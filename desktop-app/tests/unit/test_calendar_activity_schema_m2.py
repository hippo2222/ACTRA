import json
import shutil
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.calendar import CalendarService  # type: ignore
from services.calendar.calendar_service import _normalize_activity_entry  # type: ignore


def _make_calendar_service():
    tmp_root = Path.cwd() / ".pytest_tmp_calendar_m2"
    tmp_root.mkdir(parents=True, exist_ok=True)
    tmp_dir = Path(tempfile.mkdtemp(prefix="calendar_m2_", dir=str(tmp_root)))
    svc = CalendarService(data_dir=str(tmp_dir), user_id="test_user")
    return svc, tmp_dir


def test_normalize_activity_entry_m2_fields_and_legacy_int():
    legacy = _normalize_activity_entry(75)
    assert legacy["completion_percent"] == 0
    assert legacy["tasks_attempted"] == 0
    assert legacy["microcards_reviews"] == 0
    assert legacy["activity_attempts_total"] == 0
    assert legacy["activity_sources"]["tasks"] == {
        "attempts": 0,
        "successes": 0,
        "seconds_spent": 0,
    }
    assert legacy["activity_sources"]["microcards"] == {
        "attempts": 0,
        "successes": 0,
        "seconds_spent": 0,
    }

    mixed = _normalize_activity_entry(
        {
            "tasks_attempted": "5",
            "tasks_solved": 4,
            "seconds_spent": "780",
            "microcards_reviews": "18",
            "microcards_correct": 14,
            "microcards_seconds_spent": "540",
            "microcards_pair_match_reviews": "3",
            "microcards_pair_match_perfect": 1,
            "session_ids": "not-a-list",
            "activity_sources": {"tasks": {"attempts": 999}},
            "activity_attempts_total": 999,
        }
    )
    assert mixed["session_ids"] == []
    assert mixed["tasks_attempted"] == 5
    assert mixed["tasks_solved"] == 4
    assert mixed["seconds_spent"] == 780
    assert mixed["microcards_reviews"] == 18
    assert mixed["microcards_correct"] == 14
    assert mixed["microcards_seconds_spent"] == 540
    assert mixed["microcards_pair_match_reviews"] == 3
    assert mixed["microcards_pair_match_perfect"] == 1
    assert mixed["activity_attempts_total"] == 23
    assert mixed["activity_success_total"] == 18
    assert mixed["activity_seconds_spent_total"] == 1320
    assert mixed["activity_sources"]["tasks"] == {
        "attempts": 5,
        "successes": 4,
        "seconds_spent": 780,
    }
    assert mixed["activity_sources"]["microcards"] == {
        "attempts": 18,
        "successes": 14,
        "seconds_spent": 540,
    }


def test_get_activity_history_safe_reads_old_and_partial_activity_json():
    svc, tmp_dir = _make_calendar_service()
    try:
        today_iso = date.today().isoformat()
        prev_iso = (date.today() - timedelta(days=1)).isoformat()
        payload = {
            prev_iso: 80,  # legacy int-only format; sanitized to defaults
            today_iso: {
                "tasks_attempted": 2,
                "tasks_solved": 1,
                "seconds_spent": 90,
            },
        }
        with open(svc.activity_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)

        history = svc.get_activity_history()

        assert history[prev_iso]["completion_percent"] == 0
        assert history[prev_iso]["microcards_reviews"] == 0
        assert history[prev_iso]["activity_attempts_total"] == 0
        assert history[prev_iso]["activity_sources"]["microcards"]["attempts"] == 0

        assert history[today_iso]["tasks_attempted"] == 2
        assert history[today_iso]["tasks_solved"] == 1
        assert history[today_iso]["seconds_spent"] == 90
        assert history[today_iso]["activity_attempts_total"] == 2
        assert history[today_iso]["activity_success_total"] == 1
        assert history[today_iso]["activity_seconds_spent_total"] == 90
        assert history[today_iso]["microcards_reviews"] == 0
    finally:
        shutil.rmtree(tmp_dir)


def test_get_activity_for_heatmap_includes_m2_mixed_fields_additively():
    svc, tmp_dir = _make_calendar_service()
    try:
        today_iso = date.today().isoformat()
        with open(svc.activity_path, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    today_iso: {
                        "completion_percent": 80,
                        "tasks_attempted": 5,
                        "tasks_solved": 4,
                        "seconds_spent": 780,
                        "microcards_reviews": 18,
                        "microcards_correct": 14,
                        "microcards_seconds_spent": 540,
                        "microcards_pair_match_reviews": 3,
                        "microcards_pair_match_perfect": 1,
                    }
                },
                fh,
                ensure_ascii=False,
                indent=2,
            )

        heatmap = svc.get_activity_for_heatmap(days=1)
        assert len(heatmap) == 2  # today + one future day

        today_payload = heatmap[0]
        assert today_payload["date"] == today_iso
        assert today_payload["completion_percent"] == 80  # legacy field preserved
        assert today_payload["tasks_attempted"] == 5
        assert today_payload["tasks_solved"] == 4
        assert today_payload["seconds_spent"] == 780
        assert today_payload["microcards_reviews"] == 18
        assert today_payload["microcards_correct"] == 14
        assert today_payload["microcards_seconds_spent"] == 540
        assert today_payload["microcards_pair_match_reviews"] == 3
        assert today_payload["microcards_pair_match_perfect"] == 1
        assert today_payload["activity_attempts_total"] == 23
        assert today_payload["activity_success_total"] == 18
        assert today_payload["activity_seconds_spent_total"] == 1320
        assert today_payload["activity_sources"]["tasks"]["attempts"] == 5
        assert today_payload["activity_sources"]["tasks"]["successes"] == 4
        assert today_payload["activity_sources"]["microcards"]["attempts"] == 18
        assert today_payload["activity_sources"]["microcards"]["successes"] == 14

        future_payload = heatmap[1]
        assert "activity_sources" in future_payload
        assert future_payload["microcards_reviews"] == 0
        assert future_payload["activity_attempts_total"] == 0
    finally:
        shutil.rmtree(tmp_dir)
