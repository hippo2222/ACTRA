"""
Test suite validating clinical stress-fixtures (Table 5.1 and Table 5.2):
- JSON schema validation via SequenceAssemblyTaskSchema
- High text-density stress constraints (100-190 characters per card)
- DAG integrity (acyclic graph, valid parents, tier consistency)
- Evaluation via TaskEvaluatorService across Difficulties 1, 2, 3
"""

import copy
import json
from pathlib import Path
import sys

import pytest

ROOT_DIR = Path(__file__).resolve().parents[2]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
for p in (str(ROOT_DIR), str(DESKTOP_APP_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from task_system.core.schemas.sequence_assembly_schema import SequenceAssemblyTaskSchema
from task_system.types.sequence_assembly_task import SequenceAssemblyTaskType
from services.task_evaluator_service import TaskEvaluatorService
from services.difficulty_manager import DifficultyManager

FIXTURES_DIR = ROOT_DIR / "tests" / "fixtures" / "clinical_fixtures"


def load_fixture(filename: str) -> dict:
    path = FIXTURES_DIR / filename
    assert path.exists(), f"Fixture file not found: {path}"
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


class TestClinicalHierarchyFixtures:
    @pytest.mark.parametrize("filename", [
        "table_5_1_tela_stratification.json",
        "table_5_2_pneumothorax_differentiation.json",
    ])
    def test_fixture_schema_validation(self, filename: str):
        """Fixtures must strictly conform to SequenceAssemblyTaskSchema."""
        raw_task = load_fixture(filename)
        errors = SequenceAssemblyTaskSchema.validate(raw_task)
        assert errors == [], f"Validation errors in {filename}: {errors}"

        task_type = SequenceAssemblyTaskType()
        assert task_type.validate_task_data(raw_task["content"]) is True
        assert raw_task["content"]["display_mode"] == "hierarchy"
        assert len(raw_task["content"]["elements"]) >= 8
        assert len(raw_task["content"]["levels"]) >= 3
        assert len(raw_task["content"]["nodes"]) >= 6

    @pytest.mark.parametrize("filename", [
        "table_5_1_tela_stratification.json",
        "table_5_2_pneumothorax_differentiation.json",
    ])
    def test_high_density_character_lengths(self, filename: str):
        """
        Verify that clinical elements meet the high-density stress testing criteria:
        each element text must be substantive (>= 100 characters and <= 200 characters).
        """
        raw_task = load_fixture(filename)
        elements = raw_task["content"]["elements"]
        for elem in elements:
            text = elem["text"]
            length = len(text)
            assert 100 <= length <= 200, (
                f"Element '{elem['id']}' in {filename} has length {length}, "
                f"expected between 100 and 200 chars: '{text[:40]}...'"
            )

    @pytest.mark.parametrize("filename", [
        "table_5_1_tela_stratification.json",
        "table_5_2_pneumothorax_differentiation.json",
    ])
    def test_dag_tree_integrity(self, filename: str):
        """Verify no cycles, parent existence, and tier assignment consistency."""
        raw_task = load_fixture(filename)
        content = raw_task["content"]
        level_ids = {lvl["level_id"] for lvl in content["levels"]}
        node_ids = {node["node_id"] for node in content["nodes"]}
        node_by_id = {node["node_id"]: node for node in content["nodes"]}

        # 1. All parents exist and level_ids exist
        for node in content["nodes"]:
            assert node["level_id"] in level_ids, f"Unknown level_id in node {node['node_id']}"
            if node["parent_id"] is not None:
                assert node["parent_id"] in node_ids, f"Parent {node['parent_id']} not found"
                assert node["parent_id"] != node["node_id"], "Self-referencing parent detected"

        # 2. Cycle detection via topological traversal
        visited = set()
        for node in content["nodes"]:
            curr = node["node_id"]
            path = []
            while curr is not None:
                assert curr not in path, f"Cycle detected in {filename}: {' -> '.join(path + [curr])}"
                path.append(curr)
                parent_id = node_by_id[curr]["parent_id"]
                curr = parent_id

    def test_table_5_1_evaluation_success(self):
        """Table 5.1 evaluation returns 100% success on correct answer."""
        raw_task = load_fixture("table_5_1_tela_stratification.json")
        content = raw_task["content"]
        answer_key = copy.deepcopy(content)
        answer_key.update(raw_task["settings"])

        user_answer = {
            "display_mode": "hierarchy",
            "levels": [
                {"level_id": lvl["level_id"], "blocks": lvl["blocks"][:]}
                for lvl in content["levels"]
            ],
            "nodes": [
                {
                    "node_id": node["node_id"],
                    "level_id": node["level_id"],
                    "parent_id": node["parent_id"],
                    "blocks": node["blocks"][:],
                }
                for node in content["nodes"]
            ],
        }

        service = TaskEvaluatorService()
        result = service.evaluate_sequence_task(
            user_input=user_answer,
            answer_key=answer_key,
            task_data=raw_task,
        )
        assert result.success is True
        assert result.score == pytest.approx(100.0)
        assert len(result.details["correct_nodes"]) == 8
        assert len(result.details["incorrect_nodes"]) == 0

    def test_table_5_1_swapped_columns_accepted(self):
        """
        Table 5.1 comparative columns: swapping the High-Risk and Non-High-Risk columns
        must be recognized as equivalent and accepted (symmetry tolerance).
        """
        raw_task = load_fixture("table_5_1_tela_stratification.json")
        answer_key = copy.deepcopy(raw_task["content"])
        answer_key.update(raw_task["settings"])

        # Swap Column 1 (node_high_*) and Column 2 (node_non_high_*)
        user_answer = {
            "display_mode": "hierarchy",
            "levels": [
                {"level_id": lvl["level_id"], "blocks": lvl["blocks"][::-1]}
                for lvl in raw_task["content"]["levels"]
            ],
            "nodes": [
                # Column 2 placed first
                {"node_id": "u_col2_r1", "level_id": "tier_hemodynamics", "parent_id": None, "blocks": ["elem_non_high_risk"], "column_title": "ТЭЛА невысокого риска"},
                {"node_id": "u_col2_r2", "level_id": "tier_biomarkers", "parent_id": "u_col2_r1", "blocks": ["elem_non_high_markers"]},
                {"node_id": "u_col2_r3", "level_id": "tier_imaging", "parent_id": "u_col2_r2", "blocks": ["elem_non_high_ct"]},
                {"node_id": "u_col2_r4", "level_id": "tier_reperfusion", "parent_id": "u_col2_r3", "blocks": ["elem_non_high_tx"]},
                # Column 1 placed second
                {"node_id": "u_col1_r1", "level_id": "tier_hemodynamics", "parent_id": None, "blocks": ["elem_high_risk"], "column_title": "ТЭЛА высокого риска"},
                {"node_id": "u_col1_r2", "level_id": "tier_biomarkers", "parent_id": "u_col1_r1", "blocks": ["elem_high_markers"]},
                {"node_id": "u_col1_r3", "level_id": "tier_imaging", "parent_id": "u_col1_r2", "blocks": ["elem_high_ct"]},
                {"node_id": "u_col1_r4", "level_id": "tier_reperfusion", "parent_id": "u_col1_r3", "blocks": ["elem_high_tx"]},
            ],
        }

        service = TaskEvaluatorService()
        result = service.evaluate_sequence_task(
            user_input=user_answer,
            answer_key=answer_key,
            task_data=raw_task,
        )
        assert result.success is True
        assert result.score == pytest.approx(100.0)

    def test_table_5_2_pneumothorax_evaluation_success(self):
        """Table 5.2 3-branch classification evaluation."""
        raw_task = load_fixture("table_5_2_pneumothorax_differentiation.json")
        content = raw_task["content"]
        answer_key = copy.deepcopy(content)
        answer_key.update(raw_task["settings"])

        user_answer = {
            "display_mode": "hierarchy",
            "levels": [
                {"level_id": lvl["level_id"], "blocks": lvl["blocks"][:]}
                for lvl in content["levels"]
            ],
            "nodes": [
                {
                    "node_id": node["node_id"],
                    "level_id": node["level_id"],
                    "parent_id": node["parent_id"],
                    "blocks": node["blocks"][:],
                }
                for node in content["nodes"]
            ],
        }

        service = TaskEvaluatorService()
        result = service.evaluate_sequence_task(
            user_input=user_answer,
            answer_key=answer_key,
            task_data=raw_task,
        )
        assert result.success is True
        assert result.score == pytest.approx(100.0)
        assert len(result.details["correct_nodes"]) == 9
        assert len(result.details["incorrect_nodes"]) == 0

    def test_difficulty_enhancement_and_eval_for_table_5_1(self):
        """Test Difficulty 2 (typed tier names) and Difficulty 3 (blind skeleton) on Table 5.1."""
        raw_task = load_fixture("table_5_1_tela_stratification.json")
        dm = DifficultyManager()

        # 1. Difficulty 2
        d2_task = dm._enhance_sequence_task(copy.deepcopy(raw_task), level=2)
        assert d2_task["content"]["requires_level_names"] is True
        assert d2_task["content"]["requires_block_names"] is False

        # Evaluation of D2 with correct typed names
        d2_answer_key = copy.deepcopy(d2_task["content"])
        d2_answer_key.update(d2_task["settings"])
        user_answer_d2 = {
            "display_mode": "hierarchy",
            "levels": [
                {"level_id": lvl["level_id"], "level_name": lvl["label"], "blocks": lvl["blocks"][:]}
                for lvl in raw_task["content"]["levels"]
            ],
            "nodes": [
                {
                    "node_id": node["node_id"],
                    "level_id": node["level_id"],
                    "parent_id": node["parent_id"],
                    "blocks": node["blocks"][:],
                }
                for node in raw_task["content"]["nodes"]
            ],
        }
        service = TaskEvaluatorService()
        res_d2 = service.evaluate_sequence_task(
            user_input=user_answer_d2,
            answer_key=d2_answer_key,
            task_data=d2_task,
        )
        assert res_d2.success is True
        assert res_d2.score == pytest.approx(100.0)

        # 2. Difficulty 3
        d3_task = dm._enhance_sequence_task(copy.deepcopy(raw_task), level=3)
        assert d3_task["content"]["requires_level_names"] is False
        assert d3_task["content"]["requires_block_names"] is True
        assert d3_task["content"]["show_block_labels"] is False
        assert d3_task["content"]["show_level_labels"] is True

        # Evaluation of D3 with typed block names
        d3_answer_key = copy.deepcopy(d3_task["content"])
        d3_answer_key.update(d3_task["settings"])
        elem_text_by_id = {e["id"]: e["text"] for e in raw_task["content"]["elements"]}

        user_answer_d3 = {
            "display_mode": "hierarchy",
            "levels": [
                {"level_id": lvl["level_id"], "blocks": lvl["blocks"][:]}
                for lvl in raw_task["content"]["levels"]
            ],
            "nodes": [
                {
                    "node_id": node["node_id"],
                    "level_id": node["level_id"],
                    "parent_id": node["parent_id"],
                    "blocks": node["blocks"][:],
                    "block_names": {b_id: elem_text_by_id[b_id] for b_id in node["blocks"]},
                }
                for node in raw_task["content"]["nodes"]
            ],
        }
        res_d3 = service.evaluate_sequence_task(
            user_input=user_answer_d3,
            answer_key=d3_answer_key,
            task_data=d3_task,
        )
        assert res_d3.success is True
        assert res_d3.score == pytest.approx(100.0)
