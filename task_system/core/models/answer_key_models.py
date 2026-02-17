"""
Pydantic models for answer key structures.

This module defines Pydantic models for validating answer_key.json structures
for different task types.
"""

from typing import List, Tuple, Optional, Dict, Any, Union
from pydantic import BaseModel, Field, validator


class PointTarget(BaseModel):
    """Point target for click tasks."""
    
    point: Tuple[int, int] = Field(
        ...,
        description="Point coordinates [x, y]"
    )
    tolerance_px: int = Field(
        default=10,
        ge=1,
        le=100,
        description="Tolerance in pixels"
    )
    label: Optional[str] = Field(
        None,
        description="Target label"
    )
    
    @validator('point')
    def validate_point(cls, v):
        """Validate point coordinates."""
        if len(v) != 2:
            raise ValueError("Point must have exactly 2 coordinates [x, y]")
        if not all(isinstance(coord, (int, float)) for coord in v):
            raise ValueError("Point coordinates must be numbers")
        return (int(v[0]), int(v[1]))
    
    class Config:
        extra = "allow"  # Allow extra fields like 'score' for backward compatibility


class PolygonTarget(BaseModel):
    """Polygon target for click/draw tasks."""
    
    points: List[Tuple[float, float]] = Field(
        ...,
        min_items=3,
        description="Polygon point coordinates"
    )
    label: Optional[str] = Field(
        None,
        description="Target label"
    )
    score: Optional[Dict[str, Any]] = Field(
        None,
        description="Scoring metrics (IoU, threshold)"
    )
    
    @validator('points')
    def validate_points(cls, v):
        """Validate polygon points."""
        if len(v) < 3:
            raise ValueError("Polygon must have at least 3 points")
        validated_points = []
        for point in v:
            if len(point) != 2:
                raise ValueError("Each point must have exactly 2 coordinates [x, y]")
            if not all(isinstance(coord, (int, float)) for coord in point):
                raise ValueError("Point coordinates must be numbers")
            validated_points.append((float(point[0]), float(point[1])))
        return validated_points
    
    class Config:
        extra = "allow"


class ClickTaskAnswerKey(BaseModel):
    """Answer key for click tasks."""
    
    version: int = Field(
        default=1,
        description="Answer key format version"
    )
    targets: List[Union[PointTarget, PolygonTarget]] = Field(
        ...,
        min_items=1,
        description="List of targets (points or polygons)"
    )
    
    @validator('targets')
    def validate_targets(cls, v):
        """Validate that there is at least one target."""
        if not v:
            raise ValueError("At least one target is required")
        return v
    
    def apply_tolerance_from_settings(self, tolerance_px: int):
        """Apply tolerance_px from task settings to PointTargets without tolerance."""
        for target in self.targets:
            if isinstance(target, PointTarget) and target.tolerance_px == 10:
                # Apply default tolerance only if it's the default value
                target.tolerance_px = tolerance_px
    
    class Config:
        extra = "allow"


class DrawTaskAnswerKey(BaseModel):
    """Answer key for draw tasks."""
    
    version: int = Field(
        default=1,
        description="Answer key format version"
    )
    targets: List[PolygonTarget] = Field(
        ...,
        min_items=1,
        description="List of polygon targets"
    )
    
    @validator('targets')
    def validate_targets(cls, v):
        """Validate that there is at least one target."""
        if not v:
            raise ValueError("At least one target is required")
        return v
    
    class Config:
        extra = "allow"


class OpenAnswerTaskAnswerKey(BaseModel):
    """Answer key for open answer tasks."""
    
    version: int = Field(
        default=1,
        description="Answer key format version"
    )
    keywords: List[str] = Field(
        ...,
        min_items=1,
        description="Keywords for searching in answer"
    )
    sequence_matters: bool = Field(
        default=False,
        description="Whether keyword sequence matters"
    )
    reference_answer: Optional[str] = Field(
        None,
        description="Reference answer text"
    )
    
    class Config:
        extra = "allow"


class SequenceAssemblyAnswerKey(BaseModel):
    """Answer key for sequence assembly tasks."""
    
    version: int = Field(
        default=1,
        description="Answer key format version"
    )
    levels: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="Correct level structure with blocks (optional, can be in task.json instead)"
    )
    sequence_within_level_matters: bool = Field(
        default=False,
        description="Whether sequence within level matters"
    )
    level_order_matters: bool = Field(
        default=False,
        description="Whether level order matters"
    )
    
    class Config:
        extra = "allow"


class TestTaskAnswerKey(BaseModel):
    """Answer key for test tasks."""
    
    version: int = Field(
        default=1,
        description="Answer key format version"
    )
    correct_answers: Dict[str, int] = Field(
        ...,
        description="Correct answers mapping question_id -> answer_index"
    )
    
    class Config:
        extra = "allow"


