"""
UI Hooks - Точки расширения для UI компонентов

Позволяет плагинам регистрировать виджеты для toolbar и других UI элементов.
"""

from typing import Dict, Any, List, Tuple
from ..hooks.hook_registry import hook_registry


class UIHooks:
    """
    Класс для работы с UI hooks.
    
    Предоставляет удобный интерфейс для регистрации виджетов toolbar
    и других UI элементов.
    """
    
    HOOK_TOOLBAR_REGISTER = "ui.toolbar.register"
    
    @staticmethod
    def register_toolbar_widget(plugin_id: str, widget_descriptor: Dict[str, Any], 
                                priority: int = 0) -> None:
        """
        Регистрирует виджет для toolbar.
        
        Args:
            plugin_id: ID плагина
            widget_descriptor: Описание виджета:
                {
                    "id": str,  # Уникальный ID виджета
                    "type": str,  # Тип виджета ("button", "separator", "label", etc.)
                    "config": dict  # Конфигурация виджета (text, command, etc.)
                }
            priority: Приоритет регистрации
        """
        hook_registry.register(
            UIHooks.HOOK_TOOLBAR_REGISTER,
            lambda: widget_descriptor,
            plugin_id=plugin_id,
            priority=priority
        )
    
    @staticmethod
    def get_toolbar_widgets() -> List[Dict[str, Any]]:
        """
        Получает все зарегистрированные виджеты toolbar.
        
        Returns:
            Список описаний виджетов
        """
        return hook_registry.call(UIHooks.HOOK_TOOLBAR_REGISTER) or []
    
    @staticmethod
    def unregister_toolbar_widget(plugin_id: str) -> None:
        """
        Отменяет регистрацию всех виджетов toolbar плагина.
        
        Args:
            plugin_id: ID плагина
        """
        hook_registry.unregister_all_for_plugin(plugin_id)


# Глобальный экземпляр
ui_hooks = UIHooks()





