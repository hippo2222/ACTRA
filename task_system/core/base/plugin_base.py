"""
PluginBase - Базовый класс для всех плагинов

Определяет формальный контракт для плагинов с lifecycle методами
и поддержкой extension points.
"""

from abc import ABC, abstractmethod
from typing import List, Type, Optional, Dict, Any
from .app_context import AppContext
from .task_type import BaseTaskType


class PluginBase(ABC):
    """
    Базовый класс для всех плагинов системы.
    
    Все плагины должны наследоваться от этого класса и реализовать
    обязательные методы для интеграции с системой.
    """
    
    # Обязательные поля класса (могут быть переопределены в подклассах)
    plugin_id: str
    version: str
    
    def __init__(self):
        """Инициализация плагина"""
        if not hasattr(self, 'plugin_id') or not self.plugin_id:
            raise ValueError(f"Plugin {self.__class__.__name__} must define plugin_id")
        if not hasattr(self, 'version') or not self.version:
            raise ValueError(f"Plugin {self.__class__.__name__} must define version")
    
    @abstractmethod
    def setup(self, app_context: AppContext) -> None:
        """
        Вызывается при загрузке плагина для инициализации.
        
        В этом методе плагин должен:
        - Регистрировать свои task types через hooks
        - Настраивать extension points
        - Инициализировать внутренние ресурсы
        
        Args:
            app_context: Контекст приложения с доступом к сервисам
        """
        pass
    
    @abstractmethod
    def teardown(self) -> None:
        """
        Вызывается при выгрузке плагина для очистки ресурсов.
        
        В этом методе плагин должен:
        - Отменять регистрацию task types
        - Освобождать ресурсы
        - Отменять подписки на hooks
        """
        pass
    
    @abstractmethod
    def get_task_types(self) -> List[Type[BaseTaskType]]:
        """
        Возвращает список классов типов заданий, предоставляемых плагином.
        
        Returns:
            Список классов, наследующихся от BaseTaskType
        """
        pass
    
    def get_metadata(self) -> Dict[str, Any]:
        """
        Возвращает метаданные плагина.
        
        Может быть переопределён для предоставления дополнительной информации.
        
        Returns:
            Словарь с метаданными плагина
        """
        return {
            "id": self.plugin_id,
            "version": self.version,
            "class": self.__class__.__name__
        }
    
    def on_task_type_registered(self, task_type: BaseTaskType) -> None:
        """
        Вызывается после регистрации типа задания плагина.
        
        Может быть переопределён для дополнительных действий.
        
        Args:
            task_type: Экземпляр зарегистрированного типа задания
        """
        pass
    
    def on_task_type_unregistered(self, task_id: str) -> None:
        """
        Вызывается после отмены регистрации типа задания плагина.
        
        Может быть переопределён для дополнительных действий.
        
        Args:
            task_id: ID типа задания
        """
        pass





