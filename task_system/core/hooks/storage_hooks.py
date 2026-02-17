"""
Storage Hooks - Точки расширения для работы с хранилищем

Позволяет плагинам добавлять обработчики при сохранении/загрузке данных.
"""

from typing import Dict, Any, Callable, Optional
from ..hooks.hook_registry import hook_registry


class StorageHooks:
    """
    Класс для работы с storage hooks.
    
    Предоставляет точки расширения для модификации процесса
    сохранения и загрузки данных.
    """
    
    HOOK_ON_SAVE = "storage.hooks.on_save"
    HOOK_ON_LOAD = "storage.hooks.on_load"
    
    @staticmethod
    def register_on_save(plugin_id: str, handler: Callable[[str, Dict[str, Any]], Optional[Dict[str, Any]]],
                         priority: int = 0) -> None:
        """
        Регистрирует обработчик, вызываемый при сохранении данных.
        
        Args:
            plugin_id: ID плагина
            handler: Функция, принимающая (file_path, data)
                     и возвращающая модифицированные данные или None
            priority: Приоритет обработчика
        """
        hook_registry.register(
            StorageHooks.HOOK_ON_SAVE,
            handler,
            plugin_id=plugin_id,
            priority=priority
        )
    
    @staticmethod
    def register_on_load(plugin_id: str, handler: Callable[[str, Dict[str, Any]], Optional[Dict[str, Any]]],
                         priority: int = 0) -> None:
        """
        Регистрирует обработчик, вызываемый при загрузке данных.
        
        Args:
            plugin_id: ID плагина
            handler: Функция, принимающая (file_path, data)
                     и возвращающая модифицированные данные или None
            priority: Приоритет обработчика
        """
        hook_registry.register(
            StorageHooks.HOOK_ON_LOAD,
            handler,
            plugin_id=plugin_id,
            priority=priority
        )
    
    @staticmethod
    def call_on_save(file_path: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Вызывает все обработчики on_save.
        
        Args:
            file_path: Путь к файлу
            data: Данные для сохранения
        
        Returns:
            Модифицированные данные
        """
        modified_data = data
        results = hook_registry.call(StorageHooks.HOOK_ON_SAVE, file_path, data)
        
        for result in results:
            if result is not None:
                if isinstance(result, dict):
                    # Объединяем модификации
                    modified_data = {**modified_data, **result}
        
        return modified_data
    
    @staticmethod
    def call_on_load(file_path: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Вызывает все обработчики on_load.
        
        Args:
            file_path: Путь к файлу
            data: Загруженные данные
        
        Returns:
            Модифицированные данные
        """
        modified_data = data
        results = hook_registry.call(StorageHooks.HOOK_ON_LOAD, file_path, data)
        
        for result in results:
            if result is not None:
                if isinstance(result, dict):
                    # Объединяем модификации
                    modified_data = {**modified_data, **result}
        
        return modified_data
    
    @staticmethod
    def unregister_all(plugin_id: str) -> None:
        """
        Отменяет регистрацию всех storage hooks плагина.
        
        Args:
            plugin_id: ID плагина
        """
        hook_registry.unregister_all_for_plugin(plugin_id)


# Глобальный экземпляр
storage_hooks = StorageHooks()





