import tempfile

import pytest

from task_system.models.test_parser import TestFileParser


def test_parser_basic_roundtrip(tmp_path):
    """Тест обратной совместимости: старый формат ? текст вопроса"""
    content = """?Q1
-B
+A

"""
    src = tmp_path / "q.txt"
    src.write_text(content, encoding="utf-8")

    parser = TestFileParser()
    test_task = parser.create_test_from_file(str(src))

    # Проверяем, что вопрос распарсился правильно
    assert len(test_task.questions) == 1
    assert test_task.questions[0].text == "Q1"
    assert len(test_task.questions[0].answers) == 2
    
    # Экспортируем и убеждаемся, что файл создаётся
    out = tmp_path / "out.txt"
    parser.export_test_to_file(test_task, str(out))
    assert out.exists()


def test_parser_new_format_separate_line(tmp_path):
    """Тест нового формата: ? на отдельной строке, текст вопроса на следующей"""
    content = """?
Вопрос на отдельной строке
+Правильный ответ
-Неправильный ответ 1
-Неправильный ответ 2

"""
    src = tmp_path / "q_new.txt"
    src.write_text(content, encoding="utf-8")

    parser = TestFileParser()
    test_task = parser.create_test_from_file(str(src))

    # Проверяем, что вопрос распарсился правильно
    assert len(test_task.questions) == 1
    assert test_task.questions[0].text == "Вопрос на отдельной строке"
    assert len(test_task.questions[0].answers) == 3
    
    # Проверяем правильный ответ
    correct_answers = [a for a in test_task.questions[0].answers if a.correct]
    assert len(correct_answers) == 1
    assert correct_answers[0].text == "Правильный ответ"


def test_parser_new_format_multiline_question(tmp_path):
    """Тест нового формата с многострочным вопросом"""
    content = """?
Это первая строка вопроса
Это вторая строка вопроса
Это третья строка вопроса
+Правильный ответ
-Неправильный ответ

"""
    src = tmp_path / "q_multiline.txt"
    src.write_text(content, encoding="utf-8")

    parser = TestFileParser()
    test_task = parser.create_test_from_file(str(src))

    # Проверяем, что многострочный вопрос объединился
    assert len(test_task.questions) == 1
    assert test_task.questions[0].text == "Это первая строка вопроса Это вторая строка вопроса Это третья строка вопроса"
    assert len(test_task.questions[0].answers) == 2


def test_parser_new_format_with_empty_lines(tmp_path):
    """Тест нового формата с пустыми строками после ?"""
    content = """?

Вопрос после пустой строки
+Правильный ответ
-Неправильный ответ

"""
    src = tmp_path / "q_empty.txt"
    src.write_text(content, encoding="utf-8")

    parser = TestFileParser()
    test_task = parser.create_test_from_file(str(src))

    # Проверяем, что пустые строки после ? игнорируются
    assert len(test_task.questions) == 1
    assert test_task.questions[0].text == "Вопрос после пустой строки"
    assert len(test_task.questions[0].answers) == 2


def test_parser_mixed_formats(tmp_path):
    """Тест смешанного формата: старый и новый форматы в одном файле"""
    content = """?Вопрос в старом формате
+Правильный ответ 1
-Неправильный ответ 1

?
Вопрос в новом формате
+Правильный ответ 2
-Неправильный ответ 2

"""
    src = tmp_path / "q_mixed.txt"
    src.write_text(content, encoding="utf-8")

    parser = TestFileParser()
    test_task = parser.create_test_from_file(str(src))

    # Проверяем, что оба вопроса распарсились
    assert len(test_task.questions) == 2
    assert test_task.questions[0].text == "Вопрос в старом формате"
    assert test_task.questions[1].text == "Вопрос в новом формате"
    assert len(test_task.questions[0].answers) == 2
    assert len(test_task.questions[1].answers) == 2


def test_parser_new_format_error_no_text(tmp_path):
    """Тест ошибки: ? без текста вопроса"""
    content = """?
+Правильный ответ
-Неправильный ответ

"""
    src = tmp_path / "q_error.txt"
    src.write_text(content, encoding="utf-8")

    parser = TestFileParser()
    
    # Должна быть ошибка, так как после ? нет текста вопроса
    with pytest.raises(ValueError, match="вопрос без текста"):
        parser.create_test_from_file(str(src))







































