import sys
import tempfile
import json
from pathlib import Path
from flask import Flask

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.microcards_service_v2 import MicrocardsServiceV2
from routes.microcards_routes_v2 import microcards_v2_bp
import routes.microcards_routes_v2 as routes_v2


def test_service_pause_resume_discard():
    tmp_dir = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp_dir, user_id="test_user")
    
    # 1. Create a deck and some cards
    deck = svc.create_deck(name="Test Deck", description="Description")
    deck_id = deck["id"]
    card1 = svc.create_card(deck_id, front_text="Q1", back_text="A1")
    card2 = svc.create_card(deck_id, front_text="Q2", back_text="A2")

    # 2. Start session (initial run)
    session = svc.start_session(deck_id, resume=True, restart=True, level_mode=1)
    session_id = session["id"]
    assert session["paused"] is False
    assert session["combo"] == 0
    assert len(session["card_queue"]) == 2

    # 3. Pause session and store metrics
    svc.pause_session(
        session_id=session_id,
        combo=3,
        max_combo=5,
        session_xp=15
    )

    # 4. Check list_decks returns pause status
    decks = svc.list_decks()
    assert len(decks) == 1
    assert decks[0]["is_paused"] is True
    assert decks[0]["paused_progress"] == "0/2"
    assert decks[0]["active_session_id"] == session_id
    assert decks[0]["active_session_level_mode"] == 1

    # 5. Retrieve deck directly and check pause status
    deck_details = svc.get_deck(deck_id)
    # Check that service-level get_deck itself is unaltered, but routes layer adds dynamic fields.
    # So we test route serialization later.

    # 6. Resume session (resume=True, restart=False)
    resumed = svc.start_session(deck_id, resume=True, restart=False, level_mode=1)
    assert resumed["id"] == session_id
    assert resumed["paused"] is False
    assert resumed["combo"] == 3
    assert resumed["session_xp"] == 15

    # 7. Pause again
    svc.pause_session(session_id, combo=1, max_combo=1)
    
    # 8. Discard session
    svc.discard_session(session_id)
    decks = svc.list_decks()
    assert decks[0]["is_paused"] is False
    assert decks[0]["active_session_id"] is None


class FakeCtx:
    def __init__(self, data_dir, user_id="test_user"):
        self.data_dir = data_dir
        self.user_id = user_id
        self.catalog_service = None


def test_routes_pause_resume_discard(monkeypatch):
    tmp_dir = tempfile.mkdtemp()
    
    # Setup mock context for routes
    fake_ctx = FakeCtx(tmp_dir)
    monkeypatch.setattr(routes_v2, "get_ctx", lambda: fake_ctx)
    monkeypatch.setattr(routes_v2, "_check_guest", lambda: None)

    app = Flask(__name__)
    app.register_blueprint(microcards_v2_bp, url_prefix="/api/v2/microcards")

    # Use direct service to create deck/cards
    svc = MicrocardsServiceV2(tmp_dir, user_id="test_user")
    deck = svc.create_deck(name="Route Deck")
    deck_id = deck["id"]
    svc.create_card(deck_id, front_text="Q1", back_text="A1")

    with app.test_client() as client:
        # 1. Start session
        res = client.post(f"/api/v2/microcards/decks/{deck_id}/session/start", json={
            "resume": True,
            "restart": True,
            "level_mode": 1
        })
        assert res.status_code == 200
        data = res.get_json()
        assert data["ok"] is True
        session_id = data["session"]["id"]

        # 2. Pause session
        res_pause = client.post(f"/api/v2/microcards/session/{session_id}/pause", json={
            "combo": 4,
            "max_combo": 10,
            "session_xp": 40
        })
        assert res_pause.status_code == 200
        assert res_pause.get_json()["ok"] is True

        # 3. GET deck details (should append active session info)
        res_deck = client.get(f"/api/v2/microcards/decks/{deck_id}")
        assert res_deck.status_code == 200
        deck_data = res_deck.get_json()["deck"]
        assert deck_data["is_paused"] is True
        assert deck_data["active_session_id"] == session_id
        assert deck_data["paused_progress"] == "0/1"

        # 4. Resume session
        res_resume = client.post(f"/api/v2/microcards/session/{session_id}/resume")
        assert res_resume.status_code == 200
        assert res_resume.get_json()["ok"] is True
        assert res_resume.get_json()["session"]["paused"] is False

        # 5. Discard session
        res_discard = client.post(f"/api/v2/microcards/session/{session_id}/discard")
        assert res_discard.status_code == 200
        assert res_discard.get_json()["ok"] is True
        
        # Verify it is no longer paused
        res_deck2 = client.get(f"/api/v2/microcards/decks/{deck_id}")
        assert res_deck2.get_json()["deck"]["is_paused"] is False
        assert res_deck2.get_json()["deck"]["active_session_id"] is None
