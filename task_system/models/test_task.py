"""
Модуль для работы с тестовыми заданиями
"""

import json
import os
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict


@dataclass
class TestAnswer:
    """Вариант ответа на тестовый вопрос"""
    text: str
    correct: bool
    image_path: Optional[str] = None


@dataclass
class TestQuestion:
    """Вопрос теста"""
    id: int
    text: str
    answers: List[TestAnswer]
    image_path: Optional[str] = None  # Обратная совместимость (image_choice)
    images: Optional[List[str]] = None  # Новое поле: список изображений вопроса (до 3 шт)


@dataclass
class TestSettings:
    """Настройки теста"""
    shuffle_questions: bool = True
    shuffle_answers: bool = True
    time_limit: Optional[int] = None  # в секундах, None = без ограничения
    passing_score: int = 70  # процент для прохождения


class TestTask:
    """Класс для работы с тестовыми заданиями"""
    
    def __init__(self, task_data: Dict[str, Any]):
        self.task_data = task_data
        self.test_type = task_data.get('test_type', 'single_choice')
        self.questions = self._load_questions()
        self.settings = self._load_settings()
    
    def _load_questions(self) -> List[TestQuestion]:
        """Загружает вопросы из данных задания"""
        questions = []
        for q_data in self.task_data.get('questions', []):
            answers = []
            for a_data in q_data.get('answers', []):
                answer = TestAnswer(
                    text=a_data.get('text', ''),
                    correct=a_data.get('correct', False),
                    image_path=a_data.get('image_path')
                )
                answers.append(answer)
            
            question = TestQuestion(
                id=q_data.get('id', 0),
                text=q_data.get('text', ''),
                answers=answers,
                image_path=q_data.get('image_path'),
                images=q_data.get('images')  # Загружаем список изображений (если есть)
            )
            questions.append(question)
        
        return questions
    
    def _load_settings(self) -> TestSettings:
        """Загружает настройки теста"""
        settings_data = self.task_data.get('settings', {})
        return TestSettings(
            shuffle_questions=settings_data.get('shuffle_questions', True),
            shuffle_answers=settings_data.get('shuffle_answers', True),
            time_limit=settings_data.get('time_limit'),
            passing_score=settings_data.get('passing_score', 70)
        )
    
    def get_question_count(self) -> int:
        """Возвращает количество вопросов в тесте"""
        return len(self.questions)
    
    def get_question(self, question_id: int) -> Optional[TestQuestion]:
        """Возвращает вопрос по ID"""
        for question in self.questions:
            if question.id == question_id:
                return question
        return None
    
    def get_question_by_index(self, index: int) -> Optional[TestQuestion]:
        """Возвращает вопрос по индексу"""
        if 0 <= index < len(self.questions):
            return self.questions[index]
        return None
    
    def validate_test(self) -> List[str]:
        """Проверяет корректность теста и возвращает список ошибок"""
        errors = []
        
        if not self.questions:
            errors.append("Тест не содержит вопросов")
            return errors
        
        for i, question in enumerate(self.questions):
            if not question.text.strip():
                errors.append(f"Вопрос {i+1}: пустой текст вопроса")
            
            if not question.answers:
                errors.append(f"Вопрос {i+1}: нет вариантов ответов")
                continue
            
            # Проверяем наличие правильных ответов
            correct_answers = [a for a in question.answers if a.correct]
            if not correct_answers:
                errors.append(f"Вопрос {i+1}: нет правильных ответов")
            
            # Проверяем только наличие правильных ответов
            # Количество правильных ответов может быть любым (1 или больше)
            # Убрана проверка на соответствие test_type, так как каждый вопрос может иметь разное количество правильных ответов
        
        return errors
    
    def to_dict(self) -> Dict[str, Any]:
        """
        Преобразует тест в словарь для сохранения.
        
        ВАЖНО: Не включает 'type', так как это поле должно быть только на верхнем уровне TaskData.
        Для content нужны только: test_type, questions, settings.
        """
        questions_list = []
        for q in self.questions:
            question_dict = {
                'id': q.id,
                'text': q.text,
                'answers': [
                    {
                        'text': a.text,
                        'correct': a.correct,
                        'image_path': a.image_path
                    }
                    for a in q.answers
                ]
            }
            # Добавляем image_path только если он есть (обратная совместимость)
            if q.image_path:
                question_dict['image_path'] = q.image_path
            # Добавляем images только если список не пустой
            if q.images:
                question_dict['images'] = q.images
            
            questions_list.append(question_dict)
        
        return {
            'test_type': self.test_type,
            'questions': questions_list,
            'settings': asdict(self.settings)
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'TestTask':
        """Создает тест из словаря"""
        return cls(data)
    
    @classmethod
    def create_empty(cls, test_type: str = 'single_choice') -> 'TestTask':
        """Создает пустой тест"""
        return cls({
            'type': 'test',
            'test_type': test_type,
            'questions': [],
            'settings': {
                'shuffle_questions': True,
                'shuffle_answers': True,
                'time_limit': None,
                'passing_score': 70
            }
        })

