"""
Тесты для схем валидации пользовательских данных.

Проверяет валидацию:
- profile.json
- progress.json
- statistics.json
"""

import unittest
import tempfile
import json
from pathlib import Path
from datetime import datetime

import sys
from pathlib import Path

# Добавляем путь для импорта
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.schemas.user_schemas import (
    ProfileSchema,
    ProgressSchema,
    StatisticsSchema,
    validate_profile,
    validate_progress,
    validate_statistics,
)


class TestProfileSchema(unittest.TestCase):
    """Тесты для ProfileSchema"""
    
    def test_valid_profile(self):
        """Тест валидного профиля"""
        data = {
            "user_id": "user_123",
            "profile": {
                "name": "Иван Иванов",
                "created_at": "2024-01-01T00:00:00",
                "settings": {}
            }
        }
        
        errors = ProfileSchema.validate(data)
        self.assertEqual(len(errors), 0, f"Ожидалось отсутствие ошибок, получено: {errors}")
    
    def test_missing_user_id(self):
        """Тест отсутствия user_id"""
        data = {
            "profile": {
                "name": "Иван Иванов",
                "created_at": "2024-01-01T00:00:00"
            }
        }
        
        errors = ProfileSchema.validate(data)
        self.assertGreater(len(errors), 0)
        self.assertTrue(any("user_id" in err.lower() for err in errors))
    
    def test_missing_profile(self):
        """Тест отсутствия profile"""
        data = {
            "user_id": "user_123"
        }
        
        errors = ProfileSchema.validate(data)
        self.assertGreater(len(errors), 0)
        self.assertTrue(any("profile" in err.lower() for err in errors))
    
    def test_missing_name(self):
        """Тест отсутствия name"""
        data = {
            "user_id": "user_123",
            "profile": {
                "created_at": "2024-01-01T00:00:00"
            }
        }
        
        errors = ProfileSchema.validate(data)
        self.assertGreater(len(errors), 0)
        self.assertTrue(any("name" in err.lower() for err in errors))
    
    
    def test_invalid_date_format(self):
        """Тест невалидного формата даты"""
        data = {
            "user_id": "user_123",
            "profile": {
                "name": "Иван Иванов",
                "created_at": "2024-01-01"  # Неполный формат (без времени)
            }
        }
        
        errors = ProfileSchema.validate(data)
        self.assertGreater(len(errors), 0, "Ожидалась ошибка валидации для неполного формата даты")
        self.assertTrue(any("created_at" in err.lower() or "формат" in err.lower() or "время" in err.lower() for err in errors),
                       f"Ошибка должна содержать информацию о формате даты. Полученные ошибки: {errors}")


class TestProgressSchema(unittest.TestCase):
    """Тесты для ProgressSchema"""
    
    def test_valid_progress(self):
        """Тест валидного progress.json"""
        data = {
            "version": "2.0",
            "user_id": "user_123",
            "task_history": {
                "module_01/topic_01/task_001": {
                    "attempts": [
                        {
                            "timestamp": "2025-11-16T14:03:00",
                            "difficulty": 1,
                            "success": True,
                            "score": 95.0,
                            "time_spent": 45,
                            "complex_id": None,
                            "iteration": None
                        }
                    ],
                    "current_difficulty": 2,
                    "mastery_level": "good"
                }
            },
            "mistake_bank": [
                {
                    "module": "module_01",
                    "topic": "topic_01",
                    "task": "task_005",
                    "level": 1,
                    "fail_count": 3,
                    "last_failed": "2025-11-15T12:00:00"
                }
            ]
        }
        
        errors = ProgressSchema.validate(data)
        self.assertEqual(len(errors), 0, f"Ожидалось отсутствие ошибок, получено: {errors}")
    
    def test_missing_version(self):
        """Тест отсутствия version"""
        data = {
            "user_id": "user_123",
            "task_history": {},
            "mistake_bank": []
        }
        
        errors = ProgressSchema.validate(data)
        self.assertGreater(len(errors), 0)
        self.assertTrue(any("version" in err.lower() for err in errors))
    
    def test_wrong_version(self):
        """Тест неправильной версии"""
        data = {
            "version": "1.0",  # Неправильная версия
            "user_id": "user_123",
            "task_history": {},
            "mistake_bank": []
        }
        
        errors = ProgressSchema.validate(data)
        self.assertGreater(len(errors), 0)
        self.assertTrue(any("версия" in err.lower() or "version" in err.lower() for err in errors))
    
    def test_invalid_attempt(self):
        """Тест невалидной попытки"""
        data = {
            "version": "2.0",
            "user_id": "user_123",
            "task_history": {
                "module_01/topic_01/task_001": {
                    "attempts": [
                        {
                            "timestamp": "2025-11-16T14:03:00",
                            "difficulty": 5,  # Невалидное значение
                            "success": True,
                            "score": 95.0,
                            "time_spent": 45
                        }
                    ]
                }
            },
            "mistake_bank": []
        }
        
        errors = ProgressSchema.validate(data)
        self.assertGreater(len(errors), 0)
        self.assertTrue(any("difficulty" in err.lower() for err in errors))
    
    def test_invalid_mistake_bank(self):
        """Тест невалидного mistake_bank"""
        data = {
            "version": "2.0",
            "user_id": "user_123",
            "task_history": {},
            "mistake_bank": [
                {
                    "module": "module_01",
                    "topic": "topic_01",
                    "task": "task_005",
                    "level": 5,  # Невалидное значение
                    "fail_count": 3,
                    "last_failed": "2025-11-15T12:00:00"
                }
            ]
        }
        
        errors = ProgressSchema.validate(data)
        self.assertGreater(len(errors), 0)
        self.assertTrue(any("level" in err.lower() for err in errors))


class TestStatisticsSchema(unittest.TestCase):
    """Тесты для StatisticsSchema"""
    
    def test_valid_statistics(self):
        """Тест валидного statistics.json"""
        data = {
            "total_tasks_attempted": 150,
            "total_tasks_completed": 120,
            "success_rate": 0.80,
            "by_task_type": {
                "click": {"attempts": 50, "success_rate": 0.85},
                "draw": {"attempts": 30, "success_rate": 0.70}
            },
            "weak_areas": [
                {"topic": "topic_03", "success_rate": 0.60}
            ]
        }
        
        errors = StatisticsSchema.validate(data)
        self.assertEqual(len(errors), 0, f"Ожидалось отсутствие ошибок, получено: {errors}")
    
    def test_missing_total_tasks_attempted(self):
        """Тест отсутствия total_tasks_attempted"""
        data = {
            "total_tasks_completed": 120,
            "success_rate": 0.80
        }
        
        errors = StatisticsSchema.validate(data)
        self.assertGreater(len(errors), 0)
        self.assertTrue(any("total_tasks_attempted" in err.lower() for err in errors))
    
    def test_invalid_success_rate(self):
        """Тест невалидного success_rate"""
        data = {
            "total_tasks_attempted": 150,
            "total_tasks_completed": 120,
            "success_rate": 1.5  # Невалидное значение (> 1.0)
        }
        
        errors = StatisticsSchema.validate(data)
        self.assertGreater(len(errors), 0)
        self.assertTrue(any("success_rate" in err.lower() for err in errors))
    
    def test_completed_greater_than_attempted(self):
        """Тест случая, когда completed > attempted"""
        data = {
            "total_tasks_attempted": 100,
            "total_tasks_completed": 150,  # Больше чем attempted
            "success_rate": 0.80
        }
        
        errors = StatisticsSchema.validate(data)
        self.assertGreater(len(errors), 0)
        self.assertTrue(any("completed" in err.lower() and "attempted" in err.lower() for err in errors))


class TestUserSchemasIntegration(unittest.TestCase):
    """Интеграционные тесты для создания структуры данных"""
    
    def test_create_user_directory_structure(self):
        """Тест создания структуры директорий и файлов"""
        with tempfile.TemporaryDirectory() as tmpdir:
            users_dir = Path(tmpdir) / "users"
            users_dir.mkdir(parents=True, exist_ok=True)
            
            user_id = "test_user_123"
            user_dir = users_dir / user_id
            user_dir.mkdir(parents=True, exist_ok=True)
            
            # Создаем profile.json
            profile_data = {
                "user_id": user_id,
                "profile": {
                    "name": "Test User",
                    "created_at": datetime.now().isoformat(),
                    "settings": {
                    }
                }
            }
            profile_path = user_dir / "profile.json"
            with open(profile_path, 'w', encoding='utf-8') as f:
                json.dump(profile_data, f, ensure_ascii=False, indent=2)
            
            # Валидируем profile.json
            errors = validate_profile(profile_data)
            self.assertEqual(len(errors), 0, f"Ошибки валидации profile: {errors}")
            
            # Проверяем, что файл создан
            self.assertTrue(profile_path.exists(), "profile.json должен быть создан")
            
            # Создаем progress.json
            progress_data = {
                "version": "2.0",
                "user_id": user_id,
                "task_history": {},
                "mistake_bank": []
            }
            progress_path = user_dir / "progress.json"
            with open(progress_path, 'w', encoding='utf-8') as f:
                json.dump(progress_data, f, ensure_ascii=False, indent=2)
            
            # Валидируем progress.json
            errors = validate_progress(progress_data)
            self.assertEqual(len(errors), 0, f"Ошибки валидации progress: {errors}")
            
            # Проверяем, что файл создан
            self.assertTrue(progress_path.exists(), "progress.json должен быть создан")
            
            # Создаем statistics.json
            statistics_data = {
                "total_tasks_attempted": 0,
                "total_tasks_completed": 0,
                "success_rate": 0.0,
                "by_task_type": {},
                "weak_areas": []
            }
            statistics_path = user_dir / "statistics.json"
            with open(statistics_path, 'w', encoding='utf-8') as f:
                json.dump(statistics_data, f, ensure_ascii=False, indent=2)
            
            # Валидируем statistics.json
            errors = validate_statistics(statistics_data)
            self.assertEqual(len(errors), 0, f"Ошибки валидации statistics: {errors}")
            
            # Проверяем, что файл создан
            self.assertTrue(statistics_path.exists(), "statistics.json должен быть создан")
            
            # Проверяем структуру директорий
            self.assertTrue(users_dir.exists(), "Директория users должна существовать")
            self.assertTrue(user_dir.exists(), f"Директория {user_id} должна существовать")
            self.assertEqual(len(list(user_dir.iterdir())), 3, "Должно быть 3 файла в директории пользователя")
    
    def test_profile_schema_invalid_data(self):
        """Тест валидации невалидных данных профиля"""
        # Невалидный user_id (пустой)
        data1 = {
            "user_id": "",
            "profile": {
                "name": "Иван Иванов",
                "created_at": "2024-01-01T00:00:00",
                "settings": {}
            }
        }
        errors1 = ProfileSchema.validate(data1)
        self.assertGreater(len(errors1), 0)
        
        # Невалидный name (пустой)
        data2 = {
            "user_id": "user_123",
            "profile": {
                "name": "",
                "created_at": "2024-01-01T00:00:00",
                "settings": {}
            }
        }
        errors2 = ProfileSchema.validate(data2)
        self.assertGreater(len(errors2), 0)
        
        # Невалидный created_at (не ISO формат)
        data3 = {
            "user_id": "user_123",
            "profile": {
                "name": "Иван Иванов",
                "created_at": "01-01-2024",  # Неправильный формат
                "settings": {}
            }
        }
        errors3 = ProfileSchema.validate(data3)
        self.assertGreater(len(errors3), 0)
        
        # Невалидный settings (не словарь)
        data4 = {
            "user_id": "user_123",
            "profile": {
                "name": "Иван Иванов",
                "created_at": "2024-01-01T00:00:00",
                "settings": "invalid"  # Не словарь
            }
        }
        errors4 = ProfileSchema.validate(data4)
        self.assertGreater(len(errors4), 0)
    
    def test_progress_schema_version_compatibility(self):
        """Тест совместимости версий схем"""
        # Версия 2.0 должна быть валидной
        data_v2 = {
            "version": "2.0",
            "user_id": "user_123",
            "task_history": {},
            "mistake_bank": []
        }
        errors_v2 = ProgressSchema.validate(data_v2)
        self.assertEqual(len(errors_v2), 0, f"Версия 2.0 должна быть валидной: {errors_v2}")
        
        # Версия 1.0 не должна быть валидной (требуется 2.0)
        data_v1 = {
            "version": "1.0",
            "user_id": "user_123",
            "task_history": {},
            "mistake_bank": []
        }
        errors_v1 = ProgressSchema.validate(data_v1)
        self.assertGreater(len(errors_v1), 0, "Версия 1.0 не должна быть валидной")
        
        # Версия 3.0 не должна быть валидной (пока не поддерживается)
        data_v3 = {
            "version": "3.0",
            "user_id": "user_123",
            "task_history": {},
            "mistake_bank": []
        }
        errors_v3 = ProgressSchema.validate(data_v3)
        self.assertGreater(len(errors_v3), 0, "Версия 3.0 не должна быть валидной")
        
        # Отсутствие версии не должно быть валидным
        data_no_version = {
            "user_id": "user_123",
            "task_history": {},
            "mistake_bank": []
        }
        errors_no_version = ProgressSchema.validate(data_no_version)
        self.assertGreater(len(errors_no_version), 0, "Отсутствие версии не должно быть валидным")
    
    def test_statistics_schema_edge_cases(self):
        """Тест граничных случаев статистики"""
        # success_rate = 0.0 (все попытки неуспешные)
        data1 = {
            "total_tasks_attempted": 10,
            "total_tasks_completed": 0,
            "success_rate": 0.0,
            "by_task_type": {},
            "weak_areas": []
        }
        errors1 = StatisticsSchema.validate(data1)
        self.assertEqual(len(errors1), 0, f"success_rate=0.0 должен быть валидным: {errors1}")
        
        # success_rate = 1.0 (все попытки успешные)
        data2 = {
            "total_tasks_attempted": 10,
            "total_tasks_completed": 10,
            "success_rate": 1.0,
            "by_task_type": {},
            "weak_areas": []
        }
        errors2 = StatisticsSchema.validate(data2)
        self.assertEqual(len(errors2), 0, f"success_rate=1.0 должен быть валидным: {errors2}")
        
        # success_rate > 1.0 (невалидно)
        data3 = {
            "total_tasks_attempted": 10,
            "total_tasks_completed": 10,
            "success_rate": 1.5,  # > 1.0
            "by_task_type": {},
            "weak_areas": []
        }
        errors3 = StatisticsSchema.validate(data3)
        self.assertGreater(len(errors3), 0, "success_rate > 1.0 не должен быть валидным")
        
        # success_rate < 0.0 (невалидно)
        data4 = {
            "total_tasks_attempted": 10,
            "total_tasks_completed": 5,
            "success_rate": -0.1,  # < 0.0
            "by_task_type": {},
            "weak_areas": []
        }
        errors4 = StatisticsSchema.validate(data4)
        self.assertGreater(len(errors4), 0, "success_rate < 0.0 не должен быть валидным")
        
        # total_tasks_completed > total_tasks_attempted (невалидно)
        data5 = {
            "total_tasks_attempted": 10,
            "total_tasks_completed": 15,  # > attempted
            "success_rate": 0.8,
            "by_task_type": {},
            "weak_areas": []
        }
        errors5 = StatisticsSchema.validate(data5)
        self.assertGreater(len(errors5), 0, "completed > attempted не должно быть валидным")
        
        # Пустые данные (все нули)
        data6 = {
            "total_tasks_attempted": 0,
            "total_tasks_completed": 0,
            "success_rate": 0.0,
            "by_task_type": {},
            "weak_areas": []
        }
        errors6 = StatisticsSchema.validate(data6)
        self.assertEqual(len(errors6), 0, f"Пустые данные должны быть валидными: {errors6}")
        
        # Очень большие числа
        data7 = {
            "total_tasks_attempted": 1000000,
            "total_tasks_completed": 800000,
            "success_rate": 0.8,
            "by_task_type": {},
            "weak_areas": []
        }
        errors7 = StatisticsSchema.validate(data7)
        self.assertEqual(len(errors7), 0, f"Большие числа должны быть валидными: {errors7}")


if __name__ == '__main__':
    unittest.main()

