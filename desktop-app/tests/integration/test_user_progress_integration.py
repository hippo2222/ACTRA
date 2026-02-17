"""
Интеграционные тесты для UserService и ProgressService.

Проверяет взаимодействие между:
- UserService (создание пользователей)
- ProgressService (сохранение прогресса)
- Изоляция данных между пользователями
"""

import unittest
import tempfile
import shutil
import json
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService, User
from services.progress_service import ProgressService
from services.task_evaluator_service import EvaluationResult


class TestUserProgressIntegration(unittest.TestCase):
    """Интеграционные тесты UserService и ProgressService"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
    
    def tearDown(self):
        """Очистка после тестов"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_create_user_creates_progress_structure(self):
        """Тест: создание пользователя создает структуру прогресса"""
        # Создаем пользователя
        user = self.user_service.create_user("Test User")
        
        # Проверяем, что создана структура данных
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        
        # Проверяем наличие файлов
        self.assertTrue((user_dir / "profile.json").exists())
        self.assertTrue((user_dir / "progress.json").exists())
        self.assertTrue((user_dir / "statistics.json").exists())
        
        # Проверяем структуру progress.json
        with open(user_dir / "progress.json", 'r', encoding='utf-8') as f:
            progress_data = json.load(f)
        
        self.assertEqual(progress_data["version"], "3.0")
        self.assertEqual(progress_data["user_id"], user.user_id)
        self.assertIsInstance(progress_data["task_history"], dict)
        self.assertIsInstance(progress_data["mistake_bank"], list)
        self.assertIn("global_stats", progress_data)
        self.assertIn("updated_at", progress_data)
        
        # Проверяем, что ProgressService может работать с этим пользователем
        progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        
        # Сохраняем попытку
        result = EvaluationResult(
            success=True,
            score=85.0,
            message="Test",
            metric="percent",
            details={"difficulty": 1, "time_spent": 60}
        )
        
        saved = progress_service.save_evaluation_result(
            "module_01", "topic_01", "task_001", result
        )
        self.assertTrue(saved)
        
        # Проверяем, что попытка сохранена
        progress = progress_service.get_task_progress("module_01", "topic_01", "task_001")
        self.assertIsNotNone(progress)
        self.assertEqual(progress['attempts_count'], 1)
    
    def test_user_progress_isolation(self):
        """Тест: изоляция прогресса между пользователями"""
        # Создаем двух пользователей
        user1 = self.user_service.create_user("User 1")
        user2 = self.user_service.create_user("User 2")
        
        # Создаем ProgressService для каждого
        progress_service1 = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user1.user_id
        )
        progress_service2 = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user2.user_id
        )
        
        # Сохраняем попытки для первого пользователя
        progress_service1.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        progress_service1.save_detailed_attempt(
            "module_01", "topic_01", "task_002",
            difficulty=1, success=False, score=40.0, time_spent=120
        )
        
        # Сохраняем попытки для второго пользователя
        progress_service2.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=2, success=True, score=85.0, time_spent=90
        )
        progress_service2.save_detailed_attempt(
            "module_01", "topic_01", "task_003",
            difficulty=1, success=False, score=50.0, time_spent=100
        )
        
        # Проверяем изоляцию прогресса
        progress1_task1 = progress_service1.get_task_progress("module_01", "topic_01", "task_001")
        progress2_task1 = progress_service2.get_task_progress("module_01", "topic_01", "task_001")
        
        self.assertIsNotNone(progress1_task1)
        self.assertIsNotNone(progress2_task1)
        
        # Проверяем, что данные разные
        self.assertEqual(progress1_task1['current_difficulty'], 1)
        self.assertEqual(progress2_task1['current_difficulty'], 2)
        self.assertEqual(len(progress1_task1['attempts']), 1)
        self.assertEqual(len(progress2_task1['attempts']), 1)
        
        # Проверяем изоляцию mistake_bank
        mistakes1 = progress_service1.get_mistake_bank()
        mistakes2 = progress_service2.get_mistake_bank()
        
        self.assertEqual(len(mistakes1), 1)  # task_002 для user1
        self.assertEqual(len(mistakes2), 1)  # task_003 для user2
        
        self.assertEqual(mistakes1[0]["task"], "task_002")
        self.assertEqual(mistakes2[0]["task"], "task_003")
        
        # Проверяем изоляцию на уровне файлов
        progress_file1 = Path(self.temp_dir) / "users" / user1.user_id / "progress.json"
        progress_file2 = Path(self.temp_dir) / "users" / user2.user_id / "progress.json"
        
        with open(progress_file1, 'r', encoding='utf-8') as f:
            data1 = json.load(f)
        with open(progress_file2, 'r', encoding='utf-8') as f:
            data2 = json.load(f)
        
        # Проверяем, что user_id в файлах разные
        self.assertEqual(data1["user_id"], user1.user_id)
        self.assertEqual(data2["user_id"], user2.user_id)
        
        # Проверяем, что task_history изолированы (разные задания)
        tasks1 = set(data1["task_history"].keys())
        tasks2 = set(data2["task_history"].keys())
        # У user1: task_001, task_002; у user2: task_001, task_003
        # Должны быть разные наборы заданий (или хотя бы одно различие)
        self.assertNotEqual(tasks1, tasks2, "Task histories should be different for different users")
    
    def test_switch_user_progress_persistence(self):
        """Тест: сохранение прогресса при переключении пользователей"""
        # Создаем пользователя
        user = self.user_service.create_user("Switch User")
        
        # Создаем ProgressService и сохраняем данные
        progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        
        progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        # Проверяем, что данные сохранены
        progress1 = progress_service.get_task_progress("module_01", "topic_01", "task_001")
        self.assertIsNotNone(progress1)
        self.assertEqual(len(progress1['attempts']), 1)
        
        # Создаем новый экземпляр ProgressService (симуляция переключения пользователя)
        new_progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        
        # Проверяем, что данные сохранились
        progress2 = new_progress_service.get_task_progress("module_01", "topic_01", "task_001")
        self.assertIsNotNone(progress2)
        self.assertEqual(len(progress2['attempts']), 1)
        self.assertEqual(progress2['attempts'][0]['score'], 90.0)
        
        # Добавляем еще одну попытку
        new_progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=2, success=True, score=85.0, time_spent=90
        )
        
        # Проверяем, что обе попытки сохранены
        progress3 = new_progress_service.get_task_progress("module_01", "topic_01", "task_001")
        self.assertEqual(len(progress3['attempts']), 2)
    
    def test_delete_user_cleanup(self):
        """Тест: очистка данных при удалении пользователя"""
        # Создаем пользователя
        user = self.user_service.create_user("Delete User")
        
        # Создаем ProgressService и сохраняем данные
        progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        
        progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        # Проверяем, что данные сохранены
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        self.assertTrue(user_dir.exists())
        self.assertTrue((user_dir / "progress.json").exists())
        
        # Удаляем пользователя
        deleted = self.user_service.delete_user(user.user_id)
        self.assertTrue(deleted)
        
        # Проверяем, что директория удалена
        self.assertFalse(user_dir.exists())
        
        # Проверяем, что пользователь не найден
        retrieved_user = self.user_service.get_user(user.user_id)
        self.assertIsNone(retrieved_user)
        
        # Проверяем, что попытка создать ProgressService для удаленного пользователя
        # создаст новую структуру (но данные будут потеряны)
        new_progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        
        # Проверяем, что структура создана заново, но данных нет
        progress = new_progress_service.get_task_progress("module_01", "topic_01", "task_001")
        self.assertIsNone(progress)  # Данные потеряны при удалении


if __name__ == '__main__':
    unittest.main()

