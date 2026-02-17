"""
Тесты для типа задания "Открытый ответ"
"""

import sys
import os

# Добавляем корневую папку проекта в путь
project_root = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, project_root)

from task_system.types.open_answer_task_type import OpenAnswerTaskType, OpenAnswerTaskEvaluator


def test_open_answer_type_creation():
    """Тест создания типа задания"""
    task_type = OpenAnswerTaskType()
    
    assert task_type.task_id == "open_answer"
    assert task_type.name == "Открытый ответ"
    assert task_type.description == "Вопрос с текстовым ответом по изображению"
    assert task_type.evaluator is not None
    assert task_type.ui is not None
    
    print("✅ Тест создания типа пройден")


def test_open_answer_default_settings():
    """Тест настроек по умолчанию"""
    task_type = OpenAnswerTaskType()
    settings = task_type.get_default_settings()
    
    assert 'max_length' in settings
    assert settings['max_length'] == 500
    assert 'show_hint' in settings
    assert 'allow_markers' in settings
    
    print("✅ Тест настроек по умолчанию пройден")


def test_open_answer_validation():
    """Тест валидации данных задания"""
    task_type = OpenAnswerTaskType()
    
    # Валидные данные
    valid_data = {
        'question': 'Опишите, что вы видите на снимке',
        'image': 'test.png',
        'reference_answer': 'Эталонный ответ'
    }
    assert task_type.validate_task_data(valid_data) == True
    
    # Невалидные данные - нет вопроса
    invalid_data_1 = {
        'image': 'test.png',
        'reference_answer': 'Ответ'
    }
    assert task_type.validate_task_data(invalid_data_1) == False
    
    # Валидные данные - нет изображения (image теперь опциональное поле)
    valid_data_no_image = {
        'question': 'Опишите процесс выполнения операции',
        'reference_answer': 'Ответ'
    }
    assert task_type.validate_task_data(valid_data_no_image) == True
    
    # Невалидные данные - слишком короткий вопрос
    invalid_data_3 = {
        'question': 'Что?',
        'image': 'test.png'
    }
    assert task_type.validate_task_data(invalid_data_3) == False
    
    print("✅ Тест валидации пройден")


def test_open_answer_evaluator():
    """Тест оценщика"""
    evaluator = OpenAnswerTaskEvaluator()
    
    # Пустой ответ
    result = evaluator.evaluate(
        {'answer': ''},
        {'max_length': 500}
    )
    assert result['success'] == False
    assert result['message'] == "Ответ не может быть пустым"
    
    # Слишком длинный ответ
    result = evaluator.evaluate(
        {'answer': 'a' * 600},
        {'max_length': 500}
    )
    assert result['success'] == False
    assert 'слишком длинный' in result['message']
    
    # Нормальный ответ
    result = evaluator.evaluate(
        {'answer': 'Это правильный ответ'},
        {'max_length': 500}
    )
    assert result['success'] == True
    assert result['message'] == "Ответ принят"
    
    print("✅ Тест оценщика пройден")


def test_open_answer_ui_settings():
    """Тест настроек UI"""
    task_type = OpenAnswerTaskType()
    ui_elements = task_type.ui.get_ui_elements()
    
    assert ui_elements['show_brush'] == False
    assert ui_elements['show_compare'] == False
    assert ui_elements['show_reset'] == True
    assert ui_elements['handle_click'] == True
    assert ui_elements['handle_draw'] == False
    
    print("✅ Тест настроек UI пройден")


def test_open_answer_available_tools():
    """Тест доступных инструментов"""
    task_type = OpenAnswerTaskType()
    tools = task_type.get_available_tools()
    
    assert 'point' in tools
    assert 'arrow' in tools
    
    print("✅ Тест доступных инструментов пройден")


def run_all_tests():
    """Запускает все тесты"""
    print("\n" + "="*60)
    print("Тестирование типа задания 'Открытый ответ'")
    print("="*60 + "\n")
    
    test_open_answer_type_creation()
    test_open_answer_default_settings()
    test_open_answer_validation()
    test_open_answer_evaluator()
    test_open_answer_ui_settings()
    test_open_answer_available_tools()
    
    print("\n" + "="*60)
    print("✅ Все тесты пройдены успешно!")
    print("="*60 + "\n")


if __name__ == '__main__':
    run_all_tests()
