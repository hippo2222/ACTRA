"""
Тесты логики ProfileSelectionScreen (без GUI).

Проверяет:
- Загрузку списка профилей
- Flow создания профиля
- Flow выбора профиля
- Flow удаления профиля
"""

import unittest
import tempfile
import shutil
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService
from services.progress_service import ProgressService
from services.statistics_service import StatisticsService
from logic.profile_controller import ProfileController


class TestProfileSelectionLogic(unittest.TestCase):
    """Тесты логики ProfileSelectionScreen"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
    
    def tearDown(self):
        """Очистка после тестов"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_profile_list_loading(self):
        """Тест: загрузка списка профилей"""
        # Создаем несколько пользователей
        user1 = self.user_service.create_user("User 1")
        user2 = self.user_service.create_user("User 2")
        user3 = self.user_service.create_user("User 3")
        
        # Получаем список профилей
        all_users = self.user_service.get_all_users()
        
        # Проверяем, что все пользователи загружены
        self.assertEqual(len(all_users), 3)
        
        user_ids = {user.user_id for user in all_users}
        self.assertIn(user1.user_id, user_ids)
        self.assertIn(user2.user_id, user_ids)
        self.assertIn(user3.user_id, user_ids)
        
        # Проверяем структуру данных для UI
        for user in all_users:
            self.assertIsNotNone(user.user_id)
            self.assertIsNotNone(user.name)
            self.assertIsNotNone(user.created_at)
    
    def test_profile_creation_flow(self):
        """Тест: flow создания профиля"""
        # Создаем ProfileController
        progress_service = ProgressService(data_dir=str(self.temp_dir), user_id="temp")
        statistics_service = StatisticsService(progress_service=progress_service)
        controller = ProfileController(self.user_service, statistics_service)
        
        # Создаем профиль
        user = controller.create_new_profile("New Profile")
        
        # Проверяем, что профиль создан
        self.assertIsNotNone(user)
        self.assertEqual(user.name, "New Profile")
        
        # Проверяем, что структура данных создана
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        self.assertTrue(user_dir.exists())
        self.assertTrue((user_dir / "profile.json").exists())
        self.assertTrue((user_dir / "progress.json").exists())
        self.assertTrue((user_dir / "statistics.json").exists())
        
        # Проверяем, что профиль в списке
        all_users = self.user_service.get_all_users()
        user_ids = {u.user_id for u in all_users}
        self.assertIn(user.user_id, user_ids)
    
    def test_profile_selection_flow(self):
        """Тест: flow выбора профиля"""
        # Создаем ProfileController
        progress_service = ProgressService(data_dir=str(self.temp_dir), user_id="temp")
        statistics_service = StatisticsService(progress_service=progress_service)
        controller = ProfileController(self.user_service, statistics_service)
        
        # Создаем профиль
        user = controller.create_new_profile("Selected Profile")
        
        # Выбираем профиль
        selected_user = controller.select_profile(user.user_id)
        
        # Проверяем, что профиль выбран
        self.assertIsNotNone(selected_user)
        self.assertEqual(selected_user.user_id, user.user_id)
        self.assertEqual(selected_user.name, user.name)
    
    def test_profile_deletion_flow(self):
        """Тест: flow удаления профиля"""
        # Создаем профиль
        user = self.user_service.create_user("To Delete")
        
        # Проверяем, что профиль существует
        retrieved_user = self.user_service.get_user(user.user_id)
        self.assertIsNotNone(retrieved_user)
        
        # Удаляем профиль
        deleted = self.user_service.delete_user(user.user_id)
        self.assertTrue(deleted)
        
        # Проверяем, что профиль удален
        retrieved_user_after = self.user_service.get_user(user.user_id)
        self.assertIsNone(retrieved_user_after)
        
        # Проверяем, что профиль не в списке
        all_users = self.user_service.get_all_users()
        user_ids = {u.user_id for u in all_users}
        self.assertNotIn(user.user_id, user_ids)


if __name__ == '__main__':
    unittest.main()

