"""
Calendar Models - Модели данных для календаря обучения.

Содержит:
- Enums для статусов и типов
- Pydantic-подобные dataclasses для валидации
- Модели для хранения и передачи данных
"""

from dataclasses import dataclass, field
from datetime import datetime, date, timedelta
from enum import Enum
from typing import Optional, List, Dict, Any
import uuid


# =============================================================================
# ENUMS
# =============================================================================

class ComplexStatus(str, Enum):
    """Статус комплекса для пользователя."""
    NEW = "new"                  # Ещё не начинал
    IN_PROGRESS = "in_progress"  # В процессе изучения
    MASTERED = "mastered"        # Освоен (все задачи, высокий HealthScore)
    FROZEN = "frozen"            # Заморожен пользователем


class MasteryCategory(str, Enum):
    """Категория освоения комплекса для адаптивной частоты повторений."""
    CRITICAL = "critical"           # < 0.5: каждый день
    NEEDS_PRACTICE = "needs_practice"  # 0.5-0.7: через 1-2 дня
    GOOD = "good"                   # 0.7-0.85: 2 раза в неделю
    MASTERED = "mastered"           # 0.85-0.95: раз в неделю
    MAINTAINED = "maintained"       # > 0.95: раз в 2 недели


# Интервалы повторений для каждой категории (в днях)
MASTERY_INTERVALS = {
    MasteryCategory.CRITICAL: 1,
    MasteryCategory.NEEDS_PRACTICE: 2,
    MasteryCategory.GOOD: 3,
    MasteryCategory.MASTERED: 7,
    MasteryCategory.MAINTAINED: 14,
}


class ScheduleMode(str, Enum):
    """Режим расписания."""
    DAILY = "daily"      # Ежедневные занятия
    


class SessionType(str, Enum):
    """Тип сессии обучения."""
    DAILY_MIX = "daily_mix"           # Повторение (Daily Mix)
    NEW_MATERIAL = "new_material"     # Изучение нового материала
    UNPLANNED_REVIEW = "unplanned"    # Внеплановое повторение


class NotificationType(str, Enum):
    """Тип уведомления."""
    HEALTH_DROP = "health_drop"           # Падение HealthScore
    TIME_SUGGESTION = "time_suggestion"   # Предложение обновить лимит времени
    STREAK_MILESTONE = "streak_milestone" # Достижение streak
    MODE_SUGGESTION = "mode_suggestion"   # Предложение сменить режим


class TaskType(str, Enum):
    """Тип задачи в Daily Mix."""
    WARMUP = "warmup"           # Разминка (быстрые кейсы)
    MAIN = "main"               # Основной блок
    CONSOLIDATION = "consolidation"  # Закрепление


class DayStatus(str, Enum):
    """Статус дня в расписании."""
    PLANNED = "planned"         # Запланирован
    IN_PROGRESS = "in_progress" # В процессе
    COMPLETED = "completed"     # Выполнен
    MISSED = "missed"           # Пропущен
    RECALCULATED = "recalculated"  # Пересчитан после пропуска
    REST_DAY = "rest_day"       # Выходной


class GradingStrategy(str, Enum):
    """Стратегия оценивания."""
    BINARY = "binary"    # 0/1 (MVP)
    FIVE_BUTTON = "5button"  # 1-5 (Stage 2: Smart Review)


# =============================================================================
# DATA MODELS
# =============================================================================

@dataclass
class ComplexProgress:
    """Прогресс пользователя по комплексу."""
    complex_id: str
    user_id: str
    status: ComplexStatus = ComplexStatus.NEW
    last_reviewed_at: Optional[datetime] = None
    health_score: float = 1.0  # 0.0 - 1.0
    stability: Optional[float] = None  # Для FSRS (Stage 2)
    frozen_until: Optional[datetime] = None
    total_tasks_completed: int = 0
    total_attempts: int = 0
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    
    def get_mastery_category(self) -> MasteryCategory:
        """Определить категорию освоения на основе health_score."""
        if self.health_score < 0.5:
            return MasteryCategory.CRITICAL
        elif self.health_score < 0.7:
            return MasteryCategory.NEEDS_PRACTICE
        elif self.health_score < 0.85:
            return MasteryCategory.GOOD
        elif self.health_score < 0.95:
            return MasteryCategory.MASTERED
        else:
            return MasteryCategory.MAINTAINED
    
    def get_required_interval_days(self) -> int:
        """Получить требуемый интервал повторения в днях."""
        category = self.get_mastery_category()
        return MASTERY_INTERVALS[category]
    
    def get_next_review_date(self, reference_date: Optional[date] = None) -> date:
        """
        Вычислить следующую дату повторения.
        
        Args:
            reference_date: Базовая дата (по умолчанию сегодня)
        
        Returns:
            date: Дата следующего повторения
        """
        if reference_date is None:
            reference_date = date.today()
        
        if self.last_reviewed_at:
            last_date = self.last_reviewed_at.date() if hasattr(self.last_reviewed_at, 'date') else self.last_reviewed_at
        else:
            # Если никогда не проходили, нужно повторить сегодня
            return reference_date
        
        interval = self.get_required_interval_days()
        return last_date + timedelta(days=interval)
    
    def needs_review_on_date(self, target_date: date) -> bool:
        """
        Проверить, нужно ли повторение на указанную дату.
        
        Args:
            target_date: Дата для проверки
        
        Returns:
            bool: True если нужно повторение
        """
        next_review = self.get_next_review_date()
        return target_date >= next_review
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "complex_id": self.complex_id,
            "user_id": self.user_id,
            "status": self.status.value,
            "last_reviewed_at": self.last_reviewed_at.isoformat() if self.last_reviewed_at else None,
            "health_score": self.health_score,
            "stability": self.stability,
            "frozen_until": self.frozen_until.isoformat() if self.frozen_until else None,
            "total_tasks_completed": self.total_tasks_completed,
            "total_attempts": self.total_attempts,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "mastery_category": self.get_mastery_category().value,
            "required_interval_days": self.get_required_interval_days(),
            "next_review_date": self.get_next_review_date().isoformat(),
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ComplexProgress":
        return cls(
            complex_id=data["complex_id"],
            user_id=data["user_id"],
            status=ComplexStatus(data.get("status", "new")),
            last_reviewed_at=datetime.fromisoformat(data["last_reviewed_at"]) if data.get("last_reviewed_at") else None,
            health_score=data.get("health_score", 1.0),
            stability=data.get("stability"),
            frozen_until=datetime.fromisoformat(data["frozen_until"]) if data.get("frozen_until") else None,
            total_tasks_completed=data.get("total_tasks_completed", 0),
            total_attempts=data.get("total_attempts", 0),
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else datetime.now(),
            updated_at=datetime.fromisoformat(data["updated_at"]) if data.get("updated_at") else datetime.now(),
        )


@dataclass
class TaskAttempt:
    """Попытка выполнения задачи."""
    attempt_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    task_id: str = ""
    user_id: str = ""
    complex_id: str = ""
    user_grading: int = 0  # 0 или 1 (MVP)
    confidence_rating: Optional[int] = None  # 1-5 (Stage 2: Smart Review)
    response_time_seconds: float = 0.0
    timestamp: datetime = field(default_factory=datetime.now)
    grading_strategy: GradingStrategy = GradingStrategy.BINARY
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "attempt_id": self.attempt_id,
            "task_id": self.task_id,
            "user_id": self.user_id,
            "complex_id": self.complex_id,
            "user_grading": self.user_grading,
            "confidence_rating": self.confidence_rating,
            "response_time_seconds": self.response_time_seconds,
            "timestamp": self.timestamp.isoformat(),
            "grading_strategy": self.grading_strategy.value,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TaskAttempt":
        return cls(
            attempt_id=data.get("attempt_id", str(uuid.uuid4())),
            task_id=data["task_id"],
            user_id=data["user_id"],
            complex_id=data.get("complex_id", ""),
            user_grading=data.get("user_grading", 0),
            confidence_rating=data.get("confidence_rating"),
            response_time_seconds=data.get("response_time_seconds", 0.0),
            timestamp=datetime.fromisoformat(data["timestamp"]) if data.get("timestamp") else datetime.now(),
            grading_strategy=GradingStrategy(data.get("grading_strategy", "binary")),
        )


@dataclass
class Session:
    """Сессия обучения."""
    session_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = ""
    started_at: datetime = field(default_factory=datetime.now)
    ended_at: Optional[datetime] = None
    session_type: SessionType = SessionType.DAILY_MIX
    active_time_seconds: int = 0
    tasks_count: int = 0
    tasks_completed: int = 0
    target_time_minutes: int = 30  # Пользовательский лимит
    complex_id: Optional[str] = None  # Для NEW_MATERIAL сессий
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "started_at": self.started_at.isoformat(),
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "session_type": self.session_type.value,
            "active_time_seconds": self.active_time_seconds,
            "tasks_count": self.tasks_count,
            "tasks_completed": self.tasks_completed,
            "target_time_minutes": self.target_time_minutes,
            "complex_id": self.complex_id,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Session":
        return cls(
            session_id=data.get("session_id", str(uuid.uuid4())),
            user_id=data["user_id"],
            started_at=datetime.fromisoformat(data["started_at"]) if data.get("started_at") else datetime.now(),
            ended_at=datetime.fromisoformat(data["ended_at"]) if data.get("ended_at") else None,
            session_type=SessionType(data.get("session_type", "daily_mix")),
            active_time_seconds=data.get("active_time_seconds", 0),
            tasks_count=data.get("tasks_count", 0),
            tasks_completed=data.get("tasks_completed", 0),
            target_time_minutes=data.get("target_time_minutes", 30),
            complex_id=data.get("complex_id"),
        )


@dataclass
class UserCalendarSettings:
    """Настройки календаря пользователя."""
    user_id: str
    daily_time_limit_minutes: int = 30  # 20/30/45
    schedule_mode: ScheduleMode = ScheduleMode.DAILY
    streak_days: int = 0
    last_activity_date: Optional[date] = None
    suggested_time_update: Optional[int] = None  # Предложение системы
    flexible_days_per_week: int = 4  # Для гибкого режима
    last_adapted_date: Optional[date] = None  # Дата последней адаптации после пропуска
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "daily_time_limit_minutes": self.daily_time_limit_minutes,
            "schedule_mode": self.schedule_mode.value,
            "streak_days": self.streak_days,
            "last_activity_date": self.last_activity_date.isoformat() if self.last_activity_date else None,
            "suggested_time_update": self.suggested_time_update,
            "flexible_days_per_week": self.flexible_days_per_week,
            "last_adapted_date": self.last_adapted_date.isoformat() if self.last_adapted_date else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "UserCalendarSettings":
        raw_mode = data.get("schedule_mode", "daily")
        if raw_mode == "flexible":
            raw_mode = "daily"
        return cls(
            user_id=data["user_id"],
            daily_time_limit_minutes=data.get("daily_time_limit_minutes", 30),
            schedule_mode=ScheduleMode(raw_mode),
            streak_days=data.get("streak_days", 0),
            last_activity_date=date.fromisoformat(data["last_activity_date"]) if data.get("last_activity_date") else None,
            suggested_time_update=data.get("suggested_time_update"),
            flexible_days_per_week=data.get("flexible_days_per_week", 4),
            last_adapted_date=date.fromisoformat(data["last_adapted_date"]) if data.get("last_adapted_date") else None,
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else datetime.now(),
            updated_at=datetime.fromisoformat(data["updated_at"]) if data.get("updated_at") else datetime.now(),
        )


@dataclass
class Notification:
    """Уведомление для пользователя."""
    notification_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = ""
    type: NotificationType = NotificationType.HEALTH_DROP
    priority: int = 3  # 1-5 (1 = высший)
    title: str = ""
    message: str = ""
    action_type: Optional[str] = None  # "fix", "update_plan", "switch_mode"
    action_data: Optional[Dict[str, Any]] = None
    dismissed: bool = False
    created_at: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "notification_id": self.notification_id,
            "user_id": self.user_id,
            "type": self.type.value,
            "priority": self.priority,
            "title": self.title,
            "message": self.message,
            "action_type": self.action_type,
            "action_data": self.action_data,
            "dismissed": self.dismissed,
            "created_at": self.created_at.isoformat(),
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Notification":
        return cls(
            notification_id=data.get("notification_id", str(uuid.uuid4())),
            user_id=data["user_id"],
            type=NotificationType(data.get("type", "health_drop")),
            priority=data.get("priority", 3),
            title=data.get("title", ""),
            message=data.get("message", ""),
            action_type=data.get("action_type"),
            action_data=data.get("action_data"),
            dismissed=data.get("dismissed", False),
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else datetime.now(),
        )


# =============================================================================
# SCHEDULER MODELS
# =============================================================================

@dataclass
class ScheduledTask:
    """Задача в расписании."""
    task_id: str
    complex_id: str
    complex_name: str = ""
    task_type: TaskType = TaskType.MAIN
    priority: float = 0.5  # На основе health_score/retrievability
    estimated_duration_seconds: int = 150  # ~2.5 мин по умолчанию
    health_score: float = 1.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "complex_id": self.complex_id,
            "complex_name": self.complex_name,
            "task_type": self.task_type.value,
            "priority": self.priority,
            "estimated_duration_seconds": self.estimated_duration_seconds,
            "health_score": self.health_score,
        }


@dataclass
class DayPlan:
    """План на конкретный день в ленте."""
    date: date
    day_name: str = ""  # "Сегодня", "Завтра", "Суббота"
    day_num: int = 0  # Число месяца
    month: str = ""   # Краткое имя месяца (напр. "янв")
    status: DayStatus = DayStatus.PLANNED
    tasks: List[str] = field(default_factory=list)  # Краткие названия
    badges: List[str] = field(default_factory=list)  # "План", "Пересчитано", etc.
    is_rest_in_flexible: bool = False  # Выходной в гибком режиме
    is_today: bool = False
    is_future: bool = False
    # Новые поля для раскрытия и отслеживания выполнения
    all_tasks: List[Dict[str, Any]] = field(default_factory=list)  # Полный список задач с метаданными
    has_overflow: bool = False  # Есть ли скрытые задачи
    overflow_count: int = 0  # Количество скрытых задач
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "date": self.date.isoformat(),
            "day_name": self.day_name,
            "day_num": self.day_num,
            "month": self.month,
            "status": self.status.value,
            "tasks": self.tasks,
            "badges": self.badges,
            "is_rest_in_flexible": self.is_rest_in_flexible,
            "is_today": self.is_today,
            "is_future": self.is_future,
            "all_tasks": self.all_tasks,
            "has_overflow": self.has_overflow,
            "overflow_count": self.overflow_count,
        }


@dataclass
class DailyPlan:
    """Полный план на сегодня."""
    date: date
    daily_mix: List[ScheduledTask] = field(default_factory=list)
    main_focus: Optional[ScheduledTask] = None
    main_focus_complex_name: str = ""
    main_focus_tasks_count: int = 0
    total_estimated_minutes: int = 0
    daily_mix_estimated_minutes: int = 0
    main_focus_estimated_minutes: int = 0
    status: DayStatus = DayStatus.PLANNED
    is_adapted: bool = False  # После пропуска
    
    def to_dict(self) -> Dict[str, Any]:
        main_focus_name = self.main_focus_complex_name
        if not main_focus_name and self.main_focus:
            main_focus_name = self.main_focus.complex_name

        return {
            "date": self.date.isoformat(),
            "daily_mix": [t.to_dict() for t in self.daily_mix],
            "daily_mix_count": len(self.daily_mix),
            "main_focus": self.main_focus.to_dict() if self.main_focus else None,
            "main_focus_complex_name": self.main_focus_complex_name,
            "main_focus_tasks_count": self.main_focus_tasks_count,
            "total_estimated_minutes": self.total_estimated_minutes,
            "daily_mix_estimated_minutes": self.daily_mix_estimated_minutes,
            # Alias for frontend naming
            "daily_mix_minutes": self.daily_mix_estimated_minutes,
            "main_focus_name": main_focus_name,
            "main_focus_count": self.main_focus_tasks_count,
            "main_focus_estimated_minutes": self.main_focus_estimated_minutes,
            "main_focus_minutes": self.main_focus_estimated_minutes,
            "status": self.status.value,
            "is_adapted": self.is_adapted,
        }


# =============================================================================
# RESPONSE MODELS
# =============================================================================

@dataclass
class HealthSummary:
    """Сводка по здоровью памяти."""
    overall_health: float  # 0.0 - 1.0
    complexes: List[Dict[str, Any]] = field(default_factory=list)
    # Each: {"complex_id", "name", "health_score", "status"}
    critical_count: int = 0  # Количество с health < 0.65
    active_count: int = 0
    has_data: bool = True
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "overall_health": self.overall_health,
            "overall_health_percent": int(self.overall_health * 100),
            "complexes": self.complexes,
            "critical_count": self.critical_count,
            "active_count": self.active_count,
            "has_data": self.has_data,
        }


@dataclass
class ActivityDay:
    """День активности для heatmap."""
    date: date
    completion_percent: int = 0  # 0-100+ (вычисляется на лету)
    is_missed: bool = False
    is_today: bool = False
    is_future: bool = False
    is_rest_day: bool = False
    tasks_solved: int = 0
    tasks_attempted: int = 0
    seconds_spent: int = 0
    target_minutes: int = 30
    microcards_reviews: int = 0
    microcards_correct: int = 0
    microcards_seconds_spent: int = 0
    microcards_pair_match_reviews: int = 0
    microcards_pair_match_perfect: int = 0
    activity_attempts_total: int = 0
    activity_success_total: int = 0
    activity_seconds_spent_total: int = 0
    activity_sources: Dict[str, Dict[str, int]] = field(
        default_factory=lambda: {
            "tasks": {"attempts": 0, "successes": 0, "seconds_spent": 0},
            "microcards": {"attempts": 0, "successes": 0, "seconds_spent": 0},
        }
    )
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "date": self.date.isoformat(),
            "completion_percent": self.completion_percent,
            "is_missed": self.is_missed,
            "is_today": self.is_today,
            "is_future": self.is_future,
            "is_rest_day": self.is_rest_day,
            "tasks_solved": self.tasks_solved,
            "tasks_attempted": self.tasks_attempted,
            "seconds_spent": self.seconds_spent,
            "target_minutes": self.target_minutes,
            "microcards_reviews": self.microcards_reviews,
            "microcards_correct": self.microcards_correct,
            "microcards_seconds_spent": self.microcards_seconds_spent,
            "microcards_pair_match_reviews": self.microcards_pair_match_reviews,
            "microcards_pair_match_perfect": self.microcards_pair_match_perfect,
            "activity_attempts_total": self.activity_attempts_total,
            "activity_success_total": self.activity_success_total,
            "activity_seconds_spent_total": self.activity_seconds_spent_total,
            "activity_sources": self.activity_sources,
        }
