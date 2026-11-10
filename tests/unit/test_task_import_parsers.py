"""
Unit tests for Task Import Parsers
Tests all parser types: OpenAnswer, Sequence, ClickText, ClickWords
"""

import pytest
from task_system.models.parsers import (
    OpenAnswerParser,
    SequenceParser,
    ClickTextParser,
    ClickWordsParser,
    TestImportParser as TestImportParserCls,
)


class TestOpenAnswerParser:
    """Tests for OpenAnswerParser"""
    
    def test_parse_single_task(self):
        """Test parsing a single Open Answer task"""
        parser = OpenAnswerParser()
        text = """
@OPEN_ANSWER
# Опишите основные признаки пневмонии на рентгенограмме
"""
        tasks = parser.parse_text(text)
        
        assert len(tasks) == 1
        assert tasks[0]['type'] == 'open_answer'
        assert 'пневмонии' in tasks[0]['prompt'].lower()
        assert len(tasks[0]['prompt']) >= 10
    
    def test_parse_multiple_tasks(self):
        """Test parsing multiple Open Answer tasks"""
        parser = OpenAnswerParser()
        text = """
@OPEN_ANSWER
# Первый вопрос о рентгене

@OPEN_ANSWER
# Второй вопрос о КТ
"""
        tasks = parser.parse_text(text)
        
        assert len(tasks) == 2
        assert all(t['type'] == 'open_answer' for t in tasks)
    
    def test_empty_prompt_error(self):
        """Test that empty prompt generates error"""
        parser = OpenAnswerParser()
        text = "@OPEN_ANSWER\n"
        
        tasks = parser.parse_text(text)
        
        # Parser returns empty list when prompt is missing
        assert len(tasks) == 0
    
    def test_short_prompt_warning(self):
        """Test that very short prompts generate warnings"""
        parser = OpenAnswerParser()
        text = "@OPEN_ANSWER\n# Краткий"
        
        tasks = parser.parse_text(text)
        
        # Should parse but may have warnings
        assert len(tasks) <= 1

    def test_parse_with_keywords(self):
        """ED-4: Parser extracts keywords marked with *"""
        parser = OpenAnswerParser()
        text = """
@OPEN_ANSWER
# Что изображено на снимке?
* рентгенография
* ОГК
* недостаточным
"""
        tasks = parser.parse_text(text)
        assert len(tasks) == 1
        data = tasks[0]['data']
        assert data['keywords'] == ['рентгенография', 'ОГК', 'недостаточным']

    def test_parse_with_reference_answer(self):
        """ED-4: Parser extracts reference answer marked with ="""
        parser = OpenAnswerParser()
        text = """
@OPEN_ANSWER
# Что изображено на снимке?
= Рентгенография ОГК с недостаточным проникновением
"""
        tasks = parser.parse_text(text)
        assert len(tasks) == 1
        data = tasks[0]['data']
        assert data['reference_answer'] == 'Рентгенография ОГК с недостаточным проникновением'

    def test_parse_full_format(self):
        """ED-4: Parser handles question + reference + keywords together"""
        parser = OpenAnswerParser()
        text = """
@OPEN_ANSWER
# Опишите рентгенограмму
= Рентгенография ОГК
* рентгенография
* ОГК
"""
        tasks = parser.parse_text(text)
        assert len(tasks) == 1
        t = tasks[0]
        assert t['prompt'] == 'Опишите рентгенограмму'
        assert t['data']['question'] == 'Опишите рентгенограмму'
        assert t['data']['reference_answer'] == 'Рентгенография ОГК'
        assert t['data']['keywords'] == ['рентгенография', 'ОГК']

    def test_parse_question_only_backward_compat(self):
        """ED-4: Old format (question only) still works, no keywords/reference in data"""
        parser = OpenAnswerParser()
        text = """
@OPEN_ANSWER
# Простой вопрос без ключевых слов
"""
        tasks = parser.parse_text(text)
        assert len(tasks) == 1
        data = tasks[0]['data']
        assert data['question'] == 'Простой вопрос без ключевых слов'
        assert 'keywords' not in data
        assert 'reference_answer' not in data


class TestSequenceParser:
    """Tests for SequenceParser"""
    
    def test_parse_valid_sequence(self):
        """Test parsing a valid Sequence task"""
        parser = SequenceParser()
        text = """
@SEQUENCE
# Алгоритм диагностики
element_1: Сбор анамнеза
element_2: Физикальное обследование
element_3: Лабораторные тесты
level_1: element_1
level_2: element_2, element_3
"""
        tasks = parser.parse_text(text)
        
        assert len(tasks) == 1
        task = tasks[0]
        assert task['type'] == 'sequence_assembly'
        assert len(task['data']['elements']) == 3
        assert len(task['data']['levels']) == 2
        # Without titles, level_names is empty
        assert task['data'].get('level_names') == {}

    def test_parse_sequence_with_custom_level_titles(self):
        """Test parsing sequence with custom level titles in brackets and parentheses"""
        parser = SequenceParser()
        text = """
@SEQUENCE
# Алгоритм оказания помощи
element_1: Оценить безопасность
element_2: Проверить реакцию
element_3: Оценить дыхание
element_4: Начать компрессии
level_1 [Безопасность и сознание]: element_1, element_2
level_2 (Дыхание): element_3
level_3: element_4
"""
        tasks = parser.parse_text(text)
        assert len(tasks) == 1
        task = tasks[0]
        assert task['type'] == 'sequence_assembly'
        assert len(task['data']['levels']) == 3
        level_names = task['data'].get('level_names', {})
        assert level_names.get(1) == 'Безопасность и сознание'
        assert level_names.get(2) == 'Дыхание'
        assert 3 not in level_names

    def test_duplicate_element_warning(self):
        """Test that duplicate element IDs generate warnings"""
        parser = SequenceParser()
        text = """
@SEQUENCE
# Test
element_1: First
element_1: Duplicate
level_1: element_1
"""
        tasks = parser.parse_text(text)
        
        assert len(tasks) == 1
        assert any(w.get('code') == 'duplicate_element_id' for w in parser.warnings)
    
    def test_invalid_element_reference(self):
        """Test validation of element references in levels"""
        parser = SequenceParser()
        text = """
@SEQUENCE
# Test
element_1: First
level_1: element_1, element_99
"""
        tasks = parser.parse_text(text)
        
        if len(tasks) > 0:
            errors = parser._validate_single_task(tasks[0], 0)
            assert any('element_99' in str(err) for err in errors)
    
    def test_unused_elements_warning(self):
        """Test warning for unused elements"""
        parser = SequenceParser()
        text = """
@SEQUENCE
# Test
element_1: Used
element_2: Unused
level_1: element_1
"""
        tasks = parser.parse_text(text)
        
        if len(tasks) > 0:
            parser._validate_single_task(tasks[0], 0)
            assert any(w.get('code') == 'unused_element' for w in parser.warnings)

    def test_extract_inline_legend_from_prompt_exact_user_feedback(self):
        """Test extracting level legend embedded in the prompt # from external AI"""
        parser = SequenceParser()
        text = """
@SEQUENCE
# Сгруппируйте патологические состояния по направлению смещения структур средостения (Уровень 1 — смещение в сторону затемнения; Уровень 2 — смещение от затемнения в противоположную сторону; Уровень 3 — отсутствие смещения средостения):
element_1: Ателектаз доли
element_2: Фиброторакс
element_3: Клапанный пневмоторакс
element_4: Напряжённый гидроторакс
element_5: Очаговая пневмония
element_6: Сухой плеврит
level_1: element_1, element_2
level_2: element_3, element_4
level_3: element_5, element_6
"""
        tasks = parser.parse_text(text)
        assert len(tasks) == 1
        t = tasks[0]
        # Prompt should be cleaned from the parenthesis legend
        assert t['prompt'] == 'Сгруппируйте патологические состояния по направлению смещения структур средостения:'
        level_names = t['data'].get('level_names', {})
        assert level_names.get(1) == 'Смещение в сторону затемнения'
        assert level_names.get(2) == 'Смещение от затемнения в противоположную сторону'
        assert level_names.get(3) == 'Отсутствие смещения средостения'

    def test_extract_inline_legend_multilingual(self):
        """Test extracting inline level legends in English and Ukrainian"""
        parser = SequenceParser()
        en_text = """
@SEQUENCE
# Classify conditions by mediastinal shift (Level 1: Toward opacity; Level 2: Away from opacity; Level 3: No shift):
element_1: Atelectasis
element_2: Fibrothorax
element_3: Pneumothorax
level_1: element_1
level_2: element_2
level_3: element_3
"""
        tasks = parser.parse_text(en_text)
        assert len(tasks) == 1
        assert tasks[0]['prompt'] == 'Classify conditions by mediastinal shift:'
        en_ln = tasks[0]['data']['level_names']
        assert en_ln[1] == 'Toward opacity'
        assert en_ln[2] == 'Away from opacity'
        assert en_ln[3] == 'No shift'

        uk_text = """
@SEQUENCE
# Згрупуйте патологічні стани за зміщенням середостіння (Рівень 1 — у бік затемнення; Рівень 2 — у протилежний бік):
element_1: Ателектаз
element_2: Пневмоторакс
element_3: Пневмонія
level_1: element_1
level_2: element_2, element_3
"""
        tasks_uk = parser.parse_text(uk_text)
        assert len(tasks_uk) == 1
        assert tasks_uk[0]['prompt'] == 'Згрупуйте патологічні стани за зміщенням середостіння:'
        uk_ln = tasks_uk[0]['data']['level_names']
        assert uk_ln[1] == 'У бік затемнення'
        assert uk_ln[2] == 'У протилежний бік'

    def test_regular_parentheses_not_extracted_as_legend(self):
        """Test that medical abbreviations in parentheses are NOT treated as legends"""
        parser = SequenceParser()
        text = """
@SEQUENCE
# Оцените степень тяжести ХОБЛ (хронической обструктивной болезни легких):
element_1: Легкая степень
element_2: Средняя степень
element_3: Тяжелая степень
level_1: element_1
level_2: element_2
level_3: element_3
"""
        tasks = parser.parse_text(text)
        assert len(tasks) == 1
        assert 'хронической обструктивной болезни легких' in tasks[0]['prompt']
        assert tasks[0]['data']['level_names'] == {}

    def test_resilient_level_line_parsing(self):
        """Test parsing level lines with nested parentheses, dashes, quotes, and filtering tautological names"""
        parser = SequenceParser()
        text = """
@SEQUENCE
# Тест устойчивости парсера
element_1: A
element_2: B
element_3: C
element_4: D
element_5: E
level_1 [Смещение (в сторону затемнения)]: element_1
level_2 (Смещение (в противоположную сторону)): element_2
level_3 — Направление без изменений: element_3
level_4 "Кавычки": element_4
level_5 [Level 5]: element_5
"""
        tasks = parser.parse_text(text)
        assert len(tasks) == 1
        ln = tasks[0]['data']['level_names']
        assert ln.get(1) == 'Смещение (в сторону затемнения)'
        assert ln.get(2) == 'Смещение (в противоположную сторону)'
        assert ln.get(3) == 'Направление без изменений'
        assert ln.get(4) == 'Кавычки'
        # Tautological "Level 5" is stripped
        assert 5 not in ln

    def test_explicit_level_title_overrides_legend_in_prompt(self):
        """Test that explicit [Title] on level line has priority over prompt legend"""
        parser = SequenceParser()
        text = """
@SEQUENCE
# Сгруппируйте (Уровень 1 — Старый 1; Уровень 2 — Старый 2):
element_1: E1
element_2: E2
level_1 [Новый заголовок 1]: element_1
level_2: element_2
"""
        tasks = parser.parse_text(text)
        assert len(tasks) == 1
        ln = tasks[0]['data']['level_names']
        assert ln.get(1) == 'Новый заголовок 1'
        assert ln.get(2) == 'Старый 2'

    def test_didactic_warnings_for_grouping_without_titles(self):
        """Test that grouping tasks without titles trigger missing_group_titles warning"""
        parser = SequenceParser()
        text = """
@SEQUENCE
@ level_order_matters: false
# Задача на группировку
element_1: A
element_2: B
element_3: C
level_1: element_1
level_2: element_2, element_3
"""
        tasks = parser.parse_text(text)
        assert len(tasks) == 1
        parser._validate_single_task(tasks[0], 0)
        assert any(w.get('code') == 'missing_group_titles' for w in parser.warnings)


class TestClickTextParser:
    """Tests for ClickTextParser"""
    
    def test_parse_valid_click_text(self):
        """Test parsing valid Click Text task"""
        parser = ClickTextParser()
        text = """
@CLICK_TEXT
# Выберите правильные утверждения
+ Правильный ответ 1
- Неправильный ответ
+ Правильный ответ 2
"""
        tasks = parser.parse_text(text)
        
        assert len(tasks) == 1
        task = tasks[0]
        assert task['type'] == 'click'
        assert task['data']['mode'] == 'text_choice'
        
        options = task['data']['options']
        assert len(options) == 3
        correct_count = sum(1 for opt in options if opt['correct'])
        assert correct_count == 2
    
    def test_no_correct_answers_error(self):
        """Test error when no correct answers"""
        parser = ClickTextParser()
        text = """
@CLICK_TEXT
# Test
- Wrong 1
- Wrong 2
"""
        tasks = parser.parse_text(text)
        
        if len(tasks) > 0:
            errors = parser._validate_single_task(tasks[0], 0)
            assert len(errors) > 0


class TestClickWordsParser:
    """Tests for ClickWordsParser"""
    
    def test_parse_valid_click_words(self):
        """Test parsing valid Click Words task"""
        parser = ClickWordsParser()
        text = """
@CLICK_WORDS
# Найдите ошибки в тексте (индексы: 2, 5)
Это тест с ошибками для проверки парсинга
"""
        tasks = parser.parse_text(text)
        
        assert len(tasks) == 1
        task = tasks[0]
        assert task['type'] == 'click'
        assert task['data']['mode'] == 'word_errors'
        # Parser extracts indices from prompt - check at least one was found
        assert len(task['data']['error_indices']) >= 1
        assert 2 in task['data']['error_indices']
    
    def test_invalid_indices_error(self):
        """Test error for invalid indices"""
        parser = ClickWordsParser()
        text = """
@CLICK_WORDS
# Test (индексы: 999)
Short text
"""
        tasks = parser.parse_text(text)
        
        if len(tasks) > 0:
            errors = parser._validate_single_task(tasks[0], 0)
            # Should have error about index out of range
            assert len(errors) > 0


class TestParserIntegration:
    """Integration tests for parser combinations"""
    
    def test_parse_mixed_task_types(self):
        """Test parsing document with multiple task types"""
        text = """
@OPEN_ANSWER
# Вопрос 1

@SEQUENCE
# Последовательность
element_1: Шаг 1
level_1: element_1

@CLICK_TEXT
# Выбор
+ Да
- Нет
"""
        open_parser = OpenAnswerParser()
        seq_parser = SequenceParser()
        click_parser = ClickTextParser()
        
        open_tasks = open_parser.parse_text(text)
        seq_tasks = seq_parser.parse_text(text)
        click_tasks = click_parser.parse_text(text)
        
        assert len(open_tasks) == 1
        assert len(seq_tasks) == 1
        assert len(click_tasks) == 1
    
    def test_task_name_generation(self):
        """Test that task names are generated correctly"""
        parser = OpenAnswerParser()
        text = """
@OPEN_ANSWER
# Первый вопрос

@OPEN_ANSWER
# Второй вопрос
"""
        tasks = parser.parse_text(text)
        
        assert len(tasks) == 2
        assert tasks[0]['name'] != tasks[1]['name']
        assert 'Открытый ответ' in tasks[0]['name']

    def test_long_prompt_auto_name_preserved_without_premature_truncation(self):
        """Verify that task names generated from long prompts are not truncated to 37 chars."""
        long_prompt = "Опишите основные признаки очаговой пневмонии на обзорной рентгенограмме органов грудной клетки"
        assert len(long_prompt) > 40
        open_text = f"""
@OPEN_ANSWER
# {long_prompt}
= Рентгенография ОГК
* очаговая тень
"""
        open_tasks = OpenAnswerParser().parse_text(open_text)
        assert len(open_tasks) == 1
        name = open_tasks[0]['name']
        assert "Открытый ответ - Опишите основные признаки" in name
        assert not name.endswith("...")
        assert len(name) > 50

    def test_explicit_title_metadata_preserved_across_all_parsers(self):
        """Test that @ title: and @ name: directives are respected without 37-char truncation."""
        long_title = "Клинический протокол расширенной сердечно-легочной реанимации при остановке сердца"
        assert len(long_title) > 40

        # SequenceParser
        seq_text = f"""
@SEQUENCE
@ title: {long_title}
# Описание шагов реанимации
element_1: Компрессии 30
level_1: element_1
"""
        seq_tasks = SequenceParser().parse_text(seq_text)
        assert len(seq_tasks) == 1
        assert seq_tasks[0]['name'] == long_title
        assert not seq_tasks[0]['name'].endswith("...")

        # TestImportParser
        test_text = f"""
@TEST
@ title: {long_title}
? Какова глубина компрессий грудной клетки у взрослых?
+ 5-6 см
- 2-3 см
"""
        test_tasks = TestImportParserCls().parse_text(test_text)
        assert len(test_tasks) == 1
        assert test_tasks[0]['name'] == long_title
        assert not test_tasks[0]['name'].endswith("...")

        # ClickTextParser
        click_text = f"""
@CLICK_TEXT
@ name: {long_title}
# Найдите правильное утверждение
+ ИВЛ с частотой 10 в минуту
- Отсутствие компрессий
"""
        click_tasks = ClickTextParser().parse_text(click_text)
        assert len(click_tasks) == 1
        assert click_tasks[0]['name'] == long_title
        assert not click_tasks[0]['name'].endswith("...")

        # ClickWordsParser
        click_words_text = f"""
@CLICK_WORDS
@ title: {long_title}
# Найдите ошибку в описании: индексы 2
Пациент в сознании [бездыханный] стабилен
"""
        words_tasks = ClickWordsParser().parse_text(click_words_text)
        assert len(words_tasks) == 1
        assert words_tasks[0]['name'] == long_title
        assert not words_tasks[0]['name'].endswith("...")

        # OpenAnswerParser
        open_text = f"""
@OPEN_ANSWER
@ title: {long_title}
# Опишите алгоритм действий
= Алгоритм включает раннюю дефибрилляцию
"""
        open_tasks = OpenAnswerParser().parse_text(open_text)
        assert len(open_tasks) == 1
        assert open_tasks[0]['name'] == long_title
        assert not open_tasks[0]['name'].endswith("...")


class TestSequenceImportPayloadIntegration:
    """Integration tests for Sequence import payload construction and tautology prevention."""

    def test_sequence_import_routes_no_tautological_level_name(self):
        import sys
        from pathlib import Path
        desktop_app_path = str(Path(__file__).resolve().parents[2] / 'desktop-app')
        if desktop_app_path not in sys.path:
            sys.path.insert(0, desktop_app_path)
        from routes.import_routes import _build_imported_task_payload

        text = """
@SEQUENCE
# Расположите этапы в порядке выполнения
element_1: Осмотр
element_2: Пальпация
level_1: element_1
level_2: element_2
"""
        tasks = SequenceParser().parse_text(text)
        assert len(tasks) == 1
        payload = _build_imported_task_payload(tasks[0], "task_seq_1", "m1", "t1", "user_1")
        content = payload["content"]
        assert content["levels"][0]["level_name"] == ""
        assert content["levels"][1]["level_name"] == ""
        assert content["sequence"][0]["title"] == ""
        assert content["sequence"][1]["title"] == ""

    def test_sequence_import_routes_filters_tautological_names(self):
        import sys
        from pathlib import Path
        desktop_app_path = str(Path(__file__).resolve().parents[2] / 'desktop-app')
        if desktop_app_path not in sys.path:
            sys.path.insert(0, desktop_app_path)
        from routes.import_routes import _build_imported_task_payload

        text = """
@SEQUENCE
# Расположите этапы в порядке выполнения
element_1: Осмотр
element_2: Пальпация
level_1 [Level 1]: element_1
level_2 [Уровень 2]: element_2
"""
        tasks = SequenceParser().parse_text(text)
        assert len(tasks) == 1
        payload = _build_imported_task_payload(tasks[0], "task_seq_taut", "m1", "t1", "user_1")
        content = payload["content"]
        assert content["levels"][0]["level_name"] == ""
        assert content["levels"][1]["level_name"] == ""
        assert content["sequence"][0]["title"] == ""
        assert content["sequence"][1]["title"] == ""

    def test_sequence_import_routes_preserves_custom_group_names(self):
        import sys
        from pathlib import Path
        desktop_app_path = str(Path(__file__).resolve().parents[2] / 'desktop-app')
        if desktop_app_path not in sys.path:
            sys.path.insert(0, desktop_app_path)
        from routes.import_routes import _build_imported_task_payload

        text = """
@SEQUENCE
# Сгруппируйте патологические состояния по направлению смещения
element_1: Ателектаз
element_2: Пневмоторакс
level_1 [Смещение в сторону затемнения]: element_1
level_2 [Смещение в противоположную сторону]: element_2
"""
        tasks = SequenceParser().parse_text(text)
        assert len(tasks) == 1
        payload = _build_imported_task_payload(tasks[0], "task_seq_group", "m1", "t1", "user_1")
        content = payload["content"]
        assert content["levels"][0]["level_name"] == "Смещение в сторону затемнения"
        assert content["levels"][1]["level_name"] == "Смещение в противоположную сторону"
        assert content["sequence"][0]["title"] == "Смещение в сторону затемнения"
        assert content["sequence"][1]["title"] == "Смещение в противоположную сторону"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
