import pytest

from api.complexes_api import validate_and_normalize_create_payload


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
    assert normalized["theory_link"] == {"theory_id": "th_abc123", "relation": "link"}
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
    assert normalized["theory_link"] == {"theory_id": "th_copy_01", "relation": "copy"}
    assert normalized["theory_mode"] == "override"


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
