import sys
import time
from pathlib import Path


DESKTOP_APP_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = Path(__file__).resolve().parents[3]

if str(DESKTOP_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_ROOT))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import server


def test_get_cached_internet_connectivity_allow_stale_returns_cached_value(monkeypatch):
    original_cache = dict(server._network_probe_cache)
    try:
        server._network_probe_cache.update(
            {
                "checked_at": time.time() - (server.NETWORK_PROBE_CACHE_TTL_SEC + 5),
                "internet_online": True,
                "refreshing": False,
            }
        )
        refresh_calls = []
        monkeypatch.setattr(
            server,
            "_start_async_internet_connectivity_refresh",
            lambda: refresh_calls.append("refresh") or True,
        )

        status = server._get_cached_internet_connectivity(force=False, allow_stale=True)

        assert status is True
        assert refresh_calls == ["refresh"]
    finally:
        server._network_probe_cache.clear()
        server._network_probe_cache.update(original_cache)


def test_get_cached_internet_connectivity_force_still_runs_sync_probe(monkeypatch):
    original_cache = dict(server._network_probe_cache)
    try:
        server._network_probe_cache.update(
            {
                "checked_at": 0.0,
                "internet_online": None,
                "refreshing": False,
            }
        )
        sync_calls = []
        monkeypatch.setattr(
            server,
            "_check_internet_connectivity",
            lambda timeout_sec: sync_calls.append(timeout_sec) or False,
        )

        status = server._get_cached_internet_connectivity(force=True)

        assert status is False
        assert len(sync_calls) == 1
    finally:
        server._network_probe_cache.clear()
        server._network_probe_cache.update(original_cache)
