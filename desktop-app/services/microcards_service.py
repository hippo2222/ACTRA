"""Microcards MVP storage/service for P9.

Shared deck content is stored globally under ``data/microcards/decks``.
Review state and events are stored per user under ``data/users/{user_id}/microcards``.
"""

import json
import random
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def _utc_now() -> datetime:
    return datetime.utcnow()


def _utc_now_iso() -> str:
    return _utc_now().isoformat(timespec="seconds") + "Z"


def _parse_iso(value: Any) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        return dt.replace(tzinfo=None) if dt.tzinfo else dt
    except Exception:
        return None


def _read_json(path: Path, default: Any) -> Any:
    try:
        if not path.exists():
            return default
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


def _s(value: Any, default: str = "") -> str:
    return str(value if value is not None else default).strip()


def _int_list(values: Any, limit: int = 64) -> List[int]:
    out: List[int] = []
    seen = set()
    if not isinstance(values, list):
        return out
    for raw in values:
        try:
            v = int(raw)
        except (TypeError, ValueError):
            continue
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
        if len(out) >= limit:
            break
    return out


def _str_list(values: Any, limit: int = 64) -> List[str]:
    out: List[str] = []
    seen = set()
    if not isinstance(values, list):
        return out
    for raw in values:
        v = _s(raw)
        if not v or v in seen:
            continue
        seen.add(v)
        out.append(v)
        if len(out) >= limit:
            break
    return out


def score_pair_match_response(card: Dict[str, Any], response: Any) -> Dict[str, Any]:
    """Compute percentage score for pair_match answers."""
    back = card.get("back") if isinstance(card, dict) else {}
    payload = back.get("payload") if isinstance(back, dict) else {}
    pairs = payload.get("pairs") if isinstance(payload, dict) else []
    expected: Dict[str, str] = {}
    if isinstance(pairs, list):
        for item in pairs:
            if not isinstance(item, dict):
                continue
            left_id = _s(item.get("left_id"))
            right_id = _s(item.get("right_id"))
            if left_id and right_id:
                expected[left_id] = right_id

    submitted: Dict[str, str] = {}
    if isinstance(response, dict):
        raw_pairs = response.get("pairs")
        if isinstance(raw_pairs, list):
            for item in raw_pairs:
                if not isinstance(item, dict):
                    continue
                left_id = _s(item.get("left_id"))
                right_id = _s(item.get("right_id"))
                if left_id and right_id:
                    submitted[left_id] = right_id
        elif isinstance(response.get("mapping"), dict):
            for k, v in response.get("mapping", {}).items():
                left_id = _s(k)
                right_id = _s(v)
                if left_id and right_id:
                    submitted[left_id] = right_id

    total = len(expected)
    if total == 0:
        return {
            "partial_score": 0.0,
            "correct_pairs": 0,
            "total_pairs": 0,
            "is_perfect": False,
            "pair_results": [],
        }

    correct = 0
    details: List[Dict[str, Any]] = []
    for left_id, right_id in expected.items():
        got = submitted.get(left_id)
        ok = got == right_id
        if ok:
            correct += 1
        details.append(
            {
                "left_id": left_id,
                "expected_right_id": right_id,
                "submitted_right_id": got,
                "is_correct": ok,
            }
        )

    return {
        "partial_score": round((correct / total) * 100.0, 2),
        "correct_pairs": correct,
        "total_pairs": total,
        "is_perfect": correct == total,
        "pair_results": details,
    }


def apply_sm2_mvp_rating(prev_state: Optional[Dict[str, Any]], rating: str, *, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Small SM2-like scheduler used for P9 MVP."""
    now = now or _utc_now()
    state = dict(prev_state or {})
    status = _s(state.get("status"), "new") or "new"
    ease = float(state.get("ease") or 2.5)
    interval_days = int(state.get("interval_days") or 0)
    repetitions = int(state.get("repetitions") or 0)
    lapses = int(state.get("lapses") or 0)

    rating = _s(rating, "good").lower()
    if rating not in {"again", "hard", "good", "easy"}:
        rating = "good"

    if rating == "again":
        lapses += 1
        repetitions = 0
        interval_days = 0
        ease = max(1.3, ease - 0.2)
        status = "relearning" if status in {"review", "relearning"} else "learning"
        due_dt = now + timedelta(minutes=10)
    elif status in {"new", "learning", "relearning"}:
        repetitions += 1
        status = "review"
        if rating == "hard":
            ease = max(1.3, ease - 0.15)
            interval_days = 1
        elif rating == "easy":
            ease = min(3.2, ease + 0.15)
            interval_days = 3 if repetitions <= 1 else 5
        else:
            interval_days = 1 if repetitions <= 1 else max(2, interval_days)
        due_dt = now + timedelta(days=max(1, interval_days))
    else:
        base = max(1, interval_days)
        if rating == "hard":
            ease = max(1.3, ease - 0.15)
            interval_days = max(1, int(round(base * 1.2)))
        elif rating == "easy":
            ease = min(3.2, ease + 0.15)
            interval_days = max(base + 1, int(round(base * (ease + 0.3))))
        else:
            interval_days = max(base + 1, int(round(base * ease)))
        repetitions += 1
        status = "review"
        due_dt = now + timedelta(days=max(1, interval_days))

    if interval_days <= 1:
        stability_hint = "low"
    elif interval_days <= 7:
        stability_hint = "medium"
    else:
        stability_hint = "high"

    state.update(
        {
            "schema_version": "1.0",
            "status": status,
            "ease": round(ease, 2),
            "interval_days": int(max(0, interval_days)),
            "repetitions": int(max(0, repetitions)),
            "lapses": int(max(0, lapses)),
            "due_at": due_dt.isoformat(timespec="seconds") + "Z",
            "last_reviewed_at": now.isoformat(timespec="seconds") + "Z",
            "last_rating": rating,
            "stability_hint": stability_hint,
        }
    )
    return state


class MicrocardsService:
    def __init__(self, data_dir: str, user_id: str = "default_user") -> None:
        self.data_dir = Path(data_dir)
        self.user_id = _s(user_id, "default_user") or "default_user"

    def switch_user(self, user_id: str) -> None:
        self.user_id = _s(user_id, "default_user") or "default_user"

    @property
    def _global_root(self) -> Path:
        p = self.data_dir / "microcards"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def _decks_root(self) -> Path:
        p = self._global_root / "decks"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def _user_root(self) -> Path:
        p = self.data_dir / "users" / self.user_id / "microcards"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def _states_path(self) -> Path:
        return self._user_root / "review_states.json"

    @property
    def _events_path(self) -> Path:
        return self._user_root / "review_events.json"

    @property
    def _sessions_path(self) -> Path:
        return self._user_root / "review_sessions.json"

    def _deck_path(self, deck_id: str) -> Path:
        return self._decks_root / f"{deck_id}.json"

    def _read_states(self) -> Dict[str, Dict[str, Any]]:
        payload = _read_json(self._states_path, {"schema_version": "1.0", "user_id": self.user_id, "items": {}})
        items = payload.get("items") if isinstance(payload, dict) else {}
        if not isinstance(items, dict):
            items = {}
        out: Dict[str, Dict[str, Any]] = {}
        for card_id, state in items.items():
            if isinstance(state, dict):
                out[str(card_id)] = dict(state)
        return out

    def _write_states(self, states: Dict[str, Dict[str, Any]]) -> None:
        _write_json(
            self._states_path,
            {
                "schema_version": "1.0",
                "user_id": self.user_id,
                "updated_at": _utc_now_iso(),
                "items": states,
            },
        )

    def _append_event(self, event: Dict[str, Any]) -> None:
        payload = _read_json(self._events_path, {"schema_version": "1.0", "user_id": self.user_id, "items": []})
        items = payload.get("items") if isinstance(payload, dict) else []
        if not isinstance(items, list):
            items = []
        items.append(event)
        if len(items) > 5000:
            items = items[-5000:]
        _write_json(
            self._events_path,
            {
                "schema_version": "1.0",
                "user_id": self.user_id,
                "updated_at": _utc_now_iso(),
                "items": items,
            },
        )

    def _read_sessions(self) -> Dict[str, Any]:
        payload = _read_json(
            self._sessions_path,
            {"schema_version": "1.0", "user_id": self.user_id, "updated_at": None, "active_by_deck": {}, "items": {}},
        )
        if not isinstance(payload, dict):
            payload = {}
        active_by_deck = payload.get("active_by_deck")
        items = payload.get("items")
        if not isinstance(active_by_deck, dict):
            active_by_deck = {}
        if not isinstance(items, dict):
            items = {}
        return {
            "schema_version": "1.0",
            "user_id": self.user_id,
            "updated_at": payload.get("updated_at"),
            "active_by_deck": active_by_deck,
            "items": items,
        }

    def _write_sessions(self, payload: Dict[str, Any]) -> None:
        normalized = self._read_sessions()
        if isinstance(payload, dict):
            normalized.update(payload)
        normalized["schema_version"] = "1.0"
        normalized["user_id"] = self.user_id
        normalized["updated_at"] = _utc_now_iso()
        if not isinstance(normalized.get("active_by_deck"), dict):
            normalized["active_by_deck"] = {}
        if not isinstance(normalized.get("items"), dict):
            normalized["items"] = {}
        _write_json(self._sessions_path, normalized)

    def _get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        sid = _s(session_id)
        if not sid:
            return None
        sessions = self._read_sessions()
        items = sessions.get("items") if isinstance(sessions.get("items"), dict) else {}
        session = items.get(sid)
        return dict(session) if isinstance(session, dict) else None

    def _save_session(self, session: Dict[str, Any], *, set_active: bool = False) -> None:
        if not isinstance(session, dict):
            return
        sid = _s(session.get("id"))
        deck_id = _s(session.get("deck_id"))
        if not sid or not deck_id:
            return
        sessions = self._read_sessions()
        items = sessions.get("items") if isinstance(sessions.get("items"), dict) else {}
        active_by_deck = sessions.get("active_by_deck") if isinstance(sessions.get("active_by_deck"), dict) else {}
        session = dict(session)
        session["id"] = sid
        session["deck_id"] = deck_id
        session["user_id"] = self.user_id
        session["updated_at"] = _utc_now_iso()
        items[sid] = session
        if set_active and not bool(session.get("completed")):
            active_by_deck[deck_id] = sid
        if bool(session.get("completed")) and active_by_deck.get(deck_id) == sid:
            active_by_deck.pop(deck_id, None)
        self._write_sessions({"items": items, "active_by_deck": active_by_deck})

    def _get_active_session_for_deck(self, deck_id: str) -> Optional[Dict[str, Any]]:
        deck_id = _s(deck_id)
        if not deck_id:
            return None
        sessions = self._read_sessions()
        active_by_deck = sessions.get("active_by_deck") if isinstance(sessions.get("active_by_deck"), dict) else {}
        items = sessions.get("items") if isinstance(sessions.get("items"), dict) else {}
        sid = _s(active_by_deck.get(deck_id))
        session = items.get(sid) if sid else None
        if not isinstance(session, dict):
            return None
        if bool(session.get("completed")):
            return None
        if _s(session.get("user_id")) != self.user_id:
            return None
        if _s(session.get("deck_id")) != deck_id:
            return None
        return dict(session)

    def _card_signature(self, card: Dict[str, Any]) -> Tuple[Any, ...]:
        return (
            _s(card.get("card_type")),
            _s((card.get("front") or {}).get("text")),
            _s((card.get("back") or {}).get("text")),
            tuple(_int_list(card.get("unit_ids"), limit=16)),
            tuple(_str_list(card.get("chunk_ids"), limit=16)),
        )

    def _write_deck(self, deck: Dict[str, Any]) -> None:
        if not isinstance(deck, dict):
            return
        deck_id = _s(deck.get("id"))
        if not deck_id:
            return
        meta = deck.get("meta") if isinstance(deck.get("meta"), dict) else {}
        meta["updated_at"] = _utc_now_iso()
        deck["meta"] = meta
        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        deck["cards"] = cards
        deck["card_ids"] = [_s(c.get("id")) for c in cards if isinstance(c, dict) and _s(c.get("id"))]
        _write_json(self._deck_path(deck_id), deck)

    def get_deck(self, deck_id: str) -> Optional[Dict[str, Any]]:
        deck_id = _s(deck_id)
        if not deck_id:
            return None
        payload = _read_json(self._deck_path(deck_id), None)
        return payload if isinstance(payload, dict) else None

    def _deck_user_stats(self, deck: Dict[str, Any], states: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        now = _utc_now()
        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        total = 0
        new_count = 0
        due_count = 0
        review_count = 0
        suspended_count = 0
        for card in cards:
            if not isinstance(card, dict):
                continue
            cstatus = _s(card.get("status"), "active")
            if cstatus in {"archived"}:
                continue
            total += 1
            card_id = _s(card.get("id"))
            st = states.get(card_id) or {}
            if _s(st.get("status")) == "suspended" or cstatus == "suspended":
                suspended_count += 1
                continue
            due_at = _parse_iso(st.get("due_at"))
            if not st or _s(st.get("status"), "new") == "new":
                new_count += 1
                if not due_at or due_at <= now:
                    due_count += 1
            else:
                review_count += 1
                if not due_at or due_at <= now:
                    due_count += 1
        return {
            "cards_total": total,
            "cards_new": new_count,
            "cards_due": due_count,
            "cards_review": review_count,
            "cards_suspended": suspended_count,
        }

    def _deck_ownership(self, deck: Dict[str, Any], meta: Dict[str, Any]) -> Dict[str, Any]:
        created_by_user_id = _s(meta.get("created_by_user_id")) or None
        updated_by_user_id = _s(meta.get("updated_by_user_id")) or created_by_user_id
        created_via = _s(meta.get("source"))
        if not created_via:
            created_via = "analysis_auto" if _s(deck.get("analysis_id")) else "manual_editor"
        content_scope = _s(meta.get("content_scope"), "shared_local") or "shared_local"
        return {
            "scope": "workspace",
            "content_scope": content_scope,
            "created_by_user_id": created_by_user_id,
            "updated_by_user_id": updated_by_user_id,
            "created_via": created_via,
            "has_owner": bool(created_by_user_id),
            "is_owned_by_current_user": bool(
                created_by_user_id and created_by_user_id == self.user_id
            ),
            "is_shared_library": content_scope == "shared_local",
        }

    def list_decks(self, limit: int = 100) -> List[Dict[str, Any]]:
        states = self._read_states()
        rows: List[Tuple[str, Dict[str, Any]]] = []
        for path in self._decks_root.glob("*.json"):
            deck = _read_json(path, None)
            if not isinstance(deck, dict):
                continue
            deck_id = _s(deck.get("id")) or path.stem
            meta = deck.get("meta") if isinstance(deck.get("meta"), dict) else {}
            row = {
                "id": deck_id,
                "schema_version": deck.get("schema_version"),
                "name": deck.get("name") or deck_id,
                "analysis_id": deck.get("analysis_id"),
                "target_language": deck.get("target_language"),
                "selector": deck.get("selector") if isinstance(deck.get("selector"), dict) else {},
                "settings": deck.get("settings") if isinstance(deck.get("settings"), dict) else {},
                "meta": meta,
                "ownership": self._deck_ownership(deck, meta),
                "stats": self._deck_user_stats(deck, states),
            }
            sort_key = _s(meta.get("updated_at")) or _s(meta.get("created_at"))
            rows.append((sort_key, row))
        rows.sort(key=lambda item: (item[0], item[1]["id"]), reverse=True)
        return [row for _, row in rows[: max(1, min(int(limit or 100), 500))]]

    def _make_deck_name(self, ai_run_id: str, selector: Dict[str, Any], explicit_name: Optional[str]) -> str:
        if _s(explicit_name):
            return _s(explicit_name)[:120]
        parts = ["Microcards", ai_run_id]
        if selector.get("scope") and selector.get("scope") != "all":
            parts.append(str(selector["scope"]))
        if selector.get("chunk_id"):
            parts.append(f"chunk:{selector['chunk_id']}")
        if selector.get("unit_id") is not None:
            parts.append(f"unit:{selector['unit_id']}")
        if selector.get("pair_match_only"):
            parts.append("pair_match")
        return " / ".join(parts)[:120]

    def _build_simple_card(
        self,
        *,
        deck_id: str,
        ai_run_id: str,
        cand: Dict[str, Any],
        unit_by_id: Dict[int, Dict[str, Any]],
        chunk_by_id: Dict[str, Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        ctype = _s(cand.get("card_type"), "fact_recall").lower() or "fact_recall"
        if ctype == "pair_match":
            return None
        unit_id = None
        try:
            if cand.get("unit_id") is not None:
                unit_id = int(cand.get("unit_id"))
        except (TypeError, ValueError):
            unit_id = None
        chunk_id = _s(cand.get("chunk_id")) or None
        unit = unit_by_id.get(unit_id) if unit_id is not None else None
        prompt = _s(cand.get("prompt_seed")) or _s((unit or {}).get("title")) or "Вопрос"
        answer = _s(cand.get("answer_seed")) or _s((unit or {}).get("description")) or _s((unit or {}).get("evidence")) or _s(cand.get("why")) or "Ответ"
        anchors: List[Dict[str, Any]] = []
        for a in (cand.get("anchors") if isinstance(cand.get("anchors"), list) else [])[:6]:
            if isinstance(a, dict):
                val = _s(a.get("value"))
                if val:
                    anchors.append({"kind": _s(a.get("kind"), "term") or "term", "value": val})
            else:
                val = _s(a)
                if val:
                    anchors.append({"kind": "term", "value": val})
        return {
            "id": f"mc_{uuid.uuid4().hex[:10]}",
            "schema_version": "1.0",
            "deck_id": deck_id,
            "analysis_id": ai_run_id,
            "unit_ids": [unit_id] if unit_id is not None else [],
            "chunk_ids": [chunk_id] if chunk_id else [],
            "card_type": ctype,
            "front": {"text": prompt, "payload": {}},
            "back": {"text": answer, "payload": {}},
            "anchors": anchors,
            "difficulty_hint": _s(cand.get("priority"), "medium").lower() or "medium",
            "source_evidence": [x for x in [_s(cand.get("why")), _s(cand.get("answer_seed"))] if x][:2],
            "created_by": "analysis_auto",
            "status": "active",
            "meta": {"chunk_title": _s((chunk_by_id.get(chunk_id or "") or {}).get("title"))},
        }

    def _build_pair_match_cards(
        self,
        *,
        deck_id: str,
        ai_run_id: str,
        candidates: List[Dict[str, Any]],
        units: List[Dict[str, Any]],
        chunks: List[Dict[str, Any]],
        future_caps: List[Dict[str, Any]],
        selector: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        unit_by_id: Dict[int, Dict[str, Any]] = {}
        for u in units:
            if not isinstance(u, dict):
                continue
            try:
                unit_by_id[int(u.get("id"))] = u
            except (TypeError, ValueError):
                continue
        chunk_by_id = {str(c.get("id")): c for c in chunks if isinstance(c, dict) and _s(c.get("id"))}
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for cand in candidates:
            if _s(cand.get("card_type")).lower() != "pair_match":
                continue
            chunk_id = _s(cand.get("chunk_id")) or "chunk_unscoped"
            unit_id = None
            try:
                if cand.get("unit_id") is not None:
                    unit_id = int(cand.get("unit_id"))
            except (TypeError, ValueError):
                unit_id = None
            unit = unit_by_id.get(unit_id) if unit_id is not None else None
            left_text = _s(cand.get("prompt_seed")) or _s((unit or {}).get("title"))
            right_text = _s(cand.get("answer_seed")) or _s(cand.get("why")) or _s((unit or {}).get("description")) or _s((unit or {}).get("evidence"))
            if left_text and right_text:
                grouped.setdefault(chunk_id, []).append(
                    {"left": left_text, "right": right_text, "unit_id": unit_id, "why": _s(cand.get("why"))}
                )

        if not grouped:
            pair_chunks = set()
            for fc in future_caps:
                if not isinstance(fc, dict) or _s(fc.get("capability_id")) != "pair_matching":
                    continue
                pair_chunks.update(_str_list(fc.get("covers_chunk_ids"), limit=64))
            # Only derive synthetic pair_match cards when analysis explicitly signals matching suitability
            # (future capability) or user requested pair-match-only fallback.
            if not pair_chunks and not bool(selector.get("pair_match_only")):
                return []
            for chunk in chunks:
                if not isinstance(chunk, dict):
                    continue
                cid = _s(chunk.get("id"))
                if not cid:
                    continue
                if pair_chunks and cid not in pair_chunks:
                    continue
                seeds = []
                for uid in _int_list(chunk.get("unit_ids"), limit=16):
                    unit = unit_by_id.get(uid) or {}
                    left = _s(unit.get("title"))
                    right = _s(unit.get("description")) or _s(unit.get("evidence"))
                    if left and right:
                        seeds.append({"left": left, "right": right, "unit_id": uid, "why": "Derived from chunk units."})
                if len(seeds) >= 2:
                    grouped[cid] = seeds

        cards: List[Dict[str, Any]] = []
        for chunk_id, seeds in grouped.items():
            if len(seeds) < 2:
                continue
            batch = seeds[:5]
            left_items = []
            right_items = []
            pairs = []
            explanations = []
            unit_ids = []
            for idx, seed in enumerate(batch, start=1):
                lid = f"l{idx}"
                rid = f"r{idx}"
                left_items.append({"id": lid, "text": seed["left"]})
                right_items.append({"id": rid, "text": seed["right"]})
                pairs.append({"left_id": lid, "right_id": rid})
                if seed.get("why"):
                    explanations.append({"left_id": lid, "text": _s(seed.get('why'))[:240]})
                if isinstance(seed.get("unit_id"), int):
                    unit_ids.append(int(seed["unit_id"]))
            shuffled_right = list(right_items)
            random.shuffle(shuffled_right)
            cards.append(
                {
                    "id": f"mc_{uuid.uuid4().hex[:10]}",
                    "schema_version": "1.0",
                    "deck_id": deck_id,
                    "analysis_id": ai_run_id,
                    "unit_ids": sorted(set(unit_ids)),
                    "chunk_ids": [chunk_id] if chunk_id != "chunk_unscoped" else [],
                    "card_type": "pair_match",
                    "front": {
                        "text": "Сопоставьте элементы" + (f" ({_s((chunk_by_id.get(chunk_id) or {}).get('title'))})" if chunk_id in chunk_by_id else ""),
                        "payload": {"mode": "pair_match", "left_items": left_items, "right_items": shuffled_right, "shuffle_right": True},
                    },
                    "back": {
                        "text": "Правильные соответствия",
                        "payload": {"mode": "pair_match_solution", "pairs": pairs, "explanations": explanations},
                    },
                    "anchors": [],
                    "difficulty_hint": "medium",
                    "source_evidence": ["Pair match derived from analysis."],
                    "created_by": "analysis_auto",
                    "status": "active",
                }
            )
        return cards

    def create_deck_from_analysis(
        self,
        analysis_payload: Dict[str, Any],
        *,
        ai_run_id: str,
        selector: Optional[Dict[str, Any]] = None,
        deck_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        selector = dict(selector or {})
        scope = _s(selector.get("scope"), "all").lower() or "all"
        chunk_id = _s(selector.get("chunk_id")) or None
        unit_id = None
        try:
            if selector.get("unit_id") is not None and str(selector.get("unit_id")).strip():
                unit_id = int(selector.get("unit_id"))
        except (TypeError, ValueError):
            unit_id = None
        pair_match_only = bool(selector.get("pair_match_only"))
        card_types = {s.lower() for s in _str_list(selector.get("card_types"), limit=16)}
        if pair_match_only:
            card_types = {"pair_match"}

        units = analysis_payload.get("educational_units") if isinstance(analysis_payload.get("educational_units"), list) else []
        chunks = analysis_payload.get("learning_chunks") if isinstance(analysis_payload.get("learning_chunks"), list) else []
        candidates = analysis_payload.get("microcards_candidates") if isinstance(analysis_payload.get("microcards_candidates"), list) else []
        future_caps = analysis_payload.get("future_capabilities") if isinstance(analysis_payload.get("future_capabilities"), list) else []
        target_language = _s(analysis_payload.get("target_language"), "unknown") or "unknown"

        unit_by_id: Dict[int, Dict[str, Any]] = {}
        for u in units:
            if not isinstance(u, dict):
                continue
            try:
                unit_by_id[int(u.get("id"))] = u
            except (TypeError, ValueError):
                continue
        chunk_by_id = {str(c.get("id")): c for c in chunks if isinstance(c, dict) and _s(c.get("id"))}

        filtered_candidates: List[Dict[str, Any]] = []
        for cand in candidates:
            if not isinstance(cand, dict):
                continue
            ctype = _s(cand.get("card_type"), "fact_recall").lower() or "fact_recall"
            cchunk = _s(cand.get("chunk_id")) or None
            cunit = None
            try:
                if cand.get("unit_id") is not None:
                    cunit = int(cand.get("unit_id"))
            except (TypeError, ValueError):
                cunit = None
            if chunk_id and cchunk != chunk_id:
                continue
            if unit_id is not None and cunit != unit_id:
                continue
            if card_types and ctype not in card_types:
                continue
            filtered_candidates.append(cand)

        if not filtered_candidates and unit_id is not None and unit_id in unit_by_id:
            unit = unit_by_id[unit_id]
            filtered_candidates.append(
                {
                    "candidate_id": f"derived_unit_{unit_id}",
                    "unit_id": unit_id,
                    "chunk_id": (_str_list(unit.get("chunk_ids"), limit=1) or [None])[0],
                    "card_type": "fact_recall",
                    "priority": "medium",
                    "prompt_seed": _s(unit.get("title")),
                    "answer_seed": _s(unit.get("description")) or _s(unit.get("evidence")),
                    "anchors": [a.get("value") if isinstance(a, dict) else a for a in (unit.get("factual_anchors") or [])][:4],
                    "why": "Derived from educational unit.",
                }
            )

        if not filtered_candidates and chunk_id:
            for unit in units:
                if not isinstance(unit, dict):
                    continue
                if chunk_id not in _str_list(unit.get("chunk_ids"), limit=8):
                    continue
                filtered_candidates.append(
                    {
                        "candidate_id": f"derived_chunk_{chunk_id}_{unit.get('id')}",
                        "unit_id": unit.get("id"),
                        "chunk_id": chunk_id,
                        "card_type": "fact_recall",
                        "priority": "medium",
                        "prompt_seed": _s(unit.get("title")),
                        "answer_seed": _s(unit.get("description")) or _s(unit.get("evidence")),
                        "anchors": [a.get("value") if isinstance(a, dict) else a for a in (unit.get("factual_anchors") or [])][:4],
                        "why": "Derived from learning chunk.",
                    }
                )

        deck_id = f"deck_{uuid.uuid4().hex[:12]}"
        normalized_selector = {
            "scope": scope,
            "chunk_id": chunk_id,
            "unit_id": unit_id,
            "card_types": sorted(card_types),
            "pair_match_only": pair_match_only,
        }

        cards: List[Dict[str, Any]] = []
        for cand in filtered_candidates:
            card = self._build_simple_card(
                deck_id=deck_id,
                ai_run_id=ai_run_id,
                cand=cand,
                unit_by_id=unit_by_id,
                chunk_by_id=chunk_by_id,
            )
            if card:
                cards.append(card)

        pair_cards = self._build_pair_match_cards(
            deck_id=deck_id,
            ai_run_id=ai_run_id,
            candidates=filtered_candidates if filtered_candidates else candidates,
            units=units,
            chunks=chunks,
            future_caps=future_caps,
            selector=normalized_selector,
        )
        if pair_match_only:
            cards = []
        cards.extend(pair_cards)

        seen = set()
        deduped: List[Dict[str, Any]] = []
        for card in cards:
            sig = (_s(card.get("card_type")), _s((card.get("front") or {}).get("text")), _s((card.get("back") or {}).get("text")))
            if sig in seen:
                continue
            seen.add(sig)
            deduped.append(card)
        cards = deduped

        deck = {
            "id": deck_id,
            "schema_version": "1.0",
            "name": self._make_deck_name(ai_run_id, normalized_selector, deck_name),
            "analysis_id": ai_run_id,
            "source_material_fingerprint": None,
            "target_language": target_language,
            "card_ids": [c["id"] for c in cards],
            "cards": cards,
            "settings": {"scheduler": "sm2_mvp", "new_cards_per_day": 20, "max_reviews_per_day": 100},
            "selector": normalized_selector,
            "meta": {
                "created_at": _utc_now_iso(),
                "updated_at": _utc_now_iso(),
                "created_by_user_id": self.user_id,
                "content_scope": "shared_local",
            },
        }
        _write_json(self._deck_path(deck_id), deck)
        return deck

    def append_cards_from_analysis_to_deck(
        self,
        *,
        deck_id: str,
        analysis_payload: Dict[str, Any],
        ai_run_id: str,
        selector: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        target = self.get_deck(deck_id)
        if not isinstance(target, dict):
            raise LookupError("deck_not_found")

        temp_deck = self.create_deck_from_analysis(
            analysis_payload,
            ai_run_id=ai_run_id,
            selector=selector or {},
            deck_name=None,
        )
        temp_path = self._deck_path(_s(temp_deck.get("id")))
        try:
            existing_cards = target.get("cards") if isinstance(target.get("cards"), list) else []
            new_cards = temp_deck.get("cards") if isinstance(temp_deck.get("cards"), list) else []
            signatures = {self._card_signature(c) for c in existing_cards if isinstance(c, dict)}
            appended_count = 0
            duplicate_count = 0
            for card in new_cards:
                if not isinstance(card, dict):
                    continue
                sig = self._card_signature(card)
                if sig in signatures:
                    duplicate_count += 1
                    continue
                signatures.add(sig)
                cloned = json.loads(json.dumps(card, ensure_ascii=False))
                cloned["id"] = f"mc_{uuid.uuid4().hex[:10]}"
                cloned["deck_id"] = _s(target.get("id"))
                existing_cards.append(cloned)
                appended_count += 1

            target["cards"] = existing_cards
            meta = target.get("meta") if isinstance(target.get("meta"), dict) else {}
            append_history = meta.get("append_history") if isinstance(meta.get("append_history"), list) else []
            append_history.append(
                {
                    "at": _utc_now_iso(),
                    "user_id": self.user_id,
                    "source_ai_run_id": ai_run_id,
                    "selector": dict(selector or {}),
                    "added_cards": appended_count,
                    "skipped_duplicates": duplicate_count,
                }
            )
            if len(append_history) > 50:
                append_history = append_history[-50:]
            meta["append_history"] = append_history
            target["meta"] = meta
            self._write_deck(target)
            return {
                "deck": target,
                "added_cards": appended_count,
                "skipped_duplicates": duplicate_count,
            }
        finally:
            try:
                if temp_path.exists():
                    temp_path.unlink()
            except Exception:
                pass

    def get_due_queue(self, deck_id: str, limit: int = 20, *, resume: bool = True, restart: bool = False) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not isinstance(deck, dict):
            raise LookupError("deck_not_found")
        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        card_by_id = {_s(c.get("id")): c for c in cards if isinstance(c, dict) and _s(c.get("id"))}
        states = self._read_states()
        now = _utc_now()
        session: Optional[Dict[str, Any]] = None
        if resume and not restart:
            session = self._get_active_session_for_deck(deck_id)
            if isinstance(session, dict):
                queue_ids_existing = _str_list(session.get("card_queue"), limit=1000)
                filtered_queue_ids = [cid for cid in queue_ids_existing if cid in card_by_id]
                cursor_existing = int(session.get("cursor") or 0)
                if filtered_queue_ids != queue_ids_existing or cursor_existing < 0:
                    session["card_queue"] = filtered_queue_ids
                    session["cursor"] = max(0, min(cursor_existing, len(filtered_queue_ids)))
                    session["completed"] = bool(session.get("cursor", 0) >= len(filtered_queue_ids))
                    self._save_session(session, set_active=True)
                if bool(session.get("completed")):
                    session = None

        if not isinstance(session, dict):
            due_rows: List[Tuple[int, datetime, Dict[str, Any], Dict[str, Any]]] = []
            for card in cards:
                if not isinstance(card, dict):
                    continue
                if _s(card.get("status"), "active") in {"archived", "suspended"}:
                    continue
                card_id = _s(card.get("id"))
                if not card_id:
                    continue
                state = states.get(card_id) or {}
                if _s(state.get("status")) == "suspended":
                    continue
                due_at = _parse_iso(state.get("due_at"))
                is_new = not state or _s(state.get("status"), "new") == "new"
                if not due_at or due_at <= now or is_new:
                    due_rows.append((0 if is_new else 1, due_at or now, card, state))
            due_rows.sort(key=lambda item: (item[0], item[1], _s(item[2].get("id"))))
            picked = due_rows[: max(1, min(int(limit or 20), 100))]
            queue_cards = [row[2] for row in picked]
            queue_ids = [_s(c.get("id")) for c in queue_cards if isinstance(c, dict) and _s(c.get("id"))]
            session = {
                "id": f"mcsess_{uuid.uuid4().hex[:12]}",
                "schema_version": "1.0",
                "user_id": self.user_id,
                "deck_id": _s(deck.get("id")),
                "created_at": _utc_now_iso(),
                "updated_at": _utc_now_iso(),
                "card_queue": queue_ids,
                "cursor": 0,
                "completed": len(queue_ids) == 0,
            }
            self._save_session(session, set_active=True)

        queue_ids = _str_list(session.get("card_queue"), limit=1000)
        cursor = int(session.get("cursor") or 0)
        cursor = max(0, min(cursor, len(queue_ids)))
        queue_cards = [card_by_id[cid] for cid in queue_ids if cid in card_by_id]
        queue_states = {cid: states.get(cid) for cid in queue_ids if isinstance(states.get(cid), dict)}
        current_card = queue_cards[cursor] if cursor < len(queue_cards) else None
        return {
            "deck": {
                "id": deck.get("id"),
                "name": deck.get("name"),
                "analysis_id": deck.get("analysis_id"),
                "target_language": deck.get("target_language"),
                "settings": deck.get("settings") if isinstance(deck.get("settings"), dict) else {},
            },
            "session": session,
            "cursor": cursor,
            "queue_count": len(queue_cards),
            "current_card": current_card,
            "queue": queue_cards,
            "queue_states": queue_states,
            "stats": self._deck_user_stats(deck, states),
        }

    def submit_review(
        self,
        *,
        deck_id: str,
        card_id: str,
        rating: str,
        session_id: Optional[str] = None,
        response: Any = None,
        response_time_ms: Optional[int] = None,
    ) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not isinstance(deck, dict):
            raise LookupError("deck_not_found")
        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        card = next((c for c in cards if isinstance(c, dict) and _s(c.get("id")) == _s(card_id)), None)
        if not isinstance(card, dict):
            raise LookupError("card_not_found")

        rating = _s(rating, "good").lower()
        if rating not in {"again", "hard", "good", "easy"}:
            rating = "good"

        states = self._read_states()
        prev_state = states.get(_s(card_id))
        now = _utc_now()
        next_state = apply_sm2_mvp_rating(prev_state, rating, now=now)
        next_state["card_id"] = _s(card_id)
        next_state["user_id"] = self.user_id
        states[_s(card_id)] = next_state
        self._write_states(states)

        session_obj: Optional[Dict[str, Any]] = None
        sid = _s(session_id)
        if sid:
            session_obj = self._get_session(sid)
            if not isinstance(session_obj, dict):
                raise LookupError("session_not_found")
            if _s(session_obj.get("user_id")) != self.user_id:
                raise LookupError("session_not_found")
            if _s(session_obj.get("deck_id")) != _s(deck_id):
                raise ValueError("session_deck_mismatch")
            if bool(session_obj.get("completed")):
                raise ValueError("session_completed")
            queue_ids = _str_list(session_obj.get("card_queue"), limit=1000)
            cursor = int(session_obj.get("cursor") or 0)
            cursor = max(0, cursor)
            expected_card_id = queue_ids[cursor] if cursor < len(queue_ids) else None
            if not expected_card_id:
                session_obj["completed"] = True
                self._save_session(session_obj, set_active=True)
                raise ValueError("session_queue_exhausted")
            if _s(expected_card_id) != _s(card_id):
                raise ValueError("session_card_mismatch")
            session_obj["cursor"] = cursor + 1
            session_obj["completed"] = bool((cursor + 1) >= len(queue_ids))
            self._save_session(session_obj, set_active=True)

        details: Dict[str, Any] = {"card_type": _s(card.get("card_type"))}
        was_correct = rating != "again"
        if _s(card.get("card_type")).lower() == "pair_match":
            score = score_pair_match_response(card, response)
            details.update(score)
            was_correct = bool(score.get("is_perfect"))

        event = {
            "id": f"mcrev_{uuid.uuid4().hex[:12]}",
            "user_id": self.user_id,
            "card_id": _s(card_id),
            "session_id": sid or None,
            "reviewed_at": now.isoformat(timespec="seconds") + "Z",
            "rating": rating,
            "response_time_ms": int(response_time_ms) if isinstance(response_time_ms, int) and response_time_ms >= 0 else None,
            "was_correct": bool(was_correct),
            "details": details,
        }
        self._append_event(event)

        return {
            "review_state": next_state,
            "review_event": event,
            "session": session_obj,
            "deck_stats": self._deck_user_stats(deck, states),
        }

    # ── M11: Manual deck/card CRUD ────────────────────────────────────

    def create_deck_manual(
        self,
        *,
        name: str,
        tags: Optional[List[str]] = None,
        target_language: str = "unknown",
    ) -> Dict[str, Any]:
        name = _s(name)[:120] or "Новая колода"
        deck_id = f"deck_{uuid.uuid4().hex[:12]}"
        deck: Dict[str, Any] = {
            "id": deck_id,
            "schema_version": "1.0",
            "name": name,
            "analysis_id": None,
            "source_material_fingerprint": None,
            "target_language": _s(target_language, "unknown") or "unknown",
            "card_ids": [],
            "cards": [],
            "tags": _str_list(tags, limit=32),
            "settings": {"scheduler": "sm2_mvp", "new_cards_per_day": 20, "max_reviews_per_day": 100},
            "selector": {},
            "meta": {
                "created_at": _utc_now_iso(),
                "updated_at": _utc_now_iso(),
                "created_by_user_id": self.user_id,
                "content_scope": "shared_local",
                "source": "manual_editor",
            },
        }
        _write_json(self._deck_path(deck_id), deck)
        return deck

    def rename_deck(self, deck_id: str, new_name: str) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not isinstance(deck, dict):
            raise LookupError("deck_not_found")
        deck["name"] = _s(new_name)[:120] or deck.get("name", "Колода")
        self._write_deck(deck)
        return deck

    def archive_deck(self, deck_id: str, *, archive: bool = True) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not isinstance(deck, dict):
            raise LookupError("deck_not_found")
        meta = deck.get("meta") if isinstance(deck.get("meta"), dict) else {}
        meta["archived"] = bool(archive)
        meta["archived_at"] = _utc_now_iso() if archive else None
        deck["meta"] = meta
        self._write_deck(deck)
        return deck

    def delete_deck(self, deck_id: str) -> bool:
        deck_id = _s(deck_id)
        if not deck_id:
            return False
        path = self._deck_path(deck_id)
        if path.exists():
            path.unlink()
            return True
        return False

    def create_card_manual(
        self,
        *,
        deck_id: str,
        front_text: str,
        back_text: str,
        tags: Optional[List[str]] = None,
        difficulty_hint: str = "medium",
    ) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not isinstance(deck, dict):
            raise LookupError("deck_not_found")

        front_text = _s(front_text)
        back_text = _s(back_text)
        if not front_text:
            raise ValueError("front_text_required")
        if not back_text:
            raise ValueError("back_text_required")

        card: Dict[str, Any] = {
            "id": f"mc_{uuid.uuid4().hex[:10]}",
            "schema_version": "1.0",
            "deck_id": deck_id,
            "analysis_id": None,
            "unit_ids": [],
            "chunk_ids": [],
            "card_type": "fact_recall",
            "front": {"text": front_text, "payload": {}},
            "back": {"text": back_text, "payload": {}},
            "anchors": [],
            "tags": _str_list(tags, limit=32),
            "difficulty_hint": _s(difficulty_hint, "medium").lower() or "medium",
            "source_evidence": [],
            "created_by": "manual_editor",
            "status": "active",
            "meta": {"created_at": _utc_now_iso()},
        }

        # Dedup check
        existing_cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        new_sig = self._card_signature(card)
        for ec in existing_cards:
            if isinstance(ec, dict) and self._card_signature(ec) == new_sig:
                raise ValueError("duplicate_card")

        existing_cards.append(card)
        deck["cards"] = existing_cards
        self._write_deck(deck)
        return card

    # ── M15: Pair-match manual authoring ──────────────────────────────

    @staticmethod
    def _validate_pair_match_pairs(
        pairs: List[Dict[str, str]],
    ) -> List[Dict[str, str]]:
        """Validate and normalize pair_match pairs list.

        Constraints (spec §7.5 / M15):
        - 2–5 pairs required
        - Each pair has non-empty 'left' and 'right' strings
        - No many-to-many: each left text and each right text must be unique
        """
        if not isinstance(pairs, list):
            raise ValueError("pairs_required")
        cleaned: List[Dict[str, str]] = []
        for p in pairs:
            if not isinstance(p, dict):
                continue
            left = str(p.get("left") or "").strip()
            right = str(p.get("right") or "").strip()
            if left and right:
                cleaned.append({"left": left, "right": right})
        if len(cleaned) < 2:
            raise ValueError("pair_match_min_2_pairs")
        if len(cleaned) > 5:
            raise ValueError("pair_match_max_5_pairs")
        # No many-to-many: unique lefts, unique rights
        lefts = [p["left"] for p in cleaned]
        rights = [p["right"] for p in cleaned]
        if len(set(lefts)) != len(lefts):
            raise ValueError("pair_match_duplicate_left")
        if len(set(rights)) != len(rights):
            raise ValueError("pair_match_duplicate_right")
        return cleaned

    def create_pair_match_card_manual(
        self,
        *,
        deck_id: str,
        front_text: str,
        pairs: List[Dict[str, str]],
        tags: Optional[List[str]] = None,
        difficulty_hint: str = "medium",
    ) -> Dict[str, Any]:
        """Create a pair_match card manually (M15).

        Args:
            deck_id: Target deck
            front_text: Instruction text (e.g. "Сопоставьте термин и определение")
            pairs: List of {"left": str, "right": str} (2-5 pairs)
            tags: Optional tag list
            difficulty_hint: low/medium/high
        """
        deck = self.get_deck(deck_id)
        if not isinstance(deck, dict):
            raise LookupError("deck_not_found")

        front_text = _s(front_text)
        if not front_text:
            raise ValueError("front_text_required")

        validated_pairs = self._validate_pair_match_pairs(pairs)

        # Build structured payload matching analysis-generated format
        left_items = []
        right_items = []
        pair_links = []
        for idx, p in enumerate(validated_pairs, start=1):
            lid = f"l{idx}"
            rid = f"r{idx}"
            left_items.append({"id": lid, "text": p["left"]})
            right_items.append({"id": rid, "text": p["right"]})
            pair_links.append({"left_id": lid, "right_id": rid})

        shuffled_right = list(right_items)
        random.shuffle(shuffled_right)

        card: Dict[str, Any] = {
            "id": f"mc_{uuid.uuid4().hex[:10]}",
            "schema_version": "1.0",
            "deck_id": deck_id,
            "analysis_id": None,
            "unit_ids": [],
            "chunk_ids": [],
            "card_type": "pair_match",
            "front": {
                "text": front_text,
                "payload": {
                    "mode": "pair_match",
                    "left_items": left_items,
                    "right_items": shuffled_right,
                    "shuffle_right": True,
                },
            },
            "back": {
                "text": "Правильные соответствия",
                "payload": {
                    "mode": "pair_match_solution",
                    "pairs": pair_links,
                    "explanations": [],
                },
            },
            "anchors": [],
            "tags": _str_list(tags, limit=32),
            "difficulty_hint": _s(difficulty_hint, "medium").lower() or "medium",
            "source_evidence": [],
            "created_by": "manual_editor",
            "status": "active",
            "meta": {"created_at": _utc_now_iso()},
        }

        # Dedup check
        existing_cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        new_sig = self._card_signature(card)
        for ec in existing_cards:
            if isinstance(ec, dict) and self._card_signature(ec) == new_sig:
                raise ValueError("duplicate_card")

        existing_cards.append(card)
        deck["cards"] = existing_cards
        self._write_deck(deck)
        return card

    def update_pair_match_card(
        self,
        *,
        deck_id: str,
        card_id: str,
        front_text: Optional[str] = None,
        pairs: Optional[List[Dict[str, str]]] = None,
        tags: Optional[List[str]] = None,
        difficulty_hint: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Update an existing pair_match card's pairs/text/metadata (M15)."""
        deck = self.get_deck(deck_id)
        if not isinstance(deck, dict):
            raise LookupError("deck_not_found")

        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        card = next((c for c in cards if isinstance(c, dict) and _s(c.get("id")) == _s(card_id)), None)
        if not isinstance(card, dict):
            raise LookupError("card_not_found")
        if _s(card.get("card_type")) != "pair_match":
            raise ValueError("not_pair_match_card")

        changed = False

        if front_text is not None:
            ft = _s(front_text)
            if not ft:
                raise ValueError("front_text_required")
            front = card.get("front") if isinstance(card.get("front"), dict) else {"text": "", "payload": {}}
            front["text"] = ft
            card["front"] = front
            changed = True

        if pairs is not None:
            validated = self._validate_pair_match_pairs(pairs)
            left_items = []
            right_items = []
            pair_links = []
            for idx, p in enumerate(validated, start=1):
                lid = f"l{idx}"
                rid = f"r{idx}"
                left_items.append({"id": lid, "text": p["left"]})
                right_items.append({"id": rid, "text": p["right"]})
                pair_links.append({"left_id": lid, "right_id": rid})
            shuffled_right = list(right_items)
            random.shuffle(shuffled_right)

            front = card.get("front") if isinstance(card.get("front"), dict) else {"text": "", "payload": {}}
            front["payload"] = {
                "mode": "pair_match",
                "left_items": left_items,
                "right_items": shuffled_right,
                "shuffle_right": True,
            }
            card["front"] = front

            back = card.get("back") if isinstance(card.get("back"), dict) else {"text": "", "payload": {}}
            back["payload"] = {
                "mode": "pair_match_solution",
                "pairs": pair_links,
                "explanations": back.get("payload", {}).get("explanations", []) if isinstance(back.get("payload"), dict) else [],
            }
            card["back"] = back
            changed = True

        if tags is not None:
            card["tags"] = _str_list(tags, limit=32)
            changed = True
        if difficulty_hint is not None:
            dh = _s(difficulty_hint, "medium").lower()
            if dh in {"low", "medium", "high"}:
                card["difficulty_hint"] = dh
                changed = True
        if status is not None:
            st = _s(status, "active").lower()
            if st in {"active", "archived", "suspended"}:
                card["status"] = st
                changed = True

        if changed:
            new_sig = self._card_signature(card)
            for ec in cards:
                if not isinstance(ec, dict):
                    continue
                if _s(ec.get("id")) == _s(card_id):
                    continue
                if self._card_signature(ec) == new_sig:
                    raise ValueError("duplicate_card")
            meta = card.get("meta") if isinstance(card.get("meta"), dict) else {}
            meta["updated_at"] = _utc_now_iso()
            card["meta"] = meta
            self._write_deck(deck)

        return card

    def update_card(
        self,
        *,
        deck_id: str,
        card_id: str,
        front_text: Optional[str] = None,
        back_text: Optional[str] = None,
        tags: Optional[List[str]] = None,
        difficulty_hint: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not isinstance(deck, dict):
            raise LookupError("deck_not_found")

        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        card = next((c for c in cards if isinstance(c, dict) and _s(c.get("id")) == _s(card_id)), None)
        if not isinstance(card, dict):
            raise LookupError("card_not_found")

        changed = False
        if front_text is not None:
            ft = _s(front_text)
            if not ft:
                raise ValueError("front_text_required")
            front = card.get("front") if isinstance(card.get("front"), dict) else {"text": "", "payload": {}}
            front["text"] = ft
            card["front"] = front
            changed = True
        if back_text is not None:
            bt = _s(back_text)
            if not bt:
                raise ValueError("back_text_required")
            back = card.get("back") if isinstance(card.get("back"), dict) else {"text": "", "payload": {}}
            back["text"] = bt
            card["back"] = back
            changed = True
        if tags is not None:
            card["tags"] = _str_list(tags, limit=32)
            changed = True
        if difficulty_hint is not None:
            dh = _s(difficulty_hint, "medium").lower()
            if dh in {"low", "medium", "high"}:
                card["difficulty_hint"] = dh
                changed = True
        if status is not None:
            st = _s(status, "active").lower()
            if st in {"active", "archived", "suspended"}:
                card["status"] = st
                changed = True

        if changed:
            # Dedup check against other cards
            new_sig = self._card_signature(card)
            for ec in cards:
                if not isinstance(ec, dict):
                    continue
                if _s(ec.get("id")) == _s(card_id):
                    continue
                if self._card_signature(ec) == new_sig:
                    raise ValueError("duplicate_card")
            meta = card.get("meta") if isinstance(card.get("meta"), dict) else {}
            meta["updated_at"] = _utc_now_iso()
            card["meta"] = meta
            self._write_deck(deck)

        return card

    def delete_card(self, deck_id: str, card_id: str) -> bool:
        deck = self.get_deck(deck_id)
        if not isinstance(deck, dict):
            raise LookupError("deck_not_found")
        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        new_cards = [c for c in cards if not (isinstance(c, dict) and _s(c.get("id")) == _s(card_id))]
        if len(new_cards) == len(cards):
            raise LookupError("card_not_found")
        deck["cards"] = new_cards
        self._write_deck(deck)
        return True

    def reorder_cards(self, deck_id: str, card_ids: List[str]) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not isinstance(deck, dict):
            raise LookupError("deck_not_found")
        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        card_map = {_s(c.get("id")): c for c in cards if isinstance(c, dict) and _s(c.get("id"))}
        ordered: List[Dict[str, Any]] = []
        seen: set = set()
        for cid in card_ids:
            cid = _s(cid)
            if cid in card_map and cid not in seen:
                ordered.append(card_map[cid])
                seen.add(cid)
        # Append any cards not in the supplied order (safety)
        for c in cards:
            if isinstance(c, dict):
                cid = _s(c.get("id"))
                if cid and cid not in seen:
                    ordered.append(c)
                    seen.add(cid)
        deck["cards"] = ordered
        self._write_deck(deck)
        return deck

    def get_card(self, deck_id: str, card_id: str) -> Optional[Dict[str, Any]]:
        deck = self.get_deck(deck_id)
        if not isinstance(deck, dict):
            return None
        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        return next((c for c in cards if isinstance(c, dict) and _s(c.get("id")) == _s(card_id)), None)

    # ── M12: Text import create/append ────────────────────────────────

    def import_cards_from_parsed(
        self,
        *,
        parsed_items: List[Dict[str, Any]],
        mode: str = "create_deck",
        target_deck_id: Optional[str] = None,
        deck_name: Optional[str] = None,
        target_language: str = "unknown",
    ) -> Dict[str, Any]:
        """Import parsed @MICROCARD and @PAIR_MATCH items into a new or existing deck.

        Args:
            parsed_items: List of item dicts from MicrocardParser.parse_text()["items"]
            mode: "create_deck" or "append_to_deck"
            target_deck_id: Required when mode="append_to_deck"
            deck_name: Deck name for create_deck mode (or suggested override)
            target_language: Language tag for new deck

        Returns:
            Dict with deck, added_cards, skipped_duplicates, skipped_errors
        """
        mode = _s(mode, "create_deck").lower()
        if mode not in {"create_deck", "append_to_deck"}:
            raise ValueError("invalid_mode")

        if mode == "append_to_deck":
            target_deck_id = _s(target_deck_id)
            if not target_deck_id:
                raise ValueError("target_deck_id_required")
            deck = self.get_deck(target_deck_id)
            if not isinstance(deck, dict):
                raise LookupError("deck_not_found")
        else:
            # Determine deck name from items metadata or explicit param
            resolved_name = _s(deck_name)
            if not resolved_name:
                for item in parsed_items:
                    meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
                    dn = _s(meta.get("deck"))
                    if dn:
                        resolved_name = dn
                        break
            if not resolved_name:
                resolved_name = "Импорт микрокарточек"
            deck = self.create_deck_manual(
                name=resolved_name[:120],
                tags=[],
                target_language=_s(target_language, "unknown") or "unknown",
            )
            # Update source in meta
            meta = deck.get("meta") if isinstance(deck.get("meta"), dict) else {}
            meta["source"] = "text_import"
            deck["meta"] = meta
            self._write_deck(deck)

        existing_cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        signatures = {self._card_signature(c) for c in existing_cards if isinstance(c, dict)}

        added_cards = 0
        skipped_duplicates = 0
        skipped_errors = 0

        for item in parsed_items:
            if not isinstance(item, dict):
                skipped_errors += 1
                continue
            if item.get("status") == "error":
                skipped_errors += 1
                continue

            preview = item.get("card_preview") if isinstance(item.get("card_preview"), dict) else {}
            card_type = _s(preview.get("card_type"), "fact_recall").lower()

            item_meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            tags = _str_list(item_meta.get("tags"), limit=32)
            difficulty = _s(item_meta.get("difficulty"), "medium").lower()
            if difficulty not in {"low", "medium", "high"}:
                difficulty = "medium"

            # M15: pair_match cards from @PAIR_MATCH parser
            if card_type == "pair_match":
                front_text = _s(preview.get("front"))
                pairs_raw = preview.get("pairs") if isinstance(preview.get("pairs"), list) else []
                if not front_text or len(pairs_raw) < 2:
                    skipped_errors += 1
                    continue
                try:
                    validated = self._validate_pair_match_pairs(pairs_raw)
                except ValueError:
                    skipped_errors += 1
                    continue
                left_items = []
                right_items = []
                pair_links = []
                for idx, p in enumerate(validated, start=1):
                    lid = f"l{idx}"
                    rid = f"r{idx}"
                    left_items.append({"id": lid, "text": p["left"]})
                    right_items.append({"id": rid, "text": p["right"]})
                    pair_links.append({"left_id": lid, "right_id": rid})
                shuffled_right = list(right_items)
                random.shuffle(shuffled_right)
                card: Dict[str, Any] = {
                    "id": f"mc_{uuid.uuid4().hex[:10]}",
                    "schema_version": "1.0",
                    "deck_id": _s(deck.get("id")),
                    "analysis_id": None,
                    "unit_ids": [],
                    "chunk_ids": [],
                    "card_type": "pair_match",
                    "front": {
                        "text": front_text,
                        "payload": {
                            "mode": "pair_match",
                            "left_items": left_items,
                            "right_items": shuffled_right,
                            "shuffle_right": True,
                        },
                    },
                    "back": {
                        "text": "Правильные соответствия",
                        "payload": {
                            "mode": "pair_match_solution",
                            "pairs": pair_links,
                            "explanations": [],
                        },
                    },
                    "anchors": [],
                    "tags": tags,
                    "difficulty_hint": difficulty,
                    "source_evidence": [],
                    "created_by": "text_import",
                    "status": "active",
                    "meta": {"created_at": _utc_now_iso()},
                }
            else:
                front_text = _s(preview.get("front"))
                back_text = _s(preview.get("back"))
                if not front_text or not back_text:
                    skipped_errors += 1
                    continue
                card = {
                    "id": f"mc_{uuid.uuid4().hex[:10]}",
                    "schema_version": "1.0",
                    "deck_id": _s(deck.get("id")),
                    "analysis_id": None,
                    "unit_ids": [],
                    "chunk_ids": [],
                    "card_type": "fact_recall",
                    "front": {"text": front_text, "payload": {}},
                    "back": {"text": back_text, "payload": {}},
                    "anchors": [],
                    "tags": tags,
                    "difficulty_hint": difficulty,
                    "source_evidence": [],
                    "created_by": "text_import",
                    "status": "active",
                    "meta": {"created_at": _utc_now_iso()},
                }

            sig = self._card_signature(card)
            if sig in signatures:
                skipped_duplicates += 1
                continue
            signatures.add(sig)
            existing_cards.append(card)
            added_cards += 1

        deck["cards"] = existing_cards
        meta = deck.get("meta") if isinstance(deck.get("meta"), dict) else {}
        import_history = meta.get("import_history") if isinstance(meta.get("import_history"), list) else []
        import_history.append({
            "at": _utc_now_iso(),
            "user_id": self.user_id,
            "source": "text_import",
            "mode": mode,
            "added_cards": added_cards,
            "skipped_duplicates": skipped_duplicates,
            "skipped_errors": skipped_errors,
        })
        if len(import_history) > 50:
            import_history = import_history[-50:]
        meta["import_history"] = import_history
        deck["meta"] = meta
        self._write_deck(deck)

        return {
            "deck": deck,
            "added_cards": added_cards,
            "skipped_duplicates": skipped_duplicates,
            "skipped_errors": skipped_errors,
        }
