"""Реализации типов заданий."""

from .registry import TaskTypeRegistry, task_registry
from .click_task import ClickTask
from .draw_task import DrawTask
from .test_task_type import TestTaskType
from .open_answer_task_type import OpenAnswerTaskType
from .sequence_assembly_task import SequenceAssemblyTaskType

__all__ = [
    "TaskTypeRegistry",
    "task_registry",
    "ClickTask",
    "DrawTask",
    "TestTaskType",
    "OpenAnswerTaskType",
    "SequenceAssemblyTaskType",
]

