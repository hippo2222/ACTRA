"""
Парсер для импорта заданий типа "Последовательность" (Sequence Assembly)
"""

import re
from typing import List, Dict, Any, Optional, Set
from ..task_import_parser import TaskImportParser


class SequenceParser(TaskImportParser):
    """Парсер для заданий типа Sequence Assembly"""
    
    def __init__(self):
        super().__init__()
        self.marker = '@SEQUENCE'
        self.element_pattern = re.compile(r'^element_(\d+):\s*(.+)$')
        self.level_pattern = re.compile(r'^level_(\d+):\s*(.+)$')
    
    def parse_text(self, text: str) -> List[Dict[str, Any]]:
        """
        Парсит текст с заданиями Sequence
        
        Формат:
        @SEQUENCE
        # Описание задачи
        element_1: Название элемента 1
        element_2: Название элемента 2
        level_1: element_1, element_2
        level_2: element_3
        
        Args:
            text: Текст для парсинга
            
        Returns:
            Список заданий в формате словарей
        """
        self.reset()
        tasks = []
        blocks = self.split_by_task_markers(text, [self.marker])
        
        for marker, content in blocks:
            if marker != self.marker:
                continue
            
            task = self._parse_single_task(content, len(tasks))
            if task:
                tasks.append(task)
        
        return tasks
    
    def _parse_single_task(self, content: str, index: int) -> Optional[Dict[str, Any]]:
        """
        Парсит одно задание Sequence
        
        Args:
            content: Содержимое блока задания
            index: Индекс задания
            
        Returns:
            Словарь с данными задания или None при ошибке
        """
        lines = content.strip().split('\n')
        metadata = self.parse_metadata(lines)
        prompt = None
        elements = {}
        levels = {}
        
        for line_num, line in enumerate(lines):
            line_stripped = line.strip()
            
            # Пропускаем пустые строки и комментарии
            if not line_stripped or line_stripped.startswith('//'):
                continue
            
            # Ищем строку с описанием задачи (начинается с #)
            if line_stripped.startswith('#'):
                if prompt is None:  # Берем только первый промпт
                    prompt = line_stripped[1:].strip()
                continue
            
            # Парсим элемент
            element_match = self.element_pattern.match(line_stripped)
            if element_match:
                element_id = f"element_{element_match.group(1)}"
                element_text = element_match.group(2).strip()
                
                if element_id in elements:
                    self.warnings.append({
                        'index': index,
                        'severity': 'warning',
                        'code': 'duplicate_element_id',
                        'message': f'Дублирующийся ID элемента: {element_id}',
                        'line': line_num
                    })
                
                elements[element_id] = element_text
                continue
            
            # Парсим уровень
            level_match = self.level_pattern.match(line_stripped)
            if level_match:
                level_num = int(level_match.group(1))
                level_elements = [e.strip() for e in level_match.group(2).split(',')]
                levels[level_num] = level_elements
                continue
        
        # Валидация обязательных полей
        if not prompt:
            self.errors.append(f"Задание #{index + 1}: не найдено описание задачи (должно начинаться с #)")
            return None
        
        if not elements:
            self.errors.append(f"Задание #{index + 1}: не найдено ни одного элемента (element_X)")
            return None
        
        if not levels:
            self.errors.append(f"Задание #{index + 1}: не найдено ни одного уровня (level_X)")
            return None
        
        # Очищаем текст
        prompt = self.sanitize_text(prompt)
        
        # Создаем задание
        task = {
            'type': 'sequence_assembly',
            'name': self.generate_task_name('sequence_assembly', index, prompt),
            'prompt': prompt,
            'data': {
                'prompt': prompt,
                'elements': elements,
                'levels': levels,
                **(({'metadata': metadata} if metadata else {}))
            }
        }
        
        return task
    
    def _validate_single_task(self, task: Dict[str, Any], index: int) -> List[str]:
        """
        Валидирует одно задание Sequence
        
        Args:
            task: Задание для валидации
            index: Индекс задания
            
        Returns:
            Список ошибок
        """
        errors = []
        
        if 'data' not in task:
            errors.append(f"Задание #{index + 1}: отсутствуют данные")
            return errors
        
        data = task['data']
        elements = data.get('elements', {})
        levels = data.get('levels', {})
        
        # Проверка элементов
        if not elements:
            errors.append(f"Задание #{index + 1}: нет элементов")
            return errors
        
        if len(elements) < 3:
            self.warnings.append({
                'index': index,
                'severity': 'warning',
                'code': 'too_few_elements',
                'message': 'Рекомендуется минимум 3 элемента',
                'line': None
            })
        
        # Проверка уровней
        if not levels:
            errors.append(f"Задание #{index + 1}: нет уровней")
            return errors
        
        if len(levels) > 5:
            self.warnings.append({
                'index': index,
                'severity': 'warning',
                'code': 'too_many_levels',
                'message': 'Слишком много уровней (более 5)',
                'line': None
            })
        
        # Проверка ссылок на элементы
        used_elements: Set[str] = set()
        
        for level_num, level_elements in levels.items():
            if not level_elements:
                errors.append(f"Задание #{index + 1}: пустой уровень level_{level_num}")
                continue
            
            for element_id in level_elements:
                if element_id not in elements:
                    errors.append(
                        f"Задание #{index + 1}: элемент '{element_id}' указан в level_{level_num}, "
                        f"но не определен в списке элементов"
                    )
                else:
                    used_elements.add(element_id)
        
        # Проверка неиспользуемых элементов
        unused_elements = set(elements.keys()) - used_elements
        if unused_elements:
            self.warnings.append({
                'index': index,
                'severity': 'warning',
                'code': 'unused_element',
                'message': f'Элементы определены, но не используются в уровнях: {", ".join(unused_elements)}',
                'line': None
            })
        
        return errors
