"""
HookRegistry - Централизованный реестр точек расширения (hooks)

Позволяет плагинам регистрировать обработчики для различных событий
и точкам расширения вызывать зарегистрированные обработчики.
"""

import logging
from typing import Dict, List, Callable, Any, Optional
from collections import defaultdict
from ..exceptions import PluginError

logger = logging.getLogger(__name__)


class HookRegistry:
    """
    Централизованный реестр hooks (точек расширения).
    
    Плагины могут регистрировать обработчики для различных hooks,
    а система вызывает эти обработчики в соответствующих точках.
    """
    
    def __init__(self):
        """Инициализация реестра"""
        self._handlers: Dict[str, List[Callable]] = defaultdict(list)
        self._handler_metadata: Dict[Callable, Dict[str, Any]] = {}
    
    def register(self, hook_name: str, handler: Callable, plugin_id: Optional[str] = None, 
                 priority: int = 0) -> None:
        """
        Регистрирует обработчик для hook.
        
        Args:
            hook_name: Имя hook (например "ui.toolbar.register")
            handler: Функция-обработчик
            plugin_id: ID плагина (для отслеживания принадлежности)
            priority: Приоритет обработчика (больше = выше приоритет, по умолчанию 0)
        """
        # Сохраняем метаданные
        self._handler_metadata[handler] = {
            'plugin_id': plugin_id,
            'priority': priority,
            'hook_name': hook_name
        }
        
        # Добавляем обработчик с учётом приоритета
        handlers = self._handlers[hook_name]
        handlers.append(handler)
        # Сортируем по приоритету (от большего к меньшему)
        handlers.sort(key=lambda h: self._handler_metadata.get(h, {}).get('priority', 0), reverse=True)
    
    def unregister(self, hook_name: str, handler: Callable) -> None:
        """
        Отменяет регистрацию обработчика.
        
        Args:
            hook_name: Имя hook
            handler: Функция-обработчик для удаления
        """
        if handler in self._handlers[hook_name]:
            self._handlers[hook_name].remove(handler)
            if handler in self._handler_metadata:
                del self._handler_metadata[handler]
    
    def unregister_all_for_plugin(self, plugin_id: str) -> None:
        """
        Отменяет регистрацию всех обработчиков плагина.
        
        Args:
            plugin_id: ID плагина
        """
        handlers_to_remove = []
        for handler, metadata in self._handler_metadata.items():
            if metadata.get('plugin_id') == plugin_id:
                hook_name = metadata.get('hook_name')
                if hook_name and handler in self._handlers.get(hook_name, []):
                    handlers_to_remove.append((hook_name, handler))
        
        for hook_name, handler in handlers_to_remove:
            self.unregister(hook_name, handler)
    
    def call(self, hook_name: str, *args, **kwargs) -> List[Any]:
        """
        Вызывает все зарегистрированные обработчики для hook.
        
        Args:
            hook_name: Имя hook
            *args: Позиционные аргументы для обработчиков
            **kwargs: Именованные аргументы для обработчиков
        
        Returns:
            Список результатов вызовов обработчиков (в порядке приоритета)
        """
        results = []
        for handler in self._handlers.get(hook_name, []):
            try:
                result = handler(*args, **kwargs)
                results.append(result)
            except Exception as e:
                # Логируем ошибку, но продолжаем выполнение других обработчиков
                handler_metadata = self._handler_metadata.get(handler, {})
                plugin_id = handler_metadata.get('plugin_id', 'unknown')
                
                logger.exception(
                    f"Error in hook handler for {hook_name} (plugin: {plugin_id})"
                )
                
                # Создаём PluginError для контекста, но не выбрасываем (продолжаем выполнение)
                error = PluginError(
                    f"Error in hook handler for {hook_name}: {e}",
                    details={
                        'hook_name': hook_name,
                        'plugin_id': plugin_id,
                        'error_type': type(e).__name__
                    }
                )
                # Логируем, но не прерываем выполнение других обработчиков
                logger.error(f"Handler error (not raised): {error}")
        return results
    
    def call_first(self, hook_name: str, *args, **kwargs) -> Optional[Any]:
        """
        Вызывает первый зарегистрированный обработчик и возвращает его результат.
        
        Args:
            hook_name: Имя hook
            *args: Позиционные аргументы
            **kwargs: Именованные аргументы
        
        Returns:
            Результат первого обработчика или None
        """
        handlers = self._handlers.get(hook_name, [])
        if handlers:
            try:
                return handlers[0](*args, **kwargs)
            except Exception as e:
                handler = handlers[0]
                handler_metadata = self._handler_metadata.get(handler, {})
                plugin_id = handler_metadata.get('plugin_id', 'unknown')
                
                logger.exception(
                    f"Error in hook handler for {hook_name} (plugin: {plugin_id})"
                )
                
                # Выбрасываем PluginError для call_first (прерываем выполнение)
                raise PluginError(
                    f"Error in hook handler for {hook_name}: {e}",
                    details={
                        'hook_name': hook_name,
                        'plugin_id': plugin_id,
                        'error_type': type(e).__name__
                    }
                ) from e
        return None
    
    def get_handlers(self, hook_name: str) -> List[Callable]:
        """
        Получает список обработчиков для hook.
        
        Args:
            hook_name: Имя hook
        
        Returns:
            Список обработчиков (в порядке приоритета)
        """
        return self._handlers.get(hook_name, []).copy()
    
    def has_handlers(self, hook_name: str) -> bool:
        """
        Проверяет, есть ли зарегистрированные обработчики для hook.
        
        Args:
            hook_name: Имя hook
        
        Returns:
            True, если есть обработчики
        """
        return len(self._handlers.get(hook_name, [])) > 0
    
    def clear(self) -> None:
        """Очищает все зарегистрированные hooks"""
        self._handlers.clear()
        self._handler_metadata.clear()
    
    def get_all_hooks(self) -> List[str]:
        """
        Получает список всех зарегистрированных hooks.
        
        Returns:
            Список имён hooks
        """
        return list(self._handlers.keys())


# Глобальный экземпляр реестра
hook_registry = HookRegistry()





