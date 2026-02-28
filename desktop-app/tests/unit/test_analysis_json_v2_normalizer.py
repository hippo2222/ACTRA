import sys
from pathlib import Path


DESKTOP_APP_DIR = Path(__file__).resolve().parent.parent.parent
PROJECT_ROOT = DESKTOP_APP_DIR.parent
for p in (str(DESKTOP_APP_DIR), str(PROJECT_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)


from services.ai_generation_service import AnalysisResult, _ensure_analysis_quality


def _base_raw_analysis():
    return {
        "material_volume": "medium",
        "target_language": "ru",
        "educational_units": [
            {
                "id": 1,
                "title": "Классификация форм X",
                "type": "classification",
                "description": "Три группы и их признаки.",
                "explicitness": "explicit",
                "evidence": "В тексте перечислены группы и признаки.",
                "modality": "text",
                "assessment_risk": "medium",
            },
            {
                "id": 2,
                "title": "Пороговое значение",
                "type": "fact",
                "description": "Порог > 5 ммоль/л указан в критериях 2024.",
                "explicitness": "explicit",
                "evidence": "Критерий > 5 ммоль/л (2024).",
                "modality": "text",
                "assessment_risk": "high",
            },
        ],
        "recommendations": [
            {
                "task_type": "TEST",
                "count": 2,
                "priority": "high",
                "covers_units": [1, 2],
                "rationale": "Подходит для проверки фактов и классификации.",
            },
            {
                "task_type": "SEQUENCE",
                "count": 1,
                "priority": "medium",
                "covers_units": [1],
                "rationale": "Подходит для структурирования классификации.",
            },
        ],
        "not_recommended": [],
        "illustrations_detected": False,
        "illustrations_note": None,
        "warnings": [],
    }


def test_p2_normalizer_extends_analysis_with_v2_fields_and_keeps_legacy():
    normalized = _ensure_analysis_quality(
        _base_raw_analysis(),
        material="Есть классификация, термины и порог > 5 ммоль/л (2024).",
        fallback_target_language="ru",
    )

    assert normalized["analysis_schema_version"] == "2.0"
    assert isinstance(normalized["learning_chunks"], list) and normalized["learning_chunks"]
    assert isinstance(normalized["type_progression_suitability"], list) and normalized["type_progression_suitability"]
    assert isinstance(normalized["authoring_routes"], list)
    assert isinstance(normalized["coverage_plan"], dict)
    assert isinstance(normalized["microcards_candidates"], list)
    assert normalized["report_blocks_version"] == "1.0"
    assert isinstance(normalized["report_lint"], dict)

    assert "recommendations" in normalized and normalized["recommendations"]
    assert "educational_units" in normalized and len(normalized["educational_units"]) == 2
    chunk_ids = {c["id"] for c in normalized["learning_chunks"]}
    assert chunk_ids
    for unit in normalized["educational_units"]:
        assert isinstance(unit.get("chunk_ids"), list) and unit["chunk_ids"]
        assert set(unit["chunk_ids"]).issubset(chunk_ids)
        assert isinstance(unit.get("prerequisite_unit_ids"), list)
        assert isinstance(unit.get("cognitive_ops"), list) and unit["cognitive_ops"]
        assert isinstance(unit.get("factual_anchors"), list) and unit["factual_anchors"]

    cov = normalized["coverage_plan"]
    assert cov["coverage_plan_version"] == "1.0"
    assert len(cov["unit_targets"]) == 2


def test_p11_routes_are_practical_across_surfaces_with_checklists_and_anti_patterns():
    normalized = _ensure_analysis_quality(
        _base_raw_analysis(),
        material="Материал с классификацией, термином и порогом > 5 ммоль/л (2024) для проверки маршрутов.",
        fallback_target_language="ru",
    )

    routes = normalized["authoring_routes"]
    assert routes

    surfaces = {str(r.get("target_surface") or "").lower() for r in routes}
    route_kinds = {str(r.get("route_kind") or "").lower() for r in routes}
    assert "complexes" in surfaces
    assert "editor_manual" in surfaces
    assert "complex_progression" in route_kinds
    assert "manual_practice" in route_kinds

    # Для этого фикстурного материала pair_matching обычно подходит, поэтому ждём microcards+hybrid пути.
    assert "microcards" in surfaces
    assert "mixed" in surfaces
    assert "microcards_support" in route_kinds
    assert "hybrid" in route_kinds

    for route in routes:
        assert str(route.get("effort_estimate") or "") in {"low", "medium", "high"}
        assert isinstance(route.get("anti_patterns"), list) and route["anti_patterns"]
        assert isinstance(route.get("expected_effect"), str) and route["expected_effect"].strip()
        steps = route.get("steps") or []
        assert steps
        for step in steps:
            assert isinstance(step.get("authoring_checklist"), list) and step["authoring_checklist"]
            assert str(step.get("action_type") or "") in {"use_task_type_progression", "add_microcards"}


def test_p2_normalizer_drops_broken_refs_and_rewrites_forbidden_fixed_route_step():
    raw = _base_raw_analysis()
    raw.update(
        {
            "learning_chunks": [
                {
                    "id": "chunk_main",
                    "title": "Основной chunk",
                    "chunk_type": "classification",
                    "goal": "Цель",
                    "unit_ids": [1, 999],
                    "route_ids": ["route_1"],
                }
            ],
            "type_progression_suitability": [
                {
                    "task_type": "TEST",
                    "availability": "implemented",
                    "progression_is_fixed": True,
                    "complex_role": "core",
                    "suitability": "high",
                    "priority": "high",
                    "covers_chunk_ids": ["chunk_main", "missing_chunk"],
                    "covers_unit_ids": [1, 999],
                    "why": "Причина",
                    "level_role_map": [{"level": 1, "role": "MCQ"}],
                }
            ],
            "authoring_routes": [
                {
                    "id": "route_1",
                    "title": "Путь",
                    "route_kind": "complex_progression",
                    "target_surface": "complexes",
                    "chunk_ids": ["chunk_main", "missing_chunk"],
                    "unit_ids": [1, 999],
                    "steps": [
                        {
                            "step_id": "route_1_step_1",
                            "action_type": "use_task_type_progression",
                            "task_type": "TEST",
                            "progression_policy": "pick_only_level",
                            "purpose": "Неверный policy для fixed type",
                        }
                    ],
                }
            ],
            "coverage_plan": {
                "unit_targets": [{"unit_id": 999, "must_cover": True}],
                "chunk_targets": [{"chunk_id": "missing_chunk", "route_ids": ["route_1"]}],
            },
            "future_capabilities": [
                {
                    "capability_id": "pair_matching",
                    "status": "planned",
                    "recommended_surface": "microcards",
                    "suitability": "high",
                    "covers_unit_ids": [1, 999],
                    "covers_chunk_ids": ["missing_chunk"],
                    "fallback_now": ["SEQUENCE", "TEST"],
                }
            ],
            "microcards_candidates": [
                {
                    "candidate_id": "mc_keep",
                    "unit_id": 1,
                    "chunk_id": "missing_chunk",
                    "card_type": "pair_match",
                    "priority": "high",
                    "prompt_seed": "seed",
                    "answer_seed": "answer",
                },
                {
                    "candidate_id": "mc_drop",
                    "unit_id": 999,
                    "chunk_id": "chunk_main",
                    "card_type": "fact_recall",
                },
            ],
        }
    )

    normalized = _ensure_analysis_quality(
        raw,
        material="Материал с классификацией и порогом > 5 ммоль/л.",
        fallback_target_language="ru",
    )

    valid_unit_ids = {u["id"] for u in normalized["educational_units"]}
    valid_chunk_ids = {c["id"] for c in normalized["learning_chunks"]}
    valid_route_ids = {r["id"] for r in normalized["authoring_routes"]}

    for chunk in normalized["learning_chunks"]:
        assert set(chunk["unit_ids"]).issubset(valid_unit_ids)
        assert set(chunk.get("route_ids", [])).issubset(valid_route_ids)
    for unit in normalized["educational_units"]:
        assert set(unit["chunk_ids"]).issubset(valid_chunk_ids)

    tps = normalized["type_progression_suitability"][0]
    assert set(tps["covers_unit_ids"]).issubset(valid_unit_ids)
    assert set(tps["covers_chunk_ids"]).issubset(valid_chunk_ids)

    route = normalized["authoring_routes"][0]
    assert set(route["unit_ids"]).issubset(valid_unit_ids)
    assert set(route["chunk_ids"]).issubset(valid_chunk_ids)
    assert route["steps"][0]["progression_policy"] == "full_fixed_progression"

    coverage = normalized["coverage_plan"]
    assert all(t["unit_id"] in valid_unit_ids for t in coverage["unit_targets"])
    assert all(t["chunk_id"] in valid_chunk_ids for t in coverage["chunk_targets"])
    for t in coverage["chunk_targets"]:
        assert set(t["route_ids"]).issubset(valid_route_ids)

    assert normalized["microcards_candidates"]
    for cand in normalized["microcards_candidates"]:
        assert cand["unit_id"] in valid_unit_ids
        assert cand["chunk_id"] in valid_chunk_ids

    warnings_blob = "\n".join(normalized.get("warnings", []))
    assert "dropped" in warnings_blob.lower()
    assert "pick_only_level" in warnings_blob


def test_analysis_result_to_dict_includes_v2_fields():
    ar = AnalysisResult(
        human_summary="s",
        recommendations=[],
        educational_units=[],
        not_recommended=[],
        analysis_schema_version="2.0",
        learning_chunks=[{"id": "chunk_1"}],
        type_progression_suitability=[{"task_type": "TEST"}],
        authoring_routes=[{"id": "route_1"}],
        coverage_plan={"coverage_plan_version": "1.0"},
        future_capabilities=[{"capability_id": "pair_matching"}],
        microcards_candidates=[{"candidate_id": "mc_1"}],
        report_blocks_version="1.0",
        report_blocks=[{"id": "b1"}],
        report_lint={"verbosity_risk": "low", "duplicate_content_signals": 0, "fallback_renderer_recommended": False},
    )

    data = ar.to_dict()
    assert data["analysis_schema_version"] == "2.0"
    assert data["learning_chunks"][0]["id"] == "chunk_1"
    assert data["coverage_plan"]["coverage_plan_version"] == "1.0"
    assert data["report_blocks_version"] == "1.0"
    assert "report_lint" in data


def test_p4_report_blocks_validator_drops_invalid_blocks_and_sets_fallback_flag():
    raw = _base_raw_analysis()
    long_summary = (
        ("Sentence one is intentionally long and repetitive for report lint checks. " * 6)
        + "Sentence two continues the same idea without adding much value. "
        + "Sentence three also repeats the same point. "
        + "Sentence four should be removed by sentence limit."
    )
    raw["report_blocks"] = [
        {"id": "bad_1", "type": "free_markdown", "body": {"text": "unsupported"}},
        {"id": "bad_2", "type": "chunk_card", "body": {"chunk_id": "missing_chunk"}},
        {
            "id": "good_section",
            "type": "section",
            "title": "Material map",
            "refs": {"unit_ids": [1, 999]},
            "lint": {"max_chars": 9999},
            "body": {"summary": long_summary},
        },
    ]

    normalized = _ensure_analysis_quality(
        raw,
        material="Material with categories and thresholds 2024.",
        fallback_target_language="en",
    )

    assert [b["type"] for b in normalized["report_blocks"]] == ["section"]
    section = normalized["report_blocks"][0]
    assert len(section["body"]["summary"]) <= 600
    assert section["body"]["summary"].count(".") <= 3
    assert section["refs"]["unit_ids"] == [1]

    lint = normalized["report_lint"]
    assert lint["fallback_renderer_recommended"] is True
    assert lint["verbosity_risk"] in {"medium", "high"}

    warnings_blob = "\n".join(normalized.get("warnings", []))
    assert "report_blocks validator" in warnings_blob


def test_p4_anti_grafomania_lint_trims_and_dedupes_without_forcing_fallback_on_moderate_noise():
    raw = _base_raw_analysis()
    raw["learning_chunks"] = [
        {
            "id": "chunk_main",
            "title": "Main chunk",
            "chunk_type": "classification",
            "goal": "Cover classification and threshold facts.",
            "unit_ids": [1, 2],
        }
    ]
    raw["authoring_routes"] = [
        {
            "id": "route_1",
            "title": "Main route",
            "route_kind": "complex_progression",
            "target_surface": "complexes",
            "chunk_ids": ["chunk_main"],
            "unit_ids": [1, 2],
            "steps": [
                {
                    "step_id": "route_1_step_1",
                    "action_type": "use_task_type_progression",
                    "task_type": "TEST",
                    "progression_policy": "full_fixed_progression",
                    "purpose": "Use TEST progression for factual grounding.",
                }
            ],
            "effort_estimate": "low",
            "expected_effect": "Fast baseline coverage.",
        }
    ]
    raw["report_blocks"] = [
        {
            "id": "sec_1",
            "type": "section",
            "title": "Intro",
            "refs": {"unit_ids": [1]},
            "body": {"summary": "One. Two. Three. Four."},
        },
        {
            "id": "callout_1",
            "type": "callout",
            "body": {
                "variant": "tip",
                "text": "Keep the route focused on evidence-backed facts.",
                "bullets": ["A", "B", "C", "D"],
            },
        },
        {"id": "chunk_1", "type": "chunk_card", "body": {"chunk_id": "chunk_main"}},
        {"id": "chunk_1_dup", "type": "chunk_card", "body": {"chunk_id": "chunk_main"}},
        {"id": "route_1", "type": "route_card", "body": {"route_id": "route_1"}},
        {"id": "route_1_dup", "type": "route_card", "body": {"route_id": "route_1"}},
    ]

    normalized = _ensure_analysis_quality(
        raw,
        material="Classification material with threshold 5 and date 2024.",
        fallback_target_language="en",
    )

    blocks = normalized["report_blocks"]
    assert [b["type"] for b in blocks] == ["section", "callout", "chunk_card", "route_card"]
    section = blocks[0]
    callout = blocks[1]
    assert section["body"]["summary"] == "One. Two. Three."
    assert len(callout["body"]["bullets"]) == 3

    lint = normalized["report_lint"]
    assert lint["duplicate_content_signals"] >= 3
    assert lint["verbosity_risk"] in {"medium", "high"}
    assert lint["fallback_renderer_recommended"] is False

    warnings_blob = "\n".join(normalized.get("warnings", []))
    assert "anti-grafomania" in warnings_blob
