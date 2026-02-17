"""
Тесты граничных случаев для системы уровней сложности (Фаза 2).

Тестирует обработку ошибок и некорректных данных.
"""

import unittest
import sys
from pathlib import Path

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.difficulty_manager import DifficultyManager
from services.difficulty_config_loader import DifficultyConfigLoader


class TestDifficultyEdgeCases(unittest.TestCase):
    """Тесты граничных случаев для системы уровней сложности"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.manager = DifficultyManager(config_path=None)
    
    def test_task_without_type(self):
        """Обработка заданий без типа"""
        task_data = {
            'content': {
                'prompt': 'Тест'
            }
        }
        
        # Должно обработаться без ошибки
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        self.assertIsNotNone(enhanced)
    
    def test_task_with_invalid_type(self):
        """Обработка заданий с некорректным типом"""
        task_data = {
            'type': 'invalid_type_12345',
            'content': {
                'type': 'invalid_type_12345',
                'prompt': 'Тест'
            }
        }
        
        # Должно обработаться с fallback
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        self.assertIsNotNone(enhanced)
        self.assertEqual(enhanced.get('_original_type'), 'invalid_type_12345')
    
    def test_task_without_content(self):
        """Обработка заданий без content"""
        task_data = {
            'type': 'click',
            'settings': {
                'difficulty': 1
            }
        }
        
        # Должно обработаться без ошибки
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        self.assertIsNotNone(enhanced)
    
    def test_invalid_level_zero(self):
        """Обработка некорректного уровня 0"""
        task_data = {
            'type': 'click',
            'content': {'type': 'click'}
        }
        
        # Должно обработаться (может принять уровень как есть)
        enhanced = self.manager.enhance_task_for_level(task_data, level=0)
        self.assertIsNotNone(enhanced)
        self.assertIn('_difficulty_level', enhanced)
    
    def test_invalid_level_negative(self):
        """Обработка отрицательного уровня"""
        task_data = {
            'type': 'click',
            'content': {'type': 'click'}
        }
        
        # Должно обработаться (может принять уровень как есть)
        enhanced = self.manager.enhance_task_for_level(task_data, level=-1)
        self.assertIsNotNone(enhanced)
        self.assertIn('_difficulty_level', enhanced)
    
    def test_invalid_level_too_high(self):
        """Обработка уровня > 3"""
        task_data = {
            'type': 'click',
            'content': {'type': 'click'}
        }
        
        # Должно обработаться (может принять уровень как есть)
        enhanced = self.manager.enhance_task_for_level(task_data, level=5)
        self.assertIsNotNone(enhanced)
        self.assertIn('_difficulty_level', enhanced)
    
    def test_invalid_level_non_integer(self):
        """Обработка нецелого уровня"""
        task_data = {
            'type': 'click',
            'content': {'type': 'click'}
        }
        
        # Должно обработаться или выбросить TypeError
        try:
            enhanced = self.manager.enhance_task_for_level(task_data, level=2.5)
            # Если не выброшена ошибка, проверяем результат
            self.assertIsNotNone(enhanced)
        except (TypeError, ValueError):
            # Ожидаемое поведение - ошибка типа
            pass
    
    def test_missing_config_file(self):
        """Обработка отсутствующей конфигурации"""
        # Загрузка с несуществующим путем должна использовать дефолтные значения
        config = DifficultyConfigLoader.load_config(config_path="/nonexistent/path/config.json")
        
        # Должны быть дефолтные значения
        self.assertIsNotNone(config)
        self.assertIn('default_levels', config)
    
    def test_corrupted_config_file(self):
        """Обработка поврежденной конфигурации"""
        import tempfile
        import os
        
        # Создаем временный файл с некорректным JSON
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write("invalid json content {")
            temp_path = f.name
        
        try:
            # Загрузка должна обработать ошибку и использовать дефолтные значения
            config = DifficultyConfigLoader.load_config(config_path=temp_path)
            
            # Должны быть дефолтные значения
            self.assertIsNotNone(config)
            self.assertIn('default_levels', config)
        finally:
            # Удаляем временный файл
            if os.path.exists(temp_path):
                os.unlink(temp_path)
    
    def test_task_with_partial_data(self):
        """Обработка заданий с частичными данными"""
        task_data = {
            'type': 'click'
            # Минимальные данные
        }
        
        # Должно обработаться без ошибки
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        self.assertIsNotNone(enhanced)
    
    def test_very_large_task(self):
        """Обработка очень больших заданий"""
        # Создаем задание с большим количеством данных
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Тест',
                'large_data': ['x'] * 10000  # Большой массив
            }
        }
        
        # Должно обработаться без ошибки
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        self.assertIsNotNone(enhanced)
        # Проверяем, что исходные данные сохранены
        self.assertIn('large_data', enhanced.get('content', {}))
    
    def test_task_with_non_standard_structure(self):
        """Обработка заданий с нестандартной структурой"""
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Тест',
                'custom_field': 'custom_value',
                'nested': {
                    'deep': {
                        'structure': 'value'
                    }
                }
            },
            'extra_field': 'extra_value'
        }
        
        # Должно обработаться без ошибки
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        self.assertIsNotNone(enhanced)
        # Проверяем, что нестандартные поля сохранены
        self.assertEqual(enhanced.get('extra_field'), 'extra_value')
        self.assertEqual(enhanced.get('content', {}).get('custom_field'), 'custom_value')


if __name__ == '__main__':
    unittest.main()

