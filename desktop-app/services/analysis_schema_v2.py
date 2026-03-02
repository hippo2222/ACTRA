from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

ANALYSIS_SCHEMA_VERSION = "2.0"
REPORT_BLOCKS_VERSION = "1.0"

_UNIT_TYPES = {"concept", "process", "fact", "term", "classification"}
_PRIORITY = {"high", "medium", "low"}
_RISK = {"low", "medium", "high"}
_SEQ_INTENTS = {"ordering", "classification", "hierarchy", "ranking", "grouping"}
_ANCHOR_KINDS = {"number", "term", "date", "threshold", "name"}
_CHUNK_TYPES = {
    "classification", "process", "mechanism", "contrast", "hierarchy", "factual_set", "other"
}
_SURFACES = {"complexes", "editor_manual", "microcards", "mixed"}
_TASK_TYPES = {"TEST", "OPEN_ANSWER", "SEQUENCE", "CLICK_TEXT", "CLICK_WORDS", "CLICK", "DRAW"}

_CANONICAL_LEVEL_ROLES: dict = {
    "TEST": [(1, "Multiple choice — recognition/fact check"), (2, "Text answer — recall/extraction")],
    "OPEN_ANSWER": [(1, "Free-form answer — explanation, cause-effect, mechanisms")],
    "SEQUENCE": [(1, "Assemble structure / distribute elements"), (2, "Assemble + name levels"), (3, "Assemble + name levels and blocks")],
    "CLICK": [(1, "Find/recognize on image"), (2, "Find + name"), (3, "Outline + name")],
    "DRAW": [(1, "Outline / spatial recognition"), (2, "Outline + name")],
}


def _s(v: Any, default: str = "") -> str:
    return str(v if v is not None else default).strip()


def _i(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except Exception:
        return default


def _b(v: Any, default: bool = False) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    low = _s(v).lower()
    if low in {"1", "true", "yes", "on"}:
        return True
    if low in {"0", "false", "no", "off"}:
        return False
    return default


def _append_unique(items: List[str], msg: str) -> None:
    if msg and msg not in items:
        items.append(msg)


def _uniq_ints(values: Any, allowed: Optional[set] = None) -> List[int]:
    out: List[int] = []
    seen = set()
    if not isinstance(values, list):
        return out
    for raw in values:
        try:
            v = int(raw)
        except Exception:
            continue
        if allowed is not None and v not in allowed:
            continue
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


def _uniq_strs(values: Any, allowed: Optional[set] = None) -> List[str]:
    out: List[str] = []
    seen = set()
    if not isinstance(values, list):
        return out
    for raw in values:
        v = _s(raw)
        if not v:
            continue
        if allowed is not None and v not in allowed:
            continue
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


def _str_list(values: Any, max_items: int = 8) -> List[str]:
    out: List[str] = []
    seen = set()
    if not isinstance(values, list):
        return out
    for raw in values:
        txt = _s(raw)
        if not txt:
            continue
        key = txt.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(txt[:300])
        if len(out) >= max_items:
            break
    return out


def _norm_id(raw: Any, prefix: str, idx: int, used: set) -> str:
    token = re.sub(r"[^a-zA-Z0-9_-]+", "_", _s(raw))
    token = re.sub(r"_+", "_", token).strip("_")
    if not token:
        token = f"{prefix}_{idx}"
    base = token[:64]
    token = base
    n = 2
    while token in used:
        token = f"{base}_{n}"[:64]
        n += 1
    used.add(token)
    return token


def _unit_blob(u: Dict[str, Any]) -> str:
    return " ".join([_s(u.get("title")), _s(u.get("description")), _s(u.get("evidence"))])


def _infer_anchors(unit: Dict[str, Any]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    seen = set()
    title = _s(unit.get("title"))
    if title:
        out.append({"kind": "term", "value": title[:120]})
        seen.add(("term", title.lower()))
    blob = _unit_blob(unit)
    for year in re.findall(r"\b(?:19|20)\d{2}\b", blob):
        k = ("date", year)
        if k not in seen:
            out.append({"kind": "date", "value": year})
            seen.add(k)
    for thr in re.findall(r"(?:>=|<=|>|<|=)\s*\d+(?:[.,]\d+)?(?:\s*[%A-Za-zА-Яа-я/_-]+)?", blob):
        txt = re.sub(r"\s+", " ", thr).strip()[:120]
        k = ("threshold", txt.lower())
        if k not in seen:
            out.append({"kind": "threshold", "value": txt})
            seen.add(k)
    for num in re.findall(r"\b\d+(?:[.,]\d+)?\b", blob):
        k = ("number", num)
        if k not in seen:
            out.append({"kind": "number", "value": num})
            seen.add(k)
        if len(out) >= 6:
            break
    return out[:8]


def _norm_anchors(value: Any, unit_like: Dict[str, Any]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    seen = set()
    if isinstance(value, list):
        for raw in value:
            if not isinstance(raw, dict):
                continue
            kind = _s(raw.get("kind")).lower()
            val = _s(raw.get("value"))
            if kind not in _ANCHOR_KINDS or not val:
                continue
            key = (kind, val.lower())
            if key in seen:
                continue
            seen.add(key)
            out.append({"kind": kind, "value": val[:120]})
    return out or _infer_anchors(unit_like)


def _norm_cognitive_ops(value: Any, unit: Dict[str, Any]) -> List[str]:
    allowed = {"recognize", "recall", "explain", "classify", "compare", "sequence", "apply"}
    out = [op for op in [_s(v).lower() for v in (value if isinstance(value, list) else [])] if op in allowed]
    out = list(dict.fromkeys(out))
    if out:
        return out
    t = _s(unit.get("type"), "fact").lower()
    if t == "classification":
        return ["recognize", "classify", "recall"]
    if t == "process":
        return ["recognize", "sequence", "explain"]
    if t in {"concept"}:
        return ["recognize", "recall", "explain"]
    return ["recognize", "recall"]


def _normalize_units(raw_units: Any, warnings: List[str]) -> List[Dict[str, Any]]:
    units: List[Dict[str, Any]] = []
    used = set()
    if not isinstance(raw_units, list):
        return units
    for idx, raw in enumerate(raw_units, start=1):
        if not isinstance(raw, dict):
            continue
        u = dict(raw)
        uid = _i(u.get("id"), idx)
        if uid <= 0:
            uid = idx
        while uid in used:
            uid += 1
        used.add(uid)
        u["id"] = uid
        u["title"] = _s(u.get("title"), f"Unit {uid}") or f"Unit {uid}"
        u["description"] = _s(u.get("description"))
        t = _s(u.get("type"), "fact").lower()
        u["type"] = t if t in _UNIT_TYPES else "fact"
        exp = _s(u.get("explicitness"), "explicit").lower()
        u["explicitness"] = exp if exp in {"explicit", "inferred"} else "explicit"
        u["evidence"] = _s(u.get("evidence")) or u["description"] or u["title"]
        mod = _s(u.get("modality"), "text").lower()
        u["modality"] = mod if mod in {"text", "visual", "mixed"} else "text"
        risk = _s(u.get("assessment_risk"), "medium").lower()
        u["assessment_risk"] = risk if risk in _RISK else "medium"
        u["_chunk_ids_raw"] = _uniq_strs(u.get("chunk_ids"))
        u["_prereq_raw"] = _uniq_ints(u.get("prerequisite_unit_ids"))
        u["cognitive_ops"] = _norm_cognitive_ops(u.get("cognitive_ops"), u)
        u["factual_anchors"] = _norm_anchors(u.get("factual_anchors"), u)
        units.append(u)
    valid_ids = {int(u["id"]) for u in units}
    dropped = False
    for u in units:
        prereq_raw = list(u.pop("_prereq_raw", []))
        prereq = [x for x in prereq_raw if x in valid_ids and x != int(u["id"])]
        if len(prereq) != len(set(prereq)):
            prereq = list(dict.fromkeys(prereq))
        u["prerequisite_unit_ids"] = prereq
        u["chunk_ids"] = []
        if len(prereq) != len(_uniq_ints(prereq_raw)):
            dropped = True
    if dropped:
        _append_unique(warnings, "analysis_json v2 normalizer: dropped invalid prerequisite_unit_ids refs.")
    return units


def _chunk_type_for_units(unit_ids: List[int], unit_by_id: Dict[int, Dict[str, Any]]) -> str:
    kinds: List[str] = []
    for uid in unit_ids:
        t = _s((unit_by_id.get(uid) or {}).get("type")).lower()
        if t == "classification":
            kinds.append("classification")
        elif t == "process":
            kinds.append("process")
        elif t in {"fact", "term"}:
            kinds.append("factual_set")
        elif t == "concept":
            kinds.append("mechanism")
    if not kinds:
        return "other"
    return max(sorted(set(kinds)), key=lambda k: kinds.count(k))


def _merge_chunk_anchors(unit_ids: List[int], unit_by_id: Dict[int, Dict[str, Any]]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    seen = set()
    for uid in unit_ids:
        for a in (unit_by_id.get(uid) or {}).get("factual_anchors") or []:
            if not isinstance(a, dict):
                continue
            kind = _s(a.get("kind")).lower()
            val = _s(a.get("value"))
            if kind not in _ANCHOR_KINDS or not val:
                continue
            key = (kind, val.lower())
            if key in seen:
                continue
            seen.add(key)
            out.append({"kind": kind, "value": val[:120]})
            if len(out) >= 8:
                return out
    return out


def _derive_chunks(units: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not units:
        return []
    unit_by_id = {int(u["id"]): u for u in units}
    used = set()
    chunk_size = 1 if len(units) <= 6 else (2 if len(units) <= 12 else 3)
    chunks: List[Dict[str, Any]] = []
    for idx in range(0, len(units), chunk_size):
        group = units[idx : idx + chunk_size]
        unit_ids = [int(u["id"]) for u in group]
        cid = _norm_id(None, "chunk", len(chunks) + 1, used)
        ctype = _chunk_type_for_units(unit_ids, unit_by_id)
        title = _s(group[0].get("title"), f"Chunk {len(chunks)+1}")
        if len(group) > 1:
            title = f"{title} (+{len(group)-1})"
        chunks.append(
            {
                "id": cid,
                "title": title,
                "chunk_type": ctype if ctype in _CHUNK_TYPES else "other",
                "goal": "Cover the linked educational units with grounded practice.",
                "unit_ids": unit_ids,
                "common_confusions": [],
                "factual_anchors": _merge_chunk_anchors(unit_ids, unit_by_id),
                "route_ids": [],
                "notes_for_author": [],
            }
        )
    return chunks


def _normalize_chunks(raw_chunks: Any, units: List[Dict[str, Any]], warnings: List[str]) -> List[Dict[str, Any]]:
    if not isinstance(raw_chunks, list) or not raw_chunks:
        return _derive_chunks(units)
    unit_by_id = {int(u["id"]): u for u in units}
    valid_unit_ids = set(unit_by_id.keys())
    used = set()
    out: List[Dict[str, Any]] = []
    dropped = False
    for idx, raw in enumerate(raw_chunks, start=1):
        if not isinstance(raw, dict):
            continue
        c = dict(raw)
        c["id"] = _norm_id(c.get("id"), "chunk", idx, used)
        raw_uid_field = c.get("unit_ids") or c.get("units_covered") or []
        unit_ids_raw = _uniq_ints(raw_uid_field)
        c["unit_ids"] = _uniq_ints(raw_uid_field, allowed=valid_unit_ids)
        if len(c["unit_ids"]) != len(unit_ids_raw):
            dropped = True
        ctype = _s(c.get("chunk_type")).lower()
        if ctype not in _CHUNK_TYPES:
            ctype = _chunk_type_for_units(c["unit_ids"], unit_by_id)
        c["chunk_type"] = ctype if ctype in _CHUNK_TYPES else "other"
        c["title"] = _s(c.get("title")) or (unit_by_id.get(c["unit_ids"][0], {}).get("title") if c["unit_ids"] else f"Chunk {idx}")
        c["goal"] = _s(c.get("goal")) or "Cover the linked educational units with grounded practice."
        c["common_confusions"] = _str_list(c.get("common_confusions"), max_items=6)
        c["factual_anchors"] = _norm_anchors(c.get("factual_anchors"), {"title": c["title"], "description": c["goal"]})
        c["route_ids"] = _uniq_strs(c.get("route_ids"))
        c["notes_for_author"] = _str_list(c.get("notes_for_author"), max_items=8)
        out.append(c)
    if dropped:
        _append_unique(warnings, "analysis_json v2 normalizer: dropped invalid learning_chunks.unit_ids refs.")
    return out or _derive_chunks(units)


def _reconcile_unit_chunk_links(units: List[Dict[str, Any]], chunks: List[Dict[str, Any]], warnings: List[str]) -> None:
    if not units:
        return
    valid_unit_ids = {int(u["id"]) for u in units}
    chunk_map = {str(c["id"]): c for c in chunks if isinstance(c, dict) and c.get("id")}
    if not chunk_map:
        chunks[:] = _derive_chunks(units)
        chunk_map = {str(c["id"]): c for c in chunks}
    valid_chunk_ids = set(chunk_map.keys())
    unit_to_chunks: Dict[int, List[str]] = {int(u["id"]): [] for u in units}
    dropped = False
    for c in chunks:
        c["unit_ids"] = _uniq_ints(c.get("unit_ids"), allowed=valid_unit_ids)
        for uid in c["unit_ids"]:
            if c["id"] not in unit_to_chunks[uid]:
                unit_to_chunks[uid].append(c["id"])
    for u in units:
        raw_chunk_ids = _uniq_strs(u.pop("_chunk_ids_raw", []))
        valid = [cid for cid in raw_chunk_ids if cid in valid_chunk_ids]
        if len(valid) != len(raw_chunk_ids):
            dropped = True
        for cid in valid:
            if cid not in unit_to_chunks[int(u["id"])]:
                unit_to_chunks[int(u["id"])].append(cid)
    uncovered = [uid for uid, cids in unit_to_chunks.items() if not cids]
    if uncovered:
        used = set(valid_chunk_ids)
        cid = _norm_id(None, "chunk", len(chunks) + 1, used)
        chunks.append(
            {
                "id": cid,
                "title": "Remaining units",
                "chunk_type": "other",
                "goal": "Fallback chunk for units without links.",
                "unit_ids": list(uncovered),
                "common_confusions": [],
                "factual_anchors": _merge_chunk_anchors(list(uncovered), {int(u['id']): u for u in units}),
                "route_ids": [],
                "notes_for_author": [],
            }
        )
        for uid in uncovered:
            unit_to_chunks[uid].append(cid)
        _append_unique(warnings, "analysis_json v2 normalizer: created fallback chunk for unlinked units.")
    if dropped:
        _append_unique(warnings, "analysis_json v2 normalizer: dropped invalid educational_units.chunk_ids refs.")
    chunk_to_units = {str(c["id"]): [] for c in chunks}
    for uid, cids in unit_to_chunks.items():
        for cid in cids:
            if cid in chunk_to_units and uid not in chunk_to_units[cid]:
                chunk_to_units[cid].append(uid)
    chunk_order = [str(c["id"]) for c in chunks]
    rank = {cid: i for i, cid in enumerate(chunk_order)}
    for c in chunks:
        c["unit_ids"] = sorted(chunk_to_units.get(str(c["id"]), []))
    for u in units:
        cids = sorted(set(unit_to_chunks[int(u["id"])]), key=lambda cid: rank.get(cid, 9999))
        u["chunk_ids"] = cids


def _unit_chunk_map(units: List[Dict[str, Any]]) -> Dict[int, List[str]]:
    return {int(u["id"]): [str(cid) for cid in (u.get("chunk_ids") or []) if _s(cid)] for u in units if isinstance(u, dict)}


def _normalize_future_caps(raw: Any, units: List[Dict[str, Any]], chunks: List[Dict[str, Any]], warnings: List[str]) -> List[Dict[str, Any]]:
    unit_ids = {int(u["id"]) for u in units}
    chunk_ids = {str(c["id"]) for c in chunks}
    u2c = _unit_chunk_map(units)
    out: List[Dict[str, Any]] = []
    dropped = False
    for raw_fc in (raw if isinstance(raw, list) else []):
        if not isinstance(raw_fc, dict):
            continue
        fc = dict(raw_fc)
        cap_id = _norm_id(fc.get("capability_id"), "cap", len(out) + 1, set()).lower()
        # _norm_id with local set keeps sanitization but not dedupe across out; dedupe manually below.
        if any(_s(x.get("capability_id")).lower() == cap_id for x in out):
            continue
        covers_unit_ids_raw = _uniq_ints(fc.get("covers_unit_ids"))
        covers_unit_ids = _uniq_ints(fc.get("covers_unit_ids"), allowed=unit_ids)
        covers_chunk_ids_raw = _uniq_strs(fc.get("covers_chunk_ids"))
        covers_chunk_ids = _uniq_strs(fc.get("covers_chunk_ids"), allowed=chunk_ids)
        if len(covers_unit_ids) != len(covers_unit_ids_raw) or len(covers_chunk_ids) != len(covers_chunk_ids_raw):
            dropped = True
        if not covers_chunk_ids:
            for uid in covers_unit_ids:
                for cid in u2c.get(uid, []):
                    if cid in chunk_ids and cid not in covers_chunk_ids:
                        covers_chunk_ids.append(cid)
        status = _s(fc.get("status"), "planned").lower()
        if status not in {"planned", "microcards_mvp", "implemented"}:
            status = "planned"
        suit = _s(fc.get("suitability"), "medium").lower()
        if suit not in {"high", "medium", "low"}:
            suit = "medium"
        surface = _s(fc.get("recommended_surface"), "microcards").lower()
        if surface not in _SURFACES:
            surface = "microcards"
        fallback_now = [t.upper() for t in _uniq_strs(fc.get("fallback_now")) if t.upper() in _TASK_TYPES] or ["SEQUENCE", "TEST", "OPEN_ANSWER"]
        out.append(
            {
                "capability_id": cap_id,
                "display_name": _s(fc.get("display_name"))[:120] or cap_id,
                "status": status,
                "recommended_surface": surface,
                "suitability": suit,
                "covers_chunk_ids": covers_chunk_ids,
                "why": _s(fc.get("why"))[:400] or "Normalized future capability.",
                "fallback_now": fallback_now,
                "covers_unit_ids": covers_unit_ids,
            }
        )
    if dropped:
        _append_unique(warnings, "analysis_json v2 normalizer: dropped broken refs in future_capabilities.")
    return out


def _impl_to_availability(v: Any) -> str:
    low = _s(v).lower()
    if low == "implemented_complex_type":
        return "implemented"
    if low == "implemented_microcards_mode":
        return "microcards_only"
    if low in {"planned", "unsupported"}:
        return low
    return "implemented"


def _derive_type_progression(data: Dict[str, Any], units: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    u2c = _unit_chunk_map(units)
    unit_by_id = {int(u["id"]): u for u in units}
    out: List[Dict[str, Any]] = []
    for rec in (data.get("recommendations") or []):
        if not isinstance(rec, dict):
            continue
        task_type = _s(rec.get("task_type")).upper()
        if not task_type:
            continue
        covers_unit_ids = _uniq_ints(rec.get("covers_units"), allowed=set(unit_by_id.keys()))
        covers_chunk_ids: List[str] = []
        for uid in covers_unit_ids:
            for cid in u2c.get(uid, []):
                if cid not in covers_chunk_ids:
                    covers_chunk_ids.append(cid)
        pr = _s(rec.get("priority"), "medium").lower()
        if pr not in _PRIORITY:
            pr = "medium"
        suit = "high" if pr == "high" else ("low" if pr == "low" else "medium")
        subtype = rec.get("canonical_subtype") if rec.get("canonical_subtype") is not None else rec.get("subtype")
        subtype_s = _s(subtype)
        seq_intents = []
        if task_type == "SEQUENCE":
            raw_intents = rec.get("sequence_intents") or rec.get("sequence_intent_options") or []
            if isinstance(raw_intents, str):
                raw_intents = [raw_intents]
            seq_intents = [x for x in [_s(v).lower() for v in (raw_intents if isinstance(raw_intents, list) else [])] if x in _SEQ_INTENTS]
            if not seq_intents and any(_s(unit_by_id.get(uid, {}).get("type")).lower() == "classification" for uid in covers_unit_ids):
                seq_intents = ["classification"]
        level_role_map = []
        for row in (rec.get("level_role_map") or []):
            if not isinstance(row, dict):
                continue
            level = _i(row.get("level"), 0)
            role = _s(row.get("role"))
            if level > 0 and role:
                level_role_map.append({"level": level, "role": role[:220], "value_for_material": _s(rec.get("rationale"))[:260]})
        notes = []
        if _s(rec.get("fixed_progression_note")):
            notes.append(_s(rec.get("fixed_progression_note"))[:280])
        out.append(
            {
                "task_type": task_type,
                "subtype": subtype_s if subtype_s and subtype_s.lower() != "null" else None,
                "availability": _impl_to_availability(rec.get("implementation_status")),
                "progression_is_fixed": _b(rec.get("progression_is_fixed")),
                "complex_role": _s(rec.get("complex_role"), "none").lower() if _s(rec.get("complex_role"), "none").lower() in {"core", "finisher_special", "none"} else "none",
                "suitability": suit,
                "priority": pr,
                "covers_chunk_ids": covers_chunk_ids,
                "covers_unit_ids": covers_unit_ids,
                "why": _s(rec.get("rationale"))[:500] or "Derived from legacy recommendations.",
                "level_role_map": level_role_map,
                "sequence_intents": seq_intents,
                "constraints": [],
                "authoring_risks": [],
                "iterative_system_notes": notes,
            }
        )
    return out


def _normalize_type_progression(raw: Any, data: Dict[str, Any], units: List[Dict[str, Any]], chunks: List[Dict[str, Any]], warnings: List[str]) -> List[Dict[str, Any]]:
    unit_ids = {int(u["id"]) for u in units}
    chunk_ids = {str(c["id"]) for c in chunks}
    src = raw if isinstance(raw, list) and raw else _derive_type_progression(data, units)
    out: List[Dict[str, Any]] = []
    dropped = False
    for item in src:
        if not isinstance(item, dict):
            continue
        task_type = _s(item.get("task_type")).upper()
        if not task_type:
            continue
        av = _s(item.get("availability"), "implemented").lower()
        if av not in {"implemented", "planned", "microcards_only", "unsupported"}:
            av = "implemented"
        role = _s(item.get("complex_role"), "none").lower()
        if role not in {"core", "finisher_special", "none"}:
            role = "none"
        suit = _s(item.get("suitability"), "medium").lower()
        if suit not in {"high", "medium", "low", "not_recommended"}:
            suit = "medium"
        pr = _s(item.get("priority"), "medium").lower()
        if pr not in _PRIORITY:
            pr = "medium"
        cu_raw = _uniq_ints(item.get("covers_unit_ids"))
        cc_raw = _uniq_strs(item.get("covers_chunk_ids"))
        cu = _uniq_ints(item.get("covers_unit_ids"), allowed=unit_ids)
        cc = _uniq_strs(item.get("covers_chunk_ids"), allowed=chunk_ids)
        if len(cu) != len(cu_raw) or len(cc) != len(cc_raw):
            dropped = True
        seq = [x for x in [_s(v).lower() for v in (item.get("sequence_intents") or [])] if x in _SEQ_INTENTS]
        levels = []
        for row in (item.get("level_role_map") or []):
            if not isinstance(row, dict):
                continue
            lv = _i(row.get("level"), 0)
            rl = _s(row.get("role"))
            if lv > 0 and rl:
                levels.append({"level": lv, "role": rl[:220], "value_for_material": _s(row.get("value_for_material"))[:260]})
        if not levels and _b(item.get("progression_is_fixed")) and task_type in _CANONICAL_LEVEL_ROLES:
            for lv, rl in _CANONICAL_LEVEL_ROLES[task_type]:
                levels.append({"level": lv, "role": rl, "value_for_material": ""})
        subtype_s = _s(item.get("subtype"))
        out.append(
            {
                "task_type": task_type,
                "subtype": subtype_s if subtype_s and subtype_s.lower() != "null" else None,
                "availability": av,
                "progression_is_fixed": _b(item.get("progression_is_fixed")),
                "complex_role": role,
                "suitability": suit,
                "priority": pr,
                "covers_chunk_ids": cc,
                "covers_unit_ids": cu,
                "why": _s(item.get("why"))[:500] or "Normalized suitability entry.",
                "level_role_map": levels,
                "sequence_intents": seq,
                "constraints": _str_list(item.get("constraints"), max_items=8),
                "authoring_risks": _str_list(item.get("authoring_risks"), max_items=8),
                "iterative_system_notes": _str_list(item.get("iterative_system_notes"), max_items=8),
            }
        )
    if dropped:
        _append_unique(warnings, "analysis_json v2 normalizer: dropped broken refs in type_progression_suitability.")
    return out


def _sort_type_entries(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    p = {"high": 2, "medium": 1, "low": 0}
    s = {"high": 3, "medium": 2, "low": 1, "not_recommended": 0}
    return sorted(entries, key=lambda e: (-p.get(_s(e.get("priority")).lower(), 1), -s.get(_s(e.get("suitability")).lower(), 1), _s(e.get("task_type"))))


def _route_step_default_checklist(
    *,
    action_type: str,
    task_type: Optional[str] = None,
    progression_is_fixed: bool = False,
    sequence_intent: Optional[str] = None,
    route_surface: Optional[str] = None,
) -> List[str]:
    items: List[str] = []
    if action_type == "use_task_type_progression":
        items.append("Keep every task grounded in the linked units/chunks and factual anchors.")
        if progression_is_fixed:
            items.append("Treat levels as a fixed progression; do not offer a pick-only-level shortcut.")
        if _s(task_type).upper() == "SEQUENCE":
            if _s(sequence_intent).lower() in _SEQ_INTENTS:
                items.append(f"Keep SEQUENCE intent explicit ({_s(sequence_intent).lower()}) and aligned with the theory semantics.")
            else:
                items.append("State the SEQUENCE intent explicitly (ordering/classification/hierarchy/ranking/grouping) before authoring.")
        if _s(route_surface).lower() == "editor_manual":
            items.append("Author concrete task wording in the editor and keep scope limited to the linked chunk(s).")
        if _s(route_surface).lower() == "complexes":
            items.append("Use the route as a progression plan for complexes, not as isolated one-off tasks.")
    elif action_type == "add_microcards":
        items.extend(
            [
                "Select only pairings that are explicitly supported by the material and linked units.",
                "Keep pair_match cards within MVP limits (2-5 pairs, no many-to-many).",
                "Review ambiguous or overlapping pairs manually before adding to a deck.",
            ]
        )
    return _str_list(items, max_items=8)


def _route_default_anti_patterns(route: Dict[str, Any]) -> List[str]:
    steps = [s for s in (route.get("steps") or []) if isinstance(s, dict)]
    surface = _s(route.get("target_surface")).lower()
    items: List[str] = []
    if any(_s(s.get("action_type")).lower() == "use_task_type_progression" and _s(s.get("progression_policy")).lower() == "full_fixed_progression" for s in steps):
        items.append("Do not present fixed progression levels as an arbitrary manual choice.")
    if any(_s(s.get("action_type")).lower() == "add_microcards" for s in steps):
        items.append("Avoid ambiguous many-to-many pairings or oversized pair_match cards in MVP.")
    if surface == "editor_manual":
        items.append("Do not author all route steps against the same fact when multiple units are linked.")
    if surface == "complexes":
        items.append("Do not duplicate the same task purpose across multiple complex steps without a new learning goal.")
    if surface == "mixed":
        items.append("Do not split effort across too many surfaces before covering the core chunk once.")
    items.append("Do not add unsupported facts or terminology that is missing from the linked units.")
    return _str_list(items, max_items=8)


def _route_default_expected_effect(route: Dict[str, Any]) -> str:
    surface = _s(route.get("target_surface"), "complexes").lower()
    chunk_count = len(_uniq_strs(route.get("chunk_ids")))
    unit_count = len(_uniq_ints(route.get("unit_ids")))
    if surface == "microcards":
        return "Adds focused repetition for pair associations and short factual links after the main study pass."
    if surface == "editor_manual":
        return "Produces concrete, grounded tasks in the editor with minimal guesswork about sequence and coverage."
    if surface == "mixed":
        return "Combines structured practice with spaced repetition so chunk understanding is reinforced after authoring."
    if chunk_count or unit_count:
        return f"Turns {max(chunk_count, 1)} chunk(s) / {max(unit_count, 1)} unit(s) into a concrete progression plan for practice."
    return "Turns the analysis into a practical authoring route with clear next steps."


def _build_progression_route_step(
    rid: str,
    step_index: int,
    entry: Dict[str, Any],
    *,
    route_surface: str,
    purpose: Optional[str] = None,
) -> Dict[str, Any]:
    task_type = _s(entry.get("task_type")).upper()
    subtype = _s(entry.get("subtype"))
    progression_is_fixed = _b(entry.get("progression_is_fixed"))
    seq_intent = None
    if task_type == "SEQUENCE":
        seqs = entry.get("sequence_intents") or []
        if isinstance(seqs, list):
            first_seq = _s((seqs or [None])[0]).lower()
            if first_seq in _SEQ_INTENTS:
                seq_intent = first_seq
    step = {
        "step_id": f"{rid}_step_{step_index}",
        "action_type": "use_task_type_progression",
        "task_type": task_type,
        "subtype": subtype if subtype and subtype.lower() != "null" else None,
        "progression_policy": "full_fixed_progression" if progression_is_fixed else "not_fixed",
        "purpose": (_s(purpose) or _s(entry.get("why")) or f"Use {task_type} for the linked material.")[:260],
    }
    if seq_intent:
        step["sequence_intent"] = seq_intent
    step["authoring_checklist"] = _route_step_default_checklist(
        action_type="use_task_type_progression",
        task_type=task_type,
        progression_is_fixed=progression_is_fixed,
        sequence_intent=seq_intent,
        route_surface=route_surface,
    )
    return step


def _build_microcards_route_step(
    rid: str,
    step_index: int,
    *,
    purpose: str,
) -> Dict[str, Any]:
    return {
        "step_id": f"{rid}_step_{step_index}",
        "action_type": "add_microcards",
        "microcard_mode": "pair_match",
        "purpose": _s(purpose)[:260] or "Add pair_match microcards for short reinforcement loops.",
        "authoring_checklist": _route_step_default_checklist(action_type="add_microcards"),
    }


def _route_effort_for_steps(steps: List[Dict[str, Any]], *, surface: str) -> str:
    step_count = len([s for s in steps if isinstance(s, dict)])
    if surface == "mixed":
        return "high" if step_count >= 2 else "medium"
    if surface == "editor_manual":
        return "medium" if step_count >= 2 else "low"
    if surface == "microcards":
        return "low"
    return "medium" if step_count <= 2 else "high"


def _merge_route_refs_from_sources(*sources: Dict[str, Any]) -> Tuple[List[str], List[int]]:
    chunk_ids: List[str] = []
    unit_ids: List[int] = []
    for src in sources:
        if not isinstance(src, dict):
            continue
        for cid in _uniq_strs(src.get("covers_chunk_ids")):
            if cid not in chunk_ids:
                chunk_ids.append(cid)
        for uid in _uniq_ints(src.get("covers_unit_ids")):
            if uid not in unit_ids:
                unit_ids.append(uid)
    return chunk_ids, unit_ids


def _manual_route_sort_key(entry: Dict[str, Any]) -> Tuple[int, int, int, str]:
    type_rank = {
        "OPEN_ANSWER": 0,
        "TEST": 1,
        "CLICK_TEXT": 2,
        "CLICK_WORDS": 3,
        "SEQUENCE": 4,
        "CLICK": 5,
        "DRAW": 6,
    }
    pri = {"high": 0, "medium": 1, "low": 2}
    suit = {"high": 0, "medium": 1, "low": 2, "not_recommended": 3}
    return (
        pri.get(_s(entry.get("priority"), "medium").lower(), 1),
        suit.get(_s(entry.get("suitability"), "medium").lower(), 1),
        type_rank.get(_s(entry.get("task_type")).upper(), 9),
        _s(entry.get("task_type")).upper(),
    )


def _derive_routes(type_entries: List[Dict[str, Any]], future_caps: List[Dict[str, Any]], units: List[Dict[str, Any]], chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    all_unit_ids = [int(u["id"]) for u in units if isinstance(u, dict) and str(u.get("id")).strip()]
    all_chunk_ids = [str(c["id"]) for c in chunks if isinstance(c, dict) and _s(c.get("id"))]
    out: List[Dict[str, Any]] = []
    used = set()

    eligible = [
        e
        for e in _sort_type_entries(type_entries)
        if _s(e.get("availability"), "implemented").lower() == "implemented"
        and _s(e.get("suitability"), "medium").lower() in {"high", "medium", "low"}
        and _s(e.get("suitability")).lower() != "not_recommended"
        and _s(e.get("task_type")).upper() in _TASK_TYPES
    ]

    def _append_route(route: Dict[str, Any]) -> None:
        if not isinstance(route, dict):
            return
        route_obj = dict(route)
        route_id = _s(route_obj.get("id"))
        if not route_id:
            route_id = _norm_id(None, "route", len(out) + 1, used)
        else:
            # Callers reserve ids before building routes; keep them stable and register once.
            used.add(route_id)
        route_obj["id"] = route_id
        route_obj["anti_patterns"] = _str_list(route_obj.get("anti_patterns"), max_items=8) or _route_default_anti_patterns(route_obj)
        route_obj["expected_effect"] = _s(route_obj.get("expected_effect"))[:400] or _route_default_expected_effect(route_obj)
        route_obj["effort_estimate"] = _s(route_obj.get("effort_estimate"), "medium").lower()
        if route_obj["effort_estimate"] not in _PRIORITY:
            route_obj["effort_estimate"] = "medium"
        out.append(route_obj)

    core_candidates = [
        e
        for e in eligible
        if _s(e.get("complex_role"), "core").lower() == "core"
    ]
    complex_primary = core_candidates[0] if core_candidates else (eligible[0] if eligible else None)
    complex_finisher = next(
        (
            e
            for e in eligible
            if e is not complex_primary and _s(e.get("complex_role")).lower() in {"finisher_special", "core"}
        ),
        None,
    )
    if isinstance(complex_primary, dict):
        rid = _norm_id(None, "route", len(out) + 1, used)
        steps = [
            _build_progression_route_step(
                rid,
                1,
                complex_primary,
                route_surface="complexes",
                purpose="Run the primary progression first to establish structure and baseline coverage.",
            )
        ]
        sources = [complex_primary]
        if isinstance(complex_finisher, dict):
            steps.append(
                _build_progression_route_step(
                    rid,
                    2,
                    complex_finisher,
                    route_surface="complexes",
                    purpose="Add a complementary/finisher step after the primary progression to reduce blind spots.",
                )
            )
            sources.append(complex_finisher)
        chunk_ids, unit_ids = _merge_route_refs_from_sources(*sources)
        if not unit_ids:
            unit_ids = list(all_unit_ids)
        if not chunk_ids:
            chunk_ids = list(all_chunk_ids)
        _append_route(
            {
                "id": rid,
                "title": f"Complexes route: {_s(complex_primary.get('task_type')).upper()} progression",
                "route_kind": "complex_progression",
                "target_surface": "complexes",
                "chunk_ids": chunk_ids,
                "unit_ids": unit_ids,
                "steps": steps,
                "effort_estimate": _route_effort_for_steps(steps, surface="complexes"),
                "expected_effect": "Provides a concrete complex-oriented progression with explicit step order and coverage intent.",
                "anti_patterns": _route_default_anti_patterns({"target_surface": "complexes", "steps": steps}),
            }
        )

    manual_candidates = sorted(eligible, key=_manual_route_sort_key)
    manual_primary = manual_candidates[0] if manual_candidates else None
    manual_secondary = next(
        (
            e
            for e in manual_candidates[1:]
            if _s(e.get("task_type")).upper() != _s((manual_primary or {}).get("task_type")).upper()
            or _s(e.get("subtype")) != _s((manual_primary or {}).get("subtype"))
        ),
        None,
    )
    if isinstance(manual_primary, dict):
        rid = _norm_id(None, "route", len(out) + 1, used)
        manual_steps = [
            _build_progression_route_step(
                rid,
                1,
                manual_primary,
                route_surface="editor_manual",
                purpose="Author the first grounded task batch manually in the editor for the linked chunk(s).",
            )
        ]
        sources = [manual_primary]
        if isinstance(manual_secondary, dict):
            manual_steps.append(
                _build_progression_route_step(
                    rid,
                    2,
                    manual_secondary,
                    route_surface="editor_manual",
                    purpose="Add a second task type manually to cover a different cognitive demand without guessing the next step.",
                )
            )
            sources.append(manual_secondary)
        chunk_ids, unit_ids = _merge_route_refs_from_sources(*sources)
        if not unit_ids:
            unit_ids = list(all_unit_ids)
        if not chunk_ids:
            chunk_ids = list(all_chunk_ids)
        _append_route(
            {
                "id": rid,
                "title": "Manual editor route (grounded practice)",
                "route_kind": "manual_practice",
                "target_surface": "editor_manual",
                "chunk_ids": chunk_ids,
                "unit_ids": unit_ids,
                "steps": manual_steps,
                "effort_estimate": _route_effort_for_steps(manual_steps, surface="editor_manual"),
                "expected_effect": "Converts the analysis into concrete editor actions with explicit step-by-step authoring guidance.",
                "anti_patterns": _route_default_anti_patterns({"target_surface": "editor_manual", "steps": manual_steps}),
            }
        )

    pair = next((fc for fc in future_caps if _s(fc.get("capability_id")).lower() == "pair_matching"), None)
    pair_supported = isinstance(pair, dict) and _s(pair.get("suitability"), "low").lower() in {"high", "medium"}
    if pair_supported:
        rid = _norm_id(None, "route", len(out) + 1, used)
        mc_step = _build_microcards_route_step(
            rid,
            1,
            purpose=_s(pair.get("why"))[:220] or "Use pair_match microcards to reinforce term-definition and category-feature links.",
        )
        _append_route(
            {
                "id": rid,
                "title": "Microcards route: pair_match reinforcement",
                "route_kind": "microcards_support",
                "target_surface": "microcards",
                "chunk_ids": _uniq_strs(pair.get("covers_chunk_ids")),
                "unit_ids": _uniq_ints(pair.get("covers_unit_ids")),
                "steps": [mc_step],
                "effort_estimate": _route_effort_for_steps([mc_step], surface="microcards"),
                "expected_effect": "Strengthens pair associations with a short review loop after authoring the main practice set.",
                "anti_patterns": _route_default_anti_patterns({"target_surface": "microcards", "steps": [mc_step]}),
            }
        )

    hybrid_primary = next(
        (
            e
            for e in eligible
            if _s(e.get("task_type")).upper() == "SEQUENCE"
        ),
        complex_primary or manual_primary,
    )
    if pair_supported and isinstance(hybrid_primary, dict):
        rid = _norm_id(None, "route", len(out) + 1, used)
        hybrid_steps = [
            _build_progression_route_step(
                rid,
                1,
                hybrid_primary,
                route_surface="mixed",
                purpose="Start with a structured/grounded progression to build a stable mental model.",
            ),
            _build_microcards_route_step(
                rid,
                2,
                purpose="Then add pair_match microcards for spaced repetition of key associations.",
            ),
        ]
        chunk_ids, unit_ids = _merge_route_refs_from_sources(hybrid_primary, pair or {})
        _append_route(
            {
                "id": rid,
                "title": "Hybrid route: progression + microcards",
                "route_kind": "hybrid",
                "target_surface": "mixed",
                "chunk_ids": chunk_ids,
                "unit_ids": unit_ids,
                "steps": hybrid_steps,
                "effort_estimate": _route_effort_for_steps(hybrid_steps, surface="mixed"),
                "expected_effect": "Combines initial authoring/complex progression with follow-up retention practice in microcards.",
                "anti_patterns": _route_default_anti_patterns({"target_surface": "mixed", "steps": hybrid_steps}),
            }
        )

    return out


def _normalize_routes(raw: Any, type_entries: List[Dict[str, Any]], future_caps: List[Dict[str, Any]], units: List[Dict[str, Any]], chunks: List[Dict[str, Any]], warnings: List[str]) -> List[Dict[str, Any]]:
    valid_unit_ids = {int(u["id"]) for u in units}
    valid_chunk_ids = {str(c["id"]) for c in chunks}
    fixed_task_types = {_s(e.get("task_type")).upper() for e in type_entries if _b(e.get("progression_is_fixed"))}
    type_entry_by_key = {
        (
            _s(e.get("task_type")).upper(),
            _s(e.get("subtype")).lower() or "",
        ): e
        for e in type_entries
        if isinstance(e, dict) and _s(e.get("task_type"))
    }
    pair_fc = next((fc for fc in future_caps if _s(fc.get("capability_id")).lower() == "pair_matching"), None)
    src = raw if isinstance(raw, list) and raw else _derive_routes(type_entries, future_caps, units, chunks)
    out: List[Dict[str, Any]] = []
    used = set()
    dropped = False
    for idx, raw_route in enumerate(src, start=1):
        if not isinstance(raw_route, dict):
            continue
        r = dict(raw_route)
        rid = _norm_id(r.get("id"), "route", idx, used)
        cu_raw = _uniq_ints(r.get("unit_ids"))
        cc_raw = _uniq_strs(r.get("chunk_ids"))
        cu = _uniq_ints(r.get("unit_ids"), allowed=valid_unit_ids)
        cc = _uniq_strs(r.get("chunk_ids"), allowed=valid_chunk_ids)
        if len(cu) != len(cu_raw) or len(cc) != len(cc_raw):
            dropped = True
        route_kind = _s(r.get("route_kind"), "complex_progression").lower()
        if route_kind not in {"complex_progression", "manual_practice", "microcards_support", "hybrid"}:
            route_kind = "complex_progression"
        target_surface = _s(r.get("target_surface"), "complexes").lower()
        if target_surface not in _SURFACES:
            target_surface = "complexes"
        steps_out = []
        for sidx, raw_step in enumerate(r.get("steps") or [], start=1):
            if not isinstance(raw_step, dict):
                continue
            st = dict(raw_step)
            action = _s(st.get("action_type")).lower()
            if action not in {"use_task_type_progression", "add_microcards"}:
                continue
            step = {"step_id": _norm_id(st.get("step_id"), f"{rid}_step", sidx, set()), "action_type": action, "purpose": _s(st.get("purpose"))[:260] or "Normalized route step."}
            derived_checklist: List[str] = []
            route_surface = target_surface
            if action == "use_task_type_progression":
                task_type = _s(st.get("task_type")).upper()
                if not task_type:
                    continue
                step["task_type"] = task_type
                subtype = _s(st.get("subtype"))
                step["subtype"] = subtype if subtype and subtype.lower() != "null" else None
                pol = _s(st.get("progression_policy")).lower()
                if task_type in fixed_task_types and pol == "pick_only_level":
                    pol = "full_fixed_progression"
                    _append_unique(warnings, "analysis_json v2 normalizer: rewrote forbidden pick_only_level route step.")
                if pol not in {"full_fixed_progression", "not_fixed"}:
                    pol = "full_fixed_progression" if task_type in fixed_task_types else "not_fixed"
                step["progression_policy"] = pol
                seq_intent = _s(st.get("sequence_intent")).lower()
                if seq_intent in _SEQ_INTENTS:
                    step["sequence_intent"] = seq_intent
                matched_entry = type_entry_by_key.get((task_type, _s(step.get("subtype")).lower() or "")) or type_entry_by_key.get((task_type, ""))
                derived_checklist = _route_step_default_checklist(
                    action_type="use_task_type_progression",
                    task_type=task_type,
                    progression_is_fixed=_b(((matched_entry or {}).get("progression_is_fixed")), task_type in fixed_task_types),
                    sequence_intent=_s(step.get("sequence_intent")).lower() if step.get("sequence_intent") else None,
                    route_surface=route_surface,
                )
            else:
                step["microcard_mode"] = "pair_match"
                derived_checklist = _route_step_default_checklist(action_type="add_microcards")
            checklist = _str_list(st.get("authoring_checklist"), max_items=8)
            if not checklist:
                checklist = derived_checklist
            if checklist:
                step["authoring_checklist"] = checklist
            steps_out.append(step)
        if not steps_out:
            continue
        effort = _s(r.get("effort_estimate"), "medium").lower()
        if effort not in _PRIORITY:
            effort = "medium"
        route_obj = {
            "id": rid,
            "title": _s(r.get("title"))[:160] or rid,
            "route_kind": route_kind,
            "target_surface": target_surface,
            "chunk_ids": cc,
            "unit_ids": cu,
            "steps": steps_out,
            "effort_estimate": effort,
            "expected_effect": _s(r.get("expected_effect"))[:400] or "",
            "anti_patterns": _str_list(r.get("anti_patterns"), max_items=8),
        }
        if not route_obj["expected_effect"]:
            route_obj["expected_effect"] = _route_default_expected_effect(route_obj)
        if not route_obj["anti_patterns"]:
            route_obj["anti_patterns"] = _route_default_anti_patterns(route_obj)
        out.append(
            route_obj
        )

    existing_keys = {
        (
            _s(r.get("route_kind")).lower(),
            _s(r.get("target_surface")).lower(),
        )
        for r in out
        if isinstance(r, dict)
    }
    derived_candidates = _derive_routes(type_entries, future_caps, units, chunks)
    supplemented = False
    for dr in derived_candidates:
        if not isinstance(dr, dict):
            continue
        key = (_s(dr.get("route_kind")).lower(), _s(dr.get("target_surface")).lower())
        if key in existing_keys:
            continue
        obj = dict(dr)
        obj["id"] = _norm_id(obj.get("id"), "route", len(out) + 1, used)
        out.append(obj)
        existing_keys.add(key)
        supplemented = True
    if supplemented:
        _append_unique(warnings, "analysis_json v2 normalizer: supplemented authoring_routes with practical surface routes.")
    if dropped:
        _append_unique(warnings, "analysis_json v2 normalizer: dropped broken refs in authoring_routes.")
    return out


def _sync_chunk_route_ids(chunks: List[Dict[str, Any]], routes: List[Dict[str, Any]]) -> None:
    route_ids = {str(r["id"]) for r in routes}
    by_chunk = {str(c["id"]): [] for c in chunks}
    for r in routes:
        rid = str(r["id"])
        for cid in r.get("chunk_ids") or []:
            cid_s = _s(cid)
            if cid_s in by_chunk and rid not in by_chunk[cid_s]:
                by_chunk[cid_s].append(rid)
    for c in chunks:
        existing = _uniq_strs(c.get("route_ids"), allowed=route_ids)
        for rid in by_chunk.get(str(c["id"]), []):
            if rid not in existing:
                existing.append(rid)
        c["route_ids"] = existing


def _derive_coverage_plan(units: List[Dict[str, Any]], chunks: List[Dict[str, Any]], type_entries: List[Dict[str, Any]], routes: List[Dict[str, Any]], future_caps: List[Dict[str, Any]]) -> Dict[str, Any]:
    pair = next((fc for fc in future_caps if _s(fc.get("capability_id")).lower() == "pair_matching"), None)
    pair_unit_ids = set(_uniq_ints((pair or {}).get("covers_unit_ids")))
    types_by_unit: Dict[int, List[str]] = {}
    for e in type_entries:
        t = _s(e.get("task_type")).upper()
        for uid in _uniq_ints(e.get("covers_unit_ids")):
            types_by_unit.setdefault(uid, [])
            if t and t not in types_by_unit[uid]:
                types_by_unit[uid].append(t)
    route_ids_by_chunk: Dict[str, List[str]] = {str(c["id"]): [] for c in chunks}
    for r in routes:
        rid = _s(r.get("id"))
        for cid in r.get("chunk_ids") or []:
            cid_s = _s(cid)
            if cid_s in route_ids_by_chunk and rid not in route_ids_by_chunk[cid_s]:
                route_ids_by_chunk[cid_s].append(rid)
    return {
        "coverage_plan_version": "1.0",
        "target_coverage": {"all_units_min_once": True, "high_risk_units_priority": True},
        "unit_targets": [
            {
                "unit_id": int(u["id"]),
                "must_cover": True,
                "recommended_surfaces": ["complexes", "microcards"] if int(u["id"]) in pair_unit_ids else ["complexes"],
                "preferred_task_types": types_by_unit.get(int(u["id"]), [])[:5],
                "avoid_overtesting_with": [],
            }
            for u in units
        ],
        "chunk_targets": [
            {
                "chunk_id": str(c["id"]),
                "route_ids": route_ids_by_chunk.get(str(c["id"]), []),
                "max_primary_tasks_recommended": 3,
            }
            for c in chunks
        ],
    }


def _normalize_coverage_plan(raw: Any, units: List[Dict[str, Any]], chunks: List[Dict[str, Any]], type_entries: List[Dict[str, Any]], routes: List[Dict[str, Any]], future_caps: List[Dict[str, Any]], warnings: List[str]) -> Dict[str, Any]:
    valid_unit_ids = {int(u["id"]) for u in units}
    valid_chunk_ids = {str(c["id"]) for c in chunks}
    valid_route_ids = {str(r["id"]) for r in routes}
    src = raw if isinstance(raw, dict) and raw else _derive_coverage_plan(units, chunks, type_entries, routes, future_caps)
    out = {
        "coverage_plan_version": "1.0",
        "target_coverage": {
            "all_units_min_once": _b(((src.get("target_coverage") or {}) if isinstance(src.get("target_coverage"), dict) else {}).get("all_units_min_once"), True),
            "high_risk_units_priority": _b(((src.get("target_coverage") or {}) if isinstance(src.get("target_coverage"), dict) else {}).get("high_risk_units_priority"), True),
        },
        "unit_targets": [],
        "chunk_targets": [],
    }
    dropped = False
    seen_units = set()
    for it in src.get("unit_targets") or []:
        if not isinstance(it, dict):
            continue
        uid = _i(it.get("unit_id"), 0)
        if uid not in valid_unit_ids or uid in seen_units:
            if uid:
                dropped = True
            continue
        seen_units.add(uid)
        surfaces = [s for s in _uniq_strs(it.get("recommended_surfaces")) if s in _SURFACES] or ["complexes"]
        out["unit_targets"].append(
            {
                "unit_id": uid,
                "must_cover": _b(it.get("must_cover"), True),
                "recommended_surfaces": surfaces,
                "preferred_task_types": [t.upper() for t in _uniq_strs(it.get("preferred_task_types")) if t.upper() in _TASK_TYPES][:6],
                "avoid_overtesting_with": [t.upper() for t in _uniq_strs(it.get("avoid_overtesting_with")) if t.upper() in _TASK_TYPES][:6],
            }
        )
    if len(out["unit_targets"]) < len(valid_unit_ids):
        derived = _derive_coverage_plan(units, chunks, type_entries, routes, future_caps)
        have = {int(x["unit_id"]) for x in out["unit_targets"]}
        for it in derived["unit_targets"]:
            if int(it["unit_id"]) not in have:
                out["unit_targets"].append(it)
    seen_chunks = set()
    for it in src.get("chunk_targets") or []:
        if not isinstance(it, dict):
            continue
        cid = _s(it.get("chunk_id"))
        if cid not in valid_chunk_ids or cid in seen_chunks:
            if cid:
                dropped = True
            continue
        seen_chunks.add(cid)
        rr_raw = _uniq_strs(it.get("route_ids"))
        rr = _uniq_strs(it.get("route_ids"), allowed=valid_route_ids)
        if len(rr) != len(rr_raw):
            dropped = True
        out["chunk_targets"].append({"chunk_id": cid, "route_ids": rr, "max_primary_tasks_recommended": max(1, min(10, _i(it.get("max_primary_tasks_recommended"), 3)))})
    if len(out["chunk_targets"]) < len(valid_chunk_ids):
        derived = _derive_coverage_plan(units, chunks, type_entries, routes, future_caps)
        have = {str(x["chunk_id"]) for x in out["chunk_targets"]}
        for it in derived["chunk_targets"]:
            if str(it["chunk_id"]) not in have:
                out["chunk_targets"].append(it)
    if dropped:
        _append_unique(warnings, "analysis_json v2 normalizer: dropped broken refs in coverage_plan.")
    return out


def _derive_microcards(units: List[Dict[str, Any]], future_caps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    pair = next((fc for fc in future_caps if _s(fc.get("capability_id")).lower() == "pair_matching"), None)
    pair_ok = _s((pair or {}).get("suitability"), "low").lower() in {"high", "medium"}
    pair_unit_ids = set(_uniq_ints((pair or {}).get("covers_unit_ids")))
    out: List[Dict[str, Any]] = []
    for idx, u in enumerate(units[:10], start=1):
        uid = int(u["id"])
        chunk_id = _s((u.get("chunk_ids") or [None])[0])
        if not chunk_id:
            continue
        utype = _s(u.get("type"), "fact").lower()
        if utype == "term":
            card_type = "term_definition"
        elif utype == "process":
            card_type = "cloze"
        elif pair_ok and (utype == "classification" or uid in pair_unit_ids):
            card_type = "pair_match"
        else:
            has_numeric = any(_s(a.get("kind")).lower() in {"number", "date", "threshold"} for a in (u.get("factual_anchors") or []) if isinstance(a, dict))
            card_type = "numeric_anchor" if has_numeric else "fact_recall"
        anchors = [_s(a.get("value")) for a in (u.get("factual_anchors") or []) if isinstance(a, dict) and _s(a.get("value"))][:4]
        out.append(
            {
                "candidate_id": f"mc_cand_{idx}",
                "unit_id": uid,
                "chunk_id": chunk_id,
                "card_type": card_type,
                "priority": "high" if _s(u.get("assessment_risk")).lower() == "high" else "medium",
                "prompt_seed": _s(u.get("title"))[:180],
                "answer_seed": (_s(u.get("description")) or _s(u.get("evidence")))[:220],
                "anchors": anchors,
                "author_review_required": True,
                "why": "Derived from educational unit for microcards review.",
            }
        )
    return out


def _normalize_microcards(raw: Any, units: List[Dict[str, Any]], chunks: List[Dict[str, Any]], future_caps: List[Dict[str, Any]], warnings: List[str]) -> List[Dict[str, Any]]:
    valid_unit_ids = {int(u["id"]) for u in units}
    valid_chunk_ids = {str(c["id"]) for c in chunks}
    first_chunk_for_unit = {int(u["id"]): _s((u.get("chunk_ids") or [None])[0]) for u in units}
    src = raw if isinstance(raw, list) and raw else _derive_microcards(units, future_caps)
    out: List[Dict[str, Any]] = []
    used = set()
    dropped = False
    for idx, raw_c in enumerate(src, start=1):
        if not isinstance(raw_c, dict):
            continue
        c = dict(raw_c)
        cid = _norm_id(c.get("candidate_id"), "mc_cand", idx, used)
        uid = _i(c.get("unit_id"), 0)
        if uid not in valid_unit_ids:
            dropped = True
            continue
        chunk_id = _s(c.get("chunk_id"))
        if chunk_id not in valid_chunk_ids:
            fallback_chunk = _s(first_chunk_for_unit.get(uid))
            if fallback_chunk in valid_chunk_ids:
                chunk_id = fallback_chunk
        if chunk_id not in valid_chunk_ids:
            dropped = True
            continue
        card_type = _s(c.get("card_type"), "fact_recall").lower()
        if card_type not in {"fact_recall", "term_definition", "cloze", "pair_match", "numeric_anchor", "contrast_pair"}:
            card_type = "fact_recall"
        pr = _s(c.get("priority"), "medium").lower()
        if pr not in _PRIORITY:
            pr = "medium"
        out.append(
            {
                "candidate_id": cid,
                "unit_id": uid,
                "chunk_id": chunk_id,
                "card_type": card_type,
                "priority": pr,
                "prompt_seed": _s(c.get("prompt_seed"))[:220],
                "answer_seed": _s(c.get("answer_seed"))[:240],
                "anchors": _str_list(c.get("anchors"), max_items=6),
                "author_review_required": _b(c.get("author_review_required"), True),
                "why": _s(c.get("why"))[:320] or "Normalized microcards candidate.",
            }
        )
    if dropped:
        _append_unique(warnings, "analysis_json v2 normalizer: dropped broken refs in microcards_candidates.")
    return out


def _normalize_report_blocks(
    raw: Any,
    units: List[Dict[str, Any]],
    chunks: List[Dict[str, Any]],
    routes: List[Dict[str, Any]],
    type_entries: List[Dict[str, Any]],
    warnings: List[str],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    allowed_types = {
        "section",
        "callout",
        "chunk_card",
        "progression_matrix",
        "route_card",
        "coverage_table",
        "microcards_preview",
        "toc",
        "divider",
        "list",
    }
    tones = {"neutral", "info", "success", "warning", "risk"}
    callout_variants = {"tip", "warning", "risk", "note"}
    valid_unit_ids = {int(u["id"]) for u in units if isinstance(u, dict) and str(u.get("id")).strip()}
    valid_chunk_ids = {str(c["id"]) for c in chunks if isinstance(c, dict) and _s(c.get("id"))}
    valid_route_ids = {str(r["id"]) for r in routes if isinstance(r, dict) and _s(r.get("id"))}
    valid_progression_task_types = {
        _s(e.get("task_type")).upper()
        for e in type_entries
        if isinstance(e, dict) and _s(e.get("task_type"))
    } | set(_TASK_TYPES)

    def _norm_anchor(value: Any) -> Optional[str]:
        txt = _s(value).lower()
        if not txt:
            return None
        txt = re.sub(r"[^a-z0-9_-]+", "-", txt)
        txt = re.sub(r"-{2,}", "-", txt).strip("-_")
        return txt[:80] if txt else None

    def _norm_text(value: Any, max_chars: int = 600) -> str:
        return _s(value)[:max_chars]

    def _split_sentences(text: str) -> List[str]:
        txt = _s(text)
        if not txt:
            return []
        parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", txt) if _s(p)]
        return parts or ([txt] if txt else [])

    def _limit_sentences(text: str, max_sentences: int = 3) -> Tuple[str, bool]:
        parts = _split_sentences(text)
        if len(parts) <= max_sentences:
            return _s(text), False
        return " ".join(parts[:max_sentences]).strip(), True

    def _normalize_refs(raw_refs: Any) -> Tuple[Dict[str, Any], int]:
        refs_src = raw_refs if isinstance(raw_refs, dict) else {}
        refs: Dict[str, Any] = {}
        dropped = 0
        raw_unit_ids = _uniq_ints(refs_src.get("unit_ids"))
        unit_ids = _uniq_ints(refs_src.get("unit_ids"), allowed=valid_unit_ids)
        dropped += max(0, len(raw_unit_ids) - len(unit_ids))
        if unit_ids:
            refs["unit_ids"] = unit_ids

        raw_chunk_refs = _uniq_strs(refs_src.get("chunk_ids"))
        chunk_refs = _uniq_strs(refs_src.get("chunk_ids"), allowed=valid_chunk_ids)
        dropped += max(0, len(raw_chunk_refs) - len(chunk_refs))
        if chunk_refs:
            refs["chunk_ids"] = chunk_refs

        raw_route_refs = _uniq_strs(refs_src.get("route_ids"))
        route_refs = _uniq_strs(refs_src.get("route_ids"), allowed=valid_route_ids)
        dropped += max(0, len(raw_route_refs) - len(route_refs))
        if route_refs:
            refs["route_ids"] = route_refs
        return refs, dropped

    def _normalize_lint_meta(raw_lint: Any) -> Tuple[Dict[str, Any], int]:
        src = raw_lint if isinstance(raw_lint, dict) else {}
        out: Dict[str, Any] = {}
        adjustments = 0
        dedupe_key = _s(src.get("dedupe_key"))
        if dedupe_key:
            out["dedupe_key"] = dedupe_key[:120]
            if out["dedupe_key"] != dedupe_key:
                adjustments += 1
        if "max_chars" in src:
            max_chars = max(80, min(600, _i(src.get("max_chars"), 600)))
            out["max_chars"] = max_chars
            try:
                if int(src.get("max_chars")) != max_chars:
                    adjustments += 1
            except Exception:
                adjustments += 1
        return out, adjustments

    def _enforce_narrative_char_limit(block_type: str, body: Dict[str, Any], limit: int) -> Tuple[Dict[str, Any], int]:
        if block_type not in {"section", "callout"} or limit <= 0:
            return body, 0
        changes = 0
        b = dict(body)
        if block_type == "section":
            summary = _s(b.get("summary"))
            if len(summary) > limit:
                b["summary"] = summary[: max(0, limit - 1)].rstrip() + ("..." if limit > 0 else "")
                changes += 1
            return b, changes

        # callout: trim bullets first, then text, to keep the main signal short but intact if possible
        text = _s(b.get("text"))
        bullets = [str(x) for x in (b.get("bullets") or []) if _s(x)]

        def _total_chars() -> int:
            return len(text) + sum(len(x) for x in bullets)

        while bullets and _total_chars() > limit:
            bullets.pop()
            changes += 1
        if _total_chars() > limit and text:
            allowed = max(0, limit - sum(len(x) for x in bullets))
            if len(text) > allowed:
                text = text[: max(0, allowed - 1)].rstrip() + ("..." if allowed > 0 else "")
                changes += 1

        if _total_chars() > limit and bullets:
            # last-resort trimming inside remaining bullets
            total_bullets = sum(len(x) for x in bullets)
            overflow = _total_chars() - limit
            if total_bullets > 0 and overflow > 0:
                for idx in range(len(bullets) - 1, -1, -1):
                    if overflow <= 0:
                        break
                    current = bullets[idx]
                    if not current:
                        continue
                    cut = min(len(current), overflow)
                    new_len = max(0, len(current) - cut)
                    bullets[idx] = current[: max(0, new_len - 1)].rstrip() + ("..." if new_len > 0 else "")
                    overflow = (len(text) + sum(len(x) for x in bullets)) - limit
                    changes += 1
        b["text"] = text
        if bullets:
            b["bullets"] = bullets
        elif "bullets" in b:
            b.pop("bullets", None)
        return b, changes

    def _canonical_narrative_key(block: Dict[str, Any]) -> Optional[str]:
        btype = _s(block.get("type")).lower()
        lint = block.get("lint") if isinstance(block.get("lint"), dict) else {}
        dedupe_key = _s(lint.get("dedupe_key"))
        if dedupe_key:
            return f"{btype}:{dedupe_key.lower()}"
        body = block.get("body") if isinstance(block.get("body"), dict) else {}
        if btype == "section":
            summary = _s(body.get("summary")).lower()
            return f"section:{summary}" if summary else None
        if btype == "callout":
            variant = _s(body.get("variant"), "note").lower()
            text = _s(body.get("text")).lower()
            bullets = "|".join(_s(x).lower() for x in (body.get("bullets") or []))
            blob = f"{variant}|{text}|{bullets}".strip("|")
            return f"callout:{blob}" if blob else None
        return None

    def _risk_from_metrics(metrics: Dict[str, int], block_count: int) -> str:
        score = 0
        score += min(4, metrics.get("duplicate_content_signals", 0))
        score += min(4, metrics.get("narrative_adjustments", 0))
        score += min(4, metrics.get("dropped_blocks", 0) * 2)
        if metrics.get("narrative_chars", 0) > 1200:
            score += 1
        if block_count > 20:
            score += 1
        if block_count > 35:
            score += 2
        if score >= 6:
            return "high"
        if score >= 2:
            return "medium"
        return "low"

    raw_blocks = raw if isinstance(raw, list) else []
    out: List[Dict[str, Any]] = []
    used_ids = set()
    seen_chunk_cards = set()
    seen_route_cards = set()
    seen_narrative_keys = set()
    narrative_unit_mentions: Dict[int, int] = {}
    metrics: Dict[str, int] = {
        "duplicate_content_signals": 0,
        "narrative_adjustments": 0,
        "dropped_blocks": 0,
        "structural_invalid": 0,
        "narrative_chars": 0,
        "raw_block_count": len(raw_blocks),
    }

    for idx, item in enumerate(raw_blocks, start=1):
        if not isinstance(item, dict):
            metrics["dropped_blocks"] += 1
            metrics["structural_invalid"] += 1
            continue
        bid = _norm_id(item.get("id"), "rb", idx, used_ids)
        btype = _s(item.get("type") or item.get("block_type")).lower()
        if btype not in allowed_types:
            metrics["dropped_blocks"] += 1
            metrics["structural_invalid"] += 1
            continue

        body_src = item.get("body") if "body" in item else item.get("data")
        if body_src is None:
            body_src = {}
        if not isinstance(body_src, dict):
            # v1 blocks use object body; keep non-object layouts out of renderer path
            metrics["dropped_blocks"] += 1
            metrics["structural_invalid"] += 1
            continue

        refs, dropped_refs = _normalize_refs(item.get("refs"))
        if dropped_refs:
            metrics["structural_invalid"] += 1
            metrics["narrative_adjustments"] += 1
        lint_meta, lint_adj = _normalize_lint_meta(item.get("lint"))
        metrics["narrative_adjustments"] += lint_adj

        body: Dict[str, Any] = {}
        drop_block = False

        if btype == "toc":
            items_src = body_src.get("items") if isinstance(body_src.get("items"), list) else []
            items_out = []
            seen_anchors = set()
            for toc_item in items_src:
                if not isinstance(toc_item, dict):
                    continue
                label = _s(toc_item.get("label"))[:120]
                anchor = _norm_anchor(toc_item.get("anchor"))
                if not label or not anchor:
                    continue
                if anchor in seen_anchors:
                    metrics["duplicate_content_signals"] += 1
                    continue
                seen_anchors.add(anchor)
                items_out.append({"label": label, "anchor": anchor})
            if not items_out:
                drop_block = True
                metrics["structural_invalid"] += 1
            else:
                body = {"items": items_out}

        elif btype == "section":
            summary = _norm_text(body_src.get("summary"), 2000)
            if summary:
                summary_limited, trimmed_sentences = _limit_sentences(summary, max_sentences=3)
                if trimmed_sentences:
                    metrics["narrative_adjustments"] += 1
                summary = summary_limited
            subanchors_src = body_src.get("subanchors") if isinstance(body_src.get("subanchors"), list) else []
            subanchors: List[str] = []
            seen_subanchors = set()
            for raw_anchor in subanchors_src:
                anchor = _norm_anchor(raw_anchor)
                if not anchor:
                    continue
                if anchor in seen_subanchors:
                    metrics["duplicate_content_signals"] += 1
                    continue
                seen_subanchors.add(anchor)
                subanchors.append(anchor)
                if len(subanchors) >= 8:
                    break
            body = {}
            if summary:
                body["summary"] = summary
            if subanchors:
                body["subanchors"] = subanchors
            if not body:
                # title-only section is allowed, but keep empty body deterministic
                body = {}

        elif btype == "callout":
            variant = _s(body_src.get("variant"), "note").lower()
            if variant not in callout_variants:
                variant = "note"
                metrics["narrative_adjustments"] += 1
            text = _norm_text(body_src.get("text"), 1200)
            bullets_src = body_src.get("bullets") if isinstance(body_src.get("bullets"), list) else []
            raw_bullet_count = len(bullets_src)
            bullets = _str_list(bullets_src, max_items=3)
            if len(bullets) < raw_bullet_count:
                metrics["narrative_adjustments"] += 1
                metrics["duplicate_content_signals"] += max(0, raw_bullet_count - len(bullets))
            bullets = [b[:160] for b in bullets]
            body = {"variant": variant}
            if text:
                body["text"] = text
            if bullets:
                body["bullets"] = bullets
            if not body.get("text") and not body.get("bullets"):
                drop_block = True
                metrics["structural_invalid"] += 1

        elif btype == "chunk_card":
            chunk_id = _s(body_src.get("chunk_id"))
            if chunk_id not in valid_chunk_ids:
                drop_block = True
                metrics["structural_invalid"] += 1
            elif chunk_id in seen_chunk_cards:
                metrics["duplicate_content_signals"] += 1
                continue
            else:
                seen_chunk_cards.add(chunk_id)
                body = {
                    "chunk_id": chunk_id,
                    "show_units": _b(body_src.get("show_units"), True),
                    "show_confusions": _b(body_src.get("show_confusions"), True),
                    "show_route_links": _b(body_src.get("show_route_links"), True),
                }

        elif btype == "progression_matrix":
            rows_src = body_src.get("rows") if isinstance(body_src.get("rows"), list) else []
            rows_out = []
            seen_rows = set()
            for row in rows_src:
                if not isinstance(row, dict):
                    continue
                task_type = _s(row.get("task_type")).upper()
                if task_type not in valid_progression_task_types:
                    metrics["structural_invalid"] += 1
                    continue
                if task_type in seen_rows:
                    metrics["duplicate_content_signals"] += 1
                    continue
                seen_rows.add(task_type)
                suitability = _s(row.get("suitability"), "medium").lower()
                if suitability not in {"high", "medium", "low", "not_recommended"}:
                    suitability = "medium"
                    metrics["narrative_adjustments"] += 1
                rows_out.append(
                    {
                        "task_type": task_type,
                        "suitability": suitability,
                        "show_level_roles": _b(row.get("show_level_roles"), True),
                        "show_iterative_notes": _b(row.get("show_iterative_notes"), True),
                    }
                )
            if not rows_out:
                drop_block = True
                metrics["structural_invalid"] += 1
            else:
                body = {"rows": rows_out}

        elif btype == "route_card":
            route_id = _s(body_src.get("route_id"))
            if route_id not in valid_route_ids:
                drop_block = True
                metrics["structural_invalid"] += 1
            elif route_id in seen_route_cards:
                metrics["duplicate_content_signals"] += 1
                continue
            else:
                seen_route_cards.add(route_id)
                body = {
                    "route_id": route_id,
                    "show_checklists": _b(body_src.get("show_checklists"), True),
                    "show_anti_patterns": _b(body_src.get("show_anti_patterns"), True),
                }

        elif btype == "coverage_table":
            mode = _s(body_src.get("mode"), "mixed").lower()
            if mode not in {"units", "chunks", "mixed"}:
                mode = "mixed"
                metrics["narrative_adjustments"] += 1
            body = {
                "mode": mode,
                "highlight_gaps": _b(body_src.get("highlight_gaps"), True),
                "highlight_overlaps": _b(body_src.get("highlight_overlaps"), True),
            }

        elif btype == "microcards_preview":
            group_by = _s(body_src.get("group_by"), "card_type").lower()
            if group_by not in {"card_type", "chunk"}:
                group_by = "card_type"
                metrics["narrative_adjustments"] += 1
            body = {
                "max_items": max(1, min(20, _i(body_src.get("max_items"), 8))),
                "group_by": group_by,
                "show_pair_match_candidates": _b(body_src.get("show_pair_match_candidates"), True),
            }

        elif btype == "divider":
            body = {}

        elif btype == "list":
            items_src = body_src.get("items", body_src if isinstance(body_src, list) else [])
            if isinstance(items_src, list):
                items_out = []
                for raw_item in items_src:
                    if isinstance(raw_item, dict):
                        obj: Dict[str, Any] = {}
                        txt = _s(raw_item.get("text") or raw_item.get("label"))
                        if txt:
                            obj["text"] = txt[:220]
                        anchor = _norm_anchor(raw_item.get("anchor"))
                        if anchor:
                            obj["anchor"] = anchor
                        if obj:
                            items_out.append(obj)
                    else:
                        txt = _s(raw_item)
                        if txt:
                            items_out.append({"text": txt[:220]})
                    if len(items_out) >= 12:
                        break
                if not items_out:
                    drop_block = True
                    metrics["structural_invalid"] += 1
                else:
                    body = {"items": items_out}
            else:
                drop_block = True
                metrics["structural_invalid"] += 1

        if drop_block:
            metrics["dropped_blocks"] += 1
            continue

        obj: Dict[str, Any] = {"id": bid, "type": btype, "body": body}
        title = _s(item.get("title"))
        if title:
            obj["title"] = title[:180]
        anchor = _norm_anchor(item.get("anchor"))
        if anchor:
            obj["anchor"] = anchor
        if "priority" in item:
            obj["priority"] = max(-100, min(100, _i(item.get("priority"), 0)))
        if "collapsible" in item or btype == "section":
            obj["collapsible"] = _b(item.get("collapsible"), btype == "section")
        if "collapsed_by_default" in item:
            obj["collapsed_by_default"] = _b(item.get("collapsed_by_default"), False)
        tone = _s(item.get("tone"), "neutral").lower()
        if tone in tones and tone != "neutral":
            obj["tone"] = tone
        if refs:
            obj["refs"] = refs
        if lint_meta:
            obj["lint"] = lint_meta

        if btype in {"section", "callout"}:
            limit = min(600, max(80, _i((lint_meta or {}).get("max_chars"), 600)))
            trimmed_body, body_adjustments = _enforce_narrative_char_limit(btype, body, limit)
            if body_adjustments:
                metrics["narrative_adjustments"] += body_adjustments
                obj["body"] = trimmed_body
            narrative_key = _canonical_narrative_key(obj)
            if narrative_key:
                if narrative_key in seen_narrative_keys:
                    metrics["duplicate_content_signals"] += 1
                    continue
                seen_narrative_keys.add(narrative_key)
            for uid in (refs.get("unit_ids") or []):
                narrative_unit_mentions[int(uid)] = narrative_unit_mentions.get(int(uid), 0) + 1
            body_for_chars = obj.get("body") if isinstance(obj.get("body"), dict) else {}
            if btype == "section":
                metrics["narrative_chars"] += len(_s(body_for_chars.get("summary")))
            else:
                metrics["narrative_chars"] += len(_s(body_for_chars.get("text")))
                metrics["narrative_chars"] += sum(len(_s(x)) for x in (body_for_chars.get("bullets") or []))

        out.append(obj)

    repeated_unit_mentions = sum(max(0, count - 2) for count in narrative_unit_mentions.values())
    if repeated_unit_mentions:
        metrics["duplicate_content_signals"] += repeated_unit_mentions

    if metrics["raw_block_count"] and not out:
        metrics["structural_invalid"] += 1
    if metrics["dropped_blocks"] or metrics["structural_invalid"]:
        _append_unique(
            warnings,
            "analysis_json v2 report_blocks validator: invalid or unsupported blocks were dropped/sanitized.",
        )
    if metrics["narrative_adjustments"] or metrics["duplicate_content_signals"]:
        _append_unique(
            warnings,
            "analysis_json v2 report_blocks lint: anti-grafomania trimming/dedupe was applied.",
        )

    # --- Fallback: generate minimal report_blocks from analysis data if AI returned none ---
    if not out and (units or type_entries or routes or chunks):
        fb_id = 0

        def _fb_id() -> str:
            nonlocal fb_id
            fb_id += 1
            return f"rb_{fb_id}"

        toc_entries = []
        if units:
            toc_entries.append({"label": "Educational Units", "anchor": "units-overview"})
        if type_entries:
            toc_entries.append({"label": "Task Type Progression", "anchor": "progression"})
        if chunks:
            toc_entries.append({"label": "Learning Chunks", "anchor": "chunks"})
        if routes:
            toc_entries.append({"label": "Authoring Routes", "anchor": "routes"})

        if toc_entries:
            out.append({
                "id": _fb_id(), "type": "toc", "anchor": "toc",
                "title": "Contents", "body": {"items": toc_entries},
            })

        if units:
            unit_titles = [_s(u.get("title")) for u in units[:5] if _s(u.get("title"))]
            summary = f"{len(units)} educational units identified"
            if unit_titles:
                summary += f": {', '.join(unit_titles)}"
                if len(units) > 5:
                    summary += f" and {len(units) - 5} more"
                summary += "."
            out.append({
                "id": _fb_id(), "type": "section", "anchor": "units-overview",
                "title": "Educational Units Overview", "collapsible": True,
                "body": {"summary": summary[:600]},
                "refs": {"unit_ids": [int(u["id"]) for u in units if str(u.get("id")).strip()]},
            })

        if type_entries:
            pm_rows = []
            for te in type_entries:
                tt = _s(te.get("task_type")).upper()
                suit = _s(te.get("suitability"), "medium").lower()
                if tt:
                    pm_rows.append({
                        "task_type": tt, "suitability": suit,
                        "show_level_roles": True, "show_iterative_notes": True,
                    })
            if pm_rows:
                out.append({
                    "id": _fb_id(), "type": "progression_matrix", "anchor": "progression",
                    "title": "Task Type Progression", "body": {"rows": pm_rows},
                })

        if chunks:
            out.append({
                "id": _fb_id(), "type": "section", "anchor": "chunks",
                "title": "Learning Chunks", "collapsible": True,
                "body": {"summary": f"{len(chunks)} learning chunks identified."},
            })
            for ch in chunks[:8]:
                cid = _s(ch.get("id"))
                if cid and cid in valid_chunk_ids:
                    out.append({
                        "id": _fb_id(), "type": "chunk_card", "anchor": f"chunk-{cid}",
                        "title": _s(ch.get("title")) or cid,
                        "body": {"chunk_id": cid, "show_units": True,
                                 "show_confusions": True, "show_route_links": True},
                    })

        if routes:
            out.append({
                "id": _fb_id(), "type": "section", "anchor": "routes",
                "title": "Authoring Routes", "collapsible": True,
                "body": {"summary": f"{len(routes)} authoring routes suggested."},
            })
            for rt in routes[:4]:
                rid = _s(rt.get("id"))
                if rid and rid in valid_route_ids:
                    out.append({
                        "id": _fb_id(), "type": "route_card", "anchor": f"route-{rid}",
                        "title": _s(rt.get("title")) or rid,
                        "body": {"route_id": rid, "show_checklists": True,
                                 "show_anti_patterns": True},
                    })

        _append_unique(warnings, "report_blocks were auto-generated from analysis data (AI did not return them).")

    # --- Inject toc if AI returned blocks but no toc ---
    if out and not any(b.get("type") == "toc" for b in out):
        toc_entries = []
        for b in out:
            anchor = b.get("anchor")
            title = b.get("title")
            if anchor and title and b.get("type") in {"section", "progression_matrix", "coverage_table"}:
                toc_entries.append({"label": title, "anchor": anchor})
        if toc_entries:
            toc_block = {
                "id": f"rb_{len(out) + 1}",
                "type": "toc",
                "anchor": "toc",
                "title": "Contents",
                "body": {"items": toc_entries},
            }
            out.insert(0, toc_block)

    verbosity_risk = _risk_from_metrics(metrics, len(out))
    fallback_recommended = bool(
        not out
        or metrics.get("structural_invalid", 0) > 0
        or (verbosity_risk == "high" and metrics.get("duplicate_content_signals", 0) >= 4)
    )
    computed_lint = {
        "verbosity_risk": verbosity_risk,
        "duplicate_content_signals": max(0, int(metrics.get("duplicate_content_signals", 0))),
        "fallback_renderer_recommended": fallback_recommended,
    }
    return out, computed_lint


def _normalize_report_lint(raw: Any, computed: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    comp = computed if isinstance(computed, dict) else {}
    risk_order = {"low": 0, "medium": 1, "high": 2}

    raw_risk = _s(src.get("verbosity_risk"), "low").lower()
    if raw_risk not in risk_order:
        raw_risk = "low"
    comp_risk = _s(comp.get("verbosity_risk"), raw_risk).lower()
    if comp_risk not in risk_order:
        comp_risk = "low"
    final_risk = max((raw_risk, comp_risk), key=lambda r: risk_order.get(r, 0))

    return {
        "verbosity_risk": final_risk,
        "duplicate_content_signals": max(
            0,
            _i(src.get("duplicate_content_signals"), 0),
            _i(comp.get("duplicate_content_signals"), 0),
        ),
        "fallback_renderer_recommended": _b(src.get("fallback_renderer_recommended"), False)
        or _b(comp.get("fallback_renderer_recommended"), False),
    }


def normalize_analysis_schema_v2(data: Dict[str, Any], material: str = "") -> Dict[str, Any]:
    result = dict(data or {})
    warnings = [str(w) for w in (result.get("warnings") or []) if _s(w)]
    units = _normalize_units(result.get("educational_units"), warnings)
    chunks = _normalize_chunks(result.get("learning_chunks"), units, warnings)
    _reconcile_unit_chunk_links(units, chunks, warnings)

    future_caps = _normalize_future_caps(result.get("future_capabilities"), units, chunks, warnings)
    type_prog = _normalize_type_progression(result.get("type_progression_suitability"), result, units, chunks, warnings)
    routes = _normalize_routes(result.get("authoring_routes"), type_prog, future_caps, units, chunks, warnings)
    _sync_chunk_route_ids(chunks, routes)
    coverage = _normalize_coverage_plan(result.get("coverage_plan"), units, chunks, type_prog, routes, future_caps, warnings)
    microcards = _normalize_microcards(result.get("microcards_candidates"), units, chunks, future_caps, warnings)

    words = len((material or "").split())
    volume = _s(result.get("material_volume")).lower()
    if volume not in {"small", "medium", "large"}:
        volume = "large" if words >= 1400 or len(units) >= 20 else ("small" if words and words <= 350 and len(units) <= 6 else "medium")
    lang = _s(result.get("target_language"), "unknown").lower()
    if not re.fullmatch(r"[a-z][a-z0-9_-]{0,15}", lang or ""):
        lang = "unknown"

    result["analysis_schema_version"] = ANALYSIS_SCHEMA_VERSION
    result["material_volume"] = volume
    result["target_language"] = lang
    result["educational_units"] = units
    result["learning_chunks"] = chunks
    result["type_progression_suitability"] = type_prog
    result["authoring_routes"] = routes
    result["coverage_plan"] = coverage
    result["future_capabilities"] = future_caps
    result["microcards_candidates"] = microcards
    result["illustrations_detected"] = _b(result.get("illustrations_detected"), False)
    note = _s(result.get("illustrations_note"))
    result["illustrations_note"] = note or None
    result["report_blocks_version"] = REPORT_BLOCKS_VERSION
    report_blocks, computed_report_lint = _normalize_report_blocks(
        result.get("report_blocks"),
        units,
        chunks,
        routes,
        type_prog,
        warnings,
    )
    result["report_blocks"] = report_blocks
    result["report_lint"] = _normalize_report_lint(result.get("report_lint"), computed=computed_report_lint)
    result["warnings"] = warnings
    return result


__all__ = ["ANALYSIS_SCHEMA_VERSION", "REPORT_BLOCKS_VERSION", "normalize_analysis_schema_v2"]
