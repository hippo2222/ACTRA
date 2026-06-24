import json
from pathlib import Path

from task_system.core.loaders.task_loader import TaskLoader


def test_task_loader_accepts_text_errors_click_without_image(tmp_path):
    task_dir = tmp_path / "task_5ab28efd"
    task_dir.mkdir(parents=True, exist_ok=True)
    task_path = task_dir / "task.json"

    task_data = {
        "id": "task_5ab28efd",
        "type": "click",
        "subtype": "error_detection",
        "meta": {
            "id": "task_5ab28efd",
            "module": "test_tsentr_teorii",
            "topic": "test_tema_bez_teorii",
            "name": "Test Error Task",
            "author": "",
            "content_scope": "shared_local",
            "created": "2026-05-28T00:00:00Z",
            "modified": "2026-05-28T00:00:00Z"
        },
        "content": {
            "mode": "text_errors",
            "prompt": "Identify errors in the text",
            "text": "This is a test text.",
            "error_spans": [
                {
                    "start": 0,
                    "end": 4,
                    "label": "error",
                    "is_correct": False
                }
            ],
            "require_all_errors": True
        },
        "settings": {
            "difficulty": 1
        }
    }

    task_path.write_text(json.dumps(task_data), encoding="utf-8")

    loader = TaskLoader(tmp_path, strict_mode=True)
    loaded = loader.load_task(task_path)

    assert loaded["task_data"]["type"] == "click"
    assert loaded["task_data"]["subtype"] == "error_detection"
    assert loaded["task_data"]["content"]["mode"] == "text_errors"
    assert loaded["task_data"]["content"]["require_all_errors"] is True


def test_task_loader_accepts_text_choice_click_without_image(tmp_path):
    task_dir = tmp_path / "task_c0df4e66"
    task_dir.mkdir(parents=True, exist_ok=True)
    task_path = task_dir / "task.json"

    task_data = {
        "id": "task_c0df4e66",
        "type": "click",
        "subtype": "error_detection",
        "meta": {
            "id": "task_c0df4e66",
            "module": "test_tsentr_teorii",
            "topic": "test_tema_bez_teorii",
            "name": "Test Text Choice Task",
            "author": "",
            "content_scope": "shared_local",
            "created": "2026-05-28T00:00:00Z",
            "modified": "2026-05-28T00:00:00Z"
        },
        "content": {
            "mode": "text_choice",
            "prompt": "Choose the correct text option",
            "choice_prompt": "Выберите правильный вариант текста",
            "options": [
                {
                    "id": "opt1",
                    "text": "Correct version of text",
                    "is_correct": True
                },
                {
                    "id": "opt2",
                    "text": "Incorrect version of text",
                    "is_correct": False
                }
            ]
        },
        "settings": {
            "difficulty": 1
        }
    }

    task_path.write_text(json.dumps(task_data), encoding="utf-8")

    loader = TaskLoader(tmp_path, strict_mode=True)
    loaded = loader.load_task(task_path)

    assert loaded["task_data"]["type"] == "click"
    assert loaded["task_data"]["subtype"] == "error_detection"
    assert loaded["task_data"]["content"]["mode"] == "text_choice"
    assert len(loaded["task_data"]["content"]["options"]) == 2
    assert loaded["task_data"]["content"]["choice_prompt"] == "Выберите правильный вариант текста"

