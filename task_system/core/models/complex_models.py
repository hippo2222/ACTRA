# task_system/core/models/complex_models.py
"""
Pydantic модели для комплексов и сессий.
"""

from datetime import datetime
from typing import List, Optional, Dict, Any, Union
from pydantic import BaseModel, Field, validator

COMPLEX_SESSION_VERSION = 1

class ComplexSettings(BaseModel):
    """Настройки адаптивности комплекса."""
    
    adaptive_difficulty: bool = Field(
        default=True,
        description="Включена ли адаптивная сложность"
    )
    escalation_on_success: bool = Field(
        default=True,
        description="Повышать ли сложность при успехе"
    )
    error_pool_enabled: bool = Field(
        default=True,
        description="Использовать ли пул ошибок (повтор неправильных)"
    )
    max_iterations: Optional[int] = Field(
        default=3,
        description="Максимальное количество итераций комплекса (базовое системное ограничение = 3)"
    )

    smart_retry_near_offset: int = Field(
        default=2,
        ge=0,
        description="На сколько позиций вперед вставлять 'near' ретрай в очереди"
    )
    smart_retry_near_jitter_max: int = Field(
        default=2,
        ge=0,
        description="Максимальный детерминированный джиттер (0..N) к smart_retry_near_offset"
    )
    smart_retry_max_copies_per_task: int = Field(
        default=5,
        ge=0,
        description="Максимум retry-копий одного задания в очереди"
    )
    smart_retry_training_control_enabled: bool = Field(
        default=True,
        description="Использовать ли схему training/control (lvl-1 near + original end_of_phase)"
    )
    
    test_question_display_modes: Dict[str, str] = Field(
        default_factory=dict,
        description="Per test task display mode: together or scattered"
    )
    max_same_type_run: int = Field(
        default=3,
        ge=1,
        description=(
            "Максимум подряд идущих заданий одного типа в очереди итерации. "
            "Anti-run защита: при превышении система вставляет задание другого типа. "
            "Работает на уровне chunks (связки не разрываются)."
        ),
    )

    @validator("test_question_display_modes", pre=True, always=True)
    def validate_test_question_display_modes(cls, value):
        if not isinstance(value, dict):
            return {}
        normalized = {}
        for key, mode in value.items():
            task_ref = str(key or "").strip()
            mode_value = str(mode or "").strip().lower()
            if task_ref and mode_value in {"together", "scattered"}:
                normalized[task_ref] = mode_value
        return normalized

    class Config:
        extra = "allow"


class QueuedTask(BaseModel):
    """Задание в очереди текущей итерации."""
    task_ref: str
    difficulty: int = Field(ge=1, le=3)
    is_retry: bool = False  # True, если задание добавлено из-за ошибки в предыдущей итерации
    origin_iteration: Optional[int] = None  # Номер итерации, где была допущена ошибка (для аналитики)


    display_mode: Optional[str] = None
    source_task_ref: Optional[str] = None
    test_question_index: Optional[int] = None


class ChainDefinition(BaseModel):
    """Определение сцепки заданий внутри комплекса."""

    tasks: List[str] = Field(
        default_factory=list,
        description="Список ссылок на задания в сцепке"
    )
    shuffle_mode: str = Field(
        default="never",
        description="Режим перемешивания: never, from_iteration_2, only_iteration_3, always, custom"
    )
    shuffle_iterations: List[int] = Field(
        default_factory=list,
        description="Номера итераций (1-based), на которых сцепка перемешивается (для custom)"
    )

    @validator("shuffle_mode")
    def validate_shuffle_mode(cls, v):
        allowed = {"never", "from_iteration_2", "only_iteration_3", "always", "custom"}
        v_str = str(v or "never").strip().lower()
        if v_str not in allowed:
            raise ValueError(f"Invalid shuffle_mode '{v}'. Allowed modes: {sorted(allowed)}")
        return v_str

    @validator("shuffle_iterations", pre=True, always=True)
    def validate_shuffle_iterations(cls, v):
        if not v:
            return []
        if isinstance(v, (list, tuple, set)):
            res = []
            for it in v:
                try:
                    it_int = int(it)
                    if it_int >= 1 and it_int not in res:
                        res.append(it_int)
                except (ValueError, TypeError):
                    pass
            return sorted(res)
        return []

    # Sequence / duck-typing protocol for backwards compatibility
    def __iter__(self):
        return iter(self.tasks)

    def __len__(self):
        return len(self.tasks)

    def __getitem__(self, index):
        return self.tasks[index]

    def __contains__(self, item):
        return item in self.tasks

    def index(self, item, *args):
        return self.tasks.index(item, *args)

    class Config:
        extra = "allow"


class Complex(BaseModel):
    """Модель комплекса заданий."""
    
    id: str = Field(..., description="Уникальный ID комплекса")
    name: str = Field(..., description="Название комплекса")
    description: Optional[str] = Field("", description="Описание комплекса")
    tasks: List[str] = Field(..., description="Список ссылок на задания (module/topic/task_id)")
    chains: List[Union[ChainDefinition, List[str]]] = Field(
        default_factory=list,
        description="Группы сцепленных заданий (Task Chaining). Задания в группе всегда идут последовательно или по правилам shuffle_mode."
    )
    settings: ComplexSettings = Field(
        default_factory=ComplexSettings,
        description="Настройки комплекса"
    )
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="Дата создания"
    )
    updated_at: Optional[datetime] = Field(
        None,
        description="Дата последнего обновления"
    )
    
    @validator('chains')
    def validate_chains(cls, v):
        """Проверяет, что задания не дублируются в разных цепочках."""
        seen_tasks = set()
        for chain in v:
            tasks = chain.tasks if isinstance(chain, ChainDefinition) else (chain.get("tasks") if isinstance(chain, dict) else (chain if isinstance(chain, list) else []))
            for task_ref in tasks:
                if task_ref in seen_tasks:
                    raise ValueError(f"Task {task_ref} appears in multiple chains")
                seen_tasks.add(task_ref)
        return v

    def get_raw_task_chains(self) -> List[List[str]]:
        """Возвращает сцепки в виде простых списков ссылок на задания."""
        result = []
        for ch in self.chains:
            if isinstance(ch, ChainDefinition):
                result.append(list(ch.tasks))
            elif isinstance(ch, dict):
                result.append(list(ch.get("tasks", [])))
            elif isinstance(ch, list):
                result.append(list(ch))
        return result

    @property
    def chain_definitions(self) -> List[ChainDefinition]:
        """Возвращает все сцепки в виде объектов ChainDefinition."""
        defs = []
        for ch in self.chains:
            if isinstance(ch, ChainDefinition):
                defs.append(ch)
            elif isinstance(ch, dict):
                defs.append(ChainDefinition(**ch))
            elif isinstance(ch, list):
                defs.append(ChainDefinition(tasks=ch, shuffle_mode="never"))
        return defs
    
    class Config:
        extra = "allow"


class SessionTaskResult(BaseModel):
    """Результат выполнения конкретного задания в сессии."""
    
    task_ref: str
    success: bool
    time_spent: int
    difficulty: int
    iteration_index: int  # Номер итерации, в которой была совершена попытка
    score: Optional[float] = None # Оценка за задание (0-100)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    details: Dict[str, Any] = Field(default_factory=dict)


class ComplexSession(BaseModel):
    """Модель активной сессии выполнения комплекса."""
    
    id: str = Field(..., description="ID сессии")
    complex_id: str = Field(..., description="ID выполняемого комплекса")
    user_id: str = Field(..., description="ID пользователя")
    start_time: datetime = Field(default_factory=datetime.utcnow)
    end_time: Optional[datetime] = None
    
    # Версия структуры сессии для миграций
    version: int = Field(default=1)
    
    # Состояние сессии
    iteration: int = Field(default=1)  # Текущий номер итерации
    current_task_index: int = 0
    queue: List[QueuedTask] = Field(default_factory=list)  # Типизированная очередь заданий
    completed_tasks: List[SessionTaskResult] = Field(default_factory=list)
    # Счётчик пропусков: task_ref -> количество раз, когда задание было отложено в текущей итерации.
    # Сбрасывается при генерации новой итерации.
    skip_counts: Dict[str, int] = Field(default_factory=dict)
    broken_tasks: List[str] = Field(default_factory=list)  # Список заданий с отсутствующими файлами
    error_detection_tasks: List[str] = Field(
        default_factory=list,
        description="task_ref заданий click/error_detection, отложенных до финальной фазы",
    )
    
    deferred_retry_tasks: List[QueuedTask] = Field(default_factory=list)

    is_active: bool = True
    is_completed: bool = Field(
        default=False,
        description="Все задания выполнены на максимальной сложности, комплекс завершён",
    )
    paused: bool = Field(default=False, description="Сессия приостановлена пользователем")
    paused_at: Optional[datetime] = Field(default=None, description="Время последней паузы")
    total_pause_seconds: float = Field(default=0.0, description="Суммарное время пауз в секундах")

    # Карта для частичного ретрая тестовых заданий:
    # task_ref -> список индексов вопросов, которые были выполнены неверно
    test_failed_subtests: Dict[str, List[int]] = Field(default_factory=dict)
    
    # Временные метки для каждой итерации
    iteration_timestamps: Dict[int, Dict[str, Optional[datetime]]] = Field(
        default_factory=dict,
        description="Временные метки для каждой итерации: {iteration: {'start': datetime, 'end': datetime}}"
    )
    
    # Состояние UI для восстановления позиции пользователя
    ui_state: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Состояние UI: на каком экране находится пользователь (task, task_results, iteration_results)"
    )
    
    class Config:
        extra = "allow"


class RecentSessionSummary(BaseModel):
    """Урезанная версия итогов сессии для хранения в статистике."""
    session_id: str
    end_time: datetime
    duration_seconds: int
    success_rate: float
    total_tasks: int  # Общее количество попыток
    mastered_tasks: int  # Количество уникальных заданий, достигших max_level
    failed_tasks: int  # Количество уникальных заданий с ошибками
    total_iterations: int


class IterationSummary(BaseModel):
    """Сводка результатов конкретной итерации для показа промежуточных результатов."""
    session_id: str
    complex_id: str
    user_id: str
    iteration: int  # Номер итерации
    total_tasks: int  # Всего заданий в итерации
    successful_tasks: int  # Успешно выполненных
    failed_tasks: int  # С ошибками
    success_rate: float  # Процент успешности (0.0 - 1.0)
    iteration_results: List[SessionTaskResult]  # Результаты заданий итерации
    start_time: Optional[datetime] = None  # Время начала итерации (опционально)
    end_time: Optional[datetime] = None  # Время завершения итерации (опционально)


class ExtendedSessionResultSummary(BaseModel):
    """Расширенная сводка результатов сессии для экрана результатов."""
    session_id: str
    complex_id: str
    user_id: str
    start_time: datetime
    end_time: datetime
    total_iterations: int
    tasks_mastered_count: int
    tasks_failed_count: int
    difficulty_progression: List[float]  # Средняя сложность по итерациям
    total_tasks: int  # Общее количество попыток (для статистики)
    successful_tasks_count: int  # Количество успешных попыток (исключая skipped)
    iteration_durations: List[Optional[float]] = Field(
        default_factory=list,
        description="Длительность каждой итерации в секундах (None если не завершена или нет данных)"
    )
