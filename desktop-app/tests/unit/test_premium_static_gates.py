import sys
from pathlib import Path
from types import SimpleNamespace

from flask import Flask


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import routes.static_routes as static_routes


def _make_app():
    app = Flask(__name__)
    app.register_blueprint(static_routes.static_bp)
    return app


def test_calendar_page_requires_premium(monkeypatch):
    app = _make_app()
    user = SimpleNamespace(user_id="user_1", role="user", plan="free", premium_expires_at=None)
    ctx = SimpleNamespace(user_id="user_1", user_service=SimpleNamespace(get_user=lambda user_id: user))
    monkeypatch.setattr(static_routes, "is_hosted_web_runtime", lambda: False)
    monkeypatch.setattr(static_routes, "get_ctx", lambda: ctx)

    with app.test_client() as client:
        response = client.get("/ui/calendar")

    assert response.status_code == 403
    assert b"/ui/settings#premium" in response.data


def test_premium_calendar_page_is_served(monkeypatch, tmp_path):
    app = _make_app()
    calendar_dir = tmp_path / "Calendar"
    calendar_dir.mkdir()
    (calendar_dir / "calendar.html").write_text("<html>calendar</html>", encoding="utf-8")
    user = SimpleNamespace(user_id="user_1", role="user", plan="premium", premium_expires_at=None)
    ctx = SimpleNamespace(user_id="user_1", user_service=SimpleNamespace(get_user=lambda user_id: user))
    monkeypatch.setattr(static_routes, "is_hosted_web_runtime", lambda: False)
    monkeypatch.setattr(static_routes, "get_ctx", lambda: ctx)
    monkeypatch.setattr(static_routes, "get_extra", lambda key, default=None: {"CALENDAR_UI_DIR": calendar_dir} if key == "ui_dirs" else default)

    with app.test_client() as client:
        response = client.get("/ui/calendar")

    assert response.status_code == 200
    assert response.data == b"<html>calendar</html>"
