"""Integration tests for M12 microcards text import service methods."""

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
    d = tempfile.mkdtemp(prefix="test_mc_import_")
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def svc(tmp_data_dir):
    return MicrocardsService(data_dir=tmp_data_dir, user_id="test_user")


SAMPLE_TEXT = """@MICROCARD
@ deck: Кардиология / Базовые
@ tags: кардиология, ритм
@ difficulty: 1
# Что такое синусовый ритм?
= Ритм сердца, при котором импульсы исходят из синусового узла.

@MICROCARD
@ tags: кардиология
@ difficulty: 2
# Какова нормальная ЧСС у взрослого в покое?
= 60–100 ударов в минуту.

@MICROCARD
# Вопрос без метаданных
= Ответ без метаданных
"""


class TestImportCreateDeck:
    def test_parse_and_create_deck(self, svc):
        parser = MicrocardParser()
        parsed = parser.parse_text(SAMPLE_TEXT)
        assert parsed["ok"] is True
        assert parsed["summary"]["valid"] == 3

        result = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="create_deck",
            deck_name="Test Import Deck",
        )
        assert result["added_cards"] == 3
        assert result["skipped_duplicates"] == 0
        assert result["skipped_errors"] == 0

        deck = result["deck"]
        assert deck["name"] == "Test Import Deck"
        assert len(deck["cards"]) == 3

        # Verify card structure
        card = deck["cards"][0]
        assert card["card_type"] == "fact_recall"
        assert card["created_by"] == "text_import"
        assert card["front"]["text"] == "Что такое синусовый ритм?"
        assert card["back"]["text"] == "Ритм сердца, при котором импульсы исходят из синусового узла."
        assert card["tags"] == ["кардиология", "ритм"]
        assert card["difficulty_hint"] == "low"
        assert card["status"] == "active"

    def test_create_deck_name_from_metadata(self, svc):
        parser = MicrocardParser()
        parsed = parser.parse_text(SAMPLE_TEXT)

        result = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="create_deck",
        )
        # Should use deck name from first item's metadata
        assert result["deck"]["name"] == "Кардиология / Базовые"

    def test_create_deck_default_name(self, svc):
        text = "@MICROCARD\n# Q\n= A"
        parser = MicrocardParser()
        parsed = parser.parse_text(text)

        result = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="create_deck",
        )
        assert result["deck"]["name"] == "Импорт микрокарточек"

    def test_deck_meta_source_is_text_import(self, svc):
        parser = MicrocardParser()
        parsed = parser.parse_text(SAMPLE_TEXT)

        result = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="create_deck",
        )
        assert result["deck"]["meta"]["source"] == "text_import"
        assert "import_history" in result["deck"]["meta"]
        assert len(result["deck"]["meta"]["import_history"]) == 1


class TestImportAppendToDeck:
    def test_append_to_existing_deck(self, svc):
        # Create a deck first
        deck = svc.create_deck_manual(name="Existing Deck")
        svc.create_card_manual(
            deck_id=deck["id"],
            front_text="Existing Q",
            back_text="Existing A",
        )

        parser = MicrocardParser()
        parsed = parser.parse_text(SAMPLE_TEXT)

        result = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="append_to_deck",
            target_deck_id=deck["id"],
        )
        assert result["added_cards"] == 3
        assert len(result["deck"]["cards"]) == 4  # 1 existing + 3 new

    def test_append_dedup_skips_duplicates(self, svc):
        parser = MicrocardParser()
        parsed = parser.parse_text(SAMPLE_TEXT)

        # First import
        r1 = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="create_deck",
            deck_name="Dedup Test",
        )
        deck_id = r1["deck"]["id"]

        # Second import to same deck — should skip all as duplicates
        r2 = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="append_to_deck",
            target_deck_id=deck_id,
        )
        assert r2["added_cards"] == 0
        assert r2["skipped_duplicates"] == 3

    def test_append_to_nonexistent_deck_raises(self, svc):
        parser = MicrocardParser()
        parsed = parser.parse_text(SAMPLE_TEXT)

        with pytest.raises(LookupError, match="deck_not_found"):
            svc.import_cards_from_parsed(
                parsed_items=parsed["items"],
                mode="append_to_deck",
                target_deck_id="nonexistent",
            )


class TestImportErrorHandling:
    def test_error_items_skipped(self, svc):
        text = """@MICROCARD
# Хороший вопрос
= Хороший ответ

@MICROCARD
= Нет вопроса"""
        parser = MicrocardParser()
        parsed = parser.parse_text(text)

        result = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="create_deck",
        )
        assert result["added_cards"] == 1
        assert result["skipped_errors"] == 1

    def test_invalid_mode_raises(self, svc):
        with pytest.raises(ValueError, match="invalid_mode"):
            svc.import_cards_from_parsed(
                parsed_items=[],
                mode="bad_mode",
            )

    def test_append_without_deck_id_raises(self, svc):
        with pytest.raises(ValueError, match="target_deck_id_required"):
            svc.import_cards_from_parsed(
                parsed_items=[{"status": "valid", "card_preview": {"front": "Q", "back": "A"}, "metadata": {}}],
                mode="append_to_deck",
            )


class TestImportIdempotency:
    def test_import_history_tracked(self, svc):
        parser = MicrocardParser()
        parsed = parser.parse_text(SAMPLE_TEXT)

        r1 = svc.import_cards_from_parsed(
            parsed_items=parsed["items"],
            mode="create_deck",
        )
        deck_id = r1["deck"]["id"]

        # Second import to same deck
        new_text = "@MICROCARD\n# New Q\n= New A"
        parsed2 = parser.parse_text(new_text)
        r2 = svc.import_cards_from_parsed(
            parsed_items=parsed2["items"],
            mode="append_to_deck",
            target_deck_id=deck_id,
        )

        history = r2["deck"]["meta"]["import_history"]
        assert len(history) == 2
        assert history[0]["mode"] == "create_deck"
        assert history[1]["mode"] == "append_to_deck"
