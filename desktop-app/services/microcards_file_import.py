"""Binary file importers for microcards: Anki .apkg and Word .docx.

Both are parsed with the standard library only (zipfile + sqlite3 + ElementTree)
— no new runtime dependencies.

apkg (agreed scope):
- text only, media files are skipped on purpose (importing them would be
  "upload your own files" through the back door, which the product rejected);
- legacy SQLite collections (`collection.anki21` preferred, `collection.anki2`
  fallback). The new zstd-compressed `collection.anki21b` is rejected with a
  clear code — the user re-exports from Anki with "legacy support" enabled;
- basic notes: first field → front, second → back, the rest → hint;
- cloze notes: one card per cloze index ({{c1::...}} → front with the gap,
  back with the hidden answers).

docx: text extraction only — tables become tab-separated lines (column 1 =
front, column 2 = back — the common way people keep cards in Word), plain
paragraphs pass through as lines. The result is fed to the existing text
auto-parser, so the user gets the same preview/dedup pipeline.
"""

from __future__ import annotations

import html as _html
import io
import json
import os
import re
import sqlite3
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from typing import Any, Dict, List

FIELD_SEP = "\x1f"

_CLOZE_RE = re.compile(r"\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}", re.DOTALL)
_SOUND_RE = re.compile(r"\[sound:[^\]]*\]")
_BREAK_TAG_RE = re.compile(r"<\s*(?:br|/div|/p|/li|/tr)\s*/?\s*>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")


def _validate_zip_security_in_memory(zf: zipfile.ZipFile, max_size: int = 200 * 1024 * 1024) -> None:
    from services.package_io import PackageIO
    package_io = PackageIO()
    total_size = 0
    for info in zf.infolist():
        normalized = package_io.normalize_member_name(info.filename)
        package_io.validate_member_path(normalized)
        total_size += info.file_size
        if info.file_size > 0:
            ratio = info.file_size / (info.compress_size if info.compress_size > 0 else 1)
            if ratio > package_io.MAX_UNCOMPRESSED_RATIO and info.file_size > 10 * 1024 * 1024:
                raise ValueError(f"Suspicious compression ratio for {normalized}")
    if total_size > max_size * 2:
        raise ValueError(f"Unpacked size too large: {total_size} bytes")


def strip_html(text: Any) -> str:
    """Anki fields are HTML — flatten to readable plain text, keep line breaks."""
    t = str(text or "")
    t = _SOUND_RE.sub(" ", t)
    t = _BREAK_TAG_RE.sub("\n", t)
    t = _TAG_RE.sub(" ", t)
    t = _html.unescape(t)
    lines = [" ".join(ln.split()) for ln in t.split("\n")]
    return "\n".join(ln for ln in lines if ln).strip()


def _ok_row(front: str, back: str, hint: str | None) -> Dict[str, Any]:
    return {"status": "ok", "front": front, "back": back, "hint": hint or None}


def _err_row(raw: str, error: str) -> Dict[str, Any]:
    return {"status": "error", "raw": raw[:120], "error": error}


def _basic_rows(fields: List[str]) -> List[Dict[str, Any]]:
    texts = [strip_html(f) for f in fields]
    front = texts[0] if texts else ""
    back = texts[1] if len(texts) > 1 else ""
    if not front or not back:
        return [_err_row(" | ".join(t for t in texts if t), "missing_front_or_back")]
    hint = " · ".join(t for t in texts[2:] if t) or None
    return [_ok_row(front, back, hint)]


def _cloze_rows(fields: List[str]) -> List[Dict[str, Any]]:
    """One card per cloze index: the gap on the front, the hidden text on the back."""
    text = fields[0] if fields else ""
    extra = strip_html(fields[1]) if len(fields) > 1 else ""
    matches = list(_CLOZE_RE.finditer(text))
    if not matches:
        return _basic_rows(fields)
    rows: List[Dict[str, Any]] = []
    for idx in sorted({int(m.group(1)) for m in matches}):
        def _sub(m: re.Match) -> str:
            if int(m.group(1)) == idx:
                cloze_hint = m.group(3)
                return f"[{cloze_hint}]" if cloze_hint else "[...]"
            return m.group(2)  # other clozes stay revealed

        front = strip_html(_CLOZE_RE.sub(_sub, text))
        answers = [m.group(2) for m in matches if int(m.group(1)) == idx]
        back = strip_html(", ".join(answers))
        if not front or not back:
            rows.append(_err_row(strip_html(text), "empty_cloze"))
            continue
        rows.append(_ok_row(front, back, extra or None))
    return rows


def parse_apkg(data: bytes) -> List[Dict[str, Any]]:
    """Parse an .apkg into parser rows (same shape the text importers emit)."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("apkg_invalid")
    _validate_zip_security_in_memory(zf)
    names = set(zf.namelist())
    member = next((c for c in ("collection.anki21", "collection.anki2") if c in names), None)
    if member is None:
        if "collection.anki21b" in names:
            # New zstd format — tell the user to export with legacy support.
            raise ValueError("apkg_new_format_unsupported")
        raise ValueError("apkg_invalid")

    db_bytes = zf.read(member)
    # sqlite3 can't open from memory portably — stage to a temp file.
    fd, tmp_path = tempfile.mkstemp(suffix=".anki2")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(db_bytes)
        con = sqlite3.connect(tmp_path)
        try:
            cur = con.cursor()
            models: Dict[str, Any] = {}
            try:
                row = cur.execute("SELECT models FROM col LIMIT 1").fetchone()
                if row and row[0]:
                    models = json.loads(row[0])
            except (sqlite3.Error, ValueError):
                models = {}  # newest schemas keep notetypes elsewhere; treat all as basic

            rows: List[Dict[str, Any]] = []
            try:
                notes = cur.execute("SELECT mid, flds FROM notes").fetchall()
            except sqlite3.Error:
                raise ValueError("apkg_invalid")
            for mid, flds in notes:
                fields = (flds or "").split(FIELD_SEP)
                model = models.get(str(mid)) or {}
                is_cloze = int(model.get("type") or 0) == 1
                # Models can be missing (stripped col) — detect cloze by syntax too.
                if not is_cloze and fields and _CLOZE_RE.search(fields[0] or ""):
                    is_cloze = True
                rows.extend(_cloze_rows(fields) if is_cloze else _basic_rows(fields))
            return rows
        finally:
            con.close()
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _docx_para_text(p: ET.Element) -> str:
    parts: List[str] = []
    for node in p.iter():
        if node.tag == _W + "t":
            parts.append(node.text or "")
        elif node.tag in (_W + "br", _W + "tab"):
            parts.append(" ")
    return " ".join(" ".join(parts).split())


def extract_docx_text(data: bytes) -> str:
    """Flatten a .docx to text lines: tables → tab-separated rows, paragraphs as-is.

    The output goes into the existing text auto-parser (preview, dedup, separator
    detection), so a two-column Word table imports exactly like a Quizlet paste."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("docx_invalid")
    _validate_zip_security_in_memory(zf)
    try:
        xml = zf.read("word/document.xml")
    except KeyError:
        raise ValueError("docx_invalid")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        raise ValueError("docx_invalid")
    body = root.find(_W + "body")
    if body is None:
        return ""
    lines: List[str] = []
    for el in body:
        if el.tag == _W + "p":
            text = _docx_para_text(el)
            if text:
                lines.append(text)
        elif el.tag == _W + "tbl":
            for tr in el.findall(_W + "tr"):
                cells = []
                for tc in tr.findall(_W + "tc"):
                    cell_paras = [_docx_para_text(p) for p in tc.iter(_W + "p")]
                    cells.append(" ".join(t for t in cell_paras if t))
                if any(cells):
                    lines.append("\t".join(cells))
    return "\n".join(lines)
