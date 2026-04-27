"""
Notification Service - Система уведомлений и рекомендаций.

Реализует:
- Генерация контекстных уведомлений
- Триггеры для разных типов событий
- Приоритизация уведомлений
- Форматирование сообщений
"""

import logging
import re
from datetime import datetime, date
from typing import List, Optional, Dict, Any

from .models import (
    Notification,
    NotificationType,
    ComplexProgress,
    UserCalendarSettings,
    Session,
    ComplexStatus,
)
from .health_score_service import HealthScoreService

_RAW_ID_RE = re.compile(
    r"^(?:[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$",
    re.IGNORECASE,
)


def _safe_complex_display_name(value: Any, fallback: str = "Комплекс") -> str:
    text = str(value or "").strip()
    if not text or _RAW_ID_RE.match(text):
        return fallback
    return text


class NotificationService:
    """Сервис генерации уведомлений."""
    
    # Пороги для триггеров
    HEALTH_DROP_THRESHOLD = 0.65
    TIME_DISCREPANCY_THRESHOLD = 15  # минут
    STREAK_MILESTONES = [7, 14, 21, 30]
    MODE_SUGGESTION_THRESHOLD = 30  # дней для предложения гибкого режима
    
    # Приоритеты (1 = высший)
    PRIORITY_CRITICAL = 1
    PRIORITY_HIGH = 2
    PRIORITY_MEDIUM = 3
    PRIORITY_LOW = 4
    
    def __init__(self, health_service: Optional[HealthScoreService] = None):
        """
        Инициализация сервиса.
        
        Args:
            health_service: Сервис расчёта HealthScore
        """
        self.health_service = health_service or HealthScoreService()
        self.logger = logging.getLogger(self.__class__.__name__)
    
    # =========================================================================
    # NOTIFICATION GENERATION
    # =========================================================================
    
    def generate_notifications(
        self,
        user_id: str,
        settings: UserCalendarSettings,
        all_progress: List[ComplexProgress],
        recent_session: Optional[Session] = None,
        complex_names: Optional[Dict[str, str]] = None
    ) -> List[Notification]:
        """
        Сгенерировать все актуальные уведомления.
        
        Args:
            user_id: ID пользователя
            settings: Настройки календаря
            all_progress: Прогресс по комплексам
            recent_session: Последняя сессия (для проверки времени)
            complex_names: Словарь complex_id -> название
            
        Returns:
            List[Notification]: Отсортированные по приоритету уведомления
        """
        notifications = []
        complex_names = complex_names or {}
        
        # 1. Проверяем падение здоровья
        health_notifications = self._check_health_drops(
            user_id, all_progress, complex_names
        )
        notifications.extend(health_notifications)
        
        # 2. Проверяем streak milestones
        streak_notification = self._check_streak_milestone(user_id, settings)
        if streak_notification:
            notifications.append(streak_notification)
        
        # 3. Проверяем предложение сменить режим (30+ дней)
        mode_notification = self._check_mode_suggestion(user_id, settings)
        if mode_notification:
            notifications.append(mode_notification)
        
        # 4. Проверяем расхождение по времени
        if recent_session:
            time_notification = self._check_time_discrepancy(
                user_id, settings, recent_session
            )
            if time_notification:
                notifications.append(time_notification)
        
        # Сортируем по приоритету
        notifications.sort(key=lambda n: n.priority)
        
        return notifications
    
    # Комплексы, которые не должны учитываться при расчете здоровья (синтетические)
    SYNTHETIC_COMPLEXES = {"daily_mix"}

    def _check_health_drops(
        self,
        user_id: str,
        all_progress: List[ComplexProgress],
        complex_names: Dict[str, str]
    ) -> List[Notification]:
        """Проверить падение здоровья комплексов."""
        notifications = []
        known_complex_ids = set(complex_names.keys())
        
        for progress in all_progress:
            # Skip if complex is synthetic (e.g. daily_mix)
            if progress.complex_id in self.SYNTHETIC_COMPLEXES:
                continue

            if known_complex_ids and progress.complex_id not in known_complex_ids:
                continue

            if progress.status not in (ComplexStatus.IN_PROGRESS, ComplexStatus.MASTERED):
                continue
            
            if progress.health_score < self.HEALTH_DROP_THRESHOLD:
                complex_name = _safe_complex_display_name(
                    complex_names.get(progress.complex_id),
                    f"Комплекс {len(notifications) + 1}",
                )
                health_percent = int(progress.health_score * 100)
                recovery_minutes = self.health_service.estimate_recovery_time(
                    progress.health_score
                )
                
                # Определяем приоритет по критичности
                if progress.health_score < 0.5:
                    priority = self.PRIORITY_CRITICAL
                elif progress.health_score < 0.65:
                    priority = self.PRIORITY_HIGH
                else:
                    priority = self.PRIORITY_MEDIUM
                
                notifications.append(Notification(
                    user_id=user_id,
                    type=NotificationType.HEALTH_DROP,
                    priority=priority,
                    title=f"{complex_name} ↓{health_percent}%",
                    message=f"Риск забывания материала. {recovery_minutes} мин вернут до 90%.",
                    action_type="fix",
                    action_data={
                        "complex_id": progress.complex_id,
                        "recovery_minutes": recovery_minutes,
                    },
                ))
        
        return notifications
    
    def _check_streak_milestone(
        self,
        user_id: str,
        settings: UserCalendarSettings
    ) -> Optional[Notification]:
        """Проверить достижение streak milestone."""
        if settings.streak_days not in self.STREAK_MILESTONES:
            return None
        
        streak = settings.streak_days
        
        if streak == 7:
            title = "🔥 Неделя занятий!"
            message = "Отличный старт! Продолжайте в том же духе."
        elif streak == 14:
            title = "🔥 2 недели подряд!"
            message = "Вы формируете отличную привычку."
        elif streak == 21:
            title = "⚠️ 3 недели — следите за нагрузкой"
            message = "Возможно, стоит сделать лёгкий день, чтобы избежать выгорания."
        elif streak == 30:
            title = "🎉 Месяц занятий!"
            message = "Невероятный результат! Рекомендуем попробовать гибкий режим."
        else:
            return None
        
        return Notification(
            user_id=user_id,
            type=NotificationType.STREAK_MILESTONE,
            priority=self.PRIORITY_LOW,
            title=title,
            message=message,
            action_type=None,
            action_data={"streak_days": streak},
        )
    
    def _check_mode_suggestion(
        self,
        user_id: str,
        settings: UserCalendarSettings
    ) -> Optional[Notification]:
        """Поздравление после 30 дней подряд."""
        if settings.streak_days < self.MODE_SUGGESTION_THRESHOLD:
            return None
        
        return Notification(
            user_id=user_id,
            type=NotificationType.MODE_SUGGESTION,
            priority=self.PRIORITY_MEDIUM,
            title=f"{settings.streak_days} дней подряд!",
            message="Вы отлично держитесь! Регулярность — ключ к запоминанию.",
            action_type=None,
            action_data={
                "current_streak": settings.streak_days,
            },
        )
    
    def _check_time_discrepancy(
        self,
        user_id: str,
        settings: UserCalendarSettings,
        session: Session
    ) -> Optional[Notification]:
        """Проверить расхождение по времени."""
        if session.active_time_seconds == 0:
            return None
        
        actual_minutes = session.active_time_seconds / 60
        target_minutes = settings.daily_time_limit_minutes
        
        diff = actual_minutes - target_minutes
        
        if abs(diff) < self.TIME_DISCREPANCY_THRESHOLD:
            return None
        
        if diff > 0:
            # Занимается дольше
            suggested = int(actual_minutes / 5) * 5 + 5  # Округляем вверх до 5
            message = f"Обычно вы занимаетесь ~{int(actual_minutes)} мин. Обновим план на {suggested} мин?"
        else:
            # Занимается меньше
            suggested = max(15, int(actual_minutes / 5) * 5)  # Минимум 15 мин
            message = f"Вы занимаетесь ~{int(actual_minutes)} мин. Уменьшим план до {suggested} мин?"
        
        return Notification(
            user_id=user_id,
            type=NotificationType.TIME_SUGGESTION,
            priority=self.PRIORITY_LOW,
            title="Обновить план времени?",
            message=message,
            action_type="update_plan",
            action_data={
                "suggested_minutes": suggested,
                "current_minutes": target_minutes,
                "actual_minutes": int(actual_minutes),
            },
        )
    
    # =========================================================================
    # MISSED DAY HANDLING
    # =========================================================================
    
    def generate_missed_day_message(
        self,
        user_id: str,
        missed_date: date,
        settings: UserCalendarSettings
    ) -> Notification:
        """
        Сгенерировать сообщение о пропущенном дне.
        
        Принцип: мягкое сообщение без давления.
        """
        # Сбросили streak
        was_streak = settings.streak_days > 0
        
        if was_streak:
            message = ("Ваш план уже перестроен. Мы распределили нагрузку на "
                      "ближайшие дни, чтобы вы не чувствовали давления. "
                      "Продолжайте в своём ритме.")
        else:
            message = ("Это нормально — пропускать дни. Ваш прогресс сохраняется. "
                      "Если график стал слишком плотным, попробуйте гибкий режим.")
        
        return Notification(
            user_id=user_id,
            type=NotificationType.HEALTH_DROP,  # Reuse for soft message
            priority=self.PRIORITY_LOW,
            title="Пропустили день? Это нормально!",
            message=message,
            action_type=None,
            action_data={"missed_date": missed_date.isoformat()},
        )
    
    # =========================================================================
    # NOTIFICATION MANAGEMENT
    # =========================================================================
    
    def dismiss_notification(
        self,
        notification: Notification
    ) -> Notification:
        """Отметить уведомление как закрытое."""
        notification.dismissed = True
        return notification
    
    def filter_undismissed(
        self,
        notifications: List[Notification]
    ) -> List[Notification]:
        """Отфильтровать только активные уведомления."""
        return [n for n in notifications if not n.dismissed]
    
    def get_top_notification(
        self,
        notifications: List[Notification]
    ) -> Optional[Notification]:
        """Получить самое важное уведомление."""
        active = self.filter_undismissed(notifications)
        if not active:
            return None
        return min(active, key=lambda n: n.priority)
