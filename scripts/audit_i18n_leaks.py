#!/usr/bin/env python3
"""
ACTRA - Truly Systemic i18n Leak Auditor & CI Ratchet Guardrail
==============================================================
Scans all frontend JavaScript and HTML files for hardcoded, unlocalized Cyrillic strings.

Detects:
1. Literal Cyrillic [\\u0400-\\u04FF] in JS outside of wt(), _wt(), t(), comments, and loggers.
2. Unicode-escaped Cyrillic (\\u04xx) in JS outside of wt(), _wt(), t(), comments, and loggers.
3. Visible Cyrillic text in HTML tags lacking data-i18n.
4. Cyrillic text in HTML attributes (placeholder, title, aria-label, alt) lacking data-i18n-*.

Features:
- Accurate HTML DOM parsing (handles multiline tags, nested tags, avoids false positives).
- Accurate JS masking (handles single/double/template literal quotes, regexes, comments).
- CI mode with Ratchet Baseline: fails on any NEW leak, encourages lowering the baseline.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, List, NamedTuple, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = Path(__file__).resolve().parent.parent

IGNORE_DIRS = {
    "node_modules",
    ".git",
    "locales",
    "vendor",
    "dist",
    "build",
    ".venv",
    "__pycache__",
    "tests",
    "docs",
    "scripts",
}

CYRILLIC_LITERAL = re.compile(r"[\u0400-\u04FF]")
CYRILLIC_ESCAPED = re.compile(r"\\u04[0-9a-fA-F]{2}")
ANY_CYRILLIC = re.compile(r"[\u0400-\u04FF]|\\u04[0-9a-fA-F]{2}")


class Leak(NamedTuple):
    file: str
    line: int
    leak_type: str  # "literal_cyrillic", "escaped_unicode", "html_text", "html_attr"
    snippet: str


# ── HTML Auditor ─────────────────────────────────────────────────────────────
class I18nHtmlAuditor(HTMLParser):
    def __init__(self, rel_path: str):
        super().__init__()
        self.rel_path = rel_path
        self.stack: List[Tuple[str, Dict[str, str], Tuple[int, int]]] = []
        self.leaks: List[Leak] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, str | None]]):
        attr_dict = {k: v or "" for k, v in attrs}
        self.stack.append((tag, attr_dict, self.getpos()))

        # Check attributes that show user-facing text
        for attr in ["placeholder", "title", "aria-label", "alt"]:
            val = attr_dict.get(attr, "")
            if val and ANY_CYRILLIC.search(val):
                i18n_attr = f"data-i18n-{attr}" if attr != "aria-label" else "data-i18n-aria"
                has_attr_i18n = i18n_attr in attr_dict or "data-i18n" in attr_dict
                if not has_attr_i18n and "data-i18n-attr" in attr_dict:
                    has_attr_i18n = f"{attr}|" in attr_dict["data-i18n-attr"]
                if not has_attr_i18n:
                    line, _ = self.getpos()
                    self.leaks.append(
                        Leak(
                            file=self.rel_path,
                            line=line,
                            leak_type="html_attr",
                            snippet=f'<{tag} {attr}="{val[:60]}">',
                        )
                    )

    def handle_endtag(self, tag: str):
        if self.stack:
            self.stack.pop()

    def handle_data(self, data: str):
        if self.stack and self.stack[-1][0] in ["script", "style"]:
            return
        clean = data.strip()
        if clean and ANY_CYRILLIC.search(clean):
            # Check if any parent element in stack has data-i18n
            has_i18n = any("data-i18n" in attrs for _, attrs, _ in self.stack)
            if not has_i18n:
                # Ignore language selector text
                if clean in ["Русский", "Українська"]:
                    return
                parent_tag, _, pos = self.stack[-1] if self.stack else ("root", {}, (0, 0))
                self.leaks.append(
                    Leak(
                        file=self.rel_path,
                        line=pos[0],
                        leak_type="html_text",
                        snippet=f"<{parent_tag}> {clean[:70]}",
                    )
                )


def audit_html_file(filepath: Path) -> List[Leak]:
    rel_path = str(filepath.relative_to(PROJECT_ROOT)).replace("\\", "/")
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except Exception:
        return []

    auditor = I18nHtmlAuditor(rel_path)
    try:
        auditor.feed(content)
    except Exception:
        pass
    return auditor.leaks


# ── JavaScript Auditor ───────────────────────────────────────────────────────
def mask_safe_js_calls(content: str) -> str:
    """Masks comments, console calls, regex literals, and wt/t/wtf calls with spaces of equal length, preserving newlines."""
    def _mask_preserve_newlines(s: str) -> str:
        return re.sub(r"[^\n]", " ", s)

    # 1. Block comments (preserve newlines!)
    content = re.sub(r"/\*[\s\S]*?\*/", lambda m: _mask_preserve_newlines(m.group(0)), content)
    # 2. Line comments
    content = re.sub(r"//.*$", lambda m: " " * len(m.group(0)), content, flags=re.MULTILINE)
    # 3. Console / logger calls (preserve newlines if multiline)
    content = re.sub(
        r"\b(?:console|logger)\s*\.\s*(?:log|warn|error|info|debug)\s*\([^)]*\)",
        lambda m: _mask_preserve_newlines(m.group(0)),
        content,
    )
    # 4. Standard i18n wrapper calls: wt('key', 'fallback', ...) or _wt(...) or wtf(...) or tTour(...) or t(...)
    # We match both single-quoted, double-quoted, and backtick strings (preserve newlines if multiline)
    content = re.sub(
        r"\b(?:wt|_wt|wtf|tTour|t)\s*\(\s*(['\"`])(?:(?!\1)[\s\S])*?\1(?:\s*,\s*(['\"`])(?:(?!\2)[\s\S])*?\2)?(?:\s*,\s*\{[\s\S]*?\})?\s*\)",
        lambda m: _mask_preserve_newlines(m.group(0)),
        content,
    )
    # 5. Regex literals matching cyrillic: /[а-я]/i
    content = re.sub(r"/(?:\\/|[^/\n])+/[gimsuy]*", lambda m: " " * len(m.group(0)), content)

    return content


def audit_js_file(filepath: Path) -> List[Leak]:
    rel_path = str(filepath.relative_to(PROJECT_ROOT)).replace("\\", "/")
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            orig = f.read()
    except Exception:
        return []

    masked = mask_safe_js_calls(orig)
    orig_lines = orig.splitlines()
    masked_lines = masked.splitlines()

    leaks: List[Leak] = []

    for idx, (m_line, o_line) in enumerate(zip(masked_lines, orig_lines), 1):
        if not ANY_CYRILLIC.search(m_line):
            continue

        clean_orig = o_line.strip()
        # Exclude language picker declarations
        if "['ru'," in clean_orig or '["ru",' in clean_orig or "value: 'ru'" in clean_orig:
            continue
        # Exclude layout/transliteration mappers
        if "й: 'q'" in clean_orig or "q: 'й'" in clean_orig or "CYRILLIC_TO_LATIN" in clean_orig:
            continue

        leak_type = "escaped_unicode" if CYRILLIC_ESCAPED.search(m_line) else "literal_cyrillic"
        leaks.append(Leak(file=rel_path, line=idx, leak_type=leak_type, snippet=clean_orig[:110]))

    return leaks


# ── Scanner ──────────────────────────────────────────────────────────────────
def scan_all(target_dirs: List[str] = ["frontend"]) -> Dict[str, List[Leak]]:
    all_leaks: Dict[str, List[Leak]] = {}

    for tdir in target_dirs:
        base = PROJECT_ROOT / tdir
        if not base.exists():
            continue
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]

            for file in files:
                fpath = Path(root) / file
                ext = fpath.suffix.lower()
                rel = str(fpath.relative_to(PROJECT_ROOT)).replace("\\", "/")
                if ext == ".js":
                    file_leaks = audit_js_file(fpath)
                    if file_leaks:
                        all_leaks[rel] = file_leaks
                elif ext == ".html":
                    file_leaks = audit_html_file(fpath)
                    if file_leaks:
                        all_leaks[rel] = file_leaks

    return all_leaks


def main():
    parser = argparse.ArgumentParser(description="Audit hardcoded Cyrillic leaks across frontend code")
    parser.add_argument("--json", action="store_true", help="Output JSON report")
    parser.add_argument("--summary", action="store_true", help="Show summary count per file")
    parser.add_argument("--filter", type=str, default="", help="Filter by file path substring")
    parser.add_argument("--ci", action="store_true", help="Run in CI mode against baseline")
    parser.add_argument(
        "--baseline",
        type=str,
        default="tests/fixtures/i18n_hardcoded_baseline.json",
        help="Baseline path",
    )
    parser.add_argument(
        "--update-baseline", action="store_true", help="Update the baseline file with current counts"
    )
    args = parser.parse_args()

    leaks_by_file = scan_all(["frontend"])

    if args.filter:
        leaks_by_file = {k: v for k, v in leaks_by_file.items() if args.filter in k}

    total_leaks = sum(len(v) for v in leaks_by_file.values())
    total_files = len(leaks_by_file)

    if args.update_baseline:
        baseline_file = PROJECT_ROOT / args.baseline
        baseline_file.parent.mkdir(parents=True, exist_ok=True)
        baseline_data = {
            "total_leaks": total_leaks,
            "total_files": total_files,
            "counts_by_file": {k: len(v) for k, v in sorted(leaks_by_file.items())},
        }
        with open(baseline_file, "w", encoding="utf-8") as f:
            json.dump(baseline_data, f, indent=2, ensure_ascii=False)
        print(f"Updated baseline at {args.baseline} with {total_leaks} leaks across {total_files} files.")
        return 0

    if args.json:
        out = {
            "total_leaks": total_leaks,
            "total_files": total_files,
            "leaks": {k: [l._asdict() for l in v] for k, v in leaks_by_file.items()},
        }
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0

    print("\n=== ACTRA i18n Hardcoded String Leak Audit ===")
    print(f"Total unlocalized string leaks found: {total_leaks} in {total_files} files\n")

    for file_path, leaks in sorted(leaks_by_file.items(), key=lambda x: -len(x[1])):
        print(f"  [{len(leaks):3d} leaks] {file_path}")
        if not args.summary:
            for l in leaks[:5]:
                print(f"       L{l.line:4d} ({l.leak_type}): {l.snippet}")
            if len(leaks) > 5:
                print(f"       ... and {len(leaks) - 5} more")

    if args.ci:
        baseline_file = PROJECT_ROOT / args.baseline
        if not baseline_file.exists():
            print(f"\n[CI ERROR] Baseline file {args.baseline} not found!")
            print("Run `python scripts/audit_i18n_leaks.py --update-baseline` to initialize baseline.")
            return 1
        with open(baseline_file, "r", encoding="utf-8") as f:
            base_data = json.load(f)
        allowed_max = base_data.get("total_leaks", 0)
        base_counts = base_data.get("counts_by_file", {})

        new_debts = []
        for fpath, leaks in leaks_by_file.items():
            prev = base_counts.get(fpath, 0)
            if len(leaks) > prev:
                new_debts.append(f"{fpath}: was {prev}, now {len(leaks)} (+{len(leaks) - prev})")

        if new_debts:
            print("\n[CI FAILURE] New unlocalized string debt introduced!")
            for d in new_debts:
                print(f"  ❌ {d}")
            print("\nYou must wrap all new user-facing strings with wt('key', fallback) or data-i18n!")
            return 1

        if total_leaks < allowed_max:
            print(f"\n🎉 Progress! Leak count decreased from {allowed_max} to {total_leaks}.")
            print("Please run `python scripts/audit_i18n_leaks.py --update-baseline` to lock in this progress!")

        print("\n✅ CI Gate Passed: Zero new unlocalized strings introduced.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
