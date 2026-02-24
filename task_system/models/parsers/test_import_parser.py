"""
Парсер для импорта тестовых заданий через маркер @TEST
Адаптер над TestFileParser для интеграции с общей системой импорта
"""

import re
from typing import List, Dict, Any, Optional

from ..task_import_parser import TaskImportParser


class TestImportParser(TaskImportParser):
    """Парсер для импорта тестовых заданий в формате @TEST"""

    marker = '@TEST'

    def parse_text(self, text: str) -> List[Dict[str, Any]]:
        """
        Парсит текст с тестовыми заданиями.

        Формат внутри каждого блока @TEST:
            ? Текст вопроса
            + Правильный ответ
            - Неправильный ответ
            - Неправильный ответ

            ? Следующий вопрос
            + Ответ
            - Ответ

        Один блок @TEST = одно задание типа test, содержащее все вопросы
        внутри этого блока.
        """
        self.reset()
        blocks = self.split_by_task_markers(text, [self.marker])
        tasks = []

        for marker, content in blocks:
            task = self._parse_single_block(content, len(tasks))
            if task is not None:
                tasks.append(task)

        return tasks

    def _parse_single_block(self, content: str, index: int) -> Optional[Dict[str, Any]]:
        """Парсит один блок @TEST, извлекая вопросы и ответы."""
        lines = content.split('\n')

        question_pattern = re.compile(r'^\?\s*(.+)$')
        answer_pattern = re.compile(r'^([+-])\s*(.+)$')

        questions = []
        current_question = None
        current_answers = []
        prompt = None

        for line in lines:
            line_stripped = line.strip()
            if not line_stripped:
                continue

            # Строка-промпт (начинается с #) — необязательная
            if line_stripped.startswith('#') and prompt is None and current_question is None:
                prompt = line_stripped[1:].strip()
                continue

            # Вопрос
            q_match = question_pattern.match(line_stripped)
            if q_match:
                # Сохраняем предыдущий вопрос
                if current_question is not None:
                    questions.append({
                        'id': len(questions),
                        'text': current_question,
                        'answers': current_answers
                    })
                current_question = q_match.group(1).strip()
                current_answers = []
                continue

            # Ответ
            a_match = answer_pattern.match(line_stripped)
            if a_match:
                if current_question is None:
                    self.errors.append(
                        f"Задание #{index + 1}: ответ без вопроса: '{line_stripped}'"
                    )
                    continue
                is_correct = a_match.group(1) == '+'
                answer_text = a_match.group(2).strip()
                current_answers.append({
                    'text': answer_text,
                    'is_correct': is_correct,
                    'correct': is_correct
                })
                continue

            # Строка, начинающаяся с ? без текста (новый формат — только знак ?)
            if line_stripped == '?':
                if current_question is not None:
                    questions.append({
                        'id': len(questions),
                        'text': current_question,
                        'answers': current_answers
                    })
                current_question = ''
                current_answers = []
                continue

            # Если текущий вопрос пуст (после голого ?), это текст вопроса
            if current_question is not None and current_question == '':
                current_question = line_stripped
                continue

        # Сохраняем последний вопрос
        if current_question is not None:
            questions.append({
                'id': len(questions),
                'text': current_question,
                'answers': current_answers
            })

        # Валидация
        if not questions:
            self.errors.append(
                f"Задание #{index + 1}: блок @TEST не содержит вопросов"
            )
            return None

        # Проверяем каждый вопрос
        for i, q in enumerate(questions):
            if not q['text'].strip():
                self.warnings.append({
                    'index': index,
                    'severity': 'error',
                    'message': f"Вопрос {i + 1}: пустой текст вопроса",
                    'code': 'empty_question'
                })
            if not q['answers']:
                self.warnings.append({
                    'index': index,
                    'severity': 'error',
                    'message': f"Вопрос {i + 1}: нет вариантов ответов",
                    'code': 'no_answers'
                })
            else:
                correct_count = sum(1 for a in q['answers'] if a.get('is_correct', a.get('correct')))
                if correct_count == 0:
                    self.warnings.append({
                        'index': index,
                        'severity': 'error',
                        'message': f"Вопрос {i + 1}: нет правильных ответов",
                        'code': 'no_correct_answer'
                    })
                if correct_count > 1:
                    self.warnings.append({
                        'index': index,
                        'severity': 'warning',
                        'message': f"Вопрос {i + 1}: несколько правильных ответов (multiple choice)",
                        'code': 'multiple_correct'
                    })

        task_name = self.generate_task_name('test', index, prompt or f'Тест ({len(questions)} вопросов)')

        has_multiple_questions = any(
            sum(1 for a in q.get('answers', []) if a.get('is_correct', a.get('correct'))) > 1
            for q in questions
        )

        return {
            'type': 'test',
            'name': task_name,
            'prompt': prompt or f'Тест ({len(questions)} вопросов)',
            'data': {
                'prompt': prompt or f'Тест ({len(questions)} вопросов)',
                'test_type': 'multiple_choice' if has_multiple_questions else 'single_choice',
                'questions': questions,
                'question_count': len(questions),
                'settings': {
                    'shuffle_questions': True,
                    'shuffle_answers': True,
                    'time_limit': None,
                    'passing_score': 70
                }
            }
        }

    def _validate_single_task(self, task: Dict[str, Any], index: int) -> List[str]:
        """
        Валидирует одно тестовое задание.

        Args:
            task: Задание для валидации
            index: Индекс задания

        Returns:
            Список ошибок валидации
        """
        errors = []
        data = task.get('data', {})
        questions = data.get('questions', [])

        if not questions:
            errors.append(f"Задание #{index + 1}: нет вопросов")
            return errors

        for i, q in enumerate(questions):
            q_text = q.get('text', '').strip()
            if not q_text:
                errors.append(f"Задание #{index + 1}, вопрос {i + 1}: пустой текст вопроса")

            answers = q.get('answers', [])
            if not answers:
                errors.append(f"Задание #{index + 1}, вопрос {i + 1}: нет вариантов ответов")
                continue

            correct_count = sum(1 for a in answers if a.get('is_correct', a.get('correct')))
            if correct_count == 0:
                errors.append(f"Задание #{index + 1}, вопрос {i + 1}: нет правильного ответа")

            for j, a in enumerate(answers):
                if not a.get('text', '').strip():
                    self.warnings.append({
                        'index': index,
                        'severity': 'warning',
                        'message': f"Вопрос {i + 1}, ответ {j + 1}: пустой текст ответа",
                        'code': 'empty_answer_text'
                    })

        return errors
