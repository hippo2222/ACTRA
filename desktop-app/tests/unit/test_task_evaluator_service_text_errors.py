import pytest

from services.task_evaluator_service import TaskEvaluatorService


def _make_task_data(required_correct=1):
    return {
        "content": {
            "mode": "text_errors",
            "subtype": "error_detection",
            "required_correct": required_correct,
        },
        "subtype": "error_detection",
    }


def test_text_errors_selected_indices_success():
    evaluator = TaskEvaluatorService()
    user_input = {"mode": "text_errors", "selected_indices": [3], "total_errors": 1}
    res = evaluator.evaluate_task(
        task_type="click",
        user_input=user_input,
        answer_key={},
        task_data=_make_task_data(required_correct=1),
    )
    assert res.success is True
    assert res.score == 100.0
    assert res.details.get("selected_count") == 1


def test_text_errors_selected_indices_insufficient():
    evaluator = TaskEvaluatorService()
    user_input = {"mode": "text_errors", "selected_indices": [1], "total_errors": 1}
    res = evaluator.evaluate_task(
        task_type="click",
        user_input=user_input,
        answer_key={},
        task_data=_make_task_data(required_correct=2),
    )
    assert res.success is False
    assert res.score == 0.0
    assert res.details.get("required") == 2


def test_text_errors_selected_indices_validate_against_error_spans():
    evaluator = TaskEvaluatorService()
    task_data = {
        "content": {
            "mode": "text_errors",
            "subtype": "error_detection",
            "text": "alpha beta gamma",
            "required_correct": 1,
            "error_spans": [{"start": 6, "end": 10, "is_correct": False}],
        },
        "subtype": "error_detection",
    }
    user_input = {"mode": "text_errors", "selected_indices": [0], "total_errors": 1}
    res = evaluator.evaluate_task(
        task_type="click",
        user_input=user_input,
        answer_key={},
        task_data=task_data,
    )
    assert res.success is False
    assert res.details.get("selected_count") == 0
    assert res.details.get("rejected_indices") == [0]


def test_text_errors_require_all_errors_overrides_required_correct():
    evaluator = TaskEvaluatorService()
    task_data = {
        "content": {
            "mode": "text_errors",
            "subtype": "error_detection",
            "text": "alpha beta gamma",
            "required_correct": 1,
            "require_all_errors": True,
            "error_spans": [
                {"start": 6, "end": 10, "is_correct": False},   # beta (index 1)
                {"start": 11, "end": 16, "is_correct": False},  # gamma (index 2)
            ],
        },
        "subtype": "error_detection",
    }
    user_input = {"mode": "text_errors", "selected_indices": [1], "total_errors": 2}
    res = evaluator.evaluate_task(
        task_type="click",
        user_input=user_input,
        answer_key={},
        task_data=task_data,
    )
    assert res.success is False
    assert res.details.get("required") == 2
    assert res.details.get("selected_count") == 1
