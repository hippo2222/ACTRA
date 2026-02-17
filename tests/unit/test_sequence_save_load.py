"""
Integration tests for sequence_assembly save/load cycle.

Stage 6: Verifies that fixes #1-#10 work correctly across the full
Editor → Storage → TaskIO → task.json → Load → Evaluate pipeline.
"""

import json
import pytest
import sys
from pathlib import Path
from datetime import datetime
from copy import deepcopy

# Ensure project root is on sys.path
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

_DESKTOP_APP_PATH = _PROJECT_ROOT / "desktop-app"
if str(_DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(_DESKTOP_APP_PATH))

from task_system.core.models.task_data import TaskData
from task_system.core.io.task_io import TaskIO
from task_system.core.models.task_models import (
    SequenceElement,
    SequenceLevelBlock,
    SequenceAssemblyTaskContent,
    ValidatedTask,
    TaskMetadata,
)
from task_system.types.sequence_assembly_task import SequenceAssemblyTaskEvaluator


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

EDITOR_PAYLOAD = {
    "id": "test_seq_001",
    "type": "sequence_assembly",
    "subtype": None,
    "meta": {
        "task_schema_version": "1.2",
        "created_at": "2025-01-01T00:00:00",
        "author": "test",
        "name": "Test Sequence",
        "module": "mod_test",
        "topic": "topic_test",
        "modified": None,
        "version": "1.0",
    },
    "content": {
        "prompt": "Расположите элементы по уровням",
        "elements": [
            {"id": "elem_1", "text": "Первый"},
            {"id": "elem_2", "text": "Второй"},
            {"id": "elem_3", "text": "Третий"},
        ],
        "levels": [
            {"level_id": "level_1", "blocks": ["elem_1", "elem_2"], "level_name": "Уровень А"},
            {"level_id": "level_2", "blocks": ["elem_3"], "level_name": "Уровень Б"},
        ],
        "sequence": [
            {
                "level_id": "level_1",
                "title": "Уровень А",
                "items": [
                    {"id": "elem_1", "label": "Первый"},
                    {"id": "elem_2", "label": "Второй"},
                ],
            },
            {
                "level_id": "level_2",
                "title": "Уровень Б",
                "items": [{"id": "elem_3", "label": "Третий"}],
            },
        ],
        "level_order_matters": True,
        "sequence_within_level_matters": False,
    },
    "settings": {
        "difficulty": 1,
        "time_limit": None,
        "allow_hints": False,
        "level_order_matters": True,
        "sequence_within_level_matters": False,
    },
}


# ---------------------------------------------------------------------------
# Fix #1: SequenceElement.order is now Optional
# ---------------------------------------------------------------------------


class TestFix1_SequenceElementOrder:
    """SequenceElement should accept elements without 'order' field."""

    def test_element_without_order(self):
        elem = SequenceElement(id="e1", text="Hello")
        assert elem.id == "e1"
        assert elem.order is None

    def test_element_with_order(self):
        elem = SequenceElement(id="e2", text="World", order=3)
        assert elem.order == 3

    def test_element_dict_conversion(self):
        raw = {"id": "e3", "text": "Test"}
        elem = SequenceElement(**raw)
        assert elem.id == "e3"
        assert elem.order is None


# ---------------------------------------------------------------------------
# Fix #2: SequenceAssemblyTaskContent now has levels/flags
# ---------------------------------------------------------------------------


class TestFix2_ContentModelFields:
    """SequenceAssemblyTaskContent should accept levels and boolean flags."""

    def test_content_with_levels(self):
        content = SequenceAssemblyTaskContent(
            elements=[{"id": "a", "text": "A"}, {"id": "b", "text": "B"}],
            prompt="Test",
            levels=[{"level_id": "l1", "blocks": ["a", "b"]}],
            level_order_matters=True,
            sequence_within_level_matters=False,
        )
        assert content.levels is not None
        assert len(content.levels) == 1
        assert content.level_order_matters is True
        assert content.sequence_within_level_matters is False

    def test_content_without_levels(self):
        content = SequenceAssemblyTaskContent(
            elements=[{"id": "a", "text": "A"}, {"id": "b", "text": "B"}],
            prompt="Test",
        )
        assert content.levels is None
        assert content.level_order_matters is None

    def test_level_block_model(self):
        lvl = SequenceLevelBlock(level_id="l1", blocks=["a", "b"], level_name="Level 1")
        assert lvl.level_id == "l1"
        assert lvl.blocks == ["a", "b"]
        assert lvl.level_name == "Level 1"

    def test_levels_converted_to_typed(self):
        content = SequenceAssemblyTaskContent(
            elements=[{"id": "a", "text": "A"}, {"id": "b", "text": "B"}],
            prompt="Test",
            levels=[{"level_id": "l1", "blocks": ["a", "b"], "level_name": "L1"}],
        )
        assert isinstance(content.levels[0], SequenceLevelBlock)


# ---------------------------------------------------------------------------
# Fix #3: Validation on save now succeeds (was silently skipped)
# ---------------------------------------------------------------------------


class TestFix3_ValidationOnSave:
    """to_validated() should succeed for well-formed sequence_assembly data."""

    def test_to_validated_succeeds(self):
        task_data = TaskData.from_dict(deepcopy(EDITOR_PAYLOAD))
        validated = task_data.to_validated()
        assert validated is not None, "to_validated() should not return None for valid data"
        assert validated.type == "sequence_assembly"

    def test_validated_content_type(self):
        task_data = TaskData.from_dict(deepcopy(EDITOR_PAYLOAD))
        validated = task_data.to_validated()
        assert validated is not None
        assert isinstance(validated.content, SequenceAssemblyTaskContent)

    def test_validated_preserves_levels(self):
        task_data = TaskData.from_dict(deepcopy(EDITOR_PAYLOAD))
        validated = task_data.to_validated()
        assert validated is not None
        content = validated.content
        assert content.levels is not None
        assert len(content.levels) == 2

    def test_validated_preserves_flags(self):
        task_data = TaskData.from_dict(deepcopy(EDITOR_PAYLOAD))
        validated = task_data.to_validated()
        assert validated is not None
        content = validated.content
        assert content.level_order_matters is True
        assert content.sequence_within_level_matters is False


# ---------------------------------------------------------------------------
# Fix #4: _normalize_answer_key reads level_id correctly
# ---------------------------------------------------------------------------


class TestFix4_NormalizeAnswerKey:
    """_normalize_answer_key should use level_id from legacy sequence format."""

    def test_normalize_from_sequence(self):
        from services.storage_service import StorageService

        svc = StorageService.__new__(StorageService)
        svc.logger = __import__("logging").getLogger("test")

        task_data = {
            "type": "sequence_assembly",
            "content": {
                "sequence": [
                    {
                        "level_id": "level_1",
                        "title": "Красный",
                        "items": [
                            {"id": "elem_1", "label": "Арбуз"},
                            {"id": "elem_2", "label": "Кровь"},
                        ],
                    },
                    {
                        "level_id": "level_2",
                        "title": "Зелёный",
                        "items": [{"id": "elem_3", "label": "Трава"}],
                    },
                ],
                "level_order_matters": True,
                "sequence_within_level_matters": False,
            },
        }

        answer_key = svc._normalize_answer_key(task_data, {})

        assert "levels" in answer_key
        assert answer_key["levels"][0]["level_id"] == "level_1"
        assert answer_key["levels"][1]["level_id"] == "level_2"
        assert answer_key["levels"][0]["blocks"] == ["elem_1", "elem_2"]
        assert answer_key["levels"][1]["blocks"] == ["elem_3"]


# ---------------------------------------------------------------------------
# Fix #5: TaskIO.new_task initializes sequence_assembly
# ---------------------------------------------------------------------------


class TestFix5_NewTaskInit:
    """TaskIO.new_task should create valid initial data for sequence_assembly."""

    def test_new_task_has_elements(self):
        task = TaskIO.new_task("sequence_assembly", name="Test")
        assert "elements" in task.content
        assert isinstance(task.content["elements"], list)
        assert len(task.content["elements"]) >= 2

    def test_new_task_has_prompt(self):
        task = TaskIO.new_task("sequence_assembly", name="Test")
        assert "prompt" in task.content

    def test_new_task_has_levels(self):
        task = TaskIO.new_task("sequence_assembly", name="Test")
        assert "levels" in task.content
        assert isinstance(task.content["levels"], list)
        assert len(task.content["levels"]) >= 1

    def test_new_task_has_flags(self):
        task = TaskIO.new_task("sequence_assembly", name="Test")
        assert "level_order_matters" in task.content
        assert "sequence_within_level_matters" in task.content

    def test_new_task_validates(self):
        task = TaskIO.new_task("sequence_assembly", name="Test")
        validated = task.to_validated()
        assert validated is not None


# ---------------------------------------------------------------------------
# Full round-trip: save → load → evaluate
# ---------------------------------------------------------------------------


class TestRoundTrip:
    """Full save/load/evaluate cycle for sequence_assembly."""

    def test_save_and_load(self, tmp_path):
        task_data = TaskData.from_dict(deepcopy(EDITOR_PAYLOAD))
        task_json = tmp_path / "task.json"

        TaskIO.save(task_data, str(task_json), validate=True)

        assert task_json.exists()

        with open(task_json, "r", encoding="utf-8") as f:
            saved = json.load(f)

        assert saved["type"] == "sequence_assembly"
        assert "elements" in saved["content"]
        assert "levels" in saved["content"]
        assert len(saved["content"]["elements"]) == 3
        assert len(saved["content"]["levels"]) == 2

    def test_save_preserves_flags(self, tmp_path):
        task_data = TaskData.from_dict(deepcopy(EDITOR_PAYLOAD))
        task_json = tmp_path / "task.json"

        TaskIO.save(task_data, str(task_json), validate=True)

        with open(task_json, "r", encoding="utf-8") as f:
            saved = json.load(f)

        assert saved["content"]["level_order_matters"] is True
        assert saved["content"]["sequence_within_level_matters"] is False

    def test_load_after_save(self, tmp_path):
        task_data = TaskData.from_dict(deepcopy(EDITOR_PAYLOAD))
        task_json = tmp_path / "task.json"

        TaskIO.save(task_data, str(task_json), validate=True)

        loaded = TaskIO.load(str(task_json), use_validation=False)

        assert loaded is not None
        assert loaded.type == "sequence_assembly"
        assert len(loaded.content.get("elements", [])) == 3

    def test_roundtrip_evaluate(self, tmp_path):
        """Save → Load → use content as reference_data → evaluate correct answer."""
        task_data = TaskData.from_dict(deepcopy(EDITOR_PAYLOAD))
        task_json = tmp_path / "task.json"
        TaskIO.save(task_data, str(task_json), validate=True)

        with open(task_json, "r", encoding="utf-8") as f:
            saved = json.load(f)

        content = saved["content"]

        user_payload = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]},
                {"level_id": "level_2", "blocks": ["elem_3"]},
            ]
        }

        evaluator = SequenceAssemblyTaskEvaluator()
        result = evaluator.evaluate(user_payload, content)

        assert result["success"] is True
        assert result["score"] == 100.0

    def test_roundtrip_evaluate_wrong_answer(self, tmp_path):
        """Save → Load → evaluate incorrect answer."""
        task_data = TaskData.from_dict(deepcopy(EDITOR_PAYLOAD))
        task_json = tmp_path / "task.json"
        TaskIO.save(task_data, str(task_json), validate=True)

        with open(task_json, "r", encoding="utf-8") as f:
            saved = json.load(f)

        content = saved["content"]

        user_payload = {
            "levels": [
                {"level_id": "level_2", "blocks": ["elem_3"]},
                {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]},
            ]
        }

        evaluator = SequenceAssemblyTaskEvaluator()
        result = evaluator.evaluate(user_payload, content)

        # level_order_matters=True, so swapped levels → fail
        assert result["success"] is False


# ---------------------------------------------------------------------------
# Regression: real task_004 data should load and validate
# ---------------------------------------------------------------------------


class TestRealTaskData:
    """Verify that the real task_004 task.json passes validation after fixes."""

    TASK_004 = {
        "id": "task_004",
        "type": "sequence_assembly",
        "subtype": None,
        "meta": {
            "task_schema_version": "1.2",
            "created_at": "2025-11-14T18:21:02.512647",
            "author": "",
            "name": "4",
            "module": "module_01",
            "topic": "topic_01",
            "modified": "2025-11-16T00:36:56.166174",
            "version": "1.0",
        },
        "content": {
            "elements": [
                {"id": "elem_1", "text": "Арбуз внутри"},
                {"id": "elem_5", "text": "Кровь"},
                {"id": "elem_6", "text": "Божья коровка"},
                {"id": "elem_2", "text": "Персик"},
                {"id": "elem_7", "text": "Апельсин"},
                {"id": "elem_3", "text": "Солнце"},
                {"id": "elem_8", "text": "Лимон"},
                {"id": "elem_9", "text": "Жир"},
                {"id": "elem_4", "text": "Трава"},
                {"id": "elem_10", "text": "Огурец"},
                {"id": "elem_11", "text": "Ёлка"},
            ],
            "prompt": "Расположите цвета радуги в правильной последовательности.",
            "level_order_matters": True,
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", "elem_5", "elem_6"], "level_name": "Красный"},
                {"level_id": "level_2", "blocks": ["elem_2", "elem_7"], "level_name": "Оранжевый"},
                {"level_id": "level_3", "blocks": ["elem_3", "elem_8", "elem_9"], "level_name": "Желтый"},
                {"level_id": "level_4", "blocks": ["elem_4", "elem_10", "elem_11"], "level_name": "Зелёный"},
            ],
            "sequence_within_level_matters": False,
        },
        "settings": {
            "difficulty": 1,
            "time_limit": None,
            "allow_hints": False,
            "level_order_matters": True,
            "sequence_within_level_matters": False,
        },
    }

    def test_real_task_loads(self):
        task_data = TaskData.from_dict(deepcopy(self.TASK_004))
        assert task_data.type == "sequence_assembly"

    def test_real_task_validates(self):
        task_data = TaskData.from_dict(deepcopy(self.TASK_004))
        validated = task_data.to_validated()
        assert validated is not None, (
            "Real task_004 should pass Pydantic validation after Fix #1 and #2"
        )

    def test_real_task_roundtrip(self, tmp_path):
        task_data = TaskData.from_dict(deepcopy(self.TASK_004))
        task_json = tmp_path / "task.json"
        TaskIO.save(task_data, str(task_json), validate=True)

        loaded = TaskIO.load(str(task_json), use_validation=False)
        assert loaded is not None
        assert loaded.type == "sequence_assembly"
        assert len(loaded.content.get("elements", [])) == 11
        assert len(loaded.content.get("levels", [])) == 4


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
