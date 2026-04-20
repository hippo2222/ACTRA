import json
import sys
from pathlib import Path

import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from persistence.postgres import PostgresUnavailableError
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
        item = self.items.get(str(item_id or "").strip())
        return dict(item) if isinstance(item, dict) else None

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


def _build_settings(tmp_path: Path) -> PersistenceRuntimeSettings:
    return PersistenceRuntimeSettings(
        runtime_mode="hosted_web",
        data_root=tmp_path,
        state_root=tmp_path / "runtime_state",
        postgres_dsn="postgresql://catalog-test",
        s3_endpoint="",
        s3_bucket="",
        s3_access_key="",
        s3_secret_key="",
        hosted_contract_errors=[],
    )


def _build_service(tmp_path: Path) -> HostedCatalogService:
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
    theory_payload = {
        "id": "theory_alpha",
        "title": "Theory Alpha",
        "delta": {"ops": [{"insert": "Hosted theory body\n"}]},
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


def test_hosted_catalog_uses_repository_truth_without_shadow_bootstrap(tmp_path):
    catalog_file = tmp_path / "catalog.json"
    catalog_file.write_text(
        json.dumps(
            {
                "items": [{"item_id": "legacy_item", "title": "Legacy item"}],
                "versions": [{"version_id": "legacy_version", "item_id": "legacy_item"}],
                "theory_library_entries": [{"library_entry_id": "legacy_theory_entry", "user_id": "reader"}],
                "complex_library_entries": [{"library_entry_id": "legacy_complex_entry", "user_id": "reader"}],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    original_shadow = catalog_file.read_text(encoding="utf-8")

    service = _build_service(tmp_path)

    listed = service.list_items(requested_by_user_id=None)

    assert listed["count"] == 0
    assert service.repository.list_items() == []
    assert catalog_file.read_text(encoding="utf-8") == original_shadow


def test_hosted_catalog_publish_and_library_flow_do_not_shadow_write(tmp_path):
    catalog_file = tmp_path / "catalog.json"
    catalog_file.write_text(
        json.dumps(
            {
                "items": [],
                "versions": [],
                "theory_library_entries": [],
                "complex_library_entries": [],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    original_shadow = catalog_file.read_text(encoding="utf-8")

    service = _build_service(tmp_path)

    theory_publish = service.publish_theory(
        "theory_alpha",
        requested_by_user_id="author",
        catalog_visibility="public",
    )
    theory_add = service.add_item_to_library(
        theory_publish["item"]["item_id"],
        requested_by_user_id="reader",
    )
    removed_theory = service.remove_theory_library_entry(
        theory_add["library_entry"]["library_entry_id"],
        requested_by_user_id="reader",
    )

    complex_publish = service.publish_complex(
        "complex_alpha",
        requested_by_user_id="author",
        catalog_visibility="public",
    )
    complex_add = service.add_item_to_library(
        complex_publish["item"]["item_id"],
        requested_by_user_id="reader",
    )
    removed_complex = service.remove_complex_library_entry(
        complex_add["library_entry"]["library_entry_id"],
        requested_by_user_id="reader",
    )

    assert theory_publish["item"]["item_id"] in service.repository.items
    assert complex_publish["item"]["item_id"] in service.repository.items
    assert removed_theory["removed"] is True
    assert removed_complex["removed"] is True
    assert service.repository.theory_entries == {}
    assert service.repository.complex_entries == {}
    assert catalog_file.read_text(encoding="utf-8") == original_shadow


def test_hosted_catalog_blocks_shadow_reads_when_postgres_unavailable(tmp_path, monkeypatch):
    service = _build_service(tmp_path)

    def _raise_postgres_unavailable():
        raise PostgresUnavailableError("postgres_dsn_missing")

    monkeypatch.setattr(service, "ensure_persistence_ready", _raise_postgres_unavailable)

    with pytest.raises(HostedShadowReadFallbackDisabledError) as exc_info:
        service.list_items(requested_by_user_id=None)

    assert exc_info.value.operation == "_list_item_payloads"
    assert service.hosted_shadow_fallback_active is True
    assert service.hosted_shadow_read_fallback_blocked is True


def test_hosted_catalog_blocks_shadow_writes_when_postgres_unavailable(tmp_path, monkeypatch):
    service = _build_service(tmp_path)

    def _raise_write_block(*args, **kwargs):
        raise PostgresUnavailableError("postgres_dsn_missing")

    monkeypatch.setattr(service.repository, "upsert_item", _raise_write_block)

    with pytest.raises(HostedShadowWriteFallbackDisabledError) as exc_info:
        service.publish_theory(
            "theory_alpha",
            requested_by_user_id="author",
            catalog_visibility="public",
        )

    assert exc_info.value.operation == "_persist_publish_records"
    assert service.hosted_shadow_fallback_active is True
    assert service.hosted_shadow_write_fallback_blocked is True
