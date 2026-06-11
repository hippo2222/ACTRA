"""One-time migration: legacy V1 microcards decks -> the V2 store (plan M4).

Sources (both optional, both scanned when reachable):
  * file decks:   <data-dir>/microcards/decks/*.json with the V1 schema
                  (V1 and V2 deck documents share this directory; V1 docs are
                  recognized by their `meta` envelope / per-card `card_type`);
  * hosted table: actra_hosted_microcards_decks (payload JSONB) when a DSN
                  is available.

Conversion (decisions D2-D4, docs/microcards_v1_editor_migration_plan.md):
  * fact_recall cards  -> front/back text cards;
  * pair_match cards   -> one ordinary Q/A card per pair (left -> right);
  * archived decks     -> migrated WITH the tag «архив»;
  * review progress    -> NOT migrated (V1 manual intervals are incompatible
                          with FSRS; cards arrive as new).

The original V1 documents are never modified or deleted (cold backup).
Idempotent: each migrated V2 deck records `migrated_from_v1: <old id>`;
re-running skips decks that are already migrated for that owner.

Usage:
  python tools/migrate_microcards_v1_decks_to_v2.py \
      --data-dir data [--dsn "$ACTRA_POSTGRES_DSN"] [--dry-run]

Run on prod BEFORE the V1 removal deploy (M5).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))

from persistence.microcards_v2_storage import resolve_microcards_storage  # noqa: E402


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _s(value: Any) -> str:
    return str(value if value is not None else "").strip()


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


def is_v1_deck(doc: Dict[str, Any]) -> bool:
    """V1 docs carry a meta envelope and typed cards; V2 docs have a top-level
    created_by_user_id and plain front/back cards."""
    if not isinstance(doc, dict):
        return False
    if doc.get("created_by_user_id"):
        return False  # V2 document
    if isinstance(doc.get("meta"), dict):
        return True
    cards = doc.get("cards")
    if isinstance(cards, list):
        return any(isinstance(c, dict) and c.get("card_type") for c in cards)
    return False


def convert_v1_cards(cards: Any) -> List[Tuple[str, str, Optional[str]]]:
    """V1 cards -> (front, back, hint) triples; pair_match explodes per pair."""
    rows: List[Tuple[str, str, Optional[str]]] = []
    for card in cards if isinstance(cards, list) else []:
        if not isinstance(card, dict):
            continue
        ctype = _s(card.get("card_type")).lower() or "fact_recall"
        front = card.get("front") if isinstance(card.get("front"), dict) else {}
        back = card.get("back") if isinstance(card.get("back"), dict) else {}
        if ctype == "pair_match":
            fp = front.get("payload") if isinstance(front.get("payload"), dict) else {}
            bp = back.get("payload") if isinstance(back.get("payload"), dict) else {}
            left = {_s(i.get("id")): _s(i.get("text"))
                    for i in (fp.get("left_items") or []) if isinstance(i, dict)}
            right = {_s(i.get("id")): _s(i.get("text"))
                     for i in (fp.get("right_items") or []) if isinstance(i, dict)}
            for pair in (bp.get("pairs") or []):
                if not isinstance(pair, dict):
                    continue
                lt = left.get(_s(pair.get("left_id")))
                rt = right.get(_s(pair.get("right_id")))
                if lt and rt:
                    rows.append((lt, rt, None))
        else:
            ft = _s(front.get("text"))
            bt = _s(back.get("text"))
            if ft and bt:
                rows.append((ft, bt, _s(card.get("hint")) or None))
    return rows


def convert_v1_deck(doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Build a V2 deck document; None when there is no owner or no content."""
    meta = doc.get("meta") if isinstance(doc.get("meta"), dict) else {}
    owner = _s(meta.get("created_by_user_id")) or _s(doc.get("user_id"))
    if not owner:
        return None

    seen: set = set()
    cards: List[Dict[str, Any]] = []
    for front, back, hint in convert_v1_cards(doc.get("cards")):
        key = _norm(front)
        if key in seen:
            continue
        seen.add(key)
        cards.append({
            "id": f"mc_{uuid.uuid4().hex[:10]}",
            "front": {"text": front},
            "back": {"text": back},
            "hint": hint,
            "status": "active",
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        })
    if not cards:
        return None

    tags = ["v1"]
    if bool(meta.get("archived")):
        tags.append("архив")
    now = _now_iso()
    return {
        "id": f"deck_{uuid.uuid4().hex[:12]}",
        "name": _s(doc.get("name")) or _s(doc.get("id")) or "V1 deck",
        "description": _s(doc.get("description")),
        "tags": tags,
        "cards": cards,
        "created_by_user_id": owner,
        "migrated_from_v1": _s(doc.get("id")) or None,
        "created_at": _s(doc.get("created_at")) or now,
        "updated_at": now,
    }


def _load_v1_file_decks(data_dir: Path) -> List[Dict[str, Any]]:
    root = data_dir / "microcards" / "decks"
    if not root.exists():
        return []
    out = []
    for path in sorted(root.glob("*.json")):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                doc = json.load(fh)
        except Exception as exc:
            print(f"  !! skipping {path.name}: {exc}")
            continue
        if is_v1_deck(doc):
            out.append(doc)
    return out


def _load_v1_hosted_decks(dsn: str) -> List[Dict[str, Any]]:
    if not dsn.strip():
        return []
    try:
        from persistence.postgres import postgres_connection
        with postgres_connection(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT payload FROM actra_hosted_microcards_decks")
                rows = cur.fetchall()
    except Exception as exc:
        print(f"  (hosted V1 table not readable: {exc})")
        return []
    out = []
    for (raw,) in rows:
        doc = raw if isinstance(raw, dict) else None
        if doc is None and isinstance(raw, str):
            try:
                doc = json.loads(raw)
            except ValueError:
                continue
        if isinstance(doc, dict) and is_v1_deck(doc):
            out.append(doc)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--dsn", default=os.environ.get("ACTRA_POSTGRES_DSN", ""),
                        help="Postgres DSN for the hosted V1 deck table (default: $ACTRA_POSTGRES_DSN)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    storage = resolve_microcards_storage(data_dir)
    print(f"V2 target backend: {storage.backend_name}")

    sources = _load_v1_file_decks(data_dir) + _load_v1_hosted_decks(args.dsn)
    if not sources:
        print("No V1 decks found — nothing to migrate.")
        return 0

    # Idempotency map: owner -> set of already-migrated v1 ids.
    migrated_by_owner: Dict[str, set] = {}

    migrated = skipped = empty = 0
    for doc in sources:
        converted = convert_v1_deck(doc)
        if converted is None:
            empty += 1
            print(f"  -- {_s(doc.get('id'))}: no owner or no convertible cards, skipped")
            continue
        owner = converted["created_by_user_id"]
        if owner not in migrated_by_owner:
            migrated_by_owner[owner] = {
                _s(d.get("migrated_from_v1"))
                for d in storage.list_deck_docs(owner_user_id=owner)
                if _s(d.get("migrated_from_v1"))
            }
        if converted["migrated_from_v1"] and converted["migrated_from_v1"] in migrated_by_owner[owner]:
            skipped += 1
            continue
        archived = "архив" in converted["tags"]
        print(f"  ++ {converted['migrated_from_v1']} -> {converted['id']} "
              f"({converted['name']!r}, owner={owner}, cards={len(converted['cards'])}"
              f"{', archived' if archived else ''})")
        if not args.dry_run:
            storage.put_deck_doc(converted["id"], converted)
        migrated_by_owner[owner].add(converted["migrated_from_v1"])
        migrated += 1

    mode = "DRY RUN — nothing written" if args.dry_run else "written"
    print(f"\nDone: migrated {migrated}, already-migrated {skipped}, "
          f"unconvertible {empty} ({mode}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
