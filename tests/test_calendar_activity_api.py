import os
from datetime import date

import pytest
import requests

# Note: rest-day test requires manual setup via /api/calendar/rest-days/<date> POST
# and is better suited for integration tests with fixture data


def _resolve_base_url() -> str:
    """
    Tries several common hosts/ports to find the running server.
    Uses direct sockets (proxies disabled) to avoid env proxy issues.
    """
    candidates = [
        os.getenv("CALENDAR_API_BASE"),
        "http://127.0.0.1:8000",  # default for desktop-app/server.py
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
        "API server is not reachable on common hosts/ports.\n"
        + "\n".join(errors)
    )


def test_calendar_activity_endpoint_returns_days_and_future():
    base_url = _resolve_base_url()

    days = 5
    resp = requests.get(
        f"{base_url}/api/calendar/activity",
        params={"days": days},
        proxies={"http": None, "https": None},
        timeout=5,
    )
    assert resp.status_code == 200
    payload = resp.json()

    # Accept either `success` or `ok` flag
    assert payload.get("success", payload.get("ok")) is True
    activity = payload.get("activity", [])

    # Expected: days requested + 1 future day appended by service
    assert len(activity) == days + 1

    today_iso = date.today().isoformat()
    today_items = [d for d in activity if d.get("is_today")]
    assert today_items, "Today item must be present"
    assert today_items[0].get("date") == today_iso

    # Basic shape check on activity items
    sample = activity[0]
    assert "completion_percent" in sample
    assert "is_future" in sample


def test_calendar_today_endpoint_structure():
    base_url = _resolve_base_url()

    resp = requests.get(
        f"{base_url}/api/calendar/today",
        proxies={"http": None, "https": None},
        timeout=5,
    )
    assert resp.status_code == 200
    payload = resp.json()

    assert payload.get("success", payload.get("ok")) is True
    # Minimum expected keys
    assert "daily_plan" in payload
    assert "settings" in payload
    assert "streak_info" in payload


def test_activity_no_missed_when_no_history():
    """is_missed не выставляется, если has_any_activity == False."""
    base_url = _resolve_base_url()

    # Query 365 days to check if there is ANY activity in history overall
    resp_large = requests.get(
        f"{base_url}/api/calendar/activity",
        params={"days": 365},
        proxies={"http": None, "https": None},
        timeout=5,
    )
    assert resp_large.status_code == 200
    activity_large = resp_large.json().get("activity", [])
    has_any_history = any(
        d.get("activity_attempts_total", 0) > 0 or d.get("completion_percent", 0) > 0
        for d in activity_large
        if not d.get("is_future")
    )

    if not has_any_history:
        resp = requests.get(
            f"{base_url}/api/calendar/activity",
            params={"days": 7},
            proxies={"http": None, "https": None},
            timeout=5,
        )
        assert resp.status_code == 200
        payload = resp.json()
        activity = payload.get("activity", [])
        for day in activity:
            if not day.get("is_today") and not day.get("is_future"):
                assert not day.get("is_missed"), f"Day {day['date']} should not be marked as missed when no activity history"


def test_activity_exactly_one_today():
    """Ровно один элемент должен иметь is_today == True."""
    base_url = _resolve_base_url()

    resp = requests.get(
        f"{base_url}/api/calendar/activity",
        params={"days": 10},
        proxies={"http": None, "https": None},
        timeout=5,
    )
    assert resp.status_code == 200
    payload = resp.json()
    activity = payload.get("activity", [])

    today_items = [d for d in activity if d.get("is_today")]
    assert len(today_items) == 1, "Exactly one day must be marked as today"


def test_activity_new_fields_present():
    """Проверка наличия новых полей в ответе API."""
    base_url = _resolve_base_url()

    resp = requests.get(
        f"{base_url}/api/calendar/activity",
        params={"days": 3},
        proxies={"http": None, "https": None},
        timeout=5,
    )
    assert resp.status_code == 200
    payload = resp.json()
    activity = payload.get("activity", [])

    assert len(activity) > 0, "Activity should not be empty"
    sample = activity[0]

    # Проверяем новые поля
    assert "tasks_solved" in sample
    assert "tasks_attempted" in sample
    assert "seconds_spent" in sample
    assert "is_rest_day" in sample
    assert "target_minutes" in sample
    assert isinstance(sample["tasks_solved"], int)
    assert isinstance(sample["tasks_attempted"], int)
    assert isinstance(sample["seconds_spent"], int)
    assert isinstance(sample["is_rest_day"], bool)
    assert isinstance(sample["target_minutes"], int)
