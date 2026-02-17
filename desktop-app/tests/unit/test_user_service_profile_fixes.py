"""
Unit-тесты для проверки исправлений создания профилей (Area 1.1).

Тестируем исправления:
1. Создание complex_statistics.json при инициализации
2. Валидация имени (длина 2-50, запрещенные символы)
3. Проверка дубликатов имен
4. Обработка ошибок в API endpoint
"""

import unittest
import sys
import os
import shutil
import tempfile
import json
from pathlib import Path

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService, User


# =============================================================================
# ТЕСТЫ: Создание complex_statistics.json
# =============================================================================

class TestComplexStatisticsCreation(unittest.TestCase):
    """Тесты создания complex_statistics.json при инициализации пользователя"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_complex_statistics_file_created(self):
        """Проверка создания complex_statistics.json"""
        user = self.user_service.create_user("Test User")
        
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        complex_stats_file = user_dir / "complex_statistics.json"
        
        # Проверяем, что файл создан
        self.assertTrue(complex_stats_file.exists(), 
                       "complex_statistics.json должен быть создан")
    
    def test_complex_statistics_structure(self):
        """Проверка структуры complex_statistics.json"""
        user = self.user_service.create_user("Test User")
        
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        complex_stats_file = user_dir / "complex_statistics.json"
        
        # Читаем файл
        with open(complex_stats_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Проверяем структуру
        self.assertIn("complexes", data, 
                     "complex_statistics.json должен содержать ключ 'complexes'")
        self.assertIsInstance(data["complexes"], dict,
                            "'complexes' должен быть словарем")
        self.assertEqual(len(data["complexes"]), 0,
                        "'complexes' должен быть пустым для нового пользователя")
    
    def test_all_required_files_created(self):
        """Проверка создания всех необходимых файлов"""
        user = self.user_service.create_user("Test User")
        
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        
        # Проверяем все файлы
        required_files = [
            "profile.json",
            "progress.json",
            "statistics.json",
            "complex_statistics.json"  # НОВЫЙ ФАЙЛ
        ]
        
        for filename in required_files:
            file_path = user_dir / filename
            self.assertTrue(file_path.exists(), 
                          f"{filename} должен быть создан")


# =============================================================================
# ТЕСТЫ: Валидация имени
# =============================================================================

class TestNameValidation(unittest.TestCase):
    """Тесты валидации имени пользователя"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    # --- Тесты на пустоту ---
    
    def test_empty_name_raises_error(self):
        """Пустое имя вызывает ValueError"""
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("")
        
        self.assertIn("пустым", str(context.exception).lower())
    
    def test_whitespace_only_name_raises_error(self):
        """Имя из пробелов вызывает ValueError"""
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("   ")
        
        self.assertIn("пустым", str(context.exception).lower())
    
    # --- Тесты на минимальную длину ---
    
    def test_name_too_short_raises_error(self):
        """Имя короче 2 символов вызывает ValueError"""
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("А")
        
        self.assertIn("минимум 2", str(context.exception))
    
    def test_name_exactly_2_chars_accepted(self):
        """Имя ровно 2 символа принимается"""
        user = self.user_service.create_user("Аб")
        self.assertIsNotNone(user)
        self.assertEqual(user.name, "Аб")
    
    # --- Тесты на максимальную длину ---
    
    def test_name_too_long_raises_error(self):
        """Имя длиннее 50 символов вызывает ValueError"""
        long_name = "А" * 51
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user(long_name)
        
        self.assertIn("50", str(context.exception))
    
    def test_name_exactly_50_chars_accepted(self):
        """Имя ровно 50 символов принимается"""
        name_50 = "А" * 50
        user = self.user_service.create_user(name_50)
        self.assertIsNotNone(user)
        self.assertEqual(user.name, name_50)
    
    # --- Тесты на запрещенные символы ---
    
    def test_forbidden_char_slash_raises_error(self):
        """Символ / вызывает ValueError"""
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("Иван/Петров")
        
        self.assertIn("символы", str(context.exception).lower())
    
    def test_forbidden_char_backslash_raises_error(self):
        """Символ \\ вызывает ValueError"""
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("Иван\\Петров")
        
        self.assertIn("символы", str(context.exception).lower())
    
    def test_forbidden_char_less_than_raises_error(self):
        """Символ < вызывает ValueError"""
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("Иван<Петров")
        
        self.assertIn("символы", str(context.exception).lower())
    
    def test_forbidden_char_greater_than_raises_error(self):
        """Символ > вызывает ValueError"""
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("Иван>Петров")
        
        self.assertIn("символы", str(context.exception).lower())
    
    def test_forbidden_char_colon_raises_error(self):
        """Символ : вызывает ValueError"""
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("Иван:Петров")
        
        self.assertIn("символы", str(context.exception).lower())
    
    def test_forbidden_char_quote_raises_error(self):
        """Символ " вызывает ValueError"""
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user('Иван"Петров')
        
        self.assertIn("символы", str(context.exception).lower())
    
    def test_forbidden_char_pipe_raises_error(self):
        """Символ | вызывает ValueError"""
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("Иван|Петров")
        
        self.assertIn("символы", str(context.exception).lower())
    
    def test_forbidden_char_question_raises_error(self):
        """Символ ? вызывает ValueError"""
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("Иван?Петров")
        
        self.assertIn("символы", str(context.exception).lower())
    
    def test_forbidden_char_asterisk_raises_error(self):
        """Символ * вызывает ValueError"""
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("Иван*Петров")
        
        self.assertIn("символы", str(context.exception).lower())
    
    # --- Тесты на допустимые символы ---
    
    def test_valid_name_with_spaces(self):
        """Имя с пробелами принимается"""
        user = self.user_service.create_user("Иван Иванович Петров")
        self.assertIsNotNone(user)
        self.assertEqual(user.name, "Иван Иванович Петров")
    
    def test_valid_name_with_hyphen(self):
        """Имя с дефисом принимается"""
        user = self.user_service.create_user("Анна-Мария")
        self.assertIsNotNone(user)
        self.assertEqual(user.name, "Анна-Мария")
    
    def test_valid_name_with_apostrophe(self):
        """Имя с апострофом принимается"""
        user = self.user_service.create_user("O'Brien")
        self.assertIsNotNone(user)
        self.assertEqual(user.name, "O'Brien")
    
    def test_valid_name_with_numbers(self):
        """Имя с цифрами принимается"""
        user = self.user_service.create_user("Пользователь123")
        self.assertIsNotNone(user)
        self.assertEqual(user.name, "Пользователь123")
    
    # --- Тесты на обрезку пробелов ---
    
    def test_name_trimmed(self):
        """Пробелы в начале и конце обрезаются"""
        user = self.user_service.create_user("  Иван Петров  ")
        self.assertEqual(user.name, "Иван Петров")


# =============================================================================
# ТЕСТЫ: Проверка дубликатов
# =============================================================================

class TestDuplicateNameCheck(unittest.TestCase):
    """Тесты проверки дубликатов имен"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_duplicate_name_raises_error(self):
        """Создание пользователя с существующим именем вызывает ValueError"""
        # Создаем первого пользователя
        user1 = self.user_service.create_user("Администратор")
        self.assertIsNotNone(user1)
        
        # Пытаемся создать второго с тем же именем
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("Администратор")
        
        self.assertIn("уже существует", str(context.exception))
    
    def test_duplicate_name_case_insensitive(self):
        """Проверка дубликатов регистронезависимая"""
        # Создаем пользователя
        user1 = self.user_service.create_user("Администратор")
        self.assertIsNotNone(user1)
        
        # Пытаемся создать с другим регистром
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("АДМИНИСТРАТОР")
        
        self.assertIn("уже существует", str(context.exception))
        
        # И еще один вариант
        with self.assertRaises(ValueError) as context:
            self.user_service.create_user("администратор")
        
        self.assertIn("уже существует", str(context.exception))
    
    def test_similar_names_allowed(self):
        """Похожие, но разные имена разрешены"""
        user1 = self.user_service.create_user("Иван Петров")
        user2 = self.user_service.create_user("Иван Сидоров")
        
        self.assertIsNotNone(user1)
        self.assertIsNotNone(user2)
        self.assertNotEqual(user1.user_id, user2.user_id)
    
    def test_multiple_users_with_unique_names(self):
        """Можно создать множество пользователей с уникальными именами"""
        names = ["Пользователь 1", "Пользователь 2", "Пользователь 3"]
        users = []
        
        for name in names:
            user = self.user_service.create_user(name)
            users.append(user)
        
        # Проверяем, что все созданы
        self.assertEqual(len(users), 3)
        
        # Проверяем, что все имеют разные ID
        user_ids = [u.user_id for u in users]
        self.assertEqual(len(set(user_ids)), 3)


# =============================================================================
# ТЕСТЫ: Интеграция всех исправлений
# =============================================================================

class TestProfileCreationIntegration(unittest.TestCase):
    """Интеграционные тесты всех исправлений вместе"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_valid_user_creation_full_workflow(self):
        """Полный workflow создания валидного пользователя"""
        # Создаем пользователя
        user = self.user_service.create_user("Иван Иванович Петров")
        
        # Проверяем пользователя
        self.assertIsNotNone(user)
        self.assertEqual(user.name, "Иван Иванович Петров")
        self.assertTrue(user.user_id.startswith("user_"))
        
        # Проверяем файлы
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        self.assertTrue((user_dir / "profile.json").exists())
        self.assertTrue((user_dir / "progress.json").exists())
        self.assertTrue((user_dir / "statistics.json").exists())
        self.assertTrue((user_dir / "complex_statistics.json").exists())
        
        # Проверяем содержимое complex_statistics.json
        with open(user_dir / "complex_statistics.json", 'r', encoding='utf-8') as f:
            complex_stats = json.load(f)
        self.assertIn("complexes", complex_stats)
        self.assertEqual(len(complex_stats["complexes"]), 0)
    
    def test_invalid_names_rejected(self):
        """Все невалидные имена отклоняются"""
        invalid_names = [
            "",                    # Пустое
            "   ",                 # Только пробелы
            "А",                   # Слишком короткое
            "А" * 51,              # Слишком длинное
            "Иван/Петров",         # Запрещенный символ /
            "Иван\\Петров",        # Запрещенный символ \
            "Иван<Петров",         # Запрещенный символ <
            "Иван>Петров",         # Запрещенный символ >
            "Иван:Петров",         # Запрещенный символ :
            'Иван"Петров',         # Запрещенный символ "
            "Иван|Петров",         # Запрещенный символ |
            "Иван?Петров",         # Запрещенный символ ?
            "Иван*Петров",         # Запрещенный символ *
        ]
        
        for invalid_name in invalid_names:
            with self.assertRaises(ValueError, 
                                 msg=f"Имя '{invalid_name}' должно быть отклонено"):
                self.user_service.create_user(invalid_name)
    
    def test_edge_cases(self):
        """Тесты граничных случаев"""
        # Минимальная допустимая длина
        user_min = self.user_service.create_user("Аб")
        self.assertIsNotNone(user_min)
        
        # Максимальная допустимая длина
        user_max = self.user_service.create_user("А" * 50)
        self.assertIsNotNone(user_max)
        
        # Имя с пробелами по краям (должно обрезаться)
        user_trimmed = self.user_service.create_user("  Тест  ")
        self.assertEqual(user_trimmed.name, "Тест")
        
        # Проверяем, что все пользователи разные
        all_users = self.user_service.get_all_users()
        self.assertEqual(len(all_users), 3)


if __name__ == '__main__':
    # Запуск тестов с подробным выводом
    unittest.main(verbosity=2)
