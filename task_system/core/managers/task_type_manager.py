"""
Менеджер типов заданий
"""

from typing import Dict, List, Optional, Any
from ..base.task_type import BaseTaskType
from ...types.registry import TaskTypeRegistry


class TaskTypeManager:
    """Менеджер для работы с типами заданий"""
    
    def __init__(self, registry: Optional[TaskTypeRegistry] = None):
        self.registry = registry or TaskTypeRegistry()
    
    def get_task_type(self, task_id: str) -> Optional[BaseTaskType]:
        """Получает тип задания по ID"""
        return self.registry.get(task_id)
    
    def get_task_type_info(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Получает информацию о типе задания"""
        task_type = self.get_task_type(task_id)
        if task_type:
            return task_type.get_task_info()
        return None
    
    def is_valid_task_type(self, task_id: str) -> bool:
        """Проверяет, является ли тип задания валидным"""
        return self.registry.is_registered(task_id)
    
    def get_available_tools(self, task_id: str) -> List[str]:
        """Получает доступные инструменты для типа задания"""
        task_type = self.get_task_type(task_id)
        if task_type:
            return task_type.get_available_tools()
        return []
    
    def should_show_brush(self, task_id: str) -> bool:
        """Показывать ли кисть для данного типа"""
        task_type = self.get_task_type(task_id)
        if task_type:
            return task_type.should_show_brush()
        return False
    
    def should_show_compare(self, task_id: str) -> bool:
        """Показывать ли кнопку сравнения"""
        task_type = self.get_task_type(task_id)
        if task_type:
            return task_type.should_show_compare()
        return False
    
    def should_show_reset(self, task_id: str) -> bool:
        """Показывать ли кнопку сброса"""
        task_type = self.get_task_type(task_id)
        if task_type:
            return task_type.should_show_reset()
        return True
    
    def should_handle_click(self, task_id: str) -> bool:
        """Обрабатывать ли клики мыши"""
        task_type = self.get_task_type(task_id)
        if task_type:
            return task_type.should_handle_click()
        return True
    
    def should_handle_draw(self, task_id: str) -> bool:
        """Обрабатывать ли рисование"""
        task_type = self.get_task_type(task_id)
        if task_type:
            return task_type.should_handle_draw()
        return False
    
    def get_default_settings(self, task_id: str) -> Dict[str, Any]:
        """Получает настройки по умолчанию"""
        task_type = self.get_task_type(task_id)
        if task_type:
            return task_type.get_default_settings()
        return {}
    
    def get_task_name(self, task_id: str) -> str:
        """Получает название типа задания"""
        task_type = self.get_task_type(task_id)
        if task_type:
            return task_type.name
        return "Неизвестный тип"
    
    def get_task_description(self, task_id: str) -> str:
        """Получает описание типа задания"""
        task_type = self.get_task_type(task_id)
        if task_type:
            return task_type.description
        return ""
    def get_all_task_types(self) -> List[str]:
        """Получает все доступные типы заданий"""
        return self.registry.get_all_ids()
    
    def get_task_types_for_ui(self) -> List[tuple]:
        """Получает типы заданий для UI (ID, название)"""
        return self.registry.get_all_for_ui()
    
    def get_all_types(self) -> List[Dict[str, str]]:
        """Получает все типы заданий в формате списка словарей"""
        result = []
        for task_id, task_type in self.registry.get_all().items():
            result.append({
                'type': task_id,
                'name': task_type.name,
                'description': task_type.description
            })
        return result
    
    def evaluate_task(self, task_id: str, user_input: Any, reference_data: Any) -> Dict[str, Any]:
        """
        Оценивает выполнение задания
        
        Args:
            task_id: ID типа задания
            user_input: Ввод пользователя
            reference_data: Эталонные данные для сравнения
            
        Returns:
            Dict с результатами оценки:
            {
                "success": bool,
                "score": float,
                "message": str,
                "metric": "IoU" | "distance" | "percent",  # Тип метрики оценки
                "details": Dict
            }
        """
        task_type = self.get_task_type(task_id)
        if task_type:
            return task_type.evaluate_task(user_input, reference_data)
        return {
            "success": False,
            "score": 0.0,
            "message": "Неизвестный тип задания",
            "metric": "percent",
            "details": {}
        }
    
    def validate_task_data(self, task_id: str, task_data: Dict[str, Any]) -> bool:
        """Валидирует данные задания"""
        task_type = self.get_task_type(task_id)
        if task_type:
            return task_type.validate_task_data(task_data)
        return False
    
    def get_initial_instructions(self, task_id: str) -> str:
        """Получает начальные инструкции для типа задания"""
        task_type = self.get_task_type(task_id)
        if task_type:
            return task_type.ui.get_initial_instructions()
        return "Выберите тип задания"
    
    def normalize_type(self, task_type: str) -> str:
        """Нормализует тип задания (убирает лишние символы, приводит к нижнему регистру)"""
        if not task_type:
            return "click"
        
        # Убираем пробелы и приводим к нижнему регистру
        normalized = task_type.strip().lower()
        
        # Проверяем, существует ли такой тип
        if self.is_valid_task_type(normalized):
            return normalized
        
        # Если не найден, возвращаем click по умолчанию
        return "click"
    
    def get_ui_class(self, task_id: str):
        """
        Получает класс UI для типа задания.
        """
        # Импортируем UI-классы только когда нужно (для редактора)
        try:
            if task_id == 'click':
                from ...ui.editor.click_ui import ClickTaskUI
                return ClickTaskUI
            elif task_id == 'draw':
                from ...ui.editor.draw_ui import DrawTaskUI
                return DrawTaskUI
            elif task_id == 'test':
                from ...ui.editor.test_ui import TestTaskUI
                return TestTaskUI
            elif task_id == 'open_answer':
                from ...ui.editor.open_answer_ui import OpenAnswerTaskUI
                return OpenAnswerTaskUI
            elif task_id == 'sequence_assembly':
                from ...ui.editor.sequence_assembly_ui import SequenceAssemblyTaskUI
                return SequenceAssemblyTaskUI
        except ImportError:
            # UI-классы доступны только в редакторе
            pass
        
        return None


# Создаем глобальный экземпляр менеджера
task_type_manager = TaskTypeManager()

