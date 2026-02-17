"""Общее ядро системы - базовые классы, менеджеры, схемы."""

from .base.task_type import BaseTaskType
from .base.task_evaluator import BaseTaskEvaluator
from .base.task_ui import BaseTaskUI
from .managers.task_type_manager import TaskTypeManager, task_type_manager

# Импорт системы исключений
from .exceptions import (
    ActraError,
    TaskLoadError,
    EvaluationError,
    PluginError,
    TaskValidationError,
)

# Импорт системы логирования
from .logging_config import setup_logging

__all__ = [
    "BaseTaskType",
    "BaseTaskEvaluator",
    "BaseTaskUI", 
    "TaskTypeManager",
    "task_type_manager",
    # Система исключений
    "ActraError",
    "TaskLoadError",
    "EvaluationError",
    "PluginError",
    "TaskValidationError",
    # Система логирования
    "setup_logging",
]

