import sys
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from server import app  # type: ignore


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_ai_status_returns_placeholder_when_ai_mode_disabled(client, monkeypatch):
    monkeypatch.delenv("RP_EDITOR_FF_AI_MODE", raising=False)

    resp = client.get("/api/editor/ai/status")

    assert resp.status_code == 404
    data = resp.get_json()
    assert data["ok"] is False
    assert data["error"] == "ai_mode_in_progress"
    assert data["feature_flags"]["ai_mode"] is False
    assert data["feature_flags"]["analysis_v2_schema"] is False
    assert data["feature_flags"]["microcards_mode"] is False


def test_ai_analysis_routes_return_placeholder_when_ai_mode_disabled(client, monkeypatch):
    monkeypatch.delenv("RP_EDITOR_FF_AI_MODE", raising=False)

    resp = client.get("/api/editor/ai/analyses?limit=10")

    assert resp.status_code == 404
    data = resp.get_json()
    assert data["ok"] is False
    assert data["error"] == "ai_mode_in_progress"
    assert data["feature_flags"]["ai_mode"] is False


def test_microcards_from_analysis_routes_follow_ai_placeholder_contract(client, monkeypatch):
    monkeypatch.delenv("RP_EDITOR_FF_AI_MODE", raising=False)
    monkeypatch.setenv("RP_EDITOR_FF_MICROCARDS_MODE", "1")

    create_resp = client.post(
        "/api/editor/microcards/decks/from-analysis",
        json={"ai_run_id": "ai_run_20260419T120000Z_aihide1", "selector": {"scope": "all"}},
    )
    assert create_resp.status_code == 404
    create_data = create_resp.get_json()
    assert create_data["ok"] is False
    assert create_data["error"] == "ai_mode_in_progress"
    assert create_data["feature_flags"]["ai_mode"] is False

    append_resp = client.post(
        "/api/editor/microcards/decks/deck_demo/append-from-analysis",
        json={"ai_run_id": "ai_run_20260419T120000Z_aihide1", "selector": {"scope": "all"}},
    )
    assert append_resp.status_code == 404
    append_data = append_resp.get_json()
    assert append_data["ok"] is False
    assert append_data["error"] == "ai_mode_in_progress"
    assert append_data["feature_flags"]["ai_mode"] is False
