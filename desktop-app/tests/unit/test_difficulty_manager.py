"""
Unit-тесты для DifficultyManager.

Тестирует модификацию заданий в памяти для разных уровней сложности.
"""

import unittest
import sys
import tempfile
import shutil
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

# Добавляем пути для импорта
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

try:
    from services.difficulty_manager import DifficultyManager
    DIFFICULTY_MANAGER_AVAILABLE = True
except ImportError:
    DIFFICULTY_MANAGER_AVAILABLE = False
    DifficultyManager = None


@unittest.skipIf(not DIFFICULTY_MANAGER_AVAILABLE, "DifficultyManager не доступен")
class TestDifficultyManagerBasic(unittest.TestCase):
    """Базовые тесты для DifficultyManager"""
    
    def setUp(self):
        """Создаём DifficultyManager для тестов"""
        self.manager = DifficultyManager(config_path=None)
    
    def test_manager_initialization(self):
        """Проверка инициализации DifficultyManager"""
        self.assertIsNotNone(self.manager)
        self.assertIsNotNone(self.manager.default_levels)
        self.assertIn("click", self.manager.default_levels)
        self.assertIn("draw", self.manager.default_levels)
        self.assertIn("test", self.manager.default_levels)
    
    def test_get_available_levels_click(self):
        """Проверка получения доступных уровней для click задания"""
        levels = self.manager.get_available_levels("click")
        self.assertEqual(levels, [1, 2, 3])
    
    def test_get_available_levels_test(self):
        """Проверка получения доступных уровней для test задания (только 2 уровня)"""
        levels = self.manager.get_available_levels("test")
        self.assertEqual(levels, [1, 2])
    
    def test_get_available_levels_open_answer(self):
        """Проверка получения доступных уровней для open_answer (только 1 уровень)"""
        levels = self.manager.get_available_levels("open_answer")
        self.assertEqual(levels, [1])
    
    def test_get_available_levels_unknown(self):
        """Проверка получения доступных уровней для неизвестного типа (fallback на [1])"""
        levels = self.manager.get_available_levels("unknown_type")
        self.assertEqual(levels, [1])


@unittest.skipIf(not DIFFICULTY_MANAGER_AVAILABLE, "DifficultyManager не доступен")
class TestEnhanceTaskForLevel(unittest.TestCase):
    """Тесты для enhance_task_for_level()"""
    
    def setUp(self):
        """Создаём DifficultyManager для тестов"""
        self.manager = DifficultyManager(config_path=None)
    
    def test_enhance_click_task_level_1(self):
        """Тест модификации click задания для уровня 1"""
        task_data = {
            "type": "click",
            "content": {
                "type": "click",
                "prompt": "Кликните на область"
            },
            "settings": {
                "difficulty": 1
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        
        # Проверяем флаги валидации
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        self.assertEqual(enhanced.get('_original_type'), 'click')
        self.assertEqual(enhanced.get('_difficulty_level'), 1)
        
        # Проверяем модификацию контента
        content = enhanced.get('content', {})
        self.assertEqual(content.get('mode'), 'click')
        self.assertFalse(content.get('requires_labels', True))
        self.assertFalse(content.get('requires_drawing', True))
    
    def test_enhance_click_task_level_2(self):
        """Тест модификации click задания для уровня 2"""
        task_data = {
            "type": "click",
            "content": {
                "type": "click",
                "prompt": "Кликните на область"
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=2)
        
        # Проверяем флаги валидации
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        self.assertEqual(enhanced.get('_original_type'), 'click')
        self.assertEqual(enhanced.get('_difficulty_level'), 2)
        
        # Проверяем модификацию контента
        content = enhanced.get('content', {})
        self.assertEqual(content.get('mode'), 'click_and_label')
        self.assertTrue(content.get('requires_labels', False))
        self.assertFalse(content.get('requires_drawing', True))
        self.assertIn('назовите', content.get('prompt', '').lower())
    
    def test_enhance_click_task_level_3(self):
        """Тест модификации click задания для уровня 3"""
        task_data = {
            "type": "click",
            "content": {
                "type": "click",
                "prompt": "Кликните на область"
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=3)
        
        # Проверяем флаги валидации
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        self.assertEqual(enhanced.get('_original_type'), 'click')
        
        # Проверяем модификацию контента
        content = enhanced.get('content', {})
        self.assertEqual(content.get('mode'), 'draw_and_label')
        self.assertTrue(content.get('requires_labels', False))
        self.assertTrue(content.get('requires_drawing', False))
        self.assertIn('Обведите', content.get('prompt', ''))
    
    def test_enhance_task_in_memory_does_not_modify_original(self):
        """Проверка, что исходное задание не изменяется (модификация в памяти)"""
        original_task = {
            "type": "click",
            "content": {
                "type": "click",
                "prompt": "Кликните на область"
            }
        }
        
        original_prompt = original_task['content']['prompt']
        
        enhanced = self.manager.enhance_task_for_level(original_task, level=2)
        
        # Проверяем, что исходное задание не изменилось
        self.assertEqual(original_task['content']['prompt'], original_prompt)
        self.assertNotIn('_difficulty_enhanced', original_task)
        
        # Проверяем, что enhanced задание модифицировано
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        self.assertNotEqual(enhanced['content']['prompt'], original_prompt)
    
    def test_enhance_draw_task_with_only_polygons(self):
        """Тест: Draw задание с только полигонами остаётся Draw"""
        task_data = {
            "type": "draw",
            "content": {
                "type": "draw",
                "prompt": "Обведите контур",
                "annotations": [
                    {
                        "type": "polygon",
                        "points": [[100, 100], [200, 100], [200, 200], [100, 200]],
                        "label": "Область 1"
                    }
                ]
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        
        # Тип остаётся draw (конвертация в click убрана)
        self.assertEqual(enhanced.get('type'), 'draw')
        content = enhanced.get('content', {})
        self.assertEqual(content.get('mode'), 'draw')
    
    def test_enhance_draw_task_with_freehand(self):
        """Тест: Draw задание с freehand остается Draw"""
        task_data = {
            "type": "draw",
            "content": {
                "type": "draw",
                "prompt": "Обведите контур",
                "annotations": [
                    {
                        "type": "freehand",
                        "points": [[100, 100], [200, 100], [300, 200]],
                        "label": "Линия 1"
                    }
                ]
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        
        # Проверяем, что тип остался draw
        self.assertEqual(enhanced.get('type'), 'draw')
        content = enhanced.get('content', {})
        self.assertEqual(content.get('mode'), 'draw')
    
    def test_enhance_test_task_level_1(self):
        """Тест модификации test задания для уровня 1"""
        task_data = {
            "type": "test",
            "content": {
                "type": "test",
                "question": "Вопрос?"
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        
        content = enhanced.get('content', {})
        self.assertEqual(content.get('mode'), 'multiple_choice')
        self.assertTrue(content.get('show_options', False))
        self.assertFalse(content.get('requires_text_input', True))
    
    def test_enhance_test_task_level_2(self):
        """Тест модификации test задания для уровня 2"""
        task_data = {
            "type": "test",
            "content": {
                "type": "test",
                "question": "Вопрос?"
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=2)
        
        content = enhanced.get('content', {})
        self.assertEqual(content.get('mode'), 'open_question')
        self.assertFalse(content.get('show_options', True))
        self.assertTrue(content.get('requires_text_input', False))
    
    def test_enhance_sequence_task_level_1(self):
        """Тест: sequence_assembly level 1 корректно включает все подсказки"""
        task_data = {
            "type": "sequence_assembly",
            "content": {
                "type": "sequence_assembly"
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        
        # После P0 sequence_assembly должен модифицироваться без fallback
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        content = enhanced.get('content', {})
        self.assertTrue(content.get('show_level_labels', False))
        self.assertTrue(content.get('show_block_labels', False))
        self.assertFalse(content.get('requires_level_names', True))
        self.assertFalse(content.get('requires_block_names', True))
    
    def test_enhance_sequence_task_level_2(self):
        """Тест: sequence_assembly level 2 требует названия уровней"""
        task_data = {
            "type": "sequence_assembly",
            "content": {
                "type": "sequence_assembly"
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=2)
        
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        content = enhanced.get('content', {})
        self.assertFalse(content.get('show_level_labels', True))
        self.assertTrue(content.get('show_block_labels', False))
        self.assertTrue(content.get('requires_level_names', False))
        self.assertFalse(content.get('requires_block_names', True))
    
    def test_enhance_sequence_task_level_3(self):
        """Тест: sequence_assembly level 3 требует названия уровней и блоков"""
        task_data = {
            "type": "sequence_assembly",
            "content": {
                "type": "sequence_assembly"
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=3)
        
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        content = enhanced.get('content', {})
        self.assertFalse(content.get('show_level_labels', True))
        self.assertFalse(content.get('show_block_labels', True))
        self.assertTrue(content.get('requires_level_names', False))
        self.assertTrue(content.get('requires_block_names', False))
    
    def test_enhance_open_answer_task(self):
        """Тест: Open Answer задание не модифицируется (только уровень 1)"""
        task_data = {
            "type": "open_answer",
            "content": {
                "type": "open_answer",
                "question": "Вопрос?"
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        
        # Проверяем, что задание не модифицировано (кроме флагов)
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        content = enhanced.get('content', {})
        # Не должно быть полей mode, requires_labels и т.д. для open_answer
        self.assertNotIn('mode', content)
    
    def test_enhance_unknown_task_type(self):
        """Тест: Неизвестный тип задания возвращается как есть (fallback)"""
        task_data = {
            "type": "unknown_type",
            "content": {
                "type": "unknown_type",
                "prompt": "Тест"
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        
        # Проверяем, что задание не модифицировано (кроме флагов)
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        self.assertEqual(enhanced.get('_original_type'), 'unknown_type')
        # Контент должен остаться без изменений (кроме флагов)
        self.assertEqual(enhanced.get('content', {}).get('prompt'), 'Тест')


@unittest.skipIf(not DIFFICULTY_MANAGER_AVAILABLE, "DifficultyManager не доступен")
class TestDifficultyManagerErrorHandling(unittest.TestCase):
    """Тесты обработки ошибок в DifficultyManager"""
    
    def setUp(self):
        """Создаём DifficultyManager для тестов"""
        self.manager = DifficultyManager(config_path=None)
    
    def test_enhance_task_with_invalid_data(self):
        """Тест: При ошибке возвращается исходное задание (fallback)"""
        # Некорректные данные задания
        invalid_task_data = None
        
        # Должно вернуть исходное задание без ошибки
        enhanced = self.manager.enhance_task_for_level(invalid_task_data, level=1)
        
        # Проверяем, что вернулось что-то безопасное
        self.assertIsNotNone(enhanced)
    
    def test_enhance_task_error_fallback(self):
        """Тест: При ошибке модификации возвращается исходное задание"""
        task_data = {
            "type": "click",
            "content": {
                "type": "click",
                "prompt": "Кликните на область"
            }
        }
        
        # Мокаем метод _enhance_click_task чтобы выбросить ошибку
        original_method = self.manager._enhance_click_task
        self.manager._enhance_click_task = Mock(side_effect=Exception("Test error"))
        
        try:
            enhanced = self.manager.enhance_task_for_level(task_data, level=1)
            
            # Проверяем, что вернулось исходное задание с флагом _difficulty_enhanced = False
            self.assertFalse(enhanced.get('_difficulty_enhanced', True))
        finally:
            # Восстанавливаем оригинальный метод
            self.manager._enhance_click_task = original_method


@unittest.skipIf(not DIFFICULTY_MANAGER_AVAILABLE, "DifficultyManager не доступен")
class TestDifficultyManagerHooks(unittest.TestCase):
    """Тесты интеграции DifficultyManager с hooks"""
    
    def setUp(self):
        """Создаём DifficultyManager для тестов"""
        self.manager = DifficultyManager(config_path=None)
    
    def test_get_available_levels_with_plugin_hook(self):
        """Тест: get_available_levels использует hooks для плагинных типов"""
        # Проверяем, что hooks вызываются (если доступны)
        levels = self.manager.get_available_levels("plugin_type", task_ref="module/topic/task")
        
        # Для неизвестного типа должно вернуться [1] (fallback)
        self.assertEqual(levels, [1])
    
    @patch('services.difficulty_manager.difficulty_hooks')
    def test_enhance_task_calls_before_enhance_hook(self, mock_hooks):
        """Тест: enhance_task_for_level вызывает hook before_enhance"""
        if not self.manager.hooks_available:
            self.skipTest("Hooks не доступны")
        
        mock_hooks.call_before_enhance = Mock(return_value={})
        
        task_data = {
            "type": "click",
            "content": {"type": "click", "prompt": "Тест"}
        }
        
        self.manager.enhance_task_for_level(task_data, level=1)
        
        # Проверяем, что hook был вызван
        mock_hooks.call_before_enhance.assert_called_once()
    
    @patch('services.difficulty_manager.difficulty_hooks')
    def test_enhance_task_calls_after_enhance_hook(self, mock_hooks):
        """Тест: enhance_task_for_level вызывает hook after_enhance"""
        if not self.manager.hooks_available:
            self.skipTest("Hooks не доступны")
        
        mock_hooks.call_after_enhance = Mock(return_value={})
        
        task_data = {
            "type": "click",
            "content": {"type": "click", "prompt": "Тест"}
        }
        
        self.manager.enhance_task_for_level(task_data, level=1)
        
        # Проверяем, что hook был вызван
        mock_hooks.call_after_enhance.assert_called_once()


@unittest.skipIf(not DIFFICULTY_MANAGER_AVAILABLE, "DifficultyManager не доступен")
class TestGetInitialLevel(unittest.TestCase):
    """Тесты для get_initial_level()"""
    
    def setUp(self):
        """Создаём DifficultyManager для тестов"""
        self.manager = DifficultyManager(config_path=None)
    
    def test_get_initial_level_from_settings(self):
        """Тест: get_initial_level использует settings.difficulty"""
        task_data = {
            "type": "click",
            "settings": {
                "difficulty": 2
            }
        }
        
        level = self.manager.get_initial_level(task_data)
        self.assertEqual(level, 2)
    
    def test_get_initial_level_default(self):
        """Тест: get_initial_level возвращает 1 по умолчанию"""
        task_data = {
            "type": "click"
        }
        
        level = self.manager.get_initial_level(task_data)
        self.assertEqual(level, 1)
    
    def test_get_initial_level_for_test_task(self):
        """Тест: get_initial_level ограничивает уровень для test задания (максимум 2)"""
        task_data = {
            "type": "test",
            "settings": {
                "difficulty": 3  # Больше максимума для test
            }
        }
        
        level = self.manager.get_initial_level(task_data)
        # Должно вернуть максимальный доступный уровень для test (2)
        self.assertEqual(level, 2)


@unittest.skipIf(not DIFFICULTY_MANAGER_AVAILABLE, "DifficultyManager не доступен")
class TestDifficultyManagerAdditional(unittest.TestCase):
    """Дополнительные тесты для DifficultyManager (расширение для Фазы 2)"""
    
    def setUp(self):
        """Создаём DifficultyManager для тестов"""
        self.manager = DifficultyManager(config_path=None)
    
    def test_enhance_draw_task_level_2(self):
        """Тест модификации draw задания для уровня 2"""
        task_data = {
            "type": "draw",
            "content": {
                "type": "draw",
                "prompt": "Обведите контур",
                "annotations": [
                    {
                        "type": "freehand",
                        "points": [[100, 100], [200, 100], [300, 200]],
                        "label": "Линия 1"
                    }
                ]
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=2)
        
        # Проверяем флаги валидации
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        self.assertEqual(enhanced.get('_original_type'), 'draw')
        self.assertEqual(enhanced.get('_difficulty_level'), 2)
        
        # Проверяем модификацию контента
        content = enhanced.get('content', {})
        self.assertEqual(content.get('mode'), 'draw_and_label')
        self.assertTrue(content.get('requires_labels', False))
        self.assertFalse(content.get('requires_explanation', True))
        self.assertIn('назовите', content.get('prompt', '').lower())
    
    def test_enhance_draw_task_level_3(self):
        """Тест модификации draw задания для уровня 3"""
        task_data = {
            "type": "draw",
            "content": {
                "type": "draw",
                "prompt": "Обведите контур",
                "annotations": [
                    {
                        "type": "freehand",
                        "points": [[100, 100], [200, 100], [300, 200]],
                        "label": "Линия 1"
                    }
                ]
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=3)
        
        # Проверяем флаги валидации
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        self.assertEqual(enhanced.get('_original_type'), 'draw')
        self.assertEqual(enhanced.get('_difficulty_level'), 3)
        
        # Проверяем модификацию контента
        content = enhanced.get('content', {})
        self.assertEqual(content.get('mode'), 'draw_multiple_and_explain')
        self.assertTrue(content.get('requires_labels', False))
        self.assertTrue(content.get('requires_explanation', False))
        self.assertIn('несколько', content.get('prompt', '').lower())
        self.assertIn('связь', content.get('prompt', '').lower())
    
    def test_enhance_sequence_task_level_2_detailed(self):
        """Тест: sequence_assembly level 2 сохраняет данные и выставляет корректные флаги"""
        task_data = {
            "type": "sequence_assembly",
            "content": {
                "type": "sequence_assembly",
                "levels": [
                    {"level_id": "level1", "blocks": ["block1", "block2"]},
                    {"level_id": "level2", "blocks": ["block3"]}
                ]
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=2)
        
        # После P0 sequence_assembly level 2 должен успешно модифицироваться
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        content = enhanced.get('content', {})
        self.assertFalse(content.get('show_level_labels', True))
        self.assertTrue(content.get('show_block_labels', False))
        self.assertTrue(content.get('requires_level_names', False))
        self.assertFalse(content.get('requires_block_names', True))
        self.assertEqual(len(content.get('levels', [])), 2)
    
    def test_enhance_sequence_task_level_3_detailed(self):
        """Тест: sequence_assembly level 3 сохраняет данные и выставляет корректные флаги"""
        task_data = {
            "type": "sequence_assembly",
            "content": {
                "type": "sequence_assembly",
                "levels": [
                    {"level_id": "level1", "blocks": ["block1", "block2"]},
                    {"level_id": "level2", "blocks": ["block3"]}
                ]
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=3)
        
        # После P0 sequence_assembly level 3 должен успешно модифицироваться
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        content = enhanced.get('content', {})
        self.assertFalse(content.get('show_level_labels', True))
        self.assertFalse(content.get('show_block_labels', True))
        self.assertTrue(content.get('requires_level_names', False))
        self.assertTrue(content.get('requires_block_names', False))
        self.assertEqual(len(content.get('levels', [])), 2)
    
    def test_enhance_task_preserves_original_data(self):
        """Тест: модификация сохраняет все исходные данные задания"""
        original_task = {
            "type": "click",
            "content": {
                "type": "click",
                "prompt": "Кликните на область",
                "image": "path/to/image.jpg"
            },
            "settings": {
                "difficulty": 1,
                "time_limit": 60
            },
            "metadata": {
                "author": "Test",
                "version": "1.0"
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(original_task, level=2)
        
        # Проверяем, что исходные данные сохранены
        self.assertEqual(enhanced.get('settings', {}).get('difficulty'), 1)
        self.assertEqual(enhanced.get('settings', {}).get('time_limit'), 60)
        self.assertEqual(enhanced.get('metadata', {}).get('author'), "Test")
        self.assertEqual(enhanced.get('metadata', {}).get('version'), "1.0")
        self.assertEqual(enhanced.get('content', {}).get('image'), "path/to/image.jpg")
        
        # Проверяем, что исходное задание не изменилось
        self.assertEqual(original_task['content']['prompt'], "Кликните на область")
        self.assertNotIn('_difficulty_enhanced', original_task)
    
    def test_enhance_task_validates_flags(self):
        """Тест: проверка корректности флагов валидации"""
        task_data = {
            "type": "click",
            "content": {
                "type": "click",
                "prompt": "Кликните на область"
            }
        }
        
        enhanced = self.manager.enhance_task_for_level(task_data, level=2)
        
        # Проверяем наличие всех флагов
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        self.assertEqual(enhanced.get('_original_type'), 'click')
        self.assertEqual(enhanced.get('_difficulty_level'), 2)
        
        # Проверяем типы флагов
        self.assertIsInstance(enhanced.get('_difficulty_enhanced'), bool)
        self.assertIsInstance(enhanced.get('_original_type'), str)
        self.assertIsInstance(enhanced.get('_difficulty_level'), int)
    
    def test_enhance_task_invalid_level_zero(self):
        """Тест: обработка некорректного уровня 0"""
        task_data = {
            "type": "click",
            "content": {
                "type": "click",
                "prompt": "Кликните на область"
            }
        }
        
        # Уровень 0 должен быть обработан (DifficultyManager может принять его как есть)
        enhanced = self.manager.enhance_task_for_level(task_data, level=0)
        
        # Проверяем, что задание обработано
        self.assertIsNotNone(enhanced)
        # Уровень может быть сохранен как есть (0) или обработан
        self.assertIn('_difficulty_level', enhanced)
    
    def test_enhance_task_invalid_level_negative(self):
        """Тест: обработка отрицательного уровня"""
        task_data = {
            "type": "click",
            "content": {
                "type": "click",
                "prompt": "Кликните на область"
            }
        }
        
        # Отрицательный уровень должен быть обработан (DifficultyManager может принять его как есть)
        enhanced = self.manager.enhance_task_for_level(task_data, level=-1)
        
        # Проверяем, что задание обработано
        self.assertIsNotNone(enhanced)
        # Уровень может быть сохранен как есть (-1) или обработан
        self.assertIn('_difficulty_level', enhanced)
    
    def test_enhance_task_invalid_level_too_high(self):
        """Тест: обработка уровня > 3"""
        task_data = {
            "type": "click",
            "content": {
                "type": "click",
                "prompt": "Кликните на область"
            }
        }
        
        # Уровень > 3 должен быть обработан (DifficultyManager может принять его как есть)
        enhanced = self.manager.enhance_task_for_level(task_data, level=5)
        
        # Проверяем, что задание обработано
        self.assertIsNotNone(enhanced)
        # Уровень может быть сохранен как есть (5) или обработан
        self.assertIn('_difficulty_level', enhanced)
    
    def test_enhance_task_invalid_level_non_integer(self):
        """Тест: обработка нецелого уровня"""
        task_data = {
            "type": "click",
            "content": {
                "type": "click",
                "prompt": "Кликните на область"
            }
        }
        
        # Нецелый уровень должен вызвать ошибку или быть обработан
        # В зависимости от реализации может быть TypeError или fallback
        try:
            enhanced = self.manager.enhance_task_for_level(task_data, level=2.5)
            # Если не выброшена ошибка, проверяем результат
            self.assertIsNotNone(enhanced)
        except (TypeError, ValueError):
            # Ожидаемое поведение - ошибка типа
            pass
    
    def test_enhance_task_without_content(self):
        """Тест: обработка задания без content"""
        task_data = {
            "type": "click",
            "settings": {
                "difficulty": 1
            }
        }
        
        # Задание без content должно быть обработано (fallback)
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        
        # Проверяем, что задание обработано
        self.assertIsNotNone(enhanced)
        # Флаги должны быть установлены
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        self.assertEqual(enhanced.get('_original_type'), 'click')
    
    def test_enhance_task_with_empty_content(self):
        """Тест: обработка задания с пустым content"""
        task_data = {
            "type": "click",
            "content": {},
            "settings": {
                "difficulty": 1
            }
        }
        
        # Задание с пустым content должно быть обработано
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        
        # Проверяем, что задание обработано
        self.assertIsNotNone(enhanced)
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
    
    def test_enhance_task_without_type(self):
        """Тест: обработка задания без типа"""
        task_data = {
            "content": {
                "prompt": "Кликните на область"
            }
        }
        
        # Задание без типа должно быть обработано (fallback на unknown)
        enhanced = self.manager.enhance_task_for_level(task_data, level=1)
        
        # Проверяем, что задание обработано
        self.assertIsNotNone(enhanced)
        self.assertTrue(enhanced.get('_difficulty_enhanced'))
        # original_type должен быть 'unknown' или определен из content
        self.assertIsNotNone(enhanced.get('_original_type'))


if __name__ == '__main__':
    unittest.main()

