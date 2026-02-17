"""
Парсер для импорта заданий типа "Клик - Поиск ошибок в словах" (Click Words)
"""

import re
from typing import List, Dict, Any, Optional
from ..task_import_parser import TaskImportParser


class ClickWordsParser(TaskImportParser):
    """Парсер для заданий типа Click Words (поиск ошибок в словах)"""
    
    def __init__(self):
        super().__init__()
        self.marker = '@CLICK_WORDS'
        self.indices_pattern = re.compile(r'индексы?:\s*(.+)', re.IGNORECASE)
    
    def parse_text(self, text: str) -> List[Dict[str, Any]]:
        """
        Парсит текст с заданиями Click Words
        
        Формат:
        @CLICK_WORDS
        # Найдите ошибки в тексте (индексы: 3, 7, 12)
        Текст с ошибками где каждое слово считается отдельно
        
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
        Парсит одно задание Click Words
        
        Args:
            content: Содержимое блока задания
            index: Индекс задания
            
        Returns:
            Словарь с данными задания или None при ошибке
        """
        lines = content.strip().split('\n')
        metadata = self.parse_metadata(lines)
        prompt = None
        error_indices = []
        text_content = None
        
        for line_num, line in enumerate(lines):
            line_stripped = line.strip()
            
            # Пропускаем пустые строки и комментарии
            if not line_stripped or line_stripped.startswith('//'):
                continue
            
            # Ищем строку с инструкцией (начинается с #)
            if line_stripped.startswith('#'):
                if prompt is None:  # Берем только первый промпт
                    prompt = line_stripped[1:].strip()
                    
                    # Извлекаем индексы из промпта
                    indices_match = self.indices_pattern.search(prompt)
                    if indices_match:
                        indices_str = indices_match.group(1)
                        # Парсим индексы (могут быть через запятую)
                        try:
                            error_indices = [
                                int(idx.strip()) 
                                for idx in indices_str.replace(',', ' ').split()
                                if idx.strip().isdigit()
                            ]
                        except ValueError:
                            self.errors.append(
                                f"Задание #{index + 1}: не удалось распарсить индексы ошибок"
                            )
                continue
            
            # Если это не промпт и не пустая строка, считаем это текстом задания
            if text_content is None:
                text_content = line_stripped
            else:
                text_content += ' ' + line_stripped
        
        # Валидация обязательных полей
        if not prompt:
            self.errors.append(f"Задание #{index + 1}: не найдена инструкция (должна начинаться с #)")
            return None
        
        if not text_content:
            self.errors.append(f"Задание #{index + 1}: не найден текст с ошибками")
            return None
        
        # Поддержка inline-маркировки [слово] как альтернативы числовым индексам
        if not error_indices and '[' in text_content:
            import re as _re
            bracket_pattern = _re.compile(r'\[([^\]]+)\]')
            # Разбиваем текст на слова, сохраняя скобки для позиционирования
            clean_words = []
            raw_words = text_content.split()
            for word_idx, word in enumerate(raw_words):
                if bracket_pattern.search(word):
                    error_indices.append(len(clean_words))
                    cleaned = bracket_pattern.sub(r'\1', word)
                    clean_words.append(cleaned)
                else:
                    clean_words.append(word)
            text_content = ' '.join(clean_words)

        if not error_indices:
            self.errors.append(f"Задание #{index + 1}: не указаны индексы ошибок (используйте 'индексы: 1, 3' в промпте или [слово] в тексте)")
            return None
        
        # Очищаем текст
        prompt = self.sanitize_text(prompt)
        text_content = self.sanitize_text(text_content)
        
        # Создаем задание в формате Click с подтипом error_detection
        task = {
            'type': 'click',
            'name': self.generate_task_name('click', index, prompt),
            'prompt': prompt,
            'data': {
                'prompt': prompt,
                'subtype': 'error_detection',
                'mode': 'word_errors',
                'text': text_content,
                'error_indices': error_indices,
                **(({'metadata': metadata} if metadata else {}))
            }
        }
        
        return task
    
    def _validate_single_task(self, task: Dict[str, Any], index: int) -> List[str]:
        """
        Валидирует одно задание Click Words
        
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
        text_content = data.get('text', '')
        error_indices = data.get('error_indices', [])
        
        # Проверка текста
        if not text_content:
            errors.append(f"Задание #{index + 1}: пустой текст")
            return errors
        
        if len(text_content) < 20:
            self.warnings.append({
                'index': index,
                'severity': 'warning',
                'code': 'text_too_short',
                'message': 'Текст очень короткий (рекомендуется минимум 80 символов)',
                'line': None
            })
        
        # Разбиваем текст на слова
        words = text_content.split()
        word_count = len(words)
        
        # Проверка индексов
        if not error_indices:
            errors.append(f"Задание #{index + 1}: не указаны индексы ошибок")
            return errors
        
        if len(error_indices) < 2:
            self.warnings.append({
                'index': index,
                'severity': 'warning',
                'code': 'too_few_errors',
                'message': 'Рекомендуется минимум 2-3 ошибки',
                'line': None
            })
        
        if len(error_indices) > 5:
            self.warnings.append({
                'index': index,
                'severity': 'warning',
                'code': 'too_many_errors',
                'message': 'Слишком много ошибок (рекомендуется не более 5)',
                'line': None
            })
        
        # Проверка, что индексы не выходят за границы текста
        for idx in error_indices:
            if idx < 0 or idx >= word_count:
                errors.append(
                    f"Задание #{index + 1}: индекс {idx} выходит за границы текста "
                    f"(всего слов: {word_count})"
                )
        
        # Проверка на дубликаты индексов
        if len(error_indices) != len(set(error_indices)):
            self.warnings.append({
                'index': index,
                'severity': 'warning',
                'code': 'duplicate_index',
                'message': 'Обнаружены дублирующиеся индексы ошибок',
                'line': None
            })
        
        return errors
