"""Editor CRUD + Import/Export API routes.

Endpoints:
- GET    /api/editor/catalog                              - Module/topic/task hierarchy
- GET    /api/editor/task/<m>/<t>/<id>                    - Load task for editing
- POST   /api/editor/task/<m>/<t>/<id>                    - Save task
- DELETE /api/editor/task/<m>/<t>/<id>                    - Delete task
- POST   /api/editor/export/tasks                         - Export selected tasks
- POST   /api/editor/export/bulk                          - Export module/topic
- POST   /api/editor/import/check                         - Validate archive
- POST   /api/editor/import/confirm                       - Execute import (streaming)
- POST   /api/complexes/export                            - Export complexes bundle
- POST   /api/complexes/import/check                      - Validate complex archive
- POST   /api/complexes/import/confirm                    - Execute complex import
- POST   /api/editor/test/import                          - Import test from file
- POST   /api/editor/test/export                          - Export test to file
- POST   /api/editor/logs/scale                           - Save scale log
- POST   /api/editor/task/new                             - Create new task
- POST   /api/editor/module/new                           - Create new module
- POST   /api/editor/topic/new                            - Create new topic
- POST   /api/editor/upload-image                         - Upload image for task
- GET    /api/editor/image                                - Serve editor image
"""

import json
import logging
import os
import queue
import tempfile
import threading
import time
import uuid as _uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from flask import (
    Blueprint,
    Response,
    after_this_request,
    jsonify,
    request,
    send_file,
    stream_with_context,
)
from werkzeug.utils import secure_filename

from task_system.models.test_parser import TestFileParser
from task_system.models.test_task import TestTask

from routes._context import get_ctx, get_extra
from routes._helpers import _make_safe_id, _resolve_editor_image_path

logger = logging.getLogger(__name__)

editor_bp = Blueprint("editor", __name__)


# ---------------------------------------------------------------------------
# Editor CRUD
# ---------------------------------------------------------------------------


@editor_bp.route("/api/editor/catalog", methods=["GET"])
def get_editor_catalog() -> Any:
    """Return the full module/topic/task hierarchy for the editor."""
    try:
        modules = get_ctx().storage_service.load_modules()
        return jsonify({"ok": True, "modules": modules})
    except Exception as exc:
        logger.exception("[HTTP] Failed to get editor catalog: %s", exc)
        return jsonify({"ok": False, "error": "catalog_load_failed"}), 500


@editor_bp.route("/api/editor/task/<module_id>/<topic_id>/<task_id>", methods=["GET"])
def get_editor_task(module_id: str, topic_id: str, task_id: str) -> Any:
    """Load full task data for editing."""
    try:
        data = get_ctx().storage_service.load_task(module_id, topic_id, task_id)
        if not data:
            return jsonify({"ok": False, "error": "task_not_found"}), 404
        return jsonify({"ok": True, "task": data})
    except Exception as exc:
        logger.exception("[HTTP] Failed to load editor task: %s", exc)
        return jsonify({"ok": False, "error": "task_load_failed"}), 500


@editor_bp.route("/api/editor/task/<module_id>/<topic_id>/<task_id>", methods=["POST"])
def save_editor_task(module_id: str, topic_id: str, task_id: str) -> Any:
    """Save updated task data from the editor."""
    if get_ctx().user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.json
        if not payload:
            return jsonify({"ok": False, "error": "payload_required"}), 400

        success = get_ctx().storage_service.save_task(
            module_id, topic_id, task_id, payload, validate=True
        )

        if success:
            return jsonify({"ok": True})
        else:
            return jsonify({"ok": False, "error": "save_failed"}), 500

    except Exception as exc:
        logger.exception("[HTTP] Failed to save editor task: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/task/<module_id>/<topic_id>/<task_id>", methods=["DELETE"])
def delete_editor_task(module_id: str, topic_id: str, task_id: str) -> Any:
    if get_ctx().user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        success = get_ctx().storage_service.delete_task(module_id, topic_id, task_id)
        if success:
            return jsonify({"ok": True})
        else:
            return (
                jsonify({"ok": False, "error": "delete_failed"}),
                500,
            )  # or 404 handled inside service logs

    except Exception as exc:
        logger.exception("[HTTP] Failed to delete editor task: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# _ensure_task_registered removed (logic moved to StorageService)


def _resolve_task_dir(module_id: str, topic_id: str, task_id: str) -> Path:
    return (
        get_ctx().storage_service.modules_dir
        / module_id
        / "topics"
        / topic_id
        / "tasks"
        / task_id
    )


# ---------------------------------------------------------------------------
# Import / Export API
# ---------------------------------------------------------------------------


@editor_bp.route("/api/editor/export/tasks", methods=["POST"])
def export_tasks() -> Any:
    """Export selected tasks to a ZIP archive."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_export"}), 403
    svc = ctx.import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        payload = request.get_json(silent=True) or {}
        tasks = payload.get("tasks", [])

        if not tasks:
            return jsonify({"ok": False, "error": "tasks_required"}), 400

        zip_path = svc.create_export_archive(tasks)
        filename = f"export_tasks_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"

        @after_this_request
        def remove_file(response):
            try:
                if os.path.exists(zip_path):
                    os.remove(zip_path)
            except Exception:
                pass
            return response

        return send_file(
            zip_path, as_attachment=True, download_name=filename, mimetype="application/zip"
        )
    except Exception as exc:
        logger.exception("[HTTP] Export failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/export/bulk", methods=["POST"])
def export_bulk() -> Any:
    """Export all tasks from a module or topic as ZIP."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_export"}), 403
    svc = ctx.import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        payload = request.get_json(silent=True) or {}
        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")  # optional — if omitted, export whole module

        if not module_id:
            return jsonify({"ok": False, "error": "module_id_required"}), 400

        storage = ctx.storage_service
        tasks_to_export = []

        modules = storage.load_modules()
        for mod in modules:
            if mod["id"] != module_id:
                continue
            for topic in mod.get("topics", []):
                if topic_id and topic["id"] != topic_id:
                    continue
                for task in topic.get("tasks", []):
                    tasks_to_export.append(
                        {
                            "module_id": module_id,
                            "topic_id": topic["id"],
                            "task_id": task["id"],
                        }
                    )

        if not tasks_to_export:
            return jsonify({"ok": False, "error": "no_tasks_found"}), 404

        zip_path = svc.create_export_archive(tasks_to_export)
        scope = topic_id or module_id
        filename = f"export_{scope}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"

        @after_this_request
        def remove_file(response):
            try:
                if os.path.exists(zip_path):
                    os.remove(zip_path)
            except Exception:
                pass
            return response

        return send_file(
            zip_path, as_attachment=True, download_name=filename, mimetype="application/zip"
        )
    except Exception as exc:
        logger.exception("[HTTP] Bulk export failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


# Cache for uploaded archives between check/confirm (avoids double upload)
_import_archive_cache: Dict[str, tuple] = {}  # cache_id -> (temp_path, timestamp)
_IMPORT_CACHE_MAX_AGE = 600  # 10 minutes
_IMPORT_CACHE_MAX_SIZE = 10  # max simultaneous cached archives


def _cleanup_import_cache():
    """Remove expired cache entries and enforce size limit."""
    now = time.time()
    expired = [
        k for k, (p, ts) in _import_archive_cache.items() if now - ts > _IMPORT_CACHE_MAX_AGE
    ]
    for k in expired:
        p, _ = _import_archive_cache.pop(k, (None, 0))
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass
    # Evict oldest if over size limit
    while len(_import_archive_cache) >= _IMPORT_CACHE_MAX_SIZE:
        oldest_key = min(_import_archive_cache, key=lambda k: _import_archive_cache[k][1])
        p, _ = _import_archive_cache.pop(oldest_key, (None, 0))
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass


@editor_bp.route("/api/editor/import/check", methods=["POST"])
def import_check() -> Any:
    """Validate archive before import. Caches archive for subsequent confirm."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403
    svc = ctx.import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        _cleanup_import_cache()

        if "file" not in request.files:
            return jsonify({"ok": False, "error": "file_required"}), 400

        file = request.files["file"]
        if not file or file.filename == "":
            return jsonify({"ok": False, "error": "no_selected_file"}), 400

        # Save temp
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        temp_path = tmp.name
        tmp.close()
        file.save(temp_path)

        report = svc.validate_import_archive(temp_path)

        # Cache the archive for confirm step
        cache_id = _uuid.uuid4().hex
        _import_archive_cache[cache_id] = (temp_path, time.time())

        if isinstance(report, dict):
            report["cache_id"] = cache_id

        return jsonify(report)

    except Exception as exc:
        logger.exception("[HTTP] Import check failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/import/confirm", methods=["POST"])
def import_confirm() -> Any:
    """Execute import with progress streaming."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403
    svc = ctx.import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        # Parse per-task conflict overrides (index -> resolution)
        per_task_conflict = {}
        try:
            raw_ptc = request.form.get("per_task_conflict", "")
            if raw_ptc:
                per_task_conflict = json.loads(raw_ptc)
        except (json.JSONDecodeError, TypeError):
            pass

        params = {
            "conflict_resolution": request.form.get("conflict_resolution", "skip"),
            "target_module_id": request.form.get("target_module_id"),
            "target_topic_id": request.form.get("target_topic_id"),
            "skip_errors": request.form.get("skip_errors") == "true",
            "per_task_conflict": per_task_conflict,
        }

        temp_path = None
        cached = False

        # Try to use cached archive from check step
        cache_id = request.form.get("cache_id", "")
        if cache_id and cache_id in _import_archive_cache:
            temp_path, _ = _import_archive_cache.pop(cache_id)
            cached = True

        # Fall back to file upload
        if not temp_path or not os.path.exists(temp_path):
            if "file" not in request.files:
                return jsonify({"ok": False, "error": "file_required"}), 400
            file = request.files["file"]
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
            temp_path = tmp.name
            tmp.close()
            file.save(temp_path)

        q = queue.Queue()

        def worker():
            try:

                def progress(curr, total, status):
                    q.put({"type": "progress", "current": curr, "total": total, "status": status})

                res = svc.import_tasks_atomic(temp_path, params, progress_callback=progress)
                q.put({"type": "result", "data": res})
            except Exception as e:
                logger.exception("Import worker failed")
                q.put({"type": "error", "error": str(e)})
            finally:
                q.put(None)  # Sentinel

        threading.Thread(target=worker, daemon=True).start()

        def generator():
            try:
                while True:
                    item = q.get()
                    if item is None:
                        break
                    yield json.dumps(item) + "\n"
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except Exception:
                        pass

        return Response(stream_with_context(generator()), mimetype="application/x-ndjson")

    except Exception as exc:
        logger.exception("[HTTP] Import confirm setup failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


# Cache for complex import archives
_complex_import_archive_cache: Dict[str, tuple] = {}  # cache_id -> (temp_path, timestamp)
_COMPLEX_IMPORT_CACHE_MAX_AGE = 600
_COMPLEX_IMPORT_CACHE_MAX_SIZE = 10


def _cleanup_complex_import_cache():
    now = time.time()
    expired = [
        k
        for k, (p, ts) in _complex_import_archive_cache.items()
        if now - ts > _COMPLEX_IMPORT_CACHE_MAX_AGE
    ]
    for k in expired:
        p, _ = _complex_import_archive_cache.pop(k, (None, 0))
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass
    while len(_complex_import_archive_cache) >= _COMPLEX_IMPORT_CACHE_MAX_SIZE:
        oldest_key = min(
            _complex_import_archive_cache, key=lambda k: _complex_import_archive_cache[k][1]
        )
        p, _ = _complex_import_archive_cache.pop(oldest_key, (None, 0))
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass


@editor_bp.route("/api/complexes/export", methods=["POST"])
def export_complexes_bundle() -> Any:
    """Export selected complexes (with dependencies) to a package archive."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_export"}), 403
    svc = ctx.complex_import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        payload = request.get_json(silent=True) or {}
        complex_ids = payload.get("complex_ids")
        if not isinstance(complex_ids, list):
            single_id = payload.get("complex_id")
            complex_ids = [single_id] if isinstance(single_id, str) and single_id.strip() else []
        complex_ids = [
            str(cid).strip() for cid in complex_ids if isinstance(cid, str) and str(cid).strip()
        ]
        if not complex_ids:
            return jsonify({"ok": False, "error": "complex_ids_required"}), 400

        options = {
            "include_tasks": payload.get("include_tasks", True),
            "include_theories": payload.get("include_theories", True),
        }
        zip_path = svc.create_export_archive(complex_ids, options=options)
        filename = f"export_complexes_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"

        @after_this_request
        def remove_file(response):
            try:
                if os.path.exists(zip_path):
                    os.remove(zip_path)
            except Exception:
                pass
            return response

        return send_file(
            zip_path,
            as_attachment=True,
            download_name=filename,
            mimetype="application/zip",
        )
    except Exception as exc:
        logger.exception("[HTTP] Complex export failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/complexes/import/check", methods=["POST"])
def import_complexes_check() -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403
    svc = ctx.complex_import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        _cleanup_complex_import_cache()

        if "file" not in request.files:
            return jsonify({"ok": False, "error": "file_required"}), 400
        file = request.files["file"]
        if not file or file.filename == "":
            return jsonify({"ok": False, "error": "no_selected_file"}), 400

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        temp_path = tmp.name
        tmp.close()
        file.save(temp_path)

        report = svc.validate_import_archive(temp_path)
        cache_id = _uuid.uuid4().hex
        _complex_import_archive_cache[cache_id] = (temp_path, time.time())
        if isinstance(report, dict):
            report["cache_id"] = cache_id
        return jsonify(report)
    except Exception as exc:
        logger.exception("[HTTP] Complex import check failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/complexes/import/confirm", methods=["POST"])
def import_complexes_confirm() -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403
    svc = ctx.complex_import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        params = {
            "complex_conflict_resolution": request.form.get(
                "complex_conflict_resolution", "new_id"
            ),
            "task_conflict_resolution": request.form.get("task_conflict_resolution", "skip"),
            "theory_conflict_resolution": request.form.get(
                "theory_conflict_resolution",
                "reuse_if_same_hash",
            ),
            "skip_errors": request.form.get("skip_errors") == "true",
            "atomic_mode": request.form.get("atomic_mode", "bundle"),
        }

        temp_path = None
        cache_id = request.form.get("cache_id", "")
        if cache_id and cache_id in _complex_import_archive_cache:
            temp_path, _ = _complex_import_archive_cache.pop(cache_id)

        if not temp_path or not os.path.exists(temp_path):
            if "file" not in request.files:
                return jsonify({"ok": False, "error": "file_required"}), 400
            file = request.files["file"]
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
            temp_path = tmp.name
            tmp.close()
            file.save(temp_path)

        q = queue.Queue()

        def worker():
            try:

                def progress(curr, total, status):
                    q.put({"type": "progress", "current": curr, "total": total, "status": status})

                res = svc.import_complexes_atomic(temp_path, params, progress_callback=progress)
                q.put({"type": "result", "data": res})
            except Exception as e:
                logger.exception("Complex import worker failed")
                q.put({"type": "error", "error": str(e)})
            finally:
                q.put(None)

        threading.Thread(target=worker, daemon=True).start()

        def generator():
            try:
                while True:
                    item = q.get()
                    if item is None:
                        break
                    yield json.dumps(item) + "\n"
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except Exception:
                        pass

        return Response(stream_with_context(generator()), mimetype="application/x-ndjson")

    except Exception as exc:
        logger.exception("[HTTP] Complex import confirm setup failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/test/import", methods=["POST"])
def import_test_from_file() -> Any:
    """Import test questions using TestFileParser."""
    temp_path = None
    try:
        if "file" not in request.files:
            return jsonify({"ok": False, "error": "file_required"}), 400

        file = request.files["file"]
        if not file or file.filename == "":
            return jsonify({"ok": False, "error": "no_selected_file"}), 400

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix or ".txt")
        temp_path = tmp.name
        file.save(temp_path)
        tmp.close()

        parser = TestFileParser()
        test_task = parser.create_test_from_file(temp_path)
        content = test_task.to_dict()
        return jsonify({"ok": True, "content": content})
    except Exception as exc:
        logger.exception("[HTTP] Failed to import test: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


@editor_bp.route("/api/editor/test/export", methods=["POST"])
def export_test_to_file() -> Any:
    """Export provided test content to a text file."""
    try:
        payload = request.json
        if not payload:
            return jsonify({"ok": False, "error": "payload_required"}), 400

        test_data = {
            "type": "test",
            "test_type": payload.get("test_type", "multiple_choice"),
            "questions": payload.get("questions", []),
            "settings": payload.get("settings", {}),
        }

        test_task = TestTask(test_data)
        parser = TestFileParser()

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".txt", mode="w", encoding="utf-8")
        temp_path = tmp.name
        tmp.close()

        parser.export_test_to_file(test_task, temp_path)

        filename = payload.get("filename") or f"test_{int(time.time())}.txt"

        @after_this_request
        def remove_file(response):
            try:
                os.remove(temp_path)
            except Exception:
                pass
            return response

        return send_file(
            temp_path,
            as_attachment=True,
            download_name=secure_filename(filename),
            mimetype="text/plain",
        )
    except Exception as exc:
        logger.exception("[HTTP] Failed to export test: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/logs/scale", methods=["POST"])
def save_editor_scale_log() -> Any:
    """Persist ClickEditor scale/zoom log to file for debugging."""
    try:
        payload = request.json
        if not payload:
            return jsonify({"ok": False, "error": "payload_required"}), 400

        module_id = payload.get("module") or "unknown_module"
        topic_id = payload.get("topic") or "unknown_topic"
        task_id = payload.get("task") or "unknown_task"
        entries = payload.get("entries") or []
        meta = payload.get("meta") or {}

        if not isinstance(entries, list) or not entries:
            return jsonify({"ok": False, "error": "entries_required"}), 400

        EDITOR_SCALE_LOG_DIR = get_extra("EDITOR_SCALE_LOG_DIR")
        PROJECT_ROOT = get_extra("PROJECT_ROOT")

        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        safe_module = secure_filename(str(module_id))
        safe_topic = secure_filename(str(topic_id))
        safe_task = secure_filename(str(task_id))
        filename = f"{safe_module}_{safe_topic}_{safe_task}_{timestamp}.json"
        file_path = EDITOR_SCALE_LOG_DIR / filename

        payload_to_save = {
            "module": module_id,
            "topic": topic_id,
            "task": task_id,
            "meta": meta,
            "entries": entries,
            "labelMode": payload.get("labelMode"),
            "image": payload.get("image"),
        }

        with open(file_path, "w", encoding="utf-8") as fh:
            json.dump(payload_to_save, fh, ensure_ascii=False, indent=2)

        logger.info("[HTTP] Saved editor scale log %s", file_path)
        return jsonify({"ok": True, "path": str(file_path.relative_to(PROJECT_ROOT))})
    except Exception as exc:
        logger.exception("[HTTP] Failed to save editor scale log: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/task/new", methods=["POST"])
def create_editor_task() -> Any:
    """Create a new task with initial data."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.json
        if not payload:
            return jsonify({"ok": False, "error": "payload_required"}), 400

        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")
        task_name = payload.get("task_name")
        task_type = payload.get("task_type")

        if not all([module_id, topic_id, task_name, task_type]):
            return jsonify({"ok": False, "error": "missing_required_fields"}), 400

        task_id = ctx.storage_service.create_task(
            module_id, topic_id, task_name, task_type
        )

        if task_id:
            return jsonify({"ok": True, "task_id": task_id})
        else:
            return jsonify({"ok": False, "error": "create_failed"}), 500

    except Exception as exc:
        logger.exception("[HTTP] Failed to create editor task: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/module/new", methods=["POST"])
def create_editor_module() -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.json
        name = payload.get("name")
        if not name:
            return jsonify({"ok": False, "error": "name_required"}), 400

        module_id = _make_safe_id(name)
        if not module_id:
            return jsonify({"ok": False, "error": "invalid_module_name"}), 400
        module_dir = ctx.storage_service.modules_dir / module_id
        module_dir.mkdir(parents=True, exist_ok=True)

        with open(module_dir / "module.json", "w", encoding="utf-8") as f:
            json.dump(
                {"id": module_id, "name": name, "topics": []}, f, indent=2, ensure_ascii=False
            )

        ctx.storage_service.reload_modules()
        return jsonify({"ok": True, "module_id": module_id})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/topic/new", methods=["POST"])
def create_editor_topic() -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.json
        module_id = payload.get("module_id")
        name = payload.get("name")
        if not all([module_id, name]):
            return jsonify({"ok": False, "error": "missing_params"}), 400

        topic_id = _make_safe_id(name)
        if not topic_id:
            return jsonify({"ok": False, "error": "invalid_topic_name"}), 400
        topic_dir = ctx.storage_service.modules_dir / module_id / "topics" / topic_id
        topic_dir.mkdir(parents=True, exist_ok=True)
        (topic_dir / "tasks").mkdir(exist_ok=True)

        with open(topic_dir / "topic.json", "w", encoding="utf-8") as f:
            json.dump({"id": topic_id, "name": name, "tasks": []}, f, indent=2, ensure_ascii=False)

        ctx.storage_service.reload_modules()
        return jsonify({"ok": True, "topic_id": topic_id})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


# _copy_editor_images removed (logic moved to StorageService)


@editor_bp.route("/api/editor/upload-image", methods=["POST"])
def upload_editor_image() -> Any:
    """Upload image for a specific task and return its relative path."""
    try:
        module_id = request.form.get("module")
        topic_id = request.form.get("topic")
        task_id = request.form.get("task")

        if not all([module_id, topic_id, task_id]):
            return jsonify({"ok": False, "error": "missing_params"}), 400

        if "file" not in request.files:
            return jsonify({"ok": False, "error": "file_required"}), 400

        file = request.files["file"]
        if file.filename == "":
            return jsonify({"ok": False, "error": "no_selected_file"}), 400

        filename = secure_filename(file.filename)

        task_dir = _resolve_task_dir(module_id, topic_id, task_id)
        images_dir = task_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)

        file_path = images_dir / filename
        counter = 1
        while file_path.exists():
            stem = Path(filename).stem
            suffix = Path(filename).suffix
            file_path = images_dir / f"{stem}_{counter:02d}{suffix}"
            counter += 1

        file.save(str(file_path))
        relative_path = os.path.relpath(file_path, get_ctx().data_dir).replace("\\", "/")

        logger.info("[HTTP] Image uploaded for task %s: %s", task_id, relative_path)
        return jsonify({"ok": True, "path": relative_path})

    except Exception as exc:
        logger.exception("[HTTP] Failed to upload image: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/image", methods=["GET"])
def serve_editor_image() -> Any:
    """Special endpoint for editor to serve images from any module path."""
    FLASK_DEBUG_ENABLED = get_extra("FLASK_DEBUG_ENABLED", False)
    ed_logger = get_extra("editor_logger", logger)

    if FLASK_DEBUG_ENABLED:
        logger.debug(
            "[HTTP] serve_editor_image invoked logger=%s level=%s enabled=%s propagate=%s handlers=%s",
            logger.name,
            logger.level,
            logger.isEnabledFor(logging.DEBUG),
            logger.propagate,
            logger.handlers,
        )
    module_id = request.args.get("module")
    topic_id = request.args.get("topic")
    task_id = request.args.get("task")
    path = request.args.get("path")
    ed_logger.info(
        "REQUEST /api/editor/image path=%s module=%s topic=%s task=%s",
        path,
        module_id,
        topic_id,
        task_id,
    )
    if not path:
        logger.warning("[HTTP] /api/editor/image without 'path' parameter")
        ed_logger.warning(
            "MISSING_PATH /api/editor/image module=%s topic=%s task=%s",
            module_id,
            topic_id,
            task_id,
        )
        return jsonify({"ok": False, "error": "path_required"}), 400

    target = _resolve_editor_image_path(
        path,
        module_id=module_id,
        topic_id=topic_id,
        task_id=task_id,
    )
    if not target:
        logger.warning(
            "[HTTP] /api/editor/image not found path=%s data_dir=%s",
            path,
            get_ctx().data_dir,
        )
        ed_logger.warning(
            "NOT_FOUND /api/editor/image path=%s module=%s topic=%s task=%s",
            path,
            module_id,
            topic_id,
            task_id,
        )
        return jsonify({"ok": False, "error": "image_not_found"}), 404

    logger.info("[HTTP] /api/editor/image serving %s", target)
    ed_logger.info(
        "SERVING /api/editor/image path=%s module=%s topic=%s task=%s resolved=%s",
        path,
        module_id,
        topic_id,
        task_id,
        target,
    )
    resp = send_file(str(target))
    resp.headers["Cache-Control"] = "private, max-age=3600"
    return resp
