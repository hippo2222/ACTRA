import io
import json
import shutil
import uuid
import zipfile
from pathlib import Path

import pytest

from server import app, _headless_app_ctx  # type: ignore


def _create_task(module_id: str, topic_id: str, task_id: str) -> None:
    modules_dir = Path(_headless_app_ctx.storage_service.modules_dir)
    module_dir = modules_dir / module_id
    topic_dir = module_dir / "topics" / topic_id
    task_dir = topic_dir / "tasks" / task_id

    task_dir.mkdir(parents=True, exist_ok=True)
    (module_dir / "module.json").write_text(
        json.dumps({"id": module_id, "name": module_id}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (topic_dir / "topic.json").write_text(
        json.dumps({"id": topic_id, "name": topic_id}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (task_dir / "task.json").write_text(
        json.dumps(
            {
                "id": task_id,
                "name": "Imported Task",
                "type": "open_answer",
                "content": {"prompt": "Prompt"},
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    _headless_app_ctx.storage_service.reload_modules()


def _remove_seed(module_id: str, complex_id: str, theory_id: str) -> None:
    try:
        _headless_app_ctx.complex_service.delete_complex(complex_id)
    except Exception:
        pass

    try:
        theory_dir = _headless_app_ctx.theory_service.theories_dir / theory_id
        if theory_dir.exists():
            shutil.rmtree(theory_dir, ignore_errors=True)
    except Exception:
        pass

    try:
        module_dir = Path(_headless_app_ctx.storage_service.modules_dir) / module_id
        if module_dir.exists():
            shutil.rmtree(module_dir, ignore_errors=True)
    except Exception:
        pass

    _headless_app_ctx.storage_service.reload_modules()
    _headless_app_ctx.complex_service.load_complexes()


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


@pytest.fixture
def complex_seed():
    suffix = uuid.uuid4().hex[:8]
    module_id = f"mod_ie_{suffix}"
    topic_id = f"topic_ie_{suffix}"
    task_id = f"task_ie_{suffix}"
    complex_id = f"cx_ie_{suffix}"
    theory_id = f"th_ie_{suffix}"

    _create_task(module_id, topic_id, task_id)
    _headless_app_ctx.theory_service.create_theory(
        {
            "id": theory_id,
            "title": "Theory for API import/export",
            "delta": {"ops": [{"insert": "Theory body\n"}]},
        }
    )
    _headless_app_ctx.complex_service.create_complex(
        {
            "id": complex_id,
            "name": "Complex API Import Export",
            "description": "",
            "tasks": [f"{module_id}/{topic_id}/{task_id}"],
            "chains": [],
            "settings": {},
            "theory_link": {"theory_id": theory_id, "relation": "link"},
        }
    )

    data = {
        "module_id": module_id,
        "topic_id": topic_id,
        "task_id": task_id,
        "complex_id": complex_id,
        "theory_id": theory_id,
    }
    try:
        yield data
    finally:
        _remove_seed(module_id, complex_id, theory_id)


def _parse_ndjson_response(response) -> list:
    lines = response.get_data(as_text=True).strip().split("\n")
    messages = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        messages.append(json.loads(line))
    return messages


def test_complex_export_endpoint_returns_bundle(client, complex_seed):
    resp = client.post(
        "/api/complexes/export",
        json={
            "complex_ids": [complex_seed["complex_id"]],
            "include_tasks": True,
            "include_theories": True,
        },
    )
    assert resp.status_code == 200
    assert resp.mimetype == "application/zip"

    with zipfile.ZipFile(io.BytesIO(resp.data), "r") as zf:
        names = set(zf.namelist())
        manifest = json.loads(zf.read("manifest.json"))
        assert manifest["export_type"] == "complexes"
        assert complex_seed["complex_id"] in manifest["entities"]["complexes"]
        assert f"complexes/{complex_seed['complex_id']}.json" in names


def test_complex_import_check_and_confirm_flow(client, complex_seed):
    export_resp = client.post(
        "/api/complexes/export",
        json={
            "complex_ids": [complex_seed["complex_id"]],
            "include_tasks": True,
            "include_theories": True,
        },
    )
    assert export_resp.status_code == 200
    bundle_bytes = export_resp.data

    _remove_seed(complex_seed["module_id"], complex_seed["complex_id"], complex_seed["theory_id"])

    check_resp = client.post(
        "/api/complexes/import/check",
        data={"file": (io.BytesIO(bundle_bytes), "complex_bundle.zip")},
        content_type="multipart/form-data",
    )
    assert check_resp.status_code == 200
    check_data = check_resp.get_json()
    assert check_data["ok"] is True
    assert check_data["summary"]["total"] == 1
    assert isinstance(check_data.get("cache_id"), str) and check_data["cache_id"]

    confirm_resp = client.post(
        "/api/complexes/import/confirm",
        data={
            "cache_id": check_data["cache_id"],
            "complex_conflict_resolution": "new_id",
            "task_conflict_resolution": "skip",
            "theory_conflict_resolution": "reuse_if_same_hash",
            "atomic_mode": "bundle",
            "skip_errors": "false",
        },
        content_type="multipart/form-data",
    )
    assert confirm_resp.status_code == 200

    messages = _parse_ndjson_response(confirm_resp)
    assert any(msg.get("type") == "progress" for msg in messages)
    result_msg = next((msg for msg in messages if msg.get("type") == "result"), None)
    assert result_msg is not None
    result_data = result_msg["data"]
    assert result_data["ok"] is True
    assert result_data["imported_complexes"] == 1

    imported_complex = _headless_app_ctx.complex_service.get_complex(complex_seed["complex_id"])
    assert imported_complex is not None


def test_complex_export_endpoint_supports_multiple_complex_ids(client, complex_seed):
    suffix = uuid.uuid4().hex[:8]
    module_id_2 = f"mod_ie2_{suffix}"
    topic_id_2 = f"topic_ie2_{suffix}"
    task_id_2 = f"task_ie2_{suffix}"
    complex_id_2 = f"cx_ie2_{suffix}"
    theory_id_2 = f"th_ie2_{suffix}"

    _create_task(module_id_2, topic_id_2, task_id_2)
    _headless_app_ctx.theory_service.create_theory(
        {
            "id": theory_id_2,
            "title": "Theory for second complex",
            "delta": {"ops": [{"insert": "Second theory body\n"}]},
        }
    )
    _headless_app_ctx.complex_service.create_complex(
        {
            "id": complex_id_2,
            "name": "Second Complex API Import Export",
            "description": "",
            "tasks": [f"{module_id_2}/{topic_id_2}/{task_id_2}"],
            "chains": [],
            "settings": {},
            "theory_link": {"theory_id": theory_id_2, "relation": "link"},
        }
    )

    try:
        resp = client.post(
            "/api/complexes/export",
            json={
                "complex_ids": [complex_seed["complex_id"], complex_id_2],
                "include_tasks": True,
                "include_theories": True,
            },
        )
        assert resp.status_code == 200
        assert resp.mimetype == "application/zip"

        with zipfile.ZipFile(io.BytesIO(resp.data), "r") as zf:
            names = set(zf.namelist())
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["export_type"] == "complexes"
            assert set(manifest["entities"]["complexes"]) == {complex_seed["complex_id"], complex_id_2}
            assert f"complexes/{complex_seed['complex_id']}.json" in names
            assert f"complexes/{complex_id_2}.json" in names
            assert (
                f"modules/{module_id_2}/topics/{topic_id_2}/tasks/{task_id_2}/task.json"
                in names
            )
            assert f"theories/{theory_id_2}/theory.json" in names
    finally:
        _remove_seed(module_id_2, complex_id_2, theory_id_2)
