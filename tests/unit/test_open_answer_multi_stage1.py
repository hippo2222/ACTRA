"""
Unit tests for Stage 1: Open Answer Modernization (Data Models, Backend Storage, Parser, and Evaluator).
"""

import pytest
from pathlib import Path
from typing import Dict, Any

from task_system.core.models.task_models import OpenAnswerTaskContent, OpenAnswerQuestionItem
from task_system.core.models.answer_key_models import OpenAnswerTaskAnswerKey
from task_system.models.parsers.open_answer_parser import OpenAnswerParser
from services.storage_service import StorageService
from services.task_evaluator_service import TaskEvaluatorService, EvaluationResult


class TestOpenAnswerModelsStage1:
    """Test Pydantic models for multi-question open answer tasks."""

    def test_open_answer_question_item_creation(self):
        item = OpenAnswerQuestionItem(
            id="q_1",
            question="What is the cardiac apex?",
            reference_answer="Lower tip of the heart",
            keywords=["apex", "heart"],
            levels=[1, 2],
            case_sensitive=False,
            sequence_matters=True,
        )
        assert item.id == "q_1"
        assert item.question == "What is the cardiac apex?"
        assert item.reference_answer == "Lower tip of the heart"
        assert item.keywords == ["apex", "heart"]
        assert item.levels == [1, 2]
        assert item.sequence_matters is True

    def test_open_answer_content_multi_question_mirroring(self):
        """Verify that questions[0] is automatically mirrored to top-level fields for backwards compatibility."""
        content = OpenAnswerTaskContent(
            case_text="Patient presents with acute chest pain.",
            display_mode="sequential",
            questions=[
                {
                    "id": "q_1",
                    "question": "What is the primary rhythm?",
                    "reference_answer": "Sinus rhythm",
                    "keywords": ["sinus", "rhythm"],
                    "levels": [1, 2, 3],
                },
                {
                    "id": "q_2",
                    "question": "Are there ST elevations?",
                    "reference_answer": "No ST elevation",
                    "keywords": ["no", "elevation"],
                    "levels": [2, 3],
                },
            ],
        )
        assert content.case_text == "Patient presents with acute chest pain."
        assert content.display_mode == "sequential"
        assert len(content.questions) == 2
        # Backwards compatibility mirroring
        assert content.question == "What is the primary rhythm?"
        assert content.prompt == "What is the primary rhythm?"
        assert content.reference_answer == "Sinus rhythm"
        assert content.keywords == ["sinus", "rhythm"]

    def test_open_answer_content_legacy_single_question(self):
        """Verify legacy single-question creation still works without errors."""
        content = OpenAnswerTaskContent(
            question="Describe the ECG finding",
            reference_answer="Normal variant",
            keywords=["normal", "variant"],
        )
        assert content.question == "Describe the ECG finding"
        assert content.prompt == "Describe the ECG finding"
        assert content.reference_answer == "Normal variant"
        assert content.keywords == ["normal", "variant"]

    def test_open_answer_answer_key_multi_question(self):
        key = OpenAnswerTaskAnswerKey(
            display_mode="sequential",
            case_text="Case narrative",
            questions=[
                {"id": "q_1", "keywords": ["apex"], "reference_answer": "Apex"},
                {"id": "q_2", "keywords": ["base"], "reference_answer": "Base"},
            ],
        )
        assert key.display_mode == "sequential"
        assert key.case_text == "Case narrative"
        assert len(key.questions) == 2


class TestOpenAnswerParserStage1:
    """Test parser support for multi-question syntax."""

    def test_parse_multi_question_format(self):
        raw_text = """
@OPEN_ANSWER
@case_text: Пациент 58 лет с жалобами на одышку.
@display_mode: sequential
? Какой основной ритм? [levels: 1, 2]
= Синусовый ритм
* синусовый
* ритм

? Есть ли признаки гипертрофии? [levels: 2, 3]
= Гипертрофия левого желудочка
* гипертрофия
* желудочка
"""
        parser = OpenAnswerParser()
        tasks = parser.parse_text(raw_text)
        assert len(tasks) == 1
        task = tasks[0]
        assert task["type"] == "open_answer"
        data = task["data"]
        assert data["case_text"] == "Пациент 58 лет с жалобами на одышку."
        assert data["display_mode"] == "sequential"
        assert len(data["questions"]) == 2

        q1 = data["questions"][0]
        assert q1["question"] == "Какой основной ритм?"
        assert q1["levels"] == [1, 2]
        assert q1["reference_answer"] == "Синусовый ритм"
        assert "синусовый" in q1["keywords"]
        assert "ритм" in q1["keywords"]

        q2 = data["questions"][1]
        assert q2["question"] == "Есть ли признаки гипертрофии?"
        assert q2["levels"] == [2, 3]
        assert q2["reference_answer"] == "Гипертрофия левого желудочка"

        # Mirroring check
        assert data["question"] == "Какой основной ритм?"
        assert data["reference_answer"] == "Синусовый ритм"

    def test_parse_single_question_backward_compatibility(self):
        raw_text = """
@OPEN_ANSWER
# Какой ритм сердца на ЭКГ?
= Синусовая тахикардия
* тахикардия
* синусовая
"""
        parser = OpenAnswerParser()
        tasks = parser.parse_text(raw_text)
        assert len(tasks) == 1
        task = tasks[0]
        assert task["data"]["question"] == "Какой ритм сердца на ЭКГ?"
        assert task["data"]["reference_answer"] == "Синусовая тахикардия"
        assert len(task["data"]["keywords"]) == 2


class TestStorageServiceOpenAnswerStage1:
    """Test StorageService sanitization and answer key extraction."""

    def test_sanitize_and_extract_multi_question(self, tmp_path):
        service = StorageService(tmp_path)

        task_data = {
            "type": "open_answer",
            "content": {
                "display_mode": "sequential",
                "case_text": "Clinical context text",
                "questions": [
                    {
                        "id": "q_1",
                        "question": " First question ",
                        "reference_answer": " Ref 1 ",
                        "keywords": [{"text": "word1"}, "word2"],
                        "levels": ["1", "2"],
                    },
                    {
                        "id": "q_2",
                        "question": "Second question",
                        "reference_answer": "Ref 2",
                        "keywords": ["word3"],
                        "levels": [2, 3],
                    },
                ],
            },
            "settings": {"difficulty": 1},
        }

        service._sanitize_open_answer_payload_for_save(task_data)
        content = task_data["content"]
        assert content["display_mode"] == "sequential"
        assert content["case_text"] == "Clinical context text"
        assert len(content["questions"]) == 2
        assert content["questions"][0]["question"] == "First question"
        assert content["questions"][0]["keywords"] == ["word1", "word2"]
        assert content["questions"][0]["levels"] == [1, 2]

        # First question mirrored
        assert content["question"] == "First question"
        assert content["reference_answer"] == "Ref 1"
        assert content["keywords"] == ["word1", "word2"]

        # Extract answer key
        answer_key = service._normalize_answer_key(task_data, {})
        assert answer_key["display_mode"] == "sequential"
        assert answer_key["case_text"] == "Clinical context text"
        assert len(answer_key["questions"]) == 2


class TestTaskEvaluatorOpenAnswerStage1:
    """Test TaskEvaluatorService for multi-question and sequential step evaluation."""

    def setup_method(self):
        self.evaluator = TaskEvaluatorService()

    def test_single_question_legacy_evaluation(self):
        answer_key = {
            "keywords": ["синусовый", "ритм"],
            "sequence_matters": True,
            "reference_answer": "Синусовый ритм",
        }
        res = self.evaluator.evaluate_open_answer_task(
            user_input={"answer": "синусовый ритм"},
            answer_key=answer_key,
        )
        assert res.success is True
        assert res.score == 100.0
        assert "синусовый" in res.details["found_keywords"]

    def test_sequential_step_evaluation(self):
        """Option 1Б: step evaluation with instant feedback revealing reference answer."""
        task_data = {
            "type": "open_answer",
            "content": {
                "display_mode": "sequential",
                "questions": [
                    {
                        "id": "q_1",
                        "question": "Вопрос 1",
                        "keywords": ["инфаркт"],
                        "reference_answer": "Острый инфаркт миокарда",
                    },
                    {
                        "id": "q_2",
                        "question": "Вопрос 2",
                        "keywords": ["передняя", "стенка"],
                        "reference_answer": "Передняя стенка ЛЖ",
                    },
                ],
            },
        }

        # Step check question 1
        res = self.evaluator.evaluate_open_answer_task(
            user_input={"question_id": "q_1", "answer": "инфаркт миокарда"},
            answer_key=task_data["content"],
            task_data=task_data,
        )
        assert res.success is True
        assert res.details["is_sequential_step"] is True
        assert res.details["question_id"] == "q_1"
        assert res.details["reference_answer"] == "Острый инфаркт миокарда"

    def test_simultaneous_multi_question_evaluation(self):
        """Simultaneous mode: evaluation of all questions at once."""
        task_data = {
            "type": "open_answer",
            "content": {
                "display_mode": "simultaneous",
                "questions": [
                    {"id": "q_1", "question": "Q1", "keywords": ["альфа"], "reference_answer": "Альфа"},
                    {"id": "q_2", "question": "Q2", "keywords": ["бета"], "reference_answer": "Бета"},
                ],
            },
        }

        # Both correct
        res = self.evaluator.evaluate_open_answer_task(
            user_input={"answers": {"q_1": "альфа ритм", "q_2": "бета волна"}},
            answer_key=task_data["content"],
            task_data=task_data,
        )
        assert res.success is True
        assert res.score == 100.0
        assert res.details["total_questions"] == 2
        assert res.details["passed_questions"] == 2
        assert len(res.details["failed_question_ids"]) == 0

        # One correct, one wrong
        res_partial = self.evaluator.evaluate_open_answer_task(
            user_input={"answers": {"q_1": "альфа ритм", "q_2": "гамма волна"}},
            answer_key=task_data["content"],
            task_data=task_data,
        )
        assert res_partial.success is False
        assert res_partial.score == 50.0
        assert res_partial.details["passed_questions"] == 1
        assert res_partial.details["failed_question_ids"] == ["q_2"]
        assert res_partial.details["failed_question_indices"] == [1]

    def test_difficulty_filtering_and_smart_retry(self):
        """Test question filtering by difficulty level and Smart Partial Retry."""
        task_data = {
            "type": "open_answer",
            "settings": {"difficulty": 1},
            "content": {
                "display_mode": "simultaneous",
                "questions": [
                    {"id": "q_1", "question": "Q1", "keywords": ["один"], "levels": [1, 2, 3]},
                    {"id": "q_2", "question": "Q2", "keywords": ["два"], "levels": [2, 3]},
                ],
            },
        }

        # On difficulty 1, only q_1 is active
        res_lvl1 = self.evaluator.evaluate_open_answer_task(
            user_input={"answers": {"q_1": "один"}},
            answer_key=task_data["content"],
            task_data=task_data,
        )
        assert res_lvl1.success is True
        assert res_lvl1.details["total_questions"] == 1
        assert "q_1" in res_lvl1.details["questions"]
        assert "q_2" not in res_lvl1.details["questions"]

        # Smart Partial Retry: on difficulty 2, q_1 was already passed in preserved_results
        task_data["settings"]["difficulty"] = 2
        res_retry = self.evaluator.evaluate_open_answer_task(
            user_input={
                "answers": {"q_2": "два"},
                "preserved_results": {
                    "q_1": {"success": True, "score": 100.0, "found_keywords": ["один"]}
                },
            },
            answer_key=task_data["content"],
            task_data=task_data,
        )
        assert res_retry.success is True
        assert res_retry.details["total_questions"] == 2
        assert res_retry.details["passed_questions"] == 2
        assert res_retry.details["questions"]["q_1"]["success"] is True
        assert res_retry.details["questions"]["q_2"]["success"] is True
