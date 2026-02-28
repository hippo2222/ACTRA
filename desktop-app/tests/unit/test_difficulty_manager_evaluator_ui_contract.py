"""
P0 contract tests for DifficultyManager -> UI mode inference -> TaskEvaluatorService.

These tests validate that DifficultyManager emits flags understood by frontend logic
and that the resulting UI payload shape is correctly evaluated by the backend.
"""

import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.difficulty_manager import DifficultyManager
from services.task_evaluator_service import TaskEvaluatorService


def _ui_test_is_open_mode(task_data):
    content = (task_data or {}).get("content", {})
    settings = (task_data or {}).get("settings", {})
    difficulty = settings.get("difficulty", (task_data or {}).get("difficulty"))
    requires_text_input = bool(content.get("requires_text_input"))
    show_options = bool(content["show_options"]) if "show_options" in content else True
    return requires_text_input or (not show_options) or (
        isinstance(difficulty, (int, float)) and difficulty >= 2
    )


def _ui_sequence_user_creates_levels(task_data):
    content = (task_data or {}).get("content", {})
    settings = (task_data or {}).get("settings", {})
    difficulty = settings.get("difficulty", (task_data or {}).get("difficulty", 1))
    requires_level_names = bool(content.get("requires_level_names"))
    return (isinstance(difficulty, (int, float)) and difficulty >= 2) or requires_level_names


class TestDifficultyManagerEvaluatorUiContract(unittest.TestCase):
    def setUp(self):
        self.difficulty_manager = DifficultyManager(config_path=None)
        self.evaluator = TaskEvaluatorService()

    def test_test_level_1_contract_multiple_choice(self):
        base_task = {
            "type": "test",
            "content": {"type": "test"},
            "settings": {"difficulty": 1},
        }
        enhanced = self.difficulty_manager.enhance_task_for_level(base_task, level=1)

        self.assertEqual(enhanced["settings"]["difficulty"], 1)
        self.assertFalse(_ui_test_is_open_mode(enhanced))
        self.assertEqual(enhanced.get("content", {}).get("mode"), "multiple_choice")

        ui_payload = {
            "type": "test",
            "questions": [],
            "answers": {"q1": 0},
            "text_answers": {},
        }
        answer_key = {
            "questions": [
                {
                    "id": "q1",
                    "answers": [
                        {"text": "A", "correct": True},
                        {"text": "B", "correct": False},
                    ],
                }
            ]
        }

        result = self.evaluator.evaluate_test_task(ui_payload, answer_key, enhanced)
        self.assertTrue(result.success)
        self.assertEqual(result.details.get("level"), 1)

    def test_test_level_2_contract_open_text_with_stale_settings(self):
        # settings.difficulty intentionally stays 1; UI/evaluator must switch via content flags.
        base_task = {
            "type": "test",
            "content": {"type": "test"},
            "settings": {"difficulty": 1},
        }
        enhanced = self.difficulty_manager.enhance_task_for_level(base_task, level=2)

        self.assertEqual(enhanced["settings"]["difficulty"], 1)
        self.assertTrue(_ui_test_is_open_mode(enhanced))
        self.assertEqual(enhanced.get("content", {}).get("mode"), "open_question")
        self.assertFalse(enhanced.get("content", {}).get("show_options", True))
        self.assertTrue(enhanced.get("content", {}).get("requires_text_input", False))

        ui_payload = {
            "type": "test",
            "questions": [],
            "answers": {},
            "text_answers": {"q1": "liver detox metabolism"},
        }
        answer_key = {
            "questions": [
                {
                    "id": "q1",
                    "keywords": ["liver", "detox", "metabolism"],
                    "reference_answer": "liver detox metabolism",
                }
            ]
        }

        result = self.evaluator.evaluate_test_task(ui_payload, answer_key, enhanced)
        self.assertTrue(result.success)
        self.assertEqual(result.details.get("level"), 2)

    def test_sequence_level_2_contract_user_created_levels(self):
        # settings.difficulty stays 1, but requires_level_names should still force UI user-created mode.
        base_task = {
            "type": "sequence_assembly",
            "content": {"type": "sequence_assembly"},
            "settings": {"difficulty": 1},
        }
        enhanced = self.difficulty_manager.enhance_task_for_level(base_task, level=2)

        self.assertEqual(enhanced["settings"]["difficulty"], 1)
        self.assertTrue(_ui_sequence_user_creates_levels(enhanced))
        self.assertTrue(enhanced.get("content", {}).get("requires_level_names", False))
        self.assertFalse(enhanced.get("content", {}).get("requires_block_names", True))

        # Simulate SequenceUI.getUserAnswerPayload() for user-created levels (different IDs than answer key).
        ui_payload = {
            "levels": [
                {"level_id": "user_level_1", "level_name": "Stage A", "blocks": ["b1"]},
                {"level_id": "user_level_2", "level_name": "Stage B", "blocks": ["b2"]},
            ]
        }
        answer_key = {
            "levels": [
                {"level_id": "level_1", "level_name": "Stage A", "blocks": ["b1"]},
                {"level_id": "level_2", "level_name": "Stage B", "blocks": ["b2"]},
            ],
            "sequence_within_level_matters": True,
            "level_order_matters": True,
        }

        result = self.evaluator.evaluate_sequence_task(ui_payload, answer_key, enhanced)
        self.assertTrue(result.success)
        self.assertEqual(result.details.get("level"), 2)
        self.assertIn("level_names", result.details)

    def test_sequence_level_3_contract_block_names_payload(self):
        base_task = {
            "type": "sequence_assembly",
            "content": {"type": "sequence_assembly"},
            "settings": {"difficulty": 1},
        }
        enhanced = self.difficulty_manager.enhance_task_for_level(base_task, level=3)

        self.assertTrue(_ui_sequence_user_creates_levels(enhanced))
        self.assertTrue(enhanced.get("content", {}).get("requires_level_names", False))
        self.assertTrue(enhanced.get("content", {}).get("requires_block_names", False))

        # Simulate SequenceUI difficulty 3 payload with block_names.
        ui_payload = {
            "levels": [
                {
                    "level_id": "level_1",
                    "level_name": "Stage A",
                    "blocks": ["slot_1", "slot_2"],
                    "block_names": {
                        "slot_1": "Alpha",
                        "slot_2": "Beta",
                    },
                }
            ]
        }
        answer_key = {
            "levels": [
                {
                    "level_id": "level_1",
                    "level_name": "Stage A",
                    "blocks": ["slot_1", "slot_2"],
                    "block_names": {
                        "slot_1": "Alpha",
                        "slot_2": "Beta",
                    },
                }
            ],
            "sequence_within_level_matters": True,
            "level_order_matters": True,
        }

        result = self.evaluator.evaluate_sequence_task(ui_payload, answer_key, enhanced)
        self.assertTrue(result.success)
        self.assertEqual(result.details.get("level"), 3)
        self.assertIn("level_names", result.details)
        self.assertIn("block_names", result.details)


if __name__ == "__main__":
    unittest.main()
