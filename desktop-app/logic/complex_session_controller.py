# desktop-app/logic/complex_session_controller.py
"""
Complex Session Controller - Контроллер сессии выполнения комплекса.

Управляет взаимодействием между UI, AdaptiveSessionManager и TaskController.
Отвечает за:
- Запуск и завершение сессии
- Переход между заданиями
- Обработку ответов пользователя в контексте сессии
- Подготовку данных для отображения в UI
"""

import logging
import time
from copy import deepcopy
from typing import Optional, Dict, Any, Callable
from datetime import datetime

from services.adaptive_session_manager import AdaptiveSessionManager
from services.complex_service import ComplexService
from services.storage_service import StorageService
from logic.task_controller import TaskController
from task_system.core.models.complex_models import ComplexSession

logger = logging.getLogger(__name__)

class ComplexSessionController:
    """
    Контроллер для управления сессией комплекса.
    """
    
    def __init__(
        self,
        session_manager: AdaptiveSessionManager,
        task_controller: TaskController,
        storage_service: StorageService,
        complex_service: ComplexService
    ):
        self.session_manager = session_manager
        self.task_controller = task_controller
        self.storage_service = storage_service
        self.complex_service = complex_service
        
        self.current_session_id: Optional[str] = None
        self.current_task_ref: Optional[str] = None

        # Track iteration/task UI state for safe restore and debounced persistence.
        self._current_task_iteration: Optional[int] = None
        self._last_shown_iteration: Optional[int] = None
        self._last_ui_state: Optional[Dict[str, Any]] = None
        self._last_save_time: Optional[float] = None
        self._save_debounce_timer: Optional[Any] = None
        self._state_saved_recently: bool = False
        self._save_debounce_delay: float = 0.5
        self._recent_save_threshold: float = 1.0

        # UI callbacks
        self.on_task_changed: Optional[Callable] = None
        self.on_session_completed: Optional[Callable] = None
        self.on_iteration_completed: Optional[Callable] = None
        self.on_complex_completed: Optional[Callable] = None
        self.on_error: Optional[Callable[[str], None]] = None

    @staticmethod
    def _filter_test_questions_for_partial_retry(
        task_data_full: Dict[str, Any],
        failed_indices: list[int],
    ) -> Dict[str, Any]:
        """Keep only failed test questions for retry and preserve original indices."""
        if not isinstance(task_data_full, dict) or not failed_indices:
            return task_data_full

        filtered_payload = deepcopy(task_data_full)
        task_data = filtered_payload.get("task_data") or {}
        if not isinstance(task_data, dict) or task_data.get("type") != "test":
            return filtered_payload

        failed_index_set = set(failed_indices)

        def _filter_question_list(raw_questions: Any) -> Any:
            if not isinstance(raw_questions, list) or not raw_questions:
                return raw_questions

            filtered_questions = []
            for original_index, question in enumerate(raw_questions):
                if original_index not in failed_index_set:
                    continue

                if isinstance(question, dict):
                    question_copy = dict(question)
                    question_copy["_partial_retry_original_index"] = original_index
                    filtered_questions.append(question_copy)
                else:
                    filtered_questions.append(question)

            return filtered_questions or raw_questions

        content = task_data.get("content") or {}
        if isinstance(content, dict):
            content = dict(content)
            content["questions"] = _filter_question_list(content.get("questions") or [])
            task_data = dict(task_data)
            task_data["content"] = content
            if isinstance(task_data.get("questions"), list):
                task_data["questions"] = _filter_question_list(task_data["questions"])
            filtered_payload["task_data"] = task_data

        answer_key = filtered_payload.get("answer_key")
        if isinstance(answer_key, dict):
            answer_key = dict(answer_key)
            if isinstance(answer_key.get("questions"), list):
                answer_key["questions"] = _filter_question_list(answer_key.get("questions") or [])
            elif isinstance(answer_key.get("content"), dict):
                answer_key_content = dict(answer_key.get("content") or {})
                answer_key_content["questions"] = _filter_question_list(
                    answer_key_content.get("questions") or []
                )
                answer_key["content"] = answer_key_content
            elif isinstance(answer_key.get("task_data"), dict):
                answer_key_task_data = dict(answer_key.get("task_data") or {})
                answer_key_task_data["questions"] = _filter_question_list(
                    answer_key_task_data.get("questions") or []
                )
                answer_key["task_data"] = answer_key_task_data
            filtered_payload["answer_key"] = answer_key

        return filtered_payload

    @staticmethod
    def _resolve_test_failed_question_positions(
        session: Optional[ComplexSession],
        task_ref: str,
        failed_indices: list[int],
    ) -> list[int]:
        """Convert failed question indices from original-space to shuffled-space if needed.

        API contract: the client sends indices in shuffled-space (the order questions were
        displayed on screen). Values stored in test_failed_subtests are also in shuffled-space.
        Conversion is only performed when an index falls outside the valid shuffled range,
        which signals that the client sent original-space indices (e.g., a legacy or buggy client).
        """
        if not failed_indices or session is None:
            return failed_indices

        normalized_failed = []
        for raw_index in failed_indices:
            try:
                normalized_failed.append(int(raw_index))
            except Exception:
                continue

        if not normalized_failed:
            return []

        test_shuffle = getattr(session, "test_shuffle", None)
        iteration = getattr(session, "iteration", None)
        if not isinstance(test_shuffle, dict) or iteration is None:
            return normalized_failed

        shuffle_key = f"{task_ref}@{iteration}"
        shuffle_entry = test_shuffle.get(shuffle_key)
        if not isinstance(shuffle_entry, dict):
            return normalized_failed

        question_order = shuffle_entry.get("question_order")
        if not isinstance(question_order, list) or not question_order:
            return normalized_failed

        # Indices already in shuffled-space (the normal API-contract case).
        max_q_idx = len(question_order) - 1
        needs_conversion = any(idx > max_q_idx for idx in normalized_failed)
        if not needs_conversion:
            return normalized_failed

        # At least one index is out of the shuffled range — treat all as original-space
        # and convert to shuffled-space positions.
        original_to_shuffled: Dict[int, int] = {}
        for shuffled_idx, original_idx in enumerate(question_order):
            try:
                original_to_shuffled[int(original_idx)] = shuffled_idx
            except Exception:
                continue

        return [original_to_shuffled.get(idx, idx) for idx in normalized_failed]

    def _apply_test_partial_retry_filter(
        self,
        *,
        session: Optional[ComplexSession],
        task_ref: str,
        is_retry: bool,
        task_data_full: Dict[str, Any],
        context_label: str,
    ) -> Dict[str, Any]:
        """Apply TEST partial-retry filtering to both task_data and answer_key when needed."""
        if not isinstance(task_data_full, dict) or not is_retry or session is None:
            return task_data_full

        try:
            failed_subtests = getattr(session, "test_failed_subtests", None) or {}
            failed_indices = failed_subtests.get(task_ref) or []
            if failed_indices:
                failed_positions = self._resolve_test_failed_question_positions(
                    session,
                    task_ref,
                    failed_indices,
                )
                return self._filter_test_questions_for_partial_retry(
                    task_data_full,
                    failed_positions,
                )
        except Exception as e:
            logger.warning(
                "[%s] Failed to apply partial retry for test task %s: %s",
                context_label,
                task_ref,
                e,
            )

        return task_data_full

    @staticmethod
    def _queued_task_value(queued_task: Any, key: str, default: Any = None) -> Any:
        if isinstance(queued_task, dict):
            return queued_task.get(key, default)
        return getattr(queued_task, key, default)

    @classmethod
    def _queued_task_test_question_index(cls, queued_task: Any) -> Optional[int]:
        question_idx = cls._queued_task_value(queued_task, "test_question_index")
        if question_idx is None:
            return None
        try:
            return int(question_idx)
        except Exception:
            return None

    def _apply_test_scattered_filter(
        self,
        *,
        queued_task: Any,
        task_data_full: Dict[str, Any],
        context_label: str,
    ) -> Dict[str, Any]:
        """Filter test questions to a single one if test_question_index is specified (SCATTERED mode)."""
        if not isinstance(task_data_full, dict):
            return task_data_full

        question_idx = self._queued_task_test_question_index(queued_task)
        if question_idx is None:
            return task_data_full

        try:
            # Reuse partial retry filter logic with a single index to keep structure consistent
            return self._filter_test_questions_for_partial_retry(
                task_data_full,
                [question_idx],
            )
        except Exception as e:
            logger.warning(
                "[%s] Failed to apply scattered filter for task %s at index %s: %s",
                context_label,
                self._queued_task_value(queued_task, "task_ref", "unknown"),
                question_idx,
                e,
            )
            return task_data_full

    def _apply_test_queue_slot_filters(
        self,
        *,
        session: Optional[ComplexSession],
        queued_task: Any,
        task_ref: str,
        is_retry: bool,
        task_data_full: Dict[str, Any],
        context_label: str,
    ) -> Dict[str, Any]:
        if self._queued_task_test_question_index(queued_task) is not None:
            return self._apply_test_scattered_filter(
                queued_task=queued_task,
                task_data_full=task_data_full,
                context_label=context_label,
            )

        return self._apply_test_partial_retry_filter(
            session=session,
            task_ref=task_ref,
            is_retry=is_retry,
            task_data_full=task_data_full,
            context_label=context_label,
        )

    @staticmethod
    def _format_test_result_message(correct_count: int, total_count: int) -> str:
        """Keep TEST summary text consistent with evaluator output."""
        if total_count <= 0:
            return "❌ Проверьте ответы"

        if correct_count >= total_count:
            return f"✅ Правильно! {correct_count}/{total_count} ответов"

        incorrect_count = max(0, total_count - correct_count)
        return (
            f"❌ Есть ошибки: {incorrect_count} из {total_count} с ошибкой, "
            f"верно {correct_count}"
        )

    def _sync_evaluation_result_with_session_result(self, evaluation_result: Any, session_result: Any) -> None:
        """Mirror final session-level status back into the evaluation payload for web UI."""
        if evaluation_result is None or session_result is None:
            return

        evaluation_result.success = bool(getattr(session_result, "success", getattr(evaluation_result, "success", False)))

        original_details = getattr(evaluation_result, "details", {}) or {}
        merged_details = dict(original_details) if isinstance(original_details, dict) else {}
        session_details = getattr(session_result, "details", None)
        if isinstance(session_details, dict) and session_details:
            merged_details.update(session_details)
        evaluation_result.details = merged_details

        task_type = None
        current_task = getattr(self.task_controller, "current_task", None)
        if current_task is not None:
            task_type = getattr(current_task, "task_type", None)
        if not task_type and isinstance(merged_details, dict):
            task_type = merged_details.get("task_type")

        if task_type == "test" or (
            isinstance(merged_details, dict)
            and "correct_count" in merged_details
            and "total_count" in merged_details
        ):
            try:
                correct_count = int(merged_details.get("correct_count"))
                total_count = int(merged_details.get("total_count"))
            except Exception:
                correct_count = None
                total_count = None

            if correct_count is not None and total_count is not None:
                evaluation_result.message = self._format_test_result_message(
                    correct_count,
                    total_count,
                )
            elif evaluation_result.success:
                evaluation_result.message = "✅ Правильно!"
            return

        if evaluation_result.success:
            message = str(getattr(evaluation_result, "message", "") or "")
            if any(
                marker in message
                for marker in (
                    "Введите текстовые ответы",
                    "Не выбраны ответы",
                    "Нет вопросов",
                )
            ):
                evaluation_result.message = "✅ Правильно!"

    def start_session(self, complex_id: str, user_id: str, start_iteration: int = 1) -> bool:
        """Start a new complex session."""
        logger.info(
            "[ComplexSessionController.start_session] start_session complex_id=%s user_id=%s start_iteration=%s",
            complex_id,
            user_id,
            start_iteration,
        )
        try:
            session = self.session_manager.start_session(complex_id, user_id, start_iteration)
            self.current_session_id = session.id

            logger.info(
                "[ComplexSessionController.start_session] Created session id=%s iteration=%s queue_length=%s",
                session.id,
                session.iteration,
                len(session.queue) if session.queue else 0,
            )

            self._load_next_task()
            return True
        except Exception as e:
            logger.error("[ComplexSessionController.start_session] Failed to start session: %s", e, exc_info=True)
            if self.on_error:
                self.on_error(str(e))
            return False

    def restore_session(self, complex_id: str, user_id: str) -> bool:
        """Restore an existing complex session from storage."""
        logger.info(
            "[ComplexSessionController.restore_session] restore_session complex_id=%s user_id=%s",
            complex_id,
            user_id,
        )

        try:
            session = self.session_manager.session_repository.load_session(complex_id, user_id)
            if not session:
                logger.warning(
                    "[ComplexSessionController.restore_session] Session not found for complex %s",
                    complex_id,
                )
                return False

            logger.info(
                "[ComplexSessionController.restore_session] Loaded session id=%s iteration=%s queue_length=%s current_task_index=%s completed_tasks=%s",
                session.id,
                session.iteration,
                len(session.queue) if session.queue else 0,
                session.current_task_index,
                len(session.completed_tasks),
            )

            complex_obj = self.complex_service.get_complex(complex_id)
            if not complex_obj:
                logger.warning(
                    "[ComplexSessionController.restore_session] Complex %s not found, deleting stored session",
                    complex_id,
                )
                self.session_manager.session_repository.delete_session(complex_id, user_id)
                if self.on_error:
                    self.on_error("Комплекс не найден. Сессия удалена.")
                return False

            self.session_manager.restore_session(session)
            self.current_session_id = session.id

            ui_state = self.restore_ui_state()
            logger.info("[ComplexSessionController.restore_session] UI state: %s", ui_state)

            if ui_state and ui_state.get("screen_type") == "task_results":
                logger.info(
                    "[ComplexSessionController.restore_session] UI state = task_results; keeping saved result state for S1 reload restore"
                )

            if ui_state and ui_state.get("screen_type") == "iteration_results":
                logger.info(
                    "[ComplexSessionController.restore_session] UI state = iteration_results; skip task loading so UI can render results"
                )
                return True

            if session.queue and session.current_task_index < len(session.queue):
                logger.info(
                    "[ComplexSessionController.restore_session] Loading current task at index %s",
                    session.current_task_index,
                )
                self._load_current_task()
            else:
                logger.info(
                    "[ComplexSessionController.restore_session] Queue empty or index out of bounds; loading next task"
                )
                self._load_next_task()

            return True
        except Exception as e:
            logger.error("Failed to restore session: %s", e)
            if self.on_error:
                self.on_error(f"Ошибка восстановления сессии: {e}")
            return False

    def _load_current_task(self):
        """
        Загружает текущее задание из очереди без инкремента.
        Синхронизируется через queue-slot из ui_state, чтобы retry-логика
        и сохраненный task_ref не расходились с фактически открытым заданием.
        """
        if not self.current_session_id:
            return

        session = self.session_manager.get_session(self.current_session_id)
        if not session or not session.queue:
            return

        queue = session.queue
        task_index = None
        ui_state = self.restore_ui_state() or {}
        task_ref_from_state = ui_state.get("task_ref") if isinstance(ui_state, dict) else None
        ui_task_index = ui_state.get("task_index") if isinstance(ui_state, dict) else None

        if isinstance(ui_task_index, int) and 0 <= ui_task_index < len(queue):
            queued_from_state = queue[ui_task_index]
            if not task_ref_from_state or queued_from_state.task_ref == task_ref_from_state:
                task_index = ui_task_index
                logger.info(
                    "[_load_current_task] Restoring queue slot from ui_state: index=%s, task_ref=%s",
                    task_index,
                    queued_from_state.task_ref,
                )

        current_index = getattr(session, "current_task_index", 0)
        if not isinstance(current_index, int):
            current_index = 0

        if task_index is None and task_ref_from_state:
            logger.info(f"[_load_current_task] Found task_ref in ui_state: {task_ref_from_state}")
            for idx, queued_task in enumerate(queue):
                if queued_task.task_ref == task_ref_from_state:
                    task_index = idx
                    logger.info(
                        "[_load_current_task] Resolved task_ref %s to queue index %s",
                        task_ref_from_state,
                        task_index,
                    )
                    break
            if task_index is None:
                logger.warning(
                    "[_load_current_task] task_ref %s was not found in queue, falling back to current_task_index=%s",
                    task_ref_from_state,
                    session.current_task_index,
                )
            elif not isinstance(ui_task_index, int) and task_index < current_index:
                logger.info(
                    "[_load_current_task] Ignoring stale ui_state task_ref at index %s in favour of advanced current_task_index=%s",
                    task_index,
                    current_index,
                )
                task_index = current_index

        if task_index is None:
            task_index = max(0, min(current_index, len(queue) - 1))
            logger.info(
                "[_load_current_task] Falling back to effective queue index %s from current_task_index=%s",
                task_index,
                current_index,
            )

        if task_index is None or task_index < 0 or task_index >= len(queue):
            logger.warning("[_load_current_task] Cannot restore task: invalid queue index %s", task_index)
            return

        if isinstance(getattr(session, "current_task_index", None), int) and task_index > session.current_task_index:
            logger.info(
                "[_load_current_task] Advancing stale current_task_index: %s -> %s",
                session.current_task_index,
                task_index,
            )
            session.current_task_index = task_index

        queued_task = queue[task_index]
        task_ref = queued_task.task_ref
        difficulty = queued_task.difficulty

        self.current_task_ref = task_ref
        self._current_queue_index = task_index

        try:
            parts = task_ref.split('/')
            if len(parts) < 3:
                raise ValueError(f"Invalid task reference format: {task_ref}")

            module_id = parts[0]
            topic_id = parts[1]
            task_id = parts[-1]
            task_data_full = self.storage_service.load_task(module_id, topic_id, task_id)
            if not task_data_full:
                raise ValueError(f"Task not found: {task_ref}")

            task_data_full = self._apply_test_queue_slot_filters(
                session=session,
                queued_task=queued_task,
                task_ref=task_ref,
                is_retry=bool(queued_task.is_retry),
                task_data_full=task_data_full,
                context_label="_load_current_task",
            )

            self.task_controller._explicit_difficulty_level = difficulty
            self.task_controller.load_task(
                module_id=module_id,
                topic_id=topic_id,
                task_id=task_id,
                task_data=task_data_full['task_data'],
                answer_key=task_data_full['answer_key']
            )

            if self.on_task_changed:
                self.on_task_changed({
                    "task_ref": task_ref,
                    "difficulty": difficulty,
                    "is_retry": queued_task.is_retry,
                    "index": task_index,
                    "total": len(queue),
                    "iteration": session.iteration,
                })

            if not session.ui_state or session.ui_state.get("screen_type") != "task_results":
                self.save_ui_state(
                    "task",
                    task_ref=task_ref,
                    task_index=task_index,
                    sync_progress=True,
                )
        except Exception as e:
            logger.error(f"Error loading current task {task_ref}: {e}")
            if self.on_error:
                self.on_error(f"Ошибка загрузки задания: {e}")

    def _load_next_task(self):
        """
        Загружает следующее задание из менеджера сессии.
        """
        logger.info("[ComplexSessionController._load_next_task] ========== НАЧАЛО _load_next_task ==========")
        
        if not self.current_session_id:
            logger.debug("[ComplexSessionController._load_next_task] current_session_id is None, сессия не активна")
            return
        
        logger.info(f"[ComplexSessionController._load_next_task] current_session_id={self.current_session_id}")

        # ИСПРАВЛЕНИЕ: Проверяем, что сессия еще активна перед вызовом get_next_task
        # Это предотвращает преждевременное завершение сессии
        session = self.session_manager.get_session(self.current_session_id)
        if not session or not session.is_active:
            logger.warning(f"[ComplexSessionController._load_next_task] Сессия {self.current_session_id} не найдена или неактивна: session={session}, is_active={session.is_active if session else 'None'}")
            self._handle_session_completion()
            return

        # DAILY_MIX: простая линейная очередь без генерации итераций.
        if getattr(session, "complex_id", None) == "daily_mix":
            queue_len = len(getattr(session, "queue", []) or [])
            idx = getattr(session, "current_task_index", 0)
            comp_len = len(getattr(session, "completed_tasks", []) or [])
            logger.info(
                "[ComplexSessionController._load_next_task][daily_mix] queue_len=%s current_task_index=%s completed=%s",
                queue_len,
                idx,
                comp_len,
            )
            next_index = idx + 1
            if next_index < queue_len:
                session.current_task_index = next_index
                try:
                    if self.session_manager.session_repository:
                        self.session_manager.session_repository.save_session(
                            session, getattr(session, "user_id", "default_user")
                        )
                except Exception:
                    logger.exception("[ComplexSessionController._load_next_task][daily_mix] Failed to persist index advance")
                # загрузим следующий task
                queued_task = session.queue[next_index]
                self.current_task_ref = queued_task.task_ref
                self._current_queue_index = next_index
                try:
                    parts = queued_task.task_ref.split("/")
                    if len(parts) >= 3:
                        module_id, topic_id, task_id = parts[0], parts[1], parts[-1]
                        task_data_full = self.storage_service.load_task(module_id, topic_id, task_id)
                        task_data_full = self._apply_test_partial_retry_filter(
                            session=session,
                            task_ref=queued_task.task_ref,
                            is_retry=bool(queued_task.is_retry),
                            task_data_full=task_data_full,
                            context_label="_load_next_task.daily_mix",
                        )
                        self.task_controller._explicit_difficulty_level = queued_task.difficulty
                        self.task_controller.load_task(
                            module_id=module_id,
                            topic_id=topic_id,
                            task_id=task_id,
                            task_data=task_data_full["task_data"],
                            answer_key=task_data_full["answer_key"],
                        )
                        if self.on_task_changed:
                            self.on_task_changed(
                                {
                                    "task_ref": queued_task.task_ref,
                                    "difficulty": queued_task.difficulty,
                                    "is_retry": queued_task.is_retry,
                                    "index": session.current_task_index,
                                    "total": queue_len,
                                    "iteration": session.iteration,
                                }
                            )
                        self.save_ui_state(
                            "task",
                            task_ref=queued_task.task_ref,
                            task_index=next_index,
                            sync_progress=True,
                        )
                        return
                except Exception:
                    logger.exception("[ComplexSessionController._load_next_task][daily_mix] Failed to load next task")
                    self._handle_session_completion()
                    return
            # нет следующего задания -> завершаем
            self.current_task_ref = None
            try:
                self.task_controller.clear_task()
            except Exception:
                logger.exception("[ComplexSessionController._load_next_task][daily_mix] Failed to clear task controller on completion")
            self._handle_session_completion()
            return
        
        logger.info(f"[ComplexSessionController._load_next_task] Сессия найдена: iteration={session.iteration}, "
                   f"queue_length={len(session.queue) if session.queue else 0}, "
                   f"current_task_index={session.current_task_index}, "
                   f"completed_tasks={len(session.completed_tasks)}")
        
        # ИСПРАВЛЕНИЕ: Проверяем завершение итерации ДО генерации следующей итерации
        # Это позволяет показать результаты итерации даже если следующая итерация пуста
        # Итерация завершена, если:
        # 1. Индекс достиг конца очереди И
        # 2. Все задания в очереди были обработаны (завершены или пропущены)
        total_tasks_in_queue = len(session.queue) if session.queue else 0
        
        # Проверка завершения итерации.
        # С новой моделью пропуска задания НЕ удаляются из очереди (перемещаются в конец),
        # поэтому итерация завершена просто когда current_task_index >= len(queue).
        iteration_completed = (
            total_tasks_in_queue > 0 and
            session.current_task_index >= total_tasks_in_queue
        )
        
        logger.debug(f"[ComplexSessionController._load_next_task] Проверка завершения итерации: "
                    f"current_task_index={session.current_task_index}, "
                    f"total_tasks_in_queue={total_tasks_in_queue}, "
                    f"iteration_completed={iteration_completed}")

        # Завершённая итерация (для логики показа/пропуска результатов)
        completed_iteration = session.iteration
        ui_state = getattr(session, "ui_state", None) or {}
        already_shown = (
            self._last_shown_iteration == completed_iteration
            or (isinstance(ui_state, dict) and ui_state.get("screen_type") == "iteration_results")
        )

        if iteration_completed:
            # Если результаты этой итерации уже были показаны, пропускаем показ и генерируем следующую итерацию
            if already_shown:
                logger.info(f"[ComplexSessionController._load_next_task] Результаты итерации {completed_iteration} уже были показаны, генерируем следующую итерацию")
                # Сбрасываем флаг, чтобы следующая итерация могла показать свои результаты
                self._last_shown_iteration = None
                # Продолжаем выполнение - генерируем следующую итерацию через get_next_task()
            else:
                logger.info(f"[ComplexSessionController._load_next_task] Итерация {completed_iteration} завершена, показываем результаты итерации")

                # Критично фиксируем экран S2 до callback'а, чтобы результаты итерации переживали рестарт сервера.
                logger.info(
                    "[ComplexSessionController._load_next_task] Сохраняем состояние UI: iteration_results, iteration=%s",
                    completed_iteration,
                )
                try:
                    self.save_ui_state(
                        "iteration_results",
                        iteration_number=completed_iteration,
                        force=True,
                    )
                except Exception as e:
                    logger.warning(
                        "[ComplexSessionController._load_next_task] Ошибка при сохранении состояния iteration_results: %s",
                        e,
                        exc_info=True,
                    )

                if hasattr(self, 'on_iteration_completed') and self.on_iteration_completed:
                    iteration_summary = self.session_manager.get_iteration_summary(self.current_session_id, completed_iteration)
                    if iteration_summary:
                        logger.info(f"[ComplexSessionController._load_next_task] IterationSummary создан: iteration={iteration_summary.iteration}, "
                                  f"total_tasks={iteration_summary.total_tasks}, successful_tasks={iteration_summary.successful_tasks}, "
                                  f"failed_tasks={iteration_summary.failed_tasks}, success_rate={iteration_summary.success_rate:.2%}")
                        self._last_shown_iteration = completed_iteration
                        self.on_iteration_completed(iteration_summary)
                        return
                    else:
                        logger.warning(f"[ComplexSessionController._load_next_task] Не удалось создать IterationSummary для итерации {completed_iteration}")
                else:
                    logger.warning(f"[ComplexSessionController._load_next_task] Callback on_iteration_completed не установлен или None")
        
        # Генерируем следующую итерацию и получаем следующее задание
        # (Если итерация не завершена или результаты уже показаны, выполнение доходит сюда)
        logger.info("[ComplexSessionController._load_next_task] Вызываем get_next_task() для получения следующего задания")
        next_task_info = self.session_manager.get_next_task(self.current_session_id)
        
        if not next_task_info:
            logger.info(f"[ComplexSessionController._load_next_task] get_next_task() вернул None, сессия завершена (очередь пуста)")
            session = self.session_manager.get_session(self.current_session_id)
            if session and session.is_completed:
                self._handle_complex_completion()
            else:
                self._handle_session_completion()
            return
        
        task_ref = next_task_info['task_ref']
        difficulty = next_task_info['difficulty']
        
        logger.info(f"[ComplexSessionController._load_next_task] Получено следующее задание: task_ref={task_ref}, "
                   f"difficulty={difficulty}, iteration={next_task_info.get('iteration')}, "
                   f"index={next_task_info.get('index')}/{next_task_info.get('total')}")
        
        self.current_task_ref = task_ref
        self._current_queue_index = next_task_info.get("index")
        
        # ITERATION MISMATCH PROTECTION: Store iteration for this task
        session = self.session_manager.get_session(self.current_session_id)
        if session:
            self._current_task_iteration = session.iteration
            logger.debug(f"[_load_next_task] Stored iteration {self._current_task_iteration} for task {task_ref}")
        
        # Парсим task_ref (предполагаем формат module/topic/task_id)
        # В реальном проекте может потребоваться более надежный парсер
        try:
            parts = task_ref.split('/')
            if len(parts) >= 3:
                module_id = parts[0]
                topic_id = parts[1]
                task_id = parts[-1]
                
                # Загружаем данные задания через StorageService
                task_data_full = self.storage_service.load_task(module_id, topic_id, task_id)
                
                if not task_data_full:
                    raise ValueError(f"Task not found: {task_ref}")

                task_data_full = self._apply_test_queue_slot_filters(
                    session=session,
                    queued_task=next_task_info,
                    task_ref=task_ref,
                    is_retry=bool(next_task_info.get("is_retry")),
                    task_data_full=task_data_full,
                    context_label="_load_next_task",
                )
                    
                # Устанавливаем явный уровень сложности в TaskController
                # Это важно, так как TaskController по умолчанию может использовать другой уровень
                self.task_controller._explicit_difficulty_level = difficulty
                
                # Загружаем задание в TaskController
                self.task_controller.load_task(
                    module_id=module_id,
                    topic_id=topic_id,
                    task_id=task_id,
                    task_data=task_data_full['task_data'],
                    answer_key=task_data_full['answer_key']
                )
                
                # Уведомляем UI
                if self.on_task_changed:
                    logger.info(f"[ComplexSessionController._load_next_task] Вызываем callback on_task_changed с task_info: {next_task_info}")
                    self.on_task_changed(next_task_info)
                else:
                    logger.warning("[ComplexSessionController._load_next_task] Callback on_task_changed не установлен")
                
                # Сохраняем состояние UI: переход к новому заданию
                logger.info(f"[ComplexSessionController._load_next_task] Сохраняем состояние UI: task, task_ref={task_ref}")
                self.save_ui_state(
                    "task",
                    task_ref=task_ref,
                    task_index=next_task_info.get("index"),
                    sync_progress=True,
                )
            else:
                raise ValueError(f"Invalid task reference format: {task_ref}")
                
        except Exception as e:
            logger.error(f"[ComplexSessionController._load_next_task] Error loading task {task_ref}: {e}", exc_info=True)
            if self.on_error:
                self.on_error(f"Ошибка загрузки задания: {e}")
        
        logger.info("[ComplexSessionController._load_next_task] ========== КОНЕЦ _load_next_task ==========")
                
    def submit_answer(self, user_input: Any):
        """
        Отправляет ответ пользователя.
        """
        if not self.current_session_id or not self.task_controller.is_task_loaded():
            logger.warning("Cannot submit answer: session or task not loaded")
            return None  # Явно возвращаем None
            
        previous_defer_progress = bool(getattr(self.task_controller, "defer_progress_persistence", False))
        self.task_controller.defer_progress_persistence = True

        try:
            # 1. Оцениваем ответ через TaskController
            evaluation_result = self.task_controller.submit_answer(user_input)
            
            if not evaluation_result:
                logger.error("TaskController returned None result")
                return None
            
            # 2. Отправляем результат в SessionManager
            # Нам нужно передать task_ref и difficulty, которые мы помним
            # Или взять из evaluation_result.details, если TaskController их туда положил
            
            task_ref = self.current_task_ref
            difficulty = evaluation_result.details.get('difficulty', 1)

            requires_user_judgement = bool(
                isinstance(evaluation_result.details, dict)
                and evaluation_result.details.get('requires_user_judgement')
            )
            if requires_user_judgement:
                logger.debug(
                    "[ComplexSessionController.submit_answer] Pending user judgement for %s; skip session finalization",
                    task_ref,
                )
                try:
                    self.save_ui_state(
                        "task_results",
                        task_ref=task_ref,
                        task_index=getattr(self, "_current_queue_index", None),
                        evaluation_result=evaluation_result,
                        user_input=user_input,
                    )
                except Exception as e:
                    logger.warning(
                        f"[ComplexSessionController.submit_answer] Ошибка при сохранении pending-состояния UI: {e}"
                    )
                return evaluation_result
             
            session_result = self.session_manager.submit_result(
                self.current_session_id,
                {
                    "task_ref": task_ref,
                    "success": evaluation_result.success,
                    "score": getattr(evaluation_result, 'score', 100.0 if evaluation_result.success else 0.0),
                    "time_spent": evaluation_result.details.get('time_spent', 0),
                    "difficulty": difficulty,
                    "expected_iteration": self._current_task_iteration,  # ← ITERATION MISMATCH PROTECTION
                    "details": evaluation_result.details
                }
            )

            # Синхронизируем EvaluationResult с фактическим результатом сессии.
            # Это важно для web-HTTP-слоя: SessionAPI._serialize_evaluation_result
            # смотрит на evaluation_result.success, а не на SessionTaskResult.
            try:
                self._sync_evaluation_result_with_session_result(
                    evaluation_result,
                    session_result,
                )
            except Exception:
                logger.exception(
                    "[ComplexSessionController.submit_answer] Failed to sync evaluation_result with session_result"
                )
            
            # ИСПРАВЛЕНИЕ: Сохраняем состояние UI после отправки ответа
            # Это гарантирует, что состояние будет сохранено даже если пользователь закроет приложение
            logger.debug("[ComplexSessionController.submit_answer] Сохраняем состояние UI после отправки ответа")
            try:
                self.save_ui_state(
                    "task_results",
                    task_ref=task_ref,
                    task_index=getattr(self, "_current_queue_index", None),
                    evaluation_result=evaluation_result,
                    user_input=user_input,
                )
            except Exception as e:
                logger.warning(f"[ComplexSessionController.submit_answer] Ошибка при сохранении состояния UI: {e}")
            
            # 3. Возвращаем результат для UI
            # UI покажет результат, а потом пользователь жмет "Далее"
            return evaluation_result
            
        except Exception as e:
            logger.error(f"Error submitting answer: {e}", exc_info=True)
            if self.on_error:
                self.on_error(f"Ошибка проверки ответа: {e}")
            return None  # Явно возвращаем None при ошибке
        finally:
            self.task_controller.defer_progress_persistence = previous_defer_progress
                
    def _resolve_current_queue_index(self, session) -> Optional[int]:
        """Resolve the exact queue slot for the currently shown task."""
        queue = getattr(session, "queue", None) or []
        if not queue:
            return None

        queue_index = getattr(self, "_current_queue_index", None)
        if isinstance(queue_index, int) and 0 <= queue_index < len(queue):
            queued_task = queue[queue_index]
            if not self.current_task_ref or queued_task.task_ref == self.current_task_ref:
                return queue_index

        current_index = getattr(session, "current_task_index", 0)
        if not isinstance(current_index, int):
            return None

        fallback_index = current_index - 1 if current_index > 0 else 0
        if 0 <= fallback_index < len(queue):
            queued_task = queue[fallback_index]
            if not self.current_task_ref or queued_task.task_ref == self.current_task_ref:
                return fallback_index

        return None

    @staticmethod
    def _queue_occurrence_ordinal(session, task_ref: str, queue_index: Optional[int]) -> int:
        """Return 1-based occurrence number of task_ref within the queue up to queue_index."""
        if queue_index is None:
            return 1

        queue = getattr(session, "queue", None) or []
        occurrences = 0
        last_index = min(queue_index, len(queue) - 1)
        for idx in range(last_index + 1):
            queued_task = queue[idx]
            if getattr(queued_task, "task_ref", None) == task_ref:
                occurrences += 1

        return max(1, occurrences)

    @staticmethod
    def _completed_attempts_in_iteration(session, task_ref: str, iteration_index: Optional[int]) -> int:
        """Count how many attempts of task_ref were already submitted in the target iteration."""
        completed_tasks = getattr(session, "completed_tasks", None) or []
        return sum(
            1
            for result in completed_tasks
            if getattr(result, "task_ref", None) == task_ref
            and getattr(result, "iteration_index", None) == iteration_index
        )

    def next_task(self):
        """
        Переход к следующему заданию (вызывается из UI).
        
        Если текущее задание не было отправлено (submit_answer не был вызван),
        оно откладывается в конец очереди через skip_task.
        """
        # Проверяем, было ли текущее задание отправлено
        if self.current_session_id and self.current_task_ref:
            session = self.session_manager.get_session(self.current_session_id)
            if session:
                # Проверяем, есть ли результат для текущего задания в текущей итерации
                task_iteration = self._current_task_iteration
                if task_iteration is None:
                    task_iteration = self._get_session_iteration(session)

                queue_index = self._resolve_current_queue_index(session)
                occurrence_ordinal = self._queue_occurrence_ordinal(
                    session,
                    self.current_task_ref,
                    queue_index,
                )
                completed_attempts = self._completed_attempts_in_iteration(
                    session,
                    self.current_task_ref,
                    task_iteration,
                )
                current_task_submitted = completed_attempts >= occurrence_ordinal
                
                if not current_task_submitted:
                    # Задание не было отправлено — откладываем в конец очереди
                    logger.info(
                        f"[ComplexSessionController.next_task] Задание {self.current_task_ref} "
                        f"не было отправлено, откладываем в конец очереди"
                    )
                    try:
                        skip_result = self.session_manager.skip_task(self.current_session_id, self.current_task_ref)
                        if not skip_result.get("ok"):
                            reason = skip_result.get("reason", "unknown")
                            logger.warning(
                                f"[ComplexSessionController.next_task] Пропуск отклонён: {reason}"
                            )
                            if self.on_error and reason in ("retry_cannot_be_skipped", "last_task_cannot_be_skipped", "skip_limit_reached"):
                                self.on_error(f"Это задание нельзя пропустить: {reason}")
                                return
                    except Exception as e:
                        logger.warning(f"[ComplexSessionController.next_task] Ошибка при пропуске задания: {e}")
        
        self._load_next_task()
        
    def _handle_complex_completion(self):
        """
        Обработка завершения комплекса - все задания выполнены на максимальной сложности.
        Показывает финальные результаты.
        """
        logger.info(f"[ComplexSessionController._handle_complex_completion] Комплекс завершен - все задания на максимальной сложности")
        
        session = self.session_manager.get_session(self.current_session_id)
        if not session:
            logger.warning("[ComplexSessionController._handle_complex_completion] Сессия не найдена")
            self._handle_session_completion()
            return
        
        # Получаем финальные результаты из сессии
        final_summary = None
        if hasattr(session, '_final_summary'):
            final_summary = session._final_summary
        else:
            # Если финальные результаты не сохранены, генерируем их
            final_summary = self.session_manager.end_session(self.current_session_id)
        
        # Вызываем callback для показа финальных результатов
        if hasattr(self, 'on_complex_completed') and self.on_complex_completed:
            logger.info("[ComplexSessionController._handle_complex_completion] Вызываем callback on_complex_completed")
            # Сохраняем факт завершения комплекса в прогресс пользователя
            try:
                if hasattr(self.session_manager, "user_progress_manager"):
                    self.session_manager.user_progress_manager.add_complex_completion(
                        complex_id=session.complex_id,
                        session_id=self.current_session_id,
                        timestamp=datetime.utcnow().isoformat()
                    )
            except Exception as e:
                logger.warning(f"[ComplexSessionController._handle_complex_completion] Failed to save complex completion: {e}")

            self.on_complex_completed(final_summary)
        else:
            logger.warning("[ComplexSessionController._handle_complex_completion] Callback on_complex_completed не установлен, используем обычное завершение")
            self._handle_session_completion()
    
    def _handle_session_completion(self):
        """
        Обработка завершения сессии.
        """
        logger.info(f"Session {self.current_session_id} completed")
        session = self.session_manager.get_session(self.current_session_id)
        
        # Очищаем состояние UI при завершении сессии
        if session:
            session.ui_state = None
            # Сохраняем сессию с очищенным состоянием
            try:
                if hasattr(self.session_manager, 'session_repository'):
                    self.session_manager.session_repository.save_session(session, session.user_id)
            except Exception as e:
                logger.warning(f"Error saving session with cleared UI state: {e}")
        
        self.current_session_id = None
        self.current_task_ref = None
        self.task_controller.clear_task()
        
        if self.on_session_completed:
            self.on_session_completed(session)

    def get_current_session_stats(self) -> Dict[str, Any]:
        """
        Возвращает текущую статистику сессии для HUD.
        """
        if not self.current_session_id:
            return {}
            
        session = self.session_manager.get_session(self.current_session_id)
        if not session:
            return {}
        
        # Формат HUD: "Итерация: {current_iter} | Задание: {task_number_in_iteration} / {total_in_queue}"
        current_iter = session.iteration
        index_in_queue = session.current_task_index
        total_in_queue = len(session.queue)
        
        # ИСПРАВЛЕНИЕ: current_task_index УЖЕ УВЕЛИЧЕН в get_next_task() перед возвратом задания
        # Поэтому он уже указывает на следующее задание (после текущего)
        # Для отображения текущего задания НЕ нужно добавлять +1
        # Если индекс = 0, значит заданий еще не было, показываем 1
        # Если индекс >= total_in_queue, значит все задания пройдены, показываем total_in_queue
        if total_in_queue > 0:
            if index_in_queue == 0:
                # Еще не начали, показываем 1
                task_number_in_iteration = 1
            else:
                # current_task_index уже увеличен после загрузки, поэтому используем как есть
                task_number_in_iteration = min(index_in_queue, total_in_queue)
        else:
            task_number_in_iteration = 0
        
        # Для справки: общий порядковый номер (может быть полезен для других целей)
        completed_tasks_count = len(session.completed_tasks)
        ordinal_task_number = completed_tasks_count + 1
        
        return {
            "current_iter": current_iter,
            "index_in_queue": index_in_queue,
            "total_in_queue": total_in_queue,
            "task_number_in_iteration": task_number_in_iteration,  # Номер задания в текущей итерации
            "ordinal_task_number": ordinal_task_number,  # Общий порядковый номер (для справки)
            "progress": f"Итерация: {current_iter} | Задание: {task_number_in_iteration} / {total_in_queue}",
            "completed_count": completed_tasks_count,
            "errors_count": len([r for r in session.completed_tasks if not r.success]),
            "current_difficulty": self.task_controller.current_difficulty_level,
            "session": session  # Добавляем сессию для доступа к user_id
        }
    
    def save_ui_state(self, screen_type: str, force: bool = False, **kwargs) -> bool:
        """
        Сохраняет состояние UI в сессию.
        
        Args:
            screen_type: Тип экрана ("task", "task_results", "iteration_results")
            force: Если True, принудительно сохраняет состояние, пропуская проверку изменений и debouncing
            **kwargs: Дополнительные данные состояния:
                - task_ref: str (для task и task_results)
                - evaluation_result: Dict (для task_results)
                - iteration_number: int (для iteration_results)
        
        Returns:
            bool: True если сохранение успешно
        """
        logger.debug(f"[ComplexSessionController.save_ui_state] Вызов save_ui_state: screen_type={screen_type}, force={force}, kwargs={kwargs}")
        
        if not self.current_session_id:
            logger.warning("[ComplexSessionController.save_ui_state] Cannot save UI state: no active session")
            return False
        
        session = self.session_manager.get_session(self.current_session_id)
        if not session:
            logger.warning(f"[ComplexSessionController.save_ui_state] Cannot save UI state: session {self.current_session_id} not found")
            return False
        
        try:
            # Формируем новое состояние UI
            # iteration: используем session.iteration (или fallback, если имя иное)
            session_iter = self._get_session_iteration(session)
            
            new_ui_state = {
                "screen_type": screen_type,
                "session_id": self.current_session_id,
                "last_updated": datetime.utcnow().isoformat(),
                "iteration": session_iter
            }
            
            # Добавляем данные в зависимости от типа экрана
            sync_progress = bool(kwargs.get("sync_progress"))
            if screen_type in ("task", "task_results"):
                task_ref = kwargs.get("task_ref") or self.current_task_ref
                task_index = kwargs.get("task_index")
                if task_ref:
                    new_ui_state["task_ref"] = task_ref
                    if isinstance(task_index, int):
                        new_ui_state["task_index"] = task_index
                        self._current_queue_index = task_index

                    if screen_type != "task_results" and sync_progress:
                        skip_sync_due_to_iteration = False
                        try:
                            matching_results = [
                                r for r in session.completed_tasks
                                if getattr(r, "task_ref", None) == task_ref
                            ]
                            if matching_results:
                                last_result = matching_results[-1]
                                result_iter = getattr(last_result, "iteration_index", None)
                                current_iter = self._get_session_iteration(session)
                                if result_iter is not None and current_iter is not None and result_iter < current_iter:
                                    skip_sync_due_to_iteration = True
                                    logger.info(
                                        "[ComplexSessionController.save_ui_state] Skipping current_task_index sync for previous-iteration result: result_iter=%s current_iter=%s task_ref=%s",
                                        result_iter,
                                        current_iter,
                                        task_ref,
                                    )
                        except Exception as e:
                            logger.debug(f"[ComplexSessionController.save_ui_state] Failed to detect iteration for task_ref={task_ref}: {e}")

                        if not skip_sync_due_to_iteration and session.queue:
                            if isinstance(task_index, int):
                                if 0 <= task_index < len(session.queue):
                                    indexed_task = session.queue[task_index]
                                    if getattr(indexed_task, "task_ref", None) == task_ref:
                                        current_idx = session.current_task_index
                                        expected_idx = (
                                            task_index
                                            if getattr(session, "complex_id", None) == "daily_mix"
                                            else min(len(session.queue), task_index + 1)
                                        )
                                        if not isinstance(current_idx, int) or current_idx < expected_idx:
                                            logger.info(
                                                "[ComplexSessionController.save_ui_state] Advancing current_task_index: %s -> %s (explicit task_index=%s for %s)",
                                                current_idx,
                                                expected_idx,
                                                task_index,
                                                task_ref,
                                            )
                                            session.current_task_index = expected_idx
                                    else:
                                        logger.warning(
                                            "[ComplexSessionController.save_ui_state] task_index=%s points to %s instead of %s; keeping current_task_index=%s",
                                            task_index,
                                            getattr(indexed_task, "task_ref", None),
                                            task_ref,
                                            session.current_task_index,
                                        )
                                else:
                                    logger.warning(
                                        "[ComplexSessionController.save_ui_state] task_index=%s is out of queue bounds (len=%s)",
                                        task_index,
                                        len(session.queue),
                                    )
                            else:
                                current_idx = session.current_task_index
                                if current_idx >= len(session.queue):
                                    logger.debug(
                                        "[ComplexSessionController.save_ui_state] current_task_index=%s is outside queue_len=%s; skip sync for task_ref=%s",
                                        current_idx,
                                        len(session.queue),
                                        task_ref,
                                    )
                                else:
                                    current_queued_task = session.queue[current_idx]
                                    if current_queued_task.task_ref == task_ref:
                                        logger.debug(
                                            "[ComplexSessionController.save_ui_state] current_task_index=%s already points to task_ref=%s",
                                            current_idx,
                                            task_ref,
                                        )
                                    else:
                                        found_idx = None
                                        for idx, queued_task in enumerate(session.queue):
                                            if queued_task.task_ref == task_ref:
                                                found_idx = idx
                                                if found_idx >= current_idx:
                                                    if session.current_task_index != found_idx:
                                                        logger.info(
                                                            "[ComplexSessionController.save_ui_state] Syncing current_task_index: %s -> %s (task_ref=%s)",
                                                            session.current_task_index,
                                                            found_idx,
                                                            task_ref,
                                                        )
                                                        session.current_task_index = found_idx
                                                break
                                        if found_idx is None or found_idx < current_idx:
                                            logger.warning(
                                                "[ComplexSessionController.save_ui_state] task_ref %s was not found in queue after current_idx=%s; keeping current_task_index",
                                                task_ref,
                                                current_idx,
                                            )
                else:
                    logger.warning("Cannot save UI state: task_ref not provided")
                    return False

                user_input = kwargs.get("user_input")
                if user_input is not None:
                    new_ui_state["user_input"] = user_input

                view_state = kwargs.get("view_state")
                if view_state is not None:
                    new_ui_state["view_state"] = view_state

                if screen_type == "task_results":
                    evaluation_result = kwargs.get("evaluation_result")
                    if evaluation_result:
                        if hasattr(evaluation_result, 'dict'):
                            new_ui_state["evaluation_result"] = evaluation_result.dict()
                        elif hasattr(evaluation_result, '__dict__'):
                            new_ui_state["evaluation_result"] = self._serialize_evaluation_result(evaluation_result)
                        elif isinstance(evaluation_result, dict):
                            new_ui_state["evaluation_result"] = evaluation_result
                        else:
                            logger.warning(f"Cannot serialize evaluation_result: {type(evaluation_result)}")
                            return False

            elif screen_type == "iteration_results":
                iteration_number = kwargs.get("iteration_number")
                if iteration_number is not None:
                    new_ui_state["iteration_number"] = iteration_number
                else:
                    logger.warning("Cannot save UI state: iteration_number not provided")
                    return False
            
            # ИСПРАВЛЕНИЕ: Проверяем, изменилось ли состояние (пропускаем при force=True)
            if not force and self._last_ui_state is not None:
                # Сравниваем ключевые поля состояния
                state_changed = (
                    self._last_ui_state.get("screen_type") != new_ui_state.get("screen_type") or
                    self._last_ui_state.get("task_ref") != new_ui_state.get("task_ref") or
                    self._last_ui_state.get("task_index") != new_ui_state.get("task_index") or
                    self._last_ui_state.get("iteration_number") != new_ui_state.get("iteration_number") or
                    self._last_ui_state.get("evaluation_result") != new_ui_state.get("evaluation_result") or
                    self._last_ui_state.get("user_input") != new_ui_state.get("user_input") or
                    self._last_ui_state.get("view_state") != new_ui_state.get("view_state")
                )
                
                if not state_changed:
                    logger.debug("[ComplexSessionController.save_ui_state] Состояние не изменилось, пропускаем сохранение")
                    return True  # Возвращаем True, так как состояние уже актуально
            
            # ИСПРАВЛЕНИЕ: Проверяем debouncing - если недавно было сохранение, откладываем (пропускаем при force=True)
            current_time = time.time()
            if not force and self._last_save_time is not None:
                time_since_last_save = current_time - self._last_save_time
                
                if time_since_last_save < self._save_debounce_delay:
                    # Отменяем предыдущий отложенный вызов, если есть
                    if self._save_debounce_timer is not None:
                        # Для tkinter используем after_cancel, но нам нужен доступ к root
                        # Пока просто логируем и продолжаем
                        logger.debug(f"[ComplexSessionController.save_ui_state] Откладываем сохранение (debounce), прошло {time_since_last_save:.3f}s")
                    
                    # Для критических изменений (iteration_results, task_results) сохраняем сразу
                    if screen_type in ("iteration_results", "task_results"):
                        logger.debug("[ComplexSessionController.save_ui_state] Критическое изменение, сохраняем немедленно")
                    else:
                        # Для некритических изменений можно отложить, но для простоты сохраняем сразу
                        logger.debug("[ComplexSessionController.save_ui_state] Сохраняем несмотря на debounce")
            
            # Сохраняем состояние в сессию
            old_ui_state = session.ui_state
            session.ui_state = new_ui_state
            
            # Обновляем кэш последнего состояния
            self._last_ui_state = new_ui_state.copy()
            self._last_save_time = current_time
            self._state_saved_recently = True
            
            # Сбрасываем флаг недавнего сохранения через пороговое время
            # (будет сброшен при следующем вызове, если прошло достаточно времени)
            
            logger.info(f"[ComplexSessionController.save_ui_state] Состояние UI сохранено: screen_type={screen_type}, "
                       f"task_ref={new_ui_state.get('task_ref')}, session_id={self.current_session_id}")
            
            # Автосохранение сессии в файл
            self._auto_save_session(session)
            
            return True
            
        except Exception as e:
            logger.error(f"Error saving UI state: {e}", exc_info=True)
            return False
    
    def _serialize_evaluation_result(self, result: Any) -> Dict[str, Any]:
        """
        Сериализует результат проверки в JSON-совместимый формат.
        
        Args:
            result: Объект результата проверки
        
        Returns:
            Dict: Сериализованный результат
        """
        if isinstance(result, dict):
            return result
        
        serialized = {}
        
        # Базовые поля
        if hasattr(result, 'success'):
            serialized['success'] = result.success
        if hasattr(result, 'message'):
            serialized['message'] = str(result.message)
        if hasattr(result, 'details'):
            details = result.details
            if isinstance(details, dict):
                serialized['details'] = details
            elif hasattr(details, '__dict__'):
                serialized['details'] = details.__dict__
            else:
                serialized['details'] = str(details)
        
        return serialized

    def _get_session_iteration(self, session):
        """Безопасно получить номер текущей итерации сессии."""
        if session is None:
            return None
        return getattr(session, "iteration", None) or getattr(session, "current_iteration", None)
    
    def restore_ui_state(self) -> Optional[Dict[str, Any]]:
        """
        Восстанавливает состояние UI из сессии.
        
        Returns:
            Optional[Dict[str, Any]]: Состояние UI или None если не найдено
        """
        logger.debug(f"[ComplexSessionController.restore_ui_state] Запрос восстановления состояния UI, current_session_id={self.current_session_id}")
        
        if not self.current_session_id:
            logger.debug("[ComplexSessionController.restore_ui_state] current_session_id is None, возвращаем None")
            return None
        
        session = self.session_manager.get_session(self.current_session_id)
        if not session:
            logger.debug(f"[ComplexSessionController.restore_ui_state] Сессия {self.current_session_id} не найдена, возвращаем None")
            return None
        
        if not session.ui_state:
            logger.debug(f"[ComplexSessionController.restore_ui_state] Состояние UI в сессии {self.current_session_id} отсутствует, возвращаем None")
            return None
        
        logger.info(f"[ComplexSessionController.restore_ui_state] Состояние UI восстановлено: {session.ui_state}")
        return session.ui_state
    
    def clear_ui_state(self) -> bool:
        """
        Очищает состояние UI в сессии.
        
        Returns:
            bool: True если очистка успешна
        """
        logger.info(f"[ComplexSessionController.clear_ui_state] ========== НАЧАЛО clear_ui_state ==========")
        logger.info(f"[ComplexSessionController.clear_ui_state] current_session_id={self.current_session_id}")
        
        if not self.current_session_id:
            logger.warning("[ComplexSessionController.clear_ui_state] current_session_id is None, возвращаем False")
            return False
        
        session = self.session_manager.get_session(self.current_session_id)
        if not session:
            logger.warning(f"[ComplexSessionController.clear_ui_state] Сессия {self.current_session_id} не найдена, возвращаем False")
            return False
        
        old_ui_state = session.ui_state
        session.ui_state = None
        
        logger.info(f"[ComplexSessionController.clear_ui_state] Состояние UI очищено: old_state={old_ui_state}, new_state=None")
        
        self._auto_save_session(session)
        
        logger.info(f"[ComplexSessionController.clear_ui_state] ========== КОНЕЦ clear_ui_state ==========")
        return True
    
    def _auto_save_session(self, session: ComplexSession):
        """
        Автоматически сохраняет сессию в файл.
        
        Args:
            session: Сессия для сохранения
        """
        try:
            if hasattr(self.session_manager, 'session_repository'):
                self.session_manager.session_repository.save_session(session, session.user_id)
                logger.debug(f"Session auto-saved: {session.id}")
        except Exception as e:
            logger.warning(f"Error auto-saving session: {e}")

