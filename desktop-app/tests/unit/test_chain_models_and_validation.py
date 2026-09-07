import pytest
from pydantic import ValidationError

from task_system.core.models.complex_models import Complex, ChainDefinition, ComplexSettings
from api.complexes_api import validate_and_normalize_create_payload
from services.workspace_graph_materialization_service import WorkspaceGraphMaterializationService


def test_chain_definition_defaults_and_validation():
    chain = ChainDefinition(tasks=["m/t/1", "m/t/2"])
    assert chain.tasks == ["m/t/1", "m/t/2"]
    assert chain.shuffle_mode == "never"
    assert chain.shuffle_iterations == []

    # Sequence protocol
    assert len(chain) == 2
    assert chain[0] == "m/t/1"
    assert "m/t/2" in chain
    assert chain.index("m/t/2") == 1
    assert list(chain) == ["m/t/1", "m/t/2"]

    # Allowed modes
    for mode in ["never", "from_iteration_2", "only_iteration_3", "always", "custom"]:
        c = ChainDefinition(tasks=["m/t/1", "m/t/2"], shuffle_mode=mode)
        assert c.shuffle_mode == mode

    # Invalid mode
    with pytest.raises(ValidationError):
        ChainDefinition(tasks=["m/t/1", "m/t/2"], shuffle_mode="unsupported_mode")

    # Custom iterations validation
    c_custom = ChainDefinition(
        tasks=["m/t/1", "m/t/2"],
        shuffle_mode="custom",
        shuffle_iterations=[3, 1, 3, "2", -1, "invalid"],
    )
    assert c_custom.shuffle_iterations == [1, 2, 3]


def test_complex_model_backward_compatibility_with_list_chains():
    complex_data = {
        "id": "c1",
        "name": "Legacy Complex",
        "tasks": ["m/t/1", "m/t/2", "m/t/3"],
        "chains": [["m/t/1", "m/t/2"]],
    }
    obj = Complex(**complex_data)
    assert len(obj.chains) == 1
    assert obj.chains[0] == ["m/t/1", "m/t/2"]
    assert obj.get_raw_task_chains() == [["m/t/1", "m/t/2"]]

    defs = obj.chain_definitions
    assert len(defs) == 1
    assert isinstance(defs[0], ChainDefinition)
    assert defs[0].tasks == ["m/t/1", "m/t/2"]
    assert defs[0].shuffle_mode == "never"


def test_complex_model_with_dict_and_chain_definition():
    complex_data = {
        "id": "c2",
        "name": "New Complex",
        "tasks": ["m/t/1", "m/t/2", "m/t/3", "m/t/4"],
        "chains": [
            {"tasks": ["m/t/1", "m/t/2"], "shuffle_mode": "from_iteration_2"},
            ChainDefinition(tasks=["m/t/3", "m/t/4"], shuffle_mode="always"),
        ],
    }
    obj = Complex(**complex_data)
    assert len(obj.chains) == 2
    assert isinstance(obj.chains[0], ChainDefinition)
    assert obj.chains[0].shuffle_mode == "from_iteration_2"
    assert isinstance(obj.chains[1], ChainDefinition)
    assert obj.chains[1].shuffle_mode == "always"

    assert obj.get_raw_task_chains() == [["m/t/1", "m/t/2"], ["m/t/3", "m/t/4"]]

    # Duplicate task across chains validation
    dup_data = {
        "id": "c_dup",
        "name": "Duplicate Complex",
        "tasks": ["m/t/1", "m/t/2", "m/t/3"],
        "chains": [
            {"tasks": ["m/t/1", "m/t/2"], "shuffle_mode": "never"},
            ["m/t/2", "m/t/3"],
        ],
    }
    with pytest.raises(ValidationError) as exc:
        Complex(**dup_data)
    assert "appears in multiple chains" in str(exc.value)


def test_complexes_api_chain_normalization():
    # 1. Legacy list format passes through
    payload_legacy = {
        "name": "Legacy",
        "tasks": ["m/t/1", "m/t/2"],
        "chains": [["m/t/1", "m/t/2"]],
    }
    norm, errs = validate_and_normalize_create_payload(payload_legacy)
    assert errs == []
    assert norm["chains"] == [["m/t/1", "m/t/2"]]

    # 2. Object format normalized
    payload_obj = {
        "name": "Obj",
        "tasks": ["m/t/1", "m/t/2"],
        "chains": [{"tasks": ["m/t/1", "m/t/2"], "shuffle_mode": "always"}],
    }
    norm, errs = validate_and_normalize_create_payload(payload_obj)
    assert errs == []
    assert norm["chains"] == [{
        "tasks": ["m/t/1", "m/t/2"],
        "shuffle_mode": "always",
        "shuffle_iterations": [],
    }]

    # 3. Invalid shuffle mode rejected
    payload_bad_mode = {
        "name": "Bad",
        "tasks": ["m/t/1", "m/t/2"],
        "chains": [{"tasks": ["m/t/1", "m/t/2"], "shuffle_mode": "super_random"}],
    }
    norm, errs = validate_and_normalize_create_payload(payload_bad_mode)
    assert norm is None
    assert any(e["reason"] == "invalid_chain_shuffle_mode" for e in errs)


def test_complexes_api_chain_shuffle_mode_max_iterations_validation():
    # max_iterations = 1: from_iteration_2 must fail
    payload_iter1 = {
        "name": "Iter 1 Complex",
        "tasks": ["m/t/1", "m/t/2"],
        "settings": {"max_iterations": 1},
        "chains": [{"tasks": ["m/t/1", "m/t/2"], "shuffle_mode": "from_iteration_2"}],
    }
    norm, errs = validate_and_normalize_create_payload(payload_iter1)
    assert norm is None
    assert any(e["reason"] == "shuffle_mode_exceeds_max_iterations" for e in errs)

    # max_iterations = 2: only_iteration_3 must fail, but from_iteration_2 succeeds
    payload_iter2_bad = {
        "name": "Iter 2 Complex Bad",
        "tasks": ["m/t/1", "m/t/2"],
        "settings": {"max_iterations": 2},
        "chains": [{"tasks": ["m/t/1", "m/t/2"], "shuffle_mode": "only_iteration_3"}],
    }
    norm, errs = validate_and_normalize_create_payload(payload_iter2_bad)
    assert norm is None
    assert any(e["reason"] == "shuffle_mode_exceeds_max_iterations" for e in errs)

    payload_iter2_ok = {
        "name": "Iter 2 Complex OK",
        "tasks": ["m/t/1", "m/t/2"],
        "settings": {"max_iterations": 2},
        "chains": [{"tasks": ["m/t/1", "m/t/2"], "shuffle_mode": "from_iteration_2"}],
    }
    norm, errs = validate_and_normalize_create_payload(payload_iter2_ok)
    assert errs == []
    assert norm["chains"][0]["shuffle_mode"] == "from_iteration_2"

    # custom mode with iteration exceeding max_iterations
    payload_custom_exceed = {
        "name": "Custom Exceed",
        "tasks": ["m/t/1", "m/t/2"],
        "settings": {"max_iterations": 3},
        "chains": [{
            "tasks": ["m/t/1", "m/t/2"],
            "shuffle_mode": "custom",
            "shuffle_iterations": [1, 2, 4],
        }],
    }
    norm, errs = validate_and_normalize_create_payload(payload_custom_exceed)
    assert norm is None
    assert any(e["reason"] == "iteration_exceeds_max_iterations" for e in errs)


def test_materialization_service_remap_chains():
    class DummyService:
        pass

    service = WorkspaceGraphMaterializationService.__new__(WorkspaceGraphMaterializationService)
    task_ref_map = {
        "src_mod/src_top/t1": "dst_mod/dst_top/t1",
        "src_mod/src_top/t2": "dst_mod/dst_top/t2",
    }

    # 1. Remap legacy list
    raw_list = [["src_mod/src_top/t1", "src_mod/src_top/t2"]]
    remapped_list = service._remap_chains(raw_list, task_ref_map)
    assert remapped_list == [["dst_mod/dst_top/t1", "dst_mod/dst_top/t2"]]

    # 2. Remap dict format
    raw_dict = [{
        "tasks": ["src_mod/src_top/t1", "src_mod/src_top/t2"],
        "shuffle_mode": "from_iteration_2",
        "shuffle_iterations": [2],
    }]
    remapped_dict = service._remap_chains(raw_dict, task_ref_map)
    assert remapped_dict == [{
        "tasks": ["dst_mod/dst_top/t1", "dst_mod/dst_top/t2"],
        "shuffle_mode": "from_iteration_2",
        "shuffle_iterations": [2],
    }]

    # 3. Missing task ref raises ValueError
    unmapped = [["src_mod/src_top/t1", "src_mod/src_top/unknown"]]
    with pytest.raises(ValueError) as exc:
        service._remap_chains(unmapped, task_ref_map)
    assert "complex_chain_ref_not_materialized:src_mod/src_top/unknown" in str(exc.value)


def test_chain_localization_keys_exist_and_match():
    import json
    import os

    locales_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "assets", "locales")
    expected_keys = [
        "chain_move_up",
        "chain_move_down",
        "chain_shuffle_label",
        "chain_mode_never",
        "chain_mode_from_iter_2",
        "chain_mode_only_iter_3",
        "chain_mode_always",
        "chain_shuffle_tooltip",
    ]

    for lang in ["ru", "en", "uk"]:
        path = os.path.join(locales_dir, f"{lang}.json")
        assert os.path.exists(path), f"Locale file {path} does not exist"
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        create_sec = data.get("create", {})
        for key in expected_keys:
            assert key in create_sec, f"Missing key '{key}' in create section of {lang}.json"
            assert isinstance(create_sec[key], str) and len(create_sec[key].strip()) > 0

