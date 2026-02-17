"""
Тесты граничных случаев и обработки ошибок.

Проверяет:
- Восстановление при повреждении файла
- Обработку отсутствующей директории пользователя
- Обработку невалидных данных пользователя
- Одновременный доступ к данным пользователя
"""

import unittest
import tempfile
import shutil
import json
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService
from services.progress_service import ProgressService
from services.user_progress_manager import UserProgressManager


class TestEdgeCases(unittest.TestCase):
    """Тесты граничных случаев"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
    
    def tearDown(self):
        """Очистка после тестов"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_corrupted_progress_file_recovery(self):
        """Тест: восстановление при повреждении файла"""
        # Создаем пользователя
        user = self.user_service.create_user("Recovery User")
        
        # Повреждаем progress.json (записываем невалидный JSON)
        progress_file = Path(self.temp_dir) / "users" / user.user_id / "progress.json"
        with open(progress_file, 'w', encoding='utf-8') as f:
            f.write("invalid json content {")
        
        # Создаем новый ProgressService - должен восстановить структуру
        progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        
        # Проверяем, что структура восстановлена
        progress_data = progress_service.progress_manager.get_progress_data()
        self.assertIn(progress_data["version"], {"2.0", "3.0"})
        self.assertEqual(progress_data["user_id"], user.user_id)
        self.assertIsInstance(progress_data["task_history"], dict)
        self.assertIsInstance(progress_data["mistake_bank"], list)
        
        # Проверяем, что можно продолжать работу
        progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        progress = progress_service.get_task_progress("module_01", "topic_01", "task_001")
        self.assertIsNotNone(progress)
        self.assertEqual(len(progress['attempts']), 1)
    
    def test_missing_user_directory(self):
        """Тест: обработка отсутствующей директории пользователя"""
        # Создаем ProgressService для несуществующего пользователя
        progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id="nonexistent_user"
        )
        
        # Проверяем, что структура создана
        user_dir = Path(self.temp_dir) / "users" / "nonexistent_user"
        self.assertTrue(user_dir.exists())
        self.assertTrue((user_dir / "progress.json").exists())
        
        # Проверяем, что можно сохранять данные
        progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        progress = progress_service.get_task_progress("module_01", "topic_01", "task_001")
        self.assertIsNotNone(progress)
    
    def test_invalid_user_data(self):
        """Тест: обработка невалидных данных пользователя"""
        # Создаем пользователя
        user = self.user_service.create_user("Invalid Data User")
        
        # Повреждаем profile.json
        profile_file = Path(self.temp_dir) / "users" / user.user_id / "profile.json"
        with open(profile_file, 'w', encoding='utf-8') as f:
            f.write("invalid json")
        
        # Пытаемся получить пользователя
        retrieved_user = self.user_service.get_user(user.user_id)
        
        # Должен вернуть None при невалидных данных
        self.assertIsNone(retrieved_user)
        
        # Проверяем, что get_all_users пропускает невалидные профили
        all_users = self.user_service.get_all_users()
        user_ids = {u.user_id for u in all_users}
        self.assertNotIn(user.user_id, user_ids)
    
    def test_concurrent_user_access(self):
        """Тест: одновременный доступ к данным пользователя"""
        # Создаем пользователя
        user = self.user_service.create_user("Concurrent User")
        
        # Создаем первый экземпляр ProgressService
        progress_service1 = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        
        # Сохраняем первую попытку
        progress_service1.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        # Проверяем, что первая попытка сохранена
        progress1 = progress_service1.get_task_progress("module_01", "topic_01", "task_001")
        self.assertIsNotNone(progress1)
        
        # Создаем второй экземпляр ПОСЛЕ сохранения первой попытки
        # (он загрузит данные, включая первую попытку)
        progress_service2 = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        
        # Проверяем, что второй экземпляр видит первую попытку
        progress1_check = progress_service2.get_task_progress("module_01", "topic_01", "task_001")
        self.assertIsNotNone(progress1_check)
        
        # Сохраняем вторую попытку через второй экземпляр
        progress_service2.save_detailed_attempt(
            "module_01", "topic_01", "task_002",
            difficulty=1, success=True, score=85.0, time_spent=45
        )
        
        # Проверяем, что вторая попытка сохранена
        progress2 = progress_service2.get_task_progress("module_01", "topic_01", "task_002")
        self.assertIsNotNone(progress2)
        
        # Проверяем, что оба задания сохранены (создаем новый экземпляр для проверки)
        progress_service_final = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        all_progress_final = progress_service_final.progress_manager.get_progress_data()
        
        # Оба задания должны быть сохранены
        self.assertEqual(len(all_progress_final["task_history"]), 2)
        self.assertIn("module_01/topic_01/task_001", all_progress_final["task_history"])
        self.assertIn("module_01/topic_01/task_002", all_progress_final["task_history"])


if __name__ == '__main__':
    unittest.main()

