"""M4: legacy V1 decks -> V2 store migration (tools/migrate_microcards_v1_decks_to_v2)."""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.microcards_service_v2 import MicrocardsServiceV2

TOOLS = Path(__file__).parent.parent.parent.parent / "tools"
sys.path.insert(0, str(TOOLS))
import migrate_microcards_v1_decks_to_v2 as mig  # noqa: E402


def _v1_deck(deck_id="deck_v1aaa", owner="alice", archived=False):
    return {
        "id": deck_id,
        "schema_version": "1.0",
        "name": "Анализ / кости",
        "meta": {"created_by_user_id": owner, "archived": archived},
        "cards": [
            {"id": "mc_a", "card_type": "fact_recall",
             "front": {"text": "Os coxae", "payload": {}},
             "back": {"text": "Тазовая кость", "payload": {}}, "status": "active"},
            {"id": "mc_b", "card_type": "pair_match",
             "front": {"text": "Сопоставьте", "payload": {
                 "left_items": [{"id": "l1", "text": "Femur"}, {"id": "l2", "text": "Tibia"}],
                 "right_items": [{"id": "r1", "text": "Бедренная кость"}, {"id": "r2", "text": "Большеберцовая кость"}],
             }},
             "back": {"text": "Правильные соответствия", "payload": {
                 "pairs": [{"left_id": "l1", "right_id": "r1"}, {"left_id": "l2", "right_id": "r2"}],
             }}, "status": "active"},
            # Duplicate of the fact card after flattening → deduped.
            {"id": "mc_c", "card_type": "fact_recall",
             "front": {"text": "Os coxae", "payload": {}},
             "back": {"text": "дубль", "payload": {}}, "status": "active"},
        ],
    }


def test_v1_deck_detection_and_conversion():
    assert mig.is_v1_deck(_v1_deck()) is True
    assert mig.is_v1_deck({"id": "d", "created_by_user_id": "u", "cards": []}) is False

    converted = mig.convert_v1_deck(_v1_deck(archived=True))
    fronts = {c["front"]["text"]: c["back"]["text"] for c in converted["cards"]}
    assert fronts == {
        "Os coxae": "Тазовая кость",          # pair flattening + dedup kept the first
        "Femur": "Бедренная кость",
        "Tibia": "Большеберцовая кость",
    }
    assert converted["created_by_user_id"] == "alice"
    assert converted["migrated_from_v1"] == "deck_v1aaa"
    assert "архив" in converted["tags"]

    # No owner → unconvertible.
    ownerless = _v1_deck()
    ownerless["meta"] = {}
    assert mig.convert_v1_deck(ownerless) is None


def test_migration_end_to_end_idempotent(monkeypatch, capsys):
    tmp = Path(tempfile.mkdtemp())
    decks_dir = tmp / "microcards" / "decks"
    decks_dir.mkdir(parents=True)
    with open(decks_dir / "deck_v1aaa.json", "w", encoding="utf-8") as fh:
        json.dump(_v1_deck(), fh, ensure_ascii=False)

    # A V2 deck in the same shared directory must be left alone.
    svc = MicrocardsServiceV2(str(tmp), user_id="alice")
    existing = svc.create_deck(name="Уже V2")

    monkeypatch.setattr(sys, "argv", ["mig", "--data-dir", str(tmp), "--dsn", ""])
    assert mig.main() == 0

    decks = svc.list_decks()
    names = {d["name"] for d in decks}
    assert names == {"Уже V2", "Анализ / кости"}
    migrated = next(d for d in decks if d["name"] == "Анализ / кости")
    full = svc.get_deck(migrated["id"])
    assert full["migrated_from_v1"] == "deck_v1aaa"
    assert len(full["cards"]) == 3
    assert "v1" in full["tags"]

    # The original V1 file is untouched (cold backup).
    with open(decks_dir / "deck_v1aaa.json", encoding="utf-8") as fh:
        assert json.load(fh)["schema_version"] == "1.0"
    # The pre-existing V2 deck wasn't rewritten.
    assert svc.get_deck(existing["id"])["name"] == "Уже V2"

    # Re-run: idempotent, nothing new.
    assert mig.main() == 0
    out = capsys.readouterr().out
    assert "already-migrated 1" in out
    assert len(svc.list_decks()) == 2
