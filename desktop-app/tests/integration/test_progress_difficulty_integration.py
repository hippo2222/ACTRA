"""
Интеграционные тесты для UserProgressManager + DifficultyManager (Фаза 2).

Тестирует сохранение попыток с уровнями сложности и эскалацию.
"""

import unittest
import sys
import tempfile
import shutil
from pathlib import Path

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_progress_manager import UserProgressManager

# Импорт DifficultyManager
try:
    from services.difficulty_manager import DifficultyManager
    DIFFICULTY_MANAGER_AVAILABLE = True
except ImportError:
    DIFFICULTY_MANAGER_AVAILABLE = False
    DifficultyManager = None


@unittest.skipIf(not DIFFICULTY_MANAGER_AVAILABLE, "DifficultyManager не доступен")
class TestProgressDifficultyIntegration(unittest.TestCase):
    """Интеграционные тесты UserProgressManager + DifficultyManager"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()
        self.user_id = "test_user"
        self.difficulty_manager = DifficultyManager(config_path=None)
        self.manager = UserProgressManager(
            data_dir=self.temp_dir,
            user_id=self.user_id,
            difficulty_manager=self.difficulty_manager
        )
    
    def tearDown(self):
        """Очистка после тестов"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_save_attempt_with_difficulty_level(self):
        """Сохранение попытки с уровнем сложности"""
        success = self.manager.save_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=2,
            success=True,
            time_spent=120,
            task_type="click"
        )
        
        self.assertTrue(success)
        
        # Проверяем, что попытка сохранена с правильным уровнем
        attempts = self.manager.get_all_attempts("module_01", "topic_01", "task_001")
        self.assertEqual(len(attempts), 1)
        self.assertEqual(attempts[0]["difficulty"], 2)
    
    def test_escalate_level_after_success(self):
        """Эскалация уровня после успешной попытки"""
        # Первая попытка на уровне 1 - успех с хорошим результатом
        self.manager.save_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1,
            success=True,
            time_spent=100,
            task_type="click"
        )
        
        # Проверяем, что уровень повышен
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(task_history)
        self.assertEqual(task_history["current_difficulty"], 1)  # v3.0: save_attempt не эскалирует автоматически
    
    def test_deescalate_level_after_failure(self):
        """Деэскалация уровня после неудачной попытки"""
        # Первая попытка на уровне 2 - неудача с низким результатом
        self.manager.save_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=2,
            success=False,
            time_spent=100,
            task_type="click"
        )
        
        # Проверяем, что уровень понижен
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(task_history)
        self.assertEqual(task_history["current_difficulty"], 2)  # v3.0: save_attempt не деэскалирует автоматически
    
    def test_save_current_difficulty_in_progress(self):
        """Сохранение current_difficulty в прогресс"""
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
    
    def test_load_current_difficulty_from_progress(self):
        """Загрузка current_difficulty из прогресса"""
        # Сохраняем попытку с уровнем 3
        self.manager.save_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=3,
            success=True,
            time_spent=100,
            task_type="click"
        )
        
        # Создаем новый экземпляр менеджера (имитируем перезапуск)
        new_manager = UserProgressManager(
            data_dir=self.temp_dir,
            user_id=self.user_id,
            difficulty_manager=self.difficulty_manager
        )
        
        # Проверяем, что current_difficulty загружен из прогресса
        task_history = new_manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(task_history)
        self.assertIn("current_difficulty", task_history)
        # Уровень должен быть сохранен (3 или эскалирован, но не выше максимума)
        self.assertGreaterEqual(task_history["current_difficulty"], 1)
        self.assertLessEqual(task_history["current_difficulty"], 3)
    
    def test_escalation_respects_max_level(self):
        """Эскалация не превышает максимальный уровень"""
        # Попытка на максимальном уровне 3 - успех
        self.manager.save_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=3,
            success=True,
            time_spent=100,
            task_type="click"  # click имеет максимум 3
        )
        
        # Проверяем, что уровень не превышает максимум
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(task_history)
        self.assertEqual(task_history["current_difficulty"], 3)  # Остался на максимуме
    
    def test_deescalation_respects_min_level(self):
        """Деэскалация не опускается ниже минимального уровня"""
        # Попытка на минимальном уровне 1 - неудача
        self.manager.save_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1,
            success=False,
            time_spent=100,
            task_type="click"
        )
        
        # Проверяем, что уровень не опускается ниже минимума
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(task_history)
        self.assertEqual(task_history["current_difficulty"], 1)  # Остался на минимуме
    
    def test_escalation_uses_difficulty_manager_levels(self):
        """Эскалация использует доступные уровни из DifficultyManager"""
        # Для test задания максимальный уровень 2
        self.manager.save_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=2,
            success=True,
            time_spent=100,
            task_type="test"  # test имеет только уровни [1, 2]
        )
        
        # Проверяем, что уровень не превышает максимум для test
        task_history = self.manager.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(task_history)
        self.assertEqual(task_history["current_difficulty"], 2)  # Не превышает максимум для test


if __name__ == '__main__':
    unittest.main()

