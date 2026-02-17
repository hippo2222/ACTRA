"""
Реестр типов заданий
"""

from typing import Dict, List, Optional
from ..core.base.task_type import BaseTaskType
from .click_task import ClickTask
from .draw_task import DrawTask
from .open_answer_task_type import OpenAnswerTaskType
from .sequence_assembly_task import SequenceAssemblyTaskType

# Безопасный импорт TestTaskType
try:
    from .test_task_type import TestTaskType
    TEST_TASK_AVAILABLE = True
except ImportError:
    try:
        from .simple_test_task_type import SimpleTestTaskType as TestTaskType
        TEST_TASK_AVAILABLE = True
    except ImportError:
        TEST_TASK_AVAILABLE = False
        TestTaskType = None


class TaskTypeRegistry:
    """Реестр всех доступных типов заданий"""
    
    def __init__(self):
        self._types: Dict[str, BaseTaskType] = {}
        self._register_default_types()
    
    def _register_default_types(self):
        """Регистрирует стандартные типы заданий"""
        self.register(ClickTask())
        self.register(DrawTask())
        self.register(OpenAnswerTaskType())
        self.register(SequenceAssemblyTaskType())
        
        # Регистрируем TestTaskType только если он доступен
        if TEST_TASK_AVAILABLE and TestTaskType is not None:
            try:
                self.register(TestTaskType())
                print("TestTaskType успешно зарегистрирован")
            except Exception as e:
                print(f"Ошибка при регистрации TestTaskType: {e}")
        else:
            print(f"TestTaskType недоступен: TEST_TASK_AVAILABLE={TEST_TASK_AVAILABLE}, TestTaskType={TestTaskType}")
    
    def register(self, task_type: BaseTaskType):
        """Регистрирует новый тип задания"""
        self._types[task_type.task_id] = task_type
    
    def unregister(self, task_id: str):
        """Удаляет тип задания из реестра"""
        if task_id in self._types:
            del self._types[task_id]
    
    def get(self, task_id: str) -> Optional[BaseTaskType]:
        """Получает тип задания по ID"""
        return self._types.get(task_id)
    
    def get_all(self) -> Dict[str, BaseTaskType]:
        """Получает все зарегистрированные типы"""
        return self._types.copy()
    
    def get_all_ids(self) -> List[str]:
        """Получает все ID типов заданий"""
        return list(self._types.keys())
    
    def get_all_for_ui(self) -> List[tuple]:
        """Получает типы заданий для UI (ID, название)"""
        return [(task_id, task_type.name) for task_id, task_type in self._types.items()]
    
    def is_registered(self, task_id: str) -> bool:
        """Проверяет, зарегистрирован ли тип задания"""
        return task_id in self._types
    
    def get_count(self) -> int:
        """Возвращает количество зарегистрированных типов"""
        return len(self._types)


# Создаем глобальный экземпляр реестра
task_registry = TaskTypeRegistry()

