"""
Backward-compatibility tests for task migration/loading.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from task_system.core.io.task_io import TaskIO
from task_system.migrations.schema import CURRENT_SCHEMA_VERSION, detect_schema_version

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = REPO_ROOT / "data"


def _task_path(*parts: str) -> Path:
    return DATA_ROOT.joinpath(*parts)


def test_load_old_format_task() -> None:
    """Load a v1.0-style task and verify migration output shape."""
    task_path = _task_path("modules", "module_01", "topics", "topic_01", "tasks", "task_003", "task.json")
    if not task_path.exists():
        pytest.skip(f"Old-format task fixture is missing: {task_path}")

    task = TaskIO.load(str(task_path))
    assert task is not None
    assert "meta" in task.data
    assert "content" in task.data

    content = task.data["content"]
    assert "prompt" in content or "question" in content
    if content.get("image"):
        assert isinstance(content["image"], str)

    prompt = content.get("prompt") or content.get("question", "")
    assert prompt is not None

    version = detect_schema_version(task.data)
    assert version == CURRENT_SCHEMA_VERSION


def test_load_v1_1_format_task() -> None:
    """Load a v1.1/v1.2 task and verify current-schema result."""
    task_path = _task_path("modules", "module_01", "topics", "topic_01", "tasks", "task_002", "task.json")
    if not task_path.exists():
        pytest.skip(f"v1.1-format task fixture is missing: {task_path}")

    with task_path.open("r", encoding="utf-8") as fh:
        original_data = json.load(fh)

    original_version = detect_schema_version(original_data)
    assert original_version in {"1.1", "1.2"}

    task = TaskIO.load(str(task_path))
    assert task is not None

    version = detect_schema_version(task.data)
    assert version == CURRENT_SCHEMA_VERSION
    assert task.data["type"] == original_data["type"]
    assert task.data["id"] == original_data["id"]


def test_image_paths_resolution() -> None:
    """Load task with image references and verify fields are preserved."""
    task_path = _task_path("modules", "module_01", "topics", "topic_01", "tasks", "task_005", "task.json")
    if not task_path.exists():
        pytest.skip(f"Image-path task fixture is missing: {task_path}")

    task = TaskIO.load(str(task_path))
    assert task is not None
    assert "image" in task.data["content"]

    additional_info = task.data["content"].get("additionalInfo")
    if isinstance(additional_info, dict) and "image" in additional_info:
        assert additional_info["image"]


def test_missing_images_handling() -> None:
    """Missing image files should not break loading/migration."""
    old_task_data = {
        "id": "test_missing",
        "type": "click",
        "name": "Missing image fixture",
        "image": "nonexistent_image.png",
        "prompt": "Test task",
    }

    import tempfile

    with tempfile.TemporaryDirectory() as temp_dir:
        task_path = Path(temp_dir) / "task.json"
        with task_path.open("w", encoding="utf-8") as fh:
            json.dump(old_task_data, fh, ensure_ascii=False, indent=2)

        task = TaskIO.load(str(task_path))
        assert task is not None
        image_field = task.data["content"].get("image")
        assert image_field in {None, "nonexistent_image.png"}
