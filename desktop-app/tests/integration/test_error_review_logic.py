"""
Тесты логики ErrorReviewScreen (без GUI).

Проверяет:
- Загрузку mistake_bank для отображения
- Подготовку данных для повторного запуска задания
- Фильтрацию ошибок по критериям
- Сортировку ошибок
"""

import unittest
import tempfile
import shutil
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService
from services.progress_service import ProgressService


class TestErrorReviewLogic(unittest.TestCase):
    """Тесты логики ErrorReviewScreen"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
        self.user = self.user_service.create_user("Error Review User")
        
        self.progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=self.user.user_id
        )
    
    def tearDown(self):
        """Очистка после тестов"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_mistake_bank_loading(self):
        """Тест: загрузка mistake_bank для отображения"""
        # Добавляем ошибки
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=False, score=40.0, time_spent=120
        )
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_002",
            difficulty=1, success=False, score=45.0, time_spent=110
        )
        
        # Получаем mistake_bank
        mistake_bank = self.progress_service.get_mistake_bank()
        
        # Проверяем структуру данных для UI
        self.assertIsInstance(mistake_bank, list)
        self.assertEqual(len(mistake_bank), 2)
        
        for mistake in mistake_bank:
            self.assertIn("module", mistake)
            self.assertIn("topic", mistake)
            self.assertIn("task", mistake)
            self.assertIn("level", mistake)
            self.assertIn("fail_count", mistake)
            self.assertIn("last_failed", mistake)
    
    def test_task_restart_preparation(self):
        """Тест: подготовка данных для повторного запуска задания"""
        # Добавляем ошибку
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=False, score=40.0, time_spent=120
        )
        
        # Получаем ошибку
        mistakes = self.progress_service.get_mistakes_for_task(
            "module_01", "topic_01", "task_001"
        )
        
        self.assertEqual(len(mistakes), 1)
        mistake = mistakes[0]
        
        # Проверяем, что данные достаточны для повторного запуска
        self.assertIn("module", mistake)
        self.assertIn("topic", mistake)
        self.assertIn("task", mistake)
        self.assertIn("level", mistake)  # Уровень сложности
        
        # Проверяем, что можно получить историю задания
        history = self.progress_service.get_task_history(
            mistake["module"], mistake["topic"], mistake["task"]
        )
        self.assertIsNotNone(history)
    
    def test_error_filtering(self):
        """Тест: фильтрация ошибок по критериям"""
        # Добавляем ошибки на разных уровнях и в разных темах
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001", difficulty=1, success=False, score=40.0, time_spent=120
        )
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_002", difficulty=2, success=False, score=45.0, time_spent=110
        )
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_02", "task_003", difficulty=1, success=False, score=50.0, time_spent=100
        )
        
        # Получаем все ошибки
        all_mistakes = self.progress_service.get_mistake_bank()
        
        # Фильтруем по теме
        topic_01_mistakes = [
            m for m in all_mistakes
            if m["topic"] == "topic_01"
        ]
        self.assertEqual(len(topic_01_mistakes), 2)
        
        # Фильтруем по уровню сложности
        level_1_mistakes = [
            m for m in all_mistakes
            if m["level"] == 1
        ]
        self.assertEqual(len(level_1_mistakes), 2)
        
        # Фильтруем по модулю
        module_01_mistakes = [
            m for m in all_mistakes
            if m["module"] == "module_01"
        ]
        self.assertEqual(len(module_01_mistakes), 3)
    
    def test_error_sorting(self):
        """Тест: сортировка ошибок"""
        # Добавляем ошибки с разным количеством неудачных попыток
        # task_001: 1 ошибка
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001", difficulty=1, success=False, score=40.0, time_spent=120
        )
        
        # task_002: 3 ошибки
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_002", difficulty=1, success=False, score=40.0, time_spent=120
        )
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_002", difficulty=1, success=False, score=45.0, time_spent=110
        )
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_002", difficulty=1, success=False, score=50.0, time_spent=100
        )
        
        # task_003: 2 ошибки
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_003", difficulty=1, success=False, score=40.0, time_spent=120
        )
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_003", difficulty=1, success=False, score=45.0, time_spent=110
        )
        
        # Получаем mistake_bank
        mistake_bank = self.progress_service.get_mistake_bank()
        
        # Проверяем, что ошибки отсортированы по fail_count (от большего к меньшему)
        fail_counts = [mistake["fail_count"] for mistake in mistake_bank]
        self.assertEqual(fail_counts, sorted(fail_counts, reverse=True))
        
        # Проверяем порядок
        self.assertEqual(mistake_bank[0]["task"], "task_002")  # 3 ошибки
        self.assertEqual(mistake_bank[1]["task"], "task_003")   # 2 ошибки
        self.assertEqual(mistake_bank[2]["task"], "task_001")  # 1 ошибка


if __name__ == '__main__':
    unittest.main()

