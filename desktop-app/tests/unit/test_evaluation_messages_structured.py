import pytest
from services.evaluation_messages import get_message, get_message_payload
from services.task_evaluator_service import EvaluationResult, TaskEvaluatorService


def test_get_message_payload_returns_triplet():
    formatted, key, params = get_message_payload(
        "click_combined_success_threshold",
        found_count=5,
        required_correct=5,
        total_count=18,
        labels_message="All correct",
    )
    assert key == "click_combined_success_threshold"
    assert params["found_count"] == 5
    assert params["required_correct"] == 5
    assert params["total_count"] == 18
    assert "5/5" in formatted


def test_evaluation_result_mirrors_message_key_and_params_to_details():
    res = EvaluationResult(
        success=True,
        message="✅ Правильно!",
        message_key="click_success_all",
        message_params={"found_count": 3},
        details={"extra": "value"},
    )
    assert res.message_key == "click_success_all"
    assert res.message_params == {"found_count": 3}
    assert res.details["message_key"] == "click_success_all"
    assert res.details["message_params"] == {"found_count": 3}
    assert res.details["extra"] == "value"


def test_click_task_evaluation_returns_structured_i18n_contract():
    evaluator = TaskEvaluatorService()
    answer_key = {
        "targets": [
            {
                "label": "Brain",
                "shape": "polygon",
                "points": [[10, 10], [50, 10], [50, 50], [10, 50]],
            }
        ]
    }
    user_input = {
        "clicks": [{"x": 20, "y": 20}],
    }
    res = evaluator.evaluate_task(
        task_type="click",
        user_input=user_input,
        answer_key=answer_key,
    )
    assert res.message_key == "click_success_all"
    assert res.message_params == {"found_count": 1}
    assert res.details.get("message_key") == "click_success_all"
    assert res.details.get("message_params") == {"found_count": 1}
