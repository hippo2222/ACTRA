"""
Unit tests for StorageService — T2 coverage plan.

Covers:
- _validate_id (path-traversal prevention)
- _convert_datetime_to_str (recursive datetime conversion)
- _normalize_answer_key (click, draw, open_answer, sequence_assembly)
- _resolve_task_path (various path formats)
- get_image_path
- reload_modules (cache invalidation)
- Filesystem round-trips: load_modules, get_module, get_topics, get_topic,
  get_tasks, load_task, delete_task, delete_module, delete_topic,
  rename_module, rename_topic
"""

import sys
import os
import json
import pytest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.storage_service import StorageService


# ─── Helpers ───────────────────────────────────────────────────────


def _make_module(data_dir: Path, module_id: str, module_name: str, topics=None):
    """Create a module directory with module.json."""
    mod_dir = data_dir / "modules" / module_id
    mod_dir.mkdir(parents=True, exist_ok=True)
    payload = {"id": module_id, "name": module_name, "topics": topics or []}
    (mod_dir / "module.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return mod_dir


def _make_topic(data_dir: Path, module_id: str, topic_id: str, topic_name: str):
    """Create a topic directory with topic.json (no tasks)."""
    topic_dir = data_dir / "modules" / module_id / "topics" / topic_id
    topic_dir.mkdir(parents=True, exist_ok=True)
    payload = {"id": topic_id, "name": topic_name}
    (topic_dir / "topic.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return topic_dir


def _make_task(data_dir: Path, module_id: str, topic_id: str, task_id: str,
               task_type: str = "click", answer_key: dict = None):
    """Create a task directory with task.json and optional answer_key.json."""
    task_dir = data_dir / "modules" / module_id / "topics" / topic_id / "tasks" / task_id
    task_dir.mkdir(parents=True, exist_ok=True)
    task_data = {
        "id": task_id,
        "name": f"Task {task_id}",
        "type": task_type,
        "content": {},
        "meta": {"created_at": "2024-01-01T00:00:00"},
    }
    (task_dir / "task.json").write_text(json.dumps(task_data, ensure_ascii=False), encoding="utf-8")
    if answer_key is not None:
        (task_dir / "answer_key.json").write_text(json.dumps(answer_key, ensure_ascii=False), encoding="utf-8")
    return task_dir


# ─── Fixtures ──────────────────────────────────────────────────────


@pytest.fixture
def data_dir(tmp_path):
    """Create an empty data directory."""
    d = tmp_path / "data"
    d.mkdir()
    return d


@pytest.fixture
def svc(data_dir):
    """StorageService pointing at the temporary data directory."""
    return StorageService(str(data_dir))


@pytest.fixture
def populated(data_dir):
    """Populate data_dir with one module / one topic / one task and return svc."""
    _make_module(data_dir, "mod1", "Module 1")
    _make_topic(data_dir, "mod1", "topic1", "Topic 1")
    _make_task(data_dir, "mod1", "topic1", "task1", answer_key={"targets": []})
    return StorageService(str(data_dir))


# ═══════════════════════════════════════════════════════════════════
# _validate_id
# ═══════════════════════════════════════════════════════════════════


class TestValidateId:
    def test_valid_id(self, svc):
        svc._validate_id("anatomy_01", "module_id")  # should not raise

    def test_empty_raises(self, svc):
        with pytest.raises(ValueError, match="cannot be empty"):
            svc._validate_id("", "module_id")

    def test_path_traversal_dots(self, svc):
        with pytest.raises(ValueError, match="unsafe"):
            svc._validate_id("../etc", "module_id")

    def test_path_traversal_slash(self, svc):
        with pytest.raises(ValueError, match="unsafe"):
            svc._validate_id("a/b", "module_id")

    def test_path_traversal_backslash(self, svc):
        with pytest.raises(ValueError, match="unsafe"):
            svc._validate_id("a\\b", "module_id")


# ═══════════════════════════════════════════════════════════════════
# _convert_datetime_to_str
# ═══════════════════════════════════════════════════════════════════


class TestConvertDatetime:
    def test_datetime_converted(self, svc):
        dt = datetime(2024, 1, 15, 12, 0, 0)
        assert svc._convert_datetime_to_str(dt) == "2024-01-15T12:00:00"

    def test_nested_dict(self, svc):
        dt = datetime(2024, 6, 1)
        result = svc._convert_datetime_to_str({"a": dt, "b": {"c": dt}})
        assert result["a"] == "2024-06-01T00:00:00"
        assert result["b"]["c"] == "2024-06-01T00:00:00"

    def test_list(self, svc):
        dt = datetime(2024, 3, 1)
        result = svc._convert_datetime_to_str([dt, "hello", 42])
        assert result[0] == "2024-03-01T00:00:00"
        assert result[1] == "hello"
        assert result[2] == 42

    def test_plain_values_unchanged(self, svc):
        assert svc._convert_datetime_to_str(42) == 42
        assert svc._convert_datetime_to_str("text") == "text"
        assert svc._convert_datetime_to_str(None) is None


# ═══════════════════════════════════════════════════════════════════
# _normalize_answer_key
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeAnswerKey:
    def test_click_targets_preserved(self, svc):
        ak = {"targets": [{"shape": "point", "point": [10, 20]}]}
        result = svc._normalize_answer_key({"type": "click", "content": {}}, ak)
        assert result["targets"] == ak["targets"]

    def test_click_annotations_to_targets(self, svc):
        task_data = {
            "type": "click",
            "content": {
                "annotations": [
                    {"type": "point", "point": [10, 20], "label": "A"},
                    {"type": "polygon", "points": [[0, 0], [1, 0], [1, 1]], "label": "B"},
                ]
            },
        }
        result = svc._normalize_answer_key(task_data, {})
        assert len(result["targets"]) == 2
        assert result["targets"][0]["shape"] == "point"
        assert result["targets"][1]["shape"] == "polygon"

    def test_click_freehand_annotation(self, svc):
        task_data = {
            "type": "click",
            "content": {
                "annotations": [
                    {"type": "freehand", "points": [[0, 0], [10, 10]], "label": "Line", "tolerance_px": 5},
                ]
            },
        }
        result = svc._normalize_answer_key(task_data, {})
        assert result["targets"][0]["shape"] == "freehand"
        assert result["targets"][0]["tolerance_px"] == 5

    def test_open_answer_keywords(self, svc):
        task_data = {
            "type": "open_answer",
            "content": {"keywords": ["heart", "blood"], "reference_answer": "Heart pumps blood"},
        }
        result = svc._normalize_answer_key(task_data, {})
        assert result["keywords"] == ["heart", "blood"]
        assert result["reference_answer"] == "Heart pumps blood"

    def test_open_answer_sequence_matters(self, svc):
        task_data = {
            "type": "open_answer",
            "content": {"keywords": ["a"], "sequence_matters": True},
            "settings": {},
        }
        result = svc._normalize_answer_key(task_data, {})
        assert result["sequence_matters"] is True

    def test_sequence_assembly_from_content(self, svc):
        task_data = {
            "type": "sequence_assembly",
            "content": {
                "sequence": [
                    {"id": "l1", "title": "Level 1", "items": [{"id": "b1", "label": "Block1"}]},
                ],
                "order_inside_matters": True,
            },
        }
        result = svc._normalize_answer_key(task_data, {})
        assert len(result["levels"]) == 1
        assert result["levels"][0]["level_name"] == "Level 1"
        assert result["sequence_within_level_matters"] is True

    def test_draw_regions_to_targets(self, svc):
        task_data = {
            "type": "draw",
            "content": {
                "regions": [
                    {"type": "polygon", "points": [[0, 0], [50, 0], [50, 50], [0, 50]], "label": "Region"},
                ]
            },
        }
        result = svc._normalize_answer_key(task_data, {})
        assert len(result["targets"]) == 1
        assert result["targets"][0]["shape"] == "polygon"

    def test_unknown_type_passthrough(self, svc):
        result = svc._normalize_answer_key({"type": "custom"}, {"custom_key": 42})
        assert result["custom_key"] == 42

    def test_none_answer_key(self, svc):
        result = svc._normalize_answer_key({"type": "click", "content": {}}, None)
        assert isinstance(result, dict)


# ═══════════════════════════════════════════════════════════════════
# _resolve_task_path
# ═══════════════════════════════════════════════════════════════════


class TestResolveTaskPath:
    def test_modules_prefix(self, svc):
        p = svc._resolve_task_path("modules/mod/topics/t/tasks/x/task.json")
        assert str(p).endswith("task.json")
        assert "modules" in str(p)

    def test_data_prefix(self, svc):
        p = svc._resolve_task_path("data/modules/mod/task.json")
        assert "modules" in str(p)

    def test_legacy_prefix(self, svc):
        p = svc._resolve_task_path("../data/modules/mod/task.json")
        assert "modules" in str(p)

    def test_backslash_normalized(self, svc):
        p = svc._resolve_task_path("modules\\mod\\task.json")
        assert "modules" in str(p)

    def test_absolute_path(self, data_dir):
        svc = StorageService(str(data_dir))
        abs_path = str(data_dir / "modules" / "x" / "task.json")
        result = svc._resolve_task_path(abs_path)
        assert str(result) == abs_path


# ═══════════════════════════════════════════════════════════════════
# get_image_path
# ═══════════════════════════════════════════════════════════════════


class TestGetImagePath:
    def test_relative(self, svc, data_dir):
        p = svc.get_image_path("modules/mod/images/img.jpg")
        assert p == data_dir / "modules" / "mod" / "images" / "img.jpg"


# ═══════════════════════════════════════════════════════════════════
# Filesystem: load_modules / get_module
# ═══════════════════════════════════════════════════════════════════


class TestLoadModules:
    def test_empty_dir(self, svc):
        modules = svc.load_modules()
        assert modules == []

    def test_explicit_module(self, data_dir, svc):
        _make_module(data_dir, "mod1", "Module 1")
        modules = svc.load_modules()
        assert len(modules) == 1
        assert modules[0]["id"] == "mod1"
        assert modules[0]["name"] == "Module 1"

    def test_multiple_modules(self, data_dir, svc):
        _make_module(data_dir, "a", "A")
        _make_module(data_dir, "b", "B")
        modules = svc.load_modules()
        ids = {m["id"] for m in modules}
        assert ids == {"a", "b"}

    def test_cache_works(self, data_dir, svc):
        _make_module(data_dir, "mod1", "Module 1")
        m1 = svc.load_modules()
        m2 = svc.load_modules()
        assert m1 is m2  # same object from cache

    def test_get_module_found(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        svc = StorageService(str(data_dir))
        mod = svc.get_module("mod1")
        assert mod is not None
        assert mod["name"] == "Module 1"

    def test_get_module_not_found(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        svc = StorageService(str(data_dir))
        assert svc.get_module("nonexistent") is None

    def test_implicit_module_with_topics(self, data_dir):
        """A directory without module.json but with topics subdirectory."""
        _make_topic(data_dir, "implicit", "t1", "Topic 1")
        _make_task(data_dir, "implicit", "t1", "task1")
        svc = StorageService(str(data_dir))
        modules = svc.load_modules()
        implicit = [m for m in modules if m["id"] == "implicit"]
        assert len(implicit) == 1
        assert len(implicit[0]["topics"]) == 1


# ═══════════════════════════════════════════════════════════════════
# Filesystem: topics
# ═══════════════════════════════════════════════════════════════════


class TestTopics:
    def test_get_topics_from_explicit_module(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        _make_topic(data_dir, "mod1", "t2", "Topic 2")
        svc = StorageService(str(data_dir))
        topics = svc.get_topics("mod1")
        assert len(topics) == 2
        ids = {t["id"] for t in topics}
        assert ids == {"t1", "t2"}

    def test_get_topic_found(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        svc = StorageService(str(data_dir))
        topic = svc.get_topic("mod1", "t1")
        assert topic is not None
        assert topic["name"] == "Topic 1"

    def test_get_topic_not_found(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        svc = StorageService(str(data_dir))
        assert svc.get_topic("mod1", "nonexistent") is None

    def test_get_topics_module_not_found(self, svc):
        assert svc.get_topics("nonexistent") == []


# ═══════════════════════════════════════════════════════════════════
# Filesystem: tasks
# ═══════════════════════════════════════════════════════════════════


class TestTasks:
    def test_get_tasks(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        _make_task(data_dir, "mod1", "t1", "task1")
        _make_task(data_dir, "mod1", "t1", "task2", task_type="draw")
        svc = StorageService(str(data_dir))
        tasks = svc.get_tasks("mod1", "t1")
        assert len(tasks) == 2
        ids = {t["id"] for t in tasks}
        assert ids == {"task1", "task2"}

    def test_get_tasks_empty(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        svc = StorageService(str(data_dir))
        assert svc.get_tasks("mod1", "t1") == []

    def test_load_task_full(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        _make_task(data_dir, "mod1", "t1", "task1", answer_key={"targets": [{"shape": "point", "point": [1, 2]}]})
        svc = StorageService(str(data_dir))
        result = svc.load_task("mod1", "t1", "task1")
        assert result is not None
        assert result["task_data"]["id"] == "task1"
        assert result["task_data"]["type"] == "click"
        assert isinstance(result["answer_key"], dict)
        assert "task_dir" in result

    def test_load_task_no_answer_key(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        _make_task(data_dir, "mod1", "t1", "task1")  # no answer_key
        svc = StorageService(str(data_dir))
        result = svc.load_task("mod1", "t1", "task1")
        assert result is not None
        assert result["answer_key"] == {}

    def test_load_task_not_found(self, populated):
        assert populated.load_task("mod1", "topic1", "nonexistent") is None

    def test_load_task_route_context(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        _make_task(data_dir, "mod1", "t1", "task1")
        svc = StorageService(str(data_dir))
        result = svc.load_task("mod1", "t1", "task1")
        assert result["metadata"]["module"] == "mod1"
        assert result["metadata"]["topic"] == "t1"


# ═══════════════════════════════════════════════════════════════════
# Filesystem: delete operations
# ═══════════════════════════════════════════════════════════════════


class TestDeleteOperations:
    def test_delete_task(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        _make_task(data_dir, "mod1", "t1", "task1")
        svc = StorageService(str(data_dir))
        assert svc.delete_task("mod1", "t1", "task1") is True
        task_dir = data_dir / "modules" / "mod1" / "topics" / "t1" / "tasks" / "task1"
        assert not task_dir.exists()

    def test_delete_task_not_found(self, populated):
        assert populated.delete_task("mod1", "topic1", "nonexistent") is False

    def test_delete_module(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        svc = StorageService(str(data_dir))
        assert svc.delete_module("mod1") is True
        assert not (data_dir / "modules" / "mod1").exists()

    def test_delete_module_not_found(self, svc):
        assert svc.delete_module("nonexistent") is False

    def test_delete_topic(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        svc = StorageService(str(data_dir))
        assert svc.delete_topic("mod1", "t1") is True
        assert not (data_dir / "modules" / "mod1" / "topics" / "t1").exists()

    def test_delete_topic_invalidates_cache(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        svc = StorageService(str(data_dir))
        svc.load_modules()  # populate cache
        svc.delete_topic("mod1", "t1")
        assert svc._modules_cache is None


# ═══════════════════════════════════════════════════════════════════
# Filesystem: rename operations
# ═══════════════════════════════════════════════════════════════════


class TestRenameOperations:
    def test_rename_module(self, data_dir):
        _make_module(data_dir, "mod1", "Old Name")
        svc = StorageService(str(data_dir))
        assert svc.rename_module("mod1", "New Name") is True
        with open(data_dir / "modules" / "mod1" / "module.json", encoding="utf-8") as f:
            data = json.load(f)
        assert data["name"] == "New Name"

    def test_rename_module_empty_name(self, data_dir):
        _make_module(data_dir, "mod1", "Name")
        svc = StorageService(str(data_dir))
        assert svc.rename_module("mod1", "") is False

    def test_rename_module_not_found(self, svc):
        assert svc.rename_module("nonexistent", "Name") is False

    def test_rename_topic(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Old Topic")
        svc = StorageService(str(data_dir))
        assert svc.rename_topic("mod1", "t1", "New Topic") is True
        with open(data_dir / "modules" / "mod1" / "topics" / "t1" / "topic.json", encoding="utf-8") as f:
            data = json.load(f)
        assert data["name"] == "New Topic"

    def test_rename_topic_empty_name(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Topic")
        svc = StorageService(str(data_dir))
        assert svc.rename_topic("mod1", "t1", "") is False

    def test_rename_topic_updates_module_json(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1", topics=[{"id": "t1", "name": "Old"}])
        _make_topic(data_dir, "mod1", "t1", "Old")
        svc = StorageService(str(data_dir))
        svc.rename_topic("mod1", "t1", "New")
        with open(data_dir / "modules" / "mod1" / "module.json", encoding="utf-8") as f:
            data = json.load(f)
        t = next(t for t in data["topics"] if t["id"] == "t1")
        assert t["name"] == "New"


# ═══════════════════════════════════════════════════════════════════
# reload_modules
# ═══════════════════════════════════════════════════════════════════


class TestReloadModules:
    def test_reload_clears_cache(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        svc = StorageService(str(data_dir))
        svc.load_modules()
        assert svc._modules_cache is not None
        svc.reload_modules()
        # After reload, cache is repopulated (not None)
        assert svc._modules_cache is not None

    def test_reload_picks_up_new_module(self, data_dir):
        svc = StorageService(str(data_dir))
        assert svc.load_modules() == []
        _make_module(data_dir, "mod1", "Module 1")
        svc.reload_modules()
        assert len(svc.load_modules()) == 1


# ═══════════════════════════════════════════════════════════════════
# delete_task removes from module.json
# ═══════════════════════════════════════════════════════════════════


class TestDeleteTaskFromModuleJson:
    def test_delete_removes_from_json(self, data_dir):
        topics_data = [
            {"id": "t1", "name": "Topic 1", "tasks": [{"id": "task1", "name": "T1"}, {"id": "task2", "name": "T2"}]}
        ]
        _make_module(data_dir, "mod1", "Module 1", topics=topics_data)
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        _make_task(data_dir, "mod1", "t1", "task1")
        _make_task(data_dir, "mod1", "t1", "task2")

        svc = StorageService(str(data_dir))
        svc.delete_task("mod1", "t1", "task1")

        with open(data_dir / "modules" / "mod1" / "module.json", encoding="utf-8") as f:
            mod = json.load(f)
        remaining = mod["topics"][0]["tasks"]
        assert len(remaining) == 1
        assert remaining[0]["id"] == "task2"


# ═══════════════════════════════════════════════════════════════════
# delete_topic removes from module.json
# ═══════════════════════════════════════════════════════════════════


class TestDeleteTopicFromModuleJson:
    def test_delete_removes_from_json(self, data_dir):
        topics_data = [{"id": "t1", "name": "Topic 1"}, {"id": "t2", "name": "Topic 2"}]
        _make_module(data_dir, "mod1", "Module 1", topics=topics_data)
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        _make_topic(data_dir, "mod1", "t2", "Topic 2")

        svc = StorageService(str(data_dir))
        svc.delete_topic("mod1", "t1")

        with open(data_dir / "modules" / "mod1" / "module.json", encoding="utf-8") as f:
            mod = json.load(f)
        assert len(mod["topics"]) == 1
        assert mod["topics"][0]["id"] == "t2"


# ═══════════════════════════════════════════════════════════════════
# _enrich_tasks_with_metadata
# ═══════════════════════════════════════════════════════════════════


class TestEnrichTasks:
    def test_no_tasks(self, svc):
        assert svc._enrich_tasks_with_metadata(None, "mod1", None) == []
        assert svc._enrich_tasks_with_metadata([], "mod1", None) == []

    def test_enriches_from_disk(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        task_dir = _make_task(data_dir, "mod1", "t1", "task1", task_type="draw")
        svc = StorageService(str(data_dir))
        topic_path = data_dir / "modules" / "mod1" / "topics" / "t1"
        result = svc._enrich_tasks_with_metadata([{"id": "task1"}], "mod1", topic_path)
        assert len(result) == 1
        assert result[0]["type"] == "draw"
        assert result[0]["name"] == "Task task1"


# ═══════════════════════════════════════════════════════════════════
# Edge cases / invalid JSON
# ═══════════════════════════════════════════════════════════════════


class TestEdgeCases:
    def test_invalid_json_task(self, data_dir):
        _make_module(data_dir, "mod1", "Module 1")
        _make_topic(data_dir, "mod1", "t1", "Topic 1")
        task_dir = data_dir / "modules" / "mod1" / "topics" / "t1" / "tasks" / "bad"
        task_dir.mkdir(parents=True)
        (task_dir / "task.json").write_text("{invalid json", encoding="utf-8")
        svc = StorageService(str(data_dir))
        tasks = svc.get_tasks("mod1", "t1")
        # Bad JSON should be skipped, not crash
        assert len(tasks) == 0

    def test_module_json_invalid(self, data_dir):
        mod_dir = data_dir / "modules" / "bad"
        mod_dir.mkdir(parents=True)
        (mod_dir / "module.json").write_text("{bad}", encoding="utf-8")
        svc = StorageService(str(data_dir))
        modules = svc.load_modules()
        # Should not crash, module should be skipped
        assert len([m for m in modules if m.get("id") == "bad"]) == 0
