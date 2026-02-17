"""
Unified task type module for ACTRA.
Used in both Desktop App and Editor App.
"""

from pathlib import Path

from .core.base.task_type import BaseTaskType
from .core.base.task_evaluator import BaseTaskEvaluator
from .core.base.task_ui import BaseTaskUI
from .core.managers.task_type_manager import TaskTypeManager, task_type_manager
from .types.registry import TaskTypeRegistry, task_registry

# Import all task types for automatic registration
from .types.click_task import ClickTask
from .types.draw_task import DrawTask
from .types.test_task_type import TestTaskType
from .types.open_answer_task_type import OpenAnswerTaskType
from .types.sequence_assembly_task import SequenceAssemblyTaskType

try:
    __version__ = (Path(__file__).resolve().parent / "VERSION").read_text(encoding="utf-8").strip()
except Exception:
    __version__ = "0.0.0"

__all__ = [
    "BaseTaskType",
    "BaseTaskEvaluator",
    "BaseTaskUI",
    "TaskTypeManager",
    "task_type_manager",
    "TaskTypeRegistry",
    "task_registry",
    "ClickTask",
    "DrawTask",
    "TestTaskType",
    "OpenAnswerTaskType",
    "SequenceAssemblyTaskType",
]
