import sys
from pathlib import Path


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from services.task_evaluator_service import TaskEvaluatorService


def test_labels_return_tolerance_feedback_for_typo_match() -> None:
    service = TaskEvaluatorService()

    result = service._evaluate_labels(["Hearrt"], ["Heart"])

    assert result["success"] is True
    assert result["tolerance_type"] == "typo"
    assert result["tolerance_matches"][0]["user_answer"] == "Hearrt"
    assert "опечат" in result["tolerance_explanation"].lower()


def test_open_answer_includes_tolerance_feedback_in_details() -> None:
    service = TaskEvaluatorService()

    result = service.evaluate_open_answer_task(
        {"answer": "The hearrt pumps blood"},
        {"keywords": ["heart", "blood"]},
    )

    assert result.success is True
    assert result.details["tolerance_type"] == "typo"
    assert "опечат" in result.details["tolerance_explanation"].lower()
    assert any(match["correct_word"] == "heart" for match in result.details["tolerance_matches"])


def test_sequence_names_include_tolerance_feedback_for_level_and_block_names() -> None:
    service = TaskEvaluatorService()

    user_input = {
        "levels": [
            {
                "level_id": "user_level_1",
                "level_name": "Preparatoin",
                "blocks": ["elem_1"],
                "block_names": {"elem_1": "Hearrt"},
            }
        ]
    }
    answer_key = {
        "levels": [
            {
                "level_id": "level_1",
                "level_name": "Preparation",
                "blocks": ["elem_1"],
            }
        ],
        "elements": [
            {"id": "elem_1", "text": "Heart"},
        ],
        "sequence_within_level_matters": True,
        "level_order_matters": True,
    }
    task_data = {
        "content": {
            "requires_level_names": True,
            "requires_block_names": True,
            "elements": answer_key["elements"],
        }
    }

    result = service.evaluate_sequence_task(user_input, answer_key, task_data)

    assert result.success is True
    assert result.details["level_names"]["tolerance_type"] == "typo"
    assert result.details["block_names"]["tolerance_type"] == "typo"
    assert "опечат" in result.details["level_names"]["tolerance_explanation"].lower()
    assert "опечат" in result.details["block_names"]["tolerance_explanation"].lower()
