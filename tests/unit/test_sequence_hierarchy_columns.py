"""
Unit tests for Sequence Assembly 2D Column Architecture & Column Title Validation.

Tests:
1. SequenceAssemblyTaskSchema accepts optional column_title on nodes.
2. SequenceAssemblyTaskEvaluator anchors named columns when level_order_matters=False.
3. SequenceAssemblyTaskEvaluator allows free permutation of unnamed columns when level_order_matters=False.
4. TaskEvaluatorService preserves column_title and evaluates comparative tables correctly.
"""

import pytest
from task_system.core.schemas.sequence_assembly_schema import SequenceAssemblyTaskSchema
from task_system.types.sequence_assembly_task import SequenceAssemblyTaskEvaluator
from services.task_evaluator_service import TaskEvaluatorService


class TestSequenceHierarchySchemaColumnTitle:
    """Test schema validation for node column_title."""

    def test_schema_accepts_valid_column_title(self):
        full_task = {
            "type": "sequence_assembly",
            "meta": {"id": "task_1", "name": "Тест"},
            "content": {
                "prompt": "Распределите признаки",
                "elements": [
                    {"id": "e1", "text": "Висцеральная плевра"},
                    {"id": "e2", "text": "Смещение средостения"},
                ],
                "levels": [
                    {"level_id": "lvl_1", "level_name": "Плевра", "blocks": ["e1"]},
                    {"level_id": "lvl_2", "level_name": "Средостение", "blocks": ["e2"]},
                ],
                "display_mode": "hierarchy",
                "nodes": [
                    {
                        "node_id": "node_1",
                        "level_id": "lvl_1",
                        "parent_id": None,
                        "blocks": ["e1"],
                        "column_title": "Пневмоторакс",
                    },
                    {
                        "node_id": "node_2",
                        "level_id": "lvl_2",
                        "parent_id": "node_1",
                        "blocks": ["e2"],
                        "column_title": None,
                    },
                ],
            },
        }
        errors = SequenceAssemblyTaskSchema.validate(full_task)
        assert len(errors) == 0, f"Validation failed with errors: {errors}"

    def test_schema_rejects_non_string_column_title(self):
        full_task = {
            "type": "sequence_assembly",
            "meta": {"id": "task_1", "name": "Тест"},
            "content": {
                "prompt": "Распределите признаки",
                "elements": [
                    {"id": "e1", "text": "Элемент 1"},
                    {"id": "e2", "text": "Элемент 2"},
                ],
                "levels": [
                    {"level_id": "lvl_1", "level_name": "Уровень 1", "blocks": ["e1"]},
                    {"level_id": "lvl_2", "level_name": "Уровень 2", "blocks": ["e2"]},
                ],
                "display_mode": "hierarchy",
                "nodes": [
                    {
                        "node_id": "node_1",
                        "level_id": "lvl_1",
                        "parent_id": None,
                        "blocks": ["e1"],
                        "column_title": 12345,  # Invalid: integer instead of string
                    },
                    {
                        "node_id": "node_2",
                        "level_id": "lvl_2",
                        "parent_id": None,
                        "blocks": ["e2"],
                    },
                ],
            },
        }
        errors = SequenceAssemblyTaskSchema.validate(full_task)
        assert len(errors) > 0
        assert any("column_title: должно быть строкой" in err for err in errors)


class TestSequenceHierarchyEvaluationColumns:
    """Test relational matching with named vs unnamed columns."""

    @pytest.fixture
    def comparative_table_task(self):
        """Table 5.1: Pneumothorax vs Atelectasis (2 columns, 2 tiers)."""
        return {
            "display_mode": "hierarchy",
            "level_order_matters": False,  # Note: branch order is False!
            "sequence_within_level_matters": False,
            "levels": [
                {"level_id": "lvl_pleura", "level_name": "Плевра", "blocks": ["p_line", "a_noline"]},
                {"level_id": "lvl_shift", "level_name": "Сдвиг", "blocks": ["p_shift", "a_shift"]},
            ],
            "elements": [
                {"id": "p_line", "text": "Линия висцеральной плевры видна"},
                {"id": "p_shift", "text": "Сдвиг в здоровую сторону"},
                {"id": "a_noline", "text": "Линия плевры не видна"},
                {"id": "a_shift", "text": "Сдвиг в сторону поражения"},
            ],
            "nodes": [
                # Column 1: Pneumothorax
                {
                    "node_id": "c1_r1",
                    "level_id": "lvl_pleura",
                    "parent_id": None,
                    "blocks": ["p_line"],
                    "column_title": "Пневмоторакс",
                },
                {
                    "node_id": "c1_r2",
                    "level_id": "lvl_shift",
                    "parent_id": "c1_r1",
                    "blocks": ["p_shift"],
                },
                # Column 2: Atelectasis
                {
                    "node_id": "c2_r1",
                    "level_id": "lvl_pleura",
                    "parent_id": None,
                    "blocks": ["a_noline"],
                    "column_title": "Обструктивный ателектаз",
                },
                {
                    "node_id": "c2_r2",
                    "level_id": "lvl_shift",
                    "parent_id": "c2_r1",
                    "blocks": ["a_shift"],
                },
            ],
        }

    def test_named_columns_correct_order_succeeds(self, comparative_table_task):
        evaluator = SequenceAssemblyTaskEvaluator()
        user_input = {
            "display_mode": "hierarchy",
            "nodes": [
                {"node_id": "c1_r1", "level_id": "lvl_pleura", "parent_id": None, "blocks": ["p_line"]},
                {"node_id": "c1_r2", "level_id": "lvl_shift", "parent_id": "c1_r1", "blocks": ["p_shift"]},
                {"node_id": "c2_r1", "level_id": "lvl_pleura", "parent_id": None, "blocks": ["a_noline"]},
                {"node_id": "c2_r2", "level_id": "lvl_shift", "parent_id": "c2_r1", "blocks": ["a_shift"]},
            ],
        }
        res = evaluator.evaluate(user_input, comparative_table_task)
        assert res["success"] is True
        assert res["score"] == 100.0
        assert len(res["details"]["correct_nodes"]) == 4
        assert len(res["details"]["incorrect_nodes"]) == 0

    def test_named_columns_swapped_fails_even_with_level_order_matters_false(self, comparative_table_task):
        """
        Critical pedagogical domain rule:
        Even though level_order_matters=False, the author explicitly titled Column 1 as 'Пневмоторакс'
        and Column 2 as 'Обструктивный ателектаз'. If the student places Atelectasis features under
        'Пневмоторакс', they MUST NOT be matched as an acceptable permutation!
        """
        evaluator = SequenceAssemblyTaskEvaluator()
        # Student put Atelectasis cards into Column 1 ('c1_r1' / 'c1_r2') and Pneumothorax into Column 2
        user_input = {
            "display_mode": "hierarchy",
            "nodes": [
                {"node_id": "c1_r1", "level_id": "lvl_pleura", "parent_id": None, "blocks": ["a_noline"]},
                {"node_id": "c1_r2", "level_id": "lvl_shift", "parent_id": "c1_r1", "blocks": ["a_shift"]},
                {"node_id": "c2_r1", "level_id": "lvl_pleura", "parent_id": None, "blocks": ["p_line"]},
                {"node_id": "c2_r2", "level_id": "lvl_shift", "parent_id": "c2_r1", "blocks": ["p_shift"]},
            ],
        }
        res = evaluator.evaluate(user_input, comparative_table_task)
        assert res["success"] is False
        assert res["score"] == 0.0
        assert len(res["details"]["correct_nodes"]) == 0
        assert len(res["details"]["incorrect_nodes"]) == 4

    def test_unnamed_branches_allow_free_permutation(self):
        """
        When columns do NOT have column_title (unnamed classification tree),
        level_order_matters=False allows free branch swapping.
        """
        unnamed_task = {
            "display_mode": "hierarchy",
            "level_order_matters": False,
            "sequence_within_level_matters": False,
            "levels": [{"level_id": "lvl_1", "level_name": "Категории", "blocks": ["e_left", "e_right"]}],
            "elements": [
                {"id": "e_left", "text": "Левая ветвь"},
                {"id": "e_right", "text": "Правая ветвь"},
            ],
            "nodes": [
                {
                    "node_id": "root_a",
                    "level_id": "lvl_1",
                    "parent_id": None,
                    "blocks": ["e_left"],
                    # No column_title
                },
                {
                    "node_id": "root_b",
                    "level_id": "lvl_1",
                    "parent_id": None,
                    "blocks": ["e_right"],
                    # No column_title
                },
            ],
        }
        evaluator = SequenceAssemblyTaskEvaluator()
        # User swapped root_a and root_b
        user_input = {
            "display_mode": "hierarchy",
            "nodes": [
                {"node_id": "root_a", "level_id": "lvl_1", "parent_id": None, "blocks": ["e_right"]},
                {"node_id": "root_b", "level_id": "lvl_1", "parent_id": None, "blocks": ["e_left"]},
            ],
        }
        res = evaluator.evaluate(user_input, unnamed_task)
        # Because root_a and root_b have no column_title, swapping is permitted
        assert res["success"] is True
        assert res["score"] == 100.0

    def test_task_evaluator_service_evaluates_comparative_table(self, comparative_table_task):
        svc = TaskEvaluatorService()
        user_input = {
            "display_mode": "hierarchy",
            "nodes": [
                {"node_id": "c1_r1", "level_id": "lvl_pleura", "parent_id": None, "blocks": ["p_line"]},
                {"node_id": "c1_r2", "level_id": "lvl_shift", "parent_id": "c1_r1", "blocks": ["p_shift"]},
                {"node_id": "c2_r1", "level_id": "lvl_pleura", "parent_id": None, "blocks": ["a_noline"]},
                {"node_id": "c2_r2", "level_id": "lvl_shift", "parent_id": "c2_r1", "blocks": ["a_shift"]},
            ],
        }
        result = svc.evaluate_sequence_task(
            user_input=user_input,
            answer_key=comparative_table_task,
            task_data={"content": comparative_table_task},
        )
        assert result.success is True
        assert result.score == 100.0
        assert "correct_nodes_data" in result.details
        ref_nodes = result.details["correct_nodes_data"]
        assert len(ref_nodes) == 4
        assert ref_nodes[0].get("column_title") == "Пневмоторакс"
        assert ref_nodes[2].get("column_title") == "Обструктивный ателектаз"
