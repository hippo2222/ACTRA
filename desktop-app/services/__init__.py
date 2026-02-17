"""
Services layer exports.
"""

from .task_evaluator_service import TaskEvaluatorService, EvaluationResult
from .progress_service import ProgressService
from .image_service import ImageService, ImageInfo, PreparedImage
from .storage_service import StorageService
from .user_service import UserService, User
from .user_progress_manager import UserProgressManager
from .statistics_service import StatisticsService
from .difficulty_config_loader import DifficultyConfigLoader, load_difficulty_config, DEFAULT_CONFIG
from .complex_service import ComplexService
from .theory_service import (
    TheoryService,
    TheoryConflictError,
    TheoryValidationError,
    TheoryNotFoundError,
)
from .complex_import_export_service import ComplexImportExportService

__all__ = [
    "TaskEvaluatorService",
    "EvaluationResult",
    "ProgressService",
    "ImageService",
    "ImageInfo",
    "PreparedImage",
    "StorageService",
    "UserService",
    "User",
    "UserProgressManager",
    "StatisticsService",
    "DifficultyConfigLoader",
    "load_difficulty_config",
    "DEFAULT_CONFIG",
    "ComplexService",
    "TheoryService",
    "TheoryConflictError",
    "TheoryValidationError",
    "TheoryNotFoundError",
    "ComplexImportExportService",
]

try:
    from task_system import __version__ as _task_system_version
except Exception:
    _task_system_version = "0.0.0"

__version__ = _task_system_version
