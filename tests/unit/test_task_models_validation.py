"""
Unit tests for task_models validation improvements.

Tests the new typed models for test questions, annotations, and other enhancements.
"""

import pytest
from pydantic import ValidationError

from task_system.core.models.task_models import (
    TestOption,
    TestQuestion,
    TestTaskContent,
)


class TestTestQuestionValidation:
    """Tests for TestOption and TestQuestion models."""
    
    def test_valid_test_option(self):
        """Test creating a valid test option."""
        option = TestOption(text="Option A", is_correct=True)
        assert option.text == "Option A"
        assert option.is_correct is True
    
    def test_valid_test_question(self):
        """Test creating a valid test question with correct answer."""
        question = TestQuestion(
            text="What is the capital of France?",
            options=[
                TestOption(text="Paris", is_correct=True),
                TestOption(text="London", is_correct=False),
                TestOption(text="Berlin", is_correct=False),
            ]
        )
        assert question.text == "What is the capital of France?"
        assert len(question.options) == 3
        assert question.options[0].is_correct is True
    
    def test_question_with_image(self):
        """Test question with optional image field."""
        question = TestQuestion(
            text="Identify the structure",
            options=[
                TestOption(text="Option A", is_correct=True),
                TestOption(text="Option B", is_correct=False),
            ],
            image="question1.png"
        )
        assert question.image == "question1.png"
    
    def test_question_with_multiple_images(self):
        """Test question with multiple images."""
        question = TestQuestion(
            text="Compare these images",
            options=[
                TestOption(text="Same", is_correct=True),
                TestOption(text="Different", is_correct=False),
            ],
            images=["img1.png", "img2.png"]
        )
        assert len(question.images) == 2

    def test_question_with_object_image_refs(self):
        """Test question with canonical object image refs."""
        question = TestQuestion(
            text="Compare these images",
            options=[
                TestOption(text="Same", is_correct=True),
                TestOption(text="Different", is_correct=False),
            ],
            images=[
                {"path": "img1.png", "asset_id": "asset_1", "asset_url": "/api/assets/asset_1/content"},
                {"image_asset_id": "asset_2"},
            ],
        )
        assert len(question.images) == 2
        assert question.images[0].asset_id == "asset_1"
        assert question.images[1].asset_id == "asset_2"

    def test_question_rejects_more_than_three_images(self):
        """Test question image limit."""
        with pytest.raises(ValidationError, match="At most 3 images"):
            TestQuestion(
                text="Too many images",
                options=[
                    TestOption(text="A", is_correct=True),
                    TestOption(text="B", is_correct=False),
                ],
                images=["img1.png", "img2.png", "img3.png", "img4.png"],
            )
    
    def test_question_without_correct_answer_fails(self):
        """Test that question without correct answer raises validation error."""
        with pytest.raises(ValidationError) as exc_info:
            TestQuestion(
                text="Invalid question",
                options=[
                    TestOption(text="Option A", is_correct=False),
                    TestOption(text="Option B", is_correct=False),
                ]
            )
        assert "At least one option must be marked as correct" in str(exc_info.value)
    
    def test_question_with_less_than_two_options_fails(self):
        """Test that question with less than 2 options fails."""
        with pytest.raises(ValidationError) as exc_info:
            TestQuestion(
                text="Invalid question",
                options=[
                    TestOption(text="Only option", is_correct=True),
                ]
            )
        assert "min_items" in str(exc_info.value).lower() or "at least 2" in str(exc_info.value).lower()


class TestTestTaskContentValidation:
    """Tests for TestTaskContent with new validation."""
    
    def test_valid_test_task_with_typed_questions(self):
        """Test creating test task with typed TestQuestion objects."""
        content = TestTaskContent(
            test_type="single_choice",
            questions=[
                TestQuestion(
                    text="Question 1",
                    options=[
                        TestOption(text="A", is_correct=True),
                        TestOption(text="B", is_correct=False),
                    ]
                )
            ]
        )
        assert len(content.questions) == 1
        assert isinstance(content.questions[0], TestQuestion)
    
    def test_backward_compatibility_with_dict_questions(self):
        """Test that legacy dict format still works (backward compatibility)."""
        content = TestTaskContent(
            test_type="multiple_choice",
            questions=[
                {
                    "text": "Question 1",
                    "options": [
                        {"text": "A", "is_correct": True},
                        {"text": "B", "is_correct": False},
                    ]
                }
            ]
        )
        assert len(content.questions) == 1
        # Should be converted to TestQuestion
        assert isinstance(content.questions[0], TestQuestion)
    
    def test_legacy_answers_format_conversion(self):
        """Test conversion from legacy 'answers' to 'options' format."""
        content = TestTaskContent(
            test_type="single_choice",
            questions=[
                {
                    "text": "Question 1",
                    "answers": [
                        {"text": "A", "correct": True},
                        {"text": "B", "correct": False},
                    ]
                }
            ]
        )
        assert len(content.questions) == 1
        assert isinstance(content.questions[0], TestQuestion)
        assert content.questions[0].options[0].is_correct is True
    
    def test_test_type_validation(self):
        """Test that invalid test_type is rejected."""
        with pytest.raises(ValidationError) as exc_info:
            TestTaskContent(
                test_type="invalid_type",
                questions=[
                    {
                        "text": "Question 1",
                        "options": [
                            {"text": "A", "is_correct": True},
                            {"text": "B", "is_correct": False},
                        ]
                    }
                ]
            )
        assert "single_choice" in str(exc_info.value) or "multiple_choice" in str(exc_info.value)
    
    def test_empty_questions_list_fails(self):
        """Test that empty questions list is rejected."""
        with pytest.raises(ValidationError) as exc_info:
            TestTaskContent(
                test_type="single_choice",
                questions=[]
            )
        assert "min_items" in str(exc_info.value).lower() or "at least 1" in str(exc_info.value).lower()
    
    def test_test_task_with_image(self):
        """Test test task with optional image."""
        content = TestTaskContent(
            test_type="single_choice",
            image="test_image.png",
            questions=[
                TestQuestion(
                    text="Question 1",
                    options=[
                        TestOption(text="A", is_correct=True),
                        TestOption(text="B", is_correct=False),
                    ]
                )
            ]
        )
        assert content.image == "test_image.png"
    
    def test_mixed_typed_and_dict_questions(self):
        """Test that we can have both typed and dict questions (for migration scenarios)."""
        content = TestTaskContent(
            test_type="single_choice",
            questions=[
                TestQuestion(
                    text="Typed question",
                    options=[
                        TestOption(text="A", is_correct=True),
                        TestOption(text="B", is_correct=False),
                    ]
                ),
                {
                    "text": "Dict question",
                    "options": [
                        {"text": "C", "is_correct": True},
                        {"text": "D", "is_correct": False},
                    ]
                }
            ]
        )
        assert len(content.questions) == 2
        assert all(isinstance(q, TestQuestion) for q in content.questions)


class TestAnnotationModels:
    """Tests for typed annotation models."""
    
    def test_valid_point_annotation(self):
        """Test creating a valid point annotation."""
        from task_system.core.models.task_models import PointAnnotation
        
        point = PointAnnotation(type='point', x=100.5, y=200.3)
        assert point.type == 'point'
        assert point.x == 100.5
        assert point.y == 200.3
        assert point.label is None
    
    def test_point_annotation_with_label(self):
        """Test point annotation with optional label."""
        from task_system.core.models.task_models import PointAnnotation
        
        point = PointAnnotation(type='point', x=50, y=75, label="Target point")
        assert point.label == "Target point"
    
    def test_valid_polygon_annotation(self):
        """Test creating a valid polygon annotation."""
        from task_system.core.models.task_models import PolygonAnnotation
        
        polygon = PolygonAnnotation(
            type='polygon',
            points=[
                {'x': 0, 'y': 0},
                {'x': 100, 'y': 0},
                {'x': 50, 'y': 100}
            ]
        )
        assert polygon.type == 'polygon'
        assert len(polygon.points) == 3
    
    def test_polygon_with_less_than_three_points_fails(self):
        """Test that polygon with less than 3 points fails."""
        from task_system.core.models.task_models import PolygonAnnotation
        
        with pytest.raises(ValidationError):
            PolygonAnnotation(
                type='polygon',
                points=[
                    {'x': 0, 'y': 0},
                    {'x': 100, 'y': 0}
                ]
            )
    
    def test_valid_freehand_annotation(self):
        """Test creating a valid freehand annotation."""
        from task_system.core.models.task_models import FreehandAnnotation
        
        freehand = FreehandAnnotation(
            type='freehand',
            path="M 10 10 L 50 50 L 100 10"
        )
        assert freehand.type == 'freehand'
        assert freehand.path == "M 10 10 L 50 50 L 100 10"


class TestClickTaskContentAnnotations:
    """Tests for ClickTaskContent with typed annotations."""
    
    def test_click_task_with_typed_point_annotation(self):
        """Test ClickTaskContent with typed PointAnnotation."""
        from task_system.core.models.task_models import ClickTaskContent, PointAnnotation
        
        content = ClickTaskContent(
            image="test.png",
            prompt="Click the target",
            annotations=[
                PointAnnotation(type='point', x=100, y=200)
            ]
        )
        assert len(content.annotations) == 1
        assert isinstance(content.annotations[0], PointAnnotation)
    
    def test_click_task_with_dict_annotations_converts(self):
        """Test that dict annotations are converted to typed objects."""
        from task_system.core.models.task_models import ClickTaskContent, PointAnnotation
        
        content = ClickTaskContent(
            image="test.png",
            prompt="Click the target",
            annotations=[
                {'type': 'point', 'x': 100, 'y': 200}
            ]
        )
        assert len(content.annotations) == 1
        assert isinstance(content.annotations[0], PointAnnotation)
    
    def test_click_task_with_mixed_annotation_types(self):
        """Test ClickTaskContent with multiple annotation types."""
        from task_system.core.models.task_models import (
            ClickTaskContent, PointAnnotation, PolygonAnnotation
        )
        
        content = ClickTaskContent(
            image="test.png",
            prompt="Annotate the image",
            annotations=[
                {'type': 'point', 'x': 50, 'y': 50},
                {'type': 'polygon', 'points': [
                    {'x': 0, 'y': 0},
                    {'x': 100, 'y': 0},
                    {'x': 50, 'y': 100}
                ]}
            ]
        )
        assert len(content.annotations) == 2
        assert isinstance(content.annotations[0], PointAnnotation)
        assert isinstance(content.annotations[1], PolygonAnnotation)
    
    def test_click_task_with_unknown_annotation_type_keeps_dict(self):
        """Test that unknown annotation types are kept as dict for backward compatibility."""
        from task_system.core.models.task_models import ClickTaskContent
        
        content = ClickTaskContent(
            image="test.png",
            prompt="Test",
            annotations=[
                {'type': 'unknown_type', 'data': 'some data'}
            ]
        )
        assert len(content.annotations) == 1
        assert isinstance(content.annotations[0], dict)


class TestDrawTaskContentAnnotations:
    """Tests for DrawTaskContent with typed annotations."""
    
    def test_draw_task_with_typed_annotations(self):
        """Test DrawTaskContent with typed annotations."""
        from task_system.core.models.task_models import DrawTaskContent, PolygonAnnotation
        
        content = DrawTaskContent(
            image="test.png",
            prompt="Draw the region",
            annotations=[
                PolygonAnnotation(
                    type='polygon',
                    points=[
                        {'x': 0, 'y': 0},
                        {'x': 100, 'y': 0},
                        {'x': 50, 'y': 100}
                    ]
                )
            ]
        )
        assert len(content.annotations) == 1
        assert isinstance(content.annotations[0], PolygonAnnotation)
    
    def test_draw_task_backward_compatibility(self):
        """Test that DrawTaskContent maintains backward compatibility with dict annotations."""
        from task_system.core.models.task_models import DrawTaskContent, FreehandAnnotation
        
        content = DrawTaskContent(
            image="test.png",
            prompt="Draw freehand",
            annotations=[
                {'type': 'freehand', 'path': 'M 0 0 L 100 100'}
            ]
        )
        assert len(content.annotations) == 1
        assert isinstance(content.annotations[0], FreehandAnnotation)


class TestOpenAnswerTaskContentValidation:
    """Tests for OpenAnswerTaskContent with new fields."""
    
    def test_valid_open_answer_task(self):
        """Test creating a valid open answer task with new fields."""
        from task_system.core.models.task_models import OpenAnswerTaskContent
        
        content = OpenAnswerTaskContent(
            question="What is the meaning of life?",
            sample_answers=["42", "Forty-two"],
            min_length=1,
            max_length=100,
            case_sensitive=False
        )
        assert content.question == "What is the meaning of life?"
        assert len(content.sample_answers) == 2
        assert content.min_length == 1
    
    def test_max_length_validation(self):
        """Test that max_length must be >= min_length."""
        from task_system.core.models.task_models import OpenAnswerTaskContent
        
        with pytest.raises(ValidationError) as exc_info:
            OpenAnswerTaskContent(
                question="Test",
                min_length=10,
                max_length=5
            )
        assert "max_length" in str(exc_info.value)
        assert "must be greater than or equal to min_length" in str(exc_info.value)


class TestSequenceAssemblyTaskContentValidation:
    """Tests for SequenceAssemblyTaskContent with typed elements."""
    
    def test_valid_sequence_task_with_typed_elements(self):
        """Test sequence task with typed SequenceElement objects."""
        from task_system.core.models.task_models import SequenceAssemblyTaskContent, SequenceElement
        
        content = SequenceAssemblyTaskContent(
            prompt="Order the steps",
            elements=[
                SequenceElement(id="step1", text="Step 1", order=0),
                SequenceElement(id="step2", text="Step 2", order=1),
            ]
        )
        assert len(content.elements) == 2
        assert isinstance(content.elements[0], SequenceElement)
        assert content.elements[0].order == 0
    
    def test_sequence_backward_compatibility(self):
        """Test that dict elements are converted to SequenceElement objects."""
        from task_system.core.models.task_models import SequenceAssemblyTaskContent, SequenceElement
        
        content = SequenceAssemblyTaskContent(
            prompt="Order the steps",
            elements=[
                {"id": "step1", "text": "Step 1", "order": 0},
                {"id": "step2", "text": "Step 2", "order": 1},
            ]
        )
        assert len(content.elements) == 2
        assert isinstance(content.elements[0], SequenceElement)
    
    def test_mixed_sequence_elements(self):
        """Test mixed typed and dict elements in sequence task."""
        from task_system.core.models.task_models import SequenceAssemblyTaskContent, SequenceElement
        
        content = SequenceAssemblyTaskContent(
            prompt="Order",
            elements=[
                SequenceElement(id="step1", text="Step 1", order=0),
                {"id": "step2", "text": "Step 2", "order": 1},
            ]
        )
        assert len(content.elements) == 2
        assert all(isinstance(el, SequenceElement) for el in content.elements)
    
    def test_min_items_validation(self):
        """Test that at least 2 elements are required."""
        from task_system.core.models.task_models import SequenceAssemblyTaskContent, SequenceElement
        
        with pytest.raises(ValidationError):
            SequenceAssemblyTaskContent(
                prompt="Invalid",
                elements=[
                    SequenceElement(id="step1", text="Only one", order=0)
                ]
            )


class TestSequenceAssemblyTaskSchemaValidation:
    """Tests for SequenceAssemblyTaskSchema validation including block ID uniqueness."""
    
    def test_duplicate_block_ids_in_level_rejected(self):
        """Test that duplicate block IDs within a level are rejected (Fix 2)."""
        from task_system.core.schemas.sequence_assembly_schema import SequenceAssemblyTaskSchema
        
        # Content with duplicate block IDs within the same level
        invalid_content = {
            'elements': [
                {'id': 'elem_1', 'text': 'Step 1'},
                {'id': 'elem_2', 'text': 'Step 2'},
            ],
            'levels': [
                {
                    'level_id': 'level_1',
                    'blocks': ['elem_1', 'elem_1'],  # Duplicate!
                }
            ]
        }
        
        task_data = {'type': 'sequence_assembly', 'content': invalid_content}
        errors = SequenceAssemblyTaskSchema.validate(task_data)
        
        # Should contain a duplicate error
        assert any('дублируется' in err for err in errors), f"Expected duplicate error, got: {errors}"
    
    def test_unique_block_ids_accepted(self):
        """Test that unique block IDs are accepted."""
        from task_system.core.schemas.sequence_assembly_schema import SequenceAssemblyTaskSchema
        
        valid_content = {
            'elements': [
                {'id': 'elem_1', 'text': 'Step 1'},
                {'id': 'elem_2', 'text': 'Step 2'},
            ],
            'levels': [
                {
                    'level_id': 'level_1',
                    'blocks': ['elem_1', 'elem_2'],  # All unique
                }
            ]
        }
        
        task_data = {'type': 'sequence_assembly', 'content': valid_content}
        errors = SequenceAssemblyTaskSchema.validate(task_data)
        
        # Should not contain duplicate errors
        assert not any('дублируется' in err for err in errors), f"Unexpected duplicate error: {errors}"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
