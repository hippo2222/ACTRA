"""WSGI app loader for hosted ACTRA deployments."""

from __future__ import annotations

import importlib.util
from pathlib import Path


_SERVER_PATH = Path(__file__).resolve().parent / "desktop-app" / "server.py"
_SPEC = importlib.util.spec_from_file_location("actra_server", _SERVER_PATH)
if _SPEC is None or _SPEC.loader is None:
    raise RuntimeError(f"Failed to load ACTRA server module from {_SERVER_PATH}")

_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)
app = _MODULE.app
