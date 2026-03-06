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


def test_topic_theory_link_propagation_safe_mode_with_conflict_guard(client):
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
    complex_conflict = f"cx_conflict_{uuid.uuid4().hex[:8]}"
    created_complex_ids = [complex_inherit, complex_override, complex_conflict]

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
                "id": complex_conflict,
                "name": "Complex Conflict",
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

        updated_conflict = complex_service.get_complex(complex_conflict).dict()
        assert updated_conflict.get("theory_sync_status") == "conflict"
        assert updated_conflict.get("theory_link") is None
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
