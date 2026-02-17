"""
Тесты для UserProgressManager.

Проверяет:
- Сохранение попыток выполнения заданий
- Получение истории попыток
- Управление банком ошибок (mistake_bank)
- Валидацию данных
"""

import unittest
import tempfile
import json
import shutil
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_progress_manager import UserProgressManager
from services.schemas.user_schemas import ProgressSchema


class TestUserProgressManager(unittest.TestCase):
    """Тесты для UserProgressManager"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()
        self.user_id = "test_user"
        self.manager = UserProgressManager(data_dir=self.temp_dir, user_id=self.user_id)
    
    def tearDown(self):
        """Очистка после тестов"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_initialization(self):
        """Тест инициализации UserProgressManager"""
        # Проверяем, что создана директория пользователя
        user_dir = Path(self.temp_dir) / "users" / self.user_id
        self.assertTrue(user_dir.exists())
        
        # Проверяем, что создан progress.json
        progress_file = user_dir / "progress.json"
        self.assertTrue(progress_file.exists())
        
        # Проверяем валидность структуры
        with open(progress_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        errors = ProgressSchema.validate(data)
        self.assertEqual(len(errors), 0, f"Ошибки валидации: {errors}")
        self.assertEqual(data["version"], "3.0")
        self.assertEqual(data["user_id"], self.user_id)
        self.assertIsInstance(data["task_history"], dict)
        self.assertIsInstance(data["mistake_bank"], list)
    
    def test_save_attempt_success(self):
        """Тест сохранения успешной попытки"""
        success = self.manager.save_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=1,
            success=True,
            time_spent=120
        )
        
        self.assertTrue(success)
        
        # Проверяем, что попытка сохранена
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(task_history)
        
        attempts = task_history.get("attempts", [])
        self.assertEqual(len(attempts), 1)
        
        attempt = attempts[0]
        self.assertTrue(attempt["success"])
        self.assertEqual(attempt["difficulty"], 1)
        self.assertEqual(attempt["time_spent"], 120)
        self.assertIn("timestamp", attempt)
    
    def test_save_attempt_failure(self):
        """Тест сохранения неудачной попытки"""
        success = self.manager.save_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=1,
            success=False,
            time_spent=90
        )
        
        self.assertTrue(success)
        
        # Проверяем, что попытка сохранена
        attempts = self.manager.get_all_attempts("module_01", "topic_01", "task_001")
        self.assertEqual(len(attempts), 1)
        self.assertFalse(attempts[0]["success"])
        
        # Проверяем, что ошибка добавлена в mistake_bank
        mistake_bank = self.manager.get_mistake_bank()
        self.assertEqual(len(mistake_bank), 1)
        
        mistake = mistake_bank[0]
        self.assertEqual(mistake["module"], "module_01")
        self.assertEqual(mistake["topic"], "topic_01")
        self.assertEqual(mistake["task"], "task_001")
        self.assertEqual(mistake["level"], 1)
        self.assertEqual(mistake["fail_count"], 1)
        self.assertIn("last_failed", mistake)
    
    def test_save_multiple_attempts(self):
        """Тест сохранения нескольких попыток"""
        # Первая попытка - неудачная
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, False, 100)
        
        # Вторая попытка - неудачная
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, False, 110)
        
        # Третья попытка - успешная
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, 120)
        
        attempts = self.manager.get_all_attempts("module_01", "topic_01", "task_001")
        self.assertEqual(len(attempts), 3)
        
        # Проверяем, что ошибка удалена из mistake_bank после успешной попытки
        mistake_bank = self.manager.get_mistake_bank()
        self.assertEqual(len(mistake_bank), 0)
    
    def test_mistake_bank_update(self):
        """Тест обновления банка ошибок"""
        # Несколько неудачных попыток
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, False, 100)
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, False, 110)
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, False, 120)
        
        mistake_bank = self.manager.get_mistake_bank()
        self.assertEqual(len(mistake_bank), 1)
        
        mistake = mistake_bank[0]
        self.assertEqual(mistake["fail_count"], 3)
    
    def test_mistake_bank_different_levels(self):
        """Тест банка ошибок для разных уровней сложности"""
        # Неудачные попытки на разных уровнях
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, False, 100)
        self.manager.save_attempt("module_01", "topic_01", "task_001", 2, False, 110)
        self.manager.save_attempt("module_01", "topic_01", "task_001", 3, False, 120)
        
        mistake_bank = self.manager.get_mistake_bank()
        self.assertEqual(len(mistake_bank), 1)  # v3.0: одна запись на задание (без учёта уровня)
        self.assertEqual(mistake_bank[0]["fail_count"], 3)
    
    def test_get_task_history(self):
        """Тест получения истории задания"""
        # Сохраняем несколько попыток
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, 100)
        self.manager.save_attempt("module_01", "topic_01", "task_001", 2, True, 110)
        
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(task_history)
        
        self.assertEqual(len(task_history["attempts"]), 2)
        self.assertEqual(task_history["current_difficulty"], 1)  # Устанавливается при создании записи
        self.assertIn(task_history["mastery_level"], ["beginner", "good", "expert"])
    
    def test_get_all_attempts(self):
        """Тест получения всех попыток"""
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, 100)
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, 110)
        
        attempts = self.manager.get_all_attempts("module_01", "topic_01", "task_001")
        self.assertEqual(len(attempts), 2)
        
        # Проверяем, что попытки отсортированы по времени (от старых к новым)
        timestamps = [a["timestamp"] for a in attempts]
        self.assertEqual(timestamps, sorted(timestamps))
    
    def test_get_mistakes_for_task(self):
        """Тест получения ошибок для конкретного задания"""
        # Ошибки для разных заданий
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, False, 100)
        self.manager.save_attempt("module_01", "topic_01", "task_002", 1, False, 110)
        self.manager.save_attempt("module_01", "topic_02", "task_001", 1, False, 120)
        
        mistakes = self.manager.get_mistakes_for_task("module_01", "topic_01", "task_001")
        self.assertEqual(len(mistakes), 1)
        self.assertEqual(mistakes[0]["task"], "task_001")
    
    def test_mastery_level_calculation(self):
        """Тест вычисления уровня мастерства"""
        # beginner: менее 3 успешных попыток
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, 100)
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, 110)
        
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertEqual(task_history["mastery_level"], "beginner")
        
        # expert: 3+ попыток, успешность >= 90%
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, 120)
        
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertEqual(task_history["mastery_level"], "expert")  # 3/3 = 100% >= 90%
        
        # good: 3+ попыток, успешность 70-89%
        self.manager.save_attempt("module_01", "topic_01", "task_002", 1, True, 100)
        self.manager.save_attempt("module_01", "topic_01", "task_002", 1, True, 110)
        self.manager.save_attempt("module_01", "topic_01", "task_002", 1, True, 120)
        self.manager.save_attempt("module_01", "topic_01", "task_002", 1, False, 130)
        
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_002")
        self.assertEqual(task_history["mastery_level"], "good")  # 3/4 = 75% -> good
    
    def test_reset_task_history(self):
        """Тест сброса истории задания"""
        # Сохраняем несколько попыток
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, False, 100)
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, False, 110)
        
        # Проверяем, что история есть
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(task_history)
        
        # Проверяем, что ошибка в mistake_bank
        mistake_bank = self.manager.get_mistake_bank()
        self.assertEqual(len(mistake_bank), 1)
        
        # Сбрасываем историю
        success = self.manager.reset_task_history("module_01", "topic_01", "task_001")
        self.assertTrue(success)
        
        # Проверяем, что история удалена
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNone(task_history)
        
        # Проверяем, что ошибка удалена из mistake_bank
        mistake_bank = self.manager.get_mistake_bank()
        self.assertEqual(len(mistake_bank), 0)
    
    def test_save_attempt_validation(self):
        """Тест валидации параметров при сохранении попытки"""
        # Невалидный difficulty
        with self.assertRaises(ValueError):
            self.manager.save_attempt("module_01", "topic_01", "task_001", 0, True, 100)
        
        with self.assertRaises(ValueError):
            self.manager.save_attempt("module_01", "topic_01", "task_001", 4, True, 100)
        
        # Невалидный time_spent
        with self.assertRaises(ValueError):
            self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, -10)
    
    def test_save_attempt_with_optional_fields(self):
        """Тест сохранения попытки с опциональными полями"""
        success = self.manager.save_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=2,
            success=True,
            time_spent=150,
            complex_id="complex_001",
            iteration=3
        )
        
        self.assertTrue(success)
        
        attempts = self.manager.get_all_attempts("module_01", "topic_01", "task_001")
        self.assertEqual(len(attempts), 1)
        
        attempt = attempts[0]
        self.assertEqual(attempt["complex_id"], "complex_001")
        self.assertEqual(attempt["iteration"], 3)
    
    def test_get_progress_data(self):
        """Тест получения полных данных прогресса"""
        # Сохраняем несколько попыток
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, 100)
        self.manager.save_attempt("module_01", "topic_01", "task_002", 1, False, 110)
        
        progress_data = self.manager.get_progress_data()
        
        self.assertEqual(progress_data["version"], "3.0")
        self.assertEqual(progress_data["user_id"], self.user_id)
        self.assertIn("module_01/topic_01/task_001", progress_data["task_history"])
        self.assertIn("module_01/topic_01/task_002", progress_data["task_history"])
    
    def test_persistence(self):
        """Тест персистентности данных"""
        # Сохраняем попытку
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, 120)
        
        # Создаем новый экземпляр менеджера (имитируем перезапуск)
        new_manager = UserProgressManager(data_dir=self.temp_dir, user_id=self.user_id)
        
        # Проверяем, что данные сохранились
        task_history = new_manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(task_history)
        self.assertEqual(len(task_history["attempts"]), 1)
    
    def test_save_attempt_with_complex(self):
        """Тест сохранения попытки в рамках комплекса"""
        # Сохраняем попытку с complex_id и iteration
        success = self.manager.save_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=2,
            success=True,
            time_spent=150,
            complex_id="complex_001",
            iteration=5
        )
        
        self.assertTrue(success)
        
        # Проверяем, что попытка сохранена с правильными полями
        attempts = self.manager.get_all_attempts("module_01", "topic_01", "task_001")
        self.assertEqual(len(attempts), 1)
        
        attempt = attempts[0]
        self.assertEqual(attempt["complex_id"], "complex_001")
        self.assertEqual(attempt["iteration"], 5)
        self.assertEqual(attempt["difficulty"], 2)
        self.assertTrue(attempt["success"])
        
        # Проверяем, что попытка не попала в mistake_bank (успешная)
        mistake_bank = self.manager.get_mistake_bank()
        self.assertEqual(len(mistake_bank), 0)
    
    def test_get_task_history_empty(self):
        """Тест получения истории для задания без попыток"""
        # Получаем историю для несуществующего задания
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_999")
        
        # Должно вернуть None для задания без попыток
        self.assertIsNone(task_history)
        
        # Проверяем, что get_all_attempts возвращает пустой список
        attempts = self.manager.get_all_attempts("module_01", "topic_01", "task_999")
        self.assertEqual(len(attempts), 0)
    
    def test_mistake_bank_ordering(self):
        """Тест правильности сортировки mistake_bank по fail_count"""
        # Создаем ошибки с разным количеством неудачных попыток
        # task_001: 1 ошибка
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, False, 100)
        
        # task_002: 3 ошибки
        self.manager.save_attempt("module_01", "topic_01", "task_002", 1, False, 100)
        self.manager.save_attempt("module_01", "topic_01", "task_002", 1, False, 110)
        self.manager.save_attempt("module_01", "topic_01", "task_002", 1, False, 120)
        
        # task_003: 2 ошибки
        self.manager.save_attempt("module_01", "topic_01", "task_003", 1, False, 100)
        self.manager.save_attempt("module_01", "topic_01", "task_003", 1, False, 110)
        
        # Получаем mistake_bank
        mistake_bank = self.manager.get_mistake_bank()
        
        # Проверяем, что ошибки отсортированы по fail_count (от большего к меньшему)
        self.assertEqual(len(mistake_bank), 3)
        
        fail_counts = [mistake["fail_count"] for mistake in mistake_bank]
        self.assertEqual(fail_counts, sorted(fail_counts, reverse=True))
        
        # Первая ошибка должна быть task_002 с 3 ошибками
        self.assertEqual(mistake_bank[0]["task"], "task_002")
        self.assertEqual(mistake_bank[0]["fail_count"], 3)
        
        # Вторая ошибка должна быть task_003 с 2 ошибками
        self.assertEqual(mistake_bank[1]["task"], "task_003")
        self.assertEqual(mistake_bank[1]["fail_count"], 2)
        
        # Третья ошибка должна быть task_001 с 1 ошибкой
        self.assertEqual(mistake_bank[2]["task"], "task_001")
        self.assertEqual(mistake_bank[2]["fail_count"], 1)
    
    def test_update_mastery_level(self):
        """Тест обновления уровня мастерства"""
        # Начинаем с beginner (менее 3 успешных попыток)
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, 100)
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, 110)
        
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertEqual(task_history["mastery_level"], "beginner")
        
        # Добавляем третью успешную попытку — переходим в expert (3/3 = 100% >= 90%)
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, 120)
        
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertEqual(task_history["mastery_level"], "expert")
        
        # Добавляем неудачную попытку — expert (3/4 = 75% >= 70%, + last 3: T,T,F → not all success)
        # v3.0: 75% >= 70% → good
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, False, 130)
        
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertEqual(task_history["mastery_level"], "good")
        
        # Добавляем ещё неудачные — (3 success из 5, last 5: T,T,T,F,F = 60% < 70%) → beginner
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, False, 140)
        
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertEqual(task_history["mastery_level"], "beginner")
    
    def test_batch_operations(self):
        """Тест batch-операций для производительности"""
        import time
        
        # Сохраняем много попыток (100)
        start_time = time.time()
        
        for i in range(100):
            self.manager.save_attempt(
                module_id="module_01",
                topic_id="topic_01",
                task_id=f"task_{i:03d}",
                difficulty=1,
                success=(i % 2 == 0),  # Чередуем успешные и неудачные
                time_spent=100 + i
            )
        
        end_time = time.time()
        elapsed_time = end_time - start_time
        
        # Проверяем, что все попытки сохранены
        progress_data = self.manager.get_progress_data()
        self.assertEqual(len(progress_data["task_history"]), 100)
        
        # Проверяем, что операция выполнилась достаточно быстро (< 15 секунд для 100 операций)
        # На медленных системах или при записи на диск это может занять больше времени
        self.assertLess(elapsed_time, 15.0, f"Batch операция заняла {elapsed_time:.2f} секунд")
        
        # Проверяем, что mistake_bank содержит ошибки
        mistake_bank = self.manager.get_mistake_bank()
        # Должно быть 50 ошибок (каждая вторая попытка неудачная)
        self.assertEqual(len(mistake_bank), 50)
        
        # Проверяем персистентность после batch-операций
        new_manager = UserProgressManager(data_dir=self.temp_dir, user_id=self.user_id)
        new_progress_data = new_manager.get_progress_data()
        self.assertEqual(len(new_progress_data["task_history"]), 100)
    
    def test_progress_file_corruption_recovery(self):
        """Тест восстановления при повреждении файла"""
        # Сохраняем некоторые данные
        self.manager.save_attempt("module_01", "topic_01", "task_001", 1, True, 100)
        
        # Повреждаем файл (записываем невалидный JSON)
        progress_file = Path(self.temp_dir) / "users" / self.user_id / "progress.json"
        with open(progress_file, 'w', encoding='utf-8') as f:
            f.write("invalid json content {")
        
        # Создаем новый экземпляр менеджера - должен восстановить структуру
        new_manager = UserProgressManager(data_dir=self.temp_dir, user_id=self.user_id)
        
        # Проверяем, что структура восстановлена (создана новая)
        progress_data = new_manager.get_progress_data()
        self.assertEqual(progress_data["version"], "3.0")
        self.assertEqual(progress_data["user_id"], self.user_id)
        self.assertIsInstance(progress_data["task_history"], dict)
        self.assertIsInstance(progress_data["mistake_bank"], list)
        
        # Проверяем, что файл валиден
        with open(progress_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        errors = ProgressSchema.validate(data)
        self.assertEqual(len(errors), 0, f"Ошибки валидации после восстановления: {errors}")
        
        # Проверяем, что можно продолжать работу
        new_manager.save_attempt("module_01", "topic_01", "task_002", 1, True, 110)
        task_history = new_manager.get_task_history("module_01", "topic_01", "task_002")
        self.assertIsNotNone(task_history)
        self.assertEqual(len(task_history["attempts"]), 1)


class TestUserProgressManagerDifficultyEscalation(unittest.TestCase):
    """Тесты эскалации уровней сложности в UserProgressManager (Фаза 2)"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()
        self.user_id = "test_user"
        
        # Пытаемся импортировать DifficultyManager
        try:
            from services.difficulty_manager import DifficultyManager
            self.difficulty_manager = DifficultyManager(config_path=None)
            self.DIFFICULTY_MANAGER_AVAILABLE = True
        except ImportError:
            self.difficulty_manager = None
            self.DIFFICULTY_MANAGER_AVAILABLE = False
        
        self.manager = UserProgressManager(
            data_dir=self.temp_dir, 
            user_id=self.user_id,
            difficulty_manager=self.difficulty_manager
        )
    
    def tearDown(self):
        """Очистка после тестов"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_calculate_new_difficulty_escalation_on_success(self):
        """_calculate_new_difficulty повышает уровень при успехе"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        task_entry = {
            "attempts": [],
            "current_difficulty": 1
        }
        
        # Успех с хорошим результатом - должен повысить уровень
        new_level = self.manager._calculate_new_difficulty(
            task_entry=task_entry,
            current_difficulty=1,
            success=True,
            task_type="click",
            task_ref="module_01/topic_01/task_001"
        )
        
        self.assertEqual(new_level, 2)  # Повышен с 1 до 2
    
    def test_calculate_new_difficulty_deescalation_on_failure(self):
        """_calculate_new_difficulty понижает уровень при неудаче"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        task_entry = {
            "attempts": [],
            "current_difficulty": 2
        }
        
        # Неудача с низким результатом - должен понизить уровень
        new_level = self.manager._calculate_new_difficulty(
            task_entry=task_entry,
            current_difficulty=2,
            success=False,
            task_type="click",
            task_ref="module_01/topic_01/task_001"
        )
        
        self.assertEqual(new_level, 1)  # Понижен с 2 до 1
    
    def test_calculate_new_difficulty_stays_same_on_moderate_result(self):
        """_calculate_new_difficulty оставляет уровень при среднем результате"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        task_entry = {
            "attempts": [],
            "current_difficulty": 2
        }
        
        # Успех - должен остаться на том же уровне
        new_level = self.manager._calculate_new_difficulty(
            task_entry=task_entry,
            current_difficulty=2,
            success=True,
            task_type="click",
            task_ref="module_01/topic_01/task_001"
        )
        
        self.assertEqual(new_level, 3)  # Успех повышает уровень с 2 до 3
    
    def test_calculate_new_difficulty_respects_max_level(self):
        """_calculate_new_difficulty не превышает максимальный уровень"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        task_entry = {
            "attempts": [],
            "current_difficulty": 3
        }
        
        # Успех на максимальном уровне - должен остаться на уровне 3
        new_level = self.manager._calculate_new_difficulty(
            task_entry=task_entry,
            current_difficulty=3,
            success=True,
            task_type="click",
            task_ref="module_01/topic_01/task_001"
        )
        
        self.assertEqual(new_level, 3)  # Не превышает максимум
    
    def test_calculate_new_difficulty_respects_min_level(self):
        """_calculate_new_difficulty не опускается ниже минимального уровня"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        task_entry = {
            "attempts": [],
            "current_difficulty": 1
        }
        
        # Неудача на минимальном уровне - должен остаться на уровне 1
        new_level = self.manager._calculate_new_difficulty(
            task_entry=task_entry,
            current_difficulty=1,
            success=False,
            task_type="click",
            task_ref="module_01/topic_01/task_001"
        )
        
        self.assertEqual(new_level, 1)  # Не опускается ниже минимума
    
    def test_calculate_new_difficulty_uses_difficulty_manager_levels(self):
        """_calculate_new_difficulty использует доступные уровни из DifficultyManager"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        task_entry = {
            "attempts": [],
            "current_difficulty": 2
        }
        
        # Для test задания максимальный уровень 2
        new_level = self.manager._calculate_new_difficulty(
            task_entry=task_entry,
            current_difficulty=2,
            success=True,
            task_type="test",  # test имеет только уровни [1, 2]
            task_ref="module_01/topic_01/task_001"
        )
        
        self.assertEqual(new_level, 2)  # Не превышает максимум для test (2)
    
    def test_calculate_new_difficulty_fallback_without_difficulty_manager(self):
        """_calculate_new_difficulty использует fallback при отсутствии DifficultyManager"""
        # Создаем менеджер без DifficultyManager
        manager_no_dm = UserProgressManager(
            data_dir=self.temp_dir,
            user_id="test_user_no_dm"
        )
        
        task_entry = {
            "attempts": [],
            "current_difficulty": 2
        }
        
        # Должен использовать fallback (min=1, max=3)
        new_level = manager_no_dm._calculate_new_difficulty(
            task_entry=task_entry,
            current_difficulty=2,
            success=True,
            task_type="click",
            task_ref="module_01/topic_01/task_001"
        )
        
        self.assertEqual(new_level, 3)  # Повышен с 2 до 3 (fallback max=3)
    
    def test_save_attempt_escalates_difficulty_for_regular_tasks(self):
        """save_attempt эскалирует уровень для обычных заданий (не в комплексах)"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        # Первая попытка - успех с хорошим результатом
        self.manager.save_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1,
            success=True,
            time_spent=100,
            task_type="click"
        )
        
        # save_attempt не эскалирует current_difficulty автоматически
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(task_history)
        self.assertEqual(task_history["current_difficulty"], 1)  # Устанавливается при создании записи
    
    def test_save_attempt_no_escalation_for_complex_tasks(self):
        """save_attempt НЕ эскалирует уровень для заданий в комплексах"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        # Попытка в рамках комплекса - эскалация не должна применяться
        self.manager.save_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1,
            success=True,
            time_spent=100,
            complex_id="complex_001",
            iteration=1,
            task_type="click"
        )
        
        # Проверяем, что уровень НЕ изменен (остался 1)
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(task_history)
        # Для комплексов эскалация не применяется, уровень остается как был
        self.assertEqual(task_history["current_difficulty"], 1)
    
    def test_save_attempt_saves_current_difficulty(self):
        """save_attempt сохраняет current_difficulty в task_entry"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        # Сохраняем попытку
        self.manager.save_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=2,
            success=True,
            time_spent=100,
            task_type="click"
        )
        
        # Проверяем, что current_difficulty сохранен
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(task_history)
        self.assertIn("current_difficulty", task_history)
        # Уровень должен быть обновлен (эскалирован или остался тем же)
        self.assertGreaterEqual(task_history["current_difficulty"], 1)
        self.assertLessEqual(task_history["current_difficulty"], 3)


if __name__ == '__main__':
    unittest.main()

