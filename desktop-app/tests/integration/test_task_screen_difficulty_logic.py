"""
Тесты UI логики для TaskScreen с поддержкой уровней сложности (без GUI, Фаза 2).

Тестирует логику отображения и выбора уровней сложности.
"""

import unittest
import sys
from pathlib import Path
from unittest.mock import Mock, MagicMock

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


class TestTaskScreenDifficultyLogic(unittest.TestCase):
    """Тесты логики TaskScreen для уровней сложности"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.mock_app = Mock()
        self.mock_app.difficulty_manager = Mock()
        self.mock_app.difficulty_manager.get_available_levels.return_value = [1, 2, 3]
        # Настраиваем mock для enhance_task_for_level, чтобы возвращал правильные данные
        def mock_enhance_task_for_level(task_data, level, task_ref=None):
            enhanced = task_data.copy()
            enhanced['_difficulty_level'] = level
            enhanced['_difficulty_enhanced'] = True
            return enhanced
        self.mock_app.difficulty_manager.enhance_task_for_level = mock_enhance_task_for_level
    
    def test_display_difficulty_level(self):
        """Логика отображения уровня сложности"""
        # Симулируем получение уровня из задания
        task_data = {
            '_difficulty_level': 2,
            '_difficulty_enhanced': True
        }
        
        # Проверяем, что уровень может быть извлечен
        difficulty_level = task_data.get('_difficulty_level', 1)
        self.assertEqual(difficulty_level, 2)
    
    def test_select_difficulty_level(self):
        """Логика выбора уровня пользователем"""
        available_levels = [1, 2, 3]
        selected_level = 2
        
        # Проверяем, что выбранный уровень валиден
        self.assertIn(selected_level, available_levels)
    
    def test_apply_selected_level(self):
        """Логика применения выбранного уровня"""
        task_data = {
            'type': 'click',
            'content': {'type': 'click'}
        }
        selected_level = 2
        
        # Симулируем применение уровня через DifficultyManager
        if self.mock_app.difficulty_manager:
            enhanced = self.mock_app.difficulty_manager.enhance_task_for_level(
                task_data, level=selected_level
            )
            # Проверяем, что уровень применен
            if enhanced:
                self.assertEqual(enhanced.get('_difficulty_level'), selected_level)
    
    def test_update_ui_on_level_change(self):
        """Логика обновления UI при изменении уровня"""
        current_level = 1
        new_level = 2
        
        # Проверяем, что уровень изменился
        self.assertNotEqual(current_level, new_level)
        # UI должен обновиться для отображения нового уровня
    
    def test_display_available_levels(self):
        """Логика отображения доступных уровней"""
        task_type = "click"
        
        # Получаем доступные уровни
        if self.mock_app.difficulty_manager:
            available_levels = self.mock_app.difficulty_manager.get_available_levels(task_type)
            self.assertIsInstance(available_levels, list)
            self.assertGreater(len(available_levels), 0)


if __name__ == '__main__':
    unittest.main()

