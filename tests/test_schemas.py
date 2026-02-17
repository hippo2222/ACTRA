# tests/test_schemas.py
"""
Тесты для схем валидации.
"""

from task_system.core.schemas.click_schema import ClickTaskSchema
from task_system.core.schemas.draw_schema import DrawTaskSchema
from task_system.core.schemas.test_schema import TestTaskSchema


def test_click_schema_valid():
    """Тест валидации корректного задания click."""
    data = {
        'type': 'click',
        'meta': {'name': 'Тестовое задание'},
        'content': {
            'image': 'test.png',
            'prompt': 'Кликните на объект',
            'annotations': [
                {'type': 'point', 'x': 100, 'y': 200, 'label': 'Точка'}
            ]
        }
    }
    
    errors = ClickTaskSchema.validate(data)
    assert len(errors) == 0, f"Ожидалось 0 ошибок, получено {len(errors)}: {errors}"
    print("✅ test_click_schema_valid passed")


def test_click_schema_missing_image():
    """Тест валидации задания click без изображения."""
    data = {
        'type': 'click',
        'meta': {'name': 'Тестовое задание'},
        'content': {
            'prompt': 'Кликните на объект',
            'annotations': [
                {'type': 'point', 'x': 100, 'y': 200}
            ]
        }
    }
    
    errors = ClickTaskSchema.validate(data)
    assert len(errors) > 0
    assert any('image' in err for err in errors)
    print("✅ test_click_schema_missing_image passed")


def test_click_schema_no_annotations():
    """Тест валидации задания click без аннотаций."""
    data = {
        'type': 'click',
        'meta': {'name': 'Тестовое задание'},
        'content': {
            'image': 'test.png',
            'prompt': 'Кликните на объект',
            'annotations': []
        }
    }
    
    errors = ClickTaskSchema.validate(data)
    assert len(errors) > 0
    assert any('annotations' in err and 'хотя бы одну' in err for err in errors)
    print("✅ test_click_schema_no_annotations passed")


def test_draw_schema_valid():
    """Тест валидации корректного задания draw."""
    data = {
        'type': 'draw',
        'meta': {'name': 'Тестовое задание'},
        'content': {
            'image': 'test.png',
            'prompt': 'Нарисуйте контур',
            'annotations': [
                {
                    'type': 'polygon',
                    'label': 'Область',
                    'points': [[10, 20], [30, 40], [50, 60]]
                }
            ]
        }
    }
    
    errors = DrawTaskSchema.validate(data)
    assert len(errors) == 0, f"Ожидалось 0 ошибок, получено {len(errors)}: {errors}"
    print("✅ test_draw_schema_valid passed")


def test_draw_schema_insufficient_points():
    """Тест валидации задания draw с недостаточным количеством точек."""
    data = {
        'type': 'draw',
        'meta': {'name': 'Тестовое задание'},
        'content': {
            'image': 'test.png',
            'prompt': 'Нарисуйте контур',
            'annotations': [
                {
                    'type': 'polygon',
                    'points': [[10, 20], [30, 40]]  # Только 2 точки
                }
            ]
        }
    }
    
    errors = DrawTaskSchema.validate(data)
    assert len(errors) > 0
    assert any('минимум 3 точки' in err for err in errors)
    print("✅ test_draw_schema_insufficient_points passed")


def test_test_schema_valid():
    """Тест валидации корректного тестового задания."""
    data = {
        'type': 'test',
        'meta': {'name': 'Тестовое задание'},
        'content': {
            'questions': [
                {
                    'text': 'Вопрос 1?',
                    'answers': [
                        {'text': 'Ответ 1', 'correct': True},
                        {'text': 'Ответ 2', 'correct': False}
                    ]
                }
            ]
        }
    }
    
    errors = TestTaskSchema.validate(data)
    assert len(errors) == 0, f"Ожидалось 0 ошибок, получено {len(errors)}: {errors}"
    print("✅ test_test_schema_valid passed")


def test_test_schema_no_correct_answer():
    """Тест валидации теста без правильного ответа."""
    data = {
        'type': 'test',
        'meta': {'name': 'Тестовое задание'},
        'content': {
            'questions': [
                {
                    'text': 'Вопрос 1?',
                    'answers': [
                        {'text': 'Ответ 1', 'correct': False},
                        {'text': 'Ответ 2', 'correct': False}
                    ]
                }
            ]
        }
    }
    
    errors = TestTaskSchema.validate(data)
    assert len(errors) > 0
    assert any('правильный ответ' in err for err in errors)
    print("✅ test_test_schema_no_correct_answer passed")


def test_test_schema_no_incorrect_answer():
    """Тест валидации теста без неправильного ответа."""
    data = {
        'type': 'test',
        'meta': {'name': 'Тестовое задание'},
        'content': {
            'questions': [
                {
                    'text': 'Вопрос 1?',
                    'answers': [
                        {'text': 'Ответ 1', 'correct': True},
                        {'text': 'Ответ 2', 'correct': True}
                    ]
                }
            ]
        }
    }
    
    errors = TestTaskSchema.validate(data)
    assert len(errors) > 0
    assert any('неправильный ответ' in err for err in errors)
    print("✅ test_test_schema_no_incorrect_answer passed")


def run_all_tests():
    """Запускает все тесты."""
    print("\n" + "="*60)
    print("🧪 Запуск тестов схем валидации")
    print("="*60 + "\n")
    
    tests = [
        test_click_schema_valid,
        test_click_schema_missing_image,
        test_click_schema_no_annotations,
        test_draw_schema_valid,
        test_draw_schema_insufficient_points,
        test_test_schema_valid,
        test_test_schema_no_correct_answer,
        test_test_schema_no_incorrect_answer,
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"❌ {test.__name__} failed: {e}")
            failed += 1
        except Exception as e:
            print(f"❌ {test.__name__} error: {e}")
            failed += 1
    
    print("\n" + "="*60)
    print(f"📊 Результаты: {passed} passed, {failed} failed")
    print("="*60 + "\n")
    
    return failed == 0


if __name__ == '__main__':
    success = run_all_tests()
    sys.exit(0 if success else 1)
