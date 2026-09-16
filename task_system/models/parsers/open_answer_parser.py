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
            ~ Дополнительная информация / примечание к вопросу (опционально)
        
        Мульти-вопросный формат:
            @case_text: Описание случая
            @display_mode: simultaneous | sequential
            ? Вопрос 1 [levels: 1, 2, 3]
            = Эталон 1
            * ключ1
            ~ Дополнительная информация к вопросу 1 (опционально)
            ? Вопрос 2 [levels: 2, 3]
            = Эталон 2
            * ключ2
            ~ Дополнительная информация к вопросу 2 (опционально)

        Args:
            content: Содержимое блока задания
            index: Индекс задания
            
        Returns:
            Словарь с данными задания или None при ошибке
        """
        lines = content.strip().split('\n')
        
        # Извлекаем метаданные (@ key: value или @key: value)
        extra_meta = {}
        for line in lines:
            stripped = line.strip()
            if stripped.startswith('@') and ':' in stripped and not stripped.startswith('@OPEN_ANSWER'):
                after_at = stripped[1:].strip()
                parts = after_at.split(':', 1)
                extra_meta[parts[0].strip().lower()] = parts[1].strip()
        metadata = {**self.parse_metadata(lines), **extra_meta}

        # Check if multi-question format is used (contains lines starting with '?')
        has_multi_questions = any(line.strip().startswith('?') for line in lines)
        if has_multi_questions:
            display_mode = metadata.get('display_mode') or 'simultaneous'
            if display_mode not in ('simultaneous', 'sequential'):
                display_mode = 'simultaneous'
            case_text = metadata.get('case_text') or metadata.get('case') or ''

            questions = []
            current_q = None
            header_prompt = None
            q_regex = re.compile(r'^\?\s*(.*?)(?:\s*\[levels?:\s*([0-9,\s]+)\])?$', re.IGNORECASE)

            for line in lines:
                line_stripped = line.strip()
                if not line_stripped or line_stripped.startswith('//') or line_stripped.startswith('@'):
                    continue

                if line_stripped.startswith('#') and not current_q and not header_prompt:
                    header_prompt = line_stripped[1:].strip()
                    if not case_text:
                        case_text = header_prompt
                    continue

                m = q_regex.match(line_stripped)
                if m:
                    if current_q:
                        questions.append(current_q)
                    q_text = m.group(1).strip()
                    levels_raw = m.group(2)
                    levels = [1, 2, 3]
                    if levels_raw:
                        parsed_levels = []
                        for part in levels_raw.split(','):
                            try:
                                ilvl = int(part.strip())
                                if 1 <= ilvl <= 3:
                                    parsed_levels.append(ilvl)
                            except (ValueError, TypeError):
                                pass
                        if parsed_levels:
                            levels = sorted(list(set(parsed_levels)))
                    current_q = {
                        'id': f"q_{len(questions) + 1}",
                        'question': self.sanitize_text(q_text),
                        'reference_answer': '',
                        'hint': '',
                        'keywords': [],
                        'levels': levels,
                    }
                    continue

                if current_q:
                    if line_stripped.startswith('='):
                        current_q['reference_answer'] = self.sanitize_text(line_stripped[1:].strip())
                    elif line_stripped.startswith('*'):
                        kw = self.sanitize_text(line_stripped[1:].strip())
                        if kw:
                            current_q['keywords'].append(kw)
                    elif line_stripped.startswith('~'):
                        hint_val = self.sanitize_text(line_stripped[1:].strip())
                        if hint_val:
                            current_q['hint'] = hint_val

            if current_q:
                questions.append(current_q)

            if not questions:
                self.errors.append(f"Задание #{index + 1}: не найдены вопросы (должны начинаться с ?)")
                return None

            first_q = questions[0]
            prompt = header_prompt or first_q['question']
            first_hint = first_q.get('hint', '')
            data = {
                'case_text': self.sanitize_text(case_text) if case_text else '',
                'display_mode': display_mode,
                'questions': questions,
                'question': first_q['question'],
                'reference_answer': first_q['reference_answer'],
                'keywords': list(first_q['keywords']),
            }
            if first_hint:
                data['hint'] = first_hint
            if metadata:
                data['metadata'] = metadata

            task = {
                'type': 'open_answer',
                'name': self.generate_task_name('open_answer', index, prompt),
                'prompt': prompt,
                'data': data,
            }
            return task

        prompt = None
        reference_answer = None
        hint = None
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

            # Дополнительная информация / подсказка (начинается с ~)
            if line_stripped.startswith('~') and hint is None:
                hint = line_stripped[1:].strip()
                continue
        
        if not prompt:
            self.errors.append(f"Задание #{index + 1}: не найден текст вопроса (должен начинаться с #)")
            return None

        if not hint and metadata:
            raw_hint = metadata.get('info') or metadata.get('hint')
            if raw_hint:
                hint = str(raw_hint).strip()
        
        # Очищаем текст от потенциально опасных символов
        prompt = self.sanitize_text(prompt)
        if reference_answer:
            reference_answer = self.sanitize_text(reference_answer)
        if hint:
            hint = self.sanitize_text(hint)
        keywords = [self.sanitize_text(kw) for kw in keywords]
        
        # Создаем задание
        data = {'question': prompt}
        if keywords:
            data['keywords'] = keywords
        if reference_answer:
            data['reference_answer'] = reference_answer
        if hint:
            data['hint'] = hint
        if metadata:
            raw_min_keywords = metadata.get('min_keywords')
            try:
                if raw_min_keywords is not None:
                    min_kw = int(raw_min_keywords)
                    if min_kw >= 1:
                        data['min_keywords'] = min_kw
            except (TypeError, ValueError):
                pass
            raw_require_all = metadata.get('require_all_keywords')
            if isinstance(raw_require_all, str):
                lowered = raw_require_all.strip().lower()
                if lowered in ('true', '1', 'yes', 'да'):
                    data['require_all_keywords'] = True
                elif lowered in ('false', '0', 'no', 'нет'):
                    data['require_all_keywords'] = False
            elif isinstance(raw_require_all, bool):
                data['require_all_keywords'] = raw_require_all
        
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
