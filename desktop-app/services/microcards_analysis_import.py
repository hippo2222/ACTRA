"""AI-analysis → V2 microcards rows (editor "deck from analysis" flows).

Replaces the V1 create_deck_from_analysis card builder for the V2 stack.
The output is plain parser rows ({status, front, back, hint}) — the same
shape every other importer emits — so deck creation goes through the one
shared pipeline (_create_from_parsed: dedup, validation).

Decision D2 (docs/microcards_v1_editor_migration_plan.md): V2 has no
pair_match runtime, so pair candidates are converted into ordinary Q/A
cards (term → definition). Content survives, the structured matching UI
does not — if pair_match ever lands in V2, it becomes a new importer here.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


def _s(value: Any, default: str = "") -> str:
    return str(value if value is not None else default).strip()


def _str_list(values: Any, *, limit: int) -> List[str]:
    out: List[str] = []
    if not isinstance(values, list):
        return out
    for raw in values:
        text = _s(raw if not isinstance(raw, dict) else raw.get("value"))
        if text:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def _int_or_none(value: Any) -> Optional[int]:
    try:
        if value is None or str(value).strip() == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def deck_name_for_analysis(ai_run_id: str, selector: Dict[str, Any],
                           explicit_name: Optional[str] = None) -> str:
    """Same naming convention the V1 surface used (familiar to editor users)."""
    if _s(explicit_name):
        return _s(explicit_name)[:120]
    parts = ["Microcards", _s(ai_run_id)]
    if _s(selector.get("scope")) and _s(selector.get("scope")) != "all":
        parts.append(_s(selector.get("scope")))
    if _s(selector.get("chunk_id")):
        parts.append(f"chunk:{_s(selector.get('chunk_id'))}")
    if selector.get("unit_id") is not None:
        parts.append(f"unit:{selector.get('unit_id')}")
    if selector.get("pair_match_only"):
        parts.append("pair_match")
    return " / ".join(p for p in parts if p)[:120]


def analysis_to_rows(analysis_payload: Dict[str, Any],
                     selector: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Build importer rows from an analysis payload honoring the V1 selector
    semantics (scope/chunk_id/unit_id/card_types/pair_match_only)."""
    selector = dict(selector or {})
    chunk_filter = _s(selector.get("chunk_id")) or None
    unit_filter = _int_or_none(selector.get("unit_id"))
    pair_match_only = bool(selector.get("pair_match_only"))
    card_types = {s.lower() for s in _str_list(selector.get("card_types"), limit=16)}
    if pair_match_only:
        card_types = {"pair_match"}

    units = analysis_payload.get("educational_units") if isinstance(analysis_payload.get("educational_units"), list) else []
    chunks = analysis_payload.get("learning_chunks") if isinstance(analysis_payload.get("learning_chunks"), list) else []
    candidates = analysis_payload.get("microcards_candidates") if isinstance(analysis_payload.get("microcards_candidates"), list) else []
    future_caps = analysis_payload.get("future_capabilities") if isinstance(analysis_payload.get("future_capabilities"), list) else []

    unit_by_id: Dict[int, Dict[str, Any]] = {}
    for u in units:
        uid = _int_or_none(u.get("id")) if isinstance(u, dict) else None
        if uid is not None:
            unit_by_id[uid] = u
    chunk_by_id = {_s(c.get("id")): c for c in chunks if isinstance(c, dict) and _s(c.get("id"))}

    # ── Filter candidates exactly like V1 did ──────────────────────────
    filtered: List[Dict[str, Any]] = []
    for cand in candidates:
        if not isinstance(cand, dict):
            continue
        ctype = _s(cand.get("card_type"), "fact_recall").lower() or "fact_recall"
        if chunk_filter and (_s(cand.get("chunk_id")) or None) != chunk_filter:
            continue
        if unit_filter is not None and _int_or_none(cand.get("unit_id")) != unit_filter:
            continue
        if card_types and ctype not in card_types:
            continue
        filtered.append(cand)

    # Fallbacks: a unit/chunk selection with no candidates derives cards from
    # the educational units themselves (V1 behavior the editor relies on).
    if not filtered and unit_filter is not None and unit_filter in unit_by_id:
        unit = unit_by_id[unit_filter]
        filtered.append({
            "unit_id": unit_filter,
            "card_type": "fact_recall",
            "prompt_seed": _s(unit.get("title")),
            "answer_seed": _s(unit.get("description")) or _s(unit.get("evidence")),
            "chunk_id": (_str_list(unit.get("chunk_ids"), limit=1) or [None])[0],
        })
    if not filtered and chunk_filter:
        for unit in units:
            if not isinstance(unit, dict):
                continue
            if chunk_filter not in _str_list(unit.get("chunk_ids"), limit=8):
                continue
            filtered.append({
                "unit_id": unit.get("id"),
                "card_type": "fact_recall",
                "prompt_seed": _s(unit.get("title")),
                "answer_seed": _s(unit.get("description")) or _s(unit.get("evidence")),
                "chunk_id": chunk_filter,
            })

    rows: List[Dict[str, Any]] = []

    def _chunk_title(chunk_id: Optional[str]) -> Optional[str]:
        title = _s((chunk_by_id.get(chunk_id or "") or {}).get("title"))
        return title or None

    for cand in filtered:
        ctype = _s(cand.get("card_type"), "fact_recall").lower() or "fact_recall"
        unit = unit_by_id.get(_int_or_none(cand.get("unit_id")) or -1)
        front = _s(cand.get("prompt_seed")) or _s((unit or {}).get("title"))
        back = (_s(cand.get("answer_seed")) or _s((unit or {}).get("description"))
                or _s((unit or {}).get("evidence")) or _s(cand.get("why")))
        if not front or not back:
            rows.append({"status": "error", "raw": (front or back or "")[:120],
                         "error": "missing_front_or_back"})
            continue
        # D2: pair candidates flatten to the same Q/A shape (left → right);
        # the shared dedup later collapses overlaps with fact_recall cards.
        rows.append({
            "status": "ok",
            "front": front,
            "back": back,
            "hint": _chunk_title(_s(cand.get("chunk_id")) or None),
        })

    # ── Synthetic pair seeds (V1 derived these from chunk units when the
    # analysis flagged pair_matching suitability, or on pair_match_only) ──
    if not any(_s(c.get("card_type")).lower() == "pair_match" for c in filtered):
        pair_chunks: set = set()
        for fc in future_caps:
            if isinstance(fc, dict) and _s(fc.get("capability_id")) == "pair_matching":
                pair_chunks.update(_str_list(fc.get("covers_chunk_ids"), limit=64))
        if pair_chunks or pair_match_only:
            for chunk in chunks:
                if not isinstance(chunk, dict):
                    continue
                cid = _s(chunk.get("id"))
                if not cid or (pair_chunks and cid not in pair_chunks):
                    continue
                if chunk_filter and cid != chunk_filter:
                    continue
                for uid_raw in (chunk.get("unit_ids") if isinstance(chunk.get("unit_ids"), list) else []):
                    uid = _int_or_none(uid_raw)
                    unit = unit_by_id.get(uid) if uid is not None else None
                    if not unit:
                        continue
                    left = _s(unit.get("title"))
                    right = _s(unit.get("description")) or _s(unit.get("evidence"))
                    if left and right:
                        rows.append({"status": "ok", "front": left, "back": right,
                                     "hint": _chunk_title(cid)})

    return rows
