import copy
import json
import sys
from pathlib import Path

import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

import server  # type: ignore
import routes._context as ctx_module  # type: ignore
from services.hosted_shadow_fallback import (
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)


class _DummyHostedUser:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.settings = {}


class _DummyHostedUserService:
    def get_user(self, user_id: str):
        clean = str(user_id or "").strip()
        if not clean:
            return None
        return _DummyHostedUser(clean)


class _WorkspaceLimitsStub:
    def assert_can_create_workspace_entity(self, user_id: str, entity_kind: str):
        return None


class _EditorStorageStub:
    def __init__(self):
        self.modules = []
        self.tasks = {}
        self.bootstrap_counter = 0
        self.fail_read_operation = None
        self.fail_write_operation = None

    @staticmethod
    def _workspace_fields(workspace_meta=None):
        meta = workspace_meta if isinstance(workspace_meta, dict) else {}
        payload = {}
        for field_name in (
            "created_by_user_id",
            "updated_by_user_id",
            "created_via",
            "content_scope",
        ):
            if meta.get(field_name) is not None:
                payload[field_name] = meta.get(field_name)
        return payload

    def _clone_modules(self):
        return copy.deepcopy(self.modules)

    def _find_module(self, module_id: str):
        for module in self.modules:
            if str(module.get("id") or "").strip() == module_id:
                return module
        return None

    def _find_topic(self, module_id: str, topic_id: str):
        module = self._find_module(module_id)
        if not module:
            return None
        for topic in module.get("topics") or []:
            if str(topic.get("id") or "").strip() == topic_id:
                return topic
        return None

    def _task_ref_payload(
        self,
        *,
        module_id: str,
        topic_id: str,
        task_id: str,
        task_name: str,
        owner_id=None,
        workspace_meta=None,
    ):
        payload = {
            "id": task_id,
            "name": task_name,
            "module": module_id,
            "topic": topic_id,
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        }
        payload.update(self._workspace_fields(workspace_meta))
        effective_owner_id = owner_id or payload.get("created_by_user_id")
        if effective_owner_id:
            payload["created_by_user_id"] = effective_owner_id
            payload["ownership"] = {
                "scope": "workspace",
                "content_scope": payload.get("content_scope", "shared_local"),
                "created_by_user_id": effective_owner_id,
                "updated_by_user_id": payload.get("updated_by_user_id"),
                "created_via": payload.get("created_via", "manual_editor"),
                "has_owner": True,
                "is_owned_by_current_user": False,
                "is_shared_library": payload.get("content_scope", "shared_local") == "shared_local",
            }
        return payload

    def _task_payload(
        self,
        *,
        module_id: str,
        topic_id: str,
        task_id: str,
        task_name: str,
        task_type: str,
        workspace_meta=None,
    ):
        payload = {
            "task_data": {
                "type": task_type,
                "name": task_name,
                "meta": {
                    "id": task_id,
                    "name": task_name,
                    "module": module_id,
                    "topic": topic_id,
                    "created_via": "manual_editor",
                    "content_scope": "shared_local",
                },
                "content": {
                    "questions": [],
                    "settings": {},
                },
            },
            "answer_key": {},
            "metadata": {
                "id": task_id,
                "name": task_name,
                "module": module_id,
                "topic": topic_id,
                "created_via": "manual_editor",
                "content_scope": "shared_local",
            },
            "task_dir": f"/virtual/{module_id}/{topic_id}/{task_id}",
        }
        fields = self._workspace_fields(workspace_meta)
        payload["metadata"].update(fields)
        payload["task_data"]["meta"].update(fields)
        return payload

    def load_modules(self):
        if self.fail_read_operation == "load_modules":
            raise HostedShadowReadFallbackDisabledError(
                "editor.catalog",
                reason="test_editor_catalog_blocked",
            )
        return self._clone_modules()

    def build_task_draft_bootstrap(
        self,
        module_id,
        topic_id,
        task_name,
        task_type,
        preferred_task_id=None,
        workspace_meta=None,
    ):
        if self.fail_write_operation == "build_task_draft_bootstrap":
            raise HostedShadowWriteFallbackDisabledError(
                "build_task_draft_bootstrap",
                reason="test_editor_bootstrap_blocked",
            )
        task_id = preferred_task_id or f"draft_{self.bootstrap_counter + 1}"
        self.bootstrap_counter += 1
        return {
            "task_id": task_id,
            "task": {
                **self._task_payload(
                    module_id=module_id,
                    topic_id=topic_id,
                    task_id=task_id,
                    task_name=task_name,
                    task_type=task_type,
                    workspace_meta=workspace_meta,
                ),
                "is_new": True,
            },
        }

    def create_module(self, module_id, name, workspace_meta=None):
        if self.fail_write_operation == "create_module":
            raise HostedShadowWriteFallbackDisabledError(
                "create_module",
                reason="test_editor_module_create_blocked",
            )
        payload = {
            "id": module_id,
            "name": name,
            "created_via": "manual_editor",
            "content_scope": "shared_local",
            "topics": [],
        }
        payload.update(self._workspace_fields(workspace_meta))
        self.modules.append(payload)
        return True

    def create_topic(self, module_id, topic_id, name, theory_link=None, workspace_meta=None):
        if self.fail_write_operation == "create_topic":
            raise HostedShadowWriteFallbackDisabledError(
                "create_topic",
                reason="test_editor_topic_create_blocked",
            )
        module = self._find_module(module_id)
        if not module:
            return False
        module.setdefault("topics", []).append(
            {
                "id": topic_id,
                "name": name,
                "created_via": "manual_editor",
                "content_scope": "shared_local",
                "tasks": [],
                **self._workspace_fields(workspace_meta),
            }
        )
        return True

    def create_task(self, module_id, topic_id, task_name, task_type, preferred_task_id=None, workspace_meta=None):
        if self.fail_write_operation == "create_task":
            raise HostedShadowWriteFallbackDisabledError(
                "create_task",
                reason="test_editor_task_create_blocked",
            )
        topic = self._find_topic(module_id, topic_id)
        if not topic:
            return None
        task_id = preferred_task_id or f"task_{len(topic.get('tasks') or []) + 1}"
        payload = self._task_payload(
            module_id=module_id,
            topic_id=topic_id,
            task_id=task_id,
            task_name=task_name,
            task_type=task_type,
            workspace_meta=workspace_meta,
        )
        self.tasks[(module_id, topic_id, task_id)] = copy.deepcopy(payload)
        topic.setdefault("tasks", []).append(
            self._task_ref_payload(
                module_id=module_id,
                topic_id=topic_id,
                task_id=task_id,
                task_name=task_name,
                workspace_meta=workspace_meta,
            )
        )
        return task_id

    def save_task(self, module_id, topic_id, task_id, payload, validate=True):
        if self.fail_write_operation == "save_task":
            raise HostedShadowWriteFallbackDisabledError(
                "save_task",
                reason="test_editor_task_save_blocked",
            )
        normalized = copy.deepcopy(payload)
        metadata = normalized.get("metadata") if isinstance(normalized.get("metadata"), dict) else {}
        task_data = normalized.get("task_data") if isinstance(normalized.get("task_data"), dict) else {}
        task_name = (
            str(metadata.get("name") or "").strip()
            or str(task_data.get("name") or "").strip()
            or task_id
        )
        metadata.setdefault("id", task_id)
        metadata.setdefault("module", module_id)
        metadata.setdefault("topic", topic_id)
        metadata.setdefault("name", task_name)
        metadata.setdefault("created_via", "manual_editor")
        metadata.setdefault("content_scope", "shared_local")
        normalized["metadata"] = metadata
        if isinstance(task_data, dict):
            meta = task_data.get("meta") if isinstance(task_data.get("meta"), dict) else {}
            meta.update(metadata)
            task_data["meta"] = meta
            task_data.setdefault("name", task_name)
            normalized["task_data"] = task_data
        topic = self._find_topic(module_id, topic_id)
        if not topic:
            return False
        existing_tasks = topic.setdefault("tasks", [])
        for item in existing_tasks:
            if str(item.get("id") or "").strip() == task_id:
                item.update(
                    self._task_ref_payload(
                        module_id=module_id,
                        topic_id=topic_id,
                        task_id=task_id,
                        task_name=task_name,
                        workspace_meta=metadata,
                    )
                )
                break
        else:
            existing_tasks.append(
                self._task_ref_payload(
                    module_id=module_id,
                    topic_id=topic_id,
                    task_id=task_id,
                    task_name=task_name,
                    workspace_meta=metadata,
                )
            )
        self.tasks[(module_id, topic_id, task_id)] = normalized
        return True

    def load_task(self, module_id, topic_id, task_id):
        if self.fail_read_operation == "load_task":
            raise HostedShadowReadFallbackDisabledError(
                "editor.load_task",
                reason="test_editor_task_read_blocked",
            )
        payload = self.tasks.get((module_id, topic_id, task_id))
        return copy.deepcopy(payload) if payload is not None else None

    def delete_task(self, module_id, topic_id, task_id):
        if self.fail_write_operation == "delete_task":
            raise HostedShadowWriteFallbackDisabledError(
                "delete_task",
                reason="test_editor_task_delete_blocked",
            )
        topic = self._find_topic(module_id, topic_id)
        if not topic:
            return False
        topic["tasks"] = [
            item for item in topic.get("tasks") or []
            if str(item.get("id") or "").strip() != task_id
        ]
        self.tasks.pop((module_id, topic_id, task_id), None)
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
            "user_service": _DummyHostedUserService(),
            "workspace_limits_service": _WorkspaceLimitsStub(),
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


@pytest.fixture
def client():
    with server.app.test_client() as c:
        yield c


def test_hosted_task_editor_crud_flow_uses_single_hosted_truth(client, monkeypatch, tmp_path):
    storage = _EditorStorageStub()
    _install_hosted_ctx(monkeypatch, tmp_path, storage_service=storage)
    _login(client)

    module_response = client.post("/api/editor/module/new", json={"name": "Hosted Module"})
    assert module_response.status_code == 200
    module_id = module_response.get_json()["module_id"]

    topic_response = client.post(
        "/api/editor/topic/new",
        json={"module_id": module_id, "name": "Hosted Topic"},
    )
    assert topic_response.status_code == 200
    topic_id = topic_response.get_json()["topic_id"]

    bootstrap_response = client.post(
        "/api/editor/task/bootstrap",
        json={
            "module_id": module_id,
            "topic_id": topic_id,
            "task_name": "Hosted Draft Task",
            "task_type": "test",
        },
    )
    assert bootstrap_response.status_code == 200
    bootstrap_payload = bootstrap_response.get_json()
    assert bootstrap_payload["ok"] is True
    task_id = bootstrap_payload["task_id"]
    assert bootstrap_payload["task"]["is_new"] is True
    assert bootstrap_payload["task"]["metadata"]["created_by_user_id"] == "editor-user"
    assert bootstrap_payload["task"]["metadata"]["updated_by_user_id"] == "editor-user"
    assert bootstrap_payload["task"]["task_data"]["meta"]["created_by_user_id"] == "editor-user"

    save_payload = bootstrap_payload["task"]
    save_payload["task_data"]["content"]["questions"] = [
        {
            "id": 1,
            "text": "Hosted question",
            "answers": [],
            "options": [],
        }
    ]
    save_payload["task_data"]["name"] = "Hosted Saved Task"
    save_payload["metadata"]["name"] = "Hosted Saved Task"

    save_response = client.post(
        f"/api/editor/task/{module_id}/{topic_id}/{task_id}",
        json=save_payload,
    )
    assert save_response.status_code == 200
    assert save_response.get_json()["ok"] is True

    load_response = client.get(f"/api/editor/task/{module_id}/{topic_id}/{task_id}")
    assert load_response.status_code == 200
    loaded_task = load_response.get_json()["task"]
    assert loaded_task["metadata"]["id"] == task_id
    assert loaded_task["metadata"]["name"] == "Hosted Saved Task"
    assert loaded_task["metadata"]["created_by_user_id"] == "editor-user"
    assert loaded_task["metadata"]["updated_by_user_id"] == "editor-user"
    assert loaded_task["task_data"]["content"]["questions"][0]["text"] == "Hosted question"

    catalog_response = client.get("/api/editor/catalog")
    assert catalog_response.status_code == 200
    catalog_payload = catalog_response.get_json()
    assert catalog_payload["ok"] is True
    module_payload = next(item for item in catalog_payload["modules"] if item["id"] == module_id)
    topic_payload = next(item for item in module_payload["topics"] if item["id"] == topic_id)
    assert [item["id"] for item in topic_payload["tasks"]] == [task_id]

    reopen_response = client.get(f"/api/editor/task/{module_id}/{topic_id}/{task_id}")
    assert reopen_response.status_code == 200
    reopened_task = reopen_response.get_json()["task"]
    assert reopened_task["metadata"]["name"] == "Hosted Saved Task"

    delete_response = client.delete(f"/api/editor/task/{module_id}/{topic_id}/{task_id}")
    assert delete_response.status_code == 200
    assert delete_response.get_json()["ok"] is True

    missing_response = client.get(f"/api/editor/task/{module_id}/{topic_id}/{task_id}")
    assert missing_response.status_code == 404
    assert missing_response.get_json()["error"] == "task_not_found"

    final_catalog_response = client.get("/api/editor/catalog")
    final_catalog_payload = final_catalog_response.get_json()
    module_payload = next(item for item in final_catalog_payload["modules"] if item["id"] == module_id)
    topic_payload = next(item for item in module_payload["topics"] if item["id"] == topic_id)
    assert topic_payload["tasks"] == []


def test_hosted_task_editor_hides_foreign_owned_tasks_in_catalog_and_load(client, monkeypatch, tmp_path):
    storage = _EditorStorageStub()
    storage.modules = [
        {
            "id": "module_1",
            "name": "Module 1",
            "created_by_user_id": "editor-user",
            "updated_by_user_id": "editor-user",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
            "topics": [
                {
                    "id": "topic_1",
                    "name": "Topic 1",
                    "created_by_user_id": "editor-user",
                    "updated_by_user_id": "editor-user",
                    "created_via": "manual_editor",
                    "content_scope": "shared_local",
                    "tasks": [
                        storage._task_ref_payload(
                            module_id="module_1",
                            topic_id="topic_1",
                            task_id="task_visible",
                            task_name="Visible task",
                            owner_id="editor-user",
                        ),
                        storage._task_ref_payload(
                            module_id="module_1",
                            topic_id="topic_1",
                            task_id="task_foreign",
                            task_name="Foreign task",
                            owner_id="other-user",
                        ),
                    ],
                }
            ],
        }
    ]
    storage.tasks[("module_1", "topic_1", "task_visible")] = storage._task_payload(
        module_id="module_1",
        topic_id="topic_1",
        task_id="task_visible",
        task_name="Visible task",
        task_type="test",
        workspace_meta={
            "created_by_user_id": "editor-user",
            "updated_by_user_id": "editor-user",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        },
    )
    foreign_task = storage._task_payload(
        module_id="module_1",
        topic_id="topic_1",
        task_id="task_foreign",
        task_name="Foreign task",
        task_type="test",
    )
    foreign_task["metadata"]["created_by_user_id"] = "other-user"
    foreign_task["metadata"]["ownership"] = {
        "scope": "workspace",
        "content_scope": "shared_local",
        "created_by_user_id": "other-user",
        "created_via": "manual_editor",
        "has_owner": True,
        "is_owned_by_current_user": False,
        "is_shared_library": True,
    }
    foreign_task["task_data"]["meta"] = copy.deepcopy(foreign_task["metadata"])
    storage.tasks[("module_1", "topic_1", "task_foreign")] = foreign_task

    _install_hosted_ctx(monkeypatch, tmp_path, storage_service=storage)
    _login(client)

    catalog_response = client.get("/api/editor/catalog")
    assert catalog_response.status_code == 200
    catalog_payload = catalog_response.get_json()
    topic_payload = catalog_payload["modules"][0]["topics"][0]
    assert [item["id"] for item in topic_payload["tasks"]] == ["task_visible"]

    foreign_response = client.get("/api/editor/task/module_1/topic_1/task_foreign")
    assert foreign_response.status_code == 404
    assert foreign_response.get_json()["error"] == "task_not_found"


def test_hosted_task_editor_hides_foreign_imported_tasks_in_catalog_and_load(client, monkeypatch, tmp_path):
    storage = _EditorStorageStub()
    storage.modules = [
        {
            "id": "module_1",
            "name": "Module 1",
            "created_by_user_id": "editor-user",
            "updated_by_user_id": "editor-user",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
            "topics": [
                {
                    "id": "topic_1",
                    "name": "Topic 1",
                    "created_by_user_id": "editor-user",
                    "updated_by_user_id": "editor-user",
                    "created_via": "manual_editor",
                    "content_scope": "shared_local",
                    "tasks": [
                        storage._task_ref_payload(
                            module_id="module_1",
                            topic_id="topic_1",
                            task_id="task_visible",
                            task_name="Visible task",
                            owner_id="editor-user",
                        ),
                        {
                            **storage._task_ref_payload(
                                module_id="module_1",
                                topic_id="topic_1",
                                task_id="task_imported_foreign",
                                task_name="Imported foreign task",
                                owner_id="other-user",
                            ),
                            "created_via": "manual_copy",
                            "source_catalog_item_id": "catalog_task_demo",
                        },
                    ],
                }
            ],
        }
    ]
    storage.tasks[("module_1", "topic_1", "task_visible")] = storage._task_payload(
        module_id="module_1",
        topic_id="topic_1",
        task_id="task_visible",
        task_name="Visible task",
        task_type="test",
        workspace_meta={
            "created_by_user_id": "editor-user",
            "updated_by_user_id": "editor-user",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        },
    )
    storage.tasks[("module_1", "topic_1", "task_imported_foreign")] = storage._task_payload(
        module_id="module_1",
        topic_id="topic_1",
        task_id="task_imported_foreign",
        task_name="Imported foreign task",
        task_type="test",
        workspace_meta={
            "created_by_user_id": "other-user",
            "updated_by_user_id": "other-user",
            "created_via": "manual_copy",
            "content_scope": "shared_local",
        },
    )
    storage.tasks[("module_1", "topic_1", "task_imported_foreign")]["metadata"]["source_catalog_item_id"] = (
        "catalog_task_demo"
    )
    storage.tasks[("module_1", "topic_1", "task_imported_foreign")]["task_data"]["meta"]["source_catalog_item_id"] = (
        "catalog_task_demo"
    )

    _install_hosted_ctx(monkeypatch, tmp_path, storage_service=storage)
    _login(client)

    catalog_response = client.get("/api/editor/catalog")
    assert catalog_response.status_code == 200
    catalog_payload = catalog_response.get_json()
    topic_payload = catalog_payload["modules"][0]["topics"][0]
    assert [item["id"] for item in topic_payload["tasks"]] == ["task_visible"]

    foreign_response = client.get("/api/editor/task/module_1/topic_1/task_imported_foreign")
    assert foreign_response.status_code == 404
    assert foreign_response.get_json()["error"] == "task_not_found"


def test_hosted_task_editor_hides_ownerless_legacy_catalog_entries(client, monkeypatch, tmp_path):
    storage = _EditorStorageStub()
    storage.modules = [
        {
            "id": "legacy_module",
            "name": "Legacy Module",
            "created_via": "legacy_unknown",
            "content_scope": "shared_local",
            "topics": [
                {
                    "id": "legacy_topic",
                    "name": "Legacy Topic",
                    "created_via": "legacy_unknown",
                    "content_scope": "shared_local",
                    "tasks": [
                        storage._task_ref_payload(
                            module_id="legacy_module",
                            topic_id="legacy_topic",
                            task_id="legacy_task",
                            task_name="Legacy Task",
                        )
                    ],
                }
            ],
        }
    ]
    storage.tasks[("legacy_module", "legacy_topic", "legacy_task")] = storage._task_payload(
        module_id="legacy_module",
        topic_id="legacy_topic",
        task_id="legacy_task",
        task_name="Legacy Task",
        task_type="test",
    )

    _install_hosted_ctx(monkeypatch, tmp_path, storage_service=storage)
    _login(client)

    catalog_response = client.get("/api/editor/catalog")
    assert catalog_response.status_code == 200
    assert catalog_response.get_json()["modules"] == []

    task_response = client.get("/api/editor/task/legacy_module/legacy_topic/legacy_task")
    assert task_response.status_code == 404
    assert task_response.get_json()["error"] == "task_not_found"


def test_hosted_task_editor_blocks_foreign_owned_task_save_and_delete(client, monkeypatch, tmp_path):
    storage = _EditorStorageStub()
    storage.modules = [
        {
            "id": "module_1",
            "name": "Module 1",
            "created_by_user_id": "other-user",
            "updated_by_user_id": "other-user",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
            "topics": [
                {
                    "id": "topic_1",
                    "name": "Topic 1",
                    "created_by_user_id": "other-user",
                    "updated_by_user_id": "other-user",
                    "created_via": "manual_editor",
                    "content_scope": "shared_local",
                    "tasks": [
                        storage._task_ref_payload(
                            module_id="module_1",
                            topic_id="topic_1",
                            task_id="task_foreign",
                            task_name="Foreign task",
                            owner_id="other-user",
                        )
                    ],
                }
            ],
        }
    ]
    foreign_task = storage._task_payload(
        module_id="module_1",
        topic_id="topic_1",
        task_id="task_foreign",
        task_name="Foreign task",
        task_type="test",
        workspace_meta={
            "created_by_user_id": "other-user",
            "updated_by_user_id": "other-user",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        },
    )
    storage.tasks[("module_1", "topic_1", "task_foreign")] = foreign_task

    _install_hosted_ctx(monkeypatch, tmp_path, storage_service=storage)
    _login(client)

    save_response = client.post(
        "/api/editor/task/module_1/topic_1/task_foreign",
        json=foreign_task,
    )
    assert save_response.status_code == 404
    assert save_response.get_json()["error"] == "task_not_found"

    delete_response = client.delete("/api/editor/task/module_1/topic_1/task_foreign")
    assert delete_response.status_code == 404
    assert delete_response.get_json()["error"] == "task_not_found"


def test_hosted_editor_catalog_returns_degraded_when_shadow_read_is_blocked(client, monkeypatch, tmp_path):
    storage = _EditorStorageStub()
    storage.fail_read_operation = "load_modules"
    _install_hosted_ctx(monkeypatch, tmp_path, storage_service=storage)
    _login(client)

    response = client.get("/api/editor/catalog")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["error"] == "hosted_shadow_read_blocked"
    assert payload["details"]["operation"] == "editor.catalog"


def test_hosted_editor_task_route_returns_degraded_when_shadow_read_is_blocked(client, monkeypatch, tmp_path):
    storage = _EditorStorageStub()
    storage.fail_read_operation = "load_task"
    _install_hosted_ctx(monkeypatch, tmp_path, storage_service=storage)
    _login(client)

    response = client.get("/api/editor/task/module_1/topic_1/task_1")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["error"] == "hosted_shadow_read_blocked"
    assert payload["details"]["operation"] == "editor.load_task"


def test_hosted_editor_bootstrap_and_save_return_degraded_when_shadow_write_is_blocked(client, monkeypatch, tmp_path):
    storage = _EditorStorageStub()
    storage.modules = [
        {
            "id": "module_1",
            "name": "Module 1",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
            "topics": [
                {
                    "id": "topic_1",
                    "name": "Topic 1",
                    "created_via": "manual_editor",
                    "content_scope": "shared_local",
                    "tasks": [],
                }
            ],
        }
    ]
    _install_hosted_ctx(monkeypatch, tmp_path, storage_service=storage)
    _login(client)

    storage.fail_write_operation = "build_task_draft_bootstrap"
    bootstrap_response = client.post(
        "/api/editor/task/bootstrap",
        json={
            "module_id": "module_1",
            "topic_id": "topic_1",
            "task_name": "Blocked draft",
            "task_type": "test",
        },
    )
    assert bootstrap_response.status_code == 503
    assert bootstrap_response.get_json()["error"] == "hosted_shadow_write_blocked"
    assert bootstrap_response.get_json()["details"]["operation"] == "build_task_draft_bootstrap"

    storage.fail_write_operation = "save_task"
    save_response = client.post(
        "/api/editor/task/module_1/topic_1/task_1",
        json={
            "task_data": {
                "type": "test",
                "name": "Blocked save",
                "meta": {"id": "task_1", "module": "module_1", "topic": "topic_1"},
                "content": {"questions": []},
            },
            "answer_key": {},
            "metadata": {"id": "task_1", "module": "module_1", "topic": "topic_1"},
        },
    )
    assert save_response.status_code == 503
    assert save_response.get_json()["error"] == "hosted_shadow_write_blocked"
    assert save_response.get_json()["details"]["operation"] == "save_task"
