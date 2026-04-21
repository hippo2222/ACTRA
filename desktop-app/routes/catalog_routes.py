"""Public catalog routes for Stage 5 publish/read foundation."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from flask import Blueprint, jsonify, request

from routes._context import get_ctx
from routes._helpers import _maybe_hosted_shadow_write_error_response
from services.workspace_limits_service import WorkspaceLimitError

logger = logging.getLogger(__name__)

catalog_bp = Blueprint("catalog", __name__)


def _route_contract(*, mode: str, public_api: bool = True) -> Dict[str, Any]:
    return {
        "namespace": "public_catalog",
        "mode": mode,
        "public_api": bool(public_api),
        "legacy_editor_import": False,
    }


def _with_route_contract(payload: Any, *, mode: str, public_api: bool = True) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = dict(payload)
    normalized["route_contract"] = _route_contract(mode=mode, public_api=public_api)
    return normalized


def _error_response(*, mode: str, error: str, status: int, public_api: bool = True) -> Any:
    return (
        jsonify(
            {
                "ok": False,
                "error": str(error),
                "route_contract": _route_contract(mode=mode, public_api=public_api),
            }
        ),
        status,
    )


def _workspace_limit_response(exc: WorkspaceLimitError, *, mode: str, public_api: bool = True) -> Any:
    payload = exc.to_payload()
    payload["route_contract"] = _route_contract(mode=mode, public_api=public_api)
    return jsonify(payload), 409


def _maybe_degraded_catalog_error(exc: Exception, *, mode: str, public_api: bool = True) -> Optional[Any]:
    return _maybe_hosted_shadow_write_error_response(
        exc,
        extra_payload={"route_contract": _route_contract(mode=mode, public_api=public_api)},
        status=503,
    )


def _service() -> Any:
    return getattr(get_ctx(), "catalog_service", None)


def _request_user_id(*, required: bool = False) -> Any:
    user_id = str(get_ctx().user_id or "").strip()
    if user_id and user_id != "guest":
        return user_id
    if required:
        raise ValueError("requested_by_user_id_required")
    return None


def _json_body() -> Dict[str, Any]:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def _request_access_code() -> Any:
    query_code = request.args.get("access_code")
    if isinstance(query_code, str) and query_code.strip():
        return query_code
    body_code = _json_body().get("access_code")
    if isinstance(body_code, str) and body_code.strip():
        return body_code
    return None


def _request_flag(name: str) -> bool:
    value = request.args.get(name)
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _publish_error_status(error: str) -> int:
    text = str(error or "")
    if text == "workspace_limit_reached":
        return 409
    if text.endswith("_not_found"):
        return 404
    if "forbidden" in text:
        return 403
    if text in {
        "catalog_item_not_accessible",
        "catalog_access_code_required",
        "theory_library_entry_not_accessible",
        "guest_cannot_publish",
        "guest_cannot_add_to_library",
        "guest_cannot_read_library_status",
        "guest_cannot_update_catalog_visibility",
    }:
        return 403
    if text in {"theory_library_entry_not_found", "catalog_version_not_found", "catalog_item_not_found"}:
        return 404
    if text == "theory_catalog_visibility_locked_by_public_complex":
        return 409
    if text == "requested_by_user_id_required":
        return 403
    if text == "catalog_service_not_available":
        return 503
    return 400


@catalog_bp.route("/api/catalog/items", methods=["GET"])
def list_catalog_items() -> Any:
    service = _service()
    if service is None:
        return _error_response(mode="list", error="catalog_service_not_available", status=503)
    query = request.args.get("q")
    content_type = request.args.get("content_type")
    owner_user_id = request.args.get("owner_user_id")
    include_owned_non_public = _request_flag("include_owned_non_public")
    try:
        payload = service.list_items(
            query=query,
            content_type=content_type,
            owner_user_id=owner_user_id,
            include_owned_non_public=include_owned_non_public,
            requested_by_user_id=_request_user_id(required=False),
        )
        return jsonify(_with_route_contract(payload, mode="list"))
    except ValueError as exc:
        return _error_response(mode="list", error=str(exc), status=_publish_error_status(str(exc)))
    except Exception as exc:
        degraded_response = _maybe_degraded_catalog_error(exc, mode="list")
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] catalog list failed: %s", exc)
        return _error_response(mode="list", error="catalog_list_failed", status=500)


@catalog_bp.route("/api/catalog/items/<string:item_id>", methods=["GET"])
def get_catalog_item(item_id: str) -> Any:
    service = _service()
    if service is None:
        return _error_response(mode="detail", error="catalog_service_not_available", status=503)
    try:
        payload = service.get_item(
            item_id,
            requested_by_user_id=_request_user_id(required=False),
            access_code=_request_access_code(),
        )
        return jsonify(_with_route_contract(payload, mode="detail"))
    except ValueError as exc:
        return _error_response(mode="detail", error=str(exc), status=_publish_error_status(str(exc)))
    except Exception as exc:
        degraded_response = _maybe_degraded_catalog_error(exc, mode="detail")
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] catalog detail failed: item=%s error=%s", item_id, exc)
        return _error_response(mode="detail", error="catalog_detail_failed", status=500)


@catalog_bp.route("/api/catalog/items/<string:item_id>/versions/<string:version_id>", methods=["GET"])
def get_catalog_version(item_id: str, version_id: str) -> Any:
    service = _service()
    if service is None:
        return _error_response(mode="version", error="catalog_service_not_available", status=503)
    try:
        payload = service.get_version(
            item_id,
            version_id,
            requested_by_user_id=_request_user_id(required=False),
            access_code=_request_access_code(),
        )
        return jsonify(_with_route_contract(payload, mode="version"))
    except ValueError as exc:
        return _error_response(mode="version", error=str(exc), status=_publish_error_status(str(exc)))
    except Exception as exc:
        degraded_response = _maybe_degraded_catalog_error(exc, mode="version")
        if degraded_response is not None:
            return degraded_response
        logger.exception(
            "[HTTP] catalog version failed: item=%s version=%s error=%s",
            item_id,
            version_id,
            exc,
        )
        return _error_response(mode="version", error="catalog_version_failed", status=500)


@catalog_bp.route("/api/catalog/items/<string:item_id>/library", methods=["POST"])
def add_catalog_item_to_library(item_id: str) -> Any:
    ctx = get_ctx()
    if str(ctx.user_id or "").strip() == "guest":
        return _error_response(mode="add_item_to_library", error="guest_cannot_add_to_library", status=403, public_api=False)
    service = getattr(ctx, "catalog_service", None)
    if service is None:
        return _error_response(
            mode="add_item_to_library",
            error="catalog_service_not_available",
            status=503,
            public_api=False,
        )
    try:
        payload = service.add_item_to_library(
            item_id,
            requested_by_user_id=ctx.user_id,
            access_code=_request_access_code(),
        )
        return jsonify(_with_route_contract(payload, mode="add_item_to_library", public_api=False))
    except WorkspaceLimitError as exc:
        return _workspace_limit_response(exc, mode="add_item_to_library", public_api=False)
    except ValueError as exc:
        return _error_response(
            mode="add_item_to_library",
            error=str(exc),
            status=_publish_error_status(str(exc)),
            public_api=False,
        )
    except Exception as exc:
        degraded_response = _maybe_degraded_catalog_error(exc, mode="add_item_to_library", public_api=False)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] add item to library failed: item=%s error=%s", item_id, exc)
        return _error_response(
            mode="add_item_to_library",
            error="catalog_add_item_to_library_failed",
            status=500,
            public_api=False,
        )


@catalog_bp.route("/api/catalog/items/<string:item_id>/library-status", methods=["GET"])
def get_catalog_item_library_status(item_id: str) -> Any:
    ctx = get_ctx()
    if str(ctx.user_id or "").strip() == "guest":
        return _error_response(
            mode="item_library_status",
            error="guest_cannot_read_library_status",
            status=403,
            public_api=False,
        )
    service = getattr(ctx, "catalog_service", None)
    if service is None:
        return _error_response(
            mode="item_library_status",
            error="catalog_service_not_available",
            status=503,
            public_api=False,
        )
    try:
        payload = service.get_item_library_status(
            item_id,
            requested_by_user_id=ctx.user_id,
        )
        return jsonify(_with_route_contract(payload, mode="item_library_status", public_api=False))
    except ValueError as exc:
        return _error_response(
            mode="item_library_status",
            error=str(exc),
            status=_publish_error_status(str(exc)),
            public_api=False,
        )
    except Exception as exc:
        degraded_response = _maybe_degraded_catalog_error(exc, mode="item_library_status", public_api=False)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] item library status failed: item=%s error=%s", item_id, exc)
        return _error_response(
            mode="item_library_status",
            error="catalog_item_library_status_failed",
            status=500,
            public_api=False,
        )


@catalog_bp.route("/api/catalog/complexes/<string:workspace_complex_id>/publish", methods=["POST"])
def publish_catalog_complex(workspace_complex_id: str) -> Any:
    ctx = get_ctx()
    if str(ctx.user_id or "").strip() == "guest":
        return _error_response(mode="publish_complex", error="guest_cannot_publish", status=403, public_api=False)
    service = getattr(ctx, "catalog_service", None)
    if service is None:
        return _error_response(
            mode="publish_complex",
            error="catalog_service_not_available",
            status=503,
            public_api=False,
        )
    try:
        body = _json_body()
        payload = service.publish_complex(
            workspace_complex_id,
            requested_by_user_id=ctx.user_id,
            catalog_visibility=body.get("catalog_visibility"),
        )
        return jsonify(_with_route_contract(payload, mode="publish_complex", public_api=False))
    except ValueError as exc:
        return _error_response(
            mode="publish_complex",
            error=str(exc),
            status=_publish_error_status(str(exc)),
            public_api=False,
        )
    except Exception as exc:
        degraded_response = _maybe_degraded_catalog_error(exc, mode="publish_complex", public_api=False)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] complex publish failed: complex=%s error=%s", workspace_complex_id, exc)
        return _error_response(
            mode="publish_complex",
            error="catalog_publish_failed",
            status=500,
            public_api=False,
        )


@catalog_bp.route("/api/catalog/theories/<string:theory_id>/publish", methods=["POST"])
def publish_catalog_theory(theory_id: str) -> Any:
    ctx = get_ctx()
    if str(ctx.user_id or "").strip() == "guest":
        return _error_response(mode="publish_theory", error="guest_cannot_publish", status=403, public_api=False)
    service = getattr(ctx, "catalog_service", None)
    if service is None:
        return _error_response(
            mode="publish_theory",
            error="catalog_service_not_available",
            status=503,
            public_api=False,
        )
    try:
        body = _json_body()
        payload = service.publish_theory(
            theory_id,
            requested_by_user_id=ctx.user_id,
            catalog_visibility=body.get("catalog_visibility"),
        )
        return jsonify(_with_route_contract(payload, mode="publish_theory", public_api=False))
    except ValueError as exc:
        return _error_response(
            mode="publish_theory",
            error=str(exc),
            status=_publish_error_status(str(exc)),
            public_api=False,
        )
    except Exception as exc:
        degraded_response = _maybe_degraded_catalog_error(exc, mode="publish_theory", public_api=False)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] theory publish failed: theory=%s error=%s", theory_id, exc)
        return _error_response(
            mode="publish_theory",
            error="catalog_publish_failed",
            status=500,
            public_api=False,
        )


@catalog_bp.route("/api/catalog/items/<string:item_id>/versions/<string:version_id>/add-to-library", methods=["POST"])
def add_catalog_version_to_library(item_id: str, version_id: str) -> Any:
    ctx = get_ctx()
    if str(ctx.user_id or "").strip() == "guest":
        return _error_response(mode="add_to_library", error="guest_cannot_add_to_library", status=403, public_api=False)
    service = getattr(ctx, "catalog_service", None)
    if service is None:
        return _error_response(
            mode="add_to_library",
            error="catalog_service_not_available",
            status=503,
            public_api=False,
        )
    try:
        body = _json_body()
        payload = service.add_version_to_library(
            item_id,
            version_id,
            requested_by_user_id=ctx.user_id,
            prefer_existing_by_lineage=bool(body.get("prefer_existing_by_lineage", True)),
            access_code=_request_access_code(),
        )
        return jsonify(_with_route_contract(payload, mode="add_to_library", public_api=False))
    except WorkspaceLimitError as exc:
        return _workspace_limit_response(exc, mode="add_to_library", public_api=False)
    except ValueError as exc:
        return _error_response(
            mode="add_to_library",
            error=str(exc),
            status=_publish_error_status(str(exc)),
            public_api=False,
        )
    except Exception as exc:
        degraded_response = _maybe_degraded_catalog_error(exc, mode="add_to_library", public_api=False)
        if degraded_response is not None:
            return degraded_response
        logger.exception(
            "[HTTP] add to library failed: item=%s version=%s error=%s",
            item_id,
            version_id,
            exc,
        )
        return _error_response(
            mode="add_to_library",
            error="catalog_add_to_library_failed",
            status=500,
            public_api=False,
        )


@catalog_bp.route("/api/catalog/items/<string:item_id>/versions/<string:version_id>/add-to-library/preview", methods=["POST"])
def preview_add_catalog_version_to_library(item_id: str, version_id: str) -> Any:
    ctx = get_ctx()
    if str(ctx.user_id or "").strip() == "guest":
        return _error_response(
            mode="add_to_library_preview",
            error="guest_cannot_add_to_library",
            status=403,
            public_api=False,
        )
    service = getattr(ctx, "catalog_service", None)
    if service is None:
        return _error_response(
            mode="add_to_library_preview",
            error="catalog_service_not_available",
            status=503,
            public_api=False,
        )
    try:
        body = _json_body()
        payload = service.preview_add_version_to_library(
            item_id,
            version_id,
            requested_by_user_id=ctx.user_id,
            prefer_existing_by_lineage=bool(body.get("prefer_existing_by_lineage", True)),
            access_code=_request_access_code(),
        )
        return jsonify(_with_route_contract(payload, mode="add_to_library_preview", public_api=False))
    except ValueError as exc:
        return _error_response(
            mode="add_to_library_preview",
            error=str(exc),
            status=_publish_error_status(str(exc)),
            public_api=False,
        )
    except Exception as exc:
        degraded_response = _maybe_degraded_catalog_error(exc, mode="add_to_library_preview", public_api=False)
        if degraded_response is not None:
            return degraded_response
        logger.exception(
            "[HTTP] add to library preview failed: item=%s version=%s error=%s",
            item_id,
            version_id,
            exc,
        )
        return _error_response(
            mode="add_to_library_preview",
            error="catalog_add_to_library_preview_failed",
            status=500,
            public_api=False,
        )


@catalog_bp.route("/api/catalog/items/<string:item_id>/versions/<string:version_id>/library-status", methods=["GET"])
def get_catalog_version_library_status(item_id: str, version_id: str) -> Any:
    ctx = get_ctx()
    if str(ctx.user_id or "").strip() == "guest":
        return _error_response(
            mode="library_status",
            error="guest_cannot_read_library_status",
            status=403,
            public_api=False,
        )
    service = getattr(ctx, "catalog_service", None)
    if service is None:
        return _error_response(
            mode="library_status",
            error="catalog_service_not_available",
            status=503,
            public_api=False,
        )
    try:
        payload = service.get_version_library_status(
            item_id,
            version_id,
            requested_by_user_id=ctx.user_id,
            access_code=_request_access_code(),
        )
        return jsonify(_with_route_contract(payload, mode="library_status", public_api=False))
    except ValueError as exc:
        return _error_response(
            mode="library_status",
            error=str(exc),
            status=_publish_error_status(str(exc)),
            public_api=False,
        )
    except Exception as exc:
        degraded_response = _maybe_degraded_catalog_error(exc, mode="library_status", public_api=False)
        if degraded_response is not None:
            return degraded_response
        logger.exception(
            "[HTTP] library status failed: item=%s version=%s error=%s",
            item_id,
            version_id,
            exc,
        )
        return _error_response(
            mode="library_status",
            error="catalog_library_status_failed",
            status=500,
            public_api=False,
        )


@catalog_bp.route("/api/catalog/items/<string:item_id>/visibility", methods=["POST"])
def update_catalog_item_visibility(item_id: str) -> Any:
    ctx = get_ctx()
    if str(ctx.user_id or "").strip() == "guest":
        return _error_response(
            mode="set_visibility",
            error="guest_cannot_update_catalog_visibility",
            status=403,
            public_api=False,
        )
    service = getattr(ctx, "catalog_service", None)
    if service is None:
        return _error_response(
            mode="set_visibility",
            error="catalog_service_not_available",
            status=503,
            public_api=False,
        )
    try:
        body = _json_body()
        payload = service.set_item_visibility(
            item_id,
            catalog_visibility=body.get("catalog_visibility"),
            requested_by_user_id=ctx.user_id,
        )
        return jsonify(_with_route_contract(payload, mode="set_visibility", public_api=False))
    except ValueError as exc:
        return _error_response(
            mode="set_visibility",
            error=str(exc),
            status=_publish_error_status(str(exc)),
            public_api=False,
        )
    except Exception as exc:
        degraded_response = _maybe_degraded_catalog_error(exc, mode="set_visibility", public_api=False)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] catalog visibility update failed: item=%s error=%s", item_id, exc)
        return _error_response(
            mode="set_visibility",
            error="catalog_visibility_update_failed",
            status=500,
            public_api=False,
        )


@catalog_bp.route("/api/catalog/access-code/resolve", methods=["POST"])
def resolve_catalog_access_code() -> Any:
    service = _service()
    if service is None:
        return _error_response(mode="resolve_access_code", error="catalog_service_not_available", status=503)
    try:
        payload = service.resolve_access_code(
            _json_body().get("access_code"),
            requested_by_user_id=_request_user_id(required=False),
        )
        return jsonify(_with_route_contract(payload, mode="resolve_access_code"))
    except ValueError as exc:
        return _error_response(
            mode="resolve_access_code",
            error=str(exc),
            status=_publish_error_status(str(exc)),
        )
    except Exception as exc:
        degraded_response = _maybe_degraded_catalog_error(exc, mode="resolve_access_code")
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] catalog access code resolve failed: %s", exc)
        return _error_response(mode="resolve_access_code", error="catalog_access_code_resolve_failed", status=500)
