#!/usr/bin/env python3
"""Fail-fast mojibake check for critical user-facing screens."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_TARGETS: Tuple[Path, ...] = (
    PROJECT_ROOT / "frontend" / "MainScreen" / "Main.html",
    PROJECT_ROOT / "frontend" / "Welcome" / "welcome.html",
    PROJECT_ROOT / "frontend" / "S3" / "index.html",
    PROJECT_ROOT / "desktop-app" / "webview_launcher.py",
)

# Common mojibake signatures:
# - U+FFFD replacement character
# - a broken cp1251 fragment that typically starts with U+0432 U+0402
# - a broken Latin-1/Windows-1252 fragment that typically starts with U+00E2 U+20AC
SUSPICIOUS_SUBSTRINGS: Tuple[Tuple[str, str], ...] = (
    ("\ufffd", "replacement_char"),
    ("\u0432\u0402", "cp1251_fragment"),
    ("\u00e2\u20ac", "latin1_utf8_fragment"),
)

# Repeating sequences built from U+0420/U+0421 pairs are a strong sign of
# UTF-8 Russian text decoded as cp1251.
SUSPICIOUS_REGEXES: Tuple[Tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"(?:[\u0420\u0421][\u0410-\u042F\u0430-\u044F\u0401\u0451]){4,}"),
        "cyrillic_mojibake_sequence",
    ),
)


@dataclass(frozen=True)
class MojibakeIssue:
    path: Path
    line: int
    code: str
    snippet: str


def _scan_text(path: Path, text: str) -> List[MojibakeIssue]:
    issues: List[MojibakeIssue] = []
    lines = text.splitlines()

    for line_no, line in enumerate(lines, start=1):
        for token, code in SUSPICIOUS_SUBSTRINGS:
            if token in line:
                issues.append(
                    MojibakeIssue(
                        path=path,
                        line=line_no,
                        code=code,
                        snippet=line.strip()[:160],
                    )
                )

    for regex, code in SUSPICIOUS_REGEXES:
        for match in regex.finditer(text):
            line_no = text.count("\n", 0, match.start()) + 1
            snippet = match.group(0).replace("\n", " ")[:160]
            issues.append(
                MojibakeIssue(
                    path=path,
                    line=line_no,
                    code=code,
                    snippet=snippet,
                )
            )

    return issues


def scan_file(path: Path) -> List[MojibakeIssue]:
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return [MojibakeIssue(path=path, line=1, code="file_missing", snippet="file not found")]
    except UnicodeDecodeError as exc:
        return [
            MojibakeIssue(
                path=path,
                line=1,
                code="utf8_decode_error",
                snippet=str(exc)[:160],
            )
        ]
    return _scan_text(path, text)


def _iter_targets(raw_paths: Sequence[str]) -> Iterable[Path]:
    if raw_paths:
        for raw in raw_paths:
            candidate = Path(raw)
            if not candidate.is_absolute():
                candidate = (PROJECT_ROOT / candidate).resolve()
            yield candidate
        return
    yield from DEFAULT_TARGETS


def main() -> int:
    parser = argparse.ArgumentParser(description="Detect mojibake in critical UI files.")
    parser.add_argument(
        "--file",
        action="append",
        default=[],
        help="Additional file to check (can be used multiple times).",
    )
    args = parser.parse_args()

    targets = list(_iter_targets(args.file))
    all_issues: List[MojibakeIssue] = []
    for target in targets:
        all_issues.extend(scan_file(target))

    if all_issues:
        print("Mojibake check failed:")
        for issue in all_issues:
            rel_path = issue.path
            try:
                rel_path = issue.path.resolve().relative_to(PROJECT_ROOT.resolve())
            except ValueError:
                pass
            print(f"- {rel_path}:{issue.line} [{issue.code}] {issue.snippet}")
        return 1

    print(f"Mojibake check passed for {len(targets)} file(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
