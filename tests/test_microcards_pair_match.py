"""Unit/integration tests for M15 pair_match card CRUD and import (microcards_service)."""

import sys
import os
import shutil
import tempfile
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.microcards_service import MicrocardsService
from task_system.models.parsers.microcard_parser import MicrocardParser


@pytest.fixture
def tmp_data_dir():
    d = tempfile.mkdtemp(prefix="test_mc_pm_")
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def svc(tmp_data_dir):
    return MicrocardsService(data_dir=tmp_data_dir, user_id="test_user")


@pytest.fixture
def deck(svc):
    return svc.create_deck_manual(name="PM Test Deck")


VALID_PAIRS = [
    {"left": "Систола", "right": "Фаза сокращения"},
    {"left": "Диастола", "right": "Фаза расслабления"},
]


# ── create_pair_match_card_manual ──────────────────────────────────


class TestCreatePairMatchCard:
    def test_basic_create(self, svc, deck):
        card = svc.create_pair_match_card_manual(
            deck_id=deck["id"],
            front_text="Сопоставьте термин и определение",
            pairs=VALID_PAIRS,
        )
        assert card["card_type"] == "pair_match"
        assert card["created_by"] == "manual_editor"
        assert card["status"] == "active"
        assert card["front"]["text"] == "Сопоставьте термин и определение"
        assert card["back"]["text"] == "Правильные соответствия"

        # Payload structure
        fp = card["front"]["payload"]
        assert fp["mode"] == "pair_match"
        assert len(fp["left_items"]) == 2
        assert len(fp["right_items"]) == 2
        assert fp["shuffle_right"] is True

        bp = card["back"]["payload"]
        assert bp["mode"] == "pair_match_solution"
        assert len(bp["pairs"]) == 2
        assert bp["pairs"][0]["left_id"] == "l1"
        assert bp["pairs"][0]["right_id"] == "r1"

    def test_tags_and_difficulty(self, svc, deck):
        card = svc.create_pair_match_card_manual(
            deck_id=deck["id"],
            front_text="Инструкция",
            pairs=VALID_PAIRS,
            tags=["tag1", "tag2"],
            difficulty_hint="high",
        )
        assert card["tags"] == ["tag1", "tag2"]
        assert card["difficulty_hint"] == "high"

    def test_five_pairs_ok(self, svc, deck):
        pairs = [{"left": f"L{i}", "right": f"R{i}"} for i in range(5)]
        card = svc.create_pair_match_card_manual(
            deck_id=deck["id"],
            front_text="Инструкция",
            pairs=pairs,
        )
        assert len(card["front"]["payload"]["left_items"]) == 5
        assert len(card["back"]["payload"]["pairs"]) == 5

    def test_one_pair_raises(self, svc, deck):
        with pytest.raises(ValueError, match="pair_match_min_2_pairs"):
            svc.create_pair_match_card_manual(
                deck_id=deck["id"],
                front_text="X",
                pairs=[{"left": "A", "right": "B"}],
            )

    def test_six_pairs_raises(self, svc, deck):
        pairs = [{"left": f"L{i}", "right": f"R{i}"} for i in range(6)]
        with pytest.raises(ValueError, match="pair_match_max_5_pairs"):
            svc.create_pair_match_card_manual(
                deck_id=deck["id"],
                front_text="X",
                pairs=pairs,
            )

    def test_duplicate_left_raises(self, svc, deck):
        with pytest.raises(ValueError, match="pair_match_duplicate_left"):
            svc.create_pair_match_card_manual(
                deck_id=deck["id"],
                front_text="X",
                pairs=[{"left": "Same", "right": "A"}, {"left": "Same", "right": "B"}],
            )

    def test_duplicate_right_raises(self, svc, deck):
        with pytest.raises(ValueError, match="pair_match_duplicate_right"):
            svc.create_pair_match_card_manual(
                deck_id=deck["id"],
                front_text="X",
                pairs=[{"left": "A", "right": "Same"}, {"left": "B", "right": "Same"}],
            )

    def test_empty_front_raises(self, svc, deck):
        with pytest.raises(ValueError, match="front_text_required"):
            svc.create_pair_match_card_manual(
                deck_id=deck["id"],
                front_text="",
                pairs=VALID_PAIRS,
            )

    def test_empty_pair_items_filtered(self, svc, deck):
        pairs = [
            {"left": "A", "right": "B"},
            {"left": "", "right": ""},
            {"left": "C", "right": "D"},
        ]
        card = svc.create_pair_match_card_manual(
            deck_id=deck["id"],
            front_text="X",
            pairs=pairs,
        )
        assert len(card["back"]["payload"]["pairs"]) == 2

    def test_dedup_prevents_duplicate_card(self, svc, deck):
        svc.create_pair_match_card_manual(
            deck_id=deck["id"],
            front_text="Инструкция",
            pairs=VALID_PAIRS,
        )
        with pytest.raises(ValueError, match="duplicate_card"):
            svc.create_pair_match_card_manual(
                deck_id=deck["id"],
                front_text="Инструкция",
                pairs=VALID_PAIRS,
            )

    def test_card_persisted_in_deck(self, svc, deck):
        svc.create_pair_match_card_manual(
            deck_id=deck["id"],
            front_text="Test persist",
            pairs=VALID_PAIRS,
        )
        refreshed = svc.get_deck(deck["id"])
        assert len(refreshed["cards"]) == 1
        assert refreshed["cards"][0]["card_type"] == "pair_match"

    def test_nonexistent_deck_raises(self, svc):
        with pytest.raises(LookupError):
            svc.create_pair_match_card_manual(
                deck_id="nonexistent",
                front_text="X",
                pairs=VALID_PAIRS,
            )


# ── update_pair_match_card ─────────────────────────────────────────


class TestUpdatePairMatchCard:
    def _make_card(self, svc, deck):
        return svc.create_pair_match_card_manual(
            deck_id=deck["id"],
            front_text="Original instruction",
            pairs=VALID_PAIRS,
            tags=["orig"],
            difficulty_hint="medium",
        )

    def test_update_front_text(self, svc, deck):
        card = self._make_card(svc, deck)
        updated = svc.update_pair_match_card(
            deck_id=deck["id"],
            card_id=card["id"],
            front_text="New instruction",
        )
        assert updated["front"]["text"] == "New instruction"

    def test_update_pairs(self, svc, deck):
        card = self._make_card(svc, deck)
        new_pairs = [
            {"left": "Alpha", "right": "Omega"},
            {"left": "Beta", "right": "Gamma"},
            {"left": "Delta", "right": "Epsilon"},
        ]
        updated = svc.update_pair_match_card(
            deck_id=deck["id"],
            card_id=card["id"],
            pairs=new_pairs,
        )
        assert len(updated["front"]["payload"]["left_items"]) == 3
        assert len(updated["back"]["payload"]["pairs"]) == 3
        # Verify the IDs match
        assert updated["back"]["payload"]["pairs"][2]["left_id"] == "l3"

    def test_update_tags_and_difficulty(self, svc, deck):
        card = self._make_card(svc, deck)
        updated = svc.update_pair_match_card(
            deck_id=deck["id"],
            card_id=card["id"],
            tags=["new_tag"],
            difficulty_hint="high",
        )
        assert updated["tags"] == ["new_tag"]
        assert updated["difficulty_hint"] == "high"

    def test_update_status(self, svc, deck):
        card = self._make_card(svc, deck)
        updated = svc.update_pair_match_card(
            deck_id=deck["id"],
            card_id=card["id"],
            status="archived",
        )
        assert updated["status"] == "archived"

    def test_update_empty_front_raises(self, svc, deck):
        card = self._make_card(svc, deck)
        with pytest.raises(ValueError, match="front_text_required"):
            svc.update_pair_match_card(
                deck_id=deck["id"],
                card_id=card["id"],
                front_text="",
            )

    def test_update_invalid_pairs_raises(self, svc, deck):
        card = self._make_card(svc, deck)
        with pytest.raises(ValueError, match="pair_match_min_2_pairs"):
            svc.update_pair_match_card(
                deck_id=deck["id"],
                card_id=card["id"],
                pairs=[{"left": "A", "right": "B"}],
            )

    def test_update_nonexistent_card_raises(self, svc, deck):
        with pytest.raises(LookupError, match="card_not_found"):
            svc.update_pair_match_card(
                deck_id=deck["id"],
                card_id="nonexistent",
                front_text="X",
            )

    def test_update_fact_recall_card_raises(self, svc, deck):
        fr_card = svc.create_card_manual(
            deck_id=deck["id"],
            front_text="Q",
            back_text="A",
        )
        with pytest.raises(ValueError, match="not_pair_match_card"):
            svc.update_pair_match_card(
                deck_id=deck["id"],
                card_id=fr_card["id"],
                front_text="X",
            )

    def test_update_sets_updated_at(self, svc, deck):
        card = self._make_card(svc, deck)
        updated = svc.update_pair_match_card(
            deck_id=deck["id"],
            card_id=card["id"],
            front_text="Changed",
        )
        assert "updated_at" in updated.get("meta", {})

    def test_dedup_on_update(self, svc, deck):
        self._make_card(svc, deck)
        card2 = svc.create_pair_match_card_manual(
            deck_id=deck["id"],
            front_text="Different instruction",
            pairs=[{"left": "X", "right": "Y"}, {"left": "Z", "right": "W"}],
        )
        # Try to update card2 to match card1
        with pytest.raises(ValueError, match="duplicate_card"):
            svc.update_pair_match_card(
                deck_id=deck["id"],
                card_id=card2["id"],
                front_text="Original instruction",
            )


# ── _validate_pair_match_pairs ─────────────────────────────────────


class TestValidatePairMatchPairs:
    def test_valid_pairs(self):
        result = MicrocardsService._validate_pair_match_pairs(VALID_PAIRS)
        assert len(result) == 2

    def test_strips_whitespace(self):
        pairs = [{"left": "  A  ", "right": " B "}, {"left": "C", "right": "D"}]
        result = MicrocardsService._validate_pair_match_pairs(pairs)
        assert result[0]["left"] == "A"
        assert result[0]["right"] == "B"

    def test_filters_empty(self):
        pairs = [{"left": "A", "right": "B"}, {"left": "", "right": ""}, {"left": "C", "right": "D"}]
        result = MicrocardsService._validate_pair_match_pairs(pairs)
        assert len(result) == 2

    def test_not_list_raises(self):
        with pytest.raises(ValueError, match="pairs_required"):
            MicrocardsService._validate_pair_match_pairs("not a list")

    def test_non_dict_items_skipped(self):
        pairs = [{"left": "A", "right": "B"}, "bad", {"left": "C", "right": "D"}]
        result = MicrocardsService._validate_pair_match_pairs(pairs)
        assert len(result) == 2


# ── import pair_match from parser ──────────────────────────────────


class TestImportPairMatch:
    PAIR_MATCH_TEXT = """@PAIR_MATCH
@ deck: PM Deck
@ tags: test
# Сопоставьте
L: Систола
L: Диастола
R: Фаза сокращения
R: Фаза расслабления
P: Систола => Фаза сокращения
P: Диастола => Фаза расслабления
"""

    MIXED_TEXT = """@MICROCARD
# Вопрос 1
= Ответ 1

@PAIR_MATCH
# Сопоставьте термин и определение
P: A => X
P: B => Y

@MICROCARD
# Вопрос 2
= Ответ 2
"""

    def test_import_pair_match_create_deck(self, svc):
        parser = MicrocardParser()
        parsed = parser.parse_text(self.PAIR_MATCH_TEXT)
        assert parsed["ok"] is True

        result = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="create_deck",
            deck_name="PM Import Deck",
        )
        assert result["added_cards"] == 1
        card = result["deck"]["cards"][0]
        assert card["card_type"] == "pair_match"
        assert card["created_by"] == "text_import"
        assert card["front"]["text"] == "Сопоставьте"
        assert len(card["back"]["payload"]["pairs"]) == 2
        assert card["tags"] == ["test"]

    def test_import_mixed_cards(self, svc):
        parser = MicrocardParser()
        parsed = parser.parse_text(self.MIXED_TEXT)

        result = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="create_deck",
            deck_name="Mixed Deck",
        )
        assert result["added_cards"] == 3
        types = [c["card_type"] for c in result["deck"]["cards"]]
        assert types.count("fact_recall") == 2
        assert types.count("pair_match") == 1

    def test_import_pair_match_dedup(self, svc):
        parser = MicrocardParser()
        parsed = parser.parse_text(self.PAIR_MATCH_TEXT)

        r1 = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="create_deck",
            deck_name="Dedup PM",
        )
        deck_id = r1["deck"]["id"]

        r2 = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="append_to_deck",
            target_deck_id=deck_id,
        )
        assert r2["added_cards"] == 0
        assert r2["skipped_duplicates"] == 1

    def test_import_error_pair_match_skipped(self, svc):
        text = """@PAIR_MATCH
# Only one pair
P: A => B"""
        parser = MicrocardParser()
        parsed = parser.parse_text(text)

        result = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="create_deck",
        )
        assert result["added_cards"] == 0
        assert result["skipped_errors"] == 1
