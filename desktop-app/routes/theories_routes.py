"""Theories API routes.

Endpoints:
- GET    /api/theories                                          - List theories
- POST   /api/theories                                          - Create theory
- POST   /api/theories/bulk-delete                              - Delete multiple orphan theories
- DELETE /api/theories/<id>                                     - Delete one orphan theory
- GET    /api/theories/<id>                                     - Get theory
- POST   /api/theories/<id>/copy                                - Clone theory
- PUT    /api/theories/<id>                                     - Update theory
- POST   /api/theories/<id>/upload-image                        - Upload image
- GET    /api/theories/<id>/history                              - Version history
- POST   /api/theories/<id>/restore/<snapshot_timestamp>        - Restore snapshot
"""

import logging
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request

from services.theory_service import (  # type: ignore
    TheoryConflictError,
    TheoryNotFoundError,
    TheoryValidationError,
)
from services.workspace_limits_service import PremiumArchivedContentError, WorkspaceLimitError

from routes._context import get_ctx, is_hosted_web_runtime
from persistence.postgres import PostgresUnavailableError
from routes._helpers import (
    _maybe_hosted_shadow_write_error_response,
    _serialize_complex_payload,
    _serialize_theory_payload,
    compute_theory_usage_stats,
)

logger = logging.getLogger(__name__)

theories_bp = Blueprint("theories", __name__)


class TheoryInUseError(Exception):
    def __init__(self, theory_id: str, usage_topics: int, usage_complexes: int):
        super().__init__("Theory is linked to topics or complexes")
        self.theory_id = theory_id
        self.usage_topics = usage_topics
        self.usage_complexes = usage_complexes


def _workspace_limit_response(exc: WorkspaceLimitError) -> Any:
    return jsonify(exc.to_payload()), 409


def _premium_archive_response(exc: PremiumArchivedContentError) -> Any:
    return jsonify(exc.to_payload()), 409


def _assert_theory_not_archived(ctx: Any, theory_id: str, *, action: str) -> None:
    service = getattr(ctx, "workspace_limits_service", None)
    if service is None:
        return
    service.assert_entity_not_archived(
        ctx.user_id,
        "theory",
        theory_id,
        action=action,
        scope="workspace",
    )


def _hosted_theory_asset_degraded_response(
    *,
    error: str,
    operation: str,
    reason: str,
    status: int = 503,
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
        "route_contract": {
            "mode": "upload_image",
            "public_api": False,
        },
    }
    return jsonify(payload), int(status)


def _normalize_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _is_imported_library_theory_payload(item: Any) -> bool:
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


def _is_visible_library_theory_for_current_user(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    ownership = item.get("ownership") if isinstance(item.get("ownership"), dict) else {}
    if ownership.get("is_owned_by_current_user") is True:
        return True
    return _is_imported_library_theory_payload(item)


def _should_adopt_ownerless_theory_payload(item: Any, *, current_user_id: str) -> bool:
    normalized_user_id = _normalize_optional_text(current_user_id)
    if not normalized_user_id or normalized_user_id == "guest":
        return False
    if not isinstance(item, dict):
        return False
    created_by_user_id = _normalize_optional_text(item.get("created_by_user_id"))
    if created_by_user_id is not None:
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


def _adopt_ownerless_theories_for_current_user(
    theories: Any,
    *,
    current_user_id: str,
) -> Any:
    normalized_user_id = _normalize_optional_text(current_user_id)
    if not normalized_user_id or normalized_user_id == "guest" or not isinstance(theories, list):
        return theories

    service = get_ctx().theory_service
    adopted_any = False
    for theory_obj in list(theories):
        raw_payload = theory_obj.dict() if hasattr(theory_obj, "dict") else dict(theory_obj or {})
        if not _should_adopt_ownerless_theory_payload(raw_payload, current_user_id=normalized_user_id):
            continue
        theory_id = _normalize_optional_text(raw_payload.get("id"))
        if not theory_id:
            continue
        try:
            service.update_theory(
                theory_id,
                {
                    "created_by_user_id": normalized_user_id,
                    "updated_by_user_id": normalized_user_id,
                    "created_via": str(raw_payload.get("created_via") or "manual_editor").strip() or "manual_editor",
                    "content_scope": "shared_local",
                },
            )
            adopted_any = True
            logger.info("[HTTP] Adopted ownerless theory %s for hosted user %s", theory_id, normalized_user_id)
        except Exception as exc:
            logger.warning(
                "[HTTP] Failed to adopt ownerless theory %s for hosted user %s: %s",
                theory_id,
                normalized_user_id,
                exc,
            )
    if adopted_any:
        return service.list_theories()
    return theories


def _load_theory_usage_stats(ctx: Any) -> Dict[str, Dict[str, int]]:
    try:
        modules = ctx.storage_service.load_modules()
        serialized_complexes = [
            _serialize_complex_payload(obj, current_user_id=ctx.user_id)
            for obj in ctx.complex_service.get_all_complexes()
        ]
        usage_stats, _ = compute_theory_usage_stats(
            modules=modules,
            complex_payloads=serialized_complexes,
        )
        return usage_stats
    except Exception as exc:
        logger.warning("[HTTP] Failed to compute theory usage stats: %s", exc)
        return {}


def _build_theory_in_use_error(theory_id: str, usage_topics: int, usage_complexes: int) -> Dict[str, Any]:
    return {
        "theory_id": theory_id,
        "error": "theory_in_use",
        "message": "Theory is linked to topics or complexes",
        "usage_topics": usage_topics,
        "usage_complexes": usage_complexes,
    }


def _delete_theory_if_orphan(
    ctx: Any,
    theory_id: str,
    usage_stats: Dict[str, Dict[str, int]],
) -> Dict[str, Any]:
    usage = usage_stats.get(theory_id, {"topics": 0, "complexes": 0})
    usage_topics = int(usage.get("topics") or 0)
    usage_complexes = int(usage.get("complexes") or 0)
    if (usage_topics + usage_complexes) > 0:
        raise TheoryInUseError(theory_id, usage_topics, usage_complexes)
    return ctx.theory_service.delete_theory(theory_id)


@theories_bp.route("/api/theories", methods=["GET"])
def list_theories() -> Any:
    query = request.args.get("query")
    try:
        ctx = get_ctx()
        items = ctx.theory_service.list_theories(query=query)
        if is_hosted_web_runtime():
            items = _adopt_ownerless_theories_for_current_user(
                items,
                current_user_id=ctx.user_id,
            )
        items = [
            _serialize_theory_payload(item, current_user_id=ctx.user_id)
            for item in items
        ]
        if is_hosted_web_runtime():
            items = [
                item
                for item in items
                if _is_visible_library_theory_for_current_user(item)
            ]
        usage_stats = _load_theory_usage_stats(ctx)

        for item in items:
            theory_id = str(item.get("id") or "").strip()
            usage = usage_stats.get(theory_id, {"topics": 0, "complexes": 0})
            usage_topics = int(usage.get("topics") or 0)
            usage_complexes = int(usage.get("complexes") or 0)
            item["usage_topics"] = usage_topics
            item["usage_complexes"] = usage_complexes
            item["is_orphan"] = (usage_topics + usage_complexes) == 0

        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to list theories: %s", exc)
        return jsonify({"ok": False, "error": "theories_load_failed"}), 500


@theories_bp.route("/api/theory-library", methods=["GET"])
def list_theory_library() -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_read_library_status"}), 403
    try:
        payload = ctx.catalog_service.list_theory_library_entries(requested_by_user_id=ctx.user_id)
        return jsonify(payload)
    except ValueError as exc:
        error = str(exc)
        status = 404 if error.endswith("_not_found") else 403 if "forbidden" in error else 400
        return jsonify({"ok": False, "error": error}), status
    except Exception as exc:
        logger.exception("[HTTP] Failed to list theory library: %s", exc)
        return jsonify({"ok": False, "error": "theory_library_load_failed"}), 500


@theories_bp.route("/api/theory-library/<string:library_entry_id>", methods=["GET"])
def get_theory_library_entry(library_entry_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_read_library_status"}), 403
    try:
        payload = ctx.catalog_service.get_theory_library_entry(
            library_entry_id,
            requested_by_user_id=ctx.user_id,
            access_code=request.args.get("access_code"),
        )
        return jsonify(payload)
    except ValueError as exc:
        error = str(exc)
        if error.endswith("_not_found"):
            status = 404
        elif "forbidden" in error or error in {"catalog_access_code_required", "theory_library_entry_not_accessible"}:
            status = 403
        else:
            status = 400
        return jsonify({"ok": False, "error": error}), status
    except Exception as exc:
        logger.exception("[HTTP] Failed to get theory library entry %s: %s", library_entry_id, exc)
        return jsonify({"ok": False, "error": "theory_library_detail_failed"}), 500


@theories_bp.route("/api/theory-library/<string:library_entry_id>/access-code", methods=["POST"])
def submit_theory_library_access_code(library_entry_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_read_library_status"}), 403
    payload = request.get_json(silent=True) or {}
    try:
        result = ctx.catalog_service.submit_theory_library_access_code(
            library_entry_id,
            requested_by_user_id=ctx.user_id,
            access_code=payload.get("access_code"),
        )
        return jsonify(result)
    except ValueError as exc:
        error = str(exc)
        if error.endswith("_not_found"):
            status = 404
        elif "forbidden" in error or error in {"catalog_access_code_required", "theory_library_entry_not_accessible"}:
            status = 403
        else:
            status = 400
        return jsonify({"ok": False, "error": error}), status
    except Exception as exc:
        logger.exception("[HTTP] Failed to submit theory library access code %s: %s", library_entry_id, exc)
        return jsonify({"ok": False, "error": "theory_library_access_code_failed"}), 500


@theories_bp.route("/api/theory-library/<string:library_entry_id>", methods=["DELETE"])
def delete_theory_library_entry(library_entry_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        result = ctx.catalog_service.remove_theory_library_entry(
            library_entry_id,
            requested_by_user_id=ctx.user_id,
        )
        return jsonify(result)
    except ValueError as exc:
        error = str(exc)
        status = 404 if error.endswith("_not_found") else 403 if "forbidden" in error else 400
        return jsonify({"ok": False, "error": error}), status
    except Exception as exc:
        logger.exception("[HTTP] Failed to delete theory library entry %s: %s", library_entry_id, exc)
        return jsonify({"ok": False, "error": "theory_library_delete_failed"}), 500


@theories_bp.route("/api/theories/bulk-delete", methods=["POST"])
def bulk_delete_theories() -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    payload = request.get_json(silent=True) or {}
    raw_theory_ids = payload.get("theory_ids")
    if not isinstance(raw_theory_ids, list):
        return jsonify({"ok": False, "error": "theory_ids_required"}), 400

    theory_ids = []
    seen = set()
    for raw_theory_id in raw_theory_ids:
        theory_id = str(raw_theory_id or "").strip()
        if not theory_id or theory_id in seen:
            continue
        seen.add(theory_id)
        theory_ids.append(theory_id)

    if not theory_ids:
        return jsonify({"ok": False, "error": "theory_ids_required"}), 400

    usage_stats = _load_theory_usage_stats(ctx)
    deleted_items = []
    errors = []

    for theory_id in theory_ids:
        try:
            deleted_items.append(_delete_theory_if_orphan(ctx, theory_id, usage_stats))
        except TheoryInUseError as exc:
            errors.append(
                _build_theory_in_use_error(
                    exc.theory_id,
                    exc.usage_topics,
                    exc.usage_complexes,
                )
            )
        except TheoryNotFoundError:
            errors.append(
                {
                    "theory_id": theory_id,
                    "error": "theory_not_found",
                    "message": "Theory not found",
                }
            )
        except TheoryValidationError as exc:
            errors.append(
                {
                    "theory_id": theory_id,
                    "error": "validation_error",
                    "message": str(exc),
                }
            )
        except Exception as exc:
            logger.exception("[HTTP] Failed to delete theory %s: %s", theory_id, exc)
            errors.append(
                {
                    "theory_id": theory_id,
                    "error": "theory_delete_failed",
                    "message": "Failed to delete theory",
                }
            )

    return jsonify(
        {
            "ok": True,
            "requested": len(theory_ids),
            "deleted": len(deleted_items),
            "deleted_items": deleted_items,
            "errors": errors,
            "partial": bool(errors),
        }
    )


@theories_bp.route("/api/theories/<string:theory_id>", methods=["DELETE"])
def delete_theory(theory_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    if is_hosted_web_runtime():
        try:
            existing = ctx.theory_service.get_theory(theory_id, include_delta=False)
            existing_s = _serialize_theory_payload(existing, current_user_id=ctx.user_id)
            if not (existing_s.get("ownership") or {}).get("is_owned_by_current_user"):
                return jsonify({"ok": False, "error": "theory_not_found"}), 404
        except TheoryNotFoundError:
            return jsonify({"ok": False, "error": "theory_not_found"}), 404

    try:
        usage_stats = _load_theory_usage_stats(ctx)
        item = _delete_theory_if_orphan(ctx, theory_id, usage_stats)
        return jsonify({"ok": True, "item": item})
    except TheoryInUseError as exc:
        payload = _build_theory_in_use_error(
            exc.theory_id,
            exc.usage_topics,
            exc.usage_complexes,
        )
        return jsonify({"ok": False, **payload}), 409
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to delete theory %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_delete_failed"}), 500


@theories_bp.route("/api/theories", methods=["POST"])
def create_theory() -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    payload = request.get_json(silent=True) or {}
    try:
        ctx.workspace_limits_service.assert_can_create_workspace_entity(ctx.user_id, "theory")
        payload["created_by_user_id"] = ctx.user_id
        payload["updated_by_user_id"] = ctx.user_id
        item = ctx.theory_service.create_theory(payload)
        item = _serialize_theory_payload(item, current_user_id=ctx.user_id)
        return jsonify({"ok": True, "item": item}), 200
    except WorkspaceLimitError as exc:
        return _workspace_limit_response(exc)
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to create theory: %s", exc)
        return jsonify({"ok": False, "error": "theory_create_failed"}), 500


@theories_bp.route("/api/theories/<string:theory_id>", methods=["GET"])
def get_theory(theory_id: str) -> Any:
    try:
        ctx = get_ctx()
        if is_hosted_web_runtime():
            _adopt_ownerless_theories_for_current_user(
                ctx.theory_service.list_theories(),
                current_user_id=ctx.user_id,
            )
        item = ctx.theory_service.get_theory(theory_id, include_delta=True)
        item = _serialize_theory_payload(item, current_user_id=ctx.user_id)
        if is_hosted_web_runtime() and not _is_visible_library_theory_for_current_user(item):
            return jsonify({"ok": False, "error": "theory_not_found"}), 404
        return jsonify({"ok": True, "item": item})
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to get theory %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_load_failed"}), 500


@theories_bp.route("/api/theories/<string:theory_id>/copy", methods=["POST"])
def copy_theory(theory_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    payload = request.get_json(silent=True) or {}
    title = payload.get("title")
    try:
        _assert_theory_not_archived(ctx, theory_id, action="copy")
        ctx.workspace_limits_service.assert_can_create_workspace_entity(ctx.user_id, "theory")
        item = ctx.theory_service.clone_theory(
            theory_id,
            title=title,
            created_by_user_id=ctx.user_id,
        )
        item = _serialize_theory_payload(item, current_user_id=ctx.user_id)
        return jsonify({"ok": True, "item": item})
    except PremiumArchivedContentError as exc:
        return _premium_archive_response(exc)
    except WorkspaceLimitError as exc:
        return _workspace_limit_response(exc)
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to copy theory %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_copy_failed"}), 500


@theories_bp.route("/api/theories/<string:theory_id>", methods=["PUT"])
def update_theory(theory_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    if is_hosted_web_runtime():
        try:
            existing = ctx.theory_service.get_theory(theory_id, include_delta=False)
            existing_s = _serialize_theory_payload(existing, current_user_id=ctx.user_id)
            if not (existing_s.get("ownership") or {}).get("is_owned_by_current_user"):
                return jsonify({"ok": False, "error": "theory_not_found"}), 404
        except TheoryNotFoundError:
            return jsonify({"ok": False, "error": "theory_not_found"}), 404

    payload = request.get_json(silent=True) or {}
    expected_version = payload.get("expected_version")
    updates: Dict[str, Any] = {}
    for field in ("title", "delta", "images"):
        if field in payload:
            updates[field] = payload.get(field)
    if updates:
        updates["updated_by_user_id"] = ctx.user_id

    try:
        if not updates:
            item = ctx.theory_service.get_theory(theory_id, include_delta=True)
        else:
            _assert_theory_not_archived(ctx, theory_id, action="edit")
            item = ctx.theory_service.update_theory(
                theory_id,
                updates,
                expected_version=expected_version,
            )
        item = _serialize_theory_payload(item, current_user_id=ctx.user_id)
        return jsonify({"ok": True, "item": item})
    except PremiumArchivedContentError as exc:
        return _premium_archive_response(exc)
    except TheoryConflictError as exc:
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
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to update theory %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_update_failed"}), 500


@theories_bp.route("/api/theories/<string:theory_id>/upload-image", methods=["POST"])
def upload_theory_image(theory_id: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    if "file" not in request.files:
        return jsonify({"ok": False, "error": "file_required"}), 400

    try:
        _assert_theory_not_archived(ctx, theory_id, action="edit")
        result = ctx.theory_service.add_image(theory_id, request.files["file"])
        response_payload: Dict[str, Any] = {"ok": True, **result}
        asset_service = getattr(ctx, "asset_service", None)
        rel_path = str(result.get("path") or "").strip()
        if is_hosted_web_runtime() and asset_service is None:
            return _hosted_theory_asset_degraded_response(
                error="hosted_asset_contract_blocked",
                operation="theory.upload_image",
                reason="asset_service_not_available",
            )
        if asset_service is not None and rel_path:
            abs_path = (ctx.data_dir / rel_path).resolve()
            try:
                asset = asset_service.register_existing_file(
                    abs_path,
                    owner_user_id=getattr(ctx, "user_id", None),
                    visibility_scope="private_workspace",
                    asset_kind="theory_image",
                    metadata={"theory_id": theory_id},
                )
                response_payload["asset_id"] = asset.get("asset_id")
                response_payload["asset_url"] = asset.get("asset_url")
            except PostgresUnavailableError as exc:
                if is_hosted_web_runtime():
                    logger.warning(
                        "[HTTP] Hosted asset registration unavailable for theory image %s: %s",
                        rel_path,
                        exc,
                    )
                    return _hosted_theory_asset_degraded_response(
                        error="hosted_asset_contract_blocked",
                        operation="theory.upload_image",
                        reason="asset_registration_storage_unavailable",
                    )
                logger.warning(
                    "[HTTP][DEV-FALLBACK] Asset registration skipped (Postgres unavailable) for theory image %s: %s",
                    rel_path,
                    exc,
                )
            except Exception as exc:
                if is_hosted_web_runtime():
                    logger.exception(
                        "[HTTP] Hosted asset registration failed for theory image %s",
                        rel_path,
                    )
                    return _hosted_theory_asset_degraded_response(
                        error="hosted_asset_contract_blocked",
                        operation="theory.upload_image",
                        reason="asset_registration_failed",
                    )
                logger.warning(
                    "[HTTP] Asset registration skipped for theory image %s: %s",
                    rel_path,
                    exc,
                )
        if is_hosted_web_runtime():
            if not (
                str(response_payload.get("asset_id") or "").strip()
                or str(response_payload.get("asset_url") or "").strip()
            ):
                return _hosted_theory_asset_degraded_response(
                    error="hosted_asset_contract_blocked",
                    operation="theory.upload_image",
                    reason="asset_id_or_asset_url_required_in_hosted_runtime",
                )
            response_payload.pop("path", None)
        return jsonify(response_payload), 200
    except PremiumArchivedContentError as exc:
        return _premium_archive_response(exc)
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to upload theory image %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_image_upload_failed"}), 500


@theories_bp.route("/api/theories/<string:theory_id>/history", methods=["GET"])
def get_theory_history(theory_id: str) -> Any:
    try:
        history = get_ctx().theory_service.get_history(theory_id)
        return jsonify({"ok": True, "history": history})
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to load theory history %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_history_failed"}), 500


@theories_bp.route("/api/theories/<string:theory_id>/restore/<string:snapshot_timestamp>", methods=["POST"])
def restore_theory(theory_id: str, snapshot_timestamp: str) -> Any:
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    try:
        _assert_theory_not_archived(ctx, theory_id, action="edit")
        item = ctx.theory_service.restore_from_history(
            theory_id,
            snapshot_timestamp,
            restored_by_user_id=ctx.user_id,
        )
        item = _serialize_theory_payload(item, current_user_id=ctx.user_id)
        return jsonify({"ok": True, "item": item})
    except PremiumArchivedContentError as exc:
        return _premium_archive_response(exc)
    except TheoryNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception(
            "[HTTP] Failed to restore theory %s from %s: %s",
            theory_id,
            snapshot_timestamp,
            exc,
        )
        return jsonify({"ok": False, "error": "theory_restore_failed"}), 500
