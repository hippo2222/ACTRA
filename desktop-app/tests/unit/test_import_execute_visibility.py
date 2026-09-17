import sys
from pathlib import Path
import pytest

DESKTOP_APP_DIR = Path(__file__).resolve().parent.parent.parent
PROJECT_ROOT = DESKTOP_APP_DIR.parent
for p in (str(DESKTOP_APP_DIR), str(PROJECT_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

from routes import import_routes
from routes._helpers import _serialize_workspace_graph_entry, _serialize_workspace_catalog_modules
from routes.editor_routes import (
    _is_imported_workspace_graph_payload,
    _is_visible_workspace_graph_payload_for_current_user,
    _filter_hosted_workspace_catalog_modules,
)


def test_build_imported_task_payload_attaches_user_ownership(monkeypatch):
    monkeypatch.setattr(import_routes, "_ih", lambda: {"CURRENT_SCHEMA_VERSION": "1.2"})

    task = {
        "type": "open_answer",
        "name": "OA-1",
        "prompt": "What is Python?",
        "data": {
            "question": "What is Python?",
            "reference_answer": "A programming language",
        },
    }

    payload = import_routes._build_imported_task_payload(
        task,
        "mod-1",
        "top-1",
        "task-1",
        import_context={"source": "studio"},
        user_id="user_test_42",
    )

    assert payload["id"] == "task-1"
    assert payload["type"] == "open_answer"
    assert payload["created_by_user_id"] == "user_test_42"
    assert payload["updated_by_user_id"] == "user_test_42"
    assert payload["meta"]["created_by_user_id"] == "user_test_42"
    assert payload["meta"]["updated_by_user_id"] == "user_test_42"
    assert payload["meta"]["created_via"] == "studio_import"
    assert payload["meta"]["imported"] is True
    assert payload["content"]["reference_answer"] == "A programming language"


def test_build_imported_task_payload_normalizes_aliases(monkeypatch):
    monkeypatch.setattr(import_routes, "_ih", lambda: {"CURRENT_SCHEMA_VERSION": "1.2"})

    # Test "sequence" alias maps to "sequence_assembly"
    seq_task = {
        "type": "sequence",
        "name": "Seq-1",
        "prompt": "Arrange steps",
        "data": {
            "elements": {"1": "Step 1", "2": "Step 2"},
            "levels": {1: ["1", "2"]},
        },
    }
    payload_seq = import_routes._build_imported_task_payload(
        seq_task, "m", "t", "t-seq", user_id="user_1"
    )
    assert payload_seq["type"] == "sequence_assembly"
    assert "levels" in payload_seq["content"]

    # Test "click_words" alias maps to "click"
    click_task = {
        "type": "click_words",
        "name": "CW-1",
        "prompt": "Find error",
        "data": {
            "mode": "text_errors",
            "text": "Hello wrld",
            "error_spans": [{"start": 6, "end": 10, "is_correct": False}],
        },
    }
    payload_click = import_routes._build_imported_task_payload(
        click_task, "m", "t", "t-click", user_id="user_1"
    )
    assert payload_click["type"] == "click"
    assert payload_click["content"]["mode"] == "text_errors"


def test_is_imported_workspace_graph_payload_detection():
    # Suffix _import
    assert _is_imported_workspace_graph_payload({"created_via": "studio_import"}) is True
    assert _is_imported_workspace_graph_payload({"created_via": "text_import"}) is True
    assert _is_imported_workspace_graph_payload({"created_via": "ai_import"}) is True
    assert _is_imported_workspace_graph_payload({"created_via": "workspace_import"}) is True
    assert _is_imported_workspace_graph_payload({"created_via": "archive_import"}) is True

    # imported: True flag
    assert _is_imported_workspace_graph_payload({"imported": True}) is True
    assert _is_imported_workspace_graph_payload({"meta": {"imported": True}}) is True

    # Not imported
    assert _is_imported_workspace_graph_payload({"created_via": "manual_editor"}) is False
    assert _is_imported_workspace_graph_payload({}) is False


def test_hosted_catalog_filtering_preserves_imported_tasks(monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    user_id = "user_author_123"

    # Module with 14 imported tasks
    raw_tasks = [
        {
            "id": f"task_{i}",
            "name": f"Task #{i}",
            "type": "test",
            "created_by_user_id": user_id,
            "updated_by_user_id": user_id,
            "created_via": "studio_import",
            "imported": True,
            "content_scope": "shared_local",
        }
        for i in range(1, 15)
    ]

    modules = [
        {
            "id": "mod_1",
            "name": "Physics",
            "created_by_user_id": user_id,
            "topics": [
                {
                    "id": "topic_1",
                    "name": "Mechanics",
                    "created_by_user_id": user_id,
                    "tasks": raw_tasks,
                }
            ],
        }
    ]

    serialized = _serialize_workspace_catalog_modules(modules, current_user_id=user_id)
    filtered = _filter_hosted_workspace_catalog_modules(serialized, current_user_id=user_id)

    assert len(filtered) == 1
    assert len(filtered[0]["topics"]) == 1
    topic = filtered[0]["topics"][0]
    # ALL 14 tasks MUST be visible to the author!
    assert len(topic["tasks"]) == 14
    for t in topic["tasks"]:
        assert t["id"].startswith("task_")


def test_hosted_catalog_filtering_preserves_legacy_imported_tasks_without_owner(monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    user_id = "user_author_123"

    # Tasks imported before ownership was tracked (created_by_user_id is None)
    raw_tasks = [
        {
            "id": f"legacy_task_{i}",
            "name": f"Legacy Task #{i}",
            "type": "test",
            "created_by_user_id": None,
            "created_via": "ai_import",
            "imported": True,
            "content_scope": "shared_local",
        }
        for i in range(1, 15)
    ]

    modules = [
        {
            "id": "mod_1",
            "name": "Physics",
            "created_by_user_id": user_id,
            "topics": [
                {
                    "id": "topic_1",
                    "name": "Mechanics",
                    "created_by_user_id": user_id,
                    "tasks": raw_tasks,
                }
            ],
        }
    ]

    serialized = _serialize_workspace_catalog_modules(modules, current_user_id=user_id)
    filtered = _filter_hosted_workspace_catalog_modules(serialized, current_user_id=user_id)

    assert len(filtered) == 1
    topic = filtered[0]["topics"][0]
    # Legacy imported tasks without owner MUST NOT vanish!
    assert len(topic["tasks"]) == 14
