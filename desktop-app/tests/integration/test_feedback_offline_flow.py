import json
import sys
from pathlib import Path

import pytest

DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if not (DESKTOP_APP_PATH / "server.py").exists():
    DESKTOP_APP_PATH = DESKTOP_APP_PATH / "desktop-app"
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import server  # type: ignore


class _DummyUser:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.name = f"TestUser_{user_id[:8]}"
    
    def to_api_dict(self):
        return {"user_id": self.user_id, "name": self.name}


class _DummyUserService:
    def get_user(self, user_id: str):
        return _DummyUser(user_id)
    
    def get_all_users(self):
        return []


@pytest.fixture(autouse=True)
def _mock_misc_helpers(monkeypatch):
    """Mock misc_helpers for network/feedback routes after refactoring."""
    import routes._context as ctx_module
    
    # Storage for tickets (used by save/build helpers)
    tickets_storage = {}
    feedback_dir_ref = [Path("./data/feedback")]  # Mutable reference for tests to update
    
    def build_ticket(payload, user_id):
        import uuid
        ticket_id = f"ticket_{uuid.uuid4().hex[:12]}"
        return {
            "ticket_id": ticket_id,
            "user_id": user_id,
            "type": payload.get("type"),
            "severity": payload.get("severity"),
            "title": payload.get("title"),
            "description": payload.get("description"),
            "status": "pending",
            "delivery": {},
        }
    
    def save_ticket(ticket):
        import json
        tickets_storage[ticket["ticket_id"]] = ticket
        # Write to disk like real implementation
        feedback_path = feedback_dir_ref[0]
        feedback_path.mkdir(parents=True, exist_ok=True)
        ticket_file = feedback_path / f"{ticket['ticket_id']}.json"
        ticket_file.write_text(json.dumps(ticket, indent=2), encoding="utf-8")
    
    def update_delivery(ticket, email_status):
        ticket["delivery"]["email_sent"] = email_status.get("sent", False)
        ticket["delivery"]["email_reason"] = email_status.get("reason", "")
        if email_status.get("sent"):
            ticket["status"] = "delivered"
        else:
            ticket["status"] = "queued"
    
    def retry_pending(limit=10):
        """Mock retry helper that processes queued tickets in feedback_dir."""
        import json
        feedback_path = feedback_dir_ref[0]
        if not feedback_path.exists():
            return {"attempted": 0, "sent": 0, "failed": 0}
        
        attempted = sent = failed = 0
        for ticket_file in feedback_path.glob("*.json"):
            if attempted >= limit:
                break
            try:
                ticket = json.loads(ticket_file.read_text(encoding="utf-8"))
                if ticket.get("status") in ("pending", "queued"):
                    attempted += 1
                    # Get user from misc_helpers
                    user = misc_helpers["user_service"].get_user(ticket.get("user_id", ""))
                    email_result = misc_helpers["notify_feedback_via_email"](ticket, user)
                    update_delivery(ticket, email_result)
                    save_ticket(ticket)
                    if email_result.get("sent"):
                        sent += 1
                    else:
                        failed += 1
            except Exception:
                pass
        return {"attempted": attempted, "sent": sent, "failed": failed}
    
    # Default mocks for all tests
    misc_helpers = {
        "get_cached_internet_connectivity": lambda **kwargs: True,
        "feedback_dir": lambda: feedback_dir_ref[0],
        "notify_feedback_via_email": lambda *args, **kwargs: {"sent": True},
        # Additional helpers for network_status route
        "feedback_email_settings": lambda: {"enabled": True, "recipients": ["test@example.com"]},
        "validate_feedback_email_settings": lambda settings, **kwargs: [],
        "update_manifest_url": lambda: "https://example.com/manifest.json",
        "env_bool": lambda key, default: default,
        "manifest_url_requires_internet": lambda url: True,
        # user_service for feedback routes
        "user_service": _DummyUserService(),
        # feedback ticket helpers
        "build_feedback_ticket": build_ticket,
        "save_feedback_ticket": save_ticket,
        "update_feedback_delivery_fields": update_delivery,
        "retry_pending_feedback_notifications": retry_pending,
        # Internal reference for tests to update feedback_dir
        "_feedback_dir_ref": feedback_dir_ref,
    }
    
    existing_extra = getattr(ctx_module, "_extra", {})
    existing_extra["misc_helpers"] = misc_helpers
    monkeypatch.setattr(ctx_module, "_extra", existing_extra)
    
    return misc_helpers


@pytest.fixture
def client():
    server.app.config["TESTING"] = True
    with server.app.test_client() as test_client:
        yield test_client


def _get_current_user_id(client) -> str:
    resp = client.get("/api/users/current")
    if resp.status_code == 200:
        payload = resp.get_json()
        if payload and payload.get("ok") is True:
            user = payload.get("user") or {}
            user_id = user.get("user_id")
            if isinstance(user_id, str) and user_id:
                return user_id

    list_resp = client.get("/api/users")
    assert list_resp.status_code == 200
    list_payload = list_resp.get_json() or {}
    items = list_payload.get("items") or []
    if items:
        first = items[0] or {}
        user_id = first.get("user_id")
        assert isinstance(user_id, str) and user_id
        select_resp = client.post("/api/users/select", json={"user_id": user_id})
        assert select_resp.status_code == 200
        return user_id

    create_resp = client.post("/api/users", json={"name": "Feedback Test User"})
    assert create_resp.status_code == 200
    create_payload = create_resp.get_json() or {}
    created_user = create_payload.get("user") or {}
    user_id = created_user.get("user_id")
    assert isinstance(user_id, str) and user_id
    select_resp = client.post("/api/users/select", json={"user_id": user_id})
    assert select_resp.status_code == 200
    return user_id


def test_network_status_endpoint_returns_expected_shape(client):
    resp = client.get("/api/network/status")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload and payload.get("ok") is True
    assert isinstance(payload.get("internet_online"), bool)
    assert isinstance(payload.get("feedback_delivery"), dict)
    assert isinstance(payload.get("updates"), dict)


def test_feedback_submit_marks_ticket_delivered_when_email_send_succeeds(client, tmp_path, _mock_misc_helpers):
    user_id = _get_current_user_id(client)
    feedback_dir_ref = _mock_misc_helpers["_feedback_dir_ref"]
    feedback_dir_ref[0] = tmp_path
    _mock_misc_helpers["get_cached_internet_connectivity"] = lambda **_kwargs: True
    _mock_misc_helpers["notify_feedback_via_email"] = lambda *_args, **_kwargs: {"sent": True}

    resp = client.post(
        "/api/feedback",
        json={
            "user_id": user_id,
            "type": "idea",
            "severity": "medium",
            "title": "Online success path",
            "description": "Feedback should be delivered immediately when SMTP works.",
            "include_technical_data": True,
            "technical": {"runtime_mode": "hosted_web"},
            "include_logs": False,
        },
    )
    assert resp.status_code == 201
    payload = resp.get_json()
    assert payload and payload.get("ok") is True
    assert payload.get("email_notification", {}).get("sent") is True

    ticket_id = payload.get("ticket_id")
    assert isinstance(ticket_id, str) and ticket_id
    ticket_path = tmp_path / f"{ticket_id}.json"
    assert ticket_path.exists()

    ticket = json.loads(ticket_path.read_text(encoding="utf-8"))
    assert ticket.get("user_id") == user_id
    assert ticket.get("status") == "delivered"
    delivery = ticket.get("delivery") or {}
    assert delivery.get("email_sent") is True
    assert delivery.get("email_reason") in ("", "ok")


def test_feedback_submit_marks_ticket_queued_when_email_send_fails(client, monkeypatch, tmp_path, _mock_misc_helpers):
    user_id = _get_current_user_id(client)
    # After refactoring, update misc_helpers in context
    # Update the feedback_dir reference used by save_ticket
    import routes._context as ctx_module
    feedback_dir_ref = ctx_module._extra["misc_helpers"]["_feedback_dir_ref"]
    feedback_dir_ref[0] = tmp_path
    _mock_misc_helpers["get_cached_internet_connectivity"] = lambda **_kwargs: True
    _mock_misc_helpers["notify_feedback_via_email"] = lambda *_args, **_kwargs: {"sent": False, "reason": "send_failed"}

    resp = client.post(
        "/api/feedback",
        json={
            "user_id": user_id,
            "type": "bug",
            "severity": "high",
            "title": "Offline send failure",
            "description": "Email relay is unavailable in this test.",
            "include_technical_data": False,
            "include_logs": False,
        },
    )
    assert resp.status_code == 201
    payload = resp.get_json()
    assert payload and payload.get("ok") is True
    assert payload.get("email_notification", {}).get("sent") is False

    ticket_id = payload.get("ticket_id")
    assert isinstance(ticket_id, str) and ticket_id
    ticket_path = tmp_path / f"{ticket_id}.json"
    assert ticket_path.exists()

    ticket = json.loads(ticket_path.read_text(encoding="utf-8"))
    assert ticket.get("status") == "queued"
    delivery = ticket.get("delivery") or {}
    assert delivery.get("email_sent") is False
    assert delivery.get("email_reason") == "send_failed"


def test_feedback_retry_pending_sends_queued_ticket(client, monkeypatch, tmp_path, _mock_misc_helpers):
    user_id = _get_current_user_id(client)
    # After refactoring, update misc_helpers in context
    feedback_dir_ref = _mock_misc_helpers["_feedback_dir_ref"]
    feedback_dir_ref[0] = tmp_path
    _mock_misc_helpers["get_cached_internet_connectivity"] = lambda **_kwargs: True

    # Use mock helpers instead of real server functions
    ticket = _mock_misc_helpers["build_feedback_ticket"](
        {
            "type": "bug",
            "severity": "medium",
            "title": "Queued ticket",
            "description": "Will be retried later.",
            "include_technical_data": False,
            "include_logs": False,
        },
        user_id=user_id,
    )
    _mock_misc_helpers["save_feedback_ticket"](ticket)

    _mock_misc_helpers["notify_feedback_via_email"] = lambda *_args, **_kwargs: {"sent": True}

    resp = client.post("/api/feedback/retry-pending", json={"limit": 10})
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload and payload.get("ok") is True
    assert payload.get("attempted", 0) >= 1
    assert payload.get("sent", 0) >= 1

    ticket_path = tmp_path / f"{ticket['ticket_id']}.json"
    saved = json.loads(ticket_path.read_text(encoding="utf-8"))
    assert saved.get("status") == "delivered"
    delivery = saved.get("delivery") or {}
    assert delivery.get("email_sent") is True


def test_feedback_submit_short_circuits_when_offline(client, monkeypatch, tmp_path, _mock_misc_helpers):
    user_id = _get_current_user_id(client)
    # After refactoring, update misc_helpers in context
    feedback_dir_ref = _mock_misc_helpers["_feedback_dir_ref"]
    feedback_dir_ref[0] = tmp_path
    _mock_misc_helpers["get_cached_internet_connectivity"] = lambda **_kwargs: False

    called = {"value": False}

    def _fake_notify(*_args, **_kwargs):
        called["value"] = True
        return {"sent": True}

    _mock_misc_helpers["notify_feedback_via_email"] = _fake_notify

    resp = client.post(
        "/api/feedback",
        json={
            "user_id": user_id,
            "type": "bug",
            "severity": "low",
            "title": "Offline fast path",
            "description": "SMTP should not be called when internet is offline.",
            "include_technical_data": False,
            "include_logs": False,
        },
    )
    assert resp.status_code == 201
    payload = resp.get_json()
    assert payload and payload.get("ok") is True
    assert payload.get("email_notification", {}).get("reason") == "offline"
    assert called["value"] is False


def test_feedback_submit_requires_hosted_authentication_in_hosted_runtime(
    client, monkeypatch, _mock_misc_helpers
):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")

    resp = client.post(
        "/api/feedback",
        json={
            "user_id": "body_user_should_not_matter",
            "type": "bug",
            "severity": "low",
            "title": "Hosted auth required",
            "description": "Feedback must require an authenticated hosted session.",
        },
    )

    assert resp.status_code == 401
    payload = resp.get_json()
    assert payload and payload.get("ok") is False
    assert payload.get("error") == "authentication_required"


def test_feedback_submit_uses_hosted_session_user_over_payload_user_id(
    client, monkeypatch, tmp_path, _mock_misc_helpers
):
    session_user_id = _get_current_user_id(client)
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    feedback_dir_ref = _mock_misc_helpers["_feedback_dir_ref"]
    feedback_dir_ref[0] = tmp_path
    _mock_misc_helpers["get_cached_internet_connectivity"] = lambda **_kwargs: True
    _mock_misc_helpers["notify_feedback_via_email"] = lambda *_args, **_kwargs: {"sent": True}

    body_user_id = "body_user_should_be_ignored"

    with client.session_transaction() as session:
        session["auth_user_id"] = session_user_id

    resp = client.post(
        "/api/feedback",
        json={
            "user_id": body_user_id,
            "type": "question",
            "severity": "medium",
            "title": "Hosted identity binding",
            "description": "The server should trust the hosted auth session over payload user_id.",
        },
    )

    assert resp.status_code == 201
    payload = resp.get_json()
    assert payload and payload.get("ok") is True

    ticket_id = payload.get("ticket_id")
    assert isinstance(ticket_id, str) and ticket_id
    ticket_path = tmp_path / f"{ticket_id}.json"
    saved_ticket = json.loads(ticket_path.read_text(encoding="utf-8"))
    assert saved_ticket.get("user_id") == session_user_id
    assert saved_ticket.get("user_id") != body_user_id
