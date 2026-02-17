import pytest
from unittest.mock import patch, MagicMock
from services.task_evaluator_service import TaskEvaluatorService

class TestEvaluatorScoring:
    
    @pytest.fixture
    def service(self):
        with patch('services.task_evaluator_service.load_difficulty_config') as mock_load:
            mock_load.return_value = {
                "evaluation_defaults": {
                    "click": {"success_threshold_percent": 100}, # Strict default
                    "draw": {"success_threshold_percent": 75}
                }
            }
            return TaskEvaluatorService()

    def test_click_partial_score_basic(self, service):
        """Простая проверка частичного балла: 2 из 4 целей = 50%"""
        # Define dynamic side effect to avoid iteration count issues
        def check_hit(x, y, target, *args, **kwargs):
            # Simulate hit if click x matches target idx (0 and 1 match, 2 and 3 don't)
            t_idx = target.get('idx')
            return t_idx in [0, 1] and x == t_idx

        service._check_point_target = MagicMock(side_effect=check_hit)
        
        # 4 clicks with distinct X coordinates
        user_input = {
            'x': 0, 'y': 0, 
            'clicks': [{'x':0, 'y':0}, {'x':1, 'y':0}, {'x':2, 'y':0}, {'x':3, 'y':0}], 
            'scale_factor': 1
        }
        # 4 targets with explicit indices for our mock logic
        answer_key = {
            'targets': [
                {'shape':'point', 'idx':0}, 
                {'shape':'point', 'idx':1}, 
                {'shape':'point', 'idx':2}, 
                {'shape':'point', 'idx':3}
            ]
        }
        
        result = service.evaluate_click_task(user_input, answer_key)
        
        assert result.score == 50.0
        assert result.success is False # Default threshold 100%

    def test_click_success_with_low_threshold(self, service):
        """Проверка успеха при низком пороге (например, 50%)"""
        # Set threshold to 50% (2 targets) via task_data settings
        task_data = {'settings': {'success_threshold': 2}} 
        
        def check_hit(x, y, target, *args, **kwargs):
            t_idx = target.get('idx')
            return t_idx in [0, 1] and x == t_idx
            
        service._check_point_target = MagicMock(side_effect=check_hit)
        
        user_input = {'clicks': [{'x':0, 'y':0}, {'x':1, 'y':0}, {'x':2, 'y':0}, {'x':3, 'y':0}], 'scale_factor': 1}
        answer_key = {'targets': [{'shape':'point', 'idx':0}, {'shape':'point', 'idx':1}, {'shape':'point', 'idx':2}, {'shape':'point', 'idx':3}]}
        
        result = service.evaluate_click_task(user_input, answer_key, task_data=task_data)
        
        assert result.score == 50.0
        assert result.success is True
        assert "Правильно!" in result.message

    def test_click_combined_score_with_labels(self, service):
        """Проверка комбинированного скора (клики + названия)"""
        # 4 клика, все верные. Labels: 2 верных, 2 неверных.
        # Click Score: 100%
        # Label Score: 50%
        # Combined: 100*0.7 + 50*0.3 = 70 + 15 = 85.0
        
        service._check_point_target = MagicMock(return_value=True)
        # Mock _evaluate_labels to return 50% score
        service._evaluate_labels = MagicMock(return_value={'success': False, 'score': 50.0, 'message': 'Partial'})
        
        task_data = {'content': {'requires_labels': True}}
        user_input = {'clicks': [{'x':0, 'y':0}]*4, 'labels': ['a','b','c','d'], 'scale_factor': 1}
        answer_key = {'targets': [{'shape':'point', 'label':'a'}]*4}
        
        result = service.evaluate_click_task(user_input, answer_key, task_data=task_data)
        
        assert result.score == 85.0
        assert result.success is False # Combined success requires label success too
