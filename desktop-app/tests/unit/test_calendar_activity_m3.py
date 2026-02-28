import shutil
import sys
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.calendar import CalendarService  # type: ignore


def _make_calendar_service():
    tmp_root = Path.cwd() / ".pytest_tmp_calendar_m3"
    tmp_root.mkdir(parents=True, exist_ok=True)
    tmp_dir = Path(tempfile.mkdtemp(prefix="calendar_m3_", dir=str(tmp_root)))
    svc = CalendarService(data_dir=str(tmp_dir), user_id="test_user")
    return svc, tmp_dir


def _utc_z_now_same_local_day() -> str:
    """
    Build UTC timestamp that round-trips back to the current local day
    when parsed and converted to local time.
    """
    now_local = datetime.now().astimezone()
    return (
        now_local.astimezone(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def test_record_microcards_review_updates_activity_and_streak_once_per_day():
    svc, tmp_dir = _make_calendar_service()
    try:
        reviewed_at = _utc_z_now_same_local_day()

        r1 = svc.record_microcards_review(
            deck_id="deck_1",
            card_id="mc_1",
            review_event={
                "id": "mcrev_1",
                "reviewed_at": reviewed_at,
                "rating": "good",
                "response_time_ms": 1500,
                "was_correct": True,
                "details": {"card_type": "fact_recall"},
            },
        )
        r2 = svc.record_microcards_review(
            deck_id="deck_1",
            card_id="mc_2",
            review_event={
                "id": "mcrev_2",
                "reviewed_at": reviewed_at,
                "rating": "again",
                "response_time_ms": 2500,
                "was_correct": False,
                "details": {
                    "card_type": "pair_match",
                    "is_perfect": False,
                    "partial_score": 50.0,
                },
            },
        )

        assert r1["success"] is True
        assert r2["success"] is True
        assert r1["activity_date"] == r2["activity_date"]

        activity_date = r1["activity_date"]
        history = svc.get_activity_history()
        day = history[activity_date]

        assert day["microcards_reviews"] == 2
        assert day["microcards_correct"] == 1
        assert day["microcards_seconds_spent"] == 3  # floor(1500/1000) + floor(2500/1000)
        assert day["microcards_pair_match_reviews"] == 1
        assert day["microcards_pair_match_perfect"] == 0
        assert day["activity_attempts_total"] == 2
        assert day["activity_success_total"] == 1
        assert day["activity_seconds_spent_total"] == 3
        assert day["activity_sources"]["microcards"]["attempts"] == 2
        assert day["activity_sources"]["microcards"]["successes"] == 1
        assert day["streak_active"] is True

        settings = svc.get_settings()
        assert settings.streak_days == 1
        assert settings.last_activity_date is not None
        assert settings.last_activity_date.isoformat() == activity_date
    finally:
        shutil.rmtree(tmp_dir)


def test_complete_session_uses_shared_streak_helper_and_persists_streak_active():
    svc, tmp_dir = _make_calendar_service()
    try:
        started = svc.start_session("unplanned")
        session_id = started["session_id"]

        result = svc.complete_session(
            session_id=session_id,
            tasks_completed=0,
            active_time_seconds=120,
        )
        assert result["success"] is True
        assert result["streak_days"] == 1

        today_iso = date.today().isoformat()
        history = svc.get_activity_history()
        assert today_iso in history
        assert history[today_iso]["streak_active"] is True

        settings = svc.get_settings()
        assert settings.last_activity_date is not None
        assert settings.last_activity_date.isoformat() == today_iso
    finally:
        shutil.rmtree(tmp_dir)


def test_heatmap_does_not_mark_microcards_only_day_as_missed():
    svc, tmp_dir = _make_calendar_service()
    try:
        reviewed_at = _utc_z_now_same_local_day()

        res = svc.record_microcards_review(
            deck_id="deck_1",
            card_id="mc_1",
            review_event={
                "id": "mcrev_heatmap_1",
                "reviewed_at": reviewed_at,
                "rating": "good",
                "response_time_ms": 900,
                "was_correct": True,
                "details": {"card_type": "fact_recall"},
            },
        )
        activity_date = res["activity_date"]

        heatmap = svc.get_activity_for_heatmap(days=1)
        row = next((x for x in heatmap if x.get("date") == activity_date), None)
        assert isinstance(row, dict)
        assert row["microcards_reviews"] == 1
        assert row["activity_attempts_total"] == 1
        assert row["is_missed"] is False
        assert row["streak_active"] is True if "streak_active" in row else True
    finally:
        shutil.rmtree(tmp_dir)
