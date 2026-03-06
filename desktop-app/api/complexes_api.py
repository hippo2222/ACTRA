import re
from typing import Any, Dict, List, Optional, Tuple


def validate_task_ref(task_ref: Any) -> Optional[str]:
    if not isinstance(task_ref, str):
        return "task_ref_must_be_string"
    parts = [p for p in task_ref.split("/")]
    if len(parts) < 3:
        return "task_ref_invalid_format"
    if any((p is None) or (not str(p).strip()) for p in parts[:2] + [parts[-1]]):
        return "task_ref_invalid_format"
    if re.search(r"\s", task_ref):
        return "task_ref_must_not_contain_whitespace"
    return None


def validate_and_normalize_theory_link(
    value: Any, *, required: bool = False
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Validate optional theory link payload for a complex.

    Accepted shape:
      {
        "theory_id": "th_xxx",
        "relation": "link" | "copy",
        "title_cache": "...",
        "updated_at": "..."
      }
    """
    if value is None:
        if required:
            return None, "theory_link_required"
        return None, None
    if not isinstance(value, dict):
        return None, "theory_link_must_be_object"

    theory_id = value.get("theory_id")
    if not isinstance(theory_id, str) or not theory_id.strip():
        return None, "theory_id_required"

    relation = value.get("relation", "link")
    if not isinstance(relation, str):
        return None, "theory_relation_must_be_string"
    relation_norm = relation.strip().lower() or "link"
    if relation_norm not in {"link", "copy"}:
        return None, "theory_relation_invalid"

    title_cache = value.get("title_cache")
    if title_cache is not None and not isinstance(title_cache, str):
        return None, "theory_title_cache_must_be_string"

    updated_at = value.get("updated_at")
    if updated_at is not None and not isinstance(updated_at, str):
        return None, "theory_updated_at_must_be_string"

    normalized: Dict[str, Any] = {
        "theory_id": theory_id.strip(),
        "relation": relation_norm,
    }
    if isinstance(title_cache, str):
        normalized["title_cache"] = title_cache.strip()
    if isinstance(updated_at, str):
        normalized["updated_at"] = updated_at.strip()
    return normalized, None


def validate_and_normalize_create_payload(
    payload: Dict[str, Any], *, require_theory_link: bool = False
) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    """Validate and normalize create complex payload.

    Returns:
        (normalized_payload, errors)

    normalized_payload has keys:
      - name, description, tasks, chains, settings
    """

    name = payload.get("name")
    description = payload.get("description")
    tasks = payload.get("tasks")
    chains = payload.get("chains")
    settings = payload.get("settings")
    theory_link = payload.get("theory_link")
    theory_mode = payload.get("theory_mode")

    errors: List[Dict[str, Any]] = []

    if not isinstance(name, str) or not name.strip():
        errors.append({"field": "name", "reason": "name_required"})

    if description is not None and not isinstance(description, str):
        errors.append({"field": "description", "reason": "description_must_be_string"})

    if not isinstance(tasks, list) or not tasks:
        errors.append({"field": "tasks", "reason": "tasks_required"})
        tasks_list: List[Any] = []
    else:
        tasks_list = tasks

    if chains is None:
        chains_list: List[Any] = []
    elif not isinstance(chains, list):
        errors.append({"field": "chains", "reason": "chains_must_be_array"})
        chains_list = []
    else:
        chains_list = chains

    if settings is None:
        settings_dict: Dict[str, Any] = {}
    elif not isinstance(settings, dict):
        errors.append({"field": "settings", "reason": "settings_must_be_object"})
        settings_dict = {}
    else:
        settings_dict = settings

    normalized_theory_link, theory_link_error = validate_and_normalize_theory_link(
        theory_link, required=require_theory_link
    )
    if theory_link_error is not None:
        errors.append({"field": "theory_link", "reason": theory_link_error})

    normalized_theory_mode = None
    if theory_mode is None:
        normalized_theory_mode = "override" if normalized_theory_link else "inherit"
    elif not isinstance(theory_mode, str):
        errors.append({"field": "theory_mode", "reason": "theory_mode_must_be_string"})
    else:
        theory_mode_norm = theory_mode.strip().lower()
        if theory_mode_norm not in {"inherit", "override"}:
            errors.append({"field": "theory_mode", "reason": "theory_mode_invalid"})
        else:
            normalized_theory_mode = theory_mode_norm

    seen = set()
    deduped_tasks: List[str] = []
    for i, tr in enumerate(tasks_list):
        err = validate_task_ref(tr)
        if err is not None:
            errors.append({"field": f"tasks[{i}]", "reason": err, "value": tr})
            continue
        if tr in seen:
            errors.append({"field": f"tasks[{i}]", "reason": "duplicate_task", "value": tr})
            continue
        seen.add(tr)
        deduped_tasks.append(tr)

    chains_tasks_seen = set()
    normalized_chains: List[List[str]] = []
    for ci, ch in enumerate(chains_list):
        if not isinstance(ch, list) or not ch:
            errors.append({"field": f"chains[{ci}]", "reason": "chain_must_be_non_empty_array"})
            continue

        normalized_chain: List[str] = []
        for ti, tr in enumerate(ch):
            err = validate_task_ref(tr)
            if err is not None:
                errors.append({"field": f"chains[{ci}][{ti}]", "reason": err, "value": tr})
                continue
            if tr not in seen:
                errors.append(
                    {
                        "field": f"chains[{ci}][{ti}]",
                        "reason": "chain_task_not_in_tasks",
                        "value": tr,
                    }
                )
                continue
            if tr in chains_tasks_seen:
                errors.append(
                    {
                        "field": f"chains[{ci}][{ti}]",
                        "reason": "task_in_multiple_chains",
                        "value": tr,
                    }
                )
                continue
            chains_tasks_seen.add(tr)
            normalized_chain.append(tr)

        if normalized_chain:
            normalized_chains.append(normalized_chain)

    if errors:
        return None, errors

    normalized = {
        "name": name.strip() if isinstance(name, str) else "",
        "description": description or "",
        "tasks": deduped_tasks,
        "chains": normalized_chains,
        "settings": settings_dict,
        "theory_link": normalized_theory_link,
        "theory_mode": normalized_theory_mode,
    }

    return normalized, []
