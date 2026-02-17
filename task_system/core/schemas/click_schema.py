# task_system/schemas/click_schema.py
"""
Схема валидации для заданий типа "click".
"""

from typing import Dict, List, Any
from .base_schema import BaseTaskSchema


class ClickTaskSchema(BaseTaskSchema):
    """Схема для валидации заданий типа "клик по объекту"."""
    
    @classmethod
    def _validate_content(cls, content: Dict[str, Any]) -> List[str]:
        """
        Валидирует содержимое задания типа click.
        
        Требования:
        - Должно быть поле image (путь к изображению)
        - Должно быть поле prompt (текст задания)
        - Должны быть annotations с хотя бы одной точкой
        """
        errors = []
        
        # Проверяем обязательные поля
        if 'image' not in content or not content['image']:
            errors.append("content.image: обязательное поле отсутствует или пусто")
        
        if 'prompt' not in content or not content['prompt']:
            errors.append("content.prompt: обязательное поле отсутствует или пусто")
        
        # Проверяем аннотации
        if 'annotations' not in content:
            errors.append("content.annotations: обязательное поле отсутствует")
        else:
            annotations = content['annotations']
            if not isinstance(annotations, list):
                errors.append("content.annotations: должен быть списком")
            elif len(annotations) == 0:
                errors.append("content.annotations: должен содержать хотя бы одну точку")
            else:
                # Проверяем каждую аннотацию
                for i, ann in enumerate(annotations):
                    if not isinstance(ann, dict):
                        errors.append(f"content.annotations[{i}]: должен быть словарем")
                        continue
                    
                    if ann.get('type') != 'point':
                        errors.append(f"content.annotations[{i}]: тип должен быть 'point'")
                    
                    if 'x' not in ann or not isinstance(ann['x'], (int, float)):
                        errors.append(f"content.annotations[{i}]: отсутствует или некорректна координата x")
                    
                    if 'y' not in ann or not isinstance(ann['y'], (int, float)):
                        errors.append(f"content.annotations[{i}]: отсутствует или некорректна координата y")
        
        return errors

