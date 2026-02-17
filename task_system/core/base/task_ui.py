"""
Базовый класс для UI элементов типов заданий
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Tuple


class BaseTaskUI(ABC):
    """Базовый класс для UI элементов типов заданий"""
    
    @abstractmethod
    def get_ui_elements(self) -> Dict[str, bool]:
        """
        Возвращает настройки UI элементов
        
        Returns:
            Dict с настройками:
            {
                "show_brush": bool,
                "show_compare": bool, 
                "show_reset": bool,
                "handle_click": bool,
                "handle_draw": bool
            }
        """
        pass
    
    def should_show_brush(self) -> bool:
        """Показывать ли кисть"""
        return self.get_ui_elements().get("show_brush", False)
    
    def should_show_compare(self) -> bool:
        """Показывать ли кнопку сравнения"""
        return self.get_ui_elements().get("show_compare", False)
    
    def should_show_reset(self) -> bool:
        """Показывать ли кнопку сброса"""
        return self.get_ui_elements().get("show_reset", True)
    
    def should_handle_click(self) -> bool:
        """Обрабатывать ли клики мыши"""
        return self.get_ui_elements().get("handle_click", True)
    
    def should_handle_draw(self) -> bool:
        """Обрабатывать ли рисование"""
        return self.get_ui_elements().get("handle_draw", False)
    
    @abstractmethod
    def get_toolbar_widgets(self) -> List[Tuple[str, str, Dict]]:
        """
        Возвращает виджеты для панели инструментов
        
        Returns:
            List[Tuple[name, widget_type, config]]
            Например: [("brush", "button", {"text": "Кисть", "command": self.toggle_brush})]
        """
        pass
    
    @abstractmethod
    def get_initial_instructions(self) -> str:
        """Возвращает начальные инструкции для пользователя"""
        pass

