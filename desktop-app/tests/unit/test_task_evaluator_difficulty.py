"""
Дополнительные unit-тесты для TaskEvaluatorService с поддержкой уровней сложности (Фаза 2).

Дополняет существующие тесты в test_task_evaluator.py.
"""

import unittest
import sys
from pathlib import Path

# Добавляем пути для импорта
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.task_evaluator_service import TaskEvaluatorService, EvaluationResult


class TestTaskEvaluatorDifficultyAdditional(unittest.TestCase):
    """Дополнительные тесты для TaskEvaluatorService с уровнями сложности"""
    
    def setUp(self):
        """Подготовка для каждого теста"""
        self.service = TaskEvaluatorService()
    
    def test_click_level_2_combined_evaluation(self):
        """Тест комбинированной оценки уровня 2: 70% клик + 30% labels"""
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
        
        # Проверяем, что используется комбинированная оценка
        self.assertIn('labels', result.details)
        self.assertIn('found_targets', result.details)
        self.assertEqual(result.details.get('level'), 2)
        
        # Проверяем, что оба компонента оценены
        labels_result = result.details.get('labels', {})
        found_targets = result.details.get('found_targets', [])
        
        self.assertIsNotNone(labels_result)
        self.assertIsInstance(found_targets, list)
        self.assertGreater(len(found_targets), 0)  # Должна быть найдена хотя бы одна цель
        
        # Итоговый score должен учитывать оба компонента (70% клик + 30% labels)
        if result.success:
            self.assertGreater(result.score, 70.0)  # Комбинация должна дать хороший результат
    
    def test_click_level_3_combined_evaluation(self):
        """Тест комбинированной оценки уровня 3: 70% обводка + 30% labels"""
        # Создаем штрихи обводки
        strokes = []
        for y in range(100, 201, 5):
            points = [[x, y] for x in range(100, 201, 5)]
            strokes.append({'type': 'brush_stroke', 'points': points})
        
        user_input = {
            'drawing': strokes,
            'image_width': 500,
            'image_height': 500,
            'brush_radius': 8,
            'labels': ['Печень']
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
        
        # Проверяем, что используется комбинированная оценка
        self.assertIn('drawing', result.details)
        self.assertIn('labels', result.details)
        self.assertEqual(result.details.get('level'), 3)
        
        # Проверяем, что оба компонента оценены
        drawing_result = result.details.get('drawing', {})
        labels_result = result.details.get('labels', {})
        
        self.assertIsNotNone(drawing_result)
        self.assertIsNotNone(labels_result)
        
        # Проверяем, что drawing содержит coverage
        if 'coverage' in drawing_result:
            self.assertGreaterEqual(drawing_result['coverage'], 0)
    
    def test_draw_level_2_with_label(self):
        """Тест evaluate_draw_task на уровне 2 с требованием label (draw задания не поддерживают уровень 3)"""
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
                'requires_labels': True,
                'requires_explanation': False  # Draw задания не поддерживают уровень 3
            }
        }
        
        result = self.service.evaluate_draw_task(user_input, answer_key, task_data)
        
        # Проверяем, что уровень 2 (draw задания не поддерживают уровень 3)
        self.assertEqual(result.details.get('level'), 2)
        # Проверяем, что label проверяется
        self.assertIn('label', result.details)
    
    def test_evaluate_task_safe_field_checking(self):
        """Тест безопасной проверки полей через .get()"""
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
        
        # task_data без полей сложности - должен работать с fallback
        task_data = {
            'content': {
                'type': 'click'
                # Нет requires_labels, requires_drawing
            }
        }
        
        # Не должно быть ошибки, должен работать как уровень 1
        result = self.service.evaluate_click_task(user_input, answer_key, task_data)
        
        self.assertIsInstance(result, EvaluationResult)
        # Должен работать без ошибок
    
    def test_evaluate_task_fallback_to_level_1(self):
        """Тест fallback на уровень 1 при отсутствии полей сложности"""
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
        
        # task_data без полей сложности
        task_data = {
            'content': {}
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key, task_data)
        
        # Должен работать как уровень 1 (только клик)
        self.assertIsInstance(result, EvaluationResult)
        # Не должно быть проверки labels или drawing
        if 'labels' in result.details:
            # Если labels проверяются, это ошибка для уровня 1
            self.fail("Labels не должны проверяться на уровне 1")
    
    def test_evaluate_task_handles_missing_task_data(self):
        """Тест обработки отсутствующего task_data"""
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
        
        # task_data = None - должен работать с fallback
        result = self.service.evaluate_click_task(user_input, answer_key, task_data=None)
        
        self.assertIsInstance(result, EvaluationResult)
        # Не должно быть ошибки
    
    def test_validate_user_input_level_2_requires_labels(self):
        """Тест валидации user_input для уровня 2 (требуются labels)"""
        # user_input без labels для уровня 2
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
        
        # Должна быть ошибка из-за отсутствия labels
        self.assertFalse(result.success)
        self.assertEqual(result.details.get('error'), 'labels_missing')
    
    def test_validate_user_input_level_3_requires_drawing(self):
        """Тест валидации user_input для уровня 3 (требуется drawing)"""
        # user_input без drawing для уровня 3
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
        
        # Должна быть ошибка из-за отсутствия drawing
        self.assertFalse(result.success)
        # Проверяем, что ошибка связана с отсутствием drawing
        if 'drawing' in result.details:
            drawing_error = result.details['drawing'].get('error')
            if drawing_error:
                self.assertEqual(drawing_error, 'no_drawing')
    
    def test_evaluate_click_task_with_partial_labels(self):
        """Тест оценки с частично правильными labels"""
        # Используем множественные клики для проверки двух целей
        user_input = {
            'clicks': [
                {'x': 105, 'y': 105, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0},
                {'x': 205, 'y': 205, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
            ],
            'labels': ['Печень', 'Почка']  # Два labels для двух targets (второй неправильный)
        }
        
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'Печень'},
                {'shape': 'point', 'coordinates': [200, 200], 'label': 'Сердце'}
            ],
            'target_names': ['Печень', 'Сердце']
        }
        
        task_data = {
            'content': {
                'requires_labels': True,
                'requires_drawing': False
            }
        }
        
        result = self.service.evaluate_click_task(user_input, answer_key, task_data)
        
        # Проверяем, что labels проверяются
        self.assertIn('labels', result.details)
        labels_result = result.details['labels']
        
        # Один label правильный (Печень), один неправильный (Почка вместо Сердце)
        if 'matched_labels' in labels_result:
            # Должен быть хотя бы один правильный label
            self.assertGreaterEqual(len(labels_result['matched_labels']), 1)
        if 'unmatched_labels' in labels_result:
            # Должен быть хотя бы один неправильный label
            self.assertGreaterEqual(len(labels_result['unmatched_labels']), 1)
    
    def test_evaluate_draw_task_level_2_label_wrong(self):
        """Тест evaluate_draw_task уровня 2 с неправильным label"""
        strokes = []
        for y in range(100, 201, 5):
            points = [[x, y] for x in range(100, 201, 5)]
            strokes.append({'type': 'brush_stroke', 'points': points})
        
        user_input = {
            'drawing': strokes,
            'label': 'Почка'  # Неправильное название
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
        
        # Проверяем, что label проверяется
        self.assertIn('label', result.details)
        label_result = result.details['label']
        
        # Неправильный label должен дать неудачу
        if 'success' in label_result:
            self.assertFalse(label_result['success'])
    
    def test_evaluate_test_task_level_2_missing_text_input(self):
        """Тест evaluate_test_task уровня 2 без text_input"""
        user_input = {
            # text_answers отсутствуют
        }
        
        answer_key = {
            'questions': [
                {
                    'id': 'q1',
                    'keywords': ['печень', 'детоксикацию'],
                    'reference_answer': 'Печень выполняет детоксикацию'
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
        
        # Должна быть ошибка из-за отсутствия text_input
        self.assertFalse(result.success)
        # Правильное название ошибки - 'no_text_answers'
        self.assertEqual(result.details.get('error'), 'no_text_answers')
    
    def test_evaluate_sequence_task_level_2_missing_level_names(self):
        """Тест evaluate_sequence_task уровня 2 без level_names"""
        user_input = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['block1']}
                # level_name отсутствует
            ]
        }
        
        answer_key = {
            'levels': [
                {'level_id': 'level1', 'blocks': ['block1'], 'level_name': 'Красный'}
            ]
        }
        
        task_data = {
            'content': {
                'requires_level_names': True,
                'requires_block_names': False
            }
        }
        
        result = self.service.evaluate_sequence_task(user_input, answer_key, task_data)

        # requires_level_names=True, но пользователь не указал level_name → неуспех,
        # даже если структура (blocks) совпала. Согласовано с L3-аналогом
        # (test_evaluate_sequence_task_level_3_missing_block_names): если названия
        # требуются, без них задание не засчитывается.
        self.assertFalse(result.success)
    
    def test_evaluate_sequence_task_level_3_missing_block_names(self):
        """Тест evaluate_sequence_task уровня 3 без block_names"""
        user_input = {
            'levels': [
                {
                    'level_id': 'level1',
                    'blocks': ['block1', 'block2'],
                    'level_name': 'Красный'
                    # block_names отсутствует
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
        
        # Должна быть неудача из-за отсутствия block_names
        # evaluate_sequence_task проверяет block_names через _evaluate_block_names
        # Если block_names отсутствует, он будет в unmatched_blocks
        self.assertFalse(result.success)
        # Проверяем, что block_names проверяются
        if 'block_names' in result.details:
            block_names_result = result.details['block_names']
            # Должны быть unmatched_blocks (отсутствующие названия)
            if 'unmatched_blocks' in block_names_result:
                self.assertGreater(len(block_names_result['unmatched_blocks']), 0)


if __name__ == '__main__':
    unittest.main()

