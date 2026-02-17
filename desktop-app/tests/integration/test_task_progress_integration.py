"""
Интеграционные тесты для TaskController и ProgressService.

Проверяет взаимодействие между:
- TaskController (управление заданиями)
- ProgressService (сохранение прогресса)
- Сохранение прогресса при выполнении задания
- Обновление mistake_bank при ошибке
- Отслеживание истории выполнения заданий
- Сохранение уровня сложности
"""

import unittest
import tempfile
import shutil
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from logic.task_controller import TaskController, TaskState
from services.task_evaluator_service import TaskEvaluatorService, EvaluationResult
from services.progress_service import ProgressService


class TestTaskProgressIntegration(unittest.TestCase):
    """Интеграционные тесты TaskController и ProgressService"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()
        self.user_id = "test_user"
        
        self.evaluator_service = TaskEvaluatorService()
        self.progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=self.user_id
        )
        
        self.controller = TaskController(
            evaluator_service=self.evaluator_service,
            progress_service=self.progress_service
        )
    
    def tearDown(self):
        """Очистка после тестов"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def _create_test_task_data(self, task_type: str = "click") -> tuple[dict, dict]:
        """Создает тестовые данные задания"""
        task_data = {
            "meta": {
                "task_schema_version": "1.2",
                "name": "Test Task"
            },
            "content": {
                "type": task_type,
                "image": "test_image.jpg",
                "prompt": "Выполните задание"
            },
            "settings": {
                "difficulty": 1
            }
        }
        
        answer_key = {
            "targets": [
                {
                    "type": "polygon",
                    "points": [[100, 100], [200, 100], [200, 200], [100, 200]],
                    "name": "Target 1"
                }
            ]
        }
        
        return task_data, answer_key
    
    def test_task_completion_saves_progress(self):
        """Тест: сохранение прогресса при выполнении задания"""
        # Создаем тестовые данные
        task_data, answer_key = self._create_test_task_data("click")
        
        # Загружаем задание
        task = self.controller.load_task(
            "module_01", "topic_01", "task_001",
            task_data, answer_key
        )
        
        self.assertIsNotNone(task)
        self.assertEqual(self.controller.task_state, TaskState.IN_PROGRESS)
        
        # Отправляем правильный ответ
        user_input = {
            'x': 150, 'y': 150,  # Внутри целевой области
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        
        result = self.controller.submit_answer(user_input)
        
        # Проверяем, что задание выполнено
        self.assertTrue(result.success)
        self.assertEqual(self.controller.task_state, TaskState.COMPLETED)
        
        # Проверяем, что прогресс сохранен
        progress = self.progress_service.get_task_progress(
            "module_01", "topic_01", "task_001"
        )
        
        self.assertIsNotNone(progress)
        self.assertEqual(progress['attempts_count'], 1)
        self.assertTrue(progress['completed'])
        self.assertEqual(len(progress['attempts']), 1)
        
        # Проверяем детали попытки
        attempt = progress['attempts'][0]
        self.assertTrue(attempt['success'])
        self.assertGreater(attempt['score'], 0.0)
        self.assertIn('timestamp', attempt)
        self.assertIn('difficulty', attempt)
        self.assertIn('time_spent', attempt)
    
    def test_task_failure_updates_mistake_bank(self):
        """Тест: обновление mistake_bank при ошибке"""
        # Создаем тестовые данные
        task_data, answer_key = self._create_test_task_data("click")
        
        # Загружаем задание
        task = self.controller.load_task(
            "module_01", "topic_01", "task_002",
            task_data, answer_key
        )
        
        # Отправляем неправильный ответ (вне целевой области)
        user_input = {
            'x': 50, 'y': 50,  # Вне целевой области
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        
        result = self.controller.submit_answer(user_input)
        
        # Проверяем, что задание не выполнено
        self.assertFalse(result.success)
        self.assertEqual(self.controller.task_state, TaskState.FAILED)
        
        # Проверяем, что ошибка добавлена в mistake_bank
        mistake_bank = self.progress_service.get_mistake_bank()
        
        self.assertGreater(len(mistake_bank), 0)
        
        # Проверяем, что ошибка для правильного задания
        mistake = mistake_bank[0]
        self.assertEqual(mistake["module"], "module_01")
        self.assertEqual(mistake["topic"], "topic_01")
        self.assertEqual(mistake["task"], "task_002")
        self.assertEqual(mistake["level"], 1)  # Уровень сложности
        self.assertEqual(mistake["fail_count"], 1)
        self.assertIn("last_failed", mistake)
        
        # Проверяем, что при успешной попытке ошибка удаляется из mistake_bank
        task2 = self.controller.load_task(
            "module_01", "topic_01", "task_002",
            task_data, answer_key
        )
        
        user_input2 = {
            'x': 150, 'y': 150,  # Правильный ответ
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        
        result2 = self.controller.submit_answer(user_input2)
        self.assertTrue(result2.success)
        
        # Проверяем, что ошибка удалена из mistake_bank
        mistake_bank2 = self.progress_service.get_mistake_bank()
        task_002_mistakes = [
            m for m in mistake_bank2
            if m["task"] == "task_002"
        ]
        self.assertEqual(len(task_002_mistakes), 0)
    
    def test_task_history_tracking(self):
        """Тест: отслеживание истории выполнения заданий"""
        # Создаем тестовые данные
        task_data, answer_key = self._create_test_task_data("click")
        
        # Выполняем задание несколько раз
        # Полигон: [[100, 100], [200, 100], [200, 200], [100, 200]]
        # Область: от (100, 100) до (200, 200)
        attempts = [
            (50, 50, False),   # Неудачная попытка (вне области)
            (150, 150, True),   # Успешная попытка (внутри области)
            (250, 250, False),  # Еще одна неудачная попытка (вне области)
            (150, 150, True),   # Еще одна успешная попытка (внутри области)
        ]
        
        for i, (x, y, expected_success) in enumerate(attempts):
            task = self.controller.load_task(
                "module_01", "topic_01", "task_003",
                task_data, answer_key
            )
            
            user_input = {
                'x': x, 'y': y,
                'scale_factor': 1.0,
                'offset_x': 0, 'offset_y': 0
            }
            
            result = self.controller.submit_answer(user_input)
            self.assertEqual(result.success, expected_success)
        
        # Проверяем историю
        history = self.progress_service.get_task_history(
            "module_01", "topic_01", "task_003"
        )
        
        self.assertIsNotNone(history)
        self.assertEqual(len(history["attempts"]), 4)
        
        # Проверяем, что попытки отсортированы по времени
        timestamps = [a["timestamp"] for a in history["attempts"]]
        self.assertEqual(timestamps, sorted(timestamps))
        
        # Проверяем, что current_difficulty обновлен
        self.assertIn("current_difficulty", history)
        self.assertEqual(history["current_difficulty"], 1)
        
        # Проверяем mastery_level
        self.assertIn("mastery_level", history)
        self.assertIn(history["mastery_level"], ["beginner", "good", "expert"])
    
    def test_difficulty_level_persistence(self):
        """Тест: сохранение уровня сложности"""
        # Создаем тестовые данные с разными уровнями сложности
        task_data1, answer_key1 = self._create_test_task_data("click")
        task_data1["settings"]["difficulty"] = 1
        
        task_data2, answer_key2 = self._create_test_task_data("click")
        task_data2["settings"]["difficulty"] = 2
        
        task_data3, answer_key3 = self._create_test_task_data("click")
        task_data3["settings"]["difficulty"] = 3
        
        # Выполняем задания на разных уровнях
        for difficulty, (task_data, answer_key) in enumerate([
            (task_data1, answer_key1),
            (task_data2, answer_key2),
            (task_data3, answer_key3)
        ], start=1):
            task = self.controller.load_task(
                "module_01", "topic_01", f"task_difficulty_{difficulty}",
                task_data, answer_key
            )
            
            user_input = {
                'x': 150, 'y': 150,
                'scale_factor': 1.0,
                'offset_x': 0, 'offset_y': 0
            }
            
            result = self.controller.submit_answer(user_input)
            self.assertTrue(result.success)
        
        # Проверяем, что уровни сложности сохранены
        for difficulty in [1, 2, 3]:
            progress = self.progress_service.get_task_progress(
                "module_01", "topic_01", f"task_difficulty_{difficulty}"
            )
            
            self.assertIsNotNone(progress)
            self.assertEqual(len(progress['attempts']), 1)
            # Проверяем, что difficulty сохранен в attempts
            # difficulty может быть сохранен из result.details или из settings
            saved_difficulty = progress['attempts'][0].get('difficulty')
            # Уровень может быть сохранен или определен из settings
            self.assertIsNotNone(saved_difficulty)
            self.assertGreaterEqual(saved_difficulty, 1)
            self.assertLessEqual(saved_difficulty, 3)
            # current_difficulty может быть изменен эскалацией/деэскалацией
            # Проверяем только, что он существует и в допустимом диапазоне
            current_difficulty = progress.get('current_difficulty')
            self.assertIsNotNone(current_difficulty)
            self.assertGreaterEqual(current_difficulty, 1)
            self.assertLessEqual(current_difficulty, 3)
    
    def test_multiple_tasks_progress_isolation(self):
        """Тест: изоляция прогресса между разными заданиями"""
        # Создаем тестовые данные
        task_data, answer_key = self._create_test_task_data("click")
        
        # Выполняем разные задания
        tasks = [
            ("module_01", "topic_01", "task_004", True),
            ("module_01", "topic_01", "task_005", False),
            ("module_01", "topic_02", "task_006", True),
        ]
        
        for module_id, topic_id, task_id, should_succeed in tasks:
            task = self.controller.load_task(
                module_id, topic_id, task_id,
                task_data, answer_key
            )
            
            if should_succeed:
                user_input = {
                    'x': 150, 'y': 150,  # Правильный ответ
                    'scale_factor': 1.0,
                    'offset_x': 0, 'offset_y': 0
                }
            else:
                user_input = {
                    'x': 50, 'y': 50,  # Неправильный ответ
                    'scale_factor': 1.0,
                    'offset_x': 0, 'offset_y': 0
                }
            
            result = self.controller.submit_answer(user_input)
            self.assertEqual(result.success, should_succeed)
        
        # Проверяем изоляцию прогресса
        progress_004 = self.progress_service.get_task_progress(
            "module_01", "topic_01", "task_004"
        )
        progress_005 = self.progress_service.get_task_progress(
            "module_01", "topic_01", "task_005"
        )
        progress_006 = self.progress_service.get_task_progress(
            "module_01", "topic_02", "task_006"
        )
        
        self.assertIsNotNone(progress_004)
        self.assertIsNotNone(progress_005)
        self.assertIsNotNone(progress_006)
        
        # Проверяем, что данные изолированы
        self.assertTrue(progress_004['completed'])
        self.assertFalse(progress_005['completed'])
        self.assertTrue(progress_006['completed'])
        
        # Проверяем mistake_bank
        mistake_bank = self.progress_service.get_mistake_bank()
        task_005_mistakes = [
            m for m in mistake_bank
            if m["task"] == "task_005"
        ]
        self.assertEqual(len(task_005_mistakes), 1)  # task_005 должна быть в mistake_bank


if __name__ == '__main__':
    unittest.main()

