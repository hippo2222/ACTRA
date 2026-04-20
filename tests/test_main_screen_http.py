import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

import server  # type: ignore
import routes._context as ctx_module  # type: ignore


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

    def get_user(self, user_id):
        for user in self._users:
            if getattr(user, "user_id", None) == user_id:
                return user
        return None


@pytest.fixture
def client():
    with server.app.test_client() as c:
        yield c


def _install_hosted_runtime(monkeypatch, *, users=None, ui_dirs=None):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_HOSTED_DEV_AUTH_BRIDGE", raising=False)
    user_service = _DummyUserService(users or [])
    app_ctx = type(
        "Ctx",
        (),
        {
            "user_service": user_service,
            "user_id": "",
            "data_dir": str(ROOT_DIR),
        },
    )()
    extra = dict(getattr(ctx_module, "_extra", {}))
    if ui_dirs is not None:
        extra["ui_dirs"] = ui_dirs
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(ctx_module, "_extra", extra)
    monkeypatch.setattr(server._headless_app_ctx, "user_service", user_service, raising=False)


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
    # After refactoring, misc_routes uses _mh() helper which gets from _extra["misc_helpers"]
    import routes._context as ctx_module
    dummy_service = _DummyUserService(users=[])
    misc_helpers = {"user_service": dummy_service}
    existing_extra = getattr(ctx_module, "_extra", {})
    existing_extra["misc_helpers"] = misc_helpers
    monkeypatch.setattr(ctx_module, "_extra", existing_extra)

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
    # After refactoring, misc_routes uses _mh() helper which gets from _extra["misc_helpers"]
    import routes._context as ctx_module
    dummy_service = _DummyUserService(users=[user])
    misc_helpers = {"user_service": dummy_service}
    existing_extra = getattr(ctx_module, "_extra", {})
    existing_extra["misc_helpers"] = misc_helpers
    monkeypatch.setattr(ctx_module, "_extra", existing_extra)

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
    # After refactoring, misc_routes uses _mh() helper which gets from _extra["misc_helpers"]
    import routes._context as ctx_module
    dummy_service = _DummyUserService(users=[user])
    misc_helpers = {"user_service": dummy_service}
    existing_extra = getattr(ctx_module, "_extra", {})
    existing_extra["misc_helpers"] = misc_helpers
    monkeypatch.setattr(ctx_module, "_extra", existing_extra)

    response = client.get("/api/users/should-welcome")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["show_welcome"] is False
    assert payload["auto_select_user_id"] == "u1"


def test_should_welcome_returns_auth_mode_in_hosted_runtime(client, monkeypatch):
    import routes._context as ctx_module

    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_HOSTED_DEV_AUTH_BRIDGE", raising=False)

    dummy_service = _DummyUserService(users=[])
    app_ctx = type("Ctx", (), {"user_service": dummy_service, "user_id": "", "data_dir": str(ROOT_DIR)})()
    existing_extra = getattr(ctx_module, "_extra", {})
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(ctx_module, "_extra", existing_extra)

    response = client.get("/api/users/should-welcome")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["show_welcome"] is True
    assert payload["mode"] == "auth"
    assert payload["authenticated"] is False
    assert payload["profiles"] == []


def test_hosted_ui_pages_redirect_to_welcome_without_auth(client, monkeypatch, tmp_path):
    welcome_dir = tmp_path / "Welcome"
    welcome_dir.mkdir(parents=True, exist_ok=True)
    (welcome_dir / "welcome.html").write_text("<!doctype html><html><body>Welcome</body></html>", encoding="utf-8")
    ui_dirs = {"WELCOME_UI_DIR": welcome_dir}
    _install_hosted_runtime(monkeypatch, users=[], ui_dirs=ui_dirs)

    main_response = client.get("/ui/main", headers={"Accept": "text/html"})
    settings_response = client.get("/ui/settings", headers={"Accept": "text/html"})
    welcome_response = client.get("/ui/welcome")

    assert main_response.status_code == 302
    assert main_response.headers["Location"].endswith("/ui/welcome")
    assert settings_response.status_code == 302
    assert settings_response.headers["Location"].endswith("/ui/welcome")
    assert welcome_response.status_code == 200


def test_hosted_ui_page_serves_when_authenticated(client, monkeypatch, tmp_path):
    mainscreen_dir = tmp_path / "MainScreen"
    mainscreen_dir.mkdir(parents=True, exist_ok=True)
    (mainscreen_dir / "Main.html").write_text("<!doctype html><html><body>Protected Main</body></html>", encoding="utf-8")
    ui_dirs = {"MAINSCREEN_UI_DIR": mainscreen_dir}
    user = _DummyUser("u-auth", has_password=True, require_password_on_login=True)
    _install_hosted_runtime(monkeypatch, users=[user], ui_dirs=ui_dirs)

    with client.session_transaction() as session:
        session["auth_user_id"] = "u-auth"

    response = client.get("/ui/main")
    assert response.status_code == 200
    assert b"Protected Main" in response.data
