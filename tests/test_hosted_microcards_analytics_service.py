import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from persistence.postgres import PostgresUnavailableError  # type: ignore
from persistence.runtime import PersistenceRuntimeSettings  # type: ignore
from services.hosted_microcards_analytics_service import HostedMicrocardsAnalyticsService  # type: ignore
from services.hosted_shadow_fallback import HostedShadowReadFallbackDisabledError  # type: ignore


class _InMemoryHostedMicrocardsRepository:
    def __init__(self) -> None:
        self.decks = {}
        self.schema_ready = False

    def ensure_schema(self) -> None:
        self.schema_ready = True

    def list_decks(self, *, limit: int = 500):
        items = list(self.decks.values())
        return items[: max(1, min(int(limit or 500), 500))]


class _InMemoryHostedMicrocardsReviewRepository:
    def __init__(self) -> None:
        self.documents = {}
        self.schema_ready = False

    def ensure_schema(self) -> None:
        self.schema_ready = True

    def get_document(self, user_id: str, doc_kind: str):
        return self.documents.get((str(user_id or "").strip(), str(doc_kind or "").strip()))

    def write_document(self, user_id: str, doc_kind: str, payload, *, updated_at: str) -> None:
        self.documents[(str(user_id or "").strip(), str(doc_kind or "").strip())] = payload

    def import_document_if_absent(self, user_id: str, doc_kind: str, payload, *, updated_at: str) -> None:
        self.documents.setdefault((str(user_id or "").strip(), str(doc_kind or "").strip()), payload)


class _FailingHostedMicrocardsRepository:
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


def test_hosted_microcards_analytics_service_reads_hosted_review_documents(persistence_settings, tmp_path):
    service = HostedMicrocardsAnalyticsService(
        data_dir=str(tmp_path),
        persistence_settings=persistence_settings,
    )
    service.deck_repository = _InMemoryHostedMicrocardsRepository()
    service.review_repository = _InMemoryHostedMicrocardsReviewRepository()

    user_id = "user_microcards_analytics"
    tomorrow_iso = (
        (datetime.now(timezone.utc) + timedelta(days=1))
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )
    reviewed_at_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    service.deck_repository.decks["deck_analytics"] = {
        "id": "deck_analytics",
        "name": "Hosted analytics deck",
        "cards": [
            {"id": "mc_review", "card_type": "fact_recall", "status": "active"},
            {"id": "mc_new", "card_type": "fact_recall", "status": "active"},
        ],
    }
    service.review_repository.write_document(
        user_id,
        "review_states",
        {
            "mc_review": {
                "status": "review",
                "due_at": tomorrow_iso,
                "last_rating": "good",
            }
        },
        updated_at="2026-04-19T00:00:00Z",
    )
    service.review_repository.write_document(
        user_id,
        "review_events",
        [
            {
                "id": "mcrev_analytics",
                "user_id": user_id,
                "card_id": "mc_review",
                "reviewed_at": reviewed_at_iso,
                "rating": "good",
                "response_time_ms": 1500,
                "was_correct": True,
                "details": {"card_type": "fact_recall"},
            }
        ],
        updated_at="2026-04-19T00:00:00Z",
    )

    payload = service.get_summary(
        user_id=user_id,
        force_refresh=True,
        include_dynamics=True,
        dynamics_days=7,
    )

    assert payload["user_id"] == user_id
    assert payload["totals"]["reviews"] == 1
    assert payload["totals"]["correct_reviews"] == 1
    assert payload["totals"]["time_spent_seconds"] == 1
    assert payload["totals"]["decks_active"] == 1
    assert payload["queue_summary"]["decks_with_due"] == 1
    assert payload["queue_summary"]["cards_due_total"] == 1
    assert payload["queue_summary"]["cards_new_total"] == 1
    assert payload["by_card_type"]["fact_recall"]["reviews"] == 1
    assert payload["ratings_distribution"]["good"] == 1
    assert len(payload["dynamics"]) == 1
    assert payload["dynamics"][0]["reviews"] == 1


def test_hosted_microcards_analytics_service_does_not_bootstrap_shadow_review_documents(
    persistence_settings,
    tmp_path,
):
    service = HostedMicrocardsAnalyticsService(
        data_dir=str(tmp_path),
        persistence_settings=persistence_settings,
    )
    service.deck_repository = _InMemoryHostedMicrocardsRepository()
    service.review_repository = _InMemoryHostedMicrocardsReviewRepository()

    user_id = "user_microcards_analytics"
    service.deck_repository.decks["deck_shadow_only"] = {
        "id": "deck_shadow_only",
        "name": "Shadow-only deck",
        "cards": [{"id": "mc_shadow", "card_type": "fact_recall", "status": "active"}],
    }
    user_dir = tmp_path / "users" / user_id / "microcards"
    user_dir.mkdir(parents=True, exist_ok=True)
    (user_dir / "review_states.json").write_text(
        '{"items":{"mc_shadow":{"status":"review","due_at":"2026-04-20T00:00:00Z","last_rating":"easy"}}}',
        encoding="utf-8",
    )
    (user_dir / "review_events.json").write_text(
        '{"items":[{"id":"shadow_event","user_id":"user_microcards_analytics","card_id":"mc_shadow","reviewed_at":"2026-04-19T00:00:00Z","rating":"easy","was_correct":true,"details":{"card_type":"fact_recall"}}]}',
        encoding="utf-8",
    )

    payload = service.get_summary(
        user_id=user_id,
        force_refresh=True,
        include_dynamics=True,
        dynamics_days=7,
    )

    assert payload["totals"]["reviews"] == 0
    assert payload["queue_summary"]["cards_due_total"] == 1
    assert payload["queue_summary"]["cards_new_total"] == 1
    assert payload["dynamics"] == []
    assert service.review_repository.documents == {}


def test_hosted_microcards_analytics_service_blocks_shadow_reads_when_postgres_is_unavailable(
    persistence_settings,
    tmp_path,
    monkeypatch,
):
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)
    service = HostedMicrocardsAnalyticsService(
        data_dir=str(tmp_path),
        persistence_settings=persistence_settings,
    )
    service.deck_repository = _FailingHostedMicrocardsRepository()

    with pytest.raises(HostedShadowReadFallbackDisabledError) as exc_info:
        service.get_summary(user_id="user_microcards_analytics", force_refresh=True)

    assert exc_info.value.operation == "microcards.analytics.summary"
    assert exc_info.value.reason == "postgres_unavailable_for_test"
