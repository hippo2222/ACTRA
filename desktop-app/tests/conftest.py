"""
Root conftest for desktop-app/tests.

Installs early pytest hooks and shared fixtures for the desktop-app test suite.
"""
import os
import sys
from pathlib import Path

import pytest


_DESKTOP_APP_PATH = Path(__file__).resolve().parent.parent
if str(_DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(_DESKTOP_APP_PATH))


def pytest_configure(config: pytest.Config) -> None:
    """Patch TempPathFactory to survive Windows ACL-locked stale directories.

    When stale test directories from deleted tests have broken ACLs on Windows,
    pytest's rm_rf raises PermissionError even after chmod+retry.  Normally
    pytest then tries basetemp.mkdir() but since rm_rf failed the directory
    still exists and mkdir raises FileExistsError — reported as ``ERROR at setup``.

    We patch TempPathFactory.getbasetemp to:
      1. Wrap rm_rf in a try/except so ACL-blocked dirs don't abort cleanup.
      2. Use exist_ok=True for the subsequent mkdir so a partial cleanup is OK.
    """
    try:
        import _pytest.tmpdir as _td
        from _pytest.pathlib import rm_rf as _rm_rf_orig, ensure_extended_length_path

        _original_getbasetemp = _td.TempPathFactory.getbasetemp

        if getattr(_original_getbasetemp, "_win_safe_patched", False):
            return  # already patched

        def _safe_getbasetemp(self):
            if self._basetemp is not None:
                return self._basetemp

            if self._given_basetemp is not None:
                basetemp = self._given_basetemp
                if basetemp.exists():
                    try:
                        _rm_rf_orig(basetemp)
                    except (PermissionError, OSError):
                        pass  # partial cleanup is OK; mkdir will use exist_ok
                try:
                    basetemp.mkdir(mode=0o700)
                except FileExistsError:
                    pass  # stale dir couldn't be removed; reuse it
                basetemp = basetemp.resolve()
            else:
                return _original_getbasetemp(self)

            self._basetemp = t = basetemp
            self._trace("new basetemp", t)
            return t

        _safe_getbasetemp._win_safe_patched = True  # type: ignore[attr-defined]
        _td.TempPathFactory.getbasetemp = _safe_getbasetemp  # type: ignore[assignment]
    except Exception:
        pass  # never break collection due to the patch itself failing
