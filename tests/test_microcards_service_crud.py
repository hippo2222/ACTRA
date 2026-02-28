"""
Unit tests for MicrocardsService — T4 coverage plan.

Covers remaining CRUD, deck lifecycle, SM2 scheduler, scoring,
sessions, due queue, submit_review, import, and pure helpers.
"""

import sys
import os
import json
import pytest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.microcards_service import (
    MicrocardsService,
    score_pair_match_response,
    apply_sm2_mvp_rating,
    _s,
    _int_list,
    _str_list,
    _utc_now,
    _utc_now_iso,
    _parse_iso,
    _read_json,
    _write_json,
)


# ─── Fixtures ──────────────────────────────────────────────────────


@pytest.fixture
def svc(tmp_path):
    return MicrocardsService(str(tmp_path), user_id="test_user")


@pytest.fixture
def deck(svc):
    """Create a manual deck and return it."""
    return svc.create_deck_manual(name="Test Deck")


# ═══════════════════════════════════════════════════════════════════
# Pure helpers
# ═══════════════════════════════════════════════════════════════════


class TestHelperS:
    def test_normal(self):
        assert _s("hello") == "hello"

    def test_none(self):
        assert _s(None) == ""

    def test_default(self):
        assert _s(None, "fallback") == "fallback"

    def test_strips(self):
        assert _s("  hi  ") == "hi"

    def test_int(self):
        assert _s(42) == "42"


class TestIntList:
    def test_normal(self):
        assert _int_list([1, 2, 3]) == [1, 2, 3]

    def test_dedup(self):
        assert _int_list([1, 1, 2]) == [1, 2]

    def test_not_list(self):
        assert _int_list("bad") == []

    def test_non_int(self):
        assert _int_list(["a", 1]) == [1]

    def test_limit(self):
        assert len(_int_list(list(range(100)), limit=5)) == 5


class TestStrList:
    def test_normal(self):
        assert _str_list(["a", "b"]) == ["a", "b"]

    def test_dedup(self):
        assert _str_list(["a", "a", "b"]) == ["a", "b"]

    def test_not_list(self):
        assert _str_list(42) == []

    def test_empty_skipped(self):
        assert _str_list(["", "a"]) == ["a"]

    def test_limit(self):
        assert len(_str_list([f"x{i}" for i in range(100)], limit=3)) == 3


class TestUtcHelpers:
    def test_utc_now_returns_datetime(self):
        assert isinstance(_utc_now(), datetime)

    def test_utc_now_iso_returns_string(self):
        iso = _utc_now_iso()
        assert isinstance(iso, str)
        assert "T" in iso

    def test_parse_iso_valid(self):
        dt = _parse_iso("2024-01-15T10:00:00")
        assert dt is not None
        assert dt.year == 2024

    def test_parse_iso_none(self):
        assert _parse_iso(None) is None

    def test_parse_iso_invalid(self):
        assert _parse_iso("not-a-date") is None


class TestReadWriteJson:
    def test_round_trip(self, tmp_path):
        p = tmp_path / "test.json"
        _write_json(p, {"key": "value"})
        assert _read_json(p, {}) == {"key": "value"}

    def test_read_missing(self, tmp_path):
        assert _read_json(tmp_path / "nope.json", []) == []

    def test_write_creates_dirs(self, tmp_path):
        p = tmp_path / "sub" / "deep" / "file.json"
        _write_json(p, {"a": 1})
        assert _read_json(p, {}) == {"a": 1}


# ═══════════════════════════════════════════════════════════════════
# score_pair_match_response
# ═══════════════════════════════════════════════════════════════════


class TestScorePairMatch:
    def _card(self, pairs):
        return {
            "back": {
                "payload": {
                    "pairs": [{"left_id": p[0], "right_id": p[1]} for p in pairs]
                }
            }
        }

    def test_perfect(self):
        card = self._card([("l1", "r1"), ("l2", "r2")])
        resp = {"pairs": [{"left_id": "l1", "right_id": "r1"}, {"left_id": "l2", "right_id": "r2"}]}
        result = score_pair_match_response(card, resp)
        assert result["is_perfect"] is True
        assert result["partial_score"] == 100.0
        assert result["correct_pairs"] == 2

    def test_partial(self):
        card = self._card([("l1", "r1"), ("l2", "r2")])
        resp = {"pairs": [{"left_id": "l1", "right_id": "r1"}, {"left_id": "l2", "right_id": "r1"}]}
        result = score_pair_match_response(card, resp)
        assert result["is_perfect"] is False
        assert result["correct_pairs"] == 1
        assert result["partial_score"] == 50.0

    def test_empty_card(self):
        result = score_pair_match_response({}, {})
        assert result["total_pairs"] == 0

    def test_mapping_format(self):
        card = self._card([("l1", "r1")])
        resp = {"mapping": {"l1": "r1"}}
        result = score_pair_match_response(card, resp)
        assert result["is_perfect"] is True


# ═══════════════════════════════════════════════════════════════════
# apply_sm2_mvp_rating
# ═══════════════════════════════════════════════════════════════════


class TestSM2Rating:
    def test_new_good(self):
        state = apply_sm2_mvp_rating(None, "good")
        assert state["status"] == "review"
        assert state["repetitions"] == 1
        assert state["interval_days"] >= 1

    def test_new_easy(self):
        state = apply_sm2_mvp_rating(None, "easy")
        assert state["status"] == "review"
        assert state["interval_days"] >= 3

    def test_new_hard(self):
        state = apply_sm2_mvp_rating(None, "hard")
        assert state["status"] == "review"
        assert state["ease"] < 2.5

    def test_again_resets(self):
        prev = {"status": "review", "ease": 2.5, "interval_days": 5, "repetitions": 3, "lapses": 0}
        state = apply_sm2_mvp_rating(prev, "again")
        assert state["status"] == "relearning"
        assert state["repetitions"] == 0
        assert state["lapses"] == 1
        assert state["interval_days"] == 0

    def test_review_good_grows_interval(self):
        prev = {"status": "review", "ease": 2.5, "interval_days": 3, "repetitions": 2, "lapses": 0}
        state = apply_sm2_mvp_rating(prev, "good")
        assert state["interval_days"] > 3

    def test_review_easy_grows_faster(self):
        prev = {"status": "review", "ease": 2.5, "interval_days": 3, "repetitions": 2, "lapses": 0}
        state_good = apply_sm2_mvp_rating(prev, "good")
        state_easy = apply_sm2_mvp_rating(prev, "easy")
        assert state_easy["interval_days"] >= state_good["interval_days"]

    def test_stability_hint(self):
        state1 = apply_sm2_mvp_rating(None, "hard")
        assert state1["stability_hint"] == "low"
        prev = {"status": "review", "ease": 2.5, "interval_days": 10, "repetitions": 5, "lapses": 0}
        state2 = apply_sm2_mvp_rating(prev, "good")
        assert state2["stability_hint"] == "high"

    def test_invalid_rating_defaults_good(self):
        state = apply_sm2_mvp_rating(None, "invalid_rating")
        assert state["last_rating"] == "good"

    def test_due_at_present(self):
        state = apply_sm2_mvp_rating(None, "good")
        assert "due_at" in state
        assert state["due_at"].endswith("Z")

    def test_schema_version(self):
        state = apply_sm2_mvp_rating(None, "good")
        assert state["schema_version"] == "1.0"


# ═══════════════════════════════════════════════════════════════════
# Deck lifecycle
# ═══════════════════════════════════════════════════════════════════


class TestDeckLifecycle:
    def test_create_deck(self, svc):
        deck = svc.create_deck_manual(name="My Deck", tags=["tag1"])
        assert deck["name"] == "My Deck"
        assert deck["id"].startswith("deck_")
        assert deck["tags"] == ["tag1"]

    def test_get_deck(self, svc, deck):
        loaded = svc.get_deck(deck["id"])
        assert loaded is not None
        assert loaded["id"] == deck["id"]

    def test_get_deck_not_found(self, svc):
        assert svc.get_deck("nonexistent") is None

    def test_rename_deck(self, svc, deck):
        renamed = svc.rename_deck(deck["id"], "New Name")
        assert renamed["name"] == "New Name"
        loaded = svc.get_deck(deck["id"])
        assert loaded["name"] == "New Name"

    def test_rename_deck_not_found(self, svc):
        with pytest.raises(LookupError):
            svc.rename_deck("bad_id", "Name")

    def test_archive_deck(self, svc, deck):
        archived = svc.archive_deck(deck["id"])
        assert archived["meta"]["archived"] is True
        unarchived = svc.archive_deck(deck["id"], archive=False)
        assert unarchived["meta"]["archived"] is False

    def test_delete_deck(self, svc, deck):
        assert svc.delete_deck(deck["id"]) is True
        assert svc.get_deck(deck["id"]) is None

    def test_delete_deck_not_found(self, svc):
        assert svc.delete_deck("nonexistent") is False

    def test_list_decks(self, svc):
        svc.create_deck_manual(name="Deck A")
        svc.create_deck_manual(name="Deck B")
        decks = svc.list_decks()
        assert len(decks) >= 2


# ═══════════════════════════════════════════════════════════════════
# Card CRUD (fact_recall)
# ═══════════════════════════════════════════════════════════════════


class TestCardCRUD:
    def test_create_card(self, svc, deck):
        card = svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")
        assert card["card_type"] == "fact_recall"
        assert card["front"]["text"] == "Q"

    def test_create_card_empty_front(self, svc, deck):
        with pytest.raises(ValueError, match="front_text_required"):
            svc.create_card_manual(deck_id=deck["id"], front_text="", back_text="A")

    def test_create_card_empty_back(self, svc, deck):
        with pytest.raises(ValueError, match="back_text_required"):
            svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="")

    def test_create_duplicate_card(self, svc, deck):
        svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")
        with pytest.raises(ValueError, match="duplicate_card"):
            svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")

    def test_update_card(self, svc, deck):
        card = svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")
        updated = svc.update_card(deck_id=deck["id"], card_id=card["id"], front_text="Q2")
        assert updated["front"]["text"] == "Q2"

    def test_update_card_status(self, svc, deck):
        card = svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")
        updated = svc.update_card(deck_id=deck["id"], card_id=card["id"], status="archived")
        assert updated["status"] == "archived"

    def test_update_card_not_found(self, svc, deck):
        with pytest.raises(LookupError):
            svc.update_card(deck_id=deck["id"], card_id="bad", front_text="X")

    def test_delete_card(self, svc, deck):
        card = svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")
        assert svc.delete_card(deck["id"], card["id"]) is True
        assert svc.get_card(deck["id"], card["id"]) is None

    def test_delete_card_not_found(self, svc, deck):
        with pytest.raises(LookupError):
            svc.delete_card(deck["id"], "bad_id")

    def test_get_card(self, svc, deck):
        card = svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")
        loaded = svc.get_card(deck["id"], card["id"])
        assert loaded is not None
        assert loaded["id"] == card["id"]

    def test_get_card_deck_not_found(self, svc):
        assert svc.get_card("bad", "bad") is None

    def test_reorder_cards(self, svc, deck):
        c1 = svc.create_card_manual(deck_id=deck["id"], front_text="Q1", back_text="A1")
        c2 = svc.create_card_manual(deck_id=deck["id"], front_text="Q2", back_text="A2")
        reordered = svc.reorder_cards(deck["id"], [c2["id"], c1["id"]])
        ids = [c["id"] for c in reordered["cards"]]
        assert ids == [c2["id"], c1["id"]]


# ═══════════════════════════════════════════════════════════════════
# Sessions & due queue
# ═══════════════════════════════════════════════════════════════════


class TestDueQueue:
    def test_empty_deck(self, svc, deck):
        result = svc.get_due_queue(deck["id"])
        assert result["queue_count"] == 0
        assert result["current_card"] is None

    def test_due_cards_returned(self, svc, deck):
        svc.create_card_manual(deck_id=deck["id"], front_text="Q1", back_text="A1")
        svc.create_card_manual(deck_id=deck["id"], front_text="Q2", back_text="A2")
        result = svc.get_due_queue(deck["id"])
        assert result["queue_count"] == 2
        assert result["current_card"] is not None

    def test_deck_not_found(self, svc):
        with pytest.raises(LookupError):
            svc.get_due_queue("bad_id")

    def test_session_created(self, svc, deck):
        svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")
        result = svc.get_due_queue(deck["id"])
        assert "session" in result
        assert result["session"]["id"].startswith("mcsess_")

    def test_resume_session(self, svc, deck):
        svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")
        r1 = svc.get_due_queue(deck["id"])
        r2 = svc.get_due_queue(deck["id"])  # resume=True by default
        assert r2["session"]["id"] == r1["session"]["id"]

    def test_restart_creates_new_session(self, svc, deck):
        svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")
        r1 = svc.get_due_queue(deck["id"])
        r2 = svc.get_due_queue(deck["id"], restart=True)
        assert r2["session"]["id"] != r1["session"]["id"]


# ═══════════════════════════════════════════════════════════════════
# submit_review
# ═══════════════════════════════════════════════════════════════════


class TestSubmitReview:
    def test_basic_review(self, svc, deck):
        card = svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")
        result = svc.submit_review(deck_id=deck["id"], card_id=card["id"], rating="good")
        assert result["review_state"]["status"] == "review"
        assert result["review_event"]["rating"] == "good"
        assert result["review_event"]["was_correct"] is True

    def test_again_review(self, svc, deck):
        card = svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")
        result = svc.submit_review(deck_id=deck["id"], card_id=card["id"], rating="again")
        assert result["review_event"]["was_correct"] is False

    def test_review_with_session(self, svc, deck):
        svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")
        queue = svc.get_due_queue(deck["id"])
        session = queue["session"]
        card = queue["current_card"]
        result = svc.submit_review(
            deck_id=deck["id"],
            card_id=card["id"],
            rating="good",
            session_id=session["id"],
        )
        assert result["session"]["cursor"] == 1

    def test_deck_not_found(self, svc):
        with pytest.raises(LookupError):
            svc.submit_review(deck_id="bad", card_id="bad", rating="good")

    def test_card_not_found(self, svc, deck):
        with pytest.raises(LookupError):
            svc.submit_review(deck_id=deck["id"], card_id="bad", rating="good")

    def test_invalid_rating_defaults(self, svc, deck):
        card = svc.create_card_manual(deck_id=deck["id"], front_text="Q", back_text="A")
        result = svc.submit_review(deck_id=deck["id"], card_id=card["id"], rating="xyz")
        assert result["review_event"]["rating"] == "good"


# ═══════════════════════════════════════════════════════════════════
# import_cards_from_parsed
# ═══════════════════════════════════════════════════════════════════


class TestImportCards:
    def _fact_recall_item(self, front="Q", back="A"):
        return {
            "status": "ok",
            "card_preview": {"card_type": "fact_recall", "front": front, "back": back},
            "metadata": {"tags": ["imported"], "difficulty": "medium"},
        }

    def _pair_match_item(self, front="Match items", pairs=None):
        if pairs is None:
            pairs = [{"left": "A", "right": "1"}, {"left": "B", "right": "2"}]
        return {
            "status": "ok",
            "card_preview": {"card_type": "pair_match", "front": front, "pairs": pairs},
            "metadata": {"tags": [], "difficulty": "hard"},
        }

    def test_create_deck_mode(self, svc):
        result = svc.import_cards_from_parsed(
            parsed_items=[self._fact_recall_item("Q1", "A1"), self._fact_recall_item("Q2", "A2")],
            mode="create_deck",
            deck_name="Imported",
        )
        assert result["added_cards"] == 2
        assert result["deck"]["name"] == "Imported"

    def test_append_mode(self, svc, deck):
        result = svc.import_cards_from_parsed(
            parsed_items=[self._fact_recall_item()],
            mode="append_to_deck",
            target_deck_id=deck["id"],
        )
        assert result["added_cards"] == 1
        loaded = svc.get_deck(deck["id"])
        assert len(loaded["cards"]) == 1

    def test_duplicate_skipped(self, svc):
        result = svc.import_cards_from_parsed(
            parsed_items=[self._fact_recall_item("Q", "A"), self._fact_recall_item("Q", "A")],
            mode="create_deck",
        )
        assert result["added_cards"] == 1
        assert result["skipped_duplicates"] == 1

    def test_error_items_skipped(self, svc):
        result = svc.import_cards_from_parsed(
            parsed_items=[{"status": "error"}, self._fact_recall_item()],
            mode="create_deck",
        )
        assert result["added_cards"] == 1
        assert result["skipped_errors"] == 1

    def test_pair_match_import(self, svc):
        result = svc.import_cards_from_parsed(
            parsed_items=[self._pair_match_item()],
            mode="create_deck",
        )
        assert result["added_cards"] == 1
        card = result["deck"]["cards"][0]
        assert card["card_type"] == "pair_match"

    def test_invalid_mode(self, svc):
        with pytest.raises(ValueError, match="invalid_mode"):
            svc.import_cards_from_parsed(parsed_items=[], mode="bad_mode")

    def test_append_no_deck_id(self, svc):
        with pytest.raises(ValueError, match="target_deck_id_required"):
            svc.import_cards_from_parsed(parsed_items=[], mode="append_to_deck")

    def test_append_deck_not_found(self, svc):
        with pytest.raises(LookupError):
            svc.import_cards_from_parsed(
                parsed_items=[],
                mode="append_to_deck",
                target_deck_id="nonexistent",
            )

    def test_default_deck_name(self, svc):
        result = svc.import_cards_from_parsed(
            parsed_items=[self._fact_recall_item()],
            mode="create_deck",
        )
        assert result["deck"]["name"] == "Импорт микрокарточек"

    def test_deck_name_from_metadata(self, svc):
        item = self._fact_recall_item()
        item["metadata"]["deck"] = "Custom Name"
        result = svc.import_cards_from_parsed(
            parsed_items=[item],
            mode="create_deck",
        )
        assert result["deck"]["name"] == "Custom Name"


# ═══════════════════════════════════════════════════════════════════
# _card_signature and _deck_user_stats
# ═══════════════════════════════════════════════════════════════════


class TestCardSignature:
    def test_same_content_same_sig(self, svc):
        c1 = {"card_type": "fact_recall", "front": {"text": "Q"}, "back": {"text": "A"}}
        c2 = {"card_type": "fact_recall", "front": {"text": "Q"}, "back": {"text": "A"}}
        assert svc._card_signature(c1) == svc._card_signature(c2)

    def test_different_content_different_sig(self, svc):
        c1 = {"card_type": "fact_recall", "front": {"text": "Q1"}, "back": {"text": "A"}}
        c2 = {"card_type": "fact_recall", "front": {"text": "Q2"}, "back": {"text": "A"}}
        assert svc._card_signature(c1) != svc._card_signature(c2)


class TestDeckUserStats:
    def test_empty_deck(self, svc):
        deck = {"cards": []}
        stats = svc._deck_user_stats(deck, {})
        assert stats["cards_total"] == 0

    def test_new_cards(self, svc):
        deck = {"cards": [{"id": "c1", "status": "active"}, {"id": "c2", "status": "active"}]}
        stats = svc._deck_user_stats(deck, {})
        assert stats["cards_total"] == 2
        assert stats["cards_new"] == 2
        assert stats["cards_due"] == 2

    def test_archived_excluded(self, svc):
        deck = {"cards": [{"id": "c1", "status": "archived"}]}
        stats = svc._deck_user_stats(deck, {})
        assert stats["cards_total"] == 0


# ═══════════════════════════════════════════════════════════════════
# switch_user
# ═══════════════════════════════════════════════════════════════════


class TestSwitchUser:
    def test_switch(self, svc):
        svc.switch_user("new_user")
        assert svc.user_id == "new_user"

    def test_default_on_empty(self, svc):
        svc.switch_user("")
        assert svc.user_id == "default_user"
