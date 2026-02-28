import json
import shutil
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.microcards_analytics_service import MicrocardsAnalyticsService  # type: ignore


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _make_data_root() -> Path:
    tmp_root = Path.cwd() / ".pytest_tmp_m5_microcards_analytics"
    tmp_root.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix="m5_microcards_analytics_", dir=str(tmp_root)))


def _seed_user_fixture(data_root: Path, user_id: str) -> dict:
    now_local = datetime.now().replace(microsecond=0)
    today_iso = now_local.date().isoformat()
    yesterday_iso = (now_local - timedelta(days=1)).date().isoformat()
    tomorrow_utc = (datetime.utcnow() + timedelta(days=1)).replace(microsecond=0).isoformat() + "Z"
    yesterday_utc = (datetime.utcnow() - timedelta(days=1)).replace(microsecond=0).isoformat() + "Z"

    _write_json(
        data_root / "microcards" / "decks" / "deck_1.json",
        {
            "id": "deck_1",
            "name": "Deck 1",
            "cards": [
                {"id": "c1", "card_type": "fact_recall", "status": "active"},
                {"id": "c2", "card_type": "pair_match", "status": "active"},
                {"id": "c3", "card_type": "fact_recall", "status": "archived"},
            ],
        },
    )
    _write_json(
        data_root / "microcards" / "decks" / "deck_2.json",
        {
            "id": "deck_2",
            "name": "Deck 2",
            "cards": [
                {"id": "c4", "card_type": "fact_recall", "status": "active"},
            ],
        },
    )

    _write_json(
        data_root / "users" / user_id / "microcards" / "review_states.json",
        {
            "schema_version": "1.0",
            "user_id": user_id,
            "items": {
                "c1": {"status": "new"},
                "c2": {"status": "review", "due_at": yesterday_utc},
                "c4": {"status": "review", "due_at": tomorrow_utc},
            },
        },
    )

    _write_json(
        data_root / "users" / user_id / "microcards" / "review_events.json",
        {
            "schema_version": "1.0",
            "user_id": user_id,
            "items": [
                {
                    "id": "evt_today_fact",
                    "reviewed_at": now_local.isoformat(timespec="seconds"),
                    "rating": "good",
                    "response_time_ms": 2000,
                    "was_correct": True,
                    "details": {"card_type": "fact_recall"},
                },
                {
                    "id": "evt_today_pair_nonperfect",
                    "reviewed_at": now_local.isoformat(timespec="seconds"),
                    "rating": "again",
                    "response_time_ms": 1500,
                    "was_correct": False,
                    "details": {"card_type": "pair_match", "is_perfect": False, "partial_score": 50.0},
                },
                {
                    "id": "evt_yesterday_pair_perfect",
                    "reviewed_at": (now_local - timedelta(days=1)).isoformat(timespec="seconds"),
                    "rating": "easy",
                    "response_time_ms": 1000,
                    "was_correct": True,
                    "details": {"card_type": "pair_match", "is_perfect": True, "partial_score": 100.0},
                },
            ],
        },
    )

    return {"today_iso": today_iso, "yesterday_iso": yesterday_iso}


def test_m5_microcards_summary_contract_and_aggregates():
    data_root = _make_data_root()
    user_id = "m5_user_a"
    _seed_user_fixture(data_root, user_id)
    try:
        svc = MicrocardsAnalyticsService(
            str(data_root),
            summary_cache_ttl_seconds=600,
            dynamics_cache_ttl_seconds=600,
        )
        summary = svc.get_summary(user_id=user_id)

        assert summary["user_id"] == user_id
        assert isinstance(summary.get("generated_at"), str) and summary["generated_at"]

        assert summary["totals"]["reviews"] == 3
        assert summary["totals"]["correct_reviews"] == 2
        assert summary["totals"]["correct_rate"] == 0.667
        assert summary["totals"]["time_spent_seconds"] == 4
        assert summary["totals"]["decks_active"] == 2

        assert summary["today"]["reviews"] == 2
        assert summary["today"]["correct_reviews"] == 1
        assert summary["today"]["correct_rate"] == 0.5
        assert summary["today"]["time_spent_seconds"] == 3

        assert summary["queue_summary"] == {
            "decks_with_due": 1,
            "cards_due_total": 2,
            "cards_new_total": 1,
        }

        assert summary["by_card_type"]["fact_recall"]["reviews"] == 1
        assert summary["by_card_type"]["fact_recall"]["correct_rate"] == 1.0
        assert summary["by_card_type"]["pair_match"]["reviews"] == 2
        assert summary["by_card_type"]["pair_match"]["correct_rate"] == 0.5
        assert summary["by_card_type"]["pair_match"]["perfect_rate"] == 0.5

        assert summary["ratings_distribution"] == {
            "again": 1,
            "hard": 0,
            "good": 1,
            "easy": 1,
        }
    finally:
        shutil.rmtree(data_root)


def test_m5_microcards_summary_cache_clear_and_dynamics():
    data_root = _make_data_root()
    user_id = "m5_user_b"
    fixture_meta = _seed_user_fixture(data_root, user_id)
    try:
        svc = MicrocardsAnalyticsService(
            str(data_root),
            summary_cache_ttl_seconds=600,
            dynamics_cache_ttl_seconds=600,
        )

        first = svc.get_summary(user_id=user_id)
        assert first["totals"]["reviews"] == 3

        events_path = data_root / "users" / user_id / "microcards" / "review_events.json"
        events_payload = _read_json(events_path)
        events_payload["items"].append(
            {
                "id": "evt_cache_after_first_read",
                "reviewed_at": datetime.now().replace(microsecond=0).isoformat(timespec="seconds"),
                "rating": "hard",
                "response_time_ms": 500,
                "was_correct": True,
                "details": {"card_type": "fact_recall"},
            }
        )
        _write_json(events_path, events_payload)

        cached = svc.get_summary(user_id=user_id)
        assert cached["totals"]["reviews"] == 3

        svc.clear_cache(user_id=user_id)
        refreshed = svc.get_summary(user_id=user_id, include_dynamics=True, dynamics_days=7)
        assert refreshed["totals"]["reviews"] == 4
        assert refreshed["ratings_distribution"]["hard"] == 1
        assert isinstance(refreshed.get("dynamics"), list)
        assert len(refreshed["dynamics"]) >= 2
        assert refreshed["dynamics"][-1]["date"] == fixture_meta["today_iso"]
    finally:
        shutil.rmtree(data_root)
