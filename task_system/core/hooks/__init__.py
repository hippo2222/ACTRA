"""
Система hooks (точек расширения) для плагинов

Предоставляет централизованный механизм для регистрации и вызова
обработчиков в различных точках системы.
"""

from .hook_registry import HookRegistry, hook_registry
from .ui_hooks import ui_hooks
from .evaluator_hooks import evaluator_hooks
from .data_hooks import data_hooks
from .storage_hooks import storage_hooks
from .difficulty_hooks import difficulty_hooks

__all__ = [
    "HookRegistry",
    "hook_registry",
    "ui_hooks",
    "evaluator_hooks",
    "data_hooks",
    "storage_hooks",
    "difficulty_hooks",
]





