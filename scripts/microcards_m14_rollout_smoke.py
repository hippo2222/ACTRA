"""
M14 microcards productization rollout smoke scenario using Flask test_client.

What it checks:
- staged rollout caps microcards prod feature flags as expected
- manual editor endpoints blocked at stages without microcards_manual_editor
- text import endpoints blocked at stages without microcards_text_import
- rollout status endpoint returns correct stage/flags
- runtime telemetry endpoint accepts valid events and rejects invalid
- telemetry summary aggregates key events correctly
- rollback does not delete data, re-enable restores access

Run:
    python scripts/microcards_m14_rollout_smoke.py
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, Iterator, Optional


REPO_ROOT = Path(__file__).resolve().parent.parent
DESKTOP_APP_DIR = REPO_ROOT / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from server import app, _headless_app_ctx  # type: ignore


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _create_analysis_artifact(root: Path, run_id: str) -> None:
    run_dir = root / run_id
    _write_json(
        run_dir / "run.json",
        {
            "run_id": run_id,
            "phase": "analyzed",
            "created_at": "2026-02-27T10:00:00Z",
            "updated_at": "2026-02-27T10:01:00Z",
            "provider_used": "smoke_provider",
            "provider_model": "smoke_model",
            "material_language": "ru",
            "effective_output_language": "ru",
        },
    )
    _write_json(
        run_dir / "analysis.json",
        {
            "run_id": run_id,
            "created_at": "2026-02-27T10:00:00Z",
            "provider_used": "smoke_provider",
            "provider_model": "smoke_model",
            "provider_chain_attempts": [{"provider": "smoke_provider", "status": "ok"}],
            "material_stats": {"language": "ru", "word_count": 120, "char_count": 800},
            "language_preferences": {"mode": "same_as_material", "effective": "ru", "requested": None},
            "result": {
                "human_summary": "M14 smoke fixture",
                "educational_units": [
                    {"id": 1, "title": "Term A", "type": "term", "description": "Definition A", "chunk_ids": ["c1"]},
                    {"id": 2, "title": "Fact B", "type": "fact", "description": "Description B", "chunk_ids": ["c1"]},
                ],
                "recommendations": [{"task_type": "TEST", "count": 1, "priority": "high"}],
                "not_recommended": [],
                "warnings": [],
                "material_volume": "small",
                "target_language": "ru",
                "analysis_schema_version": "2.0",
                "learning_chunks": [{"id": "c1", "title": "Chunk 1", "chunk_type": "factual_set", "unit_ids": [1, 2]}],
                "authoring_routes": [],
                "future_capabilities": [],
                "microcards_candidates": [
                    {
                        "candidate_id": "mc1",
                        "unit_id": 1,
                        "chunk_id": "c1",
                        "card_type": "fact_recall",
                        "prompt_seed": "Term A?",
                        "answer_seed": "Definition A",
                    },
                ],
                "report_blocks_version": "1.0",
                "report_blocks": [{"id": "s1", "type": "section", "title": "Summary", "body": {"summary": "Smoke"}}],
                "report_lint": {"verbosity_risk": "low", "duplicate_content_signals": 0, "fallback_renderer_recommended": False},
                "illustrations_detected": False,
                "illustrations_note": None,
            },
        },
    )


@contextlib.contextmanager
def _patched_test_context(temp_data_dir: Path) -> Iterator[Any]:
    original_data_dir = _headless_app_ctx.data_dir
    original_user_id = _headless_app_ctx.user_id
    app.config["TESTING"] = True
    _headless_app_ctx.data_dir = temp_data_dir
    _headless_app_ctx.user_id = "smoke_user"
    with app.test_client() as client:
        try:
            yield client
        finally:
            _headless_app_ctx.data_dir = original_data_dir
            _headless_app_ctx.user_id = original_user_id


@contextlib.contextmanager
def _env_override(name: str, value: Optional[str]) -> Iterator[None]:
    old = os.environ.get(name)
    try:
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
        yield
    finally:
        if old is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = old


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _get_json(client: Any, path: str, *, expected_status: int = 200) -> Dict[str, Any]:
    resp = client.get(path)
    data = resp.get_json(silent=True)
    if resp.status_code != expected_status:
        raise AssertionError(f"GET {path} expected {expected_status}, got {resp.status_code}, body={data}")
    _assert(isinstance(data, dict), f"GET {path} returned non-dict body")
    return data


def _post_json(client: Any, path: str, payload: Dict[str, Any], *, expected_status: int = 200) -> Dict[str, Any]:
    resp = client.post(path, json=payload)
    data = resp.get_json(silent=True)
    if resp.status_code != expected_status:
        raise AssertionError(f"POST {path} expected {expected_status}, got {resp.status_code}, body={data}")
    _assert(isinstance(data, dict), f"POST {path} returned non-dict body")
    return data


# Expected flag caps per stage
_STAGE_EXPECTATIONS: Dict[str, Dict[str, bool]] = {
    "disabled": {
        "microcards_runtime_ui": False,
        "microcards_home_entry": False,
        "microcards_calendar_integration": False,
        "microcards_statistics_integration": False,
        "microcards_manual_editor": False,
        "microcards_text_import": False,
        "microcards_review_fx": False,
        "microcards_pair_match_runtime": False,
    },
    "runtime_hidden": {
        "microcards_runtime_ui": False,
        "microcards_home_entry": False,
        "microcards_calendar_integration": False,
        "microcards_statistics_integration": False,
        "microcards_manual_editor": False,
        "microcards_text_import": False,
        "microcards_review_fx": False,
        "microcards_pair_match_runtime": False,
    },
    "calendar_stats_only": {
        "microcards_runtime_ui": False,
        "microcards_home_entry": False,
        "microcards_calendar_integration": True,
        "microcards_statistics_integration": True,
        "microcards_manual_editor": False,
        "microcards_text_import": False,
        "microcards_review_fx": False,
        "microcards_pair_match_runtime": False,
    },
    "runtime_ui": {
        "microcards_runtime_ui": True,
        "microcards_home_entry": False,
        "microcards_calendar_integration": True,
        "microcards_statistics_integration": True,
        "microcards_manual_editor": False,
        "microcards_text_import": False,
        "microcards_review_fx": True,
        "microcards_pair_match_runtime": True,
    },
    "home_entry": {
        "microcards_runtime_ui": True,
        "microcards_home_entry": True,
        "microcards_calendar_integration": True,
        "microcards_statistics_integration": True,
        "microcards_manual_editor": False,
        "microcards_text_import": False,
        "microcards_review_fx": True,
        "microcards_pair_match_runtime": True,
    },
    "manual_editor": {
        "microcards_runtime_ui": True,
        "microcards_home_entry": True,
        "microcards_calendar_integration": True,
        "microcards_statistics_integration": True,
        "microcards_manual_editor": True,
        "microcards_text_import": False,
        "microcards_review_fx": True,
        "microcards_pair_match_runtime": True,
    },
    "text_import": {
        "microcards_runtime_ui": True,
        "microcards_home_entry": True,
        "microcards_calendar_integration": True,
        "microcards_statistics_integration": True,
        "microcards_manual_editor": True,
        "microcards_text_import": True,
        "microcards_review_fx": True,
        "microcards_pair_match_runtime": True,
    },
    "full": {
        "microcards_runtime_ui": True,
        "microcards_home_entry": True,
        "microcards_calendar_integration": True,
        "microcards_statistics_integration": True,
        "microcards_manual_editor": True,
        "microcards_text_import": True,
        "microcards_review_fx": True,
        "microcards_pair_match_runtime": True,
    },
}


def _check_stage_flags(client: Any, stage: str, expected: Dict[str, bool], *, verbose: bool = False) -> None:
    data = _get_json(client, "/api/microcards/rollout/status")
    _assert(data.get("ok") is True, f"rollout/status not ok at stage={stage}")
    rollout = data["rollout"]
    _assert(rollout.get("stage") == stage, f"stage mismatch: expected {stage}, got {rollout.get('stage')}")
    ff = rollout.get("effective_feature_flags") or {}
    for key, exp in expected.items():
        _assert(bool(ff.get(key)) is exp, f"stage={stage} flag {key} expected {exp}, got {ff.get(key)}")
    if verbose:
        print(f"  [OK] stage={stage} flags verified")


def _check_manual_editor_gating(client: Any, stage: str, expected_flags: Dict[str, bool], *, verbose: bool = False) -> None:
    allowed = expected_flags.get("microcards_manual_editor", False)
    if allowed:
        result = _post_json(client, "/api/editor/microcards/decks/create-manual", {"name": f"smoke_deck_{stage}"})
        _assert(result.get("ok") is True, f"manual create should succeed at stage={stage}")
        if verbose:
            print(f"  [OK] stage={stage} manual editor allowed")
    else:
        result = _post_json(client, "/api/editor/microcards/decks/create-manual", {"name": f"smoke_{stage}"}, expected_status=404)
        _assert(result.get("error") == "microcards_manual_editor_disabled", f"manual create should be blocked at stage={stage}")
        if verbose:
            print(f"  [OK] stage={stage} manual editor blocked")


def _check_text_import_gating(client: Any, stage: str, expected_flags: Dict[str, bool], *, verbose: bool = False) -> None:
    allowed = expected_flags.get("microcards_text_import", False)
    test_text = "@MICROCARD\n# Test Q\n= Test A\n"
    if allowed:
        result = _post_json(client, "/api/editor/microcards/import/parse-text", {"text": test_text})
        _assert(result.get("ok") is True, f"text import parse should succeed at stage={stage}")
        if verbose:
            print(f"  [OK] stage={stage} text import allowed")
    else:
        result = _post_json(client, "/api/editor/microcards/import/parse-text", {"text": test_text}, expected_status=404)
        _assert(result.get("error") == "microcards_text_import_disabled", f"text import should be blocked at stage={stage}")
        if verbose:
            print(f"  [OK] stage={stage} text import blocked")


def _check_runtime_telemetry(client: Any, *, verbose: bool = False) -> None:
    # Valid events
    for event_name in ("microcards_runtime_opened", "microcards_runtime_session_started", "microcards_runtime_session_completed"):
        result = _post_json(client, "/api/microcards/runtime/telemetry", {"event": event_name, "fields": {"test": True}})
        _assert(result.get("ok") is True, f"runtime telemetry should accept {event_name}")

    # Invalid event
    result = _post_json(client, "/api/microcards/runtime/telemetry", {"event": "invalid_event"}, expected_status=400)
    _assert(result.get("error") == "invalid_event", "invalid event should be rejected")

    if verbose:
        print("  [OK] runtime telemetry endpoint validated")


def run_smoke(*, keep_temp: bool = False, verbose: bool = False) -> int:
    smoke_dir = REPO_ROOT / ".pytest_tmp_m14_rollout_smoke"
    smoke_dir.mkdir(parents=True, exist_ok=True)
    temp_root = Path(tempfile.mkdtemp(prefix="m14_smoke_", dir=str(smoke_dir)))
    run_id = "ai_run_20260227T150000Z_m14smoke"
    deck_id: Optional[str] = None

    try:
        _create_analysis_artifact(temp_root / "ai_runs", run_id)

        with _patched_test_context(temp_root) as client:
            # Ensure theory rollout is at full so microcards_mode is enabled
            with _env_override("RP_THEORY_ROLLOUT_STAGE", "full"):
                # ── Phase 1: Verify flag caps for every stage ──
                print("[Phase 1] Checking flag caps per stage...")
                for stage, expected in _STAGE_EXPECTATIONS.items():
                    with _env_override("RP_MICROCARDS_ROLLOUT_STAGE", stage):
                        _check_stage_flags(client, stage, expected, verbose=verbose)

                # ── Phase 2: Verify manual editor gating ──
                print("[Phase 2] Checking manual editor gating...")
                for stage, expected in _STAGE_EXPECTATIONS.items():
                    with _env_override("RP_MICROCARDS_ROLLOUT_STAGE", stage):
                        _check_manual_editor_gating(client, stage, expected, verbose=verbose)

                # ── Phase 3: Verify text import gating ──
                print("[Phase 3] Checking text import gating...")
                for stage, expected in _STAGE_EXPECTATIONS.items():
                    with _env_override("RP_MICROCARDS_ROLLOUT_STAGE", stage):
                        _check_text_import_gating(client, stage, expected, verbose=verbose)

                # ── Phase 4: Runtime telemetry endpoint ──
                print("[Phase 4] Checking runtime telemetry...")
                with _env_override("RP_MICROCARDS_ROLLOUT_STAGE", "full"):
                    _check_runtime_telemetry(client, verbose=verbose)

                # ── Phase 5: Create data at full, then rollback ──
                print("[Phase 5] Rollback safety test...")
                with _env_override("RP_MICROCARDS_ROLLOUT_STAGE", "full"):
                    created = _post_json(
                        client,
                        "/api/editor/microcards/decks/from-analysis",
                        {"ai_run_id": run_id, "selector": {"scope": "all"}},
                    )
                    _assert(created.get("ok") is True, "deck creation failed at full stage")
                    deck = created.get("deck") or {}
                    deck_id = str(deck.get("id") or "").strip()
                    _assert(bool(deck_id), "deck_id missing after create")

                    manual_deck = _post_json(
                        client,
                        "/api/editor/microcards/decks/create-manual",
                        {"name": "Manual Smoke Deck"},
                    )
                    _assert(manual_deck.get("ok") is True, "manual deck creation failed at full")
                    manual_deck_id = str((manual_deck.get("deck") or {}).get("id") or "")
                    _assert(bool(manual_deck_id), "manual deck_id missing")
                    if verbose:
                        print(f"  [OK] created decks: analysis={deck_id}, manual={manual_deck_id}")

                # Rollback to disabled: manual editor blocked, deck files remain
                deck_path = temp_root / "microcards" / "decks" / f"{deck_id}.json"
                manual_deck_path = temp_root / "microcards" / "decks" / f"{manual_deck_id}.json"
                _assert(deck_path.exists(), "analysis deck file should exist before rollback")
                _assert(manual_deck_path.exists(), "manual deck file should exist before rollback")

                with _env_override("RP_MICROCARDS_ROLLOUT_STAGE", "disabled"):
                    blocked = _post_json(
                        client,
                        "/api/editor/microcards/decks/create-manual",
                        {"name": "should_fail"},
                        expected_status=404,
                    )
                    _assert(blocked.get("error") == "microcards_manual_editor_disabled", "should be blocked at disabled")
                    _assert(deck_path.exists(), "rollback must not delete analysis deck")
                    _assert(manual_deck_path.exists(), "rollback must not delete manual deck")
                    if verbose:
                        print("  [OK] disabled stage blocks manual editor but preserves data")

                # Re-enable to full: data still accessible
                with _env_override("RP_MICROCARDS_ROLLOUT_STAGE", "full"):
                    reopened = _get_json(client, f"/api/editor/microcards/decks/{deck_id}")
                    _assert(reopened.get("ok") is True, "reopen analysis deck failed after re-enable")
                    _assert((reopened.get("deck") or {}).get("id") == deck_id, "reopened deck id mismatch")
                    if verbose:
                        print("  [OK] re-enabled full stage, data accessible")

                # ── Phase 6: Telemetry summary ──
                print("[Phase 6] Checking telemetry summary...")
                with _env_override("RP_MICROCARDS_ROLLOUT_STAGE", "full"):
                    tel_data = _get_json(client, "/api/microcards/rollout/telemetry?limit=1000")
                    _assert(tel_data.get("ok") is True, "telemetry endpoint failed")
                    tel_summary = tel_data.get("telemetry") or {}
                    by_event = tel_summary.get("by_event") or {}
                    metrics = tel_summary.get("metrics") or {}

                    for event_name in (
                        "microcards_runtime_opened",
                        "microcards_runtime_session_started",
                        "microcards_runtime_session_completed",
                        "microcards_manual_deck_created",
                        "microcards_text_import_parsed",
                        "microcards_prod_feature_blocked",
                    ):
                        _assert(int(by_event.get(event_name, 0)) >= 1, f"telemetry missing event {event_name}")

                    _assert(int(metrics.get("runtime_opens", 0)) >= 1, "runtime_opens metric missing")
                    _assert(int(metrics.get("runtime_sessions_started", 0)) >= 1, "sessions_started metric missing")
                    _assert(int(metrics.get("runtime_sessions_completed", 0)) >= 1, "sessions_completed metric missing")
                    _assert(int(metrics.get("manual_deck_creates", 0)) >= 1, "manual_deck_creates metric missing")
                    _assert(int(metrics.get("feature_blocks", 0)) >= 1, "feature_blocks metric missing")

                    # Check rollout status includes telemetry when requested
                    status_with_tel = _get_json(client, "/api/microcards/rollout/status?include_telemetry=1")
                    _assert(status_with_tel.get("ok") is True, "status with telemetry failed")
                    _assert(
                        isinstance(((status_with_tel.get("rollout") or {}).get("telemetry")), dict),
                        "rollout/status should include telemetry when requested",
                    )
                    if verbose:
                        print(f"  [OK] telemetry summary: {len(by_event)} event types, metrics validated")

        telemetry_file = temp_root / "telemetry" / "microcards_prod_rollout_events.jsonl"
        print("M14 rollout smoke: PASS")
        print(f"temp_data_dir: {temp_root}")
        print(f"ai_run_id: {run_id}")
        print(f"deck_id: {deck_id}")
        print(f"telemetry_file: {telemetry_file} (exists={telemetry_file.exists()})")
        return 0

    except Exception as exc:
        print(f"M14 rollout smoke: FAIL: {exc}", file=sys.stderr)
        print(f"temp_data_dir: {temp_root}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1
    finally:
        if keep_temp:
            print(f"[keep-temp] preserved {temp_root}")
        else:
            try:
                shutil.rmtree(temp_root, ignore_errors=True)
            except Exception:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description="M14 microcards productization rollout smoke test")
    parser.add_argument("--keep-temp", action="store_true", help="Preserve temp data directory")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()
    return run_smoke(keep_temp=args.keep_temp, verbose=args.verbose)


if __name__ == "__main__":
    raise SystemExit(main())
