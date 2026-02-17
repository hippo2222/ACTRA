"""
Парсер для импорта заданий типа "Клик - Текстовый выбор" (Click Text)
"""

import re
from typing import List, Dict, Any, Optional
from ..task_import_parser import TaskImportParser


class ClickTextParser(TaskImportParser):
    """Парсер для заданий типа Click Text (текстовый выбор)"""
    
    def __init__(self):
        super().__init__()
        self.marker = '@CLICK_TEXT'
        self.answer_pattern = re.compile(r'^([+-])\s*(.+)$')
    
    def parse_text(self, text: str) -> List[Dict[str, Any]]:
        """
        Парсит текст с заданиями Click Text
        
        Формат:
        @CLICK_TEXT
        # Вопрос - что нужно выбрать
        + Правильный вариант
        - Неправильный вариант
        - Неправильный вариант
        
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
        Парсит одно задание Click Text
        
        Args:
            content: Содержимое блока задания
            index: Индекс задания
            
        Returns:
            Словарь с данными задания или None при ошибке
        """
        lines = content.strip().split('\n')
        metadata = self.parse_metadata(lines)
        prompt = None
        options = []
        
        for line_num, line in enumerate(lines):
            line_stripped = line.strip()
            
            # Пропускаем пустые строки и комментарии
            if not line_stripped or line_stripped.startswith('//'):
                continue
            
            # Ищем строку с вопросом (начинается с #)
            if line_stripped.startswith('#'):
                if prompt is None:  # Берем только первый промпт
                    prompt = line_stripped[1:].strip()
                continue
            
            # Парсим вариант ответа
            answer_match = self.answer_pattern.match(line_stripped)
            if answer_match:
                is_correct = answer_match.group(1) == '+'
                option_text = answer_match.group(2).strip()
                
                options.append({
                    'text': option_text,
                    'is_correct': is_correct,
                    # Backward compatibility for older tests/consumers.
                    'correct': is_correct,
                })
                continue
        
        # Валидация обязательных полей
        if not prompt:
            self.errors.append(f"Задание #{index + 1}: не найден текст вопроса (должен начинаться с #)")
            return None
        
        if not options:
            self.errors.append(f"Задание #{index + 1}: не найдено ни одного варианта ответа")
            return None
        
        # Очищаем текст
        prompt = self.sanitize_text(prompt)
        
        # Создаем задание в формате Click с подтипом error_detection
        task = {
            'type': 'click',
            'name': self.generate_task_name('click', index, prompt),
            'prompt': prompt,
            'data': {
                'prompt': prompt,
                'subtype': 'error_detection',
                'mode': 'text_choice',
                'options': options,
                **(({'metadata': metadata} if metadata else {}))
            }
        }
        
        return task
    
    def _validate_single_task(self, task: Dict[str, Any], index: int) -> List[str]:
        """
        Валидирует одно задание Click Text
        
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
        options = data.get('options', [])
        
        # Проверка вариантов ответа
        if not options:
            errors.append(f"Задание #{index + 1}: нет вариантов ответа")
            return errors
        
        if len(options) < 2:
            errors.append(f"Задание #{index + 1}: минимум 2 варианта ответа")
            return errors
        
        if len(options) > 10:
            self.warnings.append({
                'index': index,
                'severity': 'warning',
                'code': 'too_many_options',
                'message': 'Слишком много вариантов (рекомендуется не более 10)',
                'line': None
            })
        
        # Проверка наличия правильных ответов
        correct_count = sum(1 for opt in options if opt.get('is_correct', opt.get('correct', False)))
        
        if correct_count == 0:
            errors.append(f"Задание #{index + 1}: нет правильного ответа")
        
        if correct_count == len(options):
            errors.append(f"Задание #{index + 1}: все ответы помечены как правильные")
        
        if correct_count == 1:
            self.warnings.append({
                'index': index,
                'severity': 'warning',
                'code': 'single_correct_answer',
                'message': 'Только один правильный ответ (рекомендуется несколько для лучшей оценки)',
                'line': None
            })
        
        return errors
