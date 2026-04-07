from pathlib import Path

from task_system.core.loaders.task_loader import TaskLoader


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"


def test_task_loader_accepts_text_errors_click_without_image():
    loader = TaskLoader(DATA_DIR, strict_mode=True)
    task_path = DATA_DIR / "modules" / "test_tsentr_teorii" / "topics" / "test_tema_bez_teorii" / "tasks" / "task_5ab28efd" / "task.json"

    loaded = loader.load_task(task_path)

    assert loaded["task_data"]["type"] == "click"
    assert loaded["task_data"]["subtype"] == "error_detection"
    assert loaded["task_data"]["content"]["mode"] == "text_errors"
    assert loaded["task_data"]["content"]["require_all_errors"] is True


def test_task_loader_accepts_text_choice_click_without_image():
    loader = TaskLoader(DATA_DIR, strict_mode=True)
    task_path = DATA_DIR / "modules" / "test_tsentr_teorii" / "topics" / "test_tema_bez_teorii" / "tasks" / "task_c0df4e66" / "task.json"

    loaded = loader.load_task(task_path)

    assert loaded["task_data"]["type"] == "click"
    assert loaded["task_data"]["subtype"] == "error_detection"
    assert loaded["task_data"]["content"]["mode"] == "text_choice"
    assert len(loaded["task_data"]["content"]["options"]) == 2
    assert loaded["task_data"]["content"]["choice_prompt"] == "Выберите правильный вариант текста"
