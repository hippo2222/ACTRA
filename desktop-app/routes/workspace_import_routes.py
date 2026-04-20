"""Restricted workspace import routes for the internal workspace bridge.

These endpoints intentionally do not expose public catalog/publish semantics.
They remain available only as an explicit internal bridge for legacy or
operational flows. Hosted web keeps them blocked by default.
"""

import logging
import os
from typing import Any

from flask import Blueprint, jsonify, request

from routes._context import get_ctx, is_hosted_web_runtime

logger = logging.getLogger(__name__)

workspace_import_bp = Blueprint("workspace_import", __name__)

_HOSTED_BRIDGE_ENABLE_ENV = "ACTRA_ENABLE_HOSTED_WORKSPACE_IMPORT_BRIDGE"
_HOSTED_BRIDGE_HEADER = "X-ACTRA-Internal-Bridge"
_HOSTED_BRIDGE_HEADER_VALUE = "workspace-import"


def _to_bool(value: Any, default: bool = True) -> bool:
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


def _build_route_contract_payload(result: Any, *, mode: str) -> Any:
    if not isinstance(result, dict):
        return result
    normalized = dict(result)
    normalized["route_contract"] = _route_contract(mode=mode)
    return normalized


def _route_contract(*, mode: str) -> Any:
    return {
        "namespace": "internal_workspace_import",
        "mode": mode,
        "public_api": False,
        "legacy_editor_import": False,
        "bridge_only": True,
        "hosted_runtime_blocked_by_default": True,
        "hosted_route_enabled": _is_hosted_bridge_enabled(),
    }


def _is_hosted_bridge_enabled() -> bool:
    raw = str(os.environ.get(_HOSTED_BRIDGE_ENABLE_ENV) or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _validate_bridge_access(*, mode: str) -> Any:
    if not is_hosted_web_runtime():
        return None
    if not _is_hosted_bridge_enabled():
        return _error_route_response(
            mode=mode,
            status=403,
            error="workspace_import_bridge_disabled_in_hosted_web",
        )
    header_value = str(request.headers.get(_HOSTED_BRIDGE_HEADER) or "").strip().lower()
    if header_value != _HOSTED_BRIDGE_HEADER_VALUE:
        return _error_route_response(
            mode=mode,
            status=403,
            error="internal_bridge_header_required",
            required_header=_HOSTED_BRIDGE_HEADER,
        )
    return None


def _error_route_response(*, mode: str, status: int, error: str, **extra: Any) -> Any:
    payload = {
        "ok": False,
        "error": str(error),
        "route_contract": _route_contract(mode=mode),
    }
    if extra:
        payload.update(extra)
    return jsonify(payload), status


def _find_legacy_import_markers(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return []
    legacy_keys = (
        "cache_id",
        "archive",
        "archive_name",
        "module_id",
        "topic_id",
        "overwrite_existing",
        "conflict_resolution",
        "import_context",
        "parsed_tasks",
        "tasks",
    )
    return [key for key in legacy_keys if key in payload]


def _parse_import_request_payload() -> Any:
    payload = request.get_json(silent=True) or {}
    legacy_markers = _find_legacy_import_markers(payload)
    if legacy_markers:
        raise ValueError(f"legacy_editor_import_payload_not_supported:{','.join(legacy_markers)}")
    source_complex_id = str(payload.get("source_complex_id") or "").strip()
    source_catalog_item_id = str(payload.get("source_catalog_item_id") or "").strip()
    source_catalog_version_id = str(payload.get("source_catalog_version_id") or "").strip()
    prefer_existing_by_lineage = _to_bool(payload.get("prefer_existing_by_lineage"), True)
    return (
        source_complex_id,
        source_catalog_item_id,
        source_catalog_version_id,
        prefer_existing_by_lineage,
    )


def _validate_import_request(ctx: Any, *, mode: str) -> Any:
    bridge_error = _validate_bridge_access(mode=mode)
    if bridge_error is not None:
        return None, bridge_error

    if ctx.user_id == "guest":
        return None, _error_route_response(mode=mode, status=403, error="guest_cannot_import")

    try:
        (
            source_complex_id,
            source_catalog_item_id,
            source_catalog_version_id,
            prefer_existing_by_lineage,
        ) = _parse_import_request_payload()
    except ValueError as exc:
        return None, _error_route_response(mode=mode, status=400, error=str(exc))

    if not source_complex_id:
        return None, _error_route_response(mode=mode, status=400, error="source_complex_id_required")
    if not source_catalog_item_id:
        return None, _error_route_response(mode=mode, status=400, error="source_catalog_item_id_required")
    if not source_catalog_version_id:
        return None, _error_route_response(mode=mode, status=400, error="source_catalog_version_id_required")

    service = getattr(ctx, "workspace_import_service", None)
    if service is None:
        return None, _error_route_response(mode=mode, status=503, error="service_not_available")

    source_complex = ctx.complex_service.get_complex(source_complex_id)
    if source_complex is None:
        return None, _error_route_response(mode=mode, status=404, error="source_complex_not_found")

    return (
        {
            "service": service,
            "source_complex_id": source_complex_id,
            "source_catalog_item_id": source_catalog_item_id,
            "source_catalog_version_id": source_catalog_version_id,
            "prefer_existing_by_lineage": prefer_existing_by_lineage,
        },
        None,
    )


@workspace_import_bp.route("/api/internal/workspace/import/complex-copy", methods=["POST"])
def import_workspace_complex_copy() -> Any:
    ctx = get_ctx()
    parsed, error_response = _validate_import_request(ctx, mode="execute")
    if error_response is not None:
        return error_response
    assert parsed is not None

    try:
        result = parsed["service"].import_complex_copy_by_source_complex_id(
            parsed["source_complex_id"],
            source_catalog_item_id=parsed["source_catalog_item_id"],
            source_catalog_version_id=parsed["source_catalog_version_id"],
            requested_by_user_id=ctx.user_id,
            prefer_existing_by_lineage=parsed["prefer_existing_by_lineage"],
        )
        return jsonify(_build_route_contract_payload(result, mode="execute"))
    except ValueError as exc:
        logger.warning(
            "[HTTP] workspace import rejected: complex=%s catalog_item=%s version=%s error=%s",
            parsed["source_complex_id"],
            parsed["source_catalog_item_id"],
            parsed["source_catalog_version_id"],
            exc,
        )
        return _error_route_response(mode="execute", status=400, error=str(exc))
    except Exception as exc:
        logger.exception(
            "[HTTP] workspace import failed: complex=%s catalog_item=%s version=%s error=%s",
            parsed["source_complex_id"],
            parsed["source_catalog_item_id"],
            parsed["source_catalog_version_id"],
            exc,
        )
        return _error_route_response(mode="execute", status=500, error="workspace_import_failed")


@workspace_import_bp.route("/api/internal/workspace/import/complex-copy/preview", methods=["POST"])
def preview_workspace_complex_copy() -> Any:
    ctx = get_ctx()
    parsed, error_response = _validate_import_request(ctx, mode="preview")
    if error_response is not None:
        return error_response
    assert parsed is not None

    try:
        result = parsed["service"].preview_complex_copy_by_source_complex_id(
            parsed["source_complex_id"],
            source_catalog_item_id=parsed["source_catalog_item_id"],
            source_catalog_version_id=parsed["source_catalog_version_id"],
            requested_by_user_id=ctx.user_id,
            prefer_existing_by_lineage=parsed["prefer_existing_by_lineage"],
        )
        return jsonify(_build_route_contract_payload(result, mode="preview"))
    except ValueError as exc:
        logger.warning(
            "[HTTP] workspace import preview rejected: complex=%s catalog_item=%s version=%s error=%s",
            parsed["source_complex_id"],
            parsed["source_catalog_item_id"],
            parsed["source_catalog_version_id"],
            exc,
        )
        return _error_route_response(mode="preview", status=400, error=str(exc))
    except Exception as exc:
        logger.exception(
            "[HTTP] workspace import preview failed: complex=%s catalog_item=%s version=%s error=%s",
            parsed["source_complex_id"],
            parsed["source_catalog_item_id"],
            parsed["source_catalog_version_id"],
            exc,
        )
        return _error_route_response(mode="preview", status=500, error="workspace_import_preview_failed")
