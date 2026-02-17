import logging
import os
import copy
import random
from pathlib import Path
from urllib.parse import quote
from typing import Any, Dict, Optional, List

from services.statistics_service import StatisticsService
from services.adaptive_session_manager import AdaptiveSessionManager
from services.complex_service import ComplexService
from services.storage_service import StorageService
from logic.complex_session_controller import ComplexSessionController
from api.web_models.sequence_models import (
    WebSequenceElement,
    WebSequenceLevel,
    WebSequenceSettings,
    WebSequenceTaskData,
    WebSequenceResultDetails,
)


logger = logging.getLogger(__name__)


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
        self._controller = session_controller
        self._session_manager = adaptive_session_manager
        self._complex_service = complex_service
        self._storage_service = storage_service
        self._statistics_service = statistics_service
        self._default_user_id = default_user_id

    # ------------------------------------------------------------------
    # Базовые операции сессии
    # ------------------------------------------------------------------

    def start_session(self, complex_id: str, user_id: Optional[str] = None, start_iteration: int = 1) -> Dict[str, Any]:
        """Запустить новую сессию комплекса и вернуть её краткие данные.

        Поведение контроллера не меняем: он сам создаёт сессию и загружает
        первое задание. Здесь только оборачиваем в dict.
        """
        user_id = user_id or self._default_user_id

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

        success = self._controller.start_session(complex_id, user_id, start_iteration=start_iteration)
        if not success or not self._controller.current_session_id:
            return {
                "ok": False,
                "error": "failed_to_start_session",
                "complex_id": complex_id,
                "user_id": user_id,
            }

        session_id = self._controller.current_session_id
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
        user_id = user_id or self._default_user_id

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

    def get_session(self, session_id: str) -> Optional[Any]:
        """Вернуть объект ComplexSession (активный или загруженный)."""
        session = self._session_manager.get_session(session_id)
        if session:
            return session
        try:
            return self._session_manager.session_repository.load_session_by_session_id(
                user_id=self._default_user_id, session_id=session_id
            )
        except Exception:
            logger.exception("[SessionAPI.get_session] Failed to load session by id %s", session_id)
            return None

    def pause_session(self, session_id: str) -> None:
        session = self.get_session(session_id)
        if not session:
            return
        self._session_manager.pause_session(session_id)

    def resume_session(self, session_id: str) -> Optional[Any]:
        session = self.get_session(session_id)
        user_id = getattr(session, "user_id", self._default_user_id) if session else self._default_user_id
        resumed = self._session_manager.resume_session(session_id, user_id)
        if resumed:
            self._controller.current_session_id = session_id
            try:
                if getattr(resumed, "queue", None):
                    idx = getattr(resumed, "current_task_index", 0)
                    if isinstance(resumed.queue, list) and 0 <= idx < len(resumed.queue):
                        qt = resumed.queue[idx]
                        task_ref = qt.task_ref
                        if task_ref:
                            self._controller.current_task_ref = task_ref
            except Exception:
                logger.exception("[SessionAPI.resume_session] Failed to sync controller task_ref")
        return resumed

    def get_current_task(self, session_id: str, auto_resume: bool = False) -> Optional[Dict[str, Any]]:
        """Вернуть описание текущего задания для активной сессии.

        Если session_id не совпадает с текущей сессией контроллера, ничего не делаем.
        """
        if not session_id:
            return None

        session = self._session_manager.get_session(session_id)
        if session and not getattr(session, "is_active", True):
            logger.warning("[SessionAPI.get_current_task] session %s is not active -> None", session_id)
            return None
        if not session and auto_resume:
            session = self.resume_session(session_id)
        if not session:
            return None

        if session.paused and auto_resume:
            session.paused = False
            session.paused_at = None
            try:
                self._session_manager.session_repository.save_session(session, session.user_id)
            except Exception:
                logger.exception("[SessionAPI.get_current_task] Failed to persist auto-resume state")

        if session_id != self._controller.current_session_id:
            logger.warning("[SessionAPI.get_current_task] session_id mismatch: api=%s, controller=%s -> syncing", session_id, self._controller.current_session_id)
            self._controller.current_session_id = session_id
            # Попробуем восстановить task_ref из очереди
            try:
                idx = getattr(session, "current_task_index", 0)
                if isinstance(session.queue, list) and 0 <= idx < len(session.queue):
                    qt = session.queue[idx]
                    task_ref_candidate = qt.task_ref
                    if task_ref_candidate:
                        self._controller.current_task_ref = task_ref_candidate
            except Exception:
                logger.exception("[SessionAPI.get_current_task] Failed to sync controller task_ref from session")

        current_task_ref = self._controller.current_task_ref
        if not current_task_ref:
            # Fallback: берём task_ref из очереди по current_task_index
            try:
                total = len(session.queue) if session.queue else 0
                if total:
                    idx = session.current_task_index
                    # Fallback: если контроллер не держит task_ref, считаем current_task_index текущим
                    if idx < 0:
                        idx = 0
                    if idx >= total:
                        idx = total - 1
                    qt = session.queue[idx]
                    tr = qt.task_ref
                    if tr:
                        current_task_ref = tr
                        self._controller.current_task_ref = tr
            except Exception:
                logger.exception("[SessionAPI.get_current_task] Failed to restore task_ref from queue fallback")
        if not current_task_ref:
            return None

        # Парсим task_ref в module/topic/task_id
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
        task_dir = task_data_full.get("task_dir")

        try:
            controller_task = getattr(getattr(self._controller, "task_controller", None), "current_task", None)
            if controller_task is not None:
                ctrl_ref = getattr(controller_task, "full_id", None)
                ctrl_task_data = getattr(controller_task, "task_data", None)
                # full_id in Task is module/topic/task_id
                if ctrl_ref == current_task_ref and isinstance(ctrl_task_data, dict):
                    task_data = copy.deepcopy(ctrl_task_data)
        except Exception:
            logger.exception("[SessionAPI.get_current_task] Failed to reuse enhanced task_data from TaskController")

        # Обогащаем task_data web-дружественными полями (например, image_url)
        if isinstance(task_data, dict):
            self._enrich_task_data_for_web(task_data, task_dir)
            task_data_full["task_data"] = task_data

            # Дополнительно нормализуем структуру для sequence_assembly задач
            try:
                task_type = task_data.get("type") or task_data.get("task_type")
                if task_type == "sequence_assembly":
                    content = task_data.get("content") or {}
                    settings_dict = (
                        task_data.get("settings")
                        or content.get("settings")
                        or {}
                    )

                    elements_src = content.get("elements") or []
                    levels_src = content.get("levels") or []

                    elements = [
                        WebSequenceElement(
                            id=e["id"],
                            text=e.get("text", ""),
                            image=e.get("image"),
                        )
                        for e in elements_src
                        if isinstance(e, dict) and "id" in e
                    ]

                    levels = [
                        WebSequenceLevel(
                            level_id=l["level_id"],
                            label=l.get("level_name"),
                            slots=list(l.get("blocks", [])),
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
                        prompt=content.get("prompt", ""),
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
        queued_task = None
        if session.queue:
            total_in_queue = len(session.queue)
            current_index = session.current_task_index

            if isinstance(current_index, int) and total_in_queue > 0:
                # Для кастомных daily_mix-сессий трактуем current_task_index как индекс текущего задания.
                if session.complex_id == "daily_mix":
                    effective_index = max(0, min(current_index, total_in_queue - 1))
                else:
                    # Вычисляем индекс текущего задания с учётом off-by-one семантики (старая логика)
                    if current_index <= 0:
                        effective_index = 0
                    else:
                        effective_index = current_index - 1

                    if effective_index >= total_in_queue:
                        effective_index = total_in_queue - 1

                if 0 <= effective_index < total_in_queue:
                    queued_task = session.queue[effective_index]
                    # Дополнительно проверяем, что task_ref совпадает, чтобы избежать
                    # рассинхронизации; в нормальном потоке это условие выполняется.
                    if queued_task.task_ref == current_task_ref:
                        difficulty = queued_task.difficulty
                        index_in_queue = effective_index
                        is_retry = queued_task.is_retry
                        origin_iteration = queued_task.origin_iteration

        # Fallback к статистике контроллера, если по какой-то причине не удалось
        # определить индекс/сложность через очередь (например, старая сессия или пустая queue).
        stats = self._controller.get_current_session_stats() or {}
        if difficulty is None:
            difficulty = stats.get("current_difficulty")
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
        try:
            if (
                is_retry
                and hasattr(session, "test_failed_subtests")
                and session.test_failed_subtests
            ):
                failed_indices = session.test_failed_subtests.get(current_task_ref) or []
                if failed_indices and isinstance(task_data, dict):
                    td = task_data
                    task_type = td.get("type") or td.get("task_type")
                    if task_type == "test":
                        content = td.get("content") or {}
                        questions = content.get("questions") or []
                        if isinstance(questions, list) and questions:
                            filtered = [
                                q for i, q in enumerate(questions)
                                if i in failed_indices
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

        return {
            "session_id": session_id,
            "task_ref": current_task_ref,
            "module_id": module_id,
            "topic_id": topic_id,
            "task_id": task_id,
            "iteration": session.iteration,
            "difficulty": difficulty,
            "is_retry": is_retry,
            "queue": {
                "index": index_in_queue,
                "total": total_in_queue,
            },
            "order_meta": order_meta,
            "task_data": task_data,
            "answer_key": task_data_full.get("answer_key"),
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

        task_data = getattr(task_obj, "task_data", None) if task_obj is not None else None
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

    def submit_answer(self, session_id: str, task_id: str, user_input: Dict[str, Any]) -> Optional[Any]:
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
            session = self._session_manager.get_session(session_id)
            if session and session.user_id == "guest":
                logger.warning("[SessionAPI.submit_answer] Rejecting submit for guest user, session_id=%s", session_id)
                return None
        except Exception:
            logger.exception("[SessionAPI.submit_answer] Failed to check guest status")
            return None
        
        if session_id != self._controller.current_session_id:
            logger.warning("[SessionAPI.submit_answer] session_id mismatch: api=%s, controller=%s -> syncing", session_id, self._controller.current_session_id)
            self._controller.current_session_id = session_id
            # Попробуем восстановить current_task_ref из сессии
            try:
                session = self._session_manager.get_session(session_id)
                if session and session.queue:
                    idx = session.current_task_index
                    if session.complex_id == "daily_mix":
                        effective_index = max(0, min(idx, len(session.queue) - 1))
                    else:
                        effective_index = idx - 1 if idx > 0 else 0
                        if effective_index >= len(session.queue):
                            effective_index = len(session.queue) - 1
                    if 0 <= effective_index < len(session.queue):
                        qt = session.queue[effective_index]
                        tr = qt.task_ref
                        if tr:
                            self._controller.current_task_ref = tr
            except Exception:
                logger.exception("[SessionAPI.submit_answer] Failed to sync task_ref on mismatch")

        current_task_ref = self._controller.current_task_ref
        if not current_task_ref:
            # Fallback: пробуем взять task_ref по task_id из очереди
            task_ref_candidate = None
            try:
                session = self._session_manager.get_session(session_id)
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
                task_data = self.get_current_task(session_id, auto_resume=True)
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
        try:
            session = self._session_manager.get_session(session_id)
            if session and session.queue:
                for idx, qt in enumerate(session.queue):
                    tr = qt.task_ref
                    if tr == current_task_ref:
                        if session.current_task_index != idx:
                            logger.info("[SessionAPI.submit_answer] Aligning current_task_index %s -> %s for task_ref=%s", session.current_task_index, idx, current_task_ref)
                            session.current_task_index = idx
                            try:
                                if self._session_manager.session_repository:
                                    self._session_manager.session_repository.save_session(session, session.user_id)
                            except Exception:
                                logger.exception("[SessionAPI.submit_answer] Failed to persist aligned current_task_index")
                        break
        except Exception:
            logger.exception("[SessionAPI.submit_answer] Failed to align current_task_index by task_ref")

        # Убедимся, что контроллер загрузил текущее задание
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
                session = self._session_manager.get_session(session_id)
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
                session = self._session_manager.get_session(session_id)
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

    def next_task(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Перейти к следующему заданию и вернуть его описание как dict."""
        logger.info("[SessionAPI.next_task] ========== НАЧАЛО next_task, session_id=%s ==========", session_id)
        session = self._session_manager.get_session(session_id)
        if session:
            logger.info("[SessionAPI.next_task] Session found: complex_id=%s, current_task_index=%s, queue_length=%s, is_active=%s", 
                       session.complex_id, 
                       session.current_task_index,
                       len(session.queue) if session.queue else 0,
                       session.is_active)
        else:
            logger.warning("[SessionAPI.next_task] Session NOT found for session_id=%s", session_id)
        
        if session and not session.is_active:
            logger.warning("[SessionAPI.next_task] session %s is not active -> session_completed", session_id)
            return {"ok": False, "error": "session_completed"}
        if session_id != self._controller.current_session_id:
            logger.warning("[SessionAPI.next_task] session_id mismatch: api=%s, controller=%s", session_id, self._controller.current_session_id)
            self._controller.current_session_id = session_id
            # Попробуем восстановить task_ref
            try:
                if session and session.queue:
                    idx = session.current_task_index
                    if session.complex_id == "daily_mix":
                        effective_index = max(0, min(idx, len(session.queue) - 1))
                    else:
                        effective_index = idx - 1 if idx > 0 else 0
                        if effective_index >= len(session.queue):
                            effective_index = len(session.queue) - 1
                    if 0 <= effective_index < len(session.queue):
                        qt = session.queue[effective_index]
                        tr = qt.task_ref
                        if tr:
                            self._controller.current_task_ref = tr
            except Exception:
                logger.exception("[SessionAPI.next_task] Failed to sync controller task_ref on mismatch")

        logger.info("[SessionAPI.next_task] Calling controller.next_task()...")
        self._controller.next_task()

        # Повторно читаем сессию: контроллер мог завершить daily_mix или другую сессию.
        session_after = self._session_manager.get_session(session_id)
        queue_after = session_after.queue if session_after else None
        current_idx_after = session_after.current_task_index if session_after else 0
        queue_len_after = len(queue_after) if queue_after else 0
        completed_after = len(session_after.completed_tasks) if session_after else 0

        session_inactive = session_after is None or not session_after.is_active
        queue_exhausted = queue_len_after == 0 or current_idx_after >= queue_len_after
        all_tasks_completed = queue_len_after > 0 and completed_after >= queue_len_after
        controller_detached = (
            getattr(self._controller, "current_session_id", None) is None
            or getattr(self._controller, "current_task_ref", None) is None
        )

        if session_inactive or queue_exhausted or all_tasks_completed or controller_detached:
            logger.info(
                "[SessionAPI.next_task] session completed after controller call: session=%s is_active=%s queue_len=%s current_idx=%s completed=%s controller_session=%s controller_task_ref=%s",
                session_after,
                session_after.is_active if session_after else None,
                queue_len_after,
                current_idx_after,
                completed_after,
                getattr(self._controller, "current_session_id", None),
                getattr(self._controller, "current_task_ref", None),
            )
            try:
                self._controller.current_task_ref = None
                if getattr(self._controller, "task_controller", None):
                    self._controller.task_controller.clear_task()
            except Exception:
                logger.exception("[SessionAPI.next_task] Failed to clear controller after completion")
            logger.info("[SessionAPI.next_task] ========== КОНЕЦ next_task, result=session_completed ==========")
            return {"ok": False, "error": "session_completed"}

        logger.info("[SessionAPI.next_task] controller.next_task() completed, calling get_current_task()...")
        result = self.get_current_task(session_id)
        logger.info("[SessionAPI.next_task] ========== КОНЕЦ next_task, result=%s ==========", "task_found" if result else "None")
        return result

    def skip_task(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Отложить текущее задание в конец очереди и загрузить следующее.

        Возвращает dict с результатом:
        - При успехе: данные следующего задания (как get_current_task)
        - При отказе: {"ok": False, "reason": "...", "error": "..."}
        - None при критической ошибке
        """
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
        return self.get_current_task(session_id)

    def cancel_session(self, session_id: str) -> Dict[str, Any]:
        """Отменить активную сессию без сохранения результатов."""
        # Даже если контроллер уже перешел к другой сессии, пробуем отменить через менеджер.
        success = False
        try:
            success = self._session_manager.cancel_session(
                session_id, user_id=self._default_user_id
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

        return {"ok": bool(success)}

    # ------------------------------------------------------------------
    # Результаты итераций и всей сессии
    # ------------------------------------------------------------------

    def get_iteration_results(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Вернуть результаты последней завершённой или текущей итерации.

        Сейчас берём номер итерации прямо из сессии и строим IterationSummary
        через AdaptiveSessionManager.get_iteration_summary, затем конвертируем
        в dict.
        """
        session = self._session_manager.get_session(session_id)
        if not session:
            logger.warning("[SessionAPI.get_iteration_results] session not found: %s", session_id)
            return None

        iteration = getattr(session, "iteration", None)
        if iteration is None:
            return None

        # Сначала пробуем взять сводку для текущей итерации. Если её нет (например,
        # мы уже перешли к следующей итерации, а интересуют результаты предыдущей),
        # делаем попытку для iteration-1.
        summary = self._session_manager.get_iteration_summary(session_id, iteration)
        if summary is None and iteration > 1:
            prev_iter = iteration - 1
            logger.info(
                "[SessionAPI.get_iteration_results] summary for iteration %s not found, "
                "trying previous iteration %s", iteration, prev_iter
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
            if isinstance(data, dict) and "iterations" not in data:
                iters = self._build_iterations_for_web(session)
                if iters:
                    data["iterations"] = iters
        except Exception:
            logger.exception("[SessionAPI.get_final_results] Failed to build iterations dynamics")

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
        for r in completed:
            try:
                it = int(getattr(r, "iteration_index", 0) or 0)
            except Exception:
                it = 0
            if it <= 0:
                # Защита от мусорных/старых данных
                continue
            by_iter.setdefault(it, []).append(r)

        if not by_iter:
            return []

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

    def get_final_results(self, session_id: str) -> Optional[Dict[str, Any]]:
        """
        Завершить сессию и вернуть итоговый ExtendedSessionResultSummary как dict.
        Если активной сессии нет (переход на S3 после завершения), пытаемся восстановить
        из репозитория и сгенерировать/вернуть финальную сводку, вместо 404.
        """
        summary_from_cache = False

        # 1) Пытаемся завершить активную сессию
        summary = self._session_manager.end_session(session_id)

        # Сессия нужна для вычисления динамики по итерациям (web S3).
        # Берём её до возможного выхода в ветку восстановления.
        session = self._session_manager.get_session(session_id)

        # 2) Если активной нет, пробуем восстановить и сгенерировать
        if summary is None:
            session = self.get_session(session_id)
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
            if isinstance(data, dict) and "iterations" not in data:
                iters = self._build_iterations_for_web(session)
                if iters:
                    data["iterations"] = iters
        except Exception:
            logger.exception("[SessionAPI.get_final_results] Failed to build iterations dynamics")

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
            user_id = getattr(session, "user_id", self._default_user_id) if session else self._default_user_id
            complex_id = data.get("complex_id") or getattr(session, "complex_id", None)

            # summary is ExtendedSessionResultSummary here
            self._statistics_service.update_complex_stats(
                session_result=summary,
                user_id=user_id,
                complex_id=complex_id
            )
            logger.info("[SessionAPI.get_final_results] Complex statistics updated for session %s", session_id)
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

        # Определяем тип задания
        task_type = task_data.get("type") or task_data.get("task_type")
        if task_type == "click":
            content = task_data.get("content") or {}

            # Не затираем уже подготовленный image_url
            existing = task_data.get("image_url")
            if not existing and isinstance(content, dict):
                existing = content.get("image_url")
            if existing:
                return

            img_path = None
            if isinstance(content, dict):
                img_path = content.get("image") or task_data.get("image")
            else:
                img_path = task_data.get("image")

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

            url = f"/api/local-image?path={quote(abs_path)}"
            task_data["image_url"] = url
            if isinstance(content, dict):
                content["image_url"] = url
                task_data["content"] = content
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
            answers = q.get("answers") or []
            if not isinstance(answers, list):
                continue
            for ans in answers:
                if not isinstance(ans, dict):
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
                ans["image_url"] = f"/api/local-image?path={quote(abs_path)}"
