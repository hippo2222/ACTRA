import json
import uuid
from pathlib import Path
import pytest

from server import app, _headless_app_ctx  # type: ignore
from task_system.core.io.task_io import TaskIO


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


@pytest.fixture
def temp_test_task():
    """Создает временный модуль/тему/задание в файловой структуре редактора."""
    modules_dir = Path(_headless_app_ctx.storage_service.modules_dir)
    module_id = f"mod_prev_{uuid.uuid4().hex[:8]}"
    topic_id = f"top_prev_{uuid.uuid4().hex[:8]}"
    task_id = f"task_{uuid.uuid4().hex[:6]}"

    module_dir = modules_dir / module_id
    topic_dir = module_dir / "topics" / topic_id
    task_dir = topic_dir / "tasks" / task_id

    try:
        (module_dir / "topics").mkdir(parents=True, exist_ok=True)
        (topic_dir / "tasks").mkdir(parents=True, exist_ok=True)

        (module_dir / "module.json").write_text(
            json.dumps({"id": module_id, "name": module_id, "topics": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (topic_dir / "topic.json").write_text(
            json.dumps({"id": topic_id, "name": topic_id, "tasks": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        task_data = TaskIO.new_task("test", name="Preview API Test", module=module_id, topic=topic_id)
        task_data.content["questions"] = [
            {
                "id": "q1",
                "question": "Sample Question",
                "type": "single_choice",
                "answers": [
                    {"id": "a1", "text": "Answer 1", "is_correct": True},
                    {"id": "a2", "text": "Answer 2", "is_correct": False},
                ],
            }
        ]
        TaskIO.save(task_data, str(task_dir / "task.json"), validate=True)

        _headless_app_ctx.storage_service.reload_modules()
        yield module_id, topic_id, task_id, task_dir

    finally:
        import shutil
        if module_dir.exists():
            shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()


@pytest.fixture
def temp_click_task_level3():
    """Создает тестовое задание типа Click только с 3-м уровнем сложности."""
    modules_dir = Path(_headless_app_ctx.storage_service.modules_dir)
    module_id = f"mod_prev_{uuid.uuid4().hex[:8]}"
    topic_id = f"top_prev_{uuid.uuid4().hex[:8]}"
    task_id = f"task_{uuid.uuid4().hex[:6]}"

    module_dir = modules_dir / module_id
    topic_dir = module_dir / "topics" / topic_id
    task_dir = topic_dir / "tasks" / task_id

    try:
        (module_dir / "topics").mkdir(parents=True, exist_ok=True)
        (topic_dir / "tasks").mkdir(parents=True, exist_ok=True)
        task_dir.mkdir(parents=True, exist_ok=True)

        (module_dir / "module.json").write_text(
            json.dumps({"id": module_id, "name": module_id, "topics": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (topic_dir / "topic.json").write_text(
            json.dumps({"id": topic_id, "name": topic_id, "tasks": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        task_payload = {
            "version": "1.0",
            "type": "click",
            "meta": {"name": "Click Task Level 3"},
            "settings": {"allowed_difficulties": [3]},
            "content": {
                "type": "click",
                "image": "test.png",
                "mode": "draw_and_label",
                "regions": [],
            },
        }
        (task_dir / "task.json").write_text(
            json.dumps(task_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        _headless_app_ctx.storage_service.reload_modules()
        yield module_id, topic_id, task_id, task_dir

    finally:
        import shutil
        if module_dir.exists():
            shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()


def test_preview_session_http_endpoints(client, temp_test_task):
    module_id, topic_id, task_id, _ = temp_test_task
    task_ref = f"{module_id}/{topic_id}/{task_id}"

    # 0. Clean any leftover preview session
    client.post("/api/editor/preview-session/cancel")

    # 1. Start preview session
    resp = client.post(
        "/api/editor/preview-session/start",
        json={"task_refs": [task_ref], "source_context": {"module_id": module_id, "topic_id": topic_id}},
    )
    assert resp.status_code == 200, resp.data
    data = resp.get_json()
    assert data["ok"] is True
    session_id = data["session_id"]
    assert data["complex_id"] == "task_preview"

    # 2. Check active preview endpoint
    active_resp = client.get("/api/editor/preview-session/active")
    assert active_resp.status_code == 200
    active_data = active_resp.get_json()
    assert active_data["ok"] is True
    assert active_data["active"] is True
    assert active_data["session_id"] == session_id
    assert active_data["current_task_ref"] == task_ref
    assert active_data["total_tasks"] == 1
    assert "active_session" in active_data
    assert active_data["active_session"]["display_index"] == 1
    assert active_data["active_session"]["current_task"]["name"] == "Preview API Test"

    # 2b. Check synthetic complex GET endpoint
    complex_resp = client.get("/api/complexes/task_preview")
    assert complex_resp.status_code == 200
    complex_data = complex_resp.get_json()
    assert complex_data["ok"] is True
    assert complex_data["item"]["id"] == "task_preview"
    assert complex_data["item"]["is_preview"] is True

    # 2c. Check /api/sessions/active endpoint
    sessions_resp = client.get("/api/sessions/active")
    assert sessions_resp.status_code == 200
    sessions_data = sessions_resp.get_json()
    items = sessions_data.get("items", []) if isinstance(sessions_data, dict) else sessions_data
    preview_items = [s for s in items if s.get("complex_id") == "task_preview" or s.get("is_preview")]
    assert len(preview_items) >= 1
    assert preview_items[0]["display_index"] == 1
    assert preview_items[0]["current_task"]["name"] == "Preview API Test"

    # 3. Starting without force while session is active returns 409
    conflict_resp = client.post(
        "/api/editor/preview-session/start",
        json={"task_refs": [task_ref], "force": False},
    )
    assert conflict_resp.status_code == 409
    conflict_data = conflict_resp.get_json()
    assert conflict_data["error"] == "paused_preview_exists"
    assert conflict_data["session_id"] == session_id
    assert "active_session" in conflict_data
    assert conflict_data["active_session"]["display_index"] == 1
    assert conflict_data["active_session"]["current_task"]["name"] == "Preview API Test"


    # 4. Restart preview session
    restart_resp = client.post(
        "/api/editor/preview-session/restart",
        json={"session_id": session_id},
    )
    assert restart_resp.status_code == 200
    restart_data = restart_resp.get_json()
    assert restart_data["ok"] is True

    # 5. Starting with force: true succeeds
    force_resp = client.post(
        "/api/editor/preview-session/start",
        json={"task_refs": [task_ref], "force": True},
    )
    assert force_resp.status_code == 200
    new_data = force_resp.get_json()
    assert new_data["ok"] is True
    new_session_id = new_data["session_id"]
    assert new_session_id != session_id

    # 6. Cancel preview session
    cancel_resp = client.post(
        "/api/editor/preview-session/cancel",
        json={"session_id": new_session_id},
    )
    assert cancel_resp.status_code == 200

    # 7. Verify no active session remaining
    active_after = client.get("/api/editor/preview-session/active")
    assert active_after.status_code == 200
    assert active_after.get_json()["active"] is False


def test_preview_session_click_task_only_difficulty_3(client, temp_click_task_level3):
    module_id, topic_id, task_id, _ = temp_click_task_level3
    task_ref = f"{module_id}/{topic_id}/{task_id}"

    client.post("/api/editor/preview-session/cancel")

    # 1. Start preview without explicit difficulty -> starts at 3
    resp = client.post(
        "/api/editor/preview-session/start",
        json={"task_refs": [task_ref], "force": True},
    )
    assert resp.status_code == 200, resp.data
    data = resp.get_json()
    assert data["ok"] is True
    session_id = data["session_id"]

    task_resp = client.get(f"/api/session/{session_id}/task")
    assert task_resp.status_code == 200
    task_payload = task_resp.get_json()
    assert task_payload.get("ok") is True
    task_data = task_payload.get("task") or {}
    assert task_data.get("difficulty") == 3
    assert task_data.get("available_levels") == [3]
    assert task_data.get("task_data", {}).get("_difficulty_level") == 3
    assert task_data.get("task_data", {}).get("content", {}).get("mode") == "draw_and_label"

    client.post("/api/editor/preview-session/cancel")

    # 2. Start preview with explicit invalid difficulty=1 -> normalized to 3
    resp2 = client.post(
        "/api/editor/preview-session/start",
        json={"task_refs": [task_ref], "difficulty": 1, "force": True},
    )
    assert resp2.status_code == 200, resp2.data
    session_id2 = resp2.get_json()["session_id"]

    task_resp2 = client.get(f"/api/session/{session_id2}/task")
    assert task_resp2.status_code == 200
    task_payload2 = task_resp2.get_json()
    assert task_payload2.get("ok") is True
    task_data2 = task_payload2.get("task") or {}
    assert task_data2.get("difficulty") == 3
    assert task_data2.get("available_levels") == [3]
    assert task_data2.get("task_data", {}).get("_difficulty_level") == 3
    assert task_data2.get("task_data", {}).get("content", {}).get("mode") == "draw_and_label"

    client.post("/api/editor/preview-session/cancel")
