"""Базовые классы системы."""

from .task_type import BaseTaskType
from .task_evaluator import BaseTaskEvaluator
from .task_ui import BaseTaskUI
from .plugin_base import PluginBase
from .app_context import AppContext

__all__ = [
    "BaseTaskType",
    "BaseTaskEvaluator",
    "BaseTaskUI",
    "PluginBase",
    "AppContext",
]

