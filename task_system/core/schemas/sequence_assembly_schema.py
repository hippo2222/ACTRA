"""
Схема валидации для заданий типа "Сборка схем"
"""

from typing import Dict, List, Any
from .base_schema import BaseTaskSchema, ValidationError


class SequenceAssemblyTaskSchema(BaseTaskSchema):
    """
    Схема валидации для заданий на сборку схем.
    Проверяет структуру данных для типа задания sequence_assembly.
    """
    
    @classmethod
    def _validate_content(cls, content: Dict[str, Any]) -> List[str]:
        """
        Валидирует содержимое задания на сборку схем.
        
        Args:
            content: Содержимое задания
            
        Returns:
            Список ошибок валидации
        """
        errors = []
        
        # Проверяем обязательное поле elements
        if 'elements' not in content:
            errors.append("content.elements: поле обязательно")
        
        # Проверяем наличие levels или correct_sequence (хотя бы одно)
        has_levels = 'levels' in content
        has_sequence = 'correct_sequence' in content
        
        if not has_levels and not has_sequence:
            errors.append("content: должно содержать либо 'levels', либо 'correct_sequence'")
        
        # Валидируем elements
        if 'elements' in content:
            elements_errors = cls._validate_elements(content['elements'])
            errors.extend(elements_errors)
        
        # Валидируем levels (новая структура)
        if has_levels:
            levels_errors = cls._validate_levels(content['levels'], content.get('elements', []))
            errors.extend(levels_errors)
        
        # Валидируем correct_sequence (старая структура, для обратной совместимости)
        if has_sequence:
            sequence_errors = cls._validate_correct_sequence(content['correct_sequence'])
            errors.extend(sequence_errors)
            
            # Проверяем соответствие между elements и correct_sequence
            if 'elements' in content:
                consistency_errors = cls._validate_consistency(content['elements'], content['correct_sequence'])
                errors.extend(consistency_errors)
        
        # Валидируем prompt (опционально)
        if 'prompt' in content:
            prompt_errors = cls._validate_prompt(content['prompt'])
            errors.extend(prompt_errors)
        
        # Валидируем level_order_matters (опционально)
        if 'level_order_matters' in content:
            level_order_errors = cls._validate_level_order_matters(content['level_order_matters'])
            errors.extend(level_order_errors)
        
        # Валидируем sequence_within_level_matters (опционально)
        if 'sequence_within_level_matters' in content:
            seq_matters_errors = cls._validate_sequence_within_level_matters(content['sequence_within_level_matters'])
            errors.extend(seq_matters_errors)
        
        return errors
    
    @classmethod
    def _validate_elements(cls, elements: Any) -> List[str]:
        """
        Валидирует массив элементов.
        
        Args:
            elements: Массив элементов
            
        Returns:
            Список ошибок
        """
        errors = []
        
        if not isinstance(elements, list):
            errors.append("content.elements: должно быть массивом")
            return errors
        
        if len(elements) == 0:
            errors.append("content.elements: массив не может быть пустым")
            return errors
        
        if len(elements) < 2:
            errors.append("content.elements: должно быть минимум 2 элемента")
        
        # Проверяем каждый элемент
        element_ids = set()
        for i, element in enumerate(elements):
            element_errors = cls._validate_single_element(element, i)
            errors.extend(element_errors)
            
            # Проверяем уникальность ID
            if isinstance(element, dict) and 'id' in element:
                element_id = element['id']
                if element_id in element_ids:
                    errors.append(f"content.elements[{i}].id: ID '{element_id}' дублируется")
                else:
                    element_ids.add(element_id)
        
        return errors
    
    @classmethod
    def _validate_single_element(cls, element: Any, index: int) -> List[str]:
        """
        Валидирует отдельный элемент.
        
        Args:
            element: Элемент для валидации
            index: Индекс элемента в массиве
            
        Returns:
            Список ошибок
        """
        errors = []
        
        if not isinstance(element, dict):
            errors.append(f"content.elements[{index}]: должен быть объектом")
            return errors
        
        # Проверяем обязательные поля элемента
        required_element_fields = ['id', 'text']
        for field in required_element_fields:
            if field not in element:
                errors.append(f"content.elements[{index}].{field}: поле обязательно")
        
        # Валидируем ID
        if 'id' in element:
            element_id = element['id']
            if not isinstance(element_id, str):
                errors.append(f"content.elements[{index}].id: должно быть строкой")
            elif not element_id.strip():
                errors.append(f"content.elements[{index}].id: не может быть пустым")
        
        # Валидируем text
        if 'text' in element:
            text = element['text']
            if not isinstance(text, str):
                errors.append(f"content.elements[{index}].text: должно быть строкой")
            elif not text.strip():
                errors.append(f"content.elements[{index}].text: не может быть пустым")
        
        # Валидируем image (опционально)
        if 'image' in element:
            image = element['image']
            if image is not None and not isinstance(image, str):
                errors.append(f"content.elements[{index}].image: должно быть строкой или null")
        
        return errors
    
    @classmethod
    def _validate_correct_sequence(cls, sequence: Any) -> List[str]:
        """
        Валидирует правильную последовательность.
        
        Args:
            sequence: Последовательность ID элементов
            
        Returns:
            Список ошибок
        """
        errors = []
        
        if not isinstance(sequence, list):
            errors.append("content.correct_sequence: должно быть массивом")
            return errors
        
        if len(sequence) == 0:
            errors.append("content.correct_sequence: массив не может быть пустым")
            return errors
        
        # Проверяем каждый ID в последовательности
        for i, element_id in enumerate(sequence):
            if not isinstance(element_id, str):
                errors.append(f"content.correct_sequence[{i}]: должно быть строкой")
            elif not element_id.strip():
                errors.append(f"content.correct_sequence[{i}]: не может быть пустым")
        
        return errors
    
    @classmethod
    def _validate_consistency(cls, elements: List[Dict], sequence: List[str]) -> List[str]:
        """
        Проверяет соответствие между элементами и последовательностью.
        
        Args:
            elements: Массив элементов
            sequence: Правильная последовательность
            
        Returns:
            Список ошибок
        """
        errors = []
        
        # Получаем ID всех элементов
        element_ids = set()
        for element in elements:
            if isinstance(element, dict) and 'id' in element:
                element_ids.add(element['id'])
        
        # Проверяем, что все ID в последовательности существуют в элементах
        for i, element_id in enumerate(sequence):
            if element_id not in element_ids:
                errors.append(f"content.correct_sequence[{i}]: ID '{element_id}' не найден в elements")
        
        # Проверяем, что все элементы присутствуют в последовательности
        sequence_ids = set(sequence)
        for element in elements:
            if isinstance(element, dict) and 'id' in element:
                element_id = element['id']
                if element_id not in sequence_ids:
                    errors.append(f"content.elements: элемент с ID '{element_id}' отсутствует в correct_sequence")
        
        # Проверяем, что количество элементов совпадает
        if len(elements) != len(sequence):
            errors.append("content: количество элементов должно совпадать с длиной correct_sequence")
        
        return errors
    
    @classmethod
    def _validate_prompt(cls, prompt: Any) -> List[str]:
        """
        Валидирует текст задания.
        
        Args:
            prompt: Текст задания
            
        Returns:
            Список ошибок
        """
        errors = []
        
        if prompt is not None and not isinstance(prompt, str):
            errors.append("content.prompt: должно быть строкой или null")
        
        return errors
    
    @classmethod
    def _validate_levels(cls, levels: Any, elements: List[Dict]) -> List[str]:
        """
        Валидирует массив уровней.
        
        Args:
            levels: Массив уровней
            elements: Массив элементов для проверки консистентности
            
        Returns:
            Список ошибок
        """
        errors = []
        
        if not isinstance(levels, list):
            errors.append("content.levels: должно быть массивом")
            return errors
        
        if len(levels) == 0:
            errors.append("content.levels: массив не может быть пустым")
            return errors
        
        # Получаем ID всех элементов
        element_ids = {elem['id'] for elem in elements if isinstance(elem, dict) and 'id' in elem}
        
        # Проверяем каждый уровень
        for i, level in enumerate(levels):
            if not isinstance(level, dict):
                errors.append(f"content.levels[{i}]: должен быть объектом")
                continue
            
            # Проверяем обязательные поля
            if 'level_id' not in level:
                errors.append(f"content.levels[{i}].level_id: поле обязательно")
            elif not isinstance(level['level_id'], str) or not level['level_id'].strip():
                errors.append(f"content.levels[{i}].level_id: должно быть непустой строкой")
            
            if 'blocks' not in level:
                errors.append(f"content.levels[{i}].blocks: поле обязательно")
            elif not isinstance(level['blocks'], list):
                errors.append(f"content.levels[{i}].blocks: должно быть массивом")
            else:
                # Проверяем, что все ID блоков существуют в elements
                seen_block_ids = set()
                for j, block_id in enumerate(level['blocks']):
                    if not isinstance(block_id, str):
                        errors.append(f"content.levels[{i}].blocks[{j}]: должно быть строкой")
                    elif block_id not in element_ids:
                        errors.append(f"content.levels[{i}].blocks[{j}]: ID '{block_id}' не найден в elements")
                    elif block_id in seen_block_ids:
                        errors.append(f"content.levels[{i}].blocks[{j}]: ID '{block_id}' дублируется в уровне")
                    else:
                        seen_block_ids.add(block_id)
            
            # Проверяем опциональное поле level_name
            if 'level_name' in level:
                level_name = level['level_name']
                if level_name is not None and not isinstance(level_name, str):
                    errors.append(f"content.levels[{i}].level_name: должно быть строкой или null")
        
        return errors
    
    @classmethod
    def _validate_level_order_matters(cls, value: Any) -> List[str]:
        """
        Валидирует настройку level_order_matters.
        
        Args:
            value: Значение настройки
            
        Returns:
            Список ошибок
        """
        errors = []
        
        if not isinstance(value, bool):
            errors.append("content.level_order_matters: должно быть булевым значением")
        
        return errors
    
    @classmethod
    def _validate_sequence_within_level_matters(cls, value: Any) -> List[str]:
        """
        Валидирует настройку sequence_within_level_matters.
        
        Args:
            value: Значение настройки
            
        Returns:
            Список ошибок
        """
        errors = []
        
        if not isinstance(value, bool):
            errors.append("content.sequence_within_level_matters: должно быть булевым значением")
        
        return errors
    
    @classmethod
    def get_example_data(cls) -> Dict[str, Any]:
        """
        Возвращает пример корректных данных для задания.
        
        Returns:
            Словарь с примером данных
        """
        return {
            "type": "sequence_assembly",
            "meta": {
                "name": "Пример задания на сборку схем",
                "description": "Распределите домашние задания по предметам"
            },
            "content": {
                "prompt": "Распределите домашние задания по соответствующим предметам",
                "elements": [
                    {
                        "id": "task_1",
                        "text": "Написать сочинение"
                    },
                    {
                        "id": "task_2",
                        "text": "Начертить прямоугольник"
                    },
                    {
                        "id": "task_3",
                        "text": "Провести опыт с натрием"
                    }
                ],
                "levels": [
                    {
                        "level_id": "level_1",
                        "level_name": "Русский язык",
                        "blocks": ["task_1"]
                    },
                    {
                        "level_id": "level_2",
                        "level_name": "Математика",
                        "blocks": ["task_2"]
                    },
                    {
                        "level_id": "level_3",
                        "level_name": "Химия",
                        "blocks": ["task_3"]
                    }
                ],
                "sequence_within_level_matters": false,
                "level_order_matters": false
            },
            "settings": {
                "shuffle_elements": true,
                "level_order_matters": false,
                "sequence_within_level_matters": false
            }
        }

