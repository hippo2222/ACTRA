import pytest
import json
import os
from unittest.mock import patch, MagicMock
from services.task_evaluator_service import TaskEvaluatorService

class TestEvaluatorConfig:
    
    def test_load_config_with_defaults(self):
        """Проверка загрузки конфига с дефолтными значениями (или fallback)"""
        # Mock load_difficulty_config to return empty or specific default structure
        with patch('services.task_evaluator_service.load_difficulty_config') as mock_load:
            mock_load.return_value = {}
            
            service = TaskEvaluatorService()
            
            assert service.default_click_tolerance == 25
            assert service.default_freehand_tolerance == 15
            assert service.default_draw_threshold == 75
            assert service.default_brush_radius == 8

    def test_load_config_with_custom_values(self):
        """Проверка загрузки кастомных значений из конфига"""
        custom_config = {
            "version": "1.0",
            "evaluation_defaults": {
                "click": {
                    "tolerance_px": 30,
                    "freehand_tolerance_px": 20
                },
                "draw": {
                    "success_threshold_percent": 80,
                    "brush_radius_px": 10,
                    "iou_threshold": 0.6
                }
            }
        }
        
        with patch('services.task_evaluator_service.load_difficulty_config') as mock_load:
            mock_load.return_value = custom_config
            
            service = TaskEvaluatorService()
            
            assert service.default_click_tolerance == 30
            assert service.default_freehand_tolerance == 20
            # Draw values
            assert service.default_draw_threshold == 80
            assert service.default_brush_radius == 10
            assert service.default_iou_threshold == 0.6

    def test_fallback_exception(self):
        """Проверка fallback при ошибке загрузки конфига"""
        with patch('services.task_evaluator_service.load_difficulty_config') as mock_load:
            mock_load.side_effect = Exception("Config load error")
            
            service = TaskEvaluatorService()
            
            # Should fall back to hardcoded defaults in code (init logic)
            # Logic: difficulty_config = {} -> get returns {} -> get returns default
            assert service.default_click_tolerance == 25
            assert service.default_freehand_tolerance == 15

    def test_click_task_uses_config_tolerance(self):
        """Integration-like test: verify evaluate_click_task uses the tolerance from config (via self)"""
        # Setup service with custom config
        custom_config = {
            "evaluation_defaults": {
                "click": { "freehand_tolerance_px": 50 } # Custom large tolerance
            }
        }
        with patch('services.task_evaluator_service.load_difficulty_config') as mock_load:
            mock_load.return_value = custom_config
            service = TaskEvaluatorService()
            
            # Target is freehand
            target = {
                'shape': 'freehand',
                'points': [[0, 0], [10, 0]], 
                # No explicit tolerance in target, should use default (50 from config)
            }
            # Mock _check_freehand_target to verify it receives the correct tolerance
            with patch.object(service, '_check_freehand_target', return_value=True) as mock_check:
                
                user_input = {'x': 100, 'y': 100, 'scale_factor': 1} # coords dont matter as we mock check
                answer_key = {'targets': [target]}
                
                service.evaluate_click_task(user_input, answer_key)
                
                # Check arguments passed to _check_freehand_target
                args, kwargs = mock_check.call_args
                # Verify tolerance_px kwarg is 50
                assert kwargs.get('tolerance_px') == 50
