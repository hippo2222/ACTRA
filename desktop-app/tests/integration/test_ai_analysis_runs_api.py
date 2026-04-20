import json
import sys
from pathlib import Path
from typing import Optional

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from server import app, _headless_app_ctx  # type: ignore
from persistence.runtime import resolve_persistence_runtime_settings  # type: ignore
from services.storage_service import StorageService  # type: ignore
from task_system.core.io.task_io import TaskIO  # type: ignore


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture(autouse=True)
def enable_ai_mode(monkeypatch):
    monkeypatch.setenv("RP_EDITOR_FF_AI_MODE", "1")
    yield


@pytest.fixture
def temp_ai_runs_root(monkeypatch, tmp_path: Path):
    original_data_dir = _headless_app_ctx.data_dir
    original_persistence_runtime = _headless_app_ctx.persistence_runtime
    original_user_id = _headless_app_ctx.user_id
    test_runtime = resolve_persistence_runtime_settings(
        data_root=tmp_path,
        project_root=Path(__file__).resolve().parents[3],
    )
    test_runtime.ensure_runtime_dirs()
    monkeypatch.setattr(_headless_app_ctx, "data_dir", tmp_path)
    monkeypatch.setattr(_headless_app_ctx, "persistence_runtime", test_runtime)
    monkeypatch.setattr(_headless_app_ctx, "user_id", "test_user")
    try:
        yield tmp_path / "ai_runs"
    finally:
        monkeypatch.setattr(_headless_app_ctx, "data_dir", original_data_dir)
        monkeypatch.setattr(_headless_app_ctx, "persistence_runtime", original_persistence_runtime)
        monkeypatch.setattr(_headless_app_ctx, "user_id", original_user_id)


@pytest.fixture
def temp_ai_runs_with_storage(monkeypatch, tmp_path: Path):
    original_data_dir = _headless_app_ctx.data_dir
    original_persistence_runtime = _headless_app_ctx.persistence_runtime
    original_user_id = _headless_app_ctx.user_id
    original_storage = _headless_app_ctx.storage_service
    test_runtime = resolve_persistence_runtime_settings(
        data_root=tmp_path,
        project_root=Path(__file__).resolve().parents[3],
    )
    test_runtime.ensure_runtime_dirs()
    monkeypatch.setattr(_headless_app_ctx, "data_dir", tmp_path)
    monkeypatch.setattr(_headless_app_ctx, "persistence_runtime", test_runtime)
    monkeypatch.setattr(_headless_app_ctx, "user_id", "test_user")
    monkeypatch.setattr(_headless_app_ctx, "storage_service", StorageService(tmp_path))
    try:
        yield tmp_path / "ai_runs", _headless_app_ctx.storage_service
    finally:
        monkeypatch.setattr(_headless_app_ctx, "storage_service", original_storage)
        monkeypatch.setattr(_headless_app_ctx, "data_dir", original_data_dir)
        monkeypatch.setattr(_headless_app_ctx, "persistence_runtime", original_persistence_runtime)
        monkeypatch.setattr(_headless_app_ctx, "user_id", original_user_id)


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _create_analysis_run(root: Path, run_id: str, *, updated_at: str, created_at: str, word_count: int = 120) -> None:
    run_dir = root / run_id
    _write_json(
        run_dir / "run.json",
        {
            "run_id": run_id,
            "phase": "analyzed",
            "created_at": created_at,
            "updated_at": updated_at,
            "material_word_count": word_count,
            "material_language": "ru",
            "provider_used": "mock_provider",
            "provider_model": "mock-model",
            "effective_output_language": "ru",
            "source_file_name": "lecture.pdf",
        },
    )
    _write_json(
        run_dir / "analysis.json",
        {
            "run_id": run_id,
            "created_at": created_at,
            "provider_used": "mock_provider",
            "provider_model": "mock-model",
            "provider_chain_attempts": [{"provider": "mock_provider", "status": "ok"}],
            "material_stats": {"word_count": word_count, "char_count": 1000, "language": "ru"},
            "language_preferences": {
                "mode": "same_as_material",
                "requested": None,
                "effective": "ru",
                "translation_warning": None,
            },
            "result": {
                "human_summary": "Короткий итог",
                "educational_units": [{"id": 1, "title": "Unit", "type": "concept"}],
                "recommendations": [{"task_type": "TEST", "count": 2, "priority": "high"}],
                "not_recommended": [],
                "warnings": [],
                "material_volume": "small",
                "target_language": "ru",
                "analysis_schema_version": "2.0",
                "learning_chunks": [{"id": "chunk_1", "title": "Chunk"}],
                "authoring_routes": [{"id": "route_1", "title": "Route"}],
                "future_capabilities": [{"capability_id": "pair_matching"}],
                "microcards_candidates": [{"candidate_id": "mc_1"}],
                "report_blocks_version": "1.0",
                "report_blocks": [],
                "report_lint": {"verbosity_risk": "low", "duplicate_content_signals": 0, "fallback_renderer_recommended": False},
                "illustrations_detected": False,
                "illustrations_note": None,
            },
        },
    )


def _create_editor_topic_task(
    storage: StorageService,
    *,
    module_id: str,
    topic_id: str,
    task_id: str,
    task_type: str = "test",
    name: str,
    meta_patch: Optional[dict] = None,
    content_patch: Optional[dict] = None,
) -> None:
    module_dir = Path(storage.modules_dir) / module_id
    topic_dir = module_dir / "topics" / topic_id
    (topic_dir / "tasks").mkdir(parents=True, exist_ok=True)
    if not (module_dir / "module.json").exists():
        _write_json(module_dir / "module.json", {"id": module_id, "name": module_id, "topics": [{"id": topic_id, "name": topic_id, "tasks": []}]})
    if not (topic_dir / "topic.json").exists():
        _write_json(topic_dir / "topic.json", {"id": topic_id, "name": topic_id, "tasks": []})

    task_obj = TaskIO.new_task(task_type, name=name, module=module_id, topic=topic_id)
    payload = task_obj.to_dict() if hasattr(task_obj, "to_dict") else task_obj
    payload["id"] = task_id
    payload["name"] = name
    payload.setdefault("meta", {})
    payload["meta"]["id"] = task_id
    payload["meta"]["module"] = module_id
    payload["meta"]["topic"] = topic_id
    if isinstance(meta_patch, dict):
        payload["meta"].update(meta_patch)
    payload.setdefault("content", {})
    if isinstance(content_patch, dict):
        payload["content"].update(content_patch)
    ok = storage.save_task(module_id, topic_id, task_id, payload, validate=True)
    assert ok is True


def test_list_ai_analyses_returns_recent_runs(client, temp_ai_runs_root: Path):
    _create_analysis_run(
        temp_ai_runs_root,
        "ai_run_20260224T100000Z_old111",
        created_at="2026-02-24T10:00:00Z",
        updated_at="2026-02-24T10:05:00Z",
        word_count=110,
    )
    _create_analysis_run(
        temp_ai_runs_root,
        "ai_run_20260225T090000Z_new222",
        created_at="2026-02-25T09:00:00Z",
        updated_at="2026-02-25T09:03:00Z",
        word_count=220,
    )
    _write_json(
        temp_ai_runs_root / "ai_run_20260225T090000Z_noanalysis" / "run.json",
        {"run_id": "ai_run_20260225T090000Z_noanalysis", "phase": "generated_only"},
    )

    response = client.get("/api/editor/ai/analyses?limit=10")
    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    assert len(data["items"]) == 2
    assert data["items"][0]["ai_run_id"] == "ai_run_20260225T090000Z_new222"
    assert data["items"][1]["ai_run_id"] == "ai_run_20260224T100000Z_old111"
    assert data["items"][0]["units_count"] == 1
    assert data["items"][0]["recommendations_count"] == 1
    assert data["items"][0]["material_word_count"] == 220


def test_open_ai_analysis_run_returns_analysis_payload(client, temp_ai_runs_root: Path):
    run_id = "ai_run_20260225T120000Z_open333"
    _create_analysis_run(
        temp_ai_runs_root,
        run_id,
        created_at="2026-02-25T12:00:00Z",
        updated_at="2026-02-25T12:01:00Z",
        word_count=345,
    )

    response = client.get(f"/api/editor/ai/analyses/{run_id}")
    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    assert data["ai_run_id"] == run_id
    assert data["provider_used"] == "mock_provider"
    assert data["material_language"] == "ru"
    assert data["effective_output_language"] == "ru"
    assert data["analysis_schema_version"] == "2.0"
    assert isinstance(data["educational_units"], list)
    assert isinstance(data["recommendations"], list)
    assert data["material_stats"]["word_count"] == 345


def test_open_ai_analysis_run_hides_v2_fields_when_analysis_v2_flag_disabled(client, temp_ai_runs_root: Path, monkeypatch):
    monkeypatch.setenv("RP_EDITOR_FF_ANALYSIS_V2_SCHEMA", "0")
    run_id = "ai_run_20260226T120500Z_ffv2off1"
    _create_analysis_run(
        temp_ai_runs_root,
        run_id,
        created_at="2026-02-26T12:05:00Z",
        updated_at="2026-02-26T12:06:00Z",
        word_count=210,
    )

    resp = client.get(f"/api/editor/ai/analyses/{run_id}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert isinstance(data["educational_units"], list)
    assert isinstance(data["recommendations"], list)
    assert "analysis_schema_version" not in data
    assert "learning_chunks" not in data
    assert "authoring_routes" not in data
    assert "report_blocks" not in data
    assert data["feature_flags"]["analysis_v2_schema"] is False
    assert data["feature_flags"]["analysis_report_blocks_v1"] is False


def test_open_ai_analysis_run_hides_report_blocks_when_report_blocks_flag_disabled(client, temp_ai_runs_root: Path, monkeypatch):
    monkeypatch.setenv("RP_EDITOR_FF_ANALYSIS_REPORT_BLOCKS_V1", "0")
    run_id = "ai_run_20260226T121000Z_ffrboff2"
    _create_analysis_run(
        temp_ai_runs_root,
        run_id,
        created_at="2026-02-26T12:10:00Z",
        updated_at="2026-02-26T12:11:00Z",
        word_count=230,
    )

    resp = client.get(f"/api/editor/ai/analyses/{run_id}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert data.get("analysis_schema_version") == "2.0"
    assert "learning_chunks" in data
    assert "report_blocks" not in data
    assert "report_blocks_version" not in data
    assert "report_lint" not in data
    assert data["feature_flags"]["analysis_report_blocks_v1"] is False
    assert data["feature_flags"]["analysis_report_renderer_v1"] is False


def test_open_ai_analysis_run_not_found(client, temp_ai_runs_root: Path):
    response = client.get("/api/editor/ai/analyses/ai_run_20260225T120000Z_missing0")
    assert response.status_code == 404
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "analysis_not_found"


def test_ai_analysis_coverage_endpoint_returns_gaps_duplicates_and_grounding(client, temp_ai_runs_with_storage):
    ai_runs_root, storage = temp_ai_runs_with_storage
    run_id = "ai_run_20260225T150000Z_cov444"
    _create_analysis_run(
        ai_runs_root,
        run_id,
        created_at="2026-02-25T15:00:00Z",
        updated_at="2026-02-25T15:01:00Z",
        word_count=500,
    )

    # Enrich analysis artifact with units/chunks/coverage data relevant for P8
    analysis_path = ai_runs_root / run_id / "analysis.json"
    analysis_payload = json.loads(analysis_path.read_text(encoding="utf-8"))
    analysis_payload["result"]["educational_units"] = [
        {"id": 1, "title": "Unit 1", "type": "concept", "assessment_risk": "low", "description": "Alpha", "evidence": "alpha evidence"},
        {"id": 2, "title": "Unit 2", "type": "fact", "assessment_risk": "high", "description": "Beta", "evidence": "beta evidence"},
    ]
    analysis_payload["result"]["learning_chunks"] = [
        {"id": "chunk_1", "title": "Chunk 1", "chunk_type": "factual_set", "unit_ids": [1]},
        {"id": "chunk_2", "title": "Chunk 2", "chunk_type": "contrast", "unit_ids": [2]},
    ]
    analysis_payload["result"]["coverage_plan"] = {
        "coverage_plan_version": "1.0",
        "unit_targets": [
            {"unit_id": 1, "must_cover": True, "recommended_surfaces": ["editor_manual"], "preferred_task_types": ["TEST"]},
            {"unit_id": 2, "must_cover": True, "recommended_surfaces": ["editor_manual"], "preferred_task_types": ["OPEN_ANSWER"]},
        ],
        "chunk_targets": [
            {"chunk_id": "chunk_1", "route_ids": ["route_1"], "max_primary_tasks_recommended": 1},
            {"chunk_id": "chunk_2", "route_ids": ["route_2"], "max_primary_tasks_recommended": 1},
        ],
    }
    _write_json(analysis_path, analysis_payload)

    module_id = "m_cov"
    topic_id = "t_cov"

    _create_editor_topic_task(
        storage,
        module_id=module_id,
        topic_id=topic_id,
        task_id="task_a",
        name="Task A",
        meta_patch={
            "ai_run_id": run_id,
            "educational_unit_ids": [1],
            "analysis_chunk_ids": ["chunk_1"],
            "source_grounding": {"score": 0.82, "weak": False, "primary_unit_id": 1, "primary_unit_title": "Unit 1"},
        },
        content_patch={"prompt": "Alpha prompt"},
    )
    _create_editor_topic_task(
        storage,
        module_id=module_id,
        topic_id=topic_id,
        task_id="task_b",
        name="Task B",
        meta_patch={
            "ai_run_id": run_id,
            "educational_unit_ids": [1],
            # chunk will be inferred from unit_ids
            "source_grounding": {"score": 0.11, "weak": True, "primary_unit_id": 1, "primary_unit_title": "Unit 1"},
        },
        content_patch={"prompt": "Weakly grounded alpha-ish text"},
    )
    _create_editor_topic_task(
        storage,
        module_id=module_id,
        topic_id=topic_id,
        task_id="task_c",
        name="Task C",
        meta_patch={
            "ai_run_id": run_id,
            "educational_unit_ids": [1],
            "analysis_chunk_ids": ["chunk_1"],
        },
        content_patch={"prompt": "Another alpha task"},
    )
    _create_editor_topic_task(
        storage,
        module_id=module_id,
        topic_id=topic_id,
        task_id="task_d",
        name="Task D no links",
        meta_patch={"ai_run_id": run_id},
        content_patch={"prompt": "Unlinked task prompt"},
    )
    _create_editor_topic_task(
        storage,
        module_id=module_id,
        topic_id=topic_id,
        task_id="task_e",
        name="Task E foreign",
        meta_patch={
            "ai_run_id": "ai_run_20260225T150500Z_other55",
            "educational_unit_ids": [2],
            "analysis_chunk_ids": ["chunk_2"],
        },
        content_patch={"prompt": "Beta task for another run"},
    )
    storage.reload_modules()

    resp = client.get(f"/api/editor/ai/analyses/{run_id}/coverage?module_id={module_id}&topic_id={topic_id}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert data["ai_run_id"] == run_id
    assert data["module_id"] == module_id
    assert data["topic_id"] == topic_id

    summary = data["summary"]
    assert summary["tasks_total"] == 5
    assert summary["tasks_linked_in_scope"] == 3
    assert summary["tasks_without_links"] == 1
    assert summary["tasks_foreign_run"] == 1
    assert summary["weak_grounding_tasks"] == 1
    assert summary["units_total"] == 2
    assert summary["must_cover_units_uncovered"] == 1
    assert summary["units_overcovered"] == 1  # unit_1 linked by 3 tasks
    assert summary["chunks_uncovered"] == 1   # chunk_2 only covered by foreign-run task (excluded)
    assert summary["chunks_overcovered"] == 1  # chunk_1 covered by 3 tasks; threshold=1

    unit_rows = {row["unit_id"]: row for row in data["unit_coverage"]}
    assert unit_rows[1]["is_duplicate"] is True
    assert unit_rows[2]["is_gap"] is True
    assert unit_rows[2]["is_must_cover_gap"] is True

    chunk_rows = {row["chunk_id"]: row for row in data["chunk_coverage"]}
    assert chunk_rows["chunk_1"]["is_duplicate"] is True
    assert chunk_rows["chunk_2"]["is_gap"] is True

    tasks = {row["task_id"]: row for row in data["tasks"]}
    assert tasks["task_b"]["weak_grounding"] is True
    assert "weak_source_grounding" in tasks["task_b"]["warnings"]
    assert tasks["task_b"]["chunk_link_mode"] == "inferred_from_units"
    assert tasks["task_d"]["warnings"] == ["no_analysis_links"]
    assert tasks["task_e"]["analysis_scope"] == "foreign_run"
    assert "linked_to_other_ai_run" in tasks["task_e"]["warnings"]


def test_ai_analysis_coverage_endpoint_disabled_by_feature_flag(client, monkeypatch):
    monkeypatch.setenv("RP_EDITOR_FF_ANALYSIS_COVERAGE_IN_EDITOR", "0")
    run_id = "ai_run_20260226T122000Z_covoff03"
    resp = client.get(f"/api/editor/ai/analyses/{run_id}/coverage?module_id=m1&topic_id=t1")
    assert resp.status_code == 404
    data = resp.get_json()
    assert data["ok"] is False
    assert data["error"] == "analysis_coverage_disabled"
    assert data["feature_flags"]["analysis_coverage_in_editor"] is False


def test_theory_rollout_stage_caps_features_and_status_endpoint(client, temp_ai_runs_root: Path, monkeypatch):
    monkeypatch.setenv("RP_THEORY_ROLLOUT_STAGE", "analysis_v2")
    run_id = "ai_run_20260226T130000Z_roll13a"
    _create_analysis_run(
        temp_ai_runs_root,
        run_id,
        created_at="2026-02-26T13:00:00Z",
        updated_at="2026-02-26T13:01:00Z",
        word_count=150,
    )

    open_resp = client.get(f"/api/editor/ai/analyses/{run_id}")
    assert open_resp.status_code == 200
    open_data = open_resp.get_json()
    assert open_data["ok"] is True
    assert open_data.get("analysis_schema_version") == "2.0"
    assert "report_blocks" not in open_data
    assert open_data["feature_flags"]["analysis_v2_schema"] is True
    assert open_data["feature_flags"]["analysis_report_blocks_v1"] is False
    assert open_data["feature_flags"]["analysis_report_renderer_v1"] is False
    assert open_data["feature_flags"]["microcards_mode"] is False
    assert open_data["feature_flags"]["microcards_pair_match"] is False

    status_resp = client.get("/api/editor/theory/rollout/status")
    assert status_resp.status_code == 200
    status_data = status_resp.get_json()
    assert status_data["ok"] is True
    rollout = status_data["rollout"]
    assert rollout["stage"] == "analysis_v2"
    assert rollout["previous_stage"] == "legacy"
    assert rollout["next_stage"] == "report_blocks"
    assert rollout["effective_feature_flags"]["analysis_v2_schema"] is True
    assert rollout["effective_feature_flags"]["analysis_report_blocks_v1"] is False
    assert "migration_inventory" in rollout
    assert isinstance(rollout["rollback_guarantees"], list)
    assert rollout["migration_inventory"]["ai_runs"]["with_analysis_artifact"] >= 1


def test_theory_rollout_telemetry_summary_records_analysis_open(client, temp_ai_runs_root: Path):
    run_id = "ai_run_20260226T131500Z_roll13b"
    _create_analysis_run(
        temp_ai_runs_root,
        run_id,
        created_at="2026-02-26T13:15:00Z",
        updated_at="2026-02-26T13:16:00Z",
        word_count=190,
    )

    open_resp = client.get(f"/api/editor/ai/analyses/{run_id}")
    assert open_resp.status_code == 200

    telemetry_resp = client.get("/api/editor/theory/rollout/telemetry?limit=200")
    assert telemetry_resp.status_code == 200
    telemetry_data = telemetry_resp.get_json()
    assert telemetry_data["ok"] is True
    telemetry = telemetry_data["telemetry"]
    assert telemetry["events_window"] >= 1
    assert telemetry["by_event"].get("analysis_payload_served", 0) >= 1
    metrics = telemetry["metrics"]
    assert metrics["analysis_v2_valid_ratio"]["denominator"] >= 1
    assert metrics["analysis_v2_valid_ratio"]["numerator"] >= 1
    assert metrics["avg_report_blocks_size"] is not None
