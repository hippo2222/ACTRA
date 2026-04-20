import io
import sys
from pathlib import Path

import pytest
from werkzeug.datastructures import FileStorage


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from persistence.postgres import PostgresUnavailableError  # type: ignore
from persistence.runtime import PersistenceRuntimeSettings  # type: ignore
from services.hosted_shadow_fallback import (  # type: ignore
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)
from services.hosted_theory_service import HostedTheoryService  # type: ignore
from services.theory_service import TheoryNotFoundError  # type: ignore


class _InMemoryHostedTheoryMetadataRepository:
    def __init__(self):
        self.items = {}

    def ensure_schema(self) -> None:
        return None

    def list_theories(self):
        return sorted(
            self.items.values(),
            key=lambda item: str(item.get("updated_at") or ""),
            reverse=True,
        )

    def get_theory_metadata(self, theory_id: str):
        return self.items.get(str(theory_id or "").strip())

    def upsert_theory_metadata(self, payload):
        theory_id = str(payload.get("id") or "").strip()
        self.items[theory_id] = dict(payload)

    def delete_theory_metadata(self, theory_id: str):
        return self.items.pop(str(theory_id or "").strip(), None) is not None


class _InMemoryHostedTheoryContentRepository:
    def __init__(self):
        self.items = {}
        self.history = {}

    def ensure_schema(self) -> None:
        return None

    def get_theory_content(self, theory_id: str):
        return self.items.get(str(theory_id or "").strip())

    def upsert_theory_content(self, theory_id: str, *, delta, images, updated_at: str):
        self.items[str(theory_id or "").strip()] = {
            "theory_id": str(theory_id or "").strip(),
            "delta": delta,
            "images": list(images or []),
            "updated_at": str(updated_at or "").strip(),
        }

    def delete_theory_content(self, theory_id: str):
        return self.items.pop(str(theory_id or "").strip(), None) is not None

    def import_history_snapshot_if_absent(self, theory_id: str, snapshot_timestamp: str, payload):
        self.history.setdefault(str(theory_id or "").strip(), {})
        self.history[str(theory_id or "").strip()].setdefault(str(snapshot_timestamp or "").strip(), dict(payload))

    def upsert_history_snapshot(self, theory_id: str, snapshot_timestamp: str, payload):
        self.history.setdefault(str(theory_id or "").strip(), {})
        self.history[str(theory_id or "").strip()][str(snapshot_timestamp or "").strip()] = dict(payload)

    def list_history(self, theory_id: str):
        items = []
        for snapshot_timestamp, payload in (
            self.history.get(str(theory_id or "").strip(), {}) or {}
        ).items():
            item = dict(payload)
            item["_snapshot_timestamp"] = snapshot_timestamp
            items.append(item)
        items.sort(key=lambda item: str(item.get("_snapshot_timestamp") or ""), reverse=True)
        return items

    def get_history_snapshot(self, theory_id: str, snapshot_timestamp: str):
        payload = (
            self.history.get(str(theory_id or "").strip(), {}) or {}
        ).get(str(snapshot_timestamp or "").strip())
        return dict(payload) if isinstance(payload, dict) else None

    def delete_history_snapshot(self, theory_id: str, snapshot_timestamp: str):
        bucket = self.history.get(str(theory_id or "").strip(), {}) or {}
        return bucket.pop(str(snapshot_timestamp or "").strip(), None) is not None

    def delete_history(self, theory_id: str):
        bucket = self.history.pop(str(theory_id or "").strip(), {}) or {}
        return len(bucket)


class _FailingHostedTheoryRepository:
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


@pytest.fixture
def svc(tmp_path, persistence_settings):
    service = HostedTheoryService(data_dir=str(tmp_path), persistence_settings=persistence_settings)
    service.repository = _InMemoryHostedTheoryMetadataRepository()
    service.content_repository = _InMemoryHostedTheoryContentRepository()
    return service


def _theory_payload(theory_id="th_hosted", title="Hosted Theory"):
    return {
        "id": theory_id,
        "title": title,
        "delta": {"ops": [{"insert": "Hosted text\n"}]},
        "created_by_user_id": "owner-hosted",
        "updated_by_user_id": "owner-hosted",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }


def test_hosted_theory_service_persists_crud_history_restore_and_images_without_shadow_files(svc, tmp_path):
    created = svc.create_theory(_theory_payload())
    assert created["id"] == "th_hosted"
    assert svc.repository.get_theory_metadata("th_hosted")["title"] == "Hosted Theory"
    assert not (tmp_path / "complexes" / "theories" / "th_hosted" / "theory.json").exists()

    updated = svc.update_theory(
        "th_hosted",
        {
            "title": "Hosted Theory Updated",
            "delta": {"ops": [{"insert": "Updated hosted text\n"}]},
        },
    )
    assert updated["title"] == "Hosted Theory Updated"

    upload = FileStorage(
        stream=io.BytesIO(b"fake-png"),
        filename="hosted.png",
        content_type="image/png",
    )
    image_result = svc.add_image("th_hosted", upload)
    assert image_result["path"].endswith("hosted.png")
    assert svc.get_theory("th_hosted")["images"] == [image_result["path"]]
    assert (tmp_path / image_result["path"]).exists()

    history = svc.get_history("th_hosted")
    assert history
    restored = svc.restore_from_history("th_hosted", history[0]["_snapshot_timestamp"])
    assert restored["title"] == "Hosted Theory"

    deleted = svc.delete_theory("th_hosted")
    assert deleted["id"] == "th_hosted"
    assert svc.repository.get_theory_metadata("th_hosted") is None
    assert svc.content_repository.get_theory_content("th_hosted") is None
    with pytest.raises(TheoryNotFoundError):
        svc.get_theory("th_hosted")


def test_hosted_theory_service_does_not_bootstrap_from_shadow_files(tmp_path, persistence_settings):
    theory_dir = tmp_path / "complexes" / "theories" / "th_shadow_only"
    theory_dir.mkdir(parents=True, exist_ok=True)
    (theory_dir / "theory.json").write_text(
        '{"id":"th_shadow_only","title":"Legacy shadow","created_at":"2026-04-19T10:00:00","updated_at":"2026-04-19T10:00:00","version":"2026-04-19T10:00:00","delta_path":"body.delta.json","images":[]}',
        encoding="utf-8",
    )
    (theory_dir / "body.delta.json").write_text('{"ops":[{"insert":"shadow\\n"}]}', encoding="utf-8")

    service = HostedTheoryService(data_dir=str(tmp_path), persistence_settings=persistence_settings)
    service.repository = _InMemoryHostedTheoryMetadataRepository()
    service.content_repository = _InMemoryHostedTheoryContentRepository()

    assert service.list_theories() == []
    with pytest.raises(TheoryNotFoundError):
        service.get_theory("th_shadow_only")


def test_hosted_theory_service_blocks_shadow_reads_when_postgres_is_unavailable(tmp_path, persistence_settings, monkeypatch):
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)
    service = HostedTheoryService(data_dir=str(tmp_path), persistence_settings=persistence_settings)
    service.repository = _FailingHostedTheoryRepository()
    service.content_repository = _InMemoryHostedTheoryContentRepository()

    with pytest.raises(HostedShadowReadFallbackDisabledError) as exc_info:
        service.list_theories()

    assert exc_info.value.operation == "theories.list"
    assert exc_info.value.reason == "postgres_unavailable_for_test"


def test_hosted_theory_service_blocks_shadow_writes_when_postgres_is_unavailable(tmp_path, persistence_settings, monkeypatch):
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)
    service = HostedTheoryService(data_dir=str(tmp_path), persistence_settings=persistence_settings)
    service.repository = _FailingHostedTheoryRepository()
    service.content_repository = _InMemoryHostedTheoryContentRepository()

    with pytest.raises(HostedShadowWriteFallbackDisabledError) as exc_info:
        service.create_theory(_theory_payload())

    assert exc_info.value.operation == "theories.write"
    assert exc_info.value.reason == "postgres_unavailable_for_test"
