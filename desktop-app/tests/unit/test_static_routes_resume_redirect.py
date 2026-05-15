import sys
from pathlib import Path
from types import SimpleNamespace

from flask import Flask, Response


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import routes.static_routes as static_routes


def test_serve_session_ui_redirects_to_iteration_results_resume_target(monkeypatch, tmp_path):
    app = Flask(__name__)
    s1_dir = tmp_path / "S1"
    s1_dir.mkdir()

    session = SimpleNamespace(
        id="sess_1",
        user_id="audit_user",
        ui_state={"screen_type": "iteration_results", "iteration_number": 1},
    )
    fake_session_api = SimpleNamespace(
        get_session=lambda session_id, user_id=None: session,
        get_resume_target=lambda loaded: {
            "screen_type": "iteration_results",
            "iteration_number": 1,
            "url": "/session/sess_1/iteration/1",
        },
    )
    fake_ctx = SimpleNamespace(user_id="audit_user", session_api=fake_session_api)

    monkeypatch.setattr(static_routes, "get_ctx", lambda: fake_ctx)
    monkeypatch.setattr(static_routes, "_get_ui_dirs", lambda: {"S1_UI_DIR": s1_dir})
    monkeypatch.setattr(
        static_routes,
        "send_from_directory",
        lambda *_args, **_kwargs: Response("S1", status=200, mimetype="text/html"),
    )

    with app.test_request_context("/session/sess_1", method="GET"):
        response = static_routes.serve_session_ui("sess_1")

    assert response.status_code == 302
    assert response.location.endswith("/session/sess_1/iteration/1")


def test_serve_session_ui_keeps_s1_when_resume_target_is_current_task(monkeypatch, tmp_path):
    app = Flask(__name__)
    s1_dir = tmp_path / "S1"
    s1_dir.mkdir()

    session = SimpleNamespace(
        id="sess_1",
        user_id="audit_user",
        ui_state={"screen_type": "task", "task_ref": "module/topic/task_001"},
    )
    fake_session_api = SimpleNamespace(
        get_session=lambda session_id, user_id=None: session,
        get_resume_target=lambda loaded: {
            "screen_type": "task",
            "url": "/session/sess_1",
        },
    )
    fake_ctx = SimpleNamespace(user_id="audit_user", session_api=fake_session_api)

    monkeypatch.setattr(static_routes, "get_ctx", lambda: fake_ctx)
    monkeypatch.setattr(static_routes, "_get_ui_dirs", lambda: {"S1_UI_DIR": s1_dir})
    monkeypatch.setattr(
        static_routes,
        "send_from_directory",
        lambda *_args, **_kwargs: Response("S1", status=200, mimetype="text/html"),
    )

    with app.test_request_context("/session/sess_1", method="GET"):
        response = static_routes.serve_session_ui("sess_1")

    assert response.status_code == 200
    assert response.get_data(as_text=True) == "S1"


def test_favicon_serves_project_icon(monkeypatch, tmp_path):
    app = Flask(__name__)
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()

    monkeypatch.setattr(static_routes, "_get_ui_dirs", lambda: {"ASSETS_DIR": assets_dir})
    monkeypatch.setattr(
        static_routes,
        "send_from_directory",
        lambda directory, filename, **kwargs: Response(
            f"{Path(directory).name}/{filename}/{kwargs.get('mimetype')}",
            status=200,
        ),
    )

    with app.test_request_context("/favicon.ico", method="GET"):
        response = static_routes.favicon()

    assert response.status_code == 200
    assert response.get_data(as_text=True) == "assets/actra_white.ico/image/x-icon"
