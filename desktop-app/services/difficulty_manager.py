"""
Difficulty manager for task-level difficulty progression.

This service modifies task payloads in memory only.
"""

from __future__ import annotations

import copy
import logging
from typing import Any, Dict, List, Optional, Tuple

try:
    from services.difficulty_config_loader import DifficultyConfigLoader

    CONFIG_LOADER_AVAILABLE = True
except ImportError:
    CONFIG_LOADER_AVAILABLE = False
    DifficultyConfigLoader = None

try:
    from services.analysis_capability_matrix import get_task_difficulty_metadata
except ImportError:
    def get_task_difficulty_metadata(task_type: Optional[str], subtype: Optional[str] = None) -> Dict[str, Any]:
        return {
            "task_type": str(task_type or "").strip().upper(),
            "subtype": str(subtype or "").strip().lower() or None,
            "supported_levels": [],
            "level_role_map": [],
            "progression_is_fixed": False,
            "progression_kind": "unknown",
            "authoring_enabled": False,
            "complex_role": "none",
            "fixed_progression_note": "",
        }

try:
    from task_system.core.hooks.difficulty_hooks import difficulty_hooks

    HOOKS_AVAILABLE = True
except ImportError:
    HOOKS_AVAILABLE = False
    difficulty_hooks = None

logger = logging.getLogger(__name__)


class DifficultyManager:
    def __init__(self, config_path: Optional[str] = None, storage_service: Optional[Any] = None):
        self.config_path = config_path
        self.storage_service = storage_service
        self.logger = logging.getLogger(self.__class__.__name__)
        self._task_payload_cache: Dict[str, Optional[Dict[str, Any]]] = {}

        if CONFIG_LOADER_AVAILABLE and DifficultyConfigLoader:
            try:
                self.config = DifficultyConfigLoader.load_config(config_path)
            except Exception as exc:
                self.logger.warning("Failed to load difficulty config: %s", exc)
                self.config = {}
        else:
            self.config = {}

        self.default_levels = self._get_default_levels()
        self.hooks_available = HOOKS_AVAILABLE

    def _get_default_levels(self) -> Dict[str, List[int]]:
        if self.config and "default_levels" in self.config:
            configured: Dict[str, Any] = self.config["default_levels"]
            return {
                self._normalize_task_type(task_type): self._normalize_levels(levels)
                for task_type, levels in configured.items()
            }
        return {
            "click": [1, 2, 3],
            "draw": [1, 2],
            "test": [1, 2],
            "sequence_assembly": [1, 2, 3],
            "image_labeling": [1, 2],
            "open_answer": [1],
        }

    @staticmethod
    def _normalize_task_type(task_type: Optional[str]) -> str:
        value = str(task_type or "").strip().lower()
        if value == "sequence":
            return "sequence_assembly"
        return value

    def _resolve_task_identity(
        self,
        task_type: Optional[str] = None,
        task_data: Optional[Dict[str, Any]] = None,
        subtype: Optional[str] = None,
    ) -> Tuple[str, Optional[str]]:
        data = task_data if isinstance(task_data, dict) else {}
        content = data.get("content") if isinstance(data.get("content"), dict) else {}
        requested_task_type = self._normalize_task_type(task_type)
        if requested_task_type == "unknown":
            requested_task_type = ""
        resolved_task_type = self._normalize_task_type(
            requested_task_type
            or data.get("type")
            or data.get("task_type")
            or content.get("type")
        )
        resolved_subtype = str(
            subtype
            or data.get("subtype")
            or content.get("subtype")
            or ""
        ).strip().lower() or None
        return resolved_task_type, resolved_subtype

    @staticmethod
    def _normalize_levels(levels: Optional[List[Any]], supported_levels: Optional[List[int]] = None) -> List[int]:
        normalized: List[int] = []
        seen = set()
        allowed = {int(level) for level in (supported_levels or []) if isinstance(level, int)}

        for raw_level in levels or []:
            try:
                level = int(raw_level)
            except Exception:
                continue
            if level < 1:
                continue
            if allowed and level not in allowed:
                continue
            if level in seen:
                continue
            normalized.append(level)
            seen.add(level)

        normalized.sort()
        return normalized

    def get_task_difficulty_metadata(self, task_type: Optional[str], subtype: Optional[str] = None) -> Dict[str, Any]:
        return get_task_difficulty_metadata(self._normalize_task_type(task_type), subtype)

    def _get_supported_levels(self, task_type: str, subtype: Optional[str] = None) -> List[int]:
        metadata = self.get_task_difficulty_metadata(task_type, subtype)
        supported_levels = self._normalize_levels(metadata.get("supported_levels"))
        if supported_levels:
            return supported_levels
        return self.default_levels.get(self._normalize_task_type(task_type), [1])

    def _load_task_data_from_ref(self, task_ref: Optional[str]) -> Optional[Dict[str, Any]]:
        if not task_ref:
            return None
        if task_ref in self._task_payload_cache:
            return copy.deepcopy(self._task_payload_cache[task_ref])
        if self.storage_service is None:
            return None

        try:
            parts = [str(part).strip() for part in str(task_ref).split("/") if str(part).strip()]
            if len(parts) < 3:
                return None
            payload = self.storage_service.load_task(parts[0], parts[1], parts[2])
            task_data = payload.get("task_data") if isinstance(payload, dict) else None
            cached = copy.deepcopy(task_data) if isinstance(task_data, dict) else None
            self._task_payload_cache[task_ref] = cached
            return copy.deepcopy(cached)
        except Exception as exc:
            self.logger.debug("Failed to load task payload for %s: %s", task_ref, exc)
            self._task_payload_cache[task_ref] = None
            return None

    def _get_task_override_levels(self, task_ref: Optional[str], supported_levels: List[int]) -> List[int]:
        if not task_ref:
            return []
        override = self.config.get("task_overrides", {}).get(task_ref) or {}
        return self._normalize_levels(override.get("levels"), supported_levels=supported_levels)

    def _get_type_override_levels(self, task_type: str, supported_levels: List[int]) -> List[int]:
        override = self.config.get("type_overrides", {}).get(self._normalize_task_type(task_type)) or {}
        try:
            max_level = int(override.get("max_level"))
        except Exception:
            return []
        del supported_levels
        return self._normalize_levels(list(range(1, max_level + 1)))

    def _get_task_authored_levels(
        self,
        task_data: Optional[Dict[str, Any]],
        *,
        supported_levels: List[int],
        authoring_enabled: bool,
    ) -> List[int]:
        if not authoring_enabled or not isinstance(task_data, dict):
            return []
        settings = task_data.get("settings")
        if not isinstance(settings, dict):
            return []

        for field_name in ("allowed_difficulties", "available_difficulties"):
            if field_name not in settings:
                continue
            return self._normalize_levels(settings.get(field_name), supported_levels=supported_levels)
        return []

    def get_available_levels(
        self,
        task_type: str,
        task_ref: Optional[str] = None,
        task_data: Optional[Dict[str, Any]] = None,
        subtype: Optional[str] = None,
    ) -> List[int]:
        resolved_task_data = (
            copy.deepcopy(task_data)
            if isinstance(task_data, dict)
            else self._load_task_data_from_ref(task_ref)
        )
        resolved_task_type, resolved_subtype = self._resolve_task_identity(task_type, resolved_task_data, subtype)
        supported_levels = self._get_supported_levels(resolved_task_type, resolved_subtype)
        metadata = self.get_task_difficulty_metadata(resolved_task_type, resolved_subtype)

        if self.hooks_available and difficulty_hooks:
            plugin_levels = difficulty_hooks.call_get_levels(resolved_task_type, task_ref)
            if plugin_levels is not None:
                normalized_plugin_levels = self._normalize_levels(plugin_levels, supported_levels=supported_levels)
                if normalized_plugin_levels:
                    return normalized_plugin_levels

        override_levels = self._get_task_override_levels(task_ref, supported_levels)
        if override_levels:
            return override_levels

        type_override_levels = self._get_type_override_levels(resolved_task_type, supported_levels)
        base_levels = type_override_levels or supported_levels

        authored_levels = self._get_task_authored_levels(
            resolved_task_data,
            supported_levels=base_levels,
            authoring_enabled=bool(metadata.get("authoring_enabled")),
        )
        if authored_levels:
            return authored_levels

        if type_override_levels:
            return type_override_levels

        return supported_levels or self.default_levels.get(resolved_task_type, [1])

    def uses_explicit_level_selection(
        self,
        task_type: str,
        task_ref: Optional[str] = None,
        task_data: Optional[Dict[str, Any]] = None,
        subtype: Optional[str] = None,
    ) -> bool:
        resolved_task_data = (
            copy.deepcopy(task_data)
            if isinstance(task_data, dict)
            else self._load_task_data_from_ref(task_ref)
        )
        resolved_task_type, resolved_subtype = self._resolve_task_identity(task_type, resolved_task_data, subtype)
        supported_levels = self._get_supported_levels(resolved_task_type, resolved_subtype)
        metadata = self.get_task_difficulty_metadata(resolved_task_type, resolved_subtype)

        if self.hooks_available and difficulty_hooks:
            plugin_levels = difficulty_hooks.call_get_levels(resolved_task_type, task_ref)
            if plugin_levels is not None:
                normalized_plugin_levels = self._normalize_levels(plugin_levels, supported_levels=supported_levels)
                if normalized_plugin_levels:
                    return normalized_plugin_levels != supported_levels

        override_levels = self._get_task_override_levels(task_ref, supported_levels)
        if override_levels:
            return override_levels != supported_levels

        type_override_levels = self._get_type_override_levels(resolved_task_type, supported_levels)
        base_levels = type_override_levels or supported_levels
        authored_levels = self._get_task_authored_levels(
            resolved_task_data,
            supported_levels=base_levels,
            authoring_enabled=bool(metadata.get("authoring_enabled")),
        )
        if authored_levels:
            return authored_levels != base_levels

        return False

    def get_smart_retry_config(self) -> Dict[str, Any]:
        return self.config.get(
            "smart_retry_defaults",
            {
                "near_offset": 2,
                "near_jitter_max": 2,
                "max_copies": 5,
                "training_control_enabled": True,
            },
        )

    @staticmethod
    def normalize_requested_level(requested_level: Any, available_levels: List[int]) -> int:
        normalized_levels = sorted(int(level) for level in available_levels if isinstance(level, int))
        if not normalized_levels:
            return 1

        try:
            requested = int(requested_level)
        except Exception:
            return normalized_levels[0]

        if requested in normalized_levels:
            return requested

        lower_or_equal = [level for level in normalized_levels if level <= requested]
        if lower_or_equal:
            return lower_or_equal[-1]
        return normalized_levels[0]

    @classmethod
    def get_next_allowed_level(cls, current_level: Any, available_levels: List[int]) -> int:
        normalized_levels = sorted(int(level) for level in available_levels if isinstance(level, int))
        if not normalized_levels:
            return 1
        current = cls.normalize_requested_level(current_level, normalized_levels)
        for level in normalized_levels:
            if level > current:
                return level
        return normalized_levels[-1]

    @classmethod
    def get_previous_allowed_level(cls, current_level: Any, available_levels: List[int]) -> int:
        normalized_levels = sorted(int(level) for level in available_levels if isinstance(level, int))
        if not normalized_levels:
            return 1
        current = cls.normalize_requested_level(current_level, normalized_levels)
        previous = normalized_levels[0]
        for level in normalized_levels:
            if level >= current:
                return previous
            previous = level
        return normalized_levels[-1]

    @staticmethod
    def get_progression_step_count(available_levels: List[int]) -> int:
        normalized_levels = [int(level) for level in available_levels if isinstance(level, int)]
        return max(1, len(normalized_levels))

    @classmethod
    def get_iteration_level_by_step(cls, target_step: Any, available_levels: List[int]) -> int:
        normalized_levels = sorted(int(level) for level in available_levels if isinstance(level, int))
        if not normalized_levels:
            return 1
        try:
            step = max(1, int(target_step))
        except Exception:
            step = 1
        return normalized_levels[min(step - 1, len(normalized_levels) - 1)]

    def enhance_task_for_level(
        self,
        task_data: Dict[str, Any],
        level: int,
        task_ref: Optional[str] = None,
    ) -> Dict[str, Any]:
        try:
            if not isinstance(task_data, dict):
                return {"_difficulty_enhanced": False}
            enhanced = copy.deepcopy(task_data or {})
            task_type, subtype = self._resolve_task_identity(task_data=enhanced)
            del subtype
            try:
                normalized_level = max(1, int(level))
            except Exception:
                normalized_level = 1

            original_type = enhanced.get("type") or enhanced.get("content", {}).get("type", "unknown")
            enhanced["_difficulty_enhanced"] = True
            enhanced["_original_type"] = original_type
            enhanced["_difficulty_level"] = normalized_level

            if self.hooks_available and difficulty_hooks:
                enhanced = difficulty_hooks.call_before_enhance(enhanced, normalized_level, task_ref)

            if task_type == "click":
                enhanced = self._enhance_click_task(enhanced, normalized_level)
            elif task_type == "draw":
                enhanced = self._enhance_draw_task(enhanced, normalized_level)
            elif task_type == "test":
                enhanced = self._enhance_test_task(enhanced, normalized_level)
            elif task_type == "sequence_assembly":
                enhanced = self._enhance_sequence_task(enhanced, normalized_level)
            elif task_type == "image_labeling":
                enhanced = self._enhance_image_labeling_task(enhanced, normalized_level)
            elif task_type == "open_answer":
                pass
            elif self.hooks_available and difficulty_hooks:
                plugin_levels = difficulty_hooks.call_get_levels(task_type, task_ref)
                if plugin_levels and normalized_level in plugin_levels:
                    enhanced = difficulty_hooks.call_before_enhance(enhanced, normalized_level, task_ref)

            if self.hooks_available and difficulty_hooks:
                enhanced = difficulty_hooks.call_after_enhance(enhanced, normalized_level, task_ref)

            return enhanced
        except Exception as exc:
            self.logger.error("Failed to enhance task for level %s (%s): %s", level, task_ref, exc)
            original = copy.deepcopy(task_data or {})
            original["_difficulty_enhanced"] = False
            return original

    def _enhance_click_task(self, task_data: Dict[str, Any], level: int) -> Dict[str, Any]:
        content = task_data.get("content", {})

        if level == 1:
            content["mode"] = "click"
            content["requires_labels"] = False
            content["requires_drawing"] = False
        elif level == 2:
            content["mode"] = "click_and_label"
            content["requires_labels"] = True
            content["requires_drawing"] = False
            original_prompt = content.get("prompt", "Кликните на область")
            content["prompt"] = f"{original_prompt} и назовите её"
        elif level >= 3:
            content["mode"] = "draw_and_label"
            content["requires_labels"] = True
            content["requires_drawing"] = True
            original_prompt = content.get("prompt", "Кликните на область")
            content["prompt"] = f"Обведите контур и назовите: {original_prompt}"

        task_data["content"] = content
        return task_data

    def _enhance_draw_task(self, task_data: Dict[str, Any], level: int) -> Dict[str, Any]:
        content = task_data.get("content", {})

        if level == 1:
            content["mode"] = "draw"
            content["requires_labels"] = False
            content["requires_explanation"] = False
            content["requires_drawing"] = False
        elif level == 2:
            content["mode"] = "draw_and_label"
            content["requires_labels"] = True
            content["requires_drawing"] = True
            content["requires_explanation"] = False
            original_prompt = content.get("prompt", "Обведите контур")
            content["prompt"] = f"Обведите контур и назовите: {original_prompt}"
        elif level >= 3:
            content["mode"] = "draw_multiple_and_explain"
            content["requires_labels"] = True
            content["requires_explanation"] = True
            content["requires_drawing"] = True
            original_prompt = content.get("prompt", "Обведите контур")
            content["prompt"] = f"Обведите несколько связанных структур и опишите связь между ними: {original_prompt}"

        task_data["content"] = content
        return task_data

    def _enhance_test_task(self, task_data: Dict[str, Any], level: int) -> Dict[str, Any]:
        content = task_data.get("content", {})
        content.pop("show_level_labels", None)
        content.pop("show_block_labels", None)
        content.pop("requires_level_names", None)
        content.pop("requires_block_names", None)

        if level <= 1:
            content["mode"] = "multiple_choice"
            content["show_options"] = True
            content["requires_text_input"] = False
        else:
            content["mode"] = "open_question"
            content["show_options"] = False
            content["requires_text_input"] = True

        task_data["content"] = content
        return task_data

    def _enhance_sequence_task(self, task_data: Dict[str, Any], level: int) -> Dict[str, Any]:
        content = task_data.get("content", {})
        content.pop("show_options", None)
        content.pop("requires_text_input", None)

        if level == 1:
            content["show_level_labels"] = True
            content["show_block_labels"] = True
            content["requires_level_names"] = False
            content["requires_block_names"] = False
        elif level == 2:
            content["show_level_labels"] = False
            content["show_block_labels"] = True
            content["requires_level_names"] = True
            content["requires_block_names"] = False
        elif level >= 3:
            content["show_level_labels"] = False
            content["show_block_labels"] = False
            content["requires_level_names"] = True
            content["requires_block_names"] = True

        task_data["content"] = content
        return task_data

    def _enhance_image_labeling_task(self, task_data: Dict[str, Any], level: int) -> Dict[str, Any]:
        content = task_data.get("content", {})
        if level == 1:
            content["requires_typing"] = False
        elif level >= 2:
            content["requires_typing"] = True
        task_data["content"] = content
        return task_data

    def _should_use_draw_instead_of_click(self, task_data: Dict[str, Any]) -> bool:
        content = task_data.get("content", {})
        annotations = content.get("annotations", [])
        for annotation in annotations:
            annotation_type = annotation.get("type", "")
            shape = annotation.get("shape", "")
            if annotation_type == "freehand" or shape == "freehand":
                return True
        return False

    def get_initial_level(self, task_data: Dict[str, Any]) -> int:
        default_level = task_data.get("settings", {}).get("difficulty", 1)
        task_type, subtype = self._resolve_task_identity(task_data=task_data)
        available_levels = self.get_available_levels(task_type, task_data=task_data, subtype=subtype)
        return self.normalize_requested_level(default_level, available_levels)
