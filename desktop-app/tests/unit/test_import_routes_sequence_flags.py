import sys
from pathlib import Path


DESKTOP_APP_DIR = Path(__file__).resolve().parent.parent.parent
PROJECT_ROOT = DESKTOP_APP_DIR.parent
for p in (str(DESKTOP_APP_DIR), str(PROJECT_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)


from routes import import_routes


def test_sequence_import_respects_explicit_metadata_flags(monkeypatch):
    monkeypatch.setattr(import_routes, "_ih", lambda: {"CURRENT_SCHEMA_VERSION": 1})

    task = {
        "type": "sequence_assembly",
        "name": "seq-1",
        "prompt": "Распределите элементы по группам",
        "data": {
            "elements": {
                "element_1": "A",
                "element_2": "B",
                "element_3": "C",
            },
            "levels": {
                1: ["element_1", "element_2"],
                2: ["element_3"],
            },
            "metadata": {
                "level_order_matters": "false",
                "sequence_within_level_matters": "false",
            },
        },
    }

    payload = import_routes._build_imported_task_payload(task, "m1", "t1", "task-1")
    content = payload["content"]

    assert content["sequence_within_level_matters"] is False
    assert content["level_order_matters"] is False
    assert content["order_inside_matters"] is False
    assert content["elements"] == [
        {"id": "element_1", "text": "A"},
        {"id": "element_2", "text": "B"},
        {"id": "element_3", "text": "C"},
    ]
    assert content["levels"] == [
        {"level_id": "level_1", "blocks": ["element_1", "element_2"], "level_name": "Level 1"},
        {"level_id": "level_2", "blocks": ["element_3"], "level_name": "Level 2"},
    ]
    assert content["sequence"][0]["level_id"] == "level_1"
    assert content["sequence"][1]["level_id"] == "level_2"


def test_sequence_import_infers_linear_order_when_metadata_missing(monkeypatch):
    monkeypatch.setattr(import_routes, "_ih", lambda: {"CURRENT_SCHEMA_VERSION": 1})

    task = {
        "type": "sequence_assembly",
        "name": "seq-2",
        "prompt": "Расположите этапы процесса в правильном порядке",
        "data": {
            "elements": {
                "element_1": "Шаг 1",
                "element_2": "Шаг 2",
                "element_3": "Шаг 3",
            },
            "levels": {
                1: ["element_1"],
                2: ["element_2"],
                3: ["element_3"],
            },
        },
    }

    payload = import_routes._build_imported_task_payload(task, "m1", "t1", "task-2")
    content = payload["content"]

    assert content["level_order_matters"] is True
    assert content["sequence_within_level_matters"] is False


def test_sequence_import_infers_grouping_without_level_order_when_metadata_missing(monkeypatch):
    monkeypatch.setattr(import_routes, "_ih", lambda: {"CURRENT_SCHEMA_VERSION": 1})

    task = {
        "type": "sequence_assembly",
        "name": "seq-3",
        "prompt": "Распределите элементы по группам",
        "data": {
            "elements": {
                "element_1": "Пример A",
                "element_2": "Пример B",
                "element_3": "Пример C",
            },
            "levels": {
                1: ["element_1", "element_2"],
                2: ["element_3"],
            },
        },
    }

    payload = import_routes._build_imported_task_payload(task, "m1", "t1", "task-3")
    content = payload["content"]

    assert content["level_order_matters"] is False
    assert content["sequence_within_level_matters"] is False
