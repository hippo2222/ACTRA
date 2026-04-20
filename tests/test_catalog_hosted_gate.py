import sys
from pathlib import Path

import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

import server  # type: ignore
import routes._context as ctx_module  # type: ignore
from persistence.runtime import PersistenceRuntimeSettings
from services.hosted_catalog_service import HostedCatalogService
from services.hosted_shadow_fallback import (
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)


class _FakeComplex:
    def __init__(self, payload):
        self._payload = dict(payload)

    def dict(self):
        return dict(self._payload)


class _FakeComplexService:
    def __init__(self, payload):
        self._payload = dict(payload)

    def get_complex(self, complex_id):
        if str(complex_id or "").strip() != str(self._payload.get("id") or "").strip():
            return None
        return _FakeComplex(self._payload)


class _FakeTheoryService:
    def __init__(self, payload):
        self._payload = dict(payload)

    def get_theory(self, theory_id, include_delta=True):
        if str(theory_id or "").strip() != str(self._payload.get("id") or "").strip():
            return None
        return dict(self._payload)


class _FakeStorageService:
    def __init__(self):
        self.modules = {"module-a": {"id": "module-a", "name": "Module A"}}
        self.topics = {("module-a", "topic-a"): {"id": "topic-a", "module_id": "module-a", "name": "Topic A"}}
        self.tasks = {
            ("module-a", "topic-a", "task-a"): {
                "id": "task-a",
                "module_id": "module-a",
                "topic_id": "topic-a",
                "task_data": {
                    "type": "test",
                    "name": "Task A",
                    "prompt": "Hosted task body",
                },
            }
        }

    def get_module(self, module_id):
        payload = self.modules.get(str(module_id or "").strip())
        return dict(payload) if isinstance(payload, dict) else None

    def get_topic(self, module_id, topic_id):
        payload = self.topics.get((str(module_id or "").strip(), str(topic_id or "").strip()))
        return dict(payload) if isinstance(payload, dict) else None

    def load_task(self, module_id, topic_id, task_id):
        payload = self.tasks.get(
            (str(module_id or "").strip(), str(topic_id or "").strip(), str(task_id or "").strip())
        )
        return dict(payload) if isinstance(payload, dict) else None

    def get_topic_theory_link(self, module_id, topic_id):
        return None


class _InMemoryHostedCatalogRepository:
    def __init__(self):
        self.items = {}
        self.versions = {}
        self.theory_entries = {}
        self.complex_entries = {}

    def ensure_schema(self):
        return None

    def list_items(self):
        return [dict(value) for value in self.items.values()]

    def get_item(self, item_id):
        payload = self.items.get(str(item_id or "").strip())
        return dict(payload) if isinstance(payload, dict) else None

    def get_item_by_source_workspace_key(self, source_workspace_key):
        clean_key = str(source_workspace_key or "").strip()
        for payload in self.items.values():
            if str(payload.get("source_workspace_key") or "").strip() == clean_key:
                return dict(payload)
        return None

    def get_item_by_access_code(self, access_code):
        clean_code = str(access_code or "").strip()
        for payload in self.items.values():
            if str(payload.get("access_code") or "").strip() == clean_code:
                return dict(payload)
        return None

    def upsert_item(self, payload):
        normalized = dict(payload)
        self.items[str(normalized.get("item_id") or "").strip()] = normalized

    def list_versions(self, item_id):
        clean_item_id = str(item_id or "").strip()
        return [
            dict(payload)
            for payload in self.versions.values()
            if str(payload.get("item_id") or "").strip() == clean_item_id
        ]

    def get_version(self, item_id, version_id):
        payload = self.versions.get(str(version_id or "").strip())
        if not isinstance(payload, dict):
            return None
        if str(payload.get("item_id") or "").strip() != str(item_id or "").strip():
            return None
        return dict(payload)

    def insert_version(self, payload):
        normalized = dict(payload)
        self.versions[str(normalized.get("version_id") or "").strip()] = normalized

    def list_theory_library_entries(self, user_id):
        clean_user_id = str(user_id or "").strip()
        return [
            dict(payload)
            for payload in self.theory_entries.values()
            if str(payload.get("user_id") or "").strip() == clean_user_id
        ]

    def get_theory_library_entry(self, library_entry_id):
        payload = self.theory_entries.get(str(library_entry_id or "").strip())
        return dict(payload) if isinstance(payload, dict) else None

    def get_theory_library_entry_by_user_item(self, user_id, catalog_item_id):
        clean_user_id = str(user_id or "").strip()
        clean_item_id = str(catalog_item_id or "").strip()
        for payload in self.theory_entries.values():
            if (
                str(payload.get("user_id") or "").strip() == clean_user_id
                and str(payload.get("catalog_item_id") or "").strip() == clean_item_id
            ):
                return dict(payload)
        return None

    def upsert_theory_library_entry(self, payload):
        normalized = dict(payload)
        self.theory_entries[str(normalized.get("library_entry_id") or "").strip()] = normalized

    def delete_theory_library_entry(self, library_entry_id):
        self.theory_entries.pop(str(library_entry_id or "").strip(), None)

    def list_complex_library_entries(self, user_id):
        clean_user_id = str(user_id or "").strip()
        return [
            dict(payload)
            for payload in self.complex_entries.values()
            if str(payload.get("user_id") or "").strip() == clean_user_id
        ]

    def get_complex_library_entry(self, library_entry_id):
        payload = self.complex_entries.get(str(library_entry_id or "").strip())
        return dict(payload) if isinstance(payload, dict) else None

    def get_complex_library_entry_by_user_item(self, user_id, catalog_item_id):
        clean_user_id = str(user_id or "").strip()
        clean_item_id = str(catalog_item_id or "").strip()
        for payload in self.complex_entries.values():
            if (
                str(payload.get("user_id") or "").strip() == clean_user_id
                and str(payload.get("catalog_item_id") or "").strip() == clean_item_id
            ):
                return dict(payload)
        return None

    def upsert_complex_library_entry(self, payload):
        normalized = dict(payload)
        self.complex_entries[str(normalized.get("library_entry_id") or "").strip()] = normalized

    def delete_complex_library_entry(self, library_entry_id):
        self.complex_entries.pop(str(library_entry_id or "").strip(), None)


class _DummyHostedUserService:
    def get_user(self, user_id: str):
        clean_user_id = str(user_id or "").strip()
        if not clean_user_id:
            return None
        return type("User", (), {"user_id": clean_user_id})()


def _login_hosted_user(client, user_id: str) -> None:
    with client.session_transaction() as session:
        session[ctx_module._AUTH_USER_ID_SESSION_KEY] = user_id


def _logout_hosted_user(client) -> None:
    with client.session_transaction() as session:
        session.pop(ctx_module._AUTH_USER_ID_SESSION_KEY, None)


def _build_settings(tmp_path: Path) -> PersistenceRuntimeSettings:
    return PersistenceRuntimeSettings(
        runtime_mode="hosted_web",
        data_root=tmp_path,
        state_root=tmp_path / "runtime_state",
        postgres_dsn="postgresql://catalog-gate",
        s3_endpoint="",
        s3_bucket="",
        s3_access_key="",
        s3_secret_key="",
        hosted_contract_errors=[],
    )


def _build_catalog_service(tmp_path: Path) -> HostedCatalogService:
    theory_payload = {
        "id": "theory_alpha",
        "title": "Theory Alpha",
        "delta": {"ops": [{"insert": "Hosted theory body\n"}]},
        "created_by_user_id": "author",
        "updated_by_user_id": "author",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }
    complex_payload = {
        "id": "complex_alpha",
        "name": "Complex Alpha",
        "description": "Hosted complex",
        "tasks": ["module-a/topic-a/task-a"],
        "chains": [],
        "theory_link": None,
        "created_by_user_id": "author",
        "updated_by_user_id": "author",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }
    service = HostedCatalogService(
        data_dir=str(tmp_path),
        complex_service=_FakeComplexService(complex_payload),
        theory_service=_FakeTheoryService(theory_payload),
        storage_service=_FakeStorageService(),
        persistence_settings=_build_settings(tmp_path),
    )
    service.repository = _InMemoryHostedCatalogRepository()
    return service


def test_catalog_publish_library_visibility_flow_has_hosted_route_contract(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    catalog_service = _build_catalog_service(tmp_path)
    app_ctx = type(
        "Ctx",
        (),
        {
            "catalog_service": catalog_service,
            "user_service": _DummyHostedUserService(),
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)

    with server.app.test_client() as client:
        _login_hosted_user(client, "author")
        theory_publish = client.post(
            "/api/catalog/theories/theory_alpha/publish",
            json={"catalog_visibility": "public"},
        )
        assert theory_publish.status_code == 200
        theory_publish_payload = theory_publish.get_json()
        theory_item_id = theory_publish_payload["item"]["item_id"]
        theory_version_id = theory_publish_payload["version"]["version_id"]
        assert theory_publish_payload["route_contract"]["namespace"] == "public_catalog"
        assert theory_publish_payload["route_contract"]["mode"] == "publish_theory"

        complex_publish = client.post(
            "/api/catalog/complexes/complex_alpha/publish",
            json={"catalog_visibility": "public"},
        )
        assert complex_publish.status_code == 200
        complex_publish_payload = complex_publish.get_json()
        assert complex_publish_payload["route_contract"]["mode"] == "publish_complex"

        _logout_hosted_user(client)
        list_response = client.get("/api/catalog/items")
        assert list_response.status_code == 200
        list_payload = list_response.get_json()
        assert list_payload["count"] == 2
        assert {item["item_id"] for item in list_payload["items"]} == {
            theory_item_id,
            complex_publish_payload["item"]["item_id"],
        }

        detail_response = client.get(f"/api/catalog/items/{theory_item_id}")
        assert detail_response.status_code == 200
        detail_payload = detail_response.get_json()
        assert detail_payload["item"]["item_id"] == theory_item_id

        version_response = client.get(f"/api/catalog/items/{theory_item_id}/versions/{theory_version_id}")
        assert version_response.status_code == 200
        version_payload = version_response.get_json()
        assert version_payload["version"]["version_id"] == theory_version_id

        _login_hosted_user(client, "reader")
        add_response = client.post(f"/api/catalog/items/{theory_item_id}/library")
        assert add_response.status_code == 200
        add_payload = add_response.get_json()
        assert add_payload["library_entry"]["catalog_item_id"] == theory_item_id
        assert add_payload["route_contract"]["mode"] == "add_item_to_library"

        item_library_status = client.get(f"/api/catalog/items/{theory_item_id}/library-status")
        assert item_library_status.status_code == 200
        item_library_payload = item_library_status.get_json()
        assert item_library_payload["library_status"]["access_state"] == "active"

        version_library_status = client.get(
            f"/api/catalog/items/{theory_item_id}/versions/{theory_version_id}/library-status"
        )
        assert version_library_status.status_code == 200
        version_library_payload = version_library_status.get_json()
        assert version_library_payload["status_kind"] == "catalog_version_library_status"
        assert version_library_payload["library_status"]["content_type"] == "theory"
        assert "access_state" not in version_library_payload["library_status"]

        _login_hosted_user(client, "author")
        visibility_response = client.post(
            f"/api/catalog/items/{theory_item_id}/visibility",
            json={"catalog_visibility": "access_code"},
        )
        assert visibility_response.status_code == 200
        visibility_payload = visibility_response.get_json()
        access_code = visibility_payload["item"]["access_code"]
        assert visibility_payload["route_contract"]["mode"] == "set_visibility"

        _login_hosted_user(client, "reader")
        blocked_detail = client.get(f"/api/catalog/items/{theory_item_id}")
        assert blocked_detail.status_code == 403
        blocked_payload = blocked_detail.get_json()
        assert blocked_payload["error"] == "catalog_access_code_required"

        requires_code_status = client.get(f"/api/catalog/items/{theory_item_id}/library-status")
        assert requires_code_status.status_code == 200
        requires_code_payload = requires_code_status.get_json()
        assert requires_code_payload["library_status"]["access_state"] == "requires_access_code"

        resolved = client.post("/api/catalog/access-code/resolve", json={"access_code": access_code})
        assert resolved.status_code == 200
        resolved_payload = resolved.get_json()
        assert resolved_payload["item"]["item_id"] == theory_item_id
        assert resolved_payload["route_contract"]["mode"] == "resolve_access_code"

        unlocked_detail = client.get(f"/api/catalog/items/{theory_item_id}?access_code={access_code}")
        assert unlocked_detail.status_code == 200
        unlocked_payload = unlocked_detail.get_json()
        assert unlocked_payload["item"]["item_id"] == theory_item_id


def test_catalog_routes_return_canonical_degraded_for_blocked_hosted_paths(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    class _DegradedCatalogService:
        def list_items(self, **kwargs):
            raise HostedShadowReadFallbackDisabledError("_list_item_payloads", reason="postgres_dsn_missing")

        def publish_theory(self, *args, **kwargs):
            raise HostedShadowWriteFallbackDisabledError("_persist_publish_records", reason="postgres_dsn_missing")

    app_ctx = type(
        "Ctx",
        (),
        {
            "catalog_service": _DegradedCatalogService(),
            "user_service": _DummyHostedUserService(),
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)

    with server.app.test_client() as client:
        degraded_list = client.get("/api/catalog/items")
        assert degraded_list.status_code == 503
        degraded_list_payload = degraded_list.get_json()
        assert degraded_list_payload["error"] == "hosted_shadow_read_blocked"
        assert degraded_list_payload["route_contract"]["namespace"] == "public_catalog"
        assert degraded_list_payload["route_contract"]["mode"] == "list"

        _login_hosted_user(client, "author")
        degraded_publish = client.post(
            "/api/catalog/theories/theory_alpha/publish",
            json={"catalog_visibility": "public"},
        )
        assert degraded_publish.status_code == 503
        degraded_publish_payload = degraded_publish.get_json()
        assert degraded_publish_payload["error"] == "hosted_shadow_write_blocked"
        assert degraded_publish_payload["route_contract"]["namespace"] == "public_catalog"
        assert degraded_publish_payload["route_contract"]["mode"] == "publish_theory"
