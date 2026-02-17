from .helpers import load_task_evaluator_service


TaskEvaluatorService = load_task_evaluator_service()


def test_requires_drawing_triggers_level3_flow():
    service = TaskEvaluatorService()
    task_data = {
        "content": {
            "requires_drawing": True,
            "requires_labels": True,
            "mode": "draw_and_label",
        }
    }
    answer_key = {
        "targets": [
            {"shape": "polygon", "points": [[0, 0], [10, 0], [10, 10]]},
        ]
    }
    user_input = {
        "drawing": [],
        "labels": ["Org"],
    }

    result = service.evaluate_click_task(user_input, answer_key, task_data)
    assert result.details.get("level") == 3
    assert result.details.get("stage") == "drawing"
    assert result.details.get("error") == "no_drawing"
