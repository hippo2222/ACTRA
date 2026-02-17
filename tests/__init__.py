# tests/__init__.py
"""
Общий пакет тестов. Расширяет путь так, чтобы pytest мог видеть как
корневые тесты, так и тесты из desktop-app/tests.
"""

from pathlib import Path
from pkgutil import extend_path

__path__ = extend_path(__path__, __name__)

_DESKTOP_APP_TESTS = Path(__file__).resolve().parent.parent / "desktop-app" / "tests"
if _DESKTOP_APP_TESTS.exists():
    __path__.append(str(_DESKTOP_APP_TESTS))
