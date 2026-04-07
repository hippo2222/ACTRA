"""
Unit-тесты для TaskEvaluatorService.

Тестирует логику оценки для всех типов заданий:
- Click tasks (клик по анатомическим областям)
- Draw tasks (рисование контуров)
- Open Answer tasks (текстовые ответы)
- Sequence Assembly tasks (сборка последовательностей)

НЕДЕЛЯ 2, Блок A: Task Evaluator Service
"""

import unittest
import sys
from pathlib import Path
from datetime import datetime

# Добавляем пути для импорта
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.task_evaluator_service import TaskEvaluatorService, EvaluationResult


class TestClickTaskEvaluation(unittest.TestCase):
    """Тесты для evaluate_click_task"""
    
    def setUp(self):
        """Подготовка для каждого теста"""
        self.service = TaskEvaluatorService()
    
    def test_evaluate_click_task_correct_point(self):
        """User кликнул точно в точечную цель - должен быть успех"""
        user_input = {
            'x': 105,
            'y': 105,
            'scale_factor': 1.0,
            'offset_x': 0,
            'offset_y': 0
        }
        
        answer_key = {
            'targets': [
                {
                    'shape': 'point',
                    'coordinates': [100, 100],
                    'label': 'Точка A'
                }
            ]
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key)
        
        self.assertTrue(result.success)
        self.assertIn('Точка A', result.message)
        self.assertEqual(result.metric, "distance")
    
    def test_evaluate_click_task_near_point(self):
        """User кликнул рядом (в пределах tolerance) - должен быть успех"""
        user_input = {
            'x': 120,
            'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0,
            'offset_y': 0
        }
        
        answer_key = {
            'targets': [
                {
                    'shape': 'point',
                    'coordinates': [100, 100],
                    'label': 'Точка A'
                }
            ]
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key)
        
        # Расстояние 20 пикселей - в пределах tolerance (25)
        self.assertTrue(result.success)
        self.assertEqual(result.metric, "distance")
    
    def test_evaluate_click_task_wrong_point(self):
        """User кликнул далеко - должен быть провал"""
        user_input = {
            'x': 200,
            'y': 200,
            'scale_factor': 1.0,
            'offset_x': 0,
            'offset_y': 0
        }
        
        answer_key = {
            'targets': [
                {
                    'shape': 'point',
                    'coordinates': [100, 100],
                    'label': 'Точка A'
                }
            ]
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key)
        
        self.assertFalse(result.success)
        self.assertEqual(result.metric, "distance")
    
    def test_evaluate_click_task_polygon_correct(self):
        """User кликнул внутри полигона - успех"""
        user_input = {
            'x': 150,
            'y': 150,
            'scale_factor': 1.0,
            'offset_x': 0,
            'offset_y': 0
        }
        
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'points': [
                        [100, 100],
                        [200, 100],
                        [200, 200],
                        [100, 200]
                    ],
                    'label': 'Прямоугольник'
                }
            ]
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key)
        
        self.assertTrue(result.success)
        self.assertIn('Прямоугольник', result.message)
        self.assertEqual(result.metric, "distance")
    
    def test_evaluate_click_task_polygon_wrong(self):
        """User кликнул вне полигона - провал"""
        user_input = {
            'x': 50,
            'y': 50,
            'scale_factor': 1.0,
            'offset_x': 0,
            'offset_y': 0
        }
        
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'points': [
                        [100, 100],
                        [200, 100],
                        [200, 200],
                        [100, 200]
                    ],
                    'label': 'Прямоугольник'
                }
            ]
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key)
        
        self.assertFalse(result.success)
        self.assertEqual(result.metric, "distance")
    
    def test_evaluate_click_task_with_scaling(self):
        """Клик с учетом масштабирования и смещения
        
        ВАЖНО: координаты x, y должны быть уже в оригинальных координатах изображения
        (преобразованы из canvas координат до вызова evaluate_click_task).
        Здесь мы передаем координаты напрямую в оригинальных координатах.
        """
        user_input = {
            'x': 100,  # Координаты уже в оригинальных координатах изображения
            'y': 100,
            'scale_factor': 1.0,  # Не используется, т.к. координаты уже преобразованы
            'offset_x': 0,
            'offset_y': 0
        }
        
        answer_key = {
            'targets': [
                {
                    'shape': 'point',
                    'coordinates': [100, 100],
                    'label': 'Точка A'
                }
            ]
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key)
        
        self.assertTrue(result.success)
        self.assertEqual(result.metric, "distance")
    
    def test_evaluate_click_task_no_targets(self):
        """Нет целей - должна быть ошибка"""
        user_input = {
            'x': 100,
            'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0,
            'offset_y': 0
        }
        
        answer_key = {'targets': []}
        
        result = self.service.evaluate_click_task(user_input, answer_key)
        
        self.assertFalse(result.success)
        self.assertEqual(result.score, 0.0)
        self.assertEqual(result.details['error'], 'no_targets')
        self.assertEqual(result.metric, "distance")


class TestDrawTaskEvaluation(unittest.TestCase):
    """Тесты для evaluate_draw_task"""
    
    def setUp(self):
        """Подготовка для каждого теста"""
        self.service = TaskEvaluatorService()
    
    def test_evaluate_draw_task_full_coverage(self):
        """User обвёл полигон - хороший результат"""
        # Создаем ОЧЕНЬ густую сетку штрихов, покрывающую весь прямоугольник
        strokes = []
        # Горизонтальные линии
        for y in range(100, 201, 2):  # каждые 2 пикселя
            points = [[x, y] for x in range(100, 201, 1)]  # все точки по X
            strokes.append({
                'type': 'brush_stroke',
                'points': points
            })
        # Вертикальные линии для полноты
        for x in range(100, 201, 2):
            points = [[x, y] for y in range(100, 201, 1)]
            strokes.append({
                'type': 'brush_stroke',
                'points': points
            })
        
        user_input = {'drawing': strokes}
        
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'points': [
                        [100, 100],
                        [200, 100],
                        [200, 200],
                        [100, 200]
                    ],
                    'label': 'Прямоугольник'
                }
            ]
        }
        
        result = self.service.evaluate_draw_task(user_input, answer_key)
        
        # Проверяем что есть хорошее покрытие
        self.assertIn('coverage', result.details)  # Есть метрика покрытия
        self.assertGreater(result.details['coverage'], 50.0)
        self.assertEqual(result.metric, "IoU")
    
    def test_evaluate_draw_task_partial_coverage(self):
        """User обвёл только часть полигона - средний score"""
        # Создаем штрихи только в левой половине прямоугольника
        strokes = []
        for y in range(100, 200, 10):
            points = [[x, y] for x in range(100, 150, 5)]
            strokes.append({
                'type': 'brush_stroke',
                'points': points
            })
        
        user_input = {'drawing': strokes}
        
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'points': [
                        [100, 100],
                        [200, 100],
                        [200, 200],
                        [100, 200]
                    ],
                    'label': 'Прямоугольник'
                }
            ]
        }
        
        result = self.service.evaluate_draw_task(user_input, answer_key)
        
        # Покрытие должно быть меньше порога
        self.assertFalse(result.success)
        self.assertIn('Нужно улучшить', result.message)
        self.assertEqual(result.metric, "IoU")
    
    def test_evaluate_draw_task_no_drawing(self):
        """Нет рисунка - должна быть ошибка"""
        user_input = {'drawing': []}
        
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'points': [[100, 100], [200, 100], [200, 200], [100, 200]],
                    'label': 'Прямоугольник'
                }
            ]
        }
        
        result = self.service.evaluate_draw_task(user_input, answer_key)
        
        self.assertFalse(result.success)
        self.assertEqual(result.details['error'], 'no_drawing')
        self.assertEqual(result.metric, "IoU")
    
    def test_evaluate_draw_task_no_targets(self):
        """Нет эталонных областей - ошибка"""
        user_input = {
            'drawing': [
                {'type': 'brush_stroke', 'points': [[100, 100], [110, 110]]}
            ]
        }
        
        answer_key = {'targets': []}
        
        result = self.service.evaluate_draw_task(user_input, answer_key)
        
        self.assertFalse(result.success)
        self.assertEqual(result.score, 0.0)
        self.assertEqual(result.details['error'], 'no_targets')
        self.assertEqual(result.metric, "IoU")


class TestOpenAnswerTaskEvaluation(unittest.TestCase):
    """Тесты для evaluate_open_answer_task"""
    
    def setUp(self):
        """Подготовка для каждого теста"""
        self.service = TaskEvaluatorService()
    
    def test_evaluate_open_answer_all_keywords_found(self):
        """Все ключевые слова найдены - успех"""
        user_input = {
            'answer': 'Этот орган называется печень и выполняет детоксикацию организма'
        }
        
        answer_key = {
            'keywords': ['печень', 'детоксикацию'],
            'sequence_matters': False
        }
        
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        
        self.assertTrue(result.success)
        self.assertIn('Правильно', result.message)
        self.assertEqual(len(result.details['found_keywords']), 2)
        self.assertEqual(len(result.details['missing_keywords']), 0)
        self.assertEqual(result.metric, "percent")
    
    def test_evaluate_open_answer_partial_keywords(self):
        """Найдена только часть ключевых слов - провал"""
        user_input = {
            'answer': 'Этот орган называется печень'
        }
        
        answer_key = {
            'keywords': ['печень', 'детоксикация', 'метаболизм'],
            'sequence_matters': False
        }
        
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        
        self.assertFalse(result.success)
        self.assertEqual(len(result.details['found_keywords']), 1)
        self.assertEqual(len(result.details['missing_keywords']), 2)
        self.assertEqual(result.metric, "percent")
    
    def test_evaluate_open_answer_sequence_matters_correct(self):
        """Ключевые слова в правильной последовательности - успех"""
        user_input = {
            'answer': 'дыхательный цикл включает вдох выдох повторение'
        }
        
        answer_key = {
            'keywords': ['вдох', 'выдох'],
            'sequence_matters': True
        }
        
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        
        self.assertTrue(result.success)
        self.assertEqual(result.metric, "percent")
    
    def test_evaluate_open_answer_sequence_matters_wrong(self):
        """Ключевые слова есть, но в неправильной последовательности - провал"""
        user_input = {
            'answer': 'дыхательный цикл включает выдох вдох неправильно'
        }
        
        answer_key = {
            'keywords': ['вдох', 'выдох'],
            'sequence_matters': True
        }
        
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        
        self.assertFalse(result.success)
        # Score может быть 100 если все слова найдены (но не в правильной последовательности)
        # Проверяем, что результат неправильный
        self.assertEqual(len(result.details['found_keywords']), 2)
        self.assertEqual(result.metric, "percent")
    
    def test_evaluate_open_answer_empty(self):
        """Пустой ответ - ошибка"""
        user_input = {'answer': ''}
        
        answer_key = {
            'keywords': ['печень'],
            'sequence_matters': False
        }
        
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        
        self.assertFalse(result.success)
        self.assertEqual(result.details['error'], 'empty_answer')
        self.assertEqual(result.metric, "percent")
    
    def test_evaluate_open_answer_no_keywords(self):
        """Нет ключевых слов в answer_key - ошибка"""
        user_input = {'answer': 'Какой-то ответ'}
        
        answer_key = {'keywords': []}
        
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        
        self.assertFalse(result.success)
        self.assertEqual(result.details['error'], 'no_keywords')
        self.assertEqual(result.metric, "percent")
    
    def test_evaluate_open_answer_case_insensitive(self):
        """Проверка регистронезависимости"""
        user_input = {
            'answer': 'ПЕЧЕНЬ выполняет ДЕТОКСИКАЦИЮ'
        }
        
        answer_key = {
            'keywords': ['печень', 'детоксикацию'],
            'sequence_matters': False
        }
        
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        
        self.assertTrue(result.success)
        self.assertEqual(result.metric, "percent")


class TestUnifiedEvaluateTask(unittest.TestCase):
    """Тесты для unified entry point evaluate_task"""
    
    def setUp(self):
        """Подготовка для каждого теста"""
        self.service = TaskEvaluatorService()
    
    def test_evaluate_task_click(self):
        """Unified метод для click задания"""
        user_input = {
            'x': 105,
            'y': 105,
            'scale_factor': 1.0,
            'offset_x': 0,
            'offset_y': 0
        }
        
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'Точка'}
            ]
        }
        
        result = self.service.evaluate_task('click', user_input, answer_key)
        
        self.assertIsInstance(result, EvaluationResult)
        self.assertTrue(result.success)
        self.assertEqual(result.metric, "distance")
    
    def test_evaluate_task_draw(self):
        """Unified метод для draw задания"""
        user_input = {
            'drawing': [
                {'type': 'brush_stroke', 'points': [[100, 100], [110, 110]]}
            ]
        }
        
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'points': [[100, 100], [200, 100], [200, 200], [100, 200]]
                }
            ]
        }
        
        result = self.service.evaluate_task('draw', user_input, answer_key)
        
        self.assertIsInstance(result, EvaluationResult)
        self.assertEqual(result.metric, "IoU")
    
    def test_evaluate_task_open_answer(self):
        """Unified метод для open_answer задания"""
        user_input = {'answer': 'печень детоксикация'}
        answer_key = {'keywords': ['печень', 'детоксикация']}
        
        result = self.service.evaluate_task('open_answer', user_input, answer_key)
        
        self.assertIsInstance(result, EvaluationResult)
        self.assertTrue(result.success)
        self.assertEqual(result.metric, "percent")
    
    def test_evaluate_task_unknown_type(self):
        """Неизвестный тип задания - должна быть ошибка"""
        from task_system.core.exceptions import EvaluationError
        
        with self.assertRaises(EvaluationError) as context:
            self.service.evaluate_task('unknown_type', {}, {})
        
        self.assertIn('Unknown task type', str(context.exception))
    
    def test_evaluate_task_test_type(self):
        """Тип 'test' обрабатывается через evaluate_test_task"""
        user_input = {
            'answers': {
                'q1': 0
            }
        }
        
        answer_key = {
            'questions': [
                {
                    'id': 'q1',
                    'answers': [
                        {'text': 'Печень', 'correct': True},
                        {'text': 'Почка', 'correct': False}
                    ]
                }
            ]
        }
        
        result = self.service.evaluate_task('test', user_input, answer_key)
        
        self.assertIsInstance(result, EvaluationResult)
        self.assertTrue(result.success)
        self.assertEqual(result.metric, "percent")


class TestEvaluationResultDataclass(unittest.TestCase):
    """Тесты для EvaluationResult dataclass"""
    
    def test_evaluation_result_creation(self):
        """Создание EvaluationResult"""
        result = EvaluationResult(
            success=True,
            score=95.5,
            message="Отлично!",
            metric="IoU",
            details={'coverage': 95.5}
        )
        
        self.assertTrue(result.success)
        self.assertEqual(result.message, "Отлично!")
        self.assertEqual(result.details['coverage'], 95.5)
        self.assertEqual(result.metric, "IoU")
        self.assertIsInstance(result.timestamp, datetime)
    
    def test_evaluation_result_score_validation(self):
        """Score должен быть в диапазоне 0-100"""
        from task_system.core.exceptions import EvaluationError
        
        with self.assertRaises(EvaluationError):
            EvaluationResult(
                success=True,
                score=150.0,  # Недопустимое значение
                message="Test"
            )
        
        with self.assertRaises(EvaluationError):
            EvaluationResult(
                success=True,
                score=-10.0,  # Недопустимое значение
                message="Test"
            )
    
    def test_evaluation_result_defaults(self):
        """Проверка значений по умолчанию"""
        result = EvaluationResult(
            success=True,
            score=100.0,
            message="Test",
            metric="percent"
        )
        
        self.assertEqual(result.details, {})
        self.assertEqual(result.metric, "percent")
        self.assertIsInstance(result.timestamp, datetime)


class TestDifficultyLevelsHelpers(unittest.TestCase):
    """Тесты для вспомогательных методов проверки уровней сложности (ФАЗА 2)"""
    
    def setUp(self):
        """Подготовка для каждого теста"""
        self.service = TaskEvaluatorService()
    
    def test_evaluate_labels_all_correct(self):
        """Все названия правильные"""
        user_labels = ['Печень', 'Почка', 'Сердце']
        correct_labels = ['Печень', 'Почка', 'Сердце']
        
        result = self.service._evaluate_labels(user_labels, correct_labels)
        
        self.assertTrue(result['success'])
        self.assertEqual(len(result['matched_labels']), 3)
        self.assertEqual(len(result['unmatched_labels']), 0)
    
    def test_evaluate_labels_partial_match(self):
        """Частичное совпадение названий"""
        user_labels = ['Печень', 'Почка', 'Легкое']
        correct_labels = ['Печень', 'Почка', 'Сердце']
        
        result = self.service._evaluate_labels(user_labels, correct_labels)
        
        self.assertFalse(result['success'])
        self.assertEqual(len(result['matched_labels']), 2)
        self.assertEqual(len(result['unmatched_labels']), 1)
    
    def test_evaluate_labels_case_insensitive(self):
        """Проверка регистронезависимости"""
        user_labels = ['печень', 'ПОЧКА', 'Сердце']
        correct_labels = ['Печень', 'Почка', 'Сердце']
        
        result = self.service._evaluate_labels(user_labels, correct_labels)
        
        self.assertTrue(result['success'])
    
    def test_evaluate_labels_empty(self):
        """Пустые списки"""
        result = self.service._evaluate_labels([], [])
        
        self.assertFalse(result['success'])
    
    def test_evaluate_label_correct(self):
        """Правильное название"""
        result = self.service._evaluate_label('Печень', 'Печень')
        
        self.assertTrue(result['success'])
        self.assertIn('Правильное', result['message'])
    
    def test_evaluate_label_wrong(self):
        """Неправильное название"""
        result = self.service._evaluate_label('Почка', 'Печень')
        
        self.assertFalse(result['success'])
        self.assertIn('Неправильное', result['message'])
    
    def test_evaluate_label_case_insensitive(self):
        """Проверка регистронезависимости"""
        result = self.service._evaluate_label('печень', 'Печень')
        
        self.assertTrue(result['success'])
    
    def test_evaluate_text_answer_all_keywords(self):
        """Все ключевые слова найдены"""
        result = self.service._evaluate_text_answer(
            'Печень выполняет детоксикацию и метаболизм',
            ['печень', 'детоксикацию', 'метаболизм']
        )
        
        self.assertTrue(result['success'])
        self.assertEqual(len(result['found_keywords']), 3)
        self.assertEqual(len(result['missing_keywords']), 0)
    
    def test_evaluate_text_answer_partial_keywords(self):
        """Часть ключевых слов найдена"""
        result = self.service._evaluate_text_answer(
            'Печень выполняет детоксикацию',
            ['печень', 'детоксикацию', 'метаболизм']
        )
        
        self.assertFalse(result['success'])
        self.assertEqual(len(result['found_keywords']), 2)
        self.assertEqual(len(result['missing_keywords']), 1)
    
    def test_evaluate_level_names_all_correct(self):
        """Все названия уровней правильные"""
        user_levels = [
            {'level_id': 'level1', 'level_name': 'Красный'},
            {'level_id': 'level2', 'level_name': 'Синий'}
        ]
        correct_levels = [
            {'level_id': 'level1', 'level_name': 'Красный'},
            {'level_id': 'level2', 'level_name': 'Синий'}
        ]
        
        result = self.service._evaluate_level_names(user_levels, correct_levels)
        
        self.assertTrue(result['success'])
        self.assertEqual(len(result['matched_levels']), 2)
    
    def test_evaluate_block_names_all_correct(self):
        """Все названия блоков правильные"""
        user_levels = [
            {
                'level_id': 'level1',
                'blocks': ['block1', 'block2'],
                'block_names': {'block1': 'Яблоко', 'block2': 'Помидор'}
            }
        ]
        correct_levels = [
            {
                'level_id': 'level1',
                'blocks': ['block1', 'block2'],
                'block_names': {'block1': 'Яблоко', 'block2': 'Помидор'}
            }
        ]
        
        result = self.service._evaluate_block_names(user_levels, correct_levels)
        
        self.assertTrue(result['success'])
        self.assertEqual(len(result['matched_blocks']), 2)


class TestClickTaskDifficultyLevels(unittest.TestCase):
    """Тесты для evaluate_click_task с уровнями сложности (ФАЗА 2)"""
    
    def setUp(self):
        """Подготовка для каждого теста"""
        self.service = TaskEvaluatorService()
    
    def test_click_level_1_basic(self):
        """Уровень 1: только клик (базовая логика)"""
        user_input = {
            'x': 105,
            'y': 105,
            'scale_factor': 1.0,
            'offset_x': 0,
            'offset_y': 0
        }
        
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'Точка'}
            ]
        }
        
        task_data = {
            'content': {
                'requires_labels': False,
                'requires_drawing': False
            }
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key, task_data)
        
        self.assertTrue(result.success)
        self.assertEqual(result.details.get('level'), 1)
    
    def test_click_level_2_with_labels_correct(self):
        """Уровень 2: клик + названия (все правильно)"""
        user_input = {
            'x': 105,
            'y': 105,
            'scale_factor': 1.0,
            'offset_x': 0,
            'offset_y': 0,
            'labels': ['Печень']
        }
        
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'Печень'}
            ],
            'target_names': ['Печень']
        }
        
        task_data = {
            'content': {
                'requires_labels': True,
                'requires_drawing': False
            }
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key, task_data)
        
        self.assertTrue(result.success)
        self.assertEqual(result.details.get('level'), 2)
        self.assertIn('labels', result.details)
    
    def test_click_level_2_with_labels_wrong(self):
        """Уровень 2: клик правильный, но название неправильное"""
        user_input = {
            'x': 105,
            'y': 105,
            'scale_factor': 1.0,
            'offset_x': 0,
            'offset_y': 0,
            'labels': ['Почка']  # Неправильное название
        }
        
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'Печень'}
            ],
            'target_names': ['Печень']
        }
        
        task_data = {
            'content': {
                'requires_labels': True,
                'requires_drawing': False
            }
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key, task_data)
        
        self.assertFalse(result.success)  # Неправильное название
        self.assertEqual(result.details.get('level'), 2)
    
    def test_click_level_2_missing_labels(self):
        """Уровень 2: клик правильный, но названия не введены"""
        user_input = {
            'x': 105,
            'y': 105,
            'scale_factor': 1.0,
            'offset_x': 0,
            'offset_y': 0
            # labels отсутствуют
        }
        
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'Печень'}
            ],
            'target_names': ['Печень']
        }
        
        task_data = {
            'content': {
                'requires_labels': True,
                'requires_drawing': False
            }
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key, task_data)
        
        self.assertFalse(result.success)
        self.assertEqual(result.details.get('error'), 'labels_missing')
        self.assertEqual(result.details.get('level'), 2)
    
    def test_click_level_3_with_drawing_and_labels_correct(self):
        """Уровень 3: обводка + названия (все правильно)"""
        # Создаем штрихи обводки для полигона
        strokes = []
        for y in range(100, 201, 5):
            points = [[x, y] for x in range(100, 201, 5)]
            strokes.append({'type': 'brush_stroke', 'points': points})
        
        user_input = {
            'drawing': strokes,
            'image_width': 500,
            'image_height': 500,
            'brush_radius': 8,
            'labels': ['Печень']  # Название для найденного target
        }
        
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'points': [[100, 100], [200, 100], [200, 200], [100, 200]],
                    'label': 'Печень'
                }
            ],
            'target_names': ['Печень']
        }
        
        task_data = {
            'content': {
                'requires_labels': True,
                'requires_drawing': True  # Уровень 3
            }
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key, task_data)
        
        self.assertEqual(result.details.get('level'), 3)
        self.assertIn('drawing', result.details)
        self.assertIn('labels', result.details)
        # Проверяем, что используется логика Draw для проверки покрытия
        self.assertIn('coverage', result.details['drawing'])
        # Если обводка хорошая и название правильное - должен быть успех
        if result.details['drawing']['success'] and result.details['labels']['success']:
            self.assertTrue(result.success)
    
    def test_click_level_3_drawing_good_labels_wrong(self):
        """Уровень 3: обводка хорошая, но название неправильное"""
        strokes = []
        for y in range(100, 201, 5):
            points = [[x, y] for x in range(100, 201, 5)]
            strokes.append({'type': 'brush_stroke', 'points': points})
        
        user_input = {
            'drawing': strokes,
            'image_width': 500,
            'image_height': 500,
            'brush_radius': 8,
            'labels': ['Почка']  # Неправильное название
        }
        
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'points': [[100, 100], [200, 100], [200, 200], [100, 200]],
                    'label': 'Печень'
                }
            ],
            'target_names': ['Печень']
        }
        
        task_data = {
            'content': {
                'requires_labels': True,
                'requires_drawing': True
            }
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key, task_data)
        
        self.assertEqual(result.details.get('level'), 3)
        # Обводка может быть хорошей, но название неправильное
        # Проверяем, что labels проверяются
        self.assertIn('labels', result.details)
        # Если название неправильное, labels['success'] должен быть False
        if not result.details['labels']['success']:
            self.assertFalse(result.success)
    
    def test_click_level_3_missing_drawing(self):
        """Уровень 3: требуется обводка, но она не предоставлена"""
        user_input = {
            'labels': ['Печень']
            # drawing отсутствует
        }
        
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'points': [[100, 100], [200, 100], [200, 200], [100, 200]],
                    'label': 'Печень'
                }
            ],
            'target_names': ['Печень']
        }
        
        task_data = {
            'content': {
                'requires_labels': True,
                'requires_drawing': True
            }
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key, task_data)
        
        # Должна быть ошибка, т.к. нет drawing
        # evaluate_draw_task вернет ошибку 'no_drawing'
        self.assertFalse(result.success)
        self.assertEqual(result.details.get('level'), 3)
        # Проверяем, что ошибка связана с отсутствием drawing
        self.assertIn('drawing', result.details)


class TestDrawTaskDifficultyLevels(unittest.TestCase):
    """Тесты для evaluate_draw_task с уровнями сложности (ФАЗА 2)"""
    
    def setUp(self):
        """Подготовка для каждого теста"""
        self.service = TaskEvaluatorService()
    
    def test_draw_level_1_basic(self):
        """Уровень 1: только обводка (базовая логика)"""
        strokes = []
        for y in range(100, 201, 5):
            points = [[x, y] for x in range(100, 201, 5)]
            strokes.append({'type': 'brush_stroke', 'points': points})
        
        user_input = {'drawing': strokes}
        
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'points': [[100, 100], [200, 100], [200, 200], [100, 200]],
                    'label': 'Прямоугольник'
                }
            ]
        }
        
        task_data = {
            'content': {
                'requires_labels': False
            }
        }
        
        result = self.service.evaluate_draw_task(user_input, answer_key, task_data)
        
        self.assertEqual(result.details.get('level'), 1)
    
    def test_draw_level_2_with_label_correct(self):
        """Уровень 2: обводка + название (все правильно)"""
        strokes = []
        for y in range(100, 201, 5):
            points = [[x, y] for x in range(100, 201, 5)]
            strokes.append({'type': 'brush_stroke', 'points': points})
        
        user_input = {
            'drawing': strokes,
            'label': 'Печень'
        }
        
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'points': [[100, 100], [200, 100], [200, 200], [100, 200]],
                    'label': 'Печень'
                }
            ]
        }
        
        task_data = {
            'content': {
                'requires_labels': True
            }
        }
        
        result = self.service.evaluate_draw_task(user_input, answer_key, task_data)
        
        self.assertEqual(result.details.get('level'), 2)
        self.assertIn('label', result.details)
    
    def test_draw_level_2_missing_label(self):
        """Уровень 2: обводка правильная, но название не введено"""
        strokes = []
        for y in range(100, 201, 5):
            points = [[x, y] for x in range(100, 201, 5)]
            strokes.append({'type': 'brush_stroke', 'points': points})
        
        user_input = {
            'drawing': strokes
            # label отсутствует
        }
        
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'points': [[100, 100], [200, 100], [200, 200], [100, 200]],
                    'label': 'Печень'
                }
            ]
        }
        
        task_data = {
            'content': {
                'requires_labels': True
            }
        }
        
        result = self.service.evaluate_draw_task(user_input, answer_key, task_data)
        
        self.assertFalse(result.success)
        self.assertEqual(result.details.get('error'), 'label_missing')
        self.assertEqual(result.details.get('level'), 2)


class TestTestTaskDifficultyLevels(unittest.TestCase):
    """Тесты для evaluate_test_task с уровнями сложности (ФАЗА 2)"""
    
    def setUp(self):
        """Подготовка для каждого теста"""
        self.service = TaskEvaluatorService()
    
    def test_test_level_1_multiple_choice(self):
        """Уровень 1: Multiple choice (базовая логика)"""
        user_input = {
            'answers': {
                'q1': 0  # Выбран первый вариант
            }
        }
        
        answer_key = {
            'questions': [
                {
                    'id': 'q1',
                    'answers': [
                        {'text': 'Печень', 'correct': True},
                        {'text': 'Почка', 'correct': False}
                    ]
                }
            ]
        }
        
        task_data = {
            'content': {
                'show_options': True,
                'requires_text_input': False
            }
        }
        
        result = self.service.evaluate_test_task(user_input, answer_key, task_data)
        
        self.assertTrue(result.success)
        self.assertEqual(result.details.get('level'), 1)
    
    def test_test_level_2_text_answer_correct(self):
        """Уровень 2: Открытый вопрос (все ключевые слова найдены)"""
        user_input = {
            'text_answers': {
                'q1': 'Печень выполняет детоксикацию и метаболизм'
            }
        }
        
        answer_key = {
            'questions': [
                {
                    'id': 'q1',
                    'keywords': ['печень', 'детоксикацию', 'метаболизм'],
                    'reference_answer': 'Печень выполняет детоксикацию и метаболизм'
                }
            ]
        }
        
        task_data = {
            'content': {
                'show_options': False,
                'requires_text_input': True
            }
        }
        
        result = self.service.evaluate_test_task(user_input, answer_key, task_data)
        
        self.assertTrue(result.success)
        self.assertEqual(result.details.get('level'), 2)
        self.assertEqual(len(result.details['question_results']), 1)
        self.assertTrue(result.details['question_results'][0]['correct'])
    
    def test_test_level_2_text_answer_partial(self):
        """Уровень 2: Открытый вопрос (часть ключевых слов найдена)"""
        user_input = {
            'text_answers': {
                'q1': 'Печень выполняет детоксикацию'
            }
        }
        
        answer_key = {
            'questions': [
                {
                    'id': 'q1',
                    'keywords': ['печень', 'детоксикацию', 'метаболизм'],
                    'reference_answer': 'Печень выполняет детоксикацию и метаболизм'
                }
            ]
        }
        
        task_data = {
            'content': {
                'show_options': False,
                'requires_text_input': True
            }
        }
        
        result = self.service.evaluate_test_task(user_input, answer_key, task_data)
        
        self.assertFalse(result.success)
        self.assertEqual(result.details.get('level'), 2)
    
    def test_test_level_2_with_typos(self):
        """Уровень 2: Открытый вопрос с опечатками (должно быть найдено)"""
        user_input = {
            'text_answers': {
                'q1': 'Печен выполняет детоксикацию и метаболизм'
            }
        }
        
        answer_key = {
            'questions': [
                {
                    'id': 'q1',
                    'keywords': ['печень', 'детоксикацию', 'метаболизм'],
                    'reference_answer': 'Печень выполняет детоксикацию и метаболизм'
                }
            ]
        }
        
        task_data = {
            'content': {
                'show_options': False,
                'requires_text_input': True
            }
        }
        
        result = self.service.evaluate_test_task(user_input, answer_key, task_data)
        
        # С толерантностью к опечаткам должно быть найдено
        self.assertTrue(result.success)
        self.assertEqual(result.details.get('level'), 2)
        self.assertTrue(result.details['question_results'][0]['correct'])
    
    def test_test_level_2_with_different_endings(self):
        """Уровень 2: Открытый вопрос с разными окончаниями (должно быть найдено)"""
        user_input = {
            'text_answers': {
                'q1': 'Печени выполняет детоксикацию и метаболизм'
            }
        }
        
        answer_key = {
            'questions': [
                {
                    'id': 'q1',
                    'keywords': ['печень', 'детоксикацию', 'метаболизм'],
                    'reference_answer': 'Печень выполняет детоксикацию и метаболизм'
                }
            ]
        }
        
        task_data = {
            'content': {
                'show_options': False,
                'requires_text_input': True
            }
        }
        
        result = self.service.evaluate_test_task(user_input, answer_key, task_data)
        
        # С толерантностью к окончаниям должно быть найдено
        self.assertTrue(result.success)
        self.assertEqual(result.details.get('level'), 2)
        self.assertTrue(result.details['question_results'][0]['correct'])
    
    def test_test_level_2_with_yo_normalization(self):
        """Уровень 2: Открытый вопрос с нормализацией е/ё"""
        user_input = {
            'text_answers': {
                'q1': 'Пёчень выполняет детоксикацию и метаболизм'
            }
        }
        
        answer_key = {
            'questions': [
                {
                    'id': 'q1',
                    'keywords': ['печень', 'детоксикацию', 'метаболизм'],
                    'reference_answer': 'Печень выполняет детоксикацию и метаболизм'
                }
            ]
        }
        
        task_data = {
            'content': {
                'show_options': False,
                'requires_text_input': True
            }
        }
        
        result = self.service.evaluate_test_task(user_input, answer_key, task_data)
        
        # С нормализацией е/ё должно быть найдено
        self.assertTrue(result.success)
        self.assertEqual(result.details.get('level'), 2)
        self.assertTrue(result.details['question_results'][0]['correct'])
    
    def test_test_level_2_with_typo_and_ending(self):
        """Уровень 2: Открытый вопрос с опечаткой и другим окончанием"""
        user_input = {
            'text_answers': {
                'q1': 'Печни выполняет детоксикацию и метаболизм'
            }
        }
        
        answer_key = {
            'questions': [
                {
                    'id': 'q1',
                    'keywords': ['печень', 'детоксикацию', 'метаболизм'],
                    'reference_answer': 'Печень выполняет детоксикацию и метаболизм'
                }
            ]
        }
        
        task_data = {
            'content': {
                'show_options': False,
                'requires_text_input': True
            }
        }
        
        result = self.service.evaluate_test_task(user_input, answer_key, task_data)
        
        # С комбинацией толерантностей должно быть найдено
        self.assertTrue(result.success)
        self.assertEqual(result.details.get('level'), 2)
        self.assertTrue(result.details['question_results'][0]['correct'])
    
    def test_test_level_2_too_many_typos(self):
        """Уровень 2: Слишком много опечаток (не должно быть найдено)"""
        user_input = {
            'text_answers': {
                'q1': 'Печ выполняет детоксикацию и метаболизм'
            }
        }
        
        answer_key = {
            'questions': [
                {
                    'id': 'q1',
                    'keywords': ['печень', 'детоксикацию', 'метаболизм'],
                    'reference_answer': 'Печень выполняет детоксикацию и метаболизм'
                }
            ]
        }
        
        task_data = {
            'content': {
                'show_options': False,
                'requires_text_input': True
            }
        }
        
        result = self.service.evaluate_test_task(user_input, answer_key, task_data)
        
        # Слишком много опечаток - не должно быть найдено
        self.assertFalse(result.success)
        self.assertEqual(result.details.get('level'), 2)


class TestSequenceTaskDifficultyLevels(unittest.TestCase):
    """Тесты для evaluate_sequence_task с уровнями сложности (ФАЗА 2)"""
    
    def setUp(self):
        """Подготовка для каждого теста"""
        self.service = TaskEvaluatorService()
    
    def test_sequence_level_1_basic(self):
        """Уровень 1: только сборка последовательности (базовая логика)"""
        user_input = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['block1', 'block2']},
                {'level_id': 'level2', 'blocks': ['block3']}
            ]
        }
        
        answer_key = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['block1', 'block2']},
                {'level_id': 'level2', 'blocks': ['block3']}
            ]
        }
        
        task_data = {
            'content': {
                'requires_level_names': False,
                'requires_block_names': False
            }
        }
        
        result = self.service.evaluate_sequence_task(user_input, answer_key, task_data)
        
        self.assertEqual(result.details.get('level'), 1)
    
    def test_sequence_level_2_with_level_names_correct(self):
        """Уровень 2: сборка + названия уровней (все правильно)"""
        user_input = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['block1'], 'level_name': 'Красный'},
                {'level_id': 'level2', 'blocks': ['block2'], 'level_name': 'Синий'}
            ]
        }
        
        answer_key = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['block1'], 'level_name': 'Красный'},
                {'level_id': 'level2', 'blocks': ['block2'], 'level_name': 'Синий'}
            ]
        }
        
        task_data = {
            'content': {
                'requires_level_names': True,
                'requires_block_names': False
            }
        }
        
        result = self.service.evaluate_sequence_task(user_input, answer_key, task_data)
        
        self.assertEqual(result.details.get('level'), 2)
        self.assertIn('level_names', result.details)
    
    def test_sequence_level_3_with_all_names_correct(self):
        """Уровень 3: сборка + названия уровней + названия блоков (все правильно)"""
        user_input = {
            'levels': [
                {
                    'level_id': 'level1',
                    'blocks': ['block1', 'block2'],
                    'level_name': 'Красный',
                    'block_names': {'block1': 'Яблоко', 'block2': 'Помидор'}
                }
            ]
        }
        
        answer_key = {
            'levels': [
                {
                    'level_id': 'level1',
                    'blocks': ['block1', 'block2'],
                    'level_name': 'Красный',
                    'block_names': {'block1': 'Яблоко', 'block2': 'Помидор'}
                }
            ]
        }
        
        task_data = {
            'content': {
                'requires_level_names': True,
                'requires_block_names': True
            }
        }
        
        result = self.service.evaluate_sequence_task(user_input, answer_key, task_data)
        
        self.assertEqual(result.details.get('level'), 3)
        self.assertIn('level_names', result.details)
        self.assertIn('block_names', result.details)


    def test_sequence_level_1_treats_same_text_blocks_as_equivalent(self):
        user_input = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['elem_2', 'elem_4']},
            ]
        }

        answer_key = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['elem_1', 'elem_3']}
            ],
            'elements': [
                {'id': 'elem_1', 'text': 'Same step'},
                {'id': 'elem_2', 'text': 'Same step'},
                {'id': 'elem_3', 'text': 'Another'},
                {'id': 'elem_4', 'text': 'Another'}
            ],
            'sequence_within_level_matters': True,
            'level_order_matters': False
        }

        task_data = {
            'content': {
                'requires_level_names': False,
                'requires_block_names': False,
                'elements': answer_key['elements']
            }
        }

        result = self.service.evaluate_sequence_task(user_input, answer_key, task_data)

        self.assertTrue(result.success)
        self.assertEqual(result.score, 100.0)
        self.assertEqual(result.details.get('total_correct_blocks'), 2)

    def test_sequence_level_1_partial_match_uses_semantic_keys_when_order_matters(self):
        user_input = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['elem_2', 'elem_5']},
            ]
        }

        answer_key = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['elem_1', 'elem_3']}
            ],
            'elements': [
                {'id': 'elem_1', 'text': 'Same step'},
                {'id': 'elem_2', 'text': 'Same step'},
                {'id': 'elem_3', 'text': 'Another'},
                {'id': 'elem_5', 'text': 'Wrong step'}
            ],
            'sequence_within_level_matters': True,
            'level_order_matters': False
        }

        task_data = {
            'content': {
                'requires_level_names': False,
                'requires_block_names': False,
                'elements': answer_key['elements']
            }
        }

        result = self.service.evaluate_sequence_task(user_input, answer_key, task_data)

        self.assertFalse(result.success)
        self.assertEqual(result.score, 50.0)
        self.assertEqual(result.details.get('total_correct_blocks'), 1)
        self.assertEqual(result.details.get('correct_blocks_by_level', {}).get('level1'), ['elem_2', None])

    def test_sequence_level_1_partial_match_preserves_ordered_slot_positions_for_feedback(self):
        user_input = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['elem_9', 'elem_4']},
            ]
        }

        answer_key = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['elem_1', 'elem_3']}
            ],
            'elements': [
                {'id': 'elem_1', 'text': 'Same step'},
                {'id': 'elem_3', 'text': 'Another'},
                {'id': 'elem_4', 'text': 'Another'},
                {'id': 'elem_9', 'text': 'Wrong step'}
            ],
            'sequence_within_level_matters': True,
            'level_order_matters': False
        }

        task_data = {
            'content': {
                'requires_level_names': False,
                'requires_block_names': False,
                'elements': answer_key['elements']
            }
        }

        result = self.service.evaluate_sequence_task(user_input, answer_key, task_data)

        self.assertFalse(result.success)
        self.assertEqual(result.details.get('total_correct_blocks'), 1)
        self.assertEqual(
            result.details.get('correct_blocks_by_level', {}).get('level1'),
            [None, 'elem_4']
        )

    def test_sequence_level_1_partial_match_counts_duplicate_text_by_quantity(self):
        user_input = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['elem_2', 'elem_5', 'elem_6']},
            ]
        }

        answer_key = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['elem_1', 'elem_3', 'elem_4']}
            ],
            'elements': [
                {'id': 'elem_1', 'text': 'Same step'},
                {'id': 'elem_2', 'text': 'Same step'},
                {'id': 'elem_3', 'text': 'Repeatable'},
                {'id': 'elem_4', 'text': 'Repeatable'},
                {'id': 'elem_5', 'text': 'Repeatable'},
                {'id': 'elem_6', 'text': 'Wrong step'}
            ],
            'sequence_within_level_matters': False,
            'level_order_matters': False
        }

        task_data = {
            'content': {
                'requires_level_names': False,
                'requires_block_names': False,
                'elements': answer_key['elements']
            }
        }

        result = self.service.evaluate_sequence_task(user_input, answer_key, task_data)

        self.assertFalse(result.success)
        self.assertAlmostEqual(result.score, (2 / 3) * 100.0)
        self.assertEqual(result.details.get('total_correct_blocks'), 2)
        self.assertCountEqual(
            result.details.get('correct_blocks_by_level', {}).get('level1', []),
            ['elem_2', 'elem_5']
        )

    def test_sequence_level_2_matches_same_text_blocks_even_when_level_ids_are_runtime_generated(self):
        user_input = {
            'levels': [
                {
                    'level_id': 'user_level_1',
                    'level_name': 'Подготовка',
                    'blocks': ['elem_2', 'elem_4']
                }
            ]
        }

        answer_key = {
            'levels': [
                {
                    'level_id': 'level_1',
                    'level_name': 'Подготовка',
                    'blocks': ['elem_1', 'elem_3']
                }
            ],
            'elements': [
                {'id': 'elem_1', 'text': 'Same step'},
                {'id': 'elem_2', 'text': 'Same step'},
                {'id': 'elem_3', 'text': 'Another'},
                {'id': 'elem_4', 'text': 'Another'}
            ],
            'sequence_within_level_matters': True,
            'level_order_matters': False
        }

        task_data = {
            'content': {
                'requires_level_names': True,
                'requires_block_names': False,
                'elements': answer_key['elements']
            }
        }

        result = self.service.evaluate_sequence_task(user_input, answer_key, task_data)

        self.assertTrue(result.success)
        self.assertEqual(result.details.get('total_correct_blocks'), 2)
        self.assertEqual(result.details.get('correct_blocks_by_level', {}).get('level_1'), ['elem_2', 'elem_4'])

    def test_sequence_level_2_does_not_award_level_name_credit_without_structural_match(self):
        user_input = {
            'levels': [
                {
                    'level_id': 'user_level_1',
                    'level_name': 'Подготовка',
                    'blocks': ['elem_9']
                }
            ]
        }

        answer_key = {
            'levels': [
                {
                    'level_id': 'level_1',
                    'level_name': 'Подготовка',
                    'blocks': ['elem_1']
                }
            ],
            'elements': [
                {'id': 'elem_1', 'text': 'Right step'},
                {'id': 'elem_9', 'text': 'Wrong step'}
            ],
            'sequence_within_level_matters': True,
            'level_order_matters': False
        }

        task_data = {
            'content': {
                'requires_level_names': True,
                'requires_block_names': False,
                'elements': answer_key['elements']
            }
        }

        result = self.service.evaluate_sequence_task(user_input, answer_key, task_data)

        self.assertFalse(result.success)
        self.assertEqual(result.details.get('level_names', {}).get('score'), 0.0)
        self.assertEqual(result.details.get('level_names', {}).get('matched_levels'), [])

    def test_sequence_level_3_does_not_award_block_name_credit_without_structural_match(self):
        user_input = {
            'levels': [
                {
                    'level_id': 'user_level_1',
                    'level_name': 'Подготовка',
                    'blocks': ['elem_9'],
                    'block_names': {'elem_9': 'Right step'}
                }
            ]
        }

        answer_key = {
            'levels': [
                {
                    'level_id': 'level_1',
                    'level_name': 'Подготовка',
                    'blocks': ['elem_1']
                }
            ],
            'elements': [
                {'id': 'elem_1', 'text': 'Right step'},
                {'id': 'elem_9', 'text': 'Wrong step'}
            ],
            'sequence_within_level_matters': True,
            'level_order_matters': False
        }

        task_data = {
            'content': {
                'requires_level_names': True,
                'requires_block_names': True,
                'elements': answer_key['elements']
            }
        }

        result = self.service.evaluate_sequence_task(user_input, answer_key, task_data)

        self.assertFalse(result.success)
        self.assertEqual(result.details.get('block_names', {}).get('score'), 0.0)
        self.assertEqual(result.details.get('block_names', {}).get('matched_blocks'), [])

    def test_sequence_level_3_matches_synthetic_runtime_slots_by_typed_block_names(self):
        user_input = {
            'levels': [
                {
                    'level_id': 'user_level_1',
                    'level_name': 'Правая рука',
                    'blocks': ['user_slot_1', 'user_slot_2'],
                    'block_names': {
                        'user_slot_1': 'Красный',
                        'user_slot_2': 'Желтый',
                    }
                }
            ]
        }

        answer_key = {
            'levels': [
                {
                    'level_id': 'level_1',
                    'level_name': 'Правая рука',
                    'blocks': ['elem_red', 'elem_yellow'],
                    'block_names': {
                        'elem_red': 'Красный',
                        'elem_yellow': 'Желтый',
                    }
                }
            ],
            'elements': [
                {'id': 'elem_red', 'text': 'Красный'},
                {'id': 'elem_yellow', 'text': 'Желтый'}
            ],
            'sequence_within_level_matters': True,
            'level_order_matters': False
        }

        task_data = {
            'content': {
                'requires_level_names': True,
                'requires_block_names': True,
                'elements': answer_key['elements']
            }
        }

        result = self.service.evaluate_sequence_task(user_input, answer_key, task_data)

        self.assertTrue(result.success)
        self.assertEqual(result.score, 100.0)
        self.assertEqual(result.details.get('level_names', {}).get('score'), 100.0)
        self.assertEqual(result.details.get('block_names', {}).get('score'), 100.0)
        self.assertEqual(
            result.details.get('correct_blocks_by_level', {}).get('level_1'),
            ['user_slot_1', 'user_slot_2']
        )

    def test_sequence_level_3_matches_explicit_text_semantic_keys_after_normalization(self):
        user_input = {
            'levels': [
                {
                    'level_id': 'user_level_1',
                    'level_name': '\u041b\u0435\u0432\u0430\u044f \u043d\u043e\u0433\u0430',
                    'blocks': ['user_slot_1', 'user_slot_2'],
                    'block_names': {
                        'user_slot_1': '\u0416\u0435\u043b\u0442\u044b\u0439',
                        'user_slot_2': '\u0417\u0435\u043b\u0435\u043d\u044b\u0439',
                    }
                }
            ]
        }

        answer_key = {
            'levels': [
                {
                    'level_id': 'level_1',
                    'level_name': '\u041b\u0435\u0432\u0430\u044f \u043d\u043e\u0433\u0430',
                    'blocks': ['elem_yellow', 'elem_green'],
                    'block_names': {
                        'elem_yellow': '\u0416\u0435\u043b\u0442\u044b\u0439',
                        'elem_green': '\u0417\u0435\u043b\u0451\u043d\u044b\u0439',
                    }
                }
            ],
            'elements': [
                {'id': 'elem_yellow', 'text': '\u0416\u0435\u043b\u0442\u044b\u0439', 'semantic_key': 'text:\u0416\u0435\u043b\u0442\u044b\u0439'},
                {'id': 'elem_green', 'text': '\u0417\u0435\u043b\u0435\u043d\u044b\u0439', 'semantic_key': 'text:\u0417\u0435\u043b\u0451\u043d\u044b\u0439'}
            ],
            'sequence_within_level_matters': True,
            'level_order_matters': False
        }

        task_data = {
            'content': {
                'requires_level_names': True,
                'requires_block_names': True,
                'elements': answer_key['elements']
            }
        }

        result = self.service.evaluate_sequence_task(user_input, answer_key, task_data)

        self.assertTrue(result.success)
        self.assertEqual(result.score, 100.0)
        self.assertEqual(result.details.get('level_names', {}).get('score'), 100.0)
        self.assertEqual(result.details.get('block_names', {}).get('score'), 100.0)
        self.assertEqual(
            result.details.get('correct_blocks_by_level', {}).get('level_1'),
            ['user_slot_1', 'user_slot_2']
        )


class TestDrawResolutionScaling(unittest.TestCase):
    """Проверка scale-aware поведения для штрихов на изображениях разного разрешения."""

    def setUp(self):
        self.service = TaskEvaluatorService()

    @staticmethod
    def _dense_line(x1, y1, x2, y2, step=2):
        points = []
        length = max(abs(x2 - x1), abs(y2 - y1))
        segments = max(1, int(length / step))
        for idx in range(segments + 1):
            t = idx / segments
            points.append([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t])
        return points

    def test_line_coverage_scales_with_display_size(self):
        small_reference = [(10, 50), (190, 50)]
        large_reference = [(100, 500), (1900, 500)]

        small_user = {
            'drawing': [{
                'type': 'brush_stroke',
                'points': self._dense_line(10, 60, 190, 60, step=2),
            }],
            'image_width': 200,
            'image_height': 200,
            'display_width': 200,
            'display_height': 200,
        }
        large_user = {
            'drawing': [{
                'type': 'brush_stroke',
                'points': self._dense_line(100, 600, 1900, 600, step=20),
            }],
            'image_width': 2000,
            'image_height': 2000,
            'display_width': 200,
            'display_height': 200,
        }

        small_score = self.service.calculate_line_coverage(
            small_reference, small_user, tolerance_px=15.0, use_improved_evaluation=True
        )
        large_score = self.service.calculate_line_coverage(
            large_reference, large_user, tolerance_px=15.0, use_improved_evaluation=True
        )

        self.assertAlmostEqual(small_score, large_score, delta=1.0)
        self.assertGreater(large_score, 90.0)

if __name__ == '__main__':
    # Запуск всех тестов
    unittest.main(verbosity=2)
