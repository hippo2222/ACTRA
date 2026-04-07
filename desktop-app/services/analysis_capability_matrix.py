"""
Capability Matrix v1 helpers for theory analysis (P1).

This module provides a canonical registry of task capabilities/progression roles
and lightweight annotation/validation for legacy analysis recommendations.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

CAPABILITY_MATRIX_VERSION = "1.0"

_TASK_TYPE_TO_ENTRY_ID: Dict[str, str] = {
    "TEST": "test_core",
    "OPEN_ANSWER": "open_answer_core",
    "DRAW": "draw_core",
    "CLICK": "click_core",
    "SEQUENCE": "sequence_structuring",
    "SEQUENCE_ASSEMBLY": "sequence_structuring",
}


def _matrix_entries() -> Dict[str, Dict[str, Any]]:
    return {
        "test_core": {
            "id": "test_core",
            "task_type": "TEST",
            "subtype": None,
            "implementation_status": "implemented_complex_type",
            "progression_is_fixed": True,
            "supported_levels": [1, 2],
            "complex_role": "core",
            "capability_ids": ["fact_recall", "recognition_check"],
            "level_role_map": [
                {"level": 1, "role": "Multiple choice: распознавание и объективная проверка фактов"},
                {"level": 2, "role": "Text answer: воспроизведение и извлечение ответа"},
            ],
        },
        "open_answer_core": {
            "id": "open_answer_core",
            "task_type": "OPEN_ANSWER",
            "subtype": None,
            "implementation_status": "implemented_complex_type",
            "progression_is_fixed": True,
            "supported_levels": [1],
            "complex_role": "core",
            "capability_ids": ["explanation", "causal_reasoning"],
            "level_role_map": [
                {"level": 1, "role": "Развернутый ответ: объяснение и причинно-следственные связи"},
            ],
        },
        "sequence_structuring": {
            "id": "sequence_structuring",
            "task_type": "SEQUENCE",
            "subtype": None,
            "implementation_status": "implemented_complex_type",
            "progression_is_fixed": True,
            "supported_levels": [1, 2, 3],
            "complex_role": "core",
            "capability_ids": ["sequence_structuring", "ordering", "classification", "hierarchy_building"],
            "intents": ["ordering", "classification", "hierarchy", "ranking", "grouping"],
            "level_role_map": [
                {"level": 1, "role": "Сборка структуры / распределение элементов"},
                {"level": 2, "role": "Сборка + называние уровней"},
                {"level": 3, "role": "Сборка + называние уровней и блоков"},
            ],
        },
        "click_core": {
            "id": "click_core",
            "task_type": "CLICK",
            "subtype": None,
            "implementation_status": "implemented_complex_type",
            "progression_is_fixed": True,
            "supported_levels": [1, 2, 3],
            "complex_role": "core",
            "capability_ids": ["recognition", "spatial_localization"],
            "level_role_map": [
                {"level": 1, "role": "Распознавание / нахождение"},
                {"level": 2, "role": "Распознавание + называние"},
                {"level": 3, "role": "Обводка + называние"},
            ],
        },
        "draw_core": {
            "id": "draw_core",
            "task_type": "DRAW",
            "subtype": None,
            "implementation_status": "implemented_complex_type",
            "progression_is_fixed": True,
            "supported_levels": [1, 2],
            "complex_role": "core",
            "capability_ids": ["spatial_recall", "annotation"],
            "level_role_map": [
                {"level": 1, "role": "Обводка / пространственное распознавание"},
                {"level": 2, "role": "Обводка + называние"},
            ],
        },
        "click_error_detection": {
            "id": "click_error_detection",
            "task_type": "CLICK",
            "subtype": "error_detection",
            "implementation_status": "implemented_complex_type",
            "progression_is_fixed": False,
            "supported_levels": [],
            "complex_role": "finisher_special",
            "capability_ids": ["error_detection", "discrimination"],
            "modes": ["text_errors", "text_choice"],
            "level_role_map": [],
        },
        "pair_matching_future": {
            "id": "pair_matching_future",
            "task_type": None,
            "subtype": None,
            "implementation_status": "planned",
            "progression_is_fixed": False,
            "supported_levels": [],
            "complex_role": "none",
            "capability_ids": ["pair_matching"],
            "first_target_implementation": "microcards.pair_match",
            "level_role_map": [],
        },
    }


def normalize_task_type(task_type: Optional[str]) -> str:
    value = str(task_type or "").strip().upper()
    if value in {"SEQUENCE_ASSEMBLY", "SEQUENCE"}:
        return "SEQUENCE_ASSEMBLY"
    return value


def get_task_capability_entry(task_type: Optional[str], subtype: Optional[str] = None) -> Optional[Dict[str, Any]]:
    normalized_task_type = normalize_task_type(task_type)
    normalized_subtype = str(subtype or "").strip().lower() or None

    if normalized_task_type == "CLICK" and normalized_subtype == "error_detection":
        entry = _matrix_entries().get("click_error_detection")
        return dict(entry) if entry else None

    entry_id = _TASK_TYPE_TO_ENTRY_ID.get(normalized_task_type)
    if not entry_id:
        return None

    entry = _matrix_entries().get(entry_id)
    return dict(entry) if entry else None


def get_task_difficulty_metadata(task_type: Optional[str], subtype: Optional[str] = None) -> Dict[str, Any]:
    entry = get_task_capability_entry(task_type, subtype)
    normalized_task_type = normalize_task_type(task_type)
    normalized_subtype = str(subtype or "").strip().lower() or None

    if not entry:
        return {
            "task_type": normalized_task_type or str(task_type or "").strip().upper(),
            "subtype": normalized_subtype,
            "capability_matrix_entry_id": None,
            "supported_levels": [1],
            "level_role_map": [],
            "progression_is_fixed": False,
            "progression_kind": "unknown",
            "authoring_enabled": False,
            "complex_role": "none",
            "fixed_progression_note": "",
        }

    supported_levels = [int(level) for level in (entry.get("supported_levels") or []) if isinstance(level, int)]
    progression_is_fixed = bool(entry.get("progression_is_fixed"))
    if not supported_levels:
        progression_kind = "special"
    elif len(supported_levels) == 1:
        progression_kind = "single_level"
    else:
        progression_kind = "fixed_levels" if progression_is_fixed else "subsettable"

    authoring_enabled = bool(progression_is_fixed and len(supported_levels) > 1)
    level_role_map = [dict(item) for item in (entry.get("level_role_map") or []) if isinstance(item, dict)]

    return {
        "task_type": normalize_task_type(entry.get("task_type")) or normalized_task_type,
        "subtype": str(entry.get("subtype") or normalized_subtype or "").strip().lower() or None,
        "capability_matrix_entry_id": entry.get("id"),
        "supported_levels": supported_levels,
        "level_role_map": _simplify_level_role_map(
            normalize_task_type(entry.get("task_type")) or normalized_task_type,
            str(entry.get("subtype") or normalized_subtype or "").strip().lower() or None,
            level_role_map,
        ),
        "progression_is_fixed": progression_is_fixed,
        "progression_kind": progression_kind,
        "authoring_enabled": authoring_enabled,
        "complex_role": entry.get("complex_role") or "none",
        "fixed_progression_note": _fixed_progression_note(entry),
    }


_LEGACY_RECOMMENDATION_MAP: Dict[str, Dict[str, Any]] = {
    "TEST": {"entry_id": "test_core"},
    "OPEN_ANSWER": {"entry_id": "open_answer_core"},
    "SEQUENCE": {"entry_id": "sequence_structuring"},
    "CLICK_TEXT": {"entry_id": "click_error_detection", "error_detection_mode": "text_choice"},
    "CLICK_WORDS": {"entry_id": "click_error_detection", "error_detection_mode": "text_errors"},
}


def _append_unique_warning(warnings: List[str], message: str) -> None:
    if not message:
        return
    if message not in warnings:
        warnings.append(message)


def _fixed_progression_note(entry: Dict[str, Any]) -> str:
    levels = entry.get("supported_levels") or []
    if not entry.get("progression_is_fixed"):
        return ""
    if levels:
        levels_text = ", ".join(f"L{int(l)}" for l in levels if isinstance(l, int))
        return (
            f"Уровни {levels_text} являются фиксированной progression этого типа; "
            "в анализе их не нужно выбирать вручную по отдельности."
        )
    return "Уровни этого типа трактуются как фиксированная progression, а не ручной выбор."


def _simplify_level_role_map(
    task_type: Optional[str],
    subtype: Optional[str],
    level_role_map: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    normalized_task_type = normalize_task_type(task_type)
    normalized_subtype = str(subtype or "").strip().lower() or None
    simple_roles: Dict[str, Dict[int, str]] = {
        "TEST": {
            1: "Пользователь выбирает правильный вариант из готовых ответов.",
            2: "Пользователь сам вводит короткий текстовый ответ.",
        },
        "DRAW": {
            1: "Пользователь обводит нужную область.",
            2: "Пользователь обводит область и подписывает её.",
        },
        "CLICK": {
            1: "Пользователь просто нажимает на нужную область.",
            2: "Пользователь находит область и выбирает её с названием.",
            3: "Пользователь выделяет область и называет её.",
        },
        "SEQUENCE_ASSEMBLY": {
            1: "Пользователь раскладывает элементы по уровням или группам.",
            2: "Пользователь раскладывает элементы и подписывает уровни.",
            3: "Пользователь раскладывает элементы и подписывает и уровни, и элементы.",
        },
    }

    if normalized_task_type == "CLICK" and normalized_subtype == "error_detection":
        return [dict(item) for item in level_role_map if isinstance(item, dict)]

    task_roles = simple_roles.get(normalized_task_type)
    if not task_roles:
        return [dict(item) for item in level_role_map if isinstance(item, dict)]

    simplified: List[Dict[str, Any]] = []
    for item in level_role_map:
        if not isinstance(item, dict):
            continue
        try:
            level = int(item.get("level"))
        except Exception:
            simplified.append(dict(item))
            continue
        simplified.append({
            **dict(item),
            "role": task_roles.get(level, str(item.get("role") or "").strip()),
        })
    return simplified


def _annotate_recommendation(rec: Dict[str, Any], warnings: List[str]) -> Dict[str, Any]:
    task_type = str(rec.get("task_type") or "").strip().upper()
    mapping = _LEGACY_RECOMMENDATION_MAP.get(task_type)
    if not mapping:
        _append_unique_warning(
            warnings,
            f"Capability matrix v1: unknown recommendation task_type '{task_type}' was left unannotated.",
        )
        return rec

    entries = _matrix_entries()
    entry = entries.get(str(mapping.get("entry_id")))
    if not entry:
        _append_unique_warning(
            warnings,
            f"Capability matrix v1: internal mapping for '{task_type}' is missing.",
        )
        return rec

    annotated = dict(rec)
    annotated["capability_matrix_entry_id"] = entry["id"]
    annotated["implementation_status"] = entry["implementation_status"]
    annotated["progression_is_fixed"] = bool(entry.get("progression_is_fixed"))
    annotated["supported_levels"] = list(entry.get("supported_levels") or [])
    annotated["complex_role"] = entry.get("complex_role")
    annotated["level_role_map"] = _simplify_level_role_map(
        entry.get("task_type"),
        entry.get("subtype"),
        [dict(item) for item in (entry.get("level_role_map") or []) if isinstance(item, dict)],
    )
    annotated["capability_ids"] = list(entry.get("capability_ids") or [])
    annotated["canonical_task_type"] = entry.get("task_type")
    if entry.get("subtype") is not None:
        annotated["canonical_subtype"] = entry.get("subtype")
    if mapping.get("error_detection_mode"):
        annotated["error_detection_mode"] = mapping["error_detection_mode"]
    if task_type == "SEQUENCE":
        annotated["sequence_intent_options"] = list(entry.get("intents") or [])
    note = _fixed_progression_note(entry)
    if note:
        annotated["fixed_progression_note"] = note
    return annotated


def _pair_matching_suitability(units: List[Dict[str, Any]]) -> Tuple[str, List[int], str]:
    if not units:
        return "low", [], "Недостаточно извлечённых единиц для уверенной рекомендации pair matching."

    scored_ids: List[int] = []
    score = 0
    for unit in units:
        if not isinstance(unit, dict):
            continue
        try:
            uid = int(unit.get("id"))
        except Exception:
            continue
        unit_type = str(unit.get("type") or "").strip().lower()
        title = str(unit.get("title") or "").strip().lower()
        desc = str(unit.get("description") or "").strip().lower()
        blob = f"{title} {desc}"
        unit_score = 0
        if unit_type in {"term", "classification"}:
            unit_score += 2
        elif unit_type in {"concept", "fact"}:
            unit_score += 1
        if any(token in blob for token in ["класс", "групп", "тип", "признак", "термин", "определен"]):
            unit_score += 1
        if unit_score > 0:
            scored_ids.append(uid)
            score += unit_score

    scored_ids = scored_ids[:8]
    if score >= 8 or len(scored_ids) >= 5:
        return "high", scored_ids, "Материал содержит термины/классификации и признаки, подходящие для сопоставления пар."
    if score >= 3 or len(scored_ids) >= 2:
        return "medium", scored_ids, "Есть несколько единиц, которые можно усилить через сопоставление терминов и признаков."
    return "low", scored_ids, "Pair matching возможен, но выраженных терминологических/классификационных пар немного."


def _build_pair_matching_future_capability(units: List[Dict[str, Any]]) -> Dict[str, Any]:
    suitability, cover_unit_ids, why = _pair_matching_suitability(units)
    return {
        "capability_id": "pair_matching",
        "display_name": "MATCH (сопоставление пар)",
        "status": "planned",
        "recommended_surface": "microcards",
        "suitability": suitability,
        "why": why,
        "fallback_now": ["SEQUENCE", "TEST", "OPEN_ANSWER"],
        # P1 bridge field (unit-based, until chunk-based v2 schema is introduced in P2)
        "covers_unit_ids": cover_unit_ids,
    }


def apply_capability_matrix_v1_annotations(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Annotate legacy analysis output with P1 capability-matrix metadata.

    Backward-compatible: keeps legacy fields untouched and only adds metadata.
    """
    result = dict(data or {})
    warnings = [str(w) for w in (result.get("warnings") or []) if str(w).strip()]
    recommendations = result.get("recommendations") if isinstance(result.get("recommendations"), list) else []
    units = result.get("educational_units") if isinstance(result.get("educational_units"), list) else []

    annotated_recs: List[Dict[str, Any]] = []
    validation_issues: List[str] = []
    fixed_progression_annotations = 0
    for raw_rec in recommendations:
        if not isinstance(raw_rec, dict):
            validation_issues.append("non_object_recommendation")
            continue
        rec = _annotate_recommendation(raw_rec, warnings)
        if rec.get("progression_is_fixed"):
            fixed_progression_annotations += 1
        if not rec.get("capability_matrix_entry_id"):
            validation_issues.append(f"unmapped:{rec.get('task_type')}")
        annotated_recs.append(rec)

    result["recommendations"] = annotated_recs
    result["warnings"] = warnings
    result["capability_matrix_version"] = CAPABILITY_MATRIX_VERSION
    result["capability_matrix_validation"] = {
        "matrix_version": CAPABILITY_MATRIX_VERSION,
        "validated_recommendations": len(annotated_recs),
        "fixed_progression_annotated": fixed_progression_annotations,
        "issues": validation_issues,
        "valid": len(validation_issues) == 0,
    }

    future_capabilities = [
        fc
        for fc in (result.get("future_capabilities") or [])
        if isinstance(fc, dict) and str(fc.get("capability_id") or "").strip()
    ]
    has_pair_matching = any(
        str(fc.get("capability_id") or "").strip().lower() == "pair_matching"
        for fc in future_capabilities
    )
    if not has_pair_matching:
        future_capabilities.append(_build_pair_matching_future_capability(units))
    else:
        normalized_fc: List[Dict[str, Any]] = []
        for fc in future_capabilities:
            if str(fc.get("capability_id") or "").strip().lower() != "pair_matching":
                normalized_fc.append(fc)
                continue
            merged = dict(_build_pair_matching_future_capability(units))
            merged.update(fc)
            merged["capability_id"] = "pair_matching"
            merged["status"] = "planned"
            normalized_fc.append(merged)
        future_capabilities = normalized_fc

    result["future_capabilities"] = future_capabilities
    return result


__all__ = [
    "CAPABILITY_MATRIX_VERSION",
    "apply_capability_matrix_v1_annotations",
    "get_task_capability_entry",
    "get_task_difficulty_metadata",
    "normalize_task_type",
]
