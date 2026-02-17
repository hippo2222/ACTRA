"""
Data Hooks - Точки расширения для импорта/экспорта данных

Позволяет плагинам регистрировать импортеры для различных форматов данных.
"""

from typing import Dict, Any, Callable, Optional
from ..hooks.hook_registry import hook_registry


class DataHooks:
    """
    Класс для работы с data hooks.
    
    Предоставляет механизм регистрации импортеров для различных форматов данных.
    """
    
    HOOK_IMPORTER_REGISTER = "data.importer.register"
    
    @staticmethod
    def register_importer(plugin_id: str, format_name: str, 
                          importer_func: Callable[[str], Dict[str, Any]],
                          priority: int = 0) -> None:
        """
        Регистрирует импортер для формата данных.
        
        Args:
            plugin_id: ID плагина
            format_name: Имя формата (например "dicom", "nifti", "custom")
            importer_func: Функция импорта, принимающая путь к файлу
                          и возвращающая словарь с данными
            priority: Приоритет импортера
        """
        def wrapper(file_path: str) -> Dict[str, Any]:
            return importer_func(file_path)
        
        hook_registry.register(
            f"{DataHooks.HOOK_IMPORTER_REGISTER}.{format_name}",
            wrapper,
            plugin_id=plugin_id,
            priority=priority
        )
    
    @staticmethod
    def get_importer(format_name: str) -> Optional[Callable[[str], Dict[str, Any]]]:
        """
        Получает импортер для формата.
        
        Args:
            format_name: Имя формата
        
        Returns:
            Функция импорта или None, если не найдена
        """
        return hook_registry.call_first(f"{DataHooks.HOOK_IMPORTER_REGISTER}.{format_name}")
    
    @staticmethod
    def import_data(format_name: str, file_path: str) -> Optional[Dict[str, Any]]:
        """
        Импортирует данные из файла используя зарегистрированный импортер.
        
        Args:
            format_name: Имя формата
            file_path: Путь к файлу
        
        Returns:
            Словарь с данными или None, если импортер не найден
        """
        importer = DataHooks.get_importer(format_name)
        if importer:
            try:
                return importer(file_path)
            except Exception as e:
                print(f"Error importing {format_name} from {file_path}: {e}")
                import traceback
                traceback.print_exc()
        return None
    
    @staticmethod
    def unregister_importer(plugin_id: str) -> None:
        """
        Отменяет регистрацию всех импортеров плагина.
        
        Args:
            plugin_id: ID плагина
        """
        hook_registry.unregister_all_for_plugin(plugin_id)


# Глобальный экземпляр
data_hooks = DataHooks()





