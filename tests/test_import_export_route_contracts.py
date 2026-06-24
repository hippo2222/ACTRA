import io
import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path

import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

import server  # type: ignore
import routes._context as ctx_module  # type: ignore
import routes.import_routes as import_routes_module  # type: ignore
from services.hosted_shadow_fallback import (  # type: ignore
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)


class _DummyHostedUser:
    def __init__(self, user_id: str):
        self.user_id = user_id


class _DummyHostedUserService:
    def __init__(self, user_id: str):
        self._user = _DummyHostedUser(user_id)

    def get_user(self, user_id: str):
        return self._user if str(user_id or "").strip() == self._user.user_id else None


class _DummyHostedStorage:
    def __init__(self):
        self._tasks = []
        self.saved_tasks = []
        self.deleted_tasks = []
        self.loaded_tasks = {}
        self.raise_on_load = None
        self.raise_on_save = None
        self.reload_count = 0

    def get_module(self, module_id: str):
        if module_id == "m1":
            return {"id": "m1", "name": "Module"}
        return None

    def get_topic(self, module_id: str, topic_id: str):
        if module_id == "m1" and topic_id == "t1":
            return {"id": "t1", "name": "Topic"}
        return None

    def get_tasks(self, module_id: str, topic_id: str):
        return list(self._tasks)

    def save_task(self, module_id: str, topic_id: str, task_id: str, task_data: dict, validate: bool = True):
        if self.raise_on_save is not None:
            raise self.raise_on_save
        self.saved_tasks.append(
            {
                "module_id": module_id,
                "topic_id": topic_id,
                "task_id": task_id,
                "task_data": task_data,
                "validate": validate,
            }
        )
        self._tasks.append({"id": task_id})
        return True

    def delete_task(self, module_id: str, topic_id: str, task_id: str):
        self.deleted_tasks.append((module_id, topic_id, task_id))
        self._tasks = [task for task in self._tasks if task.get("id") != task_id]
        return True

    def load_task(self, module_id: str, topic_id: str, task_id: str):
        if self.raise_on_load is not None:
            raise self.raise_on_load
        return self.loaded_tasks.get((module_id, topic_id, task_id))

    def reload_modules(self):
        self.reload_count += 1


class _DummyHostedImportExportService:
    SERVICE_CONTRACT = {
        "namespace": "public_editor_import_export",
        "import_family": "text_or_archive_task_import",
        "workspace_import": False,
        "public_api": True,
    }

    def __init__(self):
        self.exported_tasks = []
        self.imported_archives = []
        self.raise_on_export = None
        self.raise_on_import = None
        self.import_result = {
            "ok": True,
            "imported": 1,
            "skipped": 0,
            "errors": 0,
            "service_contract": dict(self.SERVICE_CONTRACT),
        }

    def validate_import_archive(self, archive_path):
        return {"tasks": []}

    def create_export_archive(self, tasks):
        if self.raise_on_export is not None:
            raise self.raise_on_export
        self.exported_tasks.append(list(tasks))
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp.close()
        with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("manifest.json", json.dumps({"export_type": "tasks"}))
        return tmp.name

    def import_tasks_atomic(self, archive_path, params, progress_callback=None):
        if self.raise_on_import is not None:
            raise self.raise_on_import
        self.imported_archives.append(
            {
                "archive_path": archive_path,
                "params": dict(params),
            }
        )
        if progress_callback is not None:
            progress_callback(0, 1, "Extracting archive...")
            progress_callback(1, 1, "Done")
        return dict(self.import_result)


class _DummyHostedComplexImportExportService:
    SERVICE_CONTRACT = {
        "namespace": "public_editor_import_export",
        "import_family": "complex_archive_import",
        "workspace_import": False,
        "public_api": True,
    }

    def __init__(self):
        self.exported_complexes = []
        self.raise_on_export = None
        self.imported_archives = []
        self.raise_on_import = None
        self.import_result = {
            "ok": True,
            "imported_complexes": 1,
            "skipped_complexes": 0,
            "complex_errors": 0,
            "rollback": False,
            "service_contract": dict(self.SERVICE_CONTRACT),
        }

    def validate_import_archive(self, archive_path):
        return {
            "summary": {"total": 0},
            "manifest": {"entities": {"tasks": []}}
        }

    def create_export_archive(self, complex_ids, options=None):
        if self.raise_on_export is not None:
            raise self.raise_on_export
        self.exported_complexes.append(
            {
                "complex_ids": list(complex_ids),
                "options": dict(options or {}),
            }
        )
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp.close()
        with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("manifest.json", json.dumps({"export_type": "complexes"}))
        return tmp.name

    def import_complexes_atomic(self, archive_path, params, progress_callback=None):
        if self.raise_on_import is not None:
            raise self.raise_on_import
        self.imported_archives.append(
            {
                "archive_path": archive_path,
                "params": dict(params),
            }
        )
        if progress_callback is not None:
            progress_callback(0, 1, "Extracting archive...")
            progress_callback(1, 1, "Done")
        return dict(self.import_result)


@pytest.fixture
def hosted_client(monkeypatch):
    user_id = "user_import_contract"
    storage = _DummyHostedStorage()
    import_export_service = _DummyHostedImportExportService()
    complex_import_export_service = _DummyHostedComplexImportExportService()
    import_helpers = {
        "PARSERS_AVAILABLE": True,
        "CURRENT_SCHEMA_VERSION": "1.2",
        "stable_json_hash": lambda payload: json.dumps(payload, sort_keys=True, ensure_ascii=False),
        "extract_task_preview_signature": lambda task: task,
        "ai_run_write_artifact": lambda *args, **kwargs: None,
        "ai_run_merge_manifest": lambda *args, **kwargs: None,
        "utc_now_iso": lambda: "2026-04-19T00:00:00+00:00",
    }

    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setattr(import_routes_module, "_ih", lambda: import_helpers)
    app_ctx = getattr(ctx_module, "_app_ctx", None)
    monkeypatch.setattr(app_ctx, "user_service", _DummyHostedUserService(user_id), raising=False)
    monkeypatch.setattr(app_ctx, "storage_service", storage, raising=False)
    monkeypatch.setattr(app_ctx, "import_export_service", import_export_service, raising=False)
    monkeypatch.setattr(
        app_ctx,
        "complex_import_export_service",
        complex_import_export_service,
        raising=False,
    )
    server.app.config["TESTING"] = True
    with server.app.test_client() as client:
        with client.session_transaction() as session:
            session[ctx_module._AUTH_USER_ID_SESSION_KEY] = user_id
        yield client, storage, import_export_service, complex_import_export_service


def _assert_public_import_contract(payload: dict, *, mode: str, import_family: str) -> None:
    route_contract = payload["route_contract"]
    assert route_contract["namespace"] == "public_editor_import_export"
    assert route_contract["mode"] == mode
    assert route_contract["import_family"] == import_family
    assert route_contract["public_api"] is True
    assert route_contract["workspace_import"] is False


def _assert_hosted_shadow_blocked(
    payload: dict,
    *,
    error: str,
    mode: str,
    import_family: str,
    service_contract_expected: bool,
    reason: str,
) -> None:
    assert payload["error"] == error
    assert payload["degraded"] is True
    assert payload["details"]["reason"] == reason
    _assert_public_import_contract(payload, mode=mode, import_family=import_family)
    if service_contract_expected:
        assert payload["service_contract"]["namespace"] == "public_editor_import_export"
        assert payload["service_contract"]["public_api"] is True
        assert payload["service_contract"]["workspace_import"] is False
    else:
        assert "service_contract" not in payload


def _decode_ndjson(response) -> list[dict]:
    body = response.get_data(as_text=True).strip()
    if not body:
        return []
    return [json.loads(line) for line in body.splitlines() if line.strip()]


def test_text_import_parse_rejects_workspace_markers_with_public_route_contract(hosted_client):
    client, _storage, _svc, _complex_svc = hosted_client
    response = client.post(
        "/api/editor/import/parse",
        json={
            "module_id": "m1",
            "topic_id": "t1",
            "text": "@OPEN_ANSWER\n# Prompt",
            "source_complex_id": "complex_1",
        },
    )

    assert response.status_code == 400
    payload = response.get_json()
    assert payload["error"] == "workspace_import_payload_not_supported:source_complex_id"
    _assert_public_import_contract(
        payload,
        mode="parse",
        import_family="text_task_import",
    )


def test_text_import_execute_rejects_workspace_markers_with_public_route_contract(hosted_client):
    client, _storage, _svc, _complex_svc = hosted_client
    response = client.post(
        "/api/editor/import/execute",
        json={
            "module_id": "m1",
            "topic_id": "t1",
            "tasks": [{"status": "valid", "type": "open_answer", "data": {"prompt": "Prompt"}}],
            "source_catalog_item_id": "catalog_item_1",
        },
    )

    assert response.status_code == 400
    payload = response.get_json()
    assert payload["error"] == "workspace_import_payload_not_supported:source_catalog_item_id"
    _assert_public_import_contract(
        payload,
        mode="execute",
        import_family="text_task_import",
    )


def test_text_export_uses_hosted_storage_load_task(hosted_client):
    client, storage, _svc, _complex_svc = hosted_client
    storage.loaded_tasks[("m1", "t1", "task_1")] = {
        "task_data": {
            "type": "open_answer",
            "content": {
                "question": "Prompt",
                "reference_answer": "Reference",
                "keywords": ["alpha", "beta"],
            },
        }
    }

    response = client.post(
        "/api/editor/export/text",
        json={"tasks": [{"module_id": "m1", "topic_id": "t1", "task_id": "task_1"}]},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert "@OPEN_ANSWER" in payload["text"]
    assert "# Prompt" in payload["text"]
    assert "= Reference" in payload["text"]
    _assert_public_import_contract(
        payload,
        mode="export_text",
        import_family="text_task_export",
    )


def test_text_export_returns_degraded_when_hosted_storage_load_is_blocked(hosted_client):
    client, storage, _svc, _complex_svc = hosted_client
    storage.raise_on_load = HostedShadowReadFallbackDisabledError(
        "editor_import_export.export_text",
        reason="test_shadow_read_blocked",
    )

    response = client.post(
        "/api/editor/export/text",
        json={"tasks": [{"module_id": "m1", "topic_id": "t1", "task_id": "task_1"}]},
    )

    assert response.status_code == 503
    payload = response.get_json()
    _assert_hosted_shadow_blocked(
        payload,
        error="hosted_shadow_read_blocked",
        mode="export_text",
        import_family="text_task_export",
        service_contract_expected=False,
        reason="test_shadow_read_blocked",
    )


def test_text_import_execute_uses_hosted_storage_save_task(hosted_client):
    client, storage, _svc, _complex_svc = hosted_client
    response = client.post(
        "/api/editor/import/execute",
        json={
            "module_id": "m1",
            "topic_id": "t1",
            "tasks": [
                {
                    "status": "valid",
                    "name": "Imported task",
                    "type": "open_answer",
                    "data": {
                        "prompt": "Prompt",
                        "question": "Prompt",
                        "reference_answer": "Reference",
                        "keywords": ["alpha"],
                    },
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["imported"] == 1
    assert len(payload["task_ids"]) == 1
    _assert_public_import_contract(
        payload,
        mode="execute",
        import_family="text_task_import",
    )
    assert len(storage.saved_tasks) == 1
    saved = storage.saved_tasks[0]
    assert saved["module_id"] == "m1"
    assert saved["topic_id"] == "t1"
    assert saved["validate"] is False
    assert saved["task_data"]["content"]["question"] == "Prompt"
    assert saved["task_data"]["content"]["reference_answer"] == "Reference"
    assert saved["task_data"]["meta"]["import_source"] == "text"
    assert storage.reload_count == 1


def test_text_import_execute_returns_degraded_when_hosted_storage_save_is_blocked(hosted_client):
    client, storage, _svc, _complex_svc = hosted_client
    storage.raise_on_save = HostedShadowWriteFallbackDisabledError(
        "editor_import_export.execute_text_import",
        reason="test_shadow_write_blocked",
    )

    response = client.post(
        "/api/editor/import/execute",
        json={
            "module_id": "m1",
            "topic_id": "t1",
            "tasks": [{"status": "valid", "type": "open_answer", "data": {"prompt": "Prompt"}}],
        },
    )

    assert response.status_code == 503
    payload = response.get_json()
    _assert_hosted_shadow_blocked(
        payload,
        error="hosted_shadow_write_blocked",
        mode="execute",
        import_family="text_task_import",
        service_contract_expected=False,
        reason="test_shadow_write_blocked",
    )


def test_task_archive_import_check_rejects_workspace_markers_with_public_route_contract(hosted_client):
    client, _storage, _svc, _complex_svc = hosted_client
    response = client.post(
        "/api/editor/import/check",
        data={"source_catalog_version_id": "version_1"},
    )

    assert response.status_code == 400
    payload = response.get_json()
    assert payload["error"] == "workspace_import_payload_not_supported:source_catalog_version_id"
    _assert_public_import_contract(
        payload,
        mode="check",
        import_family="task_archive_import",
    )


def test_task_archive_import_confirm_rejects_workspace_markers_with_public_route_contract(hosted_client):
    client, _storage, _svc, _complex_svc = hosted_client
    response = client.post(
        "/api/editor/import/confirm",
        data={"prefer_existing_by_lineage": "true"},
    )

    assert response.status_code == 400
    payload = response.get_json()
    assert payload["error"] == "workspace_import_payload_not_supported:prefer_existing_by_lineage"
    _assert_public_import_contract(
        payload,
        mode="confirm",
        import_family="task_archive_import",
    )


def test_task_archive_export_uses_hosted_service_in_hosted_runtime(hosted_client):
    client, _storage, svc, _complex_svc = hosted_client
    response = client.post(
        "/api/editor/export/tasks",
        json={"tasks": [{"module_id": "m1", "topic_id": "t1", "task_id": "task_1"}]},
    )

    assert response.status_code == 200
    assert response.mimetype == "application/zip"
    assert svc.exported_tasks == [[{"module_id": "m1", "topic_id": "t1", "task_id": "task_1"}]]


def test_task_archive_export_returns_degraded_when_hosted_service_is_blocked(hosted_client):
    client, _storage, svc, _complex_svc = hosted_client
    svc.raise_on_export = HostedShadowReadFallbackDisabledError(
        "import_export.create_export_archive",
        reason="test_task_archive_export_blocked",
    )

    response = client.post(
        "/api/editor/export/tasks",
        json={"tasks": [{"module_id": "m1", "topic_id": "t1", "task_id": "task_1"}]},
    )

    assert response.status_code == 503
    payload = response.get_json()
    _assert_hosted_shadow_blocked(
        payload,
        error="hosted_shadow_read_blocked",
        mode="export",
        import_family="task_archive_export",
        service_contract_expected=True,
        reason="test_task_archive_export_blocked",
    )


def test_task_archive_import_confirm_streams_hosted_service_result(hosted_client):
    client, _storage, svc, _complex_svc = hosted_client
    response = client.post(
        "/api/editor/import/confirm",
        data={
            "conflict_resolution": "overwrite",
            "target_module_id": "m1",
            "target_topic_id": "t1",
            "file": (io.BytesIO(b"pk"), "tasks.zip"),
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    assert response.mimetype == "application/x-ndjson"
    events = _decode_ndjson(response)
    assert events[0]["type"] == "progress"
    assert events[-1]["type"] == "result"
    payload = events[-1]["data"]
    assert payload["ok"] is True
    assert payload["imported"] == 1
    _assert_public_import_contract(
        payload,
        mode="confirm",
        import_family="task_archive_import",
    )
    assert payload["service_contract"]["namespace"] == "public_editor_import_export"
    assert svc.imported_archives[0]["params"]["conflict_resolution"] == "overwrite"
    assert svc.imported_archives[0]["params"]["target_module_id"] == "m1"
    assert svc.imported_archives[0]["params"]["target_topic_id"] == "t1"


def test_task_archive_import_confirm_streams_degraded_when_hosted_write_is_blocked(hosted_client):
    client, _storage, svc, _complex_svc = hosted_client
    svc.raise_on_import = HostedShadowWriteFallbackDisabledError(
        "import_export.import_tasks_atomic",
        reason="test_task_archive_import_write_blocked",
    )

    response = client.post(
        "/api/editor/import/confirm",
        data={"file": (io.BytesIO(b"pk"), "tasks.zip")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    events = _decode_ndjson(response)
    assert events[-1]["type"] == "result"
    payload = events[-1]["data"]
    _assert_hosted_shadow_blocked(
        payload,
        error="hosted_shadow_write_blocked",
        mode="confirm",
        import_family="task_archive_import",
        service_contract_expected=True,
        reason="test_task_archive_import_write_blocked",
    )


def test_complex_archive_import_check_rejects_workspace_markers_with_public_route_contract(hosted_client):
    client, _storage, _svc, _complex_svc = hosted_client
    response = client.post(
        "/api/complexes/import/check",
        data={"requested_by_user_id": "user_1"},
    )

    assert response.status_code == 400
    payload = response.get_json()
    assert payload["error"] == "workspace_import_payload_not_supported:requested_by_user_id"
    _assert_public_import_contract(
        payload,
        mode="check",
        import_family="complex_archive_import",
    )


def test_complex_archive_import_confirm_rejects_workspace_markers_with_public_route_contract(hosted_client):
    client, _storage, _svc, _complex_svc = hosted_client
    response = client.post(
        "/api/complexes/import/confirm",
        data={"source_complex_id": "complex_1", "file": (io.BytesIO(b"pk"), "complex.zip")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    payload = response.get_json()
    assert payload["error"] == "workspace_import_payload_not_supported:source_complex_id"
    _assert_public_import_contract(
        payload,
        mode="confirm",
        import_family="complex_archive_import",
    )


def test_complex_archive_export_uses_hosted_service_in_hosted_runtime(hosted_client):
    client, _storage, _svc, complex_svc = hosted_client
    response = client.post(
        "/api/complexes/export",
        json={"complex_id": "complex_1", "include_tasks": True, "include_theories": False},
    )

    assert response.status_code == 200
    assert response.mimetype == "application/zip"
    assert complex_svc.exported_complexes == [
        {
            "complex_ids": ["complex_1"],
            "options": {"include_tasks": True, "include_theories": False},
        }
    ]


def test_complex_archive_export_returns_degraded_when_hosted_service_is_blocked(hosted_client):
    client, _storage, _svc, complex_svc = hosted_client
    complex_svc.raise_on_export = HostedShadowReadFallbackDisabledError(
        "complex_import_export.create_export_archive",
        reason="test_complex_archive_export_blocked",
    )

    response = client.post(
        "/api/complexes/export",
        json={"complex_id": "complex_1"},
    )

    assert response.status_code == 503
    payload = response.get_json()
    _assert_hosted_shadow_blocked(
        payload,
        error="hosted_shadow_read_blocked",
        mode="export",
        import_family="complex_archive_export",
        service_contract_expected=True,
        reason="test_complex_archive_export_blocked",
    )


def test_complex_archive_import_confirm_streams_hosted_service_result(hosted_client):
    client, _storage, _svc, complex_svc = hosted_client
    response = client.post(
        "/api/complexes/import/confirm",
        data={
            "complex_conflict_resolution": "overwrite",
            "task_conflict_resolution": "skip",
            "theory_conflict_resolution": "overwrite",
            "file": (io.BytesIO(b"pk"), "complex.zip"),
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    assert response.mimetype == "application/x-ndjson"
    events = _decode_ndjson(response)
    assert events[0]["type"] == "progress"
    assert events[-1]["type"] == "result"
    payload = events[-1]["data"]
    assert payload["ok"] is True
    assert payload["imported_complexes"] == 1
    _assert_public_import_contract(
        payload,
        mode="confirm",
        import_family="complex_archive_import",
    )
    assert payload["service_contract"]["namespace"] == "public_editor_import_export"
    assert complex_svc.imported_archives[0]["params"]["complex_conflict_resolution"] == "overwrite"
    assert complex_svc.imported_archives[0]["params"]["theory_conflict_resolution"] == "overwrite"


def test_complex_archive_import_confirm_streams_degraded_when_hosted_write_is_blocked(hosted_client):
    client, _storage, _svc, complex_svc = hosted_client
    complex_svc.raise_on_import = HostedShadowWriteFallbackDisabledError(
        "complex_import_export.import_complexes_atomic",
        reason="test_complex_archive_import_write_blocked",
    )

    response = client.post(
        "/api/complexes/import/confirm",
        data={"file": (io.BytesIO(b"pk"), "complex.zip")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    events = _decode_ndjson(response)
    assert events[-1]["type"] == "result"
    payload = events[-1]["data"]
    _assert_hosted_shadow_blocked(
        payload,
        error="hosted_shadow_write_blocked",
        mode="confirm",
        import_family="complex_archive_import",
        service_contract_expected=True,
        reason="test_complex_archive_import_write_blocked",
    )
