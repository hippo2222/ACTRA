# task_system/schemas/base_schema.py
"""
Базовая схема для валидации заданий.
"""

from typing import Dict, List, Any, Optional

# Импортируем TaskValidationError из единой системы исключений
from ..exceptions import TaskValidationError

# Сохраняем ValidationError как алиас для обратной совместимости
ValidationError = TaskValidationError


class BaseTaskSchema:
    """
    Базовая схема для валидации структуры задания.
    Все схемы типов наследуются от этого класса.
    """
    
    @classmethod
    def validate(cls, data: Dict[str, Any]) -> List[str]:
        """
        Валидирует данные задания.
        
        Args:
            data: Данные задания для валидации
            
        Returns:
            Список ошибок валидации (пустой если данные валидны)
        """
        errors = []
        
        # Проверяем обязательные поля верхнего уровня
        required_fields = ['type', 'meta', 'content']
        for field in required_fields:
            if field not in data:
                errors.append(f"Отсутствует обязательное поле: {field}")
        
        # Проверяем meta
        if 'meta' in data:
            meta_errors = cls._validate_meta(data['meta'])
            errors.extend(meta_errors)
        
        # Проверяем content (переопределяется в подклассах)
        if 'content' in data:
            content_errors = cls._validate_content(data['content'])
            errors.extend(content_errors)
        
        return errors
    
    @classmethod
    def _validate_meta(cls, meta: Dict[str, Any]) -> List[str]:
        """
        Валидирует метаданные задания.
        
        Args:
            meta: Метаданные задания
            
        Returns:
            Список ошибок
        """
        errors = []
        
        # Проверяем обязательные поля meta
        required_meta_fields = ['name']
        for field in required_meta_fields:
            if field not in meta or not meta[field]:
                errors.append(f"meta.{field}: поле обязательно и не может быть пустым")
        
        return errors
    
    @classmethod
    def _validate_content(cls, content: Dict[str, Any]) -> List[str]:
        """
        Валидирует содержимое задания.
        Переопределяется в подклассах для специфичной валидации.
        
        Args:
            content: Содержимое задания
            
        Returns:
            Список ошибок
        """
        # Базовая реализация - переопределяется в подклассах
        return []
    
    @classmethod
    def is_valid(cls, data: Dict[str, Any]) -> bool:
        """
        Проверяет валидность данных.
        
        Args:
            data: Данные для проверки
            
        Returns:
            True если данные валидны
        """
        errors = cls.validate(data)
        return len(errors) == 0
    
    @classmethod
    def validate_or_raise(cls, data: Dict[str, Any]):
        """
        Валидирует данные и выбрасывает исключение при ошибках.
        
        Args:
            data: Данные для валидации
            
        Raises:
            ValidationError: Если данные невалидны
        """
        errors = cls.validate(data)
        if errors:
            error_message = "\n".join(errors)
            raise ValidationError(f"Ошибки валидации:\n{error_message}")

