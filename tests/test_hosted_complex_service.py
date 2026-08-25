import os
import sys
from pathlib import Path

import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from persistence.postgres import PostgresUnavailableError  # type: ignore
from persistence.runtime import PersistenceRuntimeSettings  # type: ignore
from services.hosted_complex_service import HostedComplexService  # type: ignore
from services.hosted_shadow_fallback import (  # type: ignore
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)


class _InMemoryHostedComplexRepository:
    def __init__(self):
        self.complexes = {}
        self.history = {}

    def ensure_schema(self) -> None:
        return None

    def list_complexes(self):
        return list(self.complexes.values())

    def get_complex(self, complex_id: str):
        return self.complexes.get(str(complex_id or "").strip())

    def upsert_complex(self, payload):
        cid = str(payload.get("id") or "").strip()
        if cid:
            self.complexes[cid] = dict(payload)

    def delete_complex(self, complex_id: str):
        return self.complexes.pop(str(complex_id or "").strip(), None) is not None

    def replace_all_complexes(self, payloads):
        self.complexes = {
            str(item.get("id") or "").strip(): dict(item)
            for item in payloads or []
            if isinstance(item, dict) and str(item.get("id") or "").strip()
        }

    def upsert_history_snapshot(self, complex_id, snapshot_timestamp, payload, *, updated_at, history_kind):
        key = (str(complex_id or "").strip(), str(snapshot_timestamp or "").strip())
        self.history[key] = dict(payload)

    def list_history(self, complex_id, *, history_kind=None):
        clean_complex_id = str(complex_id or "").strip()
        items = []
        for (item_complex_id, snapshot_timestamp), payload in self.history.items():
            if item_complex_id != clean_complex_id:
                continue
            if history_kind and str(payload.get("_history_kind") or "").strip() != str(history_kind).strip():
                continue
            item = dict(payload)
            item["_snapshot_timestamp"] = snapshot_timestamp
            items.append(item)
        items.sort(key=lambda item: str(item.get("_snapshot_timestamp") or ""), reverse=True)
        return items

    def get_history_snapshot(self, complex_id, snapshot_timestamp):
        payload = self.history.get((str(complex_id or "").strip(), str(snapshot_timestamp or "").strip()))
        if not isinstance(payload, dict):
            return None
        item = dict(payload)
        item["_snapshot_timestamp"] = str(snapshot_timestamp or "").strip()
        return item

    def delete_history_snapshot(self, complex_id, snapshot_timestamp):
        return self.history.pop((str(complex_id or "").strip(), str(snapshot_timestamp or "").strip()), None) is not None

    def delete_autosave_snapshots(self, complex_id):
        clean_complex_id = str(complex_id or "").strip()
        deleted = 0
        for key in list(self.history.keys()):
            if key[0] != clean_complex_id:
                continue
            payload = self.history.get(key) or {}
            if str(payload.get("_history_kind") or "").strip().lower() != "autosave":
                continue
            self.history.pop(key, None)
            deleted += 1
        return deleted

    def delete_history(self, complex_id):
        clean_complex_id = str(complex_id or "").strip()
        deleted = 0
        for key in list(self.history.keys()):
            if key[0] == clean_complex_id:
                self.history.pop(key, None)
                deleted += 1
        return deleted


class _FailingHostedComplexRepository:
    def ensure_schema(self) -> None:
        raise PostgresUnavailableError("postgres_unavailable_for_test")


@pytest.fixture
def persistence_settings(tmp_path):
    return PersistenceRuntimeSettings(
        runtime_mode="hosted_web",
        data_root=tmp_path,
        state_root=tmp_path / "runtime_state",
        postgres_dsn="postgresql://unused",
        s3_endpoint="s3",
        s3_bucket="bucket",
        s3_access_key="key",
        s3_secret_key="secret",
        hosted_contract_errors=[],
    )


def _valid_complex_payload(complex_id="cx_hosted", name="Hosted Complex"):
    return {
        "id": complex_id,
        "name": name,
        "description": "Hosted description",
        "tasks": ["module/topic/task_1"],
        "chains": [],
        "settings": {},
        "created_by_user_id": "owner-hosted",
        "updated_by_user_id": "owner-hosted",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }


@pytest.fixture
def svc(tmp_path, persistence_settings):
    service = HostedComplexService(data_dir=str(tmp_path), persistence_settings=persistence_settings)
    service.repository = _InMemoryHostedComplexRepository()
    return service


def test_hosted_complex_service_persists_crud_without_shadow_files(svc, tmp_path):
    created = svc.create_complex(_valid_complex_payload())
    assert created.id == "cx_hosted"
    assert svc.repository.complexes["cx_hosted"]["name"] == "Hosted Complex"
    assert not (tmp_path / "complexes" / "complexes.json").exists()

    updated = svc.update_complex("cx_hosted", {"name": "Hosted Complex Updated"})
    assert updated.name == "Hosted Complex Updated"
    assert svc.repository.complexes["cx_hosted"]["name"] == "Hosted Complex Updated"

    assert svc.delete_complex("cx_hosted") is True
    assert "cx_hosted" not in svc.repository.complexes


def test_hosted_complex_service_does_not_bootstrap_from_shadow_files(tmp_path, persistence_settings):
    shadow_dir = tmp_path / "complexes"
    shadow_dir.mkdir(parents=True, exist_ok=True)
    (shadow_dir / "complexes.json").write_text(
        '[{"id":"legacy_shadow_complex","name":"Legacy shadow complex","description":"","tasks":[],"chains":[],"settings":{}}]',
        encoding="utf-8",
    )

    service = HostedComplexService(data_dir=str(tmp_path), persistence_settings=persistence_settings)
    service.repository = _InMemoryHostedComplexRepository()

    assert service.get_all_complexes() == []
    assert service.repository.complexes == {}


def test_hosted_complex_service_persists_autosave_history_and_restore_without_shadow_history(svc, tmp_path):
    svc.create_complex(_valid_complex_payload())
    svc.update_complex("cx_hosted", {"name": "Hosted Complex v2"})

    autosave = svc.save_autosave_snapshot("cx_hosted", {"description": "Draft description"})
    assert autosave["description"] == "Draft description"
    assert svc.get_latest_autosave_snapshot("cx_hosted")["description"] == "Draft description"

    history = svc.get_complex_history("cx_hosted")
    assert history
    manual_snapshot = next(
        item for item in history if str(item.get("_history_kind") or "").strip().lower() != "autosave"
    )

    assert svc.delete_autosave_snapshots("cx_hosted") == 1
    assert svc.get_latest_autosave_snapshot("cx_hosted") is None

    restored = svc.restore_from_history("cx_hosted", manual_snapshot["_snapshot_timestamp"])
    assert restored.name == "Hosted Complex"
    assert not (tmp_path / "complexes" / "history").exists()


def test_hosted_complex_service_blocks_shadow_reads_when_postgres_is_unavailable(tmp_path, persistence_settings, monkeypatch):
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)
    service = HostedComplexService(data_dir=str(tmp_path), persistence_settings=persistence_settings)
    service.repository = _FailingHostedComplexRepository()

    with pytest.raises(HostedShadowReadFallbackDisabledError) as exc_info:
        service.get_all_complexes()

    assert exc_info.value.operation == "complexes.load"
    assert exc_info.value.reason == "postgres_unavailable_for_test"


def test_hosted_complex_service_blocks_shadow_writes_when_postgres_is_unavailable(tmp_path, persistence_settings, monkeypatch):
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)
    service = HostedComplexService(data_dir=str(tmp_path), persistence_settings=persistence_settings)
    service.repository = _FailingHostedComplexRepository()
    service._initialized = True

    with pytest.raises(HostedShadowWriteFallbackDisabledError) as exc_info:
        service.create_complex(_valid_complex_payload())

    assert exc_info.value.operation == "complexes.write"
    assert exc_info.value.reason == "postgres_unavailable_for_test"


def test_get_all_complexes_always_reads_from_postgres_not_stale_cache(tmp_path, persistence_settings):
    """
    Regression test for the multi-worker stale cache bug.

    When Flask serves requests across multiple workers, each worker has its own
    in-process _complexes_cache. A complex created by worker A was invisible to
    worker B because get_all_complexes() returned _complexes_cache instead of
    reading Postgres directly.

    After the fix, get_all_complexes() always calls load_complexes() which hits
    Postgres, so even a worker whose cache is empty/stale returns fresh data.
    """
    # Worker A: create a complex (writes to repo + its own cache)
    worker_a = HostedComplexService(data_dir=str(tmp_path), persistence_settings=persistence_settings)
    worker_a.repository = _InMemoryHostedComplexRepository()
    worker_a.create_complex(_valid_complex_payload("cx_worker_a", "Worker A Complex"))

    # Worker B: simulated by a fresh service instance sharing the SAME repository
    # but with a completely empty in-process cache (as would happen with a new thread)
    worker_b = HostedComplexService(data_dir=str(tmp_path), persistence_settings=persistence_settings)
    worker_b.repository = worker_a.repository  # same Postgres (in-memory repo here)
    # worker_b cache starts empty — _initialized=False

    complexes = worker_b.get_all_complexes()
    ids = [c.id for c in complexes]
    assert "cx_worker_a" in ids, (
        "get_all_complexes() must always read from Postgres, not from stale in-process cache"
    )
