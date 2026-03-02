import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

import server  # type: ignore


class _DummyUser:
    def __init__(self, user_id: str, has_password: bool, require_password_on_login: bool):
        self.user_id = user_id
        self._payload = {
            "user_id": user_id,
            "has_password": has_password,
            "security_settings": {
                "require_password_on_login": require_password_on_login,
            },
        }

    def to_api_dict(self):
        return dict(self._payload)


class _DummyUserService:
    def __init__(self, users):
        self._users = users

    def get_all_users(self):
        return list(self._users)


@pytest.fixture
def client():
    with server.app.test_client() as c:
        yield c


def test_ui_main_serves_current_mainscreen_html(client, tmp_path, monkeypatch):
    mainscreen_dir = tmp_path / "MainScreen"
    mainscreen_dir.mkdir(parents=True, exist_ok=True)
    html = "<!doctype html><html><body><h1>MainScreen Test</h1></body></html>"
    (mainscreen_dir / "Main.html").write_text(html, encoding="utf-8")
    
    # After refactoring, routes use context to get ui_dirs
    import routes._context as ctx_module
    ui_dirs = {"MAINSCREEN_UI_DIR": mainscreen_dir}
    existing_extra = getattr(ctx_module, "_extra", {})
    existing_extra["ui_dirs"] = ui_dirs
    monkeypatch.setattr(ctx_module, "_extra", existing_extra)

    response = client.get("/ui/main")
    assert response.status_code == 200
    assert "text/html" in (response.content_type or "")
    assert b"MainScreen Test" in response.data
    assert response.headers.get("Cache-Control") == "no-store"


def test_should_welcome_onboarding_when_no_users(client, monkeypatch):
    monkeypatch.setattr(server, "user_service", _DummyUserService(users=[]))

    response = client.get("/api/users/should-welcome")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["show_welcome"] is True
    assert payload["mode"] == "onboarding"
    assert payload["profiles"] == []


def test_should_welcome_login_for_single_password_profile(client, monkeypatch):
    user = _DummyUser(
        user_id="u1",
        has_password=True,
        require_password_on_login=True,
    )
    monkeypatch.setattr(server, "user_service", _DummyUserService(users=[user]))

    response = client.get("/api/users/should-welcome")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["show_welcome"] is True
    assert payload["mode"] == "login"
    assert len(payload["profiles"]) == 1
    assert payload["profiles"][0]["user_id"] == "u1"


def test_should_auto_select_single_profile_without_login_password(client, monkeypatch):
    user = _DummyUser(
        user_id="u1",
        has_password=False,
        require_password_on_login=False,
    )
    monkeypatch.setattr(server, "user_service", _DummyUserService(users=[user]))

    response = client.get("/api/users/should-welcome")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["show_welcome"] is False
    assert payload["auto_select_user_id"] == "u1"
