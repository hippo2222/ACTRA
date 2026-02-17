"""
Базовый класс для миграций данных заданий.
"""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)


class BaseMigration(ABC):
    """
    Базовый класс для всех миграций данных заданий.
    
    Каждая миграция преобразует данные из одной версии схемы в другую.
    """
    
    def __init__(self):
        """Инициализация миграции."""
        if not hasattr(self, 'from_version') or not hasattr(self, 'to_version'):
            raise ValueError(
                f"Migration {self.__class__.__name__} must define "
                f"'from_version' and 'to_version' class attributes"
            )
    
    @property
    @abstractmethod
    def from_version(self) -> str:
        """Исходная версия схемы."""
        pass
    
    @property
    @abstractmethod
    def to_version(self) -> str:
        """Целевая версия схемы."""
        pass
    
    @abstractmethod
    def migrate(self, task_dict: Dict[str, Any], task_path: Path) -> Dict[str, Any]:
        """
        Применяет миграцию к данным задания.
        
        Args:
            task_dict: Словарь с данными задания
            task_path: Путь к файлу task.json (для контекста миграции)
            
        Returns:
            Мигрированный словарь с данными задания
        """
        pass
    
    def validate(self, task_dict: Dict[str, Any]) -> bool:
        """
        Проверяет корректность данных перед миграцией.
        
        Args:
            task_dict: Словарь с данными задания
            
        Returns:
            True если данные корректны для миграции
        """
        return True
    
    def rollback(self, task_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        Откатывает миграцию (опционально).
        
        Args:
            task_dict: Словарь с данными задания
            
        Returns:
            Откатанный словарь с данными задания
        """
        # По умолчанию откат не поддерживается
        raise NotImplementedError(
            f"Migration {self.__class__.__name__} does not support rollback"
        )


















































