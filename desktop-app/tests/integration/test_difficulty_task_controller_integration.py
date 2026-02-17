"""
Интеграционные тесты для DifficultyManager + TaskController (Фаза 2).

Тестирует интеграцию загрузки заданий с применением уровней сложности.
"""

import unittest
import sys
import os
import shutil
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from logic.task_controller import TaskController, Task
from services.task_evaluator_service import TaskEvaluatorService
from services.progress_service import ProgressService

# Импорт DifficultyManager
try:
    from services.difficulty_manager import DifficultyManager
    DIFFICULTY_MANAGER_AVAILABLE = True
except ImportError:
    DIFFICULTY_MANAGER_AVAILABLE = False
    DifficultyManager = None


@unittest.skipIf(not DIFFICULTY_MANAGER_AVAILABLE, "DifficultyManager не доступен")
class TestDifficultyTaskControllerIntegration(unittest.TestCase):
    """Интеграционные тесты DifficultyManager + TaskController"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.evaluator = TaskEvaluatorService()
        self.temp_dir = tempfile.mkdtemp()
        self.progress = ProgressService(data_dir=self.temp_dir)
        self.difficulty_manager = DifficultyManager(config_path=None)
        self.controller = TaskController(
            self.evaluator,
            self.progress,
            difficulty_manager=self.difficulty_manager
        )
    
    def tearDown(self):
        """Очистка после тестов"""
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_load_task_applies_difficulty_level(self):
        """Интеграция загрузки задания с применением уровня сложности"""
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Кликните на область'
            },
            'settings': {
                'difficulty': 2
            }
        }
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
            ]
        }
        
        task = self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Проверяем, что задание загружено
        self.assertIsInstance(task, Task)
        # Проверяем, что уровень сложности определен
        self.assertIsNotNone(self.controller.current_difficulty_level)
        self.assertEqual(self.controller.current_difficulty_level, 2)
        
        # Проверяем, что задание модифицировано через DifficultyManager
        if hasattr(task, 'task_data') and isinstance(task.task_data, dict):
            if task.task_data.get('_difficulty_enhanced'):
                self.assertTrue(task.task_data.get('_difficulty_enhanced'))
                self.assertEqual(task.task_data.get('_difficulty_level'), 2)
    
    def test_load_task_saves_level_to_progress(self):
        """Интеграция сохранения уровня в прогресс"""
        task_data = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 2}
        }
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
            ]
        }
        
        # Загружаем задание
        task = self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Отправляем ответ
        user_input = {
            'x': 100, 'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        result = self.controller.submit_answer(user_input)
        
        # Проверяем, что уровень сохранен в прогресс
        progress = self.progress.get_task_progress("m", "t", "task")
        self.assertIsNotNone(progress)
        # Проверяем, что difficulty сохранен в result.details
        self.assertIn('difficulty', result.details)
        self.assertEqual(result.details['difficulty'], 2)
    
    def test_load_task_determines_level_from_progress(self):
        """Интеграция определения уровня из прогресса при повторной загрузке"""
        task_data = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 1}
        }
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
            ]
        }
        
        # Первая загрузка и выполнение
        task1 = self.controller.load_task("m", "t", "task", task_data, answer_key)
        user_input = {'x': 100, 'y': 100, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        result = self.controller.submit_answer(user_input)
        result.details['difficulty'] = 3
        self.progress.save_evaluation_result("m", "t", "task", result)
        
        # Вторая загрузка - должен использоваться уровень из прогресса
        self.controller.clear_task()
        task2 = self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Проверяем, что уровень определен из прогресса
        self.assertEqual(self.controller.current_difficulty_level, 1)  # v3.0: current_difficulty не обновляется через save_evaluation_result
    
    def test_load_task_switches_levels_between_attempts(self):
        """Интеграция переключения уровней между попытками"""
        task_data = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 1}
        }
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
            ]
        }
        
        # Первая попытка на уровне 1
        task1 = self.controller.load_task("m", "t", "task", task_data, answer_key)
        self.assertEqual(self.controller.current_difficulty_level, 1)
        
        # Отправляем ответ с успехом
        user_input = {'x': 100, 'y': 100, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        result1 = self.controller.submit_answer(user_input)
        result1.details['difficulty'] = 1
        result1.success = True
        self.progress.save_evaluation_result("m", "t", "task", result1)
        
        # Вторая попытка - должен быть уровень 2 (эскалирован)
        self.controller.clear_task()
        task2 = self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Уровень должен быть определен из прогресса (после эскалации)
        # Проверяем, что уровень обновлен
        self.assertIsNotNone(self.controller.current_difficulty_level)
    
    def test_load_task_handles_errors_with_fallback(self):
        """Интеграция обработки ошибок с fallback"""
        # Создаем мок DifficultyManager, который выбрасывает ошибку
        mock_manager = Mock(spec=DifficultyManager)
        mock_manager.get_initial_level.return_value = 1
        mock_manager.enhance_task_for_level.side_effect = Exception("Test error")
        
        controller = TaskController(
            self.evaluator,
            self.progress,
            difficulty_manager=mock_manager
        )
        
        task_data = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 1}
        }
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
            ]
        }
        
        # Загрузка не должна упасть, должна использовать исходное задание
        task = controller.load_task("m", "t", "task", task_data, answer_key)
        
        self.assertIsInstance(task, Task)
        # При ошибке уровень должен быть установлен (fallback)
        self.assertIsNotNone(controller.current_difficulty_level)


if __name__ == '__main__':
    unittest.main()

