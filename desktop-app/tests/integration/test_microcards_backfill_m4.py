import io
import json
import shutil
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.calendar.microcards_backfill import main as backfill_main  # type: ignore


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _make_data_root() -> Path:
    tmp_root = Path.cwd() / ".pytest_tmp_m4_backfill_integration"
    tmp_root.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix="m4_backfill_it_", dir=str(tmp_root)))


def _run_cli(args):
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = backfill_main(args)
    payload = json.loads(buffer.getvalue())
    return code, payload


def test_m4_cli_rebuild_all_users_apply_and_verify():
    data_root = _make_data_root()
    try:
        _write_json(
            data_root / "users" / "user_a" / "microcards" / "review_events.json",
            {
                "schema_version": "1.0",
                "user_id": "user_a",
                "items": [
                    {
                        "id": "evt_a1",
                        "reviewed_at": "2026-03-01T10:00:00",
                        "response_time_ms": 2100,
                        "was_correct": True,
                        "details": {"card_type": "fact_recall"},
                    }
                ],
            },
        )

        _write_json(
            data_root / "user_calendar" / "user_b" / "activity.json",
            {
                "2026-03-02": {
                    "microcards_reviews": 7,
                    "microcards_correct": 7,
                    "microcards_seconds_spent": 14,
                }
            },
        )
        _write_json(
            data_root / "user_calendar" / "user_b" / "settings.json",
            {
                "user_id": "user_b",
                "daily_time_limit_minutes": 30,
                "schedule_mode": "daily",
                "streak_days": 3,
                "last_activity_date": "2026-03-02",
                "created_at": "2026-01-01T00:00:00",
                "updated_at": "2026-01-01T00:00:00",
            },
        )

        dry_code, dry_payload = _run_cli(
            ["--data-root", str(data_root), "--mode", "dry-run", "rebuild-all-users"]
        )
        assert dry_code == 0
        assert dry_payload["ok"] is True
        assert dry_payload["users_total"] == 2

        apply_code, apply_payload = _run_cli(
            ["--data-root", str(data_root), "--mode", "apply", "rebuild-all-users"]
        )
        assert apply_code == 0
        assert apply_payload["ok"] is True
        assert apply_payload["users_total"] == 2

        verify_code, verify_payload = _run_cli(
            ["--data-root", str(data_root), "--mode", "verify", "rebuild-all-users"]
        )
        assert verify_code == 0
        assert verify_payload["ok"] is True
        assert verify_payload["users_total"] == 2

        user_a_activity = _read_json(data_root / "user_calendar" / "user_a" / "activity.json")
        day_a = user_a_activity["2026-03-01"]
        assert day_a["microcards_reviews"] == 1
        assert day_a["microcards_correct"] == 1
        assert day_a["microcards_seconds_spent"] == 2
        assert day_a["activity_attempts_total"] == 1
        assert day_a["streak_active"] is True

        user_b_activity = _read_json(data_root / "user_calendar" / "user_b" / "activity.json")
        day_b = user_b_activity["2026-03-02"]
        assert day_b["microcards_reviews"] == 0
        assert day_b["microcards_correct"] == 0
        assert day_b["microcards_seconds_spent"] == 0
        assert day_b["activity_attempts_total"] == 0
        assert day_b["streak_active"] is False

        status_a = data_root / "users" / "user_a" / "microcards" / "backfill_status.json"
        status_b = data_root / "users" / "user_b" / "microcards" / "backfill_status.json"
        assert status_a.exists()
        assert status_b.exists()
    finally:
        shutil.rmtree(data_root)
