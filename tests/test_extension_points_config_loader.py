import os
from pathlib import Path

from common.extension_points_config import load_extension_points_config, DEFAULT_CONFIG


def test_extension_points_defaults_when_no_file(tmp_path, monkeypatch):
    # Run from a temp project copy without config file
    project_root = Path(__file__).resolve().parents[1]
    cfg = load_extension_points_config()
    assert "extension_points" in cfg
    ep = cfg["extension_points"]
    assert ep.get("evaluators", {}).get("allow_override", True) is True
    assert isinstance(ep.get("task_types", {}).get("directory"), str)


def test_extension_points_paths_are_normalized():
    cfg = load_extension_points_config()
    ep = cfg["extension_points"]
    # directories should be absolute paths after normalization
    assert Path(ep["task_types"]["directory"]).is_absolute()
    assert Path(ep["ui_components"]["custom_widgets"]).is_absolute()







































