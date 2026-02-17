"""
Базовый класс для типа задания
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional
from .task_evaluator import BaseTaskEvaluator
from .task_ui import BaseTaskUI


class BaseTaskType(ABC):
    """Базовый класс для всех типов заданий"""
    
    def __init__(self, task_id: str, name: str, description: str):
        self.task_id = task_id
        self.name = name
        self.description = description
        self.evaluator = self.create_evaluator()
        self.ui = self.create_ui()
    
    @abstractmethod
    def create_evaluator(self) -> BaseTaskEvaluator:
        """Создает оценщик для данного типа задания"""
        pass
    
    @abstractmethod
    def create_ui(self) -> BaseTaskUI:
        """Создает UI компоненты для данного типа задания"""
        pass
    
    @abstractmethod
    def get_available_tools(self) -> List[str]:
        """Возвращает список доступных инструментов"""
        pass
    
    @abstractmethod
    def get_default_settings(self) -> Dict[str, Any]:
        """Возвращает настройки по умолчанию"""
        pass
    
    @abstractmethod
    def validate_task_data(self, task_data: Dict[str, Any]) -> bool:
        """Валидирует данные задания"""
        pass
    
    def get_ui_elements(self) -> Dict[str, bool]:
        """Возвращает настройки UI элементов"""
        return self.ui.get_ui_elements()
    
    def should_show_brush(self) -> bool:
        """Показывать ли кисть"""
        return self.ui.should_show_brush()
    
    def should_show_compare(self) -> bool:
        """Показывать ли кнопку сравнения"""
        return self.ui.should_show_compare()
    
    def should_show_reset(self) -> bool:
        """Показывать ли кнопку сброса"""
        return self.ui.should_show_reset()
    
    def should_handle_click(self) -> bool:
        """Обрабатывать ли клики мыши"""
        return self.ui.should_handle_click()
    
    def should_handle_draw(self) -> bool:
        """Обрабатывать ли рисование"""
        return self.ui.should_handle_draw()
    
    def evaluate_task(self, user_input: Any, reference_data: Any) -> Dict[str, Any]:
        """Оценивает выполнение задания"""
        return self.evaluator.evaluate(user_input, reference_data)
    
    def get_task_info(self) -> Dict[str, Any]:
        """Возвращает информацию о типе задания"""
        return {
            "id": self.task_id,
            "name": self.name,
            "description": self.description,
            "tools": self.get_available_tools(),
            "settings": self.get_default_settings(),
            "ui_elements": self.get_ui_elements()
        }

