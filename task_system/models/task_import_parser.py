"""
Базовый класс для парсера импорта заданий из текстовых файлов
"""

import re
from typing import List, Dict, Any, Optional
from abc import ABC, abstractmethod


class TaskImportParser(ABC):
    """Базовый класс для импорта заданий из текстового формата"""
    
    def __init__(self):
        """Инициализация парсера"""
        self.errors = []
        self.warnings = []
    
    def reset(self):
        """Сбрасывает ошибки и предупреждения перед новым парсингом"""
        self.errors = []
        self.warnings = []

    def parse_file(self, file_path: str) -> List[Dict[str, Any]]:
        """
        Парсит файл с заданиями
        
        Args:
            file_path: Путь к файлу
            
        Returns:
            Список распарсенных заданий
        """
        self.reset()
        # Список кодировок для попытки открытия файла
        encodings = ['utf-8', 'cp1251', 'windows-1251', 'utf-16', 'latin-1']
        
        for encoding in encodings:
            try:
                with open(file_path, 'r', encoding=encoding) as f:
                    text = f.read()
                return self.parse_text(text)
            except UnicodeDecodeError:
                continue
            except FileNotFoundError:
                raise ValueError(f"Файл не найден: {file_path}")
            except Exception as e:
                raise ValueError(f"Ошибка при чтении файла: {e}")
        
        raise ValueError(f"Не удалось определить кодировку файла: {file_path}")
    
    @abstractmethod
    def parse_text(self, text: str) -> List[Dict[str, Any]]:
        """
        Парсит текст с заданиями
        
        Args:
            text: Текст для парсинга
            
        Returns:
            Список распарсенных заданий
        """
        pass
    
    def validate_tasks(self, tasks: List[Dict[str, Any]]) -> List[str]:
        """
        Валидирует список заданий
        
        Args:
            tasks: Список заданий для валидации
            
        Returns:
            Список ошибок валидации (пустой список если ошибок нет)
        """
        errors = []
        
        if not tasks:
            errors.append("Список заданий пуст")
            return errors
        
        for i, task in enumerate(tasks):
            task_errors = self._validate_single_task(task, i)
            errors.extend(task_errors)
        
        return errors
    
    @abstractmethod
    def _validate_single_task(self, task: Dict[str, Any], index: int) -> List[str]:
        """
        Валидирует одно задание
        
        Args:
            task: Задание для валидации
            index: Индекс задания в списке
            
        Returns:
            Список ошибок валидации
        """
        pass
    
    @staticmethod
    def parse_metadata(lines: list) -> dict:
        """
        Извлекает метаданные из строк формата '@ ключ: значение'.
        
        Поддерживаемые ключи: difficulty, tags, max_length, time_limit, case_sensitive.
        Строки метаданных удаляются из списка lines in-place.
        
        Returns:
            Словарь с метаданными
        """
        metadata = {}
        remaining = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith('@ ') and ':' in stripped:
                key_val = stripped[2:].split(':', 1)
                key = key_val[0].strip().lower()
                val = key_val[1].strip()
                if key == 'difficulty':
                    try:
                        metadata['difficulty'] = int(val)
                    except ValueError:
                        pass
                elif key == 'tags':
                    metadata['tags'] = [t.strip() for t in val.split(',') if t.strip()]
                elif key in ('max_length', 'time_limit'):
                    try:
                        metadata[key] = int(val)
                    except ValueError:
                        pass
                elif key == 'case_sensitive':
                    metadata['case_sensitive'] = val.lower() in ('true', '1', 'yes', 'да')
                else:
                    metadata[key] = val
            else:
                remaining.append(line)
        lines[:] = remaining
        return metadata

    def generate_task_name(self, task_type: str, index: int, prompt: str = "") -> str:
        """
        Генерирует название задания
        
        Args:
            task_type: Тип задания
            index: Порядковый номер задания
            prompt: Промпт задания (для укороченного названия)
            
        Returns:
            Сгенерированное название
        """
        type_names = {
            'open_answer': 'Открытый ответ',
            'sequence_assembly': 'Последовательность',
            'click': 'Клик'
        }
        
        base_name = type_names.get(task_type, 'Задание')
        
        # Если промпт короткий, добавляем его в название
        if prompt and len(prompt) <= 40:
            return f"{base_name} - {prompt}"
        elif prompt:
            # Если промпт длинный, берем первые 40 символов
            return f"{base_name} - {prompt[:37]}..."
        else:
            # Если промпта нет, используем номер
            return f"{base_name} #{index + 1}"
    
    def split_by_task_markers(self, text: str, markers: List[str]) -> List[tuple]:
        """
        Разбивает текст на блоки по маркерам типов заданий
        
        Args:
            text: Исходный текст
            markers: Список маркеров (например, ['@OPEN_ANSWER', '@SEQUENCE'])
            
        Returns:
            Список кортежей (marker, content)
        """
        blocks = []
        lines = text.strip().split('\n')
        current_marker = None
        current_lines = []
        
        for line_num, line in enumerate(lines):
            line_stripped = line.strip()
            
            # Проверяем, является ли строка маркером
            is_marker = False
            for marker in markers:
                if line_stripped.startswith(marker):
                    # Сохраняем предыдущий блок
                    if current_marker is not None and current_lines:
                        blocks.append((current_marker, '\n'.join(current_lines)))
                    
                    # Начинаем новый блок
                    current_marker = marker
                    current_lines = []
                    is_marker = True
                    break
            
            if not is_marker and current_marker is not None:
                # Добавляем строку к текущему блоку
                current_lines.append(line)
        
        # Добавляем последний блок
        if current_marker is not None and current_lines:
            blocks.append((current_marker, '\n'.join(current_lines)))
        
        return blocks
    
    def sanitize_text(self, text: str) -> str:
        """
        Очищает текст от потенциально опасных символов
        
        Args:
            text: Исходный текст
            
        Returns:
            Очищенный текст
        """
        # Удаляем HTML теги (только настоящие теги вида <tag>, </tag>, <tag attr="...">)
        text = re.sub(r'</?[a-zA-Z][^>]*>', '', text)
        
        # Базовое экранирование (для безопасности)
        # Не используем html.escape, так как нам нужен обычный текст
        return text.strip()
