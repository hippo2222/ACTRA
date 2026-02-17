"""
Базовый класс для оценки заданий
"""

from abc import ABC, abstractmethod
from typing import Dict, Any


class BaseTaskEvaluator(ABC):
    """Базовый класс для оценки выполнения заданий"""
    
    @abstractmethod
    def evaluate(self, user_input: Any, reference_data: Any) -> Dict[str, Any]:
        """
        Оценивает выполнение задания
        
        Args:
            user_input: Ввод пользователя (клик, рисунок и т.д.)
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
        pass
    
    @abstractmethod
    def get_evaluation_method(self) -> str:
        """Возвращает название метода оценки"""
        pass
    
    def format_result_message(self, success: bool, score: float, threshold: float) -> str:
        """Форматирует сообщение о результате"""
        if success:
            return f"✅ Отлично! Результат: {score:.1f}%"
        else:
            return f"❌ Нужно улучшить. Результат: {score:.1f}% (минимум {threshold:.0f}%)"

