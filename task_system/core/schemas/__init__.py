"""JSON схемы для типов заданий."""

from .base_schema import BaseTaskSchema
from .click_schema import ClickTaskSchema
from .draw_schema import DrawTaskSchema
from .test_schema import TestTaskSchema
from .sequence_assembly_schema import SequenceAssemblyTaskSchema

__all__ = [
    "BaseTaskSchema",
    "ClickTaskSchema",
    "DrawTaskSchema",
    "TestTaskSchema",
    "SequenceAssemblyTaskSchema",
]

