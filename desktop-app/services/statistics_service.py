"""
Statistics Service - агрегация статистики пользователя.

Предоставляет методы для:
- Агрегации статистики из task_history
- Определения слабых областей
- Вычисления производительности по типам заданий
- Кэширования результатов для производительности

ФАЗА 1: Профили пользователей и расширенная статистика
ФАЗА 3: Улучшенная аналитика комплексов
"""

import json
import logging
import time
from pathlib import Path
from typing import Dict, Any, List, Optional, Union
from collections import defaultdict
from datetime import datetime, date

from services.progress_service import ProgressService
from task_system.core.models.complex_models import (
    ExtendedSessionResultSummary,
    RecentSessionSummary
)


def _safe_int(value: Any, *, minimum: int = 0) -> int:
    """Best-effort integer cast with lower-bound clamp."""
    try:
        parsed = int(value or 0)
    except Exception:
        parsed = 0
    if parsed < minimum:
        return minimum
    return parsed


def _safe_float(value: Any, *, minimum: float = 0.0) -> float:
    """Best-effort float cast with lower-bound clamp."""
    try:
        parsed = float(value or 0.0)
    except Exception:
        parsed = 0.0
    if parsed < minimum:
        return minimum
    return parsed


def _safe_rate(numerator: int, denominator: int) -> float:
    """Return rounded safe rate for non-negative counters."""
    if denominator <= 0:
        return 0.0
    return round(float(numerator) / float(denominator), 3)


class StatisticsService:
    """
    Сервис для агрегации статистики пользователя.
    
    Использует ProgressService для получения данных и агрегирует их
    для отображения в UI.
    
    Особенности:
    - Кэширование результатов (TTL 5 минут)
    - Автоматическое обновление кэша при изменении данных
    - Поддержка фильтрации по периодам времени
    
    Использование:
        service = StatisticsService(progress_service, module_repository=repo)
        stats = service.aggregate_statistics(user_id="user_123")
        weak_areas = service.get_weak_areas(user_id="user_123", threshold=0.70)
        performance = service.get_performance_by_type(user_id="user_123")
    """

    # Стандартный порог для определения слабых областей (success_rate < 0.70)
    DEFAULT_WEAK_AREA_THRESHOLD = 0.70
    
    def __init__(self, progress_service: ProgressService, module_repository: Optional[Any] = None, 
                 data_dir: Optional[str] = None, event_bus: Optional[Any] = None):
        """
        Инициализация StatisticsService.
        
        Args:
            progress_service: Экземпляр ProgressService для получения данных
            module_repository: Опциональный экземпляр ModuleRepository для получения общего количества заданий
            data_dir: Путь к директории с данными (если None, используется config.json)
        """
        self.progress_service = progress_service
        self.module_repository = module_repository
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Определяем data_dir
        if data_dir is None:
            from common.config_loader import load_config
            config = load_config()
            data_dir = config.get("data_root", "data")
        self.data_dir = Path(data_dir)
        self.users_dir = self.data_dir / "users"
        
        # Кэш статистики: {user_id: (data, timestamp)}
        self._cache: Dict[str, tuple] = {}
        self._cache_ttl = 300  # 5 минут в секундах

        # Кэш динамики: {(user_id, days): (data, timestamp)}
        self._time_dynamics_cache: Dict[tuple, tuple] = {}
        self._time_dynamics_cache_ttl = 180  # 3 минуты достаточно для графика

        # Lazy microcards analytics bridge (M6)
        self._microcards_analytics_service: Optional[Any] = None
        
        # Подписываемся на события обновления прогресса для автоматической инвалидации кэша
        if event_bus:
            event_bus.subscribe('progress_updated', self._on_progress_updated)
            self.logger.debug("Subscribed to progress_updated events")
    
    def set_module_repository(self, module_repository: Any):
        """
        Устанавливает ModuleRepository для получения общего количества заданий.
        
        Args:
            module_repository: Экземпляр ModuleRepository
        """
        self.module_repository = module_repository
        # Очищаем кэш при обновлении репозитория
        self._cache.clear()

    def _get_microcards_analytics_service(self) -> Optional[Any]:
        """
        Lazily create microcards analytics service and reuse it across requests.

        Uses a sentinel `False` value when initialization failed to avoid
        repeated import/init attempts on every statistics call.
        """
        if self._microcards_analytics_service is False:
            return None
        if self._microcards_analytics_service is not None:
            return self._microcards_analytics_service
        try:
            from services.microcards_analytics_service import MicrocardsAnalyticsService
            self._microcards_analytics_service = MicrocardsAnalyticsService(str(self.data_dir))
            return self._microcards_analytics_service
        except Exception as exc:
            self.logger.warning("Failed to initialize MicrocardsAnalyticsService bridge: %s", exc)
            self._microcards_analytics_service = False
            return None

    def _read_json_file(self, path: Path, default: Any) -> Any:
        if not path.exists():
            return default
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception as exc:
            self.logger.warning("Failed to read JSON file %s: %s", path, exc)
            return default

    def _normalize_ratings_distribution(self, raw: Any) -> Dict[str, int]:
        payload = raw if isinstance(raw, dict) else {}
        return {
            "again": _safe_int(payload.get("again"), minimum=0),
            "hard": _safe_int(payload.get("hard"), minimum=0),
            "good": _safe_int(payload.get("good"), minimum=0),
            "easy": _safe_int(payload.get("easy"), minimum=0),
        }

    def _empty_microcards_overall_payload(self) -> Dict[str, Any]:
        return {
            "reviews_total": 0,
            "correct_rate": 0.0,
            "time_spent_seconds": 0,
            "decks_active": 0,
            "by_card_type": {},
            "ratings_distribution": self._normalize_ratings_distribution({}),
        }

    def _build_microcards_overall_payload(self, user_id: str) -> Dict[str, Any]:
        """
        Build additive microcards block for /api/statistics/overall.

        Reads from M5 analytics summary so runtime/home/stats use one source.
        """
        svc = self._get_microcards_analytics_service()
        if svc is None:
            return self._empty_microcards_overall_payload()

        try:
            summary = svc.get_summary(user_id=user_id)
            totals = summary.get("totals") if isinstance(summary.get("totals"), dict) else {}
            by_card_type = summary.get("by_card_type") if isinstance(summary.get("by_card_type"), dict) else {}
            ratings_distribution = self._normalize_ratings_distribution(summary.get("ratings_distribution"))
            return {
                "reviews_total": _safe_int(totals.get("reviews"), minimum=0),
                "correct_rate": round(_safe_float(totals.get("correct_rate"), minimum=0.0), 3),
                "time_spent_seconds": _safe_int(totals.get("time_spent_seconds"), minimum=0),
                "decks_active": _safe_int(totals.get("decks_active"), minimum=0),
                "by_card_type": by_card_type,
                "ratings_distribution": ratings_distribution,
            }
        except Exception as exc:
            self.logger.warning("Failed to build microcards overall payload for user %s: %s", user_id, exc)
            return self._empty_microcards_overall_payload()

    def _load_calendar_activity(self, user_id: str) -> Dict[str, Any]:
        payload = self._read_json_file(
            self.data_dir / "user_calendar" / user_id / "activity.json",
            {},
        )
        if isinstance(payload, dict):
            return payload
        return {}

    def _has_learning_activity(self, day_payload: Any) -> bool:
        if isinstance(day_payload, dict):
            attempts = _safe_int(day_payload.get("activity_attempts_total"), minimum=0)
            if attempts <= 0:
                # Legacy fallback: old payloads may not have mixed totals yet.
                attempts = (
                    _safe_int(day_payload.get("tasks_attempted"), minimum=0)
                    + _safe_int(day_payload.get("microcards_reviews"), minimum=0)
                )
            completion = _safe_int(day_payload.get("completion_percent"), minimum=0)
            return attempts > 0 or completion > 0
        if isinstance(day_payload, (int, float)):
            return int(day_payload) > 0
        return False

    def _extract_microcards_day_metrics(self, day_payload: Any) -> Dict[str, int]:
        if not isinstance(day_payload, dict):
            return {
                "reviews": 0,
                "correct_reviews": 0,
                "time_spent_seconds": 0,
            }
        return {
            "reviews": _safe_int(day_payload.get("microcards_reviews"), minimum=0),
            "correct_reviews": _safe_int(day_payload.get("microcards_correct"), minimum=0),
            "time_spent_seconds": _safe_int(day_payload.get("microcards_seconds_spent"), minimum=0),
        }

    def _compute_activity_streak_metrics(self, user_id: str) -> Dict[str, int]:
        """
        Compute mixed activity streak metrics from calendar activity history.

        `activity_streak_days` is the current streak (active today or yesterday),
        `activity_streak_best` is the best consecutive run in history.
        """
        activity = self._load_calendar_activity(user_id)
        active_dates: List[date] = []
        for day_iso, day_payload in activity.items():
            try:
                day_obj = date.fromisoformat(str(day_iso))
            except Exception:
                continue
            if self._has_learning_activity(day_payload):
                active_dates.append(day_obj)

        if not active_dates:
            return {"activity_streak_days": 0, "activity_streak_best": 0}

        active_dates = sorted(set(active_dates))
        today = date.today()
        active_dates = [item for item in active_dates if item <= today]
        if not active_dates:
            return {"activity_streak_days": 0, "activity_streak_best": 0}

        best_streak = 0
        run = 0
        prev_day: Optional[date] = None
        for day_obj in active_dates:
            if prev_day is None:
                run = 1
            else:
                gap = (day_obj - prev_day).days
                if gap == 1:
                    run += 1
                else:
                    run = 1
            best_streak = max(best_streak, run)
            prev_day = day_obj

        current_streak = 0
        last_day = active_dates[-1]
        if (today - last_day).days <= 1:
            current_streak = 1
            prev_cursor = last_day
            for day_obj in reversed(active_dates[:-1]):
                if (prev_cursor - day_obj).days == 1:
                    current_streak += 1
                    prev_cursor = day_obj
                else:
                    break

        return {
            "activity_streak_days": current_streak,
            "activity_streak_best": best_streak,
        }
    
    def aggregate_statistics(
        self,
        user_id: str,
        force_refresh: bool = False,
        days: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Агрегирует статистику пользователя из task_history.
        
        Args:
            user_id: ID пользователя
            force_refresh: Принудительное обновление кэша
            days: Количество дней для фильтрации (None = за все время)
        
            Returns:
            dict: {
                "total_tasks_attempted": int,
                "tasks_mastered": int,
                "total_tasks_available": int,
                "success_rate": float,
                "total_time_spent": int,
                "by_task_type": {...},
                "last_updated": str,
                "period_days": int,
            }
        """
        # Проверяем кэш
        cache_key = f"stats_{user_id}_{days}"
        if not force_refresh and cache_key in self._cache:
            cached_data, timestamp = self._cache[cache_key]
            if time.time() - timestamp < self._cache_ttl:
                self.logger.debug(f"Returning cached statistics for user {user_id} (days={days})")
                return cached_data
        
        # Убеждаемся, что ProgressService работает с правильным пользователем
        if self.progress_service.user_id != user_id:
            self.logger.debug(f"Switching ProgressService from {self.progress_service.user_id} to {user_id}")
            self.progress_service.switch_user(user_id)
        
        # Получаем данные из ProgressService
        try:
            progress_data = self.progress_service.progress_manager.get_progress_data()
            task_history = progress_data.get("task_history", {})
            complex_completions = progress_data.get("complex_completions", []) or []

            # Determine cutoff date
            from datetime import timedelta
            cutoff_date = None
            if days is not None:
                # Use current time at midnight for consistency logic if needed, 
                # but better to just subtract days from NOW.
                # Actually "Today" usually means "since 00:00 today" or "last 24h"?
                 # Use current time at midnight as anchor for "Today" logic
                 # This ensures that "1 day" always means "Today" (since 00:00),
                 # regardless of whether the user has practiced recently or not.
                 ref_date = datetime.now()
                 
                 # Calculate start of the period. 
                 # "1 day" usually means "Today" (since midnight of ref_date)
                 # "7 days" means last 7 days including today.
                 if days == 1:
                     cutoff_date = ref_date.replace(hour=0, minute=0, second=0, microsecond=0)
                 else:
                     # Start of (N-1) days ago, so [start, end] covers N days
                     # e.g. if days=7, we want today + 6 previous days
                     start_date = ref_date - timedelta(days=days - 1)
                     cutoff_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
                 
                 # Update anchor for "Today" stats
                 anchor_date_iso = ref_date.date().isoformat()
            else:
                 anchor_date_iso = datetime.now().date().isoformat()

            def _parse_ts(ts_str):
                if not ts_str: return None
                try:
                    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    # Naive conversion for comparison
                    if dt.tzinfo: dt = dt.astimezone().replace(tzinfo=None)
                    return dt
                except:
                    return None

            # Filter completions
            filtered_completions = []
            if cutoff_date:
                for entry in complex_completions:
                    ds = entry.get("date") # YYYY-MM-DD
                    if ds:
                        try:
                            d_date = datetime.strptime(ds, "%Y-%m-%d")
                            if d_date >= cutoff_date:
                                filtered_completions.append(entry)
                        except: pass
            else:
                filtered_completions = complex_completions

            # Количество завершений комплексов за "сегодня" (по якорю)
            completed_complexes_today = sum(
                1
                for entry in complex_completions
                if (entry or {}).get("date") == anchor_date_iso
            )
            completed_complexes_period = len(filtered_completions)
            
            # Предрасчёт gap (всегда по полной истории для корректного стрика)
            completion_dates_set = set(e.get("date") for e in complex_completions if e.get("date"))
            # ... (streak logic remains on full history usually, OR should it be filtered?
            # Streak is a global property of the user. "Period stats" shouldn't change current streak.)
            
            # Инициализация счетчиков
            total_attempts = 0
            total_time_spent = 0
            successful_attempts = 0
            
            mastered_tasks = set()
            
            by_task_type: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
                "attempts": 0,
                "successes": 0,
                "success_rate": 0.0,
                "scores_sum": 0.0,
                "scores_count": 0
            })
            
            # Обрабатываем попытки
            filtered_history_tasks_count = 0
            
            for task_ref, task_data in task_history.items():
                attempts = task_data.get("attempts", [])
                
                # Filter attempts
                task_attempts_filtered = []
                for attempt in attempts:
                    if cutoff_date:
                        ts = _parse_ts(attempt.get("timestamp"))
                        if not ts:
                            continue
                        # Debug first few rejections
                        if ts < cutoff_date:
                            # self.logger.debug(f"Rejecting attempt {ts} < {cutoff_date}")
                            continue
                    task_attempts_filtered.append(attempt)
                
                if not task_attempts_filtered and days is not None:
                     # Skip task if no attempts in period
                     continue
                
                filtered_history_tasks_count += 1
                has_successful_attempt = False
                
                for attempt in task_attempts_filtered:
                    total_attempts += 1
                    
                    success = attempt.get("success", False)
                    time_spent = attempt.get("time_spent", 0)
                    
                    if success:
                        successful_attempts += 1
                        has_successful_attempt = True
                    
                    total_time_spent += time_spent
                    
                    task_type = self._extract_task_type(task_ref)
                    
                    by_task_type[task_type]["attempts"] += 1
                    if success:
                        by_task_type[task_type]["successes"] += 1
                    if "score" in attempt:
                        try:
                            by_task_type[task_type]["scores_sum"] += float(attempt.get("score", 0))
                            by_task_type[task_type]["scores_count"] += 1
                        except: pass
                
                if has_successful_attempt:
                    mastered_tasks.add(task_ref)
            
            # ... (rate calculations) ...
            
            # Вычисляем success_rate для типов заданий
            for task_type in by_task_type:
                type_data = by_task_type[task_type]
                if type_data["attempts"] > 0:
                    type_data["success_rate"] = type_data["successes"] / type_data["attempts"]
                    # Средний балл по типу (если есть score), иначе fallback на success_rate
                    if type_data["scores_count"] > 0:
                        type_data["average_score"] = type_data["scores_sum"] / type_data["scores_count"]
                    else:
                        # Fallback для старых данных, где не было поля score
                        type_data["average_score"] = type_data["success_rate"] * 100.0
                # Удаляем временные поля
                del type_data["successes"]
                del type_data["scores_sum"]
                del type_data["scores_count"]
            
            # Вычисляем общие метрики
            success_rate = successful_attempts / total_attempts if total_attempts > 0 else 0.0
            # Средний балл (если score есть в попытках), иначе fallback на success_rate
            scores = []
            for task_data in task_history.values():
                for attempt in task_data.get("attempts", []):
                    if "score" in attempt:
                        try:
                            scores.append(float(attempt.get("score", 0)))
                        except Exception:
                            continue
            
            if scores:
                average_score = sum(scores) / len(scores)
            else:
                # Fallback для всей статистики
                average_score = success_rate * 100.0

            # Рассчитываем streak по завершениям комплексов (разрыв <=1 день).
            # NOTE: This is the *completion-based* streak for time_dynamics charts.
            # The canonical user-facing streak is CalendarService → UserCalendarSettings.streak_days,
            # which tracks consecutive days of any activity.  Do NOT use this value for UI streak badges.
            streak_days = 0
            best_streak = 0
            streak_gap = 0
            if completion_dates_set:
                sorted_dates = sorted(completion_dates_set)
                prev_date = None
                for ds in sorted_dates:
                    try:
                        d = datetime.strptime(ds, "%Y-%m-%d").date()
                    except Exception:
                        continue
                    if prev_date is None:
                        streak_days = 1
                    else:
                        gap = (d - prev_date).days - 1
                        if gap <= 1:
                            streak_days += 1
                        else:
                            streak_days = 1
                        streak_gap = max(gap, 0)
                    best_streak = max(best_streak, streak_days)
                    prev_date = d
            
            # Check if the streak is current (active today or yesterday)
            # If the last activity was 2+ days ago, the current streak is broken/zero.
            if completion_dates_set and streak_days > 0:
                try:
                    # completion_dates_set contains strings YYYY-MM-DD
                    # We can pick the max one easily since ISO format sorts lexicographically
                    last_ds = max(completion_dates_set) 
                    last_date = datetime.strptime(last_ds, "%Y-%m-%d").date()
                    today_date = datetime.now().date()
                    
                    gap_days = (today_date - last_date).days
                    if gap_days > 1:
                        streak_days = 0
                except Exception as e:
                    self.logger.warning(f"Error checking streak currency: {e}")
                    # Fallback: do not reset, keep calculated value
            
            tasks_mastered = len(mastered_tasks)
            
            # Получаем общее количество доступных заданий (если module_repository доступен)
            total_tasks_available = 0
            if self.module_repository:
                try:
                    repo_stats = self.module_repository.get_repository_stats()
                    total_tasks_available = repo_stats.get("tasks", 0)
                except Exception as e:
                    self.logger.warning(f"Failed to get total tasks count: {e}")

            # M6: mixed-aware additive fields (legacy task-centric fields stay unchanged)
            microcards_stats = self._build_microcards_overall_payload(user_id=user_id)
            activity_streak = self._compute_activity_streak_metrics(user_id=user_id)
            learning_sources = {
                "tasks": {
                    "attempts": total_attempts,
                    "time_spent_seconds": total_time_spent,
                },
                "microcards": {
                    "attempts": _safe_int(microcards_stats.get("reviews_total"), minimum=0),
                    "time_spent_seconds": _safe_int(microcards_stats.get("time_spent_seconds"), minimum=0),
                },
            }
            learning_sources["combined"] = {
                "attempts": learning_sources["tasks"]["attempts"] + learning_sources["microcards"]["attempts"],
                "time_spent_seconds": (
                    learning_sources["tasks"]["time_spent_seconds"]
                    + learning_sources["microcards"]["time_spent_seconds"]
                ),
            }
            
            # Логируем детальную информацию для отладки
            self.logger.debug(
                f"Statistics calculation for user {user_id}: "
                f"total_attempts={total_attempts}, "
                f"tasks_mastered={tasks_mastered}, "
                f"total_tasks_available={total_tasks_available}, "
                f"success_rate={success_rate:.2%}, "
                f"task_history_size={len(task_history)}"
            )
            
            # Формируем результат
            result = {
                "total_tasks_attempted": total_attempts,
                "tasks_mastered": tasks_mastered,
                "total_tasks_available": total_tasks_available,
                # Для обратной совместимости с тестами/старым UI
                "total_tasks_completed": successful_attempts,
                "success_rate": round(success_rate, 3),
                "average_score": round(average_score, 3),
                "total_time_spent": total_time_spent,
                "by_task_type": dict(by_task_type),
                "last_updated": datetime.now().isoformat(),
                "streak_days": streak_days,
                "streak_best": best_streak,
                "streak_gap": streak_gap,
                "completed_complexes_today": completed_complexes_today,
                "completed_complexes_period": completed_complexes_period,
                "activity_streak_days": _safe_int(activity_streak.get("activity_streak_days"), minimum=0),
                "activity_streak_best": _safe_int(activity_streak.get("activity_streak_best"), minimum=0),
                "microcards": microcards_stats,
                "learning_sources": learning_sources,
            }
            
            # Сохраняем в кэш
            self._cache[cache_key] = (result, time.time())
            
            self.logger.info(
                f"Aggregated statistics for user {user_id}: "
                f"{total_attempts} attempts, {success_rate:.1%} success rate"
            )
            
            return result
            
        except Exception as e:
            self.logger.error(f"Failed to aggregate statistics for user {user_id}: {e}")
            # Возвращаем пустую статистику при ошибке
            return {
                "total_tasks_attempted": 0,
                "tasks_mastered": 0,
                "total_tasks_available": 0,
                "total_tasks_completed": 0,  # Для обратной совместимости
                "success_rate": 0.0,
                "total_time_spent": 0,
                "by_task_type": {},
                "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
                "completed_complexes_today": 0,
                "completed_complexes_period": 0,
                "activity_streak_days": 0,
                "activity_streak_best": 0,
                "microcards": self._empty_microcards_overall_payload(),
                "learning_sources": {
                    "tasks": {"attempts": 0, "time_spent_seconds": 0},
                    "microcards": {"attempts": 0, "time_spent_seconds": 0},
                    "combined": {"attempts": 0, "time_spent_seconds": 0},
                },
            }
    
    def get_weak_areas(self, user_id: str, threshold: Optional[float] = None) -> List[Dict[str, Any]]:
        """
        Получает слабые области (темы с низким success_rate).
        
        Args:
            user_id: ID пользователя
            threshold: Порог success_rate (если None, используется DEFAULT_WEAK_AREA_THRESHOLD)
        
        Returns:
            List[dict]: [
                {
                    "module": str,
                    "topic": str,
                    "success_rate": float,
                    "attempts": int
                },
                ...
            ]
        """
        if threshold is None:
            threshold = self.DEFAULT_WEAK_AREA_THRESHOLD
            
        # Убеждаемся, что ProgressService работает с правильным пользователем
        if self.progress_service.user_id != user_id:
            self.progress_service.switch_user(user_id)
        
        try:
            progress_data = self.progress_service.progress_manager.get_progress_data()
            task_history = progress_data.get("task_history", {})
            
            # Группируем попытки по темам
            topic_stats: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
                "module": "",
                "topic": "",
                "attempts": 0,
                "successes": 0
            })
            
            # Обрабатываем все попытки
            for task_ref, task_data in task_history.items():
                # Извлекаем module и topic из task_ref
                parts = task_ref.split("/")
                if len(parts) >= 2:
                    module_id = parts[0]
                    topic_id = parts[1]
                    topic_key = f"{module_id}/{topic_id}"
                    
                    topic_stats[topic_key]["module"] = module_id
                    topic_stats[topic_key]["topic"] = topic_id
                    
                    attempts = task_data.get("attempts", [])
                    for attempt in attempts:
                        topic_stats[topic_key]["attempts"] += 1
                        if attempt.get("success", False):
                            topic_stats[topic_key]["successes"] += 1
            
            # Вычисляем success_rate и фильтруем слабые области
            weak_areas = []
            for topic_key, stats in topic_stats.items():
                if stats["attempts"] > 0:
                    success_rate = stats["successes"] / stats["attempts"]
                    
                    if success_rate < threshold:
                        weak_areas.append({
                            "module": stats["module"],
                            "topic": stats["topic"],
                            "success_rate": round(success_rate, 3),
                            "attempts": stats["attempts"]
                        })
            
            # Сортируем по success_rate (от худшего к лучшему)
            weak_areas.sort(key=lambda x: x["success_rate"])
            
            self.logger.info(
                f"Found {len(weak_areas)} weak areas for user {user_id} "
                f"(threshold={threshold})"
            )
            
            return weak_areas
            
        except Exception as e:
            self.logger.error(f"Failed to get weak areas for user {user_id}: {e}")
            return []
    
    def get_performance_by_type(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        """
        Получает производительность по типам заданий.
        
        Args:
            user_id: ID пользователя
        
        Returns:
            dict: {
                "click": {
                    "attempts": int,
                    "success_rate": float
                },
                "draw": {...},
                ...
            }
        """
        # Используем aggregate_statistics для получения данных
        stats = self.aggregate_statistics(user_id)
        return stats.get("by_task_type", {})
    
    def get_time_dynamics(
        self,
        user_id: str,
        days: int = 30,
        force_refresh: bool = False,
        smoothing_window: int = 3
    ) -> List[Dict[str, Any]]:
        """
        Получает динамику производительности по времени.
        
        Использует логику "Last Attempt" - для каждого дня берет только последнюю попытку
        каждого задания, затронутого в этот день. Это показывает итоговый уровень знаний
        на конец дня, а не количество ошибок в процессе обучения.
        
        Дополнительно собирает вспомогательные метрики (время обучения, дельта успеха,
        сглаженные значения), чтобы UI мог строить более информативный график.
        
        Args:
            user_id: ID пользователя
            days: Количество дней для анализа (по умолчанию 30)
            force_refresh: Принудительно пересчитать данные, минуя кэш
            smoothing_window: Размер окна скользящего среднего для success_rate
        
        Returns:
            List[dict]: [
                {
                    "date": str,
                    "attempts": int,  # Количество уникальных заданий, затронутых в этот день
                    "success_rate": float,  # Средний success_rate по последним попыткам
                    "success_rate_start": float,  # Уровень успешности по первым попыткам
                    "success_rate_delta": float,  # Разница между start и end
                    "success_rate_smooth": float,  # Скользящее среднее
                    "study_minutes": int,  # Суммарное время обучения за день
                    "total_attempts": int,  # Количество всех попыток (включая повторы)
                    "streak_gap": int,  # Количество пропущенных дней с момента последней активности
                    "streak_break": bool,  # Прервалась ли серия
                    "events": List[dict]  # Автоматические маркеры (perfect_day и т.д.)
                },
                ...
            ]
        """
        from datetime import timedelta
        
        days = max(1, days)
        smoothing_window = max(1, smoothing_window)

        cache_key = (user_id, days, smoothing_window)
        if not force_refresh and cache_key in self._time_dynamics_cache:
            cached_data, timestamp = self._time_dynamics_cache[cache_key]
            if time.time() - timestamp < self._time_dynamics_cache_ttl:
                if cached_data:
                    return cached_data
        
        # Убеждаемся, что ProgressService работает с правильным пользователем
        if self.progress_service.user_id != user_id:
            self.progress_service.switch_user(user_id)
        
        try:
            progress_data = self.progress_service.progress_manager.get_progress_data()
            task_history = progress_data.get("task_history", {})
            activity_map = self._load_calendar_activity(user_id)
            completion_count_map: Dict[str, int] = defaultdict(int)
            for entry in progress_data.get("complex_completions", []) or []:
                date_key = (entry or {}).get("date")
                if date_key:
                    completion_count_map[date_key] += 1
            completion_dates_set = set(
                (entry or {}).get("date")
                for entry in progress_data.get("complex_completions", []) or []
                if (entry or {}).get("date")
            )
            sorted_completion_dates: List[str] = sorted(completion_dates_set)
            completion_gap_map: Dict[str, int] = {}
            if sorted_completion_dates:
                prev_cd = None
                for ds in sorted_completion_dates:
                    try:
                        # Парсим дату в формате YYYY-MM-DD
                        cd = datetime.strptime(ds, "%Y-%m-%d").date()
                    except Exception as e:
                        self.logger.warning(f"Failed to parse completion date '{ds}': {e}")
                        continue
                    if prev_cd is not None:
                        gap_days = (cd - prev_cd).days - 1
                        completion_gap_map[ds] = max(gap_days, 0)
                    else:
                        completion_gap_map[ds] = 0
                    prev_cd = cd
            
            # Вычисляем граничную дату
            cutoff_date = None

            def _parse_attempt_timestamp(timestamp_str: str) -> Optional[datetime]:
                if not timestamp_str:
                    return None
                try:
                    dt = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    return None

                # Нормализуем в локальное naive-время, чтобы сравнение с cutoff_date было безопасным
                try:
                    if dt.tzinfo is not None:
                        dt = dt.astimezone().replace(tzinfo=None)
                except Exception:
                    # На всякий случай, если tzinfo/astimezone ведут себя нестандартно
                    dt = dt.replace(tzinfo=None)
                return dt

            # Якорим период к последней активности, чтобы график не становился пустым,
            # если пользователь давно не занимался. Учитываем либо последние попытки, либо завершения комплексов.
            latest_ts: Optional[datetime] = None
            for task_data in (task_history or {}).values():
                for attempt in (task_data or {}).get("attempts", []) or []:
                    ts = _parse_attempt_timestamp((attempt or {}).get("timestamp", ""))
                    if ts is None:
                        continue
                    if latest_ts is None or ts > latest_ts:
                        latest_ts = ts
            if latest_ts is None and completion_dates_set:
                try:
                    latest_ts = max(
                        datetime.fromisoformat(d + "T00:00:00")
                        for d in completion_dates_set
                    )
                except Exception:
                    latest_ts = None


            # Убеждаемся, что захватываем период по "сегодня" включительно
            now_ts = datetime.now()
            if latest_ts is None or latest_ts < now_ts:
                latest_ts = now_ts

            if latest_ts is None:
                # Should not be reached due to fallback above, but for safety
                self._time_dynamics_cache[cache_key] = ([], time.time())
                return []

            # Нормализуем к началу дня (00:00), чтобы cutoff также попадал на 00:00,
            # и мы захватывали полные сутки для всех дней периода.
            latest_ts = latest_ts.replace(hour=0, minute=0, second=0, microsecond=0)


            cutoff_date = latest_ts - timedelta(days=max(days - 1, 0))
            
            date_stats: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
                "last_attempts": {},
                "first_attempts": {},
                "study_seconds": 0,
                "total_attempts": 0,
            })
            
            # Pre-fill period dates to ensure we return "0" stats for empty days (including Today)
            # This logic guarantees that "1 day" returns exactly the current day.
            current_d = cutoff_date
            while current_d <= latest_ts:
                d_key = current_d.strftime("%Y-%m-%d")
                _ = date_stats[d_key] # Init default
                current_d += timedelta(days=1)
            
            for task_ref, task_data in task_history.items():
                attempts = task_data.get("attempts", [])
                for attempt in attempts:
                    timestamp_str = attempt.get("timestamp", "")
                    if not timestamp_str:
                        continue
                    timestamp = _parse_attempt_timestamp(timestamp_str)
                    if timestamp is None:
                        continue
                    
                    if timestamp < cutoff_date:
                        continue
                    
                    date_key = timestamp.strftime("%Y-%m-%d")
                    stats_for_date = date_stats[date_key]
                    stats_for_date["study_seconds"] += attempt.get("time_spent", 0) or 0
                    stats_for_date["total_attempts"] += 1
                    
                    if task_ref not in stats_for_date["first_attempts"]:
                        stats_for_date["first_attempts"][task_ref] = attempt
                    # Последняя попытка всегда заменяется (поскольку идем по времени в произвольном порядке,
                    # сравниваем timestamp, чтобы точно взять последнюю)
                    current_last = stats_for_date["last_attempts"].get(task_ref)
                    if current_last:
                        existing_ts_str = current_last.get("timestamp", "")
                        existing_ts = _parse_attempt_timestamp(existing_ts_str)
                    else:
                        existing_ts = None
                    
                    if not existing_ts or timestamp >= existing_ts:
                        stats_for_date["last_attempts"][task_ref] = attempt
            
            # Добавляем “пустые” даты для завершений комплексов в пределах окна, чтобы метка стрика была видна даже без попыток
            for ds in completion_dates_set:
                try:
                    dt = datetime.fromisoformat(ds + "T00:00:00")
                except Exception:
                    continue
                if dt < cutoff_date:
                    continue
                date_key = ds
                _ = date_stats[date_key]  # создаём с нулями

            if not date_stats:
                self._time_dynamics_cache[cache_key] = ([], time.time())
                return []
            
            sorted_dates = sorted(date_stats.keys())
            result: List[Dict[str, Any]] = []
            last_completion_date = None
            for date_key in sorted_dates:
                stats = date_stats[date_key]
                tasks_count = len(stats["last_attempts"])
                # Если нет попыток, но день есть в завершениях комплексов — не пропускаем (нужно для streak)
                # UPD: Теперь мы предварительно заполняем date_stats для всех дней диапазона,
                # поэтому убираем фильтрацию, чтобы возвращать "нулевые" дни.
                # if tasks_count == 0 and date_key not in completion_dates_set:
                #     continue
                
                successes_end = sum(
                    1 for attempt in stats["last_attempts"].values()
                    if attempt.get("success", False)
                )
                successes_start = sum(
                    1 for attempt in stats["first_attempts"].values()
                    if attempt.get("success", False)
                )
                
                success_rate = successes_end / tasks_count if tasks_count else 0.0
                success_rate_start = successes_start / tasks_count if tasks_count else 0.0
                success_delta = success_rate - success_rate_start
                
                # Средний балл по последним попыткам дня
                scores_end = [
                    float(attempt.get("score", 0)) for attempt in stats["last_attempts"].values()
                    if "score" in attempt
                ]
                avg_score = sum(scores_end) / len(scores_end) if scores_end else 0.0
                task_study_minutes = int(round(stats["study_seconds"] / 60))
                microcards_day = self._extract_microcards_day_metrics(activity_map.get(date_key))
                microcards_reviews = _safe_int(microcards_day.get("reviews"), minimum=0)
                microcards_correct_reviews = _safe_int(microcards_day.get("correct_reviews"), minimum=0)
                microcards_time_spent_seconds = _safe_int(microcards_day.get("time_spent_seconds"), minimum=0)
                microcards_study_minutes = int(round(microcards_time_spent_seconds / 60))
                
                result.append({
                    "date": date_key,
                    "attempts": tasks_count,
                    "total_attempts": stats["total_attempts"],
                    "completed_complexes": _safe_int(completion_count_map.get(date_key), minimum=0),
                    "success_rate": round(success_rate, 3),
                    "success_rate_start": round(success_rate_start, 3),
                    "success_rate_delta": round(success_delta, 3),
                    "average_score": round(avg_score, 3),
                    "study_minutes": task_study_minutes,
                    "microcards_reviews": microcards_reviews,
                    "microcards_correct_rate": _safe_rate(microcards_correct_reviews, microcards_reviews),
                    "microcards_study_minutes": microcards_study_minutes,
                    "combined_study_minutes": task_study_minutes + microcards_study_minutes,
                    "activity_attempts_total": _safe_int(stats["total_attempts"], minimum=0) + microcards_reviews,
                    "source_breakdown": {
                        "tasks": {
                            "attempts": _safe_int(stats["total_attempts"], minimum=0),
                            "study_minutes": task_study_minutes,
                        },
                        "microcards": {
                            "attempts": microcards_reviews,
                            "study_minutes": microcards_study_minutes,
                        },
                    },
                    "streak_gap": 0,
                    "streak_break": False,
                    "events": []
                })
            
            # Сглаживание / дополнительные показатели
            if result:
                success_values = [entry["success_rate"] for entry in result]
                
                def _rolling_average(values: List[float], window: int) -> List[float]:
                    smoothed = []
                    for idx in range(len(values)):
                        start_idx = max(0, idx - window + 1)
                        window_values = values[start_idx:idx + 1]
                        avg = sum(window_values) / len(window_values)
                        smoothed.append(round(avg, 3))
                    return smoothed
                
                smoothed_values = _rolling_average(success_values, smoothing_window)
                
                prev_date = None
                prev_success = None
                for idx, entry in enumerate(result):
                    entry["success_rate_smooth"] = smoothed_values[idx]
                    
                    date_obj = datetime.strptime(entry["date"], "%Y-%m-%d").date()
                    date_key = entry["date"]
                    # streak по завершениям комплексов: берем предрасчитанный gap по дате completion
                    if date_key in completion_gap_map:
                        gap = completion_gap_map.get(date_key, 0)
                        entry["streak_gap"] = gap
                        entry["streak_break"] = gap > 1
                        last_completion_date = date_obj
                    else:
                        if last_completion_date is not None:
                            gap = (date_obj - last_completion_date).days - 1
                            entry["streak_gap"] = max(gap, 0)
                            entry["streak_break"] = gap > 1
                        else:
                            entry["streak_gap"] = 0
                            entry["streak_break"] = False
                    
                    if prev_date:
                        gap = (date_obj - prev_date).days - 1
                        # streak_gap уже выставлен от completion; не перезаписываем, но добавляем событие при разрыве
                        if gap > 0:
                            entry["events"].append({
                                "type": "streak_break",
                                "gap_days": max(gap, entry.get("streak_gap", 0))
                            })
                    prev_date = date_obj
                    
                    if prev_success is not None:
                        momentum = entry["success_rate"] - prev_success
                        entry["momentum"] = round(momentum, 3)
                        if momentum >= 0.2:
                            entry["events"].append({
                                "type": "big_improvement",
                                "delta": round(momentum, 3)
                            })
                        elif momentum <= -0.2:
                            entry["events"].append({
                                "type": "drop",
                                "delta": round(momentum, 3)
                            })
                    else:
                        entry["momentum"] = 0.0
                    prev_success = entry["success_rate"]
                    
                    if entry["success_rate"] >= 0.95 and entry["total_attempts"] >= 3:
                        entry["events"].append({"type": "perfect_day"})
                    if entry["study_minutes"] >= 60:
                        entry["events"].append({"type": "long_study"})
            
            self._time_dynamics_cache[cache_key] = (result, time.time())
            return result
            
        except Exception as e:
            self.logger.exception(f"Failed to get time dynamics for user {user_id}: {e}")
            return []
    
    def clear_cache(self, user_id: Optional[str] = None):
        """
        Очищает кэш статистики.
        
        Args:
            user_id: ID пользователя (если None, очищает весь кэш)
        """
        if user_id:
            # Clear all cache entries for this user (all days variants)
            # Cache keys are formatted as "stats_{user_id}_{days}"
            keys_to_delete = [
                key for key in self._cache 
                if key.startswith(f"stats_{user_id}_")
            ]
            for key in keys_to_delete:
                del self._cache[key]
            
            if keys_to_delete:
                self.logger.debug(f"Cleared {len(keys_to_delete)} cache entries for user {user_id}")

            # Чистим кэш динамики для конкретного пользователя
            keys_to_delete = [key for key in self._time_dynamics_cache if key[0] == user_id]
            for key in keys_to_delete:
                del self._time_dynamics_cache[key]

            microcards_service = self._microcards_analytics_service
            if microcards_service not in (None, False) and hasattr(microcards_service, "clear_cache"):
                try:
                    microcards_service.clear_cache(user_id)
                except Exception as exc:
                    self.logger.warning("Failed to clear microcards analytics cache for user %s: %s", user_id, exc)
        else:
            self._cache.clear()
            self._time_dynamics_cache.clear()
            microcards_service = self._microcards_analytics_service
            if microcards_service not in (None, False) and hasattr(microcards_service, "clear_cache"):
                try:
                    microcards_service.clear_cache()
                except Exception as exc:
                    self.logger.warning("Failed to clear microcards analytics cache: %s", exc)
            self.logger.debug("Cleared all statistics cache")
    
    def _on_progress_updated(self, user_id: str) -> None:
        """Handle progress update event by clearing cache.
        
        This method is called automatically when UserProgressManager publishes
        a 'progress_updated' event after saving an attempt.
        
        Args:
            user_id: ID of user whose progress was updated
        """
        # Clear all cache entries for this user (all days variants)
        # Cache keys are formatted as "stats_{user_id}_{days}"
        keys_to_delete = [
            key for key in self._cache 
            if key.startswith(f"stats_{user_id}_")
        ]
        for key in keys_to_delete:
            del self._cache[key]
        
        # Also clear time dynamics cache for this user
        dynamics_keys_to_delete = [
            key for key in self._time_dynamics_cache 
            if key[0] == user_id
        ]
        for key in dynamics_keys_to_delete:
            del self._time_dynamics_cache[key]
        
        self.logger.debug(
            f"Cache cleared for user {user_id} due to progress update event "
            f"({len(keys_to_delete)} stats entries, {len(dynamics_keys_to_delete)} dynamics entries)"
        )
    
    def _extract_task_type(self, task_ref: str) -> str:
        """
        Извлекает тип задания из task_ref.
        
        Использует ModuleRepository для получения типа задания.
        
        Args:
            task_ref: Ссылка на задание (module_id/topic_id/task_id)
        
        Returns:
            str: Тип задания или "unknown"
        """
        # Если module_repository не доступен, возвращаем "unknown"
        if not self.module_repository:
            return "unknown"
        
        # Парсим task_ref: формат "module_id/topic_id/task_id"
        parts = task_ref.split("/")
        if len(parts) != 3:
            self.logger.warning(f"Invalid task_ref format: {task_ref}")
            return "unknown"
        
        module_id, topic_id, task_id = parts
        
        try:
            # Получаем задание через ModuleRepository
            task = self.module_repository.get_task(module_id, topic_id, task_id)
            if task and hasattr(task, 'task_type'):
                return task.task_type
        except Exception as e:
            self.logger.warning(f"Failed to get task type for {task_ref}: {e}")
        
        return "unknown"
    
    # =========================================================================
    # ФАЗА 3: Статистика комплексов
    # =========================================================================
    
    def _get_complex_statistics_file_path(self, user_id: str) -> Path:
        """
        Получить путь к файлу статистики комплексов пользователя.
        
        Args:
            user_id: ID пользователя
            
        Returns:
            Path: Путь к файлу complex_statistics.json
        """
        user_dir = self.users_dir / user_id
        user_dir.mkdir(parents=True, exist_ok=True)
        return user_dir / "complex_statistics.json"
    
    def _load_complex_statistics(self, user_id: str) -> Dict[str, Any]:
        """
        Загружает статистику комплексов из файла.
        
        Args:
            user_id: ID пользователя
            
        Returns:
            Dict: Структура статистики комплексов
        """
        stats_file = self._get_complex_statistics_file_path(user_id)
        
        if not stats_file.exists():
            return {}
        
        try:
            with open(stats_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            self.logger.error(f"Error loading complex statistics for user {user_id}: {e}")
            return {}
    
    def _save_complex_statistics(self, user_id: str, statistics: Dict[str, Any]) -> bool:
        """
        Сохраняет статистику комплексов в файл.
        
        Args:
            user_id: ID пользователя
            statistics: Структура статистики комплексов
            
        Returns:
            bool: True если сохранение успешно
        """
        stats_file = self._get_complex_statistics_file_path(user_id)
        
        try:
            with open(stats_file, 'w', encoding='utf-8') as f:
                json.dump(statistics, f, ensure_ascii=False, indent=2, default=str)
            return True
        except Exception as e:
            self.logger.error(f"Error saving complex statistics for user {user_id}: {e}")
            return False
    
    def _extended_to_recent_summary(self, extended: ExtendedSessionResultSummary) -> RecentSessionSummary:
        """
        Преобразует ExtendedSessionResultSummary в RecentSessionSummary.
        
        Args:
            extended: ExtendedSessionResultSummary для преобразования
            
        Returns:
            RecentSessionSummary
        """
        # Вычисляем duration_seconds
        if extended.end_time and extended.start_time:
            duration_seconds = int((extended.end_time - extended.start_time).total_seconds())
        else:
            duration_seconds = 0
        
        # Вычисляем success_rate из total_tasks и successful_tasks_count
        # Исключаем skipped из подсчета (уже исключены в successful_tasks_count)
        success_rate = 0.0
        if extended.total_tasks > 0:
            success_rate = extended.successful_tasks_count / extended.total_tasks
        
        return RecentSessionSummary(
            session_id=extended.session_id,
            end_time=extended.end_time,
            duration_seconds=duration_seconds,
            success_rate=success_rate,
            total_tasks=extended.total_tasks,
            mastered_tasks=extended.tasks_mastered_count,
            failed_tasks=extended.tasks_failed_count,
            total_iterations=extended.total_iterations
        )
    
    def update_complex_stats(
        self, 
        session_result: Union[ExtendedSessionResultSummary, RecentSessionSummary],
        user_id: str,
        complex_id: Optional[str] = None
    ) -> bool:
        """
        Обновляет статистику комплекса на основе результатов сессии.
        
        Реализует "Гибридный подход" хранения:
        - Агрегированные метрики в `aggregated`
        - Последние 20 сессий в `recent_sessions`
        
        Args:
            session_result: ExtendedSessionResultSummary или RecentSessionSummary
            user_id: ID пользователя
            complex_id: ID комплекса (обязателен для RecentSessionSummary, опционален для ExtendedSessionResultSummary)
            
        Returns:
            bool: True если обновление успешно
        """
        try:
            # Загружаем текущую статистику
            statistics = self._load_complex_statistics(user_id)
            
            # Преобразуем ExtendedSessionResultSummary в RecentSessionSummary если нужно
            if isinstance(session_result, ExtendedSessionResultSummary):
                recent_summary = self._extended_to_recent_summary(session_result)
                # Используем complex_id из ExtendedSessionResultSummary или переданный параметр
                complex_id = complex_id or session_result.complex_id
            else:
                recent_summary = session_result
                # Для RecentSessionSummary complex_id обязателен
                if not complex_id:
                    self.logger.error(
                        f"complex_id is required for RecentSessionSummary. "
                        f"Session ID: {recent_summary.session_id}"
                    )
                    return False
            
            # Инициализируем структуру для комплекса, если её нет
            if complex_id not in statistics:
                statistics[complex_id] = {
                    "aggregated": {
                        "attempts": 0,
                        "wins": 0,
                        "success_rate": 0.0
                    },
                    "recent_sessions": []
                }
            
            complex_stats = statistics[complex_id]
            aggregated = complex_stats["aggregated"]
            recent_sessions = complex_stats["recent_sessions"]

            # Idempotency guard: `/api/session/<id>/final-results` can be read
            # multiple times for the same completed session (API, S3 boot, audit checks).
            # Complex-level aggregates must not grow on repeated reads of the same session.
            existing_session = next(
                (
                    item for item in recent_sessions
                    if isinstance(item, dict)
                    and str(item.get("session_id") or "").strip() == str(recent_summary.session_id or "").strip()
                ),
                None,
            )
            if existing_session is not None:
                self.logger.debug(
                    "Skipping duplicate complex statistics update for session %s in complex %s",
                    recent_summary.session_id,
                    complex_id,
                )
                return True
            
            # Обновляем агрегаторы
            # attempts += session_result.total_tasks
            aggregated["attempts"] = aggregated.get("attempts", 0) + recent_summary.total_tasks
            
            # wins += count(successful tasks) (исключая skipped)
            # successful_tasks_count уже исключает skipped
            if isinstance(session_result, ExtendedSessionResultSummary):
                wins_to_add = session_result.successful_tasks_count
            else:
                # Для RecentSessionSummary вычисляем wins из success_rate и total_tasks
                wins_to_add = int(recent_summary.success_rate * recent_summary.total_tasks)
            
            aggregated["wins"] = aggregated.get("wins", 0) + wins_to_add
            
            # success_rate = wins / attempts
            if aggregated["attempts"] > 0:
                aggregated["success_rate"] = aggregated["wins"] / aggregated["attempts"]
            else:
                aggregated["success_rate"] = 0.0
            
            # Добавляем запись в recent_sessions
            # Преобразуем RecentSessionSummary в dict для JSON
            session_dict = {
                "session_id": recent_summary.session_id,
                "end_time": recent_summary.end_time.isoformat() if isinstance(recent_summary.end_time, datetime) else recent_summary.end_time,
                "duration_seconds": recent_summary.duration_seconds,
                "success_rate": recent_summary.success_rate,
                "total_tasks": recent_summary.total_tasks,
                "mastered_tasks": recent_summary.mastered_tasks,
                "failed_tasks": recent_summary.failed_tasks,
                "total_iterations": recent_summary.total_iterations
            }
            
            # Добавляем в начало списка (FIFO)
            recent_sessions.insert(0, session_dict)
            
            # Ограничиваем список до 20 последних записей
            if len(recent_sessions) > 20:
                complex_stats["recent_sessions"] = recent_sessions[:20]
            else:
                complex_stats["recent_sessions"] = recent_sessions
            
            # Сохраняем обновленную статистику
            return self._save_complex_statistics(user_id, statistics)
            
        except Exception as e:
            self.logger.error(f"Error updating complex statistics: {e}", exc_info=True)
            return False

    def get_complex_statistics(self, user_id: str) -> Dict[str, Any]:
        """
        Получает статистику всех комплексов пользователя.
        
        Args:
            user_id: ID пользователя
            
        Returns:
            Dict: Статистика комплексов с агрегированными данными и последними сессиями
        """
        return self._load_complex_statistics(user_id)
    
    def get_recent_sessions(self, user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Получает последние сессии пользователя из всех комплексов.
        
        Args:
            user_id: ID пользователя
            limit: Максимальное количество сессий
            
        Returns:
            List: Список последних сессий, отсортированных по дате
        """
        all_sessions = []
        complex_stats = self._load_complex_statistics(user_id)
        
        for complex_id, stats in complex_stats.items():
            recent = stats.get("recent_sessions", [])
            for session in recent:
                session["complex_id"] = complex_id
                all_sessions.append(session)
        
        # Сортируем по дате (новые первыми)
        all_sessions.sort(key=lambda x: x.get("end_time", ""), reverse=True)
        
        return all_sessions[:limit]

