"""
Парсер для импорта заданий типа "Последовательность" (Sequence Assembly)
"""

import re
from typing import List, Dict, Any, Optional, Set, Tuple
from ..task_import_parser import TaskImportParser


class SequenceParser(TaskImportParser):
    """Парсер для заданий типа Sequence Assembly"""

    def __init__(self):
        super().__init__()
        self.marker = '@SEQUENCE'
        self.element_pattern = re.compile(r'^element_(\d+):\s*(.+)$')
        self.level_pattern = re.compile(r'^level_(\d+)(?:\s*(?:\[(.*?)\]|\((.*?)\)))?:\s*(.+)$')
        self.step_pattern = re.compile(r'^(\d+)\.\s*(.+)$')

    @staticmethod
    def is_tautological_level_name(level_num: int, name: Optional[str]) -> bool:
        """
        Проверяет, является ли название уровня тавтологической бессмысленной заглушкой,
        дублирующей индекс уровня (например, "Level 1", "Уровень 1", "1", "level_1").
        """
        if not name:
            return True
        s = str(name).strip()
        if not s:
            return True
        if s in (str(level_num), f"#{level_num}"):
            return True
        pattern = re.compile(
            r'^(?:level|уровень|рівень|этап|етап|stage|группа|група|group)[_\s-]*' + str(level_num) + r'$',
            re.IGNORECASE
        )
        return bool(pattern.match(s))

    @staticmethod
    def _clean_prompt_and_extract_legend(prompt: str) -> Tuple[str, Dict[int, str]]:
        """
        Автоматически обнаруживает и извлекает встроенную легенду уровней из текста вопроса (#),
        например: "(Уровень 1 — смещение в сторону; Уровень 2 — смещение в противоположную сторону):"
        Возвращает очищенный текст вопроса и словарь извлеченных названий {level_num: title}.
        """
        if not prompt or ('(' not in prompt and '[' not in prompt):
            return prompt, {}

        legend_block_match = re.search(
            r'([\(\[])\s*((?:уровень|рівень|level|этап|етап|stage|группа|група|group)\s*1\s*[-—–:].*?)([\)\]])',
            prompt,
            re.IGNORECASE | re.DOTALL
        )
        if not legend_block_match:
            return prompt, {}

        block_content = legend_block_match.group(2)
        entry_pattern = re.compile(
            r'(?i:уровень|рівень|level|этап|етап|stage|группа|група|group)\s*(\d+)\s*[-—–:]\s*(.+?)(?=(?:;\s*|,\s*)?(?i:уровень|рівень|level|этап|етап|stage|группа|група|group)\s*\d+\s*[-—–:]|\s*$)',
            re.IGNORECASE | re.DOTALL
        )

        extracted: Dict[int, str] = {}
        for m in entry_pattern.finditer(block_content):
            lvl_num = int(m.group(1))
            lvl_title = m.group(2).strip().rstrip(';,.')
            if lvl_title:
                if len(lvl_title) > 1 and lvl_title[0].islower():
                    lvl_title = lvl_title[0].upper() + lvl_title[1:]
                extracted[lvl_num] = lvl_title

        # Считаем легендой только блок, содержащий как минимум 2 уровня
        if len(extracted) < 2:
            return prompt, {}

        start, end = legend_block_match.span()
        before = prompt[:start].rstrip()
        after = prompt[end:].lstrip()

        has_colon = before.endswith(':') or after.startswith(':')
        has_question = before.endswith('?') or after.startswith('?')

        before = re.sub(r'[\s:?.!]+$', '', before)
        after = re.sub(r'^[\s:?.!]+', '', after)

        if after:
            cleaned_prompt = f"{before} {after}".strip()
        else:
            cleaned_prompt = before.strip()

        if has_question:
            cleaned_prompt += '?'
        elif has_colon:
            cleaned_prompt += ':'
        else:
            cleaned_prompt += ':'

        return cleaned_prompt, extracted

    def _parse_level_line(self, line: str) -> Optional[Tuple[int, Optional[str], List[str]]]:
        """
        Устойчиво парсит строку уровня с поддержкой вложенных скобок, дефисов, кавычек и разных разделителей.
        Поддерживает форматы:
          - level_1 [Название]: element_1, element_2
          - level_1 (Название (уточнение)): element_1, element_2
          - level_1 — Название: element_1, element_2
          - level_1 - Название: element_1, element_2
          - level_1 "Название": element_1, element_2
          - level_1: element_1, element_2
        """
        line = line.strip()
        match = re.match(r'^(?i:level)[_\s]*(\d+)', line)
        if not match:
            return None
        level_num = int(match.group(1))
        rest = line[match.end():].strip()

        level_name = None
        elements_part = ""

        # Вариант 1: Квадратные скобки [ ... ]
        if rest.startswith('['):
            end_bracket = rest.rfind(']')
            if end_bracket != -1:
                level_name = rest[1:end_bracket].strip()
                after_bracket = rest[end_bracket + 1:].strip()
                if after_bracket.startswith(':'):
                    elements_part = after_bracket[1:].strip()
                else:
                    elements_part = after_bracket
        # Вариант 2: Круглые скобки ( ... )
        elif rest.startswith('('):
            end_paren = rest.rfind(')')
            if end_paren != -1:
                level_name = rest[1:end_paren].strip()
                after_paren = rest[end_paren + 1:].strip()
                if after_paren.startswith(':'):
                    elements_part = after_paren[1:].strip()
                else:
                    elements_part = after_paren
        # Вариант 3: Кавычки " ... " или ' ... '
        elif (rest.startswith('"') and rest.count('"') >= 2) or (rest.startswith("'") and rest.count("'") >= 2):
            q_char = rest[0]
            end_quote = rest.find(q_char, 1)
            level_name = rest[1:end_quote].strip()
            after_quote = rest[end_quote + 1:].strip()
            if after_quote.startswith(':'):
                elements_part = after_quote[1:].strip()
            else:
                elements_part = after_quote
        # Вариант 4: Тире или дефис: — Название: elem_1 или - Название: elem_1
        elif re.match(r'^[-—–]\s*', rest):
            rest_after_dash = re.sub(r'^[-—–]\s*', '', rest)
            colon_idx = rest_after_dash.find(':')
            if colon_idx != -1:
                level_name = rest_after_dash[:colon_idx].strip()
                elements_part = rest_after_dash[colon_idx + 1:].strip()
            else:
                colon_idx = rest.find(':')
                if colon_idx != -1:
                    elements_part = rest[colon_idx + 1:].strip()
        # Вариант 5: Двоеточие: : elem_1, elem_2
        elif rest.startswith(':'):
            elements_part = rest[1:].strip()
        else:
            colon_idx = rest.find(':')
            if colon_idx != -1:
                possible_title = rest[:colon_idx].strip()
                if possible_title:
                    level_name = possible_title
                elements_part = rest[colon_idx + 1:].strip()
            else:
                elements_part = rest

        if level_name and self.is_tautological_level_name(level_num, level_name):
            level_name = None

        delims = [',', ';']
        chosen_delim = ',' if ',' in elements_part else (';' if ';' in elements_part else None)
        if chosen_delim:
            elements = [e.strip() for e in elements_part.split(chosen_delim) if e.strip()]
        else:
            elements = [e.strip() for e in elements_part.split() if e.strip()]

        return level_num, level_name, elements

    def parse_text(self, text: str) -> List[Dict[str, Any]]:
        """
        Парсит текст с заданиями Sequence

        Формат:
        @SEQUENCE
        # Описание задачи
        element_1: Название элемента 1
        element_2: Название элемента 2
        element_3: Название элемента 3
        level_1 [Название этапа 1]: element_1, element_2
        level_2 [Название этапа 2]: element_3
        (или без скобок для автогенерации имен: level_1: element_1)

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
        level_names = {}

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

            # Парсим нумерованный шаг линейной последовательности (1. Шаг)
            step_match = self.step_pattern.match(line_stripped)
            if step_match:
                step_num = int(step_match.group(1))
                element_id = f"element_{step_num}"
                element_text = step_match.group(2).strip()
                elements[element_id] = element_text
                levels[step_num] = [element_id]
                continue

            # Парсим уровень (с поддержкой расширенного синтаксиса)
            level_tuple = self._parse_level_line(line_stripped)
            if level_tuple:
                level_num, level_name_raw, level_elements = level_tuple
                if level_name_raw is not None and level_name_raw.strip():
                    clean_name = self.sanitize_text(level_name_raw.strip())
                    if not self.is_tautological_level_name(level_num, clean_name):
                        level_names[level_num] = clean_name
                levels[level_num] = level_elements
                continue

            # Предупреждение о нераспознанной строке, похожей на объявление уровня
            if re.match(r'^(?i:level)[_\s]*\d+', line_stripped):
                self.warnings.append({
                    'index': index,
                    'severity': 'warning',
                    'code': 'malformed_level_line',
                    'message': f'Не удалось распознать строку уровня: "{line_stripped}"',
                    'line': line_num
                })
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

        # Автоматическое извлечение встроенной легенды уровней из вопроса (# ...)
        cleaned_prompt, extracted_legend = self._clean_prompt_and_extract_legend(prompt)
        prompt = self.sanitize_text(cleaned_prompt)

        for lvl_num, lvl_title in extracted_legend.items():
            if lvl_num not in level_names or self.is_tautological_level_name(lvl_num, level_names.get(lvl_num, '')):
                level_names[lvl_num] = self.sanitize_text(lvl_title)

        # Очистка от возможных остаточных тавтологических плейсхолдеров
        level_names = {
            lvl: name for lvl, name in level_names.items()
            if name and not self.is_tautological_level_name(lvl, name)
        }

        # Создаем задание
        task_title = metadata.get('title') or metadata.get('name')
        task_data = {
            'prompt': prompt,
            'elements': elements,
            'levels': levels,
            'level_names': level_names,
            **(({'metadata': metadata} if metadata else {}))
        }
        if 'level_order_matters' in metadata:
            task_data['level_order_matters'] = metadata['level_order_matters']
        if 'sequence_within_level_matters' in metadata:
            task_data['sequence_within_level_matters'] = metadata['sequence_within_level_matters']
        task = {
            'type': 'sequence_assembly',
            'name': self.generate_task_name('sequence_assembly', index, prompt, title=task_title),
            'prompt': prompt,
            'data': task_data
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
        prompt = task.get('prompt', '')

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

        # Дидактическая валидация: проверка названий групп для заданий на классификацию/группировку
        is_grouping = (
            data.get('level_order_matters') is False
            or any(len(elem_list) > 1 for elem_list in levels.values())
        )
        has_custom_titles = any(
            bool(name and not self.is_tautological_level_name(lvl, name))
            for lvl, name in data.get('level_names', {}).items()
        )
        if is_grouping and not has_custom_titles and len(levels) > 1:
            self.warnings.append({
                'index': index,
                'severity': 'warning',
                'code': 'missing_group_titles',
                'message': 'Для заданий на группировку/классификацию (или с несколькими элементами на уровне) рекомендуется указывать понятные названия групп: level_N [Название группы]: element_1, element_2',
                'line': None
            })

        # Проверка на наличие остаточной нераспарсенной легенды уровней в строке описания (#)
        if prompt and re.search(r'(?i:уровень|рівень|level)\s*\d+\s*[-—–:]', prompt):
            self.warnings.append({
                'index': index,
                'severity': 'warning',
                'code': 'level_legend_in_prompt',
                'message': 'Обнаружена расшифровка уровней в строке описания (#). Рекомендуется указывать названия уровней в квадратных скобках: level_N [Название]: ...',
                'line': None
            })

        return errors
