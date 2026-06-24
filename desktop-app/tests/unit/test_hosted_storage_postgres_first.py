"""
Tests for HostedStorageService — Postgres-first behaviour.

All methods are tested in the scenario where shadow filesystem directories
DON'T EXIST (typical after API-based import), verifying that Postgres
catalog is the source of truth and operations succeed regardless of FS state.
"""
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List, Tuple
from unittest.mock import patch


# ---------------------------------------------------------------------------
# Minimal stubs
# ---------------------------------------------------------------------------

class FakeWorkspaceCatalogRepository:
    def __init__(self, initial=None):
        self._catalog = list(initial or [])

    def load_catalog(self):
        return [dict(m) for m in self._catalog]

    def replace_catalog(self, modules):
        self._catalog = [dict(m) for m in modules]

    def ensure_schema(self):
        pass


class FakeTaskContentRepository:
    def __init__(self):
        self._content = {}

    def _key(self, mid, tid, taskid):
        return f"{mid}/{tid}/{taskid}"

    def get_task_content(self, mid, tid, taskid):
        payload = self._content.get(self._key(mid, tid, taskid))
        if not payload:
            return None
        return {
            "module_id": mid,
            "topic_id": tid,
            "task_id": taskid,
            "task_data": payload.get("task_data") or {},
            "answer_key": payload.get("answer_key") or {},
            "updated_at": payload.get("updated_at") or "",
        }

    def upsert_task_content(self, mid, tid, taskid, *, task_data, answer_key, updated_at):
        self._content[self._key(mid, tid, taskid)] = {
            "task_data": task_data,
            "answer_key": answer_key,
            "updated_at": updated_at,
        }

    def delete_task_content(self, mid, tid, taskid):
        self._content.pop(self._key(mid, tid, taskid), None)

    def list_task_refs(self) -> List[Tuple[str, str, str]]:
        refs = []
        for k in self._content.keys():
            parts = k.split("/", 2)
            if len(parts) == 3:
                refs.append((parts[0], parts[1], parts[2]))
        return refs

    def ensure_schema(self):
        pass


def _make_module(module_id, name="Test Module", topics=None):
    return {"id": module_id, "name": name, "topics": topics or []}


def _make_topic(topic_id, name="Test Topic", tasks=None):
    return {"id": topic_id, "name": name, "tasks": tasks or []}


def _make_task(task_id, name="Test Task"):
    return {"id": task_id, "name": name}


# ---------------------------------------------------------------------------
# Test class
# ---------------------------------------------------------------------------

class TestHostedStorageServicePostgresFirst(unittest.TestCase):
    """
    All operations must succeed when shadow filesystem directories do NOT exist.
    Postgres catalog is the single source of truth.
    """

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.data_dir = self.tmp / "data"
        self.data_dir.mkdir()

        from services.hosted_storage_service import HostedStorageService
        from services.storage_service import StorageService

        self.catalog_repo = FakeWorkspaceCatalogRepository()
        self.content_repo = FakeTaskContentRepository()

        patcher = patch(
            "services.hosted_storage_service.HostedStorageService.ensure_persistence_ready",
            return_value=None,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

        self.svc = HostedStorageService.__new__(HostedStorageService)
        StorageService.__init__(self.svc, self.data_dir)
        self.svc.repository = self.catalog_repo
        self.svc.content_repository = self.content_repo
        self.svc._modules_cache = None
        import logging
        self.svc.logger = logging.getLogger("test_hosted")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # --- create_module ---

    def test_create_module_no_shadow_succeeds(self):
        ok = self.svc.create_module("mod_alpha", "Модуль Альфа")
        self.assertTrue(ok)
        ids = [m["id"] for m in self.catalog_repo.load_catalog()]
        self.assertIn("mod_alpha", ids)

    def test_create_module_sets_name(self):
        self.svc.create_module("mod_name", "Правильное имя")
        entry = next(m for m in self.catalog_repo.load_catalog() if m["id"] == "mod_name")
        self.assertEqual(entry["name"], "Правильное имя")

    def test_create_module_duplicate_rejected(self):
        self.catalog_repo.replace_catalog([_make_module("mod_dup")])
        ok = self.svc.create_module("mod_dup", "Дубликат")
        self.assertFalse(ok)
        self.assertEqual(len(self.catalog_repo.load_catalog()), 1)

    # --- create_topic ---

    def test_create_topic_no_shadow_succeeds(self):
        self.catalog_repo.replace_catalog([_make_module("mod_t")])
        ok = self.svc.create_topic("mod_t", "topic_x", "Тема X")
        self.assertTrue(ok)
        mod = next(m for m in self.catalog_repo.load_catalog() if m["id"] == "mod_t")
        topic_ids = [t["id"] for t in mod["topics"]]
        self.assertIn("topic_x", topic_ids)

    def test_create_topic_module_not_in_catalog_fails(self):
        ok = self.svc.create_topic("no_such_mod", "topic_y", "Тема Y")
        self.assertFalse(ok)

    def test_create_topic_duplicate_rejected(self):
        self.catalog_repo.replace_catalog([
            _make_module("mod_t2", topics=[_make_topic("dup_topic")])
        ])
        ok = self.svc.create_topic("mod_t2", "dup_topic", "Дубликат")
        self.assertFalse(ok)

    def test_create_topic_with_theory_link(self):
        self.catalog_repo.replace_catalog([_make_module("mod_th")])
        ok = self.svc.create_topic("mod_th", "topic_th", "Тема",
                                   theory_link={"theory_id": "th_001"})
        self.assertTrue(ok)
        mod = next(m for m in self.catalog_repo.load_catalog() if m["id"] == "mod_th")
        topic = next(t for t in mod["topics"] if t["id"] == "topic_th")
        self.assertEqual(topic.get("theory_link", {}).get("theory_id"), "th_001")

    # --- delete_module ---

    def test_delete_module_catalog_only(self):
        self.catalog_repo.replace_catalog([_make_module("mod_del")])
        ok = self.svc.delete_module("mod_del")
        self.assertTrue(ok)
        ids = [m["id"] for m in self.catalog_repo.load_catalog()]
        self.assertNotIn("mod_del", ids)

    def test_delete_module_not_found_returns_false(self):
        ok = self.svc.delete_module("ghost_module")
        self.assertFalse(ok)

    def test_delete_module_preserves_others(self):
        self.catalog_repo.replace_catalog([_make_module("keep"), _make_module("del2")])
        self.svc.delete_module("del2")
        ids = [m["id"] for m in self.catalog_repo.load_catalog()]
        self.assertIn("keep", ids)
        self.assertNotIn("del2", ids)

    # --- delete_topic ---

    def test_delete_topic_catalog_only(self):
        self.catalog_repo.replace_catalog([
            _make_module("mod_dt", topics=[_make_topic("topic_dt")])
        ])
        ok = self.svc.delete_topic("mod_dt", "topic_dt")
        self.assertTrue(ok)
        mod = next(m for m in self.catalog_repo.load_catalog() if m["id"] == "mod_dt")
        self.assertNotIn("topic_dt", [t["id"] for t in mod["topics"]])

    def test_delete_topic_not_found_returns_false(self):
        self.catalog_repo.replace_catalog([_make_module("mod_ok")])
        ok = self.svc.delete_topic("mod_ok", "ghost_topic")
        self.assertFalse(ok)

    # --- delete_task ---

    def test_delete_task_catalog_only(self):
        """THE MAIN BUG SCENARIO: task only in Postgres, no shadow folder."""
        self.catalog_repo.replace_catalog([
            _make_module("mod_dtask", topics=[
                _make_topic("topic_dtask", tasks=[_make_task("task_ghost")])
            ])
        ])
        self.content_repo.upsert_task_content(
            "mod_dtask", "topic_dtask", "task_ghost",
            task_data={"data": "x"}, answer_key={}, updated_at="now"
        )
        ok = self.svc.delete_task("mod_dtask", "topic_dtask", "task_ghost")
        self.assertTrue(ok)

        mod = next(m for m in self.catalog_repo.load_catalog() if m["id"] == "mod_dtask")
        topic = next(t for t in mod["topics"] if t["id"] == "topic_dtask")
        self.assertNotIn("task_ghost", [t["id"] for t in topic["tasks"]])
        self.assertIsNone(
            self.content_repo.get_task_content("mod_dtask", "topic_dtask", "task_ghost")
        )

    def test_delete_task_not_found_returns_false(self):
        self.catalog_repo.replace_catalog([
            _make_module("mod_m", topics=[_make_topic("topic_t")])
        ])
        ok = self.svc.delete_task("mod_m", "topic_t", "ghost_task")
        self.assertFalse(ok)

    def test_delete_task_removes_shadow_dir_if_present(self):
        mid, tid, taskid = "mod_shadow", "topic_shadow", "task_shadow"
        self.catalog_repo.replace_catalog([
            _make_module(mid, topics=[_make_topic(tid, tasks=[_make_task(taskid)])])
        ])
        shadow = self.svc.modules_dir / mid / "topics" / tid / "tasks" / taskid
        shadow.mkdir(parents=True)
        (shadow / "task.json").write_text("{}")
        self.svc.delete_task(mid, tid, taskid)
        self.assertFalse(shadow.exists())

    # --- rename_module ---

    def test_rename_module_no_shadow(self):
        self.catalog_repo.replace_catalog([_make_module("mod_ren", "Старое")])
        ok = self.svc.rename_module("mod_ren", "Новое")
        self.assertTrue(ok)
        mod = next(m for m in self.catalog_repo.load_catalog() if m["id"] == "mod_ren")
        self.assertEqual(mod["name"], "Новое")

    def test_rename_module_not_found(self):
        ok = self.svc.rename_module("ghost", "X")
        self.assertFalse(ok)

    def test_rename_module_updates_shadow_if_exists(self):
        mid = "mod_ren_sh"
        self.catalog_repo.replace_catalog([_make_module(mid, "Old")])
        p = self.svc.modules_dir / mid / "module.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"id": mid, "name": "Old"}), encoding="utf-8")
        self.svc.rename_module(mid, "New")
        self.assertEqual(json.loads(p.read_text())["name"], "New")

    # --- rename_topic ---

    def test_rename_topic_no_shadow(self):
        self.catalog_repo.replace_catalog([
            _make_module("mod_rt", topics=[_make_topic("topic_rt", "Старая")])
        ])
        ok = self.svc.rename_topic("mod_rt", "topic_rt", "Новая")
        self.assertTrue(ok)
        mod = next(m for m in self.catalog_repo.load_catalog() if m["id"] == "mod_rt")
        topic = next(t for t in mod["topics"] if t["id"] == "topic_rt")
        self.assertEqual(topic["name"], "Новая")

    def test_rename_topic_not_found(self):
        self.catalog_repo.replace_catalog([_make_module("mod_rt2")])
        ok = self.svc.rename_topic("mod_rt2", "ghost", "X")
        self.assertFalse(ok)

    def test_rename_topic_updates_shadow_if_exists(self):
        mid, tid = "mod_rt_s", "topic_rt_s"
        self.catalog_repo.replace_catalog([
            _make_module(mid, topics=[_make_topic(tid, "Old")])
        ])
        p = self.svc.modules_dir / mid / "topics" / tid / "topic.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"id": tid, "name": "Old"}), encoding="utf-8")
        self.svc.rename_topic(mid, tid, "New")
        self.assertEqual(json.loads(p.read_text())["name"], "New")

    # --- set_topic_theory_link ---

    def test_set_theory_link_no_shadow(self):
        self.catalog_repo.replace_catalog([
            _make_module("mod_tl", topics=[_make_topic("topic_tl")])
        ])
        result = self.svc.set_topic_theory_link(
            "mod_tl", "topic_tl", {"theory_id": "th_abc"}
        )
        self.assertEqual(result.get("theory_link", {}).get("theory_id"), "th_abc")
        mod = next(m for m in self.catalog_repo.load_catalog() if m["id"] == "mod_tl")
        topic = next(t for t in mod["topics"] if t["id"] == "topic_tl")
        self.assertEqual(topic.get("theory_link", {}).get("theory_id"), "th_abc")

    def test_clear_theory_link(self):
        self.catalog_repo.replace_catalog([
            _make_module("mod_tl2", topics=[
                {**_make_topic("topic_tl2"), "theory_link": {"theory_id": "old"}}
            ])
        ])
        self.svc.set_topic_theory_link("mod_tl2", "topic_tl2", None)
        mod = next(m for m in self.catalog_repo.load_catalog() if m["id"] == "mod_tl2")
        topic = next(t for t in mod["topics"] if t["id"] == "topic_tl2")
        self.assertNotIn("theory_link", topic)

    def test_set_theory_link_topic_not_found_raises(self):
        self.catalog_repo.replace_catalog([_make_module("mod_tl3")])
        with self.assertRaises(ValueError):
            self.svc.set_topic_theory_link("mod_tl3", "ghost_topic", {"theory_id": "x"})

    # --- Full lifecycle (the broken scenario) ---

    def test_import_then_delete_full_lifecycle(self):
        """
        Main end-to-end scenario: module/topic/task imported via API
        (exists only in Postgres, no shadow) → user deletes all of it.
        """
        mid, tid, taskid = "imported_mod", "imported_topic", "imported_task"
        self.catalog_repo.replace_catalog([
            _make_module(mid, "Импортированный модуль", topics=[
                _make_topic(tid, "Импортированная тема", tasks=[
                    _make_task(taskid, "Импортированное задание")
                ])
            ])
        ])

        self.assertTrue(self.svc.delete_task(mid, tid, taskid))
        self.assertTrue(self.svc.delete_topic(mid, tid))
        self.assertTrue(self.svc.delete_module(mid))
        self.assertEqual(self.catalog_repo.load_catalog(), [])

    def test_create_rename_delete_module_cycle(self):
        self.assertTrue(self.svc.create_module("cycle_mod", "Начальное"))
        self.assertTrue(self.svc.rename_module("cycle_mod", "Изменённое"))
        mod = next(m for m in self.catalog_repo.load_catalog() if m["id"] == "cycle_mod")
        self.assertEqual(mod["name"], "Изменённое")
        self.assertTrue(self.svc.delete_module("cycle_mod"))
        self.assertEqual(self.catalog_repo.load_catalog(), [])

    def test_create_rename_delete_topic_cycle(self):
        self.catalog_repo.replace_catalog([_make_module("mod_cycle")])
        self.assertTrue(self.svc.create_topic("mod_cycle", "topic_cycle", "Начальная"))
        self.assertTrue(self.svc.rename_topic("mod_cycle", "topic_cycle", "Переименованная"))
        mod = next(m for m in self.catalog_repo.load_catalog() if m["id"] == "mod_cycle")
        topic = next(t for t in mod["topics"] if t["id"] == "topic_cycle")
        self.assertEqual(topic["name"], "Переименованная")
        self.assertTrue(self.svc.delete_topic("mod_cycle", "topic_cycle"))
        mod = next(m for m in self.catalog_repo.load_catalog() if m["id"] == "mod_cycle")
        self.assertEqual(mod["topics"], [])


if __name__ == "__main__":
    unittest.main()
