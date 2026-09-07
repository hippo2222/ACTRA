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
    value: Any, *, required: bool = False, allow_linked_library: bool = False
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Validate optional theory link payload for a complex.

    Accepted shape:
      {
        "source_kind": "workspace",
        "theory_id": "th_xxx",
        "relation": "link" | "copy",
        "title_cache": "...",
        "updated_at": "..."
      }

    When allow_linked_library=True this shape is also accepted:
      {
        "source_kind": "linked_library",
        "library_entry_id": "thlib_xxx",
        "relation": "link",
        "title_cache": "...",
        "updated_at": "...",
        "catalog_item_id": "...",
        "source_theory_id": "...",
        "access_state": "...",
        "access_reason": "..."
      }
    """
    if value is None:
        if required:
            return None, "theory_link_required"
        return None, None
    if not isinstance(value, dict):
        return None, "theory_link_must_be_object"

    source_kind_raw = value.get("source_kind")
    if source_kind_raw is not None and not isinstance(source_kind_raw, str):
        return None, "theory_source_kind_must_be_string"
    source_kind_norm = str(source_kind_raw or "").strip().lower()
    if source_kind_norm and source_kind_norm not in {"workspace", "linked_library"}:
        return None, "theory_source_kind_invalid"

    theory_id = value.get("theory_id")
    theory_id_norm = theory_id.strip() if isinstance(theory_id, str) and theory_id.strip() else None

    library_entry_id = value.get("library_entry_id")
    library_entry_id_norm = (
        library_entry_id.strip()
        if isinstance(library_entry_id, str) and library_entry_id.strip()
        else None
    )

    if source_kind_norm == "linked_library" or (allow_linked_library and library_entry_id_norm):
        if not allow_linked_library:
            return None, "linked_theory_link_not_supported"
        source_kind = "linked_library"
        if not library_entry_id_norm:
            return None, "library_entry_id_required"
    else:
        source_kind = "workspace"
        if theory_id_norm is None:
            return None, "theory_id_required"

    relation = value.get("relation", "link")
    if not isinstance(relation, str):
        return None, "theory_relation_must_be_string"
    relation_norm = relation.strip().lower() or "link"
    allowed_relations = {"link"} if source_kind == "linked_library" else {"link", "copy"}
    if relation_norm not in allowed_relations:
        return None, "theory_relation_invalid"

    title_cache = value.get("title_cache")
    if title_cache is not None and not isinstance(title_cache, str):
        return None, "theory_title_cache_must_be_string"

    updated_at = value.get("updated_at")
    if updated_at is not None and not isinstance(updated_at, str):
        return None, "theory_updated_at_must_be_string"

    normalized: Dict[str, Any] = {"source_kind": source_kind, "relation": relation_norm}
    if source_kind == "linked_library":
        normalized["library_entry_id"] = library_entry_id_norm
    else:
        normalized["theory_id"] = theory_id_norm

    if isinstance(title_cache, str):
        normalized["title_cache"] = title_cache.strip()
    if isinstance(updated_at, str):
        normalized["updated_at"] = updated_at.strip()

    for key, error_code in (
        ("catalog_item_id", "theory_catalog_item_id_must_be_string"),
        ("source_theory_id", "theory_source_theory_id_must_be_string"),
        ("access_state", "theory_access_state_must_be_string"),
        ("access_reason", "theory_access_reason_must_be_string"),
    ):
        raw_value = value.get(key)
        if raw_value is None:
            continue
        if not isinstance(raw_value, str):
            return None, error_code
        normalized[key] = raw_value.strip()

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
        settings_dict = dict(settings)

    normalized_theory_link, theory_link_error = validate_and_normalize_theory_link(
        theory_link, required=require_theory_link, allow_linked_library=True
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
    normalized_chains: List[Any] = []
    allowed_chain_shuffle_modes = {
        "never",
        "from_iteration_2",
        "only_iteration_3",
        "always",
        "custom",
    }
    try:
        max_iters = int(settings_dict.get("max_iterations", 3) or 3)
    except (ValueError, TypeError):
        max_iters = 3

    for ci, ch in enumerate(chains_list):
        if isinstance(ch, list):
            if not ch:
                errors.append({"field": f"chains[{ci}]", "reason": "chain_must_be_non_empty_array"})
                continue
            chain_tasks_raw = ch
            shuffle_mode = "never"
            shuffle_iterations: List[int] = []
            is_dict_format = False
        elif isinstance(ch, dict):
            raw_tasks = ch.get("tasks")
            if not isinstance(raw_tasks, list) or not raw_tasks:
                errors.append(
                    {
                        "field": f"chains[{ci}].tasks",
                        "reason": "chain_tasks_must_be_non_empty_array",
                    }
                )
                continue
            chain_tasks_raw = raw_tasks
            raw_mode = ch.get("shuffle_mode", "never")
            if not isinstance(raw_mode, str):
                errors.append(
                    {"field": f"chains[{ci}].shuffle_mode", "reason": "shuffle_mode_must_be_string"}
                )
                shuffle_mode = "never"
            else:
                shuffle_mode = raw_mode.strip().lower()
                if shuffle_mode not in allowed_chain_shuffle_modes:
                    errors.append(
                        {
                            "field": f"chains[{ci}].shuffle_mode",
                            "reason": "invalid_chain_shuffle_mode",
                            "value": raw_mode,
                        }
                    )

            raw_iterations = ch.get("shuffle_iterations", [])
            shuffle_iterations = []
            if raw_iterations is not None:
                if not isinstance(raw_iterations, list):
                    errors.append(
                        {
                            "field": f"chains[{ci}].shuffle_iterations",
                            "reason": "shuffle_iterations_must_be_array",
                        }
                    )
                else:
                    for it_idx, it_val in enumerate(raw_iterations):
                        try:
                            it_num = int(it_val)
                            if it_num < 1:
                                errors.append(
                                    {
                                        "field": f"chains[{ci}].shuffle_iterations[{it_idx}]",
                                        "reason": "iteration_must_be_positive",
                                    }
                                )
                            elif it_num > max_iters:
                                errors.append(
                                    {
                                        "field": f"chains[{ci}].shuffle_iterations[{it_idx}]",
                                        "reason": "iteration_exceeds_max_iterations",
                                        "value": it_num,
                                    }
                                )
                            else:
                                if it_num not in shuffle_iterations:
                                    shuffle_iterations.append(it_num)
                        except (ValueError, TypeError):
                            errors.append(
                                {
                                    "field": f"chains[{ci}].shuffle_iterations[{it_idx}]",
                                    "reason": "iteration_must_be_integer",
                                }
                            )

            if shuffle_mode == "from_iteration_2" and max_iters < 2:
                errors.append(
                    {
                        "field": f"chains[{ci}].shuffle_mode",
                        "reason": "shuffle_mode_exceeds_max_iterations",
                        "value": shuffle_mode,
                    }
                )
            elif shuffle_mode == "only_iteration_3" and max_iters < 3:
                errors.append(
                    {
                        "field": f"chains[{ci}].shuffle_mode",
                        "reason": "shuffle_mode_exceeds_max_iterations",
                        "value": shuffle_mode,
                    }
                )

            is_dict_format = True
        else:
            errors.append({"field": f"chains[{ci}]", "reason": "chain_must_be_array_or_object"})
            continue

        normalized_chain_tasks: List[str] = []
        for ti, tr in enumerate(chain_tasks_raw):
            err = validate_task_ref(tr)
            field_name = f"chains[{ci}].tasks[{ti}]" if is_dict_format else f"chains[{ci}][{ti}]"
            if err is not None:
                errors.append({"field": field_name, "reason": err, "value": tr})
                continue
            if tr not in seen:
                errors.append(
                    {
                        "field": field_name,
                        "reason": "chain_task_not_in_tasks",
                        "value": tr,
                    }
                )
                continue
            if tr in chains_tasks_seen:
                errors.append(
                    {
                        "field": field_name,
                        "reason": "task_in_multiple_chains",
                        "value": tr,
                    }
                )
                continue
            chains_tasks_seen.add(tr)
            normalized_chain_tasks.append(tr)

        if normalized_chain_tasks:
            if is_dict_format:
                normalized_chains.append(
                    {
                        "tasks": normalized_chain_tasks,
                        "shuffle_mode": shuffle_mode,
                        "shuffle_iterations": sorted(shuffle_iterations),
                    }
                )
            else:
                normalized_chains.append(normalized_chain_tasks)

    if errors:
        return None, errors

    raw_test_modes = settings_dict.get("test_question_display_modes")
    normalized_test_modes: Dict[str, str] = {}
    if raw_test_modes is None:
        raw_test_modes = {}
    if not isinstance(raw_test_modes, dict):
        errors.append(
            {
                "field": "settings.test_question_display_modes",
                "reason": "test_question_display_modes_must_be_object",
            }
        )
    else:
        for raw_ref, raw_mode in raw_test_modes.items():
            task_ref = str(raw_ref or "").strip()
            mode = str(raw_mode or "").strip().lower()
            if task_ref not in seen:
                errors.append(
                    {
                        "field": f"settings.test_question_display_modes.{task_ref or '<empty>'}",
                        "reason": "task_not_in_tasks",
                    }
                )
                continue
            if mode not in {"together", "scattered"}:
                errors.append(
                    {
                        "field": f"settings.test_question_display_modes.{task_ref}",
                        "reason": "invalid_display_mode",
                    }
                )
                continue
            if mode == "scattered":
                normalized_test_modes[task_ref] = mode

    raw_theory_blocks = payload.get("theory_blocks")
    normalized_theory_blocks: Dict[str, Dict[str, Any]] = {}
    if raw_theory_blocks is not None:
        if not isinstance(raw_theory_blocks, dict):
            errors.append({"field": "theory_blocks", "reason": "theory_blocks_must_be_object"})
        else:
            for blk_id, blk_data in raw_theory_blocks.items():
                b_id = str(blk_id or "").strip()
                if not b_id:
                    errors.append({"field": "theory_blocks", "reason": "block_id_required"})
                    continue
                if not isinstance(blk_data, dict):
                    errors.append(
                        {"field": f"theory_blocks.{b_id}", "reason": "block_data_must_be_object"}
                    )
                    continue
                label = str(blk_data.get("label") or "").strip()
                color = str(blk_data.get("color") or "").strip()
                color_border = str(blk_data.get("color_border") or "").strip()
                normalized_theory_blocks[b_id] = {
                    "label": label,
                    "color": color,
                    **({"color_border": color_border} if color_border else {}),
                }

    raw_theory_block_ranges = payload.get("theory_block_ranges")
    normalized_theory_block_ranges: List[Dict[str, Any]] = []
    if raw_theory_block_ranges is not None:
        if not isinstance(raw_theory_block_ranges, list):
            errors.append(
                {"field": "theory_block_ranges", "reason": "theory_block_ranges_must_be_array"}
            )
        else:
            for idx, item in enumerate(raw_theory_block_ranges):
                if not isinstance(item, dict):
                    errors.append(
                        {"field": f"theory_block_ranges[{idx}]", "reason": "range_must_be_object"}
                    )
                    continue
                blk_id = str(item.get("block_id") or "").strip()
                th_id = str(item.get("theory_id") or "").strip()
                line_start = item.get("line_start")
                line_end = item.get("line_end")

                if not blk_id:
                    errors.append(
                        {
                            "field": f"theory_block_ranges[{idx}].block_id",
                            "reason": "block_id_required",
                        }
                    )
                elif normalized_theory_blocks and blk_id not in normalized_theory_blocks:
                    errors.append(
                        {
                            "field": f"theory_block_ranges[{idx}].block_id",
                            "reason": "range_block_not_found",
                            "value": blk_id,
                        }
                    )

                if not th_id:
                    errors.append(
                        {
                            "field": f"theory_block_ranges[{idx}].theory_id",
                            "reason": "theory_id_required",
                        }
                    )

                if not isinstance(line_start, int) or line_start < 0:
                    errors.append(
                        {
                            "field": f"theory_block_ranges[{idx}].line_start",
                            "reason": "invalid_line_start",
                        }
                    )
                if not isinstance(line_end, int) or (
                    isinstance(line_start, int) and line_end < line_start
                ):
                    errors.append(
                        {
                            "field": f"theory_block_ranges[{idx}].line_end",
                            "reason": "invalid_line_end",
                        }
                    )

                if (
                    blk_id
                    and th_id
                    and isinstance(line_start, int)
                    and isinstance(line_end, int)
                    and line_start >= 0
                    and line_end >= line_start
                ):
                    normalized_theory_block_ranges.append(
                        {
                            "block_id": blk_id,
                            "theory_id": th_id,
                            "line_start": line_start,
                            "line_end": line_end,
                        }
                    )

    raw_theory_block_versions = payload.get("theory_block_versions")
    normalized_theory_block_versions: Dict[str, str] = {}
    if raw_theory_block_versions is not None:
        if not isinstance(raw_theory_block_versions, dict):
            errors.append(
                {"field": "theory_block_versions", "reason": "theory_block_versions_must_be_object"}
            )
        else:
            for th_id, ver in raw_theory_block_versions.items():
                t_id = str(th_id or "").strip()
                if t_id and ver is not None:
                    normalized_theory_block_versions[t_id] = str(ver).strip()

    raw_task_block_mappings = payload.get("task_block_mappings")
    normalized_task_block_mappings: Dict[str, List[str]] = {}
    if raw_task_block_mappings is not None:
        if not isinstance(raw_task_block_mappings, dict):
            errors.append(
                {"field": "task_block_mappings", "reason": "task_block_mappings_must_be_object"}
            )
        else:
            for raw_task_ref, raw_block_ids in raw_task_block_mappings.items():
                t_ref = str(raw_task_ref or "").strip()
                if t_ref not in seen:
                    errors.append(
                        {
                            "field": f"task_block_mappings.{t_ref or '<empty>'}",
                            "reason": "mapping_task_not_in_tasks",
                            "value": t_ref,
                        }
                    )
                    continue
                if not isinstance(raw_block_ids, list):
                    errors.append(
                        {
                            "field": f"task_block_mappings.{t_ref}",
                            "reason": "block_ids_must_be_array",
                        }
                    )
                    continue
                norm_blocks: List[str] = []
                for b_idx, b_id_raw in enumerate(raw_block_ids):
                    b_id = str(b_id_raw or "").strip()
                    if not b_id:
                        continue
                    if normalized_theory_blocks and b_id not in normalized_theory_blocks:
                        errors.append(
                            {
                                "field": f"task_block_mappings.{t_ref}[{b_idx}]",
                                "reason": "mapping_block_not_found",
                                "value": b_id,
                            }
                        )
                        continue
                    if b_id not in norm_blocks:
                        norm_blocks.append(b_id)
                if norm_blocks:
                    normalized_task_block_mappings[t_ref] = norm_blocks

    if errors:
        return None, errors

    settings_dict["test_question_display_modes"] = normalized_test_modes

    normalized = {
        "name": name.strip() if isinstance(name, str) else "",
        "description": description or "",
        "tasks": deduped_tasks,
        "chains": normalized_chains,
        "settings": settings_dict,
        "theory_link": normalized_theory_link,
        "theory_mode": normalized_theory_mode,
        "theory_blocks": normalized_theory_blocks,
        "theory_block_ranges": normalized_theory_block_ranges,
        "theory_block_versions": normalized_theory_block_versions,
        "task_block_mappings": normalized_task_block_mappings,
    }

    return normalized, []
