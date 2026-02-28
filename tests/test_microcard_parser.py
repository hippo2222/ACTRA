"""Unit tests for MicrocardParser (M12)."""

import sys
import os
import pytest

# Ensure project root is on sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from task_system.models.parsers.microcard_parser import MicrocardParser


class TestMicrocardParserBasic:
    """Basic parsing tests."""

    def test_empty_text_returns_zero_items(self):
        parser = MicrocardParser()
        result = parser.parse_text("")
        assert result["ok"] is True
        assert result["summary"]["total"] == 0
        assert result["items"] == []

    def test_none_text_returns_zero_items(self):
        parser = MicrocardParser()
        result = parser.parse_text(None)
        assert result["ok"] is True
        assert result["summary"]["total"] == 0

    def test_single_valid_card(self):
        text = """@MICROCARD
# Что такое синусовый ритм?
= Ритм сердца, при котором импульсы исходят из синусового узла."""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["ok"] is True
        assert result["summary"]["total"] == 1
        assert result["summary"]["valid"] == 1
        assert result["summary"]["errors"] == 0
        item = result["items"][0]
        assert item["status"] == "valid"
        assert item["card_preview"]["front"] == "Что такое синусовый ритм?"
        assert item["card_preview"]["back"] == "Ритм сердца, при котором импульсы исходят из синусового узла."
        assert item["card_preview"]["card_type"] == "fact_recall"

    def test_multiple_cards(self):
        text = """@MICROCARD
# Вопрос 1
= Ответ 1

@MICROCARD
# Вопрос 2
= Ответ 2

@MICROCARD
# Вопрос 3
= Ответ 3"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["summary"]["total"] == 3
        assert result["summary"]["valid"] == 3
        for i, item in enumerate(result["items"]):
            assert item["card_preview"]["front"] == f"Вопрос {i + 1}"
            assert item["card_preview"]["back"] == f"Ответ {i + 1}"


class TestMicrocardParserMetadata:
    """Metadata parsing tests."""

    def test_tags_parsed(self):
        text = """@MICROCARD
@ tags: кардиология, ритм, ЭКГ
# Вопрос
= Ответ"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        item = result["items"][0]
        assert item["metadata"]["tags"] == ["кардиология", "ритм", "ЭКГ"]

    def test_difficulty_numeric(self):
        text = """@MICROCARD
@ difficulty: 3
# Вопрос
= Ответ"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["items"][0]["metadata"]["difficulty"] == "high"

    def test_difficulty_text(self):
        text = """@MICROCARD
@ difficulty: low
# Вопрос
= Ответ"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["items"][0]["metadata"]["difficulty"] == "low"

    def test_deck_metadata(self):
        text = """@MICROCARD
@ deck: Кардиология / Базовые
# Вопрос
= Ответ"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["items"][0]["metadata"]["deck"] == "Кардиология / Базовые"

    def test_duplicate_metadata_key_last_write_wins(self):
        text = """@MICROCARD
@ tags: tag1
@ tags: tag2, tag3
# Вопрос
= Ответ"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        item = result["items"][0]
        assert item["metadata"]["tags"] == ["tag2", "tag3"]
        # Should have a warning about duplicate key
        has_dup_warning = any(
            i.get("code") == "duplicate_metadata_key"
            for i in item["validation_issues"]
        )
        assert has_dup_warning

    def test_metadata_no_inheritance_between_blocks(self):
        text = """@MICROCARD
@ tags: блок1
@ deck: Колода А
# Вопрос 1
= Ответ 1

@MICROCARD
# Вопрос 2
= Ответ 2"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["items"][0]["metadata"]["tags"] == ["блок1"]
        assert result["items"][0]["metadata"]["deck"] == "Колода А"
        assert result["items"][1]["metadata"]["tags"] == []
        assert result["items"][1]["metadata"]["deck"] is None


class TestMicrocardParserValidation:
    """Validation and error handling tests."""

    def test_missing_front_is_error(self):
        text = """@MICROCARD
= Только ответ"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["summary"]["errors"] == 1
        assert result["items"][0]["status"] == "error"

    def test_missing_back_is_error(self):
        text = """@MICROCARD
# Только вопрос"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["summary"]["errors"] == 1
        assert result["items"][0]["status"] == "error"

    def test_short_front_is_warning(self):
        text = """@MICROCARD
# AB
= Нормальный ответ"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["items"][0]["status"] == "warning"
        has_short_warning = any(
            i.get("code") == "front_too_short"
            for i in result["items"][0]["validation_issues"]
        )
        assert has_short_warning

    def test_html_sanitized(self):
        text = """@MICROCARD
# Вопрос <script>alert(1)</script> текст
= Ответ <b>bold</b>"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        item = result["items"][0]
        assert "<script>" not in item["card_preview"]["front"]
        assert "<b>" not in item["card_preview"]["back"]
        assert "alert(1)" in item["card_preview"]["front"]  # text preserved
        assert "bold" in item["card_preview"]["back"]

    def test_comments_ignored(self):
        text = """@MICROCARD
// Это комментарий
# Вопрос
// Ещё комментарий
= Ответ"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["summary"]["valid"] == 1
        assert result["items"][0]["card_preview"]["front"] == "Вопрос"

    def test_empty_lines_ignored(self):
        text = """@MICROCARD

# Вопрос

= Ответ
"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["summary"]["valid"] == 1


class TestMicrocardParserPairMatch:
    """@PAIR_MATCH parsing tests (M15 / M12 v1.1)."""

    def test_pair_match_mixed_with_microcard(self):
        text = """@MICROCARD
# Вопрос 1
= Ответ 1

@PAIR_MATCH
# Сопоставьте термин и определение
L: Систола
L: Диастола
R: Фаза сокращения миокарда
R: Фаза расслабления миокарда
P: Систола => Фаза сокращения миокарда
P: Диастола => Фаза расслабления миокарда

@MICROCARD
# Вопрос 2
= Ответ 2"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["summary"]["total"] == 3
        assert result["items"][0]["card_preview"]["card_type"] == "fact_recall"
        assert result["items"][1]["card_preview"]["card_type"] == "pair_match"
        assert result["items"][2]["card_preview"]["card_type"] == "fact_recall"
        assert result["summary"]["by_type"]["fact_recall"] == 2
        assert result["summary"]["by_type"]["pair_match"] == 1

    def test_valid_pair_match_block(self):
        text = """@PAIR_MATCH
@ deck: Кардиология / Сопоставления
@ tags: кардиология
# Сопоставьте термин и определение
L: Систола
L: Диастола
R: Фаза расслабления миокарда
R: Фаза сокращения миокарда
P: Систола => Фаза сокращения миокарда
P: Диастола => Фаза расслабления миокарда"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["summary"]["total"] == 1
        assert result["summary"]["valid"] == 1
        item = result["items"][0]
        assert item["status"] == "valid"
        assert item["card_preview"]["card_type"] == "pair_match"
        assert item["card_preview"]["front"] == "Сопоставьте термин и определение"
        pairs = item["card_preview"]["pairs"]
        assert len(pairs) == 2
        assert pairs[0] == {"left": "Систола", "right": "Фаза сокращения миокарда"}
        assert pairs[1] == {"left": "Диастола", "right": "Фаза расслабления миокарда"}
        assert item["metadata"]["deck"] == "Кардиология / Сопоставления"
        assert item["metadata"]["tags"] == ["кардиология"]

    def test_pair_match_missing_front_is_error(self):
        text = """@PAIR_MATCH
L: A
L: B
R: X
R: Y
P: A => X
P: B => Y"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["items"][0]["status"] == "error"
        has_err = any(i["code"] == "missing_front" for i in result["items"][0]["validation_issues"])
        assert has_err

    def test_pair_match_missing_pairs_is_error(self):
        text = """@PAIR_MATCH
# Инструкция
L: A
R: B"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["items"][0]["status"] == "error"
        has_err = any(i["code"] == "missing_pairs" for i in result["items"][0]["validation_issues"])
        assert has_err

    def test_pair_match_one_pair_is_error(self):
        text = """@PAIR_MATCH
# Инструкция
P: A => B"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["items"][0]["status"] == "error"
        has_err = any(i["code"] == "pair_match_min_2_pairs" for i in result["items"][0]["validation_issues"])
        assert has_err

    def test_pair_match_six_pairs_is_error(self):
        text = "@PAIR_MATCH\n# Инструкция\n"
        for i in range(6):
            text += f"P: L{i} => R{i}\n"
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["items"][0]["status"] == "error"
        has_err = any(i["code"] == "pair_match_max_5_pairs" for i in result["items"][0]["validation_issues"])
        assert has_err

    def test_pair_match_duplicate_left_is_error(self):
        text = """@PAIR_MATCH
# Инструкция
P: Same => X
P: Same => Y"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["items"][0]["status"] == "error"
        has_err = any(i["code"] == "pair_match_duplicate_left" for i in result["items"][0]["validation_issues"])
        assert has_err

    def test_pair_match_duplicate_right_is_error(self):
        text = """@PAIR_MATCH
# Инструкция
P: A => Same
P: B => Same"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["items"][0]["status"] == "error"
        has_err = any(i["code"] == "pair_match_duplicate_right" for i in result["items"][0]["validation_issues"])
        assert has_err

    def test_pair_match_unlinked_l_items_warning(self):
        text = """@PAIR_MATCH
# Инструкция
L: A
L: B
L: C
R: X
R: Y
P: A => X
P: B => Y"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        item = result["items"][0]
        # C is unlinked — should produce warning but still valid
        has_warn = any(i["code"] == "unlinked_left_items" for i in item["validation_issues"])
        assert has_warn
        assert item["status"] in ("valid", "warning")

    def test_pair_match_five_pairs_valid(self):
        text = "@PAIR_MATCH\n# Максимум пар\n"
        for i in range(5):
            text += f"P: Left{i} => Right{i}\n"
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["items"][0]["status"] == "valid"
        assert len(result["items"][0]["card_preview"]["pairs"]) == 5

    def test_pair_match_html_sanitized(self):
        text = """@PAIR_MATCH
# <b>Инструкция</b>
P: <script>A</script> => <i>B</i>
P: C => D"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        item = result["items"][0]
        assert "<b>" not in item["card_preview"]["front"]
        assert "<script>" not in item["card_preview"]["pairs"][0]["left"]
        assert "<i>" not in item["card_preview"]["pairs"][0]["right"]

    def test_build_pair_match_card_data(self):
        text = """@PAIR_MATCH
@ tags: test
@ difficulty: 3
# Сопоставьте
P: A => X
P: B => Y"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        data = MicrocardParser.build_pair_match_card_data(result["items"][0])
        assert data is not None
        assert data["front_text"] == "Сопоставьте"
        assert len(data["pairs"]) == 2
        assert data["tags"] == ["test"]
        assert data["difficulty_hint"] == "high"

    def test_build_pair_match_card_data_returns_none_for_error(self):
        text = """@PAIR_MATCH
# Only one pair
P: A => B"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        data = MicrocardParser.build_pair_match_card_data(result["items"][0])
        assert data is None

    def test_build_pair_match_card_data_returns_none_for_fact_recall(self):
        text = """@MICROCARD
# Question
= Answer"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        data = MicrocardParser.build_pair_match_card_data(result["items"][0])
        assert data is None

    def test_notes_show_both_markers_supported(self):
        text = """@MICROCARD
# Q
= A"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert any("@MICROCARD" in n and "@PAIR_MATCH" in n for n in result["notes"])


class TestMicrocardParserEdgeCases:
    """Edge case tests."""

    def test_no_markers_returns_empty(self):
        text = "Просто текст без маркеров."
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["summary"]["total"] == 0

    def test_mixed_valid_and_error(self):
        text = """@MICROCARD
# Хороший вопрос
= Хороший ответ

@MICROCARD
= Нет вопроса"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        assert result["summary"]["total"] == 2
        assert result["summary"]["valid"] == 1
        assert result["summary"]["errors"] == 1

    def test_parser_resets_between_calls(self):
        parser = MicrocardParser()
        text1 = "@MICROCARD\n# Q1\n= A1"
        text2 = "@MICROCARD\n# Q2\n= A2\n\n@MICROCARD\n# Q3\n= A3"
        r1 = parser.parse_text(text1)
        r2 = parser.parse_text(text2)
        assert r1["summary"]["total"] == 1
        assert r2["summary"]["total"] == 2

    def test_source_line_tracked(self):
        text = """Some preamble

@MICROCARD
# Вопрос
= Ответ"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        # Marker is on line 3 (1-indexed), so source_line should be 3
        assert result["items"][0]["source_line"] == 3

    def test_unknown_difficulty_warning(self):
        text = """@MICROCARD
@ difficulty: extreme
# Вопрос
= Ответ"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        item = result["items"][0]
        has_warning = any(
            i.get("code") == "unknown_difficulty"
            for i in item["validation_issues"]
        )
        assert has_warning
        # Default difficulty should still be medium
        assert item["metadata"]["difficulty"] == "medium"

    def test_response_structure_matches_spec(self):
        text = """@MICROCARD
@ deck: Test Deck
@ tags: tag1
# Question
= Answer"""
        parser = MicrocardParser()
        result = parser.parse_text(text)
        # Check top-level keys
        assert "ok" in result
        assert "summary" in result
        assert "items" in result
        assert "parsing_errors" in result
        assert "notes" in result
        # Check summary keys
        s = result["summary"]
        assert "total" in s
        assert "valid" in s
        assert "warnings" in s
        assert "errors" in s
        assert "by_type" in s
        # Check item keys
        item = result["items"][0]
        assert "index" in item
        assert "status" in item
        assert "card_preview" in item
        assert "metadata" in item
        assert "validation_issues" in item
        # Check card_preview keys
        cp = item["card_preview"]
        assert "card_type" in cp
        assert "front" in cp
        assert "back" in cp
        # Check metadata keys
        meta = item["metadata"]
        assert "deck" in meta
        assert "tags" in meta
        assert "difficulty" in meta
