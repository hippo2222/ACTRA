"""
Unit tests for DifficultyManager — T7 coverage plan.

Covers:
- Init and default levels
- get_available_levels with defaults, type overrides, task overrides
- get_smart_retry_config
- enhance_task_for_level for click, draw, test, sequence_assembly, open_answer
- _should_use_draw_instead_of_click
- get_initial_level
- Error handling in enhance_task_for_level
"""

import sys
import os
import copy
import pytest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.difficulty_manager import DifficultyManager


# ─── Fixtures ──────────────────────────────────────────────────────


@pytest.fixture
def dm():
    """DifficultyManager with no config file (uses defaults)."""
    with patch("services.difficulty_manager.CONFIG_LOADER_AVAILABLE", False):
        return DifficultyManager(config_path=None)


@pytest.fixture
def dm_with_config():
    """DifficultyManager with custom config."""
    with patch("services.difficulty_manager.CONFIG_LOADER_AVAILABLE", False):
        mgr = DifficultyManager(config_path=None)
    mgr.config = {
        "default_levels": {
            "click": [1, 2, 3],
            "draw": [1, 2],
            "test": [1, 2],
            "sequence_assembly": [1, 2, 3],
            "open_answer": [1],
        },
        "task_overrides": {
            "mod/topic/special_task": {"levels": [1, 2]},
        },
        "type_overrides": {
            "draw": {"max_level": 3},
        },
        "smart_retry_defaults": {
            "near_offset": 3,
            "near_jitter_max": 1,
            "max_copies": 4,
            "training_control_enabled": False,
        },
    }
    mgr.default_levels = mgr._get_default_levels()
    return mgr


# ═══════════════════════════════════════════════════════════════════
# Init & default levels
# ═══════════════════════════════════════════════════════════════════


class TestInit:
    def test_default_levels(self, dm):
        assert dm.default_levels["click"] == [1, 2, 3]
        assert dm.default_levels["draw"] == [1, 2]
        assert dm.default_levels["test"] == [1, 2]
        assert dm.default_levels["sequence_assembly"] == [1, 2, 3]
        assert dm.default_levels["open_answer"] == [1]

    def test_config_from_loader(self, dm_with_config):
        assert dm_with_config.default_levels["click"] == [1, 2, 3]


# ═══════════════════════════════════════════════════════════════════
# get_available_levels
# ═══════════════════════════════════════════════════════════════════


class TestGetAvailableLevels:
    def test_defaults(self, dm):
        assert dm.get_available_levels("click") == [1, 2, 3]
        assert dm.get_available_levels("draw") == [1, 2]
        assert dm.get_available_levels("open_answer") == [1]

    def test_unknown_type(self, dm):
        assert dm.get_available_levels("unknown_type") == [1]

    def test_task_override(self, dm_with_config):
        assert dm_with_config.get_available_levels("click", "mod/topic/special_task") == [1, 2]

    def test_type_override(self, dm_with_config):
        assert dm_with_config.get_available_levels("draw") == [1, 2, 3]

    def test_task_override_priority_over_type(self, dm_with_config):
        # task override should take priority
        assert dm_with_config.get_available_levels("click", "mod/topic/special_task") == [1, 2]

    def test_unknown_placeholder_falls_back_to_loaded_task_type(self, dm):
        storage = MagicMock()
        storage.load_task.return_value = {
            "task_data": {
                "type": "click",
                "settings": {
                    "difficulty": 2,
                },
            }
        }
        dm.storage_service = storage

        assert dm.get_available_levels("unknown", "mod/topic/task") == [1, 2, 3]


# ═══════════════════════════════════════════════════════════════════
# get_smart_retry_config
# ═══════════════════════════════════════════════════════════════════


class TestSmartRetryConfig:
    def test_default(self, dm):
        cfg = dm.get_smart_retry_config()
        assert cfg["near_offset"] == 2
        assert cfg["max_copies"] == 5

    def test_from_config(self, dm_with_config):
        cfg = dm_with_config.get_smart_retry_config()
        assert cfg["near_offset"] == 3
        assert cfg["training_control_enabled"] is False


# ═══════════════════════════════════════════════════════════════════
# enhance_task_for_level — click
# ═══════════════════════════════════════════════════════════════════


class TestEnhanceClick:
    def _task(self):
        return {"type": "click", "content": {"type": "click", "prompt": "Click here", "mode": "click"}}

    def test_level1(self, dm):
        result = dm.enhance_task_for_level(self._task(), 1)
        assert result["content"]["mode"] == "click"
        assert result["content"]["requires_labels"] is False

    def test_level2(self, dm):
        result = dm.enhance_task_for_level(self._task(), 2)
        assert result["content"]["mode"] == "click_and_label"
        assert result["content"]["requires_labels"] is True

    def test_level3(self, dm):
        result = dm.enhance_task_for_level(self._task(), 3)
        assert result["content"]["mode"] == "draw_and_label"
        assert result["content"]["requires_drawing"] is True

    def test_flags_set(self, dm):
        result = dm.enhance_task_for_level(self._task(), 2)
        assert result["_difficulty_enhanced"] is True
        assert result["_original_type"] == "click"
        assert result["_difficulty_level"] == 2

    def test_original_not_modified(self, dm):
        original = self._task()
        original_copy = copy.deepcopy(original)
        dm.enhance_task_for_level(original, 3)
        assert original == original_copy


# ═══════════════════════════════════════════════════════════════════
# enhance_task_for_level — draw
# ═══════════════════════════════════════════════════════════════════


class TestEnhanceDraw:
    def _task(self):
        return {"type": "draw", "content": {"type": "draw", "prompt": "Draw", "mode": "draw"}}

    def test_level1(self, dm):
        result = dm.enhance_task_for_level(self._task(), 1)
        assert result["content"]["mode"] == "draw"
        assert result["content"]["requires_labels"] is False

    def test_level2(self, dm):
        result = dm.enhance_task_for_level(self._task(), 2)
        assert result["content"]["mode"] == "draw_and_label"
        assert result["content"]["requires_labels"] is True

    def test_level3(self, dm):
        result = dm.enhance_task_for_level(self._task(), 3)
        assert result["content"]["mode"] == "draw_multiple_and_explain"
        assert result["content"]["requires_explanation"] is True


# ═══════════════════════════════════════════════════════════════════
# enhance_task_for_level — test
# ═══════════════════════════════════════════════════════════════════


class TestEnhanceTest:
    def _task(self):
        return {"type": "test", "content": {"type": "test", "mode": "multiple_choice"}}

    def test_level1(self, dm):
        result = dm.enhance_task_for_level(self._task(), 1)
        assert result["content"]["mode"] == "multiple_choice"
        assert result["content"]["show_options"] is True

    def test_level2(self, dm):
        result = dm.enhance_task_for_level(self._task(), 2)
        assert result["content"]["mode"] == "open_question"
        assert result["content"]["requires_text_input"] is True

    def test_cleans_sequence_flags(self, dm):
        task = self._task()
        task["content"]["show_level_labels"] = True
        result = dm.enhance_task_for_level(task, 1)
        assert "show_level_labels" not in result["content"]


# ═══════════════════════════════════════════════════════════════════
# enhance_task_for_level — sequence_assembly
# ═══════════════════════════════════════════════════════════════════


class TestEnhanceSequence:
    def _task(self):
        return {"type": "sequence_assembly", "content": {"type": "sequence_assembly"}}

    def test_level1(self, dm):
        result = dm.enhance_task_for_level(self._task(), 1)
        assert result["content"]["show_level_labels"] is True
        assert result["content"]["requires_level_names"] is False

    def test_level2(self, dm):
        result = dm.enhance_task_for_level(self._task(), 2)
        assert result["content"]["show_level_labels"] is False
        assert result["content"]["requires_level_names"] is True
        assert result["content"]["requires_block_names"] is False

    def test_level3(self, dm):
        result = dm.enhance_task_for_level(self._task(), 3)
        assert result["content"]["requires_level_names"] is True
        assert result["content"]["requires_block_names"] is True

    def test_cleans_test_flags(self, dm):
        task = self._task()
        task["content"]["show_options"] = True
        result = dm.enhance_task_for_level(task, 1)
        assert "show_options" not in result["content"]


# ═══════════════════════════════════════════════════════════════════
# enhance_task_for_level — open_answer & unknown
# ═══════════════════════════════════════════════════════════════════


class TestEnhanceOther:
    def test_open_answer_no_change(self, dm):
        task = {"type": "open_answer", "content": {"type": "open_answer", "prompt": "Answer"}}
        result = dm.enhance_task_for_level(task, 1)
        assert result["content"]["prompt"] == "Answer"
        assert result["_difficulty_enhanced"] is True

    def test_unknown_type(self, dm):
        task = {"type": "custom_plugin", "content": {"type": "custom_plugin"}}
        result = dm.enhance_task_for_level(task, 1)
        assert result["_difficulty_enhanced"] is True
        assert result["_original_type"] == "custom_plugin"

    def test_error_returns_original(self, dm):
        result = dm.enhance_task_for_level(None, 1)
        assert result["_difficulty_enhanced"] is False


# ═══════════════════════════════════════════════════════════════════
# _should_use_draw_instead_of_click
# ═══════════════════════════════════════════════════════════════════


class TestShouldUseDraw:
    def test_freehand_present(self, dm):
        task = {"content": {"annotations": [{"type": "freehand"}]}}
        assert dm._should_use_draw_instead_of_click(task) is True

    def test_freehand_shape(self, dm):
        task = {"content": {"annotations": [{"shape": "freehand"}]}}
        assert dm._should_use_draw_instead_of_click(task) is True

    def test_polygon_only(self, dm):
        task = {"content": {"annotations": [{"type": "polygon"}]}}
        assert dm._should_use_draw_instead_of_click(task) is False

    def test_no_annotations(self, dm):
        task = {"content": {}}
        assert dm._should_use_draw_instead_of_click(task) is False


# ═══════════════════════════════════════════════════════════════════
# get_initial_level
# ═══════════════════════════════════════════════════════════════════


class TestGetInitialLevel:
    def test_default_level_1(self, dm):
        task = {"type": "click", "content": {"type": "click"}}
        assert dm.get_initial_level(task) == 1

    def test_from_settings(self, dm):
        task = {"type": "click", "content": {"type": "click"}, "settings": {"difficulty": 2}}
        assert dm.get_initial_level(task) == 2

    def test_clamps_to_max(self, dm):
        task = {"type": "draw", "content": {"type": "draw"}, "settings": {"difficulty": 5}}
        assert dm.get_initial_level(task) == 2  # draw max is 2

    def test_clamps_to_min(self, dm):
        task = {"type": "click", "content": {"type": "click"}, "settings": {"difficulty": 0}}
        assert dm.get_initial_level(task) == 1

    def test_unknown_type(self, dm):
        task = {"type": "unknown", "content": {"type": "unknown"}, "settings": {"difficulty": 3}}
        assert dm.get_initial_level(task) == 1  # unknown only has [1]
