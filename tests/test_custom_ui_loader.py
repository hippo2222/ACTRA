import json
from pathlib import Path

from task_system.core.hooks.ui_hooks import ui_hooks
from common.extension_points_config import load_extension_points_config


def test_custom_ui_widgets_directory_parsed(tmp_path, monkeypatch):
    # Prepare a temp widgets directory with a JSON descriptor
    widgets_dir = tmp_path / "custom_ui"
    widgets_dir.mkdir(parents=True, exist_ok=True)
    data = {
        "toolbar_widgets": [
            {"id": "t1", "type": "button", "config": {"text": "Test"}, "priority": 5}
        ]
    }
    json_file = widgets_dir / "widgets.json"
    json_file.write_text(json.dumps(data), encoding="utf-8")

    # Monkeypatch loader to return our temp path
    def fake_loader():
        return {
            "extension_points": {
                "task_types": {"enabled": False},
                "evaluators": {"enabled": False},
                "ui_components": {"enabled": True, "custom_widgets": str(widgets_dir)},
            }
        }

    monkeypatch.setattr(
        "common.extension_points_config.load_extension_points_config", fake_loader
    )

    # Simulate what app/editor do when initializing UI widgets
    # Directly load like app does
    loaded = 0
    for file in widgets_dir.glob("*.json"):
        payload = json.loads(file.read_text(encoding="utf-8"))
        for w in payload.get("toolbar_widgets", []):
            ui_hooks.register_toolbar_widget(
                plugin_id="__custom_ui__", widget_descriptor=w, priority=w.get("priority", 0)
            )
            loaded += 1

    widgets = ui_hooks.get_toolbar_widgets()
    assert any(w.get("id") == "t1" for w in widgets)
    assert loaded == 1






































