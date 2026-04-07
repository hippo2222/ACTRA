import shutil
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.storage_service import StorageService


class TestStorageServiceDrawTargets(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.service = StorageService(self.temp_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_normalize_answer_key_preserves_freehand_annotations(self):
        task_data = {
            "type": "draw",
            "content": {
                "annotations": [
                    {
                        "type": "polygon",
                        "label": "Контур",
                        "points": [[0, 0], [20, 0], [20, 20], [0, 20]],
                    },
                    {
                        "type": "freehand",
                        "label": "Линия",
                        "points": [[30, 10], [40, 10], [50, 12], [60, 12]],
                    },
                ]
            },
        }

        normalized = self.service._normalize_answer_key(task_data, {})

        self.assertEqual(
            [target.get("shape") for target in normalized.get("targets", [])],
            ["polygon", "freehand"],
        )


if __name__ == "__main__":
    unittest.main()
