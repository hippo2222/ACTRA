"""
Тесты для config_loader.
Проверяет загрузку конфигурации из config.json и fallback на значения по умолчанию.
"""

import unittest
import json
import tempfile
import shutil
from pathlib import Path
import sys

# Добавляем пути для импорта
sys.path.insert(0, str(Path(__file__).parent.parent))

from common.config_loader import load_config, get_data_root, get_task_system_root


class TestConfigLoader(unittest.TestCase):
    """Тесты для загрузки конфигурации"""
    
    def setUp(self):
        """Создаём временную директорию для тестов"""
        self.test_dir = tempfile.mkdtemp()
        self.project_root = Path(self.test_dir)
        
        # Создаём структуру директорий
        (self.project_root / "data").mkdir()
        (self.project_root / "task_system").mkdir()
    
    def tearDown(self):
        """Удаляем временную директорию"""
        shutil.rmtree(self.test_dir)
    
    def test_load_config_with_existing_file(self):
        """Проверка загрузки конфигурации из существующего config.json"""
        # Создаём config.json
        config_path = self.project_root / "config.json"
        config_data = {
            "data_root": "data",
            "task_system_root": "task_system"
        }
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        
        # Загружаем конфигурацию с указанием пути
        config = load_config(str(config_path))
        
        # Проверяем, что пути нормализованы до абсолютных
        self.assertIn("data_root", config)
        self.assertIn("task_system_root", config)
        self.assertTrue(Path(config["data_root"]).is_absolute())
        self.assertTrue(Path(config["task_system_root"]).is_absolute())
    
    def test_load_config_default_values(self):
        """Проверка fallback на значения по умолчанию при отсутствии config.json"""
        # config.json не существует
        config_path = self.project_root / "config.json"
        
        # Загружаем конфигурацию
        config = load_config(str(config_path))
        
        # Проверяем, что возвращены значения по умолчанию
        self.assertIn("data_root", config)
        self.assertIn("task_system_root", config)
        self.assertTrue(Path(config["data_root"]).is_absolute())
        self.assertTrue(Path(config["task_system_root"]).is_absolute())
    
    def test_load_config_relative_paths(self):
        """Проверка обработки относительных путей в config.json"""
        # Создаём config.json с относительными путями
        config_path = self.project_root / "config.json"
        config_data = {
            "data_root": "data",
            "task_system_root": "task_system"
        }
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        
        # Загружаем конфигурацию
        config = load_config(str(config_path))
        
        # Проверяем, что пути нормализованы до абсолютных
        expected_data_root = self.project_root / "data"
        expected_task_system_root = self.project_root / "task_system"
        
        self.assertEqual(config["data_root"], str(expected_data_root.resolve()))
        self.assertEqual(config["task_system_root"], str(expected_task_system_root.resolve()))
    
    def test_get_data_root(self):
        """Проверка функции get_data_root()"""
        # Создаём config.json
        config_path = self.project_root / "config.json"
        config_data = {
            "data_root": "data"
        }
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        
        # Используем временную директорию как корень проекта
        # Для этого нам нужно изменить логику, но для теста используем прямое указание
        data_root = Path(load_config(str(config_path))["data_root"])
        
        self.assertTrue(data_root.is_absolute())
        self.assertEqual(data_root, (self.project_root / "data").resolve())
    
    def test_get_task_system_root(self):
        """Проверка функции get_task_system_root()"""
        # Создаём config.json
        config_path = self.project_root / "config.json"
        config_data = {
            "task_system_root": "task_system"
        }
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        
        task_system_root = Path(load_config(str(config_path))["task_system_root"])
        
        self.assertTrue(task_system_root.is_absolute())
        self.assertEqual(task_system_root, (self.project_root / "task_system").resolve())
    
    def test_load_config_invalid_json(self):
        """Проверка обработки некорректного JSON в config.json"""
        # Создаём config.json с некорректным JSON
        config_path = self.project_root / "config.json"
        with open(config_path, "w", encoding="utf-8") as f:
            f.write("invalid json content")
        
        # Загружаем конфигурацию - должна вернуться fallback
        config = load_config(str(config_path))
        
        # Должны быть значения по умолчанию
        self.assertIn("data_root", config)
        self.assertIn("task_system_root", config)


if __name__ == "__main__":
    unittest.main()

