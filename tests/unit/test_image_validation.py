"""
Unit tests for image path validation.
"""

import pytest
from pydantic import ValidationError, BaseModel, validator
from task_system.core.models.task_models import (
    validate_image_path_format,
    ClickTaskContent,
    DrawTaskContent,
    TestQuestion,
    TestTaskContent,
    SequenceElement,
    OpenAnswerTaskContent
)

class TestImageValidatorFunction:
    """Tests for the reusable validate_image_path_format function."""
    
    def test_valid_image_paths(self):
        """Test valid relative image paths with allowed extensions."""
        valid_paths = [
            "image.png",
            "folder/image.jpg",
            "nested/path/photo.jpeg",
            "img.gif",
            "icon.svg",
            "photo.webp",
            "IMAGE.PNG",  # Case insensitive
        ]
        for path in valid_paths:
            assert validate_image_path_format(path) == path
            
    def test_none_path(self):
        """Test that None is accepted (optional field)."""
        assert validate_image_path_format(None) is None
        
    def test_absolute_paths_fail(self):
        """Test that absolute paths are rejected."""
        invalid_paths = [
            "/absolute/path/image.png",
            "C:/Windows/image.jpg",
            "\\server\\share\\image.png",
        ]
        for path in invalid_paths:
            with pytest.raises(ValueError, match="Image path must be relative"):
                validate_image_path_format(path)
                
    def test_invalid_extensions_fail(self):
        """Test that invalid extensions are rejected."""
        invalid_paths = [
            "image.txt",
            "script.py",
            "image",  # No extension
            "image.bmp",  # Not in allowed list
        ]
        for path in invalid_paths:
            with pytest.raises(ValueError, match="Invalid image extension"):
                validate_image_path_format(path)


class TestModelImageValidation:
    """Tests for image validation integrated into models."""
    
    def test_click_task_image_validation(self):
        """Test image validation in ClickTaskContent."""
        # Valid
        ClickTaskContent(image="test.png", prompt="Test")
        
        # Invalid extension
        with pytest.raises(ValidationError, match="Invalid image extension"):
            ClickTaskContent(image="test.txt", prompt="Test")
            
        # Absolute path
        with pytest.raises(ValidationError, match="Image path must be relative"):
            ClickTaskContent(image="/img.png", prompt="Test")
            
    def test_draw_task_image_validation(self):
        """Test image validation in DrawTaskContent."""
        DrawTaskContent(image="test.jpg", prompt="Draw")
        
        with pytest.raises(ValidationError, match="Invalid image extension"):
            DrawTaskContent(image="test.exe", prompt="Draw")

    def test_open_answer_task_image_validation(self):
        """Test image validation in OpenAnswerTaskContent."""
        # Optional image
        OpenAnswerTaskContent(question="Q", image=None)
        OpenAnswerTaskContent(question="Q", image="test.png")
        
        with pytest.raises(ValidationError, match="Invalid image extension"):
            OpenAnswerTaskContent(question="Q", image="test.pdf")

    def test_test_task_image_validation(self):
        """Test image validation in TestTaskContent."""
        # Optional task image
        TestTaskContent(
            test_type="single_choice",
            questions=[{"text": "Q", "options": [{"text": "A", "is_correct": True}, {"text": "B", "is_correct": False}]}],
            image="test.png"
        )
        
        with pytest.raises(ValidationError, match="Image path must be relative"):
            TestTaskContent(
                test_type="single_choice",
                questions=[{"text": "Q", "options": [{"text": "A", "is_correct": True}, {"text": "B", "is_correct": False}]}],
                image="/test.png"
            )

    def test_test_question_image_validation(self):
        """Test image validation in TestQuestion (single and list)."""
        # Single image
        TestQuestion(
            text="Q",
            options=[{"text": "A", "is_correct": True}, {"text": "B", "is_correct": False}],
            image="img.png"
        )
        
        # Multiple images
        TestQuestion(
            text="Q",
            options=[{"text": "A", "is_correct": True}, {"text": "B", "is_correct": False}],
            images=["img1.jpg", "img2.svg"]
        )

        # Canonical object refs
        question = TestQuestion(
            text="Q",
            options=[{"text": "A", "is_correct": True}, {"text": "B", "is_correct": False}],
            images=[{"path": "img1.jpg", "asset_id": "asset_img_1"}, {"image_asset_url": "/api/assets/asset_img_2/content"}]
        )
        assert question.images[0].path == "img1.jpg"
        assert question.images[1].asset_url == "/api/assets/asset_img_2/content"
        
        # Invalid single
        with pytest.raises(ValidationError, match="Invalid image extension"):
            TestQuestion(
                text="Q",
                options=[{"text": "A", "is_correct": True}, {"text": "B", "is_correct": False}],
                image="img.bmp"
            )
            
        # Invalid list item
        with pytest.raises(ValidationError, match="Invalid image extension"):
            TestQuestion(
                text="Q",
                options=[{"text": "A", "is_correct": True}, {"text": "B", "is_correct": False}],
                images=["valid.png", "invalid.txt"]
            )

        with pytest.raises(ValidationError, match="At most 3 images"):
            TestQuestion(
                text="Q",
                options=[{"text": "A", "is_correct": True}, {"text": "B", "is_correct": False}],
                images=["1.png", "2.png", "3.png", "4.png"]
            )

    def test_sequence_element_image_validation(self):
        """Test image validation in SequenceElement."""
        SequenceElement(id="1", order=0, image="step.png")
        
        with pytest.raises(ValidationError, match="Invalid image extension"):
            SequenceElement(id="1", order=0, image="step.doc")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
