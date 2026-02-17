"""
Тип задания "Тест"
"""

from typing import Dict, List, Any
from ..core.base.task_type import BaseTaskType
from ..core.base.task_evaluator import BaseTaskEvaluator
from ..core.base.task_ui import BaseTaskUI

# Безопасный импорт TestTask
try:
    from ..models.test_task import TestTask
except ImportError:
    # Если не удалось импортировать, создаем заглушку
    class TestTask:
        def __init__(self, data):
            self.data = data
        
        def get_question_count(self):
            return len(self.data.get('questions', []))
        
        def validate_test(self):
            return []


class TestTaskEvaluator(BaseTaskEvaluator):
    """Оценщик для тестовых заданий"""
    
    def evaluate(self, user_input: Any, reference_data: Any) -> Dict[str, Any]:
        """Оценивает выполнение тестового задания (основной метод)"""
        return self.evaluate_task(user_input, reference_data)
    
    def get_evaluation_method(self) -> str:
        """Возвращает название метода оценки"""
        return "test_evaluation"
    
    def evaluate_task(self, user_input: Any, reference_data: Any) -> Dict[str, Any]:
        """Оценивает выполнение тестового задания"""
        if not isinstance(user_input, dict) or not isinstance(reference_data, dict):
            return {
                "success": False,
                "score": 0.0,
                "message": "Неверный формат данных",
                "metric": "percent",
                "details": {}
            }
        
        # Получаем ответы пользователя и правильные ответы
        user_answers = user_input.get('answers', {})
        correct_answers = reference_data.get('correct_answers', {})
        
        if not user_answers or not correct_answers:
            return {
                "success": False,
                "score": 0.0,
                "message": "Отсутствуют ответы",
                "metric": "percent",
                "details": {}
            }
        
        # Подсчитываем правильные ответы
        correct_count = 0
        total_questions = len(correct_answers)
        
        for question_id, correct_answer in correct_answers.items():
            user_answer = user_answers.get(question_id, [])
            if user_answer == correct_answer:
                correct_count += 1
        
        # Вычисляем процент правильных ответов
        score = (correct_count / total_questions) * 100 if total_questions > 0 else 0
        
        # Определяем, прошел ли тест
        passing_score = reference_data.get('passing_score', 70)
        success = score >= passing_score
        
        return {
            "success": success,
            "score": score,
            "message": f"Правильных ответов: {correct_count}/{total_questions} ({score:.1f}%)",
            "metric": "percent",
            "details": {
                "correct_answers": correct_count,
                "total_questions": total_questions,
                "percentage": score,
                "passed": success
            }
        }


class TestTaskUI(BaseTaskUI):
    """UI компоненты для тестовых заданий"""
    
    def get_ui_elements(self) -> Dict[str, bool]:
        """Возвращает настройки UI элементов"""
        return {
            "show_brush": False,
            "show_compare": False,
            "show_reset": True,
            "handle_click": True,
            "handle_draw": False
        }
    
    def get_toolbar_widgets(self) -> List:
        """Возвращает виджеты для панели инструментов"""
        return []
    
    def get_initial_instructions(self) -> str:
        """Возвращает начальные инструкции"""
        return "Выберите правильные ответы на вопросы теста"
    
    def get_task_instructions(self, task_data: Dict[str, Any]) -> str:
        """Возвращает инструкции для конкретного задания"""
        try:
            # Поддерживаем как старый формат (questions на верхнем уровне), так и новый (content.questions)
            # TestTask ожидает данные с questions на верхнем уровне, поэтому нормализуем
            normalized_data = task_data.copy()
            if 'content' in task_data and 'questions' in task_data['content']:
                normalized_data['questions'] = task_data['content']['questions']
                if 'test_type' in task_data['content']:
                    normalized_data['test_type'] = task_data['content']['test_type']
                if 'settings' in task_data['content']:
                    normalized_data['settings'] = task_data['content']['settings']
            
            test_task = TestTask(normalized_data)
            return f"Тест содержит {test_task.get_question_count()} вопросов. Выберите правильные ответы."
        except:
            # Поддерживаем как старый формат (questions на верхнем уровне), так и новый (content.questions)
            if 'content' in task_data and 'questions' in task_data['content']:
                questions = task_data['content']['questions']
            else:
                questions = task_data.get('questions', [])
            return f"Тест содержит {len(questions)} вопросов. Выберите правильные ответы."
    
    def get_completion_message(self, result: Dict[str, Any]) -> str:
        """Возвращает сообщение о завершении"""
        if result.get("success", False):
            return f"Тест пройден! Результат: {result.get('score', 0):.1f}%"
        else:
            return f"Тест не пройден. Результат: {result.get('score', 0):.1f}%"


class TestTaskType(BaseTaskType):
    """Тип задания "Тест" """
    
    def __init__(self):
        super().__init__(
            task_id="test",
            name="Тест",
            description="Тестовые задания с вопросами и вариантами ответов"
        )
    
    def create_evaluator(self) -> BaseTaskEvaluator:
        """Создает оценщик для тестовых заданий"""
        return TestTaskEvaluator()
    
    def create_ui(self) -> BaseTaskUI:
        """Создает UI компоненты для тестовых заданий"""
        return TestTaskUI()
    
    def get_available_tools(self) -> List[str]:
        """Возвращает доступные инструменты"""
        return ["select", "submit"]
    
    def get_default_settings(self) -> Dict[str, Any]:
        """Возвращает настройки по умолчанию"""
        return {
            "shuffle_questions": True,
            "shuffle_answers": True,
            "time_limit": None,
            "passing_score": 70
        }
    
    def validate_task_data(self, task_data: Dict[str, Any]) -> bool:
        """Валидирует данные тестового задания"""
        try:
            # Поддерживаем как старый формат (questions на верхнем уровне), так и новый (content.questions)
            # TestTask ожидает данные с questions на верхнем уровне, поэтому нормализуем
            normalized_data = task_data.copy()
            if 'content' in task_data and 'questions' in task_data['content']:
                normalized_data['questions'] = task_data['content']['questions']
                if 'test_type' in task_data['content']:
                    normalized_data['test_type'] = task_data['content']['test_type']
                if 'settings' in task_data['content']:
                    normalized_data['settings'] = task_data['content']['settings']
            
            test_task = TestTask(normalized_data)
            errors = test_task.validate_test()
            return len(errors) == 0
        except Exception:
            # Простая валидация без TestTask
            # Поддерживаем как старый формат, так и новый
            if not isinstance(task_data, dict):
                return False
            if 'content' in task_data and 'questions' in task_data['content']:
                return True
            return 'questions' in task_data
    
    def should_show_brush(self) -> bool:
        """Не показывать кисть для тестов"""
        return False
    
    def should_show_compare(self) -> bool:
        """Не показывать кнопку сравнения для тестов"""
        return False
    
    def should_show_reset(self) -> bool:
        """Показывать кнопку сброса для тестов"""
        return True
    
    def should_handle_click(self) -> bool:
        """Обрабатывать клики для выбора ответов"""
        return True
    
    def should_handle_draw(self) -> bool:
        """Не обрабатывать рисование для тестов"""
        return False

