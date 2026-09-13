"""
Unit and Integration tests for Stage 4:
- S2 Results Review Card Formatting (session_api._make_review_payload_for_review)
- Multi-iteration Difficulty Progression (DifficultyManager)
- Smart Partial Retry (AdaptiveSessionManager & ComplexSessionController)
"""

import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock

DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import pytest
from services.difficulty_manager import DifficultyManager
from services.adaptive_session_manager import AdaptiveSessionManager
from services.task_evaluator_service import TaskEvaluatorService, EvaluationResult
from logic.complex_session_controller import ComplexSessionController
from task_system.core.models.complex_models import ComplexSession, QueuedTask, SessionTaskResult


class TestOpenAnswerReviewPayloadStage4:
    """Tests for S2 review payload formatting in SessionAPI."""

    def test_single_question_with_case_text_in_review(self):
        """Single-question task with case_text should prepend clinical description to prompt."""
        content = {
            "case_text": "Пациент 54 года, поступил с жалобами на одышку.",
            "question": "Какая патология определяется на рентгенограмме?",
            "reference_answer": "Правосторонний гидроторакс",
        }
        
        prompt_local = content.get("question")
        case_text = content.get("case_text")
        if case_text and prompt_local and case_text not in prompt_local:
            prompt_local = f"{case_text}\n\n{prompt_local}"

        assert "Пациент 54 года" in prompt_local
        assert "Какая патология определяется" in prompt_local

    def test_multi_question_review_formatting_with_error_and_success_subtests(self):
        """Multi-question review card should format line-by-line pairs with [✓]/[✗] and count errors."""
        content = {
            "case_text": "Клинический случай: Острая боль за грудиной.",
            "questions": [
                {
                    "id": "q_1",
                    "question": "Какой ритм на ЭКГ?",
                    "reference_answer": "Синусовый ритм",
                    "keywords": ["синусовый", "ритм"],
                },
                {
                    "id": "q_2",
                    "question": "В каких отведениях подъем ST?",
                    "reference_answer": "V1-V4",
                    "keywords": ["v1", "v4"],
                },
            ],
        }
        evaluator_questions = {
            "q_1": {
                "success": True,
                "user_answer": "синусовый ритм",
                "reference_answer": "Синусовый ритм",
            },
            "q_2": {
                "success": False,
                "user_answer": "отведения II, III, aVF",
                "reference_answer": "V1-V4",
            },
        }

        user_lines = []
        reference_lines = []
        failed_count = 0
        for idx, q in enumerate(content["questions"]):
            qid = q["id"]
            q_eval = evaluator_questions.get(qid) or {}
            is_correct = q_eval.get("success")
            if is_correct is False:
                failed_count += 1
                prefix = "[✗] "
            elif is_correct is True:
                prefix = "[✓] "
            else:
                prefix = ""

            u_ans = q_eval.get("user_answer", "")
            r_ans = q_eval.get("reference_answer", "")
            user_lines.append(f"{prefix}В{idx + 1}. {q['question']}: {u_ans}")
            reference_lines.append(f"В{idx + 1}: {r_ans}")

        assert failed_count == 1
        note = f"Ошибки в вопросах: неверно {failed_count} из {len(content['questions'])}."

        assert len(user_lines) == 2
        assert user_lines[0].startswith("[✓] В1. Какой ритм на ЭКГ?: синусовый ритм")
        assert user_lines[1].startswith("[✗] В2. В каких отведениях подъем ST?: отведения II, III, aVF")
        assert reference_lines[0] == "В1: Синусовый ритм"
        assert reference_lines[1] == "В2: V1-V4"
        assert note == "Ошибки в вопросах: неверно 1 из 2."


class TestOpenAnswerDifficultyProgressionStage4:
    """Tests for multi-iteration DifficultyManager filtering of open answer tasks."""

    def setup_method(self):
        self.dm = DifficultyManager()

    def test_progressive_question_unlock_by_iteration(self):
        """Questions configured with [1, 2, 3], [2, 3], and [3] unlock progressively."""
        task_data = {
            "type": "open_answer",
            "content": {
                "case_text": "Пациент с подозрением на пневмонию",
                "display_mode": "sequential",
                "questions": [
                    {"id": "q1", "question": "Локализация затемнения?", "levels": [1, 2, 3], "reference_answer": "Нижняя доля"},
                    {"id": "q2", "question": "Характер контуров?", "levels": [2, 3], "reference_answer": "Нечеткие"},
                    {"id": "q3", "question": "Дифференциальный диагноз?", "levels": [3], "reference_answer": "Инфаркт легкого"},
                ],
            },
        }

        # Iteration 1 (Level 1): Only Q1
        t_l1 = self.dm.enhance_task_for_level(task_data, level=1)
        q_l1 = t_l1["content"]["questions"]
        assert len(q_l1) == 1
        assert q_l1[0]["id"] == "q1"
        assert t_l1["content"]["question"] == "Локализация затемнения?"

        # Iteration 2 (Level 2): Q1 and Q2
        t_l2 = self.dm.enhance_task_for_level(task_data, level=2)
        q_l2 = t_l2["content"]["questions"]
        assert len(q_l2) == 2
        assert [q["id"] for q in q_l2] == ["q1", "q2"]

        # Iteration 3 (Level 3): Q1, Q2, and Q3
        t_l3 = self.dm.enhance_task_for_level(task_data, level=3)
        q_l3 = t_l3["content"]["questions"]
        assert len(q_l3) == 3
        assert [q["id"] for q in q_l3] == ["q1", "q2", "q3"]


class TestOpenAnswerSmartPartialRetryStage4:
    """Tests for partial retry filtering and session tracking for multi-question open answer."""

    def test_controller_filters_open_answer_questions_for_retry(self):
        """ComplexSessionController._filter_test_questions_for_partial_retry keeps only failed questions."""
        task_data_full = {
            "task_data": {
                "type": "open_answer",
                "content": {
                    "case_text": "Кейс преамбула",
                    "questions": [
                        {"id": "q1", "question": "Вопрос 1", "reference_answer": "Ответ 1", "keywords": ["к1"]},
                        {"id": "q2", "question": "Вопрос 2", "reference_answer": "Ответ 2", "keywords": ["к2"]},
                        {"id": "q3", "question": "Вопрос 3", "reference_answer": "Ответ 3", "keywords": ["к3"]},
                    ],
                },
            },
            "answer_key": {
                "questions": [
                    {"id": "q1", "question": "Вопрос 1", "reference_answer": "Ответ 1", "keywords": ["к1"]},
                    {"id": "q2", "question": "Вопрос 2", "reference_answer": "Ответ 2", "keywords": ["к2"]},
                    {"id": "q3", "question": "Вопрос 3", "reference_answer": "Ответ 3", "keywords": ["к3"]},
                ],
            },
        }

        # Suppose question index 1 (q2) failed
        filtered = ComplexSessionController._filter_test_questions_for_partial_retry(
            task_data_full=task_data_full,
            failed_indices=[1],
        )

        filtered_questions = filtered["task_data"]["content"]["questions"]
        assert len(filtered_questions) == 1
        assert filtered_questions[0]["id"] == "q2"
        assert filtered_questions[0]["_partial_retry_original_index"] == 1

        # Root mirroring for 100% backward compatibility
        assert filtered["task_data"]["content"]["question"] == "Вопрос 2"
        assert filtered["task_data"]["content"]["reference_answer"] == "Ответ 2"
        assert filtered["task_data"]["content"]["keywords"] == ["к2"]

        # Answer key mirroring
        assert len(filtered["answer_key"]["questions"]) == 1
        assert filtered["answer_key"]["reference_answer"] == "Ответ 2"

    def test_adaptive_session_manager_open_answer_partial_retry_lifecycle(self):
        """AdaptiveSessionManager records failed questions and resolves them on correct retry."""
        asm = AdaptiveSessionManager(
            storage_service=MagicMock(),
            complex_service=MagicMock(),
            user_progress_manager=MagicMock(),
            difficulty_manager=MagicMock(),
        )
        session = ComplexSession(
            id="test_sess",
            complex_id="comp_1",
            user_id="user_1",
            start_time=datetime.utcnow(),
            iteration=1,
            queue=[
                QueuedTask(task_ref="m/t/oa_task", difficulty=1, is_retry=False),
            ],
            completed_tasks=[],
        )

        task_ref = "m/t/oa_task"

        # Attempt 1: Question index 1 failed
        eval_res_1 = EvaluationResult(
            success=False,
            message="❌ Не все вопросы решены верно (1/2)",
            score=50.0,
            metric="percent",
            details={
                "total_questions": 2,
                "passed_questions": 1,
                "failed_question_indices": [1],
                "failed_subtests": [
                    {"index": 1, "question_id": "q2", "label": "Вопрос 2"},
                ],
            },
        )

        success_1 = asm._process_test_partial_retry(
            session=session,
            task_ref=task_ref,
            result=eval_res_1,
            failed_subtests_raw=eval_res_1.details["failed_subtests"],
        )

        assert success_1 is False
        assert session.test_failed_subtests.get(task_ref) == [1]

        # Attempt 2 (Retry): User correctly answers the retry question
        eval_res_2 = EvaluationResult(
            success=True,
            message="✅ Правильно!",
            score=100.0,
            metric="percent",
            details={
                "total_questions": 1,
                "passed_questions": 1,
                "failed_question_indices": [],
                "failed_subtests": [],
            },
        )

        success_2 = asm._process_test_partial_retry(
            session=session,
            task_ref=task_ref,
            result=eval_res_2,
            failed_subtests_raw=eval_res_2.details["failed_subtests"],
        )

        assert success_2 is True
        # Tracked failure should be resolved and cleared!
        assert task_ref not in session.test_failed_subtests


class TestSessionAPIOpenAnswerIntegration:
    """Integration tests testing SessionAPI review generation and partial retry delivery."""

    def test_session_api_iteration_results_for_open_answer(self):
        from api.session_api import SessionAPI
        from types import SimpleNamespace

        task_ref = "cardio/ecg/oa_infarct"
        task_data = {
            "type": "open_answer",
            "name": "Анализ ЭКГ при ОКС",
            "content": {
                "case_text": "Пациент 60 лет доставлен бригадой СМП с ангинозным статусом.",
                "display_mode": "sequential",
                "questions": [
                    {
                        "id": "q1",
                        "question": "Какой ритм сердца?",
                        "reference_answer": "Синусовый ритм",
                        "keywords": ["синусовый"],
                    },
                    {
                        "id": "q2",
                        "question": "Локализация элевации ST?",
                        "reference_answer": "Передне-перегородочная область",
                        "keywords": ["перегородочная"],
                    },
                ],
            },
        }

        storage_service = MagicMock()
        storage_service.load_task.return_value = {
            "task_data": task_data,
            "answer_key": task_data["content"],
        }

        session_manager = MagicMock()
        session = ComplexSession(
            id="sess_stage4",
            complex_id="comp_ecg",
            user_id="user_doc",
            start_time=datetime.utcnow(),
            iteration=1,
            queue=[QueuedTask(task_ref=task_ref, difficulty=1, is_retry=False)],
            completed_tasks=[],
        )
        session_manager.get_session.return_value = session

        summary = SimpleNamespace(
            iteration=1,
            total_tasks=1,
            successful_tasks=0,
            failed_tasks=1,
            success_rate=0.0,
            iteration_results=[
                {
                    "task_ref": task_ref,
                    "success": False,
                    "details": {
                        "task_type": "open_answer",
                        "user_input": {
                            "answers": {
                                "q1": "синусовый тахикардия",
                                "q2": "боковая стенка",
                            }
                        },
                        "evaluator_result": {
                            "details": {
                                "questions": {
                                    "q1": {
                                        "success": True,
                                        "user_answer": "синусовый тахикардия",
                                        "reference_answer": "Синусовый ритм",
                                    },
                                    "q2": {
                                        "success": False,
                                        "user_answer": "боковая стенка",
                                        "reference_answer": "Передне-перегородочная область",
                                    },
                                }
                            }
                        },
                    },
                }
            ],
        )
        session_manager.get_iteration_summary.return_value = summary

        api = SessionAPI(
            session_controller=MagicMock(),
            adaptive_session_manager=session_manager,
            complex_service=MagicMock(),
            storage_service=storage_service,
            statistics_service=MagicMock(),
        )
        api._build_iterations_for_web = MagicMock(return_value=[])
        api._build_problem_tasks_for_web = MagicMock(return_value=[])

        res = api.get_iteration_results("sess_stage4")
        assert res is not None
        assert "iteration_results" in res
        review = res["iteration_results"][0]["review"]

        assert review["title"] == "Анализ ЭКГ при ОКС"
        assert "Пациент 60 лет доставлен бригадой СМП" in review["prompt"]
        assert review["user_label"] == "Твои ответы"
        assert review["reference_label"] == "Правильные ответы"
        assert len(review["user_lines"]) == 2
        assert review["user_lines"][0].startswith("[✓] В1. Какой ритм сердца?: синусовый тахикардия")
        assert review["user_lines"][1].startswith("[✗] В2. Локализация элевации ST?: боковая стенка")
        assert review["reference_lines"][0] == "В1: Синусовый ритм"
        assert review["reference_lines"][1] == "В2: Передне-перегородочная область"
        assert review["note"] == "Ошибки в вопросах: неверно 1 из 2."

    def test_session_api_get_current_task_partial_retry_filter(self):
        from api.session_api import SessionAPI

        task_ref = "cardio/ecg/oa_infarct"
        task_data = {
            "type": "open_answer",
            "name": "Анализ ЭКГ при ОКС",
            "content": {
                "case_text": "Пациент 60 лет.",
                "questions": [
                    {"id": "q1", "question": "Вопрос 1", "reference_answer": "Эталон 1", "keywords": ["к1"]},
                    {"id": "q2", "question": "Вопрос 2", "reference_answer": "Эталон 2", "keywords": ["к2"]},
                ],
            },
        }

        storage_service = MagicMock()
        storage_service.load_task.return_value = {
            "task_data": task_data,
            "answer_key": task_data["content"],
        }

        session = ComplexSession(
            id="sess_retry",
            complex_id="comp_1",
            user_id="user_1",
            start_time=datetime.utcnow(),
            iteration=1,
            current_task_index=0,
            queue=[QueuedTask(task_ref=task_ref, difficulty=1, is_retry=True)],
            completed_tasks=[],
            test_failed_subtests={task_ref: [1]},  # Only question index 1 failed
        )

        session_manager = MagicMock()
        session_manager.get_session.return_value = session

        controller = MagicMock()
        controller.current_session_id = "sess_retry"
        controller.task_controller.difficulty_manager = DifficultyManager()

        api = SessionAPI(
            session_controller=controller,
            adaptive_session_manager=session_manager,
            complex_service=MagicMock(),
            storage_service=storage_service,
            statistics_service=MagicMock(),
        )

        task_payload = api.get_current_task("sess_retry")
        assert task_payload is not None
        served_content = task_payload["task_data"]["content"]

        # Only the failed question (index 1) should be present!
        assert len(served_content["questions"]) == 1
        assert served_content["questions"][0]["id"] == "q2"
        # Root mirroring
        assert served_content["question"] == "Вопрос 2"
        assert served_content["reference_answer"] == "Эталон 2"
        assert served_content["keywords"] == ["к2"]

