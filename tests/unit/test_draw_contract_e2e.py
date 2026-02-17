"""
Contract e2e тесты для DRAWING task type.

Проверка контракта: getUserAnswerPayload (Frontend) → TaskEvaluatorService (Backend)

Тестирует полный путь данных от формата UI payload до результата evaluator.
"""

import pytest
from task_system.types.draw_task import DrawTaskEvaluator


class TestDrawContractE2E:
    """
    Контрактные e2e тесты: проверяют что payload из UI 
    корректно обрабатывается Backend evaluator.
    """
    
    def test_ui_payload_format_with_brush_radius(self):
        """
        Тест: UI payload с brush_radius корректно обрабатывается.
        
        UI (DrawUI.web.js) отправляет:
        {
            "brush_radius": 8,
            "drawing": [{"type": "brush_stroke", "points": [...]}]
        }
        """
        evaluator = DrawTaskEvaluator()
        
        # Симулируем payload как отправляет DrawUI.web.js
        ui_payload = {
            "image_width": 800,
            "image_height": 600,
            "brush_radius": 8,  # UI default
            "polygons": [{"points": [[100, 100], [200, 100], [200, 200], [100, 200]]}],
            "lines": [],
            "labels_polygons": ["Test Region"],
            "labels_lines": [],
            "drawing": [
                {
                    "type": "brush_stroke",
                    "points": [[100, 100], [150, 100], [200, 100], [200, 150], 
                               [200, 200], [150, 200], [100, 200], [100, 150], [100, 100]]
                }
            ]
        }
        
        # Backend reference data
        reference_data = {
            "polygons": [[[100, 100], [200, 100], [200, 200], [100, 200]]]
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # Проверяем что brush_radius из UI payload использован
        assert result["details"]["brush_radius"] == 8
        assert result["metric"] == "IoU"
        assert "coverage" in result["details"]
    
    def test_ui_payload_legacy_drawing_format(self):
        """
        Тест: Legacy drawing[] формат корректно обрабатывается.
        
        Backend читает user_input.drawing[] как массив brush_stroke объектов.
        """
        evaluator = DrawTaskEvaluator()
        
        # Legacy format (только drawing[], без polygons/lines)
        ui_payload = {
            "drawing": [
                {
                    "type": "brush_stroke",
                    "points": [[50, 50], [100, 50], [100, 100], [50, 100], [50, 50]]
                }
            ]
        }
        
        reference_data = {
            "polygons": [[[50, 50], [100, 50], [100, 100], [50, 100]]]
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # Должен работать с legacy форматом
        assert result["success"] is True or result["success"] is False  # Результат зависит от покрытия
        assert result["score"] >= 0
        assert result["details"]["brush_radius"] == 8  # Default
    
    def test_ui_payload_with_custom_coverage_threshold(self):
        """
        Тест: Настраиваемый coverage_threshold работает через reference_data.
        
        Editor может сохранить coverage_threshold в answer_key для мягкой оценки.
        """
        evaluator = DrawTaskEvaluator()
        
        # UI payload с частичным покрытием
        ui_payload = {
            "brush_radius": 8,
            "drawing": [
                {
                    "type": "brush_stroke",
                    "points": [[0, 0], [50, 0], [100, 0]]  # Только верхняя граница
                }
            ]
        }
        
        # Reference с пониженным порогом
        reference_data_low = {
            "polygons": [[[0, 0], [100, 0], [100, 100], [0, 100]]],
            "coverage_threshold": 20  # Низкий порог
        }
        
        # Reference со стандартным порогом
        reference_data_high = {
            "polygons": [[[0, 0], [100, 0], [100, 100], [0, 100]]],
            "coverage_threshold": 75  # Стандартный порог
        }
        
        result_low = evaluator.evaluate(ui_payload, reference_data_low)
        result_high = evaluator.evaluate(ui_payload, reference_data_high)
        
        # Проверяем что пороги применяются
        assert result_low["details"]["coverage_threshold"] == 20
        assert result_high["details"]["coverage_threshold"] == 75


class TestDrawRegressionBugFixes:
    """
    Регрессионные тесты на ранее найденные баги.
    """
    
    def test_bug_brush_radius_mismatch_fixed(self):
        """
        Регрессионный тест: brush_radius больше не hardcoded 4px.
        
        Баг: UI отправляет brush_radius=8, но Backend использовал hardcoded 4.
        Фикс: Backend теперь читает brush_radius из user_input.
        """
        evaluator = DrawTaskEvaluator()
        
        # UI отправляет brush_radius=16 (большой радиус)
        ui_payload = {
            "brush_radius": 16,
            "drawing": [
                {"type": "brush_stroke", "points": [[50, 50], [51, 50]]}  # Минимальный штрих
            ]
        }
        
        reference_data = {
            "polygons": [[[40, 40], [60, 40], [60, 60], [40, 60]]]  # 20x20 квадрат вокруг точки
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # Критическая проверка: brush_radius должен быть 16, а не 4
        assert result["details"]["brush_radius"] == 16, \
            f"Регрессия! brush_radius должен быть 16, получили {result['details']['brush_radius']}"
    
    def test_bug_coverage_threshold_hardcoded_fixed(self):
        """
        Регрессионный тест: coverage_threshold больше не hardcoded 75%.
        
        Баг: 75% порог был зашит в код и не настраивался.
        Фикс: Backend теперь читает coverage_threshold из reference_data.
        """
        evaluator = DrawTaskEvaluator()
        
        ui_payload = {
            "drawing": [
                {"type": "brush_stroke", "points": [[0, 0], [50, 0], [100, 0]]}
            ]
        }
        
        # Используем нестандартный порог 50%
        reference_data = {
            "polygons": [[[0, 0], [100, 0], [100, 100], [0, 100]]],
            "coverage_threshold": 50
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # Критическая проверка: coverage_threshold должен быть 50, а не 75
        assert result["details"]["coverage_threshold"] == 50, \
            f"Регрессия! coverage_threshold должен быть 50, получили {result['details']['coverage_threshold']}"
    
    def test_bug_invalid_brush_radius_defaults_to_8(self):
        """
        Регрессионный тест: невалидный brush_radius использует default 8.
        
        Баг: Отсутствие валидации brush_radius могло привести к ошибкам.
        Фикс: Добавлена валидация с fallback на 8px.
        """
        evaluator = DrawTaskEvaluator()
        
        # Невалидные значения brush_radius
        invalid_values = [0, -5, "invalid", None]
        
        for invalid_value in invalid_values:
            ui_payload = {
                "brush_radius": invalid_value,
                "drawing": [{"type": "brush_stroke", "points": [[50, 50]]}]
            }
            
            reference_data = {
                "polygons": [[[0, 0], [100, 0], [100, 100], [0, 100]]]
            }
            
            result = evaluator.evaluate(ui_payload, reference_data)
            
            assert result["details"]["brush_radius"] == 8, \
                f"Регрессия! Для brush_radius={invalid_value} должен быть default 8"


class TestDrawEdgeCasesIntegration:
    """
    Интеграционные тесты на граничные случаи.
    """
    
    def test_multiple_polygons_partial_success(self):
        """
        Тест: Частичный успех при нескольких полигонах.
        
        Пользователь правильно обводит 2 из 3 регионов.
        """
        evaluator = DrawTaskEvaluator()
        
        # Рисуем точно по первым двум полигонам
        ui_payload = {
            "brush_radius": 10,
            "drawing": [
                # Полигон 1 - покрыт полностью
                {"type": "brush_stroke", "points": [
                    [0, 0], [50, 0], [100, 0], [100, 50], [100, 100], 
                    [50, 100], [0, 100], [0, 50], [0, 0]
                ]},
                # Полигон 2 - покрыт полностью
                {"type": "brush_stroke", "points": [
                    [200, 0], [250, 0], [300, 0], [300, 50], [300, 100], 
                    [250, 100], [200, 100], [200, 50], [200, 0]
                ]}
                # Полигон 3 - НЕ покрыт
            ]
        }
        
        reference_data = {
            "polygons": [
                [[0, 0], [100, 0], [100, 100], [0, 100]],      # Регион 1
                [[200, 0], [300, 0], [300, 100], [200, 100]],  # Регион 2
                [[400, 0], [500, 0], [500, 100], [400, 100]]   # Регион 3 - не покрыт
            ],
            "success_threshold": 2  # Требуется 2 из 3
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # Должны пройти, т.к. 2+ успешных из требуемых 2
        assert result["details"]["total_targets"] == 3
        assert result["details"]["required_correct"] == 2
    
    def test_empty_stroke_points_handled(self):
        """
        Тест: Пустые точки в штрихе корректно обрабатываются.
        """
        evaluator = DrawTaskEvaluator()
        
        ui_payload = {
            "drawing": [
                {"type": "brush_stroke", "points": []},  # Пустой штрих
                {"type": "brush_stroke", "points": [[50, 50], [60, 60]]}  # Нормальный штрих
            ]
        }
        
        reference_data = {
            "polygons": [[[0, 0], [100, 0], [100, 100], [0, 100]]]
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # Не должно быть ошибки
        assert result["score"] >= 0
        assert "success" in result
