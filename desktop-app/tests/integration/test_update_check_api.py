import sys
from pathlib import Path

import pytest

DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if not (DESKTOP_APP_PATH / "server.py").exists():
    DESKTOP_APP_PATH = DESKTOP_APP_PATH / "desktop-app"
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import server  # type: ignore


@pytest.fixture(autouse=True)
def _mock_misc_helpers(monkeypatch):
    """Mock misc_helpers for update check routes after refactoring."""
    import routes._context as ctx_module
    
    def build_update_status_mock(force=False):
        """Default mock that returns 'not configured' status."""
        return {
            "manifest_url_configured": False,
            "update_available": False,
            "reason": "not_configured",
        }
    
    misc_helpers = {
        "env_bool": lambda key, default: default,
        "update_manifest_url": lambda: "",
        "configured_update_manifest_url_from_config": lambda: "",
        "update_cache_path": lambda: Path("./update_check_cache.json"),
        "get_cached_internet_connectivity": lambda **kwargs: True,
        "get_app_version": lambda: "1.0.0",
        "fetch_update_manifest": lambda *args, **kwargs: {},
        "manifest_url_requires_internet": lambda url: True,
        "build_update_status": build_update_status_mock,
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


def test_update_check_returns_not_configured_when_manifest_missing(client, monkeypatch, tmp_path, _mock_misc_helpers):
    monkeypatch.setenv("ACTRA_UPDATE_CHECK_ENABLED", "1")
    monkeypatch.delenv("ACTRA_UPDATE_MANIFEST_URL", raising=False)
    _mock_misc_helpers["configured_update_manifest_url_from_config"] = lambda: ""
    _mock_misc_helpers["update_cache_path"] = lambda: tmp_path / "update_check_cache.json"

    resp = client.get("/api/update/check")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data and data.get("ok") is True
    assert data.get("manifest_url_configured") is False
    assert data.get("reason") == "not_configured"
    assert data.get("update_available") is False


def test_update_check_reports_update_available(client, monkeypatch, tmp_path, _mock_misc_helpers):
    monkeypatch.setenv("ACTRA_UPDATE_CHECK_ENABLED", "1")
    monkeypatch.setenv("ACTRA_UPDATE_MANIFEST_URL", "https://updates.example.com/latest.json")
    
    _mock_misc_helpers["build_update_status"] = lambda force=False: {
        "manifest_url_configured": True,
        "update_available": True,
        "latest_version": "1.1.0",
        "download_url": "https://updates.example.com/ACTRA-1.1.0.exe",
        "notes_url": "https://updates.example.com/notes/1.1.0",
        "reason": "update_available",
    }

    resp = client.get("/api/update/check?force=1")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data and data.get("ok") is True
    assert data.get("update_available") is True
    assert data.get("latest_version") == "1.1.0"
    assert data.get("reason") == "update_available"
    assert data.get("download_url") == "https://updates.example.com/ACTRA-1.1.0.exe"


def test_update_check_returns_offline_with_cache_fallback(client, monkeypatch, tmp_path, _mock_misc_helpers):
    cache_path = tmp_path / "update_check_cache.json"
    monkeypatch.setenv("ACTRA_UPDATE_CHECK_ENABLED", "1")
    monkeypatch.setenv("ACTRA_UPDATE_MANIFEST_URL", "https://updates.example.com/latest.json")
    
    # First call online
    _mock_misc_helpers["build_update_status"] = lambda force=False: {
        "manifest_url_configured": True,
        "update_available": True,
        "latest_version": "1.2.0",
        "reason": "update_available",
    }

    first = client.get("/api/update/check?force=1")
    assert first.status_code == 200

    # Second call offline with cache
    _mock_misc_helpers["build_update_status"] = lambda force=False: {
        "manifest_url_configured": True,
        "update_available": True,
        "from_cache": True,
        "latest_version": "1.2.0",
        "reason": "offline_cached",
    }
    
    second = client.get("/api/update/check?force=1")
    assert second.status_code == 200
    data = second.get_json()
    assert data and data.get("ok") is True
    assert data.get("from_cache") is True
    assert data.get("reason") == "offline_cached"


def test_update_check_uses_local_config_manifest_without_internet(client, monkeypatch, tmp_path, _mock_misc_helpers):
    monkeypatch.setenv("ACTRA_UPDATE_CHECK_ENABLED", "1")
    monkeypatch.delenv("ACTRA_UPDATE_MANIFEST_URL", raising=False)
    
    _mock_misc_helpers["build_update_status"] = lambda force=False: {
        "manifest_url_configured": True,
        "manifest_requires_internet": False,
        "update_available": False,
        "latest_version": "1.0.0",
        "reason": "up_to_date",
    }

    resp = client.get("/api/update/check?force=1")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data and data.get("ok") is True
    assert data.get("manifest_url_configured") is True
    assert data.get("manifest_requires_internet") is False
    assert data.get("reason") == "up_to_date"
