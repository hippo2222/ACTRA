"""Менеджеры системы."""

from .task_type_manager import TaskTypeManager, task_type_manager
from .plugin_manager import PluginManager

__all__ = [
    "TaskTypeManager",
    "task_type_manager",
    "PluginManager",
]

