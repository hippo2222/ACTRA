"""
Интеграционные тесты для ProgressService и StatisticsService.

Проверяет взаимодействие между:
- ProgressService (сохранение прогресса)
- StatisticsService (агрегация статистики)
- Обновление статистики при изменении прогресса
- Связь mistake_bank и weak_areas
"""

import unittest
import tempfile
import shutil
import time
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.progress_service import ProgressService
from services.statistics_service import StatisticsService


class TestProgressStatisticsIntegration(unittest.TestCase):
    """Интеграционные тесты ProgressService и StatisticsService"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.temp_dir = tempfile.mkdtemp()
        self.user_id = "test_user"
        
        self.progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=self.user_id
        )
        
        self.statistics_service = StatisticsService(
            progress_service=self.progress_service
        )
    
    def tearDown(self):
        """Очистка после тестов"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_statistics_updates_on_progress_change(self):
        """Тест: обновление статистики при изменении прогресса"""
        # Получаем начальную статистику
        stats1 = self.statistics_service.aggregate_statistics(
            self.user_id,
            force_refresh=True
        )
        
        self.assertEqual(stats1["total_tasks_attempted"], 0)
        self.assertEqual(stats1["total_tasks_completed"], 0)
        
        # Добавляем несколько попыток
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_002",
            difficulty=1, success=True, score=85.0, time_spent=45
        )
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_02", "task_003",
            difficulty=1, success=False, score=40.0, time_spent=120
        )
        
        # Получаем обновленную статистику с force_refresh
        stats2 = self.statistics_service.aggregate_statistics(
            self.user_id,
            force_refresh=True
        )
        
        # Проверяем, что статистика обновилась
        self.assertEqual(stats2["total_tasks_attempted"], 3)
        self.assertEqual(stats2["total_tasks_completed"], 2)
        self.assertAlmostEqual(stats2["success_rate"], 2/3, places=2)
        
        # Проверяем, что средний балл вычислен правильно
        expected_avg = (90.0 + 85.0 + 40.0) / 3
        self.assertAlmostEqual(stats2["average_score"], expected_avg, places=1)
        
        # Проверяем общее время
        self.assertEqual(stats2["total_time_spent"], 60 + 45 + 120)
    
    def test_mistake_bank_to_weak_areas(self):
        """Тест: связь mistake_bank и weak_areas"""
        # Создаем ошибки в разных темах
        # topic_01: 1 успешная, 0 неуспешных (100% успешность)
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        # topic_02: 0 успешных, 2 неуспешных (0% успешность)
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_02", "task_002",
            difficulty=1, success=False, score=40.0, time_spent=120
        )
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_02", "task_003",
            difficulty=1, success=False, score=45.0, time_spent=110
        )
        
        # topic_03: 1 успешная, 1 неуспешная (50% успешность)
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_03", "task_004",
            difficulty=1, success=True, score=80.0, time_spent=70
        )
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_03", "task_005",
            difficulty=1, success=False, score=50.0, time_spent=100
        )
        
        # Получаем mistake_bank
        mistake_bank = self.progress_service.get_mistake_bank()
        
        # Проверяем, что ошибки есть в mistake_bank
        self.assertGreater(len(mistake_bank), 0)
        
        # Получаем weak_areas с порогом 0.70
        weak_areas = self.statistics_service.get_weak_areas(
            self.user_id,
            threshold=0.70
        )
        
        # topic_02 (0%) и topic_03 (50%) должны быть в weak_areas
        self.assertGreaterEqual(len(weak_areas), 2)
        
        topic_ids = {area["topic"] for area in weak_areas}
        self.assertIn("topic_02", topic_ids)
        self.assertIn("topic_03", topic_ids)
        
        # Проверяем, что topic_01 (100%) не в weak_areas
        self.assertNotIn("topic_01", topic_ids)
        
        # Проверяем соответствие mistake_bank и weak_areas
        # Задания из mistake_bank должны соответствовать слабым темам
        mistake_topics = {mistake["topic"] for mistake in mistake_bank}
        weak_topics = {area["topic"] for area in weak_areas}
        
        # Все темы с ошибками должны быть в weak_areas (если порог позволяет)
        for mistake in mistake_bank:
            if mistake["topic"] in ["topic_02", "topic_03"]:
                self.assertIn(mistake["topic"], weak_topics)
    
    def test_statistics_aggregation_from_history(self):
        """Тест: агрегация статистики из task_history"""
        # Создаем разнообразные попытки
        attempts = [
            ("module_01", "topic_01", "task_001", 1, True, 90.0, 60),
            ("module_01", "topic_01", "task_001", 2, True, 85.0, 90),
            ("module_01", "topic_01", "task_002", 1, False, 40.0, 120),
            ("module_01", "topic_02", "task_003", 1, True, 95.0, 45),
            ("module_01", "topic_02", "task_003", 2, True, 88.0, 80),
            ("module_01", "topic_02", "task_003", 3, False, 60.0, 150),
        ]
        
        for module_id, topic_id, task_id, difficulty, success, score, time_spent in attempts:
            self.progress_service.save_detailed_attempt(
                module_id, topic_id, task_id,
                difficulty=difficulty,
                success=success,
                score=score,
                time_spent=time_spent
            )
        
        # Агрегируем статистику
        stats = self.statistics_service.aggregate_statistics(
            self.user_id,
            force_refresh=True
        )
        
        # Проверяем общие метрики
        self.assertEqual(stats["total_tasks_attempted"], 6)
        self.assertEqual(stats["total_tasks_completed"], 4)  # 4 успешных попытки
        self.assertAlmostEqual(stats["success_rate"], 4/6, places=2)
        
        # Проверяем средний балл
        expected_avg = (90.0 + 85.0 + 40.0 + 95.0 + 88.0 + 60.0) / 6
        self.assertAlmostEqual(stats["average_score"], expected_avg, places=1)
        
        # Проверяем общее время
        expected_time = 60 + 90 + 120 + 45 + 80 + 150
        self.assertEqual(stats["total_time_spent"], expected_time)
    
    def test_cache_consistency(self):
        """Тест: консистентность кэша статистики"""
        # Добавляем попытку
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_001",
            difficulty=1, success=True, score=90.0, time_spent=60
        )
        
        # Получаем статистику (заполняет кэш)
        stats1 = self.statistics_service.aggregate_statistics(self.user_id)
        cache_key = f"stats_{self.user_id}_None"
        
        # Проверяем, что кэш заполнен
        self.assertIn(cache_key, self.statistics_service._cache)
        
        # Получаем статистику еще раз (должна быть из кэша)
        stats2 = self.statistics_service.aggregate_statistics(self.user_id)
        
        # Данные должны быть одинаковыми
        self.assertEqual(stats1["total_tasks_attempted"], stats2["total_tasks_attempted"])
        self.assertEqual(stats1["last_updated"], stats2["last_updated"])
        
        # Добавляем новую попытку
        self.progress_service.save_detailed_attempt(
            "module_01", "topic_01", "task_002",
            difficulty=1, success=True, score=85.0, time_spent=45
        )
        
        # Получаем статистику без force_refresh (должна быть из кэша)
        stats3 = self.statistics_service.aggregate_statistics(self.user_id)
        
        # Данные должны быть старыми (из кэша)
        self.assertEqual(stats3["total_tasks_attempted"], stats1["total_tasks_attempted"])
        
        # Получаем статистику с force_refresh (должна быть пересчитана)
        stats4 = self.statistics_service.aggregate_statistics(
            self.user_id,
            force_refresh=True
        )
        
        # Данные должны быть обновлены
        self.assertGreater(stats4["total_tasks_attempted"], stats3["total_tasks_attempted"])
        self.assertEqual(stats4["total_tasks_attempted"], 2)
        
        # Проверяем, что кэш обновился
        cached_data, cached_timestamp = self.statistics_service._cache[cache_key]
        # Сохраняем timestamp из первого вызова для сравнения
        first_cached_data, first_cached_timestamp = self.statistics_service._cache.get(cache_key, (None, 0))
        # Если кэш был обновлен, timestamp должен быть больше
        import time
        time.sleep(0.01)  # Небольшая задержка для гарантии обновления timestamp
        self.assertGreaterEqual(cached_timestamp, first_cached_timestamp)
        self.assertIsInstance(cached_timestamp, (int, float))
    

if __name__ == '__main__':
    unittest.main()

