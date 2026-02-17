import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from services.task_evaluator_service import TaskEvaluatorService


def test_text_errors_span_hits_success():
    evaluator = TaskEvaluatorService()
    task_data = {
        "type": "click",
        "content": {
            "mode": "text_errors",
            "subtype": "error_detection",
        },
    }
    answer_key = {
        "reference_spans": [
            {"start": 0, "end": 5},
            {"start": 10, "end": 15},
        ],
        "targets": [
            {"shape": "span", "start": 0, "end": 5},
            {"shape": "span", "start": 10, "end": 15},
        ],
        "required_correct": 1,
    }
    user_input = {
        "spans": [
            {"start": 11, "end": 14},  # intersects second target
        ]
    }

    result = evaluator.evaluate_click_task(user_input, answer_key, task_data)

    assert result.success is True
    assert result.details["mode"] == "text_errors"
    assert result.details["spans_correct"] == 1
    assert result.details["required"] == 1


def test_text_errors_span_miss_fail():
    evaluator = TaskEvaluatorService()
    task_data = {
        "type": "click",
        "content": {
            "mode": "text_errors",
            "subtype": "error_detection",
        },
    }
    answer_key = {
        "reference_spans": [
            {"start": 0, "end": 5},
        ],
        "targets": [
            {"shape": "span", "start": 0, "end": 5},
        ],
        "required_correct": 1,
    }
    user_input = {
        "spans": [
            {"start": 6, "end": 7},  # no intersection
        ]
    }

    result = evaluator.evaluate_click_task(user_input, answer_key, task_data)

    assert result.success is False
    assert result.details["spans_correct"] == 0
    assert result.details["required"] == 1
