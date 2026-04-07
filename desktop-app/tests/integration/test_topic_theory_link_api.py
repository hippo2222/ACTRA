import json
import shutil
import uuid
from pathlib import Path

import pytest

from server import app, _headless_app_ctx  # type: ignore
from task_system.core.io.task_io import TaskIO


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def _ensure_module_topic_task(module_id: str, topic_id: str, task_id: str, task_name: str = "Topic API Test"):
    modules_dir = Path(_headless_app_ctx.storage_service.modules_dir)
    module_dir = modules_dir / module_id
    topic_dir = module_dir / "topics" / topic_id
    task_dir = topic_dir / "tasks" / task_id

    (module_dir / "topics").mkdir(parents=True, exist_ok=True)
    (topic_dir / "tasks").mkdir(parents=True, exist_ok=True)

    module_json = module_dir / "module.json"
    if not module_json.exists():
        module_json.write_text(
            json.dumps({"id": module_id, "name": module_id, "topics": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    topic_json = topic_dir / "topic.json"
    if not topic_json.exists():
        topic_json.write_text(
            json.dumps({"id": topic_id, "name": topic_id, "tasks": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    task_data = TaskIO.new_task("test", name=task_name, module=module_id, topic=topic_id)
    TaskIO.save(task_data, str(task_dir / "task.json"), validate=True)

    _headless_app_ctx.storage_service.reload_modules()
    return module_dir

def test_topic_theory_link_roundtrip(client):
    module_id = f"mod_topic_api_{uuid.uuid4().hex[:8]}"
    topic_id = f"topic_topic_api_{uuid.uuid4().hex[:8]}"
    task_id = f"task_{uuid.uuid4().hex[:6]}"
    module_dir = _ensure_module_topic_task(module_id, topic_id, task_id)

    theory = _headless_app_ctx.theory_service.create_theory(
        {"title": "Topic API Theory", "delta": {"ops": [{"insert": "Theory text\n"}]}}
    )
    theory_id = theory["id"]

    try:
        put_resp = client.put(
            f"/api/editor/topic/{module_id}/{topic_id}/theory-link",
            json={
                "theory_link": {"theory_id": theory_id, "relation": "link"},
                "apply_to_complexes": False,
            },
        )
        assert put_resp.status_code == 200
        put_data = put_resp.get_json()
        assert put_data["ok"] is True
        assert put_data["item"]["theory_link"]["theory_id"] == theory_id

        get_resp = client.get(f"/api/editor/topic/{module_id}/{topic_id}/theory-link")
        assert get_resp.status_code == 200
        get_data = get_resp.get_json()
        assert get_data["ok"] is True
        assert get_data["item"]["theory_link"]["theory_id"] == theory_id
    finally:
        shutil.rmtree(module_dir, ignore_errors=True)
        shutil.rmtree(Path(_headless_app_ctx.theory_service.theories_dir) / theory_id, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()


def test_topic_theory_link_defaults_to_safe_complex_autosync(client):
    module_id = f"mod_topic_auto_{uuid.uuid4().hex[:8]}"
    topic_id = f"topic_topic_auto_{uuid.uuid4().hex[:8]}"
    task_id = f"task_{uuid.uuid4().hex[:6]}"
    complex_id = f"cx_topic_auto_{uuid.uuid4().hex[:8]}"
    module_dir = _ensure_module_topic_task(module_id, topic_id, task_id, task_name="Autosync Task")

    theory = _headless_app_ctx.theory_service.create_theory(
        {"title": "Autosync Theory", "delta": {"ops": [{"insert": "Autosync body\n"}]}}
    )
    theory_id = theory["id"]

    complex_service = _headless_app_ctx.complex_service
    history_root = Path(complex_service.complexes_dir) / "history"

    try:
        complex_service.create_complex(
            {
                "id": complex_id,
                "name": "Autosync Complex",
                "tasks": [f"{module_id}/{topic_id}/{task_id}"],
                "chains": [],
                "settings": {},
                "theory_mode": "inherit",
            }
        )

        put_resp = client.put(
            f"/api/editor/topic/{module_id}/{topic_id}/theory-link",
            json={
                "theory_link": {"theory_id": theory_id, "relation": "link"},
            },
        )
        assert put_resp.status_code == 200
        put_data = put_resp.get_json()
        assert put_data["ok"] is True
        assert put_data["item"]["theory_link"]["theory_id"] == theory_id
        propagation = put_data.get("propagation") or {}
        assert propagation.get("summary", {}).get("impacted_complexes") == 1
        assert propagation.get("summary", {}).get("updated") == 1

        updated_complex = complex_service.get_complex(complex_id).dict()
        assert updated_complex.get("theory_mode") == "inherit"
        assert updated_complex.get("theory_sync_status") == "ok"
        assert updated_complex.get("theory_link", {}).get("theory_id") == theory_id
    finally:
        try:
            complex_service.delete_complex(complex_id)
        except Exception:
            pass
        shutil.rmtree(history_root / complex_id, ignore_errors=True)
        shutil.rmtree(module_dir, ignore_errors=True)
        shutil.rmtree(Path(_headless_app_ctx.theory_service.theories_dir) / theory_id, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()
        complex_service.load_complexes()


def test_create_complex_inherit_sets_composite_context_immediately(client):
    module_id = f"mod_complex_create_{uuid.uuid4().hex[:8]}"
    topic_a = f"topic_create_a_{uuid.uuid4().hex[:6]}"
    topic_b = f"topic_create_b_{uuid.uuid4().hex[:6]}"
    task_a = f"task_{uuid.uuid4().hex[:6]}"
    task_b = f"task_{uuid.uuid4().hex[:6]}"
    complex_id = f"cx_create_composite_{uuid.uuid4().hex[:8]}"

    module_dir = _ensure_module_topic_task(module_id, topic_a, task_a, task_name="Create Task A")
    _ensure_module_topic_task(module_id, topic_b, task_b, task_name="Create Task B")

    theory_a = _headless_app_ctx.theory_service.create_theory(
        {"title": "Create Theory A", "delta": {"ops": [{"insert": "Create A\n"}]}}
    )
    theory_b = _headless_app_ctx.theory_service.create_theory(
        {"title": "Create Theory B", "delta": {"ops": [{"insert": "Create B\n"}]}}
    )

    complex_service = _headless_app_ctx.complex_service
    history_root = Path(complex_service.complexes_dir) / "history"

    try:
        _headless_app_ctx.storage_service.set_topic_theory_link(
            module_id,
            topic_a,
            {"theory_id": theory_a["id"], "relation": "link"},
        )
        _headless_app_ctx.storage_service.set_topic_theory_link(
            module_id,
            topic_b,
            {"theory_id": theory_b["id"], "relation": "link"},
        )

        create_resp = client.post(
            "/api/complexes",
            json={
                "id": complex_id,
                "name": "Composite Create Complex",
                "description": "",
                "tasks": [
                    f"{module_id}/{topic_a}/{task_a}",
                    f"{module_id}/{topic_b}/{task_b}",
                ],
                "chains": [],
                "settings": {},
                "theory_mode": "inherit",
            },
        )
        assert create_resp.status_code == 200
        create_data = create_resp.get_json()
        assert create_data["ok"] is True

        item = create_data["item"]
        assert item.get("theory_mode") == "inherit"
        assert item.get("theory_sync_status") == "composite"
        assert item.get("theory_link") is None
        sync_meta = item.get("theory_sync_meta") or {}
        assert set(sync_meta.get("theory_ids") or []) == {theory_a["id"], theory_b["id"]}
        assert len(sync_meta.get("composite_theory_links") or []) == 2
    finally:
        try:
            complex_service.delete_complex(complex_id)
        except Exception:
            pass
        shutil.rmtree(history_root / complex_id, ignore_errors=True)
        shutil.rmtree(Path(_headless_app_ctx.theory_service.theories_dir) / theory_a["id"], ignore_errors=True)
        shutil.rmtree(Path(_headless_app_ctx.theory_service.theories_dir) / theory_b["id"], ignore_errors=True)
        shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()
        complex_service.load_complexes()


def test_topic_theory_link_propagation_safe_mode_marks_composite_bundle(client):
    module_id = f"mod_topic_sync_{uuid.uuid4().hex[:8]}"
    topic_a = f"topic_a_{uuid.uuid4().hex[:6]}"
    topic_b = f"topic_b_{uuid.uuid4().hex[:6]}"
    task_a = f"task_{uuid.uuid4().hex[:6]}"
    task_b = f"task_{uuid.uuid4().hex[:6]}"

    module_dir = _ensure_module_topic_task(module_id, topic_a, task_a, task_name="Task A")
    _ensure_module_topic_task(module_id, topic_b, task_b, task_name="Task B")

    theory_a = _headless_app_ctx.theory_service.create_theory(
        {"title": "Theory A", "delta": {"ops": [{"insert": "A\n"}]}}
    )
    theory_b = _headless_app_ctx.theory_service.create_theory(
        {"title": "Theory B", "delta": {"ops": [{"insert": "B\n"}]}}
    )
    theory_override = _headless_app_ctx.theory_service.create_theory(
        {"title": "Theory Override", "delta": {"ops": [{"insert": "Override\n"}]}}
    )

    _headless_app_ctx.storage_service.set_topic_theory_link(
        module_id, topic_b, {"theory_id": theory_b["id"], "relation": "link"}
    )

    complex_service = _headless_app_ctx.complex_service
    complex_inherit = f"cx_inherit_{uuid.uuid4().hex[:8]}"
    complex_override = f"cx_override_{uuid.uuid4().hex[:8]}"
    complex_composite = f"cx_composite_{uuid.uuid4().hex[:8]}"
    created_complex_ids = [complex_inherit, complex_override, complex_composite]

    history_root = Path(complex_service.complexes_dir) / "history"
    theory_ids = [theory_a["id"], theory_b["id"], theory_override["id"]]

    try:
        complex_service.create_complex(
            {
                "id": complex_inherit,
                "name": "Complex Inherit",
                "tasks": [f"{module_id}/{topic_a}/{task_a}"],
                "chains": [],
                "settings": {},
                "theory_mode": "inherit",
            }
        )
        complex_service.create_complex(
            {
                "id": complex_override,
                "name": "Complex Override",
                "tasks": [f"{module_id}/{topic_a}/{task_a}"],
                "chains": [],
                "settings": {},
                "theory_link": {"theory_id": theory_override["id"], "relation": "link"},
                "theory_mode": "override",
            }
        )
        complex_service.create_complex(
            {
                "id": complex_composite,
                "name": "Complex Composite",
                "tasks": [
                    f"{module_id}/{topic_a}/{task_a}",
                    f"{module_id}/{topic_b}/{task_b}",
                ],
                "chains": [],
                "settings": {},
                "theory_mode": "inherit",
            }
        )

        dry_run_resp = client.put(
            f"/api/editor/topic/{module_id}/{topic_a}/theory-link",
            json={
                "theory_link": {"theory_id": theory_a["id"], "relation": "link"},
                "apply_to_complexes": True,
                "dry_run": True,
                "propagation_mode": "safe",
            },
        )
        assert dry_run_resp.status_code == 200
        dry_data = dry_run_resp.get_json()
        assert dry_data["ok"] is True
        assert dry_data["propagation"]["summary"]["impacted_complexes"] == 3
        assert dry_data["propagation"]["summary"]["would_update"] >= 2

        apply_resp = client.put(
            f"/api/editor/topic/{module_id}/{topic_a}/theory-link",
            json={
                "theory_link": {"theory_id": theory_a["id"], "relation": "link"},
                "apply_to_complexes": True,
                "dry_run": False,
                "propagation_mode": "safe",
            },
        )
        assert apply_resp.status_code == 200
        apply_data = apply_resp.get_json()
        assert apply_data["ok"] is True
        assert apply_data["propagation"]["summary"]["updated"] >= 2

        updated_inherit = complex_service.get_complex(complex_inherit).dict()
        assert updated_inherit.get("theory_link", {}).get("theory_id") == theory_a["id"]
        assert updated_inherit.get("theory_sync_status") == "ok"
        assert updated_inherit.get("theory_mode") == "inherit"

        updated_override = complex_service.get_complex(complex_override).dict()
        assert updated_override.get("theory_link", {}).get("theory_id") == theory_override["id"]
        assert updated_override.get("theory_mode") == "override"

        updated_composite = complex_service.get_complex(complex_composite).dict()
        assert updated_composite.get("theory_sync_status") == "composite"
        assert updated_composite.get("theory_link") is None
        composite_meta = updated_composite.get("theory_sync_meta") or {}
        assert set(composite_meta.get("theory_ids") or []) == {theory_a["id"], theory_b["id"]}
        assert len(composite_meta.get("composite_theory_links") or []) == 2
        assert len(composite_meta.get("composite_topics") or []) == 2
    finally:
        for complex_id in created_complex_ids:
            try:
                complex_service.delete_complex(complex_id)
            except Exception:
                pass
            shutil.rmtree(history_root / complex_id, ignore_errors=True)
        for theory_id in theory_ids:
            shutil.rmtree(Path(_headless_app_ctx.theory_service.theories_dir) / theory_id, ignore_errors=True)
        shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()
        complex_service.load_complexes()


def test_complex_sync_from_topics_dry_run_then_apply(client):
    module_id = f"mod_complex_sync_{uuid.uuid4().hex[:8]}"
    topic_id = f"topic_complex_sync_{uuid.uuid4().hex[:8]}"
    task_id = f"task_{uuid.uuid4().hex[:6]}"

    module_dir = _ensure_module_topic_task(module_id, topic_id, task_id, task_name="Sync Task")
    theory = _headless_app_ctx.theory_service.create_theory(
        {"title": "Sync Theory", "delta": {"ops": [{"insert": "Sync\n"}]}}
    )
    theory_id = theory["id"]

    complex_service = _headless_app_ctx.complex_service
    complex_id = f"cx_single_sync_{uuid.uuid4().hex[:8]}"
    history_root = Path(complex_service.complexes_dir) / "history"

    try:
        _headless_app_ctx.storage_service.set_topic_theory_link(
            module_id,
            topic_id,
            {"theory_id": theory_id, "relation": "link"},
        )

        complex_service.create_complex(
            {
                "id": complex_id,
                "name": "Single Sync Complex",
                "tasks": [f"{module_id}/{topic_id}/{task_id}"],
                "chains": [],
                "settings": {},
                "theory_mode": "inherit",
            }
        )

        preview_resp = client.post(
            f"/api/complexes/{complex_id}/sync-theory-from-topics",
            json={"dry_run": True, "propagation_mode": "safe"},
        )
        assert preview_resp.status_code == 200
        preview_data = preview_resp.get_json()
        assert preview_data["ok"] is True
        assert preview_data["summary"]["action"] == "would_update"
        assert preview_data["summary"]["status"] == "ok"
        assert "theory_link" in (preview_data.get("preview", {}).get("changed_keys") or [])

        unchanged = complex_service.get_complex(complex_id).dict()
        assert unchanged.get("theory_link") is None

        apply_resp = client.post(
            f"/api/complexes/{complex_id}/sync-theory-from-topics",
            json={"dry_run": False, "propagation_mode": "safe"},
        )
        assert apply_resp.status_code == 200
        apply_data = apply_resp.get_json()
        assert apply_data["ok"] is True
        assert apply_data["summary"]["action"] == "updated"
        assert apply_data["summary"]["status"] == "ok"

        updated = complex_service.get_complex(complex_id).dict()
        assert updated.get("theory_link", {}).get("theory_id") == theory_id
        assert updated.get("theory_mode") == "inherit"
        assert updated.get("theory_sync_status") == "ok"
    finally:
        try:
            complex_service.delete_complex(complex_id)
        except Exception:
            pass
        shutil.rmtree(history_root / complex_id, ignore_errors=True)
        shutil.rmtree(Path(_headless_app_ctx.theory_service.theories_dir) / theory_id, ignore_errors=True)
        shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()
        complex_service.load_complexes()


def test_complex_sync_from_topics_marks_composite_bundle(client):
    module_id = f"mod_complex_composite_{uuid.uuid4().hex[:8]}"
    topic_a = f"topic_composite_a_{uuid.uuid4().hex[:6]}"
    topic_b = f"topic_composite_b_{uuid.uuid4().hex[:6]}"
    task_a = f"task_{uuid.uuid4().hex[:6]}"
    task_b = f"task_{uuid.uuid4().hex[:6]}"

    module_dir = _ensure_module_topic_task(module_id, topic_a, task_a, task_name="Composite Task A")
    _ensure_module_topic_task(module_id, topic_b, task_b, task_name="Composite Task B")

    theory_a = _headless_app_ctx.theory_service.create_theory(
        {"title": "Composite Theory A", "delta": {"ops": [{"insert": "Composite A\n"}]}}
    )
    theory_b = _headless_app_ctx.theory_service.create_theory(
        {"title": "Composite Theory B", "delta": {"ops": [{"insert": "Composite B\n"}]}}
    )

    complex_service = _headless_app_ctx.complex_service
    complex_id = f"cx_composite_sync_{uuid.uuid4().hex[:8]}"
    history_root = Path(complex_service.complexes_dir) / "history"

    try:
        _headless_app_ctx.storage_service.set_topic_theory_link(
            module_id,
            topic_a,
            {"theory_id": theory_a["id"], "relation": "link"},
        )
        _headless_app_ctx.storage_service.set_topic_theory_link(
            module_id,
            topic_b,
            {"theory_id": theory_b["id"], "relation": "link"},
        )

        complex_service.create_complex(
            {
                "id": complex_id,
                "name": "Composite Sync Complex",
                "tasks": [
                    f"{module_id}/{topic_a}/{task_a}",
                    f"{module_id}/{topic_b}/{task_b}",
                ],
                "chains": [],
                "settings": {},
                "theory_mode": "inherit",
            }
        )

        preview_resp = client.post(
            f"/api/complexes/{complex_id}/sync-theory-from-topics",
            json={"dry_run": True, "propagation_mode": "safe"},
        )
        assert preview_resp.status_code == 200
        preview_data = preview_resp.get_json()
        assert preview_data["ok"] is True
        assert preview_data["summary"]["action"] == "would_update"
        assert preview_data["summary"]["status"] == "composite"
        changed_keys = preview_data.get("preview", {}).get("changed_keys") or []
        assert "theory_sync_status" in changed_keys
        assert "theory_sync_meta" in changed_keys

        apply_resp = client.post(
            f"/api/complexes/{complex_id}/sync-theory-from-topics",
            json={"dry_run": False, "propagation_mode": "safe"},
        )
        assert apply_resp.status_code == 200
        apply_data = apply_resp.get_json()
        assert apply_data["ok"] is True
        assert apply_data["summary"]["action"] == "updated"
        assert apply_data["summary"]["status"] == "composite"

        updated = complex_service.get_complex(complex_id).dict()
        assert updated.get("theory_link") is None
        assert updated.get("theory_mode") == "inherit"
        assert updated.get("theory_sync_status") == "composite"
        sync_meta = updated.get("theory_sync_meta") or {}
        assert set(sync_meta.get("theory_ids") or []) == {theory_a["id"], theory_b["id"]}
        assert len(sync_meta.get("composite_theory_links") or []) == 2
        assert len(sync_meta.get("composite_topics") or []) == 2
    finally:
        try:
            complex_service.delete_complex(complex_id)
        except Exception:
            pass
        shutil.rmtree(history_root / complex_id, ignore_errors=True)
        shutil.rmtree(Path(_headless_app_ctx.theory_service.theories_dir) / theory_a["id"], ignore_errors=True)
        shutil.rmtree(Path(_headless_app_ctx.theory_service.theories_dir) / theory_b["id"], ignore_errors=True)
        shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()
        complex_service.load_complexes()


def test_complex_sync_from_topics_safe_skips_override_and_all_force_updates(client):
    module_id = f"mod_complex_force_{uuid.uuid4().hex[:8]}"
    topic_id = f"topic_complex_force_{uuid.uuid4().hex[:8]}"
    task_id = f"task_{uuid.uuid4().hex[:6]}"

    module_dir = _ensure_module_topic_task(module_id, topic_id, task_id, task_name="Force Task")
    theory_topic = _headless_app_ctx.theory_service.create_theory(
        {"title": "Topic Theory", "delta": {"ops": [{"insert": "Topic\n"}]}}
    )
    theory_override = _headless_app_ctx.theory_service.create_theory(
        {"title": "Override Theory", "delta": {"ops": [{"insert": "Override\n"}]}}
    )

    complex_service = _headless_app_ctx.complex_service
    complex_id = f"cx_force_sync_{uuid.uuid4().hex[:8]}"
    history_root = Path(complex_service.complexes_dir) / "history"

    try:
        _headless_app_ctx.storage_service.set_topic_theory_link(
            module_id,
            topic_id,
            {"theory_id": theory_topic["id"], "relation": "link"},
        )

        complex_service.create_complex(
            {
                "id": complex_id,
                "name": "Override Complex",
                "tasks": [f"{module_id}/{topic_id}/{task_id}"],
                "chains": [],
                "settings": {},
                "theory_mode": "override",
                "theory_link": {"theory_id": theory_override["id"], "relation": "link"},
            }
        )

        safe_resp = client.post(
            f"/api/complexes/{complex_id}/sync-theory-from-topics",
            json={"dry_run": False, "propagation_mode": "safe"},
        )
        assert safe_resp.status_code == 200
        safe_data = safe_resp.get_json()
        assert safe_data["ok"] is True
        assert safe_data["summary"]["action"] == "skipped"
        assert safe_data["summary"]["reason"] == "mode_override"

        after_safe = complex_service.get_complex(complex_id).dict()
        assert after_safe.get("theory_link", {}).get("theory_id") == theory_override["id"]
        assert after_safe.get("theory_mode") == "override"

        force_resp = client.post(
            f"/api/complexes/{complex_id}/sync-theory-from-topics",
            json={"dry_run": False, "propagation_mode": "all_force"},
        )
        assert force_resp.status_code == 200
        force_data = force_resp.get_json()
        assert force_data["ok"] is True
        assert force_data["summary"]["action"] == "updated"
        assert force_data["summary"]["status"] == "ok"

        after_force = complex_service.get_complex(complex_id).dict()
        assert after_force.get("theory_link", {}).get("theory_id") == theory_topic["id"]
        assert after_force.get("theory_mode") == "override"
        assert after_force.get("theory_sync_status") == "ok"
    finally:
        try:
            complex_service.delete_complex(complex_id)
        except Exception:
            pass
        shutil.rmtree(history_root / complex_id, ignore_errors=True)
        shutil.rmtree(Path(_headless_app_ctx.theory_service.theories_dir) / theory_topic["id"], ignore_errors=True)
        shutil.rmtree(
            Path(_headless_app_ctx.theory_service.theories_dir) / theory_override["id"],
            ignore_errors=True,
        )
        shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()
        complex_service.load_complexes()


def test_theory_center_overview_returns_user_friendly_states(client):
    module_id = f"mod_theory_center_{uuid.uuid4().hex[:8]}"
    topic_a = f"topic_center_a_{uuid.uuid4().hex[:6]}"
    topic_b = f"topic_center_b_{uuid.uuid4().hex[:6]}"
    topic_c = f"topic_center_c_{uuid.uuid4().hex[:6]}"
    task_a = f"task_{uuid.uuid4().hex[:6]}"
    task_b = f"task_{uuid.uuid4().hex[:6]}"
    task_c = f"task_{uuid.uuid4().hex[:6]}"

    module_dir = _ensure_module_topic_task(module_id, topic_a, task_a, task_name="Center Task A")
    _ensure_module_topic_task(module_id, topic_b, task_b, task_name="Center Task B")
    _ensure_module_topic_task(module_id, topic_c, task_c, task_name="Center Task C")

    theory_a = _headless_app_ctx.theory_service.create_theory(
        {"title": "Center Theory A", "delta": {"ops": [{"insert": "Center A\n"}]}}
    )
    theory_b = _headless_app_ctx.theory_service.create_theory(
        {"title": "Center Theory B", "delta": {"ops": [{"insert": "Center B\n"}]}}
    )
    theory_override = _headless_app_ctx.theory_service.create_theory(
        {"title": "Center Theory Override", "delta": {"ops": [{"insert": "Center Override\n"}]}}
    )

    complex_service = _headless_app_ctx.complex_service
    complex_single = f"cx_center_single_{uuid.uuid4().hex[:8]}"
    complex_composite = f"cx_center_composite_{uuid.uuid4().hex[:8]}"
    complex_override = f"cx_center_override_{uuid.uuid4().hex[:8]}"
    complex_none = f"cx_center_none_{uuid.uuid4().hex[:8]}"
    created_complex_ids = [complex_single, complex_composite, complex_override, complex_none]
    history_root = Path(complex_service.complexes_dir) / "history"

    try:
        _headless_app_ctx.storage_service.set_topic_theory_link(
            module_id, topic_a, {"theory_id": theory_a["id"], "relation": "link"}
        )
        _headless_app_ctx.storage_service.set_topic_theory_link(
            module_id, topic_b, {"theory_id": theory_b["id"], "relation": "link"}
        )

        complex_service.create_complex(
            {
                "id": complex_single,
                "name": "Center Single Complex",
                "tasks": [f"{module_id}/{topic_a}/{task_a}"],
                "chains": [],
                "settings": {},
                "theory_mode": "inherit",
            }
        )
        complex_service.create_complex(
            {
                "id": complex_composite,
                "name": "Center Composite Complex",
                "tasks": [
                    f"{module_id}/{topic_a}/{task_a}",
                    f"{module_id}/{topic_b}/{task_b}",
                ],
                "chains": [],
                "settings": {},
                "theory_mode": "inherit",
            }
        )
        complex_service.create_complex(
            {
                "id": complex_override,
                "name": "Center Override Complex",
                "tasks": [f"{module_id}/{topic_a}/{task_a}"],
                "chains": [],
                "settings": {},
                "theory_mode": "override",
                "theory_link": {"theory_id": theory_override["id"], "relation": "link"},
            }
        )
        complex_service.create_complex(
            {
                "id": complex_none,
                "name": "Center None Complex",
                "tasks": [f"{module_id}/{topic_c}/{task_c}"],
                "chains": [],
                "settings": {},
                "theory_mode": "inherit",
            }
        )

        resp = client.get("/api/theory-center/overview")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True

        summary = data["summary"]
        assert summary["topics_without_theory"] >= 1
        assert summary["complexes_single_theory"] >= 1
        assert summary["complexes_composite_theory"] >= 1
        assert summary["complexes_override_theory"] >= 1
        assert summary["complexes_without_theory"] >= 1
        assert summary["theories_total"] >= 3

        topic_rows = data["topics"]
        topic_missing = next(row for row in topic_rows if row["topic_id"] == topic_c)
        assert topic_missing["theory_state"] == "missing"
        assert topic_missing["has_theory"] is False

        complex_rows = data["complexes"]
        row_single = next(row for row in complex_rows if row["complex_id"] == complex_single)
        row_composite = next(row for row in complex_rows if row["complex_id"] == complex_composite)
        row_override = next(row for row in complex_rows if row["complex_id"] == complex_override)
        row_none = next(row for row in complex_rows if row["complex_id"] == complex_none)

        assert row_single["theory_state"] == "single"
        assert row_single["theory_source"] == "topics"
        assert row_single["open_theory_id"] == theory_a["id"]

        assert row_composite["theory_state"] == "composite"
        assert row_composite["effective_theory_count"] == 2
        assert set(row_composite["theory_ids"]) == {theory_a["id"], theory_b["id"]}

        assert row_override["theory_state"] == "own"
        assert row_override["theory_source"] == "own"
        assert row_override["open_theory_id"] == theory_override["id"]

        assert row_none["theory_state"] == "none"
        assert row_none["has_theory"] is False

        theory_rows = data["theories"]
        theory_ids = {row["id"] for row in theory_rows}
        assert theory_a["id"] in theory_ids
        assert theory_b["id"] in theory_ids
        assert theory_override["id"] in theory_ids
    finally:
        for complex_id in created_complex_ids:
            try:
                complex_service.delete_complex(complex_id)
            except Exception:
                pass
            shutil.rmtree(history_root / complex_id, ignore_errors=True)
        for theory_id in [theory_a["id"], theory_b["id"], theory_override["id"]]:
            shutil.rmtree(Path(_headless_app_ctx.theory_service.theories_dir) / theory_id, ignore_errors=True)
        shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()
        complex_service.load_complexes()


def test_bulk_delete_theories_skips_linked_records(client):
    module_id = f"mod_theory_bulk_delete_{uuid.uuid4().hex[:8]}"
    topic_id = f"topic_theory_bulk_delete_{uuid.uuid4().hex[:8]}"
    task_id = f"task_{uuid.uuid4().hex[:6]}"
    module_dir = _ensure_module_topic_task(module_id, topic_id, task_id, task_name="Bulk delete task")

    linked_theory = _headless_app_ctx.theory_service.create_theory(
        {"title": "Linked theory", "delta": {"ops": [{"insert": "linked\n"}]}}
    )
    orphan_theory = _headless_app_ctx.theory_service.create_theory(
        {"title": "Orphan theory", "delta": {"ops": [{"insert": "orphan\n"}]}}
    )

    theories_dir = Path(_headless_app_ctx.theory_service.theories_dir)

    try:
        _headless_app_ctx.storage_service.set_topic_theory_link(
            module_id,
            topic_id,
            {"theory_id": linked_theory["id"], "relation": "link"},
        )

        resp = client.post(
            "/api/theories/bulk-delete",
            json={"theory_ids": [linked_theory["id"], orphan_theory["id"]]},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["requested"] == 2
        assert data["deleted"] == 1
        assert data["partial"] is True

        error = next(item for item in data["errors"] if item["theory_id"] == linked_theory["id"])
        assert error["error"] == "theory_in_use"
        assert error["usage_topics"] == 1
        assert error["usage_complexes"] == 0

        deleted_item = next(item for item in data["deleted_items"] if item["id"] == orphan_theory["id"])
        assert deleted_item["id"] == orphan_theory["id"]
        assert "archived_path" not in deleted_item

        assert (theories_dir / linked_theory["id"] / "theory.json").exists()
        assert not (theories_dir / orphan_theory["id"]).exists()
    finally:
        shutil.rmtree(theories_dir / linked_theory["id"], ignore_errors=True)
        shutil.rmtree(theories_dir / orphan_theory["id"], ignore_errors=True)
        shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()


def test_delete_theory_route_rejects_linked_and_deletes_orphan(client):
    module_id = f"mod_theory_delete_{uuid.uuid4().hex[:8]}"
    topic_id = f"topic_theory_delete_{uuid.uuid4().hex[:8]}"
    task_id = f"task_{uuid.uuid4().hex[:6]}"
    module_dir = _ensure_module_topic_task(module_id, topic_id, task_id, task_name="Delete route task")

    linked_theory = _headless_app_ctx.theory_service.create_theory(
        {"title": "Linked theory route", "delta": {"ops": [{"insert": "linked\n"}]}}
    )
    orphan_theory = _headless_app_ctx.theory_service.create_theory(
        {"title": "Orphan theory route", "delta": {"ops": [{"insert": "orphan\n"}]}}
    )

    theories_dir = Path(_headless_app_ctx.theory_service.theories_dir)

    try:
        _headless_app_ctx.storage_service.set_topic_theory_link(
            module_id,
            topic_id,
            {"theory_id": linked_theory["id"], "relation": "link"},
        )

        linked_resp = client.delete(f"/api/theories/{linked_theory['id']}")
        assert linked_resp.status_code == 409
        linked_payload = linked_resp.get_json()
        assert linked_payload["ok"] is False
        assert linked_payload["error"] == "theory_in_use"
        assert linked_payload["usage_topics"] == 1
        assert (theories_dir / linked_theory["id"] / "theory.json").exists()

        orphan_resp = client.delete(f"/api/theories/{orphan_theory['id']}")
        assert orphan_resp.status_code == 200
        orphan_payload = orphan_resp.get_json()
        assert orphan_payload["ok"] is True
        assert orphan_payload["item"]["id"] == orphan_theory["id"]
        assert "archived_path" not in orphan_payload["item"]
        assert not (theories_dir / orphan_theory["id"]).exists()
    finally:
        shutil.rmtree(theories_dir / linked_theory["id"], ignore_errors=True)
        shutil.rmtree(theories_dir / orphan_theory["id"], ignore_errors=True)
        shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()
