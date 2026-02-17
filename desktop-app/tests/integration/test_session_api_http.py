import sys
from pathlib import Path

import pytest

# Добавляем desktop-app в PYTHONPATH, чтобы импортировать server/app
DESKTOP_APP_PATH = Path(__file__).resolve().parents[2] / "desktop-app"
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from server import app  # type: ignore


@pytest.fixture
def client():
    """Flask test client for HTTP API over SessionAPI."""
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_health_returns_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data == {"status": "ok"}


def test_start_session_with_unknown_complex_returns_error(client):
    resp = client.post(
        "/api/session/unknown_complex/start",
        json={"user_id": "test_user", "start_iteration": 1},
    )
    assert resp.status_code in (400, 404)
    data = resp.get_json()
    assert isinstance(data, dict)
    assert data.get("ok") is False
    assert "error" in data


def test_get_task_with_invalid_session_id_returns_404(client):
    resp = client.get("/api/session/nonexistent_session/task")
    assert resp.status_code == 404
    data = resp.get_json()
    assert data.get("ok") is False
    assert data.get("error") == "task_not_found_or_session_mismatch"


def test_iteration_results_with_invalid_session_id_returns_404(client):
    resp = client.get("/api/session/nonexistent_session/iteration-results")
    assert resp.status_code == 404
    data = resp.get_json()
    assert data.get("ok") is False
    assert data.get("error") == "iteration_results_not_found"


def test_final_results_with_invalid_session_id_returns_404(client):
    resp = client.get("/api/session/nonexistent_session/final-results")
    assert resp.status_code == 404
    data = resp.get_json()
    assert data.get("ok") is False
    assert data.get("error") == "final_results_not_found"


def test_create_complex_invalid_payload_returns_validation_error(client):
    resp = client.post("/api/complexes", json={"name": "", "tasks": []})
    assert resp.status_code == 400
    data = resp.get_json()
    assert data.get("ok") is False
    assert data.get("error") == "validation_error"
    details = data.get("details") or {}
    errors = details.get("errors") or []
    reasons = {err.get("reason") for err in errors}
    assert "name_required" in reasons
    assert "tasks_required" in reasons
