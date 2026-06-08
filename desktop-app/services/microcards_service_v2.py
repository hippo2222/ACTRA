"""Microcards V2 service with FSRS-4.5 scheduler and progressive levels."""

import json
import os
import random
import re
import uuid
import difflib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from logic.fsrs import FSRS, Rating, State


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
        "new_per_session_mode": "manual",  # manual | auto (adaptive to review backlog)
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

    def update_settings(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        s = self.get_settings()
        if isinstance(patch, dict):
            for k in self.DEFAULT_SETTINGS:
                if patch.get(k) is not None:
                    s[k] = patch[k]
        _write_json(self._settings_path, s)
        return self.get_settings()

    @property
    def _events_path(self) -> Path:
        return self._user_root / "review_events.json"

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

    def _read_sessions(self) -> Dict[str, Any]:
        payload = _read_json(self._sessions_path, {"schema_version": "2.0", "user_id": self.user_id, "items": {}, "active_by_deck": {}})
        items = payload.get("items")
        active_by_deck = payload.get("active_by_deck")
        if not isinstance(items, dict):
            items = {}
        if not isinstance(active_by_deck, dict):
            active_by_deck = {}
        return {
            "schema_version": "2.0",
            "user_id": self.user_id,
            "items": items,
            "active_by_deck": active_by_deck
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
            if not session.get("completed"):
                sessions["active_by_deck"][deck_id] = session_id
            else:
                sessions["active_by_deck"].pop(deck_id, None)
        self._write_sessions(sessions)

    def _get_active_session_for_deck(self, deck_id: str) -> Optional[Dict[str, Any]]:
        sessions = self._read_sessions()
        session_id = sessions["active_by_deck"].get(deck_id)
        if session_id:
            return sessions["items"].get(session_id)
        return None

    # ── Decks CRUD ────────────────────────────────────────────────────

    def _owns_deck(self, deck: Dict[str, Any]) -> bool:
        """Decks live in a global store but belong to a single user.
        Ownership is the only access boundary — enforce it everywhere."""
        return _s(deck.get("created_by_user_id")) == _s(self.user_id)

    def get_deck(self, deck_id: str) -> Optional[Dict[str, Any]]:
        clean_id = _s(deck_id)
        if not clean_id:
            return None
        path = self._deck_path(clean_id)
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
            deck["card_count"] = len(cards) if access_state == "granted" else (deck.get("card_count") or 0)
        return deck

    def _resolve_linked_deck(self, deck: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], str]:
        """Fetch read-only cards for a linked deck from the catalog snapshot.

        access_state: 'granted' | 'requires_access_code' | 'revoked' | 'unavailable'.
        """
        cat = self.catalog_service
        item_id = _s(deck.get("catalog_item_id"))
        if not cat or not item_id:
            return [], "unavailable"
        code = deck.get("granted_access_code")
        try:
            res = cat.add_item_to_library(item_id, requested_by_user_id=self.user_id, access_code=code)
            snap = res.get("snapshot") or {}
            cards = snap.get("cards") or []
            return (cards if isinstance(cards, list) else []), "granted"
        except ValueError as exc:
            msg = str(exc).lower()
            if "access_code" in msg or "access code" in msg:
                return [], "requires_access_code"
            if "not_found" in msg or "deleted" in msg or "revoked" in msg or "not_accessible" in msg:
                return [], "revoked"
            return [], "unavailable"
        except Exception:
            return [], "unavailable"

    def _assert_editable(self, deck: Dict[str, Any]) -> None:
        """Linked decks are read-only references — block content mutations."""
        if deck.get("linked"):
            raise ValueError("deck_is_linked_readonly")

    def list_decks(self, limit: int = 100) -> List[Dict[str, Any]]:
        paths = list(self._decks_root.glob("*.json"))
        decks: List[Dict[str, Any]] = []
        states = self._read_states()

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
                    catalog_visibility: Optional[str] = None, access_code: Optional[str] = None) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")
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

        deck["updated_at"] = _utc_now_iso()
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

    def create_card(self, deck_id: str, front_text: str, back_text: str, hint: Optional[str] = None, front_image_url: Optional[str] = None, back_image_url: Optional[str] = None, acceptable_answers: Optional[List[str]] = None) -> Dict[str, Any]:
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
                "image_url": front_image_url
            },
            "back": {
                "text": _s(back_text),
                "image_url": back_image_url
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

    def update_card(self, deck_id: str, card_id: str, front_text: Optional[str] = None, back_text: Optional[str] = None, hint: Optional[str] = None, front_image_url: Optional[str] = None, back_image_url: Optional[str] = None, status: Optional[str] = None, acceptable_answers: Optional[List[str]] = None) -> Dict[str, Any]:
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
        if back_text is not None:
            card["back"]["text"] = _s(back_text)
        if back_image_url is not None:
            card["back"]["image_url"] = back_image_url
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
                      direction: Optional[str] = None) -> Dict[str, Any]:
        deck = self.get_deck(deck_id)
        if not deck:
            raise LookupError("deck_not_found")

        if resume and not restart:
            active_session = self._get_active_session_for_deck(deck_id)
            if active_session:
                return active_session

        # Create new session
        cards = deck.get("cards", [])
        if not cards:
            raise ValueError("deck_is_empty")

        settings = self.get_settings()
        size = settings["session_size"]
        new_limit = settings["new_per_session"]
        if direction not in self.DIRECTIONS:
            direction = settings["default_direction"]

        states = self._read_states()
        now = _utc_now()

        due_cards = []
        new_cards = []

        for card in cards:
            card_id = card.get("id")
            state = states.get(card_id, {})
            stability = state.get("stability", 0.0)

            if not state or stability <= 0:
                new_cards.append(card_id)
            else:
                due_at = _parse_iso(state.get("due_at"))
                if due_at and due_at <= now:
                    due_cards.append(card_id)

        # In 'auto' mode the new-card limit adapts to the current review backlog.
        if settings.get("new_per_session_mode") == "auto":
            new_limit = self._auto_new_limit(len(due_cards), new_limit)

        # Mix cards: due cards first, then new cards (capped by the new-per-session
        # limit), up to the configured session size.
        random.shuffle(due_cards)
        random.shuffle(new_cards)

        queue = []
        queue.extend(due_cards[:size])
        if len(queue) < size:
            remaining = size - len(queue)
            queue.extend(new_cards[:min(new_limit, remaining)])

        if not queue:
            # If nothing is due or new, let user study everything
            all_ids = [c.get("id") for c in cards]
            random.shuffle(all_ids)
            queue = all_ids[:size]

        # Resolve a concrete direction per card (mixed → random per card).
        card_directions = {}
        for cid in queue:
            if direction == "mixed":
                card_directions[cid] = random.choice(("front_back", "back_front"))
            else:
                card_directions[cid] = direction

        session_id = f"session_{uuid.uuid4().hex[:12]}"
        session = {
            "id": session_id,
            "deck_id": deck_id,
            "user_id": self.user_id,
            "card_queue": queue,
            "direction": direction,
            "card_directions": card_directions,
            "cursor": 0,
            "completed": False,
            "created_at": _utc_now_iso(),
            "completed_at": None,
            "stats": {
                "total": len(queue),
                "correct": 0,
                "errors": 0,
                "error_card_ids": []
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

        level = card_state.get("level", 1)
        consecutive_correct = card_state.get("consecutive_correct", 0)
        is_correct = False
        rating = Rating.AGAIN

        # Direction of this card in the session decides which side is the answer.
        card_dir = (session.get("card_directions") or {}).get(card_id) or session.get("direction") or "front_back"
        if card_dir == "back_front":
            # Prompt = back side, the user must produce the FRONT text.
            expected_text = card["front"]["text"]
            acceptable = []  # acceptable_answers describe the back side only
        else:
            expected_text = card["back"]["text"]
            acceptable = card.get("acceptable_answers") or []

        # 1. Check correctness based on Level
        if level == 1:
            # Level 1: user_answer is expected to be "know" or "dont_know"
            ans_clean = _s(user_answer).lower()
            if ans_clean == "know" or override:
                is_correct = True
                rating = Rating.GOOD
            else:
                is_correct = False
                rating = Rating.AGAIN
        else:
            # Level 2: open answer compared via fuzzy matching (back side + alternatives).
            # Typo-tolerant by a fixed threshold; borderline misses are handled by override.
            is_correct = override or self.verify_answer_against_card(
                user_answer, expected_text, acceptable, self.FUZZY_THRESHOLD)
            rating = Rating.GOOD if is_correct else Rating.AGAIN

        # 2. Update level and progression
        if level == 1:
            if is_correct:
                consecutive_correct += 1
                if consecutive_correct >= 3:
                    level = 2
                    consecutive_correct = 0
            else:
                consecutive_correct = 0
        else: # level == 2
            if not is_correct:
                # Rollback to level 1 on failure
                level = 1
                consecutive_correct = 0

        # 3. Calculate spacing via FSRS
        now = _utc_now()
        last_reviewed_str = card_state.get("last_reviewed_at")
        last_reviewed = _parse_iso(last_reviewed_str)
        
        if last_reviewed:
            elapsed_days = max(0.0, (now - last_reviewed).total_seconds() / 86400.0)
        else:
            elapsed_days = 0.0

        fsrs_state = {
            "stability": card_state.get("stability", 0.0),
            "difficulty": card_state.get("difficulty", 0.0),
            "state": card_state.get("state", 0),
        }
        
        # Advance FSRS
        next_fsrs = self.fsrs.step(fsrs_state, rating, elapsed_days)
        
        # Update card_state
        card_state.update(next_fsrs)
        card_state["level"] = level
        card_state["consecutive_correct"] = consecutive_correct
        card_state["last_reviewed_at"] = now.isoformat().replace("+00:00", "Z")
        card_state["due_at"] = (now + timedelta(days=next_fsrs["interval_days"])).isoformat().replace("+00:00", "Z")

        # Save card state
        states[card_id] = card_state
        self._write_states(states)

        # 4. Log event
        event = {
            "id": f"mcrev_{uuid.uuid4().hex[:12]}",
            "user_id": self.user_id,
            "deck_id": deck_id,
            "card_id": card_id,
            "session_id": session_id,
            "level": level,
            "rating": int(rating),
            "user_answer": user_answer,
            "is_correct": is_correct,
            "reviewed_at": _utc_now_iso()
        }
        self._append_event(event)

        # 5. Update session stats
        stats = session.get("stats", {})
        error_card_ids = stats.get("error_card_ids", [])

        if not is_correct:
            stats["errors"] = stats.get("errors", 0) + 1
            if card_id not in error_card_ids:
                error_card_ids.append(card_id)
        else:
            stats["correct"] = stats.get("correct", 0) + 1
            # If user corrected an error with override, remove it from errors
            if override and card_id in error_card_ids:
                error_card_ids.remove(card_id)
                stats["errors"] = max(0, stats.get("errors", 1) - 1)

        stats["error_card_ids"] = error_card_ids
        session["stats"] = stats

        # Update cursor in queue
        queue = session.get("card_queue", [])
        cursor = session.get("cursor", 0)
        
        if _s(queue[cursor]) == _s(card_id):
            session["cursor"] = cursor + 1
            if cursor + 1 >= len(queue):
                session["completed"] = True
                session["completed_at"] = _utc_now_iso()

        self._save_session(session, set_active=True)

        return {
            "is_correct": is_correct,
            "card_state": card_state,
            "session": session,
            "expected_answer": expected_text,
            "direction": card_dir,
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
                    if front and back:
                        parsed.append(self._ok_item(front, back))
                    else:
                        parsed.append(self._err_item(block.strip(), "empty_front_or_back"))
                else:
                    # Single-line block: fall back to inline separator split.
                    parts = self._split_simplified(block_lines[0], qa_sep)
                    if parts and len(parts) == 2 and parts[0].strip() and parts[1].strip():
                        parsed.append(self._ok_item(parts[0].strip(), parts[1].strip()))
                    else:
                        parsed.append(self._err_item(block_lines[0], "separator_not_found"))
            return parsed

        content_lines = [ln.strip() for ln in text.splitlines()
                         if ln.strip() and not ln.strip().startswith(("//", "#"))]

        # In auto mode, lock onto the separator that dominates the whole text. This keeps
        # the split consistent (e.g. a tab-separated Quizlet export where some definitions
        # themselves contain " - " won't be split on the dash).
        line_sep = qa_sep
        if _s(qa_sep).lower() in ("", "auto"):
            dominant = self._detect_dominant_separator(content_lines)
            if dominant:
                line_sep = dominant

        # Auto-multiline: turn it on only for a tab hierarchy (Quizlet tree) — a
        # dominant tab with tab-less continuation lines. Flat lists keep it off so
        # a stray separator-less line is flagged instead of silently merged.
        if auto_ml:
            multiline = (line_sep == "\t" and any("\t" not in ln for ln in content_lines))

        for stripped in content_lines:
            parts = self._split_simplified(stripped, line_sep)
            if parts and len(parts) == 2 and parts[0].strip() and parts[1].strip():
                parsed.append(self._ok_item(parts[0].strip(), parts[1].strip()))
            elif multiline and parsed and parsed[-1].get("status") == "ok":
                # Continuation line: append to the previous card's back.
                prev = parsed[-1]
                prev["back"] = (prev["back"] + "\n" + stripped).strip()
            else:
                parsed.append(self._err_item(stripped, "separator_not_found"))
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
        candidates = ["\t", " => ", " -> ", " - ", ";", ":", ","]
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
