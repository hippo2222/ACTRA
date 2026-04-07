"""
Тесты для UserService.

Проверяет:
- Создание пользователей
- Получение пользователей
- Получение списка всех пользователей
- Валидацию данных
"""

import unittest
import tempfile
import json
import shutil
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService, User
from services.schemas.user_schemas import ProfileSchema, ProgressSchema, StatisticsSchema


class TestUserService(unittest.TestCase):
    """Тесты для UserService"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()
        self.service = UserService(data_dir=self.temp_dir)
    
    def tearDown(self):
        """Очистка после тестов"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_create_user(self):
        """Тест создания пользователя"""
        user = self.service.create_user("Иван Иванов")
        
        # Проверяем, что пользователь создан
        self.assertIsNotNone(user)
        self.assertIsInstance(user, User)
        self.assertEqual(user.name, "Иван Иванов")
        self.assertTrue(user.user_id.startswith("user_"))
        self.assertIsNotNone(user.created_at)
        
        # Проверяем, что создана директория
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        self.assertTrue(user_dir.exists())
        
        # Проверяем, что создан profile.json
        profile_file = user_dir / "profile.json"
        self.assertTrue(profile_file.exists())
        
        # Проверяем содержимое profile.json
        with open(profile_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        errors = ProfileSchema.validate(data)
        self.assertEqual(len(errors), 0, f"Ошибки валидации: {errors}")
        self.assertEqual(data["user_id"], user.user_id)
        self.assertEqual(data["profile"]["name"], "Иван Иванов")
        
        # Проверяем, что созданы progress.json и statistics.json
        progress_file = user_dir / "progress.json"
        statistics_file = user_dir / "statistics.json"
        
        self.assertTrue(progress_file.exists())
        self.assertTrue(statistics_file.exists())
        
        # Проверяем валидность progress.json
        with open(progress_file, 'r', encoding='utf-8') as f:
            progress_data = json.load(f)
        errors = ProgressSchema.validate(progress_data)
        self.assertEqual(len(errors), 0, f"Ошибки валидации progress.json: {errors}")
        
        # Проверяем валидность statistics.json
        with open(statistics_file, 'r', encoding='utf-8') as f:
            statistics_data = json.load(f)
        errors = StatisticsSchema.validate(statistics_data)
        self.assertEqual(len(errors), 0, f"Ошибки валидации statistics.json: {errors}")
    
    def test_create_user_with_settings(self):
        """Тест создания пользователя (settings пустой по умолчанию)"""
        user = self.service.create_user("Петр Петров")
        
        # Settings должен быть пустым словарем
        self.assertEqual(user.settings, {})
        
        # Проверяем в файле
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        profile_file = user_dir / "profile.json"
        
        with open(profile_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        self.assertEqual(data["profile"]["settings"], {})
    
    def test_create_user_empty_name(self):
        """Тест создания пользователя с пустым именем"""
        with self.assertRaises(ValueError) as context:
            self.service.create_user("")
        
        msg = str(context.exception).lower()
        self.assertIn("пустым", msg)
    
    
    def test_get_user(self):
        """Тест получения пользователя"""
        # Создаем пользователя
        created_user = self.service.create_user("Иван Иванов")
        
        # Получаем пользователя
        retrieved_user = self.service.get_user(created_user.user_id)
        
        # Проверяем, что пользователь найден
        self.assertIsNotNone(retrieved_user)
        self.assertEqual(retrieved_user.user_id, created_user.user_id)
        self.assertEqual(retrieved_user.name, created_user.name)
        self.assertEqual(retrieved_user.created_at, created_user.created_at)
    
    def test_get_user_not_found(self):
        """Тест получения несуществующего пользователя"""
        user = self.service.get_user("nonexistent_user")
        self.assertIsNone(user)
    
    def test_get_user_empty_id(self):
        """Тест получения пользователя с пустым ID"""
        user = self.service.get_user("")
        self.assertIsNone(user)
    
    def test_get_all_users(self):
        """Тест получения списка всех пользователей"""
        # Создаем несколько пользователей
        user1 = self.service.create_user("Иван Иванов")
        user2 = self.service.create_user("Петр Петров")
        user3 = self.service.create_user("Мария Сидорова")
        
        # Получаем всех пользователей
        users = self.service.get_all_users()
        
        # Проверяем, что все пользователи найдены
        self.assertEqual(len(users), 3)
        
        user_ids = {user.user_id for user in users}
        self.assertIn(user1.user_id, user_ids)
        self.assertIn(user2.user_id, user_ids)
        self.assertIn(user3.user_id, user_ids)
        
        names = {user.name for user in users}
        self.assertIn("Иван Иванов", names)
        self.assertIn("Петр Петров", names)
        self.assertIn("Мария Сидорова", names)
    
    def test_get_all_users_empty(self):
        """Тест получения списка пользователей, когда их нет"""
        users = self.service.get_all_users()
        self.assertEqual(len(users), 0)
    
    def test_user_to_dict(self):
        """Тест преобразования User в словарь"""
        user = User(
            user_id="user_123",
            name="Иван Иванов",
            created_at="2024-01-01T00:00:00",
            settings={}
        )
        
        data = user.to_dict()
        
        self.assertEqual(data["user_id"], "user_123")
        self.assertEqual(data["profile"]["name"], "Иван Иванов")
        self.assertEqual(data["profile"]["created_at"], "2024-01-01T00:00:00")
        self.assertEqual(data["profile"]["settings"], {})
        
        # Проверяем валидность
        errors = ProfileSchema.validate(data)
        self.assertEqual(len(errors), 0, f"Ошибки валидации: {errors}")
    
    def test_user_from_dict(self):
        """Тест создания User из словаря"""
        data = {
            "user_id": "user_123",
            "profile": {
                "name": "Иван Иванов",
                "created_at": "2024-01-01T00:00:00",
                "settings": {}
            }
        }
        
        user = User.from_dict(data)
        
        self.assertEqual(user.user_id, "user_123")
        self.assertEqual(user.name, "Иван Иванов")
        self.assertEqual(user.created_at, "2024-01-01T00:00:00")
        self.assertEqual(user.settings, {})
    
    def test_unique_user_ids(self):
        """Тест уникальности user_id"""
        user1 = self.service.create_user("Иван")
        user2 = self.service.create_user("Петр")
        user3 = self.service.create_user("Мария")
        
        user_ids = {user1.user_id, user2.user_id, user3.user_id}
        self.assertEqual(len(user_ids), 3)  # Все ID должны быть уникальными
    
    def test_user_directory_structure(self):
        """Тест структуры директорий пользователя"""
        user = self.service.create_user("Иван Иванов")
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        
        # Проверяем, что все необходимые файлы созданы
        self.assertTrue((user_dir / "profile.json").exists())
        self.assertTrue((user_dir / "progress.json").exists())
        self.assertTrue((user_dir / "statistics.json").exists())
    
    def test_create_user_duplicate_name(self):
        """Тест создания пользователей с одинаковыми именами (должно быть запрещено)"""
        # Создаем первого пользователя
        user1 = self.service.create_user("Иван Иванов")
        self.assertIsNotNone(user1)
        
        # Попытка создать второго пользователя с тем же именем должна выбросить ошибку
        with self.assertRaises(ValueError):
            self.service.create_user("Иван Иванов")
    
    def test_user_isolation(self):
        """Тест изоляции данных между пользователями"""
        # Создаем двух пользователей
        user1 = self.service.create_user("Пользователь 1")
        user2 = self.service.create_user("Пользователь 2")
        
        # Проверяем, что у каждого пользователя своя директория
        user1_dir = Path(self.temp_dir) / "users" / user1.user_id
        user2_dir = Path(self.temp_dir) / "users" / user2.user_id
        
        self.assertTrue(user1_dir.exists())
        self.assertTrue(user2_dir.exists())
        self.assertNotEqual(user1_dir, user2_dir)
        
        # Проверяем, что у каждого свой profile.json
        profile1 = user1_dir / "profile.json"
        profile2 = user2_dir / "profile.json"
        
        self.assertTrue(profile1.exists())
        self.assertTrue(profile2.exists())
        
        # Проверяем содержимое profile.json
        with open(profile1, 'r', encoding='utf-8') as f:
            data1 = json.load(f)
        with open(profile2, 'r', encoding='utf-8') as f:
            data2 = json.load(f)
        
        # Проверяем, что user_id разные
        self.assertNotEqual(data1["user_id"], data2["user_id"])
        self.assertEqual(data1["user_id"], user1.user_id)
        self.assertEqual(data2["user_id"], user2.user_id)
        
        # Проверяем, что имена разные
        self.assertEqual(data1["profile"]["name"], "Пользователь 1")
        self.assertEqual(data2["profile"]["name"], "Пользователь 2")
        
        # Проверяем, что у каждого свой progress.json и statistics.json
        progress1 = user1_dir / "progress.json"
        progress2 = user2_dir / "progress.json"
        stats1 = user1_dir / "statistics.json"
        stats2 = user2_dir / "statistics.json"
        
        self.assertTrue(progress1.exists())
        self.assertTrue(progress2.exists())
        self.assertTrue(stats1.exists())
        self.assertTrue(stats2.exists())
        
        # Проверяем содержимое progress.json
        with open(progress1, 'r', encoding='utf-8') as f:
            progress_data1 = json.load(f)
        with open(progress2, 'r', encoding='utf-8') as f:
            progress_data2 = json.load(f)
        
        # Проверяем, что user_id в progress.json соответствуют
        self.assertEqual(progress_data1["user_id"], user1.user_id)
        self.assertEqual(progress_data2["user_id"], user2.user_id)
        
        # Проверяем, что данные изолированы (task_history пустые)
        self.assertEqual(progress_data1["task_history"], {})
        self.assertEqual(progress_data2["task_history"], {})
    
    def test_delete_user_with_progress(self):
        """Тест удаления пользователя с сохранением данных"""
        # Создаем пользователя
        user = self.service.create_user("Тестовый Пользователь")
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        
        # Проверяем, что пользователь создан
        self.assertTrue(user_dir.exists())
        self.assertTrue((user_dir / "profile.json").exists())
        self.assertTrue((user_dir / "progress.json").exists())
        self.assertTrue((user_dir / "progress.json").exists())
        
        # Добавляем некоторые данные в progress.json (симуляция прогресса)
        from services.progress_service import ProgressService
        progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        
        # Сохраняем тестовую попытку
        from services.task_evaluator_service import EvaluationResult
        result = EvaluationResult(
            success=True,
            score=85.0,
            message="Тест",
            metric="percent",
            details={}
        )
        progress_service.save_evaluation_result(
            "module_01", "topic_01", "task_001", result
        )
        
        # Проверяем, что данные сохранены
        progress_file = user_dir / "progress.json"
        with open(progress_file, 'r', encoding='utf-8') as f:
            progress_data = json.load(f)
        self.assertGreater(len(progress_data.get("task_history", {})), 0)
        
        # Удаляем пользователя
        deleted = self.service.delete_user(user.user_id)
        self.assertTrue(deleted)
        
        # Проверяем, что директория удалена
        self.assertFalse(user_dir.exists())
        
        # Проверяем, что пользователь не найден
        retrieved_user = self.service.get_user(user.user_id)
        self.assertIsNone(retrieved_user)
        
        # Проверяем, что пользователь не в списке
        all_users = self.service.get_all_users()
        user_ids = {u.user_id for u in all_users}
        self.assertNotIn(user.user_id, user_ids)
    
    def test_delete_user_not_found(self):
        """Тест удаления несуществующего пользователя"""
        deleted = self.service.delete_user("nonexistent_user")
        self.assertFalse(deleted)
    
    def test_delete_user_empty_id(self):
        """Тест удаления пользователя с пустым ID"""
        with self.assertRaises(ValueError):
            self.service.delete_user("")
    
    def test_get_user_guest_returns_none(self):
        """Guest profile is deprecated and must not be returned."""
        user = self.service.get_user("guest")
        self.assertIsNone(user)

    def test_get_all_users_skips_guest_directory(self):
        """Legacy guest directory must be ignored in user listing."""
        regular = self.service.create_user("Regular User")

        guest_dir = Path(self.temp_dir) / "users" / "guest"
        guest_dir.mkdir(parents=True, exist_ok=True)
        guest_profile = {
            "user_id": "guest",
            "profile": {
                "name": "Guest",
                "created_at": "2026-02-15T00:00:00",
                "avatar_seed": "1.png",
                "password_hash": None,
                "security_settings": {
                    "require_password_on_login": False,
                    "require_password_on_edit": False
                },
                "settings": {}
            }
        }
        with open(guest_dir / "profile.json", "w", encoding="utf-8") as f:
            json.dump(guest_profile, f, ensure_ascii=False, indent=2)

        users = self.service.get_all_users()
        user_ids = {u.user_id for u in users}
        self.assertIn(regular.user_id, user_ids)
        self.assertNotIn("guest", user_ids)

    def test_save_last_user_id_guest_is_cleared(self):
        """Guest must never persist as last active user in app_state."""
        self.service.save_last_user_id("guest")
        saved = self.service.get_last_user_id()
        self.assertEqual(saved, "")

if __name__ == '__main__':
    unittest.main()


