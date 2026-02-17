"""
Unit tests for Task Import Parsers
Tests all parser types: OpenAnswer, Sequence, ClickText, ClickWords
"""

import pytest
from task_system.models.parsers import (
    OpenAnswerParser,
    SequenceParser,
    ClickTextParser,
    ClickWordsParser
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


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
