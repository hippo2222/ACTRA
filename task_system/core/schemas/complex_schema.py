# task_system/core/schemas/complex_schema.py
"""
Схема для валидации структуры комплексов (Complex).
"""

from typing import Dict, List, Any
from ..exceptions import TaskValidationError

class ComplexSchema:
    """
    Схема для валидации структуры комплекса.
    """
    
    @classmethod
    def validate(cls, data: Dict[str, Any]) -> List[str]:
        """
        Валидирует данные комплекса.
        
        Args:
            data: Данные комплекса для валидации
            
        Returns:
            Список ошибок валидации (пустой если данные валидны)
        """
        errors = []
        
        # Проверяем обязательные поля
        required_fields = ['id', 'name', 'tasks']
        for field in required_fields:
            if field not in data:
                errors.append(f"Отсутствует обязательное поле: {field}")
                
        # Проверяем типы полей
        if 'id' in data and not isinstance(data['id'], str):
            errors.append("Поле 'id' должно быть строкой")
            
        if 'name' in data and not isinstance(data['name'], str):
            errors.append("Поле 'name' должно быть строкой")
            
        if 'tasks' in data:
            if not isinstance(data['tasks'], list):
                errors.append("Поле 'tasks' должно быть списком")
            elif not data['tasks']:
                errors.append("Список 'tasks' не может быть пустым")
            else:
                # Проверяем элементы списка tasks
                for i, task_ref in enumerate(data['tasks']):
                    if not isinstance(task_ref, str):
                        errors.append(f"Элемент tasks[{i}] должен быть строкой (ссылкой на задание)")
        
        # Проверяем settings если есть
        if 'settings' in data:
            if not isinstance(data['settings'], dict):
                errors.append("Поле 'settings' должно быть словарем")
        
        return errors

    @classmethod
    def validate_or_raise(cls, data: Dict[str, Any]):
        """
        Валидирует данные и выбрасывает исключение при ошибках.
        
        Args:
            data: Данные для валидации
            
        Raises:
            TaskValidationError: Если данные невалидны
        """
        errors = cls.validate(data)
        if errors:
            error_message = "\n".join(errors)
            raise TaskValidationError(f"Ошибки валидации комплекса:\n{error_message}")
