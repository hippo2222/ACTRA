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
from services.hosted_microcards_service import HostedMicrocardsService  # type: ignore
from services.hosted_shadow_fallback import (  # type: ignore
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)


class _InMemoryHostedMicrocardsRepository:
    def __init__(self):
        self.decks = {}
        self.schema_ready = False

    def ensure_schema(self) -> None:
        self.schema_ready = True

    def count_decks(self) -> int:
        return len(self.decks)

    def list_decks(self, *, limit: int = 100):
        items = list(self.decks.values())
        return items[: max(1, min(int(limit or 100), 500))]

    def get_deck(self, deck_id: str):
        deck = self.decks.get(str(deck_id or "").strip())
        return dict(deck) if isinstance(deck, dict) else None

    def upsert_deck(self, deck: dict, *, updated_at: str) -> None:
        payload = dict(deck)
        meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
        meta["updated_at"] = updated_at
        payload["meta"] = meta
        self.decks[payload["id"]] = payload

    def import_deck_if_absent(self, deck: dict, *, updated_at: str) -> None:
        self.decks.setdefault(deck["id"], dict(deck))

    def delete_deck(self, deck_id: str) -> bool:
        return self.decks.pop(str(deck_id or "").strip(), None) is not None


class _FailingHostedMicrocardsRepository:
    def ensure_schema(self) -> None:
        raise PostgresUnavailableError("postgres_unavailable_for_test")


class _InMemoryHostedMicrocardsReviewRepository:
    def __init__(self):
        self.documents = {}

    def ensure_schema(self) -> None:
        return None

    def get_document(self, user_id: str, doc_kind: str):
        return self.documents.get((str(user_id or "").strip(), str(doc_kind or "").strip()))

    def write_document(self, user_id: str, doc_kind: str, payload, *, updated_at: str) -> None:
        self.documents[(str(user_id or "").strip(), str(doc_kind or "").strip())] = payload

    def import_document_if_absent(self, user_id: str, doc_kind: str, payload, *, updated_at: str) -> None:
        self.documents.setdefault((str(user_id or "").strip(), str(doc_kind or "").strip()), payload)


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
    service = HostedMicrocardsService(
        data_dir=str(tmp_path),
        user_id="user_hosted_microcards",
        persistence_settings=persistence_settings,
    )
    service.repository = _InMemoryHostedMicrocardsRepository()
    service.review_repository = _InMemoryHostedMicrocardsReviewRepository()
    return service


def test_hosted_microcards_service_persists_manual_deck_crud_without_filesystem_shadow(svc, tmp_path):
    deck = svc.create_deck_manual(name="Hosted deck", tags=["manual"], target_language="en")

    decks_dir = tmp_path / "microcards" / "decks"
    assert deck["id"] in svc.repository.decks
    assert list(decks_dir.glob("*.json")) == []

    listed = svc.list_decks()
    assert listed[0]["id"] == deck["id"]
    assert listed[0]["stats"]["cards_total"] == 0

    loaded = svc.get_deck(deck["id"])
    assert loaded["name"] == "Hosted deck"

    renamed = svc.rename_deck(deck["id"], "Renamed hosted deck")
    assert renamed["name"] == "Renamed hosted deck"
    assert svc.get_deck(deck["id"])["name"] == "Renamed hosted deck"

    assert svc.delete_deck(deck["id"]) is True
    assert svc.get_deck(deck["id"]) is None


def test_hosted_microcards_service_imports_cards_into_hosted_deck_docs(svc):
    result = svc.import_cards_from_parsed(
        parsed_items=[
            {
                "status": "ok",
                "card_preview": {
                    "card_type": "fact_recall",
                    "front": "Question",
                    "back": "Answer",
                },
                "metadata": {"tags": ["imported"], "difficulty": "medium"},
            }
        ],
        mode="create_deck",
        deck_name="Imported hosted deck",
        target_language="en",
    )

    deck = result["deck"]
    assert deck["name"] == "Imported hosted deck"
    assert result["added_cards"] == 1
    assert svc.get_deck(deck["id"])["cards"][0]["front"]["text"] == "Question"


def test_hosted_microcards_service_does_not_bootstrap_decks_from_shadow_files(tmp_path, persistence_settings):
    decks_dir = tmp_path / "microcards" / "decks"
    decks_dir.mkdir(parents=True, exist_ok=True)
    (decks_dir / "legacy_shadow.json").write_text(
        '{"id":"legacy_shadow","name":"Legacy shadow deck","cards":[],"meta":{"updated_at":"2026-04-19T00:00:00Z"}}',
        encoding="utf-8",
    )

    service = HostedMicrocardsService(
        data_dir=str(tmp_path),
        user_id="user_hosted_microcards",
        persistence_settings=persistence_settings,
    )
    service.repository = _InMemoryHostedMicrocardsRepository()
    service.review_repository = _InMemoryHostedMicrocardsReviewRepository()

    assert service.list_decks() == []
    assert service.repository.decks == {}


def test_hosted_microcards_service_persists_queue_and_review_runtime_docs(svc):
    deck = svc.create_deck_manual(name="Review deck", target_language="en")
    import_result = svc.import_cards_from_parsed(
        parsed_items=[
            {
                "status": "ok",
                "card_preview": {
                    "card_type": "fact_recall",
                    "front": "Question",
                    "back": "Answer",
                },
                "metadata": {"tags": ["review"], "difficulty": "medium"},
            }
        ],
        mode="append_to_deck",
        target_deck_id=deck["id"],
    )
    card_id = import_result["deck"]["cards"][0]["id"]

    queue_payload = svc.get_due_queue(deck["id"], limit=10)
    assert queue_payload["current_card"]["id"] == card_id
    session_id = queue_payload["session"]["id"]

    review_payload = svc.submit_review(
        deck_id=deck["id"],
        card_id=card_id,
        rating="good",
        session_id=session_id,
        response_time_ms=900,
    )

    assert review_payload["review_state"]["card_id"] == card_id
    assert review_payload["review_event"]["rating"] == "good"
    assert svc.review_repository.get_document("user_hosted_microcards", "review_states")[card_id]["last_rating"] == "good"
    assert svc.review_repository.get_document("user_hosted_microcards", "review_events")[0]["card_id"] == card_id
    sessions_payload = svc.review_repository.get_document("user_hosted_microcards", "review_sessions")
    assert sessions_payload["items"][session_id]["completed"] is True
    assert svc.list_decks()[0]["stats"]["cards_review"] == 1


def test_hosted_microcards_service_does_not_bootstrap_review_state_from_shadow_files(tmp_path, persistence_settings):
    user_dir = tmp_path / "users" / "user_hosted_microcards" / "microcards"
    user_dir.mkdir(parents=True, exist_ok=True)
    (user_dir / "review_states.json").write_text(
        '{"items":{"shadow_card":{"status":"review","last_rating":"easy"}}}',
        encoding="utf-8",
    )
    (user_dir / "review_events.json").write_text(
        '{"items":[{"id":"shadow_event","card_id":"shadow_card","rating":"easy"}]}',
        encoding="utf-8",
    )
    (user_dir / "review_sessions.json").write_text(
        '{"schema_version":"1.0","user_id":"user_hosted_microcards","active_by_deck":{"shadow":"sess"},"items":{"sess":{"id":"sess"}}}',
        encoding="utf-8",
    )

    service = HostedMicrocardsService(
        data_dir=str(tmp_path),
        user_id="user_hosted_microcards",
        persistence_settings=persistence_settings,
    )
    service.repository = _InMemoryHostedMicrocardsRepository()
    service.review_repository = _InMemoryHostedMicrocardsReviewRepository()

    assert service._read_states() == {}
    assert service._read_sessions()["active_by_deck"] == {}
    assert service.review_repository.documents == {}


def test_hosted_microcards_service_blocks_shadow_reads_when_postgres_is_unavailable(tmp_path, persistence_settings, monkeypatch):
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)
    service = HostedMicrocardsService(
        data_dir=str(tmp_path),
        user_id="user_hosted_microcards",
        persistence_settings=persistence_settings,
    )
    service.repository = _FailingHostedMicrocardsRepository()

    with pytest.raises(HostedShadowReadFallbackDisabledError) as exc_info:
        service.list_decks()

    assert exc_info.value.operation == "microcards.decks.list"
    assert exc_info.value.reason == "postgres_unavailable_for_test"


def test_hosted_microcards_service_blocks_shadow_writes_when_postgres_is_unavailable(tmp_path, persistence_settings, monkeypatch):
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)
    service = HostedMicrocardsService(
        data_dir=str(tmp_path),
        user_id="user_hosted_microcards",
        persistence_settings=persistence_settings,
    )
    service.repository = _FailingHostedMicrocardsRepository()

    with pytest.raises(HostedShadowWriteFallbackDisabledError) as exc_info:
        service.create_deck_manual(name="Blocked deck")

    assert exc_info.value.operation == "microcards.decks.write"
    assert exc_info.value.reason == "postgres_unavailable_for_test"
