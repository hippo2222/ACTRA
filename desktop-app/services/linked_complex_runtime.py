from __future__ import annotations

import base64
from typing import Optional


LINKED_COMPLEX_RUNTIME_PREFIX = "linked_library__"


def build_linked_runtime_complex_id(library_entry_id: str) -> str:
    normalized = str(library_entry_id or "").strip()
    if not normalized:
        return ""
    encoded = base64.urlsafe_b64encode(normalized.encode("utf-8")).decode("ascii").rstrip("=")
    return f"{LINKED_COMPLEX_RUNTIME_PREFIX}{encoded}"


def parse_linked_runtime_complex_id(complex_id: str) -> Optional[str]:
    normalized = str(complex_id or "").strip()
    if not normalized.startswith(LINKED_COMPLEX_RUNTIME_PREFIX):
        return None
    token = normalized[len(LINKED_COMPLEX_RUNTIME_PREFIX):].strip()
    if not token:
        return None
    padding = "=" * (-len(token) % 4)
    try:
        return base64.urlsafe_b64decode(f"{token}{padding}".encode("ascii")).decode("utf-8").strip() or None
    except Exception:
        return None
