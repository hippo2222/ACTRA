import json
import shutil
import sys
import tempfile
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.calendar.microcards_backfill import run_backfill_for_user  # type: ignore


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _make_data_root() -> Path:
    tmp_root = Path.cwd() / ".pytest_tmp_m4_backfill_unit"
    tmp_root.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix="m4_backfill_unit_", dir=str(tmp_root)))


def _seed_user_fixture(data_root: Path, user_id: str) -> None:
    _write_json(
        data_root / "users" / user_id / "microcards" / "review_events.json",
        {
            "schema_version": "1.0",
            "user_id": user_id,
            "items": [
                {
                    "id": "evt_3",
                    "reviewed_at": "2026-02-02T09:00:00",
                    "response_time_ms": 1200,
                    "was_correct": True,
                    "details": {"card_type": "pair_match", "is_perfect": True},
                },
                {
                    "id": "evt_bad",
                    "reviewed_at": "not-a-timestamp",
                    "response_time_ms": 500,
                    "was_correct": True,
                    "details": {"card_type": "fact_recall"},
                },
                {
                    "id": "evt_1",
                    "reviewed_at": "2026-02-01T08:00:00",
                    "response_time_ms": 2500,
                    "was_correct": True,
                    "details": {"card_type": "fact_recall"},
                },
                {
                    "id": "evt_2",
                    "reviewed_at": "2026-02-01T12:30:00",
                    "response_time_ms": 800,
                    "was_correct": False,
                    "details": {"card_type": "pair_match", "is_perfect": False},
                },
            ],
        },
    )

    _write_json(
        data_root / "user_calendar" / user_id / "activity.json",
        {
            "2026-02-01": {
                "tasks_attempted": 2,
                "tasks_solved": 1,
                "seconds_spent": 90,
                "completion_percent": 40,
                "microcards_reviews": 99,
                "microcards_correct": 88,
                "microcards_seconds_spent": 777,
                "microcards_pair_match_reviews": 10,
                "microcards_pair_match_perfect": 10,
            },
            "2026-02-03": {
                "microcards_reviews": 5,
                "microcards_correct": 5,
                "microcards_seconds_spent": 10,
            },
        },
    )

    _write_json(
        data_root / "user_calendar" / user_id / "settings.json",
        {
            "user_id": user_id,
            "daily_time_limit_minutes": 30,
            "schedule_mode": "daily",
            "streak_days": 17,
            "last_activity_date": "2026-02-03",
            "created_at": "2026-01-01T00:00:00",
            "updated_at": "2026-01-01T00:00:00",
        },
    )


def test_m4_backfill_apply_is_deterministic_and_preserves_task_fields():
    data_root = _make_data_root()
    user_id = "m4_user_a"
    _seed_user_fixture(data_root, user_id)
    try:
        dry_run = run_backfill_for_user(data_root=data_root, user_id=user_id, mode="dry-run")
        assert dry_run["events_total"] == 4
        assert dry_run["events_processed"] == 3
        assert dry_run["events_invalid"] == 1
        assert dry_run["days_touched"] == 2
        assert dry_run["totals"]["microcards_reviews"] == 3
        assert dry_run["totals"]["microcards_correct"] == 2
        assert dry_run["totals"]["microcards_seconds_spent"] == 3
        assert dry_run["writes"]["activity"] is False
        assert dry_run["writes"]["settings"] is False
        assert dry_run["verify_passed"] is False

        apply_report = run_backfill_for_user(data_root=data_root, user_id=user_id, mode="apply")
        assert apply_report["verify_passed"] is True
        assert apply_report["writes"]["activity"] is True
        assert apply_report["writes"]["settings"] is True
        assert apply_report["writes"]["status"] is True

        activity = _read_json(data_root / "user_calendar" / user_id / "activity.json")
        day_1 = activity["2026-02-01"]
        assert day_1["tasks_attempted"] == 2
        assert day_1["tasks_solved"] == 1
        assert day_1["seconds_spent"] == 90
        assert day_1["microcards_reviews"] == 2
        assert day_1["microcards_correct"] == 1
        assert day_1["microcards_seconds_spent"] == 2
        assert day_1["microcards_pair_match_reviews"] == 1
        assert day_1["microcards_pair_match_perfect"] == 0
        assert day_1["activity_attempts_total"] == 4
        assert day_1["activity_success_total"] == 2
        assert day_1["streak_active"] is True

        day_2 = activity["2026-02-02"]
        assert day_2["microcards_reviews"] == 1
        assert day_2["microcards_correct"] == 1
        assert day_2["microcards_seconds_spent"] == 1
        assert day_2["microcards_pair_match_reviews"] == 1
        assert day_2["microcards_pair_match_perfect"] == 1
        assert day_2["activity_attempts_total"] == 1
        assert day_2["activity_success_total"] == 1

        day_3 = activity["2026-02-03"]
        assert day_3["microcards_reviews"] == 0
        assert day_3["microcards_correct"] == 0
        assert day_3["microcards_seconds_spent"] == 0
        assert day_3["activity_attempts_total"] == 0
        assert day_3["streak_active"] is False

        settings = _read_json(data_root / "user_calendar" / user_id / "settings.json")
        assert settings["streak_days"] == 2
        assert settings["last_activity_date"] == "2026-02-02"

        status_path = data_root / "users" / user_id / "microcards" / "backfill_status.json"
        assert status_path.exists()
        status = _read_json(status_path)
        assert status["schema_version"] == "1.0"
        assert status["user_id"] == user_id
        assert status["verify_passed"] is True

        apply_again = run_backfill_for_user(data_root=data_root, user_id=user_id, mode="apply")
        assert apply_again["verify_passed"] is True
        assert apply_again["days_changed"] == 0
        assert apply_again["writes"]["activity"] is False
    finally:
        shutil.rmtree(data_root)


def test_m4_backfill_verify_detects_mismatches():
    data_root = _make_data_root()
    user_id = "m4_user_b"
    _seed_user_fixture(data_root, user_id)
    try:
        run_backfill_for_user(data_root=data_root, user_id=user_id, mode="apply")

        activity_path = data_root / "user_calendar" / user_id / "activity.json"
        activity = _read_json(activity_path)
        activity["2026-02-02"]["microcards_reviews"] = 99
        _write_json(activity_path, activity)

        settings_path = data_root / "user_calendar" / user_id / "settings.json"
        settings = _read_json(settings_path)
        settings["streak_days"] = 99
        _write_json(settings_path, settings)

        verify_report = run_backfill_for_user(data_root=data_root, user_id=user_id, mode="verify")
        assert verify_report["verify_passed"] is False
        assert verify_report["verify_activity_mismatch_count"] >= 1
        assert verify_report["verify_settings_mismatch"] is True
        assert verify_report["writes"]["activity"] is False
        assert verify_report["writes"]["settings"] is False
        assert verify_report["writes"]["status"] is False
    finally:
        shutil.rmtree(data_root)
