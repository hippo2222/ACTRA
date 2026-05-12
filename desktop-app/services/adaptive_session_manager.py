# desktop-app/services/adaptive_session_manager.py
"""
Adaptive Session Manager - Ядро адаптивной системы.

Управляет жизненным циклом сессии выполнения комплекса:
- Выбор следующего задания
- Адаптация сложности
- Обработка результатов
- Генерация очередей итераций
"""

import json
import logging
import hashlib
import random
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Any, Tuple

from task_system.core.models.complex_models import (
    Complex,
    ComplexSession,
    SessionTaskResult,
    QueuedTask,
    ExtendedSessionResultSummary,
    IterationSummary
)
from services.complex_service import ComplexService
from services.user_progress_manager import UserProgressManager
from services.difficulty_manager import DifficultyManager
from services.storage_service import StorageService
from services.session_repository import SessionRepository

logger = logging.getLogger(__name__)


class AdaptiveSessionManager:
    """
    Менеджер адаптивных сессий.
    
    Управляет жизненным циклом сессии выполнения комплекса:
    - Генерация очередей заданий по итерациям
    - Адаптация сложности на основе результатов
    - Обработка битых заданий
    - Сохранение и восстановление сессий
    """
    
    def __init__(
        self, 
        complex_service: ComplexService,
        user_progress_manager: UserProgressManager,
        difficulty_manager: DifficultyManager,
        storage_service: Optional[StorageService] = None,
        session_repository: Optional[SessionRepository] = None
    ):
        self.complex_service = complex_service
        self.user_progress_manager = user_progress_manager
        self.difficulty_manager = difficulty_manager
        self.storage_service = storage_service
        self.session_repository = session_repository or SessionRepository()
        
        # Активные сессии в памяти: session_id -> ComplexSession
        self._active_sessions: Dict[str, ComplexSession] = {}
        self._progress_manager_by_user: Dict[str, UserProgressManager] = {}
        prototype_user_id = str(getattr(user_progress_manager, "user_id", "") or "").strip()
        if prototype_user_id:
            self._progress_manager_by_user[prototype_user_id] = user_progress_manager
        
        # Кэш метаданных заданий: task_ref -> task_type, а также дополнительные данные
        self.task_meta_cache: Dict[str, Any] = {}

    def _get_progress_manager_for_user(self, user_id: Optional[str]) -> UserProgressManager:
        normalized_user_id = str(user_id or "").strip()
        if not normalized_user_id:
            return self.user_progress_manager

        prototype_user_id = str(getattr(self.user_progress_manager, "user_id", "") or "").strip()
        if prototype_user_id == normalized_user_id:
            return self.user_progress_manager

        cached = self._progress_manager_by_user.get(normalized_user_id)
        if cached is not None:
            return cached

        scoped_manager = UserProgressManager(
            data_dir=str(getattr(self.user_progress_manager, "data_dir", "data")),
            user_id=normalized_user_id,
            difficulty_manager=getattr(self.user_progress_manager, "difficulty_manager", None),
            event_bus=getattr(self.user_progress_manager, "event_bus", None),
            persistence_settings=getattr(self.user_progress_manager, "persistence_settings", None),
        )
        self._progress_manager_by_user[normalized_user_id] = scoped_manager
        return scoped_manager
    
    @staticmethod
    def _split_task_ref(task_ref: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """
        Разбивает task_ref в формате module/topic/task на составляющие.
        """
        if not task_ref:
            return None, None, None
        parts = task_ref.split('/')
        if len(parts) < 3:
            return None, None, None
        return parts[0], parts[1], parts[-1]
    
    def _resolve_task_json_path(self, module_id: str, topic_id: str, task_id: str) -> Optional[Path]:
        """
        Строит путь к файлу task.json по идентификаторам.
        """
        try:
            from common.config_loader import load_config  # type: ignore
            config = load_config()
            data_root = Path(config.get("data_root", "data"))
        except Exception:
            data_root = Path("data")
        task_path = data_root / "modules" / module_id / "topics" / topic_id / "tasks" / task_id / "task.json"
        return task_path

    def _load_task_metadata(self, task_ref: str) -> Dict[str, Any]:
        """
        Загружает и кэширует метаданные задания (type, subtype, content.mode и др.).
        """
        cache_key = f"metadata:{task_ref}"
        cached = self.task_meta_cache.get(cache_key)
        if cached is not None:
            return cached

        metadata: Dict[str, Any] = {}
        module_id, topic_id, task_id = self._split_task_ref(task_ref)
        if not module_id or not topic_id or not task_id:
            self.task_meta_cache[cache_key] = metadata
            return metadata

        task_json: Optional[Dict[str, Any]] = None
        meta_section: Dict[str, Any] = {}

        try:
            if self.storage_service:
                try:
                    loaded = self.storage_service.load_task(module_id, topic_id, task_id)
                except Exception as load_error:
                    logger.warning(f"[_load_task_metadata] Не удалось загрузить через StorageService {task_ref}: {load_error}")
                    loaded = None
                if isinstance(loaded, dict):
                    task_data_candidate = loaded.get("task_data") or loaded
                    if isinstance(task_data_candidate, dict):
                        task_json = task_data_candidate
                    meta_candidate = loaded.get("metadata")
                    if isinstance(meta_candidate, dict):
                        meta_section = meta_candidate

            if task_json is None:
                task_path = self._resolve_task_json_path(module_id, topic_id, task_id)
                if task_path and task_path.exists():
                    try:
                        with open(task_path, "r", encoding="utf-8") as f:
                            task_json = json.load(f)
                    except Exception as file_error:
                        logger.warning(f"[_load_task_metadata] Ошибка чтения {task_path}: {file_error}")

            if not isinstance(task_json, dict):
                self.task_meta_cache[cache_key] = metadata
                return metadata

            content = task_json.get("content", {})
            if not isinstance(content, dict):
                content = {}

            resolved_metadata = {
                "type": (
                    meta_section.get("type")
                    or task_json.get("type")
                    or task_json.get("task_type")
                    or content.get("type")
                ),
                "subtype": (
                    meta_section.get("subtype")
                    or task_json.get("subtype")
                    or content.get("subtype")
                ),
                "mode": content.get("mode"),
            }

            # Убираем None значений
            metadata = {k: v for k, v in resolved_metadata.items() if v is not None}
            metadata["task_ref"] = task_ref
        except Exception:
            logger.exception(f"[_load_task_metadata] Ошибка при загрузке метаданных для {task_ref}")
            metadata = {}

        self.task_meta_cache[cache_key] = metadata
        return metadata

    @staticmethod
    def _is_error_detection_metadata(task_metadata: Optional[Dict[str, Any]]) -> bool:
        """Определяет задания подтипа error_detection с fallback по mode."""
        if not isinstance(task_metadata, dict):
            return False
        subtype = str(task_metadata.get("subtype") or "").strip().lower()
        mode = str(task_metadata.get("mode") or "").strip().lower()
        return subtype == "error_detection" or mode in {"text_errors", "text_choice"}

    def _all_other_tasks_at_max(
        self,
        session: ComplexSession,
        complex_obj: Complex,
        exclude_task_ref: Optional[str] = None,
    ) -> bool:
        """
        Проверяет, достигли ли все задания (кроме исключений) максимальной сложности.

        Учитываются только задания, которые:
        - присутствуют в списке комплекса,
        - не отмечены как broken,
        - не являются error_detection.
        """
        if not complex_obj or not complex_obj.tasks:
            return False

        for task_ref in complex_obj.tasks:
            if task_ref == exclude_task_ref:
                continue
            if task_ref in session.broken_tasks:
                continue

            task_metadata = self._load_task_metadata(task_ref)
            if self._is_error_detection_metadata(task_metadata):
                continue

            last_result: Optional[SessionTaskResult] = None
            for result in reversed(session.completed_tasks):
                if result.task_ref == task_ref:
                    last_result = result
                    break

            if not last_result:
                logger.debug(
                    f"[_all_other_tasks_at_max] Нет результатов по {task_ref}, условие не выполнено"
                )
                return False

            task_type = self._get_task_type(task_ref)
            available_levels = self.difficulty_manager.get_available_levels(task_type, task_ref)
            max_level = max(available_levels) if available_levels else 1

            if not last_result.success or last_result.difficulty < max_level:
                logger.debug(
                    f"[_all_other_tasks_at_max] {task_ref} ещё не на максимальной сложности "
                    f"(success={last_result.success}, level={last_result.difficulty}, max={max_level})"
                )
                return False

        logger.debug(
            f"[_all_other_tasks_at_max] Все подходящие задания (кроме {exclude_task_ref}) "
            f"на максимальном уровне"
        )
        return True

    def _get_task_max_level(self, task_type: str, task_ref: str) -> int:
        """Возвращает максимальный доступный уровень сложности для задания."""
        available_levels = self.difficulty_manager.get_available_levels(task_type, task_ref)
        if not available_levels:
            return 1
        try:
            return max(int(level) for level in available_levels)
        except Exception:
            logger.debug(
                "[_get_task_max_level] Не удалось нормализовать уровни %s для %s, используем 1",
                available_levels,
                task_ref,
            )
            return 1

    @staticmethod
    def _has_real_difficulty_helper(helper: Any) -> bool:
        return callable(helper) and not str(getattr(helper.__class__, "__module__", "")).startswith("unittest.mock")

    @staticmethod
    def _fallback_normalize_requested_level(requested_level: Any, available_levels: List[int]) -> int:
        normalized_levels = sorted(int(level) for level in available_levels if isinstance(level, int))
        if not normalized_levels:
            return 1
        try:
            requested = int(requested_level)
        except Exception:
            return normalized_levels[0]
        if requested in normalized_levels:
            return requested
        lower_or_equal = [level for level in normalized_levels if level <= requested]
        if lower_or_equal:
            return lower_or_equal[-1]
        return normalized_levels[0]

    def _normalize_level_for_available(self, requested_level: Any, available_levels: List[int]) -> int:
        helper = getattr(self.difficulty_manager, "normalize_requested_level", None)
        if self._has_real_difficulty_helper(helper):
            try:
                return int(helper(requested_level, available_levels))
            except Exception:
                pass
        return self._fallback_normalize_requested_level(requested_level, available_levels)

    def _next_level_for_available(self, current_level: Any, available_levels: List[int]) -> int:
        helper = getattr(self.difficulty_manager, "get_next_allowed_level", None)
        if self._has_real_difficulty_helper(helper):
            try:
                return int(helper(current_level, available_levels))
            except Exception:
                pass

        normalized_levels = sorted(int(level) for level in available_levels if isinstance(level, int))
        if not normalized_levels:
            return 1
        current = self._fallback_normalize_requested_level(current_level, normalized_levels)
        for level in normalized_levels:
            if level > current:
                return level
        return normalized_levels[-1]

    def _progression_step_count_for_levels(self, available_levels: List[int]) -> int:
        helper = getattr(self.difficulty_manager, "get_progression_step_count", None)
        if self._has_real_difficulty_helper(helper):
            try:
                return int(helper(available_levels))
            except Exception:
                pass
        return max(1, len([level for level in available_levels if isinstance(level, int)]))

    def _iteration_level_for_step(self, target_step: Any, available_levels: List[int]) -> int:
        helper = getattr(self.difficulty_manager, "get_iteration_level_by_step", None)
        if self._has_real_difficulty_helper(helper):
            try:
                return int(helper(target_step, available_levels))
            except Exception:
                pass

        normalized_levels = sorted(int(level) for level in available_levels if isinstance(level, int))
        if not normalized_levels:
            return 1
        try:
            step = max(1, int(target_step))
        except Exception:
            step = 1
        return normalized_levels[min(step - 1, len(normalized_levels) - 1)]

    def _get_task_progression_steps(self, task_type: str, task_ref: str) -> int:
        """Возвращает число реальных шагов прогрессии для задания."""
        available_levels = self.difficulty_manager.get_available_levels(task_type, task_ref)
        if not available_levels:
            return 1
        try:
            return self._progression_step_count_for_levels(available_levels)
        except Exception:
            logger.debug(
                "[_get_task_progression_steps] Не удалось нормализовать уровни %s для %s, используем 1",
                available_levels,
                task_ref,
            )
            return 1

    @staticmethod
    def _get_error_detection_finisher_level() -> int:
        """Error-detection задачи являются отдельным финишером и всегда живут на уровне 3."""
        return 3

    @staticmethod
    def _normalize_iteration_level_list(levels: List[Any]) -> List[int]:
        normalized = sorted({int(level) for level in levels if isinstance(level, int)})
        return [level for level in normalized if level >= 1]

    def _get_regular_iteration_levels(
        self,
        session: ComplexSession,
        complex_obj: Complex,
    ) -> List[int]:
        levels = set()
        for task_ref in complex_obj.tasks or []:
            if task_ref in session.broken_tasks:
                continue

            task_metadata = self._load_task_metadata(task_ref)
            if self._is_error_detection_metadata(task_metadata):
                continue

            task_type = self._get_task_type(task_ref)
            available_levels = self.difficulty_manager.get_available_levels(task_type, task_ref)
            for level in self._normalize_iteration_level_list(available_levels):
                levels.add(level)

        return sorted(levels)

    def _has_error_detection_tasks(
        self,
        session: ComplexSession,
        complex_obj: Complex,
    ) -> bool:
        for task_ref in complex_obj.tasks or []:
            if task_ref in session.broken_tasks:
                continue
            if self._is_error_detection_metadata(self._load_task_metadata(task_ref)):
                return True
        return False

    def _get_visible_iteration_levels(
        self,
        session: ComplexSession,
        complex_obj: Complex,
    ) -> List[int]:
        visible_levels = list(self._get_regular_iteration_levels(session, complex_obj))
        if self._has_error_detection_tasks(session, complex_obj):
            finisher_level = self._get_error_detection_finisher_level()
            if finisher_level not in visible_levels:
                visible_levels.append(finisher_level)
                visible_levels.sort()
        return visible_levels

    def _get_absolute_iteration_level(
        self,
        session: ComplexSession,
        complex_obj: Complex,
        target_iteration: int,
    ) -> Optional[int]:
        visible_levels = self._get_visible_iteration_levels(session, complex_obj)
        if not visible_levels:
            return None
        try:
            visible_iteration = max(1, int(target_iteration or 1))
        except Exception:
            visible_iteration = 1
        if visible_iteration > len(visible_levels):
            return None
        return visible_levels[visible_iteration - 1]

    def _task_participates_in_absolute_level(
        self,
        task_type: str,
        task_ref: str,
        absolute_level: Optional[int],
        *,
        is_error_detection: bool = False,
        available_levels: Optional[List[int]] = None,
    ) -> bool:
        if absolute_level is None:
            return False
        if is_error_detection:
            return absolute_level == self._get_error_detection_finisher_level()
        return (
            self._resolve_regular_iteration_difficulty(
                task_type,
                task_ref,
                absolute_level,
                available_levels=available_levels,
            )
            is not None
        )

    def _get_planned_final_iteration(
        self,
        session: ComplexSession,
        complex_obj: Complex,
    ) -> int:
        """
        Возвращает номер плановой финальной итерации.

        До этой итерации комплекс должен повторять все доступные не-broken задания,
        повышая сложность до максимума для каждого типа. Error-detection задания
        подключаются в эту финальную плановую итерацию вместе с остальными.
        """
        visible_levels = self._get_visible_iteration_levels(session, complex_obj)
        return max(1, len(visible_levels))

    def _get_iteration_target_difficulty(
        self,
        task_type: str,
        task_ref: str,
        target_iteration: int,
        session: ComplexSession,
        complex_obj: Complex,
        *,
        is_error_detection: bool = False,
    ) -> Optional[int]:
        """Возвращает сложность задания для целевой итерации с учётом максимума."""
        absolute_level = self._get_absolute_iteration_level(session, complex_obj, target_iteration)
        if absolute_level is None:
            return None
        if is_error_detection:
            return self._get_error_detection_finisher_level()
        available_levels = self.difficulty_manager.get_available_levels(task_type, task_ref)
        return self._resolve_regular_iteration_difficulty(
            task_type,
            task_ref,
            absolute_level,
            available_levels=available_levels,
        )

    def _task_uses_explicit_level_selection(self, task_type: str, task_ref: str) -> bool:
        helper = getattr(self.difficulty_manager, "uses_explicit_level_selection", None)
        if self._has_real_difficulty_helper(helper):
            try:
                return bool(helper(task_type, task_ref=task_ref))
            except Exception:
                logger.debug(
                    "[_task_uses_explicit_level_selection] Failed to resolve explicit policy for %s",
                    task_ref,
                    exc_info=True,
                )
        return False

    def _resolve_regular_iteration_difficulty(
        self,
        task_type: str,
        task_ref: str,
        absolute_level: Optional[int],
        *,
        available_levels: Optional[List[int]] = None,
    ) -> Optional[int]:
        if absolute_level is None:
            return None

        normalized_levels = self._normalize_iteration_level_list(
            available_levels
            if available_levels is not None
            else self.difficulty_manager.get_available_levels(task_type, task_ref)
        )
        if not normalized_levels:
            return None

        if absolute_level < normalized_levels[0]:
            return None

        return self._normalize_level_for_available(absolute_level, normalized_levels)
        
    def start_session(self, complex_id: str, user_id: str, start_iteration: int = 1) -> ComplexSession:
        """
        Начинает новую сессию выполнения комплекса.
        
        Args:
            complex_id: ID комплекса
            user_id: ID пользователя
            start_iteration: Начальная итерация (по умолчанию 1)
        
        Fail Fast при критических ошибках (парсинг комплекса, БД) -> выбросить исключение,
        не создавать файл сессии.
        
        Если все задания битые: сессия создается, но завершается при первом get_next_task()
        (очередь пуста).
        """
        complex_obj = self.complex_service.get_complex(complex_id)
        if not complex_obj:
            raise ValueError(f"Complex not found: {complex_id}")
        
        # Создаем новую сессию
        session_id = f"session_{user_id}_{datetime.utcnow().timestamp()}"
        session = ComplexSession(
            id=session_id,
            complex_id=complex_id,
            user_id=user_id,
            start_time=datetime.utcnow(),
            version=1,
            iteration=start_iteration
        )
        
        # Инициализируем timestamps для начальной итерации
        session.iteration_timestamps[start_iteration] = {
            'start': datetime.utcnow(),
            'end': None
        }
        
        logger.info(f"[start_session] Создана сессия: session_id={session_id}, user_id={user_id}, "
                   f"complex_id={complex_id}, start_iteration={start_iteration}")
        
        # Генерируем начальную очередь
        self._generate_initial_queue(session, complex_obj, start_iteration)
        
        # Сохраняем сессию через SessionRepository
        self.session_repository.save_session(session, user_id)
        logger.info(f"[start_session] Сессия сохранена: session_id={session_id}, user_id={user_id}")
        
        self._active_sessions[session_id] = session
        logger.info(f"Started session {session_id} for complex {complex_id} at iteration {start_iteration}")
        return session
    
    def restore_session(self, session: ComplexSession) -> None:
        """
        Восстанавливает сессию в памяти из загруженного файла.
        
        Args:
            session: Загруженная сессия из SessionRepository
        """
        # ИСПРАВЛЕНИЕ: Если сессия была завершена (is_active = False), но состояние UI = "iteration_results",
        # не восстанавливаем ее как активную, но сохраняем в памяти для доступа к данным
        # UI сам решит, что делать с такой сессией
        self._active_sessions[session.id] = session
        
        # Если сессия была завершена, но состояние UI = "iteration_results", это нормально
        # UI покажет экран результатов итерации
        if not session.is_active and session.ui_state and session.ui_state.get("screen_type") == "iteration_results":
            logger.info(f"Restored session {session.id} (inactive, but has iteration_results state) for complex {session.complex_id}")
        else:
            logger.info(f"Restored session {session.id} for complex {session.complex_id}")
    
    # Максимальное количество пропусков одного задания за итерацию
    MAX_SKIPS_PER_TASK = 2

    def skip_task(self, session_id: str, task_ref: str) -> Dict[str, Any]:
        """
        Откладывает задание в конец текущей очереди итерации.
        
        Новая модель пропуска:
        - Задание перемещается в конец очереди (а не исчезает из итерации)
        - Ретрай-копии (is_retry=True) нельзя пропустить
        - Последнее оставшееся задание в итерации нельзя пропустить
        - Каждое задание можно отложить не более MAX_SKIPS_PER_TASK раз за итерацию
        
        Args:
            session_id: ID сессии
            task_ref: Ссылка на задание для пропуска
            
        Returns:
            Dict с результатом: {"ok": True} или {"ok": False, "reason": "..."}
        """
        session = self._active_sessions.get(session_id)
        if not session or not session.is_active:
            logger.warning(f"[skip_task] Сессия {session_id} не найдена или неактивна")
            return {"ok": False, "reason": "session_not_found"}
        
        # --- Правило 1: Найти текущее задание в очереди ---
        current_idx = session.current_task_index
        # get_next_task увеличивает index ПЕРЕД возвратом, поэтому текущее задание = index - 1
        task_queue_idx = current_idx - 1 if current_idx > 0 else 0
        
        if task_queue_idx < 0 or task_queue_idx >= len(session.queue):
            logger.warning(f"[skip_task] Индекс задания {task_queue_idx} вне очереди (len={len(session.queue)})")
            return {"ok": False, "reason": "task_not_in_queue"}
        
        queued_task = session.queue[task_queue_idx]
        if queued_task.task_ref != task_ref:
            # Поиск по task_ref как запасной вариант
            found = False
            for i in range(max(0, current_idx - 1), -1, -1):
                if session.queue[i].task_ref == task_ref:
                    task_queue_idx = i
                    queued_task = session.queue[i]
                    found = True
                    break
            if not found:
                logger.warning(f"[skip_task] Задание {task_ref} не найдено в очереди около индекса {current_idx}")
                return {"ok": False, "reason": "task_not_in_queue"}
        
        # --- Правило 2: Ретрай-копии нельзя пропускать ---
        if queued_task.is_retry:
            logger.info(f"[skip_task] Задание {task_ref} является ретрай-копией, пропуск запрещён")
            return {"ok": False, "reason": "retry_cannot_be_skipped"}
        
        # --- Правило 3: Последнее оставшееся задание нельзя пропускать ---
        remaining_tasks = len(session.queue) - current_idx  # задания после текущего
        # Текущее задание ещё не отвечено, поэтому оно тоже "оставшееся"
        total_remaining = remaining_tasks + 1  # +1 = само текущее задание
        if total_remaining <= 1:
            logger.info(f"[skip_task] Задание {task_ref} последнее в итерации, пропуск запрещён")
            return {"ok": False, "reason": "last_task_cannot_be_skipped"}
        
        # --- Правило 4: Лимит пропусков ---
        skip_counts = session.skip_counts
        
        current_skip_count = skip_counts.get(task_ref, 0)
        if current_skip_count >= self.MAX_SKIPS_PER_TASK:
            logger.info(
                f"[skip_task] Задание {task_ref} уже отложено {current_skip_count} раз "
                f"(лимит {self.MAX_SKIPS_PER_TASK}), пропуск запрещён"
            )
            return {"ok": False, "reason": "skip_limit_reached"}
        
        # --- Выполняем пропуск: перемещаем задание в конец очереди ---
        session.queue.pop(task_queue_idx)
        session.queue.append(queued_task)
        
        # Корректируем current_task_index, т.к. элемент был удалён ДО текущего индекса
        if task_queue_idx < session.current_task_index:
            session.current_task_index -= 1
        
        # Увеличиваем счётчик пропусков
        skip_counts[task_ref] = current_skip_count + 1
        
        logger.info(
            f"[skip_task] Задание {task_ref} перемещено в конец очереди "
            f"(позиция {task_queue_idx} -> {len(session.queue) - 1}), "
            f"пропусков: {skip_counts[task_ref]}/{self.MAX_SKIPS_PER_TASK}, "
            f"current_task_index: {session.current_task_index}"
        )
        
        self.session_repository.save_session(session, session.user_id)
        return {"ok": True}

    @staticmethod
    def _accumulate_pause_time(session: ComplexSession) -> None:
        """Добавляет интервал текущей паузы к total_pause_seconds и корректирует iteration_timestamps."""
        paused_at = session.paused_at
        if not paused_at:
            return
        try:
            now = datetime.utcnow()
            delta = (now - paused_at).total_seconds()
            if delta <= 0:
                return
            prev = session.total_pause_seconds or 0.0
            session.total_pause_seconds = prev + delta
            logger.info(
                f"[_accumulate_pause_time] Сессия {session.id}: "
                f"пауза {delta:.1f}с, итого {session.total_pause_seconds:.1f}с"
            )

            # MISSING-4: сдвигаем start текущей итерации вперёд на delta,
            # чтобы (end - start) отражало чистое рабочее время.
            from datetime import timedelta
            cur_iter = session.iteration
            ts_map = session.iteration_timestamps
            if cur_iter in ts_map:
                ts = ts_map[cur_iter]
                start_val = ts.get("start")
                if start_val and not ts.get("end"):
                    ts["start"] = start_val + timedelta(seconds=delta)
                    logger.debug(
                        f"[_accumulate_pause_time] iteration_timestamps[{cur_iter}].start "
                        f"сдвинут на {delta:.1f}с"
                    )
        except Exception:
            logger.exception("[_accumulate_pause_time] Ошибка вычисления времени паузы")

    def pause_session(self, session_id: str) -> None:
        """
        Ставит сессию на паузу — сохраняет состояние в репозитории.
        
        Сессия не завершается (is_active остаётся True), но помечается как paused.
        Сессия остаётся в _active_sessions для быстрого доступа при resume.
        
        Args:
            session_id: ID сессии для паузы
        """
        session = self._active_sessions.get(session_id)
        if not session:
            logger.warning(f"[pause_session] Сессия {session_id} не найдена в активных сессиях")
            return

        session.paused = True
        session.paused_at = datetime.utcnow()

        # Сохраняем сессию в репозитории
        self.session_repository.save_session(session, session.user_id)
        logger.info(f"[pause_session] Сессия {session_id} сохранена и помечена как paused")

    def resume_session(
        self,
        session_id: str,
        user_id: str,
        source: Optional[str] = None,
    ) -> Optional[ComplexSession]:
        """
        Возобновляет сессию: снимает флаг paused и возвращает объект.
        Идемпотентно: если не была на паузе, возвращает активную сессию.
        """
        session = self._active_sessions.get(session_id)
        if session:
            self._accumulate_pause_time(session)
            session.paused = False
            session.paused_at = None
            session.paused_resume_target = None
            session.last_resume_source = str(source or "unknown").strip() or "unknown"
            session.last_resumed_at = datetime.utcnow()
            self.session_repository.save_session(session, session.user_id)
            logger.info(
                "[resume_session] Сессия %s активна в памяти, флаг paused снят, source=%s",
                session_id,
                session.last_resume_source,
            )
            return session

        # Не найдена в памяти — пробуем загрузить из репозитория по session_id
        try:
            loaded = self.session_repository.load_session_by_session_id(user_id=user_id, session_id=session_id)
        except Exception:
            logger.exception(f"[resume_session] Ошибка загрузки сессии {session_id} из репозитория")
            loaded = None

        if not loaded:
            logger.warning(f"[resume_session] Сессия {session_id} не найдена ни в памяти, ни в файле")
            return None

        self._accumulate_pause_time(loaded)
        loaded.paused = False
        loaded.paused_at = None
        loaded.paused_resume_target = None
        loaded.last_resume_source = str(source or "unknown").strip() or "unknown"
        loaded.last_resumed_at = datetime.utcnow()
        self._active_sessions[session_id] = loaded
        self.session_repository.save_session(loaded, loaded.user_id)
        logger.info(
            "[resume_session] Сессия %s восстановлена из файла и активирована, source=%s",
            session_id,
            loaded.last_resume_source,
        )
        return loaded
    
    def cancel_session(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """
        Полностью отменяет сессию без фиксации результатов.
        
        Args:
            session_id: ID сессии для отмены.
            user_id: ID пользователя (используется для поиска сессии на диске,
                     если она не найдена в памяти).
        
        Returns:
            bool: True если сессия найдена и отменена, иначе False.
        """
        session = self._active_sessions.pop(session_id, None)

        # Fallback: загрузка из файла (например, после перезапуска сервера)
        if not session and user_id:
            try:
                session = self.session_repository.load_session_by_session_id(
                    user_id=user_id, session_id=session_id
                )
            except Exception:
                logger.exception(
                    f"[cancel_session] Не удалось загрузить сессию {session_id} из файла"
                )

        if not session:
            logger.warning(f"[cancel_session] Сессия {session_id} не найдена ни в памяти, ни в файле")
            return False
        
        complex_id = getattr(session, "complex_id", None)
        sess_user_id = getattr(session, "user_id", None) or user_id
        
        session.is_active = False
        session.ui_state = None
        
        if complex_id and sess_user_id:
            try:
                if hasattr(self.session_repository, "delete_session_by_session_id"):
                    self.session_repository.delete_session_by_session_id(session_id, sess_user_id)
                else:
                    self.session_repository.delete_session(complex_id, sess_user_id)
                logger.info(f"[cancel_session] Удалена сессия {session_id} (complex_id={complex_id}, user_id={sess_user_id})")
            except Exception:
                logger.exception(
                    f"[cancel_session] Не удалось удалить файл сессии для complex_id={complex_id}, user_id={sess_user_id}"
                )
        else:
            logger.warning(
                f"[cancel_session] Не удалось определить complex_id/user_id для session_id={session_id}"
            )
        
        return True
    
    def get_session(self, session_id: str) -> Optional[ComplexSession]:
        """Возвращает активную сессию по ID."""
        return self._active_sessions.get(session_id)
    
    def end_session(self, session_id: str) -> Optional[ExtendedSessionResultSummary]:
        """
        Завершает сессию и генерирует ExtendedSessionResultSummary.

        Returns:
            ExtendedSessionResultSummary или None если сессия не найдена
        """
        session = self._active_sessions.get(session_id)
        if not session:
            return None

        # Если сессия уже завершена и есть end_time — возвращаем ранее сохраненную сводку или генерируем без обновления времени
        if not session.is_active and session.end_time:
            cached = getattr(session, "_final_summary", None)
            if cached is not None:
                return cached
            summary = self._generate_session_summary(session)
            session._final_summary = summary  # type: ignore[attr-defined]
            return summary

        session.end_time = datetime.utcnow()
        session.is_active = False

        # Генерируем ExtendedSessionResultSummary
        summary = self._generate_session_summary(session)
        session._final_summary = summary  # type: ignore[attr-defined]

        # Сохраняем финальное состояние сессии
        self.session_repository.save_session(session, session.user_id)

        # Фиксируем завершение комплекса в прогрессе (для streak/серии)
        try:
            progress_manager = self._get_progress_manager_for_user(getattr(session, "user_id", None))
            if progress_manager:
                progress_manager.add_complex_completion(
                    complex_id=session.complex_id,
                    session_id=session.id,
                    timestamp=datetime.utcnow().isoformat(),
                )
        except Exception as e:
            logger.warning(f"[end_session] Failed to add complex completion for streak: {e}")
        
        logger.info(f"Ended session {session_id}")
        return summary
    
    def get_next_task(self, session_id: str, _recursion_depth: int = 0) -> Optional[Dict[str, Any]]:
        """
        Определяет следующее задание для выполнения.
        
        Если current_task_index >= len(queue) -> запускается генерация Итерации N+1.
        Если новая очередь пуста -> вызывается end_session(), возвращается None.
        
        Args:
            session_id: ID сессии
            _recursion_depth: Внутренний параметр для отслеживания глубины рекурсии
        
        Returns:
            Dict с информацией о задании (task_ref, difficulty) или None, если сессия завершена.
        """
        # Защита от бесконечной рекурсии
        MAX_RECURSION_DEPTH = 100  # Максимальная глубина = размер очереди
        if _recursion_depth >= MAX_RECURSION_DEPTH:
            logger.error(
                f"[get_next_task] Достигнута максимальная глубина рекурсии ({MAX_RECURSION_DEPTH}). "
                f"Возможно, все задания в очереди битые. Session: {session_id}"
            )
            session = self._active_sessions.get(session_id)
            if session:
                logger.error(
                    f"[get_next_task] Битые задания: {session.broken_tasks}, "
                    f"всего в очереди: {len(session.queue)}"
                )
            # Завершаем сессию с ошибкой
            self.end_session(session_id)
            return None
        
        # Логирование при приближении к лимиту
        if _recursion_depth > MAX_RECURSION_DEPTH * 0.8:  # 80% от лимита
            logger.warning(
                f"[get_next_task] Высокая глубина рекурсии: {_recursion_depth}/{MAX_RECURSION_DEPTH}. "
                f"Session: {session_id}"
            )
        
        session = self._active_sessions.get(session_id)
        if not session or not session.is_active:
            return None
        
        # Если очередь закончилась, генерируем следующую итерацию
        if session.current_task_index >= len(session.queue):
            # Сохраняем номер завершенной итерации для показа результатов
            completed_iteration = session.iteration
            
            # Генерируем следующую итерацию
            complex_obj = self.complex_service.get_complex(session.complex_id)
            if not complex_obj:
                logger.error(f"Complex {session.complex_id} not found")
                return None
            
            self._generate_next_iteration(session, complex_obj)
            
            # Если очередь пуста после генерации -> завершаем сессию
            if not session.queue:
                # Проверяем, нужно ли показать финальные результаты (все задания на максимальной сложности)
                if hasattr(session, '_should_show_final_results') and session._should_show_final_results:
                    logger.info(f"[get_next_task] Комплекс завершен - все задания на максимальной сложности")
                    # Сохраняем информацию о завершенной итерации перед завершением сессии
                    session._completed_iteration_before_end = completed_iteration
                    # Завершаем сессию и сохраняем финальные результаты
                    final_summary = self.end_session(session_id)
                    # Сохраняем финальные результаты в сессии для доступа из контроллера
                    if final_summary:
                        session._final_summary = final_summary
                    return None
                else:
                    # Обычное завершение (пустая очередь по другим причинам)
                    session._completed_iteration_before_end = completed_iteration
                    self.end_session(session_id)
                    return None
        
        # Берем следующее задание из очереди
        queued_task = session.queue[session.current_task_index]
        task_ref = queued_task.task_ref
        
        # Runtime проверка: если файл не найден, пропускаем задание
        if not self._check_task_file_exists(task_ref):
            logger.warning(f"Task file not found at runtime: {task_ref}")
            session.broken_tasks.append(task_ref)
            self.session_repository.save_session(session, session.user_id)
            # Рекурсивно вызываем get_next_task для пропуска битого задания
            session.current_task_index += 1
            return self.get_next_task(session_id, _recursion_depth=_recursion_depth + 1)
        
        session.current_task_index += 1
        
        return {
            "task_ref": task_ref,
            "difficulty": queued_task.difficulty,
            "is_retry": queued_task.is_retry,
            "index": session.current_task_index - 1,  # Уже увеличили, возвращаем предыдущий
            "total": len(session.queue),
            "iteration": session.iteration,
            "display_mode": getattr(queued_task, "display_mode", None),
            "source_task_ref": getattr(queued_task, "source_task_ref", None),
            "test_question_index": getattr(queued_task, "test_question_index", None),
        }
    
    def submit_result(self, session_id: str, result_data: Dict[str, Any]) -> SessionTaskResult:
        """
        Обрабатывает результат выполнения задания.
        
        Args:
            session_id: ID сессии
            result_data: Данные результата (success, time_spent, task_ref, difficulty)
        """
        session = self._active_sessions.get(session_id)
        if not session or not session.is_active:
            raise ValueError("Session not found or inactive")
        
        task_ref = result_data['task_ref']
        success = result_data['success']
        time_spent = result_data.get('time_spent', 0)
        difficulty = result_data.get('difficulty', 1)

        # Загружаем метаданные задания для спец-логики error_detection (text_errors)
        try:
            task_meta = self._load_task_metadata(task_ref) if hasattr(self, "_load_task_metadata") else {}
        except Exception:
            task_meta = {}
        
        # ITERATION MISMATCH PROTECTION
        # Получаем expected_iteration от клиента для защиты от race conditions
        expected_iteration = result_data.get('expected_iteration')
        
        # Определяем, какую итерацию использовать
        if expected_iteration is not None:
            # Клиент передал итерацию - проверяем на несоответствие
            if expected_iteration != session.iteration:
                logger.warning(
                    f"[submit_result] ⚠️  ITERATION MISMATCH DETECTED! "
                    f"Expected: {expected_iteration}, Current: {session.iteration}. "
                    f"Task: {task_ref}, Session: {session_id}. "
                    f"Using expected_iteration to preserve data integrity."
                )
                # Используем итерацию от клиента (более надежно)
                iteration_to_use = expected_iteration
                
                # Увеличиваем счетчик несоответствий для мониторинга
                if not hasattr(self, 'iteration_mismatch_count'):
                    self.iteration_mismatch_count = 0
                self.iteration_mismatch_count += 1
                logger.warning(
                    f"[submit_result] 📊 Total iteration mismatches: {self.iteration_mismatch_count}"
                )
            else:
                # Совпадает - все ок
                iteration_to_use = session.iteration
                logger.debug(
                    f"[submit_result] ✓ Iteration match: {iteration_to_use} "
                    f"(task: {task_ref})"
                )
        else:
            # Клиент не передал (старая версия frontend) - используем текущую
            logger.debug(
                f"[submit_result] No expected_iteration provided by client. "
                f"Using current session.iteration={session.iteration}. "
                f"Task: {task_ref}"
            )
            iteration_to_use = session.iteration
        
        # Создаем объект результата с правильной итерацией
        result = SessionTaskResult(
            task_ref=task_ref,
            success=success,
            score=result_data.get('score'),
            time_spent=time_spent,
            difficulty=difficulty,
            iteration_index=iteration_to_use,  # ← Используем проверенную итерацию
            details=result_data.get("details", {})
        )

        session.completed_tasks.append(result)

        # Разбираем details один раз, чтобы использовать и для smart-retry, и для partial retry
        details = result.details or {}
        failed_subtests = details.get("failed_subtests") or []
        task_type = details.get("task_type") or None

        logger.info(
            "[submit_result] Raw result for task %s: success=%s, task_type=%s, "
            "failed_subtests_count=%s",
            task_ref,
            success,
            task_type,
            len(failed_subtests) if isinstance(failed_subtests, list) else "?",
        )

        # Обработка Partial Retry для тестов
        if task_type == "test":
             # Вызываем helper, который нормализует ошибки и обновляет статус успеха
             success = self._process_test_partial_retry(session, task_ref, result, failed_subtests)
             # Обновляем локальные переменные после обработки
             details = result.details
             failed_subtests = details.get("failed_subtests") or []
        
        # Решаем, нужно ли добавлять задание в smart-retry очередь.
        # Для обычных заданий: только при success == False.
        # Для тестов: даже если общий success == True (процентный порог пройден),
        # но есть failed_subtests, мы всё равно добавляем ретраи, чтобы переиграть
        # заваленные под-вопросы.
        # После нормализации failed_subtests для partial-retry этот флаг учитывает
        # только действительно незакрытые под-вопросы.
        should_add_retry = (not success) or (task_type == "test" and bool(failed_subtests))

        # Спец-логика: для error_detection (mode text_errors) не плодим ретраи вообще,
        # т.к. в этом режиме фронт уже показывает факт попадания по слову, а дубли в очереди ломают UX.
        try:
            is_error_detection = self._is_error_detection_metadata(task_meta)
        except Exception:
            is_error_detection = False
        if is_error_detection:
            should_add_retry = False

        logger.info(
            "[submit_result] Decision for task %s: success=%s, task_type=%s, "
            "normalized_failed_subtests_count=%s, should_add_retry=%s",
            task_ref,
            success,
            task_type,
            len(failed_subtests) if isinstance(failed_subtests, list) else "?",
            should_add_retry,
        )

        if should_add_retry:
            logger.info(
                f"[submit_result] Задание {task_ref} будет добавлено в очередь ретраев: "
                f"success={success}, task_type={task_type}, failed_subtests_count={len(failed_subtests)}"
            )
            retry_failed_indices: List[int] = []
            retry_display_mode = str(details.get("test_display_mode") or "").strip().lower()
            if task_type == "test" and retry_display_mode == "scattered" and isinstance(failed_subtests, list):
                for failed_item in failed_subtests:
                    if not isinstance(failed_item, dict):
                        continue
                    try:
                        idx = int(failed_item.get("index"))
                    except Exception:
                        continue
                    if idx >= 0 and idx not in retry_failed_indices:
                        retry_failed_indices.append(idx)
            self._add_failed_task_to_current_queue(
                session,
                task_ref,
                difficulty,
                failed_question_indices=retry_failed_indices or None,
                display_mode=retry_display_mode or None,
            )

        # Логика сохранения failed_subtests перенесена в _process_test_partial_retry
        # и выполняется ДО принятия решения о ретрае.
        
        # Сохраняем прогресс пользователя
        try:
            parts = task_ref.split('/')
            if len(parts) >= 3:
                module_id = parts[0]
                topic_id = parts[1]
                task_id = parts[-1]
                
                # Получаем task_type из кэша или загружаем
                task_type = self._get_task_type(task_ref)
                
                # ИСПРАВЛЕНИЕ: Обновляем кэш типа задания из details, если доступен
                # Это важно для случаев, когда тип не был определен при первой загрузке
                details = result_data.get('details', {})
                if details and 'task_type' in details:
                    actual_task_type = details['task_type']
                    if actual_task_type and actual_task_type != 'unknown':
                        # Обновляем кэш, если текущий тип unknown или отличается
                        if task_type == 'unknown' or task_type != actual_task_type:
                            logger.info(
                                f"[submit_result] Обновляем кэш типа задания {task_ref}: "
                                f"{task_type} -> {actual_task_type}"
                            )
                            self.task_meta_cache[task_ref] = actual_task_type
                            task_type = actual_task_type
                
                progress_manager = self._get_progress_manager_for_user(getattr(session, "user_id", None))
                progress_manager.save_attempt(
                    module_id=module_id,
                    topic_id=topic_id,
                    task_id=task_id,
                    difficulty=difficulty,
                    success=success,
                    score=result_data.get('score'),
                    time_spent=time_spent,
                    complex_id=session.complex_id,
                    iteration=session.iteration,
                    task_type=task_type
                )
        except Exception as e:
            logger.error(f"Failed to save user progress: {e}")
        
        # Сохраняем сессию после каждого результата
        self.session_repository.save_session(session, session.user_id)
        
        return result
    
    def _process_test_partial_retry(
        self, 
        session: ComplexSession, 
        task_ref: str, 
        result: SessionTaskResult, 
        failed_subtests_raw: List[Dict[str, Any]]
    ) -> bool:
        """
        Обрабатывает логику частичного ретрая для тестов.
        
        Нормализует failed_subtests, обновляет session.test_failed_subtests
        и определяет успешность задания с учетом исправления ошибок.
        
        Returns:
            bool: True если задание считается успешным (все ошибки исправлены), иначе False
        """
        success = result.success
        details = result.details or {}
        
        try:
            # 1. Нормализация failed_subtests относительно сохраненных ошибок
            if getattr(session, "test_failed_subtests", None):
                original_failed_indices = session.test_failed_subtests.get(task_ref) or []
                
                # Если есть сохраненные ошибки, фильтруем текущие ошибки
                if original_failed_indices:
                    normalized: List[Dict[str, Any]] = []
                    # Если failed_subtests_raw пустой, значит ошибок нет - все исправлено
                    if failed_subtests_raw:
                        for item in failed_subtests_raw:
                            if not isinstance(item, dict):
                                continue
                            try:
                                idx = int(item.get("index"))
                            except Exception:
                                continue
                            # Ошибкой считается только та, что была в исходном списке
                            if idx in original_failed_indices:
                                normalized.append(item)
                    
                    # Обновляем failed_subtests в details
                    # Важно: это влияет на то, какие вопросы будут показаны в ретрае
                    details["failed_subtests"] = normalized
                    result.details = details
                    
                    # Если ошибок не осталось (normalized пуст), значит исправили все "хвосты"
                    if not normalized:
                        logger.info(
                            "[submit_result] All previously failed subtests for %s "
                            "are now correct; marking partial-retry as success",
                            task_ref,
                        )
                        success = True
                        result.success = True
            
            # 2. Сохранение новых ошибок (если это первая попытка или появились новые в рамках логики)
            # В текущей логике мы сохраняем только если еще не сохраняли, или дополняем?
            # Исходная логика: if task_type == "test" and failed_subtests: save...
            # Но мы это делаем ПОСЛЕ нормализации.
            
            current_failed = details.get("failed_subtests") or []
            if current_failed:
                indices: List[int] = []
                for item in current_failed:
                    try:
                        idx = int(item.get("index"))
                        if idx not in indices:
                            indices.append(idx)
                    except Exception:
                        continue
                
                if indices:
                    # Инициализируем словарь, если нужно
                    if not hasattr(session, "test_failed_subtests") or session.test_failed_subtests is None:
                        session.test_failed_subtests = {}
                    
                    # Если для этого задания еще нет записей, сохраняем
                    # (Если уже есть, мы обычно не добавляем новые в ретрае, 
                    # но тут сохраняем "тот же хвост" или обновляем)
                    # В исходном коде просто перезаписывало/добавляло unique.
                    # Но учитывая нормализацию выше, сюда попадут только те, что были в original,
                    # ИЛИ если это первая попытка (original еще нет).
                    
                    # Если записи уже есть, мы их не затираем просто так, но wait... 
                    # Логика сохранения была: если indices не пуст, сохранить.
                    # Для первой попытки: save indices.
                    # Для ретрая: normalized indices (subset of original). 
                    # Мы не должны удалять из test_failed_subtests те индексы, которые мы ИСПРАВИЛИ сейчас?
                    # Исходный комментарий: "не очищаем test_failed_subtests автоматически... чтобы копии видели хвост".
                    # Поэтому мы обновляем запись только если ее нет? Или мержим?
                    
                    existing = session.test_failed_subtests.get(task_ref)
                    if not existing:
                        session.test_failed_subtests[task_ref] = indices
                    # Если уже есть, оставляем как есть (чтобы помнить ВСЕ изначальные ошибки),
                    # или обновляем?
                    # Логика была: просто for item in failed_subtests... if idx not in indices...
                    # потом session.test_failed_subtests[task_ref] = indices.
                    # Т.е. мы перезаписывали текущим набором ошибок.
                    # НО: комментарий говорил "не очищаем".
                    # Если мы перезапишем [1] поверх [1, 2] (где 2 исправлено), то следующая копия увидит только [1].
                    # Это правильно? "Smart-retry уже не добавит новых копий".
                    # Если у нас 2 копии. Первая исправила 2. Вторая копия запускается. Она видит test_failed_subtests.
                    # Если мы обновили до [1], то вторая копия будет спрашивать только 1. Это ОК.
                    # Если мы НЕ обновили, она спросит [1, 2]. User ответит 2 правильно опять.
                    
                    # В исходном коде (строки 750-763) мы формировали indices из current failed_subtests
                    # и ПРИСВАИВАЛИ их в session.test_failed_subtests[task_ref].
                    # Значит, мы сужали круг ошибок с каждой попыткой?
                    # Нет, исходный код:
                    # if task_type == "test" and failed_subtests:
                    #    ... собираем indices ...
                    #    session.test_failed_subtests[task_ref] = indices
                    #
                    # ДА, это перезапись. Значит, с каждой попыткой список "активных" ошибок уменьшается.
                    
                    # Однако, комментарий на строке 745 говорит: "ВАЖНО: не очищаем... автоматически при успехе partial-retry".
                    # Это значит, если failed_subtests пуст (успех), мы НЕ удаляем ключ из словаря.
                    # А если не пуст - обновляем.
                    
                    session.test_failed_subtests[task_ref] = indices

        except Exception:
            logger.exception(
                "[submit_result] Failed to process partial retry for task %s", task_ref
            )
            
        return success

    def _add_failed_task_to_current_queue(
        self,
        session: ComplexSession,
        task_ref: str,
        difficulty: int,
        failed_question_indices: Optional[List[int]] = None,
        display_mode: Optional[str] = None,
    ) -> None:
        """
        Добавляет ошибочное задание в текущую очередь итерации для повторного выполнения (Smart Retry).
        
        Логика:
        1. Если уровень > 1:
           - Добавить упрощенную версию (Lvl-1) через 2 позиции (Обучение).
           - Добавить исходную версию (Original Lvl) в конец текущей фазы (Контроль).
        2. Если уровень = 1:
           - Добавить копию (Lvl 1) через 2 позиции.
           - Добавить вторую копию (Lvl 1) в конец текущей фазы.
           
        Args:
            session: Сессия выполнения комплекса
            task_ref: Ссылка на задание
            difficulty: Уровень сложности задания
        """
        # Параметры smart-retry берём из настроек комплекса (с дефолтами,
        # совпадающими с текущим поведением).
        # Получаем дефолтные значения из конфигурации
        retry_config = self.difficulty_manager.get_smart_retry_config()
        
        near_offset = retry_config.get("near_offset", 2)
        near_jitter_max = retry_config.get("near_jitter_max", 2)
        max_copies = retry_config.get("max_copies", 5)
        training_control_enabled = retry_config.get("training_control_enabled", True)

        def _coerce_int(value, default):
            if isinstance(value, bool):
                return int(value)
            if isinstance(value, (int, float)):
                return int(value)
            if isinstance(value, str):
                try:
                    return int(value.strip())
                except ValueError:
                    return default
            return default

        def _coerce_bool(value, default):
            if isinstance(value, bool):
                return value
            if isinstance(value, (int, float)):
                return bool(value)
            if isinstance(value, str):
                lowered = value.strip().lower()
                if lowered in ("true", "1", "yes", "y", "on"):
                    return True
                if lowered in ("false", "0", "no", "n", "off"):
                    return False
            return default
        try:
            complex_id = getattr(session, "complex_id", None)
            if complex_id:
                complex_obj = self.complex_service.get_complex(complex_id)
            else:
                complex_obj = None
            settings = getattr(complex_obj, "settings", None) if complex_obj is not None else None
            if settings is not None:
                near_offset = _coerce_int(
                    getattr(settings, "smart_retry_near_offset", near_offset),
                    near_offset,
                )
                near_jitter_max = _coerce_int(
                    getattr(settings, "smart_retry_near_jitter_max", near_jitter_max),
                    near_jitter_max,
                )
                max_copies = _coerce_int(
                    getattr(settings, "smart_retry_max_copies_per_task", max_copies),
                    max_copies,
                )
                training_control_enabled = _coerce_bool(
                    getattr(
                        settings,
                        "smart_retry_training_control_enabled",
                        training_control_enabled,
                    ),
                    training_control_enabled,
                )
        except Exception:
            pass

        near_offset = _coerce_int(near_offset, 2)
        near_jitter_max = _coerce_int(near_jitter_max, 2)
        max_copies = _coerce_int(max_copies, 5)
        training_control_enabled = _coerce_bool(training_control_enabled, True)

        # Ограничение количества retry-копий одного задания
        current_copies = sum(1 for t in session.queue if t.task_ref == task_ref and t.is_retry)
        if max_copies >= 0 and current_copies >= max_copies:
            logger.info(
                f"[_add_failed_task_to_current_queue] ⚠️ Пропуск Smart Retry для {task_ref}: "
                f"достигнут лимит копий ({current_copies}/{max_copies})"
            )
            return

        remaining_copies = None
        if max_copies >= 0:
            remaining_copies = max(0, max_copies - current_copies)

        task_type = self._get_task_type(task_ref)
        scattered_retry_indices: List[int] = []
        if task_type == "test" and str(display_mode or "").strip().lower() == "scattered":
            for value in failed_question_indices or []:
                try:
                    idx = int(value)
                except Exception:
                    continue
                if idx >= 0 and idx not in scattered_retry_indices:
                    scattered_retry_indices.append(idx)

        def _make_retry_task(level: int, question_index: Optional[int] = None) -> QueuedTask:
            kwargs: Dict[str, Any] = {
                "task_ref": task_ref,
                "difficulty": level,
                "is_retry": True,
                "origin_iteration": session.iteration,
            }
            if question_index is not None:
                kwargs.update(
                    {
                        "display_mode": "scattered",
                        "source_task_ref": task_ref,
                        "test_question_index": question_index,
                    }
                )
            return QueuedTask(**kwargs)

        retry_question_indices: List[Optional[int]] = scattered_retry_indices or [None]
        tasks_to_add = []
        
        if difficulty > 1 and training_control_enabled:
            # Smart Retry: Lower level + Original level
            training_level = max(1, difficulty - 1)
            tasks_to_add.append({
                'task': QueuedTask(
                    task_ref=task_ref,
                    difficulty=training_level,
                    is_retry=True,
                    origin_iteration=session.iteration
                ),
                'position_type': 'near'
            })
            tasks_to_add.append({
                'task': QueuedTask(
                    task_ref=task_ref,
                    difficulty=difficulty,
                    is_retry=True,
                    origin_iteration=session.iteration
                ),
                'position_type': 'end_of_phase'
            })
        else:
            # Fallback / standard retry: две копии текущей сложности (вместо lvl-1 + original)
            tasks_to_add.append({
                'task': QueuedTask(
                    task_ref=task_ref,
                    difficulty=max(1, int(difficulty)),
                    is_retry=True,
                    origin_iteration=session.iteration
                ),
                'position_type': 'near'
            })
            tasks_to_add.append({
                'task': QueuedTask(
                    task_ref=task_ref,
                    difficulty=max(1, int(difficulty)),
                    is_retry=True,
                    origin_iteration=session.iteration
                ),
                'position_type': 'end_of_phase'
            })

        # Если лимит ограничивает количество новых копий за один вызов — обрезаем.
        if scattered_retry_indices:
            scattered_tasks_to_add = []
            for question_index in retry_question_indices:
                for item in tasks_to_add:
                    base_task = item.get("task")
                    level = getattr(base_task, "difficulty", difficulty)
                    scattered_tasks_to_add.append(
                        {
                            "task": _make_retry_task(int(level), question_index),
                            "position_type": item.get("position_type"),
                        }
                    )
            tasks_to_add = scattered_tasks_to_add

        if remaining_copies is not None:
            tasks_to_add = tasks_to_add[:remaining_copies]
            if not tasks_to_add:
                logger.info(
                    f"[_add_failed_task_to_current_queue] Лимит retry-копий исчерпан для {task_ref}; ничего не добавляем"
                )
                return
        
        current_idx = session.current_task_index
        queue_len = len(session.queue)
        
        # Определяем фазу исходного задания, чтобы найти конец текущей фазы
        original_phase = self._get_task_phase(task_type, difficulty)
        
        # Ищем конец фазы (первое задание с большей фазой) или конец очереди.
        end_of_phase_idx = queue_len
        
        for i in range(current_idx, queue_len):
            t = session.queue[i]
            t_type = self._get_task_type(t.task_ref)
            t_phase = self._get_task_phase(t_type, t.difficulty)
            
            # Если встретили задание из следующей фазы - это граница
            if t_phase > original_phase:
                end_of_phase_idx = i
                break
        
        # Вставляем задания
        idx_shift = 0
        
        for item in tasks_to_add:
            task = item['task']
            pos_type = item['position_type']
            
            if pos_type == 'near':
                # Вставляем через N позиций + детерминированный jitter (0..near_jitter_max).
                # Это снижает чувство однообразия и при этом воспроизводимо.
                base = max(0, near_offset)
                jitter_max = max(0, near_jitter_max)
                jitter = 0
                if jitter_max > 0:
                    seed_material = f"{session.id}:{session.iteration}:{task_ref}:near".encode("utf-8", errors="ignore")
                    jitter = int.from_bytes(hashlib.sha256(seed_material).digest()[:4], "big", signed=False) % (jitter_max + 1)

                requested_pos = current_idx + base + jitter
                # Не позволяем тренировочной копии перескочить границу фазы:
                if end_of_phase_idx < queue_len:
                    max_pos_before_next_phase = end_of_phase_idx + idx_shift
                    insert_pos = min(requested_pos, max_pos_before_next_phase)
                else:
                    insert_pos = requested_pos
                insert_pos = min(max(0, insert_pos), len(session.queue))
                session.queue.insert(insert_pos, task)
                
                # Если вставка произошла ДО конца фазы, сдвигаем индекс конца фазы
                if insert_pos <= end_of_phase_idx + idx_shift:
                    idx_shift += 1
                
                logger.info(f"[_add_failed_task_to_current_queue] Added 'near' retry task {task_ref} (lvl {task.difficulty}) at {insert_pos}")
                
            elif pos_type == 'end_of_phase':
                # Вставляем в конец фазы
                target = end_of_phase_idx + idx_shift
                # Безопасная вставка
                if target >= len(session.queue):
                     session.queue.append(task)
                else:
                     session.queue.insert(target, task)
                
                logger.info(f"[_add_failed_task_to_current_queue] Added 'end_of_phase' retry task {task_ref} (lvl {task.difficulty}) at {target}")

    def _get_task_phase(self, task_type: str, difficulty: int, task_ref: Optional[str] = None) -> int:
        """
        Определяет фазу выполнения задания (0 - Warm-up, 1 - Main, 2 - Finisher).
        
        Args:
            task_type: Тип задания
            difficulty: Уровень сложности
            
        Returns:
            int: ID фазы (0, 1 или 2)
        """
        if task_ref:
            metadata = self._load_task_metadata(task_ref)
            if self._is_error_detection_metadata(metadata):
                return 2
        
        # Open Answer всегда в конце
        if task_type == 'open_answer':
            return 2
        
        # Logic based on Mapping Matrix
        if difficulty == 1:
            if task_type in ('test', 'click', 'sequence_assembly'):
                return 0 # Warm-up
            if task_type == 'draw':
                return 1 # Main
                
        if difficulty == 2:
            if task_type == 'test':
                return 1 # Main
            if task_type in ('click', 'draw', 'sequence_assembly'):
                return 1 # Main
        
        if difficulty >= 3:
            if task_type == 'click':
                return 1 # Main
            if task_type == 'sequence_assembly':
                return 2 # Finisher
                
        # Default fallback to Main phase
        return 1

    def _task_refs_in_chains(self, chains: Optional[List[List[str]]]) -> set:
        refs = set()
        for chain in chains or []:
            if not isinstance(chain, list):
                continue
            for task_ref in chain:
                if isinstance(task_ref, str) and task_ref:
                    # Normalize to lowercase for robust matching
                    refs.add(task_ref.strip().lower())
        return refs

    def _chunk_variety_key(self, chunk: List[QueuedTask]) -> str:
        """Возвращает ключ «типа» для chunk при балансировке разнообразия.

        Логика:
        - Многоэлементный chunk (связка) → ``"chain"``: связка всегда считается
          перебивкой и никогда не образует монотонную серию.
        - Одиночный scattered-слот → ``"scattered_q:" + task_ref``: 
          используем task_ref, чтобы round-robin ПЕРЕМЕШИВАЛ вопросы РАЗНЫХ заданий
          между собой, а не просто сваливал их в одну кучу.
        - Обычное задание → реальный task_type (``"test"``, ``"click"`` и т.д.).
        """
        if not chunk:
            return "unknown"
        if len(chunk) > 1:
            return "chain"
        task = chunk[0]
        display_mode = str(getattr(task, "display_mode", "") or "").strip().lower()
        if display_mode == "scattered":
            # Normalize ref to ensure consistency
            tref = str(task.task_ref or "").strip().lower()
            return f"scattered_q:{tref}"
        return self._get_task_type(task.task_ref)

    def _break_monotony_runs(
        self,
        chunks: List[List[QueuedTask]],
        max_run: int,
    ) -> List[List[QueuedTask]]:
        """Перераспределяет chunks так, чтобы не было >max_run подряд с одним variety_key.

        Алгоритм: greedy — всегда берём тип с наибольшим остатком,
        избегая «заблокированного» ключа если хвост уже равен max_run.
        Работает на уровне chunks — связки (multi-task) никогда не разрываются.
        """
        if max_run <= 0 or len(chunks) <= 1:
            return chunks

        # Разбиваем по variety_key
        by_key: Dict[str, List[List[QueuedTask]]] = {}
        for chunk in chunks:
            k = self._chunk_variety_key(chunk)
            by_key.setdefault(k, []).append(chunk)

        if len(by_key) <= 1:
            return chunks  # Один тип — нечем перебивать, возвращаем как есть

        from collections import deque as _deque
        queues: Dict[str, Any] = {k: _deque(v) for k, v in by_key.items()}
        result: List[List[QueuedTask]] = []

        while any(queues.values()):
            # Определяем заблокированный ключ (последние max_run одинаковы)
            blocked_key: Optional[str] = None
            if len(result) >= max_run:
                tail_key = self._chunk_variety_key(result[-1])
                if all(
                    self._chunk_variety_key(result[-i - 1]) == tail_key
                    for i in range(max_run)
                ):
                    blocked_key = tail_key

            # Кандидаты: не заблокированные, с непустой очередью
            candidates = [
                (k, q) for k, q in queues.items() if q and k != blocked_key
            ]
            if not candidates:
                # Нет альтернатив — вынуждены взять заблокированный
                candidates = [(k, q) for k, q in queues.items() if q]

            if not candidates:
                break

            # Берём тип с наибольшим остатком (greedy)
            best_key = max(candidates, key=lambda kq: len(kq[1]))[0]
            result.append(queues[best_key].popleft())
            if not queues[best_key]:
                del queues[best_key]

        return result

    def _get_test_question_display_mode(self, complex_obj: Optional[Complex], task_ref: str) -> str:
        """
        Determines how test questions within a task should be displayed: 'together' or 'scattered'.
        Handles both dictionary and Pydantic model structures for settings.
        """
        if not complex_obj:
            return "together"

        # Normalize ref for search
        tref = str(task_ref or "").strip().lower()

        # 1. If task is in a chain, it is ALWAYS 'together'
        chains = getattr(complex_obj, "chains", None)
        if chains is None and isinstance(complex_obj, dict):
            chains = complex_obj.get("chains")

        if chains and tref in self._task_refs_in_chains(chains):
            return "together"

        # 2. Look in settings (test_question_display_modes)
        settings = getattr(complex_obj, "settings", None)
        if settings is None and isinstance(complex_obj, dict):
            settings = complex_obj.get("settings")

        modes = None
        if settings is not None:
            # Try attribute access (Pydantic/Object)
            modes = getattr(settings, "test_question_display_modes", None)
            # Try dictionary access
            if modes is None and isinstance(settings, dict):
                modes = settings.get("test_question_display_modes")
            # Fallback for complex models
            if modes is None and hasattr(settings, "dict"):
                try:
                    modes = settings.dict().get("test_question_display_modes")
                except Exception:
                    pass

        # 3. Robust lookup: modes can be a list of Pydantic models or a raw dict
        display_mode = "together"
        if isinstance(modes, list):
            for entry in modes:
                ref = ""
                mode_val = ""
                if hasattr(entry, "task_ref"):
                    ref = str(getattr(entry, "task_ref") or "").strip().lower()
                    mode_val = str(getattr(entry, "display_mode") or "").strip().lower()
                elif isinstance(entry, dict):
                    ref = str(entry.get("task_ref") or "").strip().lower()
                    mode_val = str(entry.get("display_mode") or "").strip().lower()
                
                if ref == tref:
                    display_mode = mode_val
                    break
        elif isinstance(modes, dict):
            # Case-insensitive search
            for k, v in modes.items():
                if str(k).strip().lower() == tref:
                    display_mode = str(v or "").strip().lower()
                    break

        # logger.info(f"[_get_test_question_display_mode] {task_ref} -> {display_mode}")
        return display_mode if display_mode in ("together", "scattered") else "together"

    def _get_test_question_count(self, task_ref: str) -> int:
        module_id, topic_id, task_id = self._split_task_ref(task_ref)
        if not module_id or not topic_id or not task_id or not self.storage_service:
            return 0
        try:
            task_data_full = self.storage_service.load_task(module_id, topic_id, task_id)
        except Exception:
            logger.exception("[_get_test_question_count] Failed to load task %s", task_ref)
            return 0
        task_data = task_data_full.get("task_data") if isinstance(task_data_full, dict) else None
        if not isinstance(task_data, dict):
            return 0
        content = task_data.get("content") if isinstance(task_data.get("content"), dict) else {}
        questions = content.get("questions") if isinstance(content.get("questions"), list) else task_data.get("questions")
        return len(questions) if isinstance(questions, list) else 0

    def _build_queued_tasks_for_complex_task(
        self,
        complex_obj: Optional[Complex],
        task_ref: str,
        difficulty: int,
        *,
        is_retry: bool = False,
        origin_iteration: Optional[int] = None,
        question_indices: Optional[List[int]] = None,
    ) -> List[QueuedTask]:
        task_type = self._get_task_type(task_ref)
        mode = self._get_test_question_display_mode(complex_obj, task_ref)
        if task_type == "test" and mode == "scattered":
            if question_indices is None:
                question_count = self._get_test_question_count(task_ref)
                indices = list(range(question_count))
            else:
                indices = []
                for value in question_indices:
                    try:
                        idx = int(value)
                    except Exception:
                        continue
                    if idx >= 0 and idx not in indices:
                        indices.append(idx)
            if indices:
                return [
                    QueuedTask(
                        task_ref=task_ref,
                        difficulty=difficulty,
                        is_retry=is_retry,
                        origin_iteration=origin_iteration,
                        display_mode="scattered",
                        source_task_ref=task_ref,
                        test_question_index=idx,
                    )
                    for idx in indices
                ]

        return [
            QueuedTask(
                task_ref=task_ref,
                difficulty=difficulty,
                is_retry=is_retry,
                origin_iteration=origin_iteration,
                display_mode="together" if task_type == "test" else None,
            )
        ]

    def _group_tasks_into_chunks(self, tasks: List[QueuedTask], chains: List[List[str]]) -> List[List[QueuedTask]]:
        """
        Группирует задания в блоки (chunks).
        Одиночные задания становятся блоком из 1 элемента.
        Сцепленные задания объединяются в один блок.
        
        Args:
            tasks: Список заданий для группировки
            chains: Список цепочек (списки task_ref)
            
        Returns:
            List[List[QueuedTask]]: Список блоков заданий
        """
        if not chains:
            return [[t] for t in tasks]
            
        # Map tasks by reference for quick access
        task_map_by_ref: Dict[str, List[QueuedTask]] = {}
        for t in tasks:
            if t.task_ref not in task_map_by_ref:
                task_map_by_ref[t.task_ref] = []
            task_map_by_ref[t.task_ref].append(t)
            
        # Track used task instances by object id to avoid hashing Pydantic models
        used_task_ids = set()
        chunks = []
        
        # Process chains first
        for chain in chains:
            chain_chunk = []
            # Для каждого ref в цепочке берем ВСЕ экземпляры этого задания из списка (если их несколько)
            # В обычной ситуации в генерации очереди дублей нет, но на всякий случай
            for ref in chain:
                if ref in task_map_by_ref:
                    # Проверяем, не использовали ли мы уже эти экземпляры (хотя это странно)
                    # Просто берем первый доступный экземпляр, если предполагается 1 к 1
                    # Но так как у нас список задач плоский, а chains - это абстракция...
                    # Допустим, мы берем первый попавшийся экземпляр этого таска
                    
                    # Нюанс: если задание повторяется в очереди (например из-за ретраев), 
                    # то сцепка должна работать для каждого вхождения? 
                    # ТЗ: "При перемешивании... порядок заданий внутри блока должен оставаться неизменным".
                    # Обычно генерация очереди (initial/next iteration) создает уникальные задания (по 1 шт).
                    # Поэтому берем available instances.
                    
                    available_instances = [t for t in task_map_by_ref[ref] if id(t) not in used_task_ids]
                    if available_instances:
                        # Берем один экземпляр
                        instance = available_instances[0]
                        chain_chunk.append(instance)
                        used_task_ids.add(id(instance)) # Mark SPECIFIC OBJECT as used
            
            if chain_chunk:
                chunks.append(chain_chunk)
        
        # Process remaining tasks
        for t in tasks:
            if id(t) not in used_task_ids:
                chunks.append([t])
                
        return chunks

    def _balance_chunks_by_type(
        self,
        chunks: List[List[QueuedTask]],
        seed_base: Optional[str],
        phase_id: int,
        max_run: int = 3,
    ) -> List[QueuedTask]:
        """
        Балансирует типы заданий внутри фазы используя round-robin распределение.

        Использует _chunk_variety_key вместо голого task_type, чтобы:
        - связки (chain) не сливались в серию одного типа;
        - scattered-вопросы не поглощали весь бюджет типа ``test``.

        После round-robin применяет _break_monotony_runs (anti-run защита).
        """
        if not chunks:
            return []

        # Группируем chunks по variety_key
        by_type: Dict[str, List[List[QueuedTask]]] = {}
        for chunk in chunks:
            if not chunk:
                continue
            vkey = self._chunk_variety_key(chunk)
            by_type.setdefault(vkey, []).append(chunk)

        # Изолированное перемешивание внутри каждой группы variety_key
        # Это гарантирует, что scattered-вопросы одного задания (и вообще задания одного типа)
        # будут изначально в случайном порядке, а не сгруппированы.
        for vkey, group_chunks in by_type.items():
            if seed_base:
                seed_material = f"{seed_base}:vkey:{vkey}:{phase_id}".encode("utf-8", errors="ignore")
                seed_int = int.from_bytes(hashlib.sha256(seed_material).digest()[:8], "big", signed=False)
                state = random.getstate()
                try:
                    random.seed(seed_int)
                    random.shuffle(group_chunks)
                finally:
                    random.setstate(state)
            else:
                random.shuffle(group_chunks)

        # Если только один variety_key — просто возвращаем группу (она уже перемешана)
        if len(by_type) <= 1:
            result = []
            for chunk in (list(by_type.values())[0] if by_type else []):
                result.extend(chunk)
            return result

        # Round-robin распределение по variety_key
        max_len = max(len(v) for v in by_type.values())
        sorted_types = sorted(by_type.keys())

        distributed: List[List[QueuedTask]] = []
        for i in range(max_len):
            for vkey in sorted_types:
                if i < len(by_type[vkey]):
                    distributed.append(by_type[vkey][i])

        # Лёгкий shuffle в окнах для непредсказуемости
        window_size = 3
        if seed_base:
            seed_material = f"{seed_base}:phase:{phase_id}:window".encode("utf-8", errors="ignore")
            seed_int = int.from_bytes(hashlib.sha256(seed_material).digest()[:8], "big", signed=False)
            state = random.getstate()
            try:
                random.seed(seed_int)
                for i in range(0, len(distributed), window_size):
                    window = distributed[i:i + window_size]
                    random.shuffle(window)
                    distributed[i:i + window_size] = window
            finally:
                random.setstate(state)
        else:
            for i in range(0, len(distributed), window_size):
                window = distributed[i:i + window_size]
                random.shuffle(window)
                distributed[i:i + window_size] = window

        # Anti-run: гарантируем не более max_run одного variety_key подряд
        if max_run > 0:
            distributed = self._break_monotony_runs(distributed, max_run)

        # Flatten chunks в плоский список
        result = []
        for chunk in distributed:
            result.extend(chunk)

        logger.info(
            "[_balance_chunks_by_type] Phase %s: %s tasks, variety_keys: %s",
            phase_id,
            len(result),
            sorted_types,
        )
        if len(result) > 0:
            logger.info(f"[_balance_chunks_by_type] First 10 task types: {[self._chunk_variety_key([t]) for t in result[:10]]}")
            
        return result

    def _sort_chunks_by_phase(
        self,
        chunks: List[List[QueuedTask]],
        seed_base: Optional[str] = None,
        max_same_type_run: int = 3,
    ) -> List[QueuedTask]:
        """
        Сортирует блоки по фазам (0 -> 1 -> 2).
        Внутри фазы блоки балансируются по variety_key с anti-run защитой.

        Args:
            chunks: Список блоков заданий
            seed_base: Seed для детерминированности
            max_same_type_run: Максимум подряд идущих chunks одного variety_key
        """
        phase_groups: Dict[int, List[List[QueuedTask]]] = {0: [], 1: [], 2: []}

        for chunk in chunks:
            if not chunk:
                continue
            first_task = chunk[0]
            task_type = self._get_task_type(first_task.task_ref)
            phase = self._get_task_phase(task_type, first_task.difficulty, first_task.task_ref)
            if phase not in phase_groups:
                phase = 1
            phase_groups[phase].append(chunk)

        final_queue: List[QueuedTask] = []
        for phase_id in sorted(phase_groups.keys()):
            balanced = self._balance_chunks_by_type(
                phase_groups[phase_id],
                seed_base,
                phase_id,
                max_run=max_same_type_run,
            )
            final_queue.extend(balanced)

        return final_queue
    
    def _generate_initial_queue(
        self,
        session: ComplexSession,
        complex_obj: Complex,
        target_iteration: int = 1
    ) -> None:
        logger.info(
            "[_generate_initial_queue] session_id=%s complex_id=%s target_iteration=%s",
            session.id,
            complex_obj.id if complex_obj else None,
            target_iteration,
        )
        queue = []
        error_detection_only = True

        settings = complex_obj.settings
        adaptive_enabled = settings.adaptive_difficulty if settings else True
        planned_final_iteration = self._get_planned_final_iteration(session, complex_obj)
        absolute_iteration_level = self._get_absolute_iteration_level(session, complex_obj, target_iteration)

        logger.info(f"[_generate_initial_queue] Generating queue for iteration {target_iteration}")
        logger.info(
            "[_generate_initial_queue] planned_final_iteration=%s absolute_iteration_level=%s",
            planned_final_iteration,
            absolute_iteration_level,
        )

        for task_ref in complex_obj.tasks:
            # Проверяем, не в broken_tasks ли уже
            if task_ref in session.broken_tasks:
                continue

            # Проверяем физическое наличие файла task.json
            if not self._check_task_file_exists(task_ref):
                logger.warning(f"Task file not found: {task_ref}, adding to broken_tasks")
                session.broken_tasks.append(task_ref)
                continue

            task_metadata = self._load_task_metadata(task_ref)
            is_error_detection = self._is_error_detection_metadata(task_metadata)
            if is_error_detection and task_ref not in session.error_detection_tasks:
                session.error_detection_tasks.append(task_ref)

            if is_error_detection:
                if target_iteration < planned_final_iteration:
                    logger.info(
                        f"[_generate_initial_queue] Error_detection {task_ref} отложен до "
                        f"финальной плановой итерации {planned_final_iteration}"
                    )
                    continue

                # Если дошли сюда - включаем error_detection в финальную плановую итерацию
                logger.info(
                    f"[_generate_initial_queue] Error_detection {task_ref} активирован на итерации {target_iteration}"
                )
                if task_ref in session.error_detection_tasks:
                    session.error_detection_tasks.remove(task_ref)
            else:
                error_detection_only = False

            # Определяем сложность задания.
            # Для error_detection всегда используем "финальный" уровень,
            # чтобы подтип работал как одноразовый финишер без повторной эскалации.
            task_type = self._get_task_type(task_ref)
            available_levels = self.difficulty_manager.get_available_levels(task_type, task_ref)
            if not is_error_detection and not self._task_participates_in_absolute_level(
                task_type,
                task_ref,
                absolute_iteration_level,
                is_error_detection=False,
                available_levels=available_levels,
            ):
                logger.info(
                    "[_generate_initial_queue] %s пропущено на итерации %s: абсолютный уровень %s не разрешён (%s)",
                    task_ref,
                    target_iteration,
                    absolute_iteration_level,
                    available_levels,
                )
                continue
            if is_error_detection:
                difficulty = self._get_iteration_target_difficulty(
                    task_type,
                    task_ref,
                    target_iteration,
                    session,
                    complex_obj,
                    is_error_detection=True,
                )
            else:
                difficulty = self._get_iteration_target_difficulty(
                    task_type,
                    task_ref,
                    target_iteration,
                    session,
                    complex_obj,
                    is_error_detection=False,
                )
            if difficulty is None:
                logger.info(
                    "[_generate_initial_queue] %s пропущено: для итерации %s нет абсолютного уровня",
                    task_ref,
                    target_iteration,
                )
                continue

            # Создаем QueuedTask
            queued_task = QueuedTask(
                task_ref=task_ref,
                difficulty=difficulty,
                is_retry=False,
                origin_iteration=None,  # Начальная очередь не имеет origin_iteration в контексте повторов
            )
            queue.extend(
                self._build_queued_tasks_for_complex_task(
                    complex_obj,
                    task_ref,
                    difficulty,
                    is_retry=False,
                    origin_iteration=None,
                )
            )

            # Предварительно загружаем метаданные для кэша
            self._get_task_type(task_ref)

        # Если очередь пуста, но в комплексе остались только error_detection задания,
        # разрешаем их ранний старт, чтобы сессия не завершалась мгновенно.
        if (
            not queue
            and error_detection_only
            and session.error_detection_tasks
            and target_iteration >= planned_final_iteration
        ):
            logger.info(
                "[_generate_initial_queue] Все задания error_detection — активируем на финальной итерации %s",
                target_iteration,
            )
            for task_ref in list(session.error_detection_tasks):
                queue.append(
                    QueuedTask(
                        task_ref=task_ref,
                        difficulty=self._get_error_detection_finisher_level(),
                        is_retry=False,
                        origin_iteration=None,
                    )
                )
            # Эти задания больше не считаем отложенными
            session.error_detection_tasks.clear()

        # Валидация пустой очереди
        if not queue:
            # Сценарий 1: Все файлы битые
            if complex_obj.tasks and all(t in session.broken_tasks for t in complex_obj.tasks):
                error_msg = (
                    f"Невозможно запустить комплекс '{complex_obj.name}': "
                    f"все задания ({len(complex_obj.tasks)}) недоступны. "
                    f"Проверьте, что файлы заданий существуют."
                )
                logger.error(f"[_generate_initial_queue] {error_msg}")
                logger.error(f"[_generate_initial_queue] Битые задания: {session.broken_tasks}")
                raise ValueError(error_msg)
            
            # Сценарий 2: Пустой комплекс
            elif not complex_obj.tasks:
                error_msg = (
                    f"Комплекс '{complex_obj.name}' не содержит заданий. "
                    f"Добавьте задания через редактор."
                )
                logger.error(f"[_generate_initial_queue] {error_msg}")
                raise ValueError(error_msg)
            
            # Сценарий 3: Неизвестная причина (логируем для отладки)
            else:
                logger.warning(
                    f"[_generate_initial_queue] Пустая очередь для итерации {target_iteration}. "
                    f"Комплекс: '{complex_obj.name}', всего заданий: {len(complex_obj.tasks)}, "
                    f"битых: {len(session.broken_tasks)}, error_detection: {len(session.error_detection_tasks)}"
                )

        # Перемешиваем очередь с учетом фаз и цепочек (вместо random.shuffle)
        max_run = int(getattr(getattr(complex_obj, "settings", None), "max_same_type_run", 3) or 3)
        chunks = self._group_tasks_into_chunks(queue, complex_obj.chains)
        session.queue = self._sort_chunks_by_phase(
            chunks,
            seed_base=f"{session.id}:{target_iteration}",
            max_same_type_run=max_run,
        )

        session.current_task_index = 0

        logger.info(f"Generated initial queue for iteration {target_iteration} with {len(queue)} tasks (broken: {len(session.broken_tasks)})")
        logger.info(
            "[_generate_initial_queue] queue=%s",
            [q.task_ref for q in session.queue] if session.queue else [],
        )
    
    def _generate_next_iteration(self, session: ComplexSession, complex_obj: Complex) -> None:
        """
        Генерирует очередь для следующей итерации на основе completed_tasks текущей итерации.
        
        Анализирует completed_tasks с фильтром iteration_index == session.iteration.
        """
        logger.info(
            f"[_generate_next_iteration] ========== НАЧАЛО ГЕНЕРАЦИИ СЛЕДУЮЩЕЙ ИТЕРАЦИИ =========="
        )
        logger.info(
            f"[_generate_next_iteration] session_id={session.id}, complex_id={session.complex_id}, user_id={session.user_id}"
        )
        logger.info(
            f"[_generate_next_iteration] Текущая итерация: {session.iteration}, "
            f"всего completed_tasks: {len(session.completed_tasks)}, "
            f"broken_tasks: {len(session.broken_tasks)}, "
            f"current_task_index: {session.current_task_index}, "
            f"queue_length: {len(session.queue) if session.queue else 0}"
        )
        
        # Сохраняем старые значения для логирования
        old_iteration = session.iteration
        old_queue_length = len(session.queue) if session.queue else 0
        
        # Проверяем настройки комплекса
        settings = complex_obj.settings
        adaptive_enabled = settings.adaptive_difficulty if settings else True
        escalation_enabled = settings.escalation_on_success if settings else True
        
        logger.info(
            f"[_generate_next_iteration] Настройки комплекса: "
            f"adaptive_difficulty={adaptive_enabled}, escalation_on_success={escalation_enabled}"
        )

        max_iterations = None
        try:
            max_iterations = int(getattr(settings, "max_iterations", 0) or 0)
        except Exception:
            max_iterations = 0

        upcoming_iteration = int(getattr(session, "iteration", 0) or 0) + 1
        planned_final_iteration = self._get_planned_final_iteration(session, complex_obj)
        full_replay_iteration = upcoming_iteration <= planned_final_iteration
        upcoming_absolute_level = self._get_absolute_iteration_level(session, complex_obj, upcoming_iteration)
        current_iteration_expected_refs = {
            queued_task.task_ref
            for queued_task in (session.queue or [])
            if getattr(queued_task, "task_ref", None)
        }
        if max_iterations > 0 and upcoming_iteration > max_iterations:
            logger.info(
                f"[_generate_next_iteration] Достигнут лимит итераций: current={session.iteration}, "
                f"upcoming={upcoming_iteration}, max_iterations={max_iterations}. Очищаем очередь без генерации."
            )
            session.queue = []
            session.current_task_index = 0
            session.skip_counts = {}
            return
        
        # Завершаем текущую итерацию (записываем end_time)
        current_iteration = session.iteration
        if current_iteration > 0:
            if current_iteration not in session.iteration_timestamps:
                session.iteration_timestamps[current_iteration] = {}
            session.iteration_timestamps[current_iteration]['end'] = datetime.utcnow()
            logger.info(
                f"[_generate_next_iteration] Итерация {current_iteration} завершена в "
                f"{session.iteration_timestamps[current_iteration]['end']}"
            )
        
        # Фильтруем результаты текущей итерации
        current_iteration_results = [
            result for result in session.completed_tasks
            if result.iteration_index == session.iteration
        ]
        
        logger.info(
            f"[_generate_next_iteration] Фильтрация результатов для итерации {session.iteration}: "
            f"найдено {len(current_iteration_results)} результатов из {len(session.completed_tasks)} общих"
        )
        logger.info(
            "[_generate_next_iteration] planned_final_iteration=%s full_replay_iteration=%s upcoming_absolute_level=%s",
            planned_final_iteration,
            full_replay_iteration,
            upcoming_absolute_level,
        )
        
        # Логируем детали результатов текущей итерации
        if current_iteration_results:
            successful_results = [r for r in current_iteration_results if r.success]
            failed_results = [r for r in current_iteration_results if not r.success]
            logger.debug(
                f"[_generate_next_iteration] Детали результатов: успешных={len(successful_results)}, "
                f"с ошибками={len(failed_results)}"
            )
            for idx, result in enumerate(current_iteration_results):
                logger.debug(
                    f"[_generate_next_iteration] Результат {idx+1}: task_ref={result.task_ref}, "
                    f"success={result.success}, difficulty={result.difficulty}, "
                    f"time_spent={result.time_spent}"
                )
        
        if not current_iteration_results:
            logger.warning(
                f"[_generate_next_iteration] Нет результатов для итерации {session.iteration}, "
                f"следующая итерация будет пустой"
            )
        
        # Собираем последние результаты текущей итерации по каждому заданию
        results_by_task: Dict[str, List[SessionTaskResult]] = {}
        for result in current_iteration_results:
            results_by_task.setdefault(result.task_ref, []).append(result)

        last_result_by_task: Dict[str, SessionTaskResult] = {}
        for task_ref_key, task_results in results_by_task.items():
            scattered_results = [
                result
                for result in task_results
                if isinstance(getattr(result, "details", None), dict)
                and result.details.get("test_display_mode") == "scattered"
            ]
            if scattered_results:
                all_success = all(bool(result.success) for result in scattered_results)
                latest_result = scattered_results[-1]
                score_values = [
                    float(result.score)
                    for result in scattered_results
                    if isinstance(result.score, (int, float))
                ]
                last_result_by_task[task_ref_key] = SessionTaskResult(
                    task_ref=task_ref_key,
                    success=all_success,
                    score=(sum(score_values) / len(score_values)) if score_values else latest_result.score,
                    time_spent=sum(int(getattr(result, "time_spent", 0) or 0) for result in scattered_results),
                    difficulty=latest_result.difficulty,
                    iteration_index=latest_result.iteration_index,
                    timestamp=latest_result.timestamp,
                    details=dict(latest_result.details or {}),
                )
            else:
                last_result_by_task[task_ref_key] = task_results[-1]
        
        new_queue = []
        successful_count = 0
        failed_count = 0
        all_at_max_difficulty = True  # Флаг для проверки завершения комплекса
        total_tasks = len([t for t in complex_obj.tasks if t not in session.broken_tasks])
        completed_all_tasks = True  # Будет сброшен, если есть задания без результата в итерации
        
        # Каждая новая итерация должна содержать все задания комплекса (кроме битых)
        for task_ref in complex_obj.tasks:
            if task_ref in session.broken_tasks:
                logger.debug(f"[_generate_next_iteration] Пропуск битого задания: {task_ref}")
                continue
            
            task_metadata = self._load_task_metadata(task_ref)
            is_error_detection = self._is_error_detection_metadata(task_metadata)
            if is_error_detection:
                if task_ref not in session.error_detection_tasks:
                    session.error_detection_tasks.append(task_ref)

                if upcoming_iteration < planned_final_iteration:
                    logger.info(
                        f"[_generate_next_iteration] Error_detection {task_ref} отложен до "
                        f"финальной плановой итерации {planned_final_iteration}"
                    )
                    continue

                # Если дошли сюда - включаем error_detection начиная с финальной плановой итерации
                logger.info(
                    f"[_generate_next_iteration] Error_detection {task_ref} активирован на итерации {upcoming_iteration}"
                )
            
            # Определяем последний результат (в текущей итерации или в истории) и уровень сложности
            current_result = last_result_by_task.get(task_ref)
            history_result: Optional[SessionTaskResult] = None
            missing_current_result = False
            if not current_result:
                history_results = [r for r in session.completed_tasks if r.task_ref == task_ref]
                history_result = history_results[-1] if history_results else None
                missing_current_result = True
            
            # Получаем task_type и доступные уровни
            task_type = self._get_task_type(task_ref)
            available_levels = self.difficulty_manager.get_available_levels(task_type, task_ref)
            max_available_level = self._get_task_max_level(task_type, task_ref)
            expected_in_current_iteration = task_ref in current_iteration_expected_refs
            
            latest_result = current_result or history_result
            current_level = (
                latest_result.difficulty
                if latest_result
                else self._normalize_level_for_available(1, available_levels)
            )
            latest_success = latest_result.success if latest_result else False
            success_in_iteration = current_result.success if current_result else False

            if not latest_result or not latest_success or current_level < max_available_level:
                all_at_max_difficulty = False

            if missing_current_result:
                if expected_in_current_iteration and not (latest_result and latest_success and current_level >= max_available_level):
                    completed_all_tasks = False
            
            # Эскалация только при успехе
            should_escalate = adaptive_enabled and escalation_enabled and success_in_iteration and current_level < max_available_level
            new_difficulty = (
                self._next_level_for_available(current_level, available_levels)
                if should_escalate
                else self._normalize_level_for_available(current_level, available_levels)
            )
            
            # Статистика по текущей итерации
            if current_result:
                if success_in_iteration:
                    successful_count += 1
                else:
                    failed_count += 1
            
            task_completed_at_max = latest_success and current_level >= max_available_level

            if is_error_detection:
                # Для error_detection не держим задание в deferred-списке после успешного
                # прохождения на максимальном уровне, иначе оно может бесконечно возвращаться.
                if task_completed_at_max:
                    if task_ref in session.error_detection_tasks:
                        session.error_detection_tasks.remove(task_ref)
                    logger.info(
                        f"[_generate_next_iteration] {task_ref} (error_detection) уже завершено на финальном уровне"
                    )
                    continue

                # Для error_detection не используем пошаговую эскалацию (1 -> 2 -> ...):
                # ставим сразу финальный уровень как финишер.
                if task_ref in session.error_detection_tasks:
                    session.error_detection_tasks.remove(task_ref)
                if full_replay_iteration or not task_completed_at_max:
                    finisher_level = self._get_error_detection_finisher_level()
                    new_queue.append(QueuedTask(
                        task_ref=task_ref,
                        difficulty=finisher_level,
                        is_retry=False,
                        origin_iteration=None
                    ))
                    logger.info(
                        f"[_generate_next_iteration] Добавлено error_detection {task_ref} "
                        f"на финальном уровне {finisher_level}"
                    )
                continue

            if full_replay_iteration:
                if not self._task_participates_in_absolute_level(
                    task_type,
                    task_ref,
                    upcoming_absolute_level,
                    is_error_detection=False,
                    available_levels=available_levels,
                ):
                    logger.info(
                        "[_generate_next_iteration] %s пропущено на видимой итерации %s: абсолютный уровень %s не разрешён (%s)",
                        task_ref,
                        upcoming_iteration,
                        upcoming_absolute_level,
                        available_levels,
                    )
                    continue
                target_difficulty = self._get_iteration_target_difficulty(
                    task_type,
                    task_ref,
                    upcoming_iteration,
                    session,
                    complex_obj,
                    is_error_detection=False,
                )
                if target_difficulty is None:
                    logger.info(
                        "[_generate_next_iteration] %s пропущено: для итерации %s нет абсолютного уровня",
                        task_ref,
                        upcoming_iteration,
                    )
                    continue
                new_queue.extend(
                    self._build_queued_tasks_for_complex_task(
                        complex_obj,
                        task_ref,
                        target_difficulty,
                        is_retry=False,
                        origin_iteration=None,
                    )
                )
                logger.info(
                    f"[_generate_next_iteration] Повторно добавлено задание {task_ref} "
                    f"для плановой итерации {upcoming_iteration}: "
                    f"уровень {current_level} -> {target_difficulty}, "
                    f"max_available={max_available_level}"
                )
            elif not task_completed_at_max:
                # Добавляем задание в новую очередь
                new_queue.extend(
                    self._build_queued_tasks_for_complex_task(
                        complex_obj,
                        task_ref,
                        new_difficulty,
                        is_retry=False,
                        origin_iteration=None,
                    )
                )
                logger.info(
                    f"[_generate_next_iteration] Добавлено задание {task_ref}: "
                    f"{'success' if success_in_iteration else 'fail/absent'}, "
                    f"уровень {current_level} -> {new_difficulty}, "
                    f"max_available={max_available_level}"
                )
            else:
                logger.info(
                    f"[_generate_next_iteration] {task_ref} достиг максимальной сложности и не будет добавлено в очередь"
                )
        
        if upcoming_absolute_level == self._get_error_detection_finisher_level() and session.error_detection_tasks:
            logger.info(
                f"[_generate_next_iteration] Проверяем deferred error_detection задания: "
                f"{len(session.error_detection_tasks)} шт."
            )
            for task_ref in list(session.error_detection_tasks):
                if task_ref in session.broken_tasks:
                    continue
                if not self._all_other_tasks_at_max(session, complex_obj, task_ref):
                    logger.info(
                        f"[_generate_next_iteration] {task_ref} остаётся отложенным — "
                        f"не все задания достигли максимальной сложности"
                    )
                    continue

                task_type = self._get_task_type(task_ref)
                finisher_level = self._get_error_detection_finisher_level()

                new_queue.append(
                    QueuedTask(
                        task_ref=task_ref,
                        difficulty=finisher_level,
                        is_retry=False,
                        origin_iteration=None,
                    )
                )
                session.error_detection_tasks.remove(task_ref)
                logger.info(
                    f"[_generate_next_iteration] Добавлено error_detection задание {task_ref} "
                    f"на уровне {finisher_level}"
                )

        # ИСПРАВЛЕНИЕ: Проверяем, нужно ли завершить комплекс
        # Комплекс завершается только если:
        # - Есть результаты по всем заданиям итерации (completed_all_tasks)
        # - Все задания (без битых) успешны и на максимальной сложности
        should_complete_complex = (
            completed_all_tasks
            and all_at_max_difficulty
            and successful_count > 0
            and failed_count == 0
            and len(current_iteration_results) > 0
            and not new_queue  # если есть задания для следующей итерации, продолжаем
        )
        
        if should_complete_complex:
            logger.info(
                f"[_generate_next_iteration] Все задания выполнены на максимальной сложности. "
                f"Завершаем комплекс. Успешных: {successful_count}, с ошибками: {failed_count}"
            )
            # Не создаем новую очередь - сессия будет завершена
            # Помечаем сессию для завершения
            session._should_show_final_results = True
            session.queue = []  # Пустая очередь означает завершение
            session.iteration += 1
            session.current_task_index = 0
            session.skip_counts = {}  # Сброс счётчиков пропусков для новой итерации
            
            # Инициализируем timestamps для новой итерации (даже если она пустая)
            session.iteration_timestamps[session.iteration] = {
                'start': datetime.utcnow(),
                'end': None
            }
        else:
            # Перемешиваем очередь с учетом фаз и цепочек (вместо random.shuffle)
            chunks = self._group_tasks_into_chunks(new_queue, complex_obj.chains)
            session.queue = self._sort_chunks_by_phase(chunks, seed_base=f"{session.id}:{upcoming_iteration}")
            
            # Обновляем сессию
            session.iteration += 1
            session.current_task_index = 0
            session.skip_counts = {}  # Сброс счётчиков пропусков для новой итерации
            
            # Инициализируем timestamps для новой итерации
            session.iteration_timestamps[session.iteration] = {
                'start': datetime.utcnow(),
                'end': None
            }
            logger.info(
                f"[_generate_next_iteration] Итерация {session.iteration} начата в "
                f"{session.iteration_timestamps[session.iteration]['start']}"
            )
        
        logger.info(
            f"[_generate_next_iteration] ========== ГЕНЕРАЦИЯ ЗАВЕРШЕНА =========="
        )
        if should_complete_complex:
            logger.info(
                f"[_generate_next_iteration] Комплекс завершен: все задания выполнены на максимальной сложности. "
                f"Очередь пуста, сессия будет завершена."
            )
        else:
            logger.info(
                f"[_generate_next_iteration] Итерация {old_iteration} -> {session.iteration}: "
                f"создана очередь из {len(new_queue)} заданий "
                f"(из {len(current_iteration_results)} завершенных заданий: "
                f"успешных={successful_count}, с ошибками={failed_count})"
            )
            logger.info(
                f"[_generate_next_iteration] Состояние сессии обновлено: "
                f"old_queue_length={old_queue_length}, new_queue_length={len(new_queue)}, "
                f"current_task_index={session.current_task_index}"
            )
        
        if not new_queue:
            logger.warning(
                f"[_generate_next_iteration] ВНИМАНИЕ: Очередь следующей итерации пуста! "
                f"Сессия будет завершена при следующем вызове get_next_task()"
            )
        else:
            logger.debug(
                f"[_generate_next_iteration] Состав очереди следующей итерации: "
                f"{[(q.task_ref, q.difficulty, 'retry' if q.is_retry else 'new') for q in new_queue[:5]]}"
                + (f" ... и еще {len(new_queue) - 5}" if len(new_queue) > 5 else "")
            )
    
    def _check_task_file_exists(self, task_ref: str) -> bool:
        """
        Проверяет физическое наличие файла task.json для задания.
        
        Args:
            task_ref: Ссылка на задание (module/topic/task)
            
        Returns:
            bool: True если файл существует
        """
        if not self.storage_service:
            # Если StorageService не доступен, пытаемся получить data_dir из конфига
            try:
                from common.config_loader import load_config
                config = load_config()
                data_dir = Path(config.get("data_root", "data"))
                
                parts = task_ref.split('/')
                if len(parts) >= 3:
                    module_id, topic_id, task_id = parts[0], parts[1], parts[-1]
                    # Стандартный путь
                    task_path = data_dir / "modules" / module_id / "topics" / topic_id / "tasks" / task_id / "task.json"
                    return task_path.exists()
            except Exception as e:
                logger.warning(f"Error checking task file existence for {task_ref}: {e}")
                return False
            return False
        
        try:
            parts = task_ref.split('/')
            if len(parts) >= 3:
                module_id, topic_id, task_id = parts[0], parts[1], parts[-1]
                
                # Пробуем загрузить задание через StorageService
                task_data = self.storage_service.load_task(module_id, topic_id, task_id)
                return task_data is not None
        except Exception as e:
            logger.warning(f"Error checking task file existence for {task_ref}: {e}")
            return False
        
        return False
    
    def _get_task_type(self, task_ref: str) -> str:
        """
        Получает task_type из кэша или загружает через StorageService.
        """
        task_ref = str(task_ref or "").strip()
        if not task_ref:
            return "unknown"

        # Проверяем кэш
        # ИСПРАВЛЕНИЕ: Если в кэше "unknown", пытаемся переопределить тип
        if task_ref in self.task_meta_cache:
            cached_type = self.task_meta_cache[task_ref]
            # Если тип "unknown", пытаемся переопределить его
            if cached_type != 'unknown':
                logger.debug(f"[_get_task_type] Используем кэшированный тип для {task_ref}: {cached_type}")
                return cached_type
            else:
                logger.debug(f"[_get_task_type] В кэше 'unknown' для {task_ref}, пытаемся переопределить")
        
        # Загружаем через StorageService
        task_type = "unknown"
        
        if self.storage_service:
            try:
                parts = task_ref.split('/')
                if len(parts) >= 3:
                    module_id, topic_id, task_id = parts[0], parts[1], parts[-1]
                    
                    # Загружаем задание для получения типа
                    task_data = self.storage_service.load_task(module_id, topic_id, task_id)
                    if not task_data:
                        logger.warning(f"[_get_task_type] Не удалось загрузить задание {task_ref}")
                    else:
                        logger.debug(f"[_get_task_type] Загружены данные для {task_ref}, ключи: {list(task_data.keys())}")
                        
                        # Приоритет 1: Проверяем metadata['type'] (из module.json)
                        if 'metadata' in task_data:
                            metadata = task_data['metadata']
                            if isinstance(metadata, dict):
                                metadata_type = metadata.get('type')
                                if metadata_type and metadata_type != 'unknown':
                                    task_type = metadata_type
                                    logger.debug(f"[_get_task_type] Тип найден в metadata для {task_ref}: {task_type}")
                        
                        # Приоритет 2: Проверяем task_data['task_data']['type']
                        if task_type == 'unknown' and 'task_data' in task_data:
                            task_data_obj = task_data['task_data']
                            if isinstance(task_data_obj, dict):
                                # Проверяем прямой тип
                                direct_type = task_data_obj.get('type')
                                if direct_type and direct_type != 'unknown':
                                    task_type = direct_type
                                    logger.debug(f"[_get_task_type] Тип найден в task_data['type'] для {task_ref}: {task_type}")
                                
                                # Если не найден, проверяем _original_type (для модифицированных заданий)
                                if task_type == 'unknown':
                                    original_type = task_data_obj.get('_original_type')
                                    if original_type and original_type != 'unknown':
                                        task_type = original_type
                                        logger.debug(f"[_get_task_type] Тип найден в _original_type для {task_ref}: {task_type}")
                                
                                # Если все еще unknown, проверяем в content
                                if task_type == 'unknown' and 'content' in task_data_obj:
                                    content = task_data_obj['content']
                                    if isinstance(content, dict):
                                        content_type = content.get('type')
                                        if content_type and content_type != 'unknown':
                                            task_type = content_type
                                            logger.debug(f"[_get_task_type] Тип найден в task_data['content']['type'] для {task_ref}: {task_type}")
                        
                        # Приоритет 3: Если все еще unknown, проверяем корневой уровень task_data
                        if task_type == 'unknown' and isinstance(task_data, dict):
                            root_type = task_data.get('type')
                            if root_type and root_type != 'unknown':
                                task_type = root_type
                                logger.debug(f"[_get_task_type] Тип найден в корневом уровне для {task_ref}: {task_type}")
                            
                            # Проверяем в content корневого уровня
                            if task_type == 'unknown' and 'content' in task_data:
                                content = task_data['content']
                                if isinstance(content, dict):
                                    content_type = content.get('type')
                                    if content_type and content_type != 'unknown':
                                        task_type = content_type
                                        logger.debug(f"[_get_task_type] Тип найден в корневом content['type'] для {task_ref}: {task_type}")
                        
                        # Логируем результат для отладки
                        if task_type != 'unknown':
                            logger.info(f"[_get_task_type] ✓ Определен тип задания {task_ref}: {task_type}")
                        else:
                            logger.warning(
                                f"[_get_task_type] ✗ Не удалось определить тип задания {task_ref}, используется 'unknown'. "
                                f"Структура данных: keys={list(task_data.keys()) if task_data else 'None'}, "
                                f"task_data keys={list(task_data.get('task_data', {}).keys()) if task_data.get('task_data') else 'None'}"
                            )
            except Exception as e:
                logger.error(f"[_get_task_type] Ошибка при получении типа задания {task_ref}: {e}", exc_info=True)
        
        # ИСПРАВЛЕНИЕ: Обновляем кэш только если тип не "unknown" или если в кэше уже был "unknown"
        # Это позволяет обновить кэш, если тип был определен позже
        if task_type != 'unknown' or (task_ref in self.task_meta_cache and self.task_meta_cache[task_ref] == 'unknown'):
            old_cached = self.task_meta_cache.get(task_ref, 'not_cached')
            self.task_meta_cache[task_ref] = task_type
            if old_cached == 'unknown' and task_type != 'unknown':
                logger.info(f"[_get_task_type] ✓ Обновлен кэш типа задания {task_ref}: unknown -> {task_type}")
        
        return task_type
    
    def _generate_session_summary(self, session: ComplexSession) -> ExtendedSessionResultSummary:
        """
        Генерирует ExtendedSessionResultSummary на основе завершенной сессии.
        
        Args:
            session: Завершенная сессия
            
        Returns:
            ExtendedSessionResultSummary
        """
        # Подсчитываем tasks_mastered_count
        # Задание считается освоенным, если последняя успешная попытка была на max_available_level
        # Для каждого уникального task_ref находим последнюю успешную попытку
        task_last_successful_attempt = {}  # task_ref -> SessionTaskResult
        
        for result in session.completed_tasks:
            task_ref = result.task_ref
            # Ищем только успешные попытки
            if result.success:
                # Обновляем последнюю успешную попытку (completed_tasks уже отсортированы по времени)
                if task_ref not in task_last_successful_attempt or result.timestamp > task_last_successful_attempt[task_ref].timestamp:
                    task_last_successful_attempt[task_ref] = result
        
        mastered_tasks = set()
        for task_ref, last_successful_result in task_last_successful_attempt.items():
            # Проверяем, что difficulty == max_available_level для этого задания
            task_type = self._get_task_type(task_ref)
            available_levels = self.difficulty_manager.get_available_levels(task_type, task_ref)
            max_available_level = max(available_levels) if available_levels else 1
            
            if last_successful_result.difficulty == max_available_level:
                # Последняя успешная попытка была на максимальном доступном уровне
                mastered_tasks.add(task_ref)
        
        tasks_mastered_count = len(mastered_tasks)
        
        # Подсчитываем tasks_failed_count
        failed_tasks = set()
        for result in session.completed_tasks:
            if not result.success:
                failed_tasks.add(result.task_ref)
        
        tasks_failed_count = len(failed_tasks)
        
        # Вычисляем difficulty_progression (средняя сложность по итерациям)
        # Сгруппировать completed_tasks по iteration_index
        # Для каждой итерации вычислить среднее значение difficulty
        # Вернуть массив [avg_diff_iter_1, avg_diff_iter_2, ...]
        difficulty_progression = []
        
        # ИСПРАВЛЕНИЕ: Находим максимальный номер завершенной итерации из completed_tasks
        max_completed_iteration = 0
        if session.completed_tasks:
            max_completed_iteration = max(result.iteration_index for result in session.completed_tasks)
        
        # Вычисляем среднюю сложность для каждой завершенной итерации
        for iteration in range(1, max_completed_iteration + 1):
            iteration_results = [
                r for r in session.completed_tasks
                if r.iteration_index == iteration
            ]
            
            if iteration_results:
                avg_difficulty = sum(r.difficulty for r in iteration_results) / len(iteration_results)
                difficulty_progression.append(avg_difficulty)
            else:
                # Если для итерации нет результатов, добавляем 0.0
                difficulty_progression.append(0.0)
        
        # Вычисляем duration_seconds (вычитаем суммарное время пауз)
        if session.end_time and session.start_time:
            raw_duration = (session.end_time - session.start_time).total_seconds()
            pause_secs = session.total_pause_seconds or 0.0
            duration_seconds = max(0, int(raw_duration - pause_secs))
        else:
            duration_seconds = 0
        
        # Подсчитываем total_tasks и successful_tasks_count (исключая skipped)
        total_tasks = len(session.completed_tasks)
        successful_tasks_count = 0
        
        for result in session.completed_tasks:
            # Исключаем записи с details.status == 'skipped'
            if result.details.get('status') == 'skipped':
                continue
            if result.success:
                successful_tasks_count += 1
        
        # ИСПРАВЛЕНИЕ: Подсчитываем количество завершенных итераций, а не текущий номер итерации
        # Находим максимальное значение iteration_index в completed_tasks - это и есть количество завершенных итераций
        completed_iterations = 0
        if session.completed_tasks:
            completed_iterations = max(result.iteration_index for result in session.completed_tasks)
        
        # Вычисляем длительность каждой итерации
        iteration_durations = []
        for iteration in range(1, max_completed_iteration + 1):
            if iteration in session.iteration_timestamps:
                ts = session.iteration_timestamps[iteration]
                if ts.get('start') and ts.get('end'):
                    iter_duration = (ts['end'] - ts['start']).total_seconds()
                    iteration_durations.append(iter_duration)
                else:
                    # Итерация начата, но не завершена
                    iteration_durations.append(None)
            else:
                # Нет данных о timestamps для этой итерации
                iteration_durations.append(None)
        
        summary = ExtendedSessionResultSummary(
            session_id=session.id,
            complex_id=session.complex_id,
            user_id=session.user_id,
            start_time=session.start_time,
            end_time=session.end_time or datetime.utcnow(),
            total_iterations=completed_iterations,
            tasks_mastered_count=tasks_mastered_count,
            tasks_failed_count=tasks_failed_count,
            difficulty_progression=difficulty_progression,
            total_tasks=total_tasks,
            successful_tasks_count=successful_tasks_count,
            iteration_durations=iteration_durations
        )
        
        return summary
    
    def get_iteration_summary(self, session_id: str, iteration: int) -> Optional[IterationSummary]:
        """
        Генерирует IterationSummary для конкретной итерации.
        
        Args:
            session_id: ID сессии
            iteration: Номер итерации
            
        Returns:
            IterationSummary или None если сессия или итерация не найдены
        """
        logger.debug(f"[AdaptiveSessionManager.get_iteration_summary] Запрос summary для session_id={session_id}, iteration={iteration}")
        
        session = self._active_sessions.get(session_id)
        if not session:
            logger.warning(f"[AdaptiveSessionManager.get_iteration_summary] Session {session_id} not found in active sessions")
            return None
        
        logger.debug(f"[AdaptiveSessionManager.get_iteration_summary] Session найдена: complex_id={session.complex_id}, "
                    f"user_id={session.user_id}, current_iteration={session.iteration}, "
                    f"total_completed_tasks={len(session.completed_tasks)}")
        
        # Фильтруем результаты по iteration_index
        iteration_results = [
            r for r in session.completed_tasks
            if r.iteration_index == iteration
        ]
        
        logger.debug(f"[AdaptiveSessionManager.get_iteration_summary] Найдено результатов для итерации {iteration}: {len(iteration_results)}")
        
        if not iteration_results:
            logger.warning(f"[AdaptiveSessionManager.get_iteration_summary] No results found for iteration {iteration} in session {session_id}")
            return None
        
        # Подсчитываем статистику
        total_tasks = len(iteration_results)
        successful_tasks = sum(1 for r in iteration_results if r.success)
        failed_tasks = total_tasks - successful_tasks
        success_rate = successful_tasks / total_tasks if total_tasks > 0 else 0.0
        
        logger.debug(f"[AdaptiveSessionManager.get_iteration_summary] Статистика: total={total_tasks}, "
                    f"successful={successful_tasks}, failed={failed_tasks}, success_rate={success_rate:.2%}")
        
        # Определяем время начала и завершения итерации
        # Находим первое и последнее время выполнения заданий в итерации
        iteration_times = [r.timestamp for r in iteration_results]
        start_time = min(iteration_times) if iteration_times else None
        end_time = max(iteration_times) if iteration_times else None
        
        logger.debug(f"[AdaptiveSessionManager.get_iteration_summary] Время: start_time={start_time}, end_time={end_time}")
        
        try:
            summary = IterationSummary(
                session_id=session_id,
                complex_id=session.complex_id,
                user_id=session.user_id,
                iteration=iteration,
                total_tasks=total_tasks,
                successful_tasks=successful_tasks,
                failed_tasks=failed_tasks,
                success_rate=success_rate,
                iteration_results=iteration_results,
                start_time=start_time,
                end_time=end_time
            )
            
            logger.info(f"[AdaptiveSessionManager.get_iteration_summary] IterationSummary успешно создан для session {session_id}, "
                       f"iteration {iteration}: {successful_tasks}/{total_tasks} successful, "
                       f"type={type(summary).__name__}")
            
            return summary
        except Exception as e:
            logger.error(f"[AdaptiveSessionManager.get_iteration_summary] Ошибка при создании IterationSummary: {e}", exc_info=True)
            return None
