import copy
import json
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

import server  # type: ignore
import routes._context as ctx_module  # type: ignore
from services.storage_service import StorageService  # type: ignore


class TestStorageServiceRenameTask:
    def test_rename_task_local_storage(self, tmp_path):
        """Test that StorageService.rename_task updates task.json and module.json atomically."""
        modules_dir = tmp_path / "modules"
        modules_dir.mkdir(parents=True)
        
        module_id = "test_mod"
        topic_id = "test_top"
        task_id = "task_001"

        # Setup folders
        task_dir = modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        task_dir.mkdir(parents=True)

        task_json = {
            "id": task_id,
            "name": "Old Task Name",
            "type": "test",
            "meta": {
                "id": task_id,
                "module": module_id,
                "topic": topic_id,
                "name": "Old Task Name",
                "version": "1.0",
            },
        }
        with open(task_dir / "task.json", "w", encoding="utf-8") as fh:
            json.dump(task_json, fh)

        module_json = {
            "id": module_id,
            "name": "Test Module",
            "topics": [
                {
                    "id": topic_id,
                    "name": "Test Topic",
                    "tasks": [
                        {"id": task_id, "name": "Old Task Name", "type": "test"}
                    ],
                }
            ],
        }
        with open(modules_dir / module_id / "module.json", "w", encoding="utf-8") as fh:
            json.dump(module_json, fh)

        storage = StorageService(data_dir=str(tmp_path))
        
        # Perform rename
        new_name = "New Awesome Task Name"
        ok = storage.rename_task(module_id, topic_id, task_id, new_name)
        assert ok is True

        # Verify task.json
        with open(task_dir / "task.json", "r", encoding="utf-8") as fh:
            updated_task = json.load(fh)
        assert updated_task["name"] == new_name
        assert updated_task["meta"]["name"] == new_name
        assert "modified" in updated_task["meta"]

        # Verify module.json
        with open(modules_dir / module_id / "module.json", "r", encoding="utf-8") as fh:
            updated_mod = json.load(fh)
        assert updated_mod["topics"][0]["tasks"][0]["name"] == new_name

    def test_rename_task_validation_rejections(self, tmp_path):
        storage = StorageService(data_dir=str(tmp_path))
        # Empty names rejected
        assert storage.rename_task("m", "t", "task1", "") is False
        assert storage.rename_task("m", "t", "task1", "   ") is False


class _DummyUser:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.settings = {}


class _DummyUserService:
    def get_user(self, user_id: str):
        clean = str(user_id or "").strip()
        if not clean:
            return None
        return _DummyUser(clean)


class _LimitsStub:
    def assert_can_create_workspace_entity(self, user_id: str, entity_kind: str):
        return None

    def assert_entity_not_archived(self, user_id, entity_kind, entity_ref, *, action, scope=None):
        if "archived" in entity_ref:
            from services.workspace_limits_service import PremiumArchivedContentError
            raise PremiumArchivedContentError("task_in_archive")
        return {
            "workspace_access_state": "active",
            "is_premium_archived": False,
            "archived_item": None,
        }


class _MockStorageForApi:
    def __init__(self):
        self.modules_dir = Path("/tmp/mock_modules")
        self.tasks = {
            ("mod1", "top1", "task1"): {
                "metadata": {
                    "id": "task1",
                    "module": "mod1",
                    "topic": "top1",
                    "name": "Original Name",
                    "created_by_user_id": "user_123",
                    "ownership": {
                        "is_owned_by_current_user": True,
                        "created_by_user_id": "user_123",
                    },
                },
                "task_data": {
                    "id": "task1",
                    "name": "Original Name",
                    "meta": {
                        "name": "Original Name",
                        "created_by_user_id": "user_123",
                    },
                },
            }
        }
        self.renamed_calls = []

    def load_task(self, module_id, topic_id, task_id):
        key = (module_id, topic_id, task_id)
        return copy.deepcopy(self.tasks.get(key))

    def rename_task(self, module_id, topic_id, task_id, new_name):
        key = (module_id, topic_id, task_id)
        if key not in self.tasks:
            return False
        self.tasks[key]["task_data"]["name"] = new_name
        self.tasks[key]["task_data"]["meta"]["name"] = new_name
        self.tasks[key]["metadata"]["name"] = new_name
        self.renamed_calls.append((module_id, topic_id, task_id, new_name))
        return True


def _install_hosted_ctx(monkeypatch, tmp_path, *, storage_service):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_HOSTED_DEV_AUTH_BRIDGE", raising=False)
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)
    storage_service.modules_dir = tmp_path / "modules"
    app_ctx = type(
        "Ctx",
        (),
        {
            "storage_service": storage_service,
            "theory_service": object(),
            "catalog_service": object(),
            "user_service": _DummyUserService(),
            "workspace_limits_service": _LimitsStub(),
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)
    monkeypatch.setattr(ctx_module, "_extra", dict(getattr(ctx_module, "_extra", {})))
    return app_ctx


def _login(client, user_id: str = "editor-user") -> None:
    with client.session_transaction() as session:
        session[ctx_module._AUTH_USER_ID_SESSION_KEY] = user_id


class TestTaskRenameApiEndpoint:
    @pytest.fixture
    def client_and_storage(self, monkeypatch, tmp_path):
        mock_storage = _MockStorageForApi()
        _install_hosted_ctx(monkeypatch, tmp_path, storage_service=mock_storage)
        app = server.app
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c, mock_storage

    def test_rename_api_success(self, client_and_storage):
        c, mock_storage = client_and_storage
        _login(c, "user_123")
        resp = c.post(
            "/api/editor/task/rename",
            json={
                "module_id": "mod1",
                "topic_id": "top1",
                "task_id": "task1",
                "name": "Updated Task Title",
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert mock_storage.tasks[("mod1", "top1", "task1")]["task_data"]["name"] == "Updated Task Title"

    def test_rename_api_validation(self, client_and_storage):
        c, _ = client_and_storage
        _login(c, "user_123")
        # Missing name
        resp = c.post(
            "/api/editor/task/rename",
            json={"module_id": "mod1", "topic_id": "top1", "task_id": "task1"},
        )
        assert resp.status_code == 400
        assert resp.get_json()["error"] == "module_id_topic_id_task_id_and_name_required"

        # Too long name
        resp = c.post(
            "/api/editor/task/rename",
            json={
                "module_id": "mod1",
                "topic_id": "top1",
                "task_id": "task1",
                "name": "x" * 151,
            },
        )
        assert resp.status_code == 400
        assert resp.get_json()["error"] == "task_name_too_long"

    def test_rename_api_guest_forbidden(self, client_and_storage):
        c, _ = client_and_storage
        # Not logged in (guest)
        resp = c.post(
            "/api/editor/task/rename",
            json={
                "module_id": "mod1",
                "topic_id": "top1",
                "task_id": "task1",
                "name": "New Name",
            },
        )
        assert resp.status_code == 403
        assert resp.get_json()["error"] == "guest_cannot_edit"
