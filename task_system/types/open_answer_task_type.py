"""
Тип задания "Открытый ответ"
Студент должен написать текстовый ответ на вопрос по изображению
"""

from typing import Dict, List, Any
from ..core.base.task_type import BaseTaskType
from ..core.base.task_evaluator import BaseTaskEvaluator
from ..core.base.task_ui import BaseTaskUI


class OpenAnswerTaskEvaluator(BaseTaskEvaluator):
    """Оценщик для заданий с открытым ответом"""
    
    def evaluate(self, user_input: Any, reference_data: Any) -> Dict[str, Any]:
        """
        Оценивает текстовый ответ студента.
        Логика проверки будет реализована в тренажере.
        Здесь только базовая структура.
        """
        if not isinstance(user_input, dict):
            return {
                "success": False,
                "score": 0.0,
                "message": "Неверный формат данных",
                "metric": "percent"
            }
        
        user_answer = user_input.get('answer', '').strip()
        
        if not user_answer:
            return {
                "success": False,
                "score": 0.0,
                "message": "Ответ не может быть пустым",
                "metric": "percent"
            }
        
        # Базовая проверка длины
        max_length = reference_data.get('max_length', 1000)
        if len(user_answer) > max_length:
            return {
                "success": False,
                "score": 0.0,
                "message": f"Ответ слишком длинный (максимум {max_length} символов)",
                "metric": "percent"
            }
        
        # Детальная логика проверки будет в тренажере
        # Здесь возвращаем базовую структуру
        return {
            "success": True,
            "score": 0.0,  # Будет рассчитано в тренажере
            "message": "Ответ принят",
            "metric": "percent",
            "details": {
                "answer_length": len(user_answer),
                "user_answer": user_answer
            }
        }
    
    def get_evaluation_method(self) -> str:
        """Возвращает название метода оценки"""
        return "open_answer_evaluation"


class OpenAnswerTaskUI(BaseTaskUI):
    """UI компоненты для заданий с открытым ответом"""
    
    def get_ui_elements(self) -> Dict[str, bool]:
        """Возвращает настройки UI элементов"""
        return {
            "show_brush": False,
            "show_compare": False,
            "show_reset": True,
            "handle_click": True,  # Для добавления маркеров на изображение
            "handle_draw": False
        }
    
    def get_toolbar_widgets(self) -> List:
        """Возвращает виджеты для панели инструментов"""
        return []
    
    def get_initial_instructions(self) -> str:
        """Возвращает начальные инструкции"""
        return "Создайте вопрос с открытым ответом"
    
    def get_task_instructions(self, task_data: Dict[str, Any]) -> str:
        """Возвращает инструкции для конкретного задания"""
        question = task_data.get('question', '')
        if question:
            return f"Вопрос: {question}"
        return "Ответьте на вопрос по изображению"
    
    def get_completion_message(self, result: Dict[str, Any]) -> str:
        """Возвращает сообщение о завершении"""
        if result.get("success", False):
            return "Ответ принят"
        else:
            return result.get("message", "Попробуйте еще раз")


class OpenAnswerTaskType(BaseTaskType):
    """Тип задания 'Открытый ответ'"""
    
    def __init__(self):
        super().__init__(
            task_id="open_answer",
            name="Открытый ответ",
            description="Вопрос с текстовым ответом по изображению"
        )
    
    def create_evaluator(self) -> OpenAnswerTaskEvaluator:
        """Создает оценщик для данного типа задания"""
        return OpenAnswerTaskEvaluator()
    
    def create_ui(self) -> OpenAnswerTaskUI:
        """Создает UI компоненты для данного типа задания"""
        return OpenAnswerTaskUI()
    
    def get_default_settings(self) -> Dict[str, Any]:
        """Возвращает настройки по умолчанию"""
        return {
            "max_length": 500,
            "show_hint": True,
            "allow_markers": True
        }
    
    def validate_task_data(self, task_data: Dict[str, Any]) -> bool:
        """Проверяет корректность данных задания"""
        # Проверка обязательных полей
        if 'question' not in task_data or not task_data['question'].strip():
            return False
        
        # image теперь опциональное поле, поэтому убираем проверку
        
        # Проверка длины вопроса
        if len(task_data['question']) < 10:
            return False
        
        return True
    
    def get_available_tools(self) -> List[str]:
        """Возвращает список доступных инструментов"""
        return ["point", "arrow"]  # Для маркеров на изображении
    
    def should_show_brush(self) -> bool:
        """Показывать ли кисть"""
        return False
    
    def should_show_compare(self) -> bool:
        """Показывать ли кнопку сравнения"""
        return False
    
    def should_show_reset(self) -> bool:
        """Показывать ли кнопку сброса"""
        return True
    
    def should_handle_click(self) -> bool:
        """Обрабатывать ли клики мыши"""
        return True  # Для добавления маркеров
    
    def should_handle_draw(self) -> bool:
        """Обрабатывать ли рисование"""
        return False

