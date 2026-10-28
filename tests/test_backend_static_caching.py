"""Tests for Phase 4: Backend static asset caching, Cache-Control headers, and log handler flush optimization."""

import os
from unittest.mock import MagicMock, patch
import pytest
from flask import Flask, Response

from routes.static_routes import _apply_static_cache_headers, _is_flask_debug_enabled


def test_apply_static_cache_headers_fonts():
    resp = Response("fake font")
    resp = _apply_static_cache_headers(resp, "fonts/MaterialSymbolsOutlined.woff2")
    assert resp.headers.get("Cache-Control") == "public, max-age=31536000, immutable"

    resp2 = Response("fake ttf")
    resp2 = _apply_static_cache_headers(resp2, "Inter-400.ttf")
    assert resp2.headers.get("Cache-Control") == "public, max-age=31536000, immutable"


def test_apply_static_cache_headers_images():
    resp = Response("fake svg")
    resp = _apply_static_cache_headers(resp, "icon.svg")
    assert resp.headers.get("Cache-Control") == "public, max-age=86400, must-revalidate"

    resp2 = Response("fake png")
    resp2 = _apply_static_cache_headers(resp2, "logo.png")
    assert resp2.headers.get("Cache-Control") == "public, max-age=86400, must-revalidate"


def test_apply_static_cache_headers_html_no_store():
    resp = Response("<html></html>")
    resp = _apply_static_cache_headers(resp, "Main.html")
    assert resp.headers.get("Cache-Control") == "no-store"

    resp2 = Response("<html></html>")
    resp2 = _apply_static_cache_headers(resp2, "Theory_Editor.html")
    assert resp2.headers.get("Cache-Control") == "no-store"


def test_apply_static_cache_headers_hosted_web_js():
    with patch("routes.static_routes.is_hosted_web_runtime", return_value=True):
        resp = Response("console.log('hi');")
        resp = _apply_static_cache_headers(resp, "ClickUI.web.js")
        assert resp.headers.get("Cache-Control") == "public, max-age=3600, must-revalidate"


def test_is_flask_debug_enabled():
    with patch("routes.static_routes.get_extra", return_value=True):
        assert _is_flask_debug_enabled() is True

    with patch("routes.static_routes.get_extra", return_value=False):
        assert _is_flask_debug_enabled() is False


def test_log_http_request_skips_flush_on_fast_success():
    from server import _log_http_request

    app = Flask("test_app")
    with app.test_request_context("/assets/fonts.css"):
        with patch("server.FLASK_DEBUG_ENABLED", False):
            with patch("server._flush_log_handlers") as mock_flush:
                resp = Response("body {}", status=200)
                res = _log_http_request(resp)
                assert res.status_code == 200
                assert mock_flush.call_count == 0


def test_log_http_request_flushes_on_slow_or_error():
    from server import _log_http_request

    app = Flask("test_app")
    # Error status triggers flush
    with app.test_request_context("/api/bad"):
        with patch("server.FLASK_DEBUG_ENABLED", False):
            with patch("server._flush_log_handlers") as mock_flush:
                resp = Response("error", status=500)
                res = _log_http_request(resp)
                assert mock_flush.call_count == 1
