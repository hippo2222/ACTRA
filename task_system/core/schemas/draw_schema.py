# task_system/schemas/draw_schema.py
"""
Схема валидации для заданий типа "draw".
"""

from typing import Dict, List, Any
from .base_schema import BaseTaskSchema


class DrawTaskSchema(BaseTaskSchema):
    """Схема для валидации заданий типа \"рисование контура\"."""
    
    @classmethod
    def _validate_content(cls, content: Dict[str, Any]) -> List[str]:
        """
        Валидирует содержимое задания типа draw.
        
        Требования:
        - Должно быть поле image (путь к изображению)
        - Должно быть поле prompt (текст задания)
        - Должны быть annotations ИЛИ regions с хотя бы одним полигоном
        - Полигон должен содержать минимум 3 точки
        
        Поддерживает два формата:
        - annotations (legacy Click Editor format)
        - regions (Draw Editor format)
        """
        errors = []
        
        # Проверяем обязательные поля
        if 'image' not in content or not content['image']:
            errors.append("content.image: обязательное поле отсутствует или пусто")
        
        if 'prompt' not in content or not content['prompt']:
            errors.append("content.prompt: обязательное поле отсутствует или пусто")
        
        # Проверяем аннотации/регионы (принимаем оба формата)
        annotations = content.get('annotations')
        regions = content.get('regions')
        
        # Определяем какой источник использовать
        source_list = None
        source_name = None
        
        if isinstance(annotations, list) and annotations:
            source_list = annotations
            source_name = 'annotations'
        elif isinstance(regions, list) and regions:
            source_list = regions
            source_name = 'regions'
        
        if source_list is None:
            errors.append("content.annotations или content.regions: должен присутствовать хотя бы один список с полигонами")
        else:
            # Проверяем каждую аннотацию/регион
            for i, ann in enumerate(source_list):
                if not isinstance(ann, dict):
                    errors.append(f"content.{source_name}[{i}]: должен быть словарем")
                    continue
                
                # Для regions формата не требуем type='polygon' (подразумевается)
                if source_name == 'annotations' and ann.get('type') != 'polygon':
                    errors.append(f"content.{source_name}[{i}]: тип должен быть 'polygon'")
                
                if 'points' not in ann:
                    errors.append(f"content.{source_name}[{i}]: отсутствует поле points")
                    continue
                
                points = ann['points']
                if not isinstance(points, list):
                    errors.append(f"content.{source_name}[{i}].points: должен быть списком")
                elif len(points) < 3:
                    errors.append(f"content.{source_name}[{i}].points: полигон должен содержать минимум 3 точки")
                else:
                    # Проверяем каждую точку
                    for j, point in enumerate(points):
                        if not isinstance(point, (list, tuple)) or len(point) != 2:
                            errors.append(f"content.{source_name}[{i}].points[{j}]: должна быть парой координат [x, y]")
                        else:
                            x, y = point
                            if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                                errors.append(f"content.{source_name}[{i}].points[{j}]: координаты должны быть числами")
        
        return errors

