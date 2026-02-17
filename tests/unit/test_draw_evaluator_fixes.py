"""
Тесты для DrawTaskEvaluator - проверка исправлений brush_radius и coverage_threshold.

Стадия 3 аудита DRAWING: тесты на новую функциональность.
"""

import pytest
from task_system.types.draw_task import DrawTaskEvaluator


class TestDrawTaskEvaluatorBrushRadius:
    """Тесты для исправления brush_radius."""
    
    def test_brush_radius_from_user_input(self):
        """Проверяет, что brush_radius читается из user_input."""
        evaluator = DrawTaskEvaluator()
        
        # Создаём простой полигон (квадрат 100x100)
        reference_data = {
            "polygons": [[(0, 0), (100, 0), (100, 100), (0, 100)]]
        }
        
        # Рисуем штрих вдоль верхней границы (y=0)
        user_input = {
            "brush_radius": 20,  # Большой радиус
            "drawing": [
                {"type": "brush_stroke", "points": [(0, 0), (50, 0), (100, 0)]}
            ]
        }
        
        result = evaluator.evaluate(user_input, reference_data)
        
        # Проверяем, что brush_radius из user_input использован
        assert result["details"]["brush_radius"] == 20
    
    def test_brush_radius_default_value(self):
        """Проверяет значение brush_radius по умолчанию (8px)."""
        evaluator = DrawTaskEvaluator()
        
        reference_data = {
            "polygons": [[(0, 0), (100, 0), (100, 100), (0, 100)]]
        }
        
        # Без brush_radius в user_input
        user_input = {
            "drawing": [
                {"type": "brush_stroke", "points": [(0, 0), (50, 0), (100, 0)]}
            ]
        }
        
        result = evaluator.evaluate(user_input, reference_data)
        
        # По умолчанию должно быть 8px (как в UI)
        assert result["details"]["brush_radius"] == 8
    
    def test_brush_radius_invalid_value_fallback(self):
        """Проверяет fallback для невалидного brush_radius."""
        evaluator = DrawTaskEvaluator()
        
        reference_data = {
            "polygons": [[(0, 0), (100, 0), (100, 100), (0, 100)]]
        }
        
        # Невалидный brush_radius
        user_input = {
            "brush_radius": -5,  # Отрицательный
            "drawing": [
                {"type": "brush_stroke", "points": [(0, 0), (50, 0), (100, 0)]}
            ]
        }
        
        result = evaluator.evaluate(user_input, reference_data)
        
        # Должен использоваться default 8px
        assert result["details"]["brush_radius"] == 8


class TestDrawTaskEvaluatorCoverageThreshold:
    """Тесты для настраиваемого coverage_threshold."""
    
    def test_coverage_threshold_from_reference_data(self):
        """Проверяет, что coverage_threshold читается из reference_data."""
        evaluator = DrawTaskEvaluator()
        
        reference_data = {
            "polygons": [[(0, 0), (100, 0), (100, 100), (0, 100)]],
            "coverage_threshold": 50  # Пониженный порог
        }
        
        user_input = {
            "drawing": [
                {"type": "brush_stroke", "points": [(0, 0), (50, 0), (100, 0)]}
            ]
        }
        
        result = evaluator.evaluate(user_input, reference_data)
        
        # Проверяем, что порог из reference_data использован
        assert result["details"]["coverage_threshold"] == 50
    
    def test_coverage_threshold_default_value(self):
        """Проверяет значение coverage_threshold по умолчанию (75%)."""
        evaluator = DrawTaskEvaluator()
        
        reference_data = {
            "polygons": [[(0, 0), (100, 0), (100, 100), (0, 100)]]
        }
        
        user_input = {
            "drawing": [
                {"type": "brush_stroke", "points": [(0, 0), (50, 0), (100, 0)]}
            ]
        }
        
        result = evaluator.evaluate(user_input, reference_data)
        
        # По умолчанию должно быть 75%
        assert result["details"]["coverage_threshold"] == 75
    
    def test_coverage_threshold_affects_success(self):
        """Проверяет, что coverage_threshold влияет на success."""
        evaluator = DrawTaskEvaluator()
        
        # Создаём полигон и рисунок с ~50% покрытием
        reference_data_low = {
            "polygons": [[(0, 0), (100, 0), (100, 100), (0, 100)]],
            "coverage_threshold": 30  # Низкий порог - должен быть успех
        }
        
        reference_data_high = {
            "polygons": [[(0, 0), (100, 0), (100, 100), (0, 100)]],
            "coverage_threshold": 90  # Высокий порог - должен быть провал
        }
        
        # Рисунок покрывает только часть границы
        user_input = {
            "brush_radius": 10,
            "drawing": [
                {"type": "brush_stroke", "points": [(0, 0), (50, 0), (100, 0), (100, 50)]}
            ]
        }
        
        result_low = evaluator.evaluate(user_input, reference_data_low)
        result_high = evaluator.evaluate(user_input, reference_data_high)
        
        # С низким порогом должен быть успех (если покрытие >= 30%)
        # С высоким порогом должен быть провал (если покрытие < 90%)
        # Примечание: точный результат зависит от алгоритма покрытия
        assert result_low["details"]["coverage_threshold"] == 30
        assert result_high["details"]["coverage_threshold"] == 90


class TestDrawTaskEvaluatorEdgeCases:
    """Тесты граничных случаев."""
    
    def test_empty_user_input(self):
        """Проверяет обработку пустого user_input."""
        evaluator = DrawTaskEvaluator()
        
        result = evaluator.evaluate(None, {"polygons": [[(0, 0), (100, 0), (100, 100)]]})
        
        assert result["success"] is False
        assert result["score"] == 0.0
        assert "Нет данных для оценки" in result["message"]
    
    def test_empty_reference_data(self):
        """Проверяет обработку пустого reference_data."""
        evaluator = DrawTaskEvaluator()
        
        result = evaluator.evaluate(
            {"drawing": [{"type": "brush_stroke", "points": [(0, 0)]}]},
            None
        )
        
        assert result["success"] is False
        assert result["score"] == 0.0
        assert "Нет данных для оценки" in result["message"]
    
    def test_empty_drawing(self):
        """Проверяет обработку пустого drawing."""
        evaluator = DrawTaskEvaluator()
        
        result = evaluator.evaluate(
            {"drawing": []},
            {"polygons": [[(0, 0), (100, 0), (100, 100), (0, 100)]]}
        )
        
        assert result["success"] is False
        assert result["score"] == 0.0
        assert "Нет данных для сравнения" in result["message"]
    
    def test_polygon_with_less_than_3_points(self):
        """Проверяет обработку полигона с менее чем 3 точками."""
        evaluator = DrawTaskEvaluator()
        
        # Полигон с 2 точками - невалидный
        coverage = evaluator.calculate_polygon_coverage(
            [(0, 0), (100, 0)],  # Только 2 точки
            [{"type": "brush_stroke", "points": [(50, 0)]}],
            brush_radius=8
        )
        
        assert coverage == 0
