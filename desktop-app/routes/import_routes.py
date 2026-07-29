"""Task Import / Export / Delete / Rename routes.

Endpoints:
- POST /api/editor/tasks/delete
- POST /api/editor/export/text
- POST /api/editor/modules/delete
- POST /api/editor/topics/delete
- POST /api/editor/module/rename
- POST /api/editor/topic/rename
- POST /api/editor/import/parse
- POST /api/editor/import/execute
"""

import hashlib
import logging
import re
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from flask import Blueprint, jsonify, request

from routes._context import get_ctx, get_extra, is_hosted_web_runtime
from routes._helpers import _maybe_hosted_shadow_write_error_response
from services.hosted_shadow_fallback import (
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)
from services.workspace_limits_service import PremiumArchivedContentError

logger = logging.getLogger(__name__)

import_bp = Blueprint("import", __name__)

_WORKSPACE_IMPORT_MARKER_KEYS = (
    "source_complex_id",
    "source_catalog_item_id",
    "source_catalog_version_id",
    "prefer_existing_by_lineage",
    "requested_by_user_id",
)


# ---------------------------------------------------------------------------
# Helper accessor
# ---------------------------------------------------------------------------

def _ih() -> Dict[str, Any]:
    """Return the import helpers dict registered by server.py."""
    return get_extra("import_helpers")


def _parse_imported_analysis_response(raw_text: str) -> Dict[str, Any]:
    text = str(raw_text or "").strip()
    if not text:
        raise ValueError("text_required")

    from services.ai_generation_service import parse_analysis_response, parse_human_summary

    parsed = parse_analysis_response(text)
    human_summary = parse_human_summary(text)
    payload: Dict[str, Any] = {
        "ok": True,
        "human_summary": human_summary,
        **(parsed if isinstance(parsed, dict) else {}),
    }

    ai_helpers = get_extra("ai_helpers")
    sanitize = None
    if isinstance(ai_helpers, dict):
        sanitize = ai_helpers.get("sanitize_analysis_response_for_client")
    if callable(sanitize):
        payload = sanitize(payload)
    return payload


def _coerce_optional_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "да"}:
            return True
        if lowered in {"false", "0", "no", "нет"}:
            return False
    return None


def _infer_imported_sequence_flags(
    prompt: str,
    level_blocks: List[List[str]],
    metadata: Dict[str, Any],
) -> Tuple[bool, bool]:
    metadata = metadata if isinstance(metadata, dict) else {}
    level_order = _coerce_optional_bool(metadata.get("level_order_matters"))
    if level_order is None:
        level_order = _coerce_optional_bool(metadata.get("levels_order_matters"))

    sequence_inside = _coerce_optional_bool(metadata.get("sequence_within_level_matters"))
    if sequence_inside is None:
        sequence_inside = _coerce_optional_bool(metadata.get("order_inside_matters"))

    prompt_low = str(prompt or "").strip().lower()
    level_sizes = [len(blocks) for blocks in level_blocks if isinstance(blocks, list)]
    has_multi_block_level = any(size > 1 for size in level_sizes)
    all_single_block = bool(level_sizes) and all(size == 1 for size in level_sizes)
    ordering_markers = (
        "поряд",
        "хронолог",
        "алгоритм",
        "этап",
        "стади",
        "последоват",
        "ранж",
        "иерарх",
        "timeline",
        "order",
        "sequence",
        "rank",
        "hierarch",
    )
    grouping_markers = (
        "классиф",
        "сгруп",
        "распредел",
        "категор",
        "group",
        "classif",
        "categor",
    )

    if level_order is None:
        if all_single_block and len(level_sizes) > 1:
            level_order = True
        elif any(marker in prompt_low for marker in ordering_markers):
            level_order = True
        elif any(marker in prompt_low for marker in grouping_markers):
            level_order = False
        else:
            level_order = False

    if sequence_inside is None:
        if has_multi_block_level and any(marker in prompt_low for marker in ordering_markers) and not any(
            marker in prompt_low for marker in grouping_markers
        ):
            sequence_inside = True
        else:
            sequence_inside = False

    return bool(sequence_inside), bool(level_order)


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


def _workspace_import_markers_in_payload(payload: Any) -> List[str]:
    if not isinstance(payload, dict):
        return []
    return [key for key in _WORKSPACE_IMPORT_MARKER_KEYS if key in payload]


def _premium_archive_response(exc: PremiumArchivedContentError) -> Any:
    return jsonify(exc.to_payload()), 409


def _assert_export_task_refs_not_archived(ctx: Any, task_refs: Any, *, action: str) -> None:
    service = getattr(ctx, "workspace_limits_service", None)
    if service is None or not isinstance(task_refs, list):
        return
    for ref in task_refs:
        if not isinstance(ref, dict):
            continue
        mid = str(ref.get("module_id") or "").strip()
        tid = str(ref.get("topic_id") or "").strip()
        task_id = str(ref.get("task_id") or "").strip()
        if not mid or not tid or not task_id:
            continue
        task_ref = f"{mid}/{tid}/{task_id}"
        service.assert_entity_not_archived(
            ctx.user_id,
            "task",
            task_ref,
            action=action,
            scope="workspace",
        )
        if task_id != task_ref:
            service.assert_entity_not_archived(
                ctx.user_id,
                "task",
                task_id,
                action=action,
                scope="workspace",
            )


# ---------------------------------------------------------------------------
# Idempotency helpers (module-local state)
# ---------------------------------------------------------------------------

_IMPORT_EXECUTE_IDEMPOTENCY_LOCK = threading.Lock()
_IMPORT_EXECUTE_IDEMPOTENCY_CACHE: Dict[str, Dict[str, Any]] = {}
_IMPORT_EXECUTE_IDEMPOTENCY_TTL_SECONDS = 15 * 60


def _cleanup_import_idempotency_cache() -> None:
    now = time.time()
    stale_keys = [
        key for key, item in _IMPORT_EXECUTE_IDEMPOTENCY_CACHE.items()
        if now - float(item.get("created_ts", 0)) > _IMPORT_EXECUTE_IDEMPOTENCY_TTL_SECONDS
    ]
    for key in stale_keys:
        _IMPORT_EXECUTE_IDEMPOTENCY_CACHE.pop(key, None)


def _import_idempotency_get(idempotency_key: str, request_fingerprint: str) -> Optional[Dict[str, Any]]:
    if not idempotency_key:
        return None
    with _IMPORT_EXECUTE_IDEMPOTENCY_LOCK:
        _cleanup_import_idempotency_cache()
        item = _IMPORT_EXECUTE_IDEMPOTENCY_CACHE.get(idempotency_key)
        if not item:
            return None
        if item.get("request_fingerprint") != request_fingerprint:
            return {"conflict": True}
        if item.get("in_progress"):
            return {"in_progress": True}
        cached_response = dict(item.get("response") or {})
        cached_response["idempotent_replay"] = True
        return cached_response


def _import_idempotency_reserve(idempotency_key: str, request_fingerprint: str) -> Optional[Dict[str, Any]]:
    if not idempotency_key:
        return None
    with _IMPORT_EXECUTE_IDEMPOTENCY_LOCK:
        _cleanup_import_idempotency_cache()
        item = _IMPORT_EXECUTE_IDEMPOTENCY_CACHE.get(idempotency_key)
        if item:
            if item.get("request_fingerprint") != request_fingerprint:
                return {"conflict": True}
            if item.get("in_progress"):
                return {"in_progress": True}
            cached_response = dict(item.get("response") or {})
            cached_response["idempotent_replay"] = True
            return cached_response
        _IMPORT_EXECUTE_IDEMPOTENCY_CACHE[idempotency_key] = {
            "created_ts": time.time(),
            "request_fingerprint": request_fingerprint,
            "in_progress": True,
            "response": None,
        }
        return None


def _import_idempotency_store(idempotency_key: str, request_fingerprint: str, response: Dict[str, Any]) -> None:
    if not idempotency_key:
        return
    with _IMPORT_EXECUTE_IDEMPOTENCY_LOCK:
        _cleanup_import_idempotency_cache()
        _IMPORT_EXECUTE_IDEMPOTENCY_CACHE[idempotency_key] = {
            "created_ts": time.time(),
            "request_fingerprint": request_fingerprint,
            "in_progress": False,
            "response": dict(response or {}),
        }


def _import_idempotency_release(idempotency_key: str, request_fingerprint: str) -> None:
    if not idempotency_key:
        return
    with _IMPORT_EXECUTE_IDEMPOTENCY_LOCK:
        item = _IMPORT_EXECUTE_IDEMPOTENCY_CACHE.get(idempotency_key)
        if not item:
            return
        if item.get("request_fingerprint") == request_fingerprint and item.get("in_progress"):
            _IMPORT_EXECUTE_IDEMPOTENCY_CACHE.pop(idempotency_key, None)


# ---------------------------------------------------------------------------
# Import-local helpers
# ---------------------------------------------------------------------------

def _word_ranges(text: str) -> List[Tuple[int, int]]:
    if not isinstance(text, str) or not text:
        return []
    return [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]


def _normalize_click_import_data(task_data: Dict[str, Any]) -> Dict[str, Any]:
    data = dict(task_data or {})
    mode = str(data.get("mode") or "").strip().lower()
    if mode == "word_errors":
        mode = "text_errors"
    data["mode"] = mode
    data["subtype"] = data.get("subtype") or "error_detection"

    if mode == "text_choice":
        normalized_options = []
        raw_options = data.get("options", [])
        if isinstance(raw_options, list):
            for idx, opt in enumerate(raw_options):
                if not isinstance(opt, dict):
                    continue
                normalized_options.append(
                    {
                        "id": str(opt.get("id") or f"option_{idx + 1}"),
                        "text": str(opt.get("text", "")),
                        "is_correct": bool(opt.get("is_correct", opt.get("correct", False))),
                    }
                )
        data["options"] = normalized_options

    if mode == "text_errors":
        text = str(data.get("text", ""))
        spans = []
        raw_spans = data.get("error_spans")
        if isinstance(raw_spans, list):
            for span in raw_spans:
                if not isinstance(span, dict):
                    continue
                start = span.get("start")
                end = span.get("end")
                if not isinstance(start, int) or not isinstance(end, int):
                    continue
                spans.append(
                    {
                        "start": start,
                        "end": end,
                        "is_correct": bool(span.get("is_correct", False)),
                    }
                )
        if not spans:
            raw_indices = data.get("error_indices", [])
            if isinstance(raw_indices, list):
                ranges = _word_ranges(text)
                for raw_idx in raw_indices:
                    if not isinstance(raw_idx, int):
                        continue
                    if raw_idx < 0 or raw_idx >= len(ranges):
                        continue
                    start, end = ranges[raw_idx]
                    spans.append({"start": start, "end": end, "is_correct": False})
        data["error_spans"] = spans
        data.pop("error_indices", None)

    return data


def _canonicalize_test_questions(questions: Any) -> Tuple[List[Dict[str, Any]], str]:
    """Normalize TEST questions to backend schema (`correct`) and infer test_type."""
    if not isinstance(questions, list):
        return [], "single_choice"

    normalized_questions: List[Dict[str, Any]] = []
    has_multiple_correct = False

    for q_idx, q in enumerate(questions):
        if not isinstance(q, dict):
            continue
        normalized_answers: List[Dict[str, Any]] = []
        correct_count = 0
        for a_idx, ans in enumerate(q.get("answers", []) or []):
            if not isinstance(ans, dict):
                continue
            is_correct = bool(ans.get("correct", ans.get("is_correct", False)))
            if is_correct:
                correct_count += 1
            normalized_answer = dict(ans)
            normalized_answer["correct"] = is_correct
            normalized_answer["is_correct"] = is_correct
            if not normalized_answer.get("id"):
                normalized_answer["id"] = f"q{q_idx + 1}_a{a_idx + 1}"
            normalized_answers.append(normalized_answer)
        if correct_count > 1:
            has_multiple_correct = True
        normalized_q = dict(q)
        normalized_q["answers"] = normalized_answers
        if "id" not in normalized_q:
            normalized_q["id"] = q_idx
        normalized_questions.append(normalized_q)

    return normalized_questions, ("multiple_choice" if has_multiple_correct else "single_choice")


def _format_task_preview(
    task: Dict[str, Any], index: int, validation_issues: List[Dict]
) -> Dict[str, Any]:
    """Format task for preview response."""
    task_type = task.get("type", "unknown")

    # Determine status based on validation issues
    has_errors = any(issue.get("severity") == "error" for issue in validation_issues)
    has_warnings = any(issue.get("severity") == "warning" for issue in validation_issues)

    if has_errors:
        status = "error"
    elif has_warnings:
        status = "warning"
    else:
        status = "valid"

    # Keep full task payload in preview so execute step can save without data loss.
    raw_data = task.get("data", {})
    if not isinstance(raw_data, dict):
        raw_data = {}
    preview_data = (
        _normalize_click_import_data(raw_data) if task_type == "click" else dict(raw_data)
    )
    if not preview_data.get("prompt"):
        preview_data["prompt"] = task.get("prompt", "")

    if task_type == "sequence_assembly":
        elements = preview_data.get("elements", {})
        levels = preview_data.get("levels", {})
        preview_data["elements_count"] = len(elements) if hasattr(elements, "__len__") else 0
        preview_data["levels_count"] = len(levels) if hasattr(levels, "__len__") else 0
    elif task_type == "click":
        mode = preview_data.get("mode", "")
        if mode == "text_choice":
            options = preview_data.get("options", [])
            preview_data["options_count"] = len(options) if isinstance(options, list) else 0
            preview_data["correct_count"] = sum(
                1
                for opt in (options if isinstance(options, list) else [])
                if isinstance(opt, dict) and bool(opt.get("is_correct", opt.get("correct", False)))
            )
            preview_data["mode"] = "text_choice"
        elif mode in ("text_errors", "word_errors"):
            spans = preview_data.get("error_spans", [])
            indices = preview_data.get("error_indices", [])
            preview_data["text_length"] = len(str(preview_data.get("text", "")))
            preview_data["error_count"] = (
                len(spans)
                if isinstance(spans, list) and spans
                else (len(indices) if isinstance(indices, list) else 0)
            )
            preview_data["mode"] = "text_errors"
    elif task_type == "test":
        questions = preview_data.get("questions", [])
        preview_data["question_count"] = len(questions) if isinstance(questions, list) else 0

    return {
        "index": index,
        "type": task_type,
        "name": task.get("name", f"Task #{index + 1}"),
        "status": status,
        "data": preview_data,
        "validation": {"issues": validation_issues},
    }


def _generate_unique_task_ids(
    storage_service: Any, module_id: str, topic_id: str, count: int
) -> List[str]:
    """Generate `count` unique task IDs in one batch (O(1) calls to storage)."""
    import uuid

    existing_tasks = storage_service.get_tasks(module_id, topic_id)
    existing_ids = {t.get("id") for t in existing_tasks}
    ids: List[str] = []
    while len(ids) < count:
        task_id = f"task_{uuid.uuid4().hex[:12]}"
        if task_id not in existing_ids:
            existing_ids.add(task_id)
            ids.append(task_id)
    return ids


def _build_imported_task_payload(
    task: Dict[str, Any],
    module_id: str,
    topic_id: str,
    task_id: str,
    import_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build canonical task payload for imported task persistence."""
    h = _ih()
    import_context = import_context if isinstance(import_context, dict) else {}
    import_source = str(import_context.get("source") or "text").strip().lower() or "text"
    ai_run_id = str(import_context.get("ai_run_id") or "").strip() or None

    now_iso = datetime.now().isoformat()
    task_json_data = {
        "id": task_id,
        "name": task.get("name", task_id),
        "type": task.get("type", "unknown"),
        "description": "",
        "meta": {
            "created_at": now_iso,
            "imported": True,
            "import_date": now_iso,
            "import_source": import_source,
            "created_via": f"{import_source}_import",
            "content_scope": "shared_local",
            "module": module_id,
            "topic": topic_id,
            "id": task_id,
            "name": task.get("name", task_id),
            "task_schema_version": h["CURRENT_SCHEMA_VERSION"],
        },
    }

    # Merge parser-provided metadata into meta/content
    task_metadata = task.get("data", {}).get("metadata", {})
    if task_metadata:
        if "difficulty" in task_metadata:
            task_json_data["meta"]["difficulty"] = task_metadata["difficulty"]
        if "tags" in task_metadata:
            task_json_data["meta"]["tags"] = task_metadata["tags"]
        for extra_key in ("max_length", "time_limit", "case_sensitive"):
            if extra_key in task_metadata:
                task_json_data["meta"][extra_key] = task_metadata[extra_key]
        for passthrough_key in ("language", "source_file_name"):
            if passthrough_key in task_metadata and passthrough_key not in task_json_data["meta"]:
                task_json_data["meta"][passthrough_key] = task_metadata[passthrough_key]

    if ai_run_id:
        task_json_data["meta"]["ai_run_id"] = ai_run_id
    ai_provider = import_context.get("ai_provider")
    if ai_provider:
        task_json_data["meta"]["ai_provider"] = ai_provider
    ai_model = import_context.get("ai_model")
    if ai_model:
        task_json_data["meta"]["ai_model"] = ai_model
    source_file_info = import_context.get("source_file_info")
    if isinstance(source_file_info, dict):
        source_file_name = source_file_info.get("name") or source_file_info.get("filename")
        if source_file_name:
            task_json_data["meta"]["source_file_name"] = source_file_name
    source_file_name = import_context.get("source_file_name")
    if source_file_name and not task_json_data["meta"].get("source_file_name"):
        task_json_data["meta"]["source_file_name"] = source_file_name
    analysis_session_id = str(import_context.get("analysis_session_id") or "").strip()
    if analysis_session_id:
        task_json_data["meta"]["analysis_session_id"] = analysis_session_id
    analysis_selected_task_type = str(import_context.get("analysis_selected_task_type") or "").strip().upper()
    if analysis_selected_task_type:
        task_json_data["meta"]["analysis_selected_task_type"] = analysis_selected_task_type
    analysis_selected_units = import_context.get("analysis_selected_units")
    if isinstance(analysis_selected_units, list):
        normalized_unit_ids = []
        for unit_id in analysis_selected_units:
            try:
                normalized_unit_ids.append(int(unit_id))
            except (TypeError, ValueError):
                continue
        if normalized_unit_ids:
            task_json_data["meta"]["analysis_selected_unit_ids"] = normalized_unit_ids
    analysis_generation_focus = str(import_context.get("analysis_generation_focus") or "").strip()
    if analysis_generation_focus:
        task_json_data["meta"]["analysis_generation_focus"] = analysis_generation_focus
    analysis_coverage_role = str(import_context.get("analysis_coverage_role") or "").strip()
    if analysis_coverage_role:
        task_json_data["meta"]["analysis_coverage_role"] = analysis_coverage_role

    task_ai_meta = task.get("ai_meta")
    if isinstance(task_ai_meta, dict):
        unit_ids = task_ai_meta.get("educational_unit_ids")
        if isinstance(unit_ids, list) and unit_ids:
            task_json_data["meta"]["educational_unit_ids"] = list(unit_ids)
        source_grounding = task_ai_meta.get("source_grounding")
        if isinstance(source_grounding, dict):
            grounded_meta = {}
            if source_grounding.get("primary_unit_id") is not None:
                grounded_meta["primary_unit_id"] = source_grounding.get("primary_unit_id")
            if source_grounding.get("primary_unit_title"):
                grounded_meta["primary_unit_title"] = source_grounding.get("primary_unit_title")
            if isinstance(source_grounding.get("score"), (int, float)):
                grounded_meta["score"] = float(source_grounding.get("score"))
            if isinstance(source_grounding.get("shared_token_count"), int):
                grounded_meta["shared_token_count"] = int(source_grounding.get("shared_token_count"))
            if isinstance(source_grounding.get("shared_number_count"), int):
                grounded_meta["shared_number_count"] = int(source_grounding.get("shared_number_count"))
            if isinstance(source_grounding.get("weak"), bool):
                grounded_meta["weak"] = bool(source_grounding.get("weak"))
            if grounded_meta:
                task_json_data["meta"]["source_grounding"] = grounded_meta
        if task_ai_meta.get("provider_used") and not task_json_data["meta"].get("ai_provider"):
            task_json_data["meta"]["ai_provider"] = task_ai_meta.get("provider_used")
        if task_ai_meta.get("run_id") and not task_json_data["meta"].get("ai_run_id"):
            task_json_data["meta"]["ai_run_id"] = task_ai_meta.get("run_id")

    # Add type-specific data
    if task.get("type") == "open_answer":
            oa_data = task.get("data", {})
            oa_content = {
                "question": oa_data.get("question", task.get("prompt", "")),
                "prompt": oa_data.get("question", task.get("prompt", "")),
            }
            if oa_data.get("keywords"):
                oa_content["keywords"] = oa_data["keywords"]
            if oa_data.get("reference_answer"):
                oa_content["reference_answer"] = oa_data["reference_answer"]
            if oa_data.get("max_length"):
                oa_content["max_length"] = oa_data["max_length"]
            if isinstance(oa_data.get("min_keywords"), int):
                oa_content["min_keywords"] = oa_data["min_keywords"]
            if isinstance(oa_data.get("require_all_keywords"), bool):
                oa_content["require_all_keywords"] = oa_data["require_all_keywords"]
            task_json_data["content"] = oa_content
    elif task.get("type") == "sequence_assembly":
            data = task.get("data", {})
            elements_map = data.get("elements", {}) if isinstance(data.get("elements"), dict) else {}
            raw_levels = data.get("levels", {}) if isinstance(data.get("levels"), dict) else {}
            sorted_level_keys = sorted(raw_levels.keys(), key=lambda k: int(k))

            canonical_elements = [
                {
                    "id": str(element_id),
                    "text": str(element_text or ""),
                }
                for element_id, element_text in elements_map.items()
            ]

            canonical_levels = []
            legacy_sequence = []
            level_blocks_for_flags: List[List[str]] = []
            for level_num in sorted_level_keys:
                level_id = f"level_{level_num}"
                level_elements = [str(element_id) for element_id in raw_levels.get(level_num, []) if element_id]
                level_items = []
                for element_id in level_elements:
                    element_text = elements_map.get(element_id, element_id)
                    level_items.append({"id": element_id, "label": str(element_text or "")})
                canonical_levels.append(
                    {
                        "level_id": level_id,
                        "blocks": level_elements,
                        "level_name": f"Level {level_num}",
                    }
                )
                legacy_sequence.append(
                    {
                        "level_id": level_id,
                        "title": f"Level {level_num}",
                        "items": level_items,
                    }
                )
                level_blocks_for_flags.append(level_elements)

            sequence_within_level_matters, level_order_matters = _infer_imported_sequence_flags(
                task.get("prompt", ""),
                level_blocks_for_flags,
                task_metadata,
            )

            task_json_data["content"] = {
                "prompt": task.get("prompt", ""),
                "elements": canonical_elements,
                "levels": canonical_levels,
                "sequence": legacy_sequence,
                "sequence_within_level_matters": sequence_within_level_matters,
                "level_order_matters": level_order_matters,
                "order_inside_matters": sequence_within_level_matters,
            }
    elif task.get("type") == "click":
            data = _normalize_click_import_data(task.get("data", {}))
            task_json_data["subtype"] = data.get("subtype", "error_detection")

            if data.get("mode") == "text_choice":
                task_json_data["content"] = {
                    "prompt": task.get("prompt", ""),
                    "mode": "text_choice",
                    "subtype": "error_detection",
                    "options": data.get("options", []),
                }
            elif data.get("mode") == "text_errors":
                content = {
                    "prompt": task.get("prompt", ""),
                    "mode": "text_errors",
                    "subtype": "error_detection",
                    "text": data.get("text", ""),
                    "error_spans": data.get("error_spans", []),
                }
                if isinstance(data.get("required_correct"), int):
                    content["required_correct"] = data.get("required_correct")
                if isinstance(data.get("reference_text"), str):
                    content["reference_text"] = data.get("reference_text")
                if isinstance(data.get("reference_spans"), list):
                    content["reference_spans"] = data.get("reference_spans")
                task_json_data["content"] = content
            else:
                raise ValueError(f"Unsupported click import mode: {data.get('mode')}")
    elif task.get("type") == "test":
            data = task.get("data", {})
            questions, inferred_test_type = _canonicalize_test_questions(data.get("questions", []))
            requested_test_type = str(data.get("test_type") or "").strip()
            if requested_test_type in {"single_choice", "multiple_choice"}:
                test_type = (
                    "multiple_choice"
                    if inferred_test_type == "multiple_choice" or requested_test_type == "multiple_choice"
                    else "single_choice"
                )
            else:
                test_type = inferred_test_type
            task_json_data["content"] = {
                "test_type": test_type,
                "questions": questions,
                "settings": data.get(
                    "settings",
                    {
                        "shuffle_questions": True,
                        "shuffle_answers": True,
                        "time_limit": None,
                        "passing_score": 70,
                    },
                ),
            }

    return task_json_data


def _save_task_to_storage(
    task: Dict[str, Any],
    module_id: str,
    topic_id: str,
    task_id: str,
    storage_service: Any,
    import_context: Optional[Dict[str, Any]] = None,
) -> bool:
    """Persist imported task through the active storage service."""
    task_json_data = _build_imported_task_payload(
        task,
        module_id,
        topic_id,
        task_id,
        import_context=import_context,
    )
    success = storage_service.save_task(
        module_id,
        topic_id,
        task_id,
        task_json_data,
        validate=False,
    )
    if success:
        logger.info(f"[HTTP] Saved imported task: {module_id}/{topic_id}/{task_id}")
    return bool(success)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@import_bp.route("/api/editor/tasks/delete", methods=["POST"])
def delete_editor_tasks() -> Any:
    """Delete tasks from the editor."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.get_json(silent=True) or {}
        tasks = payload.get("tasks", [])

        if not tasks:
            return jsonify({"ok": False, "error": "no_tasks_provided"}), 400

        deleted_count = 0
        errors = []

        for task_info in tasks:
            module_id = task_info.get("module_id")
            topic_id = task_info.get("topic_id")
            task_id = task_info.get("task_id")

            if not module_id or not topic_id or not task_id:
                errors.append(f"Invalid task data: {task_info}")
                continue

            success = ctx.storage_service.delete_task(module_id, topic_id, task_id)
            if success:
                deleted_count += 1
            else:
                errors.append(f"Failed to delete {task_id}")

        return jsonify({"ok": True, "deleted": deleted_count, "errors": errors})

    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to delete tasks: %s", exc)
        return jsonify({"ok": False, "error": "delete_failed"}), 500


@import_bp.route("/api/editor/export/text", methods=["POST"])
def export_tasks_to_text() -> Any:
    """Export selected tasks back to marker text format."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_export"}), 403
    payload = request.get_json(silent=True) or {}
    task_refs = payload.get("tasks", [])
    if not task_refs:
        return jsonify({"ok": False, "error": "no_tasks"}), 400
    storage = ctx.storage_service
    lines: List[str] = []

    try:
        _assert_export_task_refs_not_archived(ctx, task_refs, action="export")
    except PremiumArchivedContentError as exc:
        return _premium_archive_response(exc)

    for ref in task_refs:
        mid = ref.get("module_id")
        tid = ref.get("topic_id")
        task_id = ref.get("task_id")
        if not mid or not tid or not task_id:
            continue
        try:
            loaded_task = storage.load_task(mid, tid, task_id)
        except Exception as exc:
            degraded_response = _maybe_hosted_shadow_write_error_response(
                exc,
                extra_payload={
                    "route_contract": _public_import_route_contract(
                        mode="export_text",
                        import_family="text_task_export",
                    ),
                },
            )
            if degraded_response is not None:
                return degraded_response
            logger.exception("[HTTP] Failed to export task %s/%s/%s: %s", mid, tid, task_id, exc)
            return jsonify({"ok": False, "error": "export_failed"}), 500
        if not isinstance(loaded_task, dict):
            continue
        td = loaded_task.get("task_data")
        if not isinstance(td, dict):
            continue

        ttype = td.get("type", "")
        content = td.get("content", {})
        if not isinstance(content, dict):
            continue

        if ttype == "open_answer":
            lines.append("@OPEN_ANSWER")
            lines.append(f"# {content.get('question', content.get('prompt', ''))}")
            if content.get("reference_answer"):
                lines.append(f"= {content['reference_answer']}")
            for kw in content.get("keywords", []):
                lines.append(f"* {kw}")
            lines.append("")
        elif ttype == "sequence_assembly":
            lines.append("@SEQUENCE")
            lines.append(f"# {content.get('prompt', '')}")
            seq = content.get("sequence", [])
            elem_idx = 1
            for level in seq:
                for item in level.get("items", []):
                    lines.append(f"element_{elem_idx}: {item.get('label', '')}")
                    elem_idx += 1
            level_idx = 1
            elem_counter = 1
            for level in seq:
                ids = []
                for item in level.get("items", []):
                    ids.append(f"element_{elem_counter}")
                    elem_counter += 1
                lines.append(f"level_{level_idx}: {', '.join(ids)}")
                level_idx += 1
            lines.append("")
        elif ttype == "image_labeling":
            lines.append("@IMAGE_LABELING")
            lines.append(f"# {content.get('prompt', '')}")
            img_val = content.get("image")
            img_path = img_val.get("path") if isinstance(img_val, dict) else img_val
            if img_path:
                lines.append(f"image: {img_path}")
            for idx, zone in enumerate(content.get("zones", [])):
                lines.append(f"zone_{idx + 1}: {zone.get('label', '')} ({zone.get('rect', {})})")
            lines.append("")
        elif ttype == "click":
            mode = content.get("mode", "")
            if mode == "text_choice":
                lines.append("@CLICK_TEXT")
                lines.append(f"# {content.get('prompt', '')}")
                for opt in content.get("options", []):
                    prefix = "+" if opt.get("is_correct") else "-"
                    lines.append(f"{prefix} {opt.get('text', '')}")
                lines.append("")
            elif mode in ("text_errors", "word_errors"):
                lines.append("@CLICK_WORDS")
                lines.append(f"# {content.get('prompt', '')}")
                raw_text = content.get("text", "")
                error_spans = content.get("error_spans", [])
                if error_spans and isinstance(error_spans, list):
                    # Rebuild text with [brackets] around error spans (sorted desc to preserve offsets)
                    sorted_spans = sorted(
                        [
                            s
                            for s in error_spans
                            if isinstance(s, dict)
                            and isinstance(s.get("start"), int)
                            and isinstance(s.get("end"), int)
                        ],
                        key=lambda s: s["start"],
                        reverse=True,
                    )
                    marked = raw_text
                    for span in sorted_spans:
                        start, end = span["start"], span["end"]
                        if 0 <= start < end <= len(marked):
                            marked = marked[:start] + "[" + marked[start:end] + "]" + marked[end:]
                    lines.append(marked)
                else:
                    lines.append(raw_text)
                lines.append("")
            else:
                # Unsupported click mode (e.g. draw) — skip with comment
                logger.warning(
                    f"[export/text] Skipping unsupported click mode: {mode} for task {task_id}"
                )
                lines.append(f"# [Пропущено: неподдерживаемый режим click — {mode}]")
                lines.append("")
        elif ttype == "test":
            lines.append("@TEST")
            if content.get("prompt"):
                lines.append(f"# {content['prompt']}")
            for q in content.get("questions", []):
                lines.append(f"? {q.get('text', '')}")
                for a in q.get("answers", []):
                    prefix = "+" if a.get("is_correct", a.get("correct")) else "-"
                    lines.append(f"{prefix} {a.get('text', '')}")
                lines.append("")

    return jsonify(
        _with_public_import_route_contract(
            {"ok": True, "text": "\n".join(lines)},
            mode="export_text",
            import_family="text_task_export",
        )
    )


@import_bp.route("/api/editor/modules/delete", methods=["POST"])
def delete_editor_module() -> Any:
    """Delete a module via editor."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.get_json(silent=True) or {}
        module_id = payload.get("module_id")

        if not module_id:
            return jsonify({"ok": False, "error": "module_id_required"}), 400

        success = ctx.storage_service.delete_module(module_id)
        if success:
            return jsonify({"ok": True})
        else:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": "module_delete_failed",
                        "message": "Module not found or could not be deleted",
                    }
                ),
                404,
            )

    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to delete module %s: %s", payload.get("module_id"), exc)
        return jsonify({"ok": False, "error": "delete_failed"}), 500


@import_bp.route("/api/editor/topics/delete", methods=["POST"])
def delete_editor_topic() -> Any:
    """Delete a topic via editor."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.get_json(silent=True) or {}
        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")

        if not module_id or not topic_id:
            return jsonify({"ok": False, "error": "module_id_and_topic_id_required"}), 400

        success = ctx.storage_service.delete_topic(module_id, topic_id)
        if success:
            return jsonify({"ok": True})
        else:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": "topic_delete_failed",
                        "message": "Topic not found or could not be deleted",
                    }
                ),
                404,
            )

    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception(
            "[HTTP] Failed to delete topic %s/%s: %s",
            payload.get("module_id"),
            payload.get("topic_id"),
            exc,
        )
        return jsonify({"ok": False, "error": "delete_failed"}), 500


@import_bp.route("/api/editor/module/rename", methods=["POST"])
def rename_editor_module() -> Any:
    """Rename a module (change display name, keep folder ID)."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.get_json(silent=True) or {}
        module_id = payload.get("module_id")
        new_name = payload.get("name", "").strip()

        if not module_id or not new_name:
            return jsonify({"ok": False, "error": "module_id_and_name_required"}), 400

        success = ctx.storage_service.rename_module(module_id, new_name)
        if success:
            return jsonify({"ok": True})
        else:
            return jsonify({"ok": False, "error": "rename_failed"}), 404
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to rename module %s: %s", payload.get("module_id"), exc)
        return jsonify({"ok": False, "error": "rename_failed"}), 500


@import_bp.route("/api/editor/topic/rename", methods=["POST"])
def rename_editor_topic() -> Any:
    """Rename a topic (change display name, keep folder ID)."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.get_json(silent=True) or {}
        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")
        new_name = payload.get("name", "").strip()

        if not module_id or not topic_id or not new_name:
            return jsonify({"ok": False, "error": "module_id_topic_id_and_name_required"}), 400

        success = ctx.storage_service.rename_topic(module_id, topic_id, new_name)
        if success:
            return jsonify({"ok": True})
        else:
            return jsonify({"ok": False, "error": "rename_failed"}), 404
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception(
            "[HTTP] Failed to rename topic %s/%s: %s",
            payload.get("module_id"),
            payload.get("topic_id"),
            exc,
        )
        return jsonify({"ok": False, "error": "rename_failed"}), 500


@import_bp.route("/api/editor/import/parse", methods=["POST"])
def import_parse() -> Any:
    """Parse text with tasks and return preview."""
    ctx = get_ctx()
    h = _ih()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403
    if not h["PARSERS_AVAILABLE"]:
        return jsonify({"ok": False, "error": "parsers_not_available"}), 500

    payload = request.get_json(silent=True) or {}

    try:
        workspace_markers = _workspace_import_markers_in_payload(payload)
        if workspace_markers:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": f"workspace_import_payload_not_supported:{','.join(workspace_markers)}",
                        "route_contract": _public_import_route_contract(
                            mode="parse",
                            import_family="text_task_import",
                        ),
                    }
                ),
                400,
            )

        # Validate payload
        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")
        text = payload.get("text", "")

        if not module_id or not topic_id:
            return jsonify({"ok": False, "error": "module_id_and_topic_id_required"}), 400

        if not text or not isinstance(text, str):
            return jsonify({"ok": False, "error": "text_required"}), 400

        # Detect markers and parse
        all_tasks = []
        all_parsing_errors = []
        marker_counts = {}
        all_warnings = []  # (global_index, warning_dict)
        supported_markers = ("@OPEN_ANSWER", "@SEQUENCE", "@CLICK_TEXT", "@CLICK_WORDS", "@TEST")
        excluded_markers = ("@DRAW",)

        def _has_marker_line(raw_text: str, marker: str) -> bool:
            pattern = rf"(?mi)^\s*{re.escape(marker)}(?:\s|$)"
            return re.search(pattern, raw_text) is not None

        found_excluded = [marker for marker in excluded_markers if _has_marker_line(text, marker)]
        if found_excluded:
            all_parsing_errors.append(
                "Маркеры "
                + ", ".join(found_excluded)
                + " не поддерживаются в текстовом импорте. "
                + "Используйте только: "
                + ", ".join(supported_markers)
                + "."
            )

        # Try each parser
        OpenAnswerParser = h["OpenAnswerParser"]
        SequenceParser = h["SequenceParser"]
        ClickTextParser = h["ClickTextParser"]
        ClickWordsParser = h["ClickWordsParser"]
        TestImportParser = h["TestImportParser"]

        parsers = [
            ("@OPEN_ANSWER", OpenAnswerParser()),
            ("@SEQUENCE", SequenceParser()),
            ("@CLICK_TEXT", ClickTextParser()),
            ("@CLICK_WORDS", ClickWordsParser()),
            ("@TEST", TestImportParser()),
        ]

        for marker, parser in parsers:
            if _has_marker_line(text, marker):
                try:
                    global_offset = len(all_tasks)
                    tasks = parser.parse_text(text)
                    all_tasks.extend(tasks)

                    # Track counts by type
                    for task in tasks:
                        task_type = task.get("type", "unknown")
                        marker_counts[task_type] = marker_counts.get(task_type, 0) + 1

                    # Collect warnings with corrected global indices
                    for warning in parser.warnings:
                        local_idx = warning.get("index", 0)
                        all_warnings.append((global_offset + local_idx, warning))

                    # Collect parsing errors
                    if parser.errors:
                        all_parsing_errors.extend(parser.errors)

                except Exception as parse_exc:
                    logger.exception(f"[HTTP] Parser {marker} failed: {parse_exc}")
                    all_parsing_errors.append(f"Parser {marker} error: {str(parse_exc)}")

        # Validate tasks and build preview
        preview_tasks = []
        valid_count = 0
        warning_count = 0
        error_count = 0

        for i, task in enumerate(all_tasks):
            task_type = task.get("type")
            task_data = task.get("data", {})

            # Add parser-level validation issues (using corrected global indices)
            validation_issues = []
            for global_idx, warning in all_warnings:
                if global_idx == i:
                    validation_issues.append(
                        {
                            "severity": warning.get("severity", "warning"),
                            "message": warning.get("message", ""),
                            "field": warning.get("code", "unknown"),
                        }
                    )

            # Validate using TaskType validators
            try:
                validator_issues = h["validate_with_task_type"](task_type, task_data)
                validation_issues.extend(validator_issues)
            except Exception as e:
                logging.error(f"[Import Parse] Validation error for task {i}: {str(e)}")
                validation_issues.append(
                    {
                        "severity": "error",
                        "message": f"Validation failed: {str(e)}",
                        "field": "general",
                    }
                )

            # Format preview
            preview = _format_task_preview(task, i, validation_issues)
            preview_tasks.append(preview)

            # Update counts
            if preview["status"] == "error":
                error_count += 1
            elif preview["status"] == "warning":
                warning_count += 1
            else:
                valid_count += 1

        # Build summary
        summary = {
            "total": len(all_tasks),
            "valid": valid_count,
            "warnings": warning_count,
            "errors": error_count,
            "by_type": marker_counts,
        }

        # Build response
        response = {
            "ok": True,
            "summary": summary,
            "tasks": preview_tasks,
            "parsing_errors": all_parsing_errors,
            "notes": [],
        }
        response["notes"].append(
            "В текстовом импорте активны маркеры: @OPEN_ANSWER, @SEQUENCE, @CLICK_TEXT, @CLICK_WORDS, @TEST. "
            "Клик поддерживается только для подтипа Ошибки (error_detection). "
            "Рисование (@DRAW) и координатные/полигональные click-задачи не поддерживаются."
        )
        # MISSING-6: Warn about image limitation in text import
        if all_tasks:
            response["notes"].append(
                "Текстовый импорт не поддерживает изображения. "
                "Для задач с изображениями используйте импорт из ZIP-архива."
            )

        logger.info(
            "[HTTP] import/parse: module=%s topic=%s total=%s valid=%s warnings=%s errors=%s",
            module_id,
            topic_id,
            summary["total"],
            summary["valid"],
            summary["warnings"],
            summary["errors"],
        )

        return jsonify(
            _with_public_import_route_contract(
                response,
                mode="parse",
                import_family="text_task_import",
            )
        )

    except Exception as exc:
        logger.exception("[HTTP] Failed to parse import text: %s", exc)
        return jsonify({"ok": False, "error": "parse_failed"}), 500


@import_bp.route("/api/editor/import/parse-analysis", methods=["POST"])
def import_parse_analysis() -> Any:
    """Parse external AI material-analysis response and return normalized recommendations."""
    ctx = get_ctx()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403

    payload = request.get_json(silent=True) or {}
    text = payload.get("text", "")
    if not text or not isinstance(text, str):
        return jsonify({"ok": False, "error": "text_required"}), 400

    try:
        response = _parse_imported_analysis_response(text)
        logger.info(
            "[HTTP] import/parse-analysis: units=%s recommendations=%s",
            len(response.get("educational_units") or []),
            len(response.get("recommendations") or []),
        )
        return jsonify(
            _with_public_import_route_contract(
                response,
                mode="parse",
                import_family="manual_material_analysis",
            )
        )
    except Exception as exc:
        logger.warning("[HTTP] Failed to parse imported analysis response: %s", exc)
        return jsonify(
            _with_public_import_route_contract(
                {
                    "ok": False,
                    "error": "analysis_parse_failed",
                    "message": str(exc) or "analysis_parse_failed",
                },
                mode="parse",
                import_family="manual_material_analysis",
            )
        ), 400


@import_bp.route("/api/editor/import/execute", methods=["POST"])
def import_execute() -> Any:
    """Execute import - save parsed tasks to storage."""
    ctx = get_ctx()
    h = _ih()
    if ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403
    if not h["PARSERS_AVAILABLE"]:
        return jsonify({"ok": False, "error": "parsers_not_available"}), 500

    payload = request.get_json(silent=True) or {}

    try:
        workspace_markers = _workspace_import_markers_in_payload(payload)
        if workspace_markers:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": f"workspace_import_payload_not_supported:{','.join(workspace_markers)}",
                        "route_contract": _public_import_route_contract(
                            mode="execute",
                            import_family="text_task_import",
                        ),
                    }
                ),
                400,
            )
        # Validate payload
        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")
        tasks = payload.get("tasks", [])
        import_context = payload.get("import_context", {})
        if not isinstance(import_context, dict):
            import_context = {}
        idempotency_key = str(payload.get("idempotency_key") or "").strip()

        if not module_id or not topic_id:
            return jsonify({"ok": False, "error": "module_id_and_topic_id_required"}), 400

        if not isinstance(tasks, list) or not tasks:
            return jsonify({"ok": False, "error": "tasks_required"}), 400

        request_fingerprint = h["stable_json_hash"](
            {
                "module_id": module_id,
                "topic_id": topic_id,
                "tasks": [h["extract_task_preview_signature"](t) for t in tasks],
                "import_context": {
                    "source": import_context.get("source"),
                    "ai_run_id": import_context.get("ai_run_id"),
                },
            }
        )
        cached_response = _import_idempotency_reserve(idempotency_key, request_fingerprint)
        if cached_response:
            if cached_response.get("conflict"):
                return jsonify({"ok": False, "error": "idempotency_key_conflict"}), 409
            if cached_response.get("in_progress"):
                return jsonify({"ok": False, "error": "idempotency_key_in_progress"}), 409
            logger.info(
                "[HTTP] import/execute idempotent replay: module=%s topic=%s key=%s",
                module_id,
                topic_id,
                idempotency_key,
            )
            return jsonify(
                _with_public_import_route_contract(
                    cached_response,
                    mode="execute",
                    import_family="text_task_import",
                )
            )

        # Validate module and topic exist
        storage_service = ctx.storage_service
        module = storage_service.get_module(module_id)
        if not module:
            _import_idempotency_release(idempotency_key, request_fingerprint)
            return jsonify({"ok": False, "error": "module_not_found"}), 400

        topic = storage_service.get_topic(module_id, topic_id)
        if not topic:
            _import_idempotency_release(idempotency_key, request_fingerprint)
            return jsonify({"ok": False, "error": "topic_not_found"}), 400

        # Filter importable tasks
        importable_tasks = [
            (i, task) for i, task in enumerate(tasks) if task.get("status", "unknown") != "error"
        ]

        # Batch-generate unique IDs
        task_ids = _generate_unique_task_ids(
            storage_service, module_id, topic_id, len(importable_tasks)
        )

        imported_ids = []
        errors = []
        rollback_task_ids = []

        for idx, (i, task) in enumerate(importable_tasks):
            try:
                task_id = task_ids[idx]

                # Reconstruct full task from preview
                full_task = {
                    "name": task.get("name", f"Task #{i + 1}"),
                    "type": task.get("type", "unknown"),
                    "prompt": task.get("data", {}).get("prompt", ""),
                    "data": task.get("data", {}),
                }
                if isinstance(task.get("ai_meta"), dict):
                    full_task["ai_meta"] = task.get("ai_meta")

                # Save to storage
                success = _save_task_to_storage(
                    full_task,
                    module_id,
                    topic_id,
                    task_id,
                    storage_service,
                    import_context=import_context,
                )

                if success:
                    imported_ids.append(task_id)
                    rollback_task_ids.append(task_id)
                else:
                    errors.append(f"Failed to save task {i}")
                    for rollback_task_id in rollback_task_ids:
                        try:
                            storage_service.delete_task(module_id, topic_id, rollback_task_id)
                        except Exception:
                            logger.exception(
                                "[HTTP] Failed to rollback imported task %s/%s/%s",
                                module_id,
                                topic_id,
                                rollback_task_id,
                            )
                    imported_ids.clear()
                    break

            except Exception as task_exc:
                degraded_response = _maybe_hosted_shadow_write_error_response(
                    task_exc,
                    extra_payload={
                        "route_contract": _public_import_route_contract(
                            mode="execute",
                            import_family="text_task_import",
                        ),
                    },
                )
                if degraded_response is not None:
                    return degraded_response
                logger.exception(f"[HTTP] Failed to import task {i}: {task_exc}")
                errors.append(f"Task {i}: {str(task_exc)}")
                for rollback_task_id in rollback_task_ids:
                    try:
                        storage_service.delete_task(module_id, topic_id, rollback_task_id)
                    except Exception:
                        logger.exception(
                            "[HTTP] Failed to rollback imported task %s/%s/%s",
                            module_id,
                            topic_id,
                            rollback_task_id,
                        )
                imported_ids.clear()
                break

        # Reload modules cache to pick up new tasks
        storage_service.reload_modules()

        response = {
            "ok": True,
            "imported": len(imported_ids),
            "task_ids": imported_ids,
            "errors": errors,
        }
        if idempotency_key:
            response["idempotency_key"] = idempotency_key
        response = _with_public_import_route_contract(
            response,
            mode="execute",
            import_family="text_task_import",
        )
        _import_idempotency_store(idempotency_key, request_fingerprint, response)

        ai_run_id = str(import_context.get("ai_run_id") or "").strip()
        if ai_run_id:
            try:
                h["ai_run_write_artifact"](
                    ai_run_id,
                    "import",
                    {
                        "run_id": ai_run_id,
                        "created_at": h["utc_now_iso"](),
                        "module_id": module_id,
                        "topic_id": topic_id,
                        "imported_count": len(imported_ids),
                        "task_ids": imported_ids,
                        "errors": errors,
                        "idempotency_key": idempotency_key or None,
                        "source_context": {
                            "source": import_context.get("source"),
                            "ai_provider": import_context.get("ai_provider"),
                            "source_file_name": (
                                import_context.get("source_file_name")
                                or (import_context.get("source_file_info") or {}).get("name")
                                or (import_context.get("source_file_info") or {}).get("filename")
                            ),
                        },
                    },
                )
                h["ai_run_merge_manifest"](
                    ai_run_id,
                    {
                        "import_completed_at": h["utc_now_iso"](),
                        "imported_count": len(imported_ids),
                        "module_id": module_id,
                        "topic_id": topic_id,
                    },
                )
            except Exception:
                logger.exception("[HTTP] Failed to persist ai-run import artifact: %s", ai_run_id)

        logger.info(
            "[HTTP] import/execute: module=%s topic=%s imported=%s errors=%s",
            module_id,
            topic_id,
            len(imported_ids),
            len(errors),
        )

        return jsonify(response)

    except Exception as exc:
        try:
            _import_idempotency_release(
                str((payload or {}).get("idempotency_key") or "").strip(),
                locals().get("request_fingerprint", ""),
            )
        except Exception:
            pass
        degraded_response = _maybe_hosted_shadow_write_error_response(
            exc,
            extra_payload={
                "route_contract": _public_import_route_contract(
                    mode="execute",
                    import_family="text_task_import",
                ),
            },
        )
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to execute import: %s", exc)
        return jsonify({"ok": False, "error": "import_failed"}), 500
