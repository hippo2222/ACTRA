import copy
import io
import sys
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
from services.theory_service import TheoryNotFoundError  # type: ignore


class _DummyHostedUser:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.settings = {}


class _DummyHostedUserService:
    def get_user(self, user_id: str):
        clean = str(user_id or "").strip()
        return _DummyHostedUser(clean) if clean else None


class _WorkspaceLimitsStub:
    def assert_can_create_workspace_entity(self, user_id: str, entity_kind: str):
        return None

    def assert_entity_not_archived(self, user_id, entity_kind, entity_ref, *, action, scope=None):
        return {
            "workspace_access_state": "active",
            "is_premium_archived": False,
            "archived_item": None,
        }


class _HostedTheoryServiceStub:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.theories = {}
        self.history = {}
        self.fail_read_operation = None
        self.fail_write_operation = None
        self.snapshot_counter = 0

    def _assert_read_allowed(self, operation: str, reason: str):
        if self.fail_read_operation == operation:
            raise HostedShadowReadFallbackDisabledError(operation, reason=reason)

    def _assert_write_allowed(self, operation: str, reason: str):
        if self.fail_write_operation == operation:
            raise HostedShadowWriteFallbackDisabledError(operation, reason=reason)

    def _save_snapshot(self, theory_id: str, payload):
        self.snapshot_counter += 1
        snapshot_timestamp = f"20260419_000000_{self.snapshot_counter:06d}"
        snapshot = copy.deepcopy(payload)
        snapshot["_snapshot_timestamp"] = snapshot_timestamp
        self.history.setdefault(theory_id, []).insert(0, snapshot)
        return snapshot_timestamp

    def list_theories(self, query=None):
        self._assert_read_allowed("theories.list", "test_theories_list_blocked")
        q = str(query or "").strip().lower()
        items = []
        for item in self.theories.values():
            title = str(item.get("title") or "").lower()
            theory_id = str(item.get("id") or "").lower()
            if q and q not in title and q not in theory_id:
                continue
            items.append(copy.deepcopy(item))
        items.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        return items

    def get_theory(self, theory_id: str, include_delta: bool = True):
        self._assert_read_allowed("theories.get", "test_theory_get_blocked")
        payload = self.theories.get(str(theory_id or "").strip())
        if not isinstance(payload, dict):
            raise TheoryNotFoundError("theory_not_found")
        item = copy.deepcopy(payload)
        if not include_delta:
            item.pop("delta", None)
        return item

    def create_theory(self, payload):
        self._assert_write_allowed("theories.write", "test_theory_create_blocked")
        theory_id = str(payload.get("id") or "").strip()
        item = {
            "id": theory_id,
            "title": str(payload.get("title") or "").strip(),
            "delta": copy.deepcopy(payload.get("delta") or {"ops": [{"insert": "\n"}]}),
            "images": [],
            "created_by_user_id": payload.get("created_by_user_id"),
            "updated_by_user_id": payload.get("updated_by_user_id"),
            "created_via": payload.get("created_via") or "manual_editor",
            "content_scope": payload.get("content_scope") or "shared_local",
            "created_at": "2026-04-19T10:00:00",
            "updated_at": "2026-04-19T10:00:00",
            "version": "2026-04-19T10:00:00",
            "has_source_lineage": False,
            "source_lineage": None,
            "source_lineage_key": None,
        }
        self.theories[theory_id] = item
        return copy.deepcopy(item)

    def update_theory(self, theory_id: str, updates, expected_version=None):
        self._assert_write_allowed("theories.write", "test_theory_update_blocked")
        current = self.theories.get(str(theory_id or "").strip())
        if not isinstance(current, dict):
            raise TheoryNotFoundError("theory_not_found")
        self._save_snapshot(theory_id, current)
        current = copy.deepcopy(current)
        for field in ("title", "delta", "images", "created_by_user_id", "updated_by_user_id", "created_via", "content_scope"):
            if field in updates:
                current[field] = copy.deepcopy(updates.get(field))
        current["updated_at"] = "2026-04-19T10:15:00"
        current["version"] = "2026-04-19T10:15:00"
        self.theories[theory_id] = current
        return copy.deepcopy(current)

    def add_image(self, theory_id: str, upload):
        self._assert_write_allowed("theories.write", "test_theory_upload_blocked")
        current = self.theories.get(str(theory_id or "").strip())
        if not isinstance(current, dict):
            raise TheoryNotFoundError("theory_not_found")
        theory_dir = self.data_dir / "complexes" / "theories" / theory_id / "images"
        theory_dir.mkdir(parents=True, exist_ok=True)
        filename = Path(str(upload.filename or "image.png")).name
        target = theory_dir / filename
        upload.save(str(target))
        rel_path = target.relative_to(self.data_dir).as_posix()
        current = copy.deepcopy(current)
        current["images"] = list(current.get("images") or [])
        if rel_path not in current["images"]:
            current["images"].append(rel_path)
        current["updated_at"] = "2026-04-19T10:20:00"
        current["version"] = "2026-04-19T10:20:00"
        self.theories[theory_id] = current
        return {"path": rel_path, "version": current["version"]}

    def get_history(self, theory_id: str):
        self._assert_read_allowed("theories.history.read", "test_theory_history_blocked")
        if str(theory_id or "").strip() not in self.theories:
            raise TheoryNotFoundError("theory_not_found")
        return [
            {
                "_snapshot_timestamp": item["_snapshot_timestamp"],
                "id": item.get("id"),
                "title": item.get("title"),
                "version": item.get("version"),
                "updated_at": item.get("updated_at"),
            }
            for item in self.history.get(str(theory_id or "").strip(), [])
        ]

    def restore_from_history(self, theory_id: str, snapshot_timestamp: str, *, restored_by_user_id=None):
        self._assert_write_allowed("theories.history.restore", "test_theory_restore_blocked")
        clean_theory_id = str(theory_id or "").strip()
        for snapshot in self.history.get(clean_theory_id, []):
            if str(snapshot.get("_snapshot_timestamp") or "").strip() != str(snapshot_timestamp or "").strip():
                continue
            restored = copy.deepcopy(snapshot)
            restored.pop("_snapshot_timestamp", None)
            restored["updated_by_user_id"] = restored_by_user_id or restored.get("updated_by_user_id")
            restored["updated_at"] = "2026-04-19T10:30:00"
            restored["version"] = "2026-04-19T10:30:00"
            self.theories[clean_theory_id] = restored
            return copy.deepcopy(restored)
        raise TheoryNotFoundError("snapshot_not_found")

    def delete_theory(self, theory_id: str):
        self._assert_write_allowed("theories.write", "test_theory_delete_blocked")
        payload = self.theories.pop(str(theory_id or "").strip(), None)
        if not isinstance(payload, dict):
            raise TheoryNotFoundError("theory_not_found")
        self.history.pop(str(theory_id or "").strip(), None)
        return {"id": payload["id"], "title": payload["title"], "deleted_at": "2026-04-19T10:35:00"}


class _TheoryStorageStub:
    def __init__(self):
        self.fail_read_operation = None
        self.modules = [
            {
                "id": "module_1",
                "name": "Module 1",
                "topics": [
                    {
                        "id": "topic_1",
                        "name": "Topic 1",
                        "tasks": [{"id": "task_1", "name": "Task 1"}],
                    }
                ],
            }
        ]
        self.topic_theory_links = {("module_1", "topic_1"): {"theory_id": "th_hosted_editor"}}

    def load_modules(self):
        if self.fail_read_operation == "theory_center.modules.read":
            raise HostedShadowReadFallbackDisabledError(
                "theory_center.modules.read",
                reason="test_theory_center_modules_blocked",
            )
        return copy.deepcopy(self.modules)

    def get_topic_theory_link(self, module_id: str, topic_id: str):
        return copy.deepcopy(self.topic_theory_links.get((module_id, topic_id)))

    def get_module(self, module_id: str):
        for module in self.modules:
            if str(module.get("id") or "").strip() == module_id:
                return copy.deepcopy(module)
        return None

    def get_topic(self, module_id: str, topic_id: str):
        module = self.get_module(module_id)
        if not isinstance(module, dict):
            return None
        for topic in module.get("topics") or []:
            if str(topic.get("id") or "").strip() == topic_id:
                return copy.deepcopy(topic)
        return None


class _ComplexRecord:
    def __init__(self, payload):
        self._payload = copy.deepcopy(payload)

    def dict(self):
        return copy.deepcopy(self._payload)


class _TheoryComplexServiceStub:
    def __init__(self):
        self.items = [
            {
                "id": "cx_hosted_theory",
                "name": "Hosted theory complex",
                "tasks": ["module_1/topic_1/task_1"],
                "chains": [],
                "settings": {},
                "created_by_user_id": "theory-editor-user",
                "updated_by_user_id": "theory-editor-user",
                "created_via": "manual_editor",
                "content_scope": "shared_local",
                "created_at": "2026-04-19T09:00:00",
                "updated_at": "2026-04-19T09:00:00",
            }
        ]

    def get_all_complexes(self):
        return [_ComplexRecord(item) for item in self.items]


class _DummyCatalogService:
    def get_theory_library_entry(self, *args, **kwargs):
        raise ValueError("theory_library_entry_not_accessible")


class _DummyAssetService:
    def register_existing_file(self, abs_path, owner_user_id=None, visibility_scope=None, asset_kind=None, metadata=None):
        filename = Path(str(abs_path)).name
        return {
            "asset_id": f"asset_{filename}",
            "asset_url": f"/api/assets/asset_{filename}/content",
        }


def _install_hosted_ctx(monkeypatch, tmp_path, *, theory_service, storage_service):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_HOSTED_DEV_AUTH_BRIDGE", raising=False)
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)
    app_ctx = type(
        "Ctx",
        (),
        {
            "theory_service": theory_service,
            "storage_service": storage_service,
            "complex_service": _TheoryComplexServiceStub(),
            "catalog_service": _DummyCatalogService(),
            "asset_service": _DummyAssetService(),
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


def _login(client, user_id="theory-editor-user"):
    with client.session_transaction() as session:
        session[ctx_module._AUTH_USER_ID_SESSION_KEY] = user_id


@pytest.fixture
def client():
    with server.app.test_client() as c:
        yield c


def test_hosted_theory_editor_crud_flow_uses_single_hosted_truth(client, monkeypatch, tmp_path):
    theory_service = _HostedTheoryServiceStub(tmp_path)
    storage_service = _TheoryStorageStub()
    _install_hosted_ctx(monkeypatch, tmp_path, theory_service=theory_service, storage_service=storage_service)
    _login(client)

    create_response = client.post(
        "/api/theories",
        json={
            "id": "th_hosted_editor",
            "title": "Hosted theory",
            "delta": {"ops": [{"insert": "Hosted theory text\n"}]},
        },
    )
    assert create_response.status_code == 200
    assert create_response.get_json()["item"]["id"] == "th_hosted_editor"

    storage_service.topic_theory_links[("module_1", "topic_1")] = {"theory_id": "th_hosted_editor"}

    list_response = client.get("/api/theories")
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.get_json()["items"]] == ["th_hosted_editor"]

    get_response = client.get("/api/theories/th_hosted_editor")
    assert get_response.status_code == 200
    assert get_response.get_json()["item"]["delta"]["ops"][0]["insert"] == "Hosted theory text\n"

    update_response = client.put(
        "/api/theories/th_hosted_editor",
        json={
            "title": "Hosted theory updated",
            "delta": {"ops": [{"insert": "Hosted theory updated text\n"}]},
        },
    )
    assert update_response.status_code == 200
    assert update_response.get_json()["item"]["title"] == "Hosted theory updated"

    upload_response = client.post(
        "/api/theories/th_hosted_editor/upload-image",
        data={"file": (io.BytesIO(b"fake-png"), "theory.png")},
        content_type="multipart/form-data",
    )
    assert upload_response.status_code == 200
    upload_payload = upload_response.get_json()
    assert upload_payload["ok"] is True
    assert upload_payload["asset_id"] == "asset_theory.png"
    assert upload_payload["asset_url"] == "/api/assets/asset_theory.png/content"
    assert "path" not in upload_payload

    history_response = client.get("/api/theories/th_hosted_editor/history")
    assert history_response.status_code == 200
    history = history_response.get_json()["history"]
    assert history

    restore_response = client.post(
        f"/api/theories/th_hosted_editor/restore/{history[0]['_snapshot_timestamp']}"
    )
    assert restore_response.status_code == 200
    assert restore_response.get_json()["item"]["title"] == "Hosted theory"

    overview_response = client.get("/api/theory-center/overview")
    assert overview_response.status_code == 200
    overview_payload = overview_response.get_json()
    assert any(item["id"] == "th_hosted_editor" for item in overview_payload["theories"])
    complex_row = next(item for item in overview_payload["complexes"] if item["complex_id"] == "cx_hosted_theory")
    assert "th_hosted_editor" in complex_row["theory_ids"]

    storage_service.topic_theory_links.pop(("module_1", "topic_1"), None)
    delete_response = client.delete("/api/theories/th_hosted_editor")
    assert delete_response.status_code == 200
    assert delete_response.get_json()["item"]["id"] == "th_hosted_editor"

    missing_response = client.get("/api/theories/th_hosted_editor")
    assert missing_response.status_code == 404
    assert missing_response.get_json()["error"] == "theory_not_found"


def test_hosted_theory_editor_hides_foreign_owned_theories_from_list_get_and_center(client, monkeypatch, tmp_path):
    theory_service = _HostedTheoryServiceStub(tmp_path)
    theory_service.theories["th_foreign"] = {
        "id": "th_foreign",
        "title": "Foreign theory",
        "delta": {"ops": [{"insert": "Foreign\n"}]},
        "images": [],
        "created_by_user_id": "other-user",
        "updated_by_user_id": "other-user",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
        "created_at": "2026-04-19T08:00:00",
        "updated_at": "2026-04-19T08:00:00",
        "version": "2026-04-19T08:00:00",
        "has_source_lineage": False,
        "source_lineage": None,
        "source_lineage_key": None,
    }
    storage_service = _TheoryStorageStub()
    storage_service.topic_theory_links[("module_1", "topic_1")] = {"theory_id": "th_foreign"}
    _install_hosted_ctx(monkeypatch, tmp_path, theory_service=theory_service, storage_service=storage_service)
    _login(client)

    list_response = client.get("/api/theories")
    assert list_response.status_code == 200
    assert list_response.get_json()["items"] == []

    get_response = client.get("/api/theories/th_foreign")
    assert get_response.status_code == 404
    assert get_response.get_json()["error"] == "theory_not_found"

    overview_response = client.get("/api/theory-center/overview")
    assert overview_response.status_code == 200
    overview_payload = overview_response.get_json()
    assert overview_payload["theories"] == []
    assert overview_payload["topics"] == []


def test_hosted_theory_center_hides_foreign_topics_from_overview(client, monkeypatch, tmp_path):
    theory_service = _HostedTheoryServiceStub(tmp_path)
    theory_service.theories["th_owned"] = {
        "id": "th_owned",
        "title": "Owned theory",
        "delta": {"ops": [{"insert": "Owned\n"}]},
        "images": [],
        "created_by_user_id": "theory-editor-user",
        "updated_by_user_id": "theory-editor-user",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
        "created_at": "2026-04-19T08:00:00",
        "updated_at": "2026-04-19T08:00:00",
        "version": "2026-04-19T08:00:00",
        "has_source_lineage": False,
        "source_lineage": None,
        "source_lineage_key": None,
    }
    theory_service.theories["th_foreign"] = {
        "id": "th_foreign",
        "title": "Foreign theory",
        "delta": {"ops": [{"insert": "Foreign\n"}]},
        "images": [],
        "created_by_user_id": "other-user",
        "updated_by_user_id": "other-user",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
        "created_at": "2026-04-19T08:05:00",
        "updated_at": "2026-04-19T08:05:00",
        "version": "2026-04-19T08:05:00",
        "has_source_lineage": False,
        "source_lineage": None,
        "source_lineage_key": None,
    }
    storage_service = _TheoryStorageStub()
    storage_service.modules = [
        {
            "id": "module_owned",
            "name": "Owned module",
            "created_by_user_id": "theory-editor-user",
            "updated_by_user_id": "theory-editor-user",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
            "topics": [
                {
                    "id": "topic_owned",
                    "name": "Owned topic",
                    "created_by_user_id": "theory-editor-user",
                    "updated_by_user_id": "theory-editor-user",
                    "created_via": "manual_editor",
                    "content_scope": "shared_local",
                    "tasks": [],
                }
            ],
        },
        {
            "id": "module_foreign",
            "name": "Foreign module",
            "created_by_user_id": "other-user",
            "updated_by_user_id": "other-user",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
            "topics": [
                {
                    "id": "topic_foreign",
                    "name": "Foreign topic",
                    "created_by_user_id": "other-user",
                    "updated_by_user_id": "other-user",
                    "created_via": "manual_editor",
                    "content_scope": "shared_local",
                    "tasks": [],
                }
            ],
        },
    ]
    storage_service.topic_theory_links = {
        ("module_owned", "topic_owned"): {"theory_id": "th_owned"},
        ("module_foreign", "topic_foreign"): {"theory_id": "th_foreign"},
    }
    _install_hosted_ctx(monkeypatch, tmp_path, theory_service=theory_service, storage_service=storage_service)
    _login(client)

    overview_response = client.get("/api/theory-center/overview")
    assert overview_response.status_code == 200
    overview_payload = overview_response.get_json()

    assert [item["topic_id"] for item in overview_payload["topics"]] == ["topic_owned"]
    assert overview_payload["filters"]["modules"] == [{"id": "module_owned", "name": "Owned module"}]
    assert [item["id"] for item in overview_payload["theories"]] == ["th_owned"]


def test_hosted_theory_editor_returns_degraded_when_shadow_reads_are_blocked(client, monkeypatch, tmp_path):
    theory_service = _HostedTheoryServiceStub(tmp_path)
    theory_service.theories["th_hosted_editor"] = {
        "id": "th_hosted_editor",
        "title": "Hosted theory",
        "delta": {"ops": [{"insert": "Hosted theory text\n"}]},
        "images": [],
        "created_by_user_id": "theory-editor-user",
        "updated_by_user_id": "theory-editor-user",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
        "created_at": "2026-04-19T10:00:00",
        "updated_at": "2026-04-19T10:00:00",
        "version": "2026-04-19T10:00:00",
        "has_source_lineage": False,
        "source_lineage": None,
        "source_lineage_key": None,
    }
    storage_service = _TheoryStorageStub()
    _install_hosted_ctx(monkeypatch, tmp_path, theory_service=theory_service, storage_service=storage_service)
    _login(client)

    theory_service.fail_read_operation = "theories.list"
    list_response = client.get("/api/theories")
    assert list_response.status_code == 503
    assert list_response.get_json()["error"] == "hosted_shadow_read_blocked"
    assert list_response.get_json()["details"]["operation"] == "theories.list"

    theory_service.fail_read_operation = "theories.get"
    get_response = client.get("/api/theories/th_hosted_editor")
    assert get_response.status_code == 503
    assert get_response.get_json()["error"] == "hosted_shadow_read_blocked"
    assert get_response.get_json()["details"]["operation"] == "theories.get"

    theory_service.fail_read_operation = "theories.history.read"
    history_response = client.get("/api/theories/th_hosted_editor/history")
    assert history_response.status_code == 503
    assert history_response.get_json()["error"] == "hosted_shadow_read_blocked"
    assert history_response.get_json()["details"]["operation"] == "theories.history.read"

    theory_service.fail_read_operation = None
    storage_service.fail_read_operation = "theory_center.modules.read"
    overview_response = client.get("/api/theory-center/overview")
    assert overview_response.status_code == 503
    assert overview_response.get_json()["error"] == "hosted_shadow_read_blocked"
    assert overview_response.get_json()["details"]["operation"] == "theory_center.modules.read"


def test_hosted_theory_editor_returns_degraded_when_shadow_writes_are_blocked(client, monkeypatch, tmp_path):
    theory_service = _HostedTheoryServiceStub(tmp_path)
    theory_service.theories["th_hosted_editor"] = {
        "id": "th_hosted_editor",
        "title": "Hosted theory",
        "delta": {"ops": [{"insert": "Hosted theory text\n"}]},
        "images": [],
        "created_by_user_id": "theory-editor-user",
        "updated_by_user_id": "theory-editor-user",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
        "created_at": "2026-04-19T10:00:00",
        "updated_at": "2026-04-19T10:00:00",
        "version": "2026-04-19T10:00:00",
        "has_source_lineage": False,
        "source_lineage": None,
        "source_lineage_key": None,
    }
    theory_service._save_snapshot("th_hosted_editor", theory_service.theories["th_hosted_editor"])
    storage_service = _TheoryStorageStub()
    _install_hosted_ctx(monkeypatch, tmp_path, theory_service=theory_service, storage_service=storage_service)
    _login(client)

    theory_service.fail_write_operation = "theories.write"
    create_response = client.post(
        "/api/theories",
        json={
            "id": "th_blocked",
            "title": "Blocked theory",
            "delta": {"ops": [{"insert": "Blocked\n"}]},
        },
    )
    assert create_response.status_code == 503
    assert create_response.get_json()["error"] == "hosted_shadow_write_blocked"
    assert create_response.get_json()["details"]["operation"] == "theories.write"

    update_response = client.put(
        "/api/theories/th_hosted_editor",
        json={"title": "Blocked update"},
    )
    assert update_response.status_code == 503
    assert update_response.get_json()["error"] == "hosted_shadow_write_blocked"
    assert update_response.get_json()["details"]["operation"] == "theories.write"

    upload_response = client.post(
        "/api/theories/th_hosted_editor/upload-image",
        data={"file": (io.BytesIO(b"fake-png"), "blocked.png")},
        content_type="multipart/form-data",
    )
    assert upload_response.status_code == 503
    assert upload_response.get_json()["error"] == "hosted_shadow_write_blocked"
    assert upload_response.get_json()["details"]["operation"] == "theories.write"

    theory_service.fail_write_operation = "theories.history.restore"
    restore_response = client.post("/api/theories/th_hosted_editor/restore/20260419_000000_000001")
    assert restore_response.status_code == 503
    assert restore_response.get_json()["error"] == "hosted_shadow_write_blocked"
    assert restore_response.get_json()["details"]["operation"] == "theories.history.restore"
