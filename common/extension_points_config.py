"""
Extension Points Config Loader.

Loads extension_points_config.json from project root with safe defaults and
shallow merge. Normalizes relative paths against project root.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger(__name__)


DEFAULT_CONFIG: Dict[str, Any] = {
    "extension_points": {
        "task_types": {
            "enabled": True,
            "directory": "custom_task_types/",
            "auto_discover": True,
        },
        "evaluators": {
            "enabled": True,
            "allow_override": True,
        },
        "ui_components": {
            "enabled": True,
            "custom_widgets": "custom_ui/",
        },
    }
}


def _project_root() -> Path:
    # common/extension_points_config.py -> common/ -> project root
    return Path(__file__).parent.parent


def _load_raw_config(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Failed to read extension_points_config.json: {e}")
        return {}


def _shallow_merge(defaults: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    merged = {**defaults}
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = {**merged[key], **value}
        else:
            merged[key] = value
    return merged


def _normalize_paths(cfg: Dict[str, Any]) -> Dict[str, Any]:
    root = _project_root()
    ep = cfg.get("extension_points", {})

    # Normalize task_types.directory
    tt = ep.get("task_types", {})
    directory = tt.get("directory")
    if isinstance(directory, str) and directory:
        p = Path(directory)
        if not p.is_absolute():
            tt["directory"] = str((root / p).resolve())
        else:
            tt["directory"] = str(p)
        ep["task_types"] = tt

    # Normalize ui_components.custom_widgets
    ui = ep.get("ui_components", {})
    widgets_dir = ui.get("custom_widgets")
    if isinstance(widgets_dir, str) and widgets_dir:
        p = Path(widgets_dir)
        if not p.is_absolute():
            ui["custom_widgets"] = str((root / p).resolve())
        else:
            ui["custom_widgets"] = str(p)
        ep["ui_components"] = ui

    cfg["extension_points"] = ep
    return cfg


def load_extension_points_config() -> Dict[str, Any]:
    """
    Loads extension_points_config.json with defaults and path normalization.

    Returns a dict with single key "extension_points".
    """
    root = _project_root()
    path = root / "extension_points_config.json"
    raw = _load_raw_config(path)
    # Shallow merge only within extension_points block
    merged_ep = _shallow_merge(
        DEFAULT_CONFIG.get("extension_points", {}), raw.get("extension_points", {})
    )
    cfg = {"extension_points": merged_ep}
    return _normalize_paths(cfg)


__all__ = ["load_extension_points_config", "DEFAULT_CONFIG"]







































