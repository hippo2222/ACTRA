# -*- coding: utf-8 -*-
"""Convert previously-imported microcard deck COPIES into read-only LINKS.

Background: catalog deck imports used to copy the snapshot into an editable local
deck. They are now read-only references (like complex/theory library entries).
This one-off migrates existing copies.

Discriminator (file-only, safe — no catalog needed):
  a deck is an imported COPY if it has `catalog_item_id`, is NOT already `linked`,
  and has NO `catalog_visibility` (own-published source decks carry the visibility
  set at publish time; imported copies never do).

Usage:
  python desktop-app/tools/migrate_microcards_copies_to_links.py [DECKS_DIR] [--apply]
  Default DECKS_DIR: data/microcards/decks   Default: dry-run (no writes).
"""
import json, sys, glob, os, io

def main():
    args = [a for a in sys.argv[1:]]
    apply = "--apply" in args
    args = [a for a in args if a != "--apply"]
    decks_dir = args[0] if args else os.path.join("data", "microcards", "decks")
    files = sorted(glob.glob(os.path.join(decks_dir, "*.json")))
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    converted = 0
    for p in files:
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        is_copy = bool(d.get("catalog_item_id")) and not d.get("catalog_visibility") and not d.get("linked")
        if not is_copy:
            continue
        cards = d.get("cards") or []
        d["linked"] = True
        d["card_count"] = len(cards)
        d["linked_card_ids"] = []  # refreshed from the catalog snapshot on first open
        d["granted_access_code"] = d.get("granted_access_code") or None
        d["cards"] = []
        d.pop("catalog_visibility", None)
        d.pop("access_code", None)
        converted += 1
        print(f"{'CONVERT' if apply else 'WOULD CONVERT'}: {d.get('name')!r} ({os.path.basename(p)}) — {len(cards)} cards dropped", file=out)
        if apply:
            with open(p, "w", encoding="utf-8") as f:
                json.dump(d, f, ensure_ascii=False, indent=2)
    print(f"\n{converted} deck(s) {'converted' if apply else 'to convert'}. {'(dry-run; pass --apply to write)' if not apply else ''}", file=out)
    out.flush()

if __name__ == "__main__":
    main()
