import sys
from pathlib import Path
from types import SimpleNamespace

from flask import Flask


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import routes.misc_routes as misc_routes


def test_network_status_uses_non_blocking_connectivity_lookup(monkeypatch):
    app = Flask(__name__)
    call_log = []

    def fake_connectivity_lookup(**kwargs):
        call_log.append(kwargs)
        return True

    monkeypatch.setattr(
        misc_routes,
        "_mh",
        lambda: {
            "get_cached_internet_connectivity": fake_connectivity_lookup,
            "feedback_email_settings": lambda: {"enabled": False},
            "validate_feedback_email_settings": lambda settings, require_recipients=True: [],
            "update_manifest_url": lambda: "",
            "env_bool": lambda name, default=True: default,
            "manifest_url_requires_internet": lambda manifest_url: False,
        },
    )

    with app.test_request_context("/api/network/status", method="GET"):
        response = misc_routes.network_status()

    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["internet_online"] is True
    assert call_log == [{"force": False, "allow_stale": True}]
