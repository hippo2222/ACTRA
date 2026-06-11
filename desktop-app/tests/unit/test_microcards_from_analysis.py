"""M1+M2 of the V1→V2 editor migration: from-analysis endpoints on V2 and
the calendar live hook for V2 reviews."""

import sys
import tempfile
from pathlib import Path

from flask import Flask

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from routes.microcards_routes_v2 import microcards_v2_bp
import routes.microcards_routes_v2 as routes_v2
from services.microcards_analysis_import import analysis_to_rows, deck_name_for_analysis
from services.microcards_service_v2 import MicrocardsServiceV2


def _analysis_payload():
    return {
        "educational_units": [
            {"id": 1, "title": "Os coxae", "description": "Тазовая кость", "chunk_ids": ["ch1"]},
            {"id": 2, "title": "Femur", "description": "Бедренная кость", "chunk_ids": ["ch1"]},
        ],
        "learning_chunks": [
            {"id": "ch1", "title": "Кости таза", "unit_ids": [1, 2]},
        ],
        "microcards_candidates": [
            {"card_type": "fact_recall", "unit_id": 1, "chunk_id": "ch1",
             "prompt_seed": "Os coxae?", "answer_seed": "Тазовая кость"},
            # Pair candidate → D2: flattened into an ordinary Q/A card.
            {"card_type": "pair_match", "unit_id": 2, "chunk_id": "ch1",
             "prompt_seed": "Femur", "answer_seed": "Бедренная кость"},
            # Broken candidate → error row.
            {"card_type": "fact_recall", "prompt_seed": "", "answer_seed": ""},
        ],
        "future_capabilities": [],
    }


def test_analysis_to_rows_maps_and_flattens_pairs():
    rows = analysis_to_rows(_analysis_payload(), {})
    ok = [r for r in rows if r["status"] == "ok"]
    errors = [r for r in rows if r["status"] == "error"]
    assert {(r["front"], r["back"]) for r in ok} == {
        ("Os coxae?", "Тазовая кость"),
        ("Femur", "Бедренная кость"),
    }
    assert all(r["hint"] == "Кости таза" for r in ok)  # chunk title becomes the hint
    assert len(errors) == 1

    # pair_match_only keeps only the flattened pair cards.
    pair_rows = analysis_to_rows(_analysis_payload(), {"pair_match_only": True})
    ok_pairs = [r for r in pair_rows if r["status"] == "ok"]
    assert {(r["front"], r["back"]) for r in ok_pairs} == {("Femur", "Бедренная кость")}

    # unit filter falls back to deriving a card from the unit itself.
    payload = _analysis_payload()
    payload["microcards_candidates"] = []
    derived = analysis_to_rows(payload, {"unit_id": 1})
    assert [(r["front"], r["back"]) for r in derived] == [("Os coxae", "Тазовая кость")]

    # future_capabilities pair signal synthesizes term→definition cards.
    payload2 = _analysis_payload()
    payload2["microcards_candidates"] = []
    payload2["future_capabilities"] = [
        {"capability_id": "pair_matching", "covers_chunk_ids": ["ch1"]},
    ]
    synth = analysis_to_rows(payload2, {})
    assert {(r["front"], r["back"]) for r in synth} == {
        ("Os coxae", "Тазовая кость"),
        ("Femur", "Бедренная кость"),
    }

    assert deck_name_for_analysis("run_1", {"pair_match_only": True}).startswith("Microcards / run_1")


class FakeCtx:
    def __init__(self, data_dir, user_id="test_user"):
        self.data_dir = data_dir
        self.user_id = user_id
        self.catalog_service = None


def _make_client(monkeypatch, tmp_dir, helpers):
    monkeypatch.setattr(routes_v2, "get_ctx", lambda: FakeCtx(tmp_dir))
    monkeypatch.setattr(routes_v2, "_check_guest", lambda: None)
    # Patch the helper accessor directly (monkeypatch restores it) — the
    # process-global extras registry stays untouched for other test modules.
    monkeypatch.setattr(routes_v2, "_server_helpers", lambda: helpers)
    app = Flask(__name__)
    app.register_blueprint(microcards_v2_bp, url_prefix="/api/v2/microcards")
    return app.test_client()


def test_from_analysis_routes_create_and_append(monkeypatch):
    tmp = tempfile.mkdtemp()
    helpers = {
        "is_valid_ai_run_id": lambda rid: rid == "run_1",
        "ai_run_build_reopen_analysis_response": lambda rid, apply_feature_flags=False: _analysis_payload(),
        "sanitize_analysis_for_microcards_backend": lambda p: p,
    }
    client = _make_client(monkeypatch, tmp, helpers)

    res = client.post("/api/v2/microcards/decks/from-analysis",
                      json={"ai_run_id": "run_1", "selector": {}})
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert data["added_count"] == 2
    deck_id = data["deck"]["id"]
    assert data["deck_summary"]["cards_total"] == 2
    assert data["deck"]["name"].startswith("Microcards / run_1")

    # Append the same analysis: dedup swallows everything.
    res2 = client.post(f"/api/v2/microcards/decks/{deck_id}/append-from-analysis",
                       json={"ai_run_id": "run_1"})
    assert res2.status_code == 200
    assert res2.get_json()["added_count"] == 0
    assert res2.get_json()["skipped_duplicates"] == 2

    # Validation paths.
    assert client.post("/api/v2/microcards/decks/from-analysis", json={}).status_code == 400
    assert client.post("/api/v2/microcards/decks/from-analysis",
                       json={"ai_run_id": "nope"}).status_code == 400



def test_v2_review_pings_calendar_once_per_scheduled_review(monkeypatch):
    """M2: first attempts (scheduled reviews) notify the calendar orchestrator;
    mastery-cycle retries don't."""
    tmp = tempfile.mkdtemp()
    calls = []

    def orchestrate(*, deck_id, card_id, review_result):
        calls.append((deck_id, card_id, review_result["review_event"]["id"]))
        return {"applied": True}

    helpers = {"orchestrate_microcards_review_post_submit": orchestrate}
    client = _make_client(monkeypatch, tmp, helpers)

    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Calendar Deck")
    svc.create_card(deck["id"], front_text="Q0", back_text="A0")
    svc.create_card(deck["id"], front_text="Q1", back_text="A1")

    run = svc.start_session(deck["id"], mode="run", level_mode=1)
    q = list(run["card_queue"])

    # Wrong first attempt → scheduled review → one calendar ping.
    res = client.post(f"/api/v2/microcards/session/{run['id']}/answer",
                      json={"card_id": q[0], "user_answer": "dont_know"})
    assert res.status_code == 200
    assert len(calls) == 1
    assert calls[0][0] == deck["id"] and calls[0][1] == q[0]

    # Correct second card → second ping.
    client.post(f"/api/v2/microcards/session/{run['id']}/answer",
                json={"card_id": q[1], "user_answer": "know"})
    assert len(calls) == 2

    # Mastery-cycle retry of the failed card → NO new scheduled review, no ping.
    res3 = client.post(f"/api/v2/microcards/session/{run['id']}/answer",
                       json={"card_id": q[0], "user_answer": "know"})
    assert res3.status_code == 200
    assert res3.get_json()["is_retry"] is True
    assert len(calls) == 2



def test_deckless_analyze_for_editor_preview(monkeypatch):
    """The editor text-import preview parses without a target deck (M3)."""
    tmp = tempfile.mkdtemp()
    client = _make_client(monkeypatch, tmp, {})
    res = client.post("/api/v2/microcards/import/analyze",
                      json={"format": "auto", "content": "os\tbone\ncor\theart"})
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert data["counts"]["ok"] == 2
    assert all(r["duplicate"] is False for r in data["rows"])
    assert client.post("/api/v2/microcards/import/analyze",
                       json={"content": "   "}).status_code == 400
