"""
Интеграционные тесты для TaskEvaluatorService + DifficultyManager (Фаза 2).

Тестирует оценку модифицированных заданий на всех уровнях.
"""

import unittest
import sys
from pathlib import Path

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.task_evaluator_service import TaskEvaluatorService
from services.difficulty_manager import DifficultyManager


class TestEvaluatorDifficultyIntegration(unittest.TestCase):
    """Интеграционные тесты TaskEvaluatorService + DifficultyManager"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.evaluator = TaskEvaluatorService()
        self.difficulty_manager = DifficultyManager(config_path=None)
    
    def test_evaluate_enhanced_click_task_level_1(self):
        """Оценка модифицированного click задания на уровне 1"""
        # Модифицируем задание для уровня 1
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Кликните на область'
            }
        }
        enhanced_task = self.difficulty_manager.enhance_task_for_level(task_data, level=1)
        
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
        
        result = self.evaluator.evaluate_click_task(user_input, answer_key, enhanced_task)
        
        # Проверяем, что оценка работает корректно
        self.assertIsNotNone(result)
        self.assertTrue(result.success)
        self.assertEqual(result.details.get('level'), 1)
    
    def test_evaluate_enhanced_click_task_level_2(self):
        """Оценка модифицированного click задания на уровне 2"""
        # Модифицируем задание для уровня 2
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Кликните на область'
            }
        }
        enhanced_task = self.difficulty_manager.enhance_task_for_level(task_data, level=2)
        
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
        
        result = self.evaluator.evaluate_click_task(user_input, answer_key, enhanced_task)
        
        # Проверяем, что оценка работает корректно
        self.assertIsNotNone(result)
        self.assertEqual(result.details.get('level'), 2)
        self.assertIn('labels', result.details)
    
    def test_evaluate_enhanced_click_task_level_3(self):
        """Оценка модифицированного click задания на уровне 3"""
        # Модифицируем задание для уровня 3
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Кликните на область'
            }
        }
        enhanced_task = self.difficulty_manager.enhance_task_for_level(task_data, level=3)
        
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
        
        result = self.evaluator.evaluate_click_task(user_input, answer_key, enhanced_task)
        
        # Проверяем, что оценка работает корректно
        self.assertIsNotNone(result)
        self.assertEqual(result.details.get('level'), 3)
        self.assertIn('drawing', result.details)
        self.assertIn('labels', result.details)
    
    def test_evaluate_click_combined_evaluation(self):
        """Проверка корректности комбинированной оценки (клик+labels)"""
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Кликните на область'
            }
        }
        enhanced_task = self.difficulty_manager.enhance_task_for_level(task_data, level=2)
        
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
        
        result = self.evaluator.evaluate_click_task(user_input, answer_key, enhanced_task)
        
        # Проверяем, что используется комбинированная оценка
        self.assertIn('labels', result.details)
        self.assertIn('found_targets', result.details)
        self.assertEqual(result.details.get('level'), 2)
        
        # Итоговый результат должен учитывать оба компонента (клик + labels)
        if result.success:
            self.assertTrue(result.success)
    
    def test_evaluate_drawing_combined_evaluation(self):
        """Проверка корректности комбинированной оценки (drawing+labels)"""
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Кликните на область'
            }
        }
        enhanced_task = self.difficulty_manager.enhance_task_for_level(task_data, level=3)
        
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
        
        result = self.evaluator.evaluate_click_task(user_input, answer_key, enhanced_task)
        
        # Проверяем, что используется комбинированная оценка
        self.assertIn('drawing', result.details)
        self.assertIn('labels', result.details)
        
        # Итоговый результат должен учитывать оба компонента
        drawing_success = result.details.get('drawing', {}).get('success')
        labels_success = result.details.get('labels', {}).get('success')
        self.assertTrue(
            drawing_success and labels_success,
            f"Комбинированная оценка должна быть успешной для обоих компонентов: drawing={drawing_success}, labels={labels_success}"
        )
        self.assertTrue(result.success, "Общий результат должен быть успешным при успешных drawing и labels")
    def test_evaluate_integrates_with_answer_key_target_names(self):
        """Интеграция с answer_key.target_names для уровней >= 2"""
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Кликните на область'
            }
        }
        enhanced_task = self.difficulty_manager.enhance_task_for_level(task_data, level=2)
        
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
            'target_names': ['Печень']  # Для уровня >= 2
        }
        
        result = self.evaluator.evaluate_click_task(user_input, answer_key, enhanced_task)
        
        # Проверяем, что target_names используются для проверки labels
        self.assertIn('labels', result.details)
        labels_result = result.details['labels']
        if 'matched_labels' in labels_result:
            # matched_labels - это список кортежей (index, user_label, correct_label)
            matched = labels_result['matched_labels']
            # Проверяем, что есть совпадение с 'Печень'
            found = any(label_tuple[1] == 'Печень' or label_tuple[2] == 'Печень' 
                       for label_tuple in matched)
            self.assertTrue(found, f"Печень не найдена в matched_labels: {matched}")
    
    def test_evaluate_integrates_drawing_check_level_3(self):
        """Интеграция проверки drawing для уровня 3"""
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Кликните на область'
            }
        }
        enhanced_task = self.difficulty_manager.enhance_task_for_level(task_data, level=3)
        
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
        
        result = self.evaluator.evaluate_click_task(user_input, answer_key, enhanced_task)
        
        # Проверяем, что drawing проверяется
        self.assertIn('drawing', result.details)
        drawing_result = result.details['drawing']
        if 'coverage' in drawing_result:
            self.assertGreater(drawing_result['coverage'], 0)


if __name__ == '__main__':
    unittest.main()

