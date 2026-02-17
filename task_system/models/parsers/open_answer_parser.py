"""
Парсер для импорта заданий типа "Открытый ответ" (Open Answer)
"""

import re
from typing import List, Dict, Any, Optional
from ..task_import_parser import TaskImportParser


class OpenAnswerParser(TaskImportParser):
    """Парсер для заданий типа Open Answer"""
    
    def __init__(self):
        super().__init__()
        self.marker = '@OPEN_ANSWER'
    
    def parse_text(self, text: str) -> List[Dict[str, Any]]:
        """
        Парсит текст с заданиями Open Answer
        
        Формат:
        @OPEN_ANSWER
        # Текст вопроса
        
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
        Парсит одно задание Open Answer
        
        Формат:
            # Текст вопроса
            = Эталонный ответ (опционально)
            * ключевое_слово (опционально, можно несколько)
        
        Args:
            content: Содержимое блока задания
            index: Индекс задания
            
        Returns:
            Словарь с данными задания или None при ошибке
        """
        lines = content.strip().split('\n')
        
        # Извлекаем метаданные (@ key: value)
        metadata = self.parse_metadata(lines)
        
        prompt = None
        reference_answer = None
        keywords = []
        
        for line in lines:
            line_stripped = line.strip()
            
            # Пропускаем пустые строки и комментарии
            if not line_stripped or line_stripped.startswith('//'):
                continue
            
            # Ищем строку с вопросом (начинается с #)
            if line_stripped.startswith('#') and prompt is None:
                prompt = line_stripped[1:].strip()
                continue
            
            # Эталонный ответ (начинается с =)
            if line_stripped.startswith('=') and reference_answer is None:
                reference_answer = line_stripped[1:].strip()
                continue
            
            # Ключевое слово (начинается с *)
            if line_stripped.startswith('*'):
                kw = line_stripped[1:].strip()
                if kw:
                    keywords.append(kw)
                continue
        
        if not prompt:
            self.errors.append(f"Задание #{index + 1}: не найден текст вопроса (должен начинаться с #)")
            return None
        
        # Очищаем текст от потенциально опасных символов
        prompt = self.sanitize_text(prompt)
        if reference_answer:
            reference_answer = self.sanitize_text(reference_answer)
        keywords = [self.sanitize_text(kw) for kw in keywords]
        
        # Создаем задание
        data = {'question': prompt}
        if keywords:
            data['keywords'] = keywords
        if reference_answer:
            data['reference_answer'] = reference_answer
        
        if metadata:
            data['metadata'] = metadata
        
        task = {
            'type': 'open_answer',
            'name': self.generate_task_name('open_answer', index, prompt),
            'prompt': prompt,
            'data': data
        }
        
        return task
    
    def _validate_single_task(self, task: Dict[str, Any], index: int) -> List[str]:
        """
        Валидирует одно задание Open Answer
        
        Args:
            task: Задание для валидации
            index: Индекс задания
            
        Returns:
            Список ошибок
        """
        errors = []
        
        # Проверка наличия prompt
        if 'prompt' not in task or not task['prompt']:
            errors.append(f"Задание #{index + 1}: пустой текст вопроса")
            return errors
        
        prompt = task['prompt']
        
        # Проверка длины вопроса
        if len(prompt) < 10:
            self.warnings.append({
                'index': index,
                'severity': 'warning',
                'code': 'prompt_too_short',
                'message': 'Вопрос слишком короткий (меньше 10 символов)',
                'line': None
            })
        
        # Проверка на минимальную длину (критичная ошибка)
        if len(prompt) < 5:
            errors.append(f"Задание #{index + 1}: вопрос слишком короткий (минимум 5 символов)")
        
        # Проверка на максимальную длину
        if len(prompt) > 500:
            self.warnings.append({
                'index': index,
                'severity': 'warning',
                'code': 'prompt_too_long',
                'message': 'Вопрос очень длинный (более 500 символов)',
                'line': None
            })
        
        return errors
