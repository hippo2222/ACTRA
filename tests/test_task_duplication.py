import json
import sys
from pathlib import Path
import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from services.storage_service import StorageService


@pytest.fixture
def temp_storage(tmp_path):
    modules_dir = tmp_path / "modules"
    modules_dir.mkdir(parents=True)

    module_id = "mod_cardio"
    topic_id = "topic_anatomy"
    task_id = "heart_anatomy"

    task_dir = modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
    task_dir.mkdir(parents=True)

    # Put a mock image
    images_dir = task_dir / "images"
    images_dir.mkdir()
    (images_dir / "heart_view.png").write_bytes(b"PNG_MOCK_DATA")

    # task.json
    task_data = {
        "id": task_id,
        "name": "Анатомия сердца",
        "type": "click",
        "content": {"question": "Укажите левый желудочек"},
        "meta": {
            "id": task_id,
            "module": module_id,
            "topic": topic_id,
            "name": "Анатомия сердца",
            "version": "1.0",
        },
    }
    with open(task_dir / "task.json", "w", encoding="utf-8") as fh:
        json.dump(task_data, fh, ensure_ascii=False)

    # answer_key.json
    answer_key = {
        "task_id": task_id,
        "answers": [{"target": "left_ventricle", "coords": [100, 200]}],
    }
    with open(task_dir / "answer_key.json", "w", encoding="utf-8") as fh:
        json.dump(answer_key, fh, ensure_ascii=False)

    # module.json
    module_json = {
        "id": module_id,
        "name": "Кардиология",
        "topics": [
            {
                "id": topic_id,
                "name": "Анатомия",
                "tasks": [
                    {"id": task_id, "name": "Анатомия сердца", "type": "click"}
                ],
            },
            {
                "id": "topic_pathology",
                "name": "Патология",
                "tasks": [],
            },
        ],
    }
    with open(modules_dir / module_id / "module.json", "w", encoding="utf-8") as fh:
        json.dump(module_json, fh, ensure_ascii=False)

    return StorageService(data_dir=str(tmp_path))


class TestStorageServiceTaskDuplication:
    def test_duplicate_task_basic(self, temp_storage):
        storage = temp_storage
        result = storage.duplicate_task("mod_cardio", "topic_anatomy", "heart_anatomy")

        assert result["success"] is True
        assert result["task_id"] == "heart_anatomy_copy1"
        assert result["name"] == "Анатомия сердца (копия 1)"
        assert result["module_id"] == "mod_cardio"
        assert result["topic_id"] == "topic_anatomy"

        # Check cloned task on disk
        cloned_dir = storage.modules_dir / "mod_cardio" / "topics" / "topic_anatomy" / "tasks" / "heart_anatomy_copy1"
        assert cloned_dir.exists()
        assert (cloned_dir / "task.json").exists()
        assert (cloned_dir / "images" / "heart_view.png").exists()
        assert (cloned_dir / "images" / "heart_view.png").read_bytes() == b"PNG_MOCK_DATA"

        # Check task.json contents
        with open(cloned_dir / "task.json", "r", encoding="utf-8") as fh:
            cloned_json = json.load(fh)
        assert cloned_json["id"] == "heart_anatomy_copy1"
        assert cloned_json["name"] == "Анатомия сердца (копия 1)"
        assert cloned_json["meta"]["id"] == "heart_anatomy_copy1"
        assert cloned_json["meta"]["name"] == "Анатомия сердца (копия 1)"
        assert cloned_json["meta"]["created_via"] == "manual_copy"
        assert cloned_json["meta"]["source_entity_id"] == "heart_anatomy"

        # Check answer_key.json
        assert (cloned_dir / "answer_key.json").exists()
        with open(cloned_dir / "answer_key.json", "r", encoding="utf-8") as fh:
            cloned_ak = json.load(fh)
        assert cloned_ak.get("answers") == [{"target": "left_ventricle", "coords": [100, 200]}]

        # Check module.json registration
        tasks = storage.get_tasks("mod_cardio", "topic_anatomy")
        task_ids = [t["id"] for t in tasks]
        assert "heart_anatomy" in task_ids
        assert "heart_anatomy_copy1" in task_ids

    def test_duplicate_task_incremental_numbering(self, temp_storage):
        storage = temp_storage
        res1 = storage.duplicate_task("mod_cardio", "topic_anatomy", "heart_anatomy")
        assert res1["task_id"] == "heart_anatomy_copy1"
        assert res1["name"] == "Анатомия сердца (копия 1)"

        res2 = storage.duplicate_task("mod_cardio", "topic_anatomy", "heart_anatomy")
        assert res2["task_id"] == "heart_anatomy_copy2"
        assert res2["name"] == "Анатомия сердца (копия 2)"

    def test_duplicate_task_from_copy_preserves_clean_base(self, temp_storage):
        storage = temp_storage
        # Create copy 1
        storage.duplicate_task("mod_cardio", "topic_anatomy", "heart_anatomy")

        # Now duplicate heart_anatomy_copy1 directly
        res = storage.duplicate_task("mod_cardio", "topic_anatomy", "heart_anatomy_copy1")
        assert res["task_id"] == "heart_anatomy_copy2"
        assert res["name"] == "Анатомия сердца (копия 2)"

    def test_duplicate_task_to_different_topic(self, temp_storage):
        storage = temp_storage
        res = storage.duplicate_task(
            "mod_cardio",
            "topic_anatomy",
            "heart_anatomy",
            target_topic_id="topic_pathology",
        )
        assert res["success"] is True
        assert res["topic_id"] == "topic_pathology"

        tasks_pathology = storage.get_tasks("mod_cardio", "topic_pathology")
        assert any(t["id"] == res["task_id"] for t in tasks_pathology)

    def test_duplicate_nonexistent_task_raises(self, temp_storage):
        storage = temp_storage
        with pytest.raises(FileNotFoundError):
            storage.duplicate_task("mod_cardio", "topic_anatomy", "unknown_task_id")


class _LimitsStub:
    def assert_can_create_workspace_entity(self, user_id: str, entity_kind: str):
        return None

    def evaluate_capacity(self, user_id: str, requests=None):
        return {"blocked": False, "violations": []}

    def _raise_for_blocked_evaluation(self, evaluation):
        if evaluation.get("blocked"):
            from services.workspace_limits_service import WorkspaceLimitError
            raise WorkspaceLimitError("workspace_task_limit_exceeded")

    def assert_entity_not_archived(self, user_id, entity_kind, entity_ref, *, action, scope=None):
        if "archived" in str(entity_ref):
            from services.workspace_limits_service import PremiumArchivedContentError
            raise PremiumArchivedContentError("task_in_archive")
        return {
            "workspace_access_state": "active",
            "is_premium_archived": False,
            "archived_item": None,
        }


class _DummyUserService:
    def get_user(self, user_id):
        return {"id": user_id, "email": "test@example.com"}


def _install_hosted_ctx(monkeypatch, tmp_path, *, storage_service):
    import server  # type: ignore
    import routes._context as ctx_module  # type: ignore

    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    app_ctx = type(
        "Ctx",
        (),
        {
            "storage_service": storage_service,
            "theory_service": object(),
            "catalog_service": object(),
            "user_service": _DummyUserService(),
            "workspace_limits_service": _LimitsStub(),
            "import_export_service": object(),
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)
    monkeypatch.setattr(ctx_module, "_extra", dict(getattr(ctx_module, "_extra", {})))
    return app_ctx


def _login(client, user_id: str = "editor-user") -> None:
    import routes._context as ctx_module  # type: ignore
    with client.session_transaction() as session:
        session[ctx_module._AUTH_USER_ID_SESSION_KEY] = user_id


class TestDuplicateTaskApi:
    @pytest.fixture
    def client_and_storage(self, monkeypatch, temp_storage, tmp_path):
        import server  # type: ignore
        _install_hosted_ctx(monkeypatch, tmp_path, storage_service=temp_storage)
        app = server.app
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c, temp_storage

    def test_duplicate_endpoint_success(self, client_and_storage):
        c, storage = client_and_storage
        _login(c, "editor-user")
        resp = c.post(
            "/api/editor/tasks/duplicate",
            json={
                "tasks": [
                    {
                        "module_id": "mod_cardio",
                        "topic_id": "topic_anatomy",
                        "task_id": "heart_anatomy",
                    }
                ]
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["duplicated_count"] == 1
        assert len(data["duplicated"]) == 1
        dup = data["duplicated"][0]
        assert dup["source_task_id"] == "heart_anatomy"
        assert dup["task_id"] == "heart_anatomy_copy1"
        assert dup["name"] == "Анатомия сердца (копия 1)"

    def test_duplicate_endpoint_guest_blocked(self, client_and_storage):
        c, storage = client_and_storage
        # No login -> user_id is guest
        resp = c.post(
            "/api/editor/tasks/duplicate",
            json={
                "tasks": [
                    {
                        "module_id": "mod_cardio",
                        "topic_id": "topic_anatomy",
                        "task_id": "heart_anatomy",
                    }
                ]
            },
        )
        assert resp.status_code == 403
        data = resp.get_json()
        assert data["ok"] is False
        assert data["error"] == "guest_cannot_edit"

    def test_duplicate_endpoint_empty_payload(self, client_and_storage):
        c, storage = client_and_storage
        _login(c, "editor-user")
        resp = c.post(
            "/api/editor/tasks/duplicate",
            json={"tasks": []},
        )
        assert resp.status_code == 400
        data = resp.get_json()
        assert data["ok"] is False

