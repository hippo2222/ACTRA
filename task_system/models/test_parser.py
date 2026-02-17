"""
Парсер для импорта тестов из текстовых файлов
"""

import re
from typing import List, Dict, Any, Optional
from .test_task import TestTask, TestQuestion, TestAnswer


class TestFileParser:
    """Парсер для импорта тестов из текстовых файлов"""
    
    def __init__(self):
        self.question_pattern = re.compile(r'^\?\s*(.+)$')
        self.answer_pattern = re.compile(r'^[+-]\s*(.+)$')
    
    def parse_file(self, file_path: str) -> List[TestQuestion]:
        """Парсит файл с тестовыми вопросами
        
        Поддерживает два формата:
        1. Старый формат: ? текст вопроса на одной строке
        2. Новый формат: ? на отдельной строке, текст вопроса на следующих строках
        """
        questions = []
        current_question = None
        
        # Список кодировок для попытки открытия файла
        encodings = ['utf-8', 'cp1251', 'windows-1251', 'utf-16', 'latin-1']
        
        for encoding in encodings:
            try:
                with open(file_path, 'r', encoding=encoding) as f:
                    # Читаем все строки в список для возможности "заглянуть вперед"
                    lines = f.readlines()
                
                # Обрабатываем строки
                i = 0
                while i < len(lines):
                    line = lines[i].rstrip('\n\r')  # Убираем только переводы строк, сохраняем пробелы/табы
                    line_stripped = line.strip()
                    line_num = i + 1
                    
                    # Пропускаем пустые строки
                    if not line_stripped:
                        i += 1
                        continue
                    
                    # Проверяем, является ли строка вопросом в старом формате: ? текст вопроса
                    question_match = self.question_pattern.match(line_stripped)
                    if question_match:
                        # Сохраняем предыдущий вопрос, если есть
                        if current_question:
                            questions.append(current_question)
                        
                        # Создаем новый вопрос
                        current_question = TestQuestion(
                            id=len(questions),
                            text=question_match.group(1),
                            answers=[]
                        )
                        i += 1
                        continue
                    
                    # Проверяем, является ли строка только символом ? (новый формат)
                    if line_stripped == '?':
                        # Сохраняем предыдущий вопрос, если есть
                        if current_question:
                            questions.append(current_question)
                        
                        # Читаем следующие строки как текст вопроса
                        # Пропускаем пустые строки после ?
                        i += 1
                        question_lines = []
                        
                        while i < len(lines):
                            next_line = lines[i].rstrip('\n\r')
                            next_line_stripped = next_line.strip()
                            
                            # Если пустая строка - пропускаем, но продолжаем искать текст вопроса
                            if not next_line_stripped:
                                i += 1
                                continue
                            
                            # Если строка начинается с + или -, это начало ответов
                            if self.answer_pattern.match(next_line_stripped):
                                break
                            
                            # Иначе это часть текста вопроса
                            question_lines.append(next_line_stripped)
                            i += 1
                        
                        # Проверяем, что нашли текст вопроса
                        if not question_lines:
                            raise ValueError(f"Строка {line_num}: вопрос без текста (после '?' не найден текст)")
                        
                        # Объединяем строки вопроса (многострочный вопрос)
                        question_text = ' '.join(question_lines)
                        
                        # Создаем новый вопрос
                        current_question = TestQuestion(
                            id=len(questions),
                            text=question_text,
                            answers=[]
                        )
                        # Не увеличиваем i, так как мы уже на строке с ответом или пустой строке
                        continue
                    
                    # Проверяем, является ли строка ответом
                    answer_match = self.answer_pattern.match(line_stripped)
                    if answer_match:
                        if current_question is None:
                            raise ValueError(f"Строка {line_num}: ответ без вопроса")
                        
                        # Определяем, правильный ли это ответ
                        is_correct = line_stripped.startswith('+')
                        answer_text = answer_match.group(1)
                        
                        # Создаем ответ
                        answer = TestAnswer(
                            text=answer_text,
                            correct=is_correct
                        )
                        current_question.answers.append(answer)
                        i += 1
                        continue
                    
                    # Если строка не соответствует ни одному паттерну
                    raise ValueError(f"Строка {line_num}: неизвестный формат: '{line_stripped}'")
                
                # Добавляем последний вопрос, если есть
                if current_question:
                    questions.append(current_question)
                
                return questions
                
            except FileNotFoundError:
                raise ValueError(f"Файл не найден: {file_path}")
            except UnicodeDecodeError:
                # Пробуем следующую кодировку
                continue
            except Exception as e:
                raise ValueError(f"Ошибка при чтении файла: {e}")
        
        # Если ни одна кодировка не сработала
        raise ValueError(f"Не удалось определить кодировку файла: {file_path}")
    
    def validate_questions(self, questions: List[TestQuestion]) -> List[str]:
        """Проверяет корректность импортированных вопросов"""
        errors = []
        
        if not questions:
            errors.append("Файл не содержит вопросов")
            return errors
        
        for i, question in enumerate(questions):
            if not question.text.strip():
                errors.append(f"Вопрос {i+1}: пустой текст вопроса")
            
            if not question.answers:
                errors.append(f"Вопрос {i+1}: нет вариантов ответов")
                continue
            
            # Проверяем наличие правильных ответов
            correct_answers = [a for a in question.answers if a.correct]
            if not correct_answers:
                errors.append(f"Вопрос {i+1}: нет правильных ответов")
            
            # Проверяем количество правильных ответов
            if len(correct_answers) > 1:
                errors.append(f"Вопрос {i+1}: несколько правильных ответов (используйте тип 'multiple_choice')")
        
        return errors
    
    def create_test_from_file(self, file_path: str, test_type: str = 'single_choice') -> TestTask:
        """Создает тест из файла"""
        questions = self.parse_file(file_path)
        errors = self.validate_questions(questions)
        
        if errors:
            raise ValueError("Ошибки в импортируемом файле:\n" + "\n".join(errors))
        
        # Создаем тест
        test_data = {
            'type': 'test',
            'test_type': test_type,
            'questions': [
                {
                    'id': q.id,
                    'text': q.text,
                    'answers': [
                        {
                            'text': a.text,
                            'correct': a.correct
                        }
                        for a in q.answers
                    ]
                }
                for q in questions
            ],
            'settings': {
                'shuffle_questions': True,
                'shuffle_answers': True,
                'time_limit': None,
                'passing_score': 70
            }
        }
        
        return TestTask(test_data)
    
    def export_test_to_file(self, test_task: TestTask, file_path: str):
        """Экспортирует тест в текстовый файл"""
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                for question in test_task.questions:
                    # Записываем вопрос
                    f.write(f"?{question.text}\n")
                    
                    # Записываем варианты ответов
                    for answer in question.answers:
                        prefix = "+" if answer.correct else "-"
                        f.write(f"{prefix}{answer.text}\n")
                    
                    # Добавляем пустую строку между вопросами
                    f.write("\n")
            
        except Exception as e:
            raise ValueError(f"Ошибка при экспорте файла: {e}")
    
    def get_file_preview(self, file_path: str, max_lines: int = 20) -> List[str]:
        """Возвращает превью файла для предварительного просмотра"""
        encodings = ['utf-8', 'cp1251', 'windows-1251', 'utf-16', 'latin-1']
        
        for encoding in encodings:
            try:
                with open(file_path, 'r', encoding=encoding) as f:
                    lines = []
                    for i, line in enumerate(f):
                        if i >= max_lines:
                            lines.append("... (показаны первые 20 строк)")
                            break
                        lines.append(f"{i+1:3d}: {line.rstrip()}")
                    return lines
            except UnicodeDecodeError:
                continue
            except Exception as e:
                return [f"Ошибка при чтении файла: {e}"]
        
        return [f"Ошибка: не удалось определить кодировку файла"]


# Пример использования парсера
if __name__ == "__main__":
    # Пример файла с вопросами
    sample_content = """?Сколько ног у жирафа?
-Одна
-Две
+Четыре
-Три

?Какая планета ближе всего к Солнцу?
+Меркурий
-Венера
-Земля
-Марс

?Сколько дней в феврале в високосном году?
-28
+29
-30
-31
"""
    
    # Создаем временный файл для тестирования
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
        f.write(sample_content)
        temp_file = f.name
    
    try:
        # Тестируем парсер
        parser = TestFileParser()
        test_task = parser.create_test_from_file(temp_file)
        
        print(f"Импортировано {len(test_task.questions)} вопросов")
        for question in test_task.questions:
            print(f"Вопрос: {question.text}")
            for answer in question.answers:
                status = "✓" if answer.correct else "✗"
                print(f"  {status} {answer.text}")
            print()
    
    finally:
        # Удаляем временный файл
        import os
        os.unlink(temp_file)

