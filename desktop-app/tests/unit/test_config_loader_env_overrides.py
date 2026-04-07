import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from common.config_loader import load_config


class TestConfigLoaderEnvOverrides(unittest.TestCase):
    def test_trainter_data_root_override_beats_config_value(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            config_path = temp_root / "config.json"
            override_root = temp_root / "isolated-data"
            config_path.write_text(
                '{"data_root": "data", "task_system_root": "task_system"}',
                encoding="utf-8",
            )
            override_root.mkdir(parents=True)

            with patch.dict(os.environ, {"TRAINER_DATA_ROOT": str(override_root)}):
                config = load_config(str(config_path))

            self.assertEqual(config["data_root"], str(override_root.resolve()))

    def test_trainer_data_root_override_applies_when_config_is_missing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            missing_config_path = temp_root / "missing-config.json"
            override_root = temp_root / "isolated-data"
            override_root.mkdir(parents=True)

            with patch.dict(os.environ, {"TRAINER_DATA_ROOT": str(override_root)}):
                config = load_config(str(missing_config_path))

            self.assertEqual(config["data_root"], str(override_root.resolve()))

    def test_trainer_task_system_root_override_is_supported(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            config_path = temp_root / "config.json"
            task_system_root = temp_root / "isolated-task-system"
            config_path.write_text(
                '{"data_root": "data", "task_system_root": "task_system"}',
                encoding="utf-8",
            )
            task_system_root.mkdir(parents=True)

            with patch.dict(
                os.environ, {"TRAINER_TASK_SYSTEM_ROOT": str(task_system_root)}
            ):
                config = load_config(str(config_path))

            self.assertEqual(
                config["task_system_root"], str(task_system_root.resolve())
            )


if __name__ == "__main__":
    unittest.main()
