"""Complexes CRUD API routes.

Endpoints:
- POST   /api/complexes                                          - Create complex
- PUT    /api/complexes/<id>                                     - Update complex
- DELETE /api/complexes/<id>                                     - Delete complex
- POST   /api/complexes/<id>/sync-theory-from-topics             - Sync inherited theory for one complex
- GET    /api/complexes/<id>/autosave                            - Get autosave
- POST   /api/complexes/<id>/autosave                            - Save autosave
- DELETE /api/complexes/<id>/autosave                            - Delete autosave
- GET    /api/complexes/<id>/history                              - Version history
- POST   /api/complexes/<id>/restore/<snapshot_timestamp>        - Restore snapshot
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from flask import Blueprint, jsonify, request

from api.complexes_api import validate_and_normalize_create_payload
from services.linked_complex_runtime import build_linked_runtime_complex_id
from services.complex_service import ConflictError  # type: ignore
from services.theory_service import TheoryNotFoundError  # type: ignore

from routes._context import get_ctx
from routes._helpers import (
    _compute_inherited_theory_for_topics,
    _maybe_hosted_shadow_write_error_response,
    _serialize_complex_payload,
)

logger = logging.getLogger(__name__)

complexes_bp = Blueprint("complexes", __name__)


def _serialize_complex_response_item(complex_obj: Any) -> Dict[str, Any]:
    return _serialize_complex_payload(complex_obj, current_user_id=get_ctx().user_id)


def _normalize_propagation_mode(value: Any) -> str:
    mode = str(value or "").strip().lower()
    if mode in {"safe", "inherit_only_force", "all_force"}:
        return mode
    return "safe"


def _to_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return default


def _resolve_complex_created_via(payload: Any, *, fallback: str = "manual_editor") -> str:
    if isinstance(payload, dict):
        for key in ("created_via", "source"):
            raw = payload.get(key)
            if isinstance(raw, str) and raw.strip():
                return raw.strip()
    return fallback


def _parse_task_ref(task_ref: Any) -> Optional[Tuple[str, str, str]]:
    if not isinstance(task_ref, str):
        return None
    parts = [part.strip() for part in task_ref.split("/")]
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


def _build_inherited_theory_context(task_refs: Any, *, source: str) -> Dict[str, Any]:
    topic_refs = _collect_topic_refs_from_tasks(task_refs)
    inherited = _compute_inherited_theory_for_topics(topic_refs)
    inherited_status = str(inherited.get("status") or "none")

    updates: Dict[str, Any] = {
        "theory_sync_status": inherited_status,
        "theory_sync_meta": {
            "source": source,
            "updated_at": datetime.utcnow().isoformat(),
            "topic_count": len(topic_refs),
            "theory_ids": inherited.get("theory_ids") or [],
            "topic_rows": inherited.get("topic_rows") or [],
        },
    }

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

    return updates


def _build_override_theory_context(task_refs: Any, theory_link: Any, *, source: str) -> Dict[str, Any]:
    topic_refs = _collect_topic_refs_from_tasks(task_refs)
    theory_id = ""
    has_target = False
    if isinstance(theory_link, dict):
        theory_id = str(theory_link.get("theory_id") or "").strip()
        library_entry_id = str(theory_link.get("library_entry_id") or "").strip()
        has_target = bool(theory_id or library_entry_id)
    theory_ids = [theory_id] if theory_id else []
    return {
        "theory_sync_status": "ok" if has_target else "none",
        "theory_sync_meta": {
            "source": source,
            "updated_at": datetime.utcnow().isoformat(),
            "topic_count": len(topic_refs),
            "theory_ids": theory_ids,
        },
    }


def _resolve_complex_theory_link(theory_link: Any) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    if not isinstance(theory_link, dict):
        return None, None

    ctx = get_ctx()

    def _resolve_workspace_source_fallback() -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        source_theory_id = str(
            theory_link.get("source_theory_id")
            or theory_link.get("theory_id")
            or ""
        ).strip()
        if not source_theory_id:
            return None, None
        try:
            theory_item = ctx.theory_service.get_theory(
                source_theory_id,
                include_delta=False,
            )
        except TheoryNotFoundError:
            return None, None
        except Exception as exc:
            logger.warning("[HTTP] Theory fallback lookup failed for %s: %s", source_theory_id, exc)
            return None, {
                "field": "theory_link",
                "reason": "theory_lookup_failed",
                "value": source_theory_id,
            }

        resolved = {
            "source_kind": "workspace",
            "theory_id": source_theory_id,
            "relation": "link",
            "title_cache": str(
                theory_item.get("title") or theory_link.get("title_cache") or ""
            ).strip(),
            "updated_at": str(
                theory_item.get("updated_at") or theory_item.get("version") or theory_link.get("updated_at") or ""
            ).strip(),
            "catalog_item_id": str(theory_link.get("catalog_item_id") or "").strip(),
            "source_theory_id": source_theory_id,
        }
        return resolved, None

    source_kind = str(theory_link.get("source_kind") or "workspace").strip().lower() or "workspace"
    if source_kind == "linked_library":
        library_entry_id = str(theory_link.get("library_entry_id") or "").strip()
        if not library_entry_id:
            fallback_resolved, fallback_error = _resolve_workspace_source_fallback()
            if fallback_resolved is not None or fallback_error is not None:
                return fallback_resolved, fallback_error
            return None, {
                "field": "theory_link",
                "reason": "library_entry_id_required",
            }
        try:
            detail = ctx.catalog_service.get_theory_library_entry(
                library_entry_id,
                requested_by_user_id=ctx.user_id,
            )
        except ValueError as exc:
            fallback_resolved, fallback_error = _resolve_workspace_source_fallback()
            if fallback_resolved is not None or fallback_error is not None:
                return fallback_resolved, fallback_error
            return None, {
                "field": "theory_link",
                "reason": str(exc) or "theory_library_entry_not_accessible",
                "value": library_entry_id,
            }
        except Exception as exc:
            logger.warning(
                "[HTTP] Linked theory lookup failed for %s: %s", library_entry_id, exc
            )
            fallback_resolved, fallback_error = _resolve_workspace_source_fallback()
            if fallback_resolved is not None or fallback_error is not None:
                return fallback_resolved, fallback_error
            return None, {
                "field": "theory_link",
                "reason": "theory_library_lookup_failed",
                "value": library_entry_id,
            }

        entry = detail.get("library_entry") if isinstance(detail.get("library_entry"), dict) else {}
        item = detail.get("item") if isinstance(detail.get("item"), dict) else {}
        snapshot = detail.get("snapshot") if isinstance(detail.get("snapshot"), dict) else {}
        access_state = str(entry.get("access_state") or "").strip().lower()
        if access_state != "active" or not snapshot:
            fallback_resolved, fallback_error = _resolve_workspace_source_fallback()
            if fallback_resolved is not None or fallback_error is not None:
                return fallback_resolved, fallback_error
            return None, {
                "field": "theory_link",
                "reason": "theory_library_entry_not_accessible",
                "value": library_entry_id,
            }

        source_theory_id = str(
            snapshot.get("workspace_entity_id")
            or snapshot.get("id")
            or item.get("source_workspace_id")
            or ""
        ).strip()
        resolved = {
            "source_kind": "linked_library",
            "library_entry_id": library_entry_id,
            "relation": "link",
            "title_cache": str(
                snapshot.get("title") or item.get("title") or theory_link.get("title_cache") or ""
            ).strip(),
            "updated_at": str(
                snapshot.get("updated_at")
                or snapshot.get("version")
                or theory_link.get("updated_at")
                or entry.get("updated_at")
                or ""
            ).strip(),
            "catalog_item_id": str(item.get("item_id") or theory_link.get("catalog_item_id") or "").strip(),
            "source_theory_id": source_theory_id,
            "access_state": access_state or "active",
            "access_reason": str(entry.get("access_reason") or theory_link.get("access_reason") or "").strip(),
        }
        return resolved, None

    theory_id = str(theory_link.get("theory_id") or "").strip()
    if not theory_id:
        return None, {
            "field": "theory_link",
            "reason": "theory_id_required",
        }
    try:
        theory_item = ctx.theory_service.get_theory(
            theory_id,
            include_delta=False,
        )
    except TheoryNotFoundError:
        return None, {
            "field": "theory_link",
            "reason": "theory_not_found",
            "value": theory_id,
        }
    except Exception as exc:
        logger.warning("[HTTP] Theory lookup failed for %s: %s", theory_id, exc)
        return None, {
            "field": "theory_link",
            "reason": "theory_lookup_failed",
            "value": theory_id,
        }

    resolved = dict(theory_link)
    resolved["source_kind"] = "workspace"
    resolved["theory_id"] = theory_id
    resolved["title_cache"] = str(
        theory_item.get("title") or theory_link.get("title_cache") or ""
    ).strip()
    resolved["updated_at"] = str(
        theory_item.get("updated_at") or theory_link.get("updated_at") or ""
    ).strip()
    return resolved, None


def _resolve_complex_theory_mode(payload: Dict[str, Any]) -> str:
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


@complexes_bp.route("/api/complex-library", methods=["GET"])
def list_complex_library() -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_read_library_status"}), 403
    try:
        payload = ctx.catalog_service.list_complex_library_entries(requested_by_user_id=ctx.user_id)
        return jsonify(payload)
    except ValueError as exc:
        error = str(exc)
        status = 404 if error.endswith("_not_found") else 403 if "forbidden" in error else 400
        return jsonify({"ok": False, "error": error}), status
    except Exception as exc:
        logger.exception("[HTTP] Failed to list complex library: %s", exc)
        return jsonify({"ok": False, "error": "complex_library_load_failed"}), 500


@complexes_bp.route("/api/complex-library/<string:library_entry_id>", methods=["GET"])
def get_complex_library_entry(library_entry_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_read_library_status"}), 403
    try:
        payload = ctx.catalog_service.get_complex_library_entry(
            library_entry_id,
            requested_by_user_id=ctx.user_id,
            access_code=request.args.get("access_code"),
        )
        return jsonify(payload)
    except ValueError as exc:
        error = str(exc)
        if error.endswith("_not_found"):
            status = 404
        elif "forbidden" in error or error in {"catalog_access_code_required", "complex_library_entry_not_accessible"}:
            status = 403
        else:
            status = 400
        return jsonify({"ok": False, "error": error}), status
    except Exception as exc:
        logger.exception("[HTTP] Failed to get complex library entry %s: %s", library_entry_id, exc)
        return jsonify({"ok": False, "error": "complex_library_detail_failed"}), 500


@complexes_bp.route("/api/complex-library/<string:library_entry_id>/access-code", methods=["POST"])
def submit_complex_library_access_code(library_entry_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_read_library_status"}), 403
    payload = request.get_json(silent=True) or {}
    try:
        result = ctx.catalog_service.submit_complex_library_access_code(
            library_entry_id,
            requested_by_user_id=ctx.user_id,
            access_code=payload.get("access_code"),
        )
        return jsonify(result)
    except ValueError as exc:
        error = str(exc)
        if error.endswith("_not_found"):
            status = 404
        elif "forbidden" in error or error in {"catalog_access_code_required", "complex_library_entry_not_accessible"}:
            status = 403
        else:
            status = 400
        return jsonify({"ok": False, "error": error}), status
    except Exception as exc:
        logger.exception("[HTTP] Failed to submit complex library access code %s: %s", library_entry_id, exc)
        return jsonify({"ok": False, "error": "complex_library_access_code_failed"}), 500


@complexes_bp.route("/api/complex-library/<string:library_entry_id>", methods=["DELETE"])
def delete_complex_library_entry(library_entry_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        result = ctx.catalog_service.remove_complex_library_entry(
            library_entry_id,
            requested_by_user_id=ctx.user_id,
        )

        runtime_complex_id = build_linked_runtime_complex_id(library_entry_id)
        session_api = getattr(ctx, "session_api", None)
        session_manager = getattr(session_api, "_session_manager", None) if session_api is not None else None
        active_sessions = getattr(session_manager, "_active_sessions", None) if session_manager is not None else None
        if isinstance(active_sessions, dict):
            for session_id, loaded in list(active_sessions.items()):
                if str(getattr(loaded, "complex_id", "") or "").strip() != runtime_complex_id:
                    continue
                if str(getattr(loaded, "user_id", "") or "").strip() != ctx.user_id:
                    continue
                active_sessions.pop(session_id, None)

        session_repo = getattr(session_manager, "session_repository", None) if session_manager is not None else None
        if session_repo is not None and runtime_complex_id:
            try:
                session_repo.delete_session(runtime_complex_id, ctx.user_id)
            except Exception:
                logger.warning(
                    "[HTTP] Failed to clear linked runtime sessions for removed library entry %s",
                    library_entry_id,
                    exc_info=True,
                )

        return jsonify(result)
    except ValueError as exc:
        error = str(exc)
        status = 404 if error.endswith("_not_found") else 403 if "forbidden" in error else 400
        return jsonify({"ok": False, "error": error}), status
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to delete complex library entry %s: %s", library_entry_id, exc)
        return jsonify({"ok": False, "error": "complex_library_delete_failed"}), 500


@complexes_bp.route("/api/complexes", methods=["POST"])
def create_complex() -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    payload = request.get_json(silent=True) or {}

    try:
        complex_id = payload.get("id")
        normalized: Optional[Dict[str, Any]] = None
        errors: List[Dict[str, Any]] = []

        if complex_id is None:
            complex_id = str(uuid.uuid4())
        elif not isinstance(complex_id, str) or not complex_id.strip():
            errors.append({"field": "id", "reason": "id_must_be_string"})

        normalized_candidate, validation_errors = validate_and_normalize_create_payload(payload)
        if normalized_candidate is not None:
            normalized = normalized_candidate
        errors.extend(validation_errors)

        if normalized is None:
            return (
                jsonify({"ok": False, "error": "validation_error", "details": {"errors": errors}}),
                400,
            )

        missing_tasks = []
        for tr in normalized["tasks"]:
            parts = tr.split("/")
            module_id, topic_id, task_id = parts[0], parts[1], parts[-1]
            try:
                task_full = ctx.storage_service.load_task(
                    module_id, topic_id, task_id
                )
            except Exception:
                task_full = None
            if not task_full:
                missing_tasks.append(tr)

        if missing_tasks:
            for tr in missing_tasks:
                errors.append({"field": "tasks", "reason": "task_not_found", "value": tr})

        theory_link = normalized.get("theory_link")
        resolved_theory_link = None
        if isinstance(theory_link, dict):
            resolved_theory_link, theory_error = _resolve_complex_theory_link(theory_link)
            if theory_error is not None:
                errors.append(theory_error)

        if errors:
            return (
                jsonify({"ok": False, "error": "validation_error", "details": {"errors": errors}}),
                400,
            )

        complex_data = {
            "id": complex_id,
            "name": normalized["name"],
            "description": normalized["description"],
            "tasks": normalized["tasks"],
            "chains": normalized["chains"],
            "settings": normalized["settings"],
            "theory_link": resolved_theory_link,
            "theory_mode": normalized.get("theory_mode"),
            "created_by_user_id": ctx.user_id,
            "updated_by_user_id": ctx.user_id,
            "created_via": _resolve_complex_created_via(payload),
            "content_scope": "shared_local",
        }

        effective_mode = _resolve_complex_theory_mode(complex_data)
        if effective_mode == "inherit":
            complex_data.update(
                _build_inherited_theory_context(normalized["tasks"], source="complex_create")
            )
            complex_data["theory_mode"] = "inherit"
        else:
            complex_data.update(
                _build_override_theory_context(
                    normalized["tasks"],
                    resolved_theory_link,
                    source="complex_create",
                )
            )
            complex_data["theory_mode"] = "override"

        created = ctx.complex_service.create_complex(complex_data)
        return jsonify({"ok": True, "item": _serialize_complex_response_item(created)}), 200
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to create complex: %s", exc)
        return jsonify({"ok": False, "error": "complex_create_failed"}), 500


@complexes_bp.route("/api/complexes/<string:complex_id>", methods=["PUT"])
def update_complex(complex_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    payload = request.get_json(silent=True) or {}
    try:
        # Extract expected_version from payload before validation
        expected_version = payload.pop("expected_version", None)

        normalized, errors = validate_and_normalize_create_payload(payload)
        if normalized is None:
            return (
                jsonify({"ok": False, "error": "validation_error", "details": {"errors": errors}}),
                400,
            )

        # Optional: check if complex exists
        existing = ctx.complex_service.get_complex(complex_id)
        if not existing:
            return jsonify({"ok": False, "error": "complex_not_found"}), 404

        theory_link = normalized.get("theory_link")
        resolved_theory_link = None
        if isinstance(theory_link, dict):
            resolved_theory_link, theory_error = _resolve_complex_theory_link(theory_link)
            if theory_error is not None:
                return (
                    jsonify(
                        {
                            "ok": False,
                            "error": "validation_error",
                            "details": {"errors": [theory_error]},
                        }
                    ),
                    400,
                )

        update_payload = {
            **normalized,
            "theory_link": resolved_theory_link,
            "updated_by_user_id": ctx.user_id,
        }
        effective_mode = _resolve_complex_theory_mode(update_payload)
        if effective_mode == "inherit":
            update_payload.update(
                _build_inherited_theory_context(normalized["tasks"], source="complex_update")
            )
            update_payload["theory_mode"] = "inherit"
        else:
            update_payload.update(
                _build_override_theory_context(
                    normalized["tasks"],
                    resolved_theory_link,
                    source="complex_update",
                )
            )
            update_payload["theory_mode"] = "override"

        # Update with version check
        updated = ctx.complex_service.update_complex(
            complex_id,
            update_payload,
            expected_version=expected_version,
        )

        return jsonify({"ok": True, "item": _serialize_complex_response_item(updated)})

    except ConflictError as exc:
        # Handle version conflict
        logger.warning(f"Version conflict for complex {complex_id}: {exc}")
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "version_conflict",
                    "details": {
                        "message": str(exc),
                        "current_version": exc.current_version,
                        "expected_version": exc.expected_version,
                    },
                }
            ),
            409,
        )

    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to update complex %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "complex_update_failed"}), 500


@complexes_bp.route("/api/complexes/<string:complex_id>/sync-theory-from-topics", methods=["POST"])
def sync_complex_theory_from_topics(complex_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    payload = request.get_json(silent=True) or {}
    mode = _normalize_propagation_mode(payload.get("propagation_mode"))
    dry_run = _to_bool(payload.get("dry_run"), default=False)
    force_refresh = mode == "inherit_only_force"
    allow_override = mode == "all_force"

    try:
        complex_obj = ctx.complex_service.get_complex(complex_id)
        if not complex_obj:
            return jsonify({"ok": False, "error": "complex_not_found"}), 404

        current_payload = complex_obj.dict()
        current_mode = _resolve_complex_theory_mode(current_payload)
        task_refs = current_payload.get("tasks") if isinstance(current_payload.get("tasks"), list) else []
        topic_refs = _collect_topic_refs_from_tasks(task_refs)

        summary: Dict[str, Any] = {
            "complex_id": complex_id,
            "mode": mode,
            "dry_run": dry_run,
            "current_mode": current_mode,
            "topic_count": len(topic_refs),
            "action": "skipped",
            "reason": None,
            "status": "none",
        }

        if not topic_refs:
            summary["reason"] = "no_topic_refs"
            return jsonify(
                {
                    "ok": True,
                    "item": _serialize_complex_response_item(complex_obj),
                    "summary": summary,
                    "preview": {"changed_keys": [], "topic_rows": []},
                }
            )

        if not allow_override and current_mode != "inherit":
            summary["reason"] = "mode_override"
            return jsonify(
                {
                    "ok": True,
                    "item": _serialize_complex_response_item(complex_obj),
                    "summary": summary,
                    "preview": {"changed_keys": [], "topic_rows": []},
                }
            )

        inherited = _compute_inherited_theory_for_topics(topic_refs)
        inherited_status = str(inherited.get("status") or "none")
        summary["status"] = inherited_status

        updates: Dict[str, Any] = {
            "theory_sync_status": inherited_status,
            "theory_sync_meta": {
                "source": "single_complex_sync",
                "updated_at": datetime.utcnow().isoformat(),
                "topic_count": len(topic_refs),
                "theory_ids": inherited.get("theory_ids") or [],
            },
            "updated_by_user_id": ctx.user_id,
        }

        if current_mode == "inherit":
            updates["theory_mode"] = "inherit"
        elif allow_override:
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

        changed_keys: List[str] = []
        for key, next_value in updates.items():
            if not _json_like_equal(current_payload.get(key), next_value):
                changed_keys.append(key)

        if not changed_keys and not (force_refresh and current_mode == "inherit"):
            summary["reason"] = "unchanged"
            return jsonify(
                {
                    "ok": True,
                    "item": _serialize_complex_response_item(complex_obj),
                    "summary": summary,
                    "preview": {
                        "changed_keys": [],
                        "topic_rows": inherited.get("topic_rows") or [],
                    },
                }
            )

        if dry_run:
            summary["action"] = "would_update"
            return jsonify(
                {
                    "ok": True,
                    "item": _serialize_complex_response_item(complex_obj),
                    "summary": summary,
                    "preview": {
                        "changed_keys": changed_keys,
                        "topic_rows": inherited.get("topic_rows") or [],
                    },
                }
            )

        updated_obj = ctx.complex_service.update_complex(complex_id, updates)
        summary["action"] = "updated"
        return jsonify(
            {
                "ok": True,
                "item": _serialize_complex_response_item(updated_obj),
                "summary": summary,
                "preview": {
                    "changed_keys": changed_keys,
                    "topic_rows": inherited.get("topic_rows") or [],
                },
            }
        )
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to sync complex theory from topics %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "complex_theory_sync_failed"}), 500


@complexes_bp.route("/api/complexes/<string:complex_id>", methods=["DELETE"])
def delete_complex_endpoint(complex_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        deleted = ctx.complex_service.delete_complex(complex_id)
        if not deleted:
            return jsonify({"ok": False, "error": "complex_not_found"}), 404

        # BUG-3 fix: удаляем файл паузированной сессии для этого комплекса
        try:
            user_id = ctx.user_id
            session_api = ctx.session_api
            sm = getattr(session_api, "_session_manager", None)
            if sm and sm.session_repository:
                sm.session_repository.delete_session(complex_id, user_id)
                logger.info("[HTTP] Cleaned up session file for deleted complex %s", complex_id)
        except Exception:
            logger.warning(
                "[HTTP] Failed to clean up session file for complex %s", complex_id, exc_info=True
            )

        return jsonify({"ok": True})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to delete complex %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "complex_delete_failed"}), 500


@complexes_bp.route("/api/complexes/<string:complex_id>/autosave", methods=["GET"])
def get_complex_autosave(complex_id: str) -> Any:
    try:
        autosave_snapshot = get_ctx().complex_service.get_latest_autosave_snapshot(complex_id)
        if not autosave_snapshot:
            return jsonify({"ok": False, "error": "autosave_not_found"}), 404
        saved_at = autosave_snapshot.get("_history_saved_at") or autosave_snapshot.get("updated_at")
        return jsonify({"ok": True, "item": autosave_snapshot, "saved_at": saved_at})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to get autosave for %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "autosave_load_failed"}), 500


@complexes_bp.route("/api/complexes/<string:complex_id>/autosave", methods=["POST"])
def save_complex_autosave(complex_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    payload = request.get_json(silent=True) or {}
    try:
        snapshot = ctx.complex_service.save_autosave_snapshot(complex_id, payload)
        return jsonify(
            {
                "ok": True,
                "item": snapshot,
                "saved_at": datetime.utcnow().replace(tzinfo=timezone.utc).isoformat(),
                "history_kind": "autosave",
            }
        )
    except ValueError:
        return jsonify({"ok": False, "error": "complex_not_found"}), 404
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to save autosave for %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "autosave_save_failed"}), 500


@complexes_bp.route("/api/complexes/<string:complex_id>/autosave", methods=["DELETE"])
def delete_complex_autosave(complex_id: str) -> Any:
    if get_ctx().user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        deleted_count = get_ctx().complex_service.delete_autosave_snapshots(complex_id)
        return jsonify({"ok": True, "deleted_count": deleted_count})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to delete autosave for %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "autosave_delete_failed"}), 500


@complexes_bp.route("/api/complexes/<string:complex_id>/history", methods=["GET"])
def get_complex_history(complex_id: str) -> Any:
    """Получить историю изменений комплекса."""
    try:
        history = get_ctx().complex_service.get_complex_history(complex_id)
        return jsonify({"ok": True, "history": history})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception(f"Failed to get history for complex {complex_id}: {exc}")
        return jsonify({"ok": False, "error": "history_fetch_failed"}), 500


@complexes_bp.route(
    "/api/complexes/<string:complex_id>/restore/<string:snapshot_timestamp>", methods=["POST"]
)
def restore_complex_from_history(complex_id: str, snapshot_timestamp: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    """Восстановить комплекс из исторического snapshot."""
    try:
        restored = ctx.complex_service.restore_from_history(
            complex_id, snapshot_timestamp
        )

        obj = restored.dict()
        if obj.get("created_at"):
            obj["created_at"] = obj.get("created_at").isoformat()
        if obj.get("updated_at"):
            obj["updated_at"] = obj.get("updated_at").isoformat()

        return jsonify({"ok": True, "item": obj})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception(f"Failed to restore complex {complex_id}: {exc}")
        return jsonify({"ok": False, "error": "restore_failed"}), 500
