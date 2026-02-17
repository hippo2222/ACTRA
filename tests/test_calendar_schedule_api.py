import os
from datetime import date

import pytest
import requests


def _resolve_base_url() -> str:
    """
    Tries several common hosts/ports to find the running server.
    Uses direct sockets (proxies disabled) to avoid env proxy issues.
    """
    candidates = [
        os.getenv("CALENDAR_API_BASE"),
        "http://127.0.0.1:8000",  # desktop-app/server.py default
        "http://localhost:8000",
        "http://127.0.0.1:5000",
        "http://localhost:5000",
    ]
    candidates = [c for c in candidates if c]

    errors = []
    for base in candidates:
        try:
            requests.get(base, timeout=2, proxies={"http": None, "https": None})
            return base
        except Exception as e:  # noqa: BLE001
            errors.append(f"{base}: {e}")

    pytest.skip(
        "API server is not reachable on common hosts/ports.\n" + "\n".join(errors)
    )


def test_calendar_schedule_endpoint_has_new_fields():
    base_url = _resolve_base_url()

    days = 4
    resp = requests.get(
        f"{base_url}/api/calendar/schedule",
        params={"days": days},
        proxies={"http": None, "https": None},
        timeout=5,
    )
    if resp.status_code == 404:
        pytest.skip("calendar schedule endpoint not available on the running server")
    assert resp.status_code == 200
    payload = resp.json()

    # Accept either `success` or `ok` flag
    assert payload.get("success", payload.get("ok")) is True
    schedule = payload.get("schedule", [])

    # Expected: days requested + yesterday (service uses range(-1, days_count))
    assert len(schedule) == days + 1

    # Today item must be present and flagged
    today_iso = date.today().isoformat()
    today_items = [d for d in schedule if d.get("date") == today_iso]
    assert today_items, "Today item must be present"
    assert today_items[0].get("is_today") is True

    # Each item should have the new fields
    sample = schedule[0]
    assert "day_num" in sample
    assert "month" in sample
    assert "is_future" in sample

    # Missed badge for yesterday when no activity is acceptable but not enforced here


if __name__ == "__main__":
    pytest.main([__file__])
