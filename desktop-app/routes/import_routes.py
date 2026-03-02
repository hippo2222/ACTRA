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
import json
import logging
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from flask import Blueprint, jsonify, request

from routes._context import get_ctx, get_extra

logger = logging.getLogger(__name__)

import_bp = Blueprint("import", __name__)


# ---------------------------------------------------------------------------
# Helper accessor
# ---------------------------------------------------------------------------

def _ih() -> Dict[str, Any]:
    """Return the import helpers dict registered by server.py."""
    return get_extra("import_helpers")


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


def _save_task_to_storage(
    task: Dict[str, Any],
    module_id: str,
    topic_id: str,
    task_id: str,
    modules_dir: Path,
    import_context: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Save task to file system.

    Args:
        task: Task data to save
        module_id: Module ID
        topic_id: Topic ID
        task_id: Task ID
        data_dir: Data directory path

    Returns:
        True if successful, False otherwise
    """
    h = _ih()
    try:
        import_context = import_context if isinstance(import_context, dict) else {}
        import_source = str(import_context.get("source") or "text").strip().lower() or "text"
        ai_run_id = str(import_context.get("ai_run_id") or "").strip() or None

        # Create task directory
        task_dir = modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        task_dir.mkdir(parents=True, exist_ok=True)

        # Prepare task.json data
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
            # Convert to editor format
            sequence = []
            levels = data.get("levels", {})
            for level_num in sorted(levels.keys(), key=lambda k: int(k)):
                level_elements = levels[level_num]
                level_items = []
                for element_id in level_elements:
                    element_text = data.get("elements", {}).get(element_id, element_id)
                    level_items.append({"id": element_id, "label": element_text})
                sequence.append(
                    {
                        "id": f"level_{level_num}",
                        "title": f"Level {level_num}",
                        "items": level_items,
                    }
                )

            task_json_data["content"] = {
                "prompt": task.get("prompt", ""),
                "sequence": sequence,
                "order_inside_matters": True,
                "level_order_matters": True,
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

        # Save task.json
        task_json_path = task_dir / "task.json"
        with open(task_json_path, "w", encoding="utf-8") as f:
            json.dump(task_json_data, f, indent=2, ensure_ascii=False)

        logger.info(f"[HTTP] Saved imported task: {module_id}/{topic_id}/{task_id}")
        return True

    except Exception as exc:
        logger.exception(f"[HTTP] Failed to save task {task_id}: {exc}")
        return False


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

    for ref in task_refs:
        mid = ref.get("module_id")
        tid = ref.get("topic_id")
        task_id = ref.get("task_id")
        if not mid or not tid or not task_id:
            continue
        task_path = storage.modules_dir / mid / "topics" / tid / "tasks" / task_id / "task.json"
        if not task_path.exists():
            continue
        try:
            with open(task_path, "r", encoding="utf-8") as f:
                td = json.load(f)
        except Exception:
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

    return jsonify({"ok": True, "text": "\n".join(lines)})


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

        return jsonify(response)

    except Exception as exc:
        logger.exception("[HTTP] Failed to parse import text: %s", exc)
        return jsonify({"ok": False, "error": "parse_failed"}), 500


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
            return jsonify(cached_response)

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
        modules_dir = storage_service.modules_dir

        imported_ids = []
        errors = []
        saved_dirs = []  # Track saved dirs for rollback

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
                    modules_dir,
                    import_context=import_context,
                )

                if success:
                    imported_ids.append(task_id)
                    saved_dirs.append(
                        modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
                    )
                else:
                    errors.append(f"Failed to save task {i}")
                    # Rollback all previously saved tasks
                    for d in saved_dirs:
                        try:
                            import shutil

                            shutil.rmtree(d, ignore_errors=True)
                        except Exception:
                            pass
                    imported_ids.clear()
                    break

            except Exception as task_exc:
                logger.exception(f"[HTTP] Failed to import task {i}: {task_exc}")
                errors.append(f"Task {i}: {str(task_exc)}")
                # Rollback on exception
                for d in saved_dirs:
                    try:
                        import shutil

                        shutil.rmtree(d, ignore_errors=True)
                    except Exception:
                        pass
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
        logger.exception("[HTTP] Failed to execute import: %s", exc)
        return jsonify({"ok": False, "error": "import_failed"}), 500
