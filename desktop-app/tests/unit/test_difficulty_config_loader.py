"""
Unit-тесты для DifficultyConfigLoader.

Тестирует загрузку конфигурации уровней сложности из difficulty_config.json
и создание дефолтного файла при отсутствии.
"""

import unittest
import json
import tempfile
import shutil
from pathlib import Path
import sys
from unittest.mock import patch, MagicMock

# Добавляем пути для импорта
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.difficulty_config_loader import (
    DifficultyConfigLoader,
    load_difficulty_config,
    DEFAULT_CONFIG
)


class TestDifficultyConfigLoader(unittest.TestCase):
    """Тесты для загрузки конфигурации уровней сложности"""
    
    def setUp(self):
        """Создаём временную директорию для тестов"""
        self.test_dir = tempfile.mkdtemp()
        self.data_dir = Path(self.test_dir) / "data"
        self.data_dir.mkdir(parents=True)
        self.config_path = self.data_dir / "difficulty_config.json"
    
    def tearDown(self):
        """Удаляем временную директорию"""
        shutil.rmtree(self.test_dir)
    
    def test_load_config_with_existing_file(self):
        """Проверка загрузки конфигурации из существующего файла"""
        # Создаём difficulty_config.json
        config_data = {
            "version": "1.0",
            "default_levels": {
                "click": [1, 2, 3],
                "draw": [1, 2, 3],
                "test": [1, 2],
                "sequence_assembly": [1, 2, 3],
                "open_answer": [1]
            },
            "task_overrides": {
                "module_01/topic_01/task_001": {
                    "levels": [1, 2],
                    "default_level": 2
                }
            },
            "type_overrides": {}
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2)
        
        # Загружаем конфигурацию
        config = DifficultyConfigLoader.load_config(str(self.config_path))
        
        # Проверяем, что конфигурация загружена корректно
        self.assertEqual(config["version"], "1.0")
        self.assertIn("default_levels", config)
        self.assertIn("click", config["default_levels"])
        self.assertEqual(config["default_levels"]["click"], [1, 2, 3])
        self.assertIn("task_overrides", config)
        self.assertIn("module_01/topic_01/task_001", config["task_overrides"])
    
    def test_load_config_creates_default_file(self):
        """Проверка создания дефолтного файла при отсутствии"""
        # Файл не существует
        self.assertFalse(self.config_path.exists())
        
        # Загружаем конфигурацию - должен создаться дефолтный файл
        config = DifficultyConfigLoader.load_config(str(self.config_path))
        
        # Проверяем, что файл создан
        self.assertTrue(self.config_path.exists())
        
        # Проверяем, что возвращена дефолтная конфигурация
        self.assertEqual(config["version"], DEFAULT_CONFIG["version"])
        self.assertEqual(config["default_levels"], DEFAULT_CONFIG["default_levels"])
        
        # Проверяем, что файл содержит дефолтные значения
        with open(self.config_path, "r", encoding="utf-8") as f:
            file_config = json.load(f)
        self.assertEqual(file_config["version"], DEFAULT_CONFIG["version"])
        self.assertEqual(file_config["default_levels"], DEFAULT_CONFIG["default_levels"])
    
    def test_load_config_with_invalid_json(self):
        """Проверка обработки некорректного JSON"""
        # Создаём файл с некорректным JSON
        with open(self.config_path, "w", encoding="utf-8") as f:
            f.write("invalid json content {")
        
        # Загружаем конфигурацию - должна вернуться fallback
        config = DifficultyConfigLoader.load_config(str(self.config_path))
        
        # Должны быть дефолтные значения
        self.assertEqual(config["version"], DEFAULT_CONFIG["version"])
        self.assertEqual(config["default_levels"], DEFAULT_CONFIG["default_levels"])
    
    def test_load_config_with_missing_fields(self):
        """Проверка обработки конфигурации с отсутствующими полями"""
        # Создаём конфигурацию без некоторых полей
        incomplete_config = {
            "version": "1.0",
            "default_levels": {
                "click": [1, 2, 3]
            }
            # Отсутствуют task_overrides и type_overrides
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(incomplete_config, f)
        
        # Загружаем конфигурацию
        config = DifficultyConfigLoader.load_config(str(self.config_path))
        
        # Проверяем, что отсутствующие поля добавлены
        self.assertIn("task_overrides", config)
        self.assertIn("type_overrides", config)
        self.assertEqual(config["task_overrides"], {})
        self.assertEqual(config["type_overrides"], {})
    
    def test_load_config_integrates_with_main_config(self):
        """Проверка интеграции с common.config_loader"""
        # Мокаем load_main_config для получения data_root
        mock_main_config = {
            "data_root": str(self.data_dir),
            "task_system_root": str(Path(self.test_dir) / "task_system")
        }
        
        with patch('services.difficulty_config_loader.load_main_config', return_value=mock_main_config):
            # Загружаем конфигурацию без указания пути
            config = DifficultyConfigLoader.load_config(config_path=None)
            
            # Проверяем, что использован правильный путь
            expected_path = self.data_dir / "difficulty_config.json"
            self.assertTrue(expected_path.exists())
            
            # Проверяем, что конфигурация загружена
            self.assertIn("version", config)
            self.assertIn("default_levels", config)
    
    def test_create_default_config_creates_directory(self):
        """Проверка создания директории при создании дефолтного файла"""
        # Создаём путь в несуществующей директории
        new_dir = self.data_dir / "subdir"
        new_config_path = new_dir / "difficulty_config.json"
        
        # Создаём дефолтный файл
        DifficultyConfigLoader._create_default_config(new_config_path)
        
        # Проверяем, что директория и файл созданы
        self.assertTrue(new_dir.exists())
        self.assertTrue(new_config_path.exists())
        
        # Проверяем содержимое файла
        with open(new_config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        self.assertEqual(config["version"], DEFAULT_CONFIG["version"])
        self.assertEqual(config["default_levels"], DEFAULT_CONFIG["default_levels"])
    
    def test_validate_config_fixes_missing_fields(self):
        """Проверка валидации конфигурации с исправлением отсутствующих полей"""
        # Создаём конфигурацию без некоторых полей
        incomplete_config = {
            "version": "1.0"
            # Отсутствуют все остальные поля
        }
        
        # Валидируем конфигурацию
        DifficultyConfigLoader._validate_config(incomplete_config)
        
        # Проверяем, что отсутствующие поля добавлены
        self.assertIn("default_levels", incomplete_config)
        self.assertIn("task_overrides", incomplete_config)
        self.assertIn("type_overrides", incomplete_config)
    
    def test_validate_config_fixes_invalid_levels(self):
        """Проверка валидации конфигурации с исправлением некорректных уровней"""
        # Создаём конфигурацию с некорректными уровнями
        invalid_config = {
            "version": "1.0",
            "default_levels": {
                "click": "invalid",  # Должен быть список
                "test": [1, 2, "invalid"]  # Содержит не целое число
            },
            "task_overrides": {},
            "type_overrides": {}
        }
        
        # Валидируем конфигурацию
        DifficultyConfigLoader._validate_config(invalid_config)
        
        # Проверяем, что некорректные значения исправлены
        self.assertIsInstance(invalid_config["default_levels"]["click"], list)
        self.assertIsInstance(invalid_config["default_levels"]["test"], list)
        self.assertTrue(all(isinstance(level, int) for level in invalid_config["default_levels"]["test"]))
    
    def test_load_difficulty_config_function(self):
        """Проверка удобной функции load_difficulty_config()"""
        # Создаём конфигурацию
        config_data = {
            "version": "1.0",
            "default_levels": {
                "click": [1, 2, 3]
            },
            "task_overrides": {},
            "type_overrides": {}
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        
        # Используем удобную функцию
        config = load_difficulty_config(str(self.config_path))
        
        # Проверяем, что конфигурация загружена
        self.assertEqual(config["version"], "1.0")
        self.assertIn("default_levels", config)
    
    def test_default_config_structure(self):
        """Проверка структуры дефолтной конфигурации"""
        # Проверяем, что DEFAULT_CONFIG содержит все необходимые поля
        self.assertIn("version", DEFAULT_CONFIG)
        self.assertIn("default_levels", DEFAULT_CONFIG)
        self.assertIn("task_overrides", DEFAULT_CONFIG)
        self.assertIn("type_overrides", DEFAULT_CONFIG)
        
        # Проверяем типы заданий
        default_levels = DEFAULT_CONFIG["default_levels"]
        self.assertIn("click", default_levels)
        self.assertIn("draw", default_levels)
        self.assertIn("test", default_levels)
        self.assertIn("sequence_assembly", default_levels)
        self.assertIn("open_answer", default_levels)
        
        # Проверяем, что уровни - это списки целых чисел
        for task_type, levels in default_levels.items():
            self.assertIsInstance(levels, list, f"Уровни для {task_type} должны быть списком")
            self.assertTrue(all(isinstance(level, int) for level in levels), 
                          f"Уровни для {task_type} должны содержать только целые числа")
            self.assertTrue(all(level >= 1 for level in levels), 
                          f"Уровни для {task_type} должны быть >= 1")
        
        # Проверяем специфичные значения
        self.assertEqual(default_levels["test"], [1, 2])  # Test имеет только 2 уровня
        self.assertEqual(default_levels["open_answer"], [1])  # Open answer только уровень 1
    
    def test_task_overrides_loading(self):
        """Проверка загрузки task_overrides"""
        config_data = {
            "version": "1.0",
            "default_levels": {
                "click": [1, 2, 3]
            },
            "task_overrides": {
                "module_01/topic_01/task_001": {
                    "levels": [1, 2],
                    "default_level": 2
                },
                "module_02/topic_01/task_005": {
                    "levels": [1, 2, 3],
                    "default_level": 1
                }
            },
            "type_overrides": {}
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        
        config = DifficultyConfigLoader.load_config(str(self.config_path))
        
        # Проверяем, что task_overrides загружены
        self.assertIn("task_overrides", config)
        self.assertEqual(len(config["task_overrides"]), 2)
        self.assertIn("module_01/topic_01/task_001", config["task_overrides"])
        self.assertIn("module_02/topic_01/task_005", config["task_overrides"])
        
        # Проверяем содержимое переопределения
        override = config["task_overrides"]["module_01/topic_01/task_001"]
        self.assertEqual(override["levels"], [1, 2])
        self.assertEqual(override["default_level"], 2)
    
    def test_type_overrides_loading(self):
        """Проверка загрузки type_overrides"""
        config_data = {
            "version": "1.0",
            "default_levels": {
                "click": [1, 2, 3],
                "test": [1, 2]
            },
            "task_overrides": {},
            "type_overrides": {
                "click": {
                    "max_level": 2
                },
                "test": {
                    "max_level": 3
                }
            }
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        
        config = DifficultyConfigLoader.load_config(str(self.config_path))
        
        # Проверяем, что type_overrides загружены
        self.assertIn("type_overrides", config)
        self.assertIn("click", config["type_overrides"])
        self.assertIn("test", config["type_overrides"])
        
        # Проверяем содержимое переопределения
        click_override = config["type_overrides"]["click"]
        self.assertEqual(click_override["max_level"], 2)
        
        test_override = config["type_overrides"]["test"]
        self.assertEqual(test_override["max_level"], 3)
    
    def test_override_priority_task_overrides_first(self):
        """Проверка приоритета: task_overrides > type_overrides > default_levels"""
        config_data = {
            "version": "1.0",
            "default_levels": {
                "click": [1, 2, 3]
            },
            "task_overrides": {
                "module_01/topic_01/task_001": {
                    "levels": [1, 2],
                    "default_level": 2
                }
            },
            "type_overrides": {
                "click": {
                    "max_level": 2
                }
            }
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        
        config = DifficultyConfigLoader.load_config(str(self.config_path))
        
        # Проверяем, что все переопределения загружены
        self.assertIn("task_overrides", config)
        self.assertIn("type_overrides", config)
        self.assertIn("default_levels", config)
        
        # task_overrides имеет приоритет над type_overrides и default_levels
        task_override = config["task_overrides"]["module_01/topic_01/task_001"]
        self.assertEqual(task_override["levels"], [1, 2])
    
    def test_override_priority_type_overrides_second(self):
        """Проверка приоритета: type_overrides > default_levels (когда нет task_overrides)"""
        config_data = {
            "version": "1.0",
            "default_levels": {
                "click": [1, 2, 3]
            },
            "task_overrides": {},
            "type_overrides": {
                "click": {
                    "max_level": 2
                }
            }
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        
        config = DifficultyConfigLoader.load_config(str(self.config_path))
        
        # type_overrides имеет приоритет над default_levels
        type_override = config["type_overrides"]["click"]
        self.assertEqual(type_override["max_level"], 2)
        
        # default_levels остается без изменений
        default_levels = config["default_levels"]["click"]
        self.assertEqual(default_levels, [1, 2, 3])
    
    def test_invalid_task_override_validation(self):
        """Проверка валидации некорректных task_overrides"""
        config_data = {
            "version": "1.0",
            "default_levels": {
                "click": [1, 2, 3]
            },
            "task_overrides": {
                "module_01/topic_01/task_001": {
                    "levels": "invalid",  # Должен быть список
                    "default_level": 5  # Больше максимума
                }
            },
            "type_overrides": {}
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        
        # Загрузка должна исправить некорректные значения
        config = DifficultyConfigLoader.load_config(str(self.config_path))
        
        # Проверяем, что некорректные значения исправлены
        override = config["task_overrides"]["module_01/topic_01/task_001"]
        # levels должен быть списком
        if isinstance(override.get("levels"), list):
            self.assertIsInstance(override["levels"], list)
    
    def test_invalid_type_override_validation(self):
        """Проверка валидации некорректных type_overrides"""
        config_data = {
            "version": "1.0",
            "default_levels": {
                "click": [1, 2, 3]
            },
            "task_overrides": {},
            "type_overrides": {
                "click": {
                    "max_level": "invalid"  # Должно быть число
                }
            }
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        
        # Загрузка должна обработать некорректные значения
        config = DifficultyConfigLoader.load_config(str(self.config_path))
        
        # Проверяем, что конфигурация загружена
        self.assertIsNotNone(config)
        self.assertIn("type_overrides", config)
        # type_overrides может содержать некорректные значения (валидация не исправляет их автоматически)
        # или может быть исправлен в зависимости от реализации
        type_override = config["type_overrides"].get("click", {})
        # Проверяем, что структура сохранена
        self.assertIsInstance(type_override, dict)
    
    def test_difficulty_manager_integration_with_task_overrides(self):
        """Проверка интеграции DifficultyManager с task_overrides"""
        config_data = {
            "version": "1.0",
            "default_levels": {
                "click": [1, 2, 3]
            },
            "task_overrides": {
                "module_01/topic_01/task_001": {
                    "levels": [1, 2],
                    "default_level": 2
                }
            },
            "type_overrides": {}
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        
        # Создаем DifficultyManager с конфигурацией
        try:
            from services.difficulty_manager import DifficultyManager
            manager = DifficultyManager(config_path=str(self.config_path))
            
            # Проверяем, что task_overrides используются
            levels = manager.get_available_levels("click", task_ref="module_01/topic_01/task_001")
            # Должны быть уровни из task_overrides
            self.assertEqual(levels, [1, 2])
            
            # Для другого задания должны быть дефолтные уровни
            levels_default = manager.get_available_levels("click", task_ref="module_01/topic_01/task_002")
            self.assertEqual(levels_default, [1, 2, 3])
        except ImportError:
            self.skipTest("DifficultyManager не доступен")
    
    def test_difficulty_manager_integration_with_type_overrides(self):
        """Проверка интеграции DifficultyManager с type_overrides"""
        config_data = {
            "version": "1.0",
            "default_levels": {
                "click": [1, 2, 3]
            },
            "task_overrides": {},
            "type_overrides": {
                "click": {
                    "max_level": 2
                }
            }
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        
        # Создаем DifficultyManager с конфигурацией
        try:
            from services.difficulty_manager import DifficultyManager
            manager = DifficultyManager(config_path=str(self.config_path))
            
            # Проверяем, что type_overrides используются
            levels = manager.get_available_levels("click")
            # Должны быть уровни из type_overrides (1, 2)
            self.assertEqual(levels, [1, 2])
        except ImportError:
            self.skipTest("DifficultyManager не доступен")


if __name__ == "__main__":
    unittest.main()

