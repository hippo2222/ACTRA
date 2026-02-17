"""
Shared helpers for archive-based import/export packages.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


class PackageIO:
    """Reusable ZIP safety, checksum and hashing utilities."""

    MAX_ARCHIVE_SIZE = 200 * 1024 * 1024  # 200 MB
    MAX_UNCOMPRESSED_RATIO = 100
    MAX_NESTING_LEVEL = 12

    def normalize_member_name(self, name: str) -> str:
        return str(name or "").replace("\\", "/")

    def validate_zip_security(self, archive_path: str) -> None:
        path_obj = Path(archive_path)
        if path_obj.stat().st_size > self.MAX_ARCHIVE_SIZE:
            raise ValueError(f"Archive too large: {path_obj.stat().st_size} bytes")

        total_size = 0
        with zipfile.ZipFile(path_obj, "r") as zf:
            for info in zf.infolist():
                normalized = self.normalize_member_name(info.filename)
                self.validate_member_path(normalized)
                total_size += info.file_size

                if info.file_size > 0:
                    ratio = info.file_size / (info.compress_size if info.compress_size > 0 else 1)
                    if ratio > self.MAX_UNCOMPRESSED_RATIO and info.file_size > 10 * 1024 * 1024:
                        raise ValueError(f"Suspicious compression ratio for {normalized}")

            if total_size > self.MAX_ARCHIVE_SIZE * 2:
                raise ValueError(f"Unpacked size too large: {total_size} bytes")

    def validate_member_path(self, member_name: str) -> None:
        normalized = self.normalize_member_name(member_name).lstrip("./")
        if not normalized:
            raise ValueError("Empty archive member path")
        if os.path.isabs(normalized):
            raise ValueError(f"Absolute path is not allowed: {member_name}")

        parts = [p for p in normalized.split("/") if p not in {"", "."}]
        if any(part == ".." for part in parts):
            raise ValueError(f"Path traversal detected: {member_name}")
        if len(parts) > self.MAX_NESTING_LEVEL:
            raise ValueError(f"Directory nesting too deep: {member_name}")

    def extract_filtered(
        self,
        archive_path: str,
        target_dir: Path,
        allowed_extensions: Optional[Set[str]] = None,
    ) -> List[Path]:
        extracted: List[Path] = []
        target_root = target_dir.resolve()
        target_dir.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(archive_path, "r") as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue

                normalized = self.normalize_member_name(info.filename)
                self.validate_member_path(normalized)
                ext = Path(normalized).suffix.lower()
                if allowed_extensions is not None and ext not in allowed_extensions:
                    continue

                destination = (target_root / normalized).resolve()
                try:
                    destination.relative_to(target_root)
                except ValueError as exc:
                    raise ValueError(f"Path traversal detected: {normalized}") from exc

                destination.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info, "r") as src, open(destination, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                extracted.append(destination)

        return extracted

    def sha256_bytes(self, payload: bytes) -> str:
        return hashlib.sha256(payload).hexdigest()

    def sha256_file(self, path: Path) -> str:
        digest = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def normalized_json_hash(
        self,
        payload: Any,
        exclude_keys: Optional[Set[str]] = None,
    ) -> str:
        cleaned = self._strip_keys(payload, exclude_keys or set())
        text = json.dumps(cleaned, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return self.sha256_bytes(text.encode("utf-8"))

    def _strip_keys(self, value: Any, exclude_keys: Set[str]) -> Any:
        if isinstance(value, dict):
            return {
                k: self._strip_keys(v, exclude_keys)
                for k, v in value.items()
                if k not in exclude_keys
            }
        if isinstance(value, list):
            return [self._strip_keys(item, exclude_keys) for item in value]
        return value

    def validate_archive_checksums(
        self,
        zf: zipfile.ZipFile,
        expected: Dict[str, str],
        ignore_paths: Optional[Set[str]] = None,
    ) -> Dict[str, List[str]]:
        ignored = {self.normalize_member_name(p) for p in (ignore_paths or set())}
        expected_norm = {
            self.normalize_member_name(path): str(digest).strip().lower()
            for path, digest in (expected or {}).items()
        }
        actual_norm = {
            self.normalize_member_name(info.filename): info
            for info in zf.infolist()
            if not info.is_dir()
        }

        missing: List[str] = []
        mismatched: List[str] = []
        extra: List[str] = []

        for path, digest in expected_norm.items():
            if path in ignored:
                continue
            info = actual_norm.get(path)
            if info is None:
                missing.append(path)
                continue
            with zf.open(info, "r") as f:
                actual_digest = self.sha256_bytes(f.read())
            if actual_digest != digest:
                mismatched.append(path)

        for path in actual_norm:
            if path in ignored:
                continue
            if path not in expected_norm:
                extra.append(path)

        return {
            "missing": sorted(missing),
            "mismatched": sorted(mismatched),
            "extra": sorted(extra),
        }

    def list_members(self, zf: zipfile.ZipFile) -> Set[str]:
        return {
            self.normalize_member_name(info.filename)
            for info in zf.infolist()
            if not info.is_dir()
        }

    def read_json_member(self, zf: zipfile.ZipFile, member_name: str) -> Dict[str, Any]:
        normalized = self.normalize_member_name(member_name)
        with zf.open(normalized, "r") as f:
            return json.load(f)

