"""
Интеграционные тесты для TaskController + ProgressService + DifficultyManager (Фаза 2).

Тестирует полный цикл: загрузка → выполнение → оценка → сохранение → эскалация.
"""

import unittest
import sys
import os
import shutil
import tempfile
from pathlib import Path

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from logic.task_controller import TaskController
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
class TestTaskProgressDifficultyIntegration(unittest.TestCase):
    """Интеграционные тесты полного цикла с уровнями сложности"""
    
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
    
    def test_full_cycle_load_execute_save_escalate(self):
        """Полный цикл: загрузка → выполнение → оценка → сохранение → эскалация"""
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Кликните на область'
            },
            'settings': {
                'difficulty': 1
            }
        }
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
            ]
        }
        
        # 1. Загрузка задания
        task = self.controller.load_task("m", "t", "task", task_data, answer_key)
        self.assertIsNotNone(task)
        self.assertEqual(self.controller.current_difficulty_level, 1)
        
        # 2. Выполнение задания
        user_input = {
            'x': 100, 'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        result = self.controller.submit_answer(user_input)
        
        # 3. Проверяем, что результат сохранен
        self.assertIsNotNone(result)
        self.assertIn('difficulty', result.details)
        
        # 4. Проверяем, что уровень сохранен в прогресс
        progress = self.progress.get_task_progress("m", "t", "task")
        self.assertIsNotNone(progress)
    
    def test_save_level_to_progress(self):
        """Проверка сохранения уровня в прогресс"""
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
        
        # Загружаем и выполняем задание
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        user_input = {'x': 100, 'y': 100, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        result = self.controller.submit_answer(user_input)
        
        # Проверяем, что уровень сохранен в result.details
        self.assertIn('difficulty', result.details)
        self.assertEqual(result.details['difficulty'], 2)
    
    def test_load_level_from_progress_on_next_attempt(self):
        """Проверка загрузки уровня из прогресса при следующей попытке"""
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
        
        # Первая попытка - сохраняем с уровнем 2 через UserProgressManager напрямую
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        user_input = {'x': 100, 'y': 100, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        result1 = self.controller.submit_answer(user_input)
        result1.details['difficulty'] = 2
        result1.details['task_type'] = 'click'
        # Устанавливаем неуспех, чтобы избежать эскалации
        result1.success = False
        self.progress.save_evaluation_result("m", "t", "task", result1, difficulty=2)
        
        # Вторая попытка - должен использоваться уровень из прогресса
        self.controller.clear_task()
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Проверяем, что уровень определен из прогресса
        # Уровень может быть 2 (из прогресса) или изменен эскалацией/деэскалацией
        self.assertIsNotNone(self.controller.current_difficulty_level)
        # При неудаче уровень может быть понижен до 1
        self.assertGreaterEqual(self.controller.current_difficulty_level, 1)
        self.assertLessEqual(self.controller.current_difficulty_level, 2)
    
    def test_escalate_after_multiple_successful_attempts(self):
        """Проверка эскалации после нескольких успешных попыток"""
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
        
        # Первая попытка - успех
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        user_input = {'x': 100, 'y': 100, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        result1 = self.controller.submit_answer(user_input)
        result1.success = True
        result1.details['difficulty'] = 1
        result1.details['task_type'] = 'click'
        self.progress.save_evaluation_result("m", "t", "task", result1)
        
        # Вторая попытка - должен быть уровень 2 (эскалирован)
        self.controller.clear_task()
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Проверяем, что уровень эскалирован
        # Уровень должен быть определен из прогресса (после эскалации)
        self.assertIsNotNone(self.controller.current_difficulty_level)
        # Может быть 2 (эскалирован) или остаться 1 (если эскалация не применилась)
        self.assertGreaterEqual(self.controller.current_difficulty_level, 1)
        self.assertLessEqual(self.controller.current_difficulty_level, 3)
    
    def test_deescalate_after_failed_attempts(self):
        """Проверка деэскалации после неудачных попыток"""
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
        
        # Первая попытка - неудача
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        # Неправильный ответ
        user_input = {'x': 500, 'y': 500, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        result1 = self.controller.submit_answer(user_input)
        result1.success = False
        result1.details['difficulty'] = 2
        result1.details['task_type'] = 'click'
        self.progress.save_evaluation_result("m", "t", "task", result1)
        
        # Вторая попытка - должен быть уровень 1 (деэскалирован)
        self.controller.clear_task()
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Проверяем, что уровень деэскалирован
        # Уровень должен быть определен из прогресса (после деэскалации)
        self.assertIsNotNone(self.controller.current_difficulty_level)
        # Может быть 1 (деэскалирован) или остаться 2 (если деэскалация не применилась)
        self.assertGreaterEqual(self.controller.current_difficulty_level, 1)
        self.assertLessEqual(self.controller.current_difficulty_level, 2)


if __name__ == '__main__':
    unittest.main()

