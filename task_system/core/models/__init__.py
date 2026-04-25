"""
Pydantic models for task validation.

This module provides Pydantic models for validating task data structures,
ensuring type safety and data integrity throughout the application.
"""

from .task_models import (
    TaskMetadata,
    TaskSettings,
    RelativePath,
    ValidatedTask,
    PointAnnotation,
    PolygonAnnotation,
    FreehandAnnotation,
    ClickAnnotation,
    ClickTaskContent,
    DrawTaskContent,
    OpenAnswerTaskContent,
    TestOption,
    TestQuestionImageRef,
    TestQuestion,
    TestTaskContent,
    SequenceAssemblyTaskContent,
)

from .answer_key_models import (
    PointTarget,
    PolygonTarget,
    ClickTaskAnswerKey,
    DrawTaskAnswerKey,
    OpenAnswerTaskAnswerKey,
    SequenceAssemblyAnswerKey,
    TestTaskAnswerKey,
)

from .path_resolver import PathResolver

# Export all models
__all__ = [
    # Task models
    'TaskMetadata',
    'TaskSettings',
    'RelativePath',
    'ValidatedTask',
    # Annotation models
    'PointAnnotation',
    'PolygonAnnotation',
    'FreehandAnnotation',
    'ClickAnnotation',
    # Content models
    'ClickTaskContent',
    'DrawTaskContent',
    'OpenAnswerTaskContent',
    'TestOption',
    'TestQuestionImageRef',
    'TestQuestion',
    'TestTaskContent',
    'SequenceAssemblyTaskContent',
    # Answer key models
    'PointTarget',
    'PolygonTarget',
    'ClickTaskAnswerKey',
    'DrawTaskAnswerKey',
    'OpenAnswerTaskAnswerKey',
    'SequenceAssemblyAnswerKey',
    'TestTaskAnswerKey',
    # Utilities
    'PathResolver',
]
