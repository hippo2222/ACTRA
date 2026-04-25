import contextvars
import copy
import inspect
import logging
import os
import random
import re
import threading
from datetime import datetime
from contextlib import nullcontext
from functools import wraps
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from typing import Any, Dict, Optional, List, Tuple, Set

from services.statistics_service import StatisticsService
from services.hosted_shadow_fallback import HostedShadowWriteFallbackDisabledError
from services.adaptive_session_manager import AdaptiveSessionManager
from services.complex_service import ComplexService
from services.linked_complex_runtime import parse_linked_runtime_complex_id
from services.storage_service import StorageService
from logic.complex_session_controller import ComplexSessionController
from logic.task_controller import TaskController
from api.web_models.sequence_models import (
    WebSequenceElement,
    WebSequenceLevel,
    WebSequenceSettings,
    WebSequenceTaskData,
    WebSequenceResultDetails,
)


logger = logging.getLogger(__name__)


def _hosted_controller_serialized(fn):
    """Bind controller-bound SessionAPI flows to an isolated hosted context."""

    signature = inspect.signature(fn)

    @wraps(fn)
    def wrapper(self, *args, **kwargs):
        bound = signature.bind(self, *args, **kwargs)
        bound.apply_defaults()
        operation_args = dict(bound.arguments)
        operation_args.pop("self", None)

        with self._controller_state_guard(fn.__name__, operation_args):
            token = None
            if self._is_hosted_runtime():
                controller = self._resolve_operation_controller(
                    fn.__name__,
                    operation_args,
                )
                token = self._controller_context.set(controller)
            try:
                return fn(self, *args, **kwargs)
            finally:
                if token is not None:
                    self._controller_context.reset(token)

    return wrapper


class SessionAPI:
    """Фасад над ComplexSessionController / AdaptiveSessionManager.

    Пока используется только как внутренняя прослойка (без HTTP и без HTML).
    Методы возвращают простые dict-структуры, пригодные для JSON.
    """

    def __init__(
        self,
        session_controller: ComplexSessionController,
        adaptive_session_manager: AdaptiveSessionManager,
        complex_service: ComplexService,
        storage_service: StorageService,
        statistics_service: StatisticsService,
        default_user_id: str = "default_user",
    ) -> None:
        if statistics_service is None:
            raise ValueError("statistics_service is required")
        self._controller_prototype = session_controller
        self._session_manager = adaptive_session_manager
        self._complex_service = complex_service
        self._storage_service = storage_service
        self._statistics_service = statistics_service
        self._default_user_id = default_user_id
        self._controller_context: contextvars.ContextVar[ComplexSessionController] = contextvars.ContextVar(
            "session_api_controller",
            default=session_controller,
        )
        self._hosted_controller_locks: Dict[str, threading.RLock] = {}
        self._hosted_session_controllers: Dict[str, ComplexSessionController] = {}

    @property
    def _controller(self) -> ComplexSessionController:
        return self._controller_context.get()

    @staticmethod
    def _normalize_user_id(value: Optional[str]) -> str:
        return str(value or "").strip()

    @staticmethod
    def _is_hosted_runtime() -> bool:
        return str(os.environ.get("ACTRA_RUNTIME_MODE") or "").strip().lower() == "hosted_web"

    @staticmethod
    def _normalize_session_id(value: Optional[str]) -> str:
        return str(value or "").strip()

    def _build_hosted_guard_key(
        self,
        operation_name: str,
        arguments: Optional[Dict[str, Any]] = None,
    ) -> str:
        args = arguments or {}
        session_id = self._normalize_session_id(args.get("session_id"))
        if session_id:
            return f"session:{session_id}"

        user_id = self._resolve_runtime_user_id(
            args.get("user_id"),
            allow_default_in_hosted=True,
        ) or "anonymous"
        if operation_name == "start_session":
            complex_id = str(args.get("complex_id") or "").strip() or "unknown_complex"
            return f"start:{user_id}:{complex_id}"
        if operation_name == "start_custom_session":
            return f"start_custom:{user_id}"
        return f"operation:{operation_name}:{user_id}"

    def _controller_state_guard(
        self,
        operation_name: str,
        arguments: Optional[Dict[str, Any]] = None,
    ):
        if not self._is_hosted_runtime():
            return nullcontext()
        guard_key = self._build_hosted_guard_key(operation_name, arguments)
        lock = self._hosted_controller_locks.get(guard_key)
        if lock is None:
            lock = threading.RLock()
            self._hosted_controller_locks[guard_key] = lock
        return lock

    def _build_hosted_task_controller(self) -> TaskController:
        prototype_task_controller = getattr(self._controller_prototype, "task_controller", None)
        evaluator_service = getattr(prototype_task_controller, "evaluator_service", None)
        progress_service = getattr(prototype_task_controller, "progress_service", None)
        session_manager = getattr(prototype_task_controller, "session_manager", None)
        difficulty_manager = getattr(prototype_task_controller, "difficulty_manager", None)
        if evaluator_service is None or progress_service is None:
            raise RuntimeError("hosted_task_controller_requires_evaluator_and_progress")

        task_controller_cls = getattr(prototype_task_controller, "__class__", TaskController)
        try:
            return task_controller_cls(
                evaluator_service,
                progress_service,
                session_manager,
                difficulty_manager,
            )
        except TypeError:
            return TaskController(
                evaluator_service,
                progress_service,
                session_manager,
                difficulty_manager,
            )

    def _build_hosted_controller(self) -> ComplexSessionController:
        controller_cls = getattr(self._controller_prototype, "__class__", ComplexSessionController)
        controller = controller_cls(
            session_manager=self._session_manager,
            task_controller=self._build_hosted_task_controller(),
            storage_service=self._storage_service,
            complex_service=self._complex_service,
        )
        for callback_name in (
            "on_task_changed",
            "on_session_completed",
            "on_iteration_completed",
            "on_complex_completed",
            "on_error",
        ):
            if hasattr(self._controller_prototype, callback_name):
                setattr(
                    controller,
                    callback_name,
                    getattr(self._controller_prototype, callback_name),
                )
        return controller

    def _sync_hosted_controller_from_session(
        self,
        controller: ComplexSessionController,
        session_id: str,
        session: Any,
    ) -> ComplexSessionController:
        controller.current_session_id = session_id
        queued_task, queue_index = self._resolve_current_queue_slot(session)
        task_ref = getattr(queued_task, "task_ref", None) if queued_task is not None else None
        if not task_ref:
            ui_state = getattr(session, "ui_state", None) or {}
            if isinstance(ui_state, dict):
                candidate_task_ref = ui_state.get("task_ref")
                if isinstance(candidate_task_ref, str) and candidate_task_ref.strip():
                    task_ref = candidate_task_ref.strip()
                candidate_task_index = ui_state.get("task_index")
                if isinstance(candidate_task_index, int):
                    queue_index = candidate_task_index

        controller.current_task_ref = task_ref
        setattr(controller, "_current_queue_index", queue_index if isinstance(queue_index, int) else None)

        task_controller = getattr(controller, "task_controller", None)
        current_task = getattr(task_controller, "current_task", None)
        loaded_task_ref = getattr(current_task, "full_id", None)
        if loaded_task_ref and loaded_task_ref != task_ref and hasattr(task_controller, "clear_task"):
            task_controller.clear_task()
        return controller

    def _remember_hosted_session_controller(
        self,
        session_id: Optional[str],
        controller: Optional[ComplexSessionController] = None,
    ) -> None:
        normalized_session_id = self._normalize_session_id(session_id)
        if not self._is_hosted_runtime() or not normalized_session_id:
            return

        controller = controller or self._controller
        self._hosted_session_controllers[normalized_session_id] = controller
        session = self.get_session(normalized_session_id)
        if session is not None:
            self._sync_hosted_controller_from_session(controller, normalized_session_id, session)

    def _release_hosted_session_controller(self, session_id: Optional[str]) -> None:
        normalized_session_id = self._normalize_session_id(session_id)
        if not normalized_session_id:
            return
        self._hosted_session_controllers.pop(normalized_session_id, None)

    def _resolve_operation_controller(
        self,
        operation_name: str,
        arguments: Optional[Dict[str, Any]] = None,
    ) -> ComplexSessionController:
        if not self._is_hosted_runtime():
            return self._controller_prototype

        args = arguments or {}
        session_id = self._normalize_session_id(args.get("session_id"))
        if session_id:
            controller = self._hosted_session_controllers.get(session_id)
            if controller is None:
                controller = self._build_hosted_controller()
                self._hosted_session_controllers[session_id] = controller
            session = self.get_session(session_id)
            if session is not None:
                self._sync_hosted_controller_from_session(controller, session_id, session)
            else:
                controller.current_session_id = session_id
            return controller

        _ = operation_name
        return self._build_hosted_controller()

    def _register_linked_runtime_complex(self, complex_id: str, user_id: str) -> bool:
        library_entry_id = parse_linked_runtime_complex_id(complex_id)
        if not library_entry_id:
            return False

        from routes._context import get_ctx
        from task_system.core.models.complex_models import Complex
        from task_system.core.schemas.complex_schema import ComplexSchema

        detail = get_ctx().catalog_service.get_complex_library_entry(
            library_entry_id,
            requested_by_user_id=user_id,
        )
        library_entry = detail.get("library_entry") if isinstance(detail, dict) else {}
        if str((library_entry or {}).get("access_state") or "").strip().lower() != "active":
            raise ValueError("complex_library_entry_not_accessible")

        snapshot = detail.get("snapshot") if isinstance(detail, dict) else {}
        snapshot_complex = snapshot.get("complex") if isinstance(snapshot, dict) else {}
        if not isinstance(snapshot_complex, dict):
            raise ValueError("complex_library_snapshot_missing")

        payload = copy.deepcopy(snapshot_complex)
        payload["id"] = complex_id
        payload["name"] = str(payload.get("name") or "Linked complex").strip() or "Linked complex"
        payload["description"] = str(payload.get("description") or "").strip()
        payload["tasks"] = list(payload.get("tasks") or [])
        payload["chains"] = list(payload.get("chains") or [])
        payload["settings"] = dict(payload.get("settings") or {})
        payload["created_via"] = "catalog_linked"
        payload["content_scope"] = "linked_library"
        payload["linked_library_entry_id"] = library_entry_id
        payload["linked_library_access_state"] = "active"
        payload["linked_library_access_reason"] = library_entry.get("access_reason")
        payload["linked_library_resolved_version_id"] = library_entry.get("resolved_version_id")
        payload["source_catalog_item_id"] = (detail.get("item") or {}).get("item_id") if isinstance(detail.get("item"), dict) else None

        ComplexSchema.validate_or_raise(payload)
        runtime_complex = Complex(**payload)
        if hasattr(self._complex_service, "_complexes_cache"):
            self._complex_service._complexes_cache[complex_id] = runtime_complex  # type: ignore[attr-defined]
            logger.info(
                "[SessionAPI] Registered linked runtime complex in memory: complex_id=%s library_entry_id=%s",
                complex_id,
                library_entry_id,
            )
            return True
        return False

    def _ensure_runtime_complex_available(self, complex_id: str, user_id: str) -> bool:
        normalized_complex_id = str(complex_id or "").strip()
        if not normalized_complex_id:
            return False
        if self._complex_service.get_complex(normalized_complex_id):
            return True
        if parse_linked_runtime_complex_id(normalized_complex_id):
            return self._register_linked_runtime_complex(normalized_complex_id, user_id)
        return False

    def _resolve_runtime_user_id(
        self,
        user_id: Optional[str] = None,
        *,
        allow_default_in_hosted: bool = False,
    ) -> Optional[str]:
        """Resolve user id for the current runtime without silent hosted fallback.

        In hosted runtime we only allow the legacy ``default_user_id`` fallback
        when the caller explicitly opts in. This keeps desktop/test
        compatibility while preventing web requests from silently drifting into
        ``default_user`` semantics.
        """
        explicit_user_id = self._normalize_user_id(user_id)
        if explicit_user_id:
            return explicit_user_id

        default_user_id = self._normalize_user_id(self._default_user_id)
        if self._is_hosted_runtime() and not allow_default_in_hosted:
            return None
        return default_user_id or None

    @property
    def default_user_id(self) -> str:
        """Legacy compatibility accessor for desktop/test user rebinding only."""
        return self._default_user_id

    @default_user_id.setter
    def default_user_id(self, value: Optional[str]) -> None:
        self._default_user_id = str(value or "").strip() or "default_user"

    # ------------------------------------------------------------------
    # Базовые операции сессии
    # ------------------------------------------------------------------

    @_hosted_controller_serialized
    def start_session(self, complex_id: str, user_id: Optional[str] = None, start_iteration: int = 1) -> Dict[str, Any]:
        """Запустить новую сессию комплекса и вернуть её краткие данные.

        Поведение контроллера не меняем: он сам создаёт сессию и загружает
        первое задание. Здесь только оборачиваем в dict.
        """
        user_id = self._resolve_runtime_user_id(user_id)
        if not user_id:
            return {
                "ok": False,
                "error": "user_id_required",
                "complex_id": complex_id,
            }

        # GUEST MODE PROTECTION: запретить запуск сессии для гостя
        if user_id == "guest":
            logger.warning("[SessionAPI.start_session] Rejecting session start for guest user, complex_id=%s", complex_id)
            return {
                "ok": False,
                "error": "guest_cannot_start_session",
                "complex_id": complex_id,
                "user_id": "guest",
            }

        logger.info("[SessionAPI.start_session] complex_id=%s, user_id=%s, start_iteration=%s", complex_id, user_id, start_iteration)

        try:
            if not self._ensure_runtime_complex_available(complex_id, user_id):
                return {
                    "ok": False,
                    "error": "complex_not_found",
                    "complex_id": complex_id,
                    "user_id": user_id,
                }
        except ValueError as exc:
            return {
                "ok": False,
                "error": str(exc),
                "complex_id": complex_id,
                "user_id": user_id,
            }

        success = self._controller.start_session(complex_id, user_id, start_iteration=start_iteration)
        if not success or not self._controller.current_session_id:
            return {
                "ok": False,
                "error": "failed_to_start_session",
                "complex_id": complex_id,
                "user_id": user_id,
            }

        session_id = self._controller.current_session_id
        self._remember_hosted_session_controller(session_id)
        session = self._session_manager.get_session(session_id)
        stats = self._controller.get_current_session_stats() or {}

        return {
            "ok": True,
            "session_id": session_id,
            "complex_id": complex_id,
            "user_id": getattr(session, "user_id", user_id) if session else user_id,
            "iteration": stats.get("current_iter"),
            "progress": stats.get("progress"),
            "queue": {
                "index": stats.get("index_in_queue"),
                "total": stats.get("total_in_queue"),
            },
        }

    @_hosted_controller_serialized
    def start_custom_session(self, task_refs: List[str], user_id: Optional[str] = None) -> Dict[str, Any]:
        """Запустить кастомную сессию с заданным списком task_ref (для daily_mix).

        Создаёт ComplexSession с синтетическим complex_id="daily_mix" и формирует
        очередь из переданных task_ref в заданном порядке.

        Args:
            task_refs: Список task_ref в формате module/topic/task_id
            user_id: ID пользователя

        Returns:
            dict: {ok, session_id, ...} или {ok: False, error}
        """
        user_id = self._resolve_runtime_user_id(user_id)
        if not user_id:
            return {
                "ok": False,
                "error": "user_id_required",
            }

        if not task_refs:
            return {
                "ok": False,
                "error": "empty_task_refs",
                "user_id": user_id,
            }

        logger.info("[SessionAPI.start_custom_session] ========== НАЧАЛО start_custom_session ==========")
        logger.info("[SessionAPI.start_custom_session] task_refs=%s, user_id=%s", task_refs, user_id)

        try:
            from task_system.core.models.complex_models import ComplexSession, QueuedTask
            from datetime import datetime
            import uuid

            # Создаём синтетическую сессию с complex_id="daily_mix"
            session_id = str(uuid.uuid4())
            
            # Формируем очередь из task_ref с дефолтной сложностью 1
            queue = [
                QueuedTask(
                    task_ref=task_ref,
                    difficulty=1,
                    is_retry=False
                )
                for task_ref in task_refs
            ]

            now_dt = datetime.utcnow()
            session = ComplexSession(
                id=session_id,
                complex_id="daily_mix",
                user_id=user_id,
                start_time=now_dt,
                iteration=1,
                current_task_index=0,  # стартуем с первого задания (индекс 0)
                queue=queue,
                completed_tasks=[],
                is_active=True,
            )

            logger.info("[SessionAPI.start_custom_session] Created session object: id=%s, queue_length=%s, current_task_index=%s", session_id, len(queue), session.current_task_index)

            # Сохраняем сессию в репозиторий
            if self._session_manager.session_repository:
                self._session_manager.session_repository.save_session(session, user_id)
                logger.info("[SessionAPI.start_custom_session] Session saved to repository")

            # Регистрируем в активных сессиях менеджера
            self._session_manager._active_sessions[session_id] = session
            logger.info("[SessionAPI.start_custom_session] Session registered in active sessions")

            # Устанавливаем текущую сессию в контроллере
            self._controller.current_session_id = session_id
            self._controller.current_task_ref = None
            logger.info("[SessionAPI.start_custom_session] Controller session_id set to %s", session_id)

            # Загружаем первое задание через контроллер (не сдвигая индекс)
            logger.info("[SessionAPI.start_custom_session] Loading first task via _load_current_task()...")
            try:
                self._controller._load_current_task()
                logger.info("[SessionAPI.start_custom_session] First task loaded successfully, current_task_ref=%s", self._controller.current_task_ref)
            except Exception as e:
                logger.warning("[SessionAPI.start_custom_session] Failed to load first task: %s", e, exc_info=True)

            # Не двигаем current_task_index: queue[0] уже загружен, индекс обновится после submit_result.
            self._remember_hosted_session_controller(session_id)

            # Регистрируем synthetic Complex для daily_mix только в памяти (без сохранения на диск)
            try:
                if self._complex_service:
                    from task_system.core.models.complex_models import Complex
                    synthetic_complex = Complex(
                        id="daily_mix",
                        name="Daily Mix",
                        description="Synthetic daily mix",
                        tasks=task_refs,
                        created_at=now_dt,
                        updated_at=now_dt,
                    )
                    # используем внутренний кэш complex_service без записи файла
                    if hasattr(self._complex_service, "_complexes_cache"):
                        self._complex_service._complexes_cache["daily_mix"] = synthetic_complex  # type: ignore[attr-defined]
                        logger.info("[SessionAPI.start_custom_session] Synthetic complex 'daily_mix' registered in memory with %s tasks", len(task_refs))
            except Exception:
                logger.warning("[SessionAPI.start_custom_session] Failed to register synthetic daily_mix complex in memory", exc_info=True)

            result = {
                "ok": True,
                "session_id": session_id,
                "complex_id": "daily_mix",
                "user_id": user_id,
                "iteration": 1,
                "queue": {
                    "index": 0,
                    "total": len(queue),
                },
            }
            logger.info("[SessionAPI.start_custom_session] ========== КОНЕЦ start_custom_session: result=%s ==========", result)
            return result

        except Exception as e:
            logger.exception("[SessionAPI.start_custom_session] Failed to create custom session")
            return {
                "ok": False,
                "error": str(e),
                "user_id": user_id,
            }

    @staticmethod
    def _infer_user_id_from_session_id(session_id: Optional[str]) -> Optional[str]:
        normalized = str(session_id or "").strip()
        if not normalized.startswith("session_"):
            return None

        remainder = normalized[len("session_"):]
        if not remainder:
            return None

        try:
            inferred_user_id, timestamp_part = remainder.rsplit("_", 1)
        except ValueError:
            return None

        if not inferred_user_id:
            return None

        try:
            float(timestamp_part)
        except Exception:
            return None

        return inferred_user_id

    def _build_session_lookup_user_ids(
        self,
        session_id: str,
        preferred_user_id: Optional[str] = None,
    ) -> List[str]:
        candidates: List[str] = []
        default_candidate = self._resolve_runtime_user_id(
            None,
            allow_default_in_hosted=False,
        )
        for candidate in (
            preferred_user_id,
            default_candidate,
            self._infer_user_id_from_session_id(session_id),
        ):
            normalized = str(candidate or "").strip()
            if normalized and normalized not in candidates:
                candidates.append(normalized)
        return candidates

    def get_session(self, session_id: str, user_id: Optional[str] = None) -> Optional[Any]:
        """Вернуть объект ComplexSession (активный или загруженный)."""
        session = self._session_manager.get_session(session_id)
        if session:
            requested_user_id = str(user_id or "").strip()
            session_user_id = str(getattr(session, "user_id", "") or "").strip()
            if requested_user_id and session_user_id and session_user_id != requested_user_id:
                logger.warning(
                    "[SessionAPI.get_session] session ownership mismatch: session_id=%s requested_user=%s actual_user=%s",
                    session_id,
                    requested_user_id,
                    session_user_id,
                )
                return None
            try:
                self._ensure_runtime_complex_available(
                    str(getattr(session, "complex_id", "") or "").strip(),
                    session_user_id or requested_user_id,
                )
            except Exception:
                logger.warning(
                    "[SessionAPI.get_session] Failed to ensure runtime complex for active session %s",
                    session_id,
                    exc_info=True,
                )
            return session

        repo = getattr(self._session_manager, "session_repository", None)
        if repo is None:
            return None

        for candidate_user_id in self._build_session_lookup_user_ids(
            session_id,
            preferred_user_id=user_id,
        ):
            try:
                loaded = repo.load_session_by_session_id(
                    user_id=candidate_user_id,
                    session_id=session_id,
                )
            except Exception:
                logger.exception(
                    "[SessionAPI.get_session] Failed to load session by id %s for user %s",
                    session_id,
                    candidate_user_id,
                )
                continue
            if loaded is not None:
                normalized = self.mark_interrupted_session_as_paused(
                    loaded,
                    persist=True,
                    source="repository_restore",
                )
                try:
                    normalized_user_id = str(getattr(normalized, "user_id", "") or candidate_user_id).strip()
                    self._ensure_runtime_complex_available(
                        str(getattr(normalized, "complex_id", "") or "").strip(),
                        normalized_user_id,
                    )
                except Exception:
                    logger.warning(
                        "[SessionAPI.get_session] Failed to ensure runtime complex for restored session %s",
                        session_id,
                        exc_info=True,
                    )
                return normalized

        return None

    @staticmethod
    def _coerce_session_datetime(value: Any) -> Optional[datetime]:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except Exception:
                return None
        return None

    def _infer_interrupted_pause_timestamp(self, session: Any) -> datetime:
        candidates: List[datetime] = []
        ui_state = getattr(session, "ui_state", None) or {}
        if isinstance(ui_state, dict):
            for key in ("last_updated", "updated_at"):
                coerced = self._coerce_session_datetime(ui_state.get(key))
                if coerced is not None:
                    candidates.append(coerced)

        for value in (
            getattr(session, "paused_at", None),
            getattr(session, "last_resumed_at", None),
            getattr(session, "start_time", None),
        ):
            coerced = self._coerce_session_datetime(value)
            if coerced is not None:
                candidates.append(coerced)

        if not candidates:
            return datetime.utcnow()
        return max(candidates)

    def mark_interrupted_session_as_paused(
        self,
        session: Any,
        *,
        persist: bool = True,
        source: str = "unexpected_shutdown",
    ) -> Any:
        if not session:
            return session

        session_id = str(getattr(session, "id", "") or "").strip()
        active_sessions = getattr(self._session_manager, "_active_sessions", None)
        if session_id and isinstance(active_sessions, dict) and session_id in active_sessions:
            return active_sessions.get(session_id) or session

        if not getattr(session, "is_active", False) or getattr(session, "paused", False):
            return session

        session.paused = True
        session.paused_at = self._infer_interrupted_pause_timestamp(session)
        try:
            session.paused_resume_target = self.get_resume_target(session)
        except Exception:
            logger.exception(
                "[SessionAPI.mark_interrupted_session_as_paused] Failed to rebuild resume target for session %s",
                session_id,
            )
        try:
            session.pause_reason = str(source or "unexpected_shutdown").strip() or "unexpected_shutdown"
        except Exception:
            pass

        if persist:
            repo = getattr(self._session_manager, "session_repository", None)
            if repo is not None:
                try:
                    session_user_id = self._resolve_runtime_user_id(
                        getattr(session, "user_id", None),
                        allow_default_in_hosted=False,
                    )
                    if not session_user_id:
                        logger.warning(
                            "[SessionAPI.mark_interrupted_session_as_paused] Missing user_id for persisted session %s",
                            session_id,
                        )
                        return session
                    repo.save_session(
                        session,
                        session_user_id,
                    )
                except Exception:
                    logger.exception(
                        "[SessionAPI.mark_interrupted_session_as_paused] Failed to persist interrupted session %s",
                        session_id,
                    )

        logger.info(
            "[SessionAPI.mark_interrupted_session_as_paused] Marked repository-restored active session as paused: session_id=%s source=%s",
            session_id,
            source,
        )
        return session

    def _find_queue_index_by_task_ref(self, session: Any, task_ref: Optional[str]) -> Optional[int]:
        if not session or not isinstance(getattr(session, "queue", None), list) or not task_ref:
            return None

        queue = session.queue
        if not queue:
            return None

        matching_indices = [
            idx for idx, queued_task in enumerate(queue)
            if getattr(queued_task, "task_ref", None) == task_ref
        ]
        if not matching_indices:
            return None

        current_index = getattr(session, "current_task_index", 0)
        if not isinstance(current_index, int):
            current_index = 0

        if getattr(session, "complex_id", None) == "daily_mix":
            return min(matching_indices, key=lambda idx: (abs(idx - current_index), idx))

        logical_current_index = max(0, current_index - 1)
        at_or_before = [idx for idx in matching_indices if idx <= logical_current_index]
        if at_or_before:
            return max(at_or_before)
        return min(matching_indices)

    def _count_queue_occurrences(self, session: Any, task_ref: Optional[str]) -> int:
        if not session or not isinstance(getattr(session, "queue", None), list) or not task_ref:
            return 0
        return sum(
            1
            for queued_task in session.queue
            if getattr(queued_task, "task_ref", None) == task_ref
        )

    def _queue_occurrence_ordinal(
        self,
        session: Any,
        task_ref: Optional[str],
        queue_index: Optional[int],
    ) -> Optional[int]:
        if (
            not session
            or not isinstance(getattr(session, "queue", None), list)
            or not task_ref
            or not isinstance(queue_index, int)
            or queue_index < 0
        ):
            return None

        queue = session.queue
        if queue_index >= len(queue):
            return None

        ordinal = 0
        for idx, queued_task in enumerate(queue):
            if idx > queue_index:
                break
            if getattr(queued_task, "task_ref", None) == task_ref:
                ordinal += 1
        return ordinal or None

    def _count_completed_attempts(
        self,
        session: Any,
        task_ref: Optional[str],
        *,
        iteration: Optional[int] = None,
    ) -> int:
        if not session or not task_ref:
            return 0

        completed_tasks = getattr(session, "completed_tasks", None) or []
        count = 0
        for result in completed_tasks:
            if getattr(result, "task_ref", None) != task_ref:
                continue
            if iteration is not None and getattr(result, "iteration_index", None) != iteration:
                continue
            count += 1
        return count

    def _can_restore_completed_result_for_slot(
        self,
        session: Any,
        task_ref: Optional[str],
        queue_index: Optional[int],
    ) -> bool:
        """Only restore fallback results for the exact queue occurrence already attempted."""
        if not session or not task_ref:
            return False

        ordinal = self._queue_occurrence_ordinal(session, task_ref, queue_index)
        if ordinal is None:
            return self._count_queue_occurrences(session, task_ref) <= 1

        current_iteration = getattr(session, "iteration", None)
        completed_attempts = self._count_completed_attempts(
            session,
            task_ref,
            iteration=current_iteration,
        )
        return completed_attempts >= ordinal

    def _current_task_is_checked(self, session: Any) -> bool:
        if not session:
            return False

        session_ui_state = getattr(session, "ui_state", None) or {}
        screen_type = session_ui_state.get("screen_type") if isinstance(session_ui_state, dict) else None
        if screen_type not in {"task", "task_results"}:
            return True

        queued_task, queue_index = self._resolve_current_queue_slot(session)
        task_ref = getattr(queued_task, "task_ref", None) if queued_task is not None else None
        if not task_ref:
            task_ref = getattr(self._controller, "current_task_ref", None)
        if not task_ref:
            return False

        if queue_index is None:
            queue_index = self._find_queue_index_by_task_ref(session, task_ref)

        return self._can_restore_completed_result_for_slot(session, task_ref, queue_index)

    def _build_resolution_snapshot(
        self,
        session: Any,
        *,
        resolved_task: Optional[Any] = None,
        resolved_index: Optional[int] = None,
    ) -> Dict[str, Any]:
        ui_state = getattr(session, "ui_state", None) or {}
        return {
            "session_id": getattr(session, "id", None),
            "current_task_index": getattr(session, "current_task_index", None),
            "controller_task_ref": getattr(self._controller, "current_task_ref", None),
            "controller_task_index": getattr(self._controller, "_current_queue_index", None),
            "ui_screen_type": ui_state.get("screen_type") if isinstance(ui_state, dict) else None,
            "ui_task_ref": ui_state.get("task_ref") if isinstance(ui_state, dict) else None,
            "ui_task_index": ui_state.get("task_index") if isinstance(ui_state, dict) else None,
            "resolved_task_ref": getattr(resolved_task, "task_ref", None) if resolved_task is not None else None,
            "resolved_task_index": resolved_index,
        }

    def get_resume_target(self, session: Any) -> Dict[str, Any]:
        session_id = str(getattr(session, "id", "") or "").strip()
        session_url = f"/ui/session/{quote(session_id, safe='')}" if session_id else "/ui/complexes"
        target: Dict[str, Any] = {
            "screen_type": "task",
            "url": session_url,
        }

        paused_resume_target = getattr(session, "paused_resume_target", None)
        if isinstance(paused_resume_target, dict):
            snapshot_url = paused_resume_target.get("url")
            snapshot_screen_type = paused_resume_target.get("screen_type")
            if isinstance(snapshot_url, str) and snapshot_url.strip():
                normalized_target = {
                    "url": snapshot_url.strip(),
                    "screen_type": str(snapshot_screen_type or "task").strip() or "task",
                }
                if isinstance(paused_resume_target.get("task_ref"), str) and paused_resume_target.get("task_ref").strip():
                    normalized_target["task_ref"] = paused_resume_target.get("task_ref").strip()
                if isinstance(paused_resume_target.get("task_index"), int):
                    normalized_target["task_index"] = paused_resume_target.get("task_index")
                if isinstance(paused_resume_target.get("iteration_number"), int):
                    normalized_target["iteration_number"] = paused_resume_target.get("iteration_number")
                return normalized_target

        ui_state = getattr(session, "ui_state", None) or {}
        if not isinstance(ui_state, dict):
            return target

        screen_type = str(ui_state.get("screen_type") or "").strip()
        if screen_type in {"task", "task_results"}:
            target["screen_type"] = screen_type
            task_ref = ui_state.get("task_ref")
            task_index = ui_state.get("task_index")
            if isinstance(task_ref, str) and task_ref.strip():
                target["task_ref"] = task_ref
            if isinstance(task_index, int):
                target["task_index"] = task_index
            return target

        if screen_type == "iteration_results":
            iteration_number = ui_state.get("iteration_number")
            try:
                normalized_iteration = int(iteration_number)
            except Exception:
                normalized_iteration = None

            if normalized_iteration is not None and normalized_iteration > 0:
                return {
                    "screen_type": "iteration_results",
                    "iteration_number": normalized_iteration,
                    "url": f"{session_url}/iteration/{quote(str(normalized_iteration), safe='')}",
                }

        if screen_type == "final_results":
            return {
                "screen_type": "final_results",
                "url": f"{session_url}/results",
            }

        return target

    def _resolve_requested_queue_slot(
        self,
        session: Any,
        *,
        task_ref: Optional[str] = None,
        task_index: Optional[int] = None,
    ) -> Any:
        if not session or not isinstance(getattr(session, "queue", None), list):
            return None, None

        queue = session.queue
        if not queue:
            return None, None

        if isinstance(task_index, int) and 0 <= task_index < len(queue):
            queued_task = queue[task_index]
            queued_task_ref = getattr(queued_task, "task_ref", None)
            if not task_ref or queued_task_ref == task_ref:
                return queued_task, task_index

        resolved_index = self._find_queue_index_by_task_ref(session, task_ref)
        if isinstance(resolved_index, int) and 0 <= resolved_index < len(queue):
            return queue[resolved_index], resolved_index

        return None, None

    def _resolve_current_queue_slot(self, session: Any) -> Any:
        if not session or not isinstance(getattr(session, "queue", None), list):
            return None, None

        queue = session.queue
        if not queue:
            return None, None

        progress_task, progress_index = self._resolve_active_queue_slot_from_progress(session)

        ui_state = getattr(session, "ui_state", None) or {}
        if isinstance(ui_state, dict) and ui_state.get("screen_type") in {"task", "task_results"}:
            ui_task_ref = ui_state.get("task_ref")
            ui_task_index = ui_state.get("task_index")
            if isinstance(ui_task_index, int) and 0 <= ui_task_index < len(queue):
                if progress_index is not None and ui_task_index < progress_index:
                    logger.info(
                        "[SessionAPI._resolve_current_queue_slot] Ignoring stale ui_state slot index=%s below active progress index=%s",
                        ui_task_index,
                        progress_index,
                    )
                else:
                    queued_task = queue[ui_task_index]
                    if not ui_task_ref or getattr(queued_task, "task_ref", None) == ui_task_ref:
                        return queued_task, ui_task_index
                    logger.warning(
                        "[SessionAPI._resolve_current_queue_slot] ui_state mismatch: task_index=%s -> %s, ui_task_ref=%s; falling back to task_ref lookup/current index",
                        ui_task_index,
                        getattr(queued_task, "task_ref", None),
                        ui_task_ref,
                    )
            ui_index = self._find_queue_index_by_task_ref(session, ui_task_ref)
            if ui_index is not None and 0 <= ui_index < len(queue):
                if progress_index is not None and ui_index < progress_index:
                    logger.info(
                        "[SessionAPI._resolve_current_queue_slot] Ignoring stale ui_state task_ref=%s resolved to index=%s below active progress index=%s",
                        ui_task_ref,
                        ui_index,
                        progress_index,
                    )
                else:
                    return queue[ui_index], ui_index

        if progress_task is not None and progress_index is not None:
            return progress_task, progress_index

        return None, None

    def _resolve_active_queue_slot_from_progress(self, session: Any) -> Any:
        if not session or not isinstance(getattr(session, "queue", None), list):
            return None, None

        queue = session.queue
        if not queue:
            return None, None

        current_index = getattr(session, "current_task_index", 0)
        if not isinstance(current_index, int):
            current_index = 0

        if getattr(session, "complex_id", None) == "daily_mix":
            effective_index = max(0, min(current_index, len(queue) - 1))
        else:
            effective_index = max(0, current_index - 1)
            if effective_index >= len(queue):
                effective_index = len(queue) - 1

        if 0 <= effective_index < len(queue):
            return queue[effective_index], effective_index

        return None, None

    def _persist_task_ui_state(
        self,
        session: Any,
        session_id: str,
        current_task_ref: Optional[str],
        queue_index: Optional[int],
        user_input: Optional[Dict[str, Any]] = None,
        evaluation_result: Optional[Dict[str, Any]] = None,
        view_state: Optional[Dict[str, Any]] = None,
        *,
        force: bool = False,
    ) -> bool:
        if not session or not current_task_ref or not hasattr(self._controller, "save_ui_state"):
            return False

        self._controller.current_session_id = session_id
        self._controller.current_task_ref = current_task_ref
        if isinstance(queue_index, int):
            setattr(self._controller, "_current_queue_index", queue_index)

        existing_ui_state = getattr(session, "ui_state", None) or {}
        can_preserve_existing_task_state = (
            isinstance(existing_ui_state, dict)
            and existing_ui_state.get("screen_type") in ("task", "task_results")
            and (
                not existing_ui_state.get("task_ref")
                or existing_ui_state.get("task_ref") == current_task_ref
            )
        )
        # Preserve a previously checked screen only when the caller did not
        # provide any fresh task snapshot. If new draft input/view state arrives
        # without an explicit evaluation_result, treat it as an in-progress task
        # instead of reviving stale check feedback on reload.
        preserve_results_state = (
            can_preserve_existing_task_state
            and existing_ui_state.get("screen_type") == "task_results"
            and user_input is None
            and view_state is None
            and evaluation_result is None
        )
        save_kwargs = {
            "force": force,
            "task_ref": current_task_ref,
            "task_index": queue_index,
        }
        if isinstance(user_input, dict):
            save_kwargs["user_input"] = user_input
        if isinstance(view_state, dict):
            save_kwargs["view_state"] = view_state

        screen_type = "task"
        if isinstance(evaluation_result, dict):
            screen_type = "task_results"
            save_kwargs["evaluation_result"] = evaluation_result
        elif preserve_results_state:
            screen_type = "task_results"
            if "evaluation_result" in existing_ui_state:
                save_kwargs["evaluation_result"] = existing_ui_state.get("evaluation_result")
            if user_input is None and isinstance(existing_ui_state.get("user_input"), dict):
                save_kwargs["user_input"] = existing_ui_state.get("user_input")
        if (
            view_state is None
            and can_preserve_existing_task_state
            and isinstance(existing_ui_state.get("view_state"), dict)
        ):
            save_kwargs["view_state"] = existing_ui_state.get("view_state")

        self._controller.save_ui_state(screen_type, **save_kwargs)
        return True

    def _sync_controller_task_ref_from_session(self, session: Any) -> Optional[str]:
        queued_task, queue_index = self._resolve_current_queue_slot(session)
        task_ref = getattr(queued_task, "task_ref", None) if queued_task is not None else None
        if task_ref:
            self._controller.current_task_ref = task_ref
        if queue_index is not None:
            setattr(self._controller, "_current_queue_index", queue_index)
        return task_ref

    def _restore_session_from_repository_if_needed(self, session_id: str, session: Any) -> bool:
        if not session:
            return False
        if self._session_manager.get_session(session_id):
            return True
        try:
            self._session_manager.restore_session(session)
            return True
        except Exception:
            logger.exception(
                "[SessionAPI] Failed to restore session %s from repository snapshot",
                session_id,
            )
            return False

    @_hosted_controller_serialized
    def pause_session(
        self,
        session_id: str,
        user_id: Optional[str] = None,
        user_input: Optional[Dict[str, Any]] = None,
        evaluation_result: Optional[Dict[str, Any]] = None,
        view_state: Optional[Dict[str, Any]] = None,
        task_ref: Optional[str] = None,
        task_index: Optional[int] = None,
        resume_target: Optional[Dict[str, Any]] = None,
    ) -> None:
        session = self.get_session(session_id, user_id=user_id)
        if not session:
            return
        if not self._restore_session_from_repository_if_needed(session_id, session):
            return
        try:
            explicit_resume_target = None
            if isinstance(resume_target, dict):
                candidate_url = resume_target.get("url")
                candidate_screen_type = resume_target.get("screen_type")
                if isinstance(candidate_url, str) and candidate_url.strip():
                    explicit_resume_target = {
                        "url": candidate_url.strip(),
                        "screen_type": str(candidate_screen_type or "task").strip() or "task",
                    }
                    if isinstance(resume_target.get("task_ref"), str) and resume_target.get("task_ref").strip():
                        explicit_resume_target["task_ref"] = resume_target.get("task_ref").strip()
                    if isinstance(resume_target.get("task_index"), int):
                        explicit_resume_target["task_index"] = resume_target.get("task_index")
                    if isinstance(resume_target.get("iteration_number"), int):
                        explicit_resume_target["iteration_number"] = resume_target.get("iteration_number")

            existing_ui_state = getattr(session, "ui_state", None) or {}
            existing_screen_type = (
                existing_ui_state.get("screen_type")
                if isinstance(existing_ui_state, dict)
                else None
            )
            preserve_non_task_screen = (
                existing_screen_type in {"iteration_results", "final_results"}
                and task_ref is None
                and task_index is None
                and user_input is None
                and evaluation_result is None
                and view_state is None
            )
            if preserve_non_task_screen:
                logger.info(
                    "[SessionAPI.pause_session] Keeping existing non-task ui_state during pause session_id=%s screen_type=%s",
                    session_id,
                    existing_screen_type,
                )
            else:
                requested_task, requested_index = self._resolve_requested_queue_slot(
                    session,
                    task_ref=task_ref,
                    task_index=task_index,
                )
                current_task_ref = getattr(requested_task, "task_ref", None) if requested_task is not None else None
                queue_index = requested_index if requested_task is not None else None
                if current_task_ref:
                    self._controller.current_task_ref = current_task_ref
                if isinstance(queue_index, int):
                    setattr(self._controller, "_current_queue_index", queue_index)

                if not current_task_ref:
                    current_task_ref = self._sync_controller_task_ref_from_session(session)
                    queue_index = getattr(self._controller, "_current_queue_index", None)

                logger.info(
                    "[SessionAPI.pause_session] Persisting pause snapshot session_id=%s requested_task_ref=%s requested_task_index=%s snapshot=%s",
                    session_id,
                    task_ref,
                    task_index,
                    self._build_resolution_snapshot(
                        session,
                        resolved_task=requested_task,
                        resolved_index=queue_index,
                    ),
                )

                if current_task_ref:
                    self._persist_task_ui_state(
                        session,
                        session_id,
                        current_task_ref,
                        queue_index,
                        user_input=user_input,
                        evaluation_result=evaluation_result,
                        view_state=view_state,
                        force=True,
                    )
            # Always rebuild the stored pause snapshot from the latest UI/task state.
            # Otherwise a stale paused_resume_target from an older pause (for example
            # iteration results) can incorrectly override a newer pause on a task screen.
            session.paused_resume_target = None
            session.paused_resume_target = explicit_resume_target or self.get_resume_target(session)
        except Exception:
            logger.exception("[SessionAPI.pause_session] Failed to persist current task input before pause")
        self._session_manager.pause_session(session_id)

    @_hosted_controller_serialized
    def save_task_ui_state(
        self,
        session_id: str,
        *,
        task_ref: Optional[str] = None,
        task_index: Optional[int] = None,
        user_input: Optional[Dict[str, Any]] = None,
        evaluation_result: Optional[Dict[str, Any]] = None,
        view_state: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        session = self.get_session(session_id, user_id=user_id)
        if not session:
            return {"ok": False, "error": "session_not_found"}
        if getattr(session, "paused", False):
            return {"ok": False, "error": "session_paused"}

        active_task, active_index = self._resolve_active_queue_slot_from_progress(session)
        active_task_ref = getattr(active_task, "task_ref", None) if active_task is not None else None
        if active_task is None or active_index is None or not active_task_ref:
            return {"ok": False, "error": "active_task_not_found"}

        if isinstance(task_index, int):
            if task_index != active_index:
                return {
                    "ok": False,
                    "error": "stale_task",
                    "active_task_ref": active_task_ref,
                    "active_task_index": active_index,
                }
        if task_ref and task_ref != active_task_ref:
            return {
                "ok": False,
                "error": "stale_task",
                "active_task_ref": active_task_ref,
                "active_task_index": active_index,
            }

        try:
            saved = self._persist_task_ui_state(
                session,
                session_id,
                active_task_ref,
                active_index,
                user_input=user_input,
                evaluation_result=evaluation_result,
                view_state=view_state,
                force=False,
            )
            if not saved:
                return {"ok": False, "error": "save_failed"}
            return {
                "ok": True,
                "saved": True,
                "task_ref": active_task_ref,
                "task_index": active_index,
            }
        except Exception:
            logger.exception("[SessionAPI.save_task_ui_state] Failed to persist current task UI state")
            return {"ok": False, "error": "save_failed"}

    @_hosted_controller_serialized
    def resume_session(
        self,
        session_id: str,
        user_id: Optional[str] = None,
        source: Optional[str] = None,
    ) -> Optional[Any]:
        session = self.get_session(session_id, user_id=user_id)
        resolved_user_id = self._resolve_runtime_user_id(
            getattr(session, "user_id", None) or user_id,
            allow_default_in_hosted=False,
        )
        if not resolved_user_id:
            logger.warning(
                "[SessionAPI.resume_session] Missing user_id for session_id=%s in current runtime",
                session_id,
            )
            return None
        resume_source = str(source or "unknown").strip() or "unknown"
        try:
            resumed = self._session_manager.resume_session(
                session_id,
                resolved_user_id,
                source=resume_source,
            )
        except TypeError:
            # Backward-compatible path for tests or legacy adapters that still
            # expose the older ``resume_session(session_id, user_id)`` contract.
            resumed = self._session_manager.resume_session(
                session_id,
                resolved_user_id,
            )
        if resumed:
            self._controller.current_session_id = session_id
            try:
                resolved_task, resolved_index = self._resolve_current_queue_slot(resumed)
                self._sync_controller_task_ref_from_session(resumed)
                logger.info(
                    "[SessionAPI.resume_session] Session resumed source=%s snapshot=%s",
                    resume_source,
                    self._build_resolution_snapshot(
                        resumed,
                        resolved_task=resolved_task,
                        resolved_index=resolved_index,
                    ),
                )
            except Exception:
                logger.exception("[SessionAPI.resume_session] Failed to sync controller task_ref")
        return resumed

    @_hosted_controller_serialized
    def get_current_task(
        self,
        session_id: str,
        auto_resume: bool = False,
        resume_source: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Вернуть описание текущего задания для активной сессии.

        Если session_id не совпадает с текущей сессией контроллера, ничего не делаем.
        """
        if not session_id:
            return None

        session = self.get_session(session_id, user_id=user_id)
        if session and not getattr(session, "is_active", True):
            logger.warning("[SessionAPI.get_current_task] session %s is not active -> None", session_id)
            return None
        if not session and auto_resume:
            session = self.resume_session(
                session_id,
                user_id=user_id,
                source=resume_source or "get_current_task_auto_resume_missing_session",
            )
        if not session:
            return None
        if not self._restore_session_from_repository_if_needed(session_id, session):
            return None

        if session.paused and auto_resume:
            session.paused = False
            session.paused_at = None
            session.paused_resume_target = None
            session.last_resume_source = (
                str(resume_source or "get_current_task_auto_resume_existing_session").strip()
                or "get_current_task_auto_resume_existing_session"
            )
            session.last_resumed_at = datetime.utcnow()
            try:
                self._session_manager.session_repository.save_session(session, session.user_id)
                logger.info(
                    "[SessionAPI.get_current_task] Auto-resumed paused session_id=%s source=%s",
                    session_id,
                    session.last_resume_source,
                )
            except Exception:
                logger.exception("[SessionAPI.get_current_task] Failed to persist auto-resume state")

        if session_id != self._controller.current_session_id:
            logger.warning("[SessionAPI.get_current_task] session_id mismatch: api=%s, controller=%s -> syncing", session_id, self._controller.current_session_id)
            self._controller.current_session_id = session_id
            # Попробуем восстановить task_ref из очереди
            try:
                self._sync_controller_task_ref_from_session(session)
            except Exception:
                logger.exception("[SessionAPI.get_current_task] Failed to sync controller task_ref from session")

        queued_task_for_state, resolved_queue_index = self._resolve_current_queue_slot(session)
        current_task_ref = self._controller.current_task_ref
        if queued_task_for_state is not None:
            queued_task_ref = getattr(queued_task_for_state, "task_ref", None)
            if queued_task_ref:
                if current_task_ref and current_task_ref != queued_task_ref:
                    logger.warning(
                        "[SessionAPI.get_current_task] Overriding stale controller task_ref %s with session-backed task_ref %s",
                        current_task_ref,
                        queued_task_ref,
                    )
                current_task_ref = queued_task_ref
                self._controller.current_task_ref = queued_task_ref
                if resolved_queue_index is not None:
                    setattr(self._controller, "_current_queue_index", resolved_queue_index)

        if not current_task_ref:
            try:
                total = len(session.queue) if session.queue else 0
                if total:
                    idx = session.current_task_index
                    if idx < 0:
                        idx = 0
                    if idx >= total:
                        idx = total - 1
                    qt = session.queue[idx]
                    tr = qt.task_ref
                    if tr:
                        current_task_ref = tr
                        self._controller.current_task_ref = tr
                        setattr(self._controller, "_current_queue_index", idx)
            except Exception:
                logger.exception("[SessionAPI.get_current_task] Failed to restore task_ref from queue fallback")
        if not current_task_ref:
            return None


        # Парсим task_ref в module/topic/task_id
        logger.info(
            "[SessionAPI.get_current_task] Resolved active task snapshot=%s",
            self._build_resolution_snapshot(
                session,
                resolved_task=queued_task_for_state,
                resolved_index=resolved_queue_index,
            ),
        )
        parts = current_task_ref.split("/")
        if len(parts) < 3:
            logger.warning("[SessionAPI.get_current_task] invalid task_ref format: %s", current_task_ref)
            return None

        module_id, topic_id, task_id = parts[0], parts[1], parts[-1]

        try:
            task_data_full = self._storage_service.load_task(module_id, topic_id, task_id)
        except Exception:
            logger.exception("[SessionAPI.get_current_task] failed to load task %s", current_task_ref)
            return None

        if not task_data_full:
            return None

        # Always work with a detached copy to avoid in-place mutations
        # leaking between repeated get_current_task() calls.
        try:
            task_data_full = copy.deepcopy(task_data_full)
        except Exception:
            logger.exception(
                "[SessionAPI.get_current_task] Failed to deepcopy task_data_full for %s",
                current_task_ref,
            )
            return None

        # База для web: берём исходный task_data из storage.
        # Но если TaskController уже загрузил это задание с явной сложностью,
        # используем модифицированную версию (contains requires_labels/mode/etc).
        task_data = task_data_full.get("task_data")
        storage_task_data_original = copy.deepcopy(task_data) if isinstance(task_data, dict) else None
        task_dir = task_data_full.get("task_dir")
        reused_controller_task_data = False
        resolved_queue_difficulty = (
            getattr(queued_task_for_state, "difficulty", None)
            if queued_task_for_state is not None
            else None
        )

        try:
            controller_task = getattr(getattr(self._controller, "task_controller", None), "current_task", None)
            if controller_task is not None:
                ctrl_ref = getattr(controller_task, "full_id", None)
                ctrl_task_data = getattr(controller_task, "task_data", None)
                # full_id in Task is module/topic/task_id
                if ctrl_ref == current_task_ref and isinstance(ctrl_task_data, dict):
                    task_data = copy.deepcopy(ctrl_task_data)
                    reused_controller_task_data = True
        except Exception:
            logger.exception("[SessionAPI.get_current_task] Failed to reuse enhanced task_data from TaskController")

        if (
            not reused_controller_task_data
            and isinstance(task_data, dict)
            and resolved_queue_difficulty is not None
        ):
            difficulty_manager = getattr(
                getattr(self._controller, "task_controller", None),
                "difficulty_manager",
                None,
            )
            if difficulty_manager is not None:
                try:
                    task_data = difficulty_manager.enhance_task_for_level(
                        copy.deepcopy(task_data),
                        level=int(resolved_queue_difficulty),
                        task_ref=current_task_ref,
                    )
                except Exception:
                    logger.exception(
                        "[SessionAPI.get_current_task] Failed to enhance storage task_data for %s at difficulty=%s",
                        current_task_ref,
                        resolved_queue_difficulty,
                    )

        # Обогащаем task_data web-дружественными полями (например, image_url)
        if isinstance(task_data, dict):
            self._enrich_task_data_for_web(task_data, task_dir)
            task_data_full["task_data"] = task_data

            # Дополнительно нормализуем структуру для sequence_assembly задач
            try:
                task_type = task_data.get("type") or task_data.get("task_type")
                if task_type == "sequence_assembly":
                    content = task_data.get("content") or {}
                    if not isinstance(content, dict):
                        content = {}
                    meta = task_data.get("meta") or {}
                    if not isinstance(meta, dict):
                        meta = {}
                    storage_task_data = storage_task_data_original or {}
                    if not isinstance(storage_task_data, dict):
                        storage_task_data = {}
                    storage_content = storage_task_data.get("content") or {}
                    if not isinstance(storage_content, dict):
                        storage_content = {}
                    storage_meta = storage_task_data.get("meta") or {}
                    if not isinstance(storage_meta, dict):
                        storage_meta = {}
                    settings_dict = (
                        task_data.get("settings")
                        or content.get("settings")
                        or storage_task_data.get("settings")
                        or storage_content.get("settings")
                        or {}
                    )

                    prompt_text = (
                        content.get("prompt")
                        or task_data.get("prompt")
                        or storage_content.get("prompt")
                        or storage_task_data.get("prompt")
                        or content.get("question")
                        or task_data.get("question")
                        or storage_content.get("question")
                        or storage_task_data.get("question")
                        or meta.get("name")
                        or task_data.get("name")
                        or storage_meta.get("name")
                        or storage_task_data.get("name")
                        or ""
                    )
                    description_text = (
                        content.get("description")
                        or task_data.get("description")
                        or storage_content.get("description")
                        or storage_task_data.get("description")
                        or ""
                    )
                    title_text = (
                        meta.get("name")
                        or meta.get("title")
                        or task_data.get("name")
                        or task_data.get("title")
                        or storage_meta.get("name")
                        or storage_meta.get("title")
                        or storage_task_data.get("name")
                        or storage_task_data.get("title")
                        or ""
                    )

                    elements_src = (
                        content.get("elements")
                        or task_data.get("elements")
                        or storage_content.get("elements")
                        or storage_task_data.get("elements")
                        or []
                    )
                    levels_src = (
                        content.get("levels")
                        or task_data.get("levels")
                        or storage_content.get("levels")
                        or storage_task_data.get("levels")
                        or []
                    )

                    elements = [
                        WebSequenceElement(
                            id=e["id"],
                            text=e.get("text") or e.get("label") or e.get("title") or "",
                            image=e.get("image"),
                        )
                        for e in elements_src
                        if isinstance(e, dict) and "id" in e
                    ]

                    levels = [
                        WebSequenceLevel(
                            level_id=l["level_id"],
                            label=l.get("label") or l.get("level_name") or l.get("name"),
                            slots=list(l.get("blocks") or l.get("slots") or []),
                        )
                        for l in levels_src
                        if isinstance(l, dict) and "level_id" in l
                    ]

                    settings = WebSequenceSettings(
                        level_order_matters=bool(
                            content.get(
                                "level_order_matters",
                                settings_dict.get("level_order_matters", False),
                            )
                        ),
                        sequence_within_level_matters=bool(
                            content.get(
                                "sequence_within_level_matters",
                                settings_dict.get(
                                    "sequence_within_level_matters", False
                                ),
                            )
                        ),
                        shuffle_elements=bool(
                            settings_dict.get("shuffle_elements", True)
                        ),
                        show_hints=bool(settings_dict.get("show_hints", False)),
                        extra={
                            k: v
                            for k, v in settings_dict.items()
                            if k
                            not in {
                                "level_order_matters",
                                "sequence_within_level_matters",
                                "shuffle_elements",
                                "show_hints",
                            }
                        },
                    )

                    web_task = WebSequenceTaskData(
                        prompt=str(prompt_text),
                        elements=elements,
                        levels=levels,
                        settings=settings,
                    )

                    # Заменяем task_data на нормализованное представление,
                    # сохраняя явный тип задания для HTTP-слоя и фронта.
                    task_data = {
                        "type": "sequence_assembly",
                        "task_type": "sequence_assembly",
                        **web_task.dict(),
                    }
                    if title_text:
                        task_data["name"] = str(title_text)
                    if description_text:
                        task_data["description"] = str(description_text)
                    if meta or storage_meta:
                        task_data["meta"] = copy.deepcopy(meta or storage_meta)
                    task_data_full["task_data"] = task_data
            except Exception:
                logger.exception(
                    "[SessionAPI.get_current_task] Failed to normalize sequence_assembly task_data"
                )

        # Стабильный shuffle тестовых заданий (вопросы и варианты) только для web-пути.
        # Перестановка должна быть фиксированной для пары (task_ref, iteration), чтобы
        # индексы в failed_subtests продолжали соответствовать отображаемым вопросам.
        try:
            if isinstance(task_data, dict) and session is not None:
                td = task_data
                task_type = td.get("type") or td.get("task_type")
                if task_type == "test":
                    iteration = getattr(session, "iteration", None)
                    content = td.get("content") or {}
                    questions = content.get("questions") or td.get("questions") or []
                    if isinstance(questions, list) and questions and iteration is not None:
                        settings = td.get("settings") or content.get("settings") or {}
                        shuffle_questions = bool(settings.get("shuffle_questions", True))
                        shuffle_answers = bool(settings.get("shuffle_answers", True))

                        # Инициализируем хранилище permutation в сессии при первом использовании.
                        if not hasattr(session, "test_shuffle") or session.test_shuffle is None:
                            session.test_shuffle = {}

                        shuffle_key = f"{current_task_ref}@{iteration}"
                        entry = session.test_shuffle.get(shuffle_key)

                        # Генерируем permutation только один раз для пары (task_ref, iteration).
                        if entry is None:
                            q_count = len(questions)
                            question_order = list(range(q_count))
                            if shuffle_questions:
                                random.shuffle(question_order)

                            answer_order_by_question: Dict[str, Any] = {}
                            for orig_q_index in range(q_count):
                                q = questions[orig_q_index]
                                if not isinstance(q, dict):
                                    continue
                                answers = q.get("answers") or []
                                if not isinstance(answers, list) or not answers:
                                    continue

                                a_indices = list(range(len(answers)))
                                if shuffle_answers and len(a_indices) > 1:
                                    random.shuffle(a_indices)
                                answer_order_by_question[str(orig_q_index)] = a_indices

                            entry = {
                                "question_order": question_order,
                                "answer_order_by_question": answer_order_by_question,
                            }
                            session.test_shuffle[shuffle_key] = entry

                        # Применяем сохранённую permutation к копии списка вопросов.
                        question_order = entry.get("question_order") or []
                        answer_order_by_question = entry.get("answer_order_by_question") or {}

                        original_questions = list(questions)
                        shuffled_questions = []

                        for orig_index in question_order:
                            if not (0 <= orig_index < len(original_questions)):
                                continue
                            q_src = original_questions[orig_index]
                            if not isinstance(q_src, dict):
                                continue
                            q = copy.deepcopy(q_src)

                            answers = q.get("answers") or []
                            if isinstance(answers, list) and answers:
                                a_order = answer_order_by_question.get(str(orig_index))
                                if isinstance(a_order, list) and a_order:
                                    original_answers = list(answers)
                                    new_answers = []
                                    for a_idx in a_order:
                                        if 0 <= a_idx < len(original_answers):
                                            new_answers.append(original_answers[a_idx])
                                    if new_answers:
                                        q["answers"] = new_answers

                            shuffled_questions.append(q)

                        if shuffled_questions:
                            content["questions"] = shuffled_questions
                            td["content"] = content
                            # Для совместимости с местами, где вопросы лежат на верхнем уровне
                            # (например, старые тестовые структуры), синхронизируем и их.
                            if isinstance(td.get("questions"), list):
                                td["questions"] = shuffled_questions
                            task_data_full["task_data"] = td
                            task_data = td
        except Exception:
            logger.exception(
                "[SessionAPI.get_current_task] Failed to apply stable shuffle for test task %s",
                current_task_ref,
            )

        # Пытаемся найти текущую очередь и сложность
        difficulty = None
        index_in_queue = None
        total_in_queue = 0
        is_retry = False
        origin_iteration = None
        retry_variant = None
        order_meta: Dict[str, Any] = {}

        # Основной источник истины для позиции в очереди — current_task_index
        # в сессии. В AdaptiveSessionManager он указывает на СЛЕДУЮЩИЙ слот
        # после текущего задания (количество уже пройденных задач).
        # Поэтому фактический индекс текущего задания в очереди для web-UI:
        #   effective_index = max(0, min(current_task_index - 1, len(queue) - 1))
        # Это гарантирует, что:
        #   - для первого задания (current_task_index == 1) индекс будет 0;
        #   - для последнего задания (current_task_index == len(queue)) индекс будет len(queue)-1.
        queued_task, resolved_queue_index = self._resolve_current_queue_slot(session)
        if session.queue:
            total_in_queue = len(session.queue)

        if queued_task is not None and getattr(queued_task, "task_ref", None) == current_task_ref:
            difficulty = queued_task.difficulty
            index_in_queue = resolved_queue_index
            is_retry = queued_task.is_retry
            origin_iteration = queued_task.origin_iteration
            setattr(self._controller, "_current_queue_index", resolved_queue_index)

        stats = self._controller.get_current_session_stats() or {}

        if difficulty is None:
            difficulty = stats.get("current_difficulty")
        if difficulty is None and isinstance(task_data, dict):
            task_settings = task_data.get("settings") or {}
            task_content = task_data.get("content") or {}
            for candidate in (
                task_data.get("_difficulty_level"),
                task_data.get("difficulty"),
                task_settings.get("difficulty") if isinstance(task_settings, dict) else None,
                task_content.get("difficulty") if isinstance(task_content, dict) else None,
            ):
                try:
                    parsed_candidate = int(candidate)
                except Exception:
                    continue
                if parsed_candidate > 0:
                    difficulty = parsed_candidate
                    break
        if index_in_queue is None:
            index_in_queue = stats.get("index_in_queue")
        if not total_in_queue:
            total_in_queue = stats.get("total_in_queue", 0)

        # Вычисляем метаданные порядка (phase/chain/retry) без изменения логики очереди.
        try:
            complex_obj = None
            complex_id = getattr(session, "complex_id", None)
            if complex_id:
                complex_obj = self._complex_service.get_complex(complex_id)

            # Определяем task_type (для phase)
            resolved_task_type = None
            if isinstance(task_data, dict):
                resolved_task_type = task_data.get("type") or task_data.get("task_type")
            if not resolved_task_type:
                resolved_task_type = self._session_manager._get_task_type(current_task_ref)

            # Phase
            phase_id = None
            if resolved_task_type and difficulty is not None:
                phase_id = self._session_manager._get_task_phase(str(resolved_task_type), int(difficulty))

            phase_name_by_id = {
                0: "warmup",
                1: "main",
                2: "finisher",
            }
            phase_name = phase_name_by_id.get(phase_id, "main")

            # Position within phase
            phase_index = None
            phase_total = None
            if phase_id is not None and session.queue:
                phase_positions = []
                for q in session.queue:
                    q_ref = q.task_ref
                    q_diff = q.difficulty
                    if not q_ref:
                        continue
                    q_type = self._session_manager._get_task_type(q_ref)
                    q_phase = self._session_manager._get_task_phase(q_type, int(q_diff))
                    if q_phase == phase_id:
                        phase_positions.append(q)
                phase_total = len(phase_positions)
                if queued_task is not None:
                    for idx, q in enumerate(phase_positions):
                        if q is queued_task:
                            phase_index = idx
                            break

            # Chain membership
            chain_id = None
            chain_pos = None
            chain_len = None
            if complex_obj is not None:
                chains = getattr(complex_obj, "chains", None) or []
                for i, chain in enumerate(chains):
                    if not isinstance(chain, list):
                        continue
                    if current_task_ref in chain:
                        chain_id = f"chain_{i}"
                        chain_pos = chain.index(current_task_ref)
                        chain_len = len(chain)
                        break

            # Retry details
            if is_retry:
                retry_variant = "retry"
                if origin_iteration is not None:
                    origin_difficulty = None
                    try:
                        origin_results = [
                            r for r in session.completed_tasks
                            if r.task_ref == current_task_ref
                            and r.iteration_index == origin_iteration
                        ]
                        if origin_results:
                            origin_difficulty = origin_results[-1].difficulty
                    except Exception:
                        origin_difficulty = None

                    try:
                        if origin_difficulty is not None and difficulty is not None:
                            if int(difficulty) < int(origin_difficulty):
                                retry_variant = "training"
                            else:
                                retry_variant = "control"
                    except Exception:
                        retry_variant = "retry"

            order_meta = {
                "phase": {
                    "id": phase_id,
                    "name": phase_name,
                    "index": phase_index,
                    "total": phase_total,
                },
                "chain": {
                    "id": chain_id,
                    "index": chain_pos,
                    "total": chain_len,
                },
                "retry": {
                    "is_retry": bool(is_retry),
                    "origin_iteration": origin_iteration,
                    "variant": retry_variant,
                },
            }
        except Exception:
            order_meta = {}

        # Применяем partial retry для тестовых заданий и web-пути:
        # если это retry-копия теста и в сессии есть список заваленных под-вопросов,
        # подрезаем questions до этих индексов (аналогично _load_current_task).
        restored_evaluation_result = None
        restored_user_input = None
        restored_view_state = None
        try:
            session_ui_state = getattr(session, "ui_state", None) or {}
            if (
                isinstance(session_ui_state, dict)
                and session_ui_state.get("screen_type") in ("task", "task_results")
            ):
                current_iteration = getattr(session, "iteration", None)
                ui_task_ref = session_ui_state.get("task_ref")
                ui_task_index = session_ui_state.get("task_index")
                ui_iteration = session_ui_state.get("iteration")
                if ui_iteration is None:
                    ui_iteration = session_ui_state.get("iteration_number")
                ui_task_ref_matches = (not ui_task_ref or ui_task_ref == current_task_ref)
                if isinstance(ui_task_index, int):
                    ui_task_index_matches = ui_task_index == resolved_queue_index
                else:
                    ui_task_index_matches = self._count_queue_occurrences(session, current_task_ref) <= 1
                try:
                    ui_iteration_matches = (
                        current_iteration is None
                        or ui_iteration is None
                        or int(ui_iteration) == int(current_iteration)
                    )
                except Exception:
                    ui_iteration_matches = False

                if ui_task_ref_matches and ui_task_index_matches and ui_iteration_matches:
                    if session_ui_state.get("screen_type") == "task_results":
                        evaluation_result = session_ui_state.get("evaluation_result")
                        if isinstance(evaluation_result, dict):
                            restored_evaluation_result = evaluation_result
                        elif evaluation_result is not None:
                            try:
                                restored_evaluation_result = self._serialize_evaluation_result(
                                    evaluation_result,
                                    session_id=session_id,
                                    task_ref=current_task_ref,
                                )
                            except Exception:
                                logger.exception(
                                    "[SessionAPI.get_current_task] Failed to serialize restored evaluation_result for %s",
                                    current_task_ref,
                                )
                    user_input = session_ui_state.get("user_input")
                    if isinstance(user_input, dict):
                        restored_user_input = user_input
                    view_state = session_ui_state.get("view_state")
                    if isinstance(view_state, dict):
                        restored_view_state = view_state
        except Exception:
            logger.exception(
                "[SessionAPI.get_current_task] Failed to extract restored task UI state for %s",
                current_task_ref,
            )

        try:
            if isinstance(restored_user_input, dict):
                restored_user_input = self._remap_test_answers_to_shuffle_for_restore(
                    session=session,
                    current_task_ref=current_task_ref,
                    task_data=task_data_full.get("task_data") or {},
                    user_input=restored_user_input,
                )
            if isinstance(restored_evaluation_result, dict):
                self._attach_test_per_question_ui_from_shuffle(
                    session=session,
                    current_task_ref=current_task_ref,
                    task_obj=task_data_full,
                    result=restored_evaluation_result,
                )
        except Exception:
            logger.exception(
                "[SessionAPI.get_current_task] Failed to adapt restored test state for shuffle, task_ref=%s",
                current_task_ref,
            )

        if restored_evaluation_result is None:
            try:
                if self._can_restore_completed_result_for_slot(
                    session,
                    current_task_ref,
                    resolved_queue_index,
                ):
                    completed_tasks = getattr(session, "completed_tasks", None) or []
                    matching_results = [
                        result for result in completed_tasks
                        if getattr(result, "task_ref", None) == current_task_ref
                    ]
                    if matching_results:
                        current_iteration = getattr(session, "iteration", None)
                        same_iteration_results = [
                            result for result in matching_results
                            if current_iteration is None
                            or getattr(result, "iteration_index", None) == current_iteration
                        ]
                        fallback_result = (
                            same_iteration_results[-1]
                            if same_iteration_results
                            else matching_results[-1]
                        )
                        restored_evaluation_result = self._serialize_evaluation_result(
                            fallback_result,
                            session_id=session_id,
                            task_ref=current_task_ref,
                        )
                        self._attach_test_per_question_ui_from_shuffle(
                            session=session,
                            current_task_ref=current_task_ref,
                            task_obj=task_data_full,
                            result=restored_evaluation_result,
                        )
            except Exception:
                logger.exception(
                    "[SessionAPI.get_current_task] Failed to restore evaluation result from completed_tasks for %s",
                    current_task_ref,
                )

        try:
            if (
                is_retry
                and hasattr(session, "test_failed_subtests")
                and session.test_failed_subtests
            ):
                failed_indices = session.test_failed_subtests.get(current_task_ref) or []
                failed_positions = self._resolve_test_failed_question_positions(
                    session=session,
                    current_task_ref=current_task_ref,
                    failed_indices=failed_indices,
                )
                if failed_positions and isinstance(task_data, dict):
                    td = task_data
                    task_type = td.get("type") or td.get("task_type")
                    if task_type == "test":
                        content = td.get("content") or {}
                        questions = content.get("questions") or []
                        if isinstance(questions, list) and questions:
                            filtered = [
                                q for i, q in enumerate(questions)
                                if i in failed_positions
                            ]
                            if filtered:
                                content["questions"] = filtered
                                td["content"] = content
                                task_data_full["task_data"] = td
                                task_data = td
        except Exception:
            logger.exception(
                "[SessionAPI.get_current_task] Failed to apply partial retry for test task %s",
                current_task_ref,
            )

        task_name = None
        if isinstance(task_data, dict):
            task_meta = task_data.get("meta") or {}
            if not isinstance(task_meta, dict):
                task_meta = {}
            task_name = (
                task_meta.get("name")
                or task_meta.get("title")
                or task_data.get("name")
                or task_data.get("title")
            )

        available_levels = []
        difficulty_meta = None
        if isinstance(task_data, dict):
            task_content = task_data.get("content") if isinstance(task_data.get("content"), dict) else {}
            task_type_for_meta = task_data.get("type") or task_data.get("task_type") or task_content.get("type")
            task_subtype_for_meta = task_data.get("subtype") or task_content.get("subtype")
            difficulty_manager = getattr(
                getattr(self._controller, "task_controller", None),
                "difficulty_manager",
                None,
            )
            if difficulty_manager is not None and task_type_for_meta:
                try:
                    available_levels = difficulty_manager.get_available_levels(
                        task_type_for_meta,
                        task_ref=current_task_ref,
                        task_data=task_data,
                        subtype=task_subtype_for_meta,
                    )
                except Exception:
                    logger.exception(
                        "[SessionAPI.get_current_task] Failed to resolve available levels for %s",
                        current_task_ref,
                    )
                try:
                    difficulty_meta = difficulty_manager.get_task_difficulty_metadata(
                        task_type_for_meta,
                        task_subtype_for_meta,
                    )
                except Exception:
                    logger.exception(
                        "[SessionAPI.get_current_task] Failed to resolve difficulty metadata for %s",
                        current_task_ref,
                    )

        return {
            "session_id": session_id,
            "complex_id": getattr(session, "complex_id", None),
            "task_ref": current_task_ref,
            "module_id": module_id,
            "topic_id": topic_id,
            "task_id": task_id,
            "task_name": task_name,
            "iteration": session.iteration,
            "difficulty": difficulty,
            "is_retry": is_retry,
            "queue": {
                "index": index_in_queue,
                "total": total_in_queue,
            },
            "order_meta": order_meta,
            "available_levels": available_levels,
            "difficulty_meta": difficulty_meta,
            "task_data": task_data,
            "answer_key": task_data_full.get("answer_key"),
            "restored_evaluation_result": restored_evaluation_result,
            "restored_user_input": restored_user_input,
            "restored_view_state": restored_view_state,
        }

    def _normalize_test_answers_from_shuffle(
        self,
        session: Any,
        current_task_ref: str,
        task_obj: Any,
        user_input: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Map shuffled test answer indices back to original option indices."""
        if not isinstance(user_input, dict):
            return user_input
        answers_in = user_input.get("answers")
        if not isinstance(answers_in, dict) or not answers_in:
            return user_input
        if session is None:
            return user_input

        test_shuffle = getattr(session, "test_shuffle", None)
        iteration = getattr(session, "iteration", None)
        if not isinstance(test_shuffle, dict) or iteration is None:
            return user_input

        shuffle_key = f"{current_task_ref}@{iteration}"
        shuffle_entry = test_shuffle.get(shuffle_key)
        if not isinstance(shuffle_entry, dict):
            return user_input

        answer_order_by_question = shuffle_entry.get("answer_order_by_question")
        if not isinstance(answer_order_by_question, dict) or not answer_order_by_question:
            return user_input

        task_data = getattr(task_obj, "task_data", None) if task_obj is not None else None
        if not isinstance(task_data, dict):
            return user_input

        content = task_data.get("content") if isinstance(task_data.get("content"), dict) else {}
        questions = content.get("questions") if isinstance(content.get("questions"), list) else task_data.get("questions")
        if not isinstance(questions, list) or not questions:
            return user_input

        question_index_by_id: Dict[str, int] = {}
        for q_idx, question in enumerate(questions):
            if not isinstance(question, dict):
                continue
            qid_raw = question.get("id")
            qid = str(qid_raw) if qid_raw is not None else str(q_idx)
            question_index_by_id[qid] = q_idx

        if not question_index_by_id:
            return user_input

        def _to_int(v: Any) -> Optional[int]:
            if isinstance(v, bool):
                return None
            if isinstance(v, int):
                return v
            if isinstance(v, float):
                return int(v)
            if isinstance(v, str):
                s = v.strip()
                if s.isdigit():
                    return int(s)
                if s.startswith("answer_"):
                    suffix = s.split("_", 1)[1].strip()
                    if suffix.isdigit():
                        return int(suffix)
            return None

        def _remap_single_answer(qid_key: str, value: Any) -> Any:
            q_idx = question_index_by_id.get(str(qid_key))
            if q_idx is None:
                return value
            shuffled_to_original = answer_order_by_question.get(str(q_idx))
            if not isinstance(shuffled_to_original, list) or not shuffled_to_original:
                return value

            if isinstance(value, (list, tuple)):
                remapped_list: List[Any] = []
                for item in value:
                    item_idx = _to_int(item)
                    if item_idx is None:
                        remapped_list.append(item)
                        continue
                    if 0 <= item_idx < len(shuffled_to_original):
                        remapped_list.append(shuffled_to_original[item_idx])
                    else:
                        remapped_list.append(item)
                return remapped_list

            value_idx = _to_int(value)
            if value_idx is None:
                return value
            if 0 <= value_idx < len(shuffled_to_original):
                return shuffled_to_original[value_idx]
            return value

        normalized_answers: Dict[Any, Any] = {}
        changed = False
        for k, v in answers_in.items():
            mapped_value = _remap_single_answer(str(k), v)
            normalized_answers[k] = mapped_value
            if mapped_value != v:
                changed = True

        if not changed:
            return user_input

        normalized_input = dict(user_input)
        normalized_input["answers"] = normalized_answers
        logger.info(
            "[SessionAPI.submit_answer] Normalized shuffled test answers for task_ref=%s, iteration=%s",
            current_task_ref,
            iteration,
        )
        return normalized_input

    def _remap_test_answers_to_shuffle_for_restore(
        self,
        session: Any,
        current_task_ref: str,
        task_data: Dict[str, Any],
        user_input: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Map stored original test answer indices back to the current shuffled UI order."""
        if not isinstance(user_input, dict):
            return user_input
        answers_in = user_input.get("answers")
        if not isinstance(answers_in, dict) or not answers_in:
            return user_input
        if session is None or not isinstance(task_data, dict):
            return user_input

        test_shuffle = getattr(session, "test_shuffle", None)
        iteration = getattr(session, "iteration", None)
        if not isinstance(test_shuffle, dict) or iteration is None:
            return user_input

        shuffle_key = f"{current_task_ref}@{iteration}"
        shuffle_entry = test_shuffle.get(shuffle_key)
        if not isinstance(shuffle_entry, dict):
            return user_input

        question_order = shuffle_entry.get("question_order")
        answer_order_by_question = shuffle_entry.get("answer_order_by_question")
        if not isinstance(question_order, list) or not isinstance(answer_order_by_question, dict):
            return user_input

        content = task_data.get("content") if isinstance(task_data.get("content"), dict) else {}
        questions = content.get("questions") if isinstance(content.get("questions"), list) else task_data.get("questions")
        if not isinstance(questions, list) or not questions:
            return user_input

        question_index_by_id: Dict[str, int] = {}
        for shuffled_q_idx, question in enumerate(questions):
            if not isinstance(question, dict):
                continue
            qid_raw = question.get("id")
            qid = str(qid_raw) if qid_raw is not None else str(shuffled_q_idx)
            question_index_by_id[qid] = shuffled_q_idx

        if not question_index_by_id:
            return user_input

        def _to_int(v: Any) -> Optional[int]:
            if isinstance(v, bool):
                return None
            if isinstance(v, int):
                return v
            if isinstance(v, float):
                return int(v)
            if isinstance(v, str):
                s = v.strip()
                if s.isdigit():
                    return int(s)
                if s.startswith("answer_"):
                    suffix = s.split("_", 1)[1].strip()
                    if suffix.isdigit():
                        return int(suffix)
            return None

        def _remap_single_answer(qid_key: str, value: Any) -> Any:
            shuffled_q_idx = question_index_by_id.get(str(qid_key))
            if shuffled_q_idx is None or shuffled_q_idx >= len(question_order):
                return value

            try:
                original_q_idx = int(question_order[shuffled_q_idx])
            except Exception:
                return value

            shuffled_to_original = answer_order_by_question.get(str(original_q_idx))
            if not isinstance(shuffled_to_original, list) or not shuffled_to_original:
                return value

            original_to_shuffled: Dict[int, int] = {}
            for shuffled_a_idx, original_a_idx in enumerate(shuffled_to_original):
                try:
                    original_to_shuffled[int(original_a_idx)] = shuffled_a_idx
                except Exception:
                    continue

            if not original_to_shuffled:
                return value

            if isinstance(value, (list, tuple)):
                remapped_list: List[Any] = []
                for item in value:
                    item_idx = _to_int(item)
                    if item_idx is None:
                        remapped_list.append(item)
                        continue
                    remapped_list.append(original_to_shuffled.get(item_idx, item))
                return remapped_list

            value_idx = _to_int(value)
            if value_idx is None:
                return value
            return original_to_shuffled.get(value_idx, value)

        remapped_answers: Dict[Any, Any] = {}
        changed = False
        for key, value in answers_in.items():
            remapped_value = _remap_single_answer(str(key), value)
            remapped_answers[key] = remapped_value
            if remapped_value != value:
                changed = True

        if not changed:
            return user_input

        remapped_input = dict(user_input)
        remapped_input["answers"] = remapped_answers
        return remapped_input

    def _resolve_test_failed_question_positions(
        self,
        session: Any,
        current_task_ref: str,
        failed_indices: Any,
    ) -> List[int]:
        """Map original failed test question indices to positions visible in the current web payload."""
        if not isinstance(failed_indices, list) or not failed_indices:
            return []

        def _to_int(v: Any) -> Optional[int]:
            if isinstance(v, bool):
                return None
            if isinstance(v, int):
                return v
            if isinstance(v, float):
                return int(v)
            if isinstance(v, str):
                s = v.strip()
                if s.isdigit():
                    return int(s)
            return None

        normalized_failed: List[int] = []
        for value in failed_indices:
            idx = _to_int(value)
            if idx is None or idx in normalized_failed:
                continue
            normalized_failed.append(idx)

        if not normalized_failed:
            return []

        if session is None:
            return normalized_failed

        test_shuffle = getattr(session, "test_shuffle", None)
        iteration = getattr(session, "iteration", None)
        if not isinstance(test_shuffle, dict) or iteration is None:
            return normalized_failed

        shuffle_key = f"{current_task_ref}@{iteration}"
        shuffle_entry = test_shuffle.get(shuffle_key)
        if not isinstance(shuffle_entry, dict):
            return normalized_failed

        question_order = shuffle_entry.get("question_order")
        if not isinstance(question_order, list) or not question_order:
            return normalized_failed

        if all(0 <= idx < len(question_order) for idx in normalized_failed):
            return normalized_failed

        original_to_shuffled: Dict[int, int] = {}
        for shuffled_idx, original_idx in enumerate(question_order):
            oi = _to_int(original_idx)
            if oi is None or oi in original_to_shuffled:
                continue
            original_to_shuffled[oi] = shuffled_idx

        if not original_to_shuffled:
            return normalized_failed

        return [original_to_shuffled.get(idx, idx) for idx in normalized_failed]

    def _attach_test_per_question_ui_from_shuffle(
        self,
        session: Any,
        current_task_ref: str,
        task_obj: Any,
        result: Any,
    ) -> None:
        """Attach UI-oriented per-question feedback with option indices in shuffled order."""
        if result is None:
            return
        if isinstance(result, dict):
            details = result.get("details")
        else:
            details = getattr(result, "details", None)
        if not isinstance(details, dict):
            return
        per_question = details.get("per_question")
        if not isinstance(per_question, dict) or not per_question:
            return
        if session is None:
            return

        test_shuffle = getattr(session, "test_shuffle", None)
        iteration = getattr(session, "iteration", None)
        if not isinstance(test_shuffle, dict) or iteration is None:
            return

        shuffle_key = f"{current_task_ref}@{iteration}"
        shuffle_entry = test_shuffle.get(shuffle_key)
        if not isinstance(shuffle_entry, dict):
            return

        answer_order_by_question = shuffle_entry.get("answer_order_by_question")
        if not isinstance(answer_order_by_question, dict) or not answer_order_by_question:
            return

        task_data = task_obj.get("task_data") if isinstance(task_obj, dict) else getattr(task_obj, "task_data", None)
        if not isinstance(task_data, dict):
            return

        content = task_data.get("content") if isinstance(task_data.get("content"), dict) else {}
        questions = content.get("questions") if isinstance(content.get("questions"), list) else task_data.get("questions")
        if not isinstance(questions, list) or not questions:
            return

        question_index_by_id: Dict[str, int] = {}
        for q_idx, question in enumerate(questions):
            if not isinstance(question, dict):
                continue
            qid_raw = question.get("id")
            qid = str(qid_raw) if qid_raw is not None else str(q_idx)
            question_index_by_id[qid] = q_idx

        if not question_index_by_id:
            return

        def _to_int(v: Any) -> Optional[int]:
            if isinstance(v, bool):
                return None
            if isinstance(v, int):
                return v
            if isinstance(v, float):
                return int(v)
            if isinstance(v, str):
                s = v.strip()
                if s.isdigit():
                    return int(s)
            return None

        def _remap_original_ids_to_shuffled(ids: Any, original_to_shuffled: Dict[int, int]) -> List[Any]:
            if not isinstance(ids, list):
                return []
            out: List[Any] = []
            for val in ids:
                idx = _to_int(val)
                if idx is None:
                    out.append(val)
                    continue
                out.append(original_to_shuffled.get(idx, idx))
            return out

        per_question_ui: Dict[str, Any] = {}
        for qid_raw, pq_item in per_question.items():
            qid = str(qid_raw)
            if not isinstance(pq_item, dict):
                per_question_ui[qid] = pq_item
                continue

            q_idx = question_index_by_id.get(qid)
            shuffled_to_original = (
                answer_order_by_question.get(str(q_idx)) if q_idx is not None else None
            )

            if not isinstance(shuffled_to_original, list) or not shuffled_to_original:
                per_question_ui[qid] = dict(pq_item)
                continue

            original_to_shuffled: Dict[int, int] = {}
            for shuffled_idx, original_idx in enumerate(shuffled_to_original):
                oi = _to_int(original_idx)
                if oi is None:
                    continue
                original_to_shuffled[oi] = shuffled_idx

            if not original_to_shuffled:
                per_question_ui[qid] = dict(pq_item)
                continue

            remapped_item = dict(pq_item)
            remapped_item["correct_option_ids"] = _remap_original_ids_to_shuffled(
                pq_item.get("correct_option_ids"), original_to_shuffled
            )
            remapped_item["user_option_ids"] = _remap_original_ids_to_shuffled(
                pq_item.get("user_option_ids"), original_to_shuffled
            )
            per_question_ui[qid] = remapped_item

        details["per_question_ui"] = per_question_ui
        if isinstance(result, dict):
            result["details"] = details

    @_hosted_controller_serialized
    def submit_answer(
        self,
        session_id: str,
        task_id: str,
        user_input: Dict[str, Any],
        user_id: Optional[str] = None,
    ) -> Optional[Any]:
        """Отправить ответ пользователя по текущему заданию.

        Для совместимости с существующим Tkinter UI возвращает исходный
        EvaluationResult (или аналогичный объект), как и
        ComplexSessionController.submit_answer.

        task_id сейчас используется только для валидации соответствия
        текущему task_ref.
        Фактическая отправка происходит через ComplexSessionController.
        """
        # GUEST MODE PROTECTION: запретить submit для гостя
        try:
            session = self.get_session(session_id, user_id=user_id)
            if session and session.user_id == "guest":
                logger.warning("[SessionAPI.submit_answer] Rejecting submit for guest user, session_id=%s", session_id)
                return None
            if session is None:
                logger.warning(
                    "[SessionAPI.submit_answer] session not found or ownership mismatch: session_id=%s user_id=%s",
                    session_id,
                    user_id,
                )
                return None
        except Exception:
            logger.exception("[SessionAPI.submit_answer] Failed to check guest status")
            return None
        
        if session_id != self._controller.current_session_id:
            logger.warning("[SessionAPI.submit_answer] session_id mismatch: api=%s, controller=%s -> syncing", session_id, self._controller.current_session_id)
            self._controller.current_session_id = session_id
            try:
                session = self.get_session(session_id, user_id=user_id)
                self._sync_controller_task_ref_from_session(session)
            except Exception:
                logger.exception("[SessionAPI.submit_answer] Failed to sync task_ref on mismatch")

        current_task_ref = self._controller.current_task_ref
        if not current_task_ref:
            # Fallback: пробуем взять task_ref по task_id из очереди
            task_ref_candidate = None
            try:
                session = self.get_session(session_id, user_id=user_id)
                if session and session.queue:
                    # сначала пытаемся по текущему индексу
                    idx = session.current_task_index
                    candidates = list(session.queue)
                    # если индекс в пределах — поднимаем его в начало
                    if 0 <= idx < len(candidates):
                        candidates = [candidates[idx]] + candidates[:idx] + candidates[idx+1:]
                    for qt in candidates:
                        tr = qt.task_ref
                        if tr and tr.endswith(f"/{task_id}"):
                            task_ref_candidate = tr
                            break
            except Exception:
                logger.exception("[SessionAPI.submit_answer] Failed to fallback task_ref by task_id")

            if task_ref_candidate:
                current_task_ref = task_ref_candidate
                self._controller.current_task_ref = task_ref_candidate

        # Дополнительный жёсткий фолбэк для web: если task_ref всё ещё не найден,
        # пробуем загрузить текущее задание через HTTP-ориентированный helper,
        # который подтягивает данные из репозитория и восстанавливает сессию.
        if not current_task_ref:
            try:
                try:
                    task_data = self.get_current_task(
                        session_id,
                        auto_resume=True,
                        resume_source="submit_answer_current_task_fallback",
                        user_id=user_id,
                    )
                except TypeError:
                    task_data = self.get_current_task(
                        session_id,
                        auto_resume=True,
                    )
                if isinstance(task_data, dict):
                    current_task_ref = task_data.get("task_ref")
                    if current_task_ref:
                        self._controller.current_task_ref = current_task_ref
                        # синхронизируем текущую сессию для контроллера
                        self._controller.current_session_id = session_id
                        # загружаем задание в TaskController, чтобы submit работал корректно
                        try:
                            self._controller._load_current_task()
                        except Exception:
                            logger.exception("[SessionAPI.submit_answer] Failed to load current task in controller fallback")
            except Exception:
                logger.exception("[SessionAPI.submit_answer] Fallback to get_current_task failed")

        if not current_task_ref:
            logger.warning("[SessionAPI.submit_answer] no current_task_ref")
            return None

        # Синхронизируем current_task_index по task_ref, чтобы _load_current_task взял правильный элемент очереди
        # Синхронизируем current_task_index по текущему queue-slot, чтобы retry-логика
        # и сохраненный task_ref не расходились с фактически открытым заданием.
        try:
            session = self.get_session(session_id, user_id=user_id)
            if session and session.queue:
                resolved_task, resolved_index = self._resolve_current_queue_slot(session)
                target_index = None
                if resolved_task is not None and getattr(resolved_task, "task_ref", None) == current_task_ref:
                    target_index = resolved_index
                else:
                    target_index = self._find_queue_index_by_task_ref(session, current_task_ref)

                if isinstance(target_index, int):
                    expected_indices = {target_index}
                    if getattr(session, "complex_id", None) != "daily_mix":
                        expected_indices.add(target_index + 1)

                    if session.current_task_index not in expected_indices:
                        logger.info(
                            "[SessionAPI.submit_answer] Aligning current_task_index %s -> %s for task_ref=%s",
                            session.current_task_index,
                            target_index,
                            current_task_ref,
                        )
                        session.current_task_index = target_index

                    ui_state = getattr(session, "ui_state", None)
                    if isinstance(ui_state, dict):
                        ui_state["task_ref"] = current_task_ref
                        ui_state["task_index"] = target_index

                    setattr(self._controller, "_current_queue_index", target_index)
                    try:
                        if self._session_manager.session_repository:
                            self._session_manager.session_repository.save_session(session, session.user_id)
                    except Exception:
                        logger.exception("[SessionAPI.submit_answer] Failed to persist aligned current_task_index")
        except Exception:
            logger.exception("[SessionAPI.submit_answer] Failed to align current_task_index by task_ref")

        try:
            task_obj = getattr(getattr(self._controller, "task_controller", None), "current_task", None)
            task_loaded = getattr(task_obj, "full_id", None)
            if task_loaded != current_task_ref:
                self._controller.current_session_id = session_id
                self._controller.current_task_ref = current_task_ref
                self._controller._load_current_task()
                task_obj = getattr(getattr(self._controller, "task_controller", None), "current_task", None)
                task_loaded = getattr(task_obj, "full_id", None)
            if task_loaded != current_task_ref:
                logger.warning("[SessionAPI.submit_answer] TaskController not loaded with %s, loaded=%s", current_task_ref, task_loaded)
                self._controller.current_task_ref = current_task_ref
        except Exception:
            logger.exception("[SessionAPI.submit_answer] Failed to ensure task loaded in controller")

        # Проверка соответствия task_id — защита от двойного submit из разных вкладок
        parts = current_task_ref.split("/")
        if len(parts) >= 3:
            current_task_id = parts[-1]
            if current_task_id != task_id:
                logger.warning("[SessionAPI.submit_answer] task_id mismatch: api=%s, current=%s — rejecting", task_id, current_task_id)
                return {"error": "task_id_mismatch", "expected": current_task_id, "received": task_id}

        # For shuffled test tasks in web mode, convert selected option indices
        # back to original (pre-shuffle) indices expected by evaluator.
        try:
            if session is None:
                session = self.get_session(session_id, user_id=user_id)
            user_input = self._normalize_test_answers_from_shuffle(
                session=session,
                current_task_ref=current_task_ref,
                task_obj=task_obj,
                user_input=user_input,
            )
        except Exception:
            logger.exception(
                "[SessionAPI.submit_answer] Failed to normalize test answers for shuffle, task_ref=%s",
                current_task_ref,
            )

        logger.info("[SessionAPI.submit_answer] Calling controller.submit_answer() for task_ref=%s...", current_task_ref)
        result = self._controller.submit_answer(user_input)
        if result is None:
            logger.warning("[SessionAPI.submit_answer] controller.submit_answer() returned None")
            return None
        
        logger.info("[SessionAPI.submit_answer] controller.submit_answer() returned: success=%s, score=%s", 
                   getattr(result, "success", None), 
                   getattr(result, "score", None))

        # Для HTML/HTTP-слоя можно будет использовать отдельный метод,
        # который обернёт этот result в dict. Здесь возвращаем объект
        # как есть, чтобы не ломать существующий UI.
        # Keep evaluator internals in original option indices, but provide
        # UI-friendly feedback in shuffled indices for review mode.
        try:
            if session is None:
                session = self.get_session(session_id, user_id=user_id)
            self._attach_test_per_question_ui_from_shuffle(
                session=session,
                current_task_ref=current_task_ref,
                task_obj=task_obj,
                result=result,
            )
        except Exception:
            logger.exception(
                "[SessionAPI.submit_answer] Failed to attach per_question_ui for shuffle, task_ref=%s",
                current_task_ref,
            )

        return result

    @_hosted_controller_serialized
    def next_task(self, session_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Перейти к следующему заданию и вернуть его описание как dict."""
        logger.info("[SessionAPI.next_task] ========== НАЧАЛО next_task, session_id=%s ==========", session_id)
        session = self.get_session(session_id, user_id=user_id)
        if session:
            logger.info("[SessionAPI.next_task] Session found: complex_id=%s, current_task_index=%s, queue_length=%s, is_active=%s", 
                       session.complex_id, 
                       session.current_task_index,
                       len(session.queue) if session.queue else 0,
                       session.is_active)
        else:
            logger.warning("[SessionAPI.next_task] Session NOT found for session_id=%s", session_id)
            return None
        
        if session and not session.is_active:
            logger.warning("[SessionAPI.next_task] session %s is not active -> session_completed", session_id)
            return {"ok": False, "error": "session_completed"}
        if session_id != self._controller.current_session_id:
            logger.warning("[SessionAPI.next_task] session_id mismatch: api=%s, controller=%s", session_id, self._controller.current_session_id)
            self._controller.current_session_id = session_id
            try:
                self._sync_controller_task_ref_from_session(session)
            except Exception:
                logger.exception("[SessionAPI.next_task] Failed to sync controller task_ref on mismatch")

        if session and not self._current_task_is_checked(session):
            logger.warning(
                "[SessionAPI.next_task] Rejecting unchecked transition for session_id=%s task_ref=%s ui_state=%s",
                session_id,
                getattr(self._controller, "current_task_ref", None),
                getattr(session, "ui_state", None),
            )
            return {"ok": False, "error": "task_not_checked"}

        logger.info("[SessionAPI.next_task] Calling controller.next_task()...")
        self._controller.next_task()

        # Повторно читаем сессию: контроллер мог завершить daily_mix или другую сессию.
        session_after = self._session_manager.get_session(session_id)
        queue_after = session_after.queue if session_after else None
        current_idx_after = session_after.current_task_index if session_after else 0
        queue_len_after = len(queue_after) if queue_after else 0
        completed_after = len(session_after.completed_tasks) if session_after else 0
        current_iteration_after = getattr(session_after, "iteration", None) if session_after else None
        completed_in_current_iteration = 0
        if session_after and current_iteration_after is not None:
            try:
                completed_in_current_iteration = sum(
                    1
                    for result in getattr(session_after, "completed_tasks", []) or []
                    if getattr(result, "iteration_index", None) == current_iteration_after
                )
            except Exception:
                logger.exception("[SessionAPI.next_task] Failed to count completed tasks in current iteration")
                completed_in_current_iteration = 0

        session_inactive = session_after is None or not session_after.is_active
        if session_after and getattr(session_after, "complex_id", None) == "daily_mix":
            queue_exhausted = queue_len_after == 0 or current_idx_after >= queue_len_after
        else:
            queue_exhausted = queue_len_after == 0 or current_idx_after > queue_len_after
        all_tasks_completed = (
            queue_len_after > 0
            and completed_in_current_iteration >= queue_len_after
            and current_idx_after >= queue_len_after
        )
        controller_detached = (
            getattr(self._controller, "current_session_id", None) is None
            or getattr(self._controller, "current_task_ref", None) is None
        )

        if session_inactive or queue_exhausted or all_tasks_completed or controller_detached:
            logger.info(
                "[SessionAPI.next_task] session completed after controller call: session=%s is_active=%s queue_len=%s current_idx=%s completed=%s completed_in_current_iteration=%s controller_session=%s controller_task_ref=%s",
                session_after,
                session_after.is_active if session_after else None,
                queue_len_after,
                current_idx_after,
                completed_after,
                completed_in_current_iteration,
                getattr(self._controller, "current_session_id", None),
                getattr(self._controller, "current_task_ref", None),
            )
            try:
                self._controller.current_task_ref = None
                if getattr(self._controller, "task_controller", None):
                    self._controller.task_controller.clear_task()
            except Exception:
                logger.exception("[SessionAPI.next_task] Failed to clear controller after completion")
            self._release_hosted_session_controller(session_id)
            logger.info("[SessionAPI.next_task] ========== КОНЕЦ next_task, result=session_completed ==========")
            return {"ok": False, "error": "session_completed"}

        logger.info("[SessionAPI.next_task] controller.next_task() completed, calling get_current_task()...")
        result = self.get_current_task(session_id, user_id=user_id)
        logger.info("[SessionAPI.next_task] ========== КОНЕЦ next_task, result=%s ==========", "task_found" if result else "None")
        return result

    @_hosted_controller_serialized
    def skip_task(self, session_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Отложить текущее задание в конец очереди и загрузить следующее.

        Возвращает dict с результатом:
        - При успехе: данные следующего задания (как get_current_task)
        - При отказе: {"ok": False, "reason": "...", "error": "..."}
        - None при критической ошибке
        """
        session = self.get_session(session_id, user_id=user_id)
        if session is None:
            logger.warning("[SessionAPI.skip_task] Session NOT found for session_id=%s", session_id)
            return None

        if session_id != self._controller.current_session_id:
            logger.warning("[SessionAPI.skip_task] session_id mismatch: api=%s, controller=%s", session_id, self._controller.current_session_id)
            return None

        current_task_ref = self._controller.current_task_ref
        if not current_task_ref:
            return None

        try:
            skip_result = self._session_manager.skip_task(session_id, current_task_ref)
        except Exception:
            logger.exception("[SessionAPI.skip_task] failed to skip task %s", current_task_ref)
            return None

        if not skip_result.get("ok"):
            reason = skip_result.get("reason", "unknown")
            logger.info("[SessionAPI.skip_task] skip denied for %s: %s", current_task_ref, reason)
            error_messages = {
                "retry_cannot_be_skipped": "Тренировочное задание нельзя пропустить",
                "last_task_cannot_be_skipped": "Последнее задание в итерации нельзя пропустить",
                "skip_limit_reached": "Превышен лимит пропусков для этого задания",
            }
            return {
                "ok": False,
                "reason": reason,
                "error": error_messages.get(reason, "Невозможно пропустить задание"),
            }

        # После успешного пропуска загружаем следующее задание через контроллер
        self._controller._load_next_task()
        return self.get_current_task(session_id, user_id=user_id)

    @_hosted_controller_serialized
    def cancel_session(self, session_id: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Отменить активную сессию без сохранения результатов."""
        # Даже если контроллер уже перешел к другой сессии, пробуем отменить через менеджер.
        success = False
        session = self.get_session(session_id, user_id=user_id)
        resolved_user_id = self._resolve_runtime_user_id(
            getattr(session, "user_id", None) or user_id,
            allow_default_in_hosted=False,
        )
        if not resolved_user_id:
            logger.warning(
                "[SessionAPI.cancel_session] Missing user_id for session_id=%s in current runtime",
                session_id,
            )
            return {"ok": False}
        try:
            success = self._session_manager.cancel_session(
                session_id, user_id=resolved_user_id
            )
        except Exception:
            logger.exception("[SessionAPI.cancel_session] Failed to cancel session via AdaptiveSessionManager")
            success = False

        if success and session_id == self._controller.current_session_id:
            # Сбрасываем контроллер, чтобы не держать залипшие ссылки на сессию
            self._controller.current_session_id = None
            self._controller.current_task_ref = None
            try:
                self._controller.task_controller.clear_task()
            except Exception:
                logger.exception("[SessionAPI.cancel_session] Failed to clear task controller after cancellation")
        if success:
            self._release_hosted_session_controller(session_id)

        return {"ok": bool(success)}

    # ------------------------------------------------------------------
    # Результаты итераций и всей сессии
    # ------------------------------------------------------------------

    @_hosted_controller_serialized
    def get_iteration_results(
        self,
        session_id: str,
        iteration_number: Optional[int] = None,
        user_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Вернуть результаты последней завершённой или текущей итерации.

        Сейчас берём номер итерации прямо из сессии и строим IterationSummary
        через AdaptiveSessionManager.get_iteration_summary, затем конвертируем
        в dict.
        """
        session = self.get_session(session_id, user_id=user_id)
        if not session:
            logger.warning("[SessionAPI.get_iteration_results] session not found: %s", session_id)
            return None

        if not self._session_manager.get_session(session_id):
            try:
                self._session_manager.restore_session(session)
            except Exception:
                logger.exception(
                    "[SessionAPI.get_iteration_results] Failed to restore session %s from repository",
                    session_id,
                )
                return None

        if session_id != self._controller.current_session_id:
            self._controller.current_session_id = session_id

        ui_state = getattr(session, "ui_state", None) or {}
        if isinstance(ui_state, dict) and ui_state.get("screen_type") in {"task", "task_results"}:
            try:
                self._sync_controller_task_ref_from_session(session)
            except Exception:
                logger.exception(
                    "[SessionAPI.get_iteration_results] Failed to sync controller task_ref for session %s",
                    session_id,
                )
        else:
            self._controller.current_task_ref = None

        current_iteration = getattr(session, "iteration", None)
        if current_iteration is None:
            return None

        requested_iteration: Optional[int]
        try:
            requested_iteration = int(iteration_number) if iteration_number is not None else None
        except Exception:
            requested_iteration = None
        if requested_iteration is not None and requested_iteration <= 0:
            requested_iteration = None

        ui_iteration_number = None
        if isinstance(ui_state, dict) and ui_state.get("screen_type") == "iteration_results":
            try:
                candidate = int(ui_state.get("iteration_number"))
                if candidate > 0:
                    ui_iteration_number = candidate
            except Exception:
                ui_iteration_number = None

        target_iteration = requested_iteration or ui_iteration_number or current_iteration

        # Для S2 важно отдавать именно ту итерацию, которая была сохранена в ui_state
        # или явно запрошена через URL, а не гадать по current session iteration.
        summary = self._session_manager.get_iteration_summary(session_id, target_iteration)
        if (
            summary is None
            and requested_iteration is None
            and ui_iteration_number is None
            and current_iteration > 1
        ):
            prev_iter = current_iteration - 1
            logger.info(
                "[SessionAPI.get_iteration_results] summary for iteration %s not found, "
                "trying previous iteration %s", current_iteration, prev_iter
            )
            summary = self._session_manager.get_iteration_summary(session_id, prev_iter)
        if summary is None:
            return None

        # Pydantic-модели умеют dict(), иначе берём __dict__
        if hasattr(summary, "dict"):
            data = summary.dict()
        else:
            data = getattr(summary, "__dict__", {})

        # Web UI (S3) умеет отображать "Динамика по итерациям", если backend отдаёт массив iterations.
        # Сейчас ExtendedSessionResultSummary не содержит iterations, поэтому добавляем их прямо в payload.
        try:
            existing_iterations = data.get("iterations") if isinstance(data, dict) else None
            if isinstance(data, dict) and (not isinstance(existing_iterations, list) or not existing_iterations):
                iters = self._build_iterations_for_web(session)
                if iters:
                    data["iterations"] = iters
        except Exception:
            logger.exception("[SessionAPI.get_final_results] Failed to build iterations dynamics")

        try:
            existing_problem_tasks = data.get("problem_tasks") if isinstance(data, dict) else None
            if isinstance(data, dict) and (not isinstance(existing_problem_tasks, list) or not existing_problem_tasks):
                problem_tasks = self._build_problem_tasks_for_web(session)
                if problem_tasks:
                    data["problem_tasks"] = problem_tasks
        except Exception:
            logger.exception("[SessionAPI.get_final_results] Failed to build problem tasks payload")

        def _first_text(*values: Any) -> str:
            for value in values:
                if isinstance(value, str):
                    text = value.strip()
                    if text:
                        return text
            return ""

        def _normalize_answer_value(value: Any) -> str:
            if value is None:
                return ""
            if isinstance(value, str):
                return value.strip()
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return str(value)
            if isinstance(value, list):
                parts = [_normalize_answer_value(item) for item in value]
                return ", ".join(part for part in parts if part)
            if isinstance(value, dict):
                return _first_text(
                    value.get("text"),
                    value.get("label"),
                    value.get("value"),
                    value.get("answer"),
                    value.get("correct_answer"),
                    value.get("user_answer"),
                )
            return ""

        def _extract_option_text(question: Any, raw_answer: Any) -> str:
            if not isinstance(question, dict):
                return ""
            options = question.get("answers")
            if not isinstance(options, list):
                options = question.get("options")
            if not isinstance(options, list) or not options:
                return _normalize_answer_value(raw_answer)

            raw_ids = raw_answer if isinstance(raw_answer, list) else [raw_answer]
            labels: List[str] = []
            for raw_id in raw_ids:
                idx: Optional[int] = None
                if isinstance(raw_id, int) and not isinstance(raw_id, bool):
                    idx = raw_id
                elif isinstance(raw_id, float):
                    idx = int(raw_id)
                elif isinstance(raw_id, str) and raw_id.strip().isdigit():
                    idx = int(raw_id.strip())

                option_value: Any = None
                if idx is not None and 0 <= idx < len(options):
                    option_value = options[idx]
                elif raw_id is not None:
                    raw_id_text = str(raw_id).strip()
                    for option in options:
                        if not isinstance(option, dict):
                            continue
                        option_id = option.get("id")
                        if option_id is not None and str(option_id).strip() == raw_id_text:
                            option_value = option
                            break

                if option_value is None:
                    normalized = _normalize_answer_value(raw_id)
                    if normalized:
                        labels.append(normalized)
                    continue

                if isinstance(option_value, dict):
                    label = _first_text(
                        option_value.get("text"),
                        option_value.get("label"),
                        option_value.get("value"),
                        option_value.get("title"),
                    )
                    if not label and _first_text(
                        option_value.get("image_asset_url"),
                        option_value.get("image_asset_id"),
                        option_value.get("image_path"),
                        option_value.get("image_url"),
                        option_value.get("image"),
                        option_value.get("src"),
                    ):
                        try:
                            option_index = options.index(option_value)
                        except ValueError:
                            option_index = None
                        if option_index is not None:
                            label = f"Вариант {option_index + 1}"
                    if label:
                        labels.append(label)
                else:
                    labels.append(str(option_value))

            return ", ".join(label for label in labels if label)

        def _extract_correct_option_text(question: Any) -> str:
            if not isinstance(question, dict):
                return ""
            options = question.get("answers")
            if not isinstance(options, list):
                options = question.get("options")
            if not isinstance(options, list):
                return ""

            labels: List[str] = []
            for idx, option in enumerate(options):
                if not isinstance(option, dict) or not (option.get("is_correct") is True or option.get("correct") is True):
                    continue
                label = _first_text(
                    option.get("text"),
                    option.get("label"),
                    option.get("value"),
                    option.get("title"),
                )
                if not label and _first_text(
                    option.get("image_asset_url"),
                    option.get("image_asset_id"),
                    option.get("image_path"),
                    option.get("image_url"),
                    option.get("image"),
                    option.get("src"),
                ):
                    label = f"Вариант {idx + 1}"
                if label:
                    labels.append(label)
            return ", ".join(labels)

        def _question_has_image_options(question: Any) -> bool:
            if not isinstance(question, dict):
                return False
            options = question.get("answers")
            if not isinstance(options, list):
                options = question.get("options")
            if not isinstance(options, list):
                return False
            for option in options:
                if not isinstance(option, dict):
                    continue
                if _first_text(
                    option.get("image_asset_url"),
                    option.get("image_asset_id"),
                    option.get("image_path"),
                    option.get("image_url"),
                    option.get("image"),
                    option.get("src"),
                ):
                    return True
            return False

        def _build_review_option_item(option: Any, idx: Optional[int] = None) -> Optional[Dict[str, Any]]:
            if not isinstance(option, dict):
                text = _normalize_answer_value(option)
                return {"type": "text", "text": text} if text else None

            text = _first_text(
                option.get("text"),
                option.get("label"),
                option.get("value"),
                option.get("title"),
            )
            image_url = _first_text(
                option.get("image_asset_url"),
                option.get("asset_url"),
                option.get("image_url"),
                option.get("src"),
            )
            image_asset_id = _first_text(
                option.get("image_asset_id"),
                option.get("asset_id"),
            )
            if not image_url and image_asset_id:
                image_url = f"/api/assets/{quote(image_asset_id)}/content"
            image_path = _first_text(
                option.get("image_path"),
                option.get("image"),
            )
            payload: Dict[str, Any] = {
                "type": "choice_option",
            }
            if idx is not None and idx >= 0:
                payload["option_index"] = idx
                payload["fallback_label"] = f"Вариант {idx + 1}"
            if text:
                payload["text"] = text
            if image_url:
                payload["image_url"] = image_url
            if image_asset_id:
                payload["image_asset_id"] = image_asset_id
            if image_path and not hosted_runtime:
                payload["image_path"] = image_path
            return payload if len(payload) > 1 else None

        def _extract_option_review_items(question: Any, raw_answer: Any) -> List[Dict[str, Any]]:
            if not isinstance(question, dict):
                text = _normalize_answer_value(raw_answer)
                return [{"type": "text", "text": text}] if text else []

            options = question.get("answers")
            if not isinstance(options, list):
                options = question.get("options")
            if not isinstance(options, list) or not options:
                text = _normalize_answer_value(raw_answer)
                return [{"type": "text", "text": text}] if text else []

            raw_ids = raw_answer if isinstance(raw_answer, list) else [raw_answer]
            items: List[Dict[str, Any]] = []
            for raw_id in raw_ids:
                idx: Optional[int] = None
                if isinstance(raw_id, int) and not isinstance(raw_id, bool):
                    idx = raw_id
                elif isinstance(raw_id, float):
                    idx = int(raw_id)
                elif isinstance(raw_id, str) and raw_id.strip().isdigit():
                    idx = int(raw_id.strip())

                option_value: Any = None
                option_index: Optional[int] = None
                if idx is not None and 0 <= idx < len(options):
                    option_value = options[idx]
                    option_index = idx
                elif raw_id is not None:
                    raw_id_text = str(raw_id).strip()
                    for candidate_idx, option in enumerate(options):
                        if not isinstance(option, dict):
                            continue
                        option_id = option.get("id")
                        if option_id is not None and str(option_id).strip() == raw_id_text:
                            option_value = option
                            option_index = candidate_idx
                            break

                if option_value is None:
                    normalized = _normalize_answer_value(raw_id)
                    if normalized:
                        items.append({"type": "text", "text": normalized})
                    continue

                rendered = _build_review_option_item(option_value, option_index)
                if rendered:
                    items.append(rendered)
            return items

        def _extract_correct_option_review_items(question: Any) -> List[Dict[str, Any]]:
            if not isinstance(question, dict):
                return []
            options = question.get("answers")
            if not isinstance(options, list):
                options = question.get("options")
            if not isinstance(options, list):
                return []

            items: List[Dict[str, Any]] = []
            for idx, option in enumerate(options):
                if not isinstance(option, dict) or not (
                    option.get("is_correct") is True or option.get("correct") is True
                ):
                    continue
                rendered = _build_review_option_item(option, idx)
                if rendered:
                    items.append(rendered)
            return items

        def _normalize_review_lines(values: Any) -> List[str]:
            if values is None:
                return []
            if isinstance(values, list):
                lines: List[str] = []
                for value in values:
                    text = _normalize_answer_value(value)
                    if text:
                        lines.append(text)
                return lines
            text = _normalize_answer_value(values)
            if not text:
                return []
            return [line.strip() for line in str(text).splitlines() if line.strip()]

        def _make_review_payload(
            title: str,
            prompt: str,
            user_lines: Any,
            reference_lines: Any,
            user_label: str = "Твоё решение",
            reference_label: str = "Референс",
            note: str = "",
        ) -> Dict[str, Any]:
            normalized_user_lines = _normalize_review_lines(user_lines)
            normalized_reference_lines = _normalize_review_lines(reference_lines)
            return {
                "question": prompt,
                "user_answer": "\n".join(normalized_user_lines),
                "correct_answer": "\n".join(normalized_reference_lines),
                "review": {
                    "title": title,
                    "prompt": prompt,
                    "user_label": user_label,
                    "user_lines": normalized_user_lines,
                    "reference_label": reference_label,
                    "reference_lines": normalized_reference_lines,
                    "note": note,
                },
            }

        def _extract_fragments_by_spans(text: str, spans: Any) -> List[str]:
            if not isinstance(text, str) or not text.strip() or not isinstance(spans, list):
                return []
            fragments: List[str] = []
            for span in spans:
                if not isinstance(span, dict):
                    continue
                try:
                    start = int(span.get("start"))
                    end = int(span.get("end"))
                except Exception:
                    continue
                if end <= start:
                    continue
                fragment = text[start:end].strip()
                if fragment:
                    fragments.append(fragment)
            return fragments

        def _extract_words_by_indices(text: str, indices: Any) -> List[str]:
            if not isinstance(text, str) or not text.strip() or not isinstance(indices, list):
                return []
            words = list(re.finditer(r"\S+", text))
            fragments: List[str] = []
            for raw_index in indices:
                try:
                    idx = int(raw_index)
                except Exception:
                    continue
                if 0 <= idx < len(words):
                    fragment = words[idx].group(0).strip()
                    if fragment:
                        fragments.append(fragment)
            return fragments

        def _build_element_label_map(task_data_local: Dict[str, Any], details_local: Dict[str, Any]) -> Dict[str, str]:
            content_local = task_data_local.get("content") if isinstance(task_data_local.get("content"), dict) else {}
            candidates = [
                content_local.get("elements"),
                details_local.get("elements_data"),
            ]
            mapping: Dict[str, str] = {}
            for candidate in candidates:
                if not isinstance(candidate, list):
                    continue
                for item_local in candidate:
                    if not isinstance(item_local, dict):
                        continue
                    item_id = str(item_local.get("id") or "").strip()
                    if not item_id:
                        continue
                    label = _first_text(
                        item_local.get("text"),
                        item_local.get("label"),
                        item_local.get("title"),
                        item_local.get("value"),
                    )
                    if label:
                        mapping[item_id] = label
            return mapping

        def _format_sequence_lines(
            levels: Any,
            level_names_map: Dict[str, Any],
            element_map: Dict[str, str],
        ) -> List[str]:
            if not isinstance(levels, list):
                return []
            lines: List[str] = []
            for idx, level in enumerate(levels):
                if not isinstance(level, dict):
                    continue
                level_id = str(level.get("level_id") or "").strip()
                level_name = _first_text(
                    level.get("level_name"),
                    level.get("title"),
                    level_names_map.get(level_id) if isinstance(level_names_map, dict) else None,
                ) or f"Шаг {idx + 1}"
                blocks = level.get("blocks") if isinstance(level.get("blocks"), list) else []
                rendered_blocks: List[str] = []
                for block in blocks:
                    block_id = str(block)
                    rendered_blocks.append(element_map.get(block_id) or block_id)
                if not rendered_blocks:
                    rendered_blocks.append("пусто")
                lines.append(f"{level_name}: {' → '.join(rendered_blocks)}")
            return lines

        def _normalize_review_lines_for_review(values: Any) -> List[str]:
            if values is None:
                return []
            if isinstance(values, list):
                lines: List[str] = []
                for value in values:
                    text = _normalize_answer_value(value)
                    if text:
                        lines.extend(line.strip() for line in text.splitlines() if line.strip())
                return lines
            text = _normalize_answer_value(values)
            if not text:
                return []
            return [line.strip() for line in str(text).splitlines() if line.strip()]

        def _make_review_payload_for_review(
            title: str,
            prompt: str,
            user_lines: Any,
            reference_lines: Any,
            user_label: str = "Твоё решение",
            reference_label: str = "Референс",
            note: str = "",
            user_items: Any = None,
            reference_items: Any = None,
        ) -> Dict[str, Any]:
            normalized_user_lines = _normalize_review_lines_for_review(user_lines)
            normalized_reference_lines = _normalize_review_lines_for_review(reference_lines)
            review_payload: Dict[str, Any] = {
                "question": prompt,
                "user_answer": "\n".join(normalized_user_lines),
                "correct_answer": "\n".join(normalized_reference_lines),
                "review": {
                    "title": title,
                    "prompt": prompt,
                    "user_label": user_label,
                    "user_lines": normalized_user_lines,
                    "reference_label": reference_label,
                    "reference_lines": normalized_reference_lines,
                    "note": note,
                },
            }
            normalized_user_items = [
                item
                for item in (user_items if isinstance(user_items, list) else [])
                if isinstance(item, dict)
            ]
            normalized_reference_items = [
                item
                for item in (reference_items if isinstance(reference_items, list) else [])
                if isinstance(item, dict)
            ]
            if normalized_user_items:
                review_payload["review"]["user_items"] = normalized_user_items
                review_payload["user_items"] = normalized_user_items
            if normalized_reference_items:
                review_payload["review"]["reference_items"] = normalized_reference_items
                review_payload["reference_items"] = normalized_reference_items
            return review_payload

        def _format_sequence_lines_for_review(
            levels: Any,
            level_names_map: Dict[str, Any],
            element_map: Dict[str, str],
        ) -> List[str]:
            if not isinstance(levels, list):
                return []
            lines: List[str] = []
            for idx, level in enumerate(levels):
                if not isinstance(level, dict):
                    continue
                level_id = str(level.get("level_id") or "").strip()
                level_name = _first_text(
                    level.get("level_name"),
                    level.get("title"),
                    level_names_map.get(level_id) if isinstance(level_names_map, dict) else None,
                ) or f"Шаг {idx + 1}"
                blocks = level.get("blocks") if isinstance(level.get("blocks"), list) else []
                rendered_blocks: List[str] = []
                for block in blocks:
                    block_id = str(block).strip()
                    if not block_id:
                        continue
                    rendered_blocks.append(element_map.get(block_id) or block_id)
                if not rendered_blocks:
                    items = level.get("items") if isinstance(level.get("items"), list) else []
                    for block_item in items:
                        if not isinstance(block_item, dict):
                            continue
                        rendered = _first_text(
                            block_item.get("label"),
                            block_item.get("text"),
                            block_item.get("value"),
                            block_item.get("id"),
                        )
                        if rendered:
                            rendered_blocks.append(rendered)
                if not rendered_blocks:
                    rendered_blocks.append("пусто")
                lines.append(f"{level_name}: {' -> '.join(rendered_blocks)}")
            return lines

        def _build_task_review(item: Dict[str, Any], task_data: Dict[str, Any]) -> Dict[str, Any]:
            details = item.get("details") if isinstance(item.get("details"), dict) else {}
            content = task_data.get("content") if isinstance(task_data.get("content"), dict) else {}
            meta = task_data.get("meta") if isinstance(task_data.get("meta"), dict) else {}
            task_title = (
                _first_text(
                    item.get("task_name"),
                    item.get("name"),
                    meta.get("name"),
                    meta.get("title"),
                    task_data.get("name"),
                    task_data.get("title"),
                )
                or "Задание"
            )
            task_type = (
                _first_text(
                    task_data.get("type"),
                    task_data.get("task_type"),
                    details.get("task_type"),
                    item.get("task_type"),
                )
                or ""
            ).strip()
            questions = content.get("questions") if isinstance(content.get("questions"), list) else task_data.get("questions")
            questions = questions if isinstance(questions, list) else []
            per_question = details.get("per_question") if isinstance(details.get("per_question"), dict) else {}
            per_question_ui = details.get("per_question_ui") if isinstance(details.get("per_question_ui"), dict) else {}
            question_results = details.get("question_results") if isinstance(details.get("question_results"), list) else []
            failed_subtests = details.get("failed_subtests") if isinstance(details.get("failed_subtests"), list) else []

            def _collect_failed_test_targets() -> List[Dict[str, Any]]:
                targets: List[Dict[str, Any]] = []
                seen_targets: set[tuple[Optional[str], Optional[int]]] = set()

                def _register_target(
                    question_id_raw: Any,
                    index_raw: Any,
                    fallback_index: Optional[int] = None,
                ) -> None:
                    question_id = str(question_id_raw) if question_id_raw is not None else None
                    question_index = (
                        index_raw
                        if isinstance(index_raw, int)
                        else fallback_index
                        if isinstance(fallback_index, int)
                        else None
                    )
                    if question_id is None and question_index is None:
                        return
                    target_key = (
                        ("question_id", question_id)
                        if question_id is not None
                        else ("index", question_index)
                    )
                    if target_key in seen_targets:
                        return
                    seen_targets.add(target_key)
                    targets.append(
                        {
                            "question_id": question_id,
                            "index": question_index,
                        }
                    )

                for idx, result_item in enumerate(question_results):
                    if not isinstance(result_item, dict) or result_item.get("correct", False):
                        continue
                    _register_target(
                        result_item.get("question_id"),
                        result_item.get("index"),
                        idx,
                    )

                for failed_item in failed_subtests:
                    if not isinstance(failed_item, dict):
                        continue
                    _register_target(
                        failed_item.get("question_id"),
                        failed_item.get("index"),
                    )

                return targets

            def _matches_failed_target(result_item: Any, question_id: Optional[str], question_index: Optional[int], fallback_index: int) -> bool:
                if not isinstance(result_item, dict):
                    return False
                result_question_id_raw = result_item.get("question_id")
                if question_id is not None and result_question_id_raw is not None:
                    return str(result_question_id_raw) == question_id
                result_index_raw = result_item.get("index")
                result_index = result_index_raw if isinstance(result_index_raw, int) else fallback_index
                return question_index is not None and result_index == question_index

            if task_type == "test":
                failed_targets = _collect_failed_test_targets()
                if len(failed_targets) > 1:
                    entry_payloads: List[Dict[str, Any]] = []

                    for failed_target in failed_targets:
                        target_question_id = failed_target.get("question_id")
                        target_question_index = failed_target.get("index")

                        filtered_question_results = [
                            result_item
                            for idx, result_item in enumerate(question_results)
                            if _matches_failed_target(result_item, target_question_id, target_question_index, idx)
                        ]

                        filtered_failed_subtests = [
                            failed_item
                            for failed_item in failed_subtests
                            if isinstance(failed_item, dict)
                            and (
                                (
                                    target_question_id is not None
                                    and failed_item.get("question_id") is not None
                                    and str(failed_item.get("question_id")) == target_question_id
                                )
                                or (
                                    target_question_index is not None
                                    and isinstance(failed_item.get("index"), int)
                                    and failed_item.get("index") == target_question_index
                                )
                            )
                        ]

                        filtered_per_question = (
                            {target_question_id: per_question.get(target_question_id)}
                            if target_question_id is not None and isinstance(per_question.get(target_question_id), dict)
                            else {}
                        )
                        filtered_per_question_ui = (
                            {target_question_id: per_question_ui.get(target_question_id)}
                            if target_question_id is not None and isinstance(per_question_ui.get(target_question_id), dict)
                            else {}
                        )

                        target_details = dict(details)
                        target_details["question_results"] = filtered_question_results
                        target_details["failed_subtests"] = filtered_failed_subtests
                        if filtered_per_question:
                            target_details["per_question"] = filtered_per_question
                        else:
                            target_details.pop("per_question", None)
                        if filtered_per_question_ui:
                            target_details["per_question_ui"] = filtered_per_question_ui
                        else:
                            target_details.pop("per_question_ui", None)

                        target_item = dict(item)
                        target_item["details"] = target_details

                        entry_payload = _build_task_review(target_item, task_data)
                        if isinstance(entry_payload, dict) and isinstance(entry_payload.get("review"), dict):
                            entry_payloads.append(entry_payload)

                    if entry_payloads:
                        primary_payload = dict(entry_payloads[0])
                        primary_review = dict(primary_payload.get("review") or {})
                        primary_review["entries"] = [
                            dict(entry_payload.get("review") or {})
                            for entry_payload in entry_payloads
                            if isinstance(entry_payload.get("review"), dict)
                        ]
                        primary_payload["review"] = primary_review
                        return primary_payload

            failed_question_id: Optional[str] = None
            failed_question_index: Optional[int] = None

            for idx, result_item in enumerate(question_results):
                if not isinstance(result_item, dict) or result_item.get("correct", False):
                    continue
                question_id_raw = result_item.get("question_id")
                if question_id_raw is not None:
                    failed_question_id = str(question_id_raw)
                result_index = result_item.get("index")
                if isinstance(result_index, int):
                    failed_question_index = result_index
                else:
                    failed_question_index = idx
                break

            if failed_question_id is None and failed_subtests:
                first_failed = failed_subtests[0] if isinstance(failed_subtests[0], dict) else {}
                question_id_raw = first_failed.get("question_id")
                if question_id_raw is not None:
                    failed_question_id = str(question_id_raw)
                failed_index_raw = first_failed.get("index")
                if isinstance(failed_index_raw, int):
                    failed_question_index = failed_index_raw

            question: Optional[Dict[str, Any]] = None
            if isinstance(failed_question_index, int) and 0 <= failed_question_index < len(questions):
                candidate = questions[failed_question_index]
                if isinstance(candidate, dict):
                    question = candidate

            resolved_question_id = None
            if isinstance(question, dict):
                candidate_id = question.get("id")
                if candidate_id is not None:
                    resolved_question_id = str(candidate_id)

            if (question is None or (failed_question_id is not None and resolved_question_id != failed_question_id)) and failed_question_id is not None:
                for idx, candidate in enumerate(questions):
                    if not isinstance(candidate, dict):
                        continue
                    candidate_id = candidate.get("id")
                    if candidate_id is not None and str(candidate_id) == failed_question_id:
                        question = candidate
                        failed_question_index = idx
                        break

            per_question_item: Dict[str, Any] = {}
            if failed_question_id is not None:
                candidate = per_question_ui.get(failed_question_id)
                if isinstance(candidate, dict):
                    per_question_item = candidate
                else:
                    fallback_candidate = per_question.get(failed_question_id)
                    if isinstance(fallback_candidate, dict):
                        per_question_item = fallback_candidate

            per_question_details = (
                per_question_item.get("details")
                if isinstance(per_question_item.get("details"), dict)
                else {}
            )

            question_result_item: Dict[str, Any] = {}
            for idx, result_item in enumerate(question_results):
                if not isinstance(result_item, dict):
                    continue
                question_id_raw = result_item.get("question_id")
                matches_question_id = (
                    failed_question_id is not None
                    and question_id_raw is not None
                    and str(question_id_raw) == failed_question_id
                )
                matches_index = failed_question_index is not None and idx == failed_question_index
                if matches_question_id or matches_index:
                    question_result_item = result_item
                    break

            prompt = _first_text(
                item.get("question"),
                item.get("prompt"),
                details.get("question"),
                details.get("prompt"),
                content.get("question"),
                content.get("prompt"),
                question.get("question") if isinstance(question, dict) else None,
                question.get("text") if isinstance(question, dict) else None,
                question.get("prompt") if isinstance(question, dict) else None,
                question.get("title") if isinstance(question, dict) else None,
            )
            if not prompt and failed_subtests:
                first_failed = failed_subtests[0] if isinstance(failed_subtests[0], dict) else {}
                prompt = _first_text(first_failed.get("label"), first_failed.get("name"))

            user_answer_raw = (
                item.get("user_answer")
                or details.get("user_answer")
                or question_result_item.get("user_answer")
                or per_question_details.get("user_answer")
            )
            correct_answer_raw = (
                item.get("correct_answer")
                or details.get("correct_answer")
                or question_result_item.get("correct_answer")
                or per_question_details.get("reference_answer")
            )
            explanation = _first_text(
                item.get("explanation"),
                details.get("explanation"),
                details.get("message"),
                question_result_item.get("message"),
                per_question_item.get("message"),
                per_question_details.get("message"),
            )

            user_answer = _normalize_answer_value(user_answer_raw)
            correct_answer = _normalize_answer_value(correct_answer_raw)
            user_review_items: List[Dict[str, Any]] = []
            reference_review_items: List[Dict[str, Any]] = []

            if isinstance(question, dict):
                if user_answer_raw is not None:
                    option_text = _extract_option_text(question, user_answer_raw)
                    if option_text:
                        user_answer = option_text
                if correct_answer_raw is not None:
                    option_text = _extract_option_text(question, correct_answer_raw)
                    if option_text:
                        correct_answer = option_text
                if not user_answer:
                    option_text = _extract_option_text(question, per_question_item.get("user_option_ids"))
                    if option_text:
                        user_answer = option_text
                if not correct_answer:
                    option_text = _extract_option_text(question, per_question_item.get("correct_option_ids"))
                    if option_text:
                        correct_answer = option_text
                if not correct_answer:
                    option_text = _extract_correct_option_text(question)
                    if option_text:
                        correct_answer = option_text
                if _question_has_image_options(question):
                    option_user_raw = (
                        user_answer_raw
                        if user_answer_raw is not None
                        else per_question_item.get("user_option_ids")
                    )
                    option_reference_raw = (
                        correct_answer_raw
                        if correct_answer_raw is not None
                        else per_question_item.get("correct_option_ids")
                    )
                    user_review_items = _extract_option_review_items(question, option_user_raw)
                    reference_review_items = _extract_option_review_items(question, option_reference_raw)
                    if not reference_review_items:
                        reference_review_items = _extract_correct_option_review_items(question)

            if task_type == "open_answer":
                prompt_local = _first_text(content.get("question"), content.get("prompt"), prompt)
                reference_answer = _first_text(content.get("reference_answer"), correct_answer)
                if not reference_answer:
                    keywords = content.get("keywords") if isinstance(content.get("keywords"), list) else []
                    reference_answer = ", ".join(
                        keyword for keyword in (_normalize_answer_value(keyword) for keyword in keywords) if keyword
                    )
                return _make_review_payload_for_review(
                    task_title,
                    prompt_local,
                    [user_answer or "Ответ не был зафиксирован."],
                    [reference_answer or "Правильный ответ не найден."],
                    user_label="Твой ответ",
                    reference_label="Правильный ответ",
                    note=explanation,
                )

            if task_type == "sequence_assembly":
                evaluator_details = (
                    details.get("evaluator_result").get("details")
                    if isinstance(details.get("evaluator_result"), dict)
                    and isinstance(details.get("evaluator_result").get("details"), dict)
                    else {}
                )
                level_names_map = details.get("level_names_map") if isinstance(details.get("level_names_map"), dict) else {}
                if not level_names_map and isinstance(evaluator_details.get("level_names_map"), dict):
                    level_names_map = evaluator_details.get("level_names_map")
                user_levels = details.get("user_levels_data") if isinstance(details.get("user_levels_data"), list) else []
                if not user_levels and isinstance(evaluator_details.get("user_levels"), list):
                    user_levels = evaluator_details.get("user_levels")
                correct_levels = details.get("correct_levels_data") if isinstance(details.get("correct_levels_data"), list) else []
                if not correct_levels and isinstance(evaluator_details.get("correct_levels"), list):
                    correct_levels = evaluator_details.get("correct_levels")
                if not correct_levels:
                    if isinstance(content.get("levels"), list):
                        correct_levels = content.get("levels")
                    elif isinstance(content.get("sequence"), list):
                        correct_levels = content.get("sequence")
                element_map = _build_element_label_map(task_data, details)
                user_lines = _format_sequence_lines_for_review(user_levels, level_names_map, element_map)
                reference_lines = _format_sequence_lines_for_review(correct_levels, level_names_map, element_map)
                incorrect_sequences = details.get("incorrect_sequences") if isinstance(details.get("incorrect_sequences"), list) else []
                if not incorrect_sequences and isinstance(evaluator_details.get("incorrect_sequences"), list):
                    incorrect_sequences = evaluator_details.get("incorrect_sequences")
                incorrect_levels = details.get("incorrect_levels") if isinstance(details.get("incorrect_levels"), list) else []
                if not incorrect_levels and isinstance(evaluator_details.get("incorrect_levels"), list):
                    incorrect_levels = evaluator_details.get("incorrect_levels")
                note = explanation
                if not note and incorrect_sequences:
                    note = "Нарушена последовательность внутри одного или нескольких шагов."
                elif not note and incorrect_levels:
                    note = "Есть ошибка в распределении элементов по шагам."
                return _make_review_payload_for_review(
                    task_title,
                    _first_text(content.get("prompt"), content.get("question"), prompt),
                    user_lines or ["Последовательность пользователя не была сохранена."],
                    reference_lines or ["Правильная последовательность не найдена."],
                    reference_label="Правильная последовательность",
                    note=note,
                )

            if task_type == "click":
                prompt_local = _first_text(content.get("choice_prompt"), content.get("prompt"), prompt)
                mode = str(content.get("mode") or details.get("mode") or "").strip().lower()
                options = content.get("options") if isinstance(content.get("options"), list) else []
                if mode == "text_choice" or options:
                    option_question = {"options": options}
                    selected_option = (
                        details.get("selected_option_id")
                        or details.get("selected_option")
                        or ((details.get("selected_option_ids") or [None])[0] if isinstance(details.get("selected_option_ids"), list) else None)
                        or user_answer_raw
                    )
                    correct_option = details.get("correct_option_id") or correct_answer_raw
                    return _make_review_payload_for_review(
                        task_title,
                        prompt_local,
                        [_extract_option_text(option_question, selected_option) or user_answer or "Вариант не был выбран."],
                        [_extract_option_text(option_question, correct_option) or correct_answer or "Правильный вариант не найден."],
                        user_label="Твой ответ",
                        reference_label="Правильный ответ",
                        note=explanation,
                    )

                if mode == "text_errors" or isinstance(content.get("error_spans"), list) or isinstance(content.get("reference_spans"), list):
                    source_text = _first_text(content.get("text"), content.get("prompt"))
                    reference_text = _first_text(content.get("reference_text"), source_text)
                    selected_fragments = _extract_words_by_indices(source_text, details.get("matched_indices"))
                    if not selected_fragments:
                        selected_fragments = _extract_words_by_indices(source_text, details.get("selected_indices"))
                    if not selected_fragments:
                        selected_fragments = _extract_fragments_by_spans(source_text, content.get("error_spans"))
                    reference_fragments = _extract_fragments_by_spans(reference_text, content.get("reference_spans"))
                    if not reference_fragments:
                        reference_fragments = _extract_fragments_by_spans(source_text, content.get("reference_spans"))
                    if not reference_fragments:
                        reference_fragments = [reference_text] if reference_text else []
                    return _make_review_payload_for_review(
                        task_title,
                        prompt_local,
                        selected_fragments or ["Ошибка не была отмечена."],
                        reference_fragments or ["Правильный фрагмент не найден."],
                        user_label="Что ты отметил",
                        reference_label="Что должно было быть",
                        note=explanation,
                    )

                targets_info = details.get("targets_info") if isinstance(details.get("targets_info"), list) else []
                annotations = content.get("annotations") if isinstance(content.get("annotations"), list) else []
                annotation_labels: List[str] = []
                for idx, annotation in enumerate(annotations):
                    if not isinstance(annotation, dict):
                        continue
                    label = _first_text(annotation.get("label"), annotation.get("title")) or f"Область {idx + 1}"
                    annotation_labels.append(label)
                labels_details = details.get("labels") if isinstance(details.get("labels"), dict) else {}
                unmatched_labels = labels_details.get("unmatched_labels") if isinstance(labels_details.get("unmatched_labels"), list) else []
                if unmatched_labels:
                    user_lines = []
                    reference_lines = []
                    for unmatched in unmatched_labels:
                        if not isinstance(unmatched, (list, tuple)) or len(unmatched) < 3:
                            continue
                        raw_index, user_value, correct_value = unmatched[0], unmatched[1], unmatched[2]
                        prefix = ""
                        try:
                            idx = int(raw_index)
                        except Exception:
                            idx = None
                        if idx is not None and 0 <= idx < len(annotation_labels):
                            prefix = f"{annotation_labels[idx]}: "
                        user_lines.append(f"{prefix}{_normalize_answer_value(user_value) or 'не указано'}")
                        reference_lines.append(f"{prefix}{_normalize_answer_value(correct_value) or 'не указано'}")
                    return _make_review_payload_for_review(
                        task_title,
                        prompt_local,
                        user_lines or ["Подписи пользователя не были сохранены."],
                        reference_lines or annotation_labels or ["Правильные подписи не найдены."],
                        note=explanation or "Подписи к отмеченным областям не совпали.",
                    )

                found_labels = [
                    _normalize_answer_value(target.get("label"))
                    for target in targets_info
                    if isinstance(target, dict) and target.get("found")
                ]
                found_labels = [label for label in found_labels if label]
                missing_labels = [
                    _normalize_answer_value(target.get("label"))
                    for target in targets_info
                    if isinstance(target, dict) and not target.get("found")
                ]
                missing_labels = [label for label in missing_labels if label]
                user_lines = []
                if found_labels:
                    user_lines.append(f"Отмечено: {', '.join(found_labels)}")
                if missing_labels:
                    user_lines.append(f"Не отмечено: {', '.join(missing_labels)}")
                reference_lines = annotation_labels or found_labels or missing_labels
                return _make_review_payload_for_review(
                    task_title,
                    prompt_local,
                    user_lines or ["Нужная область не была отмечена."],
                    reference_lines or ["Правильная область не найдена."],
                    user_label="Твоё действие",
                    reference_label="Нужно было отметить",
                    note=explanation,
                )

            if task_type == "draw":
                prompt_local = _first_text(content.get("prompt"), content.get("question"), prompt)
                annotations = content.get("annotations") if isinstance(content.get("annotations"), list) else []
                annotation_labels: List[str] = []
                for idx, annotation in enumerate(annotations):
                    if not isinstance(annotation, dict):
                        continue
                    label = _first_text(annotation.get("label"), annotation.get("title")) or f"Контур {idx + 1}"
                    annotation_labels.append(label)

                def _draw_target_label(result_item: Dict[str, Any], fallback_prefix: str) -> str:
                    target_idx = result_item.get("target_index")
                    try:
                        idx_value = int(target_idx)
                    except Exception:
                        idx_value = None
                    if idx_value is not None and 0 <= idx_value < len(annotation_labels):
                        return annotation_labels[idx_value]
                    return fallback_prefix

                matched_lines: List[str] = []
                missed_lines: List[str] = []
                polygon_results = details.get("polygon_results") if isinstance(details.get("polygon_results"), list) else []
                line_results = details.get("line_results") if isinstance(details.get("line_results"), list) else []
                for idx, result_item in enumerate(polygon_results):
                    if not isinstance(result_item, dict):
                        continue
                    label = _draw_target_label(result_item, f"Контур {idx + 1}")
                    coverage = result_item.get("coverage")
                    coverage_text = f" ({round(float(coverage))}%)" if isinstance(coverage, (int, float)) else ""
                    rendered = f"{label}{coverage_text}"
                    if result_item.get("polygon_success"):
                        matched_lines.append(rendered)
                    else:
                        missed_lines.append(rendered)
                for idx, result_item in enumerate(line_results):
                    if not isinstance(result_item, dict):
                        continue
                    label = _draw_target_label(result_item, f"Линия {idx + 1}")
                    coverage = result_item.get("coverage")
                    coverage_text = f" ({round(float(coverage))}%)" if isinstance(coverage, (int, float)) else ""
                    rendered = f"{label}{coverage_text}"
                    if result_item.get("line_success"):
                        matched_lines.append(rendered)
                    else:
                        missed_lines.append(rendered)

                labels_details = details.get("labels") if isinstance(details.get("labels"), dict) else {}
                unmatched_labels = labels_details.get("unmatched_labels") if isinstance(labels_details.get("unmatched_labels"), list) else []
                user_lines = []
                reference_lines = []
                for unmatched in unmatched_labels:
                    if not isinstance(unmatched, (list, tuple)) or len(unmatched) < 3:
                        continue
                    raw_index, user_value, correct_value = unmatched[0], unmatched[1], unmatched[2]
                    prefix = ""
                    try:
                        idx = int(raw_index)
                    except Exception:
                        idx = None
                    if idx is not None and 0 <= idx < len(annotation_labels):
                        prefix = f"{annotation_labels[idx]}: "
                    user_lines.append(f"{prefix}{_normalize_answer_value(user_value) or 'не указано'}")
                    reference_lines.append(f"{prefix}{_normalize_answer_value(correct_value) or 'не указано'}")
                if matched_lines:
                    user_lines.append(f"Совпало: {', '.join(matched_lines)}")
                if missed_lines:
                    user_lines.append(f"Не совпало: {', '.join(missed_lines)}")
                if not reference_lines:
                    reference_lines = annotation_labels
                return _make_review_payload_for_review(
                    task_title,
                    prompt_local,
                    user_lines or ["Контуры пользователя не совпали с референсом."],
                    reference_lines or ["Референсные контуры не найдены."],
                    reference_label="Нужно было обвести",
                    note=explanation,
                )

            return _make_review_payload_for_review(
                task_title,
                prompt,
                [user_answer or "Ответ не был зафиксирован."],
                [correct_answer or "Правильный ответ не найден."],
                user_label="Твой ответ",
                reference_label="Правильный ответ",
                note=explanation,
                user_items=user_review_items,
                reference_items=reference_review_items,
            )

        try:
            results = data.get("iteration_results")
            if isinstance(results, list):
                for item in results:
                    if not isinstance(item, dict):
                        continue
                    task_ref = item.get("task_ref")
                    if not task_ref or not isinstance(task_ref, str):
                        continue
                    parts = task_ref.split("/")
                    if len(parts) < 3:
                        continue

                    should_load_task = not (
                        item.get("task_name")
                        and item.get("review")
                    )
                    if not should_load_task:
                        continue

                    try:
                        task_data_full = self._storage_service.load_task(parts[0], parts[1], parts[-1])
                        td = task_data_full.get("task_data") if isinstance(task_data_full, dict) else None
                        if not isinstance(td, dict):
                            continue

                        meta = td.get("meta") or {}
                        if isinstance(meta, dict):
                            name = meta.get("name") or meta.get("title")
                            if name and not item.get("task_name"):
                                item["task_name"] = str(name)

                        review_payload = _build_task_review(item, td)
                        for key, value in review_payload.items():
                            if value and not item.get(key):
                                item[key] = value
                    except Exception:
                        continue
        except Exception:
            logger.exception("[SessionAPI.get_iteration_results] Failed to enrich review payload")

        # Обогащаем iteration_results человекочитаемыми названиями заданий.
        try:
            results = data.get("iteration_results")
            if isinstance(results, list):
                for item in results:
                    if not isinstance(item, dict):
                        continue
                    task_ref = item.get("task_ref")
                    if not task_ref or not isinstance(task_ref, str):
                        continue

                    # Пробуем извлечь task_id из task_ref для удобства фронта.
                    parts = task_ref.split("/")
                    if len(parts) >= 3:
                        item.setdefault("module_id", parts[0])
                        item.setdefault("topic_id", parts[1])
                        item.setdefault("task_id", parts[-1])

                    # Если name уже есть, не трогаем.
                    if item.get("task_name"):
                        continue

                    try:
                        task_data_full = self._storage_service.load_task(parts[0], parts[1], parts[-1])
                        td = task_data_full.get("task_data") if isinstance(task_data_full, dict) else None
                        if isinstance(td, dict):
                            meta = td.get("meta") or {}
                            if isinstance(meta, dict):
                                name = meta.get("name") or meta.get("title")
                                if name:
                                    item["task_name"] = str(name)
                    except Exception:
                        # Не ломаем выдачу результатов итерации из-за одного задания
                        continue
        except Exception:
            logger.exception("[SessionAPI.get_iteration_results] Failed to enrich iteration_results with task names")

        # Добавляем человекочитаемое название комплекса, если оно доступно
        try:
            complex_id = data.get("complex_id")
            if complex_id:
                complex_obj = self._complex_service.get_complex(complex_id)
                if complex_obj is not None:
                    data.setdefault("complex_name", getattr(complex_obj, "name", complex_id))
        except Exception:
            # Не ломаем выдачу результатов итерации, если что-то пошло не так
            logger.exception("[SessionAPI.get_iteration_results] Failed to enrich complex_name")

        return data

    def _build_iterations_for_web(self, session: Any) -> list[dict[str, Any]]:
        """Собрать агрегированные данные по итерациям для web UI.

        Формат соответствует ожиданиям UI (frontend/S3/index.html):
        - iteration / index
        - total_tasks
        - successful_tasks
        - failed_tasks
        - success_rate
        - start_time / end_time (ISO)
        - duration_seconds

        Важно: skipped попытки не считаем ни в total, ни в success/failed.
        """

        if session is None:
            return []

        completed = getattr(session, "completed_tasks", None)
        if not isinstance(completed, list) or not completed:
            return []

        # Группируем по iteration_index
        by_iter: dict[int, list[Any]] = {}
        legacy_without_iteration: list[Any] = []
        for r in completed:
            try:
                it = int(getattr(r, "iteration_index", 0) or 0)
            except Exception:
                it = 0
            if it <= 0:
                # Старые сессии могли быть сохранены без iteration_index.
                # Если валидных индексов вообще нет, позже соберём их как одну итерацию.
                legacy_without_iteration.append(r)
                continue
            by_iter.setdefault(it, []).append(r)

        if not by_iter:
            if not legacy_without_iteration:
                return []
            by_iter[1] = legacy_without_iteration

        out: list[dict[str, Any]] = []
        for it in sorted(by_iter.keys()):
            items = by_iter[it]

            # Исключаем skipped
            filtered: list[Any] = []
            for r in items:
                details = getattr(r, "details", None) or {}
                try:
                    status = details.get("status") if isinstance(details, dict) else None
                except Exception:
                    status = None
                if status == "skipped":
                    continue
                filtered.append(r)

            total = len(filtered)
            successful = sum(1 for r in filtered if bool(getattr(r, "success", False)))
            failed = total - successful
            rate = (successful / total) if total > 0 else 0.0

            # Тайминги
            times = []
            for r in filtered:
                ts = getattr(r, "timestamp", None)
                if ts is not None:
                    times.append(ts)
            start_time = min(times) if times else None
            end_time = max(times) if times else None
            duration_seconds = None
            try:
                if start_time is not None and end_time is not None:
                    duration_seconds = int((end_time - start_time).total_seconds())
            except Exception:
                duration_seconds = None

            out.append(
                {
                    "iteration": it,
                    "total_tasks": total,
                    "successful_tasks": successful,
                    "failed_tasks": failed,
                    "success_rate": rate,
                    "start_time": start_time.isoformat() if start_time is not None else None,
                    "end_time": end_time.isoformat() if end_time is not None else None,
                    "duration_seconds": duration_seconds,
                }
            )

        return out

    def _build_problem_tasks_for_web(self, session: Any) -> List[Dict[str, Any]]:
        if session is None:
            return []

        completed = getattr(session, "completed_tasks", None)
        if not isinstance(completed, list) or not completed:
            return []

        problem_tasks_by_ref: Dict[str, Dict[str, Any]] = {}

        for result in completed:
            task_ref = getattr(result, "task_ref", None)
            if not task_ref:
                continue

            details = getattr(result, "details", None) or {}
            if isinstance(details, dict) and details.get("status") == "skipped":
                continue

            if bool(getattr(result, "success", False)):
                continue

            item = problem_tasks_by_ref.setdefault(
                task_ref,
                {
                    "task_ref": task_ref,
                    "errors": 0,
                },
            )
            item["errors"] += 1

        if not problem_tasks_by_ref:
            return []

        for task_ref, item in problem_tasks_by_ref.items():
            parts = str(task_ref).split("/")
            if len(parts) >= 3:
                module_id, topic_id, task_id = parts[0], parts[1], parts[-1]
                item.setdefault("module_id", module_id)
                item.setdefault("topic_id", topic_id)
                item.setdefault("task_id", task_id)

                try:
                    task_data_full = self._storage_service.load_task(module_id, topic_id, task_id)
                    td = task_data_full.get("task_data") if isinstance(task_data_full, dict) else None
                    if isinstance(td, dict):
                        meta = td.get("meta") or {}
                        if isinstance(meta, dict):
                            name = meta.get("name") or meta.get("title")
                            if name:
                                item["task_name"] = str(name)
                            item["meta"] = meta
                except Exception:
                    logger.exception(
                        "[SessionAPI.get_final_results] Failed to enrich problem task %s",
                        task_ref,
                    )

        return sorted(
            problem_tasks_by_ref.values(),
            key=lambda item: (-int(item.get("errors") or 0), str(item.get("task_name") or item.get("task_ref") or "")),
        )

    def get_final_results(self, session_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Завершить сессию и вернуть итоговый ExtendedSessionResultSummary как dict.
        Если активной сессии нет (переход на S3 после завершения), пытаемся восстановить
        из репозитория и сгенерировать/вернуть финальную сводку, вместо 404.
        """
        summary_from_cache = False

        # 1) Пытаемся завершить активную сессию
        session = self.get_session(session_id, user_id=user_id)
        if not session:
            return None

        summary = self._session_manager.end_session(session_id)

        # 2) Если активной нет, пробуем восстановить и сгенерировать
        if summary is None:
            session = self.get_session(session_id, user_id=user_id)
            if not session:
                return None

            # Если уже есть сохраненная сводка в сессии — используем её
            summary = getattr(session, "_final_summary", None)
            if summary is not None:
                summary_from_cache = True

            # Иначе восстановим в менеджер и попробуем завершить, чтобы зафиксировать completion
            if summary is None:
                try:
                    # restore_session сохранит в _active_sessions, но не сделает активной, если завершена
                    if not self._session_manager.get_session(session_id):
                        self._session_manager.restore_session(session)
                    summary = self._session_manager.end_session(session_id)
                except Exception:
                    logger.exception("[SessionAPI.get_final_results] Failed to restore/end session %s", session_id)
                    summary = None

        if summary is None:
            return None

        if hasattr(summary, "dict"):
            data = summary.dict()
        else:
            data = getattr(summary, "__dict__", {})

        # Web UI (S3) умеет отображать "Динамика по итерациям", если backend отдаёт массив iterations.
        # Сейчас ExtendedSessionResultSummary не содержит iterations, поэтому добавляем их прямо в payload.
        try:
            existing_iterations = data.get("iterations") if isinstance(data, dict) else None
            if isinstance(data, dict) and (not isinstance(existing_iterations, list) or not existing_iterations):
                iters = self._build_iterations_for_web(session)
                if iters:
                    data["iterations"] = iters
        except Exception:
            logger.exception("[SessionAPI.get_final_results] Failed to build iterations dynamics")

        try:
            existing_problem_tasks = data.get("problem_tasks") if isinstance(data, dict) else None
            if isinstance(data, dict) and (not isinstance(existing_problem_tasks, list) or not existing_problem_tasks):
                problem_tasks = self._build_problem_tasks_for_web(session)
                if problem_tasks:
                    data["problem_tasks"] = problem_tasks
        except Exception:
            logger.exception("[SessionAPI.get_final_results] Failed to build problem tasks payload")

        # Если сводка взята из кеша сохраненной сессии, убеждаемся, что completion зафиксирован для streak
        if summary_from_cache:
            try:
                mgr = getattr(self._session_manager, "user_progress_manager", None)
                if mgr and hasattr(mgr, "add_complex_completion"):
                    # Проверяем, не записано ли уже completion для этой сессии
                    completions = []
                    try:
                        completions = mgr.progress_data.get("complex_completions", []) if hasattr(mgr, "progress_data") else []
                    except Exception:
                        completions = []
                    already = any(
                        isinstance(entry, dict) and entry.get("session_id") == session_id
                        for entry in completions
                    )
                    if not already:
                        mgr.add_complex_completion(
                            complex_id=data.get("complex_id") or getattr(session, "complex_id", None),
                            session_id=session_id,
                            timestamp=datetime.utcnow().isoformat(),
                        )
            except Exception:
                logger.exception("[SessionAPI.get_final_results] Failed to ensure completion for session %s", session_id)

        # Hook: Update Complex Statistics
        try:
            user_id = self._resolve_runtime_user_id(
                getattr(session, "user_id", None) if session else user_id,
                allow_default_in_hosted=False,
            )
            complex_id = data.get("complex_id") or getattr(session, "complex_id", None)

            # summary is ExtendedSessionResultSummary here
            if user_id:
                updated = self._statistics_service.update_complex_stats(
                    session_result=summary,
                    user_id=user_id,
                    complex_id=complex_id
                )
                if updated:
                    logger.info("[SessionAPI.get_final_results] Complex statistics updated for session %s", session_id)
                else:
                    logger.warning(
                        "[SessionAPI.get_final_results] Complex statistics update returned False for session %s",
                        session_id,
                    )
            else:
                logger.warning(
                    "[SessionAPI.get_final_results] Skipping complex statistics update for session %s due to missing user_id",
                    session_id,
                )
        except HostedShadowWriteFallbackDisabledError:
            raise
        except Exception:
            logger.exception("[SessionAPI.get_final_results] Failed to update complex statistics for session %s", session_id)

        return data

    # ------------------------------------------------------------------
    # Вспомогательные методы
    # ------------------------------------------------------------------

    def _serialize_evaluation_result(self, result: Any, session_id: str, task_ref: str) -> Dict[str, Any]:
        """Преобразовать EvaluationResult (или аналогичный объект) к dict."""
        # Если это уже dict или Pydantic-модель
        if isinstance(result, dict):
            base: Dict[str, Any] = dict(result)
        elif hasattr(result, "dict"):
            base = result.dict()  # type: ignore[assignment]
        elif hasattr(result, "__dict__"):
            base = dict(result.__dict__)
        else:
            base = {"raw": str(result)}

        # Гарантируем наличие базовых полей
        base.setdefault("success", getattr(result, "success", None))
        base.setdefault("message", getattr(result, "message", None))
        details = base.get("details") or getattr(result, "details", {})
        if not isinstance(details, dict):
            details = {"raw": str(details)}

        # Попытка нормализовать details для sequence_assembly задач
        try:
            task_type = details.get("task_type") or base.get("task_type")
            if task_type == "sequence_assembly":
                if hasattr(WebSequenceResultDetails, "model_validate"):
                    seq_details = WebSequenceResultDetails.model_validate(details)
                else:
                    seq_details = WebSequenceResultDetails(**details)

                if hasattr(seq_details, "model_dump"):
                    details = seq_details.model_dump()
                else:
                    details = seq_details.dict()
        except Exception:
            logger.exception(
                "[SessionAPI._serialize_evaluation_result] Failed to normalize sequence_assembly result details"
            )

        base["details"] = details
        base.update(
            {
                "session_id": session_id,
                "task_ref": task_ref,
            }
        )

        return base

    # ------------------------------------------------------------------
    # Вспомогательные методы для web-сериализации заданий
    # ------------------------------------------------------------------

    def _enrich_task_data_for_web(self, task_data: Dict[str, Any], task_dir: Optional[str]) -> None:
        """Добавить в task_data дополнительные поля, удобные для web-UI.

        Сейчас основная цель — сформировать image_url для вариантов ответов
        тестовых заданий с картинками, чтобы фронтенд не гадал файловые пути.
        """

        # Определяем директорию задания, если она есть
        task_dir_path: Optional[Path] = None
        try:
            if task_dir:
                task_dir_path = Path(task_dir)
        except Exception:
            task_dir_path = None

        hosted_runtime = self._is_hosted_runtime()

        def _first_text(*values: Any) -> str:
            for value in values:
                if isinstance(value, str):
                    text = value.strip()
                    if text:
                        return text
            return ""

        def _strip_hosted_path_only_image_fields(payload: Any, image_path: Optional[str] = None) -> None:
            if not hosted_runtime or not isinstance(payload, dict):
                return

            payload.pop("image_path", None)
            image_value = payload.get("image")
            if isinstance(image_value, str):
                normalized_image_value = image_value.strip()
                normalized_image_path = str(image_path or "").strip()
                if normalized_image_value and (
                    not normalized_image_path or normalized_image_value == normalized_image_path
                ):
                    payload.pop("image", None)
            elif isinstance(image_value, dict):
                image_value.pop("image_path", None)
                image_value.pop("path", None)
                if not image_value:
                    payload.pop("image", None)

        def _nested_image_payload_asset(payload: Any) -> Tuple[Optional[str], Optional[str], Optional[str]]:
            if not isinstance(payload, dict):
                return None, None, None
            nested = payload.get("image")
            if not isinstance(nested, dict):
                return None, None, None
            return (
                _first_text(
                    nested.get("asset_url"),
                    nested.get("image_asset_url"),
                    nested.get("url"),
                    nested.get("image_url"),
                ),
                _first_text(
                    nested.get("asset_id"),
                    nested.get("image_asset_id"),
                ),
                _first_text(
                    nested.get("path"),
                    nested.get("image_path"),
                    nested.get("src"),
                ),
            )

        def _asset_content_url(asset_id: Any) -> str:
            clean_asset_id = str(asset_id or "").strip()
            if not clean_asset_id:
                return ""
            return f"/api/assets/{quote(clean_asset_id)}/content"

        def _normalize_existing_image_ref(value: Any) -> str:
            raw = str(value or "").strip()
            if not raw:
                return ""
            if raw.startswith("/api/assets/") or raw.startswith("http://") or raw.startswith("https://"):
                return raw
            if raw.startswith("data:"):
                return raw
            if "/api/local-image" in raw:
                try:
                    parsed = urlparse(raw)
                    params = parse_qs(parsed.query or "")
                    asset_id = str((params.get("asset_id") or [""])[0] or "").strip()
                    if asset_id:
                        return _asset_content_url(asset_id)
                    if hosted_runtime:
                        return ""
                    return raw
                except Exception:
                    return ""
            if hosted_runtime:
                return ""
            return raw

        def _is_web_image_ref(value: Any) -> bool:
            raw = str(value or "").strip()
            return bool(
                raw.startswith("/api/assets/")
                or raw.startswith("/api/local-image")
                or raw.startswith("http://")
                or raw.startswith("https://")
                or raw.startswith("data:")
            )

        def _normalize_question_image_ref(raw_ref: Any) -> Optional[Dict[str, str]]:
            asset_url = ""
            asset_id = ""
            image_path = ""

            if isinstance(raw_ref, str):
                value = raw_ref.strip()
                if not value:
                    return None
                normalized = _normalize_existing_image_ref(value)
                if not normalized:
                    return None
                if _is_web_image_ref(normalized):
                    asset_url = normalized
                else:
                    image_path = normalized
            elif isinstance(raw_ref, dict):
                nested_asset_url, nested_asset_id, nested_image_path = _nested_image_payload_asset(raw_ref)
                asset_url = _first_text(
                    raw_ref.get("asset_url"),
                    raw_ref.get("image_asset_url"),
                    raw_ref.get("image_url"),
                    raw_ref.get("url"),
                    nested_asset_url,
                )
                asset_id = _first_text(
                    raw_ref.get("asset_id"),
                    raw_ref.get("image_asset_id"),
                    nested_asset_id,
                )
                image_value = raw_ref.get("image")
                image_path = _first_text(
                    raw_ref.get("path"),
                    raw_ref.get("image_path"),
                    image_value if isinstance(image_value, str) else "",
                    raw_ref.get("src"),
                    nested_image_path,
                )
            else:
                return None

            if asset_url:
                normalized_url = _normalize_existing_image_ref(asset_url)
                if normalized_url and _is_web_image_ref(normalized_url):
                    asset_url = normalized_url
                elif normalized_url and not image_path:
                    image_path = normalized_url
                    asset_url = ""
                else:
                    asset_url = ""

            if image_path:
                normalized_path = _normalize_existing_image_ref(image_path)
                if normalized_path and _is_web_image_ref(normalized_path):
                    asset_url = asset_url or normalized_path
                    image_path = ""
                else:
                    image_path = normalized_path

            if asset_id and not asset_url:
                asset_url = _asset_content_url(asset_id)

            if hosted_runtime and image_path and not asset_url and not asset_id:
                image_path = ""

            ref: Dict[str, str] = {}
            if image_path:
                ref["path"] = image_path
            if asset_id:
                ref["asset_id"] = asset_id
            if asset_url:
                ref["asset_url"] = asset_url
            return ref or None

        def _normalize_question_image_refs(question: Dict[str, Any]) -> List[Dict[str, str]]:
            raw_images = question.get("images")
            candidates: List[Any] = []
            if isinstance(raw_images, list):
                candidates.extend(raw_images)

            nested_asset_url, nested_asset_id, nested_image_path = _nested_image_payload_asset(question)
            legacy_candidate = {
                "path": _first_text(
                    question.get("image_path"),
                    question.get("image") if isinstance(question.get("image"), str) else "",
                    nested_image_path,
                ),
                "asset_id": _first_text(question.get("image_asset_id"), question.get("asset_id"), nested_asset_id),
                "asset_url": _first_text(
                    question.get("image_asset_url"),
                    question.get("image_url"),
                    question.get("asset_url"),
                    nested_asset_url,
                ),
            }
            if not candidates:
                candidates.append(legacy_candidate)

            refs: List[Dict[str, str]] = []
            seen: Set[str] = set()
            for candidate in candidates:
                if len(refs) >= 3:
                    break
                ref = _normalize_question_image_ref(candidate)
                if not ref:
                    continue
                key = ref.get("asset_url") or (
                    f"asset:{ref.get('asset_id')}" if ref.get("asset_id") else ""
                ) or ref.get("path") or ""
                if not key or key in seen:
                    continue
                seen.add(key)
                refs.append(ref)
            if not refs and isinstance(raw_images, list) and raw_images:
                ref = _normalize_question_image_ref(legacy_candidate)
                if ref:
                    refs.append(ref)
            return refs

        def _apply_question_image_refs(question: Dict[str, Any]) -> None:
            had_image_list = "images" in question
            had_legacy_image = bool(
                _first_text(
                    question.get("image_path"),
                    question.get("image"),
                    question.get("image_asset_id"),
                    question.get("asset_id"),
                    question.get("image_asset_url"),
                    question.get("image_url"),
                    question.get("asset_url"),
                )
            )
            refs = _normalize_question_image_refs(question)
            if refs or had_image_list or had_legacy_image:
                question["images"] = refs

            first = refs[0] if refs else None
            if first:
                if first.get("asset_url"):
                    question["image_url"] = first["asset_url"]
                    question["image_asset_url"] = first["asset_url"]
                else:
                    question.pop("image_url", None)
                    question.pop("image_asset_url", None)

                if first.get("asset_id"):
                    question["image_asset_id"] = first["asset_id"]
                else:
                    question.pop("image_asset_id", None)

                if first.get("path"):
                    question["image_path"] = first["path"]
                    question["image"] = first["path"]
                else:
                    question.pop("image_path", None)
                    image_value = question.get("image")
                    if isinstance(image_value, str):
                        question.pop("image", None)
            else:
                _, _, nested_image_path = _nested_image_payload_asset(question)
                image_path = _first_text(
                    question.get("image_path"),
                    question.get("image") if isinstance(question.get("image"), str) else "",
                    nested_image_path,
                )
                _strip_hosted_path_only_image_fields(question, image_path)
                question.pop("image_url", None)

        def _apply_canonical_image_url(url: str, content_payload: Any) -> None:
            clean_url = str(url or "").strip()
            if not clean_url:
                return
            task_data["image_url"] = clean_url
            task_data["image"] = clean_url
            if isinstance(content_payload, dict):
                content_payload["image_url"] = clean_url
                content_payload["image"] = clean_url
                task_data["content"] = content_payload

        # Определяем тип задания
        task_type = task_data.get("type") or task_data.get("task_type")
        if task_type in {"click", "draw", "open_answer"}:
            content = task_data.get("content") or {}

            # Не затираем уже подготовленный image_url, но выравниваем stable alias в image/content.image.
            existing = _normalize_existing_image_ref(task_data.get("image_url"))
            if not existing:
                existing = _normalize_existing_image_ref(task_data.get("image"))
            if not existing and isinstance(content, dict):
                existing = _normalize_existing_image_ref(content.get("image_url"))
                if not existing:
                    existing = _normalize_existing_image_ref(content.get("image"))
            if existing:
                _apply_canonical_image_url(existing, content)
                return

            asset_url = None
            asset_id = None
            if isinstance(content, dict):
                asset_url = _first_text(
                    content.get("image_asset_url"),
                    content.get("asset_url"),
                )
                asset_id = _first_text(
                    content.get("image_asset_id"),
                    content.get("asset_id"),
                )
                nested_asset_url, nested_asset_id, nested_image_path = _nested_image_payload_asset(content)
                if not asset_url:
                    asset_url = nested_asset_url
                if not asset_id:
                    asset_id = nested_asset_id
            else:
                nested_image_path = None
            if not asset_url:
                asset_url = _first_text(
                    task_data.get("image_asset_url"),
                    task_data.get("asset_url"),
                )
            if not asset_id:
                asset_id = _first_text(
                    task_data.get("image_asset_id"),
                    task_data.get("asset_id"),
                )
            task_nested_asset_url, task_nested_asset_id, task_nested_image_path = _nested_image_payload_asset(task_data)
            if not asset_url:
                asset_url = task_nested_asset_url
            if not asset_id:
                asset_id = task_nested_asset_id
            if asset_url:
                _apply_canonical_image_url(asset_url, content)
                return
            if asset_id:
                url = _asset_content_url(asset_id)
                _apply_canonical_image_url(url, content)
                return

            img_path = None
            if isinstance(content, dict):
                img_path = _first_text(
                    content.get("image_path"),
                    content.get("image"),
                    nested_image_path,
                    task_data.get("image_path"),
                    task_data.get("image"),
                    task_nested_image_path,
                )
            else:
                img_path = _first_text(
                    task_data.get("image_path"),
                    task_data.get("image"),
                    task_nested_image_path,
                )

            if not img_path:
                return

            abs_path: Optional[str] = None
            try:
                if os.path.isabs(str(img_path)):
                    abs_path = os.path.abspath(str(img_path))
                elif task_dir_path is not None:
                    candidate = (task_dir_path / str(img_path)).resolve()
                    abs_path = str(candidate)
                else:
                    data_dir = getattr(self._storage_service, "data_dir", None)
                    if isinstance(data_dir, Path):
                        candidate = (data_dir / str(img_path)).resolve()
                        abs_path = str(candidate)
            except Exception:
                abs_path = None

            if not abs_path:
                return

            if hosted_runtime:
                _strip_hosted_path_only_image_fields(content, img_path)
                _strip_hosted_path_only_image_fields(task_data, img_path)
                if isinstance(content, dict):
                    task_data["content"] = content
                return

            url = f"/api/local-image?path={quote(abs_path)}"
            _apply_canonical_image_url(url, content)
            return

        if task_type != "test":
            return

        content = task_data.get("content") or {}
        questions = content.get("questions") or task_data.get("questions") or []
        if not isinstance(questions, list):
            return

        for q in questions:
            if not isinstance(q, dict):
                continue
            _apply_question_image_refs(q)
            answers = q.get("answers") or []
            if not isinstance(answers, list):
                continue
            for ans in answers:
                if not isinstance(ans, dict):
                    continue
                asset_url = _first_text(
                    ans.get("image_asset_url"),
                    ans.get("asset_url"),
                )
                asset_id = _first_text(
                    ans.get("image_asset_id"),
                    ans.get("asset_id"),
                )
                if not ans.get("image_url"):
                    if asset_url:
                        ans["image_url"] = asset_url
                        continue
                    if asset_id:
                        ans["image_url"] = _asset_content_url(asset_id)
                        continue
                img_path = ans.get("image_path") or ans.get("image")
                # Не затираем уже подготовленный image_url
                if not img_path or ans.get("image_url"):
                    continue

                abs_path: Optional[str] = None
                try:
                    # 1. Абсолютный путь
                    if os.path.isabs(img_path):
                        abs_path = os.path.abspath(img_path)
                    # 2. Относительно task_dir
                    elif task_dir_path is not None:
                        candidate = (task_dir_path / img_path).resolve()
                        abs_path = str(candidate)
                    # 3. Fallback: относительно data_dir
                    else:
                        data_dir = getattr(self._storage_service, "data_dir", None)
                        if isinstance(data_dir, Path):
                            candidate = (data_dir / img_path).resolve()
                            abs_path = str(candidate)
                except Exception:
                    abs_path = None

                if not abs_path:
                    continue

                # Создаём URL, который HTTP-сервер сможет отдать через /api/local-image
                if hosted_runtime:
                    _strip_hosted_path_only_image_fields(ans, img_path)
                    continue

                ans["image_url"] = f"/api/local-image?path={quote(abs_path)}"
