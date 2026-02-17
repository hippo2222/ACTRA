"""
Реализация типа задания "draw"
"""

from typing import Dict, List, Any
from ..core.base.task_type import BaseTaskType
from ..core.base.task_evaluator import BaseTaskEvaluator
from ..core.base.task_ui import BaseTaskUI


class DrawTaskEvaluator(BaseTaskEvaluator):
    """Оценщик для заданий типа "draw" """
    
    def evaluate(self, user_input: Any, reference_data: Any) -> Dict[str, Any]:
        """Оценивает соответствие нарисованной области эталону"""
        if not user_input or not reference_data:
            return {
                "success": False,
                "score": 0.0,
                "message": "Нет данных для оценки",
                "metric": "IoU",
                "details": {}
            }
        
        # Получаем нарисованные пользователем области
        user_drawing = user_input.get("drawing", [])
        reference_polygons = reference_data.get("polygons", [])
        
        if not user_drawing or not reference_polygons:
            return {
                "success": False,
                "score": 0.0,
                "message": "Нет данных для сравнения",
                "metric": "IoU",
                "details": {}
            }
        
        # FIX: Получаем brush_radius из user_input (по умолчанию 8px как в UI)
        brush_radius = user_input.get("brush_radius", 8)
        if not isinstance(brush_radius, (int, float)) or brush_radius <= 0:
            brush_radius = 8
        
        # FIX: Получаем порог покрытия из reference_data (по умолчанию 75%)
        coverage_threshold = reference_data.get("coverage_threshold", 75)
        if not isinstance(coverage_threshold, (int, float)) or coverage_threshold <= 0:
            coverage_threshold = 75
        
        # Получаем порог успеха (минимальное количество успешных targets)
        success_threshold = reference_data.get("success_threshold", None)
        total_targets = len(reference_polygons)
        required_correct = success_threshold if success_threshold else total_targets
        
        # Вычисляем покрытие для каждого полигона
        coverage_results = []
        successful_targets = 0
        
        for polygon_points in reference_polygons:
            coverage = self.calculate_polygon_coverage(polygon_points, user_drawing, brush_radius)
            coverage_results.append(coverage)
            
            # FIX: Используем настраиваемый порог вместо hardcoded 75%
            if coverage >= coverage_threshold:
                successful_targets += 1
        
        # Оценка с учетом порога
        success = successful_targets >= required_correct
        
        # Средний процент покрытия для статистики
        average_coverage = sum(coverage_results) / len(coverage_results) if coverage_results else 0
        
        return {
            "success": success,
            "score": average_coverage,
            "message": self.format_result_message(success, average_coverage, coverage_threshold),
            "metric": "IoU",
            "details": {
                "coverage": average_coverage,
                "successful_targets": successful_targets,
                "required_correct": required_correct,
                "total_targets": total_targets,
                "threshold_mode": success_threshold is not None,
                "individual_coverage": coverage_results,
                "brush_radius": brush_radius,
                "coverage_threshold": coverage_threshold
            }
        }
    
    def calculate_polygon_coverage(self, polygon_points: List, user_drawing: List, brush_radius: float = 8) -> float:
        """Рассчитывает покрытие полигона нарисованными штрихами
        
        Args:
            polygon_points: Список точек эталонного полигона [(x,y), ...]
            user_drawing: Список штрихов пользователя
            brush_radius: Радиус кисти в пикселях (по умолчанию 8, как в UI)
        
        Returns:
            float: Процент покрытия (0-100)
        """
        if len(polygon_points) < 3:
            return 0
        
        # Генерируем точки вдоль границы полигона
        boundary_points = []
        for i in range(len(polygon_points)):
            start_point = polygon_points[i]
            end_point = polygon_points[(i + 1) % len(polygon_points)]
            
            steps = max(5, int(((end_point[0] - start_point[0]) ** 2 + 
                              (end_point[1] - start_point[1]) ** 2) ** 0.5) // 3)
            for j in range(steps + 1):
                t = j / steps
                x = start_point[0] + t * (end_point[0] - start_point[0])
                y = start_point[1] + t * (end_point[1] - start_point[1])
                boundary_points.append((x, y))
        
        # Проверяем покрытие точек границы
        covered_points = 0
        
        for point in boundary_points:
            if self.is_point_covered_by_strokes(point[0], point[1], user_drawing, brush_radius):
                covered_points += 1
        
        if len(boundary_points) > 0:
            coverage_percent = (covered_points / len(boundary_points)) * 100
            return min(coverage_percent, 100.0)
        return 0
    
    def is_point_covered_by_strokes(self, x: float, y: float, user_drawing: List, radius: float) -> bool:
        """Проверяет, покрыта ли точка нарисованными штрихами"""
        for stroke in user_drawing:
            if stroke.get('type') == 'brush_stroke':
                for point in stroke.get('points', []):
                    px, py = point
                    distance = ((x - px) ** 2 + (y - py) ** 2) ** 0.5
                    if distance <= radius:
                        return True
        return False
    
    def get_evaluation_method(self) -> str:
        return "contour_overlap"


class DrawTaskUI(BaseTaskUI):
    """UI для заданий типа "draw" """
    
    def get_ui_elements(self) -> Dict[str, bool]:
        return {
            "show_brush": True,
            "show_compare": True,
            "show_reset": True,
            "handle_click": False,
            "handle_draw": True
        }
    
    def get_toolbar_widgets(self) -> List[tuple]:
        return [
            ("brush", "button", {
                "text": "🖌 Кисть",
                "command": "toggle_brush"
            }),
            ("brush_size", "scale", {
                "from_": 1,
                "to": 20,
                "orient": "horizontal"
            }),
            ("compare", "button", {
                "text": "✓ Сравнить",
                "command": "compare_drawing"
            }),
            ("reset", "button", {
                "text": "🔄 Сбросить",
                "command": "reset_task"
            })
        ]
    
    def get_initial_instructions(self) -> str:
        return "Нарисуйте область патологического очага кистью"


class DrawTask(BaseTaskType):
    """Тип задания "draw" - рисование области"""
    
    def __init__(self):
        super().__init__(
            task_id="draw",
            name="Рисование области",
            description="Пользователь должен нарисовать контур области"
        )
    
    def create_evaluator(self) -> BaseTaskEvaluator:
        return DrawTaskEvaluator()
    
    def create_ui(self) -> BaseTaskUI:
        return DrawTaskUI()
    
    def get_available_tools(self) -> List[str]:
        return ["hand", "zoom", "pan", "brush", "compare"]
    
    def get_default_settings(self) -> Dict[str, Any]:
        return {"overlapThreshold": 0.75}
    
    def validate_task_data(self, task_data: Dict[str, Any]) -> bool:
        """Валидирует данные задания типа draw"""
        required_fields = ["type", "image", "prompt"]
        return all(field in task_data for field in required_fields)

