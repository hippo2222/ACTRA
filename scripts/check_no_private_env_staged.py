"""Fail a commit when private environment files are staged.

This is intentionally narrower than a full secret scanner: Gitleaks handles
content scanning, while this guard blocks the most common footgun outright.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import PurePosixPath


ALLOWED_ENV_NAMES = {
    ".env.example",
    ".env.hosted.example",
    ".env.localhost.example",
}


def _staged_paths() -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "-z"],
        check=True,
        stdout=subprocess.PIPE,
    )
    raw = result.stdout.decode("utf-8", errors="replace")
    return [path for path in raw.split("\0") if path]


def _is_private_env_path(path: str) -> bool:
    name = PurePosixPath(path.replace("\\", "/")).name
    if name in ALLOWED_ENV_NAMES or name.endswith(".example"):
        return False
    return name == ".env" or name.startswith(".env.") or name.endswith(".env")


def main() -> int:
    blocked = [path for path in _staged_paths() if _is_private_env_path(path)]
    if not blocked:
        return 0

    print("Refusing to commit private environment files:", file=sys.stderr)
    for path in blocked:
        print(f"  - {path}", file=sys.stderr)
    print(
        "\nKeep real secrets in local ignored files or a secret manager. "
        "Commit only .env.example-style templates.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
