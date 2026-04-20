import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

import server  # type: ignore
import routes._context as ctx_module  # type: ignore


class _DummyHostedUser:
    def __init__(self, user_id: str):
        self.user_id = user_id


class _DummyHostedUserService:
    def __init__(self, user_id: str):
        self._user = _DummyHostedUser(user_id)

    def get_user(self, user_id: str):
        return self._user if str(user_id or "").strip() == self._user.user_id else None


@pytest.fixture
def client():
    server.app.config["TESTING"] = True
    with server.app.test_client() as c:
        yield c


def _login_hosted_session(client) -> None:
    with client.session_transaction() as sess:
        sess[ctx_module._AUTH_USER_ID_SESSION_KEY] = "user_stage7"


def _install_hosted_user(monkeypatch) -> None:
    app_ctx = getattr(ctx_module, "_app_ctx", None)
    monkeypatch.setattr(app_ctx, "user_service", _DummyHostedUserService("user_stage7"), raising=False)


def _preview_payload() -> dict:
    return {
        "source_complex_id": "missing_complex",
        "source_catalog_item_id": "catalog_item_missing",
        "source_catalog_version_id": "v1",
    }


def test_workspace_import_bridge_is_blocked_by_default_in_hosted_runtime(client, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_WORKSPACE_IMPORT_BRIDGE", raising=False)
    _install_hosted_user(monkeypatch)
    _login_hosted_session(client)

    response = client.post("/api/internal/workspace/import/complex-copy/preview", json=_preview_payload())

    assert response.status_code == 403
    payload = response.get_json()
    assert payload["error"] == "workspace_import_bridge_disabled_in_hosted_web"
    assert payload["route_contract"]["bridge_only"] is True
    assert payload["route_contract"]["hosted_runtime_blocked_by_default"] is True
    assert payload["route_contract"]["hosted_route_enabled"] is False


def test_workspace_import_bridge_requires_internal_header_when_opted_in(client, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_ENABLE_HOSTED_WORKSPACE_IMPORT_BRIDGE", "1")
    _install_hosted_user(monkeypatch)
    _login_hosted_session(client)

    response = client.post("/api/internal/workspace/import/complex-copy/preview", json=_preview_payload())

    assert response.status_code == 403
    payload = response.get_json()
    assert payload["error"] == "internal_bridge_header_required"
    assert payload["required_header"] == "X-ACTRA-Internal-Bridge"
    assert payload["route_contract"]["hosted_route_enabled"] is True


def test_workspace_import_bridge_allows_explicit_hosted_opt_in(client, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_ENABLE_HOSTED_WORKSPACE_IMPORT_BRIDGE", "true")
    _install_hosted_user(monkeypatch)
    _login_hosted_session(client)

    response = client.post(
        "/api/internal/workspace/import/complex-copy/preview",
        json=_preview_payload(),
        headers={"X-ACTRA-Internal-Bridge": "workspace-import"},
    )

    assert response.status_code == 404
    payload = response.get_json()
    assert payload["error"] == "source_complex_not_found"
    assert payload["route_contract"]["bridge_only"] is True
    assert payload["route_contract"]["hosted_route_enabled"] is True
