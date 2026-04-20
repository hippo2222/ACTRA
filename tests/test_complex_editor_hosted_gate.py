import copy
import sys
from datetime import datetime
from pathlib import Path

import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

import server  # type: ignore
import routes._context as ctx_module  # type: ignore
from services.hosted_shadow_fallback import (  # type: ignore
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


class _ComplexRecord:
    def __init__(self, payload):
        self._payload = copy.deepcopy(payload)

    def dict(self):
        return copy.deepcopy(self._payload)

    @property
    def id(self):
        return str(self._payload.get("id") or "").strip()


class _StorageStub:
    def __init__(self):
        self.tasks = {
            ("module_a", "topic_a", "task_1"): {
                "task_data": {
                    "type": "test",
                    "name": "Task 1",
                    "content": {"questions": []},
                },
                "metadata": {
                    "id": "task_1",
                    "module": "module_a",
                    "topic": "topic_a",
                },
            }
        }
        self.modules = {"module_a": {"id": "module_a", "name": "Module A"}}
        self.topics = {("module_a", "topic_a"): {"id": "topic_a", "name": "Topic A"}}

    def load_task(self, module_id, topic_id, task_id):
        payload = self.tasks.get((module_id, topic_id, task_id))
        return copy.deepcopy(payload) if payload is not None else None

    def get_module(self, module_id):
        payload = self.modules.get(module_id)
        return copy.deepcopy(payload) if payload is not None else None

    def get_topic(self, module_id, topic_id):
        payload = self.topics.get((module_id, topic_id))
        return copy.deepcopy(payload) if payload is not None else None

    def get_topic_theory_link(self, module_id, topic_id):
        return None


class _CatalogServiceStub:
    def __init__(self, complex_service):
        self.complex_service = complex_service

    def publish_complex(self, complex_id, requested_by_user_id=None, catalog_visibility=None):
        if self.complex_service.fail_write_operation == "publish_complex":
            raise HostedShadowWriteFallbackDisabledError(
                "catalog.publish_complex",
                reason="test_complex_publish_blocked",
            )
        item = self.complex_service.get_complex(complex_id)
        if item is None:
            raise ValueError("complex_not_found")
        return {
            "ok": True,
            "item": {
                "item_id": f"catalog_{complex_id}",
                "workspace_complex_id": complex_id,
                "catalog_visibility": str(catalog_visibility or "private"),
                "owner_user_id": str(requested_by_user_id or "").strip() or None,
            },
        }


class _HostedComplexServiceStub:
    def __init__(self):
        self.complexes = {}
        self.history = {}
        self.history_counter = 0
        self.fail_read_operation = None
        self.fail_write_operation = None

    def _next_snapshot_timestamp(self):
        self.history_counter += 1
        return f"20260419_000000_{self.history_counter:06d}"

    def _record(self, payload):
        return _ComplexRecord(payload)

    def _serialize(self, payload):
        return copy.deepcopy(payload)

    def _assert_read_allowed(self, operation, reason):
        if self.fail_read_operation == operation:
            raise HostedShadowReadFallbackDisabledError(operation, reason=reason)

    def _assert_write_allowed(self, operation, reason):
        if self.fail_write_operation == operation:
            raise HostedShadowWriteFallbackDisabledError(operation, reason=reason)

    def _save_snapshot(self, complex_id, payload, *, snapshot_kind="manual"):
        snapshot = self._serialize(payload)
        snapshot["_history_kind"] = snapshot_kind
        snapshot["_history_saved_at"] = self._next_snapshot_timestamp()
        snapshot["_snapshot_timestamp"] = snapshot["_history_saved_at"]
        self.history.setdefault(complex_id, []).insert(0, snapshot)
        return snapshot

    def get_all_complexes(self):
        self._assert_read_allowed("complexes.load", "test_complex_list_blocked")
        return [self._record(payload) for payload in self.complexes.values()]

    def get_complex(self, complex_id):
        self._assert_read_allowed("complexes.load", "test_complex_get_blocked")
        payload = self.complexes.get(str(complex_id or "").strip())
        return self._record(payload) if isinstance(payload, dict) else None

    def create_complex(self, payload):
        self._assert_write_allowed("complexes.write", "test_complex_create_blocked")
        normalized = self._serialize(payload)
        complex_id = str(normalized.get("id") or "").strip()
        now = datetime.utcnow()
        normalized.setdefault("created_by_user_id", "complex-editor-user")
        normalized.setdefault("updated_by_user_id", "complex-editor-user")
        normalized.setdefault("created_via", "manual_editor")
        normalized.setdefault("content_scope", "shared_local")
        normalized.setdefault("created_at", now)
        normalized["updated_at"] = now
        self.complexes[complex_id] = normalized
        return self._record(normalized)

    def update_complex(self, complex_id, updates, expected_version=None):
        self._assert_write_allowed("complexes.write", "test_complex_update_blocked")
        existing = self.complexes.get(str(complex_id or "").strip())
        if not isinstance(existing, dict):
            raise ValueError("complex_not_found")
        self._save_snapshot(complex_id, existing, snapshot_kind="manual")
        existing.update(self._serialize(updates))
        existing["updated_at"] = datetime.utcnow()
        self.complexes[complex_id] = existing
        return self._record(existing)

    def delete_complex(self, complex_id):
        self._assert_write_allowed("complexes.write", "test_complex_delete_blocked")
        return self.complexes.pop(str(complex_id or "").strip(), None) is not None

    def save_autosave_snapshot(self, complex_id, snapshot_payload):
        self._assert_write_allowed("complexes.autosave.write", "test_complex_autosave_write_blocked")
        existing = self.complexes.get(str(complex_id or "").strip())
        if not isinstance(existing, dict):
            raise ValueError("complex_not_found")
        snapshot = self._serialize(existing)
        snapshot.update(self._serialize(snapshot_payload if isinstance(snapshot_payload, dict) else {}))
        return self._save_snapshot(complex_id, snapshot, snapshot_kind="autosave")

    def get_latest_autosave_snapshot(self, complex_id):
        self._assert_read_allowed("complexes.autosave.read", "test_complex_autosave_read_blocked")
        snapshots = self.history.get(str(complex_id or "").strip(), [])
        for item in snapshots:
            if str(item.get("_history_kind") or "").strip().lower() == "autosave":
                return self._serialize(item)
        return None

    def delete_autosave_snapshots(self, complex_id):
        self._assert_write_allowed("complexes.autosave.delete", "test_complex_autosave_delete_blocked")
        clean_complex_id = str(complex_id or "").strip()
        snapshots = self.history.get(clean_complex_id, [])
        kept = [
            item for item in snapshots
            if str(item.get("_history_kind") or "").strip().lower() != "autosave"
        ]
        deleted = len(snapshots) - len(kept)
        self.history[clean_complex_id] = kept
        return deleted

    def get_complex_history(self, complex_id):
        self._assert_read_allowed("complexes.history.read", "test_complex_history_read_blocked")
        return [self._serialize(item) for item in self.history.get(str(complex_id or "").strip(), [])]

    def restore_from_history(self, complex_id, snapshot_timestamp):
        self._assert_write_allowed("complexes.history.restore", "test_complex_restore_blocked")
        clean_complex_id = str(complex_id or "").strip()
        snapshots = self.history.get(clean_complex_id, [])
        for item in snapshots:
            if str(item.get("_snapshot_timestamp") or "").strip() != str(snapshot_timestamp or "").strip():
                continue
            restored = self._serialize(item)
            restored.pop("_snapshot_timestamp", None)
            restored.pop("_history_kind", None)
            restored.pop("_history_saved_at", None)
            restored["updated_at"] = datetime.utcnow()
            self.complexes[clean_complex_id] = restored
            return self._record(restored)
        raise ValueError("snapshot_not_found")


def _install_hosted_ctx(monkeypatch, tmp_path, *, complex_service):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_HOSTED_DEV_AUTH_BRIDGE", raising=False)
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)
    app_ctx = type(
        "Ctx",
        (),
        {
            "complex_service": complex_service,
            "storage_service": _StorageStub(),
            "catalog_service": _CatalogServiceStub(complex_service),
            "theory_service": object(),
            "user_service": _DummyHostedUserService(),
            "session_api": object(),
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)
    monkeypatch.setattr(ctx_module, "_extra", dict(getattr(ctx_module, "_extra", {})))
    return app_ctx


def _login(client, user_id="complex-editor-user"):
    with client.session_transaction() as session:
        session[ctx_module._AUTH_USER_ID_SESSION_KEY] = user_id


@pytest.fixture
def client():
    with server.app.test_client() as c:
        yield c


def test_hosted_complex_editor_crud_flow_uses_single_hosted_truth(client, monkeypatch, tmp_path):
    complex_service = _HostedComplexServiceStub()
    _install_hosted_ctx(monkeypatch, tmp_path, complex_service=complex_service)
    _login(client)

    create_response = client.post(
        "/api/complexes",
        json={
            "id": "cx_hosted_editor",
            "name": "Hosted complex",
            "description": "Hosted description",
            "tasks": ["module_a/topic_a/task_1"],
            "chains": [],
            "settings": {},
        },
    )
    assert create_response.status_code == 200
    assert create_response.get_json()["item"]["id"] == "cx_hosted_editor"

    list_response = client.get("/api/complexes")
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.get_json()["items"]] == ["cx_hosted_editor"]

    open_response = client.get("/api/complexes/cx_hosted_editor")
    assert open_response.status_code == 200
    assert open_response.get_json()["item"]["name"] == "Hosted complex"

    update_response = client.put(
        "/api/complexes/cx_hosted_editor",
        json={
            "name": "Hosted complex updated",
            "description": "Hosted description v2",
            "tasks": ["module_a/topic_a/task_1"],
            "chains": [],
            "settings": {},
        },
    )
    assert update_response.status_code == 200
    assert update_response.get_json()["item"]["name"] == "Hosted complex updated"

    sync_response = client.post(
        "/api/complexes/cx_hosted_editor/sync-theory-from-topics",
        json={"dry_run": True, "propagation_mode": "safe"},
    )
    assert sync_response.status_code == 200
    assert sync_response.get_json()["summary"]["complex_id"] == "cx_hosted_editor"

    autosave_response = client.post(
        "/api/complexes/cx_hosted_editor/autosave",
        json={"description": "Draft description"},
    )
    assert autosave_response.status_code == 200
    assert autosave_response.get_json()["item"]["description"] == "Draft description"

    latest_autosave_response = client.get("/api/complexes/cx_hosted_editor/autosave")
    assert latest_autosave_response.status_code == 200
    assert latest_autosave_response.get_json()["item"]["description"] == "Draft description"

    history_response = client.get("/api/complexes/cx_hosted_editor/history")
    assert history_response.status_code == 200
    history_items = history_response.get_json()["history"]
    assert history_items
    manual_snapshot = next(
        item for item in history_items if str(item.get("_history_kind") or "").strip().lower() != "autosave"
    )

    restore_response = client.post(
        f"/api/complexes/cx_hosted_editor/restore/{manual_snapshot['_snapshot_timestamp']}",
    )
    assert restore_response.status_code == 200
    assert restore_response.get_json()["item"]["name"] == "Hosted complex"

    publish_response = client.post(
        "/api/catalog/complexes/cx_hosted_editor/publish",
        json={"catalog_visibility": "public"},
    )
    assert publish_response.status_code == 200
    assert publish_response.get_json()["item"]["workspace_complex_id"] == "cx_hosted_editor"

    delete_autosave_response = client.delete("/api/complexes/cx_hosted_editor/autosave")
    assert delete_autosave_response.status_code == 200
    assert delete_autosave_response.get_json()["deleted_count"] == 1

    delete_response = client.delete("/api/complexes/cx_hosted_editor")
    assert delete_response.status_code == 200
    assert delete_response.get_json()["ok"] is True

    missing_response = client.get("/api/complexes/cx_hosted_editor")
    assert missing_response.status_code == 404
    assert missing_response.get_json()["error"] == "complex_not_found"


def test_hosted_complex_editor_hides_foreign_owned_complexes(client, monkeypatch, tmp_path):
    complex_service = _HostedComplexServiceStub()
    foreign_payload = {
        "id": "cx_foreign",
        "name": "Foreign complex",
        "description": "Other owner",
        "tasks": ["module_a/topic_a/task_1"],
        "chains": [],
        "settings": {},
        "created_by_user_id": "other-user",
        "updated_by_user_id": "other-user",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    complex_service.complexes["cx_foreign"] = copy.deepcopy(foreign_payload)
    _install_hosted_ctx(monkeypatch, tmp_path, complex_service=complex_service)
    _login(client)

    list_response = client.get("/api/complexes")
    assert list_response.status_code == 200
    assert list_response.get_json()["items"] == []

    open_response = client.get("/api/complexes/cx_foreign")
    assert open_response.status_code == 404
    assert open_response.get_json()["error"] == "complex_not_found"


def test_hosted_complex_editor_returns_degraded_when_shadow_reads_are_blocked(client, monkeypatch, tmp_path):
    complex_service = _HostedComplexServiceStub()
    complex_service.fail_read_operation = "complexes.load"
    _install_hosted_ctx(monkeypatch, tmp_path, complex_service=complex_service)
    _login(client)

    list_response = client.get("/api/complexes")
    assert list_response.status_code == 503
    assert list_response.get_json()["error"] == "hosted_shadow_read_blocked"

    open_response = client.get("/api/complexes/cx_missing")
    assert open_response.status_code == 503
    assert open_response.get_json()["error"] == "hosted_shadow_read_blocked"


def test_hosted_complex_editor_autosave_and_history_reads_return_degraded_when_blocked(client, monkeypatch, tmp_path):
    complex_service = _HostedComplexServiceStub()
    complex_service.complexes["cx_hosted_editor"] = {
        "id": "cx_hosted_editor",
        "name": "Hosted complex",
        "description": "Hosted description",
        "tasks": ["module_a/topic_a/task_1"],
        "chains": [],
        "settings": {},
        "created_by_user_id": "complex-editor-user",
        "updated_by_user_id": "complex-editor-user",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    complex_service.fail_read_operation = "complexes.autosave.read"
    _install_hosted_ctx(monkeypatch, tmp_path, complex_service=complex_service)
    _login(client)

    autosave_response = client.get("/api/complexes/cx_hosted_editor/autosave")
    assert autosave_response.status_code == 503
    assert autosave_response.get_json()["error"] == "hosted_shadow_read_blocked"

    complex_service.fail_read_operation = "complexes.history.read"
    history_response = client.get("/api/complexes/cx_hosted_editor/history")
    assert history_response.status_code == 503
    assert history_response.get_json()["error"] == "hosted_shadow_read_blocked"


def test_hosted_complex_editor_returns_degraded_when_shadow_writes_are_blocked(client, monkeypatch, tmp_path):
    complex_service = _HostedComplexServiceStub()
    _install_hosted_ctx(monkeypatch, tmp_path, complex_service=complex_service)
    _login(client)

    complex_service.fail_write_operation = "complexes.write"
    create_response = client.post(
        "/api/complexes",
        json={
            "id": "cx_hosted_editor",
            "name": "Hosted complex",
            "description": "Hosted description",
            "tasks": ["module_a/topic_a/task_1"],
            "chains": [],
            "settings": {},
        },
    )
    assert create_response.status_code == 503
    assert create_response.get_json()["error"] == "hosted_shadow_write_blocked"

    complex_service.complexes["cx_hosted_editor"] = {
        "id": "cx_hosted_editor",
        "name": "Hosted complex",
        "description": "Hosted description",
        "tasks": ["module_a/topic_a/task_1"],
        "chains": [],
        "settings": {},
        "created_by_user_id": "complex-editor-user",
        "updated_by_user_id": "complex-editor-user",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }

    complex_service.fail_write_operation = "complexes.autosave.write"
    autosave_response = client.post("/api/complexes/cx_hosted_editor/autosave", json={"description": "Draft"})
    assert autosave_response.status_code == 503
    assert autosave_response.get_json()["error"] == "hosted_shadow_write_blocked"

    complex_service.fail_write_operation = "publish_complex"
    publish_response = client.post(
        "/api/catalog/complexes/cx_hosted_editor/publish",
        json={"catalog_visibility": "public"},
    )
    assert publish_response.status_code == 503
    assert publish_response.get_json()["error"] == "hosted_shadow_write_blocked"
