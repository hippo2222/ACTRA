import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.task_evaluator_service import TaskEvaluatorService


def test_evaluate_test_task_level2_includes_reference_answer_in_per_question() -> None:
    service = TaskEvaluatorService()
    user_input = {
        "text_answers": {
            "q1": "печень выполняет детоксикацию",
        }
    }
    answer_key = {
        "questions": [
            {
                "id": "q1",
                "keywords": ["печень", "детоксикацию", "метаболизм"],
                "reference_answer": "печень выполняет детоксикацию и метаболизм",
            }
        ]
    }
    task_data = {
        "content": {
            "show_options": False,
            "requires_text_input": True,
        }
    }

    result = service.evaluate_test_task(user_input, answer_key, task_data)

    assert result.success is False
    assert result.details["level"] == 2
    assert result.details["per_question"]["q1"]["status"] == "incorrect"
    assert (
        result.details["per_question"]["q1"]["details"]["reference_answer"]
        == "печень выполняет детоксикацию и метаболизм"
    )
    assert "метаболизм" in result.details["per_question"]["q1"]["details"]["missing_keywords"]


def test_evaluate_test_task_level2_marks_unanswered_with_reference_answer() -> None:
    service = TaskEvaluatorService()
    user_input = {
        "text_answers": {}
    }
    answer_key = {
        "questions": [
            {
                "id": "q1",
                "keywords": ["печень"],
                "reference_answer": "печень",
            }
        ]
    }
    task_data = {
        "content": {
            "show_options": False,
            "requires_text_input": True,
        }
    }

    result = service.evaluate_test_task(user_input, answer_key, task_data)

    assert result.success is False
    assert result.details["error"] == "no_text_answers"


def test_evaluate_test_task_level2_uses_nested_reference_answer_from_question_content() -> None:
    service = TaskEvaluatorService()
    user_input = {
        "text_answers": {
            "q1": "неверный ответ",
        }
    }
    answer_key = {
        "questions": [
            {
                "id": "q1",
                "keywords": ["печень"],
                "content": {
                    "reference_answer": "печень",
                },
            }
        ]
    }
    task_data = {
        "content": {
            "show_options": False,
            "requires_text_input": True,
        }
    }

    result = service.evaluate_test_task(user_input, answer_key, task_data)

    assert result.success is False
    assert result.details["per_question"]["q1"]["status"] == "incorrect"
    assert result.details["per_question"]["q1"]["details"]["reference_answer"] == "печень"


def test_evaluate_test_task_level2_accepts_nested_reference_answer_text() -> None:
    service = TaskEvaluatorService()
    user_input = {
        "text_answers": {
            "q1": "same as on the right",
        }
    }
    answer_key = {
        "questions": [
            {
                "id": "q1",
                "content": {
                    "reference_answer": "same as on the right",
                },
            }
        ]
    }
    task_data = {
        "content": {
            "show_options": False,
            "requires_text_input": True,
        }
    }

    result = service.evaluate_test_task(user_input, answer_key, task_data)

    assert result.success is True
    assert result.details["per_question"]["q1"]["status"] == "correct"


def test_evaluate_test_task_level2_accepts_nested_multiple_correct_answers_with_punctuation() -> None:
    service = TaskEvaluatorService()
    user_input = {
        "text_answers": {
            "q1": "red, green",
        }
    }
    answer_key = {
        "questions": [
            {
                "id": "q1",
                "content": {
                    "answers": [
                        {"text": "Red", "correct": True},
                        {"text": "Green", "correct": True},
                    ],
                },
            }
        ]
    }
    task_data = {
        "content": {
            "show_options": False,
            "requires_text_input": True,
        }
    }

    result = service.evaluate_test_task(user_input, answer_key, task_data)

    assert result.success is True
    assert result.details["per_question"]["q1"]["status"] == "correct"


def test_evaluate_test_task_level2_accepts_nested_multiple_correct_answers_without_punctuation() -> None:
    service = TaskEvaluatorService()
    user_input = {
        "text_answers": {
            "q1": "red green",
        }
    }
    answer_key = {
        "questions": [
            {
                "id": "q1",
                "content": {
                    "answers": [
                        {"text": "Red", "correct": True},
                        {"text": "Green", "correct": True},
                    ],
                },
            }
        ]
    }
    task_data = {
        "content": {
            "show_options": False,
            "requires_text_input": True,
        }
    }

    result = service.evaluate_test_task(user_input, answer_key, task_data)

    assert result.success is True
    assert result.details["per_question"]["q1"]["status"] == "correct"


def test_evaluate_test_task_level2_hides_typo_feedback_for_case_only_difference() -> None:
    service = TaskEvaluatorService()
    user_input = {
        "text_answers": {
            "q1": "heart",
        }
    }
    answer_key = {
        "questions": [
            {
                "id": "q1",
                "content": {
                    "reference_answer": "Heart",
                },
            }
        ]
    }
    task_data = {
        "content": {
            "show_options": False,
            "requires_text_input": True,
        }
    }

    result = service.evaluate_test_task(user_input, answer_key, task_data)

    assert result.success is True
    assert result.details["per_question"]["q1"]["status"] == "correct"
    assert "tolerance_type" not in result.details["per_question"]["q1"]
    assert "tolerance_explanation" not in result.details["per_question"]["q1"]


def test_evaluate_test_task_level2_hides_typo_feedback_for_punctuation_only_difference() -> None:
    service = TaskEvaluatorService()
    user_input = {
        "text_answers": {
            "q1": "red green",
        }
    }
    answer_key = {
        "questions": [
            {
                "id": "q1",
                "content": {
                    "answers": [
                        {"text": "Red", "correct": True},
                        {"text": "Green", "correct": True},
                    ],
                },
            }
        ]
    }
    task_data = {
        "content": {
            "show_options": False,
            "requires_text_input": True,
        }
    }

    result = service.evaluate_test_task(user_input, answer_key, task_data)

    assert result.success is True
    assert result.details["per_question"]["q1"]["status"] == "correct"
    assert "tolerance_type" not in result.details["per_question"]["q1"]
    assert "tolerance_explanation" not in result.details["per_question"]["q1"]
