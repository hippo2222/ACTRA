"""
Модуль для оценки результатов тестовых заданий
"""

import time
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from .test_task import TestTask, TestQuestion, TestAnswer


@dataclass
class TestResult:
    """Результат прохождения теста"""
    total_questions: int
    correct_answers: int
    percentage: float
    time_taken: float  # в секундах
    passed: bool
    details: List[Dict[str, Any]]  # детальная информация по каждому вопросу


class TestEvaluator:
    """Класс для оценки результатов тестов"""
    
    def __init__(self, test_task: TestTask):
        self.test_task = test_task
        self.start_time = None
        self.user_answers = {}  # {question_id: [answer_indices]}
    
    def start_test(self):
        """Начинает тест"""
        self.start_time = time.time()
        self.user_answers = {}
    
    def answer_question(self, question_id: int, answer_indices: List[int]):
        """Записывает ответ пользователя на вопрос"""
        self.user_answers[question_id] = answer_indices
    
    def finish_test(self) -> TestResult:
        """Завершает тест и возвращает результат"""
        if self.start_time is None:
            raise ValueError("Тест не был начат")
        
        end_time = time.time()
        time_taken = end_time - self.start_time
        
        # Подсчитываем правильные ответы
        correct_count = 0
        details = []
        
        for question in self.test_task.questions:
            user_answer_indices = self.user_answers.get(question.id, [])
            is_correct = self._check_question_answer(question, user_answer_indices)
            
            if is_correct:
                correct_count += 1
            
            # Собираем детальную информацию
            detail = {
                'question_id': question.id,
                'question_text': question.text,
                'user_answers': [question.answers[i].text for i in user_answer_indices if i < len(question.answers)],
                'correct_answers': [a.text for a in question.answers if a.correct],
                'is_correct': is_correct
            }
            details.append(detail)
        
        # Вычисляем процент правильных ответов
        percentage = (correct_count / len(self.test_task.questions)) * 100 if self.test_task.questions else 0
        
        # Проверяем, прошел ли пользователь тест
        passed = percentage >= self.test_task.settings.passing_score
        
        return TestResult(
            total_questions=len(self.test_task.questions),
            correct_answers=correct_count,
            percentage=percentage,
            time_taken=time_taken,
            passed=passed,
            details=details
        )
    
    def _check_question_answer(self, question: TestQuestion, user_answer_indices: List[int]) -> bool:
        """Проверяет правильность ответа на вопрос"""
        if not user_answer_indices:
            return False
        
        # Получаем индексы правильных ответов
        correct_indices = [i for i, answer in enumerate(question.answers) if answer.correct]
        
        if self.test_task.test_type == 'single_choice':
            # Для single_choice должен быть ровно один правильный ответ
            return len(user_answer_indices) == 1 and user_answer_indices[0] in correct_indices
        
        elif self.test_task.test_type == 'multiple_choice':
            # Для multiple_choice все выбранные ответы должны быть правильными
            # и должны быть выбраны все правильные ответы
            return (set(user_answer_indices) == set(correct_indices) and 
                    len(user_answer_indices) == len(correct_indices))
        
        elif self.test_task.test_type == 'image_choice':
            # Для image_choice логика такая же, как для single_choice
            return len(user_answer_indices) == 1 and user_answer_indices[0] in correct_indices
        
        return False
    
    def get_current_progress(self) -> Dict[str, Any]:
        """Возвращает текущий прогресс прохождения теста"""
        if self.start_time is None:
            return {'started': False}
        
        current_time = time.time()
        elapsed_time = current_time - self.start_time
        
        return {
            'started': True,
            'elapsed_time': elapsed_time,
            'answered_questions': len(self.user_answers),
            'total_questions': len(self.test_task.questions),
            'time_limit': self.test_task.settings.time_limit,
            'time_remaining': self.test_task.settings.time_limit - elapsed_time if self.test_task.settings.time_limit else None
        }
    
    def is_time_up(self) -> bool:
        """Проверяет, истекло ли время"""
        if not self.test_task.settings.time_limit or self.start_time is None:
            return False
        
        elapsed_time = time.time() - self.start_time
        return elapsed_time >= self.test_task.settings.time_limit


class TestStatistics:
    """Класс для работы со статистикой тестов"""
    
    @staticmethod
    def calculate_difficulty(question: TestQuestion, all_results: List[TestResult]) -> float:
        """Вычисляет сложность вопроса на основе результатов"""
        if not all_results:
            return 0.5  # средняя сложность по умолчанию
        
        correct_count = 0
        total_attempts = 0
        
        for result in all_results:
            for detail in result.details:
                if detail['question_id'] == question.id:
                    total_attempts += 1
                    if detail['is_correct']:
                        correct_count += 1
        
        if total_attempts == 0:
            return 0.5
        
        # Возвращаем процент правильных ответов (чем выше, тем легче вопрос)
        return correct_count / total_attempts
    
    @staticmethod
    def get_question_statistics(question: TestQuestion, all_results: List[TestResult]) -> Dict[str, Any]:
        """Возвращает статистику по конкретному вопросу"""
        total_attempts = 0
        correct_attempts = 0
        answer_choices = {}  # {answer_text: count}
        
        for result in all_results:
            for detail in result.details:
                if detail['question_id'] == question.id:
                    total_attempts += 1
                    if detail['is_correct']:
                        correct_attempts += 1
                    
                    # Подсчитываем выборы ответов
                    for answer in detail['user_answers']:
                        answer_choices[answer] = answer_choices.get(answer, 0) + 1
        
        return {
            'total_attempts': total_attempts,
            'correct_attempts': correct_attempts,
            'success_rate': correct_attempts / total_attempts if total_attempts > 0 else 0,
            'answer_choices': answer_choices,
            'difficulty': TestStatistics.calculate_difficulty(question, all_results)
        }
    
    @staticmethod
    def get_test_statistics(test_task: TestTask, all_results: List[TestResult]) -> Dict[str, Any]:
        """Возвращает общую статистику по тесту"""
        if not all_results:
            return {
                'total_attempts': 0,
                'average_score': 0,
                'pass_rate': 0,
                'average_time': 0
            }
        
        total_attempts = len(all_results)
        passed_attempts = sum(1 for result in all_results if result.passed)
        average_score = sum(result.percentage for result in all_results) / total_attempts
        average_time = sum(result.time_taken for result in all_results) / total_attempts
        
        return {
            'total_attempts': total_attempts,
            'passed_attempts': passed_attempts,
            'pass_rate': passed_attempts / total_attempts,
            'average_score': average_score,
            'average_time': average_time,
            'question_statistics': [
                TestStatistics.get_question_statistics(question, all_results)
                for question in test_task.questions
            ]
        }

