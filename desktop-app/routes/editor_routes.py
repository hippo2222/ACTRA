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
- POST   /api/editor/test/import                          - Import test from file/text
- POST   /api/editor/test/export                          - Export test to file
- POST   /api/editor/logs/scale                           - Save scale log
- POST   /api/editor/task/bootstrap                       - Reserve task id + build unsaved editor payload
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

from routes._context import get_ctx, get_extra, is_hosted_web_runtime
from routes._helpers import (
    _maybe_hosted_shadow_write_error_response,
    _compute_inherited_theory_for_topics,
    _make_safe_id,
    _resolve_editor_image_path,
    _serialize_workspace_catalog_modules,
    _serialize_workspace_task_payload,
)
from services.hosted_shadow_fallback import (
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)
from services.workspace_limits_service import WorkspaceLimitError
from persistence.runtime import HOSTED_SHADOW_WRITE_FALLBACK_ENV

logger = logging.getLogger(__name__)

editor_bp = Blueprint("editor", __name__)

_ARCHIVE_CONFIRM_IDEMPOTENCY_LOCK = threading.Lock()
_TASK_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE: Dict[str, Dict[str, Any]] = {}
_COMPLEX_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE: Dict[str, Dict[str, Any]] = {}
_ARCHIVE_CONFIRM_IDEMPOTENCY_TTL_SECONDS = 15 * 60

_WORKSPACE_IMPORT_MARKER_KEYS = (
    "source_complex_id",
    "source_catalog_item_id",
    "source_catalog_version_id",
    "prefer_existing_by_lineage",
    "requested_by_user_id",
)


def _workspace_limit_response(exc: WorkspaceLimitError) -> Any:
    return jsonify(exc.to_payload()), 409


def _hosted_editor_asset_degraded_response(
    *,
    error: str,
    operation: str,
    reason: str,
    status: int = 503,
    route_contract: Optional[Dict[str, Any]] = None,
) -> Any:
    payload: Dict[str, Any] = {
        "ok": False,
        "error": str(error or "").strip() or "hosted_asset_contract_blocked",
        "degraded": True,
        "details": {
            "operation": str(operation or "").strip() or None,
            "reason": str(reason or "").strip() or None,
            "runtime_mode": "hosted_web" if is_hosted_web_runtime() else "legacy_local",
            "source_of_truth": "asset_id/asset_url",
        },
    }
    if isinstance(route_contract, dict):
        payload["route_contract"] = route_contract
    return jsonify(payload), int(status)


def _normalize_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _is_imported_workspace_graph_payload(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    created_via = str(
        item.get("created_via")
        or ((item.get("ownership") or {}).get("created_via") if isinstance(item.get("ownership"), dict) else "")
        or ""
    ).strip().lower()
    if created_via in {"workspace_import", "archive_import"}:
        return True
    return bool(
        _normalize_optional_text(item.get("source_catalog_item_id"))
        or _normalize_optional_text(
            (item.get("source_lineage") or {}).get("catalog_item_id")
            if isinstance(item.get("source_lineage"), dict)
            else None
        )
        or _normalize_optional_text(
            (item.get("sourceLineage") or {}).get("catalog_item_id")
            if isinstance(item.get("sourceLineage"), dict)
            else None
        )
    )


def _is_ownerless_workspace_graph_payload(item: Any, *, current_user_id: str) -> bool:
    normalized_user_id = _normalize_optional_text(current_user_id)
    if not normalized_user_id or normalized_user_id == "guest":
        return False
    if not isinstance(item, dict):
        return False
    if _normalize_optional_text(item.get("created_by_user_id")) is not None:
        return False
    if bool(item.get("has_source_lineage")):
        return False
    if _normalize_optional_text(item.get("source_catalog_item_id")) is not None:
        return False
    workspace_copy_kind = str(item.get("workspace_copy_kind") or "").strip().lower()
    if workspace_copy_kind and workspace_copy_kind != "local_draft":
        return False
    content_scope = str(item.get("content_scope") or "").strip().lower()
    if content_scope and content_scope != "shared_local":
        return False
    return True


def _is_visible_workspace_graph_payload_for_current_user(item: Any, *, current_user_id: str) -> bool:
    if not isinstance(item, dict):
        return False
    ownership = item.get("ownership") if isinstance(item.get("ownership"), dict) else {}
    if ownership.get("is_owned_by_current_user") is True:
        return True
    return _is_imported_workspace_graph_payload(item)


def _build_hosted_editor_workspace_meta(
    *,
    current_user_id: str,
    existing_payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    existing = existing_payload if isinstance(existing_payload, dict) else {}
    created_by_user_id = _normalize_optional_text(existing.get("created_by_user_id")) or current_user_id
    created_via = _normalize_optional_text(existing.get("created_via")) or "manual_editor"
    content_scope = _normalize_optional_text(existing.get("content_scope")) or "shared_local"
    return {
        "created_by_user_id": created_by_user_id,
        "updated_by_user_id": current_user_id,
        "created_via": created_via,
        "content_scope": content_scope,
    }


def _apply_hosted_editor_task_ownership(
    payload: Any,
    *,
    current_user_id: str,
    existing_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    normalized = dict(payload or {}) if isinstance(payload, dict) else {}
    normalized.pop("ownership", None)

    workspace_meta = _build_hosted_editor_workspace_meta(
        current_user_id=current_user_id,
        existing_payload=existing_metadata,
    )

    metadata = normalized.get("metadata") if isinstance(normalized.get("metadata"), dict) else {}
    metadata = dict(metadata)
    metadata.pop("ownership", None)
    metadata.update(workspace_meta)
    normalized["metadata"] = metadata

    task_data = normalized.get("task_data") if isinstance(normalized.get("task_data"), dict) else None
    if isinstance(task_data, dict):
        task_data = dict(task_data)
        meta = task_data.get("meta") if isinstance(task_data.get("meta"), dict) else {}
        meta = dict(meta)
        meta.pop("ownership", None)
        meta.update(workspace_meta)
        task_data["meta"] = meta
        normalized["task_data"] = task_data

    return normalized


def _load_hosted_editor_task_metadata_if_visible(
    module_id: str,
    topic_id: str,
    task_id: str,
    *,
    current_user_id: str,
) -> Optional[Dict[str, Any]]:
    data = get_ctx().storage_service.load_task(module_id, topic_id, task_id)
    if not data:
        return None
    serialized = _serialize_workspace_task_payload(
        data,
        current_user_id=current_user_id,
    )
    metadata = serialized.get("metadata") if isinstance(serialized.get("metadata"), dict) else {}
    if not _is_visible_workspace_graph_payload_for_current_user(
        metadata,
        current_user_id=current_user_id,
    ):
        return None
    return metadata


def _adopt_workspace_graph_payload_for_current_user(item: Any, *, current_user_id: str) -> Any:
    if not isinstance(item, dict):
        return item
    normalized = dict(item)
    if _is_ownerless_workspace_graph_payload(normalized, current_user_id=current_user_id):
        normalized["created_by_user_id"] = current_user_id
        normalized["updated_by_user_id"] = normalized.get("updated_by_user_id") or current_user_id
        normalized["created_via"] = str(normalized.get("created_via") or "manual_editor").strip() or "manual_editor"
        normalized["content_scope"] = str(normalized.get("content_scope") or "shared_local").strip() or "shared_local"
        ownership = dict(normalized.get("ownership") or {})
        ownership.update(
            {
                "scope": "workspace",
                "content_scope": normalized["content_scope"],
                "created_by_user_id": current_user_id,
                "updated_by_user_id": normalized.get("updated_by_user_id"),
                "created_via": normalized["created_via"],
                "has_owner": True,
                "is_owned_by_current_user": True,
                "is_shared_library": normalized["content_scope"] == "shared_local",
            }
        )
        normalized["ownership"] = ownership
    return normalized


def _filter_hosted_workspace_catalog_modules(modules: Any, *, current_user_id: str) -> List[Dict[str, Any]]:
    filtered_modules: List[Dict[str, Any]] = []
    if not isinstance(modules, list):
        return filtered_modules

    for module in modules:
        if not isinstance(module, dict):
            continue
        module_payload = dict(module)
        serialized_topics: List[Dict[str, Any]] = []
        for topic in module_payload.get("topics") or []:
            if not isinstance(topic, dict):
                continue
            topic_payload = dict(topic)
            serialized_tasks: List[Dict[str, Any]] = []
            for task in topic_payload.get("tasks") or []:
                if not isinstance(task, dict):
                    continue
                task_payload = dict(task)
                if _is_visible_workspace_graph_payload_for_current_user(
                    task_payload,
                    current_user_id=current_user_id,
                ):
                    serialized_tasks.append(task_payload)
            topic_payload["tasks"] = serialized_tasks
            if serialized_tasks or _is_visible_workspace_graph_payload_for_current_user(
                topic_payload,
                current_user_id=current_user_id,
            ):
                serialized_topics.append(topic_payload)
        module_payload["topics"] = serialized_topics
        if serialized_topics or _is_visible_workspace_graph_payload_for_current_user(
            module_payload,
            current_user_id=current_user_id,
        ):
            filtered_modules.append(module_payload)

    return filtered_modules


def _stable_json_hash(data: Any) -> str:
    payload = json.dumps(
        data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _public_import_route_contract(*, mode: str, import_family: str) -> Dict[str, Any]:
    return {
        "namespace": "public_editor_import_export",
        "mode": mode,
        "import_family": import_family,
        "public_api": True,
        "workspace_import": False,
    }


def _with_public_import_route_contract(
    payload: Any,
    *,
    mode: str,
    import_family: str,
) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = dict(payload)
    normalized["route_contract"] = _public_import_route_contract(
        mode=mode,
        import_family=import_family,
    )
    return normalized


def _hosted_public_import_export_blocked_response(
    *,
    mode: str,
    import_family: str,
    operation: str,
    write_path: bool,
    service_contract: Optional[Dict[str, Any]] = None,
) -> Optional[Any]:
    if not is_hosted_web_runtime():
        return None
    error_cls = (
        HostedShadowWriteFallbackDisabledError
        if write_path
        else HostedShadowReadFallbackDisabledError
    )
    exc = error_cls(
        operation,
        reason="public_import_export_hosted_source_of_truth_not_implemented",
    )
    extra_payload: Dict[str, Any] = {
        "route_contract": _public_import_route_contract(
            mode=mode,
            import_family=import_family,
        ),
    }
    if isinstance(service_contract, dict):
        extra_payload["service_contract"] = dict(service_contract)
    return _maybe_hosted_shadow_write_error_response(exc, extra_payload=extra_payload)


def _workspace_import_markers_in_mapping(payload: Any) -> List[str]:
    if not hasattr(payload, "__contains__"):
        return []
    return [key for key in _WORKSPACE_IMPORT_MARKER_KEYS if key in payload]


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


def _hosted_shadow_stream_payload(
    exc: Exception,
    *,
    mode: str,
    import_family: str,
    service_contract: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    if isinstance(exc, HostedShadowReadFallbackDisabledError):
        payload: Dict[str, Any] = {
            "ok": False,
            "error": "hosted_shadow_read_blocked",
            "degraded": True,
            "details": {
                "operation": str(exc.operation or "").strip() or None,
                "reason": str(exc.reason or "").strip() or None,
                "runtime_mode": "hosted_web" if is_hosted_web_runtime() else "legacy_local",
                "source_of_truth": "postgres",
            },
            "route_contract": _public_import_route_contract(
                mode=mode,
                import_family=import_family,
            ),
        }
        if isinstance(service_contract, dict):
            payload["service_contract"] = dict(service_contract)
        return payload

    if not isinstance(exc, HostedShadowWriteFallbackDisabledError):
        return None

    payload = {
        "ok": False,
        "error": "hosted_shadow_write_blocked",
        "degraded": True,
        "details": {
            "operation": str(exc.operation or "").strip() or None,
            "reason": str(exc.reason or "").strip() or None,
            "runtime_mode": "hosted_web" if is_hosted_web_runtime() else "legacy_local",
            "env_opt_in": HOSTED_SHADOW_WRITE_FALLBACK_ENV,
        },
        "route_contract": _public_import_route_contract(
            mode=mode,
            import_family=import_family,
        ),
    }
    if isinstance(service_contract, dict):
        payload["service_contract"] = dict(service_contract)
    return payload


# ---------------------------------------------------------------------------
# Editor CRUD
# ---------------------------------------------------------------------------


@editor_bp.route("/api/editor/catalog", methods=["GET"])
def get_editor_catalog() -> Any:
    """Return the full module/topic/task hierarchy for the editor."""
    try:
        ctx = get_ctx()
        modules = ctx.storage_service.load_modules()
        modules = _serialize_workspace_catalog_modules(
            modules,
            current_user_id=ctx.user_id,
        )
        if is_hosted_web_runtime():
            modules = _filter_hosted_workspace_catalog_modules(
                modules,
                current_user_id=ctx.user_id,
            )
        return jsonify({"ok": True, "modules": modules})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to get editor catalog: %s", exc)
        return jsonify({"ok": False, "error": "catalog_load_failed"}), 500


@editor_bp.route("/api/editor/task/<module_id>/<topic_id>/<task_id>", methods=["GET"])
def get_editor_task(module_id: str, topic_id: str, task_id: str) -> Any:
    """Load full task data for editing."""
    try:
        ctx = get_ctx()
        data = ctx.storage_service.load_task(module_id, topic_id, task_id)
        if not data:
            return jsonify({"ok": False, "error": "task_not_found"}), 404
        data = _serialize_workspace_task_payload(
            data,
            current_user_id=ctx.user_id,
        )
        if is_hosted_web_runtime():
            metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
            if not _is_visible_workspace_graph_payload_for_current_user(
                metadata,
                current_user_id=ctx.user_id,
            ):
                return jsonify({"ok": False, "error": "task_not_found"}), 404
            data["metadata"] = metadata
            data["ownership"] = metadata.get("ownership")
            task_data = data.get("task_data")
            if isinstance(task_data, dict) and isinstance(task_data.get("meta"), dict):
                task_data = dict(task_data)
                task_data["meta"] = metadata
                data["task_data"] = task_data
        return jsonify({"ok": True, "task": data})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to load editor task: %s", exc)
        return jsonify({"ok": False, "error": "task_load_failed"}), 500


@editor_bp.route("/api/editor/difficulty-meta", methods=["GET"])
def editor_difficulty_meta() -> Any:
    """Return difficulty authoring metadata for a task type/subtype."""
    try:
        task_type = str(request.args.get("task_type") or "").strip()
        subtype = str(request.args.get("subtype") or "").strip() or None
        if not task_type:
            return jsonify({"ok": False, "error": "task_type_required"}), 400

        difficulty_manager = getattr(get_ctx(), "difficulty_manager", None)
        if difficulty_manager is None:
            return jsonify({"ok": False, "error": "difficulty_manager_unavailable"}), 503

        meta = difficulty_manager.get_task_difficulty_metadata(task_type, subtype)
        return jsonify({"ok": True, "meta": meta})
    except Exception as exc:
        logger.exception("[HTTP] Failed to resolve difficulty metadata: %s", exc)
        return jsonify({"ok": False, "error": "difficulty_meta_failed"}), 500


@editor_bp.route("/api/editor/task/<module_id>/<topic_id>/<task_id>", methods=["POST"])
def save_editor_task(module_id: str, topic_id: str, task_id: str) -> Any:
    """Save updated task data from the editor."""
    if get_ctx().user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        ctx = get_ctx()
        existing_metadata: Optional[Dict[str, Any]] = None
        existing_task_payload: Optional[Dict[str, Any]] = None
        if is_hosted_web_runtime():
            existing_task_payload = ctx.storage_service.load_task(module_id, topic_id, task_id)
            if existing_task_payload:
                serialized = _serialize_workspace_task_payload(
                    existing_task_payload,
                    current_user_id=ctx.user_id,
                )
                existing_metadata = serialized.get("metadata") if isinstance(serialized.get("metadata"), dict) else {}
                if not _is_visible_workspace_graph_payload_for_current_user(
                    existing_metadata,
                    current_user_id=ctx.user_id,
                ):
                    return jsonify({"ok": False, "error": "task_not_found"}), 404
            else:
                existing_metadata = None
        else:
            existing_metadata = None
        task_json_path = _resolve_task_dir(module_id, topic_id, task_id) / "task.json"
        if not task_json_path.exists() and existing_task_payload is None:
            ctx.workspace_limits_service.assert_can_create_workspace_entity(
                ctx.user_id,
                "task",
            )
        payload = request.json
        if not payload:
            return jsonify({"ok": False, "error": "payload_required"}), 400
        if is_hosted_web_runtime():
            payload = _apply_hosted_editor_task_ownership(
                payload,
                current_user_id=ctx.user_id,
                existing_metadata=existing_metadata,
            )

        success = ctx.storage_service.save_task(
            module_id, topic_id, task_id, payload, validate=True
        )

        if success:
            return jsonify({"ok": True})
        else:
            return jsonify({"ok": False, "error": "save_failed"}), 500

    except WorkspaceLimitError as exc:
        return _workspace_limit_response(exc)
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to save editor task: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/task/<module_id>/<topic_id>/<task_id>", methods=["DELETE"])
def delete_editor_task(module_id: str, topic_id: str, task_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        if is_hosted_web_runtime():
            metadata = _load_hosted_editor_task_metadata_if_visible(
                module_id,
                topic_id,
                task_id,
                current_user_id=ctx.user_id,
            )
            if metadata is None:
                return jsonify({"ok": False, "error": "task_not_found"}), 404
        success = ctx.storage_service.delete_task(module_id, topic_id, task_id)
        if success:
            return jsonify({"ok": True})
        else:
            return (
                jsonify({"ok": False, "error": "delete_failed"}),
                500,
            )  # or 404 handled inside service logs

    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
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
        "composite_count": 0,
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
        if inherited_status == "composite":
            summary["composite_count"] += 1

        updates: Dict[str, Any] = {
            "theory_sync_status": inherited_status,
            "theory_sync_meta": {
                "source": "topic_propagation",
                "updated_at": datetime.utcnow().isoformat(),
                "topic_count": len(topic_refs),
                "theory_ids": inherited.get("theory_ids") or [],
                "topic_rows": inherited.get("topic_rows") or [],
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
        elif inherited_status == "composite":
            updates["theory_link"] = None
            updates["theory_sync_meta"]["composite_topics"] = inherited.get("topic_rows") or []
            updates["theory_sync_meta"]["composite_theory_links"] = (
                inherited.get("inherited_theory_links") or []
            )
        else:
            updates["theory_link"] = None

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
        degraded_response = _maybe_hosted_shadow_write_error_response(
            exc,
            extra_payload={
                "route_contract": _public_import_route_contract(
                    mode="export",
                    import_family="task_archive_export",
                ),
                "service_contract": dict(getattr(svc, "SERVICE_CONTRACT", {}) or {}),
            },
        )
        if degraded_response is not None:
            return degraded_response
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
        degraded_response = _maybe_hosted_shadow_write_error_response(
            exc,
            extra_payload={
                "route_contract": _public_import_route_contract(
                    mode="export",
                    import_family="task_archive_export",
                ),
                "service_contract": dict(getattr(svc, "SERVICE_CONTRACT", {}) or {}),
            },
        )
        if degraded_response is not None:
            return degraded_response
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

        workspace_markers = _workspace_import_markers_in_mapping(request.form)
        if workspace_markers:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": f"workspace_import_payload_not_supported:{','.join(workspace_markers)}",
                        "route_contract": _public_import_route_contract(
                            mode="check",
                            import_family="task_archive_import",
                        ),
                    }
                ),
                400,
            )

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

        return jsonify(
            _with_public_import_route_contract(
                report,
                mode="check",
                import_family="task_archive_import",
            )
        )

    except Exception as exc:
        logger.exception("[HTTP] Import check failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/import/discard-cache", methods=["POST"])
def import_discard_cache() -> Any:
    """Discard cached archive from the check step without importing it."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403

    try:
        payload = request.get_json(silent=True) or request.form or {}
        cache_id = str(payload.get("cache_id") or "").strip()
        if not cache_id:
            return jsonify({"ok": True, "removed": False, "reason": "cache_id_missing"})

        _cleanup_import_cache()
        temp_path, _ = _import_archive_cache.pop(cache_id, (None, 0))
        removed = False
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
                removed = True
            except Exception:
                removed = False

        return jsonify({"ok": True, "removed": bool(temp_path), "file_removed": removed})
    except Exception as exc:
        logger.exception("[HTTP] Import cache discard failed: %s", exc)
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
        workspace_markers = _workspace_import_markers_in_mapping(request.form)
        if workspace_markers:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": f"workspace_import_payload_not_supported:{','.join(workspace_markers)}",
                        "route_contract": _public_import_route_contract(
                            mode="confirm",
                            import_family="task_archive_import",
                        ),
                    }
                ),
                400,
            )
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
            return _stream_result_response(
                _with_public_import_route_contract(
                    cached_response,
                    mode="confirm",
                    import_family="task_archive_import",
                )
            )

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
                    res = _with_public_import_route_contract(
                        res,
                        mode="confirm",
                        import_family="task_archive_import",
                    )
                    _archive_confirm_idempotency_store(
                        _TASK_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
                        idempotency_key,
                        request_fingerprint,
                        res,
                    )
                q.put({"type": "result", "data": res})
            except Exception as e:
                streamed_degraded = _hosted_shadow_stream_payload(
                    e,
                    mode="confirm",
                    import_family="task_archive_import",
                    service_contract=getattr(svc, "SERVICE_CONTRACT", None),
                )
                if streamed_degraded is not None:
                    if idempotency_key:
                        streamed_degraded = dict(streamed_degraded)
                        streamed_degraded["idempotency_key"] = idempotency_key
                    _archive_confirm_idempotency_store(
                        _TASK_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
                        idempotency_key,
                        request_fingerprint,
                        streamed_degraded,
                    )
                    q.put({"type": "result", "data": streamed_degraded})
                    return
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
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
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
        degraded_response = _maybe_hosted_shadow_write_error_response(
            exc,
            extra_payload={
                "route_contract": _public_import_route_contract(
                    mode="export",
                    import_family="complex_archive_export",
                ),
                "service_contract": dict(getattr(svc, "SERVICE_CONTRACT", {}) or {}),
            },
        )
        if degraded_response is not None:
            return degraded_response
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

        workspace_markers = _workspace_import_markers_in_mapping(request.form)
        if workspace_markers:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": f"workspace_import_payload_not_supported:{','.join(workspace_markers)}",
                        "route_contract": _public_import_route_contract(
                            mode="check",
                            import_family="complex_archive_import",
                        ),
                    }
                ),
                400,
            )

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
        return jsonify(
            _with_public_import_route_contract(
                report,
                mode="check",
                import_family="complex_archive_import",
            )
        )
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
        workspace_markers = _workspace_import_markers_in_mapping(request.form)
        if workspace_markers:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": f"workspace_import_payload_not_supported:{','.join(workspace_markers)}",
                        "route_contract": _public_import_route_contract(
                            mode="confirm",
                            import_family="complex_archive_import",
                        ),
                    }
                ),
                400,
            )
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
            return _stream_result_response(
                _with_public_import_route_contract(
                    cached_response,
                    mode="confirm",
                    import_family="complex_archive_import",
                )
            )

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
                    res = _with_public_import_route_contract(
                        res,
                        mode="confirm",
                        import_family="complex_archive_import",
                    )
                    _archive_confirm_idempotency_store(
                        _COMPLEX_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
                        idempotency_key,
                        request_fingerprint,
                        res,
                    )
                q.put({"type": "result", "data": res})
            except Exception as e:
                streamed_degraded = _hosted_shadow_stream_payload(
                    e,
                    mode="confirm",
                    import_family="complex_archive_import",
                    service_contract=getattr(svc, "SERVICE_CONTRACT", None),
                )
                if streamed_degraded is not None:
                    if idempotency_key:
                        streamed_degraded = dict(streamed_degraded)
                        streamed_degraded["idempotency_key"] = idempotency_key
                    _archive_confirm_idempotency_store(
                        _COMPLEX_ARCHIVE_CONFIRM_IDEMPOTENCY_CACHE,
                        idempotency_key,
                        request_fingerprint,
                        streamed_degraded,
                    )
                    q.put({"type": "result", "data": streamed_degraded})
                else:
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
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Complex import confirm setup failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/test/import", methods=["POST"])
def import_test_from_file() -> Any:
    """Import test questions from an uploaded file or raw pasted text."""
    temp_path = None
    try:
        payload = request.get_json(silent=True)
        import_text = payload.get("text") if isinstance(payload, dict) else None
        if import_text is None:
            import_text = request.form.get("text")

        if isinstance(import_text, str) and import_text.strip():
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".txt", mode="w", encoding="utf-8")
            temp_path = tmp.name
            tmp.write(import_text)
            tmp.close()
        else:
            if "file" not in request.files:
                return jsonify({"ok": False, "error": "file_or_text_required"}), 400

            file = request.files["file"]
            if not file or file.filename == "":
                return jsonify({"ok": False, "error": "no_selected_file"}), 400

            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix or ".txt")
            temp_path = tmp.name
            file.save(temp_path)
            tmp.close()

        parser = TestFileParser()
        test_task = parser.create_test_from_file(temp_path, test_type="multiple_choice")
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
        ctx.workspace_limits_service.assert_can_create_workspace_entity(ctx.user_id, "task")
        payload = request.json
        if not payload:
            return jsonify({"ok": False, "error": "payload_required"}), 400

        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")
        task_name = payload.get("task_name")
        task_type = payload.get("task_type")

        if not all([module_id, topic_id, task_name, task_type]):
            return jsonify({"ok": False, "error": "missing_required_fields"}), 400

        workspace_meta = None
        if is_hosted_web_runtime():
            workspace_meta = _build_hosted_editor_workspace_meta(current_user_id=ctx.user_id)
        task_id = ctx.storage_service.create_task(
            module_id,
            topic_id,
            task_name,
            task_type,
            workspace_meta=workspace_meta,
        )

        if task_id:
            return jsonify({"ok": True, "task_id": task_id})
        else:
            return jsonify({"ok": False, "error": "create_failed"}), 500

    except WorkspaceLimitError as exc:
        return _workspace_limit_response(exc)
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to create editor task: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@editor_bp.route("/api/editor/task/bootstrap", methods=["POST"])
def bootstrap_editor_task() -> Any:
    """Reserve a task id and build an unsaved draft payload without creating task.json."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.json or {}
        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")
        task_name = payload.get("task_name")
        task_type = payload.get("task_type")
        preferred_task_id = payload.get("task_id") or None

        if not all([module_id, topic_id, task_name, task_type]):
            return jsonify({"ok": False, "error": "missing_required_fields"}), 400

        workspace_meta = None
        if is_hosted_web_runtime():
            workspace_meta = _build_hosted_editor_workspace_meta(current_user_id=ctx.user_id)
        bootstrap = ctx.storage_service.build_task_draft_bootstrap(
            module_id,
            topic_id,
            task_name,
            task_type,
            preferred_task_id=preferred_task_id,
            workspace_meta=workspace_meta,
        )
        return jsonify({"ok": True, **bootstrap})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to bootstrap editor task: %s", exc)
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

        create_module = getattr(ctx.storage_service, "create_module", None)
        workspace_meta = None
        if is_hosted_web_runtime():
            workspace_meta = _build_hosted_editor_workspace_meta(current_user_id=ctx.user_id)
        if callable(create_module):
            created = bool(create_module(module_id, name, workspace_meta=workspace_meta))
            if not created:
                return jsonify({"ok": False, "error": "module_create_failed"}), 500
        else:
            module_dir = ctx.storage_service.modules_dir / module_id
            module_dir.mkdir(parents=True, exist_ok=True)

            with open(module_dir / "module.json", "w", encoding="utf-8") as f:
                json.dump(
                    {"id": module_id, "name": name, "topics": []}, f, indent=2, ensure_ascii=False
                )

            ctx.storage_service.reload_modules()
        return jsonify({"ok": True, "module_id": module_id})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
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

        create_topic = getattr(ctx.storage_service, "create_topic", None)
        workspace_meta = None
        if is_hosted_web_runtime():
            workspace_meta = _build_hosted_editor_workspace_meta(current_user_id=ctx.user_id)
        if callable(create_topic):
            created = bool(
                create_topic(
                    module_id,
                    topic_id,
                    name,
                    theory_link=normalized_theory_link,
                    workspace_meta=workspace_meta,
                )
            )
            if not created:
                return jsonify({"ok": False, "error": "topic_create_failed"}), 500
        else:
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
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
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

        raw_apply_to_complexes = payload.get("apply_to_complexes")
        apply_to_complexes = True if raw_apply_to_complexes is None else bool(raw_apply_to_complexes)
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
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
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
    """Upload image for a specific task and return hosted-safe media references."""
    try:
        ctx = get_ctx()
        module_id = request.form.get("module")
        topic_id = request.form.get("topic")
        task_id = request.form.get("task")
        hosted_runtime = is_hosted_web_runtime()

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

        upload_hasher = hashlib.sha256()
        while True:
            chunk = file.stream.read(8192)
            if not chunk:
                break
            upload_hasher.update(chunk)
        upload_digest = upload_hasher.hexdigest()
        file.stream.seek(0)

        def _hash_existing_image(path: Path) -> Optional[str]:
            try:
                hasher = hashlib.sha256()
                with open(path, "rb") as fh:
                    while True:
                        chunk = fh.read(8192)
                        if not chunk:
                            break
                        hasher.update(chunk)
                return hasher.hexdigest()
            except Exception:
                return None

        file_path = images_dir / filename
        stem = Path(filename).stem
        suffix = Path(filename).suffix
        candidate_paths = [file_path]
        candidate_paths.extend(sorted(images_dir.glob(f"{stem}_*{suffix}")))
        for candidate in candidate_paths:
            if candidate.exists() and _hash_existing_image(candidate) == upload_digest:
                relative_path = os.path.relpath(candidate, ctx.data_dir).replace("\\", "/")
                response_payload = {"ok": True, "reused": True}
                if not hosted_runtime:
                    response_payload["path"] = relative_path
                asset_service = getattr(ctx, "asset_service", None)
                if asset_service is None and hosted_runtime:
                    return _hosted_editor_asset_degraded_response(
                        error="hosted_asset_contract_blocked",
                        operation="editor.upload_image",
                        reason="asset_service_required_in_hosted_runtime",
                        route_contract={"mode": "upload_image", "public_api": False},
                    )
                if asset_service is not None:
                    try:
                        asset = asset_service.register_existing_file(
                            candidate,
                            owner_user_id=getattr(ctx, "user_id", None),
                            visibility_scope="private_workspace",
                            asset_kind="editor_task_image",
                            metadata={
                                "module_id": module_id,
                                "topic_id": topic_id,
                                "task_id": task_id,
                            },
                        )
                        response_payload["asset_id"] = asset.get("asset_id")
                        response_payload["asset_url"] = asset.get("asset_url")
                    except Exception as exc:
                        if hosted_runtime:
                            logger.exception(
                                "[HTTP] Hosted asset registration failed for reused editor image %s",
                                relative_path,
                            )
                            return jsonify({"ok": False, "error": "asset_registration_failed"}), 500
                        logger.warning(
                            "[HTTP] Asset registration skipped for reused editor image %s: %s",
                            relative_path,
                            exc,
                        )
                if hosted_runtime and not (
                    str(response_payload.get("asset_id") or "").strip()
                    or str(response_payload.get("asset_url") or "").strip()
                ):
                    return _hosted_editor_asset_degraded_response(
                        error="hosted_asset_contract_blocked",
                        operation="editor.upload_image",
                        reason="asset_id_or_asset_url_required_in_hosted_runtime",
                        route_contract={"mode": "upload_image", "public_api": False},
                    )
                logger.info("[HTTP] Reused identical image for task %s: %s", task_id, relative_path)
                return jsonify(response_payload)

        counter = 1
        while file_path.exists():
            file_path = images_dir / f"{stem}_{counter:02d}{suffix}"
            counter += 1

        file.save(str(file_path))
        relative_path = os.path.relpath(file_path, ctx.data_dir).replace("\\", "/")

        logger.info("[HTTP] Image uploaded for task %s: %s", task_id, relative_path)
        response_payload = {"ok": True}
        if not hosted_runtime:
            response_payload["path"] = relative_path
        asset_service = getattr(ctx, "asset_service", None)
        if asset_service is None and hosted_runtime:
            return _hosted_editor_asset_degraded_response(
                error="hosted_asset_contract_blocked",
                operation="editor.upload_image",
                reason="asset_service_required_in_hosted_runtime",
                route_contract={"mode": "upload_image", "public_api": False},
            )
        if asset_service is not None:
            try:
                asset = asset_service.register_existing_file(
                    file_path,
                    owner_user_id=getattr(ctx, "user_id", None),
                    visibility_scope="private_workspace",
                    asset_kind="editor_task_image",
                    metadata={
                        "module_id": module_id,
                        "topic_id": topic_id,
                        "task_id": task_id,
                    },
                )
                response_payload["asset_id"] = asset.get("asset_id")
                response_payload["asset_url"] = asset.get("asset_url")
            except Exception as exc:
                if hosted_runtime:
                    logger.exception(
                        "[HTTP] Hosted asset registration failed for editor image %s",
                        relative_path,
                    )
                    return jsonify({"ok": False, "error": "asset_registration_failed"}), 500
                logger.warning(
                    "[HTTP] Asset registration skipped for editor image %s: %s",
                    relative_path,
                    exc,
                )
        if hosted_runtime and not (
            str(response_payload.get("asset_id") or "").strip()
            or str(response_payload.get("asset_url") or "").strip()
        ):
            return _hosted_editor_asset_degraded_response(
                error="hosted_asset_contract_blocked",
                operation="editor.upload_image",
                reason="asset_id_or_asset_url_required_in_hosted_runtime",
                route_contract={"mode": "upload_image", "public_api": False},
            )
        return jsonify(response_payload)

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
    asset_id = request.args.get("asset_id")
    ed_logger.info(
        "REQUEST /api/editor/image path=%s module=%s topic=%s task=%s",
        path,
        module_id,
        topic_id,
        task_id,
    )
    if asset_id:
        asset_service = getattr(get_ctx(), "asset_service", None)
        if asset_service is None:
            return jsonify({"ok": False, "error": "asset_service_not_available"}), 503
        asset = asset_service.get_asset(asset_id)
        if asset is None:
            return jsonify({"ok": False, "error": "asset_not_found"}), 404
        ctx = get_ctx()
        if is_hosted_web_runtime():
            user_id = getattr(ctx, "user_id", None)
            if str(user_id or "").strip() == "guest":
                return jsonify({"ok": False, "error": "authentication_required"}), 401
            if not asset_service.can_access_asset(asset, user_id=user_id):
                return jsonify({"ok": False, "error": "asset_forbidden"}), 403
        target = asset_service.resolve_asset_file(asset_id)
        if target is None:
            return jsonify({"ok": False, "error": "asset_file_missing"}), 404
        resp = send_file(str(target))
        resp.headers["Cache-Control"] = "private, max-age=3600"
        return resp

    if not path:
        logger.warning("[HTTP] /api/editor/image without 'path' parameter")
        ed_logger.warning(
            "MISSING_PATH /api/editor/image module=%s topic=%s task=%s",
            module_id,
            topic_id,
            task_id,
        )
        return jsonify({"ok": False, "error": "path_required"}), 400

    if is_hosted_web_runtime():
        return _hosted_editor_asset_degraded_response(
            error="hosted_asset_path_blocked",
            operation="editor.image.path_lookup",
            reason="asset_id_or_asset_url_required_in_hosted_runtime",
            route_contract={"mode": "read_asset", "public_api": False},
        )

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
