"""Smoke tests for server.py — regression safety net for the refactoring.

These tests verify that key endpoints return HTTP 200 with valid JSON.
They are intentionally simple: no mutations, no side-effects, just GETs.
Run after every refactoring phase to catch import/wiring breakage.
"""

import json
import pytest

from server import app  # type: ignore


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def test_list_users(client):
    resp = client.get("/api/users")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert "items" in data


def test_current_user(client):
    resp = client.get("/api/users/current")
    assert resp.status_code in (200, 404)
    data = resp.get_json()
    if resp.status_code == 200:
        assert data["ok"] is True
    else:
        assert data["ok"] is False
        assert data["error"] == "user_not_found"


# ---------------------------------------------------------------------------
# Complexes
# ---------------------------------------------------------------------------

def test_list_complexes(client):
    resp = client.get("/api/complexes")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    items = data.get("items")
    if isinstance(items, list) and items:
        ownership = items[0].get("ownership")
        assert isinstance(ownership, dict)
        assert ownership.get("scope") == "workspace"


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------

def test_statistics_overall(client):
    resp = client.get("/api/statistics/overall")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True


# ---------------------------------------------------------------------------
# Editor
# ---------------------------------------------------------------------------

def test_editor_catalog(client):
    resp = client.get("/api/editor/catalog")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert "modules" in data


# ---------------------------------------------------------------------------
# Theories
# ---------------------------------------------------------------------------

def test_list_theories(client):
    resp = client.get("/api/theories")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True


# ---------------------------------------------------------------------------
# AI status
# ---------------------------------------------------------------------------

def test_ai_status(client):
    resp = client.get("/api/editor/ai/status")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True


# ---------------------------------------------------------------------------
# Sessions (active list — should be 200 even if empty)
# ---------------------------------------------------------------------------

def test_active_sessions(client):
    resp = client.get("/api/sessions/active")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True


# ---------------------------------------------------------------------------
# Quick-access
# ---------------------------------------------------------------------------

def test_quick_access(client):
    resp = client.get("/api/ui/quick-access")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True


# ---------------------------------------------------------------------------
# Task catalog
# ---------------------------------------------------------------------------

def test_task_catalog(client):
    resp = client.get("/api/task-catalog")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True


# ---------------------------------------------------------------------------
# Avatars
# ---------------------------------------------------------------------------

def test_avatars_list(client):
    resp = client.get("/api/assets/avatars")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
