import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

DESKTOP_APP_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = Path(__file__).resolve().parents[3]

if str(DESKTOP_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_ROOT))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server import _resolve_bootstrap_user_id


class TestServerBootstrapOverrides(unittest.TestCase):
    def test_explicit_user_id_beats_env_override(self):
        with patch.dict(os.environ, {"TRAINER_STARTUP_USER_ID": "env_user"}):
            resolved = _resolve_bootstrap_user_id("explicit_user")

        self.assertEqual(resolved, "explicit_user")

    def test_default_user_can_be_overridden_from_env(self):
        with patch.dict(os.environ, {"TRAINER_STARTUP_USER_ID": "audit_user"}):
            resolved = _resolve_bootstrap_user_id("default_user")

        self.assertEqual(resolved, "audit_user")

    def test_guest_env_override_normalizes_to_empty_string(self):
        with patch.dict(os.environ, {"TRAINER_STARTUP_USER_ID": "guest"}):
            resolved = _resolve_bootstrap_user_id("default_user")

        self.assertEqual(resolved, "")


if __name__ == "__main__":
    unittest.main()
