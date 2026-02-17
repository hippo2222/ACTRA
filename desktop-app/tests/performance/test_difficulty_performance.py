"""
Тесты производительности для DifficultyManager и связанных компонентов (Фаза 2).
"""

import unittest
import sys
import time
from pathlib import Path

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.difficulty_manager import DifficultyManager
from services.difficulty_config_loader import DifficultyConfigLoader


class TestDifficultyPerformance(unittest.TestCase):
    """Тесты производительности DifficultyManager"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.manager = DifficultyManager(config_path=None)
    
    def test_performance_modify_100_tasks(self):
        """Производительность модификации 100+ заданий"""
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Кликните на область'
            }
        }
        
        start_time = time.time()
        
        # Модифицируем 100 заданий
        for i in range(100):
            level = (i % 3) + 1  # Чередуем уровни 1, 2, 3
            enhanced = self.manager.enhance_task_for_level(task_data, level=level)
            self.assertIsNotNone(enhanced)
        
        end_time = time.time()
        elapsed_time = end_time - start_time
        
        # Проверяем, что операция выполнилась достаточно быстро
        # < 1 секунда для 100 операций (10ms на задание)
        self.assertLess(elapsed_time, 1.0, f"Модификация 100 заданий заняла {elapsed_time:.2f} секунд")
        avg_time_per_task = elapsed_time / 100
        self.assertLess(avg_time_per_task, 0.01, f"Среднее время на задание: {avg_time_per_task*1000:.2f}ms")
    
    def test_performance_load_config(self):
        """Производительность загрузки конфигурации"""
        start_time = time.time()
        
        # Загружаем конфигурацию
        config = DifficultyConfigLoader.load_config(config_path=None)
        
        end_time = time.time()
        elapsed_time = end_time - start_time
        
        # Проверяем, что загрузка выполнилась достаточно быстро (< 100ms)
        self.assertLess(elapsed_time, 0.1, f"Загрузка конфигурации заняла {elapsed_time*1000:.2f}ms")
    
    def test_performance_apply_overrides(self):
        """Производительность применения переопределений"""
        # Создаем конфигурацию с переопределениями
        config = {
            "version": "1.0",
            "default_levels": {
                "click": [1, 2, 3]
            },
            "task_overrides": {
                f"module_01/topic_01/task_{i:03d}": {
                    "levels": [1, 2],
                    "default_level": 1
                }
                for i in range(50)  # 50 переопределений
            },
            "type_overrides": {}
        }
        
        manager = DifficultyManager(config_path=None)
        manager.config = config
        
        start_time = time.time()
        
        # Применяем переопределения для 50 заданий
        for i in range(50):
            task_ref = f"module_01/topic_01/task_{i:03d}"
            levels = manager.get_available_levels("click", task_ref=task_ref)
            self.assertEqual(levels, [1, 2])
        
        end_time = time.time()
        elapsed_time = end_time - start_time
        
        # Проверяем, что применение переопределений выполнилось достаточно быстро (< 5ms на задание)
        self.assertLess(elapsed_time, 0.25, f"Применение 50 переопределений заняло {elapsed_time*1000:.2f}ms")
        avg_time_per_override = elapsed_time / 50
        self.assertLess(avg_time_per_override, 0.005, f"Среднее время на переопределение: {avg_time_per_override*1000:.2f}ms")


if __name__ == '__main__':
    unittest.main()

