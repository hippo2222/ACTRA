"""
Calendar Service - Главный сервис календаря обучения.

Оркестрирует:
- HealthScoreService
- SchedulerService
- NotificationService

Предоставляет единый интерфейс для:
- Получения плана на день
- Управления сессиями
- Настройки расписания
- Работы с комплексами (освоение, заморозка)
"""

import json
import logging
import os
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple

from .models import (
    ComplexProgress,
    TaskAttempt,
    Session,
    UserCalendarSettings,
    Notification,
    ScheduledTask,
    DailyPlan,
    DayPlan,
    HealthSummary,
    ActivityDay,
    ComplexStatus,
    SessionType,
    ScheduleMode,
    DayStatus,
)
from .health_score_service import HealthScoreService
from .scheduler_service import SchedulerService
from .notification_service import NotificationService


def _normalize_activity_entry(raw: Any) -> Dict[str, Any]:
    """Normalize any persisted activity payload to the unified dict contract."""
    base: Dict[str, Any] = {
        "tasks_attempted": 0,
        "tasks_solved": 0,
        "seconds_spent": 0,
        "completion_percent": 0,
        "session_ids": [],
        "streak_active": False,
        "rest_day": False,
    }

    if isinstance(raw, dict):
        base.update(raw)

    for key in ("tasks_attempted", "tasks_solved", "seconds_spent", "completion_percent"):
        try:
            base[key] = int(base.get(key, 0) or 0)
        except Exception:
            base[key] = 0

    session_ids = base.get("session_ids", [])
    if not isinstance(session_ids, list):
        session_ids = []
    base["session_ids"] = session_ids
    base["streak_active"] = bool(base.get("streak_active", False))
    base["rest_day"] = bool(base.get("rest_day", False))

    return base


class CalendarService:
    """Главный сервис календаря."""
    
    def __init__(
        self,
        data_dir: str,
        user_id: str = "default_user",
        use_fsrs: bool = False
    ):
        """
        Инициализация сервиса.
        
        Args:
            data_dir: Директория с данными
            user_id: ID пользователя
            use_fsrs: Использовать FSRS модель (Stage 2)
        """
        self.data_dir = Path(data_dir)
        self.user_id = user_id
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Инициализируем под-сервисы
        self.health_service = HealthScoreService(use_fsrs=use_fsrs)
        self.scheduler_service = SchedulerService(self.health_service)
        self.notification_service = NotificationService(self.health_service)
        
        # Пути к файлам данных
        self.calendar_dir = self.data_dir / "user_calendar" / user_id
        self.calendar_dir.mkdir(parents=True, exist_ok=True)
        
        self.settings_path = self.calendar_dir / "settings.json"
        self.progress_path = self.calendar_dir / "progress.json"
        self.sessions_path = self.calendar_dir / "sessions.json"
        self.activity_path = self.calendar_dir / "activity.json"
        self.notifications_path = self.calendar_dir / "notifications.json"
        self.rest_days_path = self.calendar_dir / "rest_days.json"
    
    def switch_user(self, user_id: str) -> None:
        """
        Переключить пользователя: обновить user_id и все пути к файлам.
        
        Args:
            user_id: Новый ID пользователя
        """
        self.user_id = user_id
        self.calendar_dir = self.data_dir / "user_calendar" / user_id
        self.calendar_dir.mkdir(parents=True, exist_ok=True)
        
        self.settings_path = self.calendar_dir / "settings.json"
        self.progress_path = self.calendar_dir / "progress.json"
        self.sessions_path = self.calendar_dir / "sessions.json"
        self.activity_path = self.calendar_dir / "activity.json"
        self.notifications_path = self.calendar_dir / "notifications.json"
        self.rest_days_path = self.calendar_dir / "rest_days.json"
        
        self.logger.info("Switched calendar user to: %s", user_id)
    
    # =========================================================================
    # DATA LOADING / SAVING
    # =========================================================================
    
    def _load_json(self, path: Path, default: Any = None) -> Any:
        """Загрузить JSON файл."""
        if not path.exists():
            return default if default is not None else {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self.logger.error(f"Error loading {path}: {e}")
            return default if default is not None else {}
    
    def _save_json(self, path: Path, data: Any) -> bool:
        """Сохранить JSON файл."""
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            self.logger.error(f"Error saving {path}: {e}")
            return False
    
    def get_settings(self) -> UserCalendarSettings:
        """Получить настройки календаря."""
        data = self._load_json(self.settings_path)
        if not data:
            # Создаём настройки по умолчанию
            settings = UserCalendarSettings(user_id=self.user_id)
            self.save_settings(settings)
            return settings
        return UserCalendarSettings.from_dict(data)
    
    def save_settings(self, settings: UserCalendarSettings) -> bool:
        """Сохранить настройки."""
        settings.updated_at = datetime.now()
        return self._save_json(self.settings_path, settings.to_dict())
    
    def get_all_progress(self) -> List[ComplexProgress]:
        """Получить прогресс по всем комплексам."""
        data = self._load_json(self.progress_path, [])
        return [ComplexProgress.from_dict(p) for p in data]
    
    def save_all_progress(self, progress_list: List[ComplexProgress]) -> bool:
        """Сохранить весь прогресс."""
        return self._save_json(
            self.progress_path,
            [p.to_dict() for p in progress_list]
        )
    
    def get_complex_progress(self, complex_id: str) -> Optional[ComplexProgress]:
        """Получить прогресс по конкретному комплексу."""
        all_progress = self.get_all_progress()
        for p in all_progress:
            if p.complex_id == complex_id:
                return p
        return None
    
    def save_complex_progress(self, progress: ComplexProgress) -> bool:
        """Сохранить прогресс по комплексу."""
        all_progress = self.get_all_progress()
        
        # Обновляем или добавляем
        found = False
        for i, p in enumerate(all_progress):
            if p.complex_id == progress.complex_id:
                all_progress[i] = progress
                found = True
                break
        
        if not found:
            all_progress.append(progress)
        
        return self.save_all_progress(all_progress)
    
    def get_activity_history(self, days: int = 30) -> Dict[str, Any]:
        """
        Получить историю активности.
        
        Returns:
            Dict с форматом:
            {
                "2025-01-24": {
                    "tasks_attempted": int,
                    "tasks_solved": int,
                    "seconds_spent": int,
                    "completion_percent": int,
                    "session_ids": List[str],
                    "streak_active": bool,
                    "rest_day": bool
                }
            }
        """
        raw_data = self._load_json(self.activity_path, {})
        if not isinstance(raw_data, dict):
            return {}

        normalized: Dict[str, Dict[str, Any]] = {}
        for date_iso, day_data in raw_data.items():
            normalized[str(date_iso)] = _normalize_activity_entry(day_data)

        return normalized
    
    def save_activity(self, activity_date: date, completion_percent: int) -> bool:
        """
        Сохранить активность за день.
        
        Args:
            activity_date: Дата активности
            completion_percent: Процент выполнения (0-200)
            
        Returns:
            bool: True если успешно
        """
        data = self._load_json(self.activity_path, {})
        date_iso = activity_date.isoformat()
        
        # Гарантируем что запись существует и это словарь
        if date_iso not in data:
            data[date_iso] = {
                "tasks_attempted": 0,
                "tasks_solved": 0,
                "seconds_spent": 0,
                "completion_percent": 0,
                "session_ids": [],
                "streak_active": False,
                "rest_day": False,
            }
        elif not isinstance(data[date_iso], dict):
            # МИГРАЦИЯ: старые данные (число)
            old_completion = data[date_iso]
            data[date_iso] = {
                "tasks_attempted": 0,
                "tasks_solved": 0,
                "seconds_spent": 0,
                "completion_percent": old_completion,
                "session_ids": [],
                "streak_active": False,
                "rest_day": False,
            }
        
        # Обновляем completion_percent
        data[date_iso]["completion_percent"] = max(0, min(completion_percent, 200))
        
        return self._save_json(self.activity_path, data)
    
    def get_rest_days(self) -> Dict[str, Any]:
        """Получить список выходных дней."""
        return self._load_json(self.rest_days_path, default={})
    
    def mark_rest_day(self, date_str: str, reason: str = "manual") -> bool:
        """
        Отметить день как выходной.
        
        Args:
            date_str: Дата в формате ISO (YYYY-MM-DD)
            reason: Причина ("manual", "auto_suggestion")
        
        Returns:
            bool: Успешность операции
        """
        rest_days = self.get_rest_days()
        rest_days[date_str] = {
            "marked_by_user": True,
            "reason": reason,
            "marked_at": datetime.now().isoformat()
        }
        return self._save_json(self.rest_days_path, rest_days)
    
    def unmark_rest_day(self, date_str: str) -> bool:
        """Снять отметку выходного дня."""
        rest_days = self.get_rest_days()
        if date_str in rest_days:
            del rest_days[date_str]
            return self._save_json(self.rest_days_path, rest_days)
        return False
    
    def is_rest_day(self, date_str: str) -> bool:
        """Проверить, является ли день выходным."""
        rest_days = self.get_rest_days()
        return date_str in rest_days
    
    # =========================================================================
    # MAIN API: TODAY'S PLAN
    # =========================================================================
    
    def get_today_plan(
        self,
        task_pool: Dict[str, List[Dict[str, Any]]],
        current_complex: Optional[Dict[str, Any]] = None,
        complex_names: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Получить полный план на сегодня.
        
        Args:
            task_pool: Пул задач {complex_id: [tasks]}
            current_complex: Текущий изучаемый комплекс
            complex_names: Словарь названий комплексов
            
        Returns:
            dict: {
                "daily_plan": DailyPlan,
                "notifications": List[Notification],
                "streak_info": {...},
                "health_summary": HealthSummary,
                "schedule_strip": List[DayPlan]
            }
        """
        settings = self.get_settings()
        all_progress = self.get_all_progress()
        activity = self.get_activity_history()
        complex_names = complex_names or {}
        
        # Обновляем HealthScore для всех комплексов (сохраняем только при изменениях)
        old_scores = {p.complex_id: p.health_score for p in all_progress}
        for progress in all_progress:
            self.health_service.update_progress_health(progress)
        new_scores = {p.complex_id: p.health_score for p in all_progress}
        if old_scores != new_scores:
            self.save_all_progress(all_progress)
        
        # Проверяем пропуск вчера (но адаптируем только один раз)
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        already_adapted_today = settings.last_adapted_date == date.today()
        is_adapted = (
            yesterday not in activity
            and settings.last_activity_date is not None
            and not already_adapted_today
        )
        
        if is_adapted:
            # Пересчитываем план после пропуска (один раз)
            daily_plan = self.scheduler_service.recalculate_on_miss(
                user_id=self.user_id,
                missed_date=date.today() - timedelta(days=1),
                all_progress=all_progress,
                task_pool=task_pool,
                available_minutes=settings.daily_time_limit_minutes
            )
            # Сбрасываем streak и запоминаем дату адаптации
            settings.streak_days = 0
            settings.last_adapted_date = date.today()
            self.save_settings(settings)
        else:
            # Обычный план
            daily_plan = self.scheduler_service.build_daily_plan(
                user_id=self.user_id,
                available_minutes=settings.daily_time_limit_minutes,
                all_progress=all_progress,
                task_pool=task_pool,
                current_complex=current_complex,
            )
        
        # Логируем ключевые метрики построения плана
        try:
            self.logger.info(
                "Daily plan built",
                extra={
                    "user_id": self.user_id,
                    "is_adapted": is_adapted,
                    "daily_mix_count": len(daily_plan.daily_mix),
                    "daily_mix_minutes": daily_plan.daily_mix_estimated_minutes,
                    "main_focus_tasks_count": daily_plan.main_focus_tasks_count,
                    "available_minutes": settings.daily_time_limit_minutes,
                    "progress_items": len(all_progress),
                },
            )
        except Exception:
            # Не прерываем ответ из-за проблем логирования
            pass
        
        # ИСПРАВЛЕНИЕ 6.4.4: Получаем последнюю сессию за сегодня
        # для проверки расхождения по времени в generate_notifications()
        sessions_data = self._load_json(self.sessions_path, [])
        recent_session = None
        today_iso = date.today().isoformat()
        for s in sessions_data:
            s_date = s.get("started_at", "")[:10]
            if s_date == today_iso:
                recent_session = Session.from_dict(s)
        
        # Генерируем уведомления с передачей recent_session для проверки времени
        notifications = self.notification_service.generate_notifications(
            user_id=self.user_id,
            settings=settings,
            all_progress=all_progress,
            recent_session=recent_session,
            complex_names=complex_names,
        )
        
        # ИСПРАВЛЕНИЕ 6.4.3: Отфильтровываем закрытые уведомления
        # перед отправкой клиенту
        dismissed_data = self._load_json(self.notifications_path, {})
        dismissed_ids = dismissed_data.get("dismissed", [])
        notifications = [
            n for n in notifications
            if n.notification_id not in dismissed_ids
        ]
        
        # Добавляем сообщение о пропуске если нужно
        if is_adapted:
            missed_notification = self.notification_service.generate_missed_day_message(
                user_id=self.user_id,
                missed_date=date.today() - timedelta(days=1),
                settings=settings,
            )
            notifications.insert(0, missed_notification)
        
        # Здоровье памяти
        health_summary = self._build_health_summary(all_progress, complex_names)
        
        # Лента расписания
        rest_days = self.get_rest_days()
        schedule_strip = self.scheduler_service.build_schedule_strip(
            user_id=self.user_id,
            days_count=7,
            schedule_mode=settings.schedule_mode.value,
            activity_history=activity,
            available_minutes=settings.daily_time_limit_minutes,
            all_progress=all_progress,
            task_pool=task_pool,
            rest_days=rest_days,
            complex_names=complex_names,
        )
        
        return {
            "daily_plan": daily_plan.to_dict(),
            "notifications": [n.to_dict() for n in notifications],
            "streak_info": {
                "days": settings.streak_days,
                "mode": settings.schedule_mode.value,
                "last_activity": settings.last_activity_date.isoformat() if settings.last_activity_date else None,
            },
            "health_summary": health_summary.to_dict(),
            "schedule_strip": [d.to_dict() for d in schedule_strip],
            "settings": settings.to_dict(),
            "is_adapted": is_adapted,
            "rest_days": rest_days,
        }
    
    def _build_health_summary(
        self,
        all_progress: List[ComplexProgress],
        complex_names: Dict[str, str]
    ) -> HealthSummary:
        """Построить сводку по здоровью памяти."""
        active_progress = [
            p for p in all_progress
            if p.status in (
                ComplexStatus.IN_PROGRESS,
                ComplexStatus.MASTERED,
                ComplexStatus.FROZEN,
            )
        ]
        
        if not active_progress:
            return HealthSummary(overall_health=1.0)
        
        # Средний HealthScore
        overall = sum(p.health_score for p in active_progress) / len(active_progress)
        
        # Список комплексов
        complexes = []
        critical_count = 0
        now = datetime.now()
        
        for p in sorted(active_progress, key=lambda x: x.health_score):
            # Фильтрация: скрываем синтетические комплексы
            if p.complex_id in ("daily_mix", "study", "new_material"):
                continue

            name = complex_names.get(p.complex_id, p.complex_id)
            
            # Формируем сообщение о здоровье
            health_msg = self.health_service.format_health_message(name, p.health_score)
            
            complexes.append({
                "complex_id": p.complex_id,
                "name": name,
                "health_score": p.health_score,
                "health_percent": int(p.health_score * 100),
                "status": p.status.value,
                "is_critical": self.health_service.is_critical(p.health_score),
                # Добавляем поля сообщения
                "message": health_msg["message"],
                "recovery_time": health_msg["recovery_time"],
                "hint_title": health_msg["title"],
                # Важно для фронтенда: когда разморозится
                "frozen_until": p.frozen_until.isoformat() if p.frozen_until else None,
            })
            if self.health_service.is_critical(p.health_score):
                critical_count += 1
        
        return HealthSummary(
            overall_health=overall,
            complexes=complexes,
            critical_count=critical_count,
        )
    
    # =========================================================================
    # SETTINGS MANAGEMENT
    # =========================================================================
    
    def update_time_limit(self, minutes: int) -> Dict[str, Any]:
        """
        Обновить лимит времени.
        
        Args:
            minutes: Новый лимит (обычно 20, 30 или 45)
            
        Returns:
            dict: Обновлённые настройки
        """
        settings = self.get_settings()
        settings.daily_time_limit_minutes = minutes
        settings.suggested_time_update = None  # Сбрасываем предложение
        self.save_settings(settings)
        
        return {"success": True, "settings": settings.to_dict()}
    
    def switch_schedule_mode(self, mode: str) -> Dict[str, Any]:
        """
        Переключить режим расписания.
        
        Args:
            mode: "daily" или "flexible"
            
        Returns:
            dict: Обновлённые настройки
        """
        settings = self.get_settings()
        # Flexible mode removed: always keep daily
        settings.schedule_mode = ScheduleMode.DAILY
        self.save_settings(settings)
        
        return {"success": True, "settings": settings.to_dict()}
    
    # =========================================================================
    # SESSION MANAGEMENT
    # =========================================================================
    
    def start_session(
        self,
        session_type: str,
        complex_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Начать сессию обучения.
        
        Args:
            session_type: "daily_mix", "new_material", "unplanned"
            complex_id: ID комплекса (для new_material)
            
        Returns:
            dict: {session_id, tasks, ...}
        """
        settings = self.get_settings()
        
        session = Session(
            user_id=self.user_id,
            session_type=SessionType(session_type),
            target_time_minutes=settings.daily_time_limit_minutes,
            complex_id=complex_id,
        )
        
        # Сохраняем сессию
        sessions_data = self._load_json(self.sessions_path, [])
        sessions_data.append(session.to_dict())
        self._save_json(self.sessions_path, sessions_data)
        
        return {
            "session_id": session.session_id,
            "session_type": session_type,
            "started_at": session.started_at.isoformat(),
        }
    
    def complete_session(
        self,
        session_id: str,
        tasks_completed: int,
        active_time_seconds: int
    ) -> Dict[str, Any]:
        """
        Завершить сессию.
        
        Args:
            session_id: ID сессии
            tasks_completed: Количество выполненных задач
            active_time_seconds: Активное время в секундах
            
        Returns:
            dict: Результат с возможными уведомлениями
        """
        settings = self.get_settings()
        
        # Обновляем сессию
        sessions_data = self._load_json(self.sessions_path, [])
        session = None
        
        for s in sessions_data:
            if s.get("session_id") == session_id:
                s["ended_at"] = datetime.now().isoformat()
                s["tasks_completed"] = tasks_completed
                s["active_time_seconds"] = active_time_seconds
                session = Session.from_dict(s)
                break
        
        self._save_json(self.sessions_path, sessions_data)
        
        # Если сессия не найдена — не обновляем статистику
        if session is None:
            self.logger.warning("complete_session: session_id=%s not found", session_id)
            return {"success": False, "error": "session_not_found"}
        
        # Обновляем активность и streak
        today = date.today()
        activity = self.get_activity_history()
        today_iso = today.isoformat()
        
        # Гарантируем, что запись за сегодня существует и это словарь
        if today_iso not in activity:
            activity[today_iso] = {
                "tasks_attempted": 0,
                "tasks_solved": 0,
                "seconds_spent": 0,
                "completion_percent": 0,
                "session_ids": [],
                "streak_active": False,
                "rest_day": False,
            }
        elif not isinstance(activity[today_iso], dict):
            # МИГРАЦИЯ: если остались старые данные (число)
            old_completion = activity[today_iso]
            activity[today_iso] = {
                "tasks_attempted": 0,
                "tasks_solved": 0,
                "seconds_spent": 0,
                "completion_percent": old_completion,
                "session_ids": [],
                "streak_active": False,
                "rest_day": False,
            }
            self.logger.warning(
                f"Migrated old activity format for {self.user_id}",
                extra={"date": today_iso, "old_value": old_completion}
            )
        
        # Рассчитываем процент выполнения
        target_seconds = settings.daily_time_limit_minutes * 60
        completion = int((active_time_seconds / target_seconds) * 100) if target_seconds > 0 else 0
        
        # Обновляем completion_percent (не перезаписываем, обновляем максимум)
        activity[today_iso]["completion_percent"] = max(
            activity[today_iso]["completion_percent"],
            min(completion, 200)  # Max 200%
        )
        
        # NOTE: tasks_attempted, tasks_solved, seconds_spent обновляются в record_task_attempt.
        # complete_session отвечает только за completion_percent, session_ids и streak.
        
        # Добавляем session_id если его ещё нет
        if session_id not in activity[today_iso]["session_ids"]:
            activity[today_iso]["session_ids"].append(session_id)
        
        self._save_json(self.activity_path, activity)
        
        # ИСПРАВЛЕНИЕ 6.4.1: Пересчитаем здоровье для всех комплексов
        # после завершения сессии, чтобы уведомления отражали актуальное состояние
        all_progress = self.get_all_progress()
        for progress in all_progress:
            self.health_service.update_progress_health(progress)
        self.save_all_progress(all_progress)
        
        # Обновляем streak
        if settings.last_activity_date != today:
            if settings.last_activity_date == today - timedelta(days=1):
                settings.streak_days += 1
            elif settings.last_activity_date is None:
                settings.streak_days = 1
            else:
                # Пропуск > 1 дня — сбрасываем streak (не полагаемся на get_today_plan)
                settings.streak_days = 1
            
            settings.last_activity_date = today
            activity[today_iso]["streak_active"] = True
            self.save_settings(settings)
        
        # Проверяем уведомление о времени
        notifications = []
        if session:
            time_notification = self.notification_service._check_time_discrepancy(
                self.user_id, settings, session
            )
            if time_notification:
                notifications.append(time_notification.to_dict())
        
        return {
            "success": True,
            "completion_percent": activity[today_iso]["completion_percent"],
            "streak_days": settings.streak_days,
            "notifications": notifications,
        }
    
    # =========================================================================
    # COMPLEX MANAGEMENT
    # =========================================================================
    
    def freeze_complex(
        self,
        complex_id: str,
        days: int = 30
    ) -> Dict[str, Any]:
        """
        Заморозить комплекс.
        
        Args:
            complex_id: ID комплекса
            days: На сколько дней (30, 60, 90)
            
        Returns:
            dict: Обновлённый прогресс
        """
        progress = self.get_complex_progress(complex_id)

        if not progress:
            return {"success": False, "error": "complex_not_active"}

        if progress.status != ComplexStatus.IN_PROGRESS:
            return {"success": False, "error": "complex_not_active"}
        
        progress.status = ComplexStatus.FROZEN
        progress.frozen_until = datetime.now() + timedelta(days=days)
        progress.updated_at = datetime.now()
        
        self.save_complex_progress(progress)
        
        return {"success": True, "progress": progress.to_dict()}
    
    def unfreeze_complex(self, complex_id: str) -> Dict[str, Any]:
        """Разморозить комплекс."""
        progress = self.get_complex_progress(complex_id)
        
        if not progress:
            return {"success": False, "error": "Complex not found"}

        if progress.status != ComplexStatus.FROZEN:
            return {"success": False, "error": "complex_not_frozen"}
        
        progress.status = ComplexStatus.IN_PROGRESS
        progress.frozen_until = None
        progress.updated_at = datetime.now()
        
        self.save_complex_progress(progress)
        
        return {"success": True, "progress": progress.to_dict()}
    
    def mark_complex_mastered(self, complex_id: str) -> Dict[str, Any]:
        """Отметить комплекс как освоенный."""
        progress = self.get_complex_progress(complex_id)
        
        if not progress:
            return {"success": False, "error": "Complex not found"}
        
        progress.status = ComplexStatus.MASTERED
        progress.updated_at = datetime.now()
        
        self.save_complex_progress(progress)
        
        return {"success": True, "progress": progress.to_dict()}
    
    # =========================================================================
    # ACTIVITY & HEATMAP
    # =========================================================================
    
    def get_activity_for_heatmap(self, days: int = 30) -> List[Dict[str, Any]]:
        """
        Получить данные для тепловой карты.
        
        Args:
            days: Количество дней
            
        Returns:
            List[ActivityDay]
        """
        activity = self.get_activity_history()
        rest_days = self.get_rest_days()
        settings = self.get_settings()
        target_minutes = settings.daily_time_limit_minutes
        today = date.today()
        result = []
        
        # Проверяем, была ли хоть какая-то активность (для определения пропусков)
        has_any_activity = False
        for day_data in activity.values():
            if isinstance(day_data, dict):
                if day_data.get("tasks_solved", 0) > 0 or day_data.get("tasks_attempted", 0) > 0:
                    has_any_activity = True
                    break
            elif isinstance(day_data, int) and day_data > 0:
                # Обратная совместимость со старым форматом (просто процент)
                has_any_activity = True
                break
        
        for i in range(days - 1, -1, -1):
            current_date = today - timedelta(days=i)
            date_iso = current_date.isoformat()
            
            day_data = activity.get(date_iso, {})
            is_rest = date_iso in rest_days
            
            # Поддержка старого формата (int) и нового (dict)
            if isinstance(day_data, dict):
                tasks_solved = day_data.get("tasks_solved", 0)
                tasks_attempted = day_data.get("tasks_attempted", 0)
                seconds_spent = day_data.get("seconds_spent", 0)
            else:
                # Старый формат: просто процент, конвертируем в примерные задачи
                tasks_solved = day_data // 20 if day_data > 0 else 0
                tasks_attempted = tasks_solved
                seconds_spent = 0
            
            # Используем сохранённый completion_percent (основан на времени);
            # если его нет или 0, а задачи решены — fallback на tasks_solved * 20
            if isinstance(day_data, dict):
                stored_pct = day_data.get("completion_percent", 0)
                completion_percent = stored_pct if stored_pct > 0 else min(tasks_solved * 20, 200)
            else:
                completion_percent = min(tasks_solved * 20, 200)
            
            # Если нет ни одной активности в истории, не подсвечиваем дни как пропуски
            is_missed = (
                tasks_solved == 0
                and current_date < today
                and not is_rest
                and has_any_activity
            )
            
            result.append(ActivityDay(
                date=current_date,
                completion_percent=completion_percent,
                is_missed=is_missed,
                is_today=current_date == today,
                is_future=current_date > today,
                is_rest_day=is_rest,
                tasks_solved=tasks_solved,
                tasks_attempted=tasks_attempted,
                seconds_spent=seconds_spent,
                target_minutes=target_minutes,
            ).to_dict())
        
        # Добавляем 1 будущий день
        result.append(ActivityDay(
            date=today + timedelta(days=1),
            completion_percent=0,
            is_missed=False,
            is_today=False,
            is_future=True,
            is_rest_day=False,
            tasks_solved=0,
            tasks_attempted=0,
            seconds_spent=0,
            target_minutes=target_minutes,
        ).to_dict())
        
        return result
    
    # =========================================================================
    # NOTIFICATION MANAGEMENT
    # =========================================================================
    
    def dismiss_notification(self, notification_id: str) -> Dict[str, Any]:
        """Закрыть уведомление."""
        # ИСПРАВЛЕНИЕ 6.4.3: Сохраняем dismissed_ids для фильтрации
        # при последующих вызовах get_today_plan()
        dismissed = self._load_json(self.notifications_path, {"dismissed": []})
        
        if notification_id not in dismissed["dismissed"]:
            dismissed["dismissed"].append(notification_id)
            self._save_json(self.notifications_path, dismissed)
        
        return {"success": True}
    
    # =========================================================================
    # TASK ATTEMPT RECORDING
    # =========================================================================
    
    def record_task_attempt(
        self,
        task_id: str,
        complex_id: str,
        user_grading: int,
        response_time_seconds: float,
        confidence_rating: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Записать попытку выполнения задачи.
        
        Args:
            task_id: ID задачи
            complex_id: ID комплекса
            user_grading: 0 или 1
            response_time_seconds: Время ответа
            confidence_rating: Оценка уверенности 1-5 (Stage 2)
            
        Returns:
            dict: Обновлённый прогресс комплекса
        """
        attempt = TaskAttempt(
            task_id=task_id,
            user_id=self.user_id,
            complex_id=complex_id,
            user_grading=user_grading,
            confidence_rating=confidence_rating,
            response_time_seconds=response_time_seconds,
        )
        
        # Обновляем прогресс комплекса
        progress = self.get_complex_progress(complex_id)
        
        if not progress:
            # Не создаём фантомный ComplexProgress для неизвестного комплекса —
            # запись попытки в activity всё равно произойдёт ниже, но прогресс
            # по комплексу появится только после явной регистрации.
            self.logger.warning(
                "record_task_attempt: no progress found for complex_id=%s, "
                "creating new progress record", complex_id
            )
            progress = ComplexProgress(
                complex_id=complex_id,
                user_id=self.user_id,
                status=ComplexStatus.IN_PROGRESS if user_grading == 1 else ComplexStatus.NEW,
            )
        elif progress.status == ComplexStatus.NEW and user_grading == 1:
            # Активация комплекса происходит после первой успешной попытки
            progress.status = ComplexStatus.IN_PROGRESS
        
        progress.total_attempts += 1
        if user_grading == 1:
            progress.total_tasks_completed += 1
        
        progress.last_reviewed_at = datetime.now()
        
        # Пересчитываем HealthScore
        self.health_service.update_progress_health(progress, [attempt])
        
        self.save_complex_progress(progress)
        
        # Обновляем активность за сегодня (инкрементально)
        # Сохраняем сырые данные: tasks_solved, tasks_attempted, seconds_spent
        today = date.today()
        activity = self.get_activity_history()
        today_iso = today.isoformat()
        
        # Получаем или создаём запись за сегодня (ВСЕГДА СЛОВАРЬ!)
        if today_iso not in activity:
            activity[today_iso] = {
                "tasks_attempted": 0,
                "tasks_solved": 0,
                "seconds_spent": 0,
                "completion_percent": 0,
                "session_ids": [],
                "streak_active": False,
                "rest_day": False,
            }
        elif not isinstance(activity[today_iso], dict):
            # МИГРАЦИЯ: если остались старые данные (число)
            old_completion = activity[today_iso]
            activity[today_iso] = {
                "tasks_attempted": 0,
                "tasks_solved": 0,
                "seconds_spent": 0,
                "completion_percent": old_completion,
                "session_ids": [],
                "streak_active": False,
                "rest_day": False,
            }
            self.logger.warning(
                f"Migrated old activity format for {self.user_id}",
                extra={"date": today_iso, "old_value": old_completion}
            )
        
        # Инкрементируем счётчики
        activity[today_iso]["tasks_attempted"] += 1
        if user_grading == 1:
            activity[today_iso]["tasks_solved"] += 1
        activity[today_iso]["seconds_spent"] += int(response_time_seconds)
        
        self._save_json(self.activity_path, activity)
        
        return {
            "success": True,
            "attempt": attempt.to_dict(),
            "progress": progress.to_dict(),
        }
