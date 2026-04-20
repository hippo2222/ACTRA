import sys
from pathlib import Path

import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

import server  # type: ignore
import routes._context as ctx_module  # type: ignore
import routes.microcards_routes as microcards_routes_module  # type: ignore
from services.hosted_shadow_fallback import (  # type: ignore
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)
from services.microcards_analytics_service import MicrocardsAnalyticsService  # type: ignore


class _DummyHostedUser:
    def __init__(self, user_id: str):
        self.user_id = user_id


class _DummyHostedUserService:
    def __init__(self, user_id: str):
        self._user = _DummyHostedUser(user_id)

    def get_user(self, user_id: str):
        return self._user if str(user_id or "").strip() == self._user.user_id else None


class _DummyMicrocardParser:
    def parse_text(self, text: str):
        return {
            "ok": True,
            "summary": {"total": 1, "valid": 1, "errors": 0},
            "items": [
                {
                    "front_text": text.strip() or "Prompt",
                    "back_text": "Answer",
                    "card_type": "fact_recall",
                }
            ],
        }


class _DummyHostedMicrocardsService:
    hosted_service_contract = {
        "namespace": "hosted_microcards_runtime",
        "source_of_truth": "postgres",
        "hosted_ready": True,
        "surface_scope": "deck_documents_review_state",
    }

    def __init__(self, user_id: str):
        self.user_id = user_id
        self.decks = {}
        self.review_states = {}
        self.review_events = []
        self.sessions = {}
        self.active_by_deck = {}
        self._deck_seq = 0
        self._card_seq = 0
        self._session_seq = 0
        self._event_seq = 0
        self.raise_on_list = None
        self.raise_on_get = None
        self.raise_on_create_manual = None
        self.raise_on_import = None
        self.raise_on_queue = None
        self.raise_on_submit = None

    def _next_deck_id(self) -> str:
        self._deck_seq += 1
        return f"deck_{self._deck_seq:04d}"

    def _next_card_id(self) -> str:
        self._card_seq += 1
        return f"mc_{self._card_seq:04d}"

    def _next_session_id(self) -> str:
        self._session_seq += 1
        return f"mcsess_{self._session_seq:04d}"

    def _next_event_id(self) -> str:
        self._event_seq += 1
        return f"mcrev_{self._event_seq:04d}"

    def _stats(self, deck: dict) -> dict:
        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        cards_total = 0
        cards_new = 0
        cards_due = 0
        cards_review = 0
        cards_suspended = 0
        for card in cards:
            if not isinstance(card, dict):
                continue
            if str(card.get("status") or "active").strip().lower() == "archived":
                continue
            cards_total += 1
            card_id = str(card.get("id") or "").strip()
            state = self.review_states.get(card_id) if card_id else None
            state = state if isinstance(state, dict) else {}
            state_status = str(state.get("status") or "").strip().lower()
            if state_status == "suspended" or str(card.get("status") or "").strip().lower() == "suspended":
                cards_suspended += 1
                continue
            if not state or state_status in {"", "new"}:
                cards_new += 1
                cards_due += 1
            else:
                cards_review += 1
                cards_due += 1
        return {
            "cards_total": cards_total,
            "cards_new": cards_new,
            "cards_due": cards_due,
            "cards_review": cards_review,
            "cards_suspended": cards_suspended,
        }

    def _deck_summary(self, deck: dict) -> dict:
        return {
            "id": deck["id"],
            "schema_version": deck.get("schema_version"),
            "name": deck.get("name"),
            "analysis_id": deck.get("analysis_id"),
            "target_language": deck.get("target_language"),
            "selector": deck.get("selector") or {},
            "settings": deck.get("settings") or {},
            "meta": deck.get("meta") or {},
            "ownership": {
                "scope": "workspace",
                "content_scope": "shared_local",
                "created_by_user_id": self.user_id,
                "updated_by_user_id": self.user_id,
                "created_via": (deck.get("meta") or {}).get("source") or "manual_editor",
                "has_owner": True,
                "is_owned_by_current_user": True,
                "is_shared_library": True,
            },
            "stats": self._stats(deck),
        }

    def list_decks(self, limit: int = 100):
        if self.raise_on_list is not None:
            raise self.raise_on_list
        items = [self._deck_summary(deck) for deck in self.decks.values()]
        return items[: max(1, min(int(limit or 100), 500))]

    def get_deck(self, deck_id: str):
        if self.raise_on_get is not None:
            raise self.raise_on_get
        deck = self.decks.get(str(deck_id or "").strip())
        return dict(deck) if isinstance(deck, dict) else None

    def create_deck_manual(self, *, name: str, tags=None, target_language: str = "unknown"):
        if self.raise_on_create_manual is not None:
            raise self.raise_on_create_manual
        deck_id = self._next_deck_id()
        deck = {
            "id": deck_id,
            "schema_version": "1.0",
            "name": str(name or "").strip(),
            "analysis_id": None,
            "source_material_fingerprint": None,
            "target_language": str(target_language or "unknown").strip() or "unknown",
            "card_ids": [],
            "cards": [],
            "tags": list(tags or []),
            "settings": {"scheduler": "sm2_mvp", "new_cards_per_day": 20, "max_reviews_per_day": 100},
            "selector": {},
            "meta": {
                "created_at": "2026-04-19T00:00:00Z",
                "updated_at": "2026-04-19T00:00:00Z",
                "created_by_user_id": self.user_id,
                "updated_by_user_id": self.user_id,
                "content_scope": "shared_local",
                "source": "manual_editor",
            },
        }
        self.decks[deck_id] = deck
        return dict(deck)

    def import_cards_from_parsed(
        self,
        *,
        parsed_items,
        mode: str = "create_deck",
        target_deck_id=None,
        deck_name=None,
        target_language: str = "unknown",
    ):
        if self.raise_on_import is not None:
            raise self.raise_on_import
        if mode == "append_to_deck":
            deck = self.decks.get(str(target_deck_id or "").strip())
            if not isinstance(deck, dict):
                raise LookupError("deck_not_found")
        else:
            deck = self.create_deck_manual(
                name=deck_name or "Imported",
                tags=[],
                target_language=target_language,
            )
            self.decks[deck["id"]] = deck
        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        added_cards = 0
        for item in parsed_items or []:
            if not isinstance(item, dict):
                continue
            front_text = str(item.get("front_text") or "").strip()
            back_text = str(item.get("back_text") or "").strip()
            if not front_text or not back_text:
                continue
            cards.append(
                {
                    "id": self._next_card_id(),
                    "deck_id": deck["id"],
                    "card_type": str(item.get("card_type") or "fact_recall").strip() or "fact_recall",
                    "front": {"text": front_text, "payload": {}},
                    "back": {"text": back_text, "payload": {}},
                    "status": "active",
                }
            )
            added_cards += 1
        deck["cards"] = cards
        deck["card_ids"] = [card["id"] for card in cards if isinstance(card, dict) and card.get("id")]
        self.decks[deck["id"]] = deck
        return {
            "deck": dict(deck),
            "added_cards": added_cards,
            "skipped_duplicates": 0,
            "skipped_errors": 0,
        }

    def get_due_queue(self, deck_id: str, limit: int = 20, *, resume: bool = True, restart: bool = False):
        if self.raise_on_queue is not None:
            raise self.raise_on_queue
        deck = self.decks.get(str(deck_id or "").strip())
        if not isinstance(deck, dict):
            raise LookupError("deck_not_found")
        cards = [card for card in (deck.get("cards") or []) if isinstance(card, dict)]
        session_id = None if restart else self.active_by_deck.get(deck["id"])
        session = self.sessions.get(session_id) if session_id else None
        if not isinstance(session, dict) or bool(session.get("completed")):
            queue_ids = [str(card.get("id")) for card in cards[: max(1, min(int(limit or 20), 100))]]
            session = {
                "id": self._next_session_id(),
                "schema_version": "1.0",
                "user_id": self.user_id,
                "deck_id": deck["id"],
                "created_at": "2026-04-19T00:00:00Z",
                "updated_at": "2026-04-19T00:00:00Z",
                "card_queue": queue_ids,
                "cursor": 0,
                "completed": len(queue_ids) == 0,
            }
            self.sessions[session["id"]] = session
            if not session["completed"]:
                self.active_by_deck[deck["id"]] = session["id"]
        queue_ids = [str(cid) for cid in session.get("card_queue") or []]
        cursor = int(session.get("cursor") or 0)
        queue_cards = [card for card in cards if str(card.get("id")) in set(queue_ids)]
        current_card = queue_cards[cursor] if cursor < len(queue_cards) else None
        queue_states = {
            cid: self.review_states[cid]
            for cid in queue_ids
            if cid in self.review_states and isinstance(self.review_states[cid], dict)
        }
        return {
            "deck": {
                "id": deck["id"],
                "name": deck.get("name"),
                "analysis_id": deck.get("analysis_id"),
                "target_language": deck.get("target_language"),
                "settings": deck.get("settings") or {},
            },
            "session": dict(session),
            "cursor": cursor,
            "queue_count": len(queue_cards),
            "current_card": dict(current_card) if isinstance(current_card, dict) else None,
            "queue": queue_cards,
            "queue_states": queue_states,
            "stats": self._stats(deck),
        }

    def submit_review(
        self,
        *,
        deck_id: str,
        card_id: str,
        rating: str,
        session_id=None,
        response=None,
        response_time_ms=None,
    ):
        if self.raise_on_submit is not None:
            raise self.raise_on_submit
        deck = self.decks.get(str(deck_id or "").strip())
        if not isinstance(deck, dict):
            raise LookupError("deck_not_found")
        card = next(
            (item for item in (deck.get("cards") or []) if isinstance(item, dict) and str(item.get("id")) == str(card_id)),
            None,
        )
        if not isinstance(card, dict):
            raise LookupError("card_not_found")
        state = {
            "schema_version": "1.0",
            "status": "review",
            "card_id": str(card_id),
            "user_id": self.user_id,
            "due_at": "2026-04-20T00:00:00Z",
            "last_reviewed_at": "2026-04-19T00:00:00Z",
            "last_rating": rating,
            "interval_days": 1,
            "repetitions": 1,
            "lapses": 0,
            "ease": 2.5,
            "stability_hint": "low",
        }
        self.review_states[str(card_id)] = state
        session = self.sessions.get(str(session_id or "").strip()) if session_id else None
        if isinstance(session, dict):
            session["cursor"] = int(session.get("cursor") or 0) + 1
            session["completed"] = bool(session["cursor"] >= len(session.get("card_queue") or []))
            self.sessions[session["id"]] = session
            if session["completed"] and self.active_by_deck.get(deck["id"]) == session["id"]:
                self.active_by_deck.pop(deck["id"], None)
        event = {
            "id": self._next_event_id(),
            "user_id": self.user_id,
            "card_id": str(card_id),
            "session_id": str(session_id or "").strip() or None,
            "reviewed_at": "2026-04-19T00:00:00Z",
            "rating": rating,
            "response_time_ms": response_time_ms,
            "was_correct": rating != "again",
            "details": {"card_type": str(card.get("card_type") or "fact_recall")},
        }
        self.review_events.append(event)
        return {
            "review_state": dict(state),
            "review_event": dict(event),
            "session": dict(session) if isinstance(session, dict) else None,
            "deck_stats": self._stats(deck),
        }


class _DummyHostedMicrocardsAnalyticsService:
    hosted_service_contract = {
        "namespace": "hosted_microcards_runtime",
        "source_of_truth": "postgres",
        "hosted_ready": True,
        "surface_scope": "review_state_analytics",
    }

    def __init__(self, microcards_service: _DummyHostedMicrocardsService):
        self._svc = microcards_service
        self.raise_on_summary = None

    def get_summary(self, *, user_id: str, force_refresh: bool = False, include_dynamics: bool = False, dynamics_days: int = 30):
        if self.raise_on_summary is not None:
            raise self.raise_on_summary
        reviews = len(self._svc.review_events)
        correct_reviews = sum(1 for event in self._svc.review_events if bool(event.get("was_correct")))
        payload = {
            "user_id": user_id,
            "generated_at": "2026-04-19T00:00:00Z",
            "totals": {
                "reviews": reviews,
                "correct_reviews": correct_reviews,
                "correct_rate": 0.0 if reviews <= 0 else round(float(correct_reviews) / float(reviews), 3),
                "time_spent_seconds": 0,
                "decks_active": len(self._svc.decks),
            },
            "today": {
                "reviews": reviews,
                "correct_reviews": correct_reviews,
                "correct_rate": 0.0 if reviews <= 0 else round(float(correct_reviews) / float(reviews), 3),
                "time_spent_seconds": 0,
            },
            "queue_summary": {
                "decks_with_due": sum(1 for deck in self._svc.decks.values() if self._svc._stats(deck)["cards_due"] > 0),
                "cards_due_total": sum(self._svc._stats(deck)["cards_due"] for deck in self._svc.decks.values()),
                "cards_new_total": sum(self._svc._stats(deck)["cards_new"] for deck in self._svc.decks.values()),
            },
            "by_card_type": {},
            "ratings_distribution": {"again": 0, "hard": 0, "good": 0, "easy": 0},
        }
        if include_dynamics:
            payload["dynamics"] = [
                {
                    "date": "2026-04-19",
                    "reviews": reviews,
                    "correct_reviews": correct_reviews,
                    "correct_rate": payload["today"]["correct_rate"],
                    "time_spent_seconds": 0,
                    "by_card_type": {},
                    "ratings_distribution": {"again": 0, "hard": 0, "good": 0, "easy": 0},
                }
            ]
        return payload


@pytest.fixture
def hosted_client(monkeypatch):
    user_id = "user_microcards_contract"
    microcards_service = _DummyHostedMicrocardsService(user_id=user_id)
    analytics_service = _DummyHostedMicrocardsAnalyticsService(microcards_service)
    helpers = {
        "is_editor_feature_enabled": lambda name: True,
        "is_microcards_prod_feature_enabled": lambda name: True,
        "feature_disabled_json": lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("feature-disabled helper should not be used")),
        "microcards_prod_feature_disabled_json": lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("feature-disabled helper should not be used")),
        "microcards_service": lambda: microcards_service,
        "microcards_analytics_service": lambda: analytics_service,
        "invalidate_microcards_analytics_cache": lambda user_id: True,
        "emit_theory_rollout_telemetry": lambda *args, **kwargs: None,
        "emit_microcards_prod_telemetry": lambda *args, **kwargs: None,
        "get_microcards_prod_feature_flags": lambda: {"microcards_mode": True},
        "PARSERS_AVAILABLE": True,
        "MicrocardParser": _DummyMicrocardParser,
        "orchestrate_microcards_review_post_submit": lambda **kwargs: None,
    }
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setattr(microcards_routes_module, "_mch", lambda: helpers)
    app_ctx = getattr(ctx_module, "_app_ctx", None)
    monkeypatch.setattr(app_ctx, "user_service", _DummyHostedUserService(user_id), raising=False)
    server.app.config["TESTING"] = True
    with server.app.test_client() as client:
        with client.session_transaction() as session:
            session[ctx_module._AUTH_USER_ID_SESSION_KEY] = user_id
        yield client, microcards_service, analytics_service


def _assert_public_microcards_contract(payload: dict, *, mode: str, surface: str) -> None:
    route_contract = payload["route_contract"]
    assert route_contract["namespace"] == "public_microcards"
    assert route_contract["mode"] == mode
    assert route_contract["surface"] == surface
    assert route_contract["public_api"] is True
    assert route_contract["hosted_storage_required"] is True


def test_microcards_summary_uses_hosted_runtime_service(hosted_client):
    client, service, _analytics = hosted_client
    deck = service.create_deck_manual(name="Hosted deck")
    service.import_cards_from_parsed(
        parsed_items=[{"front_text": "Q", "back_text": "A"}],
        mode="append_to_deck",
        target_deck_id=deck["id"],
    )

    response = client.get("/api/microcards/summary?include_dynamics=1")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["totals"]["decks_active"] == 1
    assert payload["queue_summary"]["cards_due_total"] == 1
    assert payload["microcards_feature_flags"]["microcards_mode"] is True
    assert len(payload["dynamics"]) == 1


def test_microcards_summary_surfaces_explicit_hosted_degraded_when_read_blocked(hosted_client):
    client, _service, analytics_service = hosted_client
    analytics_service.raise_on_summary = HostedShadowReadFallbackDisabledError(
        "microcards.analytics.summary",
        reason="test_microcards_analytics_read_blocked",
    )

    response = client.get("/api/microcards/summary")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["error"] == "hosted_shadow_read_blocked"
    assert payload["details"]["operation"] == "microcards.analytics.summary"
    assert payload["details"]["reason"] == "test_microcards_analytics_read_blocked"
    _assert_public_microcards_contract(payload, mode="summary", surface="runtime_summary")
    assert payload["service_contract"]["namespace"] == "hosted_microcards_runtime"


def test_microcards_create_list_and_get_deck_use_hosted_service(hosted_client):
    client, _service, _analytics = hosted_client

    create_response = client.post(
        "/api/editor/microcards/decks/create-manual",
        json={"name": "Hosted deck", "target_language": "en"},
    )
    assert create_response.status_code == 200
    create_payload = create_response.get_json()
    deck_id = create_payload["deck"]["id"]

    list_response = client.get("/api/editor/microcards/decks")
    assert list_response.status_code == 200
    list_payload = list_response.get_json()
    assert list_payload["ok"] is True
    assert list_payload["items"][0]["id"] == deck_id
    assert list_payload["items"][0]["stats"]["cards_total"] == 0

    get_response = client.get(f"/api/editor/microcards/decks/{deck_id}")
    assert get_response.status_code == 200
    get_payload = get_response.get_json()
    assert get_payload["deck"]["id"] == deck_id
    assert get_payload["deck"]["target_language"] == "en"


def test_microcards_create_manual_surfaces_explicit_hosted_degraded_when_write_blocked(hosted_client):
    client, service, _analytics = hosted_client
    service.raise_on_create_manual = HostedShadowWriteFallbackDisabledError(
        "microcards.decks.write",
        reason="test_microcards_write_blocked",
    )

    response = client.post(
        "/api/editor/microcards/decks/create-manual",
        json={"name": "Hosted deck"},
    )

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["error"] == "hosted_shadow_write_blocked"
    assert payload["details"]["operation"] == "microcards.decks.write"
    assert payload["details"]["reason"] == "test_microcards_write_blocked"
    _assert_public_microcards_contract(payload, mode="create_manual_deck", surface="manual_editor")
    assert payload["service_contract"]["namespace"] == "hosted_microcards_runtime"


def test_microcards_list_surfaces_explicit_hosted_degraded_when_read_blocked(hosted_client):
    client, service, _analytics = hosted_client
    service.raise_on_list = HostedShadowReadFallbackDisabledError(
        "microcards.decks.list",
        reason="test_microcards_read_blocked",
    )

    response = client.get("/api/editor/microcards/decks")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["error"] == "hosted_shadow_read_blocked"
    assert payload["details"]["operation"] == "microcards.decks.list"
    assert payload["details"]["reason"] == "test_microcards_read_blocked"
    _assert_public_microcards_contract(payload, mode="list_decks", surface="deck_library")
    assert payload["service_contract"]["namespace"] == "hosted_microcards_runtime"


def test_microcards_queue_and_review_submit_run_in_hosted_runtime(hosted_client):
    client, service, _analytics = hosted_client
    import_response = client.post(
        "/api/editor/microcards/import/execute-text",
        json={
            "items": [{"front_text": "A", "back_text": "B"}],
            "mode": "create_deck",
            "deck_name": "Imported",
        },
    )
    assert import_response.status_code == 200
    deck_id = import_response.get_json()["deck_id"]

    queue_response = client.get(f"/api/editor/microcards/decks/{deck_id}/queue")
    assert queue_response.status_code == 200
    queue_payload = queue_response.get_json()
    session_id = queue_payload["session"]["id"]
    card_id = queue_payload["current_card"]["id"]

    review_response = client.post(
        "/api/editor/microcards/review/submit",
        json={
            "deck_id": deck_id,
            "card_id": card_id,
            "rating": "good",
            "session_id": session_id,
            "response_time_ms": 1200,
        },
    )
    assert review_response.status_code == 200
    review_payload = review_response.get_json()
    assert review_payload["ok"] is True
    assert review_payload["review_state"]["card_id"] == card_id
    assert review_payload["review_event"]["rating"] == "good"
    assert len(service.review_events) == 1


def test_microcards_queue_surfaces_explicit_hosted_degraded_when_read_blocked(hosted_client):
    client, service, _analytics = hosted_client
    service.raise_on_queue = HostedShadowReadFallbackDisabledError(
        "microcards.review.sessions.read",
        reason="test_microcards_queue_read_blocked",
    )

    response = client.get("/api/editor/microcards/decks/deck_0001/queue")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["error"] == "hosted_shadow_read_blocked"
    assert payload["details"]["operation"] == "microcards.review.sessions.read"
    _assert_public_microcards_contract(payload, mode="deck_queue", surface="review_runtime")
    assert payload["service_contract"]["namespace"] == "hosted_microcards_runtime"


def test_microcards_review_submit_surfaces_explicit_hosted_degraded_when_write_blocked(hosted_client):
    client, service, _analytics = hosted_client
    service.raise_on_submit = HostedShadowWriteFallbackDisabledError(
        "microcards.review.events.append",
        reason="test_microcards_review_write_blocked",
    )
    deck = service.create_deck_manual(name="Review deck")
    service.import_cards_from_parsed(
        parsed_items=[{"front_text": "Q", "back_text": "A"}],
        mode="append_to_deck",
        target_deck_id=deck["id"],
    )

    response = client.post(
        "/api/editor/microcards/review/submit",
        json={
            "deck_id": deck["id"],
            "card_id": service.decks[deck["id"]]["cards"][0]["id"],
            "rating": "good",
        },
    )

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["error"] == "hosted_shadow_write_blocked"
    assert payload["details"]["operation"] == "microcards.review.events.append"
    _assert_public_microcards_contract(payload, mode="submit_review", surface="review_runtime")
    assert payload["service_contract"]["namespace"] == "hosted_microcards_runtime"


def test_microcards_execute_text_import_runs_in_hosted_runtime(hosted_client):
    client, _service, _analytics = hosted_client
    response = client.post(
        "/api/editor/microcards/import/execute-text",
        json={
            "items": [{"front_text": "A", "back_text": "B"}],
            "mode": "create_deck",
            "deck_name": "Imported",
        },
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["mode"] == "create_deck"
    assert payload["deck_name"] == "Imported"
    assert payload["added_cards"] == 1


def test_microcards_parse_text_remains_available_in_hosted_runtime(hosted_client):
    client, _service, _analytics = hosted_client
    response = client.post(
        "/api/editor/microcards/import/parse-text",
        json={"text": "@MICROCARD\nQ :: A"},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["summary"]["valid"] == 1


def test_microcards_analytics_service_blocks_hosted_shadow_reads(monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    svc = MicrocardsAnalyticsService(data_dir=str(tmp_path))

    with pytest.raises(HostedShadowReadFallbackDisabledError) as exc_info:
        svc.get_summary(user_id="user_microcards_contract")

    assert exc_info.value.operation == "microcards.analytics.summary"
    assert exc_info.value.reason == "microcards_hosted_source_of_truth_not_implemented"
    monkeypatch.delenv("ACTRA_RUNTIME_MODE", raising=False)
