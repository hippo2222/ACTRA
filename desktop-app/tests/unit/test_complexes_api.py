import pytest

from api.complexes_api import (
    validate_and_normalize_create_payload,
    validate_and_normalize_theory_link,
)


def test_validate_and_normalize_ok():
    payload = {
        "name": "Комплекс 1",
        "description": "",
        "tasks": [
            "module_01/topic_01/task_001",
            "module_01/topic_01/task_002",
        ],
        "chains": [
            ["module_01/topic_01/task_001", "module_01/topic_01/task_002"],
        ],
        "settings": {"adaptive_difficulty": True},
        "theory_link": {"theory_id": "th_abc123", "relation": "link"},
    }

    normalized, errors = validate_and_normalize_create_payload(payload)
    assert errors == []
    assert normalized is not None
    assert normalized["name"] == "Комплекс 1"
    assert normalized["tasks"] == [
        "module_01/topic_01/task_001",
        "module_01/topic_01/task_002",
    ]
    assert normalized["chains"] == [[
        "module_01/topic_01/task_001",
        "module_01/topic_01/task_002",
    ]]
    assert normalized["theory_link"] == {
        "source_kind": "workspace",
        "theory_id": "th_abc123",
        "relation": "link",
    }
    assert normalized["theory_mode"] == "override"


def test_validate_and_normalize_theory_link_copy_relation():
    payload = {
        "name": "X",
        "tasks": ["module_01/topic_01/task_001"],
        "theory_link": {"theory_id": "th_copy_01", "relation": "copy"},
    }

    normalized, errors = validate_and_normalize_create_payload(payload)
    assert errors == []
    assert normalized is not None
    assert normalized["theory_link"] == {
        "source_kind": "workspace",
        "theory_id": "th_copy_01",
        "relation": "copy",
    }
    assert normalized["theory_mode"] == "override"


def test_validate_and_normalize_linked_library_theory_link_for_complexes():
    payload = {
        "name": "Linked theory complex",
        "tasks": ["module_01/topic_01/task_001"],
        "theory_link": {
            "source_kind": "linked_library",
            "library_entry_id": "thlib_123",
            "relation": "link",
            "title_cache": "Catalog theory",
            "catalog_item_id": "item_123",
            "source_theory_id": "th_remote",
        },
    }

    normalized, errors = validate_and_normalize_create_payload(payload)
    assert errors == []
    assert normalized is not None
    assert normalized["theory_link"] == {
        "source_kind": "linked_library",
        "library_entry_id": "thlib_123",
        "relation": "link",
        "title_cache": "Catalog theory",
        "catalog_item_id": "item_123",
        "source_theory_id": "th_remote",
    }
    assert normalized["theory_mode"] == "override"


def test_validate_and_normalize_theory_link_rejects_linked_library_when_not_allowed():
    normalized, error = validate_and_normalize_theory_link(
        {
            "source_kind": "linked_library",
            "library_entry_id": "thlib_123",
            "relation": "link",
        },
        allow_linked_library=False,
    )
    assert normalized is None
    assert error == "linked_theory_link_not_supported"


def test_validate_and_normalize_default_theory_mode_inherit_without_theory_link():
    payload = {
        "name": "X",
        "tasks": ["module_01/topic_01/task_001"],
    }
    normalized, errors = validate_and_normalize_create_payload(payload)
    assert errors == []
    assert normalized is not None
    assert normalized["theory_mode"] == "inherit"


def test_validate_and_normalize_rejects_invalid_theory_mode():
    payload = {
        "name": "X",
        "tasks": ["module_01/topic_01/task_001"],
        "theory_mode": "broken_mode",
    }
    normalized, errors = validate_and_normalize_create_payload(payload)
    assert normalized is None
    assert any(e["field"] == "theory_mode" for e in errors)


def test_validate_and_normalize_requires_name_and_tasks():
    payload = {"name": "", "tasks": []}
    normalized, errors = validate_and_normalize_create_payload(payload)
    assert normalized is None
    reasons = {e["reason"] for e in errors}
    assert "name_required" in reasons
    assert "tasks_required" in reasons


def test_validate_and_normalize_duplicate_tasks_error():
    payload = {
        "name": "X",
        "tasks": [
            "module_01/topic_01/task_001",
            "module_01/topic_01/task_001",
        ],
    }

    normalized, errors = validate_and_normalize_create_payload(payload)
    assert normalized is None
    assert any(e["reason"] == "duplicate_task" for e in errors)


def test_validate_and_normalize_chain_task_not_in_tasks():
    payload = {
        "name": "X",
        "tasks": ["module_01/topic_01/task_001"],
        "chains": [["module_01/topic_01/task_001", "module_01/topic_01/task_999"]],
    }

    normalized, errors = validate_and_normalize_create_payload(payload)
    assert normalized is None
    assert any(e["reason"] == "chain_task_not_in_tasks" for e in errors)


def test_validate_and_normalize_task_in_multiple_chains_error():
    payload = {
        "name": "X",
        "tasks": [
            "module_01/topic_01/task_001",
            "module_01/topic_01/task_002",
            "module_01/topic_01/task_003",
        ],
        "chains": [
            ["module_01/topic_01/task_001", "module_01/topic_01/task_002"],
            ["module_01/topic_01/task_002", "module_01/topic_01/task_003"],
        ],
    }

    normalized, errors = validate_and_normalize_create_payload(payload)
    assert normalized is None
    assert any(e["reason"] == "task_in_multiple_chains" for e in errors)


@pytest.mark.parametrize(
    "bad_ref",
    [
        "just_two/parts",
        "module/topic/",
        " module/topic/task_001",
        "module/topic/task 001",
        123,
        None,
    ],
)
def test_validate_and_normalize_task_ref_format_errors(bad_ref):
    payload = {"name": "X", "tasks": [bad_ref]}
    normalized, errors = validate_and_normalize_create_payload(payload)
    assert normalized is None
    assert any(
        e["reason"] in {"task_ref_must_be_string", "task_ref_invalid_format", "task_ref_must_not_contain_whitespace"}
        for e in errors
    )


def test_validate_and_normalize_theory_link_invalid():
    payload = {
        "name": "X",
        "tasks": ["module_01/topic_01/task_001"],
        "theory_link": {"theory_id": "", "relation": "wrong"},
    }
    normalized, errors = validate_and_normalize_create_payload(payload)
    assert normalized is None
    assert any(e["field"] == "theory_link" for e in errors)


def test_validate_and_normalize_test_question_display_modes():
    payload = {
        "name": "X",
        "tasks": [
            "module_01/topic_01/test_001",
            "module_01/topic_01/test_002",
        ],
        "settings": {
            "test_question_display_modes": {
                "module_01/topic_01/test_001": "scattered",
                "module_01/topic_01/test_002": "together",
            }
        },
    }

    normalized, errors = validate_and_normalize_create_payload(payload)

    assert errors == []
    assert normalized is not None
    assert normalized["settings"]["test_question_display_modes"] == {
        "module_01/topic_01/test_001": "scattered",
    }


def test_validate_and_normalize_rejects_bad_test_question_display_mode():
    payload = {
        "name": "X",
        "tasks": ["module_01/topic_01/test_001"],
        "settings": {
            "test_question_display_modes": {
                "module_01/topic_01/test_001": "random",
                "module_01/topic_01/missing": "scattered",
            }
        },
    }

    normalized, errors = validate_and_normalize_create_payload(payload)

    assert normalized is None
    reasons = {e["reason"] for e in errors}
    assert "invalid_display_mode" in reasons
    assert "task_not_in_tasks" in reasons


def test_validate_and_normalize_theory_blocks_ok():
    payload = {
        "name": "Комплекс с блоками теории",
        "tasks": [
            "module_01/topic_01/task_001",
            "module_01/topic_01/task_002",
        ],
        "theory_blocks": {
            "blk_01": {
                "label": "Закон Ома",
                "color": "hsla(0, 65%, 70%, 0.3)",
                "color_border": "hsla(0, 75%, 50%, 1)",
            },
            "blk_02": {
                "label": "Длина волны",
                "color": "hsla(138, 65%, 70%, 0.3)",
            },
        },
        "theory_block_ranges": [
            {
                "block_id": "blk_01",
                "theory_id": "th_basics",
                "line_start": 2,
                "line_end": 5,
            },
            {
                "block_id": "blk_02",
                "theory_id": "th_optics",
                "line_start": 10,
                "line_end": 12,
            },
        ],
        "theory_block_versions": {
            "th_basics": "2026-08-31T10:00:00Z",
        },
        "task_block_mappings": {
            "module_01/topic_01/task_001": ["blk_01"],
            "module_01/topic_01/task_002": ["blk_01", "blk_02"],
        },
    }

    normalized, errors = validate_and_normalize_create_payload(payload)
    assert errors == []
    assert normalized is not None
    assert normalized["theory_blocks"]["blk_01"]["label"] == "Закон Ома"
    assert len(normalized["theory_block_ranges"]) == 2
    assert normalized["theory_block_versions"] == {"th_basics": "2026-08-31T10:00:00Z"}
    assert normalized["task_block_mappings"]["module_01/topic_01/task_001"] == ["blk_01"]


def test_validate_and_normalize_theory_blocks_rejects_invalid_references():
    payload = {
        "name": "Комплекс с ошибками в блоках",
        "tasks": ["module_01/topic_01/task_001"],
        "theory_blocks": {
            "blk_valid": {"label": "Тест", "color": "red"}
        },
        "theory_block_ranges": [
            {
                "block_id": "blk_nonexistent",
                "theory_id": "th_01",
                "line_start": 5,
                "line_end": 2,  # Invalid: line_end < line_start
            }
        ],
        "task_block_mappings": {
            "module_01/topic_01/task_999": ["blk_valid"],  # Task not in tasks
            "module_01/topic_01/task_001": ["blk_unknown"],  # Block not found
        },
    }

    normalized, errors = validate_and_normalize_create_payload(payload)
    assert normalized is None
    reasons = {e["reason"] for e in errors}
    assert "range_block_not_found" in reasons
    assert "invalid_line_end" in reasons
    assert "mapping_task_not_in_tasks" in reasons
    assert "mapping_block_not_found" in reasons


def test_validate_theory_blocks_edge_cases_negative_and_bad_types():
    # Bad types for theory_blocks, ranges, mappings
    payload = {
        "name": "Chaos Types",
        "tasks": ["module_01/topic_01/task_001"],
        "theory_blocks": "not-an-object",
        "theory_block_ranges": "not-an-array",
        "theory_block_versions": 12345,
        "task_block_mappings": ["not-an-object"],
    }
    normalized, errors = validate_and_normalize_create_payload(payload)
    assert normalized is None
    reasons = {e["reason"] for e in errors}
    assert "theory_blocks_must_be_object" in reasons
    assert "theory_block_ranges_must_be_array" in reasons
    assert "theory_block_versions_must_be_object" in reasons
    assert "task_block_mappings_must_be_object" in reasons

    # Negative and string indices
    payload_bad_indices = {
        "name": "Bad indices",
        "tasks": ["module_01/topic_01/task_001"],
        "theory_blocks": {"blk_1": {"label": "L", "color": "C"}},
        "theory_block_ranges": [
            {"block_id": "blk_1", "theory_id": "th_1", "line_start": -5, "line_end": 10},
            {"block_id": "blk_1", "theory_id": "th_1", "line_start": "0", "line_end": "10"},
        ],
    }
    normalized_2, errors_2 = validate_and_normalize_create_payload(payload_bad_indices)
    assert normalized_2 is None
    reasons_2 = {e["reason"] for e in errors_2}
    assert "invalid_line_start" in reasons_2


def test_validate_theory_blocks_cross_theory_and_unicode_and_dedup():
    payload = {
        "name": "Cross Theory Complex 🔬",
        "tasks": [
            "module_01/topic_01/task_001",
            "module_01/topic_01/task_002",
            "module_01/topic_01/task_003",
        ],
        "theory_blocks": {
            "blk_ohm": {
                "label": "⚡ Закон Ома <script>alert(1)</script>",
                "color": "hsla(0, 65%, 70%, 0.35)",
                "color_border": "hsla(0, 75%, 45%, 1)",
            },
            "blk_optics": {
                "label": "🌊 Волны и интерференция 💡",
                "color": "hsla(180, 65%, 70%, 0.35)",
            },
        },
        "theory_block_ranges": [
            {"block_id": "blk_ohm", "theory_id": "th_electro_basics", "line_start": 0, "line_end": 4},
            {"block_id": "blk_ohm", "theory_id": "th_circuit_practice", "line_start": 12, "line_end": 18},
            {"block_id": "blk_optics", "theory_id": "th_optics_advanced", "line_start": 5, "line_end": 9},
        ],
        "theory_block_versions": {
            "th_electro_basics": "2026-08-31T12:00:00Z",
            "th_circuit_practice": "2026-08-31T12:10:00Z",
        },
        "task_block_mappings": {
            # Duplicated block_id in mapping should be deduped cleanly
            "module_01/topic_01/task_001": ["blk_ohm", "blk_ohm"],
            "module_01/topic_01/task_002": ["blk_optics"],
            "module_01/topic_01/task_003": ["blk_ohm", "blk_optics"],
        },
    }

    normalized, errors = validate_and_normalize_create_payload(payload)
    assert errors == []
    assert normalized is not None
    assert normalized["theory_blocks"]["blk_ohm"]["label"] == "⚡ Закон Ома <script>alert(1)</script>"
    assert len(normalized["theory_block_ranges"]) == 3
    # Check deduplication of block IDs in task mappings
    assert normalized["task_block_mappings"]["module_01/topic_01/task_001"] == ["blk_ohm"]
    assert normalized["task_block_mappings"]["module_01/topic_01/task_003"] == ["blk_ohm", "blk_optics"]


