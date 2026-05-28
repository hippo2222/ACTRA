import io
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
from routes._helpers import _serialize_workspace_catalog_modules
from routes.editor_routes import _filter_hosted_workspace_catalog_modules
from persistence.postgres import PostgresUnavailableError
from persistence.runtime import PersistenceRuntimeSettings
from services.hosted_catalog_service import HostedCatalogService
from services.hosted_shadow_fallback import (
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)
from services.hosted_storage_service import HostedStorageService


def _build_settings(tmp_path: Path) -> PersistenceRuntimeSettings:
    return PersistenceRuntimeSettings(
        runtime_mode="hosted_web",
        data_root=tmp_path,
        state_root=tmp_path / "runtime_state",
        postgres_dsn="",
        s3_endpoint="",
        s3_bucket="",
        s3_access_key="",
        s3_secret_key="",
        hosted_contract_errors=["missing_env:ACTRA_POSTGRES_DSN"],
    )


class _InMemoryWorkspaceCatalogRepository:
    def __init__(self):
        self.modules = []

    def ensure_schema(self) -> None:
        return None

    def count_catalogs(self) -> int:
        return 0

    def load_catalog(self):
        return list(self.modules)


class _InMemoryTaskContentRepository:
    def ensure_schema(self) -> None:
        return None


def test_hosted_storage_keeps_read_fallback_for_shadow_catalog(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

    module_dir = tmp_path / "modules" / "legacy_module"
    module_dir.mkdir(parents=True, exist_ok=True)
    (module_dir / "module.json").write_text(
        json.dumps({"id": "legacy_module", "name": "Legacy Module", "topics": []}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    service = HostedStorageService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))

    modules = service.load_modules()

    assert [item["id"] for item in modules] == ["legacy_module"]
    assert service.hosted_shadow_fallback_active is True
    assert service.hosted_shadow_write_fallback_blocked is False


def test_hosted_storage_does_not_bootstrap_shadow_catalog_when_postgres_is_available(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

    module_dir = tmp_path / "modules" / "legacy_module"
    module_dir.mkdir(parents=True, exist_ok=True)
    (module_dir / "module.json").write_text(
        json.dumps({"id": "legacy_module", "name": "Legacy Module", "topics": []}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    service = HostedStorageService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))
    service.repository = _InMemoryWorkspaceCatalogRepository()
    service.content_repository = _InMemoryTaskContentRepository()

    modules = service.load_modules()

    assert modules == []
    assert service.hosted_shadow_fallback_active is False
    assert service.hosted_storage_ready is True


def test_hosted_storage_blocks_shadow_writes_by_default(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

    service = HostedStorageService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))

    with pytest.raises(HostedShadowWriteFallbackDisabledError) as exc_info:
        service.create_module("module_new", "Module New")

    assert exc_info.value.operation == "create_module"
    assert service.hosted_shadow_fallback_active is True
    assert service.hosted_shadow_write_fallback_enabled is False
    assert service.hosted_shadow_write_fallback_blocked is True
    assert not (tmp_path / "modules" / "module_new").exists()


def test_hosted_storage_shadow_writes_can_be_opted_in_for_dev(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", "1")

    service = HostedStorageService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))

    created = service.create_module("module_dev", "Module Dev")

    assert created is True
    assert service.hosted_shadow_fallback_active is True
    assert service.hosted_shadow_write_fallback_enabled is True
    assert service.hosted_shadow_write_fallback_blocked is False
    assert (tmp_path / "modules" / "module_dev" / "module.json").exists()


def test_hosted_storage_dev_shadow_writes_keep_module_and_topic_visible_for_owner(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", "1")

    service = HostedStorageService(data_dir=str(tmp_path), persistence_settings=_build_settings(tmp_path))
    workspace_meta = {
        "created_by_user_id": "editor_user",
        "updated_by_user_id": "editor_user",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }

    assert service.create_module("module_dev", "Module Dev", workspace_meta=workspace_meta) is True
    assert (
        service.create_topic(
            "module_dev",
            "topic_dev",
            "Topic Dev",
            workspace_meta=workspace_meta,
        )
        is True
    )

    module_payload = json.loads(
        (tmp_path / "modules" / "module_dev" / "module.json").read_text(encoding="utf-8")
    )
    topic_payload = json.loads(
        (
            tmp_path / "modules" / "module_dev" / "topics" / "topic_dev" / "topic.json"
        ).read_text(encoding="utf-8")
    )

    assert module_payload["created_by_user_id"] == "editor_user"
    assert module_payload["content_scope"] == "shared_local"
    assert topic_payload["created_by_user_id"] == "editor_user"
    assert topic_payload["content_scope"] == "shared_local"

    modules = service.load_modules()
    serialized = _serialize_workspace_catalog_modules(modules, current_user_id="editor_user")
    filtered = _filter_hosted_workspace_catalog_modules(
        serialized,
        current_user_id="editor_user",
    )

    assert [module["id"] for module in filtered] == ["module_dev"]
    assert [topic["id"] for topic in filtered[0]["topics"]] == ["topic_dev"]


def test_ready_payload_reports_shadow_fallback_state(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

    runtime_state_root = tmp_path / "runtime_state"
    runtime_state_root.mkdir(parents=True, exist_ok=True)

    persistence_runtime = _build_settings(tmp_path)
    storage_service = type(
        "StorageServiceStub",
        (),
        {
            "hosted_storage_ready": False,
            "hosted_shadow_fallback_active": True,
            "hosted_shadow_read_fallback_blocked": False,
            "hosted_shadow_write_fallback_blocked": True,
        },
    )()
    ready_service = type(
        "ReadyServiceStub",
        (),
        {
            "hosted_storage_ready": True,
            "hosted_shadow_fallback_active": False,
            "hosted_shadow_read_fallback_blocked": False,
            "hosted_shadow_write_fallback_blocked": False,
        },
    )()
    statistics_service = type(
        "StatisticsServiceStub",
        (),
        {
            "hosted_storage_ready": False,
            "hosted_shadow_fallback_active": True,
            "hosted_shadow_read_fallback_blocked": False,
            "hosted_shadow_write_fallback_blocked": True,
        },
    )()
    session_repository = type(
        "SessionRepositoryStub",
        (),
        {
            "hosted_storage_ready": False,
            "hosted_shadow_fallback_active": True,
            "hosted_shadow_read_fallback_blocked": False,
            "hosted_shadow_write_fallback_blocked": True,
        },
    )()
    app_ctx = type(
        "Ctx",
        (),
        {
            "data_dir": tmp_path,
            "storage_service": storage_service,
            "asset_service": ready_service,
            "session_api": object(),
            "session_repository": session_repository,
            "persistence_runtime": persistence_runtime,
            "user_service": ready_service,
            "progress_service": ready_service,
            "statistics_service": statistics_service,
            "calendar_service": ready_service,
            "complex_service": ready_service,
            "theory_service": ready_service,
            "catalog_service": ready_service,
        },
    )()

    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)

    with server.app.test_client() as client:
        response = client.get("/api/ready")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["persistence"]["hosted_shadow_write_fallback_enabled"] is False
    assert payload["checks"]["session_repository_storage_ready"] is False
    assert payload["checks"]["statistics_service_storage_ready"] is False
    assert payload["persistence"]["session_repository_storage_ready"] is False
    assert payload["persistence"]["statistics_service_storage_ready"] is False
    assert payload["degraded"]["shadow_fallback_active"] is True
    assert payload["degraded"]["shadow_read_fallback_blocked"] is False
    assert payload["degraded"]["shadow_write_fallback_blocked"] is True
    assert payload["degraded"]["services"]["storage_service"]["shadow_fallback_active"] is True
    assert payload["degraded"]["services"]["storage_service"]["shadow_read_fallback_blocked"] is False
    assert payload["degraded"]["services"]["storage_service"]["shadow_write_fallback_blocked"] is True
    assert payload["degraded"]["services"]["statistics_service"]["shadow_fallback_active"] is True
    assert payload["degraded"]["services"]["statistics_service"]["shadow_write_fallback_blocked"] is True
    assert payload["degraded"]["services"]["session_repository"]["shadow_fallback_active"] is True
    assert payload["degraded"]["services"]["session_repository"]["shadow_write_fallback_blocked"] is True


def test_hosted_catalog_blocks_shadow_reads_by_default(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

    service = HostedCatalogService(
        data_dir=str(tmp_path),
        complex_service=object(),
        theory_service=object(),
        storage_service=object(),
        persistence_settings=_build_settings(tmp_path),
    )

    def _raise_postgres_unavailable() -> None:
        raise PostgresUnavailableError("postgres_dsn_missing")

    monkeypatch.setattr(service, "ensure_persistence_ready", _raise_postgres_unavailable)

    with pytest.raises(HostedShadowReadFallbackDisabledError) as exc_info:
        service.list_items(requested_by_user_id=None)

    assert exc_info.value.operation == "_list_item_payloads"
    assert service.hosted_shadow_fallback_active is True
    assert service.hosted_shadow_read_fallback_blocked is True
    assert service.hosted_shadow_write_fallback_blocked is False


def _login_hosted_user(client, user_id: str = "user_shadow") -> None:
    with client.session_transaction() as session:
        session[ctx_module._AUTH_USER_ID_SESSION_KEY] = user_id


class _DummyHostedUserService:
    def get_user(self, user_id: str):
        clean_user_id = str(user_id or "").strip()
        if not clean_user_id:
            return None
        return type("User", (), {"user_id": clean_user_id})()


class _WorkspaceLimitsStub:
    def assert_can_create_workspace_entity(self, user_id: str, entity_kind: str):
        return None

    def assert_entity_not_archived(self, user_id, entity_kind, entity_ref, *, action, scope=None):
        return {
            "workspace_access_state": "active",
            "is_premium_archived": False,
            "archived_item": None,
        }


class _DummyHostedAssetService:
    def __init__(self, *, asset_id: str = "asset_editor_1", asset_url: str = "/api/assets/asset_editor_1/content"):
        self.asset_id = asset_id
        self.asset_url = asset_url
        self.calls = []

    def register_existing_file(self, file_path, **kwargs):
        self.calls.append({"file_path": Path(file_path), **kwargs})
        return {
            "asset_id": self.asset_id,
            "asset_url": self.asset_url,
        }


def test_editor_route_returns_explicit_degraded_response_for_blocked_shadow_write(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

    storage_service = type(
        "StorageStub",
        (),
        {
            "create_module": staticmethod(
                lambda module_id, name, workspace_meta=None: (_ for _ in ()).throw(
                    HostedShadowWriteFallbackDisabledError("create_module", reason="postgres_dsn_missing")
                )
            )
        },
    )()
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

    with server.app.test_client() as client:
        _login_hosted_user(client)
        response = client.post("/api/editor/module/new", json={"name": "Shadow blocked"})

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["error"] == "hosted_shadow_write_blocked"
    assert payload["degraded"] is True
    assert payload["details"]["operation"] == "create_module"
    assert payload["details"]["env_opt_in"] == "ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK"


def test_hosted_editor_upload_returns_asset_only_payload(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    modules_dir = tmp_path / "modules"
    task_dir = modules_dir / "mod_1" / "topics" / "topic_1" / "tasks" / "task_1"
    task_dir.mkdir(parents=True, exist_ok=True)

    storage_service = type("StorageStub", (), {"modules_dir": modules_dir})()
    asset_service = _DummyHostedAssetService()
    app_ctx = type(
        "Ctx",
        (),
        {
            "storage_service": storage_service,
            "asset_service": asset_service,
            "theory_service": object(),
            "catalog_service": object(),
            "user_service": _DummyHostedUserService(),
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)

    with server.app.test_client() as client:
        _login_hosted_user(client, user_id="author_hosted")
        response = client.post(
            "/api/editor/upload-image",
            data={
                "module": "mod_1",
                "topic": "topic_1",
                "task": "task_1",
                "file": (io.BytesIO(b"hosted-image"), "diagram.png"),
            },
            content_type="multipart/form-data",
        )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["asset_id"] == "asset_editor_1"
    assert payload["asset_url"] == "/api/assets/asset_editor_1/content"
    assert "path" not in payload
    assert asset_service.calls
    assert asset_service.calls[0]["owner_user_id"] == "author_hosted"


def test_hosted_editor_image_path_lookup_returns_explicit_degraded_response(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    modules_dir = tmp_path / "modules"
    storage_service = type("StorageStub", (), {"modules_dir": modules_dir})()
    app_ctx = type(
        "Ctx",
        (),
        {
            "storage_service": storage_service,
            "theory_service": object(),
            "catalog_service": object(),
            "user_service": _DummyHostedUserService(),
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)

    with server.app.test_client() as client:
        response = client.get("/api/editor/image?path=modules/mod_1/topics/topic_1/tasks/task_1/images/diagram.png")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["error"] == "hosted_asset_path_blocked"
    assert payload["degraded"] is True
    assert payload["details"]["operation"] == "editor.image.path_lookup"
    assert payload["details"]["source_of_truth"] == "asset_id/asset_url"
    assert payload["route_contract"]["mode"] == "read_asset"


def test_hosted_theory_upload_returns_asset_only_payload(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    theory_dir = tmp_path / "complexes" / "theories" / "th_hosted"
    theory_dir.mkdir(parents=True, exist_ok=True)

    theory_service = type(
        "TheoryStub",
        (),
        {
            "add_image": staticmethod(
                lambda theory_id, file_obj: {
                    "path": "complexes/theories/th_hosted/images/diagram.png",
                    "version": "2026-04-19T12:00:00",
                }
            )
        },
    )()
    asset_service = _DummyHostedAssetService(asset_id="asset_theory_1", asset_url="/api/assets/asset_theory_1/content")
    app_ctx = type(
        "Ctx",
        (),
        {
            "storage_service": object(),
            "theory_service": theory_service,
            "asset_service": asset_service,
            "catalog_service": object(),
            "user_service": _DummyHostedUserService(),
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)

    with server.app.test_client() as client:
        _login_hosted_user(client, user_id="author_theory")
        response = client.post(
            "/api/theories/th_hosted/upload-image",
            data={"file": (io.BytesIO(b"hosted-theory-image"), "diagram.png")},
            content_type="multipart/form-data",
        )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["asset_id"] == "asset_theory_1"
    assert payload["asset_url"] == "/api/assets/asset_theory_1/content"
    assert "path" not in payload
    assert asset_service.calls
    assert asset_service.calls[0]["owner_user_id"] == "author_theory"


def test_hosted_theory_upload_returns_degraded_when_asset_contract_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    theory_service = type(
        "TheoryStub",
        (),
        {
            "add_image": staticmethod(
                lambda theory_id, file_obj: {
                    "path": "complexes/theories/th_hosted/images/diagram.png",
                    "version": "2026-04-19T12:00:00",
                }
            )
        },
    )()
    app_ctx = type(
        "Ctx",
        (),
        {
            "storage_service": object(),
            "theory_service": theory_service,
            "catalog_service": object(),
            "user_service": _DummyHostedUserService(),
            "workspace_limits_service": _WorkspaceLimitsStub(),
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)

    with server.app.test_client() as client:
        _login_hosted_user(client, user_id="author_theory")
        response = client.post(
            "/api/theories/th_hosted/upload-image",
            data={"file": (io.BytesIO(b"hosted-theory-image"), "diagram.png")},
            content_type="multipart/form-data",
        )

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["error"] == "hosted_asset_contract_blocked"
    assert payload["degraded"] is True
    assert payload["details"]["operation"] == "theory.upload_image"
    assert payload["details"]["source_of_truth"] == "asset_id/asset_url"
    assert payload["route_contract"]["mode"] == "upload_image"


def test_hosted_runtime_local_image_path_lookup_returns_explicit_degraded_response(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    app_ctx = type(
        "Ctx",
        (),
        {
            "storage_service": object(),
            "theory_service": object(),
            "catalog_service": object(),
            "user_service": _DummyHostedUserService(),
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)

    with server.app.test_client() as client:
        response = client.get("/api/local-image?path=modules/mod_1/topics/topic_1/tasks/task_1/images/diagram.png")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["error"] == "hosted_asset_path_blocked"
    assert payload["degraded"] is True
    assert payload["details"]["operation"] == "runtime.local_image.path_lookup"
    assert payload["details"]["source_of_truth"] == "asset_id/asset_url"
    assert payload["route_contract"]["mode"] == "read_asset"


def test_theory_route_returns_explicit_degraded_response_for_blocked_shadow_write(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

    theory_service = type(
        "TheoryStub",
        (),
        {
            "create_theory": staticmethod(
                lambda payload: (_ for _ in ()).throw(
                    HostedShadowWriteFallbackDisabledError("create_theory", reason="postgres_dsn_missing")
                )
            )
        },
    )()
    app_ctx = type(
        "Ctx",
        (),
        {
            "storage_service": object(),
            "theory_service": theory_service,
            "catalog_service": object(),
            "user_service": _DummyHostedUserService(),
            "workspace_limits_service": _WorkspaceLimitsStub(),
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)

    with server.app.test_client() as client:
        _login_hosted_user(client)
        response = client.post("/api/theories", json={"title": "Hosted degraded"})

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["error"] == "hosted_shadow_write_blocked"
    assert payload["details"]["operation"] == "create_theory"


def test_catalog_route_returns_explicit_degraded_response_with_route_contract(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

    catalog_service = type(
        "CatalogStub",
        (),
        {
            "publish_complex": staticmethod(
                lambda workspace_complex_id, requested_by_user_id, catalog_visibility=None: (_ for _ in ()).throw(
                    HostedShadowWriteFallbackDisabledError("_persist_publish_records", reason="postgres_dsn_missing")
                )
            )
        },
    )()
    app_ctx = type(
        "Ctx",
        (),
        {
            "storage_service": object(),
            "theory_service": object(),
            "catalog_service": catalog_service,
            "user_service": _DummyHostedUserService(),
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)

    with server.app.test_client() as client:
        _login_hosted_user(client)
        response = client.post("/api/catalog/complexes/cx_1/publish", json={"catalog_visibility": "public"})

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["error"] == "hosted_shadow_write_blocked"
    assert payload["degraded"] is True
    assert payload["route_contract"]["mode"] == "publish_complex"
    assert payload["route_contract"]["public_api"] is False


def test_catalog_read_route_returns_explicit_degraded_response_for_blocked_shadow_read(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    catalog_service = type(
        "CatalogReadStub",
        (),
        {
            "list_items": staticmethod(
                lambda **kwargs: (_ for _ in ()).throw(
                    HostedShadowReadFallbackDisabledError("_list_item_payloads", reason="postgres_dsn_missing")
                )
            )
        },
    )()
    app_ctx = type(
        "Ctx",
        (),
        {
            "storage_service": object(),
            "theory_service": object(),
            "catalog_service": catalog_service,
            "user_service": _DummyHostedUserService(),
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)

    with server.app.test_client() as client:
        response = client.get("/api/catalog/items")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["error"] == "hosted_shadow_read_blocked"
    assert payload["degraded"] is True
    assert payload["details"]["operation"] == "_list_item_payloads"
    assert payload["details"]["source_of_truth"] == "postgres"
    assert payload["route_contract"]["mode"] == "list"
    assert payload["route_contract"]["public_api"] is True


def test_final_results_route_returns_explicit_degraded_response_for_blocked_statistics_write(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

    session_api = type(
        "SessionApiStub",
        (),
        {
            "get_final_results": staticmethod(
                lambda session_id, user_id=None: (_ for _ in ()).throw(
                    HostedShadowWriteFallbackDisabledError(
                        "statistics._save_complex_statistics",
                        reason="postgres_dsn_missing",
                    )
                )
            )
        },
    )()
    app_ctx = type(
        "Ctx",
        (),
        {
            "storage_service": object(),
            "theory_service": object(),
            "catalog_service": object(),
            "statistics_service": object(),
            "session_api": session_api,
            "user_service": _DummyHostedUserService(),
            "data_dir": tmp_path,
            "user_id": "user_shadow",
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)

    with server.app.test_client() as client:
        _login_hosted_user(client)
        response = client.get("/api/session/session_1/final-results")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["error"] == "hosted_shadow_write_blocked"
    assert payload["degraded"] is True
    assert payload["details"]["operation"] == "statistics._save_complex_statistics"
