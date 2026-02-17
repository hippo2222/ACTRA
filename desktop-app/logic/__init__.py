"""
Logic Layer - Управление бизнес-логикой и рабочими процессами.

Этот слой координирует работу между Services (обработка данных) и UI (отображение).

Экспортируемые компоненты:
- TaskController: управление жизненным циклом задания
- TaskState: состояния задания (NOT_STARTED, IN_PROGRESS, COMPLETED, FAILED, SKIPPED)
- Task: dataclass для данных задания
- SessionManager: управление сессией и навигацией между заданиями
- ModuleRepository: фасад для доступа к модулям/темам/заданиям
- ProfileController: управление профилями пользователей (ФАЗА 1)

НЕДЕЛЯ 2: SERVICES И LOGIC LAYERS
"""

from .task_controller import TaskController, TaskState, Task
from .session_manager import SessionManager
from .module_repository import ModuleRepository
from .profile_controller import ProfileController
from .complex_session_controller import ComplexSessionController

__all__ = [
    'TaskController',
    'TaskState',
    'Task',
    'SessionManager',
    'ModuleRepository',
    'ProfileController',
    'ComplexSessionController',
]
