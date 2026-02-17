import sys
from pathlib import Path

import pytest

DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if not (DESKTOP_APP_PATH / "server.py").exists():
    DESKTOP_APP_PATH = DESKTOP_APP_PATH / "desktop-app"
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import server  # type: ignore


@pytest.fixture
def client():
    server.app.config["TESTING"] = True
    with server.app.test_client() as test_client:
        yield test_client


def test_update_check_returns_not_configured_when_manifest_missing(client, monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_UPDATE_CHECK_ENABLED", "1")
    monkeypatch.delenv("ACTRA_UPDATE_MANIFEST_URL", raising=False)
    monkeypatch.setattr(server, "_update_cache_path", lambda: tmp_path / "update_check_cache.json")

    resp = client.get("/api/update/check")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data and data.get("ok") is True
    assert data.get("manifest_url_configured") is False
    assert data.get("reason") == "not_configured"
    assert data.get("update_available") is False


def test_update_check_reports_update_available(client, monkeypatch, tmp_path):
    monkeypatch.setenv("ACTRA_UPDATE_CHECK_ENABLED", "1")
    monkeypatch.setenv("ACTRA_UPDATE_MANIFEST_URL", "https://updates.example.com/latest.json")
    monkeypatch.setattr(server, "_update_cache_path", lambda: tmp_path / "update_check_cache.json")
    monkeypatch.setattr(server, "_get_cached_internet_connectivity", lambda **_kwargs: True)
    monkeypatch.setattr(server, "_get_app_version", lambda: "1.0.0")
    monkeypatch.setattr(
        server,
        "_fetch_update_manifest",
        lambda *_args, **_kwargs: {
            "latest_version": "1.1.0",
            "download_url": "https://updates.example.com/ACTRA-1.1.0.exe",
            "notes_url": "https://updates.example.com/notes/1.1.0",
        },
    )

    resp = client.get("/api/update/check?force=1")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data and data.get("ok") is True
    assert data.get("update_available") is True
    assert data.get("latest_version") == "1.1.0"
    assert data.get("reason") == "update_available"
    assert data.get("download_url") == "https://updates.example.com/ACTRA-1.1.0.exe"


def test_update_check_returns_offline_with_cache_fallback(client, monkeypatch, tmp_path):
    cache_path = tmp_path / "update_check_cache.json"
    monkeypatch.setenv("ACTRA_UPDATE_CHECK_ENABLED", "1")
    monkeypatch.setenv("ACTRA_UPDATE_MANIFEST_URL", "https://updates.example.com/latest.json")
    monkeypatch.setattr(server, "_update_cache_path", lambda: cache_path)
    monkeypatch.setattr(server, "_get_app_version", lambda: "1.0.0")
    monkeypatch.setattr(server, "_get_cached_internet_connectivity", lambda **_kwargs: True)
    monkeypatch.setattr(
        server,
        "_fetch_update_manifest",
        lambda *_args, **_kwargs: {"latest_version": "1.2.0"},
    )

    first = client.get("/api/update/check?force=1")
    assert first.status_code == 200

    monkeypatch.setattr(server, "_get_cached_internet_connectivity", lambda **_kwargs: False)
    second = client.get("/api/update/check?force=1")
    assert second.status_code == 200
    data = second.get_json()
    assert data and data.get("ok") is True
    assert data.get("from_cache") is True
    assert data.get("reason") == "offline_cached"
