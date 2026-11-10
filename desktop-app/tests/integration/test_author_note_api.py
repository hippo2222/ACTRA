import json
import shutil
import uuid
import zipfile
from pathlib import Path

import pytest

from server import app, _headless_app_ctx
from task_system.core.io.task_io import TaskIO


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


@pytest.fixture
def temp_task_for_author():
    """Create a temporary task owned by a specific test user."""
    modules_dir = Path(_headless_app_ctx.storage_service.modules_dir)
    module_id = f"mod_note_{uuid.uuid4().hex[:8]}"
    topic_id = f"top_note_{uuid.uuid4().hex[:8]}"
    task_id = f"task_{uuid.uuid4().hex[:6]}"

    module_dir = modules_dir / module_id
    topic_dir = module_dir / "topics" / topic_id
    task_dir = topic_dir / "tasks" / task_id

    (module_dir / "topics").mkdir(parents=True, exist_ok=True)
    task_dir.mkdir(parents=True, exist_ok=True)

    author_user_id = "test_author_123"

    try:
        (module_dir / "module.json").write_text(
            json.dumps({"id": module_id, "name": module_id, "topics": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (topic_dir / "topic.json").write_text(
            json.dumps({"id": topic_id, "name": topic_id, "tasks": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        task_data = TaskIO.new_task("test", name="Author Note Task", module=module_id, topic=topic_id)
        task_dict = task_data.to_dict() if hasattr(task_data, "to_dict") else dict(task_data)
        meta = task_dict.setdefault("meta", {})
        meta["created_by_user_id"] = author_user_id
        meta["id"] = task_id

        (task_dir / "task.json").write_text(
            json.dumps(task_dict, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        _headless_app_ctx.storage_service.reload_modules()
        yield module_id, topic_id, task_id, author_user_id, task_dir
    finally:
        shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()


def test_author_note_lifecycle_as_author(client, temp_task_for_author):
    module_id, topic_id, task_id, author_user_id, task_dir = temp_task_for_author
    orig_user = getattr(_headless_app_ctx, "user_id", None)
    _headless_app_ctx.user_id = author_user_id
    try:
        # 1. Initially author note is None
        resp = client.get(f"/api/editor/task/{module_id}/{topic_id}/{task_id}/author-note")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["author_note"] is None

        # 2. Set author note
        note_text = "Fix question formulation and increase time limit"
        post_resp = client.post(
            f"/api/editor/task/{module_id}/{topic_id}/{task_id}/author-note",
            json={"text": note_text, "status": "open"},
        )
        assert post_resp.status_code == 200
        post_data = post_resp.get_json()
        assert post_data["ok"] is True
        assert post_data["author_note"]["text"] == note_text
        assert post_data["author_note"]["status"] == "open"
        assert "updated_at" in post_data["author_note"]

        # 3. GET retrieves the saved note
        get_resp = client.get(f"/api/editor/task/{module_id}/{topic_id}/{task_id}/author-note")
        assert get_resp.status_code == 200
        get_data = get_resp.get_json()
        assert get_data["author_note"]["text"] == note_text
        assert get_data["author_note"]["status"] == "open"

        # 4. Resolve the note
        resolve_resp = client.post(
            f"/api/editor/task/{module_id}/{topic_id}/{task_id}/author-note",
            json={"text": note_text, "status": "resolved"},
        )
        assert resolve_resp.status_code == 200
        assert resolve_resp.get_json()["author_note"]["status"] == "resolved"

        # 5. Delete the note
        del_resp = client.post(
            f"/api/editor/task/{module_id}/{topic_id}/{task_id}/author-note",
            json={"delete": True},
        )
        assert del_resp.status_code == 200
        assert del_resp.get_json()["author_note"] is None

        # Verify task.json on disk does not have author_note
        task_on_disk = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
        assert "author_note" not in task_on_disk.get("meta", {})
    finally:
        _headless_app_ctx.user_id = orig_user


def test_author_note_forbidden_for_non_author_and_guest(client, temp_task_for_author):
    module_id, topic_id, task_id, author_user_id, _ = temp_task_for_author
    orig_user = getattr(_headless_app_ctx, "user_id", None)
    try:
        # Non-author user
        _headless_app_ctx.user_id = "intruder_user_999"
        resp = client.post(
            f"/api/editor/task/{module_id}/{topic_id}/{task_id}/author-note",
            json={"text": "I am not the author", "status": "open"},
        )
        assert resp.status_code == 403
        assert resp.get_json()["error"] == "forbidden_not_author"

        get_resp = client.get(f"/api/editor/task/{module_id}/{topic_id}/{task_id}/author-note")
        assert get_resp.status_code == 403
        assert get_resp.get_json()["error"] == "forbidden_not_author"

        # Guest user
        _headless_app_ctx.user_id = "guest"
        guest_resp = client.post(
            f"/api/editor/task/{module_id}/{topic_id}/{task_id}/author-note",
            json={"text": "Guest note"},
        )
        assert guest_resp.status_code == 403
        assert guest_resp.get_json()["error"] == "guest_cannot_edit"
    finally:
        _headless_app_ctx.user_id = orig_user


def test_session_api_author_meta_isolation(temp_task_for_author):
    module_id, topic_id, task_id, author_user_id, task_dir = temp_task_for_author
    session_api = _headless_app_ctx.session_api

    # Save a note to the task first
    task_dict = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
    task_dict.setdefault("meta", {})["author_note"] = {
        "text": "Review distractors",
        "status": "open",
        "updated_at": "2026-11-09T18:00:00Z",
    }
    (task_dir / "task.json").write_text(json.dumps(task_dict, ensure_ascii=False), encoding="utf-8")
    _headless_app_ctx.storage_service.reload_modules()

    task_ref = f"{module_id}/{topic_id}/{task_id}"

    class MockSession:
        def __init__(self, uid):
            self.id = "mock_session_1"
            self.user_id = uid
            self.complex_id = None
            self.iteration = 1
            self.current_task_index = 0
            self.is_active = True
            self.paused = False
            self.queue = []
            self.completed_tasks = []
            self.test_shuffle = {}

    mock_sess_author = MockSession(author_user_id)
    mock_sess_other = MockSession("other_student_456")

    orig_get_session = session_api.get_session
    orig_sm_get_session = session_api._session_manager.get_session
    orig_current_session_id = session_api._controller.current_session_id
    orig_current_task_ref = session_api._controller.current_task_ref

    try:
        # Author call
        session_api.get_session = lambda sid, user_id=None: mock_sess_author
        session_api._session_manager.get_session = lambda sid: mock_sess_author
        session_api._controller.current_session_id = mock_sess_author.id
        session_api._controller.current_task_ref = task_ref

        author_result = session_api.get_current_task(mock_sess_author.id, user_id=author_user_id)
        assert author_result is not None
        assert "author_meta" in author_result
        assert author_result["author_meta"]["is_author"] is True
        assert author_result["author_meta"]["author_note"]["text"] == "Review distractors"
        assert author_result["author_meta"]["author_note"]["status"] == "open"

        # Non-author student call
        session_api.get_session = lambda sid, user_id=None: mock_sess_other
        session_api._session_manager.get_session = lambda sid: mock_sess_other
        session_api._controller.current_session_id = mock_sess_other.id
        session_api._controller.current_task_ref = task_ref

        other_result = session_api.get_current_task(mock_sess_other.id, user_id="other_student_456")
        assert other_result is not None
        assert "author_meta" in other_result
        assert other_result["author_meta"]["is_author"] is False
        assert other_result["author_meta"]["author_note"] is None
    finally:
        session_api.get_session = orig_get_session
        session_api._session_manager.get_session = orig_sm_get_session
        session_api._controller.current_session_id = orig_current_session_id
        session_api._controller.current_task_ref = orig_current_task_ref


def test_export_archive_sanitizes_author_note(temp_task_for_author):
    module_id, topic_id, task_id, author_user_id, task_dir = temp_task_for_author

    # Add author note to task
    task_dict = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
    task_dict.setdefault("meta", {})["author_note"] = {
        "text": "Private методическая заметка: опечатка в вопросе",
        "status": "open",
    }
    (task_dir / "task.json").write_text(json.dumps(task_dict, ensure_ascii=False), encoding="utf-8")
    _headless_app_ctx.storage_service.reload_modules()

    import_export_svc = _headless_app_ctx.import_export_service
    tasks_to_export = [{"module_id": module_id, "topic_id": topic_id, "task_id": task_id}]

    zip_path = import_export_svc.create_export_archive(tasks_to_export)
    try:
        assert Path(zip_path).exists()
        with zipfile.ZipFile(zip_path, "r") as zf:
            task_entry = f"modules/{module_id}/topics/{topic_id}/tasks/{task_id}/task.json"
            assert task_entry in zf.namelist()
            exported_task_data = json.loads(zf.read(task_entry).decode("utf-8"))

            assert "author_note" not in exported_task_data
            assert "author_note" not in exported_task_data.get("meta", {})
            assert "author_note" not in exported_task_data.get("metadata", {})
    finally:
        Path(zip_path).unlink(missing_ok=True)
