"""
Unit tests for Stage 1 of Sequence Assembly Hierarchy / Classification mode:
- Schema validation (display_mode, color_differentiation, nodes DAG & cycle detection)
- StorageService._normalize_answer_key preservation of hierarchy fields
- DifficultyManager._enhance_sequence_task rules for display_mode='hierarchy' vs 'linear'
- Relational subtree evaluation (Tables 5.1/5.2, duplicate cards, swapped columns/branches, leaf container-groups, Difficulties 1, 2, 3)
"""

import copy
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[2]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
for p in (str(ROOT_DIR), str(DESKTOP_APP_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from task_system.core.schemas.sequence_assembly_schema import SequenceAssemblyTaskSchema
from task_system.types.sequence_assembly_task import (
    SequenceAssemblyTaskEvaluator,
    SequenceAssemblyTaskType,
)
from services.difficulty_manager import DifficultyManager
from services.task_evaluator_service import TaskEvaluatorService


# ---------------------------------------------------------------------------
# Fixtures: Comparative Table 5.1 & Branching Classification Tree
# ---------------------------------------------------------------------------

def _make_table_5_1_task() -> dict:
    """
    Table 5.1: Obstructive Atelectasis vs Pneumothorax
    Tiers (levels):
      - level_1: Заболевание (Condition)
      - level_2: Прозрачность гемиторакса (Hemithorax appearance)
      - level_3: Смещение трахеи и сердца (Trachea & Heart shift)
      - level_4: Положение в фазу выдоха (Exhalation position)
    Note: elem_7 and elem_8 both have text 'Midline' (duplicate semantic value).
    """
    elements = [
        {"id": "elem_1", "text": "Обтурационный ателектаз"},
        {"id": "elem_2", "text": "Пневмоторакс"},
        {"id": "elem_3", "text": "Затемнение (Opacified)"},
        {"id": "elem_4", "text": "Просветление (Lucent)"},
        {"id": "elem_5", "text": "Ипсилатеральное смещение"},
        {"id": "elem_6", "text": "Контралатеральное смещение"},
        {"id": "elem_7", "text": "По средней линии (Midline)"},
        {"id": "elem_8", "text": "По средней линии (Midline)"},
    ]
    levels = [
        {"level_id": "level_1", "level_name": "Заболевание", "blocks": ["elem_1", "elem_2"]},
        {"level_id": "level_2", "level_name": "Прозрачность гемиторакса", "blocks": ["elem_3", "elem_4"]},
        {"level_id": "level_3", "level_name": "Смещение трахеи и сердца", "blocks": ["elem_5", "elem_6"]},
        {"level_id": "level_4", "level_name": "Положение в фазу выдоха", "blocks": ["elem_7", "elem_8"]},
    ]
    nodes = [
        # Column 1: Obstructive Atelectasis
        {"node_id": "c1_r1", "level_id": "level_1", "parent_id": None, "blocks": ["elem_1"]},
        {"node_id": "c1_r2", "level_id": "level_2", "parent_id": "c1_r1", "blocks": ["elem_3"]},
        {"node_id": "c1_r3", "level_id": "level_3", "parent_id": "c1_r2", "blocks": ["elem_5"]},
        {"node_id": "c1_r4", "level_id": "level_4", "parent_id": "c1_r3", "blocks": ["elem_7"]},
        # Column 2: Pneumothorax
        {"node_id": "c2_r1", "level_id": "level_1", "parent_id": None, "blocks": ["elem_2"]},
        {"node_id": "c2_r2", "level_id": "level_2", "parent_id": "c2_r1", "blocks": ["elem_4"]},
        {"node_id": "c2_r3", "level_id": "level_3", "parent_id": "c2_r2", "blocks": ["elem_6"]},
        {"node_id": "c2_r4", "level_id": "level_4", "parent_id": "c2_r3", "blocks": ["elem_8"]},
    ]
    return {
        "type": "sequence_assembly",
        "meta": {"name": "Таблица 5.1", "title": "Таблица 5.1"},
        "content": {
            "prompt": "Классифицируйте признаки ателектаза и пневмоторакса",
            "display_mode": "hierarchy",
            "color_differentiation": True,
            "elements": elements,
            "levels": levels,
            "nodes": nodes,
        },
        "settings": {
            "display_mode": "hierarchy",
            "color_differentiation": True,
            "sequence_within_level_matters": False,
            "level_order_matters": False,
            "shuffle_elements": True,
        },
    }


def _make_branching_tree_task() -> dict:
    """
    3-tier classification tree with leaf container-groups (Вариант Б):
    - level_1: Группа патологий (2 root nodes: b1, b2)
    - level_2: Механизм (b1 -> b1_1, b1_2; b2 -> b2_1, b2_2)
    - level_3: Клинические факторы (leaf container-groups with 2 slots each under b1_1 and b2_1)
    """
    elements = [
        {"id": "e1", "text": "Ателектаз"},
        {"id": "e2", "text": "Плевральный выпот"},
        {"id": "e3", "text": "Обтурационный"},
        {"id": "e4", "text": "Компрессионный"},
        {"id": "e5", "text": "Транссудат"},
        {"id": "e6", "text": "Экссудат"},
        {"id": "e7", "text": "Инородное тело бронха"},
        {"id": "e8", "text": "Слизистая пробка"},
        {"id": "e9", "text": "Сердечная недостаточность"},
        {"id": "e10", "text": "Гипоальбуминемия"},
    ]
    levels = [
        {"level_id": "level_1", "level_name": "Группа патологий", "blocks": ["e1", "e2"]},
        {"level_id": "level_2", "level_name": "Механизм", "blocks": ["e3", "e4", "e5", "e6"]},
        {"level_id": "level_3", "level_name": "Клинические факторы", "blocks": ["e7", "e8", "e9", "e10"]},
    ]
    nodes = [
        # Root 1: Atelectasis
        {"node_id": "b1", "level_id": "level_1", "parent_id": None, "blocks": ["e1"]},
        {"node_id": "b1_1", "level_id": "level_2", "parent_id": "b1", "blocks": ["e3"]},
        {"node_id": "b1_2", "level_id": "level_2", "parent_id": "b1", "blocks": ["e4"]},
        {"node_id": "b1_1_leaf", "level_id": "level_3", "parent_id": "b1_1", "blocks": ["e7", "e8"]},
        # Root 2: Pleural Effusion
        {"node_id": "b2", "level_id": "level_1", "parent_id": None, "blocks": ["e2"]},
        {"node_id": "b2_1", "level_id": "level_2", "parent_id": "b2", "blocks": ["e5"]},
        {"node_id": "b2_2", "level_id": "level_2", "parent_id": "b2", "blocks": ["e6"]},
        {"node_id": "b2_1_leaf", "level_id": "level_3", "parent_id": "b2_1", "blocks": ["e9", "e10"]},
    ]
    return {
        "type": "sequence_assembly",
        "meta": {"title": "Дерево причин"},
        "content": {
            "prompt": "Распределите виды и факторы по ветвям классификации",
            "display_mode": "hierarchy",
            "color_differentiation": True,
            "elements": elements,
            "levels": levels,
            "nodes": nodes,
        },
        "settings": {
            "display_mode": "hierarchy",
            "color_differentiation": True,
            "sequence_within_level_matters": False,
            "level_order_matters": False,
        },
    }


# ---------------------------------------------------------------------------
# 1. Schema & TaskType Validation Tests
# ---------------------------------------------------------------------------

def test_schema_accepts_valid_hierarchy_task():
    task = _make_table_5_1_task()
    errors = SequenceAssemblyTaskSchema.validate(task)
    assert errors == []

    task_type = SequenceAssemblyTaskType()
    assert task_type.validate_task_data(task["content"]) is True


def test_schema_rejects_invalid_display_mode():
    task = _make_table_5_1_task()
    task["content"]["display_mode"] = "invalid_grid"
    errors = SequenceAssemblyTaskSchema.validate(task)
    assert any("display_mode" in err for err in errors)


def test_schema_detects_missing_parent_and_cycles_in_nodes():
    task = _make_table_5_1_task()
    task["content"]["nodes"][1]["parent_id"] = "non_existent_node"
    errors = SequenceAssemblyTaskSchema.validate(task)
    assert any("не существует в nodes" in err for err in errors)

    # Create a cycle: c1_r1 -> c1_r2 -> c1_r1
    task_cycle = _make_table_5_1_task()
    task_cycle["content"]["nodes"][0]["parent_id"] = "c1_r2"
    task_cycle["content"]["nodes"][1]["parent_id"] = "c1_r1"
    cycle_errors = SequenceAssemblyTaskSchema.validate(task_cycle)
    assert any("цикл" in err for err in cycle_errors)


def test_storage_service_and_core_evaluator_hierarchy():
    from services.storage_service import StorageService

    svc = StorageService.__new__(StorageService)
    task = _make_table_5_1_task()
    norm_key = svc._normalize_answer_key(task, task["content"])
    assert norm_key["display_mode"] == "hierarchy"
    assert norm_key["color_differentiation"] is True
    assert len(norm_key["nodes"]) == 8
    assert len(norm_key["levels"]) == 4

    evaluator = SequenceAssemblyTaskEvaluator()
    user_nodes_swapped = [
        {"node_id": "c1_r1", "level_id": "level_1", "parent_id": None, "blocks": ["elem_2"]},
        {"node_id": "c1_r2", "level_id": "level_2", "parent_id": "c1_r1", "blocks": ["elem_4"]},
        {"node_id": "c1_r3", "level_id": "level_3", "parent_id": "c1_r2", "blocks": ["elem_6"]},
        {"node_id": "c1_r4", "level_id": "level_4", "parent_id": "c1_r3", "blocks": ["elem_7"]},
        {"node_id": "c2_r1", "level_id": "level_1", "parent_id": None, "blocks": ["elem_1"]},
        {"node_id": "c2_r2", "level_id": "level_2", "parent_id": "c2_r1", "blocks": ["elem_3"]},
        {"node_id": "c2_r3", "level_id": "level_3", "parent_id": "c2_r2", "blocks": ["elem_5"]},
        {"node_id": "c2_r4", "level_id": "level_4", "parent_id": "c2_r3", "blocks": ["elem_8"]},
    ]
    core_res = evaluator.evaluate(
        {"nodes": user_nodes_swapped},
        {**norm_key, "elements": task["content"]["elements"]},
    )
    assert core_res["success"] is True
    assert core_res["score"] == pytest.approx(100.0)



# ---------------------------------------------------------------------------
# 2. DifficultyManager Rules for Hierarchy vs Linear
# ---------------------------------------------------------------------------

def test_difficulty_manager_hierarchy_vs_linear_levels():
    dm = DifficultyManager.__new__(DifficultyManager)
    base_hierarchy = _make_table_5_1_task()

    # Level 1: both tier labels and block labels shown
    d1 = dm._enhance_sequence_task(copy.deepcopy(base_hierarchy), level=1)
    assert d1["content"]["show_level_labels"] is True
    assert d1["content"]["show_block_labels"] is True
    assert d1["content"]["requires_level_names"] is False
    assert d1["content"]["requires_block_names"] is False

    # Level 2: tier labels hidden (requires_level_names=True), blocks shown
    d2 = dm._enhance_sequence_task(copy.deepcopy(base_hierarchy), level=2)
    assert d2["content"]["show_level_labels"] is False
    assert d2["content"]["show_block_labels"] is True
    assert d2["content"]["requires_level_names"] is True
    assert d2["content"]["requires_block_names"] is False

    # Level 3 in HIERARCHY mode: tier labels VISIBLE as coordinate axis, blocks hidden!
    d3_hier = dm._enhance_sequence_task(copy.deepcopy(base_hierarchy), level=3)
    assert d3_hier["content"]["show_level_labels"] is True
    assert d3_hier["content"]["show_block_labels"] is False
    assert d3_hier["content"]["requires_level_names"] is False
    assert d3_hier["content"]["requires_block_names"] is True

    # Level 3 in LINEAR mode: both tier labels and block labels hidden (no regression)
    base_linear = copy.deepcopy(base_hierarchy)
    base_linear["content"]["display_mode"] = "linear"
    base_linear["settings"]["display_mode"] = "linear"
    d3_lin = dm._enhance_sequence_task(base_linear, level=3)
    assert d3_lin["content"]["show_level_labels"] is False
    assert d3_lin["content"]["show_block_labels"] is False
    assert d3_lin["content"]["requires_level_names"] is True
    assert d3_lin["content"]["requires_block_names"] is True


# ---------------------------------------------------------------------------
# 3. Comparative Table 5.1 Relational Evaluation Tests
# ---------------------------------------------------------------------------

def test_table_5_1_exact_and_duplicate_midline_swap():
    task = _make_table_5_1_task()
    answer_key = copy.deepcopy(task["content"])
    answer_key.update(task["settings"])

    # User swaps elem_7 and elem_8 (both are "По средней линии (Midline)")
    user_nodes = copy.deepcopy(task["content"]["nodes"])
    user_nodes[3]["blocks"] = ["elem_8"]  # c1_r4 gets elem_8 instead of elem_7
    user_nodes[7]["blocks"] = ["elem_7"]  # c2_r4 gets elem_7 instead of elem_8

    service = TaskEvaluatorService()
    res = service.evaluate_sequence_task(
        user_input={"levels": task["content"]["levels"], "nodes": user_nodes},
        answer_key=answer_key,
        task_data=task,
    )
    assert res.success is True
    assert res.score == pytest.approx(100.0)
    assert len(res.details["correct_nodes"]) == 8
    assert res.details["incorrect_nodes"] == []
    assert res.details["message_key"] == "player.sequence.hierarchy_eval_perfect"


def test_table_5_1_swapped_columns_when_level_order_matters_false():
    task = _make_table_5_1_task()
    answer_key = copy.deepcopy(task["content"])
    answer_key.update(task["settings"])

    # User puts Pneumothorax in Column 1 (left) and Obstructive Atelectasis in Column 2 (right)
    user_nodes = [
        # Left skeleton column filled with Pneumothorax data
        {"node_id": "c1_r1", "level_id": "level_1", "parent_id": None, "blocks": ["elem_2"]},
        {"node_id": "c1_r2", "level_id": "level_2", "parent_id": "c1_r1", "blocks": ["elem_4"]},
        {"node_id": "c1_r3", "level_id": "level_3", "parent_id": "c1_r2", "blocks": ["elem_6"]},
        {"node_id": "c1_r4", "level_id": "level_4", "parent_id": "c1_r3", "blocks": ["elem_7"]},
        # Right skeleton column filled with Obstructive Atelectasis data
        {"node_id": "c2_r1", "level_id": "level_1", "parent_id": None, "blocks": ["elem_1"]},
        {"node_id": "c2_r2", "level_id": "level_2", "parent_id": "c2_r1", "blocks": ["elem_3"]},
        {"node_id": "c2_r3", "level_id": "level_3", "parent_id": "c2_r2", "blocks": ["elem_5"]},
        {"node_id": "c2_r4", "level_id": "level_4", "parent_id": "c2_r3", "blocks": ["elem_8"]},
    ]

    service = TaskEvaluatorService()
    res = service.evaluate_sequence_task(
        user_input={"levels": task["content"]["levels"], "nodes": user_nodes},
        answer_key=answer_key,
        task_data=task,
    )
    assert res.success is True
    assert res.score == pytest.approx(100.0)
    assert res.details["node_mapping"]["c1_r1"] == "c2_r1"
    assert res.details["node_mapping"]["c2_r1"] == "c1_r1"

    # Now verify that if level_order_matters=True, swapping columns is rejected
    task_strict = copy.deepcopy(task)
    task_strict["settings"]["level_order_matters"] = True
    answer_key_strict = copy.deepcopy(answer_key)
    answer_key_strict["level_order_matters"] = True
    res_strict = service.evaluate_sequence_task(
        user_input={"levels": task_strict["content"]["levels"], "nodes": user_nodes},
        answer_key=answer_key_strict,
        task_data=task_strict,
    )
    assert res_strict.success is False
    # Only the 2 Midline cells match when columns are strictly locked
    assert res_strict.score == pytest.approx(25.0)


def test_table_5_1_partial_error_crossed_features():
    task = _make_table_5_1_task()
    answer_key = copy.deepcopy(task["content"])
    answer_key.update(task["settings"])

    # User swaps only row 3 (Trachea & Heart shift) between the two columns
    user_nodes = copy.deepcopy(task["content"]["nodes"])
    user_nodes[2]["blocks"] = ["elem_6"]  # c1_r3 gets Contralateral instead of Ipsilateral
    user_nodes[6]["blocks"] = ["elem_5"]  # c2_r3 gets Ipsilateral instead of Contralateral

    service = TaskEvaluatorService()
    res = service.evaluate_sequence_task(
        user_input={"levels": task["content"]["levels"], "nodes": user_nodes},
        answer_key=answer_key,
        task_data=task,
    )
    assert res.success is False
    assert res.score == pytest.approx(75.0)  # 6 of 8 correct
    assert set(res.details["incorrect_nodes"]) == {"c1_r3", "c2_r3"}
    assert "level_3" in res.details["incorrect_levels"]
    assert set(res.details["correct_levels"]) == {"level_1", "level_2", "level_4"}


# ---------------------------------------------------------------------------
# 4. Branching Classification Tree & Leaf Container-Groups (Вариант Б)
# ---------------------------------------------------------------------------

def test_branching_tree_swapped_branches_and_leaf_container_group():
    task = _make_branching_tree_task()
    answer_key = copy.deepcopy(task["content"])
    answer_key.update(task["settings"])

    # User swaps the two main branches (b1 <-> b2) AND reverses block order inside leaf groups
    user_nodes = [
        # Put Pleural Effusion in b1 (left branch)
        {"node_id": "b1", "level_id": "level_1", "parent_id": None, "blocks": ["e2"]},
        # Also swap child order under b1: Exudate in b1_1 ( Wait: Exudate has no leaf, Transudate has leaf!
        # In the skeleton, b1_1 has child b1_1_leaf, so user puts Transudate (e5) in b1_1 and its factors reversed in b1_1_leaf)
        {"node_id": "b1_1", "level_id": "level_2", "parent_id": "b1", "blocks": ["e5"]},
        {"node_id": "b1_2", "level_id": "level_2", "parent_id": "b1", "blocks": ["e6"]},
        {"node_id": "b1_1_leaf", "level_id": "level_3", "parent_id": "b1_1", "blocks": ["e10", "e9"]},
        # Put Atelectasis in b2 (right branch)
        {"node_id": "b2", "level_id": "level_1", "parent_id": None, "blocks": ["e1"]},
        {"node_id": "b2_1", "level_id": "level_2", "parent_id": "b2", "blocks": ["e3"]},
        {"node_id": "b2_2", "level_id": "level_2", "parent_id": "b2", "blocks": ["e4"]},
        {"node_id": "b2_1_leaf", "level_id": "level_3", "parent_id": "b2_1", "blocks": ["e8", "e7"]},
    ]

    service = TaskEvaluatorService()
    res = service.evaluate_sequence_task(
        user_input={"levels": task["content"]["levels"], "nodes": user_nodes},
        answer_key=answer_key,
        task_data=task,
    )
    assert res.success is True
    assert res.score == pytest.approx(100.0)
    assert len(res.details["correct_nodes"]) == 8


# ---------------------------------------------------------------------------
# 5. Difficulty 2 & Difficulty 3 Evaluation in Hierarchy Mode
# ---------------------------------------------------------------------------

def test_hierarchy_difficulty_2_blocks_and_tier_names():
    dm = DifficultyManager.__new__(DifficultyManager)
    task = dm._enhance_sequence_task(_make_table_5_1_task(), level=2)
    answer_key = copy.deepcopy(task["content"])
    answer_key.update(task["settings"])

    user_nodes = copy.deepcopy(task["content"]["nodes"])
    # User provides 3 of 4 correct tier names (with a minor case/yo difference) and 1 wrong tier name
    user_levels = [
        {"level_id": "level_1", "level_name": "заболевание", "blocks": []},
        {"level_id": "level_2", "level_name": "Прозрачность гемиторакса", "blocks": []},
        {"level_id": "level_3", "level_name": "Смещение трахеи и сердца", "blocks": []},
        {"level_id": "level_4", "level_name": "Неверное название", "blocks": []},
    ]

    service = TaskEvaluatorService()
    res = service.evaluate_sequence_task(
        user_input={"levels": user_levels, "nodes": user_nodes},
        answer_key=answer_key,
        task_data=task,
    )
    assert res.success is False
    # 100% of blocks (70 pts) + 75% of tier names (22.5 pts) = 92.5
    assert res.score == pytest.approx(92.5)
    assert res.details["level"] == 2


def test_hierarchy_difficulty_3_blind_skeleton_with_tolerance_and_swapped_branches():
    dm = DifficultyManager.__new__(DifficultyManager)
    task = dm._enhance_sequence_task(_make_branching_tree_task(), level=3)
    answer_key = copy.deepcopy(task["content"])
    answer_key.update(task["settings"])

    # On Difficulty 3, tier names are visible (requires_level_names=False),
    # and user types block names from memory into the skeleton nodes (including a minor typo).
    user_nodes = [
        {"node_id": "b1", "level_id": "level_1", "parent_id": None, "blocks": ["s1"], "block_names": {"s1": "Ателектаз"}},
        {"node_id": "b1_1", "level_id": "level_2", "parent_id": "b1", "blocks": ["s2"], "block_names": {"s2": "Обтурационный"}},
        {"node_id": "b1_2", "level_id": "level_2", "parent_id": "b1", "blocks": ["s3"], "block_names": {"s3": "Компрессионный"}},
        {
            "node_id": "b1_1_leaf",
            "level_id": "level_3",
            "parent_id": "b1_1",
            "blocks": ["s4", "s5"],
            # Reversed order inside leaf group + lowercase
            "block_names": {"s4": "слизистая пробка", "s5": "инородное тело бронха"},
        },
        {"node_id": "b2", "level_id": "level_1", "parent_id": None, "blocks": ["s6"], "block_names": {"s6": "Плевральный выпот"}},
        {"node_id": "b2_1", "level_id": "level_2", "parent_id": "b2", "blocks": ["s7"], "block_names": {"s7": "Транссудат"}},
        {"node_id": "b2_2", "level_id": "level_2", "parent_id": "b2", "blocks": ["s8"], "block_names": {"s8": "Экссудат"}},
        {
            "node_id": "b2_1_leaf",
            "level_id": "level_3",
            "parent_id": "b2_1",
            "blocks": ["s9", "s10"],
            "block_names": {"s9": "Сердечная недостаточность", "s10": "Гипоальбуминемия"},
        },
    ]

    service = TaskEvaluatorService()
    res = service.evaluate_sequence_task(
        user_input={"levels": task["content"]["levels"], "nodes": user_nodes},
        answer_key=answer_key,
        task_data=task,
    )
    assert res.success is True
    assert res.score == pytest.approx(100.0)
    assert res.details["level"] == 3
    assert len(res.details["correct_nodes"]) == 8
