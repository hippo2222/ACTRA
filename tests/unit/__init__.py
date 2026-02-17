# Package marker for unit tests.
from pathlib import Path
from pkgutil import extend_path

__path__ = extend_path(__path__, __name__)

_DESKTOP_APP_UNIT_TESTS = Path(__file__).resolve().parent.parent.parent / "desktop-app" / "tests" / "unit"
if _DESKTOP_APP_UNIT_TESTS.exists():
    __path__.append(str(_DESKTOP_APP_UNIT_TESTS))
