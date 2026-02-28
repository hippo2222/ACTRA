"""
Microcards -> calendar backfill tooling (M4).

This module rebuilds microcards activity counters from review_events source-of-truth
and merges them into calendar activity.json without breaking legacy task fields.
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from uuid import uuid4

from .calendar_service import _normalize_activity_entry
from .models import UserCalendarSettings

logger = logging.getLogger(__name__)


def _emit_backfill_telemetry(data_root: Path, event_name: str, **fields: Any) -> None:
    try:
        telemetry_dir = data_root / "telemetry"
        telemetry_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema_version": "1.0",
            "id": f"mcpevt_{uuid4().hex[:12]}",
            "event": event_name,
            "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "rollout_stage": "backfill",
            "user_id": fields.get("user_id", "system"),
            "microcards_feature_flags": None,
            "request_path": None,
            "request_method": None,
            "fields": {k: v for k, v in fields.items() if k != "user_id"},
        }
        import json as _json
        line = _json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with open(telemetry_dir / "microcards_prod_rollout_events.jsonl", "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception as exc:
        logger.debug("backfill telemetry emit failed: %s", exc)


BACKFILL_SCHEMA_VERSION = "1.0"
BACKFILL_STATUS_SCHEMA_VERSION = "1.0"
BACKFILL_MODES = {"dry-run", "apply", "verify"}

MICROCARDS_COUNTER_FIELDS: Tuple[str, ...] = (
    "microcards_reviews",
    "microcards_correct",
    "microcards_seconds_spent",
    "microcards_pair_match_reviews",
    "microcards_pair_match_perfect",
)

DEFAULT_REPORT_FIELDS: Tuple[str, ...] = (
    "tasks_attempted",
    "tasks_solved",
    "seconds_spent",
    "completion_percent",
    "streak_active",
    "microcards_reviews",
    "microcards_correct",
    "microcards_seconds_spent",
    "microcards_pair_match_reviews",
    "microcards_pair_match_perfect",
    "activity_attempts_total",
    "activity_success_total",
    "activity_seconds_spent_total",
    "activity_sources",
)


def _read_json_file(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        logger.exception("microcards backfill: failed to read %s", path)
        return default


def _write_json_file(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


def _safe_int(value: Any, *, minimum: int = 0) -> int:
    if isinstance(value, bool):
        parsed = 0
    else:
        try:
            parsed = int(value or 0)
        except Exception:
            parsed = 0
    if parsed < minimum:
        return minimum
    return parsed


def _empty_microcards_counters() -> Dict[str, int]:
    return {
        "microcards_reviews": 0,
        "microcards_correct": 0,
        "microcards_seconds_spent": 0,
        "microcards_pair_match_reviews": 0,
        "microcards_pair_match_perfect": 0,
    }


def _parse_iso_datetime(raw: str) -> Optional[datetime]:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None


def _event_local_day_iso(event: Dict[str, Any]) -> Optional[str]:
    reviewed_at_raw = str(event.get("reviewed_at") or "").strip()
    parsed = _parse_iso_datetime(reviewed_at_raw)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        return parsed.date().isoformat()
    return parsed.astimezone().date().isoformat()


def _event_sort_key(event: Dict[str, Any]) -> Tuple[int, str, str]:
    reviewed_at_raw = str(event.get("reviewed_at") or "").strip()
    parsed = _parse_iso_datetime(reviewed_at_raw)
    if parsed is None:
        time_rank = 1
        time_key = reviewed_at_raw
    else:
        time_rank = 0
        if parsed.tzinfo is None:
            time_key = parsed.isoformat(timespec="seconds")
        else:
            time_key = parsed.astimezone().isoformat(timespec="seconds")
    event_id = str(event.get("id") or "").strip()
    return (time_rank, time_key, event_id)


def _event_is_pair_match(event: Dict[str, Any]) -> bool:
    details = event.get("details") if isinstance(event.get("details"), dict) else {}
    return str(details.get("card_type") or "").strip().lower() == "pair_match"


def _event_pair_match_is_perfect(event: Dict[str, Any]) -> bool:
    details = event.get("details") if isinstance(event.get("details"), dict) else {}
    return _event_is_pair_match(event) and bool(details.get("is_perfect"))


def _event_response_time_seconds(event: Dict[str, Any]) -> int:
    response_time_ms = _safe_int(event.get("response_time_ms"), minimum=0)
    return response_time_ms // 1000


def reduce_microcards_review_events(events: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    ordered_events = sorted(
        [item for item in events if isinstance(item, dict)],
        key=_event_sort_key,
    )
    day_counters: Dict[str, Dict[str, int]] = {}
    invalid_event_refs: List[str] = []
    totals = _empty_microcards_counters()

    for idx, event in enumerate(ordered_events):
        day_iso = _event_local_day_iso(event)
        if day_iso is None:
            event_ref = str(event.get("id") or "").strip() or f"index:{idx}"
            invalid_event_refs.append(event_ref)
            continue

        day = day_counters.setdefault(day_iso, _empty_microcards_counters())
        was_correct = bool(event.get("was_correct"))
        response_seconds = _event_response_time_seconds(event)

        day["microcards_reviews"] += 1
        day["microcards_seconds_spent"] += response_seconds
        if was_correct:
            day["microcards_correct"] += 1
        if _event_is_pair_match(event):
            day["microcards_pair_match_reviews"] += 1
            if _event_pair_match_is_perfect(event):
                day["microcards_pair_match_perfect"] += 1

    for day_payload in day_counters.values():
        for field in MICROCARDS_COUNTER_FIELDS:
            totals[field] += _safe_int(day_payload.get(field), minimum=0)

    return {
        "events_total": len(ordered_events),
        "events_processed": int(totals["microcards_reviews"]),
        "events_invalid": len(invalid_event_refs),
        "invalid_event_refs": invalid_event_refs[:20],
        "days_touched": len(day_counters),
        "totals": totals,
        "days": day_counters,
    }


def _normalize_activity_map(raw_activity: Any) -> Dict[str, Dict[str, Any]]:
    if not isinstance(raw_activity, dict):
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for raw_day_key, raw_day_payload in raw_activity.items():
        day_key = str(raw_day_key or "").strip()
        if not day_key:
            continue
        out[day_key] = _normalize_activity_entry(raw_day_payload)
    return out


def _with_rebuilt_microcards_fields(
    *,
    existing_activity: Dict[str, Any],
    reduced_days: Dict[str, Dict[str, int]],
) -> Tuple[Dict[str, Dict[str, Any]], List[str]]:
    normalized_existing = _normalize_activity_map(existing_activity)
    all_days = sorted(set(normalized_existing.keys()) | set(reduced_days.keys()))

    rebuilt: Dict[str, Dict[str, Any]] = {}
    changed_days: List[str] = []

    for day_iso in all_days:
        base_day = dict(normalized_existing.get(day_iso, _normalize_activity_entry({})))
        per_day_microcards = reduced_days.get(day_iso) or _empty_microcards_counters()

        for field in MICROCARDS_COUNTER_FIELDS:
            base_day[field] = _safe_int(per_day_microcards.get(field), minimum=0)

        normalized = _normalize_activity_entry(base_day)
        has_learning_activity = (
            _safe_int(normalized.get("activity_attempts_total"), minimum=0) > 0
            or _safe_int(normalized.get("completion_percent"), minimum=0) > 0
        )
        normalized["streak_active"] = bool(has_learning_activity)
        normalized = _normalize_activity_entry(normalized)
        rebuilt[day_iso] = normalized

        previous = normalized_existing.get(day_iso)
        if previous is None or previous != normalized:
            changed_days.append(day_iso)

    return rebuilt, changed_days


def _compute_activity_streak(activity: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    active_dates: List[date] = []

    for day_iso, payload in activity.items():
        try:
            day_obj = date.fromisoformat(day_iso)
        except Exception:
            continue
        normalized = _normalize_activity_entry(payload)
        has_learning_activity = (
            _safe_int(normalized.get("activity_attempts_total"), minimum=0) > 0
            or _safe_int(normalized.get("completion_percent"), minimum=0) > 0
        )
        if has_learning_activity:
            active_dates.append(day_obj)

    if not active_dates:
        return {"streak_days": 0, "last_activity_date": None}

    active_dates = sorted(set(active_dates))
    streak_days = 1
    prev_date = active_dates[0]

    for current in active_dates[1:]:
        gap_days = (current - prev_date).days
        if gap_days == 1:
            streak_days += 1
        elif gap_days > 1:
            streak_days = 1
        prev_date = current

    return {
        "streak_days": streak_days,
        "last_activity_date": active_dates[-1].isoformat(),
    }


def _compact_day_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalize_activity_entry(payload)
    compact: Dict[str, Any] = {}
    for key in DEFAULT_REPORT_FIELDS:
        compact[key] = normalized.get(key)
    return compact


def _verify_activity(
    *,
    existing_activity: Dict[str, Any],
    expected_activity: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    actual_normalized = _normalize_activity_map(existing_activity)
    expected_normalized = _normalize_activity_map(expected_activity)

    mismatches: List[Dict[str, Any]] = []
    all_days = sorted(set(actual_normalized.keys()) | set(expected_normalized.keys()))
    for day_iso in all_days:
        actual_day = actual_normalized.get(day_iso, _normalize_activity_entry({}))
        expected_day = expected_normalized.get(day_iso, _normalize_activity_entry({}))
        if actual_day != expected_day:
            mismatches.append(
                {
                    "date": day_iso,
                    "actual": _compact_day_payload(actual_day),
                    "expected": _compact_day_payload(expected_day),
                }
            )
    return mismatches


def _settings_path(data_root: Path, user_id: str) -> Path:
    return data_root / "user_calendar" / user_id / "settings.json"


def _activity_path(data_root: Path, user_id: str) -> Path:
    return data_root / "user_calendar" / user_id / "activity.json"


def _review_events_path(data_root: Path, user_id: str) -> Path:
    return data_root / "users" / user_id / "microcards" / "review_events.json"


def _backfill_status_path(data_root: Path, user_id: str) -> Path:
    return data_root / "users" / user_id / "microcards" / "backfill_status.json"


def _load_settings(data_root: Path, user_id: str) -> UserCalendarSettings:
    payload = _read_json_file(_settings_path(data_root, user_id), {})
    if isinstance(payload, dict) and payload:
        try:
            return UserCalendarSettings.from_dict(payload)
        except Exception:
            logger.exception("microcards backfill: failed to parse settings for user %s", user_id)
    return UserCalendarSettings(user_id=user_id)


def _save_settings(path: Path, settings: UserCalendarSettings) -> None:
    settings.updated_at = datetime.now()
    _write_json_file(path, settings.to_dict())


def _load_review_events(data_root: Path, user_id: str) -> List[Dict[str, Any]]:
    payload = _read_json_file(_review_events_path(data_root, user_id), {})
    items = payload.get("items") if isinstance(payload, dict) else []
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict)]


def run_backfill_for_user(*, data_root: Path, user_id: str, mode: str) -> Dict[str, Any]:
    if mode not in BACKFILL_MODES:
        raise ValueError(f"Unsupported mode: {mode}")

    resolved_user_id = str(user_id or "").strip()
    if not resolved_user_id:
        raise ValueError("user_id is required")

    events = _load_review_events(data_root, resolved_user_id)
    reducer_report = reduce_microcards_review_events(events)

    activity_path = _activity_path(data_root, resolved_user_id)
    settings_path = _settings_path(data_root, resolved_user_id)

    existing_activity = _read_json_file(activity_path, {})
    rebuilt_activity, changed_days = _with_rebuilt_microcards_fields(
        existing_activity=existing_activity,
        reduced_days=reducer_report["days"],
    )

    expected_streak = _compute_activity_streak(rebuilt_activity)
    actual_settings = _load_settings(data_root, resolved_user_id)
    actual_last_activity = (
        actual_settings.last_activity_date.isoformat()
        if actual_settings.last_activity_date is not None
        else None
    )

    expected_last_activity = expected_streak["last_activity_date"]
    settings_mismatch = (
        _safe_int(actual_settings.streak_days, minimum=0) != _safe_int(expected_streak["streak_days"], minimum=0)
        or actual_last_activity != expected_last_activity
    )

    activity_mismatches = _verify_activity(
        existing_activity=existing_activity,
        expected_activity=rebuilt_activity,
    )

    writes = {"activity": False, "settings": False, "status": False}
    if mode == "apply":
        if changed_days:
            _write_json_file(activity_path, rebuilt_activity)
            writes["activity"] = True

        if settings_mismatch:
            actual_settings.streak_days = _safe_int(expected_streak["streak_days"], minimum=0)
            actual_settings.last_activity_date = (
                date.fromisoformat(expected_last_activity) if expected_last_activity else None
            )
            _save_settings(settings_path, actual_settings)
            writes["settings"] = True

    # Always verify after optional apply (on persisted state).
    post_activity = _read_json_file(activity_path, {})
    post_activity_mismatches = _verify_activity(
        existing_activity=post_activity,
        expected_activity=rebuilt_activity,
    )
    post_settings = _load_settings(data_root, resolved_user_id)
    post_last_activity = (
        post_settings.last_activity_date.isoformat()
        if post_settings.last_activity_date is not None
        else None
    )
    post_settings_mismatch = (
        _safe_int(post_settings.streak_days, minimum=0) != _safe_int(expected_streak["streak_days"], minimum=0)
        or post_last_activity != expected_last_activity
    )

    verify_passed = (len(post_activity_mismatches) == 0) and (not post_settings_mismatch)

    report: Dict[str, Any] = {
        "schema_version": BACKFILL_SCHEMA_VERSION,
        "mode": mode,
        "user_id": resolved_user_id,
        "events_total": reducer_report["events_total"],
        "events_processed": reducer_report["events_processed"],
        "events_invalid": reducer_report["events_invalid"],
        "invalid_event_refs": reducer_report["invalid_event_refs"],
        "days_touched": reducer_report["days_touched"],
        "totals": reducer_report["totals"],
        "days_changed": len(changed_days),
        "changed_dates_sample": changed_days[:20],
        "expected_streak": expected_streak,
        "actual_streak_before_apply": {
            "streak_days": _safe_int(actual_settings.streak_days, minimum=0),
            "last_activity_date": actual_last_activity,
        },
        "initial_activity_mismatch_count": len(activity_mismatches),
        "initial_activity_mismatches_sample": activity_mismatches[:20],
        "initial_settings_mismatch": bool(settings_mismatch),
        "writes": writes,
        "verify_passed": bool(verify_passed),
        "verify_activity_mismatch_count": len(post_activity_mismatches),
        "verify_activity_mismatches_sample": post_activity_mismatches[:20],
        "verify_settings_mismatch": bool(post_settings_mismatch),
    }

    if mode == "apply":
        run_id = f"mcbf_{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}_{uuid4().hex[:8]}"
        status_payload = {
            "schema_version": BACKFILL_STATUS_SCHEMA_VERSION,
            "run_id": run_id,
            "user_id": resolved_user_id,
            "mode": mode,
            "ran_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "verify_passed": bool(verify_passed),
            "report": report,
        }
        _write_json_file(_backfill_status_path(data_root, resolved_user_id), status_payload)
        report["writes"]["status"] = True

    return report


def discover_user_ids(data_root: Path) -> List[str]:
    user_ids = set()

    users_root = data_root / "users"
    if users_root.exists():
        for path in users_root.iterdir():
            if path.is_dir():
                user_ids.add(path.name)

    calendar_root = data_root / "user_calendar"
    if calendar_root.exists():
        for path in calendar_root.iterdir():
            if path.is_dir():
                user_ids.add(path.name)

    return sorted(user_ids)


def run_backfill(*, data_root: Path, mode: str, user_ids: Sequence[str]) -> Dict[str, Any]:
    if mode not in BACKFILL_MODES:
        raise ValueError(f"Unsupported mode: {mode}")

    reports: List[Dict[str, Any]] = []
    failed_users: List[str] = []

    for user_id in user_ids:
        try:
            report = run_backfill_for_user(data_root=data_root, user_id=user_id, mode=mode)
            reports.append(report)
            if mode in {"apply", "verify"} and not bool(report.get("verify_passed")):
                failed_users.append(user_id)
        except Exception as exc:
            logger.exception("microcards backfill failed for user_id=%s", user_id)
            failed_users.append(user_id)
            reports.append(
                {
                    "schema_version": BACKFILL_SCHEMA_VERSION,
                    "mode": mode,
                    "user_id": user_id,
                    "error": str(exc),
                    "verify_passed": False,
                }
            )

    return {
        "schema_version": BACKFILL_SCHEMA_VERSION,
        "mode": mode,
        "data_root": str(data_root),
        "users_total": len(user_ids),
        "users_failed": len(failed_users),
        "failed_users": failed_users,
        "ok": len(failed_users) == 0,
        "reports": reports,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Microcards backfill M4: rebuild calendar activity from review_events.json",
    )
    parser.add_argument(
        "--data-root",
        default="data",
        help="Path to data root (default: data).",
    )
    parser.add_argument(
        "--mode",
        choices=sorted(BACKFILL_MODES),
        default="dry-run",
        help="Execution mode: dry-run | apply | verify.",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)
    user_parser = subparsers.add_parser("rebuild-user", help="Rebuild one user.")
    user_parser.add_argument("user_id", help="Target user id.")
    subparsers.add_parser("rebuild-all-users", help="Rebuild all discovered users.")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    data_root = Path(str(args.data_root)).resolve()
    mode = str(args.mode)
    if not data_root.exists():
        parser.error(f"data root does not exist: {data_root}")

    if args.command == "rebuild-user":
        user_ids = [str(args.user_id)]
    else:
        user_ids = discover_user_ids(data_root)

    result = run_backfill(data_root=data_root, mode=mode, user_ids=user_ids)

    _emit_backfill_telemetry(
        data_root,
        "microcards_backfill_run",
        mode=mode,
        users_total=result.get("users_total", 0),
        users_failed=result.get("users_failed", 0),
        ok=result.get("ok", False),
    )
    if not result.get("ok"):
        for report in result.get("reports", []):
            if not report.get("verify_passed"):
                _emit_backfill_telemetry(
                    data_root,
                    "microcards_backfill_verify_failed",
                    user_id=report.get("user_id", "unknown"),
                    mode=mode,
                    error=str(report.get("error", ""))[:200],
                    verify_activity_mismatch_count=report.get("verify_activity_mismatch_count", 0),
                    verify_settings_mismatch=report.get("verify_settings_mismatch", False),
                )

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if bool(result.get("ok")) else 1


if __name__ == "__main__":
    raise SystemExit(main())
