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

    response = client.get("/main")
    assert response.status_code == 200
    assert "text/html" in (response.content_type or "")
    assert b"MainScreen Test" in response.data
    assert response.headers.get("Cache-Control") == "no-store"


def test_ui_reference_serves_reference_html_and_assets(client, tmp_path, monkeypatch):
    reference_dir = tmp_path / "Reference"
    reference_dir.mkdir(parents=True, exist_ok=True)
    (reference_dir / "index.html").write_text(
        "<!doctype html><html><body><h1>Reference Test</h1></body></html>",
        encoding="utf-8",
    )
    (reference_dir / "reference.js").write_text("window.referenceAsset = true;", encoding="utf-8")
    (reference_dir / "reference.css").write_text(".reference-page {}", encoding="utf-8")

    import routes._context as ctx_module

    existing_extra = dict(getattr(ctx_module, "_extra", {}))
    existing_extra["ui_dirs"] = {"REFERENCE_UI_DIR": reference_dir}
    monkeypatch.setattr(ctx_module, "_extra", existing_extra)

    html_response = client.get("/reference")
    js_response = client.get("/reference/reference.js")
    css_response = client.get("/reference/reference.css")

    assert html_response.status_code == 200
    assert "text/html" in (html_response.content_type or "")
    assert b"Reference Test" in html_response.data
    assert html_response.headers.get("Cache-Control") == "no-store"
    assert js_response.status_code == 200
    assert b"referenceAsset" in js_response.data
    assert css_response.status_code == 200
    assert b"reference-page" in css_response.data


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

    main_response = client.get("/main", headers={"Accept": "text/html"})
    settings_response = client.get("/settings", headers={"Accept": "text/html"})
    reference_response = client.get("/reference", headers={"Accept": "text/html"})
    welcome_response = client.get("/welcome")

    assert main_response.status_code == 302
    assert main_response.headers["Location"].endswith("/welcome")
    assert settings_response.status_code == 302
    assert settings_response.headers["Location"].endswith("/welcome")
    assert reference_response.status_code == 302
    assert reference_response.headers["Location"].endswith("/welcome")
    assert welcome_response.status_code == 200


def test_root_redirects_to_public_welcome_page(client, monkeypatch):
    _install_hosted_runtime(monkeypatch, users=[])

    response = client.get("/")

    assert response.status_code == 302
    assert response.headers["Location"].endswith("/welcome")

    welcome_response = client.get("/", follow_redirects=True)
    assert welcome_response.status_code == 200
    assert "text/html" in (welcome_response.content_type or "")
    text = welcome_response.get_data(as_text=True)
    assert "ACTRA" in text
    assert "$4.99" in text
    assert "$7.99" in text
    assert "$19.99" in text
    assert "/pricing?lang=ru" in text
    assert "/refund?lang=ru" in text
    assert "/terms?lang=ru" in text


def test_public_legal_pages_are_available_without_hosted_auth(client, monkeypatch):
    _install_hosted_runtime(monkeypatch, users=[])

    privacy_response = client.get("/privacy")
    privacy_ru_response = client.get("/privacy?lang=ru")
    terms_response = client.get("/terms")
    terms_ru_response = client.get("/terms?lang=ru")

    assert privacy_response.status_code == 200
    assert "text/html" in (privacy_response.content_type or "")
    privacy_text = privacy_response.get_data(as_text=True)
    assert "Privacy Policy" in privacy_text
    assert "Last reviewed 2026-05-11" in privacy_text
    assert "/legal/terms?lang=en" in privacy_text
    assert "/refund?lang=en" in privacy_text
    assert "English" in privacy_text
    assert "Русский" in privacy_text
    assert "/legal/privacy?lang=ru" in privacy_text
    assert privacy_ru_response.status_code == 200
    assert "Политика приватности ACTRA" in privacy_ru_response.get_data(as_text=True)
    assert privacy_response.headers.get("Cache-Control") == "no-store"
    assert terms_response.status_code == 200
    assert "text/html" in (terms_response.content_type or "")
    terms_text = terms_response.get_data(as_text=True)
    assert "Terms of Service" in terms_text
    assert "Last reviewed 2026-05-13" in terms_text
    assert "/legal/privacy?lang=en" in terms_text
    assert "/refund?lang=en" in terms_text
    assert terms_ru_response.status_code == 200
    assert "Условия пользования" in terms_ru_response.get_data(as_text=True)
    current_response = client.get("/api/legal/current")
    assert current_response.status_code == 200
    current_payload = current_response.get_json()
    assert current_payload["documents"]["terms"]["version"] == "2026-05-25.2"
    assert current_payload["documents"]["refund"]["version"] == "2026-05-25.1"

    refund_document_response = client.get("/api/legal/document/refund")
    assert refund_document_response.status_code == 200
    refund_document = refund_document_response.get_json()["document"]
    assert refund_document["version"] == "2026-05-25.1"
    assert refund_document["last_reviewed_at"] == "2026-05-11T00:00:00Z"


def test_public_premium_commerce_pages_are_available_without_hosted_auth(client, monkeypatch):
    _install_hosted_runtime(monkeypatch, users=[])

    pricing_response = client.get("/pricing")
    refund_response = client.get("/refund")

    assert pricing_response.status_code == 200
    assert "text/html" in (pricing_response.content_type or "")
    pricing_text = pricing_response.get_data(as_text=True)
    assert "$4.99" in pricing_text
    assert "$7.99" in pricing_text
    assert "$19.99" in pricing_text
    assert "/legal/terms?lang=en" in pricing_text
    assert "/legal/privacy?lang=en" in pricing_text
    assert "/refund?lang=en" in pricing_text
    assert "/pricing?lang=ru" in pricing_text

    pricing_ru_response = client.get("/pricing?lang=ru")
    assert pricing_ru_response.status_code == 200
    assert "Цены" in pricing_ru_response.get_data(as_text=True)

    assert refund_response.status_code == 200
    assert "text/html" in (refund_response.content_type or "")
    refund_text = refund_response.get_data(as_text=True)
    assert "Refund Policy" in refund_text
    assert "Last reviewed 2026-05-11" in refund_text
    assert "within 14 days after the payment date" in refund_text
    assert "actrafb@proton.me" in refund_text
    assert "/pricing?lang=en" in refund_text
    assert "/refund?lang=ru" in refund_text
    assert "/legal/terms?lang=en" in refund_text
    assert "/legal/privacy?lang=en" in refund_text

    refund_ru_response = client.get("/refund?lang=ru")
    assert refund_ru_response.status_code == 200
    assert "Политика возвратов" in refund_ru_response.get_data(as_text=True)


def test_public_seo_files_are_available_without_hosted_auth(client, monkeypatch):
    monkeypatch.setenv("ACTRA_AUTH_PUBLIC_BASE_URL", "https://actra.site")
    _install_hosted_runtime(monkeypatch, users=[])

    robots_response = client.get("/robots.txt")
    sitemap_response = client.get("/sitemap.xml")

    assert robots_response.status_code == 200
    assert "text/plain" in (robots_response.content_type or "")
    assert b"User-agent: *" in robots_response.data
    assert b"Sitemap: https://actra.site/sitemap.xml" in robots_response.data
    assert sitemap_response.status_code == 200
    assert "application/xml" in (sitemap_response.content_type or "")
    assert b"<loc>https://actra.site/</loc>" in sitemap_response.data
    assert b"<loc>https://actra.site/pricing</loc>" in sitemap_response.data
    assert b"<loc>https://actra.site/refund</loc>" in sitemap_response.data
    assert b"<loc>https://actra.site/privacy</loc>" in sitemap_response.data
    assert b"<loc>https://actra.site/terms</loc>" in sitemap_response.data


def test_public_seo_files_default_to_production_domain_without_env(client, monkeypatch):
    monkeypatch.delenv("ACTRA_AUTH_PUBLIC_BASE_URL", raising=False)
    monkeypatch.delenv("ACTRA_PUBLIC_BASE_URL", raising=False)
    _install_hosted_runtime(monkeypatch, users=[])

    robots_response = client.get("/robots.txt")
    sitemap_response = client.get("/sitemap.xml")

    assert robots_response.status_code == 200
    assert sitemap_response.status_code == 200
    assert b"localhost" not in robots_response.data
    assert b"localhost" not in sitemap_response.data
    assert b"Sitemap: https://actra.site/sitemap.xml" in robots_response.data
    assert b"<loc>https://actra.site/</loc>" in sitemap_response.data


def test_missing_route_preserves_http_404(client):
    response = client.get("/definitely-missing")

    assert response.status_code == 404


def test_hosted_ui_page_serves_when_authenticated(client, monkeypatch, tmp_path):
    mainscreen_dir = tmp_path / "MainScreen"
    mainscreen_dir.mkdir(parents=True, exist_ok=True)
    (mainscreen_dir / "Main.html").write_text("<!doctype html><html><body>Protected Main</body></html>", encoding="utf-8")
    ui_dirs = {"MAINSCREEN_UI_DIR": mainscreen_dir}
    user = _DummyUser("u-auth", has_password=True, require_password_on_login=True)
    _install_hosted_runtime(monkeypatch, users=[user], ui_dirs=ui_dirs)

    with client.session_transaction() as session:
        session["auth_user_id"] = "u-auth"

    response = client.get("/main")
    assert response.status_code == 200
    assert b"Protected Main" in response.data
