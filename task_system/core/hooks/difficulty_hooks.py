"""
Difficulty Hooks - Точки расширения для системы уровней сложности

Позволяет плагинам добавлять обработчики до и после модификации заданий,
а также регистрировать поддержку уровней сложности для плагинных типов заданий.
"""

from typing import Dict, Any, Callable, Optional, List
from ..hooks.hook_registry import hook_registry


class DifficultyHooks:
    """
    Класс для работы с difficulty hooks.
    
    Предоставляет точки расширения для модификации процесса применения уровней сложности.
    """
    
    HOOK_BEFORE_ENHANCE = "difficulty.before_enhance"
    HOOK_AFTER_ENHANCE = "difficulty.after_enhance"
    HOOK_GET_LEVELS = "difficulty.get_levels"
    
    @staticmethod
    def register_before_enhance(plugin_id: str, 
                                handler: Callable[[Dict[str, Any], int, Optional[str]], Optional[Dict[str, Any]]],
                                priority: int = 0) -> None:
        """
        Регистрирует обработчик, вызываемый до модификации задания.
        
        Args:
            plugin_id: ID плагина
            handler: Функция, принимающая (task_data, level, task_ref)
                    и возвращающая модифицированные данные задания или None.
                    task_data - исходные данные задания (из task.json),
                    level - уровень сложности (1, 2, 3),
                    task_ref - ссылка на задание (module/topic/task) или None
            priority: Приоритет обработчика
        """
        hook_registry.register(
            DifficultyHooks.HOOK_BEFORE_ENHANCE,
            handler,
            plugin_id=plugin_id,
            priority=priority
        )
    
    @staticmethod
    def register_after_enhance(plugin_id: str,
                               handler: Callable[[Dict[str, Any], int, Optional[str]], Optional[Dict[str, Any]]],
                               priority: int = 0) -> None:
        """
        Регистрирует обработчик, вызываемый после модификации задания.
        
        Args:
            plugin_id: ID плагина
            handler: Функция, принимающая (enhanced_task_data, level, task_ref)
                    и возвращающая модифицированные данные задания или None.
                    enhanced_task_data - модифицированные данные задания (после применения уровня),
                    level - уровень сложности (1, 2, 3),
                    task_ref - ссылка на задание (module/topic/task) или None
            priority: Приоритет обработчика
        """
        hook_registry.register(
            DifficultyHooks.HOOK_AFTER_ENHANCE,
            handler,
            plugin_id=plugin_id,
            priority=priority
        )
    
    @staticmethod
    def register_get_levels(plugin_id: str,
                           handler: Callable[[str, Optional[str]], Optional[List[int]]],
                           priority: int = 0) -> None:
        """
        Регистрирует обработчик для получения доступных уровней для типа задания.
        
        Args:
            plugin_id: ID плагина
            handler: Функция, принимающая (task_type, task_ref)
                    и возвращающая список доступных уровней [1, 2, 3] или None.
                    task_type - тип задания (например, "click", "draw", или плагинный тип),
                    task_ref - ссылка на задание (module/topic/task) или None.
                    Если handler возвращает None, используется дефолтное значение [1].
            priority: Приоритет обработчика
        """
        hook_registry.register(
            DifficultyHooks.HOOK_GET_LEVELS,
            handler,
            plugin_id=plugin_id,
            priority=priority
        )
    
    @staticmethod
    def call_before_enhance(task_data: Dict[str, Any], level: int, 
                           task_ref: Optional[str] = None) -> Dict[str, Any]:
        """
        Вызывает все обработчики before_enhance.
        
        Args:
            task_data: Исходные данные задания
            level: Уровень сложности
            task_ref: Ссылка на задание (опционально)
        
        Returns:
            Модифицированные данные задания или исходные
        """
        results = hook_registry.call(DifficultyHooks.HOOK_BEFORE_ENHANCE, task_data, level, task_ref)
        
        # Применяем модификации последовательно
        modified_task_data = task_data
        
        for result in results:
            if result is not None and isinstance(result, dict):
                # Объединяем модификации
                modified_task_data = {**modified_task_data, **result}
        
        return modified_task_data
    
    @staticmethod
    def call_after_enhance(enhanced_task_data: Dict[str, Any], level: int,
                          task_ref: Optional[str] = None) -> Dict[str, Any]:
        """
        Вызывает все обработчики after_enhance.
        
        Args:
            enhanced_task_data: Модифицированные данные задания (после применения уровня)
            level: Уровень сложности
            task_ref: Ссылка на задание (опционально)
        
        Returns:
            Модифицированные данные задания или исходные
        """
        results = hook_registry.call(DifficultyHooks.HOOK_AFTER_ENHANCE, enhanced_task_data, level, task_ref)
        
        # Применяем модификации последовательно
        modified_task_data = enhanced_task_data
        
        for result in results:
            if result is not None and isinstance(result, dict):
                # Объединяем модификации
                modified_task_data = {**modified_task_data, **result}
        
        return modified_task_data
    
    @staticmethod
    def call_get_levels(task_type: str, task_ref: Optional[str] = None) -> Optional[List[int]]:
        """
        Вызывает все обработчики get_levels и возвращает результат первого.
        
        Args:
            task_type: Тип задания
            task_ref: Ссылка на задание (опционально)
        
        Returns:
            Список доступных уровней [1, 2, 3] или None (если ни один плагин не зарегистрировал обработчик)
        """
        results = hook_registry.call(DifficultyHooks.HOOK_GET_LEVELS, task_type, task_ref)
        
        # Возвращаем результат первого обработчика (самый высокий приоритет)
        for result in results:
            if result is not None and isinstance(result, list):
                # Проверяем, что это список целых чисел
                if all(isinstance(x, int) for x in result):
                    return result
        
        return None
    
    @staticmethod
    def unregister_all(plugin_id: str) -> None:
        """
        Отменяет регистрацию всех difficulty hooks плагина.
        
        Args:
            plugin_id: ID плагина
        """
        hook_registry.unregister_all_for_plugin(plugin_id)


# Глобальный экземпляр
difficulty_hooks = DifficultyHooks()

