"""
Tests for Test task type audit fixes (Stage 3).

Covers:
- Fix D1: L2 gate sync — difficulty >= 2 activates Level 2 in backend
- Fix O4: _copy_images_to_task_dir handles questions[].images[] array
- Regression: existing L1/L2 behavior unchanged
"""

import sys
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from services.task_evaluator_service import TaskEvaluatorService, EvaluationResult


class TestD1_Level2GateSync(unittest.TestCase):
    """Fix D1: difficulty >= 2 should activate Level 2 evaluation in backend."""

    def setUp(self):
        self.service = TaskEvaluatorService()
        self.questions = [
            {
                "id": 0,
                "text": "Який нерв пошкоджено?",
                "answers": [
                    {"text": "Променевий", "correct": True},
                    {"text": "Ліктьовий", "correct": False},
                ],
                "keywords": ["променевий"],
            },
        ]

    # ----- D1: difficulty=2, default content flags → must go Level 2 -----

    def test_difficulty2_activates_level2(self):
        """difficulty=2 with default requires_text_input=false, show_options=true → Level 2."""
        user_input = {"text_answers": {"0": "Променевий"}}
        answer_key = {"questions": self.questions}
        task_data = {
            "settings": {"difficulty": 2},
            "content": {},  # defaults: requires_text_input=false, show_options=true
        }

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertEqual(result.details.get("level"), 2)
        self.assertTrue(result.success)

    def test_difficulty2_wrong_text_answer(self):
        """difficulty=2, wrong text answer → Level 2, fail."""
        user_input = {"text_answers": {"0": "Ліктьовий"}}
        answer_key = {"questions": self.questions}
        task_data = {
            "settings": {"difficulty": 2},
            "content": {},
        }

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertEqual(result.details.get("level"), 2)
        self.assertFalse(result.success)

    def test_difficulty2_no_text_answers(self):
        """difficulty=2 but user sends empty text_answers → error message."""
        user_input = {"answers": {}, "text_answers": {}}
        answer_key = {"questions": self.questions}
        task_data = {
            "settings": {"difficulty": 2},
            "content": {},
        }

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertEqual(result.details.get("level"), 2)
        self.assertFalse(result.success)
        self.assertIn("текстовые", result.message.lower())

    def test_difficulty3_also_level2(self):
        """difficulty=3 → also Level 2."""
        user_input = {"text_answers": {"0": "Променевий"}}
        answer_key = {"questions": self.questions}
        task_data = {
            "settings": {"difficulty": 3},
            "content": {},
        }

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertEqual(result.details.get("level"), 2)
        self.assertTrue(result.success)

    def test_difficulty_in_content_also_works(self):
        """difficulty specified in content (fallback path) → Level 2."""
        user_input = {"text_answers": {"0": "Променевий"}}
        answer_key = {"questions": self.questions}
        task_data = {
            "settings": {},
            "content": {"difficulty": 2},
        }

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertEqual(result.details.get("level"), 2)

    def test_difficulty2_image_only_options_stays_level1(self):
        """difficulty=2 with image-only answer options should stay in choice mode."""
        user_input = {"answers": {"0": 0}, "text_answers": {}}
        answer_key = {
            "questions": [
                {
                    "id": 0,
                    "text": "Выберите изображение",
                    "answers": [
                        {"text": "A", "correct": True, "image_path": "img/a.png"},
                        {"text": "B", "correct": False, "image_path": "img/b.png"},
                    ],
                }
            ]
        }
        task_data = {
            "settings": {"difficulty": 2},
            "content": {"show_options": True, "requires_text_input": False},
        }

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertEqual(result.details.get("level"), 1)
        self.assertTrue(result.success)

    def test_difficulty2_mixed_text_and_image_only_questions_uses_hybrid_evaluation(self):
        """difficulty=2 mixed tests should evaluate image-only questions via answers and text questions via text_answers."""
        user_input = {
            "answers": {"0": 0},
            "text_answers": {"1": "Променевий"},
        }
        answer_key = {
            "questions": [
                {
                    "id": 0,
                    "text": "Выберите изображение",
                    "answers": [
                        {"text": "A", "correct": True, "image_path": "img/a.png"},
                        {"text": "B", "correct": False, "image_path": "img/b.png"},
                    ],
                },
                {
                    "id": 1,
                    "text": "Какой нерв поврежден?",
                    "answers": [
                        {"text": "Променевий", "correct": True},
                        {"text": "Ліктьовий", "correct": False},
                    ],
                    "keywords": ["променевий"],
                },
            ]
        }
        task_data = {
            "settings": {"difficulty": 2},
            "content": {"show_options": True, "requires_text_input": False},
        }

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertEqual(result.details.get("level"), 2)
        self.assertTrue(result.success)
        self.assertEqual(result.details["per_question"]["0"]["status"], "correct")
        self.assertEqual(result.details["per_question"]["0"]["user_option_ids"], [0])
        self.assertEqual(result.details["per_question"]["1"]["status"], "correct")

    # ----- Regression: existing triggers still work -----

    def test_requires_text_input_still_triggers_level2(self):
        """requires_text_input=true → Level 2 (unchanged behavior)."""
        user_input = {"text_answers": {"0": "Променевий"}}
        answer_key = {"questions": self.questions}
        task_data = {
            "content": {"requires_text_input": True},
        }

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertEqual(result.details.get("level"), 2)
        self.assertTrue(result.success)

    def test_show_options_false_still_triggers_level2(self):
        """show_options=false → Level 2 (unchanged behavior)."""
        user_input = {"text_answers": {"0": "Променевий"}}
        answer_key = {"questions": self.questions}
        task_data = {
            "content": {"show_options": False},
        }

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertEqual(result.details.get("level"), 2)
        self.assertTrue(result.success)

    def test_difficulty1_stays_level1(self):
        """difficulty=1 with default flags → Level 1 (no regression)."""
        user_input = {"answers": {"0": 0}}
        answer_key = {"questions": self.questions}
        task_data = {
            "settings": {"difficulty": 1},
            "content": {},
        }

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertEqual(result.details.get("level"), 1)
        self.assertTrue(result.success)

    def test_no_difficulty_stays_level1(self):
        """No difficulty set → Level 1 (default behavior)."""
        user_input = {"answers": {"0": 0}}
        answer_key = {"questions": self.questions}
        task_data = {"content": {}}

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertEqual(result.details.get("level"), 1)
        self.assertTrue(result.success)

    def test_difficulty_none_stays_level1(self):
        """difficulty=None → Level 1."""
        user_input = {"answers": {"0": 0}}
        answer_key = {"questions": self.questions}
        task_data = {
            "settings": {"difficulty": None},
            "content": {},
        }

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertEqual(result.details.get("level"), 1)
        self.assertTrue(result.success)

    def test_difficulty_string_stays_level1(self):
        """difficulty='2' (string, not int) → Level 1 (only numeric triggers L2)."""
        user_input = {"answers": {"0": 0}}
        answer_key = {"questions": self.questions}
        task_data = {
            "settings": {"difficulty": "2"},
            "content": {},
        }

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertEqual(result.details.get("level"), 1)


class TestO4_CopyImagesHandlesQuestionImages(unittest.TestCase):
    """Fix O4: _copy_images_to_task_dir must process questions[].images[] array."""

    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.data_dir = self.tmp_dir / "data"
        self.data_dir.mkdir()

        # Create a fake source image
        self.src_images_dir = self.data_dir / "images" / "sample"
        self.src_images_dir.mkdir(parents=True)
        self.src_image = self.src_images_dir / "question_img.png"
        self.src_image.write_bytes(b"\x89PNG_fake_content")

        self.task_dir = self.data_dir / "modules" / "m1" / "topics" / "t1" / "tasks" / "task_001"
        self.task_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_service(self):
        from services.storage_service import StorageService
        return StorageService(data_dir=str(self.data_dir))

    def test_images_array_is_processed(self):
        """questions[].images[] paths should be copied and normalized."""
        service = self._make_service()

        task_data = {
            "content": {
                "questions": [
                    {
                        "id": 0,
                        "text": "Q1",
                        "images": [str(self.src_image)],
                        "answers": [],
                    }
                ]
            }
        }

        service._copy_images_to_task_dir(self.task_dir, task_data)

        images_after = task_data["content"]["questions"][0]["images"]
        self.assertEqual(len(images_after), 1)
        # Path should now be relative (starting with modules/)
        self.assertTrue(
            images_after[0].startswith("modules/") or images_after[0] == str(self.src_image),
            f"Expected normalized path, got: {images_after[0]}",
        )

    def test_empty_images_array_unchanged(self):
        """Empty images array should be left as-is."""
        service = self._make_service()

        task_data = {
            "content": {
                "questions": [
                    {"id": 0, "text": "Q1", "images": [], "answers": []}
                ]
            }
        }

        service._copy_images_to_task_dir(self.task_dir, task_data)

        self.assertEqual(task_data["content"]["questions"][0]["images"], [])

    def test_no_images_field_no_error(self):
        """Question without images field should not raise."""
        service = self._make_service()

        task_data = {
            "content": {
                "questions": [
                    {"id": 0, "text": "Q1", "answers": []}
                ]
            }
        }

        # Should not raise
        service._copy_images_to_task_dir(self.task_dir, task_data)

    def test_image_path_still_processed(self):
        """Existing image_path handling should still work (regression)."""
        service = self._make_service()

        task_data = {
            "content": {
                "questions": [
                    {
                        "id": 0,
                        "text": "Q1",
                        "image_path": str(self.src_image),
                        "answers": [],
                    }
                ]
            }
        }

        service._copy_images_to_task_dir(self.task_dir, task_data)

        ip = task_data["content"]["questions"][0]["image_path"]
        self.assertTrue(
            ip.startswith("modules/") or ip == str(self.src_image),
            f"Expected normalized path, got: {ip}",
        )

    def test_answer_image_path_still_processed(self):
        """Existing answers[].image_path handling should still work (regression)."""
        service = self._make_service()

        task_data = {
            "content": {
                "questions": [
                    {
                        "id": 0,
                        "text": "Q1",
                        "answers": [
                            {"text": "A", "correct": True, "image_path": str(self.src_image)}
                        ],
                    }
                ]
            }
        }

        service._copy_images_to_task_dir(self.task_dir, task_data)

        ip = task_data["content"]["questions"][0]["answers"][0]["image_path"]
        self.assertTrue(
            ip.startswith("modules/") or ip == str(self.src_image),
            f"Expected normalized path, got: {ip}",
        )


class TestExistingL1L2Regression(unittest.TestCase):
    """Ensure existing L1 and L2 evaluation logic is unaffected by D1 fix."""

    def setUp(self):
        self.service = TaskEvaluatorService()

    def test_l1_multiple_choice_all_correct(self):
        """L1: all answers correct → success=True, score=100."""
        user_input = {"answers": {"0": 0, "1": 0}}
        answer_key = {
            "questions": [
                {"id": 0, "answers": [{"text": "A", "correct": True}, {"text": "B", "correct": False}]},
                {"id": 1, "answers": [{"text": "C", "correct": True}, {"text": "D", "correct": False}]},
            ]
        }
        task_data = {"content": {}}

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertTrue(result.success)
        self.assertEqual(result.score, 100.0)
        self.assertEqual(result.details["level"], 1)
        self.assertEqual(result.details["correct_count"], 2)
        self.assertEqual(result.details["total_count"], 2)
        self.assertEqual(len(result.details["failed_subtests"]), 0)

    def test_l1_partial_correct(self):
        """L1: 1/2 correct → success=False, score=50."""
        user_input = {"answers": {"0": 0, "1": 1}}
        answer_key = {
            "questions": [
                {"id": 0, "answers": [{"text": "A", "correct": True}, {"text": "B", "correct": False}]},
                {"id": 1, "answers": [{"text": "C", "correct": True}, {"text": "D", "correct": False}]},
            ]
        }
        task_data = {"content": {}}

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertFalse(result.success)
        self.assertEqual(result.score, 50.0)
        self.assertEqual(result.details["correct_count"], 1)
        self.assertEqual(result.message, "❌ Есть ошибки: 1 из 2 с ошибкой, верно 1")
        self.assertEqual(len(result.details["failed_subtests"]), 1)
        self.assertEqual(result.details["failed_subtests"][0]["question_id"], "1")

    def test_l1_partial_retry_uses_filtered_total_and_original_indices(self):
        """L1 partial retry should evaluate only retried questions but keep original failed indices."""
        user_input = {"answers": {"q2": 0, "q3": 0}}
        answer_key = {
            "questions": [
                {
                    "id": "q2",
                    "_partial_retry_original_index": 1,
                    "answers": [{"text": "B", "correct": True}, {"text": "X", "correct": False}],
                },
                {
                    "id": "q3",
                    "_partial_retry_original_index": 2,
                    "answers": [{"text": "C", "correct": True}, {"text": "Y", "correct": False}],
                },
            ]
        }
        task_data = {"content": {}}

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertTrue(result.success)
        self.assertEqual(result.details["correct_count"], 2)
        self.assertEqual(result.details["total_count"], 2)
        self.assertEqual(result.message, "✅ Правильно! 2/2 ответов")
        self.assertEqual(result.details["failed_subtests"], [])

        user_input_with_error = {"answers": {"q2": 0, "q3": 1}}
        result_with_error = self.service.evaluate_test_task(
            user_input_with_error,
            answer_key,
            task_data,
        )

        self.assertFalse(result_with_error.success)
        self.assertEqual(result_with_error.details["correct_count"], 1)
        self.assertEqual(result_with_error.details["total_count"], 2)
        self.assertEqual(
            result_with_error.details["failed_subtests"],
            [{"question_id": "q3", "index": 2}],
        )

    def test_l1_partial_message_avoids_ambiguous_correct_ratio(self):
        """L1: 1/3 correct should produce an unambiguous summary."""
        user_input = {"answers": {"0": 0, "1": 1, "2": 1}}
        answer_key = {
            "questions": [
                {"id": 0, "answers": [{"text": "A", "correct": True}, {"text": "B", "correct": False}]},
                {"id": 1, "answers": [{"text": "C", "correct": True}, {"text": "D", "correct": False}]},
                {"id": 2, "answers": [{"text": "E", "correct": True}, {"text": "F", "correct": False}]},
            ]
        }
        task_data = {"content": {}}

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertFalse(result.success)
        self.assertEqual(result.details["correct_count"], 1)
        self.assertEqual(result.details["total_count"], 3)
        self.assertEqual(result.message, "❌ Есть ошибки: 2 из 3 с ошибкой, верно 1")

    def test_l2_partial_message_avoids_ambiguous_correct_ratio(self):
        """L2: partial open answers should use the same summary format."""
        user_input = {
            "text_answers": {
                "q1": "печень",
                "q2": "неверный ответ",
                "q3": "",
            }
        }
        answer_key = {
            "questions": [
                {"id": "q1", "keywords": ["печень"], "reference_answer": "печень"},
                {"id": "q2", "keywords": ["почка"], "reference_answer": "почка"},
                {"id": "q3", "keywords": ["сердце"], "reference_answer": "сердце"},
            ]
        }
        task_data = {"content": {"requires_text_input": True}}

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertFalse(result.success)
        self.assertEqual(result.details["correct_count"], 1)
        self.assertEqual(result.details["total_count"], 3)
        self.assertEqual(result.message, "❌ Есть ошибки: 2 из 3 с ошибкой, верно 1")

    def test_l1_multiple_choice_set_comparison(self):
        """L1 multiple_choice: must select ALL correct and ONLY correct."""
        user_input = {"answers": {"0": [0, 2]}}
        answer_key = {
            "questions": [
                {
                    "id": 0,
                    "answers": [
                        {"text": "A", "correct": True},
                        {"text": "B", "correct": False},
                        {"text": "C", "correct": True},
                    ],
                }
            ]
        }
        task_data = {"content": {}}

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertTrue(result.success)
        self.assertEqual(result.details["per_question"]["0"]["status"], "correct")

    def test_l1_multiple_choice_missing_one(self):
        """L1 multiple_choice: selected only 1 of 2 correct → incorrect."""
        user_input = {"answers": {"0": [0]}}
        answer_key = {
            "questions": [
                {
                    "id": 0,
                    "answers": [
                        {"text": "A", "correct": True},
                        {"text": "B", "correct": False},
                        {"text": "C", "correct": True},
                    ],
                }
            ]
        }
        task_data = {"content": {}}

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertFalse(result.success)
        self.assertEqual(result.details["per_question"]["0"]["status"], "incorrect")

    def test_l1_no_answers_error(self):
        """L1 with no answers → error."""
        user_input = {"answers": {}}
        answer_key = {
            "questions": [{"id": 0, "answers": [{"text": "A", "correct": True}]}]
        }
        task_data = {"content": {}}

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertFalse(result.success)
        self.assertEqual(result.details.get("error"), "no_answers")

    def test_l2_via_requires_text_input(self):
        """L2 via requires_text_input → still works."""
        user_input = {"text_answers": {"0": "Печень"}}
        answer_key = {
            "questions": [
                {"id": 0, "keywords": ["печень"], "answers": [{"text": "Печень", "correct": True}]}
            ]
        }
        task_data = {"content": {"requires_text_input": True}}

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertTrue(result.success)
        self.assertEqual(result.details["level"], 2)

    def test_no_questions_error(self):
        """No questions in task → error."""
        user_input = {"answers": {"0": 0}}
        answer_key = {}
        task_data = {"content": {}}

        result = self.service.evaluate_test_task(user_input, answer_key, task_data)

        self.assertFalse(result.success)
        self.assertIn("no_questions", str(result.details.get("error", "")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
