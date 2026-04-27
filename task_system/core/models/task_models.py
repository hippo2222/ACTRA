"""
Pydantic models for task data structures.

This module defines Pydantic models for validating task.json structures,
ensuring type safety and data integrity.
"""

from datetime import datetime
from typing import Optional, Union, List, Dict, Any, Literal
from pathlib import Path
from pydantic import BaseModel, Field, validator, root_validator
import warnings
import logging
import re

from task_system.migrations import CURRENT_SCHEMA_VERSION
from .path_resolver import PathResolver

logger = logging.getLogger(__name__)


def is_direct_image_url(value: Optional[str]) -> bool:
    raw = str(value or "").strip()
    return bool(
        raw.startswith("/api/assets/")
        or raw.startswith("/api/editor/image")
        or raw.startswith("/api/local-image")
        or raw.startswith("http://")
        or raw.startswith("https://")
        or raw.startswith("data:")
    )


def normalize_image_ref_to_string(v: Any) -> Any:
    """Normalize editor image refs to a single string accepted by legacy models."""
    if v is None or isinstance(v, str):
        return v

    if isinstance(v, Path):
        return str(v)

    if not isinstance(v, dict):
        return v

    nested = v.get("image") if isinstance(v.get("image"), dict) else {}
    image_value = v.get("image")
    src_value = v.get("src")

    path = (
        v.get("path")
        or v.get("image_path")
        or (image_value if isinstance(image_value, str) and not is_direct_image_url(image_value) else None)
        or (src_value if isinstance(src_value, str) and not is_direct_image_url(src_value) else None)
        or nested.get("path")
        or nested.get("image_path")
        or nested.get("src")
    )
    if path and not is_direct_image_url(str(path)):
        return str(path).strip()

    asset_url = (
        v.get("asset_url")
        or v.get("image_asset_url")
        or v.get("image_url")
        or v.get("url")
        or (v.get("path") if isinstance(v.get("path"), str) and is_direct_image_url(v.get("path")) else None)
        or (v.get("image_path") if isinstance(v.get("image_path"), str) and is_direct_image_url(v.get("image_path")) else None)
        or (image_value if isinstance(image_value, str) and is_direct_image_url(image_value) else None)
        or (src_value if isinstance(src_value, str) and is_direct_image_url(src_value) else None)
        or nested.get("asset_url")
        or nested.get("image_asset_url")
        or nested.get("image_url")
        or nested.get("url")
    )
    if asset_url:
        return str(asset_url).strip()

    asset_id = (
        v.get("asset_id")
        or v.get("image_asset_id")
        or nested.get("asset_id")
        or nested.get("image_asset_id")
    )
    if asset_id:
        clean_asset_id = str(asset_id).strip()
        if clean_asset_id:
            return f"/api/assets/{clean_asset_id}/content"

    return v


def validate_image_reference_format(v: Optional[Any]) -> Optional[str]:
    """Validate an image path or hosted/browser image URL."""
    normalized = normalize_image_ref_to_string(v)
    if normalized is None:
        return normalized
    if not isinstance(normalized, str):
        raise ValueError("Image reference must be a string path or hosted image reference")
    if normalized == "" or is_direct_image_url(normalized):
        return normalized
    return validate_image_path_format(normalized)


def validate_image_path_format(v: Optional[str]) -> Optional[str]:
    """Validate image path format (relative and extension)."""
    if v is None:
        return v
    
    # Allow empty string (some legacy tasks have "image": "")
    if v == "":
        return v
    
    # Check if absolute path (using stringent check for portability).
    # On Linux, Path("C:/...").is_absolute() is False, so we also detect
    # Windows drive-letter absolute paths explicitly.
    path = Path(v)
    has_windows_drive_abs = bool(re.match(r"^[a-zA-Z]:[\\/]", v))
    if path.is_absolute() or v.startswith('/') or v.startswith('\\') or has_windows_drive_abs:
        raise ValueError(f"Image path must be relative: {v}")
    
    # Check extension
    allowed_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'}
    if path.suffix.lower() not in allowed_extensions:
        raise ValueError(f"Invalid image extension: {path.suffix}. Must be one of {allowed_extensions}")
        
    return v


class TaskMetadata(BaseModel):
    """Metadata for a task."""
    
    task_schema_version: str = Field(
        ...,
        description="Schema version of the task"
    )
    created_at: datetime = Field(
        ...,
        description="Creation timestamp"
    )
    author: str = Field(
        default="",
        description="Author of the task"
    )
    name: Optional[str] = Field(
        None,
        description="Task name"
    )
    module: Optional[str] = Field(
        None,
        description="Module ID"
    )
    topic: Optional[str] = Field(
        None,
        description="Topic ID"
    )
    modified: Optional[datetime] = Field(
        None,
        description="Last modification timestamp"
    )
    version: Optional[str] = Field(
        None,
        description="Task version (for backward compatibility)"
    )
    
    @validator('task_schema_version')
    def validate_schema_version(cls, v):
        """Validate schema version compatibility."""
        if v != CURRENT_SCHEMA_VERSION:
            warnings.warn(
                f"Schema version mismatch: {v} vs {CURRENT_SCHEMA_VERSION}. "
                "Task may need migration.",
                UserWarning
            )
        return v
    
    @validator('created_at', pre=True)
    def parse_created_at(cls, v):
        """Parse created_at from string if needed."""
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace('Z', '+00:00'))
            except ValueError:
                # Try other formats
                for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%a, %d %b %Y %H:%M:%S %Z']:
                    try:
                        # For RFC 1123 strings (e.g. Thu, 13 Nov 2025 01:00:29 GMT)
                        parsed = datetime.strptime(v, fmt)
                        if fmt.endswith('%Z') and parsed.tzinfo is None:
                            # Normalize explicit GMT to UTC
                            return parsed.replace(tzinfo=datetime.utcfromtimestamp(0).tzinfo)
                        return parsed
                    except ValueError:
                        continue
                raise ValueError(f"Cannot parse datetime: {v}")
        return v
    
    @validator('modified', pre=True)
    def parse_modified(cls, v):
        """Parse modified from string if needed."""
        if v is None:
            return None
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace('Z', '+00:00'))
            except ValueError:
                for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d']:
                    try:
                        return datetime.strptime(v, fmt)
                    except ValueError:
                        continue
                return None
        return v
    
    class Config:
        """Pydantic config."""
        extra = "allow"  # Allow extra fields for backward compatibility


class ClickTaskSettings(BaseModel):
    """Settings specific to click tasks."""
    
    difficulty: int = Field(default=1, ge=1, le=5)
    time_limit: Optional[int] = Field(None, ge=1)
    allow_hints: bool = Field(default=False)
    tolerancePx: Optional[int] = Field(default=10, ge=1, le=100)
    success_threshold: Optional[int] = Field(
        default=None,
        ge=1,
        description="Minimum number of correct annotations required for success (None = all required)"
    )
    
    class Config:
        extra = "allow"


class DrawTaskSettings(BaseModel):
    """Settings specific to draw tasks."""
    
    difficulty: int = Field(default=1, ge=1, le=5)
    time_limit: Optional[int] = Field(None, ge=1)
    allow_hints: bool = Field(default=False)
    overlapThreshold: Optional[float] = Field(default=0.75, ge=0.0, le=1.0)
    success_threshold: Optional[int] = Field(
        default=None,
        ge=1,
        description="Minimum number of correct annotations required for success (None = all required)"
    )
    
    class Config:
        extra = "allow"


class BaseTaskSettings(BaseModel):
    """Base settings for all tasks."""
    
    difficulty: int = Field(default=1, ge=1, le=5)
    time_limit: Optional[int] = Field(None, ge=1)
    allow_hints: bool = Field(default=False)
    
    class Config:
        extra = "allow"


class TaskSettings(BaseModel):
    """Task settings (polymorphic based on task type)."""
    
    difficulty: int = Field(default=1, ge=1, le=5)
    time_limit: Optional[int] = Field(None, ge=1)
    allow_hints: bool = Field(default=False)
    # Task-specific settings
    tolerancePx: Optional[int] = Field(None, ge=1, le=100)
    overlapThreshold: Optional[float] = Field(None, ge=0.0, le=1.0)
    success_threshold: Optional[int] = Field(
        None,
        ge=1,
        description="Minimum number of correct annotations required for success"
    )
    
    class Config:
        extra = "allow"


class RelativePath(BaseModel):
    """Relative path that resolves relative to task.json."""
    
    path: str = Field(..., description="Relative path from task.json")
    
    def resolve(self, task_json_path: Path) -> Path:
        """Resolve path relative to task.json."""
        return PathResolver.resolve_relative_path(self.path, task_json_path)
    
    class Config:
        extra = "forbid"


class PointAnnotation(BaseModel):
    """Point annotation for click/draw tasks."""
    
    type: Literal['point'] = Field(..., description="Annotation type")
    x: float = Field(..., description="X coordinate")
    y: float = Field(..., description="Y coordinate")
    label: Optional[str] = Field(None, description="Optional label for the point")
    
    class Config:
        extra = "allow"


class PolygonAnnotation(BaseModel):
    """Polygon annotation for click/draw tasks."""
    
    type: Literal['polygon'] = Field(..., description="Annotation type")
    points: List[Dict[str, float]] = Field(..., min_items=3, description="Polygon vertices (minimum 3 points)")
    label: Optional[str] = Field(None, description="Optional label for the polygon")
    
    class Config:
        extra = "allow"


class FreehandAnnotation(BaseModel):
    """Freehand annotation for click/draw tasks."""
    
    type: Literal['freehand'] = Field(..., description="Annotation type")
    path: str = Field(..., description="SVG path data for freehand drawing")
    label: Optional[str] = Field(None, description="Optional label for the freehand annotation")
    
    class Config:
        extra = "allow"


# Union type for all annotation types
ClickAnnotation = Union[PointAnnotation, PolygonAnnotation, FreehandAnnotation, Dict[str, Any]]


class ClickTaskContent(BaseModel):
    """Content model for click tasks."""
    
    image: str = Field(..., description="Path to image (relative to task.json)")
    prompt: str = Field(..., description="Task prompt/instruction")
    annotations: Optional[List[ClickAnnotation]] = Field(
        None,
        description="Task annotations (supports types: 'point', 'polygon', 'freehand')"
    )
    additionalInfo: Optional[Dict[str, Any]] = Field(
        None,
        description="Additional information"
    )
    
    @validator('annotations', pre=True)
    def convert_annotations(cls, v):
        """Convert dict annotations to typed objects while maintaining backward compatibility."""
        if v is None or not isinstance(v, list):
            return v
        
        converted = []
        for item in v:
            if isinstance(item, dict) and 'type' in item:
                ann_type = item.get('type')
                try:
                    if ann_type == 'point':
                        converted.append(PointAnnotation(**item))
                    elif ann_type == 'polygon':
                        converted.append(PolygonAnnotation(**item))
                    elif ann_type == 'freehand':
                        converted.append(FreehandAnnotation(**item))
                    else:
                        # Unknown type, keep as dict for backward compatibility
                        converted.append(item)
                except Exception:
                    # If conversion fails, keep as dict
                    converted.append(item)
            else:
                converted.append(item)
        return converted
    
    class Config:
        extra = "allow"
    
    _validate_image = validator('image', pre=True, allow_reuse=True)(validate_image_reference_format)


class ErrorSpan(BaseModel):
    """Clickable span representing an error fragment."""

    start: int = Field(..., ge=0, description="Start index of the span (inclusive)")
    end: int = Field(..., ge=0, description="End index of the span (exclusive)")
    label: Optional[str] = Field(None, description="Optional label for the span")
    is_correct: bool = Field(
        default=False,
        description="Indicates if the span is correct (false for errors)",
    )

    @validator("end")
    def validate_range(cls, v, values):
        start = values.get("start")
        if start is not None and v <= start:
            raise ValueError("end must be greater than start")
        return v

    class Config:
        extra = "forbid"


class ReferenceSpan(BaseModel):
    """Reference fragment inside reference_text."""

    start: int = Field(..., ge=0, description="Start index of the reference span (inclusive)")
    end: int = Field(..., ge=0, description="End index of the reference span (exclusive)")

    @validator("end")
    def validate_range(cls, v, values):
        start = values.get("start")
        if start is not None and v <= start:
            raise ValueError("reference span end must be greater than start")
        return v

    class Config:
        extra = "forbid"


class TextOption(BaseModel):
    """Option for text_choice mode."""

    id: str = Field(..., description="Option identifier")
    text: str = Field(..., description="Option text")
    is_correct: bool = Field(..., description="Is this option correct")

    class Config:
        extra = "forbid"


class ErrorDetectionContent(BaseModel):
    """
    Content model for click tasks with subtype error_detection.

    Supports two modes:
    - text_errors: clickable spans inside a text
    - text_choice: selection among text options
    """

    mode: Literal["text_errors", "text_choice"] = Field(
        ..., description="Presentation mode for error detection task"
    )
    prompt: str = Field(..., description="Task prompt/instruction")
    choice_prompt: Optional[str] = Field(
        None,
        description="Optional prompt shown above answer options in text_choice mode",
    )
    subtype: Optional[str] = Field(
        None, description="Optional duplicated subtype marker kept for editor/runtime compatibility"
    )
    required_correct: Optional[int] = Field(
        1,
        description="Optional success threshold kept for compatibility with existing click/error_detection payloads",
    )

    # text_errors fields
    text: Optional[str] = Field(
        None, description="Full text containing error spans (for text_errors mode)"
    )
    error_spans: Optional[List[ErrorSpan]] = Field(
        None, description="List of error spans (for text_errors mode)"
    )
    require_all_errors: Optional[bool] = Field(
        default=True,
        description="If true, user must find all errors to succeed (text_errors mode)",
    )
    reference_text: Optional[str] = Field(
        None,
        description="Baseline reference text used for comparison and highlighting",
        max_length=4000,
    )
    reference_spans: Optional[List[ReferenceSpan]] = Field(
        None,
        description="List of highlighted fragments inside reference_text",
    )

    # text_choice fields
    options: Optional[List[TextOption]] = Field(
        None, description="List of text options (for text_choice mode)"
    )

    @root_validator(skip_on_failure=True)
    def validate_by_mode(cls, values):
        mode = values.get("mode")
        text = values.get("text")
        error_spans = values.get("error_spans")
        options = values.get("options")
        reference_text = values.get("reference_text")
        reference_spans = values.get("reference_spans")

        if mode == "text_errors":
            if not text:
                raise ValueError("text is required when mode is 'text_errors'")
            if error_spans is None or len(error_spans) == 0:
                raise ValueError("error_spans must be a non-empty list for text_errors")
            if reference_spans:
                if reference_text is None:
                    raise ValueError("reference_text is required when reference_spans are provided")
                text_len = len(reference_text)
                for idx, span in enumerate(reference_spans):
                    if span.end > text_len:
                        raise ValueError(
                            f"reference_spans[{idx}] exceeds reference_text length ({span.end}>{text_len})"
                        )
        elif mode == "text_choice":
            if options is None or len(options) < 2:
                raise ValueError(
                    "options must contain at least two items when mode is 'text_choice'"
                )
            correct_options = [opt for opt in options if opt.is_correct]
            if len(correct_options) != 1:
                raise ValueError(
                    "exactly one option must be marked is_correct when mode is 'text_choice'"
                )
        return values

    class Config:
        extra = "forbid"


class DrawTaskContent(BaseModel):
    """Content model for draw tasks."""
    
    _validate_image = validator('image', pre=True, allow_reuse=True)(validate_image_reference_format)
    
    image: str = Field(..., description="Path to image (relative to task.json)")
    prompt: str = Field(..., description="Task prompt/instruction")
    annotations: Optional[List[ClickAnnotation]] = Field(
        None,
        description="Task annotations (supports types: 'point', 'polygon', 'freehand')"
    )
    additionalInfo: Optional[Dict[str, Any]] = Field(
        None,
        description="Additional information"
    )
    
    @validator('annotations', pre=True)
    def convert_annotations(cls, v):
        """Convert dict annotations to typed objects while maintaining backward compatibility."""
        if v is None or not isinstance(v, list):
            return v
        
        converted = []
        for item in v:
            if isinstance(item, dict) and 'type' in item:
                ann_type = item.get('type')
                try:
                    if ann_type == 'point':
                        converted.append(PointAnnotation(**item))
                    elif ann_type == 'polygon':
                        converted.append(PolygonAnnotation(**item))
                    elif ann_type == 'freehand':
                        converted.append(FreehandAnnotation(**item))
                    else:
                        # Unknown type, keep as dict for backward compatibility
                        converted.append(item)
                except Exception:
                    # If conversion fails, keep as dict
                    converted.append(item)
            else:
                converted.append(item)
        return converted
    
    class Config:
        extra = "allow"


class OpenAnswerTaskContent(BaseModel):
    """Content model for open answer tasks."""
    
    image: Optional[str] = Field(None, description="Path to image (relative to task.json, optional)")
    images: Optional[List[str]] = Field(None, description="Array of image paths (editor multi-image)")
    question: str = Field(..., description="Question text")
    prompt: Optional[str] = Field(None, description="Legacy question field (synced with question)")
    keywords: Optional[List[str]] = Field(
        None,
        description="Keywords for evaluation"
    )
    reference_answer: Optional[str] = Field(None, description="Reference/model answer shown after evaluation")
    hint: Optional[str] = Field(None, description="Hint text for the student")
    sample_answers: Optional[List[str]] = Field(
        None,
        description="Example correct answers for reference"
    )
    min_length: Optional[int] = Field(
        None,
        ge=1,
        description="Minimum answer length in characters"
    )
    max_length: Optional[int] = Field(
        None,
        ge=1,
        description="Maximum answer length in characters"
    )
    case_sensitive: bool = Field(
        default=False,
        description="Whether keyword matching should be case-sensitive"
    )
    min_keywords: Optional[int] = Field(None, ge=1, description="Minimum keywords required for success")
    require_all_keywords: Optional[bool] = Field(None, description="Whether all keywords must be found")
    sequence_matters: Optional[bool] = Field(None, description="Whether keyword order matters")
    
    @validator('max_length')
    def validate_max_length(cls, v, values):
        """Ensure max_length is greater than min_length if both are set."""
        min_length = values.get('min_length')
        if v is not None and min_length is not None and v < min_length:
            raise ValueError(f"max_length ({v}) must be greater than or equal to min_length ({min_length})")
        return v
    
    _validate_image = validator('image', pre=True, allow_reuse=True)(validate_image_reference_format)
    
    class Config:
        extra = "allow"


class TestOption(BaseModel):
    """Option for a test question."""
    
    text: str = Field(..., description="Option text")
    is_correct: bool = Field(..., description="Whether this option is correct")
    
    class Config:
        extra = "allow"


_is_direct_image_url = is_direct_image_url


class TestQuestionImageRef(BaseModel):
    """Canonical image reference for a test question."""

    path: Optional[str] = Field(None, description="Relative local image path")
    asset_id: Optional[str] = Field(None, description="Hosted asset id")
    asset_url: Optional[str] = Field(None, description="Canonical hosted asset URL")

    @root_validator(pre=True, allow_reuse=True)
    def normalize_aliases(cls, values):
        """Accept legacy aliases used by editors and API enrichers."""
        if isinstance(values, str):
            return {"asset_url": values} if _is_direct_image_url(values) else {"path": values}
        if not isinstance(values, dict):
            return values

        nested = values.get("image") if isinstance(values.get("image"), dict) else {}
        image_value = values.get("image")
        src_value = values.get("src")
        path = (
            values.get("path")
            or values.get("image_path")
            or (image_value if isinstance(image_value, str) and not _is_direct_image_url(image_value) else None)
            or (src_value if isinstance(src_value, str) and not _is_direct_image_url(src_value) else None)
            or nested.get("path")
            or nested.get("image_path")
        )
        asset_url = (
            values.get("asset_url")
            or values.get("image_asset_url")
            or values.get("image_url")
            or values.get("url")
            or (image_value if isinstance(image_value, str) and _is_direct_image_url(image_value) else None)
            or (src_value if isinstance(src_value, str) and _is_direct_image_url(src_value) else None)
            or nested.get("asset_url")
            or nested.get("image_asset_url")
            or nested.get("image_url")
            or nested.get("url")
        )
        asset_id = (
            values.get("asset_id")
            or values.get("image_asset_id")
            or nested.get("asset_id")
            or nested.get("image_asset_id")
        )

        normalized = dict(values)
        if path and "path" not in normalized:
            normalized["path"] = path
        if asset_url and "asset_url" not in normalized:
            normalized["asset_url"] = asset_url
        if asset_id and "asset_id" not in normalized:
            normalized["asset_id"] = asset_id
        return normalized

    @root_validator(skip_on_failure=True, allow_reuse=True)
    def validate_ref(cls, values):
        path = values.get("path")
        asset_id = values.get("asset_id")
        asset_url = values.get("asset_url")
        if path:
            validate_image_path_format(path)
        if not path and not asset_id and not asset_url:
            raise ValueError("Image reference must include path, asset_id, or asset_url")
        return values

    class Config:
        extra = "allow"


def validate_test_question_image_ref(v: Any) -> Any:
    """Validate one test-question image ref while preserving legacy strings."""
    if isinstance(v, str):
        return v if _is_direct_image_url(v) else validate_image_path_format(v)
    if isinstance(v, TestQuestionImageRef):
        if v.path:
            validate_image_path_format(v.path)
        return v
    if isinstance(v, dict):
        return TestQuestionImageRef(**v)
    raise ValueError("Question image must be a string path or image reference object")


class TestQuestion(BaseModel):
    """Question for a test task."""
    
    _validate_image = validator('image', pre=True, allow_reuse=True)(validate_image_reference_format)
    
    @validator('images', allow_reuse=True)
    def validate_images_list(cls, v):
        if v is None:
            return v
        if len(v) > 3:
            raise ValueError("At most 3 images are allowed")
        return [validate_test_question_image_ref(item) for item in v]
    
    text: str = Field(..., description="Question text")
    options: List[TestOption] = Field(..., min_items=2, description="Answer options (minimum 2)")
    image: Optional[str] = Field(None, description="Optional image for this question")
    images: Optional[List[Union[str, TestQuestionImageRef]]] = Field(None, description="Optional multiple images for this question")
    
    @validator('options')
    def validate_correct_answer(cls, v):
        """Ensure at least one option is marked as correct."""
        if not any(opt.is_correct for opt in v):
            raise ValueError("At least one option must be marked as correct")
        return v
    
    class Config:
        extra = "allow"


class TestTaskContent(BaseModel):
    """Content model for test tasks."""
    
    _validate_image = validator('image', pre=True, allow_reuse=True)(validate_image_reference_format)
    
    image: Optional[str] = Field(
        None,
        description="Path to image (optional)"
    )
    questions: List[Union[TestQuestion, Dict[str, Any]]] = Field(
        ...,
        min_items=1,
        description="List of questions (supports both typed TestQuestion and legacy Dict format)"
    )
    test_type: str = Field(
        ...,
        description="Test type: single_choice or multiple_choice"
    )
    
    @validator('questions', pre=True)
    def convert_questions(cls, v):
        """Convert dict questions to TestQuestion objects while maintaining backward compatibility."""
        if not isinstance(v, list):
            return v
        
        converted = []
        for item in v:
            if isinstance(item, dict):
                # Try to convert to TestQuestion for validation
                try:
                    # Convert legacy 'answers' to 'options' if needed
                    if 'answers' in item and 'options' not in item:
                        item = item.copy()
                        item['options'] = [
                            {'text': ans.get('text', ''), 'is_correct': ans.get('correct', False)}
                            for ans in item['answers']
                        ]
                    converted.append(TestQuestion(**item))
                except Exception:
                    # If conversion fails, keep as dict for backward compatibility
                    converted.append(item)
            else:
                converted.append(item)
        return converted
    
    @validator('test_type')
    def validate_test_type(cls, v):
        """Validate test type."""
        if v not in ['single_choice', 'multiple_choice']:
            raise ValueError(f"Invalid test_type: {v}. Must be 'single_choice' or 'multiple_choice'")
        return v
    
    class Config:
        extra = "allow"


class SequenceElement(BaseModel):
    """Element for sequence assembly tasks."""
    
    id: str = Field(..., description="Element identifier")
    text: Optional[str] = Field(None, description="Element text content")
    image: Optional[str] = Field(None, description="Element image path")
    order: Optional[int] = Field(None, description="Correct position in sequence (0-indexed, optional)")
    
    class Config:
        extra = "allow"
    
    _validate_image = validator('image', pre=True, allow_reuse=True)(validate_image_reference_format)


class SequenceLevelBlock(BaseModel):
    """Level block for sequence assembly tasks."""
    
    level_id: str = Field(..., description="Level identifier")
    blocks: List[str] = Field(default_factory=list, description="Block IDs in this level")
    level_name: Optional[str] = Field(None, description="Human-readable level name")
    
    class Config:
        extra = "allow"


class SequenceAssemblyTaskContent(BaseModel):
    """Content model for sequence assembly tasks."""
    
    elements: List[Union[SequenceElement, Dict[str, Any]]] = Field(
        ...,
        min_items=2,
        description="Elements for assembly (minimum 2 elements required)"
    )
    prompt: str = Field(..., description="Task prompt/instruction")
    levels: Optional[List[Union[SequenceLevelBlock, Dict[str, Any]]]] = Field(
        None,
        description="Canonical level structure [{level_id, blocks, level_name?}]"
    )
    sequence: Optional[List[Dict[str, Any]]] = Field(
        None,
        description="Legacy editor format [{level_id, title, items:[{id,label}]}]"
    )
    level_order_matters: Optional[bool] = Field(
        None,
        description="Whether the order of levels matters for evaluation"
    )
    sequence_within_level_matters: Optional[bool] = Field(
        None,
        description="Whether the order of blocks within a level matters"
    )
    settings: Optional[Dict[str, Any]] = Field(
        None,
        description="Sequence assembly settings"
    )
    
    @validator('elements', pre=True)
    def convert_elements(cls, v):
        """Convert dict elements to SequenceElement objects while maintaining backward compatibility."""
        if not isinstance(v, list):
            return v
        
        converted = []
        for item in v:
            if isinstance(item, dict):
                try:
                    converted.append(SequenceElement(**item))
                except Exception:
                    # If conversion fails, keep as dict for backward compatibility
                    converted.append(item)
            else:
                converted.append(item)
        return converted
    
    @validator('levels', pre=True)
    def convert_levels(cls, v):
        """Convert dict levels to SequenceLevelBlock objects while maintaining backward compatibility."""
        if v is None or not isinstance(v, list):
            return v
        
        converted = []
        for item in v:
            if isinstance(item, dict):
                try:
                    converted.append(SequenceLevelBlock(**item))
                except Exception:
                    converted.append(item)
            else:
                converted.append(item)
        return converted
    
    class Config:
        extra = "allow"


# Union type for all content models (defined here for forward reference)
TaskContent = Union[
    ClickTaskContent,
    ErrorDetectionContent,
    DrawTaskContent,
    OpenAnswerTaskContent,
    TestTaskContent,
    SequenceAssemblyTaskContent,
]


def get_expected_content_model(task_type: Optional[str], subtype: Optional[str] = None):
    """Return the concrete content model for a task type/subtype pair."""
    if not task_type:
        return None

    type_to_content = {
        ('click', 'error_detection'): ErrorDetectionContent,
        ('click', None): ClickTaskContent,
        ('draw', None): DrawTaskContent,
        ('open_answer', None): OpenAnswerTaskContent,
        ('test', None): TestTaskContent,
        ('sequence_assembly', None): SequenceAssemblyTaskContent,
    }
    return type_to_content.get((task_type, subtype)) or type_to_content.get((task_type, None))


class ValidatedTask(BaseModel):
    """Validated task model with polymorphic content."""
    
    id: str = Field(..., description="Task ID")
    type: str = Field(
        ...,
        description="Task type: click, draw, open_answer, test, sequence_assembly"
    )
    subtype: Optional[str] = Field(
        None,
        description="Optional subtype for task (e.g., error_detection for click tasks)",
    )
    meta: TaskMetadata = Field(..., description="Task metadata")
    content: Union[
        ClickTaskContent,
        ErrorDetectionContent,
        DrawTaskContent,
        OpenAnswerTaskContent,
        TestTaskContent,
        SequenceAssemblyTaskContent,
    ] = Field(..., description="Task content (polymorphic)")
    settings: Optional[TaskSettings] = Field(None, description="Task settings")
    
    def __init__(self, **data):
        """Override __init__ to ensure content is converted to correct type."""
        # Преобразуем content в правильный тип ДО вызова super().__init__
        task_type = data.get('type')
        subtype = data.get('subtype')
        content = data.get('content')
        
        if task_type and content:
            expected_content_type = get_expected_content_model(task_type, subtype)
            if expected_content_type:
                # ВАЖНО: Используем точное сравнение типов вместо isinstance
                # чтобы различать ClickTaskContent и DrawTaskContent с одинаковой структурой
                content_actual_type = type(content)
                
                # Если content уже правильного типа - оставляем как есть
                if content_actual_type == expected_content_type:
                    pass  # Content already correct
                # Если content - объект BaseModel неправильного типа, преобразуем его
                elif isinstance(content, BaseModel):
                    try:
                        # Получаем словарь из существующего объекта
                        content_dict = content.dict() if hasattr(content, 'dict') else {}
                        # Создаем объект правильного типа
                        validated_content = expected_content_type(**content_dict)
                        data['content'] = validated_content
                    except Exception as e:
                        logger.warning(
                            f"Failed to convert content from {content_actual_type.__name__} to {expected_content_type.__name__} "
                            f"for task type '{task_type}': {e}"
                        )
                # Если content - словарь, преобразуем в нужный тип
                elif isinstance(content, dict):
                    try:
                        # Принудительно создаем нужный тип content
                        validated_content = expected_content_type(**content)
                        data['content'] = validated_content
                    except Exception as e:
                        logger.warning(
                            f"Failed to convert content to {expected_content_type.__name__} "
                            f"for task type '{task_type}': {e}"
                        )
        
        super().__init__(**data)
    
    @validator('type')
    def validate_type(cls, v):
        """Validate task type."""
        valid_types = ['click', 'draw', 'open_answer', 'test', 'sequence_assembly']
        if v not in valid_types:
            raise ValueError(f"Invalid task type: {v}. Must be one of {valid_types}")
        return v

    @validator('subtype')
    def validate_subtype(cls, v, values):
        """Validate subtype if provided."""
        task_type = values.get('type')
        if v is None:
            return v
        if task_type == 'click':
            if v not in ['error_detection']:
                raise ValueError("Invalid subtype for click task: must be 'error_detection'")
            return v
        raise ValueError("Subtype is currently supported only for click tasks")
    
    @validator('content', pre=True)
    def validate_content_type(cls, v, values):
        """Convert content to correct type based on task type."""
        # Получаем task_type из уже валидированных значений
        task_type = values.get('type') if values else None
        subtype = values.get('subtype') if values else None
        
        # Если task_type еще не определен, возвращаем content как есть
        # и он будет обработан в root_validator
        if not task_type:
            return v
        
        # Если content уже правильного типа - оставляем как есть
        expected_content_type = get_expected_content_model(task_type, subtype)
        if expected_content_type:
            # ВАЖНО: Используем точное сравнение типов вместо isinstance
            v_actual_type = type(v)
            
            # Если content уже правильного типа - оставляем как есть
            if v_actual_type == expected_content_type:
                return v
            
            # Если content - объект BaseModel неправильного типа, преобразуем его
            if isinstance(v, BaseModel):
                try:
                    content_dict = v.dict() if hasattr(v, 'dict') else {}
                    return expected_content_type(**content_dict)
                except Exception as e:
                    logger.warning(
                        f"Failed to convert content from {v_actual_type.__name__} to {expected_content_type.__name__}: {e}"
                    )
            
            # Если content - словарь, преобразуем в нужный тип
            if isinstance(v, dict):
                try:
                    return expected_content_type(**v)
                except Exception as e:
                    logger.warning(f"Failed to convert content to {expected_content_type.__name__}: {e}")
        
        return v
    
    @classmethod
    def parse_obj(cls, obj):
        """Parse object with correct content type based on task type."""
        if isinstance(obj, dict):
            task_type = obj.get('type')
            subtype = obj.get('subtype')
            content = obj.get('content')
            
            if task_type and content:
                expected_content_type = get_expected_content_model(task_type, subtype)
                if expected_content_type:
                    content_actual_type = type(content)
                    
                    # Если content уже правильного типа - оставляем как есть
                    if content_actual_type == expected_content_type:
                        pass  # Content already correct
                    # Если content - объект BaseModel неправильного типа, преобразуем
                    elif isinstance(content, BaseModel):
                        try:
                            content_dict = content.dict() if hasattr(content, 'dict') else {}
                            validated_content = expected_content_type(**content_dict)
                            obj = obj.copy()
                            obj['content'] = validated_content
                        except Exception as e:
                            logger.warning(
                                f"Failed to convert content from {content_actual_type.__name__} to {expected_content_type.__name__}: {e}"
                            )
                    # Если content - словарь, преобразуем в нужный тип
                    elif isinstance(content, dict):
                        try:
                            # Принудительно создаем нужный тип content
                            validated_content = expected_content_type(**content)
                            obj = obj.copy()
                            obj['content'] = validated_content
                        except Exception as e:
                            logger.warning(f"Failed to convert content to {expected_content_type.__name__}: {e}")
        
        return super().parse_obj(obj)
    
    @root_validator(pre=True)
    def validate_content_type_match(cls, values):
        """Validate and convert content type to match task type BEFORE parsing."""
        task_type = values.get('type')
        subtype = values.get('subtype')
        content = values.get('content')
        
        # Если content или task_type отсутствуют, возвращаем как есть
        if not content or not task_type:
            return values
        
        expected_content_type = get_expected_content_model(task_type, subtype)
        if expected_content_type:
            # ВАЖНО: Используем точное сравнение типов вместо isinstance
            content_actual_type = type(content)
            
            # Если content уже правильного типа - оставляем как есть
            if content_actual_type == expected_content_type:
                return values
            
            # Если content - объект BaseModel, но неправильного типа, преобразуем
            if isinstance(content, BaseModel):
                try:
                    # Получаем словарь из существующего объекта
                    content_dict = content.dict() if hasattr(content, 'dict') else {}
                    # Создаем объект правильного типа
                    validated_content = expected_content_type(**content_dict)
                    values['content'] = validated_content
                    return values
                except Exception as e:
                    logger.warning(
                        f"Failed to convert content from {content_actual_type.__name__} to {expected_content_type.__name__} "
                        f"for task type '{task_type}': {e}"
                    )
            
            # Если content - словарь, ВСЕГДА преобразуем в нужный тип
            if isinstance(content, dict):
                try:
                    # Принудительно создаем нужный тип content
                    validated_content = expected_content_type(**content)
                    values['content'] = validated_content
                    return values
                except Exception as e:
                    # Если преобразование не удалось, оставляем словарь
                    # но это может привести к ошибке при парсинге Union
                    logger.warning(
                        f"Failed to convert content to {expected_content_type.__name__} "
                        f"for task type '{task_type}': {e}"
                    )
        
        return values
    
    @root_validator(skip_on_failure=True)
    def validate_content_type_match_after(cls, values):
        """Validate that content type matches task type after parsing."""
        task_type = values.get('type')
        subtype = values.get('subtype')
        content = values.get('content')
        
        if not content:
            return values
        
        expected_content_type = get_expected_content_model(task_type, subtype)
        # ВАЖНО: Используем точное сравнение типов вместо isinstance
        if expected_content_type and type(content) != expected_content_type:
            # Если тип не совпадает, пробуем преобразовать
            if isinstance(content, BaseModel):
                try:
                    # Получаем словарь из существующего объекта
                    content_dict = content.dict() if hasattr(content, 'dict') else {}
                    # Создаем объект правильного типа
                    values['content'] = expected_content_type(**content_dict)
                    return values
                except Exception as e:
                    logger.warning(
                        f"Failed to convert content from {type(content).__name__} to {expected_content_type.__name__}: {e}"
                    )
            elif isinstance(content, dict):
                try:
                    values['content'] = expected_content_type(**content)
                    return values
                except Exception as e:
                    pass
            
            raise ValueError(
                f"Content type mismatch: task type '{task_type}' requires "
                f"{expected_content_type.__name__}, got {type(content).__name__}"
            )
        
        return values
    
    def resolve_paths(self, task_json_path: Path):
        """Resolve all relative paths relative to task.json."""
        task_dir = task_json_path.parent
        
        # Resolve image path in content
        if hasattr(self.content, 'image') and self.content.image:
            if isinstance(self.content.image, str):
                if is_direct_image_url(self.content.image):
                    return
                resolved = PathResolver.resolve_image_path(
                    self.content.image,
                    task_json_path
                )
                self.content.image = str(resolved)
    
    class Config:
        extra = "allow"  # Allow extra fields for backward compatibility
