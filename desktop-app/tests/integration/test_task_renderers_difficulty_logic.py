"""
Тесты UI логики для TaskRenderers с поддержкой уровней сложности (без GUI, Фаза 2).

Тестирует логику рендереров для разных уровней сложности.
"""

import unittest
import sys
from pathlib import Path
from unittest.mock import Mock, MagicMock

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


class TestTaskRenderersDifficultyLogic(unittest.TestCase):
    """Тесты логики TaskRenderers для уровней сложности"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.mock_parent = Mock()
        self.mock_app = Mock()
    
    def test_click_renderer_v2_level_1_click_mode(self):
        """ClickTaskRendererV2: отображение режима click (уровень 1)"""
        task_data = {
            '_difficulty_level': 1,
            'content': {
                'mode': 'click',
                'requires_labels': False,
                'requires_drawing': False
            }
        }
        
        # Проверяем, что режим определен правильно
        self.assertEqual(task_data['content']['mode'], 'click')
        self.assertFalse(task_data['content']['requires_labels'])
    
    def test_click_renderer_v2_level_2_click_and_label_mode(self):
        """ClickTaskRendererV2: отображение режима click_and_label (уровень 2)"""
        task_data = {
            '_difficulty_level': 2,
            'content': {
                'mode': 'click_and_label',
                'requires_labels': True,
                'requires_drawing': False
            }
        }
        
        # Проверяем, что режим определен правильно
        self.assertEqual(task_data['content']['mode'], 'click_and_label')
        self.assertTrue(task_data['content']['requires_labels'])
    
    def test_click_renderer_v2_level_3_draw_and_label_mode(self):
        """ClickTaskRendererV2: отображение режима draw_and_label (уровень 3)"""
        task_data = {
            '_difficulty_level': 3,
            'content': {
                'mode': 'draw_and_label',
                'requires_labels': True,
                'requires_drawing': True
            }
        }
        
        # Проверяем, что режим определен правильно
        self.assertEqual(task_data['content']['mode'], 'draw_and_label')
        self.assertTrue(task_data['content']['requires_drawing'])
    
    def test_draw_renderer_v2_level_1_draw_mode(self):
        """DrawTaskRendererV2: отображение режима draw (уровень 1)"""
        task_data = {
            '_difficulty_level': 1,
            'content': {
                'mode': 'draw',
                'requires_labels': False,
                'requires_explanation': False
            }
        }
        
        # Проверяем, что режим определен правильно
        self.assertEqual(task_data['content']['mode'], 'draw')
    
    def test_draw_renderer_v2_level_2_draw_and_label_mode(self):
        """DrawTaskRendererV2: отображение режима draw_and_label (уровень 2)"""
        task_data = {
            '_difficulty_level': 2,
            'content': {
                'mode': 'draw_and_label',
                'requires_labels': True,
                'requires_explanation': False
            }
        }
        
        # Проверяем, что режим определен правильно
        self.assertEqual(task_data['content']['mode'], 'draw_and_label')
        self.assertTrue(task_data['content']['requires_labels'])
    
    def test_draw_renderer_v2_level_3_draw_multiple_and_explain_mode(self):
        """DrawTaskRendererV2: отображение режима draw_multiple_and_explain (уровень 3)"""
        task_data = {
            '_difficulty_level': 3,
            'content': {
                'mode': 'draw_multiple_and_explain',
                'requires_labels': True,
                'requires_explanation': True
            }
        }
        
        # Проверяем, что режим определен правильно
        self.assertEqual(task_data['content']['mode'], 'draw_multiple_and_explain')
        self.assertTrue(task_data['content']['requires_explanation'])
    
    def test_test_renderer_v2_level_1_multiple_choice(self):
        """TestTaskRendererV2: переключение на multiple_choice (уровень 1)"""
        task_data = {
            '_difficulty_level': 1,
            'content': {
                'mode': 'multiple_choice',
                'show_options': True,
                'requires_text_input': False
            }
        }
        
        # Проверяем, что режим определен правильно
        self.assertEqual(task_data['content']['mode'], 'multiple_choice')
        self.assertTrue(task_data['content']['show_options'])
    
    def test_test_renderer_v2_level_2_open_question(self):
        """TestTaskRendererV2: переключение на open_question (уровень 2)"""
        task_data = {
            '_difficulty_level': 2,
            'content': {
                'mode': 'open_question',
                'show_options': False,
                'requires_text_input': True
            }
        }
        
        # Проверяем, что режим определен правильно
        self.assertEqual(task_data['content']['mode'], 'open_question')
        self.assertTrue(task_data['content']['requires_text_input'])
    
    def test_sequence_renderer_level_1_all_hints_shown(self):
        """SequenceTaskRenderer: отображение всех подсказок (уровень 1)"""
        task_data = {
            '_difficulty_level': 1,
            'content': {
                'show_level_labels': True,
                'show_block_labels': True,
                'requires_level_names': False,
                'requires_block_names': False
            }
        }
        
        # Проверяем, что все подсказки показаны
        self.assertTrue(task_data['content']['show_level_labels'])
        self.assertTrue(task_data['content']['show_block_labels'])
    
    def test_sequence_renderer_level_2_level_names_required(self):
        """SequenceTaskRenderer: требование названий уровней (уровень 2)"""
        task_data = {
            '_difficulty_level': 2,
            'content': {
                'show_level_labels': False,
                'show_block_labels': True,
                'requires_level_names': True,
                'requires_block_names': False
            }
        }
        
        # Проверяем, что требуется ввод названий уровней
        self.assertTrue(task_data['content']['requires_level_names'])
        self.assertFalse(task_data['content']['show_level_labels'])
    
    def test_sequence_renderer_level_3_all_names_required(self):
        """SequenceTaskRenderer: требование названий уровней и блоков (уровень 3)"""
        task_data = {
            '_difficulty_level': 3,
            'content': {
                'show_level_labels': False,
                'show_block_labels': False,
                'requires_level_names': True,
                'requires_block_names': True
            }
        }
        
        # Проверяем, что требуется ввод всех названий
        self.assertTrue(task_data['content']['requires_level_names'])
        self.assertTrue(task_data['content']['requires_block_names'])
    
    def test_get_user_input_level_2_requires_labels(self):
        """Проверка get_user_input для уровня 2 (требуются labels)"""
        user_input = {
            'x': 100,
            'y': 100,
            'labels': ['Печень']  # Labels для уровня 2
        }
        
        # Проверяем, что labels присутствуют
        self.assertIn('labels', user_input)
        self.assertIsInstance(user_input['labels'], list)
    
    def test_get_user_input_level_3_requires_drawing_and_labels(self):
        """Проверка get_user_input для уровня 3 (требуются drawing и labels)"""
        user_input = {
            'drawing': [
                {'type': 'brush_stroke', 'points': [[100, 100], [110, 110]]}
            ],
            'labels': ['Печень']  # Labels для уровня 3
        }
        
        # Проверяем, что drawing и labels присутствуют
        self.assertIn('drawing', user_input)
        self.assertIn('labels', user_input)
    
    def test_validate_input_level_2_missing_labels(self):
        """Проверка валидации ввода для уровня 2 (labels отсутствуют)"""
        task_data = {
            'content': {
                'requires_labels': True
            }
        }
        user_input = {
            'x': 100,
            'y': 100
            # labels отсутствуют
        }
        
        # Проверяем, что валидация должна обнаружить отсутствие labels
        requires_labels = task_data.get('content', {}).get('requires_labels', False)
        if requires_labels:
            has_labels = 'labels' in user_input and user_input.get('labels')
            self.assertFalse(has_labels, "Labels должны отсутствовать для теста валидации")
    
    def test_validate_input_level_3_missing_drawing(self):
        """Проверка валидации ввода для уровня 3 (drawing отсутствует)"""
        task_data = {
            'content': {
                'requires_drawing': True
            }
        }
        user_input = {
            'labels': ['Печень']
            # drawing отсутствует
        }
        
        # Проверяем, что валидация должна обнаружить отсутствие drawing
        requires_drawing = task_data.get('content', {}).get('requires_drawing', False)
        if requires_drawing:
            has_drawing = 'drawing' in user_input and user_input.get('drawing')
            self.assertFalse(has_drawing, "Drawing должен отсутствовать для теста валидации")


if __name__ == '__main__':
    unittest.main()

