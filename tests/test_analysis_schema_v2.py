"""
Unit tests for analysis_schema_v2 — T13 coverage plan.

Covers:
- Pure helpers: _s, _i, _b, _append_unique, _uniq_ints, _uniq_strs, _str_list, _norm_id
- _infer_anchors, _norm_anchors, _norm_cognitive_ops
- _normalize_units
- _chunk_type_for_units, _merge_chunk_anchors, _derive_chunks
- _normalize_chunks
- _normalize_future_caps
- _impl_to_availability
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.analysis_schema_v2 import (
    _s, _i, _b, _append_unique, _uniq_ints, _uniq_strs, _str_list, _norm_id,
    _infer_anchors, _norm_anchors, _norm_cognitive_ops, _unit_blob,
    _normalize_units, _chunk_type_for_units, _merge_chunk_anchors,
    _derive_chunks, _normalize_chunks, _reconcile_unit_chunk_links,
    _normalize_future_caps, _impl_to_availability,
    _sort_type_entries, _route_step_default_checklist,
    _route_default_anti_patterns, _route_default_expected_effect,
    _build_progression_route_step, _build_microcards_route_step,
    _route_effort_for_steps, _merge_route_refs_from_sources,
    _manual_route_sort_key, _derive_type_progression,
    _normalize_type_progression, _normalize_routes,
    _normalize_report_lint,
    normalize_analysis_schema_v2,
)


# ═══════════════════════════════════════════════════════════════════
# _s
# ═══════════════════════════════════════════════════════════════════


class TestS:
    def test_string(self):
        assert _s("  hello  ") == "hello"

    def test_none(self):
        assert _s(None) == ""

    def test_none_default(self):
        assert _s(None, "fallback") == "fallback"

    def test_int(self):
        assert _s(42) == "42"


# ═══════════════════════════════════════════════════════════════════
# _i
# ═══════════════════════════════════════════════════════════════════


class TestI:
    def test_int(self):
        assert _i(5) == 5

    def test_string(self):
        assert _i("10") == 10

    def test_invalid(self):
        assert _i("abc") == 0

    def test_default(self):
        assert _i("abc", 99) == 99


# ═══════════════════════════════════════════════════════════════════
# _b
# ═══════════════════════════════════════════════════════════════════


class TestB:
    def test_bool(self):
        assert _b(True) is True
        assert _b(False) is False

    def test_int(self):
        assert _b(1) is True
        assert _b(0) is False

    def test_strings(self):
        assert _b("true") is True
        assert _b("yes") is True
        assert _b("1") is True
        assert _b("false") is False
        assert _b("no") is False
        assert _b("0") is False

    def test_default(self):
        assert _b("maybe", True) is True
        assert _b(None) is False


# ═══════════════════════════════════════════════════════════════════
# _append_unique
# ═══════════════════════════════════════════════════════════════════


class TestAppendUnique:
    def test_appends(self):
        items = []
        _append_unique(items, "hello")
        assert items == ["hello"]

    def test_no_duplicate(self):
        items = ["hello"]
        _append_unique(items, "hello")
        assert items == ["hello"]

    def test_empty_skipped(self):
        items = []
        _append_unique(items, "")
        assert items == []


# ═══════════════════════════════════════════════════════════════════
# _uniq_ints
# ═══════════════════════════════════════════════════════════════════


class TestUniqInts:
    def test_basic(self):
        assert _uniq_ints([1, 2, 3]) == [1, 2, 3]

    def test_dedup(self):
        assert _uniq_ints([1, 2, 2, 3]) == [1, 2, 3]

    def test_with_allowed(self):
        assert _uniq_ints([1, 2, 3], allowed={1, 3}) == [1, 3]

    def test_not_list(self):
        assert _uniq_ints("bad") == []

    def test_invalid_values(self):
        assert _uniq_ints([1, "abc", 3]) == [1, 3]

    def test_string_ints(self):
        assert _uniq_ints(["1", "2"]) == [1, 2]


# ═══════════════════════════════════════════════════════════════════
# _uniq_strs
# ═══════════════════════════════════════════════════════════════════


class TestUniqStrs:
    def test_basic(self):
        assert _uniq_strs(["a", "b"]) == ["a", "b"]

    def test_dedup(self):
        assert _uniq_strs(["a", "a", "b"]) == ["a", "b"]

    def test_with_allowed(self):
        assert _uniq_strs(["a", "b", "c"], allowed={"a", "c"}) == ["a", "c"]

    def test_not_list(self):
        assert _uniq_strs("bad") == []

    def test_empty_filtered(self):
        assert _uniq_strs(["", "  ", "ok"]) == ["ok"]


# ═══════════════════════════════════════════════════════════════════
# _str_list
# ═══════════════════════════════════════════════════════════════════


class TestStrList:
    def test_basic(self):
        assert _str_list(["a", "b"]) == ["a", "b"]

    def test_dedup_case_insensitive(self):
        assert _str_list(["Hello", "hello"]) == ["Hello"]

    def test_max_items(self):
        result = _str_list([f"item{i}" for i in range(20)], max_items=3)
        assert len(result) == 3

    def test_not_list(self):
        assert _str_list("bad") == []

    def test_truncates_long(self):
        long_str = "x" * 500
        result = _str_list([long_str])
        assert len(result[0]) == 300


# ═══════════════════════════════════════════════════════════════════
# _norm_id
# ═══════════════════════════════════════════════════════════════════


class TestNormId:
    def test_basic(self):
        used = set()
        assert _norm_id("my-id", "prefix", 1, used) == "my-id"
        assert "my-id" in used

    def test_sanitizes(self):
        used = set()
        result = _norm_id("hello world!", "p", 1, used)
        assert " " not in result
        assert "!" not in result

    def test_empty_uses_prefix(self):
        used = set()
        result = _norm_id("", "chunk", 3, used)
        assert result == "chunk_3"

    def test_collision_resolved(self):
        used = {"my_id"}
        result = _norm_id("my_id", "p", 1, used)
        assert result != "my_id"
        assert result.startswith("my_id_")


# ═══════════════════════════════════════════════════════════════════
# _infer_anchors
# ═══════════════════════════════════════════════════════════════════


class TestInferAnchors:
    def test_from_title(self):
        unit = {"title": "Cell Biology", "description": "", "evidence": ""}
        anchors = _infer_anchors(unit)
        assert any(a["kind"] == "term" and a["value"] == "Cell Biology" for a in anchors)

    def test_dates_extracted(self):
        unit = {"title": "History", "description": "Founded in 2020", "evidence": ""}
        anchors = _infer_anchors(unit)
        assert any(a["kind"] == "date" and a["value"] == "2020" for a in anchors)

    def test_threshold(self):
        unit = {"title": "Test", "description": ">= 50%", "evidence": ""}
        anchors = _infer_anchors(unit)
        assert any(a["kind"] == "threshold" for a in anchors)

    def test_numbers(self):
        unit = {"title": "Test", "description": "Contains 42 items", "evidence": ""}
        anchors = _infer_anchors(unit)
        assert any(a["kind"] == "number" and a["value"] == "42" for a in anchors)


# ═══════════════════════════════════════════════════════════════════
# _norm_cognitive_ops
# ═══════════════════════════════════════════════════════════════════


class TestNormCognitiveOps:
    def test_valid_ops(self):
        assert _norm_cognitive_ops(["recognize", "recall"], {}) == ["recognize", "recall"]

    def test_filters_invalid(self):
        assert _norm_cognitive_ops(["recognize", "INVALID", "apply"], {}) == ["recognize", "apply"]

    def test_deduplicates(self):
        assert _norm_cognitive_ops(["recall", "Recall", "RECALL"], {}) == ["recall"]

    def test_classification_default(self):
        result = _norm_cognitive_ops(None, {"type": "classification"})
        assert "classify" in result

    def test_process_default(self):
        result = _norm_cognitive_ops([], {"type": "process"})
        assert "sequence" in result

    def test_fact_default(self):
        result = _norm_cognitive_ops([], {"type": "fact"})
        assert result == ["recognize", "recall"]


# ═══════════════════════════════════════════════════════════════════
# _normalize_units
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeUnits:
    def test_basic_unit(self):
        warnings = []
        units = _normalize_units([
            {"id": 1, "title": "Unit 1", "type": "fact", "description": "desc"}
        ], warnings)
        assert len(units) == 1
        assert units[0]["id"] == 1
        assert units[0]["type"] == "fact"

    def test_invalid_type_defaults(self):
        warnings = []
        units = _normalize_units([{"id": 1, "type": "invalid_type"}], warnings)
        assert units[0]["type"] == "fact"

    def test_not_list(self):
        assert _normalize_units("bad", []) == []

    def test_duplicate_ids_resolved(self):
        warnings = []
        units = _normalize_units([
            {"id": 1, "title": "A"},
            {"id": 1, "title": "B"},
        ], warnings)
        ids = [u["id"] for u in units]
        assert len(set(ids)) == len(ids)

    def test_invalid_prereqs_dropped(self):
        warnings = []
        units = _normalize_units([
            {"id": 1, "title": "A", "prerequisite_unit_ids": [999]},
        ], warnings)
        assert units[0]["prerequisite_unit_ids"] == []


# ═══════════════════════════════════════════════════════════════════
# _chunk_type_for_units / _derive_chunks
# ═══════════════════════════════════════════════════════════════════


class TestChunks:
    def test_chunk_type_classification(self):
        unit_by_id = {1: {"type": "classification"}}
        assert _chunk_type_for_units([1], unit_by_id) == "classification"

    def test_chunk_type_process(self):
        unit_by_id = {1: {"type": "process"}}
        assert _chunk_type_for_units([1], unit_by_id) == "process"

    def test_chunk_type_empty(self):
        assert _chunk_type_for_units([], {}) == "other"

    def test_derive_chunks(self):
        units = [
            {"id": 1, "title": "A", "type": "fact", "factual_anchors": []},
            {"id": 2, "title": "B", "type": "fact", "factual_anchors": []},
        ]
        chunks = _derive_chunks(units)
        assert len(chunks) >= 1
        all_unit_ids = set()
        for c in chunks:
            all_unit_ids.update(c["unit_ids"])
        assert all_unit_ids == {1, 2}

    def test_derive_empty(self):
        assert _derive_chunks([]) == []


# ═══════════════════════════════════════════════════════════════════
# _normalize_chunks
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeChunks:
    def test_no_chunks_derives(self):
        units = [{"id": 1, "title": "A", "type": "fact", "factual_anchors": []}]
        warnings = []
        chunks = _normalize_chunks(None, units, warnings)
        assert len(chunks) >= 1

    def test_valid_chunks(self):
        units = [{"id": 1, "title": "U1", "type": "fact", "factual_anchors": []}]
        raw_chunks = [{"id": "c1", "unit_ids": [1], "title": "Chunk 1"}]
        warnings = []
        chunks = _normalize_chunks(raw_chunks, units, warnings)
        assert chunks[0]["id"] == "c1"
        assert chunks[0]["unit_ids"] == [1]

    def test_invalid_unit_ids_dropped(self):
        units = [{"id": 1, "title": "U1", "type": "fact", "factual_anchors": []}]
        raw_chunks = [{"id": "c1", "unit_ids": [1, 999], "title": "Chunk"}]
        warnings = []
        chunks = _normalize_chunks(raw_chunks, units, warnings)
        assert 999 not in chunks[0]["unit_ids"]
        assert len(warnings) >= 1


# ═══════════════════════════════════════════════════════════════════
# _normalize_future_caps
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeFutureCaps:
    def test_basic(self):
        units = [{"id": 1, "chunk_ids": ["c1"]}]
        chunks = [{"id": "c1"}]
        raw = [{"capability_id": "cap1", "display_name": "Cap 1", "covers_unit_ids": [1]}]
        warnings = []
        caps = _normalize_future_caps(raw, units, chunks, warnings)
        assert len(caps) == 1
        assert caps[0]["capability_id"] == "cap1"

    def test_invalid_status_defaults(self):
        units = [{"id": 1, "chunk_ids": []}]
        chunks = []
        raw = [{"capability_id": "c", "status": "INVALID"}]
        warnings = []
        caps = _normalize_future_caps(raw, units, chunks, warnings)
        assert caps[0]["status"] == "planned"

    def test_empty(self):
        assert _normalize_future_caps(None, [], [], []) == []

    def test_deduplicates(self):
        units = [{"id": 1, "chunk_ids": []}]
        raw = [
            {"capability_id": "cap1"},
            {"capability_id": "cap1"},
        ]
        caps = _normalize_future_caps(raw, units, [], [])
        assert len(caps) == 1


# ═══════════════════════════════════════════════════════════════════
# _impl_to_availability
# ═══════════════════════════════════════════════════════════════════


class TestImplToAvailability:
    def test_implemented_complex(self):
        assert _impl_to_availability("implemented_complex_type") == "implemented"

    def test_implemented_microcards(self):
        assert _impl_to_availability("implemented_microcards_mode") == "microcards_only"

    def test_planned(self):
        assert _impl_to_availability("planned") == "planned"

    def test_unsupported(self):
        assert _impl_to_availability("unsupported") == "unsupported"

    def test_default(self):
        assert _impl_to_availability("unknown") == "implemented"

    def test_none(self):
        assert _impl_to_availability(None) == "implemented"


# ═══════════════════════════════════════════════════════════════════
# _sort_type_entries
# ═══════════════════════════════════════════════════════════════════


class TestSortTypeEntries:
    def test_high_priority_first(self):
        entries = [
            {"task_type": "A", "priority": "low", "suitability": "medium"},
            {"task_type": "B", "priority": "high", "suitability": "medium"},
        ]
        result = _sort_type_entries(entries)
        assert result[0]["task_type"] == "B"

    def test_same_priority_sorts_by_suitability(self):
        entries = [
            {"task_type": "A", "priority": "medium", "suitability": "low"},
            {"task_type": "B", "priority": "medium", "suitability": "high"},
        ]
        result = _sort_type_entries(entries)
        assert result[0]["task_type"] == "B"

    def test_empty(self):
        assert _sort_type_entries([]) == []


# ═══════════════════════════════════════════════════════════════════
# _route_step_default_checklist
# ═══════════════════════════════════════════════════════════════════


class TestRouteStepDefaultChecklist:
    def test_use_task_type_basic(self):
        result = _route_step_default_checklist(action_type="use_task_type_progression")
        assert len(result) >= 1
        assert any("grounded" in item.lower() for item in result)

    def test_use_task_type_fixed_progression(self):
        result = _route_step_default_checklist(
            action_type="use_task_type_progression",
            progression_is_fixed=True,
        )
        assert any("fixed progression" in item.lower() for item in result)

    def test_sequence_with_intent(self):
        result = _route_step_default_checklist(
            action_type="use_task_type_progression",
            task_type="SEQUENCE",
            sequence_intent="ordering",
        )
        assert any("ordering" in item.lower() for item in result)

    def test_sequence_without_intent(self):
        result = _route_step_default_checklist(
            action_type="use_task_type_progression",
            task_type="SEQUENCE",
        )
        assert any("intent" in item.lower() for item in result)

    def test_editor_manual_surface(self):
        result = _route_step_default_checklist(
            action_type="use_task_type_progression",
            route_surface="editor_manual",
        )
        assert any("editor" in item.lower() for item in result)

    def test_complexes_surface(self):
        result = _route_step_default_checklist(
            action_type="use_task_type_progression",
            route_surface="complexes",
        )
        assert any("complexes" in item.lower() for item in result)

    def test_add_microcards(self):
        result = _route_step_default_checklist(action_type="add_microcards")
        assert len(result) == 3
        assert any("pair_match" in item.lower() for item in result)

    def test_unknown_action(self):
        result = _route_step_default_checklist(action_type="unknown")
        assert result == []


# ═══════════════════════════════════════════════════════════════════
# _route_default_anti_patterns
# ═══════════════════════════════════════════════════════════════════


class TestRouteDefaultAntiPatterns:
    def test_editor_manual(self):
        route = {"target_surface": "editor_manual", "steps": []}
        result = _route_default_anti_patterns(route)
        assert any("editor" in item.lower() or "author" in item.lower() for item in result)

    def test_complexes(self):
        route = {"target_surface": "complexes", "steps": []}
        result = _route_default_anti_patterns(route)
        assert any("complex" in item.lower() or "duplicate" in item.lower() for item in result)

    def test_mixed(self):
        route = {"target_surface": "mixed", "steps": []}
        result = _route_default_anti_patterns(route)
        assert any("split" in item.lower() or "surfaces" in item.lower() for item in result)

    def test_with_fixed_progression_step(self):
        route = {
            "target_surface": "complexes",
            "steps": [{"action_type": "use_task_type_progression", "progression_policy": "full_fixed_progression"}],
        }
        result = _route_default_anti_patterns(route)
        assert any("fixed progression" in item.lower() for item in result)

    def test_with_microcards_step(self):
        route = {
            "target_surface": "complexes",
            "steps": [{"action_type": "add_microcards"}],
        }
        result = _route_default_anti_patterns(route)
        assert any("pair" in item.lower() or "microcards" in item.lower() for item in result)

    def test_always_includes_unsupported_facts(self):
        route = {"target_surface": "something", "steps": []}
        result = _route_default_anti_patterns(route)
        assert any("unsupported" in item.lower() for item in result)


# ═══════════════════════════════════════════════════════════════════
# _route_default_expected_effect
# ═══════════════════════════════════════════════════════════════════


class TestRouteDefaultExpectedEffect:
    def test_microcards(self):
        result = _route_default_expected_effect({"target_surface": "microcards"})
        assert "repetition" in result.lower()

    def test_editor_manual(self):
        result = _route_default_expected_effect({"target_surface": "editor_manual"})
        assert "editor" in result.lower()

    def test_mixed(self):
        result = _route_default_expected_effect({"target_surface": "mixed"})
        assert "combines" in result.lower() or "reinforced" in result.lower()

    def test_with_chunks_and_units(self):
        result = _route_default_expected_effect({"chunk_ids": ["c1", "c2"], "unit_ids": [1]})
        assert "chunk" in result.lower() or "unit" in result.lower()

    def test_default(self):
        result = _route_default_expected_effect({})
        assert "route" in result.lower() or "plan" in result.lower()


# ═══════════════════════════════════════════════════════════════════
# _build_progression_route_step / _build_microcards_route_step
# ═══════════════════════════════════════════════════════════════════


class TestBuildRouteSteps:
    def test_progression_step_basic(self):
        entry = {"task_type": "TEST", "why": "good for practice"}
        step = _build_progression_route_step("r1", 0, entry, route_surface="complexes")
        assert step["step_id"] == "r1_step_0"
        assert step["action_type"] == "use_task_type_progression"
        assert step["task_type"] == "TEST"

    def test_progression_step_sequence_intent(self):
        entry = {"task_type": "SEQUENCE", "sequence_intents": ["ordering"]}
        step = _build_progression_route_step("r1", 1, entry, route_surface="complexes")
        assert step.get("sequence_intent") == "ordering"

    def test_progression_step_fixed(self):
        entry = {"task_type": "CLICK", "progression_is_fixed": True}
        step = _build_progression_route_step("r1", 0, entry, route_surface="complexes")
        assert step["progression_policy"] == "full_fixed_progression"

    def test_progression_step_not_fixed(self):
        entry = {"task_type": "CLICK", "progression_is_fixed": False}
        step = _build_progression_route_step("r1", 0, entry, route_surface="complexes")
        assert step["progression_policy"] == "not_fixed"

    def test_microcards_step(self):
        step = _build_microcards_route_step("r1", 2, purpose="Add pair cards")
        assert step["step_id"] == "r1_step_2"
        assert step["action_type"] == "add_microcards"
        assert step["microcard_mode"] == "pair_match"


# ═══════════════════════════════════════════════════════════════════
# _route_effort_for_steps
# ═══════════════════════════════════════════════════════════════════


class TestRouteEffortForSteps:
    def test_mixed_high(self):
        assert _route_effort_for_steps([{}, {}], surface="mixed") == "high"

    def test_mixed_medium(self):
        assert _route_effort_for_steps([{}], surface="mixed") == "medium"

    def test_editor_manual_two(self):
        assert _route_effort_for_steps([{}, {}], surface="editor_manual") == "medium"

    def test_editor_manual_one(self):
        assert _route_effort_for_steps([{}], surface="editor_manual") == "low"

    def test_microcards(self):
        assert _route_effort_for_steps([{}, {}, {}], surface="microcards") == "low"

    def test_default_few(self):
        assert _route_effort_for_steps([{}, {}], surface="complexes") == "medium"

    def test_default_many(self):
        assert _route_effort_for_steps([{}, {}, {}], surface="complexes") == "high"


# ═══════════════════════════════════════════════════════════════════
# _merge_route_refs_from_sources
# ═══════════════════════════════════════════════════════════════════


class TestMergeRouteRefsFromSources:
    def test_basic(self):
        cids, uids = _merge_route_refs_from_sources(
            {"covers_chunk_ids": ["c1", "c2"], "covers_unit_ids": [1, 2]},
            {"covers_chunk_ids": ["c2", "c3"], "covers_unit_ids": [2, 3]},
        )
        assert cids == ["c1", "c2", "c3"]
        assert uids == [1, 2, 3]

    def test_empty(self):
        cids, uids = _merge_route_refs_from_sources()
        assert cids == []
        assert uids == []

    def test_non_dict_ignored(self):
        cids, uids = _merge_route_refs_from_sources(None, "bad", 42)
        assert cids == []
        assert uids == []


# ═══════════════════════════════════════════════════════════════════
# _manual_route_sort_key
# ═══════════════════════════════════════════════════════════════════


class TestManualRouteSortKey:
    def test_open_answer_first(self):
        entries = [
            {"task_type": "CLICK", "priority": "high", "suitability": "high"},
            {"task_type": "OPEN_ANSWER", "priority": "high", "suitability": "high"},
        ]
        sorted_entries = sorted(entries, key=_manual_route_sort_key)
        assert sorted_entries[0]["task_type"] == "OPEN_ANSWER"

    def test_priority_dominates(self):
        entries = [
            {"task_type": "OPEN_ANSWER", "priority": "low", "suitability": "high"},
            {"task_type": "DRAW", "priority": "high", "suitability": "high"},
        ]
        sorted_entries = sorted(entries, key=_manual_route_sort_key)
        assert sorted_entries[0]["task_type"] == "DRAW"


# ═══════════════════════════════════════════════════════════════════
# _derive_type_progression
# ═══════════════════════════════════════════════════════════════════


class TestDeriveTypeProgression:
    def test_basic(self):
        units = [
            {"id": 1, "type": "factual", "chunk_ids": ["c1"], "cognitive_ops": ["recognize", "recall"]},
        ]
        data = {
            "recommendations": [
                {"task_type": "TEST", "covers_units": [1], "priority": "high"},
                {"task_type": "CLICK", "covers_units": [1], "priority": "medium"},
            ]
        }
        result = _derive_type_progression(data, units)
        assert len(result) == 2
        task_types = [e["task_type"] for e in result]
        assert "TEST" in task_types

    def test_empty_recommendations(self):
        result = _derive_type_progression({}, [])
        assert result == []

    def test_sequence_with_intent(self):
        units = [{"id": 1, "type": "classification", "chunk_ids": ["c1"]}]
        data = {
            "recommendations": [
                {"task_type": "SEQUENCE", "covers_units": [1], "sequence_intents": ["ordering"]},
            ]
        }
        result = _derive_type_progression(data, units)
        assert result[0]["sequence_intents"] == ["ordering"]

    def test_level_role_map(self):
        units = [{"id": 1, "chunk_ids": ["c1"]}]
        data = {
            "recommendations": [
                {"task_type": "TEST", "covers_units": [1], "level_role_map": [{"level": 1, "role": "intro"}]},
            ]
        }
        result = _derive_type_progression(data, units)
        assert len(result[0]["level_role_map"]) == 1


# ═══════════════════════════════════════════════════════════════════
# _normalize_type_progression
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeTypeProgression:
    def _units_and_chunks(self):
        units = [{"id": 1, "type": "factual", "chunk_ids": ["c1"], "cognitive_ops": ["recognize"]}]
        chunks = [{"id": "c1", "unit_ids": [1]}]
        return units, chunks

    def test_with_raw(self):
        units, chunks = self._units_and_chunks()
        raw = [{
            "task_type": "TEST",
            "availability": "implemented",
            "suitability": "high",
            "priority": "high",
            "covers_unit_ids": [1],
            "covers_chunk_ids": ["c1"],
        }]
        warnings = []
        result = _normalize_type_progression(raw, {}, units, chunks, warnings)
        assert len(result) == 1
        assert result[0]["task_type"] == "TEST"

    def test_fallback_derives(self):
        units, chunks = self._units_and_chunks()
        warnings = []
        data = {"recommendations": [{"task_type": "TEST", "covers_units": [1], "priority": "high"}]}
        result = _normalize_type_progression(None, data, units, chunks, warnings)
        assert len(result) >= 1

    def test_invalid_availability_defaults(self):
        units, chunks = self._units_and_chunks()
        raw = [{"task_type": "TEST", "availability": "INVALID"}]
        warnings = []
        result = _normalize_type_progression(raw, {}, units, chunks, warnings)
        assert result[0]["availability"] == "implemented"

    def test_broken_refs_warning(self):
        units, chunks = self._units_and_chunks()
        raw = [{"task_type": "TEST", "covers_unit_ids": [999]}]
        warnings = []
        _normalize_type_progression(raw, {}, units, chunks, warnings)
        assert any("dropped broken refs" in w for w in warnings)


# ═══════════════════════════════════════════════════════════════════
# _normalize_routes
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeRoutes:
    def _fixtures(self):
        units = [{"id": 1, "type": "factual", "chunk_ids": ["c1"], "cognitive_ops": ["recognize"]}]
        chunks = [{"id": "c1", "unit_ids": [1]}]
        type_entries = [{
            "task_type": "TEST",
            "availability": "implemented",
            "suitability": "high",
            "priority": "high",
            "covers_unit_ids": [1],
            "covers_chunk_ids": ["c1"],
        }]
        return units, chunks, type_entries

    def test_derives_when_none(self):
        units, chunks, te = self._fixtures()
        warnings = []
        result = _normalize_routes(None, te, [], units, chunks, warnings)
        assert isinstance(result, list)

    def test_with_raw_routes(self):
        units, chunks, te = self._fixtures()
        raw = [{
            "id": "route_1",
            "target_surface": "complexes",
            "chunk_ids": ["c1"],
            "unit_ids": [1],
            "steps": [{"step_id": "s1", "action_type": "use_task_type_progression", "task_type": "TEST"}],
        }]
        warnings = []
        result = _normalize_routes(raw, te, [], units, chunks, warnings)
        assert len(result) >= 1
        assert result[0]["id"] == "route_1"


# ═══════════════════════════════════════════════════════════════════
# _normalize_report_lint
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeReportLint:
    def test_empty(self):
        result = _normalize_report_lint(None)
        assert result["verbosity_risk"] == "low"
        assert result["duplicate_content_signals"] == 0
        assert result["fallback_renderer_recommended"] is False

    def test_merge_computed(self):
        result = _normalize_report_lint(
            {"verbosity_risk": "low"},
            computed={"verbosity_risk": "high", "duplicate_content_signals": 5},
        )
        assert result["verbosity_risk"] == "high"
        assert result["duplicate_content_signals"] == 5

    def test_fallback_recommended(self):
        result = _normalize_report_lint(
            {"fallback_renderer_recommended": True},
        )
        assert result["fallback_renderer_recommended"] is True

    def test_invalid_risk_defaults(self):
        result = _normalize_report_lint({"verbosity_risk": "INVALID"})
        assert result["verbosity_risk"] == "low"


# ═══════════════════════════════════════════════════════════════════
# normalize_analysis_schema_v2  (integration)
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeAnalysisSchemaV2:
    def test_minimal_input(self):
        result = normalize_analysis_schema_v2({})
        assert "analysis_schema_version" in result
        assert isinstance(result["educational_units"], list)
        assert isinstance(result["learning_chunks"], list)
        assert isinstance(result["warnings"], list)

    def test_with_units(self):
        data = {
            "educational_units": [
                {"title": "Unit A", "description": "desc", "type": "factual"},
            ],
        }
        result = normalize_analysis_schema_v2(data)
        assert len(result["educational_units"]) == 1
        assert result["educational_units"][0]["title"] == "Unit A"

    def test_material_volume_auto(self):
        result = normalize_analysis_schema_v2({}, material="short text")
        assert result["material_volume"] in {"small", "medium", "large"}

    def test_material_volume_large(self):
        result = normalize_analysis_schema_v2({}, material=" ".join(["word"] * 1500))
        assert result["material_volume"] == "large"

    def test_target_language(self):
        result = normalize_analysis_schema_v2({"target_language": "ru"})
        assert result["target_language"] == "ru"

    def test_invalid_language_defaults(self):
        result = normalize_analysis_schema_v2({"target_language": "!!!"})
        assert result["target_language"] == "unknown"

    def test_illustrations(self):
        result = normalize_analysis_schema_v2({"illustrations_detected": True, "illustrations_note": "Has diagrams"})
        assert result["illustrations_detected"] is True
        assert result["illustrations_note"] == "Has diagrams"

    def test_preserves_warnings(self):
        result = normalize_analysis_schema_v2({"warnings": ["existing warning"]})
        assert "existing warning" in result["warnings"]

    def test_report_lint_present(self):
        result = normalize_analysis_schema_v2({})
        assert "report_lint" in result
        assert "verbosity_risk" in result["report_lint"]
