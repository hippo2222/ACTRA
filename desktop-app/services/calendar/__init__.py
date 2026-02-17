"""
Calendar Service Module - Модуль календаря обучения.

Предоставляет:
- Управление расписанием обучения (Daily Mix, основной фокус)
- HealthScore и FSRS-совместимую систему повторений
- Adaptive Flow Scheduler для оптимизации очереди задач
- Систему уведомлений и рекомендаций
- Учёт времени и streak

Стадии внедрения:
- MVP: decay HealthScore, фиксированные интервалы
- Stage 2 (Smart Review): FSRS, confidence ratings
- Stage 3 (Adaptive Calendar): учёт времени, приоритеты
"""

from .models import (
    ComplexStatus,
    ScheduleMode,
    SessionType,
    NotificationType,
    TaskType,
    DayStatus,
    ComplexProgress,
    TaskAttempt,
    Session,
    UserCalendarSettings,
    Notification,
    ScheduledTask,
    DayPlan,
    DailyPlan,
    HealthSummary,
    ActivityDay,
)

from .health_score_service import HealthScoreService
from .scheduler_service import SchedulerService
from .notification_service import NotificationService
from .calendar_service import CalendarService

__all__ = [
    # Enums
    "ComplexStatus",
    "ScheduleMode", 
    "SessionType",
    "NotificationType",
    "TaskType",
    "DayStatus",
    # Models
    "ComplexProgress",
    "TaskAttempt",
    "Session",
    "UserCalendarSettings",
    "Notification",
    "ScheduledTask",
    "DayPlan",
    "DailyPlan",
    "HealthSummary",
    "ActivityDay",
    # Services
    "HealthScoreService",
    "SchedulerService",
    "NotificationService",
    "CalendarService",
]
