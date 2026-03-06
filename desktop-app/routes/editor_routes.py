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
- GET    /api/editor/topic/<m>/<t>/theory-link           - Get topic-level theory link
- PUT    /api/editor/topic/<m>/<t>/theory-link           - Set topic-level theory link (+ optional propagation)
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
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

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

from api.complexes_api import validate_and_normalize_theory_link
from task_system.models.test_parser import TestFileParser
from task_system.models.test_task import TestTask

from routes._context import get_ctx, get_extra
from routes._helpers import _make_safe_id, _resolve_editor_image_path

logger = logging.getLogger(__name__)

editor_bp = Blueprint("editor", __name__)

_ARCHIVE_CONFIRM_IDEMPOTENCY_LOCK = threading.Lock()
_TASK_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE: Dict[str, Dict[str, Any]] = {}
_COMPLEX_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE: Dict[str, Dict[str, Any]] = {}
_ARCHIVE_CONFIRM_IDEMPOTENCY_TTL_SECONDS = 15 * 60


def _stable_json_hash(data: Any) -> str:
    payload = json.dumps(
        data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _cleanup_archive_confirm_idempotency_cache(cache: Dict[str, Dict[str, Any]]) -> None:
    now = time.time()
    stale_keys = [
        key
        for key, item in cache.items()
        if now - float(item.get("created_ts", 0)) > _ARCHIVE_CONFIRM_IDEMPOTENCY_TTL_SECONDS
    ]
    for key in stale_keys:
        cache.pop(key, None)


def _archive_confirm_idempotency_reserve(
    cache: Dict[str, Dict[str, Any]],
    idempotency_key: str,
    request_fingerprint: str,
) -> Optional[Dict[str, Any]]:
    if not idempotency_key:
        return None
    with _ARCHIVE_CONFIRM_IDEMPOTENCY_LOCK:
        _cleanup_archive_confirm_idempotency_cache(cache)
        item = cache.get(idempotency_key)
        if item:
            if item.get("request_fingerprint") != request_fingerprint:
                return {"conflict": True}
            if item.get("in_progress"):
                return {"in_progress": True}
            cached_response = dict(item.get("response") or {})
            cached_response["idempotent_replay"] = True
            return cached_response
        cache[idempotency_key] = {
            "created_ts": time.time(),
            "request_fingerprint": request_fingerprint,
            "in_progress": True,
            "response": None,
        }
        return None


def _archive_confirm_idempotency_store(
    cache: Dict[str, Dict[str, Any]],
    idempotency_key: str,
    request_fingerprint: str,
    response: Dict[str, Any],
) -> None:
    if not idempotency_key:
        return
    payload = dict(response or {})
    payload["idempotency_key"] = idempotency_key
    with _ARCHIVE_CONFIRM_IDEMPOTENCY_LOCK:
        _cleanup_archive_confirm_idempotency_cache(cache)
        cache[idempotency_key] = {
            "created_ts": time.time(),
            "request_fingerprint": request_fingerprint,
            "in_progress": False,
            "response": payload,
        }


def _archive_confirm_idempotency_release(
    cache: Dict[str, Dict[str, Any]],
    idempotency_key: str,
    request_fingerprint: str,
) -> None:
    if not idempotency_key:
        return
    with _ARCHIVE_CONFIRM_IDEMPOTENCY_LOCK:
        item = cache.get(idempotency_key)
        if not item:
            return
        if item.get("request_fingerprint") == request_fingerprint and item.get("in_progress"):
            cache.pop(idempotency_key, None)


def _uploaded_file_fingerprint(file_storage: Any) -> Optional[Dict[str, Any]]:
    if file_storage is None:
        return None
    filename = str(getattr(file_storage, "filename", "") or "").strip()
    stream = getattr(file_storage, "stream", None)
    if stream is None:
        return {"filename": filename, "sha256": None}

    hasher = hashlib.sha256()
    try:
        stream.seek(0)
    except Exception:
        pass

    while True:
        chunk = stream.read(1024 * 1024)
        if not chunk:
            break
        if isinstance(chunk, str):
            chunk = chunk.encode("utf-8")
        hasher.update(chunk)

    try:
        stream.seek(0)
    except Exception:
        pass

    return {
        "filename": filename,
        "sha256": hasher.hexdigest(),
    }


def _stream_result_response(payload: Dict[str, Any]) -> Response:
    body = json.dumps({"type": "result", "data": payload}, ensure_ascii=False) + "\n"
    return Response(body, mimetype="application/x-ndjson")


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


def _normalize_propagation_mode(value: Any) -> str:
    mode = str(value or "").strip().lower()
    if mode in {"safe", "inherit_only_force", "all_force"}:
        return mode
    return "safe"


def _parse_task_ref(task_ref: Any) -> Optional[Tuple[str, str, str]]:
    if not isinstance(task_ref, str):
        return None
    parts = [p.strip() for p in task_ref.split("/") if p is not None]
    if len(parts) < 3:
        return None
    module_id, topic_id, task_id = parts[0], parts[1], parts[-1]
    if not module_id or not topic_id or not task_id:
        return None
    return module_id, topic_id, task_id


def _collect_topic_refs_from_tasks(task_refs: Any) -> Set[Tuple[str, str]]:
    refs: Set[Tuple[str, str]] = set()
    if not isinstance(task_refs, list):
        return refs
    for task_ref in task_refs:
        parsed = _parse_task_ref(task_ref)
        if not parsed:
            continue
        module_id, topic_id, _ = parsed
        refs.add((module_id, topic_id))
    return refs


def _complex_theory_mode(payload: Dict[str, Any]) -> str:
    raw = str(payload.get("theory_mode") or "").strip().lower()
    if raw in {"inherit", "override"}:
        return raw
    if isinstance(payload.get("theory_link"), dict):
        return "override"
    return "inherit"


def _json_like_equal(left: Any, right: Any) -> bool:
    if isinstance(left, (dict, list)) or isinstance(right, (dict, list)):
        try:
            return json.dumps(left, ensure_ascii=False, sort_keys=True) == json.dumps(
                right, ensure_ascii=False, sort_keys=True
            )
        except Exception:
            return left == right
    return left == right


def _compute_inherited_theory_for_topics(
    topic_refs: Set[Tuple[str, str]],
) -> Dict[str, Any]:
    storage = get_ctx().storage_service
    topic_rows: List[Dict[str, Any]] = []
    unique_theory_links: Dict[str, Dict[str, Any]] = {}

    for module_id, topic_id in sorted(topic_refs):
        theory_link = storage.get_topic_theory_link(module_id, topic_id)
        theory_id = (
            str(theory_link.get("theory_id") or "").strip()
            if isinstance(theory_link, dict)
            else ""
        )
        topic_rows.append(
            {
                "module_id": module_id,
                "topic_id": topic_id,
                "theory_id": theory_id or None,
            }
        )
        if theory_id and isinstance(theory_link, dict):
            unique_theory_links[theory_id] = dict(theory_link)

    if not unique_theory_links:
        return {
            "status": "none",
            "inherited_theory_link": None,
            "theory_ids": [],
            "topic_rows": topic_rows,
        }

    if len(unique_theory_links) == 1:
        theory_id = next(iter(unique_theory_links.keys()))
        return {
            "status": "ok",
            "inherited_theory_link": unique_theory_links[theory_id],
            "theory_ids": [theory_id],
            "topic_rows": topic_rows,
        }

    return {
        "status": "conflict",
        "inherited_theory_link": None,
        "theory_ids": sorted(unique_theory_links.keys()),
        "topic_rows": topic_rows,
    }


def _sync_topic_theory_to_complexes(
    module_id: str,
    topic_id: str,
    *,
    propagation_mode: str = "safe",
    dry_run: bool = True,
) -> Dict[str, Any]:
    ctx = get_ctx()
    mode = _normalize_propagation_mode(propagation_mode)
    complexes = ctx.complex_service.get_all_complexes()

    items: List[Dict[str, Any]] = []
    summary = {
        "mode": mode,
        "dry_run": bool(dry_run),
        "target_topic": {"module_id": module_id, "topic_id": topic_id},
        "impacted_complexes": 0,
        "updated": 0,
        "would_update": 0,
        "skipped": 0,
    }

    target_ref = (module_id, topic_id)
    force_refresh = mode == "inherit_only_force"
    target_all_modes = mode == "all_force"

    for complex_obj in complexes:
        payload = complex_obj.dict() if hasattr(complex_obj, "dict") else {}
        complex_id = str(payload.get("id") or "").strip()
        if not complex_id:
            continue

        task_refs = payload.get("tasks") if isinstance(payload.get("tasks"), list) else []
        topic_refs = _collect_topic_refs_from_tasks(task_refs)
        if target_ref not in topic_refs:
            continue

        summary["impacted_complexes"] += 1
        current_mode = _complex_theory_mode(payload)
        if not target_all_modes and current_mode != "inherit":
            items.append(
                {
                    "complex_id": complex_id,
                    "action": "skipped",
                    "reason": "mode_override",
                    "mode": current_mode,
                }
            )
            summary["skipped"] += 1
            continue

        inherited = _compute_inherited_theory_for_topics(topic_refs)
        inherited_status = inherited.get("status")

        updates: Dict[str, Any] = {
            "theory_sync_status": inherited_status,
            "theory_sync_meta": {
                "source": "topic_propagation",
                "updated_at": datetime.utcnow().isoformat(),
                "topic_count": len(topic_refs),
                "theory_ids": inherited.get("theory_ids") or [],
            },
        }

        if current_mode == "inherit":
            updates["theory_mode"] = "inherit"
        elif target_all_modes:
            updates["theory_mode"] = "override"

        if inherited_status == "ok":
            updates["theory_link"] = inherited.get("inherited_theory_link")
        elif inherited_status == "none":
            updates["theory_link"] = None
        else:
            # conflict: keep current complex theory_link untouched
            updates.pop("theory_link", None)
            updates["theory_sync_meta"]["conflict_topics"] = inherited.get("topic_rows") or []

        changed_keys = []
        for key, next_value in updates.items():
            if not _json_like_equal(payload.get(key), next_value):
                changed_keys.append(key)

        if not changed_keys and not (force_refresh and current_mode == "inherit"):
            items.append(
                {
                    "complex_id": complex_id,
                    "action": "skipped",
                    "reason": "unchanged",
                    "mode": current_mode,
                    "status": inherited_status,
                }
            )
            summary["skipped"] += 1
            continue

        if dry_run:
            items.append(
                {
                    "complex_id": complex_id,
                    "action": "would_update",
                    "mode": current_mode,
                    "status": inherited_status,
                    "changed_keys": changed_keys,
                }
            )
            summary["would_update"] += 1
            continue

        ctx.complex_service.update_complex(
            complex_id,
            {
                **updates,
                "updated_by_user_id": ctx.user_id,
            },
        )
        items.append(
            {
                "complex_id": complex_id,
                "action": "updated",
                "mode": current_mode,
                "status": inherited_status,
                "changed_keys": changed_keys,
            }
        )
        summary["updated"] += 1

    return {"summary": summary, "items": items}


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
        request_fingerprint = ""
        idempotency_key = str(request.form.get("idempotency_key") or "").strip()
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
        cache_id = str(request.form.get("cache_id") or "").strip()
        upload_fingerprint = None
        upload_file = None
        if cache_id:
            upload_fingerprint = None
        else:
            if "file" not in request.files:
                return jsonify({"ok": False, "error": "file_required"}), 400
            upload_file = request.files["file"]
            if not upload_file or upload_file.filename == "":
                return jsonify({"ok": False, "error": "no_selected_file"}), 400
            upload_fingerprint = _uploaded_file_fingerprint(upload_file)

        request_fingerprint = _stable_json_hash(
            {
                "cache_id": cache_id or None,
                "uploaded_file": upload_fingerprint,
                "params": params,
            }
        )
        cached_response = _archive_confirm_idempotency_reserve(
            _TASK_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
            idempotency_key,
            request_fingerprint,
        )
        if cached_response:
            if cached_response.get("conflict"):
                return jsonify({"ok": False, "error": "idempotency_key_conflict"}), 409
            if cached_response.get("in_progress"):
                return jsonify({"ok": False, "error": "idempotency_key_in_progress"}), 409
            logger.info(
                "[HTTP] editor/import/confirm idempotent replay: key=%s cache_id=%s",
                idempotency_key,
                cache_id or "-",
            )
            return _stream_result_response(cached_response)

        # Try to use cached archive from check step
        if cache_id and cache_id in _import_archive_cache:
            temp_path, _ = _import_archive_cache.pop(cache_id)

        # Fall back to file upload
        if not temp_path or not os.path.exists(temp_path):
            if upload_file is None:
                _archive_confirm_idempotency_release(
                    _TASK_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
                    idempotency_key,
                    request_fingerprint,
                )
                return jsonify({"ok": False, "error": "file_required"}), 400
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
            temp_path = tmp.name
            tmp.close()
            upload_file.save(temp_path)

        q = queue.Queue()

        def worker():
            try:

                def progress(curr, total, status):
                    q.put({"type": "progress", "current": curr, "total": total, "status": status})

                res = svc.import_tasks_atomic(temp_path, params, progress_callback=progress)
                if isinstance(res, dict) and idempotency_key:
                    res = dict(res)
                    res["idempotency_key"] = idempotency_key
                if isinstance(res, dict):
                    _archive_confirm_idempotency_store(
                        _TASK_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
                        idempotency_key,
                        request_fingerprint,
                        res,
                    )
                q.put({"type": "result", "data": res})
            except Exception as e:
                logger.exception("Import worker failed")
                _archive_confirm_idempotency_release(
                    _TASK_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
                    idempotency_key,
                    request_fingerprint,
                )
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
        _archive_confirm_idempotency_release(
            _TASK_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
            locals().get("idempotency_key", ""),
            locals().get("request_fingerprint", ""),
        )
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

        request_fingerprint = ""
        idempotency_key = str(request.form.get("idempotency_key") or "").strip()
        temp_path = None
        cache_id = str(request.form.get("cache_id") or "").strip()
        upload_file = None
        upload_fingerprint = None
        if cache_id:
            upload_fingerprint = None
        else:
            if "file" not in request.files:
                return jsonify({"ok": False, "error": "file_required"}), 400
            upload_file = request.files["file"]
            if not upload_file or upload_file.filename == "":
                return jsonify({"ok": False, "error": "no_selected_file"}), 400
            upload_fingerprint = _uploaded_file_fingerprint(upload_file)

        request_fingerprint = _stable_json_hash(
            {
                "cache_id": cache_id or None,
                "uploaded_file": upload_fingerprint,
                "params": params,
            }
        )
        cached_response = _archive_confirm_idempotency_reserve(
            _COMPLEX_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
            idempotency_key,
            request_fingerprint,
        )
        if cached_response:
            if cached_response.get("conflict"):
                return jsonify({"ok": False, "error": "idempotency_key_conflict"}), 409
            if cached_response.get("in_progress"):
                return jsonify({"ok": False, "error": "idempotency_key_in_progress"}), 409
            logger.info(
                "[HTTP] complexes/import/confirm idempotent replay: key=%s cache_id=%s",
                idempotency_key,
                cache_id or "-",
            )
            return _stream_result_response(cached_response)

        if cache_id and cache_id in _complex_import_archive_cache:
            temp_path, _ = _complex_import_archive_cache.pop(cache_id)

        if not temp_path or not os.path.exists(temp_path):
            if upload_file is None:
                _archive_confirm_idempotency_release(
                    _COMPLEX_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
                    idempotency_key,
                    request_fingerprint,
                )
                return jsonify({"ok": False, "error": "file_required"}), 400
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
            temp_path = tmp.name
            tmp.close()
            upload_file.save(temp_path)

        q = queue.Queue()

        def worker():
            try:

                def progress(curr, total, status):
                    q.put({"type": "progress", "current": curr, "total": total, "status": status})

                res = svc.import_complexes_atomic(temp_path, params, progress_callback=progress)
                if isinstance(res, dict) and idempotency_key:
                    res = dict(res)
                    res["idempotency_key"] = idempotency_key
                if isinstance(res, dict):
                    _archive_confirm_idempotency_store(
                        _COMPLEX_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
                        idempotency_key,
                        request_fingerprint,
                        res,
                    )
                q.put({"type": "result", "data": res})
            except Exception as e:
                logger.exception("Complex import worker failed")
                _archive_confirm_idempotency_release(
                    _COMPLEX_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
                    idempotency_key,
                    request_fingerprint,
                )
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
        _archive_confirm_idempotency_release(
            _COMPLEX_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
            locals().get("idempotency_key", ""),
            locals().get("request_fingerprint", ""),
        )
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

        theory_link_payload = payload.get("theory_link")
        normalized_theory_link = None
        if theory_link_payload is not None:
            normalized_theory_link, theory_link_error = validate_and_normalize_theory_link(
                theory_link_payload, required=False
            )
            if theory_link_error is not None:
                return (
                    jsonify(
                        {
                            "ok": False,
                            "error": "validation_error",
                            "details": {"errors": [{"field": "theory_link", "reason": theory_link_error}]},
                        }
                    ),
                    400,
                )
            if isinstance(normalized_theory_link, dict):
                theory_id = str(normalized_theory_link.get("theory_id") or "").strip()
                if theory_id:
                    try:
                        ctx.theory_service.get_theory(theory_id, include_delta=False)
                    except Exception:
                        return (
                            jsonify(
                                {
                                    "ok": False,
                                    "error": "validation_error",
                                    "details": {
                                        "errors": [
                                            {
                                                "field": "theory_link",
                                                "reason": "theory_not_found",
                                                "value": theory_id,
                                            }
                                        ]
                                    },
                                }
                            ),
                            400,
                        )

        topic_id = _make_safe_id(name)
        if not topic_id:
            return jsonify({"ok": False, "error": "invalid_topic_name"}), 400
        topic_dir = ctx.storage_service.modules_dir / module_id / "topics" / topic_id
        topic_dir.mkdir(parents=True, exist_ok=True)
        (topic_dir / "tasks").mkdir(exist_ok=True)

        topic_payload = {"id": topic_id, "name": name, "tasks": []}
        if isinstance(normalized_theory_link, dict):
            topic_payload["theory_link"] = normalized_theory_link
        with open(topic_dir / "topic.json", "w", encoding="utf-8") as f:
            json.dump(topic_payload, f, indent=2, ensure_ascii=False)

        ctx.storage_service.reload_modules()
        return jsonify({"ok": True, "topic_id": topic_id})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/topic/<module_id>/<topic_id>/theory-link", methods=["GET"])
def get_editor_topic_theory_link(module_id: str, topic_id: str) -> Any:
    try:
        topic = get_ctx().storage_service.get_topic(module_id, topic_id)
        if not topic:
            return jsonify({"ok": False, "error": "topic_not_found"}), 404

        theory_link = get_ctx().storage_service.get_topic_theory_link(module_id, topic_id)
        preview = _sync_topic_theory_to_complexes(
            module_id,
            topic_id,
            propagation_mode="safe",
            dry_run=True,
        )
        return jsonify(
            {
                "ok": True,
                "item": {
                    "module_id": module_id,
                    "topic_id": topic_id,
                    "theory_link": theory_link,
                },
                "propagation_preview": preview.get("summary", {}),
            }
        )
    except Exception as exc:
        logger.exception(
            "[HTTP] Failed to load topic theory link module=%s topic=%s: %s",
            module_id,
            topic_id,
            exc,
        )
        return jsonify({"ok": False, "error": "topic_theory_link_load_failed"}), 500


@editor_bp.route("/api/editor/topic/<module_id>/<topic_id>/theory-link", methods=["PUT"])
def set_editor_topic_theory_link(module_id: str, topic_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.get_json(silent=True) or {}
        if "theory_link" not in payload:
            return jsonify({"ok": False, "error": "theory_link_required"}), 400

        theory_link_payload = payload.get("theory_link")
        normalized_theory_link = None
        if theory_link_payload is not None:
            normalized_theory_link, theory_link_error = validate_and_normalize_theory_link(
                theory_link_payload, required=False
            )
            if theory_link_error is not None:
                return (
                    jsonify(
                        {
                            "ok": False,
                            "error": "validation_error",
                            "details": {"errors": [{"field": "theory_link", "reason": theory_link_error}]},
                        }
                    ),
                    400,
                )
            if isinstance(normalized_theory_link, dict):
                theory_id = str(normalized_theory_link.get("theory_id") or "").strip()
                if theory_id:
                    try:
                        ctx.theory_service.get_theory(theory_id, include_delta=False)
                    except Exception:
                        return (
                            jsonify(
                                {
                                    "ok": False,
                                    "error": "validation_error",
                                    "details": {
                                        "errors": [
                                            {
                                                "field": "theory_link",
                                                "reason": "theory_not_found",
                                                "value": theory_id,
                                            }
                                        ]
                                    },
                                }
                            ),
                            400,
                        )

        updated_topic_payload = ctx.storage_service.set_topic_theory_link(
            module_id,
            topic_id,
            normalized_theory_link,
        )

        apply_to_complexes = bool(payload.get("apply_to_complexes"))
        mode = _normalize_propagation_mode(payload.get("propagation_mode"))
        dry_run = bool(payload.get("dry_run"))
        propagation_result = None
        if apply_to_complexes:
            propagation_result = _sync_topic_theory_to_complexes(
                module_id,
                topic_id,
                propagation_mode=mode,
                dry_run=dry_run,
            )

        return jsonify(
            {
                "ok": True,
                "item": {
                    "module_id": module_id,
                    "topic_id": topic_id,
                    "theory_link": updated_topic_payload.get("theory_link")
                    if isinstance(updated_topic_payload, dict)
                    else None,
                },
                "propagation": propagation_result,
            }
        )
    except ValueError as exc:
        if str(exc) == "topic_not_found":
            return jsonify({"ok": False, "error": "topic_not_found"}), 404
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception(
            "[HTTP] Failed to save topic theory link module=%s topic=%s: %s",
            module_id,
            topic_id,
            exc,
        )
        return jsonify({"ok": False, "error": "topic_theory_link_save_failed"}), 500


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
