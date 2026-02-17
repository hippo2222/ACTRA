from .helpers import load_task_evaluator_service


TaskEvaluatorService = load_task_evaluator_service()


def build_task_dto():
    return {
        "task_data": {
            "content": {
                "prompt": "Base prompt",
                "additionalInfo": {"type": "text", "text": "Legacy hint"},
            },
        },
        "answer_key": {
            "targets": [
                {"shape": "polygon", "points": [[0, 0], [10, 0], [10, 10]]}
            ],
        },
    }


def test_draw_metadata_roundtrip():
    task = build_task_dto()
    metadata_snapshot = {
        "prompt": "Updated prompt",
        "successThreshold": 2,
        "additionalInfo": {
            "type": "combined",
            "text": "Новая подсказка",
            "images": ["a.png", "b.png"],
        },
    }

    content = task["task_data"]["content"]
    content["prompt"] = metadata_snapshot["prompt"]
    content.setdefault("settings", {})["success_threshold"] = metadata_snapshot[
        "successThreshold"
    ]
    content["additionalInfo"] = metadata_snapshot["additionalInfo"]

    service = TaskEvaluatorService()
    user_input = {
        "polygons": [{"points": [[0, 0], [10, 0], [10, 10]]}],
    }
    result = service.evaluate_draw_task(
        user_input, task["answer_key"], task["task_data"]
    )

    assert task["task_data"]["content"]["prompt"] == "Updated prompt"
    assert task["task_data"]["content"]["additionalInfo"]["text"] == "Новая подсказка"
