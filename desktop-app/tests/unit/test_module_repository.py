"""
Unit-тесты для ModuleRepository (Logic Layer - Блок C).

Тестируем:
- Получение модулей (get_all_modules, get_module)
- Получение тем (get_topics_for_module, get_topic)
- Получение заданий (get_tasks_for_topic, get_task)
- Поиск (search_tasks)
- Статистику (get_repository_stats)
"""

import unittest
import sys
from pathlib import Path
from unittest.mock import Mock, MagicMock

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from logic.module_repository import ModuleRepository
from logic.task_controller import Task


# =============================================================================
# HELPER: Mock StorageService
# =============================================================================

def create_mock_storage_service():
    """Создаёт мокированный StorageService с тестовыми данными"""
    mock_storage = Mock()
    
    # Тестовые модули
    mock_storage.load_modules.return_value = [
        {
            'id': 'anatomy',
            'name': 'Анатомия',
            'description': 'Анатомия человека',
            'topics': [
                {
                    'id': 'liver',
                    'name': 'Печень',
                    'tasks': [
                        {'id': 'liver_click_01', 'name': 'Клик на печень'},
                        {'id': 'liver_draw_01', 'name': 'Обведи печень'},
                    ]
                },
                {
                    'id': 'heart',
                    'name': 'Сердце',
                    'tasks': [
                        {'id': 'heart_click_01', 'name': 'Клик на сердце'},
                    ]
                }
            ]
        },
        {
            'id': 'pathology',
            'name': 'Патология',
            'description': 'Патологическая анатомия',
            'topics': [
                {
                    'id': 'tumors',
                    'name': 'Опухоли',
                    'tasks': [
                        {'id': 'tumor_click_01', 'name': 'Найти опухоль'},
                    ]
                }
            ]
        }
    ]
    
    # Мок для get_topics
    def mock_get_topics(module_id):
        for module in mock_storage.load_modules():
            if module['id'] == module_id:
                return module.get('topics', [])
        return []
    
    mock_storage.get_topics = Mock(side_effect=mock_get_topics)
    
    # Мок для get_topic
    def mock_get_topic(module_id, topic_id):
        topics = mock_get_topics(module_id)
        for topic in topics:
            if topic['id'] == topic_id:
                return topic
        return None
    
    mock_storage.get_topic = Mock(side_effect=mock_get_topic)
    
    # Мок для get_tasks
    def mock_get_tasks(module_id, topic_id):
        topic = mock_get_topic(module_id, topic_id)
        if topic:
            return topic.get('tasks', [])
        return []
    
    mock_storage.get_tasks = Mock(side_effect=mock_get_tasks)
    
    # Мок для load_task
    def mock_load_task(module_id, topic_id, task_id):
        tasks = mock_get_tasks(module_id, topic_id)
        for task_meta in tasks:
            if task_meta['id'] == task_id:
                return {
                    'task_data': {
                        'type': 'click',
                        'description': task_meta.get('name', ''),
                        'image': f'{task_id}.jpg'
                    },
                    'answer_key': {
                        'targets': [{'x': 100, 'y': 100}]
                    },
                    'metadata': task_meta
                }
        return None
    
    mock_storage.load_task = Mock(side_effect=mock_load_task)
    
    # Мок для reload_modules
    mock_storage.reload_modules = Mock()
    
    return mock_storage


# =============================================================================
# ТЕСТЫ: Инициализация
# =============================================================================

class TestModuleRepositoryInit(unittest.TestCase):
    """Тесты инициализации ModuleRepository"""
    
    def test_init_stores_storage_service(self):
        """Инициализация сохраняет ссылку на StorageService"""
        mock_storage = create_mock_storage_service()
        repo = ModuleRepository(mock_storage)
        
        self.assertEqual(repo.storage, mock_storage)
    
    def test_init_cache_is_none(self):
        """При инициализации кэш пуст"""
        mock_storage = create_mock_storage_service()
        repo = ModuleRepository(mock_storage)
        
        self.assertIsNone(repo._modules_cache)


# =============================================================================
# ТЕСТЫ: Получение модулей
# =============================================================================

class TestGetModules(unittest.TestCase):
    """Тесты получения модулей"""
    
    def setUp(self):
        self.mock_storage = create_mock_storage_service()
        self.repo = ModuleRepository(self.mock_storage)
    
    def test_get_all_modules_returns_list(self):
        """get_all_modules возвращает список модулей"""
        modules = self.repo.get_all_modules()
        
        self.assertIsInstance(modules, list)
        self.assertGreater(len(modules), 0)
    
    def test_get_all_modules_caches_result(self):
        """get_all_modules кэширует результат"""
        modules1 = self.repo.get_all_modules()
        modules2 = self.repo.get_all_modules()
        
        # Должен был вызваться только один раз
        self.mock_storage.load_modules.assert_called_once()
        
        # Результаты одинаковые
        self.assertEqual(modules1, modules2)
    
    def test_get_module_returns_module_by_id(self):
        """get_module возвращает модуль по ID"""
        module = self.repo.get_module("anatomy")
        
        self.assertIsNotNone(module)
        self.assertEqual(module['id'], "anatomy")
        self.assertEqual(module['name'], "Анатомия")
    
    def test_get_module_returns_none_for_nonexistent(self):
        """get_module возвращает None для несуществующего модуля"""
        module = self.repo.get_module("nonexistent")
        
        self.assertIsNone(module)
    
    def test_module_exists_returns_true_for_existing(self):
        """module_exists возвращает True для существующего модуля"""
        exists = self.repo.module_exists("anatomy")
        
        self.assertTrue(exists)
    
    def test_module_exists_returns_false_for_nonexistent(self):
        """module_exists возвращает False для несуществующего модуля"""
        exists = self.repo.module_exists("nonexistent")
        
        self.assertFalse(exists)


# =============================================================================
# ТЕСТЫ: Получение тем
# =============================================================================

class TestGetTopics(unittest.TestCase):
    """Тесты получения тем"""
    
    def setUp(self):
        self.mock_storage = create_mock_storage_service()
        self.repo = ModuleRepository(self.mock_storage)
    
    def test_get_topics_for_module_returns_list(self):
        """get_topics_for_module возвращает список тем"""
        topics = self.repo.get_topics_for_module("anatomy")
        
        self.assertIsInstance(topics, list)
        self.assertEqual(len(topics), 2)  # liver, heart
    
    def test_get_topics_for_module_correct_topics(self):
        """get_topics_for_module возвращает корректные темы"""
        topics = self.repo.get_topics_for_module("anatomy")
        
        topic_ids = [t['id'] for t in topics]
        self.assertIn('liver', topic_ids)
        self.assertIn('heart', topic_ids)
    
    def test_get_topics_for_nonexistent_module(self):
        """get_topics_for_module возвращает пустой список для несуществующего модуля"""
        topics = self.repo.get_topics_for_module("nonexistent")
        
        self.assertEqual(topics, [])
    
    def test_get_topic_returns_topic_by_id(self):
        """get_topic возвращает тему по ID"""
        topic = self.repo.get_topic("anatomy", "liver")
        
        self.assertIsNotNone(topic)
        self.assertEqual(topic['id'], "liver")
        self.assertEqual(topic['name'], "Печень")
    
    def test_get_topic_returns_none_for_nonexistent(self):
        """get_topic возвращает None для несуществующей темы"""
        topic = self.repo.get_topic("anatomy", "nonexistent")
        
        self.assertIsNone(topic)
    
    def test_topic_exists_returns_true_for_existing(self):
        """topic_exists возвращает True для существующей темы"""
        exists = self.repo.topic_exists("anatomy", "liver")
        
        self.assertTrue(exists)
    
    def test_topic_exists_returns_false_for_nonexistent(self):
        """topic_exists возвращает False для несуществующей темы"""
        exists = self.repo.topic_exists("anatomy", "nonexistent")
        
        self.assertFalse(exists)


# =============================================================================
# ТЕСТЫ: Получение заданий
# =============================================================================

class TestGetTasks(unittest.TestCase):
    """Тесты получения заданий"""
    
    def setUp(self):
        self.mock_storage = create_mock_storage_service()
        self.repo = ModuleRepository(self.mock_storage)
    
    def test_get_tasks_for_topic_returns_list_of_tasks(self):
        """get_tasks_for_topic возвращает список Task objects"""
        tasks = self.repo.get_tasks_for_topic("anatomy", "liver")
        
        self.assertIsInstance(tasks, list)
        self.assertEqual(len(tasks), 2)  # liver_click_01, liver_draw_01
        
        for task in tasks:
            self.assertIsInstance(task, Task)
    
    def test_get_tasks_for_topic_correct_task_ids(self):
        """get_tasks_for_topic возвращает корректные задания"""
        tasks = self.repo.get_tasks_for_topic("anatomy", "liver")
        
        task_ids = [t.task_id for t in tasks]
        self.assertIn('liver_click_01', task_ids)
        self.assertIn('liver_draw_01', task_ids)
    
    def test_get_tasks_for_topic_task_attributes(self):
        """Задания имеют корректные атрибуты"""
        tasks = self.repo.get_tasks_for_topic("anatomy", "liver")
        
        task = tasks[0]
        self.assertEqual(task.module_id, "anatomy")
        self.assertEqual(task.topic_id, "liver")
        self.assertIn('task_data', task.__dict__ or {})
        self.assertIn('answer_key', task.__dict__ or {})
    
    def test_get_tasks_for_nonexistent_topic(self):
        """get_tasks_for_topic возвращает пустой список для несуществующей темы"""
        tasks = self.repo.get_tasks_for_topic("anatomy", "nonexistent")
        
        self.assertEqual(tasks, [])
    
    def test_get_task_returns_task_object(self):
        """get_task возвращает Task object"""
        task = self.repo.get_task("anatomy", "liver", "liver_click_01")
        
        self.assertIsNotNone(task)
        self.assertIsInstance(task, Task)
        self.assertEqual(task.task_id, "liver_click_01")
        self.assertEqual(task.module_id, "anatomy")
        self.assertEqual(task.topic_id, "liver")
    
    def test_get_task_returns_none_for_nonexistent(self):
        """get_task возвращает None для несуществующего задания"""
        task = self.repo.get_task("anatomy", "liver", "nonexistent")
        
        self.assertIsNone(task)
    
    def test_task_exists_returns_true_for_existing(self):
        """task_exists возвращает True для существующего задания"""
        exists = self.repo.task_exists("anatomy", "liver", "liver_click_01")
        
        self.assertTrue(exists)
    
    def test_task_exists_returns_false_for_nonexistent(self):
        """task_exists возвращает False для несуществующего задания"""
        exists = self.repo.task_exists("anatomy", "liver", "nonexistent")
        
        self.assertFalse(exists)


# =============================================================================
# ТЕСТЫ: Поиск
# =============================================================================

class TestSearchTasks(unittest.TestCase):
    """Тесты поиска заданий"""
    
    def setUp(self):
        self.mock_storage = create_mock_storage_service()
        self.repo = ModuleRepository(self.mock_storage)
    
    def test_search_tasks_by_task_id(self):
        """search_tasks находит задания по task_id"""
        results = self.repo.search_tasks("liver")
        
        self.assertGreater(len(results), 0)
        
        # Проверяем что все результаты содержат "liver"
        for task in results:
            self.assertIn("liver", task.task_id.lower())
    
    def test_search_tasks_by_description(self):
        """search_tasks находит задания по description"""
        results = self.repo.search_tasks("клик")
        
        self.assertGreater(len(results), 0)
        
        # Проверяем что результаты содержат "клик" в description
        found = False
        for task in results:
            if "клик" in task.task_data.get('description', '').lower():
                found = True
                break
        
        self.assertTrue(found)
    
    def test_search_tasks_case_insensitive(self):
        """search_tasks работает без учёта регистра"""
        results_lower = self.repo.search_tasks("liver")
        results_upper = self.repo.search_tasks("LIVER")
        
        self.assertEqual(len(results_lower), len(results_upper))
    
    def test_search_tasks_returns_empty_for_no_matches(self):
        """search_tasks возвращает пустой список если ничего не найдено"""
        results = self.repo.search_tasks("nonexistent_query_12345")
        
        self.assertEqual(results, [])


# =============================================================================
# ТЕСТЫ: Статистика
# =============================================================================

class TestRepositoryStats(unittest.TestCase):
    """Тесты статистики репозитория"""
    
    def setUp(self):
        self.mock_storage = create_mock_storage_service()
        self.repo = ModuleRepository(self.mock_storage)
    
    def test_get_repository_stats_returns_dict(self):
        """get_repository_stats возвращает словарь"""
        stats = self.repo.get_repository_stats()
        
        self.assertIsInstance(stats, dict)
    
    def test_get_repository_stats_has_all_keys(self):
        """get_repository_stats содержит все ключи"""
        stats = self.repo.get_repository_stats()
        
        self.assertIn('modules', stats)
        self.assertIn('topics', stats)
        self.assertIn('tasks', stats)
    
    def test_get_repository_stats_correct_counts(self):
        """get_repository_stats возвращает корректные подсчёты"""
        stats = self.repo.get_repository_stats()
        
        # 2 модуля (anatomy, pathology)
        self.assertEqual(stats['modules'], 2)
        
        # 3 темы (liver, heart, tumors)
        self.assertEqual(stats['topics'], 3)
        
        # 4 задания (liver_click_01, liver_draw_01, heart_click_01, tumor_click_01)
        self.assertEqual(stats['tasks'], 4)
    
    def test_get_task_count_for_topic(self):
        """get_task_count_for_topic возвращает количество заданий"""
        count = self.repo.get_task_count_for_topic("anatomy", "liver")
        
        self.assertEqual(count, 2)  # liver_click_01, liver_draw_01


# =============================================================================
# ТЕСТЫ: Утилиты
# =============================================================================

class TestUtilities(unittest.TestCase):
    """Тесты утилит"""
    
    def setUp(self):
        self.mock_storage = create_mock_storage_service()
        self.repo = ModuleRepository(self.mock_storage)
    
    def test_clear_cache_clears_modules_cache(self):
        """clear_cache очищает кэш модулей"""
        # Загружаем модули (кэшируются)
        self.repo.get_all_modules()
        
        self.assertIsNotNone(self.repo._modules_cache)
        
        # Очищаем кэш
        self.repo.clear_cache()
        
        self.assertIsNone(self.repo._modules_cache)
    
    def test_clear_cache_reloads_modules(self):
        """clear_cache перезагружает модули из storage"""
        self.repo.clear_cache()
        
        # Должен был вызваться reload_modules
        self.mock_storage.reload_modules.assert_called_once()


# =============================================================================
# ЗАПУСК ТЕСТОВ
# =============================================================================

if __name__ == '__main__':
    unittest.main()

