"""One-time migration: microcards V2 JSON files -> Postgres storage.

Copies the historical file layout into the V2 Postgres tables verbatim
(payload envelopes unchanged), so the app can switch its storage backend
(persistence/microcards_v2_storage.py) without any data transformation.

What is migrated:
  data/microcards/decks/<deck_id>.json              -> actra_microcards_v2_decks
  data/users/<uid>/microcards/review_states.json    -> actra_microcards_v2_user_docs (kind=states)
  data/users/<uid>/microcards/settings.json         ->                      (kind=settings)
  data/users/<uid>/microcards/review_events.json    ->                      (kind=events)
  data/users/<uid>/microcards/deck_records.json     ->                      (kind=records)
  data/users/<uid>/microcards/review_sessions.json  ->                      (kind=sessions)

Idempotent: re-running upserts the same documents. Files are never modified
or removed — keep them as a cold backup after the cutover.

Usage (on the host / inside the app container):
  python tools/migrate_microcards_files_to_postgres.py \
      --data-dir /app/data --dsn "$ACTRA_POSTGRES_DSN" [--dry-run]

Cutover checklist (prod, Hetzner):
  1. Deploy this code (the app still reads files until env says otherwise —
     in hosted runs the backend flips automatically when ACTRA_RUNTIME_MODE
     =hosted_web and ACTRA_POSTGRES_DSN are set, so migrate BEFORE deploy
     or within the same maintenance window).
  2. Run with --dry-run, eyeball the counts.
  3. Run for real; restart the app container.
  4. Smoke: library lists decks, a review session starts, records intact.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))

from persistence.microcards_v2_storage import (  # noqa: E402
    USER_DOC_FILES,
    PostgresMicrocardsStorage,
)


def _read_json(path: Path) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:
        print(f"  !! skipping {path}: {exc}")
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data-dir", default="data", help="App data directory (default: data)")
    parser.add_argument("--dsn", default=os.environ.get("ACTRA_POSTGRES_DSN", ""),
                        help="Postgres DSN (default: $ACTRA_POSTGRES_DSN)")
    parser.add_argument("--dry-run", action="store_true", help="Scan and report only, write nothing")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    if not data_dir.exists():
        print(f"data dir not found: {data_dir}")
        return 2
    if not args.dry_run and not args.dsn.strip():
        print("DSN is required (pass --dsn or set ACTRA_POSTGRES_DSN)")
        return 2

    storage = None
    if not args.dry_run:
        storage = PostgresMicrocardsStorage(args.dsn)
        storage.ensure_schema()

    decks_migrated = 0
    decks_root = data_dir / "microcards" / "decks"
    if decks_root.exists():
        for path in sorted(decks_root.glob("*.json")):
            doc = _read_json(path)
            if not isinstance(doc, dict) or not doc.get("id"):
                continue
            print(f"  deck {doc['id']}  ({doc.get('name', '')!r}, owner={doc.get('created_by_user_id')})")
            if storage is not None:
                storage.put_deck_doc(str(doc["id"]), doc)
            decks_migrated += 1

    docs_migrated = 0
    users_root = data_dir / "users"
    if users_root.exists():
        for user_dir in sorted(users_root.iterdir()):
            mc_dir = user_dir / "microcards"
            if not mc_dir.is_dir():
                continue
            user_id = user_dir.name
            for kind, filename in USER_DOC_FILES.items():
                path = mc_dir / filename
                if not path.exists():
                    continue
                payload = _read_json(path)
                if payload is None:
                    continue
                size = len(payload) if isinstance(payload, (list, dict)) else 1
                print(f"  user {user_id}: {kind} ({size} entries)")
                if storage is not None:
                    storage.put_user_doc(user_id, kind, payload)
                docs_migrated += 1

    mode = "DRY RUN — nothing written" if args.dry_run else "written to Postgres"
    print(f"\nDone: {decks_migrated} decks, {docs_migrated} user documents ({mode}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
