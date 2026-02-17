"""
Тесты производительности для batch-операций.

Проверяет:
- Массовое сохранение попыток
- Производительность кэша статистики
- Обработку большого mistake_bank
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


class TestBatchOperations(unittest.TestCase):
    """Тесты производительности batch-операций"""
    
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
    
    def test_batch_save_attempts(self):
        """Тест: массовое сохранение попыток"""
        # Сохраняем 100 попыток
        start_time = time.time()
        
        for i in range(100):
            self.progress_service.save_detailed_attempt(
                module_id="module_01",
                topic_id="topic_01",
                task_id=f"task_{i:03d}",
                difficulty=1,
                success=(i % 2 == 0),  # Чередуем успешные и неуспешные
                score=50.0 + (i % 50),
                time_spent=60 + i
            )
        
        end_time = time.time()
        elapsed_time = end_time - start_time
        
        # Проверяем, что все попытки сохранены
        progress_data = self.progress_service.progress_manager.get_progress_data()
        self.assertEqual(len(progress_data["task_history"]), 100)
        
        # Проверяем, что операция выполнилась достаточно быстро (< 15 секунд для 100 операций)
        # На медленных системах или при записи на диск это может занять больше времени
        self.assertLess(elapsed_time, 15.0, f"Batch операция заняла {elapsed_time:.2f} секунд")
        
        # Проверяем, что mistake_bank содержит ошибки
        mistake_bank = self.progress_service.get_mistake_bank()
        self.assertEqual(len(mistake_bank), 50)  # 50 неуспешных попыток
    
    def test_statistics_cache_performance(self):
        """Тест: производительность кэша статистики"""
        # Добавляем данные
        for i in range(50):
            self.progress_service.save_detailed_attempt(
                "module_01", "topic_01", f"task_{i:03d}",
                difficulty=1, success=True, score=80.0, time_spent=60
            )
        
        # Первый вызов (вычисление)
        start_time = time.time()
        stats1 = self.statistics_service.aggregate_statistics(
            self.user_id,
            force_refresh=True
        )
        first_call_time = time.time() - start_time
        
        # Второй вызов (из кэша)
        start_time = time.time()
        stats2 = self.statistics_service.aggregate_statistics(self.user_id)
        second_call_time = time.time() - start_time
        
        # Проверяем, что данные одинаковые
        self.assertEqual(stats1["total_tasks_attempted"], stats2["total_tasks_attempted"])
        
        # Проверяем, что кэш работает (данные одинаковые)
        self.assertEqual(stats1, stats2, "Кэш должен возвращать те же данные")
        # Проверяем, что второй вызов не медленнее первого (или быстрее, если время > 0)
        if first_call_time > 0:
            self.assertLessEqual(second_call_time, first_call_time,
                               "Кэш должен ускорить или не замедлить второй вызов")
        # Если оба вызова слишком быстрые для измерения (< 0.001 сек), просто проверяем, что кэш работает
    
    def test_large_mistake_bank_handling(self):
        """Тест: обработка большого mistake_bank"""
        # Создаем много ошибок
        for i in range(100):
            # Несколько неудачных попыток для каждого задания
            for j in range(2 + (i % 3)):  # 2-4 неудачных попытки
                self.progress_service.save_detailed_attempt(
                    "module_01", "topic_01", f"task_{i:03d}",
                    difficulty=1, success=False, score=40.0 + j, time_spent=120
                )
        
        # Получаем mistake_bank
        start_time = time.time()
        mistake_bank = self.progress_service.get_mistake_bank()
        elapsed_time = time.time() - start_time
        
        # Проверяем, что все ошибки получены
        self.assertEqual(len(mistake_bank), 100)
        
        # Проверяем, что операция выполнилась быстро (< 0.1 секунды)
        self.assertLess(elapsed_time, 0.1, 
                       f"Получение mistake_bank заняло {elapsed_time:.2f} секунд")
        
        # Проверяем, что ошибки отсортированы по fail_count
        fail_counts = [mistake["fail_count"] for mistake in mistake_bank]
        self.assertEqual(fail_counts, sorted(fail_counts, reverse=True))


if __name__ == '__main__':
    unittest.main()

