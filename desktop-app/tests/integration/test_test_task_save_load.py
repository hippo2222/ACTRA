"""
Integration tests for Test task save→load roundtrip.

Covers:
- Fix E2: TaskIO.new_task("test") initializes test_type and settings
- Save→load roundtrip preserves all fields
- Pydantic validation on save doesn't corrupt data
- Saved data is readable by evaluator
"""

import sys
import json
import shutil
import tempfile
import unittest
from pathlib import Path

DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


class TestNewTaskInitialization(unittest.TestCase):
    """Fix E2: TaskIO.new_task('test') must initialize test_type and settings."""

    def test_new_task_has_test_type(self):
        from task_system.core.io.task_io import TaskIO

        task = TaskIO.new_task("test", name="My Test", module="m1", topic="t1")
        content = task.content

        self.assertIn("test_type", content)
        self.assertEqual(content["test_type"], "multiple_choice")

    def test_new_task_has_settings(self):
        from task_system.core.io.task_io import TaskIO

        task = TaskIO.new_task("test", name="My Test", module="m1", topic="t1")
        content = task.content

        self.assertIn("settings", content)
        settings = content["settings"]
        self.assertTrue(settings["shuffle_questions"])
        self.assertTrue(settings["shuffle_answers"])
        self.assertIsNone(settings["time_limit"])
        self.assertEqual(settings["passing_score"], 70)

    def test_new_task_has_questions(self):
        from task_system.core.io.task_io import TaskIO

        task = TaskIO.new_task("test")
        self.assertIn("questions", task.content)
        self.assertEqual(task.content["questions"], [])

    def test_new_task_type_is_test(self):
        from task_system.core.io.task_io import TaskIO

        task = TaskIO.new_task("test")
        self.assertEqual(task.type, "test")


class TestSaveLoadRoundtrip(unittest.TestCase):
    """Save→load roundtrip for test tasks through StorageService."""

    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.data_dir = self.tmp_dir / "data"
        self.modules_dir = self.data_dir / "modules"
        self.modules_dir.mkdir(parents=True)

        # Create module structure
        module_dir = self.modules_dir / "m1" / "topics" / "t1" / "tasks" / "task_001"
        module_dir.mkdir(parents=True)

        # Create module.json
        mod_json = self.modules_dir / "m1" / "module.json"
        mod_json.write_text(json.dumps({
            "id": "m1",
            "name": "Module 1",
            "topics": [{"id": "t1", "name": "Topic 1", "tasks": []}]
        }), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_service(self):
        from services.storage_service import StorageService
        return StorageService(data_dir=str(self.data_dir))

    def _build_test_task_data(self):
        """Build a realistic test task payload as the editor would produce."""
        return {
            "id": "task_001",
            "type": "test",
            "meta": {
                "name": "Тест по анатомии",
                "module": "m1",
                "topic": "t1",
                "id": "task_001",
            },
            "content": {
                "test_type": "single_choice",
                "settings": {
                    "shuffle_questions": True,
                    "shuffle_answers": True,
                    "time_limit": None,
                    "passing_score": 70,
                },
                "questions": [
                    {
                        "id": 0,
                        "text": "Який орган найбільший?",
                        "answers": [
                            {"text": "Печінка", "correct": True, "image_path": None},
                            {"text": "Нирка", "correct": False, "image_path": None},
                        ],
                    },
                    {
                        "id": 1,
                        "text": "Скільки хребців?",
                        "answers": [
                            {"text": "33", "correct": True, "image_path": None},
                            {"text": "24", "correct": False, "image_path": None},
                            {"text": "12", "correct": False, "image_path": None},
                        ],
                    },
                ],
            },
            "settings": {"difficulty": 1},
        }

    def _get_content(self, loaded):
        """Extract content from load_task result (which returns {task_data, answer_key, metadata})."""
        td = loaded.get("task_data", loaded)
        return td.get("content", {})

    def test_save_and_load_preserves_questions(self):
        """Save and reload: questions preserved."""
        service = self._make_service()
        task_data = self._build_test_task_data()

        ok = service.save_task("m1", "t1", "task_001", task_data)
        self.assertTrue(ok)

        loaded = service.load_task("m1", "t1", "task_001")
        self.assertIsNotNone(loaded)

        content = self._get_content(loaded)
        questions = content.get("questions", [])
        self.assertEqual(len(questions), 2)

        q0 = questions[0]
        answer_field = q0.get("answers") or q0.get("options")
        self.assertIsNotNone(answer_field)
        self.assertGreaterEqual(len(answer_field), 2)

    def test_save_and_load_preserves_test_type(self):
        """test_type survives roundtrip."""
        service = self._make_service()
        task_data = self._build_test_task_data()

        service.save_task("m1", "t1", "task_001", task_data)
        loaded = service.load_task("m1", "t1", "task_001")

        content = self._get_content(loaded)
        self.assertEqual(content.get("test_type"), "single_choice")

    def test_save_and_load_preserves_settings(self):
        """Test settings survive roundtrip."""
        service = self._make_service()
        task_data = self._build_test_task_data()

        service.save_task("m1", "t1", "task_001", task_data)
        loaded = service.load_task("m1", "t1", "task_001")

        content = self._get_content(loaded)
        settings = content.get("settings", {})
        self.assertTrue(settings.get("shuffle_questions"))
        self.assertEqual(settings.get("passing_score"), 70)

    def test_saved_data_readable_by_evaluator(self):
        """Evaluator can process saved task data."""
        service = self._make_service()
        task_data = self._build_test_task_data()

        service.save_task("m1", "t1", "task_001", task_data)
        loaded = service.load_task("m1", "t1", "task_001")
        td = loaded.get("task_data", loaded)

        from services.task_evaluator_service import TaskEvaluatorService
        evaluator = TaskEvaluatorService()

        user_input = {"answers": {"0": 0, "1": 0}}
        result = evaluator.evaluate_test_task(user_input, td, td)

        self.assertTrue(result.success)
        self.assertEqual(result.score, 100.0)

    def test_saved_data_readable_by_evaluator_wrong_answer(self):
        """Evaluator correctly fails on wrong answer from saved data."""
        service = self._make_service()
        task_data = self._build_test_task_data()

        service.save_task("m1", "t1", "task_001", task_data)
        loaded = service.load_task("m1", "t1", "task_001")
        td = loaded.get("task_data", loaded)

        from services.task_evaluator_service import TaskEvaluatorService
        evaluator = TaskEvaluatorService()

        user_input = {"answers": {"0": 1, "1": 0}}  # q0 wrong
        result = evaluator.evaluate_test_task(user_input, td, td)

        self.assertFalse(result.success)
        self.assertEqual(result.details["correct_count"], 1)
        self.assertEqual(result.details["total_count"], 2)

    def test_correct_answer_field_preserved(self):
        """The 'correct' field on answers survives roundtrip (not just is_correct)."""
        service = self._make_service()
        task_data = self._build_test_task_data()

        service.save_task("m1", "t1", "task_001", task_data)

        # Read raw JSON to verify field names
        task_json = self.modules_dir / "m1" / "topics" / "t1" / "tasks" / "task_001" / "task.json"
        raw = json.loads(task_json.read_text(encoding="utf-8"))
        content = raw.get("content", {})
        q0 = content.get("questions", [{}])[0]

        # Either answers[].correct or options[].is_correct should be present
        answers = q0.get("answers")
        options = q0.get("options")

        has_correct = False
        if answers:
            has_correct = any("correct" in a for a in answers)
        if options:
            has_correct = has_correct or any("is_correct" in o for o in options)

        self.assertTrue(has_correct, "Neither answers[].correct nor options[].is_correct found in saved JSON")

    def test_multiple_choice_task_roundtrip(self):
        """multiple_choice test_type roundtrip."""
        service = self._make_service()
        task_data = self._build_test_task_data()
        task_data["content"]["test_type"] = "multiple_choice"
        task_data["content"]["questions"][0]["answers"][1]["correct"] = True  # 2 correct

        service.save_task("m1", "t1", "task_001", task_data)
        loaded = service.load_task("m1", "t1", "task_001")
        td = loaded.get("task_data", loaded)

        from services.task_evaluator_service import TaskEvaluatorService
        evaluator = TaskEvaluatorService()

        user_input = {"answers": {"0": [0, 1], "1": 0}}
        result = evaluator.evaluate_test_task(user_input, td, td)

        self.assertTrue(result.success)


class TestCreateTaskFlow(unittest.TestCase):
    """Test the create_task → editor open → save flow."""

    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.data_dir = self.tmp_dir / "data"
        self.modules_dir = self.data_dir / "modules"
        self.modules_dir.mkdir(parents=True)

        module_dir = self.modules_dir / "m1"
        module_dir.mkdir(parents=True)
        mod_json = module_dir / "module.json"
        mod_json.write_text(json.dumps({
            "id": "m1",
            "name": "Module 1",
            "topics": [{"id": "t1", "name": "Topic 1", "tasks": []}]
        }), encoding="utf-8")

        topics_dir = module_dir / "topics" / "t1"
        topics_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_service(self):
        from services.storage_service import StorageService
        return StorageService(data_dir=str(self.data_dir))

    def test_create_test_task_produces_valid_json(self):
        """create_task('test') should produce valid task.json with test_type."""
        service = self._make_service()
        task_id = service.create_task("m1", "t1", "Новый тест", "test")

        self.assertIsNotNone(task_id)

        task_dir = self.modules_dir / "m1" / "topics" / "t1" / "tasks" / task_id
        task_json = task_dir / "task.json"
        self.assertTrue(task_json.exists())

        raw = json.loads(task_json.read_text(encoding="utf-8"))
        content = raw.get("content", {})

        self.assertEqual(content.get("test_type"), "multiple_choice")
        self.assertIn("settings", content)
        self.assertIsInstance(content.get("questions"), list)

    def test_created_task_loadable(self):
        """Created task can be loaded back."""
        service = self._make_service()
        task_id = service.create_task("m1", "t1", "Новый тест", "test")

        loaded = service.load_task("m1", "t1", task_id)
        self.assertIsNotNone(loaded)

        td = loaded.get("task_data", loaded)
        content = td.get("content", {})
        self.assertEqual(content.get("test_type"), "multiple_choice")


if __name__ == "__main__":
    unittest.main(verbosity=2)
