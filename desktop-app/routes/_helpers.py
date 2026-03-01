"""Shared helper functions used by multiple route modules."""

import logging
import uuid as _uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

from routes._context import get_ctx

logger = logging.getLogger(__name__)


def _make_safe_id(name: str) -> str:
    """Create a filesystem-safe ID from a (possibly Cyrillic) name.

    Unlike ``secure_filename`` which strips all non-ASCII chars, this helper
    keeps Cyrillic letters by doing a lightweight transliteration first.
    Falls back to a short UUID prefix when transliteration yields nothing.
    """
    _CYRILLIC_MAP = {
        "а": "a",
        "б": "b",
        "в": "v",
        "г": "g",
        "д": "d",
        "е": "e",
        "ё": "yo",
        "ж": "zh",
        "з": "z",
        "и": "i",
        "й": "j",
        "к": "k",
        "л": "l",
        "м": "m",
        "н": "n",
        "о": "o",
        "п": "p",
        "р": "r",
        "с": "s",
        "т": "t",
        "у": "u",
        "ф": "f",
        "х": "kh",
        "ц": "ts",
        "ч": "ch",
        "ш": "sh",
        "щ": "sch",
        "ъ": "",
        "ы": "y",
        "ь": "",
        "э": "e",
        "ю": "yu",
        "я": "ya",
    }
    lowered = name.strip().lower()
    chars = []
    for ch in lowered:
        if ch in _CYRILLIC_MAP:
            chars.append(_CYRILLIC_MAP[ch])
        elif ch.isascii() and (ch.isalnum() or ch in "_-"):
            chars.append(ch)
        elif ch in (" ", ".", "/", "\\"):
            chars.append("_")
        # else: skip
    result = "_".join(part for part in "".join(chars).split("_") if part)
    if not result:
        result = "item_" + _uuid.uuid4().hex[:8]
    return result


def _json_safe(obj: Any) -> Any:
    if obj is None:
        return None

    if isinstance(obj, (datetime, date)):
        try:
            return obj.isoformat()
        except Exception:
            return str(obj)

    obj_module = type(obj).__module__
    if obj_module and obj_module.split(".", 1)[0] == "numpy" and hasattr(obj, "item"):
        try:
            return obj.item()
        except Exception:
            pass

    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]

    return obj


def _normalize_complex_id(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    v = value.strip()
    return v or None


def _enrich_complex_with_theory_link(obj: dict) -> dict:
    """Attach cached theory metadata to complex payload for UI convenience."""
    from services.theory_service import TheoryNotFoundError  # type: ignore

    theory_link = obj.get("theory_link")
    if not isinstance(theory_link, dict):
        obj["has_theory"] = False
        return obj

    theory_id = theory_link.get("theory_id")
    if not isinstance(theory_id, str) or not theory_id.strip():
        obj["has_theory"] = False
        return obj

    try:
        theory_item = get_ctx().theory_service.get_theory(
            theory_id.strip(), include_delta=False
        )
        theory_link["title_cache"] = theory_item.get("title", "")
        theory_link["updated_at"] = theory_item.get("updated_at")
        obj["has_theory"] = True
    except TheoryNotFoundError:
        theory_link["missing"] = True
        obj["has_theory"] = False
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.warning("[HTTP] Failed to enrich theory link for complex %s: %s", obj.get("id"), exc)
        obj["has_theory"] = False
    return obj


def _get_complex_by_id(complex_id: str) -> Optional[dict]:
    try:
        complexes = get_ctx().complex_service.get_all_complexes()
        for c in complexes:
            obj = c.dict()
            if obj.get("id") == complex_id:
                created_at = obj.get("created_at")
                updated_at = obj.get("updated_at")
                if created_at is not None:
                    obj["created_at"] = (
                        created_at.isoformat()
                        if hasattr(created_at, "isoformat")
                        else str(created_at)
                    )
                if updated_at is not None:
                    obj["updated_at"] = (
                        updated_at.isoformat()
                        if hasattr(updated_at, "isoformat")
                        else str(updated_at)
                    )
                obj = _enrich_complex_with_theory_link(obj)
                return obj
        return None
    except Exception as exc:
        logger.exception("[HTTP] Failed to resolve complex by id %s: %s", complex_id, exc)
        return None


def _is_within_data_dir(candidate: Path) -> bool:
    data_dir = get_ctx().data_dir.resolve()
    try:
        candidate.resolve().relative_to(data_dir)
        return True
    except (ValueError, FileNotFoundError):
        return False


def _resolve_editor_image_path(
    path_str: str,
    *,
    module_id: Optional[str] = None,
    topic_id: Optional[str] = None,
    task_id: Optional[str] = None,
) -> Optional[Path]:
    """
    Try to resolve editor image path similarly to legacy Tkinter logic:
    - accept absolute paths under data_dir
    - allow relative paths inside task directory (if provided)
    - allow relative paths inside data_dir (modules/, images/, etc.)
    - handle ../data/images and data/images prefixes
    - fallback to data/images/<filename>
    """
    if not path_str:
        return None

    ctx = get_ctx()
    data_dir = ctx.data_dir.resolve()
    modules_dir = ctx.storage_service.modules_dir.resolve()
    raw_path = Path(path_str.strip())

    candidate_paths: list[Path] = []

    # 1. Absolute path as-is
    if raw_path.is_absolute():
        candidate_paths.append(raw_path)

    # Prepare task directory if module/topic/task specified
    task_dir: Optional[Path] = None
    if module_id and topic_id and task_id:
        task_dir = modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        # Relative to task json directory
        candidate_paths.append(task_dir / raw_path)
        # Allow referencing by filename inside task dir and task images subdir
        if raw_path.name:
            candidate_paths.append(task_dir / raw_path.name)
            candidate_paths.append(task_dir / "images" / raw_path.name)

    # 2. Relative to data_dir root
    candidate_paths.append(data_dir / raw_path)

    normalized_str = str(raw_path).replace("\\", "/")
    # 3. Handle explicit data/images prefixes
    if normalized_str.startswith("../data/images/") or normalized_str.startswith("data/images/"):
        rel_part = normalized_str.split("data/images/", 1)[-1]
        candidate_paths.append(data_dir / "images" / rel_part)

    # 4. data/images/<filename>
    if raw_path.name:
        candidate_paths.append(data_dir / "images" / raw_path.name)

    seen: set[str] = set()
    for candidate in candidate_paths:
        try:
            resolved = candidate.resolve()
        except FileNotFoundError:
            resolved = candidate

        key = resolved.as_posix().lower()
        if key in seen:
            continue
        seen.add(key)

        if not resolved.exists() or not resolved.is_file():
            continue

        if not _is_within_data_dir(resolved):
            logger.warning("[HTTP] serve_editor_image rejected path outside data_dir: %s", resolved)
            continue

        return resolved

    return None
