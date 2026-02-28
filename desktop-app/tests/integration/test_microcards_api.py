import json
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import server as server_module  # type: ignore
from server import app, _headless_app_ctx  # type: ignore


def _write_json(path: Path, payload: dict) -> None:
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
            "provider_used": "mock_provider",
            "provider_model": "mock_model",
            "material_language": "ru",
            "effective_output_language": "ru",
        },
    )
    _write_json(
        run_dir / "analysis.json",
        {
            "run_id": run_id,
            "created_at": "2026-02-26T10:00:00Z",
            "provider_used": "mock_provider",
            "provider_model": "mock_model",
            "material_stats": {"language": "ru", "word_count": 200},
            "language_preferences": {"mode": "same_as_material", "effective": "ru"},
            "result": {
                "analysis_schema_version": "2.0",
                "target_language": "ru",
                "educational_units": [
                    {"id": 1, "title": "Термин A", "description": "Определение A", "chunk_ids": ["chunk_1"]},
                    {"id": 2, "title": "Термин B", "description": "Определение B", "chunk_ids": ["chunk_1"]},
                    {"id": 3, "title": "Факт C", "description": "Описание C", "chunk_ids": ["chunk_2"]},
                ],
                "learning_chunks": [
                    {"id": "chunk_1", "title": "Chunk 1", "unit_ids": [1, 2]},
                    {"id": "chunk_2", "title": "Chunk 2", "unit_ids": [3]},
                ],
                "future_capabilities": [{"capability_id": "pair_matching", "covers_chunk_ids": ["chunk_1"]}],
                "microcards_candidates": [
                    {"candidate_id": "c1", "unit_id": 3, "chunk_id": "chunk_2", "card_type": "fact_recall", "prompt_seed": "Факт C?", "answer_seed": "Описание C"},
                    {"candidate_id": "c2", "unit_id": 1, "chunk_id": "chunk_1", "card_type": "pair_match", "prompt_seed": "Термин A", "answer_seed": "Определение A"},
                    {"candidate_id": "c3", "unit_id": 2, "chunk_id": "chunk_1", "card_type": "pair_match", "prompt_seed": "Термин B", "answer_seed": "Определение B"},
                ],
                "report_blocks_version": "1.0",
                "report_blocks": [],
                "report_lint": {"verbosity_risk": "low", "duplicate_content_signals": 0, "fallback_renderer_recommended": False},
                "warnings": [],
                "recommendations": [],
                "not_recommended": [],
            },
        },
    )


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture
def temp_data(monkeypatch):
    local_tmp_root = Path.cwd() / ".pytest_tmp_p9_microcards_api"
    local_tmp_root.mkdir(parents=True, exist_ok=True)
    tmp_path = Path(tempfile.mkdtemp(prefix="mcapi_", dir=str(local_tmp_root)))
    original_data_dir = _headless_app_ctx.data_dir
    original_user_id = _headless_app_ctx.user_id
    original_stats_data_dir = _headless_app_ctx.statistics_service.data_dir
    original_stats_users_dir = _headless_app_ctx.statistics_service.users_dir
    original_stats_mc_bridge = getattr(_headless_app_ctx.statistics_service, "_microcards_analytics_service", None)
    monkeypatch.setattr(_headless_app_ctx, "data_dir", tmp_path)
    monkeypatch.setattr(_headless_app_ctx, "user_id", "user_a")
    monkeypatch.setattr(_headless_app_ctx.statistics_service, "data_dir", tmp_path)
    monkeypatch.setattr(_headless_app_ctx.statistics_service, "users_dir", tmp_path / "users")
    monkeypatch.setattr(_headless_app_ctx.statistics_service, "_microcards_analytics_service", None)
    try:
        yield tmp_path
    finally:
        monkeypatch.setattr(_headless_app_ctx, "data_dir", original_data_dir)
        monkeypatch.setattr(_headless_app_ctx, "user_id", original_user_id)
        stats_service = getattr(_headless_app_ctx, "statistics_service", None)
        if stats_service is not None and hasattr(stats_service, "data_dir"):
            monkeypatch.setattr(stats_service, "data_dir", original_stats_data_dir)
        if stats_service is not None and hasattr(stats_service, "users_dir"):
            monkeypatch.setattr(stats_service, "users_dir", original_stats_users_dir)
        if stats_service is not None and hasattr(stats_service, "_microcards_analytics_service"):
            monkeypatch.setattr(stats_service, "_microcards_analytics_service", original_stats_mc_bridge)


def test_microcards_api_shared_deck_user_isolated_progress(client, temp_data: Path, monkeypatch):
    run_id = "ai_run_20260226T100000Z_p9mc01"
    _create_analysis_artifact(temp_data / "ai_runs", run_id)

    create_resp = client.post(
        "/api/editor/microcards/decks/from-analysis",
        json={"ai_run_id": run_id, "selector": {"scope": "all"}},
    )
    assert create_resp.status_code == 200
    create_data = create_resp.get_json()
    assert create_data["ok"] is True
    deck_id = create_data["deck"]["id"]
    assert (temp_data / "microcards" / "decks" / f"{deck_id}.json").exists()

    queue_a_resp = client.get(f"/api/editor/microcards/decks/{deck_id}/queue?limit=20")
    assert queue_a_resp.status_code == 200
    queue_a = queue_a_resp.get_json()
    assert queue_a["ok"] is True
    assert queue_a["queue"]
    assert queue_a["session"]["id"].startswith("mcsess_")
    assert queue_a["cursor"] == 0
    reviewed_card = queue_a["current_card"]
    assert reviewed_card and isinstance(reviewed_card, dict)

    submit_a_resp = client.post(
        "/api/editor/microcards/review/submit",
        json={"deck_id": deck_id, "card_id": reviewed_card["id"], "rating": "good", "session_id": queue_a["session"]["id"]},
    )
    assert submit_a_resp.status_code == 200
    submit_a = submit_a_resp.get_json()
    assert submit_a["ok"] is True
    assert submit_a["review_state"]["user_id"] == "user_a"
    assert submit_a["session"]["id"] == queue_a["session"]["id"]
    assert submit_a["session"]["cursor"] == 1

    # Reopen queue for same user: should resume unfinished session
    queue_a_resume_resp = client.get(f"/api/editor/microcards/decks/{deck_id}/queue?limit=20")
    assert queue_a_resume_resp.status_code == 200
    queue_a_resume = queue_a_resume_resp.get_json()
    assert queue_a_resume["ok"] is True
    assert queue_a_resume["session"]["id"] == queue_a["session"]["id"]
    assert queue_a_resume["cursor"] == 1

    monkeypatch.setattr(_headless_app_ctx, "user_id", "user_b")
    queue_b_resp = client.get(f"/api/editor/microcards/decks/{deck_id}/queue?limit=20")
    assert queue_b_resp.status_code == 200
    queue_b = queue_b_resp.get_json()
    assert queue_b["ok"] is True
    assert queue_b["queue"]
    assert any(card["id"] == reviewed_card["id"] for card in queue_b["queue"])

    state_a = json.loads((temp_data / "users" / "user_a" / "microcards" / "review_states.json").read_text(encoding="utf-8"))
    assert reviewed_card["id"] in state_a["items"]
    state_b_path = temp_data / "users" / "user_b" / "microcards" / "review_states.json"
    assert not state_b_path.exists()


def test_microcards_append_from_analysis_to_existing_deck(client, temp_data: Path):
    run_id = "ai_run_20260226T101500Z_p9mc02"
    _create_analysis_artifact(temp_data / "ai_runs", run_id)

    create_resp = client.post(
        "/api/editor/microcards/decks/from-analysis",
        json={"ai_run_id": run_id, "selector": {"scope": "all", "pair_match_only": True}},
    )
    assert create_resp.status_code == 200
    create_data = create_resp.get_json()
    assert create_data["ok"] is True
    deck_id = create_data["deck"]["id"]
    initial_total = len(create_data["deck"]["cards"])
    assert initial_total >= 1

    append_resp = client.post(
        f"/api/editor/microcards/decks/{deck_id}/append-from-analysis",
        json={"ai_run_id": run_id, "selector": {"scope": "all"}},
    )
    assert append_resp.status_code == 200
    append_data = append_resp.get_json()
    assert append_data["ok"] is True
    assert append_data["deck"]["id"] == deck_id
    assert append_data["added_cards"] >= 1  # fact_recall should be added
    assert len(append_data["deck"]["cards"]) >= initial_total + 1

    append_again_resp = client.post(
        f"/api/editor/microcards/decks/{deck_id}/append-from-analysis",
        json={"ai_run_id": run_id, "selector": {"scope": "all"}},
    )
    assert append_again_resp.status_code == 200
    append_again = append_again_resp.get_json()
    assert append_again["ok"] is True
    assert append_again["skipped_duplicates"] >= 1


def test_microcards_endpoints_disabled_by_feature_flag(client, temp_data: Path, monkeypatch):
    monkeypatch.setenv("RP_EDITOR_FF_MICROCARDS_MODE", "0")

    list_resp = client.get("/api/editor/microcards/decks")
    assert list_resp.status_code == 404
    list_data = list_resp.get_json()
    assert list_data["ok"] is False
    assert list_data["error"] == "microcards_mode_disabled"
    assert list_data["feature_flags"]["microcards_mode"] is False
    assert list_data["feature_flags"]["microcards_pair_match"] is False

    create_resp = client.post(
        "/api/editor/microcards/decks/from-analysis",
        json={"ai_run_id": "ai_run_20260226T123000Z_dummy04", "selector": {"scope": "all"}},
    )
    assert create_resp.status_code == 404
    create_data = create_resp.get_json()
    assert create_data["ok"] is False
    assert create_data["error"] == "microcards_mode_disabled"


def test_microcards_pair_match_flag_blocks_pair_only_and_filters_all_scope(client, temp_data: Path, monkeypatch):
    monkeypatch.setenv("RP_EDITOR_FF_MICROCARDS_PAIR_MATCH", "0")
    run_id = "ai_run_20260226T123500Z_pairoff5"
    _create_analysis_artifact(temp_data / "ai_runs", run_id)

    pair_only_resp = client.post(
        "/api/editor/microcards/decks/from-analysis",
        json={"ai_run_id": run_id, "selector": {"scope": "all", "pair_match_only": True}},
    )
    assert pair_only_resp.status_code == 400
    pair_only_data = pair_only_resp.get_json()
    assert pair_only_data["ok"] is False
    assert pair_only_data["error"] == "microcards_pair_match_disabled"
    assert pair_only_data["feature_flags"]["microcards_pair_match"] is False

    all_scope_resp = client.post(
        "/api/editor/microcards/decks/from-analysis",
        json={"ai_run_id": run_id, "selector": {"scope": "all"}},
    )
    assert all_scope_resp.status_code == 200
    all_scope_data = all_scope_resp.get_json()
    assert all_scope_data["ok"] is True
    cards = all_scope_data["deck"]["cards"]
    assert cards
    assert all(str(card.get("card_type") or "").lower() != "pair_match" for card in cards)


def test_microcards_summary_m5_endpoint_and_review_invalidation(client, temp_data: Path):
    run_id = "ai_run_20260226T124500Z_m5summary"
    _create_analysis_artifact(temp_data / "ai_runs", run_id)

    create_resp = client.post(
        "/api/editor/microcards/decks/from-analysis",
        json={"ai_run_id": run_id, "selector": {"scope": "all"}},
    )
    assert create_resp.status_code == 200
    create_data = create_resp.get_json()
    assert create_data["ok"] is True
    deck_id = create_data["deck"]["id"]

    queue_resp = client.get(f"/api/editor/microcards/decks/{deck_id}/queue?limit=20")
    assert queue_resp.status_code == 200
    queue_data = queue_resp.get_json()
    assert queue_data["ok"] is True
    reviewed_card = queue_data.get("current_card")
    assert isinstance(reviewed_card, dict)

    summary_before_resp = client.get("/api/microcards/summary")
    assert summary_before_resp.status_code == 200
    summary_before = summary_before_resp.get_json()
    assert summary_before["ok"] is True
    assert summary_before["totals"]["reviews"] == 0
    assert summary_before["ratings_distribution"] == {
        "again": 0,
        "hard": 0,
        "good": 0,
        "easy": 0,
    }
    assert summary_before["queue_summary"]["cards_new_total"] >= 1

    submit_resp = client.post(
        "/api/editor/microcards/review/submit",
        json={
            "deck_id": deck_id,
            "card_id": reviewed_card["id"],
            "rating": "good",
            "session_id": queue_data["session"]["id"],
        },
    )
    assert submit_resp.status_code == 200
    submit_data = submit_resp.get_json()
    assert submit_data["ok"] is True

    summary_after_resp = client.get("/api/microcards/summary")
    assert summary_after_resp.status_code == 200
    summary_after = summary_after_resp.get_json()
    assert summary_after["ok"] is True
    assert summary_after["totals"]["reviews"] == 1
    assert summary_after["today"]["reviews"] == 1
    assert summary_after["ratings_distribution"]["good"] == 1

    reviewed_type = str((submit_data.get("review_event") or {}).get("details", {}).get("card_type") or "").lower()
    assert summary_after["by_card_type"].get(reviewed_type, {}).get("reviews", 0) >= 1

    summary_with_dynamics_resp = client.get("/api/microcards/summary?include_dynamics=1&days=7")
    assert summary_with_dynamics_resp.status_code == 200
    summary_with_dynamics = summary_with_dynamics_resp.get_json()
    assert summary_with_dynamics["ok"] is True
    assert isinstance(summary_with_dynamics.get("dynamics"), list)


def test_statistics_contracts_m6_include_mixed_microcards_fields(client, temp_data: Path):
    run_id = "ai_run_20260226T125800Z_m6stats"
    _create_analysis_artifact(temp_data / "ai_runs", run_id)

    create_resp = client.post(
        "/api/editor/microcards/decks/from-analysis",
        json={"ai_run_id": run_id, "selector": {"scope": "all"}},
    )
    assert create_resp.status_code == 200
    create_data = create_resp.get_json()
    assert create_data["ok"] is True
    deck_id = create_data["deck"]["id"]

    queue_resp = client.get(f"/api/editor/microcards/decks/{deck_id}/queue?limit=20")
    assert queue_resp.status_code == 200
    queue_data = queue_resp.get_json()
    assert queue_data["ok"] is True
    first_card = queue_data["current_card"]
    assert isinstance(first_card, dict)

    submit_resp = client.post(
        "/api/editor/microcards/review/submit",
        json={
            "deck_id": deck_id,
            "card_id": first_card["id"],
            "rating": "good",
            "session_id": queue_data["session"]["id"],
        },
    )
    assert submit_resp.status_code == 200
    submit_data = submit_resp.get_json()
    assert submit_data["ok"] is True

    overall_resp = client.get("/api/statistics/overall?user_id=user_a")
    assert overall_resp.status_code == 200
    overall_data = overall_resp.get_json()
    assert overall_data["ok"] is True
    stats = overall_data["stats"]

    assert "activity_streak_days" in stats
    assert "activity_streak_best" in stats
    assert "microcards" in stats
    assert "learning_sources" in stats
    assert stats["microcards"]["reviews_total"] >= 1
    assert stats["microcards"]["ratings_distribution"]["good"] >= 1
    assert stats["learning_sources"]["microcards"]["attempts"] >= 1
    assert (
        stats["learning_sources"]["combined"]["attempts"]
        == stats["learning_sources"]["tasks"]["attempts"] + stats["learning_sources"]["microcards"]["attempts"]
    )

    dynamics_resp = client.get("/api/statistics/time-dynamics?user_id=user_a&days=2")
    assert dynamics_resp.status_code == 200
    dynamics_data = dynamics_resp.get_json()
    assert dynamics_data["ok"] is True
    rows = dynamics_data["dynamics"]
    assert isinstance(rows, list)
    assert rows

    row_with_microcards = next((row for row in rows if int(row.get("microcards_reviews") or 0) > 0), None)
    assert row_with_microcards is not None
    assert "source_breakdown" in row_with_microcards
    assert "combined_study_minutes" in row_with_microcards
    assert row_with_microcards["source_breakdown"]["tasks"]["attempts"] == row_with_microcards["total_attempts"]
    assert (
        row_with_microcards["activity_attempts_total"]
        == row_with_microcards["source_breakdown"]["tasks"]["attempts"]
        + row_with_microcards["source_breakdown"]["microcards"]["attempts"]
    )

    # Sanity check: one of rows should represent "today" window when days=2.
    today_iso = datetime.now().date().isoformat()
    assert any(row.get("date") == today_iso for row in rows)


def test_microcards_review_submit_m1_orchestration_invalidates_stats_and_is_idempotent(
    client,
    temp_data: Path,
    monkeypatch,
):
    run_id = "ai_run_20260226T130500Z_m1orchestr"
    _create_analysis_artifact(temp_data / "ai_runs", run_id)

    create_resp = client.post(
        "/api/editor/microcards/decks/from-analysis",
        json={"ai_run_id": run_id, "selector": {"scope": "all"}},
    )
    assert create_resp.status_code == 200
    create_data = create_resp.get_json()
    assert create_data["ok"] is True
    deck_id = create_data["deck"]["id"]

    queue_resp = client.get(f"/api/editor/microcards/decks/{deck_id}/queue?limit=20")
    assert queue_resp.status_code == 200
    queue_data = queue_resp.get_json()
    assert queue_data["ok"] is True
    first_card = queue_data["current_card"]
    assert isinstance(first_card, dict)

    stats_clear_calls = []

    class _StatsStub:
        def clear_cache(self, user_id=None):
            stats_clear_calls.append(user_id)

    calendar_calls = []

    class _CalendarStub:
        def __init__(self, data_dir: str, user_id: str = "default_user", **kwargs):
            self.data_dir = data_dir
            self.user_id = user_id

        def record_microcards_review(self, *, deck_id: str, card_id: str, review_event: dict):
            calendar_calls.append(
                {
                    "data_dir": self.data_dir,
                    "user_id": self.user_id,
                    "deck_id": deck_id,
                    "card_id": card_id,
                    "review_event_id": (review_event or {}).get("id"),
                }
            )
            return {"success": True}

    monkeypatch.setattr(_headless_app_ctx, "statistics_service", _StatsStub())
    monkeypatch.setattr(server_module, "CalendarService", _CalendarStub)
    monkeypatch.setattr(server_module, "CALENDAR_AVAILABLE", True)

    submit_resp = client.post(
        "/api/editor/microcards/review/submit",
        json={
            "deck_id": deck_id,
            "card_id": first_card["id"],
            "rating": "good",
            "session_id": queue_data["session"]["id"],
        },
    )
    assert submit_resp.status_code == 200
    submit_data = submit_resp.get_json()
    assert submit_data["ok"] is True
    review_event = submit_data["review_event"]
    assert review_event["id"].startswith("mcrev_")

    assert stats_clear_calls == ["user_a"]
    assert len(calendar_calls) == 1
    assert calendar_calls[0]["user_id"] == "user_a"
    assert calendar_calls[0]["deck_id"] == deck_id
    assert calendar_calls[0]["card_id"] == first_card["id"]
    assert calendar_calls[0]["review_event_id"] == review_event["id"]
    assert Path(calendar_calls[0]["data_dir"]) == temp_data

    state_path = temp_data / "users" / "user_a" / "microcards" / "live_integration_state.json"
    assert state_path.exists()
    state_payload = json.loads(state_path.read_text(encoding="utf-8"))
    assert f"review_event:{review_event['id']}" in state_payload.get("calendar_review_event_keys", [])
    assert int(state_payload.get("applied_total") or 0) >= 1

    # Simulate repeated orchestration for the same persisted review_event.
    replay_result = server_module._orchestrate_microcards_review_post_submit(
        deck_id=deck_id,
        card_id=first_card["id"],
        review_result={"review_event": review_event},
    )
    assert replay_result["calendar_integration"].get("idempotent_skip") is True
    assert len(calendar_calls) == 1
    assert stats_clear_calls == ["user_a", "user_a"]  # cache invalidation remains safe/repeatable


def test_theory_rollout_stage_rollback_disables_microcards_ui_without_data_loss_and_tracks_telemetry(
    client,
    temp_data: Path,
    monkeypatch,
):
    run_id = "ai_run_20260226T140000Z_roll13mc"
    _create_analysis_artifact(temp_data / "ai_runs", run_id)

    create_resp = client.post(
        "/api/editor/microcards/decks/from-analysis",
        json={"ai_run_id": run_id, "selector": {"scope": "all"}},
    )
    assert create_resp.status_code == 200
    create_data = create_resp.get_json()
    assert create_data["ok"] is True
    deck_id = create_data["deck"]["id"]
    deck_path = temp_data / "microcards" / "decks" / f"{deck_id}.json"
    assert deck_path.exists()

    queue_resp = client.get(f"/api/editor/microcards/decks/{deck_id}/queue?limit=20")
    assert queue_resp.status_code == 200
    queue_data = queue_resp.get_json()
    assert queue_data["ok"] is True
    first_card = queue_data["queue"][0]

    submit_resp = client.post(
        "/api/editor/microcards/review/submit",
        json={
            "deck_id": deck_id,
            "card_id": first_card["id"],
            "rating": "good",
            "session_id": queue_data["session"]["id"],
        },
    )
    assert submit_resp.status_code == 200
    submit_data = submit_resp.get_json()
    assert submit_data["ok"] is True

    monkeypatch.setenv("RP_THEORY_ROLLOUT_STAGE", "coverage")
    disabled_resp = client.get("/api/editor/microcards/decks")
    assert disabled_resp.status_code == 404
    disabled_data = disabled_resp.get_json()
    assert disabled_data["error"] == "microcards_mode_disabled"
    assert disabled_data["feature_flags"]["microcards_mode"] is False
    assert deck_path.exists()  # rollback gate must not delete deck content

    monkeypatch.delenv("RP_THEORY_ROLLOUT_STAGE", raising=False)
    reopen_resp = client.get(f"/api/editor/microcards/decks/{deck_id}")
    assert reopen_resp.status_code == 200
    reopen_data = reopen_resp.get_json()
    assert reopen_data["ok"] is True
    assert reopen_data["deck"]["id"] == deck_id

    telemetry_resp = client.get("/api/editor/theory/rollout/telemetry?limit=500")
    assert telemetry_resp.status_code == 200
    telemetry_data = telemetry_resp.get_json()
    assert telemetry_data["ok"] is True
    telemetry = telemetry_data["telemetry"]
    assert telemetry["by_event"].get("microcards_deck_created_from_analysis", 0) >= 1
    assert telemetry["by_event"].get("microcards_queue_opened", 0) >= 1
    assert telemetry["by_event"].get("microcards_review_submitted", 0) >= 1
    assert telemetry["by_event"].get("feature_flag_blocked", 0) >= 1
    metrics = telemetry["metrics"]
    assert metrics["microdeck_creations_from_analysis"] >= 1
    assert metrics["microcards_reviews_total"] >= 1
