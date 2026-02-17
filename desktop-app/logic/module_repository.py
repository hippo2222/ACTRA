"""
Module Repository - Фасад для доступа к модулям/темам/заданиям.

Упрощённый интерфейс для работы с данными обучения.
Делегирует к StorageService, предоставляет кэширование и поиск.

НЕДЕЛЯ 2, Logic Layer - Блок C: Module Repository
"""

import sys
from pathlib import Path
from typing import List, Dict, Any, Optional

# Добавляем пути для импорта
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.storage_service import StorageService
from logic.task_controller import Task


class ModuleRepository:
    """
    Репозиторий для доступа к модулям, темам и заданиям.
    
    Фасад над StorageService, предоставляющий удобный API для Logic/UI слоёв.
    
    Использование:
        from services.storage_service import StorageService
        from logic.module_repository import ModuleRepository
        
        storage = StorageService(data_dir="./data")
        repo = ModuleRepository(storage)
        
        # Получение модулей
        modules = repo.get_all_modules()
        
        # Получение тем
        topics = repo.get_topics_for_module("anatomy")
        
        # Получение заданий
        tasks = repo.get_tasks_for_topic("anatomy", "liver")
        
        # Получение конкретного задания
        task = repo.get_task("anatomy", "liver", "liver_click_01")
    """
    
    def __init__(self, storage_service: StorageService):
        """
        Инициализация ModuleRepository.
        
        Args:
            storage_service: Сервис для работы с хранилищем данных
        """
        self.storage = storage_service
        
        # Кэш (опционально, для оптимизации)
        self._modules_cache: Optional[List[Dict[str, Any]]] = None
    
    # =========================================================================
    # МОДУЛИ
    # =========================================================================
    
    def get_all_modules(self) -> List[Dict[str, Any]]:
        """
        Получить все доступные модули.
        
        Returns:
            List[Dict]: Список модулей с метаданными
        
        Example:
            >>> modules = repo.get_all_modules()
            >>> for module in modules:
            ...     print(f"{module['id']}: {module['name']}")
            anatomy: Анатомия
            pathology: Патология
        """
        if self._modules_cache is None:
            self._modules_cache = self.storage.load_modules()
        
        return self._modules_cache
    
    def get_module(self, module_id: str) -> Optional[Dict[str, Any]]:
        """
        Получить модуль по ID.
        
        Args:
            module_id: ID модуля
        
        Returns:
            Dict с данными модуля или None если не найден
        
        Example:
            >>> module = repo.get_module("anatomy")
            >>> print(module['name'])
            Анатомия
        """
        modules = self.get_all_modules()
        
        for module in modules:
            if module['id'] == module_id:
                return module
        
        return None
    
    def module_exists(self, module_id: str) -> bool:
        """
        Проверить, существует ли модуль.
        
        Args:
            module_id: ID модуля
        
        Returns:
            bool: True если модуль существует
        """
        return self.get_module(module_id) is not None
    
    # =========================================================================
    # ТЕМЫ
    # =========================================================================
    
    def get_topics_for_module(self, module_id: str) -> List[Dict[str, Any]]:
        """
        Получить темы модуля.
        
        Args:
            module_id: ID модуля
        
        Returns:
            List[Dict]: Список тем
        
        Example:
            >>> topics = repo.get_topics_for_module("anatomy")
            >>> for topic in topics:
            ...     print(f"{topic['id']}: {topic['name']}")
            liver: Печень
            heart: Сердце
        """
        return self.storage.get_topics(module_id)
    
    def get_topic(self, module_id: str, topic_id: str) -> Optional[Dict[str, Any]]:
        """
        Получить тему по ID.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
        
        Returns:
            Dict с данными темы или None если не найдена
        
        Example:
            >>> topic = repo.get_topic("anatomy", "liver")
            >>> print(topic['name'])
            Печень
        """
        return self.storage.get_topic(module_id, topic_id)
    
    def topic_exists(self, module_id: str, topic_id: str) -> bool:
        """
        Проверить, существует ли тема.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
        
        Returns:
            bool: True если тема существует
        """
        return self.get_topic(module_id, topic_id) is not None
    
    # =========================================================================
    # ЗАДАНИЯ
    # =========================================================================
    
    def get_tasks_for_topic(self, module_id: str, topic_id: str) -> List[Task]:
        """
        Получить задания темы в виде Task objects.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
        
        Returns:
            List[Task]: Список объектов Task
        
        Example:
            >>> tasks = repo.get_tasks_for_topic("anatomy", "liver")
            >>> for task in tasks:
            ...     print(f"{task.task_id}: {task.task_type}")
            liver_click_01: click
            liver_draw_01: draw
        """
        # Получаем метаданные заданий
        task_metadata_list = self.storage.get_tasks(module_id, topic_id)
        
        tasks = []
        for task_meta in task_metadata_list:
            task_id = task_meta['id']
            
            # Загружаем полные данные задания
            full_task_data = self.storage.load_task(module_id, topic_id, task_id)
            
            if full_task_data:
                # Объединяем метаданные из module.json с данными из task.json
                # Приоритет у метаданных из module.json (они более актуальные)
                merged_task_data = full_task_data['task_data'].copy()
                
                # Добавляем/перезаписываем название из метаданных, если есть
                if 'name' in task_meta:
                    merged_task_data['name'] = task_meta['name']
                
                # Определяем тип (приоритет у метаданных из module.json)
                task_type = (
                    task_meta.get('type') or  # Из module.json
                    full_task_data['task_data'].get('type') or  # Из task.json
                    'unknown'
                )
                
                # Создаём Task объект
                task = Task(
                    module_id=module_id,
                    topic_id=topic_id,
                    task_id=task_id,
                    task_type=task_type,
                    task_data=merged_task_data,
                    answer_key=full_task_data['answer_key']
                )
                tasks.append(task)
        
        return tasks
    
    def get_task(self, module_id: str, topic_id: str, task_id: str) -> Optional[Task]:
        """
        Получить конкретное задание с полными данными.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            Task object или None если не найдено
        
        Example:
            >>> task = repo.get_task("anatomy", "liver", "liver_click_01")
            >>> print(task.task_type)
            click
            >>> print(task.answer_key)
            {'targets': [...]}
        """
        full_task_data = self.storage.load_task(module_id, topic_id, task_id)
        
        if not full_task_data:
            return None
        
        # Получаем метаданные задания из темы
        task_metadata = full_task_data.get('metadata', {})
        
        # Объединяем метаданные из module.json с данными из task.json
        merged_task_data = full_task_data['task_data'].copy()
        
        # Добавляем/перезаписываем название из метаданных, если есть
        if 'name' in task_metadata:
            merged_task_data['name'] = task_metadata['name']
        
        # Определяем тип (приоритет у метаданных из module.json)
        task_type = (
            task_metadata.get('type') or  # Из module.json
            full_task_data['task_data'].get('type') or  # Из task.json
            'unknown'
        )
        
        # Создаём Task объект
        task = Task(
            module_id=module_id,
            topic_id=topic_id,
            task_id=task_id,
            task_type=task_type,
            task_data=merged_task_data,
            answer_key=full_task_data['answer_key']
        )
        
        return task
    
    def task_exists(self, module_id: str, topic_id: str, task_id: str) -> bool:
        """
        Проверить, существует ли задание.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            bool: True если задание существует
        """
        return self.get_task(module_id, topic_id, task_id) is not None
    
    # =========================================================================
    # ПОИСК
    # =========================================================================
    
    def search_tasks(self, query: str) -> List[Task]:
        """
        Поиск заданий по запросу (имя, описание).
        
        Args:
            query: Поисковый запрос
        
        Returns:
            List[Task]: Список найденных заданий
        
        Example:
            >>> results = repo.search_tasks("печень")
            >>> for task in results:
            ...     print(task.full_id)
            anatomy/liver/liver_click_01
            anatomy/liver/liver_draw_01
        
        Note:
            Поиск без учёта регистра, по названию и описанию задания.
        """
        query_lower = query.lower()
        results = []
        
        # Проходим по всем модулям
        for module in self.get_all_modules():
            module_id = module['id']
            
            # Проходим по всем темам модуля
            for topic in self.get_topics_for_module(module_id):
                topic_id = topic['id']
                
                # Проходим по всем заданиям темы
                tasks = self.get_tasks_for_topic(module_id, topic_id)
                
                for task in tasks:
                    # Проверяем task_id
                    if query_lower in task.task_id.lower():
                        results.append(task)
                        continue
                    
                    # Проверяем description в task_data
                    description = task.task_data.get('description', '')
                    if query_lower in description.lower():
                        results.append(task)
                        continue
                    
                    # Проверяем name в task_data
                    name = task.task_data.get('name', '')
                    if query_lower in name.lower():
                        results.append(task)
        
        return results
    
    # =========================================================================
    # СТАТИСТИКА
    # =========================================================================
    
    def get_repository_stats(self) -> Dict[str, int]:
        """
        Получить статистику репозитория.
        
        Returns:
            Dict с ключами: 'modules', 'topics', 'tasks'
        
        Example:
            >>> stats = repo.get_repository_stats()
            >>> print(stats)
            {'modules': 3, 'topics': 12, 'tasks': 45}
        """
        modules = self.get_all_modules()
        total_topics = 0
        total_tasks = 0
        
        for module in modules:
            topics = self.get_topics_for_module(module['id'])
            total_topics += len(topics)
            
            for topic in topics:
                tasks = self.get_tasks_for_topic(module['id'], topic['id'])
                total_tasks += len(tasks)
        
        return {
            'modules': len(modules),
            'topics': total_topics,
            'tasks': total_tasks
        }
    
    # =========================================================================
    # УТИЛИТЫ
    # =========================================================================
    
    def clear_cache(self) -> None:
        """
        Очистить кэш репозитория.
        
        Полезно если модули были изменены во время работы приложения.
        """
        self._modules_cache = None
        self.storage.reload_modules()
    
    def get_task_count_for_topic(self, module_id: str, topic_id: str) -> int:
        """
        Получить количество заданий в теме.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
        
        Returns:
            int: Количество заданий
        """
        tasks = self.get_tasks_for_topic(module_id, topic_id)
        return len(tasks)


# Экспортируемые классы
__all__ = ['ModuleRepository']

