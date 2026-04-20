"""
Scheduler Service - Adaptive Flow Scheduler.

Реализует:
- Построение Daily Mix с интерливингом
- Soft Allocation (без долгов при пропусках)
- Пересчёт очереди при изменении времени
- Формирование плана на несколько дней

Принципы:
1. Daily Mix обязателен перед новым материалом
2. Интерливинг: чередование комплексов
3. Структура: разминка → основная → закрепление
4. Soft Allocation: пропуски не создают долгов
"""

import logging
from datetime import datetime, date, timedelta
from typing import List, Optional, Dict, Any, Tuple
from collections import defaultdict
import random

from .models import (
    ComplexProgress,
    ScheduledTask,
    DailyPlan,
    DayPlan,
    TaskType,
    DayStatus,
    ComplexStatus,
    MasteryCategory,
    MASTERY_INTERVALS,
)
from .health_score_service import HealthScoreService


class SchedulerService:
    """Сервис планирования обучения."""
    
    # Константы
    DAILY_MIX_RATIO = 0.3  # 30% времени на повторение
    AVG_TASK_DURATION_SECONDS = 150  # 2.5 минуты
    MIN_DAILY_MIX_TASKS = 3
    MAX_DAILY_MIX_TASKS = 15
    MINIMUM_REQUIRED_DAILY_MIX_MINUTES = 10  # ✅ НОВОЕ: Минимум для Daily Mix (3 × 2.5 + буфер)
    
    # Структура Daily Mix
    WARMUP_RATIO = 0.2      # 20% разминка
    MAIN_RATIO = 0.6        # 60% основной блок
    CONSOLIDATION_RATIO = 0.2  # 20% закрепление
    
    # Интерливинг
    MAX_CONSECUTIVE_SAME_COMPLEX = 2
    
    def __init__(self, health_service: Optional[HealthScoreService] = None):
        """
        Инициализация планировщика.
        
        Args:
            health_service: Сервис расчёта HealthScore
        """
        self.health_service = health_service or HealthScoreService()
        self.logger = logging.getLogger(self.__class__.__name__)
    
    # =========================================================================
    # DAILY MIX CALCULATION
    # =========================================================================
    
    def calculate_daily_mix_size(
        self, 
        available_minutes: int,
        avg_task_duration_seconds: float = None
    ) -> int:
        """
        Рассчитать количество задач для Daily Mix.
        
        num_review_tasks = floor(available_time × 0.3 / avg_task_duration)
        Пример: 45 мин × 0.3 / 2.5 ≈ 5 задач
        
        Args:
            available_minutes: Доступное время в минутах
            avg_task_duration_seconds: Средняя длительность задачи
            
        Returns:
            int: Количество задач
        """
        if avg_task_duration_seconds is None:
            avg_task_duration_seconds = self.AVG_TASK_DURATION_SECONDS
        
        review_time_seconds = available_minutes * 60 * self.DAILY_MIX_RATIO
        task_count = int(review_time_seconds / avg_task_duration_seconds)
        
        return max(self.MIN_DAILY_MIX_TASKS, min(task_count, self.MAX_DAILY_MIX_TASKS))
    
    def select_review_tasks(
        self,
        all_progress: List[ComplexProgress],
        task_pool: Dict[str, List[Dict[str, Any]]],  # complex_id -> tasks
        count: int,
        excluded_task_ids: Optional[List[str]] = None
    ) -> List[ScheduledTask]:
        """
        Выбрать задачи для повторения.
        
        Алгоритм:
        1. Фильтруем только пройденные комплексы (IN_PROGRESS, MASTERED)
        2. Сортируем по приоритету (низкий health = высокий приоритет)
        3. Применяем интерливинг
        
        Args:
            all_progress: Прогресс по всем комплексам
            task_pool: Пул задач по комплексам
            count: Количество задач для выбора
            excluded_task_ids: Исключить эти задачи
            
        Returns:
            List[ScheduledTask]: Выбранные задачи
        """
        excluded = set(excluded_task_ids or [])
        
        # 1. Фильтруем комплексы
        eligible_progress = [
            p for p in all_progress
            if p.status in (ComplexStatus.IN_PROGRESS, ComplexStatus.MASTERED)
            and p.complex_id in task_pool
            and not (p.status == ComplexStatus.FROZEN and 
                    p.frozen_until and datetime.now() < p.frozen_until)
        ]
        
        # Фоллбек: если нет прогресса (новый пользователь), берём все комплексы из task_pool
        # чтобы Daily Mix не был пустым и зависел от лимита времени
        if not eligible_progress:
            fallback_user_id = all_progress[0].user_id if all_progress else "unknown"
            eligible_progress = [
                ComplexProgress(
                    complex_id=c_id,
                    user_id=fallback_user_id,
                    status=ComplexStatus.IN_PROGRESS,
                    health_score=0.5,
                )
                for c_id in task_pool.keys()
            ]
        
        # 2. Собираем задачи с приоритетами
        candidates: List[Tuple[float, ScheduledTask]] = []
        
        for progress in eligible_progress:
            priority = self.health_service.get_review_priority(progress.health_score)
            complex_tasks = task_pool.get(progress.complex_id, [])
            
            for task in complex_tasks:
                if not isinstance(task, dict):
                    task = {
                        "task_id": str(task),
                        "duration": self.AVG_TASK_DURATION_SECONDS,
                    }
                task_id = task.get("task_id") or task.get("id", "")
                if task_id in excluded:
                    continue
                
                # Определяем тип задачи
                task_type = self._infer_task_type(task)
                
                scheduled = ScheduledTask(
                    task_id=task_id,
                    complex_id=progress.complex_id,
                    complex_name=task.get("complex_name", ""),
                    task_type=task_type,
                    priority=priority,
                    estimated_duration_seconds=task.get("duration", self.AVG_TASK_DURATION_SECONDS),
                    health_score=progress.health_score,
                )
                candidates.append((priority, scheduled))
        
        # 3. Сортируем по приоритету (выше = важнее)
        candidates.sort(key=lambda x: x[0], reverse=True)
        
        # 4. Применяем интерливинг
        selected = self._apply_interleaving(
            [task for _, task in candidates],
            count
        )

        # ✅ УНИФИКАЦИЯ: Используем единый метод дублирования
        selected = self._pad_tasks_to_count(selected, count)
        
        return selected
    
    def _infer_task_type(self, task: Dict[str, Any]) -> TaskType:
        """Определить тип задачи по её характеристикам."""
        task_type_str = task.get("type", "").lower()
        difficulty = task.get("difficulty", 1)
        duration = task.get("duration", self.AVG_TASK_DURATION_SECONDS)
        
        # Явно указан тип
        if "warmup" in task_type_str or "разминка" in task_type_str:
            return TaskType.WARMUP
        if "consolidation" in task_type_str or "закрепление" in task_type_str:
            return TaskType.CONSOLIDATION
        
        # Эвристика по сложности и длительности
        if difficulty == 1 and duration < 120:  # < 2 мин, лёгкие
            return TaskType.WARMUP
        if difficulty >= 3 or duration > 300:  # > 5 мин или сложные
            return TaskType.CONSOLIDATION
        
        return TaskType.MAIN
    
    def _pad_tasks_to_count(
        self,
        tasks: List[ScheduledTask],
        target_count: int
    ) -> List[ScheduledTask]:
        """
        Дополнить список задач до целевого количества путём дублирования.
        
        ✅ УНИФИКАЦИЯ: Единая точка для дублирования задач во всей системе.
        
        Args:
            tasks: Исходный список задач
            target_count: Целевое количество
            
        Returns:
            List[ScheduledTask]: Дополненный список задач
        """
        if not tasks or len(tasks) >= target_count:
            return tasks
        
        result = list(tasks)
        idx = 0
        
        while len(result) < target_count and tasks:
            result.append(tasks[idx % len(tasks)])
            idx += 1
        
        return result
    
    def _apply_interleaving(
        self,
        tasks: List[ScheduledTask],
        count: int
    ) -> List[ScheduledTask]:
        """
        Применить интерливинг к списку задач.
        
        Правило: не более MAX_CONSECUTIVE_SAME_COMPLEX задач подряд из одного комплекса.
        
        ✅ ЗАЩИТА: Если один комплекс остался или слишком много пропусков,
           игнорируем лимит последовательности, чтобы избежать бесконечного цикла.
        
        Args:
            tasks: Отсортированные по приоритету задачи
            count: Количество для выбора
            
        Returns:
            List[ScheduledTask]: Задачи с интерливингом
        """
        if not tasks:
            return []
        
        # Если задач меньше, чем нужно, сразу размножаем, чтобы выдержать требуемый count
        if len(tasks) < count:
            padded: List[ScheduledTask] = []
            idx = 0
            while len(padded) < count and tasks:
                padded.append(tasks[idx % len(tasks)])
                idx += 1
            return padded
        
        result: List[ScheduledTask] = []
        by_complex: Dict[str, List[ScheduledTask]] = defaultdict(list)
        
        for task in tasks:
            by_complex[task.complex_id].append(task)
        
        # Round-robin с приоритетом
        complex_ids = list(by_complex.keys())
        idx = 0
        consecutive_count: Dict[str, int] = defaultdict(int)
        last_complex = None
        skip_count = 0  # ✅ НОВОЕ: счётчик пропусков для защиты от бесконечного цикла
        MAX_SKIP_THRESHOLD = len(complex_ids) * 2 if complex_ids else 0  # ✅ Лимит пропусков
        
        while len(result) < count and complex_ids:  # ✅ Проверяем complex_ids явно
            complex_id = complex_ids[idx % len(complex_ids)]
            
            # ✅ НОВОЕ: Если один комплекс остался, берём без ограничений
            if len(complex_ids) == 1:
                if by_complex[complex_id]:
                    task = by_complex[complex_id].pop(0)
                    result.append(task)
                    last_complex = complex_id
            else:
                # Проверяем лимит последовательных задач
                if last_complex == complex_id:
                    consecutive_count[complex_id] += 1
                    if consecutive_count[complex_id] >= self.MAX_CONSECUTIVE_SAME_COMPLEX:
                        idx += 1
                        skip_count += 1  # ✅ Инкрементируем счётчик пропусков
                        
                        # ✅ ЗАЩИТА: если слишком много пропусков, сбрасываем счётчик
                        if skip_count > MAX_SKIP_THRESHOLD:
                            self.logger.warning(
                                f"[Interleaving] Too many consecutive skips ({skip_count}). "
                                f"Resetting consecutive_count to avoid infinite loop."
                            )
                            consecutive_count = defaultdict(int)
                            skip_count = 0
                        
                        continue
                else:
                    consecutive_count = defaultdict(int)
                    consecutive_count[complex_id] = 1
                
                if by_complex[complex_id]:
                    task = by_complex[complex_id].pop(0)
                    result.append(task)
                    last_complex = complex_id
            
            idx += 1
            
            # Убираем пустые комплексы
            complex_ids = [c for c in complex_ids if by_complex[c]]
            if not complex_ids:
                break
        
        return result
    
    def structure_daily_mix(
        self, 
        tasks: List[ScheduledTask]
    ) -> List[ScheduledTask]:
        """
        Структурировать Daily Mix: разминка → основная → закрепление.
        
        Args:
            tasks: Неупорядоченные задачи
            
        Returns:
            List[ScheduledTask]: Упорядоченные задачи
        """
        warmup = [t for t in tasks if t.task_type == TaskType.WARMUP]
        main = [t for t in tasks if t.task_type == TaskType.MAIN]
        consolidation = [t for t in tasks if t.task_type == TaskType.CONSOLIDATION]
        
        # Рассчитываем целевые количества
        total = len(tasks)
        warmup_target = max(1, int(total * self.WARMUP_RATIO))
        consolidation_target = max(1, int(total * self.CONSOLIDATION_RATIO))
        
        # Дозаполняем если не хватает
        if len(warmup) < warmup_target and main:
            # Берём лёгкие из основных
            n_warmup = warmup_target - len(warmup)
            warmup.extend(main[:n_warmup])
            main = main[n_warmup:]
        
        if len(consolidation) < consolidation_target and main:
            # Берём сложные из основных
            n_consol = consolidation_target - len(consolidation)
            consolidation = main[-n_consol:] + consolidation
            main = main[:-n_consol] if len(main) > n_consol else []
        
        # Собираем итоговый порядок
        result = warmup[:warmup_target] + main + consolidation[:consolidation_target]
        
        return result
    
    # =========================================================================
    # DAILY PLAN BUILDING
    # =========================================================================
    
    def build_daily_plan(
        self,
        user_id: str,
        available_minutes: int,
        all_progress: List[ComplexProgress],
        task_pool: Dict[str, List[Dict[str, Any]]],
        current_complex: Optional[Dict[str, Any]] = None,
        is_adapted: bool = False
    ) -> DailyPlan:
        """
        Построить план на день.
        
        Args:
            user_id: ID пользователя
            available_minutes: Доступное время
            all_progress: Прогресс по комплексам
            task_pool: Пул задач
            current_complex: Текущий изучаемый комплекс (для main_focus)
            is_adapted: План адаптирован после пропуска
            
        Returns:
            DailyPlan: План на сегодня
            
        Raises:
            ValueError: Если недостаточно времени для Daily Mix
        """
        today = date.today()
        
        # ✅ НОВОЕ: Проверка минимально требуемого времени для Daily Mix
        if available_minutes < self.MINIMUM_REQUIRED_DAILY_MIX_MINUTES:
            error_msg = (
                f"Недостаточно времени для Daily Mix. "
                f"Минимум требуется: {self.MINIMUM_REQUIRED_DAILY_MIX_MINUTES} мин. "
                f"Вы выделили: {available_minutes} мин."
            )
            self.logger.warning(f"[Daily Plan] {error_msg}")
            raise ValueError(error_msg)
        
        # 1. Рассчитываем Daily Mix
        daily_mix_count = self.calculate_daily_mix_size(available_minutes)
        daily_mix_tasks = self.select_review_tasks(
            all_progress, task_pool, daily_mix_count
        )

        # ✅ УНИФИКАЦИЯ: Используем единый метод дублирования
        daily_mix_tasks = self._pad_tasks_to_count(daily_mix_tasks, daily_mix_count)

        daily_mix_tasks = self.structure_daily_mix(daily_mix_tasks)

        # ✅ УНИФИКАЦИЯ: Повторная унификация после структурирования
        daily_mix_tasks = self._pad_tasks_to_count(daily_mix_tasks, daily_mix_count)
        
        daily_mix_seconds = sum(t.estimated_duration_seconds for t in daily_mix_tasks)
        daily_mix_minutes = int(daily_mix_seconds / 60)
        
        # 2. Оставшееся время для нового материала
        remaining_minutes = available_minutes - daily_mix_minutes
        main_focus = None
        main_focus_complex_name = ""
        main_focus_tasks_count = 0
        main_focus_minutes = 0
        
        if remaining_minutes > 5 and current_complex:
            # Normalize current_complex to dict-like access
            if isinstance(current_complex, dict):
                cx = current_complex
            else:
                cx = {
                    "complex_id": getattr(current_complex, "complex_id", None) or getattr(current_complex, "id", ""),
                    "id": getattr(current_complex, "id", None) or getattr(current_complex, "complex_id", ""),
                    "name": getattr(current_complex, "name", ""),
                    "tasks": getattr(current_complex, "tasks", []) or [],
                }

            complex_id = cx.get("complex_id") or cx.get("id", "")
            complex_tasks = task_pool.get(complex_id, [])
            
            # Выбираем задачи на оставшееся время
            selected_tasks = []
            time_used = 0
            for task in complex_tasks:
                # Defensive: tasks can be plain strings/ids; skip invalid entries
                if not isinstance(task, dict):
                    continue
                
                duration = task.get("duration", self.AVG_TASK_DURATION_SECONDS)
                if time_used + duration / 60 <= remaining_minutes:
                    selected_tasks.append(task)
                    time_used += duration / 60
            
            if selected_tasks:
                first_task = selected_tasks[0]
                main_focus = ScheduledTask(
                    task_id=first_task.get("task_id") or first_task.get("id", ""),
                    complex_id=complex_id,
                    complex_name=cx.get("name", ""),
                    task_type=TaskType.MAIN,
                    priority=0.5,
                    estimated_duration_seconds=int(time_used * 60),
                )
                main_focus_complex_name = cx.get("name", "")
                main_focus_tasks_count = len(selected_tasks)
                main_focus_minutes = int(time_used)
        
        return DailyPlan(
            date=today,
            daily_mix=daily_mix_tasks,
            main_focus=main_focus,
            main_focus_complex_name=main_focus_complex_name,
            main_focus_tasks_count=main_focus_tasks_count,
            total_estimated_minutes=daily_mix_minutes + main_focus_minutes,
            daily_mix_estimated_minutes=daily_mix_minutes,
            main_focus_estimated_minutes=main_focus_minutes,
            status=DayStatus.PLANNED,
            is_adapted=is_adapted,
        )
    
    # =========================================================================
    # SCHEDULE STRIP (ЛЕНТА ДНЕЙ)
    # =========================================================================
    
    def build_schedule_strip(
        self,
        user_id: str,
        days_count: int,
        schedule_mode: str,
        activity_history: Dict[str, Any],
        available_minutes: int = 30,
        all_progress: Optional[List[ComplexProgress]] = None,
        task_pool: Optional[Dict[str, List[Dict[str, Any]]]] = None,
        rest_days: Optional[Dict[str, Any]] = None,
        complex_names: Optional[Dict[str, str]] = None
    ) -> List[DayPlan]:
        """
        Построить ленту расписания на несколько дней.
        
        Args:
            user_id: ID пользователя
            days_count: Количество дней
            schedule_mode: "daily" или "flexible"
            activity_history: История активности {date_iso: activity_dict}
            available_minutes: Доступное время
            all_progress: Прогресс по комплексам (для расчёта реальных задач)
            task_pool: Пул задач (для расчёта реальных задач)
            rest_days: Словарь выходных дней {date_iso: {...}}
            complex_names: Словарь названий комплексов {complex_id: name}
            
        Returns:
            List[DayPlan]: Планы на дни
        """
        rest_days = rest_days or {}
        complex_names = complex_names or {}
        # Flexible mode removed: schedule_mode is ignored, behavior is always daily
        today = date.today()
        month_names_ru = [
            "янв",
            "фев",
            "мар",
            "апр",
            "май",
            "июн",
            "июл",
            "авг",
            "сен",
            "окт",
            "ноя",
            "дек",
        ]
        day_names_ru = ["Понедельник", "Вторник", "Среда", "Четверг", 
                       "Пятница", "Суббота", "Воскресенье"]
        day_names_short_ru = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
        
        result = []
        
        for i in range(-1, days_count):  # -1 = вчера
            current_date = today + timedelta(days=i)
            date_iso = current_date.isoformat()
            day_num = current_date.day
            month_short = month_names_ru[current_date.month - 1]
            
            # Определяем название дня
            if i == -1:
                day_name = "Вчера"
            elif i == 0:
                day_name = "Сегодня"
            elif i == 1:
                day_name = "Завтра"
            else:
                full_name = day_names_ru[current_date.weekday()]
                if len(full_name) > 6:
                    day_name = day_names_short_ru[current_date.weekday()]
                else:
                    day_name = full_name
            
            # Проверяем, отмечен ли день как выходной
            is_manual_rest = date_iso in rest_days
            
            # Определяем статус
            if i < 0:
                # Прошлый день
                day_activity = activity_history.get(date_iso, {})
                if not isinstance(day_activity, dict):
                    day_activity = {}
                completion = int(day_activity.get("completion_percent", 0) or 0)
                if is_manual_rest and completion == 0:
                    status = DayStatus.REST_DAY
                    badges = ["Выходной"]
                elif completion > 0:
                    status = DayStatus.COMPLETED
                    badges = []
                else:
                    status = DayStatus.MISSED
                    badges = ["Пропущено"]
            elif i == 0:
                # Сегодня
                if is_manual_rest:
                    status = DayStatus.REST_DAY
                    badges = ["Выходной"]
                else:
                    status = DayStatus.PLANNED
                    badges = []
            else:
                # Будущее
                if is_manual_rest:
                    status = DayStatus.REST_DAY
                    badges = ["Выходной"]
                    is_rest = True
                else:
                    status = DayStatus.PLANNED
                    badges = []
                    is_rest = False
            
            # Задачи на день
            tasks = []
            all_tasks_detailed = []
            has_overflow = False
            overflow_count = 0
            is_rest_in_flexible = False
            
            if status == DayStatus.PLANNED and i >= 0:
                # Рассчитываем реальные задачи для дня (только реальные комплексы)
                if all_progress is not None and task_pool is not None:
                    # Получаем комплексы для повторения по приоритету (health_score)
                    active_complexes = [
                        p for p in all_progress
                        if p.status in (ComplexStatus.IN_PROGRESS, ComplexStatus.MASTERED)
                        and str(p.complex_id).lower() != "daily_mix"
                    ]

                    known_complex_ids = set(task_pool.keys()) | set(complex_names.keys())
                    if known_complex_ids:
                        active_complexes = [
                            p for p in active_complexes
                            if p.complex_id in known_complex_ids
                        ]

                    
                    # Применяем адаптивную частоту: фильтруем по необходимости повторения
                    complexes_needing_review = [
                        p for p in active_complexes
                        if p.needs_review_on_date(current_date)
                    ]
                    
                    # Если нет комплексов для повторения, берём самые проблемные
                    if not complexes_needing_review and active_complexes:
                        # Сортируем по health_score и берём худшие
                        sorted_by_health = sorted(active_complexes, key=lambda p: p.health_score)
                        complexes_needing_review = sorted_by_health[:3]  # Максимум 3
                    
                    # Сортируем по приоритету: критичные первыми
                    complexes_needing_review.sort(key=lambda p: (p.get_mastery_category().value, p.health_score))
                    
                    # Ограничиваем количество комплексов в день (не более 4)
                    max_complexes_per_day = 4
                    if len(complexes_needing_review) > max_complexes_per_day:
                        # Приоритет: CRITICAL всегда, остальные по очереди с ротацией
                        critical = [p for p in complexes_needing_review if p.get_mastery_category() == MasteryCategory.CRITICAL]
                        non_critical = [p for p in complexes_needing_review if p.get_mastery_category() != MasteryCategory.CRITICAL]
                        
                        # Ротация для некритичных
                        if non_critical and i > 0:
                            rotation_offset = i % len(non_critical)
                            non_critical = non_critical[rotation_offset:] + non_critical[:rotation_offset]
                        
                        # Комбинируем: все критичные + некритичные до лимита
                        available_slots = max_complexes_per_day - len(critical)
                        complexes_needing_review = critical + non_critical[:available_slots]
                    
                    active_complexes = complexes_needing_review
                    
                    # Определяем лимит отображения (3 для компактного вида)
                    display_limit = 3
                    
                    if active_complexes:
                        # Формируем полный список задач с метаданными
                        for p in active_complexes:
                            # Используем complex_names для получения имени, фолбэк на complex_id
                            complex_name = complex_names.get(p.complex_id, p.complex_id)
                            
                            # Проверяем, был ли комплекс выполнен в этот день
                            # Для прошедших дней проверяем по last_reviewed_at
                            is_completed = False
                            if i < 0:  # Прошедший день
                                if p.last_reviewed_at:
                                    review_date = p.last_reviewed_at.date() if hasattr(p.last_reviewed_at, 'date') else p.last_reviewed_at
                                    is_completed = review_date == current_date
                            
                            all_tasks_detailed.append({
                                "complex_id": p.complex_id,
                                "name": complex_name,
                                "is_completed": is_completed,
                                "health_score": p.health_score,
                                "is_synthetic": False,  # Реальные комплексы для повторения
                            })
                        
                        # Берём топ-N для компактного отображения
                        visible_tasks = all_tasks_detailed[:display_limit]
                        
                        for task_info in visible_tasks:
                            complex_name = task_info["name"]
                            # Упрощаем длинные названия
                            if len(complex_name) > 25:
                                complex_name = complex_name[:22] + "..."
                            tasks.append(complex_name)
                        
                        # Проверяем переполнение
                        if len(all_tasks_detailed) > display_limit:
                            has_overflow = True
                            overflow_count = len(all_tasks_detailed) - display_limit
                    else:
                        # Нет активных комплексов
                        if i == 0:
                            badges.append("Нет данных")
                else:
                    # Нет данных о прогрессе/пуле задач: показываем совместимый fallback.
                    if i == 0:
                        tasks.extend(["Daily Mix", "Основной фокус"])
                    else:
                        tasks.append("Daily Mix")
            elif status == DayStatus.REST_DAY:
                is_rest_in_flexible = False
            
            if (
                status == DayStatus.PLANNED
                and not tasks
                and "Нет данных" not in badges
                and (all_progress is None or task_pool is None)
            ):
                badges.append("Нет данных")

            result.append(DayPlan(
                date=current_date,
                day_name=day_name,
                day_num=day_num,
                month=month_short,
                status=status,
                tasks=tasks,
                badges=badges,
                is_rest_in_flexible=is_rest_in_flexible,
                is_today=i == 0,
                is_future=i > 0,
                all_tasks=all_tasks_detailed,
                has_overflow=has_overflow,
                overflow_count=overflow_count,
            ))
        
        return result
    
    # =========================================================================
    # RECALCULATION (SOFT ALLOCATION)
    # =========================================================================
    
    def recalculate_on_miss(
        self,
        user_id: str,
        missed_date: date,
        all_progress: List[ComplexProgress],
        task_pool: Dict[str, List[Dict[str, Any]]],
        available_minutes: int
    ) -> DailyPlan:
        """
        Пересчитать план после пропуска (Soft Allocation).
        
        Принцип: критические повторения переносятся на сегодня,
        остальное распределяется без создания "долга".
        
        Args:
            user_id: ID пользователя
            missed_date: Дата пропуска
            all_progress: Прогресс по комплексам
            task_pool: Пул задач
            available_minutes: Доступное время
            
        Returns:
            DailyPlan: Адаптированный план
        """
        # Находим критические комплексы (health < 0.65)
        critical = [
            p for p in all_progress
            if self.health_service.is_critical(p.health_score)
            and p.status in (ComplexStatus.IN_PROGRESS, ComplexStatus.MASTERED)
        ]
        
        # Увеличиваем Daily Mix если есть критические
        base_count = self.calculate_daily_mix_size(available_minutes)
        extra_count = min(len(critical) * 2, 5)  # До 5 дополнительных
        
        daily_mix_count = base_count + extra_count
        
        # Приоритизируем критические
        daily_mix_tasks = self.select_review_tasks(
            all_progress, task_pool, daily_mix_count
        )
        
        # Помечаем план как адаптированный
        plan = self.build_daily_plan(
            user_id=user_id,
            available_minutes=available_minutes,
            all_progress=all_progress,
            task_pool=task_pool,
            is_adapted=True
        )
        
        plan.daily_mix = self.structure_daily_mix(daily_mix_tasks)
        plan.status = DayStatus.RECALCULATED
        
        return plan
    
    def on_time_change(
        self,
        user_id: str,
        new_minutes: int,
        all_progress: List[ComplexProgress],
        task_pool: Dict[str, List[Dict[str, Any]]],
        current_complex: Optional[Dict[str, Any]] = None
    ) -> DailyPlan:
        """
        Пересчитать план при изменении доступного времени.
        
        Args:
            user_id: ID пользователя
            new_minutes: Новое время
            all_progress: Прогресс по комплексам
            task_pool: Пул задач
            current_complex: Текущий комплекс
            
        Returns:
            DailyPlan: Новый план
        """
        return self.build_daily_plan(
            user_id=user_id,
            available_minutes=new_minutes,
            all_progress=all_progress,
            task_pool=task_pool,
            current_complex=current_complex,
        )
