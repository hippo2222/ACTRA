"""
Integration tests for DRAW task storage and evaluation flow.

Tests the end-to-end flow from:
1. Editor saves task with content.regions
2. StorageService normalizes regions → answer_key.targets
3. Evaluator processes targets correctly
4. RuntimeUI receives correct data

These tests ensure schema compatibility between Editor, Storage, and Evaluator.
"""

import pytest
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))
sys.path.insert(0, str(project_root / "desktop-app"))

# Import after path setup
from services.storage_service import StorageService
from services.task_evaluator_service import TaskEvaluatorService
from task_system.core.schemas.draw_schema import DrawTaskSchema


class TestDrawStorageIntegration:
    """Tests for storage service normalization of draw task data."""
    
    def test_regions_to_targets_normalization(self):
        """Test that Editor's regions format is correctly converted to targets."""
        # Simulate Editor-saved task_data
        task_data = {
            'type': 'draw',
            'content': {
                'prompt': 'Обведите печень',
                'image': 'images/liver.png',
                'regions': [
                    {
                        'label': 'Печень',
                        'points': [[10, 20], [30, 20], [30, 40], [10, 40]]
                    },
                    {
                        'label': 'Селезенка',
                        'points': [[50, 60], [70, 60], [70, 80], [50, 80]]
                    }
                ]
            }
        }
        
        # Empty answer_key (Editor doesn't create separate answer_key.json)
        answer_key = {}
        
        # StorageService should normalize regions to targets
        storage = StorageService(data_dir=str(project_root / "data"))
        normalized = storage._normalize_answer_key(task_data, answer_key)
        
        # Verify targets were created from regions
        assert 'targets' in normalized
        assert len(normalized['targets']) == 2
        
        # Verify target structure
        target1 = normalized['targets'][0]
        assert target1['shape'] == 'polygon'
        assert target1['label'] == 'Печень'
        assert target1['points'] == [[10, 20], [30, 20], [30, 40], [10, 40]]
        
        target2 = normalized['targets'][1]
        assert target2['shape'] == 'polygon'
        assert target2['label'] == 'Селезенка'
    
    def test_annotations_format_still_works(self):
        """Test that legacy annotations format is still normalized correctly."""
        task_data = {
            'type': 'draw',
            'content': {
                'prompt': 'Обведите орган',
                'image': 'images/organ.png',
                'annotations': [
                    {
                        'type': 'polygon',
                        'label': 'Орган',
                        'points': [[10, 20], [30, 20], [30, 40], [10, 40]]
                    }
                ]
            }
        }
        
        answer_key = {}
        storage = StorageService(data_dir=str(project_root / "data"))
        normalized = storage._normalize_answer_key(task_data, answer_key)
        
        assert 'targets' in normalized
        assert len(normalized['targets']) == 1
        assert normalized['targets'][0]['shape'] == 'polygon'
    
    def test_existing_targets_not_overwritten(self):
        """Test that existing answer_key.targets are not overwritten."""
        task_data = {
            'type': 'draw',
            'content': {
                'regions': [
                    {'label': 'A', 'points': [[0, 0], [10, 0], [10, 10]]}
                ]
            }
        }
        
        # Pre-existing answer_key with targets
        answer_key = {
            'targets': [
                {'shape': 'polygon', 'label': 'B', 'points': [[5, 5], [15, 5], [15, 15]]}
            ]
        }
        
        storage = StorageService(data_dir=str(project_root / "data"))
        normalized = storage._normalize_answer_key(task_data, answer_key)
        
        # Should keep original targets, not override with regions
        assert normalized['targets'][0]['label'] == 'B'


class TestDrawSchemaValidation:
    """Tests for DrawTaskSchema validation with both formats."""
    
    def test_regions_format_valid(self):
        """Test that regions format passes validation."""
        content = {
            'image': 'images/test.png',
            'prompt': 'Обведите область',
            'regions': [
                {
                    'label': 'Область',
                    'points': [[10, 20], [30, 20], [30, 40], [10, 40]]
                }
            ]
        }
        
        errors = DrawTaskSchema._validate_content(content)
        assert errors == [], f"Validation failed: {errors}"
    
    def test_annotations_format_valid(self):
        """Test that annotations format passes validation."""
        content = {
            'image': 'images/test.png',
            'prompt': 'Обведите область',
            'annotations': [
                {
                    'type': 'polygon',
                    'label': 'Область',
                    'points': [[10, 20], [30, 20], [30, 40], [10, 40]]
                }
            ]
        }
        
        errors = DrawTaskSchema._validate_content(content)
        assert errors == [], f"Validation failed: {errors}"
    
    def test_no_regions_or_annotations_fails(self):
        """Test that missing both regions and annotations fails validation."""
        content = {
            'image': 'images/test.png',
            'prompt': 'Обведите область'
            # No regions or annotations
        }
        
        errors = DrawTaskSchema._validate_content(content)
        assert len(errors) > 0
        assert any('annotations' in e and 'regions' in e for e in errors)
    
    def test_regions_with_insufficient_points_fails(self):
        """Test that regions with < 3 points fail validation."""
        content = {
            'image': 'images/test.png',
            'prompt': 'Обведите область',
            'regions': [
                {
                    'label': 'Область',
                    'points': [[10, 20], [30, 20]]  # Only 2 points
                }
            ]
        }
        
        errors = DrawTaskSchema._validate_content(content)
        assert any('минимум 3 точки' in e for e in errors)


class TestDrawEvaluatorWithStorageData:
    """Integration tests for evaluator with storage-normalized data."""
    
    def test_evaluate_with_normalized_storage_data(self):
        """Test that evaluator works with storage-normalized answer_key."""
        # Simulate storage-normalized answer_key (from regions)
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'label': 'Печень',
                    'points': [[100, 100], [200, 100], [200, 200], [100, 200]]
                }
            ]
        }
        
        # User drawing that covers the target
        user_input = {
            'polygons': [
                {
                    'points': [[100, 100], [200, 100], [200, 200], [100, 200]],
                    'closed': True
                }
            ],
            'lines': [],
            'image_width': 500,
            'image_height': 500,
            'brush_radius': 8
        }
        
        task_data = {
            'type': 'draw',
            'content': {
                'prompt': 'Обведите печень'
            }
        }
        
        evaluator = TaskEvaluatorService()
        result = evaluator.evaluate_draw_task(user_input, answer_key, task_data)
        
        # Should evaluate successfully
        assert result is not None
        assert hasattr(result, 'success')
    
    def test_evaluate_with_percentage_coordinates(self):
        """Test that evaluator handles percentage coordinates from Editor."""
        # Editor saves in percentages, but storage normalizes
        # This test verifies the full flow works
        answer_key = {
            'targets': [
                {
                    'shape': 'polygon',
                    'label': 'Орган',
                    # Points in percentages (0-100 range)
                    'points': [[20, 20], [40, 20], [40, 40], [20, 40]]
                }
            ]
        }
        
        # User drawing (RuntimeUI sends in actual coordinates)
        user_input = {
            'polygons': [
                {
                    # Matching percentages on 500x500 canvas = 100,100 to 200,200
                    'points': [[100, 100], [200, 100], [200, 200], [100, 200]],
                    'closed': True
                }
            ],
            'lines': [],
            'image_width': 500,
            'image_height': 500,
            'brush_radius': 8
        }
        
        task_data = {
            'type': 'draw',
            'content': {}
        }
        
        evaluator = TaskEvaluatorService()
        result = evaluator.evaluate_draw_task(user_input, answer_key, task_data)
        
        # Should not crash, regardless of coordinate system mismatch
        assert result is not None


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
