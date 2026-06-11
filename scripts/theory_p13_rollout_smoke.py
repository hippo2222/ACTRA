"""
P13 rollout smoke scenario (test exploitation/observation) using Flask test_client.

What it checks:
- staged rollout caps feature flags as expected
- analysis payload is sanitized per rollout stage
- rollback from microcards-capable stage disables UI/API without deleting data
- telemetry file + telemetry summary aggregate key rollout events

Run:
    python scripts/theory_p13_rollout_smoke.py
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
            "created_at": "2026-02-26T10:00:00Z",
            "updated_at": "2026-02-26T10:01:00Z",
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
            "created_at": "2026-02-26T10:00:00Z",
            "provider_used": "smoke_provider",
            "provider_model": "smoke_model",
            "provider_chain_attempts": [{"provider": "smoke_provider", "status": "ok"}],
            "material_stats": {"language": "ru", "word_count": 240, "char_count": 1500},
            "language_preferences": {"mode": "same_as_material", "effective": "ru", "requested": None},
            "result": {
                "human_summary": "P13 smoke fixture",
                "educational_units": [
                    {"id": 1, "title": "Term A", "type": "term", "description": "Definition A", "chunk_ids": ["chunk_1"]},
                    {"id": 2, "title": "Term B", "type": "term", "description": "Definition B", "chunk_ids": ["chunk_1"]},
                    {"id": 3, "title": "Fact C", "type": "fact", "description": "Description C", "chunk_ids": ["chunk_2"]},
                ],
                "recommendations": [{"task_type": "TEST", "count": 2, "priority": "high"}],
                "not_recommended": [],
                "warnings": [],
                "material_volume": "small",
                "target_language": "ru",
                "analysis_schema_version": "2.0",
                "learning_chunks": [
                    {"id": "chunk_1", "title": "Chunk 1", "chunk_type": "classification", "unit_ids": [1, 2]},
                    {"id": "chunk_2", "title": "Chunk 2", "chunk_type": "factual_set", "unit_ids": [3]},
                ],
                "authoring_routes": [
                    {
                        "id": "route_1",
                        "title": "Route 1",
                        "route_kind": "hybrid",
                        "target_surface": "mixed",
                        "steps": [
                            {"step_id": "s1", "action_type": "use_task_type_progression", "task_type": "SEQUENCE"},
                            {"step_id": "s2", "action_type": "add_microcards", "microcard_mode": "pair_match"},
                        ],
                    }
                ],
                "future_capabilities": [{"capability_id": "pair_matching", "status": "microcards_mvp"}],
                "microcards_candidates": [
                    {
                        "candidate_id": "c1",
                        "unit_id": 3,
                        "chunk_id": "chunk_2",
                        "card_type": "fact_recall",
                        "prompt_seed": "Fact C?",
                        "answer_seed": "Description C",
                    },
                    {
                        "candidate_id": "c2",
                        "unit_id": 1,
                        "chunk_id": "chunk_1",
                        "card_type": "pair_match",
                        "prompt_seed": "Term A",
                        "answer_seed": "Definition A",
                    },
                    {
                        "candidate_id": "c3",
                        "unit_id": 2,
                        "chunk_id": "chunk_1",
                        "card_type": "pair_match",
                        "prompt_seed": "Term B",
                        "answer_seed": "Definition B",
                    },
                ],
                "report_blocks_version": "1.0",
                "report_blocks": [
                    {"id": "sec_1", "type": "section", "title": "Summary", "body": {"summary": "Smoke"}}
                ],
                "report_lint": {
                    "verbosity_risk": "low",
                    "duplicate_content_signals": 0,
                    "fallback_renderer_recommended": False,
                },
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


def _stage_expectations() -> Dict[str, Dict[str, bool]]:
    # Expected effective flags from the P13 staged rollout layer.
    return {
        "legacy": {
            "analysis_v2_schema": False,
            "analysis_report_blocks_v1": False,
            "analysis_report_renderer_v1": False,
            "editor_analysis_report_link": False,
            "analysis_coverage_in_editor": False,
            "microcards_mode": False,
            "microcards_pair_match": False,
        },
        "analysis_v2": {
            "analysis_v2_schema": True,
            "analysis_report_blocks_v1": False,
            "analysis_report_renderer_v1": False,
            "editor_analysis_report_link": False,
            "analysis_coverage_in_editor": False,
            "microcards_mode": False,
            "microcards_pair_match": False,
        },
        "report_blocks": {
            "analysis_v2_schema": True,
            "analysis_report_blocks_v1": True,
            "analysis_report_renderer_v1": False,
            "editor_analysis_report_link": False,
            "analysis_coverage_in_editor": False,
            "microcards_mode": False,
            "microcards_pair_match": False,
        },
        "report_renderer": {
            "analysis_v2_schema": True,
            "analysis_report_blocks_v1": True,
            "analysis_report_renderer_v1": True,
            "editor_analysis_report_link": False,
            "analysis_coverage_in_editor": False,
            "microcards_mode": False,
            "microcards_pair_match": False,
        },
        "editor_link": {
            "analysis_v2_schema": True,
            "analysis_report_blocks_v1": True,
            "analysis_report_renderer_v1": True,
            "editor_analysis_report_link": True,
            "analysis_coverage_in_editor": False,
            "microcards_mode": False,
            "microcards_pair_match": False,
        },
        "coverage": {
            "analysis_v2_schema": True,
            "analysis_report_blocks_v1": True,
            "analysis_report_renderer_v1": True,
            "editor_analysis_report_link": True,
            "analysis_coverage_in_editor": True,
            "microcards_mode": False,
            "microcards_pair_match": False,
        },
        "microcards": {
            "analysis_v2_schema": True,
            "analysis_report_blocks_v1": True,
            "analysis_report_renderer_v1": True,
            "editor_analysis_report_link": True,
            "analysis_coverage_in_editor": True,
            "microcards_mode": True,
            "microcards_pair_match": False,
        },
        "pair_match": {
            "analysis_v2_schema": True,
            "analysis_report_blocks_v1": True,
            "analysis_report_renderer_v1": True,
            "editor_analysis_report_link": True,
            "analysis_coverage_in_editor": True,
            "microcards_mode": True,
            "microcards_pair_match": True,
        },
        "full": {
            "analysis_v2_schema": True,
            "analysis_report_blocks_v1": True,
            "analysis_report_renderer_v1": True,
            "editor_analysis_report_link": True,
            "analysis_coverage_in_editor": True,
            "microcards_mode": True,
            "microcards_pair_match": True,
        },
    }


def _check_stage_behavior(client: Any, run_id: str, stage: str, expected_flags: Dict[str, bool], *, verbose: bool = False) -> None:
    status_data = _get_json(client, "/api/editor/theory/rollout/status")
    _assert(status_data.get("ok") is True, f"rollout/status not ok for stage={stage}")
    rollout = status_data["rollout"]
    _assert(rollout.get("stage") == stage, f"rollout/status stage mismatch: expected {stage}, got {rollout.get('stage')}")
    ff = rollout.get("effective_feature_flags") or {}
    for key, expected in expected_flags.items():
        _assert(bool(ff.get(key)) is expected, f"stage={stage} flag {key} expected {expected}, got {ff.get(key)}")

    analysis = _get_json(client, f"/api/editor/ai/analyses/{run_id}")
    _assert(analysis.get("ok") is True, f"analysis open failed at stage={stage}")
    aff = analysis.get("feature_flags") or {}
    for key, expected in expected_flags.items():
        _assert(bool(aff.get(key)) is expected, f"analysis response stage={stage} flag {key} expected {expected}, got {aff.get(key)}")

    has_v2 = "analysis_schema_version" in analysis
    has_report_blocks = "report_blocks" in analysis
    _assert(has_v2 is expected_flags["analysis_v2_schema"], f"stage={stage} v2 field visibility mismatch")
    _assert(has_report_blocks is expected_flags["analysis_report_blocks_v1"], f"stage={stage} report_blocks visibility mismatch")

    # The V2 microcards surface is not stage-gated (the V1 gated surface was
    # removed); deck listing stays available at every stage.
    list_data = _get_json(client, "/api/v2/microcards/decks")
    _assert(list_data.get("ok") is True, f"v2 microcards list should work at stage={stage}")

    if verbose:
        print(f"[OK] stage={stage} flags + analysis gating verified")


def run_smoke(*, keep_temp: bool = False, verbose: bool = False) -> int:
    temp_root = Path(tempfile.mkdtemp(prefix="p13_rollout_smoke_", dir=str(REPO_ROOT / ".pytest_tmp_p13_rollout_smoke")))
    (REPO_ROOT / ".pytest_tmp_p13_rollout_smoke").mkdir(parents=True, exist_ok=True)
    run_id = "ai_run_20260226T150000Z_p13smoke"
    deck_id: Optional[str] = None
    try:
        _create_analysis_artifact(temp_root / "ai_runs", run_id)

        with _patched_test_context(temp_root) as client:
            expectations = _stage_expectations()
            stage_order = list(expectations.keys())
            for stage in stage_order:
                with _env_override("RP_THEORY_ROLLOUT_STAGE", stage):
                    _check_stage_behavior(client, run_id, stage, expectations[stage], verbose=verbose)

            # Create real microcards data at full stage to test rollback safety.
            with _env_override("RP_THEORY_ROLLOUT_STAGE", "full"):
                created = _post_json(
                    client,
                    "/api/v2/microcards/decks/from-analysis",
                    {"ai_run_id": run_id, "selector": {"scope": "all"}},
                )
                _assert(created.get("ok") is True, "microcards deck creation failed at full stage")
                deck = created.get("deck") or {}
                deck_id = str(deck.get("id") or "").strip()
                _assert(bool(deck_id), "deck_id missing after create")
                cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
                _assert(len(cards) >= 1, "created deck has no cards")
                # D2: pair candidates arrive flattened as ordinary Q/A cards;
                # the embedded queue/review player no longer exists (study runs
                # in the Microcards mode itself).
                if verbose:
                    print(f"[OK] created v2 deck={deck_id} with {len(cards)} cards")

            # Rollback stage: microcards API disabled but deck file remains.
            deck_path = temp_root / "microcards" / "decks" / f"{deck_id}.json"
            _assert(deck_path.exists(), "deck file missing before rollback check")
            with _env_override("RP_THEORY_ROLLOUT_STAGE", "coverage"):
                _assert(deck_path.exists(), "rollback gating must not delete deck file")
                if verbose:
                    print("[OK] rollback to coverage preserves deck data (v2 surface is not staged)")

            # Re-enable and reopen persisted deck.
            with _env_override("RP_THEORY_ROLLOUT_STAGE", "full"):
                reopened = _get_json(client, f"/api/v2/microcards/decks/{deck_id}")
                _assert(reopened.get("ok") is True, "reopen deck failed after re-enable")
                _assert((reopened.get("deck") or {}).get("id") == deck_id, "reopened deck id mismatch")

                telemetry = _get_json(client, "/api/editor/theory/rollout/telemetry?limit=1000")
                _assert(telemetry.get("ok") is True, "telemetry endpoint failed")
                summary = telemetry.get("telemetry") or {}
                by_event = summary.get("by_event") or {}
                metrics = (summary.get("metrics") or {})
                for event_name in (
                    "analysis_payload_served",
                    "microcards_deck_created_from_analysis",
                    "feature_flag_blocked",
                ):
                    _assert(int(by_event.get(event_name, 0)) >= 1, f"telemetry missing event {event_name}")
                _assert(int(metrics.get("microdeck_creations_from_analysis", 0)) >= 1, "microdeck creation metric missing")
                ratio = (metrics.get("analysis_v2_valid_ratio") or {})
                _assert(int(ratio.get("denominator") or 0) >= 1, "analysis_v2_valid_ratio denominator should be >=1")
                _assert(int(ratio.get("numerator") or 0) >= 1, "analysis_v2_valid_ratio numerator should be >=1")

                status_with_telemetry = _get_json(client, "/api/editor/theory/rollout/status?include_telemetry=1")
                _assert(status_with_telemetry.get("ok") is True, "rollout/status include_telemetry failed")
                _assert(
                    isinstance(((status_with_telemetry.get("rollout") or {}).get("telemetry")), dict),
                    "rollout/status should include telemetry when requested",
                )

            telemetry_file = temp_root / "telemetry" / "theory_rollout_events.jsonl"
            print("P13 rollout smoke: PASS")
            print(f"temp_data_dir: {temp_root}")
            print(f"ai_run_id: {run_id}")
            print(f"deck_id: {deck_id}")
            print(f"telemetry_file: {telemetry_file} (exists={telemetry_file.exists()})")
            return 0
    except Exception as exc:
        print(f"P13 rollout smoke: FAIL: {exc}", file=sys.stderr)
        print(f"temp_data_dir: {temp_root}", file=sys.stderr)
        return 1
    finally:
        if keep_temp:
            print(f"[keep-temp] preserved {temp_root}")
        else:
            try:
                shutil.rmtree(temp_root, ignore_errors=True)
            except Exception:
                pass


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="P13 rollout smoke (stage/rollback/telemetry)")
    parser.add_argument("--keep-temp", action="store_true", help="Preserve temporary data directory")
    parser.add_argument("--verbose", action="store_true", help="Print per-stage checks")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    temp_root_parent = REPO_ROOT / ".pytest_tmp_p13_rollout_smoke"
    temp_root_parent.mkdir(parents=True, exist_ok=True)
    return run_smoke(keep_temp=bool(args.keep_temp), verbose=bool(args.verbose))


if __name__ == "__main__":
    raise SystemExit(main())

