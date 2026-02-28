"""
CLI wrapper for microcards backfill (M4).

Usage example:
  python scripts/microcards_backfill.py --data-root data --mode dry-run rebuild-all-users
"""

from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP_ROOT = REPO_ROOT / "desktop-app"
if str(DESKTOP_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_ROOT))

from services.calendar.microcards_backfill import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
