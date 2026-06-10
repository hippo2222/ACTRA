"""Microcards V2 service with FSRS-4.5 scheduler and progressive levels."""

import copy
import hashlib
import json
import logging
import os
import random
import re
import uuid
import difflib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from logic.fsrs import FSRS, Rating, State

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse_iso(value: Any) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        return datetime.fromisoformat(raw)
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


_UNSET = object()  # sentinel: "argument not provided" vs explicit None

_ATTRIBUTION_FIELDS = ("author", "license", "license_url", "source_page", "source")


def _clean_attribution(value: Any) -> Optional[Dict[str, Any]]:
    """Keep only known attribution fields as trimmed strings; None if empty."""
    if not isinstance(value, dict):
        return None
    out: Dict[str, Any] = {}
    for k in _ATTRIBUTION_FIELDS:
        v = value.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s:
            out[k] = s
    return out or None


def _clean_answer_list(values: Any) -> List[str]:
    """Normalize an optional list of acceptable answers: trim, drop empties/dupes."""
    if not values:
        return []
    if isinstance(values, str):
        values = [values]
    result: List[str] = []
    seen = set()
    for v in values:
        text = _s(v)
        key = " ".join(text.lower().split())
        if text and key not in seen:
            seen.add(key)
            result.append(text)
    return result


def _normalize_key(text: Any) -> str:
    """Lowercased, whitespace-collapsed key used for dedup comparisons."""
    return " ".join(_s(text).lower().split())


def _card_content_key(card: Dict[str, Any]) -> str:
    """Stable content fingerprint of a card (normalized front+back).

    Stored on review states so that when a linked deck's author republishes
    with re-created card ids, the subscriber's progress can be matched back
    to the same content (see _reconcile_linked_states)."""
    front = ((card.get("front") or {}).get("text")) or ""
    back = ((card.get("back") or {}).get("text")) or ""
    raw = _normalize_key(front) + "\x1f" + _normalize_key(back)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _is_hosted_runtime() -> bool:
    return str(os.environ.get("ACTRA_RUNTIME_MODE") or "").strip().lower() == "hosted_web"


def _resolve_microcards_user_id(user_id: Optional[str], *, legacy_default: str = "default_user") -> str:
    resolved = _s(user_id)
    if resolved:
        return resolved
    if _is_hosted_runtime():
        raise ValueError("user_id_required_in_hosted_runtime")
    return _s(legacy_default, "default_user") or "default_user"


class MicrocardsServiceV2:
    DEFAULT_SETTINGS = {
        "session_size": 20,
        "new_per_session": 20,
        "new_per_session_mode": "auto",  # manual | auto (adaptive to review backlog)
        "default_direction": "front_back",  # front_back | back_front | mixed
    }
    DIRECTIONS = ("front_back", "back_front", "mixed")
    # Fixed, typo-tolerant answer-matching threshold. Not user-configurable on purpose:
    # typos should pass by default, and genuinely borderline answers are resolved by the
    # learner via the "count as correct" (override) action during review.
    FUZZY_THRESHOLD = 0.82

    def __init__(self, data_dir: str, user_id: Optional[str] = None) -> None:
        self.data_dir = Path(data_dir)
        self.user_id = _resolve_microcards_user_id(user_id)
        self.fsrs = FSRS()
        # Set by the route layer; used to resolve linked (catalog-referenced) decks
        # read-only without copying their content.
        self.catalog_service = None

    def switch_user(self, user_id: Optional[str]) -> None:
        self.user_id = _resolve_microcards_user_id(user_id)

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
    def _settings_path(self) -> Path:
        return self._user_root / "settings.json"

    def get_settings(self) -> Dict[str, Any]:
        """User study settings with defaults applied and values clamped to safe ranges."""
        raw = _read_json(self._settings_path, {})
        s = dict(self.DEFAULT_SETTINGS)
        if isinstance(raw, dict):
            for k in s:
                if raw.get(k) is not None:
                    s[k] = raw[k]
        try:
            s["session_size"] = max(1, min(int(s["session_size"]), 100))
        except Exception:
            s["session_size"] = self.DEFAULT_SETTINGS["session_size"]
        try:
            s["new_per_session"] = max(0, min(int(s["new_per_session"]), 100))
        except Exception:
            s["new_per_session"] = self.DEFAULT_SETTINGS["new_per_session"]
        if s.get("new_per_session_mode") not in ("manual", "auto"):
            s["new_per_session_mode"] = self.DEFAULT_SETTINGS["new_per_session_mode"]
        if s["default_direction"] not in self.DIRECTIONS:
            s["default_direction"] = self.DEFAULT_SETTINGS["default_direction"]
        return s

    @property
    def _events_path(self) -> Path:
        return self._user_root / "review_events.json"

    @property
    def _records_path(self) -> Path:
        return self._user_root / "deck_records.json"

    @property
    def _sessions_path(self) -> Path:
        return self._user_root / "review_sessions.json"

    def _deck_path(self, deck_id: str) -> Path:
        return self._decks_root / f"{deck_id}.json"

    def _read_states(self) -> Dict[str, Dict[str, Any]]:
        payload = _read_json(self._states_path, {"schema_version": "2.0", "user_id": self.user_id, "items": {}})
        items = payload.get("items") if isinstance(payload, dict) else {}
        if not isinstance(items, dict):
            items = {}
        out: Dict[str, Dict[str, Any]] = {}
        for card_id, state in items.items():
            if isinstance(state, dict):
                out[str(card_id)] = dict(state)
        return out

    def _write_states(self, states: Dict[str, Dict[str, Any]]) -> None:
        payload = {
            "schema_version": "2.0",
            "user_id": self.user_id,
            "updated_at": _utc_now_iso(),
            "items": states
        }
        _write_json(self._states_path, payload)

    def _append_event(self, event: Dict[str, Any]) -> None:
        events = _read_json(self._events_path, [])
        if not isinstance(events, list):
            events = []
        events.append(event)
        # Cap events to prevent bloating
        if len(events) > 5000:
            events = events[-5000:]
        _write_json(self._events_path, events)

    # Active-session slots per deck: a paused RUN must not block the daily
    # REVIEW (and vice versa), and L1/L2 runs are tracked independently.
    SESSION_SLOTS = ("review", "run_l1", "run_l2")

    @staticmethod
    def _session_slot(session: Dict[str, Any]) -> str:
        if session.get("mode") == "run":
            return "run_l2" if session.get("level_mode") == 2 else "run_l1"
        return "review"

    def _read_sessions(self) -> Dict[str, Any]:
        payload = _read_json(self._sessions_path, {"schema_version": "2.0", "user_id": self.user_id, "items": {}, "active_by_deck": {}})
        items = payload.get("items")
        active_by_deck = payload.get("active_by_deck")
        if not isinstance(items, dict):
            items = {}
        if not isinstance(active_by_deck, dict):
            active_by_deck = {}
        # Normalize active pointers to the slot structure. Legacy string values
        # (pre-run schema) are dropped on purpose: those sessions predate the
        # run/record model and their partial queues must not become runs.
        normalized: Dict[str, Dict[str, str]] = {}
        for deck_id, value in active_by_deck.items():
            if isinstance(value, dict):
                slots = {k: v for k, v in value.items() if k in self.SESSION_SLOTS and isinstance(v, str) and v}
                if slots:
                    normalized[deck_id] = slots
        return {
            "schema_version": "2.0",
            "user_id": self.user_id,
            "items": items,
            "active_by_deck": normalized
        }

    def _write_sessions(self, sessions_payload: Dict[str, Any]) -> None:
        _write_json(self._sessions_path, sessions_payload)

    def _get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        sessions = self._read_sessions()
        return sessions["items"].get(session_id)

    def _save_session(self, session: Dict[str, Any], *, set_active: bool = False) -> None:
        sessions = self._read_sessions()
        session_id = session.get("id")
        deck_id = session.get("deck_id")
        if not session_id or not deck_id:
            return
        sessions["items"][session_id] = session
        if set_active:
            slot = self._session_slot(session)
            deck_slots = sessions["active_by_deck"].setdefault(deck_id, {})
            if not session.get("completed"):
                deck_slots[slot] = session_id
            else:
                deck_slots.pop(slot, None)
                if not deck_slots:
                    sessions["active_by_deck"].pop(deck_id, None)
        self._write_sessions(sessions)

    def _get_active_sessions_for_deck(self, deck_id: str) -> Dict[str, Dict[str, Any]]:
        """Active sessions of a deck by slot: review / run_l1 / run_l2."""
        sessions = self._read_sessions()
        out: Dict[str, Dict[str, Any]] = {}
        for slot, session_id in (sessions["active_by_deck"].get(deck_id) or {}).items():
            sess = sessions["items"].get(session_id)
            if isinstance(sess, dict) and not sess.get("completed"):
                out[slot] = sess
        return out

    @staticmethod
    def _session_summary_light(session: Dict[str, Any]) -> Dict[str, Any]:
        """Small per-slot summary for deck payloads (library/details)."""
        stats = session.get("stats") or {}
        unique_total = stats.get("unique_total")
        mastered = stats.get("mastered")
        if unique_total is None or mastered is None:
            unique_total = len(session.get("card_queue", []))
            mastered = session.get("cursor", 0)
        return {
            "session_id": session.get("id"),
            "mode": session.get("mode") or "review",
            "level_mode": session.get("level_mode"),
            "mastered": int(mastered or 0),
            "unique_total": int(unique_total or 0),
            "paused": bool(session.get("paused")),
        }

    def _get_active_session_for_deck(self, deck_id: str, slot: Optional[str] = None) -> Optional[Dict[str, Any]]:
        actives = self._get_active_sessions_for_deck(deck_id)
        if slot is not None:
            return actives.get(slot)
        # No slot requested: prefer a run (the long-lived object) over a review.
        for key in ("run_l1", "run_l2", "review"):
            if key in actives:
                return actives[key]
        return None

    def _scrub_cards_from_session(self, session: Dict[str, Any], valid_ids: set) -> bool:
        """Drop queue entries whose cards no longer exist in the deck.

        The deck can be edited while a session is paused (or from another tab),
        leaving ghost ids in the queue that would 404 on answer. Removes the
        ghosts everywhere (queue, first_results, mastered, errors, directions),
        keeps the cursor on the same upcoming card and re-derives the progress
        counters. Returns True when the session changed."""
        queue = session.get("card_queue", [])
        keep = [_s(cid) in valid_ids for cid in queue]
        if all(keep):
            return False

        cursor = int(session.get("cursor", 0) or 0)
        session["card_queue"] = [cid for cid, ok in zip(queue, keep) if ok]
        session["cursor"] = sum(1 for ok in keep[:cursor] if ok)

        removed = {_s(cid) for cid, ok in zip(queue, keep) if not ok}
        first_results = session.setdefault("first_results", {})
        for cid in removed:
            first_results.pop(cid, None)
        mastered_ids = [cid for cid in session.get("mastered_ids") or [] if _s(cid) not in removed]
        session["mastered_ids"] = mastered_ids
        directions = session.get("card_directions") or {}
        for cid in removed:
            directions.pop(cid, None)

        stats = session.setdefault("stats", {})
        stats["error_card_ids"] = [cid for cid in stats.get("error_card_ids") or [] if _s(cid) not in removed]
        unique_total = len({_s(cid) for cid in session["card_queue"]})
        stats["unique_total"] = unique_total
        stats["total"] = unique_total
        stats["mastered"] = len(mastered_ids)
        stats["first_try_correct"] = sum(1 for ok in first_results.values() if ok)
        stats["pending_retry"] = sum(1 for cid in first_results if cid not in mastered_ids)

        if session["cursor"] >= len(session["card_queue"]) and not session.get("completed"):
            session["completed"] = True
            session["completed_at"] = _utc_now_iso()
        return True

    # ── Deck Records (per-user, server-side) ────────────────────────────

    # Records schema "2.0": scores/stars are earned ONLY by completed full-deck
    # runs. Legacy (session-based) records are wiped on first read — agreed
    # one-time reset when the run model shipped.
    RECORDS_SCHEMA = "2.0"

    def _read_records(self) -> Dict[str, Dict[str, Any]]:
        payload = _read_json(self._records_path, {"schema_version": self.RECORDS_SCHEMA, "user_id": self.user_id, "items": {}})
        if not isinstance(payload, dict) or payload.get("schema_version") != self.RECORDS_SCHEMA:
            return {}
        items = payload.get("items")
        if not isinstance(items, dict):
            items = {}
        return {str(k): dict(v) for k, v in items.items() if isinstance(v, dict)}

    def _write_records(self, records: Dict[str, Dict[str, Any]]) -> None:
        payload = {
            "schema_version": self.RECORDS_SCHEMA,
            "user_id": self.user_id,
            "updated_at": _utc_now_iso(),
            "items": records,
        }
        _write_json(self._records_path, payload)

    def get_all_records(self) -> Dict[str, Dict[str, Any]]:
        """Return all deck records for this user."""
        return self._read_records()

    # ── L1 completion gate ──────────────────────────────────────────────
    #
    # Level 2 unlocks only after the whole deck is passed on level 1: every
    # card closed with a correct answer at least once (the mastery cycle
    # guarantees that for each completed session). Cards added to the deck
    # later naturally re-lock progress until they are passed too.

    @staticmethod
    def _l1_progress_for_ids(card_ids: List[Any], states: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        ids = [_s(cid) for cid in card_ids if _s(cid)]
        total = len(ids)
        mastered = sum(1 for cid in ids if (states.get(cid) or {}).get("l1_mastered"))
        return {
            "mastered": mastered,
            "total": total,
            "complete": total > 0 and mastered >= total,
        }

    def _l1_progress(self, deck: Dict[str, Any], states: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
        if states is None:
            states = self._read_states()
        card_ids = [c.get("id") for c in (deck.get("cards") or [])]
        if not card_ids and deck.get("linked"):
            card_ids = deck.get("linked_card_ids") or []
        return self._l1_progress_for_ids(card_ids, states)

    @staticmethod
    def _stars_for_accuracy(accuracy_pct: float) -> int:
        """First-try accuracy → 0..5 stars (the mastery cycle guarantees 100%
        completion, so repeats are what separate the star tiers)."""
        if accuracy_pct >= 100:
            return 5
        if accuracy_pct >= 80:
            return 4
        if accuracy_pct >= 60:
            return 3
        if accuracy_pct >= 40:
            return 2
        if accuracy_pct >= 20:
            return 1
        return 0

    def get_deck_record(self, deck_id: str) -> Dict[str, Any]:
        """Best completed-run results per level + the L2 gate.

        The gate is run-based: level 2 unlocks once at least one FULL-DECK
        level-1 run has been completed. Adding cards later does not re-lock it
        (the run was honestly completed) — but new star attempts always cover
        the whole current deck."""
        records = self._read_records()
        rec = records.get(str(deck_id)) or {}
        out = {
            "scoreL1": int(rec.get("scoreL1") or 0),
            "starsL1": int(rec.get("starsL1") or 0),
            "sizeL1": int(rec.get("sizeL1") or 0),
            "scoreL2": int(rec.get("scoreL2") or 0),
            "starsL2": int(rec.get("starsL2") or 0),
            "sizeL2": int(rec.get("sizeL2") or 0),
            "l1_run_completed": bool(rec.get("l1_run_completed")),
        }
        out["l2_unlocked"] = out["l1_run_completed"]
        deck = self.get_deck(deck_id)
        if deck:
            # Informational per-card metric (kept for deck stats; NOT the gate).
            out["l1_progress"] = self._l1_progress(deck)
        return out

    def _apply_run_record(self, deck_id: str, *, level: int, score: int, stars: int,
                          deck_size: int) -> Dict[str, Any]:
        """Persist a completed run's result; keeps the all-time best per level."""
        records = self._read_records()
        rec = dict(records.get(str(deck_id)) or {})
        score = max(0, int(score))
        stars = max(0, min(5, int(stars)))
        suffix = "L2" if level == 2 else "L1"
        is_new_record = False
        if score > int(rec.get(f"score{suffix}") or 0):
            rec[f"score{suffix}"] = score
            rec[f"size{suffix}"] = max(0, int(deck_size))
            is_new_record = True
        if stars > int(rec.get(f"stars{suffix}") or 0):
            rec[f"stars{suffix}"] = stars
        if level != 2:
            # Any completed L1 run opens the gate, stars don't matter.
            rec["l1_run_completed"] = True
        records[str(deck_id)] = rec
        self._write_records(records)
        return {"record": rec, "is_new_record": is_new_record}

    def save_deck_record(self, deck_id: str, score: int, stars: int, level_mode: int = 1) -> Dict[str, Any]:
        """Update deck record for a given level. Only keeps all-time best per level.
        Returns the updated record dict and whether this was a new record (is_new_record).
        """
        records = self._read_records()
        rec = dict(records.get(str(deck_id)) or {})
        # Ensure all keys exist
        for key in ("scoreL1", "starsL1", "scoreL2", "starsL2"):
            if key not in rec:
                rec[key] = 0

        score = max(0, int(score))
        stars = max(0, min(5, int(stars)))
        is_new_record = False

        if level_mode == 2:
            if score > rec["scoreL2"]:
                rec["scoreL2"] = score
                is_new_record = True
            if stars > rec["starsL2"]:
                rec["starsL2"] = stars
        else:
            if score > rec["scoreL1"]:
                rec["scoreL1"] = score
                is_new_record = True
            if stars > rec["starsL1"]:
                rec["starsL1"] = stars

        records[str(deck_id)] = rec
        self._write_records(records)
        return {"record": rec, "is_new_record": is_new_record}

    # ── Decks CRUD ────────────────────────────────────────────────────

    def _owns_deck(self, deck: Dict[str, Any]) -> bool:
        """Decks live in a global store but belong to a single user.
        Ownership is the only access boundary — enforce it everywhere."""
        return _s(deck.get("created_by_user_id")) == _s(self.user_id)

    def get_deck(self, deck_id: str) -> Optional[Dict[str, Any]]:
        path = self._deck_path(deck_id)
        deck = _read_json(path, None)
        if not isinstance(deck, dict):
            return None
        # Ownership guard: prevents cross-user read/update/delete (IDOR).
        # All mutations route through get_deck, so this scopes details, cards
        # CRUD, sessions, import/export and publish to the owner.
        if not self._owns_deck(deck):
            return None
        # Linked deck = a read-only reference to a catalog publication (like the
        # complex/theory "linked library" model). Resolve its cards live from the
        # catalog snapshot — never copied/editable.
        if deck.get("linked"):
            cards, access_state = self._resolve_linked_deck(deck)
            deck["cards"] = cards
            deck["read_only"] = True
            deck["access_state"] = access_state
            if access_state == "granted":
                resolved_ids = [c.get("id") for c in cards if c.get("id")]
                current_ids = deck.get("linked_card_ids") or []
                current_count = deck.get("card_count")
                if resolved_ids != current_ids or len(cards) != current_count:
                    # The author republished and card ids may have changed —
                    # carry this user's review progress over to the matching
                    # new cards before the old ids are forgotten.
                    self._reconcile_linked_states(current_ids, cards)
                    # Update cache on disk
                    raw_deck = _read_json(path, None)
                    if isinstance(raw_deck, dict):
                        raw_deck["linked_card_ids"] = resolved_ids
                        raw_deck["card_count"] = len(cards)
                        raw_deck["updated_at"] = _utc_now_iso()
                        _write_json(path, raw_deck)
                    deck["linked_card_ids"] = resolved_ids
                    deck["card_count"] = len(cards)
            else:
                deck["card_count"] = deck.get("card_count") or 0
        return deck

    def _reconcile_linked_states(self, old_ids: List[Any], new_cards: List[Dict[str, Any]]) -> None:
        """Migrate review states orphaned by a linked-deck republish.

        Linked decks resolve the author's LATEST snapshot live, so when the
        author re-creates cards (re-import, delete+create) their ids change and
        the subscriber's review states (FSRS schedule, level, l1_mastered)
        would silently orphan — resetting the L2 gate and deck progress.
        Old states are matched to the new cards by content fingerprint and
        moved onto the new ids. Unmatched states are left in place (analytics
        already ignores orphans) — never guess between edited cards."""
        old_set = {_s(cid) for cid in old_ids if _s(cid)}
        if not old_set:
            return
        new_by_id = {_s(c.get("id")): c for c in new_cards if _s(c.get("id"))}
        gone = old_set - set(new_by_id)
        if not gone:
            return
        states = self._read_states()
        # Candidate targets: new cards without their own state yet, by content key.
        key_to_new_id: Dict[str, str] = {}
        for cid, c in new_by_id.items():
            if cid in states:
                continue
            key_to_new_id.setdefault(_card_content_key(c), cid)
        changed = False
        for old_id in sorted(gone):
            st = states.get(old_id)
            if not st:
                continue
            key = st.get("content_key")
            new_id = key_to_new_id.pop(key, None) if key else None
            if not new_id:
                continue
            migrated = dict(st)
            migrated["card_id"] = new_id
            states[new_id] = migrated
            del states[old_id]
            changed = True
        if changed:
            self._write_states(states)

    def _resolve_linked_deck(self, deck: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], str]:
        """Fetch read-only cards for a linked deck from the catalog snapshot.

        access_state: 'granted' | 'requires_access_code' | 'revoked' | 'unavailable'.
        """
        cat = self.catalog_service
        item_id = _s(deck.get("catalog_item_id"))
        if not cat or not item_id:
            logger.warning(
                "[_resolve_linked_deck] Cannot resolve linked deck: "
                f"catalog_service={cat}, item_id={item_id}"
            )
            return [], "unavailable"
        code = deck.get("granted_access_code")
        try:
            res = cat.add_item_to_library(item_id, requested_by_user_id=self.user_id, access_code=code)
            snap = res.get("snapshot") or {}
            cards = snap.get("cards") or []
            return (cards if isinstance(cards, list) else []), "granted"
        except ValueError as exc:
            msg = str(exc).lower()
            logger.warning(
                f"[_resolve_linked_deck] ValueError resolving item {item_id}: {exc}",
                exc_info=True
            )
            if "access_code" in msg or "access code" in msg:
                return [], "requires_access_code"
            if "not_found" in msg or "deleted" in msg or "revoked" in msg or "not_accessible" in msg:
                return [], "revoked"
            return [], "unavailable"
        except Exception as exc:
            logger.exception(
                f"[_resolve_linked_deck] Unexpected exception resolving item {item_id}"
            )
            return [], "unavailable"

    def _assert_editable(self, deck: Dict[str, Any]) -> None:
        """Linked decks are read-only references — block content mutations."""
        if deck.get("linked"):
            raise ValueError("deck_is_linked_readonly")

    def list_decks(self, limit: int = 100) -> List[Dict[str, Any]]:
        paths = list(self._decks_root.glob("*.json"))
        decks: List[Dict[str, Any]] = []
        states = self._read_states()
        records = self._read_records()

        for p in paths:
            deck = _read_json(p, None)
            if isinstance(deck, dict) and self._owns_deck(deck):
                deck_id = deck.get("id")
                is_linked = bool(deck.get("linked"))
                # Linked decks don't store cards locally — use the cached id list /
                # count captured at link time (cheap; avoids a catalog read per deck).
                if is_linked:
                    card_ids = deck.get("linked_card_ids") or []
                    card_count = deck.get("card_count") if deck.get("card_count") is not None else len(card_ids)
                else:
                    deck_cards = deck.get("cards", [])
                    card_ids = [c.get("id") for c in deck_cards]
                    card_count = len(deck_cards)

                due_count = 0
                new_count = 0
                now = _utc_now()
                for card_id in card_ids:
                    state = states.get(card_id, {})
                    stability = state.get("stability", 0.0)
                    if not state or stability <= 0:
                        new_count += 1
                    else:
                        due_at = _parse_iso(state.get("due_at"))
                        if due_at and due_at <= now:
                            due_count += 1

                actives = self._get_active_sessions_for_deck(deck_id)
                active_sessions = {
                    slot: self._session_summary_light(sess)
                    for slot, sess in actives.items()
                }
                # Legacy single-session fields (library card UI): prefer a run.
                preferred = None
                for key in ("run_l1", "run_l2", "review"):
                    if key in actives:
                        preferred = actives[key]
                        break
                is_paused = preferred is not None
                paused_progress = None
                active_session_id = None
                active_session_level_mode = None
                if preferred is not None:
                    light = self._session_summary_light(preferred)
                    paused_progress = f"{light['mastered']}/{light['unique_total']}"
                    active_session_id = light["session_id"]
                    active_session_level_mode = preferred.get("level_mode")

                l1_progress = self._l1_progress_for_ids(card_ids, states)
                rec = records.get(str(deck_id)) or {}
                l2_unlocked = bool(rec.get("l1_run_completed"))

                summary = {
                    "id": deck_id,
                    "name": deck.get("name", "Untitled Deck"),
                    "description": deck.get("description", ""),
                    "tags": deck.get("tags", []),
                    "card_count": card_count,
                    "due_count": due_count,
                    "new_count": new_count,
                    "catalog_item_id": deck.get("catalog_item_id"),
                    "created_by_user_id": deck.get("created_by_user_id"),
                    "author_name": deck.get("author_name"),
                    "author_user_id": deck.get("author_user_id"),
                    "linked": is_linked,
                    "read_only": is_linked,
                    "created_at": deck.get("created_at"),
                    "updated_at": deck.get("updated_at"),
                    "is_paused": is_paused,
                    "paused_progress": paused_progress,
                    "active_session_id": active_session_id,
                    "active_session_level_mode": active_session_level_mode,
                    "active_sessions": active_sessions,
                    "l1_progress": l1_progress,
                    "l2_unlocked": l2_unlocked,
                }
                decks.append(summary)

        # Sort by updated_at descending
        decks.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
        return decks[:limit]

    def create_deck(self, name: str, description: str = "", tags: List[str] = None, catalog_item_id: Optional[str] = None,
                    author_name: Optional[str] = None, author_user_id: Optional[str] = None) -> Dict[str, Any]:
        deck_id = f"deck_{uuid.uuid4().hex[:12]}"
        now_iso = _utc_now_iso()
        deck = {
            "id": deck_id,
            "name": _s(name) or "New Deck",
            "description": _s(description),
            "tags": [t.strip().lower() for t in (tags or []) if t.strip()],
            "cards": [],
            "catalog_item_id": catalog_item_id,
            "created_by_user_id": self.user_id,
            # Original author (set when imported from the catalog); empty for own decks.
            "author_name": _s(author_name) or None,
            "author_user_id": _s(author_user_id) or None,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        _write_json(self._deck_path(deck_id), deck)
        return deck

    def create_linked_deck(self, catalog_item_id: str, snapshot: Dict[str, Any], *,
                           author_name: Optional[str] = None, author_user_id: Optional[str] = None,
                           granted_access_code: Optional[str] = None) -> Dict[str, Any]:
        """Create a read-only LINK to a catalog deck (no content copied).

        Cards are resolved live from the catalog on read; here we only cache light
        metadata (name/tags/card ids/count) so the library list is cheap.
        """
        snapshot = snapshot or {}
        cards = snapshot.get("cards") or []
        deck_id = f"deck_{uuid.uuid4().hex[:12]}"
        now_iso = _utc_now_iso()
        deck = {
            "id": deck_id,
            "linked": True,
            "catalog_item_id": _s(catalog_item_id) or None,
            "granted_access_code": _s(granted_access_code) or None,
            "name": _s(snapshot.get("name")) or "Imported Deck",
            "description": _s(snapshot.get("description")),
            "tags": [t.strip().lower() for t in (snapshot.get("tags") or []) if str(t).strip()],
            "cards": [],  # never stored for linked decks
            "card_count": len(cards),
            "linked_card_ids": [c.get("id") for c in cards if isinstance(c, dict) and c.get("id")],
            "created_by_user_id": self.user_id,
            "author_name": _s(author_name) or None,
            "author_user_id": _s(author_user_id) or None,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        _write_json(self._deck_path(deck_id), deck)
        return deck

    def update_deck(self, deck_id: str, name: Optional[str] = None, description: Optional[str] = None,
                    tags: Optional[List[str]] = None, catalog_item_id: Optional[str] = None,
                    catalog_visibility: Optional[str] = None, access_code: Optional[str] = None,
                    direction: Optional[str] = None) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")
        # `direction` is a per-deck STUDY preference, not content — it stays
        # editable even on linked (read-only) decks.
        content_change = any(v is not None for v in (name, description, tags, catalog_item_id,
                                                     catalog_visibility, access_code))
        if content_change:
            self._assert_editable(deck)

        if name is not None:
            deck["name"] = _s(name) or "Untitled Deck"
        if description is not None:
            deck["description"] = _s(description)
        if tags is not None:
            deck["tags"] = [t.strip().lower() for t in tags if t.strip()]
        # Catalog/publication fields are denormalized onto the deck so the UI can
        # show the publication status without a second catalog round-trip.
        if catalog_item_id is not None:
            deck["catalog_item_id"] = catalog_item_id
        if catalog_visibility is not None:
            deck["catalog_visibility"] = catalog_visibility
        if access_code is not None:
            deck["access_code"] = _s(access_code) or None  # empty string clears the code
        if direction is not None:
            deck["direction"] = direction if direction in self.DIRECTIONS else None

        deck["updated_at"] = _utc_now_iso()
        if deck.get("linked"):
            # Persist via the raw doc: get_deck inflates linked decks with
            # resolved cards / access fields that must never hit the disk.
            raw = _read_json(self._deck_path(deck_id), None)
            if isinstance(raw, dict):
                if direction is not None:
                    raw["direction"] = deck["direction"]
                raw["updated_at"] = deck["updated_at"]
                _write_json(self._deck_path(deck_id), raw)
            return deck
        _write_json(self._deck_path(deck_id), deck)
        return deck

    def delete_deck(self, deck_id: str) -> bool:
        # Ownership guard: get_deck returns None for decks the user doesn't own.
        if not self.get_deck(deck_id):
            return False
        path = self._deck_path(deck_id)
        if path.exists():
            path.unlink()
            return True
        return False

    def find_deck_by_catalog_item_id(self, catalog_item_id: str) -> Optional[Dict[str, Any]]:
        """Return the current user's deck imported from a given catalog item, if any.

        Owner-scoped (via _owns_deck) so the catalog shows an honest «already added»
        status and avoids creating duplicate copies on repeated import.
        """
        cid = _s(catalog_item_id)
        if not cid:
            return None
        for path in self._decks_root.glob("*.json"):
            deck = _read_json(path, None)
            if (isinstance(deck, dict)
                    and _s(deck.get("catalog_item_id")) == cid
                    and self._owns_deck(deck)):
                return deck
        return None

    # ── Cards CRUD ────────────────────────────────────────────────────

    def list_cards(self, deck_id: str) -> List[Dict[str, Any]]:
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")
        return deck.get("cards", [])

    def list_cards_with_state(self, deck_id: str) -> List[Dict[str, Any]]:
        """Cards augmented with real review state so the UI can show honest progress.

        Adds per card: is_new (never studied), level (1/2), due_at, and a coarse
        `progress` bucket: 'new' | 'learning' | 'mastered'.
        """
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")
        states = self._read_states()
        out: List[Dict[str, Any]] = []
        for card in deck.get("cards", []):
            st = states.get(card.get("id"), {})
            stability = st.get("stability", 0.0) or 0.0
            level = int(st.get("level", 1) or 1)
            is_new = (not st) or stability <= 0
            if is_new:
                bucket = "new"
            elif level >= 2:
                bucket = "mastered"
            else:
                bucket = "learning"
            enriched = dict(card)
            enriched["is_new"] = is_new
            enriched["level"] = level if not is_new else 0
            enriched["due_at"] = st.get("due_at")
            enriched["progress"] = bucket
            out.append(enriched)
        return out

    def create_card(self, deck_id: str, front_text: str, back_text: str, hint: Optional[str] = None, front_image_url: Optional[str] = None, back_image_url: Optional[str] = None, acceptable_answers: Optional[List[str]] = None, front_image_attribution: Optional[Dict[str, Any]] = None, back_image_attribution: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")
        self._assert_editable(deck)

        cards = deck.get("cards", [])
        if len(cards) >= 500:
            raise ValueError("deck_card_limit_reached")

        card_id = f"mc_{uuid.uuid4().hex[:12]}"
        now_iso = _utc_now_iso()
        card = {
            "id": card_id,
            "deck_id": deck_id,
            "front": {
                "text": _s(front_text),
                "image_url": front_image_url,
                "image_attribution": _clean_attribution(front_image_attribution),
            },
            "back": {
                "text": _s(back_text),
                "image_url": back_image_url,
                "image_attribution": _clean_attribution(back_image_attribution),
            },
            "hint": _s(hint) or None,
            "acceptable_answers": _clean_answer_list(acceptable_answers),
            "status": "active",
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        cards.append(card)
        deck["cards"] = cards
        deck["updated_at"] = now_iso
        _write_json(self._deck_path(deck_id), deck)
        return card

    def update_card(self, deck_id: str, card_id: str, front_text: Optional[str] = None, back_text: Optional[str] = None, hint: Optional[str] = None, front_image_url: Optional[str] = None, back_image_url: Optional[str] = None, status: Optional[str] = None, acceptable_answers: Optional[List[str]] = None, front_image_attribution: Any = _UNSET, back_image_attribution: Any = _UNSET) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")
        self._assert_editable(deck)

        cards = deck.get("cards", [])
        card = next((c for c in cards if c.get("id") == card_id), None)
        if not card:
            raise LookupError("card_not_found")

        if front_text is not None:
            card["front"]["text"] = _s(front_text)
        if front_image_url is not None:
            card["front"]["image_url"] = front_image_url
        if front_image_attribution is not _UNSET:
            card["front"]["image_attribution"] = _clean_attribution(front_image_attribution)
        if back_text is not None:
            card["back"]["text"] = _s(back_text)
        if back_image_url is not None:
            card["back"]["image_url"] = back_image_url
        if back_image_attribution is not _UNSET:
            card["back"]["image_attribution"] = _clean_attribution(back_image_attribution)
        if hint is not None:
            card["hint"] = _s(hint) or None
        if acceptable_answers is not None:
            card["acceptable_answers"] = _clean_answer_list(acceptable_answers)
        if status is not None:
            card["status"] = _s(status)

        card["updated_at"] = _utc_now_iso()
        deck["updated_at"] = _utc_now_iso()
        _write_json(self._deck_path(deck_id), deck)
        return card

    def delete_card(self, deck_id: str, card_id: str) -> bool:
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")
        self._assert_editable(deck)

        cards = deck.get("cards", [])
        idx = next((i for i, c in enumerate(cards) if c.get("id") == card_id), None)
        if idx is None:
            return False
            
        cards.pop(idx)
        deck["cards"] = cards
        deck["updated_at"] = _utc_now_iso()
        _write_json(self._deck_path(deck_id), deck)

        # Active (e.g. paused) sessions may still hold this card in their
        # queues — scrub every slot so resuming doesn't trip over a ghost id.
        valid_ids = {_s(c.get("id")) for c in cards}
        for active in self._get_active_sessions_for_deck(deck_id).values():
            if self._scrub_cards_from_session(active, valid_ids):
                self._save_session(active, set_active=True)
        return True

    def reorder_cards(self, deck_id: str, card_ids: List[str]) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")
        
        cards = deck.get("cards", [])
        card_map = {c.get("id"): c for c in cards}
        
        new_cards = []
        for cid in card_ids:
            if cid in card_map:
                new_cards.append(card_map[cid])
                
        # Append any remaining cards not specified in card_ids
        for c in cards:
            if c.get("id") not in card_ids:
                new_cards.append(c)
                
        deck["cards"] = new_cards
        deck["updated_at"] = _utc_now_iso()
        _write_json(self._deck_path(deck_id), deck)
        return deck

    # ── Learning Sessions ─────────────────────────────────────────────

    def _auto_new_limit(self, due_count: int, ceiling: int) -> int:
        """Adaptive new-card intake for 'auto' mode.

        Throttles new material while a review backlog exists and ramps back up to
        the user's configured `new_per_session` (the ceiling = max when fully caught
        up). Backlog-driven, like Anki's "don't bury yourself" behaviour.
        """
        ceiling = max(0, int(ceiling or 0)) or 10
        if due_count >= 50:
            stage = 0
        elif due_count >= 30:
            stage = ceiling // 4
        elif due_count >= 15:
            stage = ceiling // 2
        elif due_count >= 5:
            stage = (ceiling * 3) // 4
        else:
            stage = ceiling
        return max(0, min(stage, ceiling))

    def start_session(self, deck_id: str, resume: bool = True, restart: bool = False,
                      direction: Optional[str] = None, level_mode: Optional[int] = None,
                      mode: Optional[str] = None) -> Dict[str, Any]:
        """Start (or resume) a study session.

        mode="run"    — Прохождение: the WHOLE deck at one fixed level; the only
                        way to earn stars/records (via finish_session).
        mode="review" — Повторение: SRS-dosed due+new cards, per-card adaptive
                        form, points only.
        When mode is omitted, a given level_mode implies a run (legacy callers).
        """
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")

        if mode not in ("run", "review"):
            mode = "run" if level_mode in (1, 2) else "review"
        if mode == "run":
            level_mode = 2 if level_mode == 2 else 1
            if level_mode == 2 and not self.get_deck_record(deck_id).get("l2_unlocked"):
                raise ValueError("level2_locked")
            slot = f"run_l{level_mode}"
        else:
            level_mode = None
            slot = "review"

        active_session = self._get_active_session_for_deck(deck_id, slot)
        if active_session and restart:
            # Explicit reset: close the old session out without a record.
            active_session["completed"] = True
            active_session["completed_at"] = _utc_now_iso()
            active_session["discarded"] = True
            self._save_session(active_session, set_active=True)
            active_session = None
        if resume and not restart and active_session:
            # The deck may have been edited while the session was paused —
            # drop queue entries whose cards no longer exist.
            valid_ids = {_s(c.get("id")) for c in deck.get("cards", [])}
            changed = self._scrub_cards_from_session(active_session, valid_ids)
            if not active_session.get("completed"):
                if active_session.get("paused"):
                    active_session["paused"] = False
                    active_session["paused_at"] = None
                    changed = True
                if changed:
                    self._save_session(active_session, set_active=True)
                return active_session
            # Scrubbing emptied the remaining queue — close that session
            # out and fall through to start a fresh one.
            self._save_session(active_session, set_active=True)

        # Create new session
        cards = deck.get("cards", [])
        if not cards:
            raise ValueError("deck_is_empty")

        settings = self.get_settings()
        size = settings["session_size"]
        new_limit = settings["new_per_session"]
        if direction not in self.DIRECTIONS:
            # Per-deck study preference first, then the global default.
            deck_direction = deck.get("direction")
            direction = deck_direction if deck_direction in self.DIRECTIONS else settings["default_direction"]

        states = self._read_states()
        now = _utc_now()

        due_cards = []
        new_cards = []

        # Lazy backfill: content fingerprints let linked-deck republishes carry
        # review progress over (states written before the field existed).
        states_changed = False
        for card in cards:
            card_id = card.get("id")
            state = states.get(card_id, {})
            if state and not state.get("content_key"):
                state["content_key"] = _card_content_key(card)
                states_changed = True
            stability = state.get("stability", 0.0)

            if not state or stability <= 0:
                new_cards.append(card_id)
            else:
                due_at = _parse_iso(state.get("due_at"))
                if due_at and due_at <= now:
                    due_cards.append(card_id)
        if states_changed:
            self._write_states(states)

        composition = None
        card_forms: Dict[str, int] = {}
        if mode == "run":
            # Прохождение: the whole deck, shuffled, one fixed level.
            queue = [c.get("id") for c in cards]
            random.shuffle(queue)
        else:
            # In 'auto' mode the new-card limit adapts to the current review backlog.
            if settings.get("new_per_session_mode") == "auto":
                new_limit = self._auto_new_limit(len(due_cards), new_limit)

            # Mix cards: due cards first, then new cards (capped by the
            # new-per-session limit), up to the configured session size.
            random.shuffle(due_cards)
            random.shuffle(new_cards)

            queue = []
            queue.extend(due_cards[:size])
            due_in_queue = len(queue)
            if len(queue) < size:
                remaining = size - len(queue)
                queue.extend(new_cards[:min(new_limit, remaining)])
            new_in_queue = len(queue) - due_in_queue

            if not queue:
                # If nothing is due or new, let user study everything
                all_ids = [c.get("id") for c in cards]
                random.shuffle(all_ids)
                queue = all_ids[:size]
                due_in_queue, new_in_queue = len(queue), 0
            composition = {"due": due_in_queue, "new": new_in_queue}

            # Adaptive per-card form: cards that earned mastery level 2 are
            # checked with typed input (worth more points) — but only once the
            # deck's L2 is unlocked, so the input form is never a surprise.
            l2_unlocked = self.get_deck_record(deck_id).get("l2_unlocked", False)
            for cid in queue:
                st = states.get(cid) or {}
                strong = int(st.get("level") or 1) >= 2
                card_forms[_s(cid)] = 2 if (l2_unlocked and strong) else 1

        # Resolve a concrete direction per card (mixed → random per card).
        # Mixed is a self-grade/browse mechanic: typed checks (L2 runs, strong
        # review cards) would turn it into a "guess what to type" lottery, so
        # they are pinned to the straight direction. Explicit reverse stays
        # honored everywhere — typing the term from its definition is a valid,
        # intentionally harder drill.
        if mode == "run" and level_mode == 2 and direction == "mixed":
            direction = "front_back"
        card_directions = {}
        for cid in queue:
            if direction == "mixed":
                if card_forms.get(_s(cid)) == 2:
                    card_directions[cid] = "front_back"
                else:
                    card_directions[cid] = random.choice(("front_back", "back_front"))
            else:
                card_directions[cid] = direction

        session_id = f"session_{uuid.uuid4().hex[:12]}"
        session = {
            "id": session_id,
            "deck_id": deck_id,
            "user_id": self.user_id,
            "mode": mode,
            "card_queue": queue,
            "direction": direction,
            "card_directions": card_directions,
            "card_forms": card_forms,
            "composition": composition,
            "cursor": 0,
            "completed": False,
            "created_at": _utc_now_iso(),
            "completed_at": None,
            "level_mode": level_mode,
            "paused": False,
            "paused_at": None,
            "combo": 0,
            "max_combo": 0,
            "session_xp": 0,
            # Mastery cycle: outcome of the FIRST attempt per card (card_id -> bool)
            # and the cards already closed with a correct answer. A wrong answer
            # re-queues the card until it is answered correctly, so the session
            # only completes once every card is mastered.
            "first_results": {},
            "mastered_ids": [],
            "stats": {
                "total": len(queue),
                "unique_total": len(queue),
                "correct": 0,
                "first_try_correct": 0,
                "errors": 0,
                "error_card_ids": [],
                "mastered": 0,
                "pending_retry": 0,
                "attempts": 0
            }
        }

        self._save_session(session, set_active=True)
        return session

    def submit_answer(self, session_id: str, card_id: str, user_answer: str, override: bool = False) -> Dict[str, Any]:
        """Submit answer to a card in session. Checks correctness and schedules via FSRS.

        Note: microcards intentionally use a *binary* self-grade — only Rating.GOOD
        (correct) and Rating.AGAIN (wrong) are produced here. The Hard/Easy ratings
        that FSRS supports are legacy for this feature and are never emitted; the
        generic Hard/Easy branches in logic/fsrs.py stay only because they belong to
        the standard FSRS interval math.
        """
        session = self._get_session(session_id)
        if not session or session.get("completed"):
            raise LookupError("session_not_found_or_completed")

        deck_id = session.get("deck_id")
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")

        cards = deck.get("cards", [])
        card = next((c for c in cards if c.get("id") == card_id), None)
        if not card:
            # The card was deleted while the session was running (another tab,
            # a linked-deck refresh). If it is part of this session's queue,
            # heal the session instead of failing the whole run.
            queue_ids = {_s(cid) for cid in session.get("card_queue", [])}
            if _s(card_id) in queue_ids:
                valid_ids = {_s(c.get("id")) for c in cards}
                if self._scrub_cards_from_session(session, valid_ids):
                    self._save_session(session, set_active=True)
                return {
                    "card_missing": True,
                    "is_correct": False,
                    "card_state": None,
                    "session": session,
                    "expected_answer": "",
                    "direction": session.get("direction") or "front_back",
                    "first_attempt": False,
                    "is_retry": False,
                }
            raise LookupError("card_not_found")

        states = self._read_states()
        card_state = states.get(card_id, {
            "card_id": card_id,
            "user_id": self.user_id,
            "level": 1,
            "consecutive_correct": 0,
            "stability": 0.0,
            "difficulty": 0.0,
            "state": 0,
            "due_at": None,
            "last_reviewed_at": None
        })
        # Content fingerprint keeps progress portable across linked-deck
        # republishes (card ids may change, content survives).
        card_state["content_key"] = _card_content_key(card)

        # Mastery-cycle bookkeeping (sessions created before this schema get the
        # fields lazily, so paused old sessions keep working).
        first_results: Dict[str, Any] = session.setdefault("first_results", {})
        mastered_ids: List[str] = session.setdefault("mastered_ids", [])
        stats = session.setdefault("stats", {})
        queue = session.setdefault("card_queue", [])
        error_card_ids = stats.setdefault("error_card_ids", [])
        stats.setdefault("unique_total", len({_s(cid) for cid in queue}))

        card_key = _s(card_id)
        first_attempt = card_key not in first_results

        # How the answer is graded (self-grade vs typed answer):
        # runs fix one level for the whole session; reviews carry a per-card
        # form picked at session start (adaptive difficulty). The per-card
        # state `level` itself is only a mastery metric for deck statistics.
        session_level_mode = session.get("level_mode")
        if session_level_mode is not None:
            grade_level = session_level_mode
        else:
            grade_level = int((session.get("card_forms") or {}).get(card_key) or 1)
        is_correct = False
        rating = Rating.AGAIN

        # An override is only valid as a correction of the immediately preceding
        # wrong verdict on the same card (the "count as correct" button). Repeated
        # or out-of-place overrides are a no-op so they can't double-count stats.
        last_answer = session.get("last_answer") or {}
        override_applies = bool(
            override
            and last_answer.get("card_id") == card_key
            and not last_answer.get("correct", True)
        )
        if override and not override_applies:
            return {
                "is_correct": True,
                "card_state": card_state,
                "session": session,
                "expected_answer": "",
                "direction": (session.get("card_directions") or {}).get(card_id) or session.get("direction") or "front_back",
                "first_attempt": False,
                "is_retry": False,
            }

        is_retry = (not first_attempt) and not override

        # Direction of this card in the session decides which side is the answer.
        card_dir = (session.get("card_directions") or {}).get(card_id) or session.get("direction") or "front_back"
        if card_dir == "back_front":
            # Prompt = back side, the user must produce the FRONT text.
            expected_text = card["front"]["text"]
            acceptable = []  # acceptable_answers describe the back side only
        else:
            expected_text = card["back"]["text"]
            acceptable = card.get("acceptable_answers") or []

        # 1. Check correctness based on the session grading mode
        if grade_level == 1:
            # Level 1: user_answer is expected to be "know" or "dont_know"
            ans_clean = _s(user_answer).lower()
            is_correct = ans_clean == "know" or override
        else:
            # Level 2: open answer compared via fuzzy matching (back side + alternatives).
            # Typo-tolerant by a fixed threshold; borderline misses are handled by override.
            is_correct = override or self.verify_answer_against_card(
                user_answer, expected_text, acceptable, self.FUZZY_THRESHOLD)
        rating = Rating.GOOD if is_correct else Rating.AGAIN

        # 2. Card mastery metric (feeds deck progress buckets). Re-presentations
        # inside the mastery cycle don't move it — only the first attempt and an
        # explicit override do.
        if first_attempt or override:
            consecutive_correct = card_state.get("consecutive_correct", 0)
            mastery_level = card_state.get("level", 1)
            if is_correct:
                consecutive_correct += 1
                if grade_level == 2:
                    mastery_level = 2
                elif consecutive_correct >= 3:
                    mastery_level = 2
                    consecutive_correct = 0
            else:
                consecutive_correct = 0
                mastery_level = 1
            card_state["level"] = mastery_level
            card_state["consecutive_correct"] = consecutive_correct

        # A correct close (first try, retry inside the mastery cycle, or override)
        # marks the card as passed for the deck-wide L1 completion gate.
        if is_correct:
            card_state["l1_mastered"] = True

        # 3. FSRS scheduling: exactly one review per card per session. The first
        # attempt drives the schedule; re-presentations of a re-queued card are
        # intra-session learning steps and must not inflate the review history.
        # An override re-grades the same presentation as GOOD.
        now = _utc_now()
        if first_attempt or override:
            last_reviewed = _parse_iso(card_state.get("last_reviewed_at"))
            if last_reviewed:
                elapsed_days = max(0.0, (now - last_reviewed).total_seconds() / 86400.0)
            else:
                elapsed_days = 0.0

            fsrs_state = {
                "stability": card_state.get("stability", 0.0),
                "difficulty": card_state.get("difficulty", 0.0),
                "state": card_state.get("state", 0),
            }
            next_fsrs = self.fsrs.step(fsrs_state, rating, elapsed_days)
            card_state.update(next_fsrs)
            card_state["last_reviewed_at"] = now.isoformat().replace("+00:00", "Z")
            card_state["due_at"] = (now + timedelta(days=next_fsrs["interval_days"])).isoformat().replace("+00:00", "Z")

            # Log event (review history feeds analytics — one entry per scheduled review)
            event = {
                "id": f"mcrev_{uuid.uuid4().hex[:12]}",
                "user_id": self.user_id,
                "deck_id": deck_id,
                "card_id": card_id,
                "session_id": session_id,
                "level": grade_level,
                "rating": int(rating),
                "user_answer": user_answer,
                "is_correct": is_correct,
                "is_override": bool(override),
                "reviewed_at": _utc_now_iso()
            }
            self._append_event(event)

        # Save card state (l1_mastered may change even on a retry)
        states[card_id] = card_state
        self._write_states(states)

        # 4. Update session stats + mastery queue
        if first_attempt:
            first_results[card_key] = bool(is_correct)

        cursor = session.get("cursor", 0)
        if override:
            # Correction of the preceding wrong verdict: undo its error accounting
            # and pull the re-queued copy back out of the tail.
            stats["correct"] = stats.get("correct", 0) + 1
            stats["errors"] = max(0, stats.get("errors", 0) - 1)
            if card_key in error_card_ids:
                error_card_ids.remove(card_key)
            if last_answer.get("first_attempt"):
                first_results[card_key] = True
            for i in range(len(queue) - 1, max(cursor, 0) - 1, -1):
                if _s(queue[i]) == card_key:
                    queue.pop(i)
                    break
            if card_key not in mastered_ids:
                mastered_ids.append(card_key)
            session["last_answer"] = {"card_id": card_key, "first_attempt": False, "correct": True}
        else:
            stats["attempts"] = stats.get("attempts", 0) + 1
            if is_correct:
                stats["correct"] = stats.get("correct", 0) + 1
                if card_key not in mastered_ids:
                    mastered_ids.append(card_key)
            else:
                stats["errors"] = stats.get("errors", 0) + 1
                if card_key not in error_card_ids:
                    error_card_ids.append(card_key)
            session["last_answer"] = {"card_id": card_key, "first_attempt": first_attempt, "correct": bool(is_correct)}

            # Advance past the answered card, then (on a wrong answer) re-queue it
            # a few positions ahead — the mastery cycle.
            if cursor < len(queue) and _s(queue[cursor]) == card_key:
                cursor += 1
                session["cursor"] = cursor
            if not is_correct:
                insert_pos = min(len(queue), cursor + random.randint(2, 4))
                queue.insert(insert_pos, card_id)

        # 5. Derived progress counters for the HUD
        unique_total = stats.get("unique_total") or len({_s(cid) for cid in queue})
        stats["unique_total"] = unique_total
        stats["total"] = unique_total
        stats["mastered"] = len(mastered_ids)
        stats["first_try_correct"] = sum(1 for ok in first_results.values() if ok)
        stats["pending_retry"] = sum(1 for cid in first_results if cid not in mastered_ids)
        session["stats"] = stats

        if session.get("cursor", 0) >= len(queue):
            session["completed"] = True
            session["completed_at"] = _utc_now_iso()

        self._save_session(session, set_active=True)

        return {
            "is_correct": is_correct,
            "card_state": card_state,
            "session": session,
            "expected_answer": expected_text,
            "direction": card_dir,
            "form": grade_level,
            "first_attempt": first_attempt,
            "is_retry": is_retry,
        }

    @staticmethod
    def _normalize_answer(txt: str) -> str:
        t = _s(txt).lower().strip()
        punctuation = '.,!?;:"()[]{}-\\/_#@*&^%$'
        for char in punctuation:
            t = t.replace(char, "")
        return " ".join(t.split())

    def verify_fuzzy_match(self, user_answer: str, target_answer: str, threshold: float = 0.82) -> bool:
        """Fuzzy answer check: exact match, then the better of character-level and
        word-order-independent (token-set) similarity, compared against `threshold`."""
        norm_user = self._normalize_answer(user_answer)
        norm_target = self._normalize_answer(target_answer)

        if not norm_target:
            return False
        if norm_user == norm_target:
            return True

        # Character-level ratio (typo tolerance).
        char_ratio = difflib.SequenceMatcher(None, norm_user, norm_target).ratio()

        # Token-set ratio (word-order / extra-word tolerance).
        user_tokens = set(norm_user.split())
        target_tokens = set(norm_target.split())
        if user_tokens and target_tokens:
            inter = len(user_tokens & target_tokens)
            union = len(user_tokens | target_tokens)
            token_ratio = inter / union if union else 0.0
        else:
            token_ratio = 0.0

        return max(char_ratio, token_ratio) >= threshold

    def verify_answer_against_card(self, user_answer: str, target_text: str,
                                   acceptable_answers: Optional[List[str]] = None,
                                   threshold: float = 0.82) -> bool:
        """True if the answer fuzzy-matches the primary target or any acceptable alternative."""
        candidates = [target_text] + list(acceptable_answers or [])
        return any(self.verify_fuzzy_match(user_answer, c, threshold) for c in candidates if _s(c))

    def get_session_summary(self, session_id: str) -> Dict[str, Any]:
        session = self._get_session(session_id)
        if not session:
            raise LookupError("session_not_found")
        return session

    # Mutable fields snapshotted into a run checkpoint on pause. "Exit without
    # saving" rolls the run back to exactly this point.
    _CHECKPOINT_FIELDS = ("card_queue", "cursor", "first_results", "mastered_ids",
                          "stats", "last_answer", "combo", "max_combo", "session_xp")

    def pause_session(self, session_id: str, combo: int = 0, max_combo: int = 0,
                      session_xp: int = 0) -> Dict[str, Any]:
        session = self._get_session(session_id)
        if not session:
            raise LookupError("session_not_found")
        session["paused"] = True
        session["paused_at"] = _utc_now_iso()
        session["combo"] = combo
        session["max_combo"] = max_combo
        session["session_xp"] = session_xp
        if session.get("mode") == "run":
            # A pause is a checkpoint: the sitting just played is committed,
            # a later "exit without saving" only loses the NEXT sitting.
            session["checkpoint"] = copy.deepcopy(
                {k: session.get(k) for k in self._CHECKPOINT_FIELDS}
            )
        self._save_session(session, set_active=True)
        return session

    def resume_session(self, session_id: str) -> Dict[str, Any]:
        session = self._get_session(session_id)
        if not session:
            raise LookupError("session_not_found")
        session["paused"] = False
        session["paused_at"] = None
        self._save_session(session, set_active=True)
        return session

    def abandon_session(self, session_id: str) -> Dict[str, Any]:
        """Exit WITHOUT saving the current sitting.

        Runs roll back to the last checkpoint (pause) and stay paused there;
        a run that was never paused — and any review — is simply discarded."""
        session = self._get_session(session_id)
        if not session:
            raise LookupError("session_not_found")
        checkpoint = session.get("checkpoint")
        if session.get("mode") == "run" and isinstance(checkpoint, dict):
            for key in self._CHECKPOINT_FIELDS:
                session[key] = copy.deepcopy(checkpoint.get(key))
            session["paused"] = True
            session["paused_at"] = _utc_now_iso()
            session["completed"] = False
            session["completed_at"] = None
            self._save_session(session, set_active=True)
            return {"restored": True, "session": session}
        session["completed"] = True
        session["completed_at"] = _utc_now_iso()
        session["discarded"] = True
        self._save_session(session, set_active=True)
        return {"restored": False, "session": session}

    def discard_session(self, session_id: str) -> Dict[str, Any]:
        session = self._get_session(session_id)
        if not session:
            raise LookupError("session_not_found")
        session["completed"] = True
        session["completed_at"] = _utc_now_iso()
        session["discarded"] = True
        self._save_session(session, set_active=True)
        return session

    def finish_session(self, session_id: str, *, session_xp: int = 0, max_combo: int = 0) -> Dict[str, Any]:
        """Close out a COMPLETED run: compute stars server-side and persist the
        deck record (the only path that earns stars / opens the L2 gate).

        Idempotent — a second call returns the stored result. Reviews have no
        record to save; calling finish on one just returns its summary stats."""
        session = self._get_session(session_id)
        if not session:
            raise LookupError("session_not_found")
        if not session.get("completed") or session.get("discarded"):
            raise ValueError("session_not_completed")
        if session.get("finish_result"):
            return session["finish_result"]

        stats = session.get("stats") or {}
        unique_total = int(stats.get("unique_total") or 0)
        first_try = int(stats.get("first_try_correct") or 0)
        accuracy = round((first_try / unique_total) * 100) if unique_total else 0
        result: Dict[str, Any] = {
            "mode": session.get("mode") or "review",
            "accuracy": accuracy,
            "first_try_correct": first_try,
            "unique_total": unique_total,
        }
        if session.get("mode") == "run":
            level = 2 if session.get("level_mode") == 2 else 1
            stars = self._stars_for_accuracy(accuracy)
            score = max(0, int(session_xp))
            session["session_xp"] = score
            session["max_combo"] = max(int(session.get("max_combo") or 0), int(max_combo or 0))
            saved = self._apply_run_record(
                session.get("deck_id"), level=level, score=score, stars=stars,
                deck_size=unique_total,
            )
            result.update({
                "level": level,
                "stars": stars,
                "score": score,
                "record": saved["record"],
                "is_new_record": saved["is_new_record"],
                "l2_unlocked": bool(saved["record"].get("l1_run_completed")),
            })
        session["finish_result"] = result
        self._save_session(session, set_active=True)
        return result


    def get_analytics(self, *, retention_days: int = 30, heatmap_days: int = 84, forecast_days: int = 7) -> Dict[str, Any]:
        """Aggregate review history (events) and scheduler state into inline dashboard data.

        Only cards that still exist count — orphaned states/events from decks or cards
        the user has since deleted are ignored (otherwise "overdue" etc. would be inflated).
        """
        from collections import Counter

        events = _read_json(self._events_path, [])
        if not isinstance(events, list):
            events = []
        states = self._read_states()
        now = _utc_now()
        today = now.date()
        retention_cutoff = now - timedelta(days=retention_days)

        # Set of card ids that currently exist across the user's decks.
        live_ids = set()
        for summary in self.list_decks():
            deck = self.get_deck(summary["id"])
            for c in (deck.get("cards", []) if deck else []):
                live_ids.add(c.get("id"))

        per_day: Counter = Counter()
        event_dates = set()
        total_recent = 0
        correct_recent = 0
        for e in events:
            if e.get("card_id") not in live_ids:
                continue
            dt = _parse_iso(e.get("reviewed_at"))
            if not dt:
                continue
            d = dt.date()
            event_dates.add(d)
            per_day[d.isoformat()] += 1
            if dt >= retention_cutoff:
                total_recent += 1
                if e.get("is_correct"):
                    correct_recent += 1

        retention = round(100.0 * correct_recent / total_recent, 1) if total_recent else 0.0

        # Streak: consecutive days with reviews, counting today (or starting yesterday).
        streak = 0
        cursor = today
        if today not in event_dates and (today - timedelta(days=1)) in event_dates:
            cursor = today - timedelta(days=1)
        while cursor in event_dates:
            streak += 1
            cursor = cursor - timedelta(days=1)

        heatmap = []
        for i in range(heatmap_days - 1, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            heatmap.append({"date": d, "count": per_day.get(d, 0)})

        # Due forecast for the next `forecast_days` days + overdue backlog (live cards only).
        due_counts: Counter = Counter()
        overdue = 0
        for card_id, st in states.items():
            if card_id not in live_ids:
                continue
            due = _parse_iso(st.get("due_at"))
            if not due:
                continue
            dd = due.date()
            if dd <= today:
                overdue += 1
            else:
                due_counts[dd.isoformat()] += 1
        forecast = []
        for i in range(1, forecast_days + 1):
            d = (today + timedelta(days=i)).isoformat()
            forecast.append({"date": d, "count": due_counts.get(d, 0)})

        # Per-deck mastery: cards advanced to level 2 with a positive stability.
        deck_mastery = []
        for summary in self.list_decks():
            deck = self.get_deck(summary["id"])
            cards = deck.get("cards", []) if deck else []
            mastered = 0
            for c in cards:
                st = states.get(c.get("id"), {})
                if st.get("level", 1) >= 2 and st.get("stability", 0) > 0:
                    mastered += 1
            deck_mastery.append({
                "deck_id": summary["id"],
                "name": summary.get("name", ""),
                "total": len(cards),
                "mastered": mastered,
            })

        return {
            "streak": streak,
            "retention": retention,
            "retention_window_days": retention_days,
            "total_reviews": sum(per_day.values()),
            "reviews_today": per_day.get(today.isoformat(), 0),
            "overdue": overdue,
            "heatmap": heatmap,
            "forecast": forecast,
            "deck_mastery": deck_mastery,
        }

    # \u2500\u2500 Import: parsing / preview / create \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    # Each _parse_<fmt> turns raw text into a uniform list of preview items:
    #   {front, back, hint, acceptable_answers, status: "ok"|"error", error}
    # The same parsers feed both the live preview (analyze_import) and the
    # actual import (_create_from_parsed), so there is a single source of truth.

    PARSE_FORMATS = ("csv", "json", "txt_full", "txt_simplified", "test")

    @staticmethod
    def _ok_item(front: str, back: str, hint: Optional[str] = None,
                 acceptable_answers: Optional[List[str]] = None) -> Dict[str, Any]:
        return {
            "front": _s(front),
            "back": _s(back),
            "hint": _s(hint) or None,
            "acceptable_answers": _clean_answer_list(acceptable_answers),
            "status": "ok",
            "error": None,
        }

    @staticmethod
    def _err_item(raw: str, error: str) -> Dict[str, Any]:
        return {
            "front": _s(raw),
            "back": "",
            "hint": None,
            "acceptable_answers": [],
            "status": "error",
            "error": error,
        }

    def _detect_format(self, content: Any) -> str:
        """Guess the import format from raw content (used by the 'auto' mode).

        Cheap, unambiguous signals first, with the forgiving txt_simplified parser
        (which auto-detects its own separator, incl. the Quizlet tab-tree) as the
        catch-all.
        """
        text = _s(content).strip()
        if not text:
            return "txt_simplified"
        if text[0] in "{[":
            try:
                if isinstance(json.loads(text), (dict, list)):
                    return "json"
            except Exception:
                pass
        lines = [ln for ln in text.splitlines() if ln.strip()]
        head = "\n".join(lines[:40])
        if "@MICROCARD" in text or "@PAIR_MATCH" in text:
            return "txt_full"
        # Test bank: '?' or '#' (MyTestX) question lines + '+'/'-' answer lines.
        if re.search(r"(?m)^\s*[?#]", head) and re.search(r"(?m)^\s*[+\-−]", head):
            return "test"
        if any("\t" in ln for ln in lines):
            return "txt_simplified"
        first = (lines[0].lower() if lines else "")
        if ("," in first or ";" in first) and any(h in first for h in ("front", "term", "back", "definition")):
            return "csv"
        return "txt_simplified"

    @staticmethod
    def _hierarchy_stats(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Summarize merged multi-line (hierarchical) definitions for the preview badge."""
        multiline_cards = 0
        merged_lines = 0
        for r in rows:
            if r.get("status") != "ok":
                continue
            extra = _s(r.get("back")).count("\n")
            if extra:
                multiline_cards += 1
                merged_lines += extra
        return {"multiline_cards": multiline_cards, "merged_lines": merged_lines}

    def _parse_by_format(self, fmt: str, content: Any, options: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        fmt = _s(fmt)
        if fmt == "auto":
            fmt = self._detect_format(content)
        if fmt == "csv":
            return self._parse_csv(content, options)
        if fmt == "json":
            return self._parse_json(content, options)
        if fmt == "txt_full":
            return self._parse_txt_full(content, options)
        if fmt == "txt_simplified":
            return self._parse_txt_simplified(content, options)
        if fmt == "test":
            return self._parse_test(content, options)
        raise ValueError("unknown_import_format")

    def _create_from_parsed(self, deck_id: str, parsed: List[Dict[str, Any]], *, dedup: bool = True) -> Dict[str, Any]:
        """Create cards from parsed items, skipping error rows and (optionally) duplicates."""
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")

        seen = {_normalize_key(c.get("front", {}).get("text", "")) for c in deck.get("cards", [])} if dedup else set()
        imported: List[Dict[str, Any]] = []
        skipped = 0
        for item in parsed:
            if item.get("status") == "error":
                continue
            front = _s(item.get("front"))
            back = _s(item.get("back"))
            if not front or not back:
                continue
            key = _normalize_key(front)
            if dedup and key in seen:
                skipped += 1
                continue
            seen.add(key)
            card = self.create_card(
                deck_id=deck_id,
                front_text=front,
                back_text=back,
                hint=item.get("hint"),
                acceptable_answers=item.get("acceptable_answers"),
            )
            imported.append(card)
        return {"items": imported, "skipped_duplicates": skipped}

    def analyze_import(self, deck_id: str, fmt: str, content: Any, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Dry-run: parse content and report preview rows + counts WITHOUT writing."""
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")

        detected_format = self._detect_format(content) if _s(fmt) == "auto" else _s(fmt)
        parsed = self._parse_by_format(fmt, content, options)
        existing = {_normalize_key(c.get("front", {}).get("text", "")) for c in deck.get("cards", [])}
        seen: set = set()
        rows: List[Dict[str, Any]] = []
        counts = {"total": 0, "ok": 0, "errors": 0, "duplicates": 0}
        for item in parsed:
            counts["total"] += 1
            row = dict(item)
            row["duplicate"] = False
            if item.get("status") == "error":
                counts["errors"] += 1
            else:
                key = _normalize_key(item.get("front"))
                if key in existing or key in seen:
                    row["duplicate"] = True
                    counts["duplicates"] += 1
                else:
                    seen.add(key)
                    counts["ok"] += 1
            rows.append(row)
        return {"rows": rows, "counts": counts, "detected_format": detected_format, "hierarchy": self._hierarchy_stats(rows)}

    def _parse_csv(self, csv_content: Any, options: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        import csv
        import io
        csv_content = _s(csv_content)
        # Read lines, handling UTF-8 and BOM
        if csv_content.startswith('\ufeff'):
            csv_content = csv_content[1:]
        
        f = io.StringIO(csv_content)
        # We try to detect if we have a header or if separator is ; or ,
        first_line = next(f, "")
        f.seek(0)

        opts = options or {}
        preset = _s(opts.get("delimiter")).lower()
        delimiter_map = {",": ",", ";": ";", "tab": "\t", "\t": "\t", "comma": ",", "semicolon": ";"}
        if preset in delimiter_map:
            delimiter = delimiter_map[preset]
        else:
            delimiter = ','
            if ';' in first_line and ',' not in first_line:
                delimiter = ';'

        reader = csv.reader(f, delimiter=delimiter)
        rows = list(reader)
        if not rows:
            return []
            
        header = [r.lower().strip() for r in rows[0]]
        has_header = "front" in header or "term" in header or "back" in header or "definition" in header
        
        start_row = 1 if has_header else 0
        front_idx, back_idx, hint_idx = 0, 1, 2
        
        if has_header:
            if "front" in header:
                front_idx = header.index("front")
            elif "term" in header:
                front_idx = header.index("term")
            else:
                front_idx = 0
                
            if "back" in header:
                back_idx = header.index("back")
            elif "definition" in header:
                back_idx = header.index("definition")
            else:
                back_idx = 1
                
            if "hint" in header:
                hint_idx = header.index("hint")
            else:
                hint_idx = -1
                
        parsed: List[Dict[str, Any]] = []
        for row in rows[start_row:]:
            if not row or not any(_s(c) for c in row):
                continue
            if len(row) <= max(front_idx, back_idx):
                parsed.append(self._err_item(delimiter.join(row), "too_few_columns"))
                continue
            front_text = row[front_idx].strip()
            back_text = row[back_idx].strip()
            if not front_text or not back_text:
                parsed.append(self._err_item(delimiter.join(row), "empty_front_or_back"))
                continue
            hint = row[hint_idx].strip() if (hint_idx >= 0 and hint_idx < len(row)) else None
            parsed.append(self._ok_item(front_text, back_text, hint))
        return parsed

    def import_csv(self, deck_id: str, csv_content: str, options: Optional[Dict[str, Any]] = None, dedup: bool = True) -> Dict[str, Any]:
        parsed = self._parse_csv(csv_content, options)
        return self._create_from_parsed(deck_id, parsed, dedup=dedup)

    def _parse_json(self, data: Any, options: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                raise ValueError("invalid_json_format")

        cards_data: Any = []
        if isinstance(data, dict):
            cards_data = data.get("cards", [])
        elif isinstance(data, list):
            cards_data = data

        if not isinstance(cards_data, list):
            raise ValueError("invalid_json_format")

        parsed: List[Dict[str, Any]] = []
        for item in cards_data:
            if not isinstance(item, dict):
                continue
            front = item.get("front", "")
            front_text = front.get("text", "") if isinstance(front, dict) else str(front)
            back = item.get("back", "")
            back_text = back.get("text", "") if isinstance(back, dict) else str(back)
            hint = item.get("hint")
            acceptable = item.get("acceptable_answers")
            if not _s(front_text) or not _s(back_text):
                continue
            parsed.append(self._ok_item(front_text, back_text, hint, acceptable))
        return parsed

    def import_json(self, deck_id: str, data: Any, options: Optional[Dict[str, Any]] = None, dedup: bool = True) -> Dict[str, Any]:
        # JSON keeps its richer create path (image URLs) rather than the generic loop.
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")

        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                raise ValueError("invalid_json_format")

        cards_data: Any = []
        if isinstance(data, dict):
            cards_data = data.get("cards", [])
        elif isinstance(data, list):
            cards_data = data
        if not isinstance(cards_data, list):
            raise ValueError("invalid_json_format")

        existing = {_normalize_key(c.get("front", {}).get("text", "")) for c in deck.get("cards", [])} if dedup else set()
        imported: List[Dict[str, Any]] = []
        skipped = 0
        for item in cards_data:
            if not isinstance(item, dict):
                continue
            front = item.get("front", "")
            if isinstance(front, dict):
                front_text = front.get("text", "")
                front_img = front.get("image_url")
            else:
                front_text = str(front)
                front_img = item.get("front_image_url") or item.get("image_url")

            back = item.get("back", "")
            if isinstance(back, dict):
                back_text = back.get("text", "")
                back_img = back.get("image_url")
            else:
                back_text = str(back)
                back_img = item.get("back_image_url")

            if not _s(front_text) or not _s(back_text):
                continue
            key = _normalize_key(front_text)
            if dedup and key in existing:
                skipped += 1
                continue
            existing.add(key)
            card = self.create_card(
                deck_id=deck_id,
                front_text=front_text,
                back_text=back_text,
                hint=item.get("hint"),
                front_image_url=front_img,
                back_image_url=back_img,
                acceptable_answers=item.get("acceptable_answers"),
            )
            imported.append(card)
        return {"items": imported, "skipped_duplicates": skipped}

    def export_json(self, deck_id: str) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")
            
        return {
            "schema": "actra_flashcards_v1",
            "deck": {
                "name": deck.get("name", ""),
                "description": deck.get("description", ""),
                "tags": deck.get("tags", [])
            },
            "cards": [
                {
                    "front": c.get("front", {}),
                    "back": c.get("back", {}),
                    "hint": c.get("hint"),
                    "acceptable_answers": c.get("acceptable_answers", [])
                } for c in deck.get("cards", [])
            ]
        }

    def export_csv(self, deck_id: str) -> str:
        import csv
        import io
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")
            
        output = io.StringIO()
        writer = csv.writer(output, lineterminator='\n')
        writer.writerow(["front", "back", "hint"])
        for c in deck.get("cards", []):
            front_text = c.get("front", {}).get("text", "")
            back_text = c.get("back", {}).get("text", "")
            hint = c.get("hint", "") or ""
            writer.writerow([front_text, back_text, hint])
        return output.getvalue()

    def export_txt(self, deck_id: str) -> str:
        """Plain-text export, one 'front<TAB>back' per line.

        Round-trips with the simplified TXT import (tab separator). Tabs/newlines inside
        a card's text are flattened to spaces so each card stays on a single line.
        """
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")

        def flatten(text: str) -> str:
            return " ".join(str(text or "").split())

        lines = []
        for c in deck.get("cards", []):
            front_text = flatten(c.get("front", {}).get("text", ""))
            back_text = flatten(c.get("back", {}).get("text", ""))
            if not front_text or not back_text:
                continue
            lines.append(f"{front_text}\t{back_text}")
        return "\n".join(lines) + ("\n" if lines else "")

    def _parse_txt_full(self, content: Any, options: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        from task_system.models.parsers.microcard_parser import MicrocardParser
        parser = MicrocardParser()
        result = parser.parse_text(_s(content))

        parsed: List[Dict[str, Any]] = []
        for item in result.get("items", []):
            if item.get("status") == "error":
                parsed.append(self._err_item(item.get("raw") or "", item.get("error") or "parse_error"))
                continue
            preview = item.get("card_preview") or {}
            card_type = preview.get("card_type")
            meta = item.get("metadata") or {}

            if card_type == "fact_recall":
                front_text = preview.get("front", "").strip()
                back_text = preview.get("back", "").strip()
                if not front_text or not back_text:
                    continue
                parsed.append(self._ok_item(front_text, back_text, meta.get("hint")))
            elif card_type == "pair_match":
                for pair in preview.get("pairs", []):
                    left = pair.get("left", "").strip()
                    right = pair.get("right", "").strip()
                    if not left or not right:
                        continue
                    parsed.append(self._ok_item(left, right))
        return parsed

    def import_txt_full(self, deck_id: str, content: str, options: Optional[Dict[str, Any]] = None, dedup: bool = True) -> Dict[str, Any]:
        parsed = self._parse_txt_full(content, options)
        return self._create_from_parsed(deck_id, parsed, dedup=dedup)

    # Friendly preset name -> literal separator for the simplified TXT parser.
    QA_SEPARATOR_PRESETS = {
        "tab": "\t",
        "arrow": " => ",
        "arrow2": " -> ",
        "dash": " - ",
        "hyphen": "-",
        "semicolon": ";",
        "colon": ":",
        "comma": ",",
    }

    def _split_simplified(self, stripped: str, qa_sep: str) -> Optional[List[str]]:
        """Split one 'front<sep>back' line. qa_sep 'auto'/'' uses a cascade of common separators."""
        # NOTE: do not strip qa_sep — whitespace separators (tab, " | ") must survive.
        qa_sep = "" if qa_sep is None else str(qa_sep)
        if qa_sep and qa_sep.lower() != "auto":
            sep = self.QA_SEPARATOR_PRESETS.get(qa_sep.lower(), qa_sep)
            if sep and sep in stripped:
                return stripped.split(sep, 1)
            return None
        # auto cascade (original heuristic order)
        if "\t" in stripped:
            return stripped.split("\t", 1)
        if " => " in stripped:
            return stripped.split(" => ", 1)
        if " -> " in stripped:
            return stripped.split(" -> ", 1)
        if " — " in stripped:   # em-dash (U+2014) — what AI assistants typically emit
            return stripped.split(" — ", 1)
        if " – " in stripped:   # en-dash (U+2013)
            return stripped.split(" – ", 1)
        if " - " in stripped:
            return stripped.split(" - ", 1)
        if ";" in stripped:
            return stripped.split(";", 1)
        if ":" in stripped and not ("http:" in stripped or "https:" in stripped):
            return stripped.split(":", 1)
        if "," in stripped:
            return stripped.split(",", 1)
        if "-" in stripped:
            return stripped.split("-", 1)
        return None

    # Optional explicit hint marker at the END of a line. Two forms:
    #   • slash form  "(/ ... /)"  — preferred & unambiguous: a plain "(...)" in the question
    #     (e.g. "...(а ещё молоко — белое)") is NOT treated as a hint;
    #   • keyword form "(подсказка|підказка|hint: ...)" — kept for back-compat.
    # Extracted and stripped BEFORE separator detection so its inner chars can't skew the
    # auto-detected separator.
    _HINT_MARKER_RE = re.compile(
        r"\s*(?:"
        r"\(\s*/\s*(?P<sl>.+?)\s*/\s*\)"
        r"|"
        r"[\(\[\{]\s*(?:подсказка|підказка|hint)\s*[:=]\s*(?P<kw>.+?)\s*[\)\]\}]"
        r")\s*$",
        re.IGNORECASE)

    def _extract_hint(self, line: str):
        """Return (line_without_hint, hint_or_None). No marker → (line, None)."""
        s = line if isinstance(line, str) else _s(line)
        m = self._HINT_MARKER_RE.search(s)
        if not m:
            return s, None
        hint = (m.group("sl") or m.group("kw") or "").strip()
        clean = s[:m.start()].rstrip()
        # Only treat it as a hint when something real remains as the card (front<sep>back);
        # otherwise it was probably the whole line — leave it untouched.
        return (clean, hint or None) if clean else (s, None)

    def _parse_txt_simplified(self, content: Any, options: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        opts = options or {}
        # Accept both "qa_separator" (legacy) and "separator" (current UI) keys.
        qa_sep = opts.get("qa_separator") or opts.get("separator") or "auto"
        card_sep = _s(opts.get("card_separator")).lower() or "line"
        # multiline: lines without a separator are appended to the previous card's back
        # (e.g. Quizlet exports where a definition spans several lines).
        # "auto" — decide automatically (used by the Auto import mode): enable only
        # for tab-hierarchy (dominant tab + tab-less continuation lines).
        ml_opt = opts.get("multiline")
        auto_ml = isinstance(ml_opt, str) and ml_opt.strip().lower() == "auto"
        multiline = False if auto_ml else bool(ml_opt)

        text = _s(content)
        parsed: List[Dict[str, Any]] = []

        if card_sep == "blank":
            # Blank-line separated blocks: first line = front, the rest joined = back.
            blocks = re.split(r"\n\s*\n", text)
            for block in blocks:
                block_lines = [ln.strip() for ln in block.splitlines()
                               if ln.strip() and not ln.strip().startswith(("//", "#"))]
                if not block_lines:
                    continue
                if len(block_lines) >= 2:
                    front = block_lines[0]
                    back = "\n".join(block_lines[1:]).strip()
                    back, hint = self._extract_hint(back)
                    if front and back:
                        parsed.append(self._ok_item(front, back, hint))
                    else:
                        parsed.append(self._err_item(block.strip(), "empty_front_or_back"))
                else:
                    # Single-line block: fall back to inline separator split.
                    clean0, hint0 = self._extract_hint(block_lines[0])
                    parts = self._split_simplified(clean0, qa_sep)
                    if parts and len(parts) == 2 and parts[0].strip() and parts[1].strip():
                        parsed.append(self._ok_item(parts[0].strip(), parts[1].strip(), hint0))
                    else:
                        parsed.append(self._err_item(block_lines[0], "separator_not_found"))
            return parsed

        content_lines = [ln.strip() for ln in text.splitlines()
                         if ln.strip() and not ln.strip().startswith(("//", "#"))]

        # Pull out optional hint markers FIRST, so the separator detection/split below only
        # ever sees the front<sep>back text — the existing auto-detect stays untouched.
        line_data = [self._extract_hint(ln) for ln in content_lines]   # [(clean, hint), ...]
        clean_lines = [c for c, _ in line_data]

        # In auto mode, lock onto the separator that dominates the whole text. This keeps
        # the split consistent (e.g. a tab-separated Quizlet export where some definitions
        # themselves contain " - " won't be split on the dash).
        line_sep = qa_sep
        if _s(qa_sep).lower() in ("", "auto"):
            dominant = self._detect_dominant_separator(clean_lines)
            if dominant:
                line_sep = dominant

        # Auto-multiline: turn it on only for a tab hierarchy (Quizlet tree) — a
        # dominant tab with tab-less continuation lines. Flat lists keep it off so
        # a stray separator-less line is flagged instead of silently merged.
        if auto_ml:
            multiline = (line_sep == "\t" and any("\t" not in ln for ln in clean_lines))

        for clean, hint in line_data:
            parts = self._split_simplified(clean, line_sep)
            if parts and len(parts) == 2 and parts[0].strip() and parts[1].strip():
                parsed.append(self._ok_item(parts[0].strip(), parts[1].strip(), hint))
            elif multiline and parsed and parsed[-1].get("status") == "ok":
                # Continuation line: append to the previous card's back (and its hint, if any).
                prev = parsed[-1]
                prev["back"] = (prev["back"] + "\n" + clean).strip()
                if hint and not prev.get("hint"):
                    prev["hint"] = hint
            else:
                parsed.append(self._err_item(clean, "separator_not_found"))
        return parsed

    @staticmethod
    def _detect_dominant_separator(lines: List[str]) -> Optional[str]:
        """Pick the separator present on most lines (priority order breaks ties).

        Returns None unless one separator clearly dominates (>=2 lines and >=40%),
        so genuinely mixed-separator input falls back to the per-line cascade.

        Tab is the exception: it is an almost-certain structural marker (it virtually
        never appears incidentally in pasted prose), so a tab on >=2 lines wins
        outright even below the 40% bar — this is the Quizlet tree export where most
        lines are tab-less continuations and the tabbed parents are a minority.
        """
        if not lines:
            return None
        if sum(1 for ln in lines if "\t" in ln) >= 2:
            return "\t"
        candidates = ["\t", " => ", " -> ", " — ", " – ", " - ", ";", ":", ","]
        best, best_count = None, 0
        for sep in candidates:
            count = 0
            for ln in lines:
                if sep == ":" and ("http:" in ln or "https:" in ln):
                    continue
                if sep in ln:
                    count += 1
            if count > best_count:  # strict > keeps higher-priority sep on ties
                best, best_count = sep, count
        if best_count >= 2 and best_count >= 0.4 * len(lines):
            return best
        return None

    def import_txt_simplified(self, deck_id: str, content: str, options: Optional[Dict[str, Any]] = None, dedup: bool = True) -> Dict[str, Any]:
        parsed = self._parse_txt_simplified(content, options)
        return self._create_from_parsed(deck_id, parsed, dedup=dedup)

    def import_auto(self, deck_id: str, content: str, options: Optional[Dict[str, Any]] = None, dedup: bool = True) -> Dict[str, Any]:
        """Detect the format from the content and import with the matching parser."""
        fmt = self._detect_format(content)
        if fmt == "json":
            return self.import_json(deck_id, content, options=options, dedup=dedup)
        parsed = self._parse_by_format(fmt, content, options)
        result = self._create_from_parsed(deck_id, parsed, dedup=dedup)
        result["detected_format"] = fmt
        return result

    def _parse_test(self, content: Any, options: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Parse a test-question file. Wrong answers are ignored; card = question + correct answer.
        All correct answers are kept: the first becomes `back`, the rest go to acceptable_answers."""
        from task_system.models.test_parser import TestFileParser
        import tempfile

        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".txt", mode="w", encoding="utf-8") as tmp:
                temp_path = tmp.name
                tmp.write(_s(content))

            # Custom markers (variant A): the UI can override question/answer/image
            # markers to match an unusual file without code changes.
            markers = (options or {}).get("markers")
            parser = TestFileParser(markers=markers)
            # Lenient: skip malformed lines (questions without '?', B./C. options,
            # stray separators) so a messy bank still imports its valid questions.
            questions = parser.parse_file(temp_path, lenient=True)

            parsed: List[Dict[str, Any]] = []
            for q in questions:
                front_text = (q.text or "").strip()
                correct_answers = [ans.text.strip() for ans in q.answers if ans.correct and ans.text.strip()]
                if not front_text:
                    continue
                if not correct_answers:
                    parsed.append(self._err_item(front_text, "no_correct_answer"))
                    continue
                parsed.append(self._ok_item(front_text, correct_answers[0],
                                            acceptable_answers=correct_answers[1:]))
            return parsed
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass

    def import_test(self, deck_id: str, content: str, options: Optional[Dict[str, Any]] = None, dedup: bool = True) -> Dict[str, Any]:
        parsed = self._parse_test(content, options)
        return self._create_from_parsed(deck_id, parsed, dedup=dedup)
