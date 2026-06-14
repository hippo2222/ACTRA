"""
Реализация типа задания "click"
"""

from typing import Dict, List, Any
from ..core.base.task_type import BaseTaskType
from ..core.base.task_evaluator import BaseTaskEvaluator
from ..core.base.task_ui import BaseTaskUI


class ClickTaskEvaluator(BaseTaskEvaluator):
    """Оценщик для заданий типа "click" """
    
    def evaluate(self, user_input: Any, reference_data: Any) -> Dict[str, Any]:
        """Оценивает точность клика"""
        if not user_input or not reference_data:
            return {
                "success": False,
                "score": 0.0,
                "message": "Нет данных для оценки",
                "metric": "distance",
                "details": {}
            }

        # Специальная ветка для error_detection/text_choice
        ref_subtype = reference_data.get("subtype") or reference_data.get("task_subtype")
        ref_mode = reference_data.get("mode")
        ref_options = reference_data.get("options") or []
        if ref_subtype == "error_detection" or ref_mode in ("text_choice", "text_errors") or ref_options:
            # text_choice поддерживает только одиночный выбор
            if ref_mode == "text_choice" or ref_options:
                options = ref_options if isinstance(ref_options, list) else []
                correct_opt = next((o for o in options if o.get("is_correct")), None)
                correct_id = correct_opt.get("id") if correct_opt else None
                # user_input — dict с полями selected_option_id / selected_option / selected_option_ids
                selected_id = None
                if isinstance(user_input, dict):
                    selected_id = (
                        user_input.get("selected_option_id")
                        or user_input.get("selected_option")
                        or (user_input.get("selected_option_ids") or [None])[0]
                    )
                success = bool(selected_id) and correct_id is not None and str(selected_id) == str(correct_id)
                score = 100.0 if success else 0.0
                return {
                    "success": success,
                    "score": score,
                    "message": self.format_result_message(success, score, 100),
                    "metric": "percent",
                    "details": {
                        "mode": "text_choice",
                        "selected_option_id": selected_id,
                        "correct_option_id": correct_id,
                        "options_total": len(options),
                    },
                }
            # LEGACY: text_errors (error_detection) is scored by the running app
            # via TaskEvaluatorService.evaluate_click_task (see desktop-app). This
            # standalone task_system evaluator does not implement it and is not on
            # the live submit path; the explicit guard avoids a misleading score.
            return {
                "success": False,
                "score": 0.0,
                "message": "Оценка для text_errors не поддерживается",
                "metric": "percent",
                "details": {"mode": ref_mode or "text_errors"},
            }

        # Получаем порог успеха из settings (если есть)
        success_threshold = reference_data.get("success_threshold", None)
        annotations = reference_data.get("annotations", [])
        
        # Если аннотаций нет, возвращаем ошибку
        if not annotations:
            # Fallback: старый формат с одной точкой
            tolerance = reference_data.get("tolerancePx", 10)
            user_point = user_input
            ref_point = reference_data.get("point", (0, 0))
            
            distance = ((user_point[0] - ref_point[0]) ** 2 + 
                       (user_point[1] - ref_point[1]) ** 2) ** 0.5
            
            success = distance <= tolerance
            score = max(0, 100 - (distance / tolerance) * 100) if tolerance > 0 else 0
            
            return {
                "success": success,
                "score": score,
                "message": self.format_result_message(success, score, 75),
                "metric": "distance",
                "details": {
                    "distance": distance,
                    "tolerance": tolerance,
                    "user_point": user_point,
                    "reference_point": ref_point
                }
            }
        
        # НОВАЯ ЛОГИКА: множественные аннотации
        total_annotations = len(annotations)
        
        # Определяем порог: если не задан, требуются все аннотации
        required_correct = success_threshold if success_threshold else total_annotations
        
        # Проверяем user_input - это должен быть список кликов
        user_clicks = user_input if isinstance(user_input, list) else [user_input]
        
        # Отслеживаем, какие аннотации уже засчитаны (каждая только один раз)
        matched_annotations = set()
        successful_clicks = 0
        details_list = []
        
        for click_idx, user_click in enumerate(user_clicks):
            matched_this_click = False
            
            for ann_idx, annotation in enumerate(annotations):
                # Пропускаем уже засчитанные аннотации
                if ann_idx in matched_annotations:
                    continue
                
                # Проверяем клик против аннотации
                if self._check_click_against_annotation(user_click, annotation):
                    # Засчитываем аннотацию только первый раз
                    matched_annotations.add(ann_idx)
                    successful_clicks += 1
                    matched_this_click = True
                    details_list.append({
                        "click_index": click_idx,
                        "user_click": user_click,
                        "annotation_index": ann_idx,
                        "success": True
                    })
                    break  # Переходим к следующему клику
            
            if not matched_this_click:
                # Клик промазал - не засчитывается как ошибка, просто фиксируем
                details_list.append({
                    "click_index": click_idx,
                    "user_click": user_click,
                    "success": False,
                    "reason": "missed"
                })
        
        # Оценка успеха
        success = successful_clicks >= required_correct
        score = (successful_clicks / required_correct) * 100 if required_correct > 0 else 0
        
        return {
            "success": success,
            "score": score,
            "message": self.format_result_message(success, score, 75),
            "metric": "annotations_matched",
            "details": {
                "successful_clicks": successful_clicks,
                "required_correct": required_correct,
                "total_annotations": total_annotations,
                "total_clicks": len(user_clicks),
                "missed_clicks": len(user_clicks) - successful_clicks,
                "threshold_mode": success_threshold is not None,
                "clicks": details_list
            }
        }
    
    def _check_click_against_annotation(self, user_click: tuple, annotation: Dict) -> bool:
        """Проверяет клик против одной аннотации"""
        tolerance = annotation.get("tolerance_px", annotation.get("tolerancePx", 10))
        
        # Поддержка разных типов аннотаций
        if "point" in annotation:
            # Point annotation
            ref_point = annotation["point"]
            distance = ((user_click[0] - ref_point[0]) ** 2 + 
                       (user_click[1] - ref_point[1]) ** 2) ** 0.5
            return distance <= tolerance
        elif "points" in annotation:
            # Polygon annotation - проверяем, находится ли клик внутри полигона
            return self._point_in_polygon(user_click, annotation["points"])
        
        return False
    
    def _point_in_polygon(self, point: tuple, polygon: List[tuple]) -> bool:
        """Проверяет, находится ли точка внутри полигона (Ray casting algorithm)"""
        x, y = point
        n = len(polygon)
        inside = False
        
        p1x, p1y = polygon[0]
        for i in range(1, n + 1):
            p2x, p2y = polygon[i % n]
            if y > min(p1y, p2y):
                if y <= max(p1y, p2y):
                    if x <= max(p1x, p2x):
                        if p1y != p2y:
                            xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                        if p1x == p2x or x <= xinters:
                            inside = not inside
            p1x, p1y = p2x, p2y
        
        return inside
    
    def get_evaluation_method(self) -> str:
        return "point_accuracy"


class ClickTaskUI(BaseTaskUI):
    """UI для заданий типа "click" """
    
    def get_ui_elements(self) -> Dict[str, bool]:
        return {
            "show_brush": False,
            "show_compare": False,
            "show_reset": True,
            "handle_click": True,
            "handle_draw": False
        }
    
    def get_toolbar_widgets(self) -> List[tuple]:
        return [
            ("reset", "button", {
                "text": "🔄 Сбросить",
                "command": "reset_task"
            })
        ]
    
    def get_initial_instructions(self) -> str:
        return "Кликните на изображение для начала"


class ClickTask(BaseTaskType):
    """Тип задания "click" - клик по области"""
    
    def __init__(self):
        super().__init__(
            task_id="click",
            name="Клик по области",
            description="Пользователь должен кликнуть на определенную область"
        )
    
    def create_evaluator(self) -> BaseTaskEvaluator:
        return ClickTaskEvaluator()
    
    def create_ui(self) -> BaseTaskUI:
        return ClickTaskUI()
    
    def get_available_tools(self) -> List[str]:
        return ["hand", "zoom", "pan"]
    
    def get_default_settings(self) -> Dict[str, Any]:
        return {"tolerancePx": 10}
    
    def validate_task_data(self, task_data: Dict[str, Any]) -> bool:
        """Валидирует данные задания типа click.

        Image is required ONLY for the image-click subtype. Text-based click
        subtypes (text_choice / text_errors / error_detection) have no image, so
        the previous unconditional ``image`` requirement wrongly rejected them.

        NOTE: legacy task_system validator. The running app validates via the task
        schema (TaskData.to_validated) and scores via TaskEvaluatorService; this is
        kept only for the standalone task_system registry/tooling.
        """
        if not isinstance(task_data, dict):
            return False
        if "type" not in task_data or "prompt" not in task_data:
            return False
        subtype = str(task_data.get("subtype") or task_data.get("task_subtype") or "").strip().lower()
        mode = str(task_data.get("mode") or (task_data.get("content") or {}).get("mode") or "").strip().lower()
        is_text_based = (
            subtype == "error_detection"
            or mode in ("text_choice", "text_errors")
            or bool(task_data.get("options"))
        )
        if is_text_based:
            return True
        return "image" in task_data

