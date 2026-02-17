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
        
        # ITERATION MISMATCH PROTECTION: Track iteration for current task
        self._current_task_iteration: Optional[int] = None
        
        # ИСПРАВЛЕНИЕ: Флаг для отслеживания показа результатов итерации
        # Это предотвращает повторный показ результатов одной и той же итерации
        self._last_shown_iteration: Optional[int] = None
        
        # ИСПРАВЛЕНИЕ: Оптимизация частоты сохранения состояния UI
        self._last_ui_state: Optional[Dict[str, Any]] = None  # Последнее сохраненное состояние
        self._last_save_time: Optional[float] = None  # Время последнего сохранения
        self._save_debounce_timer: Optional[Any] = None  # Таймер для debouncing
        self._state_saved_recently: bool = False  # Флаг недавнего сохранения
        self._save_debounce_delay: float = 0.5  # Задержка debouncing в секундах (500ms)
        self._recent_save_threshold: float = 1.0  # Порог для "недавнего сохранения" в секундах
        
        # Callbacks для UI
        self.on_task_changed: Optional[Callable] = None
        self.on_session_completed: Optional[Callable] = None
        self.on_iteration_completed: Optional[Callable] = None
        self.on_complex_completed: Optional[Callable] = None  # Callback для завершения комплекса (все задания на максимальной сложности)
        self.on_error: Optional[Callable[[str], None]] = None
        
    def start_session(self, complex_id: str, user_id: str, start_iteration: int = 1) -> bool:
        """
        Начинает новую сессию.
        """
        logger.info(f"[ComplexSessionController.start_session] ========== НАЧАЛО start_session ==========")
        logger.info(f"[ComplexSessionController.start_session] complex_id={complex_id}, user_id={user_id}, start_iteration={start_iteration}")
        
        try:
            session = self.session_manager.start_session(complex_id, user_id, start_iteration)
            self.current_session_id = session.id
            
            logger.info(f"[ComplexSessionController.start_session] Сессия создана: session_id={session.id}, "
                       f"iteration={session.iteration}, queue_length={len(session.queue) if session.queue else 0}")
            
            # Загружаем первое задание
            logger.info("[ComplexSessionController.start_session] Загружаем первое задание")
            self._load_next_task()
            
            logger.info(f"[ComplexSessionController.start_session] ========== КОНЕЦ start_session ==========")
            return True
        except Exception as e:
            logger.error(f"[ComplexSessionController.start_session] Failed to start session: {e}", exc_info=True)
            if self.on_error:
                self.on_error(str(e))
            return False
    
    def restore_session(self, complex_id: str, user_id: str) -> bool:
        """
        Восстанавливает существующую сессию из файла.
        
        Args:
            complex_id: ID комплекса
            user_id: ID пользователя
        
        Returns:
            bool: True если восстановление успешно, False в противном случае
        """
        logger.info(f"[ComplexSessionController.restore_session] ========== НАЧАЛО restore_session ==========")
        logger.info(f"[ComplexSessionController.restore_session] complex_id={complex_id}, user_id={user_id}")
        
        try:
            # Загружаем сессию из файла
            logger.info("[ComplexSessionController.restore_session] Загружаем сессию из репозитория")
            session = self.session_manager.session_repository.load_session(complex_id, user_id)
            
            if not session:
                logger.warning(f"[ComplexSessionController.restore_session] Session not found for complex {complex_id}")
                return False
            
            logger.info(f"[ComplexSessionController.restore_session] Сессия загружена: session_id={session.id}, "
                       f"iteration={session.iteration}, queue_length={len(session.queue) if session.queue else 0}, "
                       f"current_task_index={session.current_task_index}, completed_tasks={len(session.completed_tasks)}")
            
            # Проверяем, что комплекс все еще существует
            complex_obj = self.complex_service.get_complex(complex_id)
            if not complex_obj:
                logger.warning(f"[ComplexSessionController.restore_session] Complex {complex_id} not found - deleting session")
                # Удаляем сессию для несуществующего комплекса
                self.session_manager.session_repository.delete_session(complex_id, user_id)
                if self.on_error:
                    self.on_error("Комплекс был удален. Сессия отменена.")
                return False
            
            # Восстанавливаем сессию в памяти
            logger.info("[ComplexSessionController.restore_session] Восстанавливаем сессию в памяти")
            self.session_manager.restore_session(session)
            self.current_session_id = session.id
            
            logger.info(f"[ComplexSessionController.restore_session] Сессия восстановлена в памяти: current_session_id={self.current_session_id}")
            
            # ИСПРАВЛЕНИЕ: Проверяем состояние UI перед загрузкой задания
            # Если состояние = "iteration_results", не загружаем задание - UI сам покажет экран результатов
            ui_state = self.restore_ui_state()
            logger.info(f"[ComplexSessionController.restore_session] Состояние UI: {ui_state}")
            
            # Если сохранился экран результатов задачи, а очередь есть — не залипаем на повторном показе
            if ui_state and ui_state.get("screen_type") == "task_results":
                logger.info("[ComplexSessionController.restore_session] UI state = task_results; очищаем, чтобы продолжить очередь")
                self.clear_ui_state()
                ui_state = None
            
            if ui_state and ui_state.get("screen_type") == "iteration_results":
                logger.info(f"[ComplexSessionController.restore_session] UI state = iteration_results, не загружаем задание - UI покажет экран результатов")
                # Не загружаем задание - AdaptiveSessionScreen.on_show() обработает состояние UI
                return True
            
            # Загружаем текущее задание (если очередь не пуста)
            if session.queue and session.current_task_index < len(session.queue):
                # Загружаем задание, на котором остановились
                logger.info(f"[ComplexSessionController.restore_session] Загружаем текущее задание (индекс {session.current_task_index})")
                self._load_current_task()
            else:
                # Очередь пуста или индекс вышел за пределы - загружаем следующее
                logger.info("[ComplexSessionController.restore_session] Очередь пуста или индекс вышел за пределы - загружаем следующее задание")
                self._load_next_task()
            
            logger.info(f"[ComplexSessionController.restore_session] ========== КОНЕЦ restore_session ==========")
            return True
            
        except Exception as e:
            logger.error(f"Failed to restore session: {e}")
            if self.on_error:
                self.on_error(f"Ошибка восстановления сессии: {e}")
            return False
    
    def _load_current_task(self):
        """
        Загружает текущее задание из сессии (для восстановления).
        Использует task_ref из ui_state, если доступен, иначе использует current_task_index.
        """
        if not self.current_session_id:
            return
        
        session = self.session_manager.get_session(self.current_session_id)
        if not session or not session.queue:
            return
        
        # ИСПРАВЛЕНИЕ: Сначала проверяем task_ref из ui_state
        task_index = None
        ui_state = self.restore_ui_state()
        if ui_state and ui_state.get("task_ref"):
            task_ref_from_state = ui_state.get("task_ref")
            logger.info(f"[_load_current_task] Найден task_ref в ui_state: {task_ref_from_state}")
            
            # Ищем индекс задания в очереди по task_ref
            for idx, queued_task in enumerate(session.queue):
                if queued_task.task_ref == task_ref_from_state:
                    task_index = idx
                    logger.info(f"[_load_current_task] Найден индекс задания в очереди: {task_index} (было current_task_index={session.current_task_index})")
                    break
            
            if task_index is None:
                logger.warning(f"[_load_current_task] task_ref {task_ref_from_state} не найден в очереди, используем current_task_index={session.current_task_index}")
        
        # Если task_ref не найден в ui_state или не найден в очереди, используем current_task_index
        if task_index is None:
            task_index = session.current_task_index
        
        # Синхронизируем current_task_index с найденным индексом
        if task_index is not None and task_index != session.current_task_index:
            # Не откатываемся назад, если в сессии индекс уже продвинут дальше
            if task_index < session.current_task_index:
                logger.info(f"[_load_current_task] Найденный индекс {task_index} < текущего {session.current_task_index}, "
                            f"не откатываем current_task_index")
            else:
                logger.info(f"[_load_current_task] Синхронизируем current_task_index: {session.current_task_index} -> {task_index}")
                session.current_task_index = task_index
        
        # Берем задание по найденному индексу (не увеличиваем индекс)
        if task_index < len(session.queue):
            queued_task = session.queue[task_index]
            task_ref = queued_task.task_ref
            difficulty = queued_task.difficulty
            
            self.current_task_ref = task_ref
            
            # Парсим task_ref
            try:
                parts = task_ref.split('/')
                if len(parts) >= 3:
                    module_id = parts[0]
                    topic_id = parts[1]
                    task_id = parts[-1]
                    
                    # Загружаем данные задания
                    task_data_full = self.storage_service.load_task(module_id, topic_id, task_id)
                    
                    if not task_data_full:
                        raise ValueError(f"Task not found: {task_ref}")
                    
                    # Если это ретрай тестового задания и в сессии есть информация
                    # о заваленных под-вопросах, подрезаем questions до этих индексов
                    try:
                        if (
                            hasattr(session, 'test_failed_subtests')
                            and session.test_failed_subtests
                            and queued_task.is_retry
                        ):
                            failed_indices = session.test_failed_subtests.get(task_ref) or []
                            td = task_data_full.get('task_data') or {}
                            if td.get('type') == 'test' and failed_indices:
                                content = td.get('content') or {}
                                questions = content.get('questions') or []
                                if isinstance(questions, list) and questions:
                                    filtered = [
                                        q for i, q in enumerate(questions)
                                        if i in failed_indices
                                    ]
                                    if filtered:
                                        # Подменяем только в загруженном экземпляре (на диске ничего не меняем)
                                        content['questions'] = filtered
                                        td['content'] = content
                                        task_data_full['task_data'] = td
                    except Exception as e:
                        logger.warning(
                            "[_load_current_task] Failed to apply partial retry for test task %s: %s",
                            task_ref,
                            e,
                        )

                    # Устанавливаем уровень сложности
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
                        self.on_task_changed({
                            "task_ref": task_ref,
                            "difficulty": difficulty,
                            "is_retry": queued_task.is_retry,
                            "index": session.current_task_index,
                            "total": len(session.queue),
                            "iteration": session.iteration
                        })
                    
                    # Сохраняем состояние UI: загрузка текущего задания (для восстановления)
                    # Не сохраняем здесь, если уже есть состояние task_results - оно будет сохранено при проверке
                    if not session.ui_state or session.ui_state.get("screen_type") != "task_results":
                        self.save_ui_state("task", task_ref=task_ref)
                else:
                    raise ValueError(f"Invalid task reference format: {task_ref}")
                    
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
                try:
                    parts = queued_task.task_ref.split("/")
                    if len(parts) >= 3:
                        module_id, topic_id, task_id = parts[0], parts[1], parts[-1]
                        task_data_full = self.storage_service.load_task(module_id, topic_id, task_id)
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
                        self.save_ui_state("task", task_ref=queued_task.task_ref)
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

        if iteration_completed:
            # Для синтетических daily_mix сессий не генерируем следующую итерацию — завершаем сразу.
            if getattr(session, "complex_id", None) == "daily_mix":
                logger.info("[ComplexSessionController._load_next_task] daily_mix итерация завершена, завершаем сессию")
                self._handle_session_completion()
                return

            # Если результаты этой итерации уже были показаны, пропускаем показ и генерируем следующую итерацию
            if self._last_shown_iteration == completed_iteration:
                logger.info(f"[ComplexSessionController._load_next_task] Результаты итерации {completed_iteration} уже были показаны, генерируем следующую итерацию")
                # Сбрасываем флаг, чтобы следующая итерация могла показать свои результаты
                self._last_shown_iteration = None
                # Продолжаем выполнение - генерируем следующую итерацию через get_next_task()
            else:
                logger.info(f"[ComplexSessionController._load_next_task] Итерация {completed_iteration} завершена, показываем результаты итерации")
                # ИСПРАВЛЕНИЕ: Сначала генерируем следующую итерацию, затем показываем результаты
                # Это гарантирует, что следующая итерация будет готова после нажатия "Продолжить"
                logger.debug(f"[ComplexSessionController._load_next_task] Генерируем следующую итерацию перед показом результатов")
                
                # Генерируем следующую итерацию (для всех complex_id, включая synthetic daily_mix)
                complex_obj = self.complex_service.get_complex(session.complex_id)
                if not complex_obj:
                    logger.error(f"[ComplexSessionController._load_next_task] Complex {session.complex_id} not found")
                    self._handle_session_completion()
                    return
            
                # Сохраняем текущий индекс перед генерацией (он уже >= len(queue))
                old_index = session.current_task_index
                old_iteration = session.iteration
                logger.info(f"[ComplexSessionController._load_next_task] Перед генерацией следующей итерации: "
                           f"old_index={old_index}, old_iteration={old_iteration}, "
                           f"queue_length={len(session.queue) if session.queue else 0}")
            
                # Генерируем следующую итерацию
                logger.info("[ComplexSessionController._load_next_task] Вызываем _generate_next_iteration()")
                try:
                    self.session_manager._generate_next_iteration(session, complex_obj)
                    
                    # Восстанавливаем индекс на 0 (начало новой очереди)
                    # Это нужно, чтобы при следующем вызове get_next_task() было получено первое задание
                    session.current_task_index = 0
                    
                    logger.info(f"[ComplexSessionController._load_next_task] После генерации следующей итерации: "
                               f"new_iteration={session.iteration}, new_index={session.current_task_index}, "
                               f"new_queue_length={len(session.queue) if session.queue else 0}")
                    
                    # Сохраняем сессию после генерации следующей итерации
                    logger.info(f"[ComplexSessionController._load_next_task] Сохраняем сессию после генерации итерации")
                    self.session_manager.session_repository.save_session(session, session.user_id)
                    
                    # Проверяем, пуста ли очередь после генерации
                    if not session.queue:
                        # Проверяем, нужно ли показать финальные результаты
                        if hasattr(session, '_should_show_final_results') and session._should_show_final_results:
                            logger.info(f"[ComplexSessionController._load_next_task] Комплекс завершен - все задания на максимальной сложности")
                            # Показываем финальные результаты вместо обычного завершения
                            self._handle_complex_completion()
                            return
                        else:
                            logger.info(f"[ComplexSessionController._load_next_task] Следующая итерация пуста, сессия завершена")
                            self._handle_session_completion()
                            return
                except Exception as e:
                    # ИСПРАВЛЕНИЕ: Обрабатываем ошибки при генерации следующей итерации
                    # Логируем ошибку, но не прерываем показ результатов итерации
                    logger.error(f"[ComplexSessionController._load_next_task] Ошибка при генерации следующей итерации: {e}", exc_info=True)
                    logger.warning(f"[ComplexSessionController._load_next_task] Продолжаем показ результатов итерации {completed_iteration} несмотря на ошибку")
                    # Не прерываем выполнение - показываем результаты итерации даже при ошибке
                
                # ИСПРАВЛЕНИЕ: Очищаем состояние UI от task_results перед показом результатов итерации
                # Это гарантирует, что при восстановлении после нажатия "Продолжить" будет загружено первое задание следующей итерации
                logger.info("[ComplexSessionController._load_next_task] Очищаем состояние UI от task_results перед показом результатов итерации")
                try:
                    ui_state_before = self.restore_ui_state()
                    logger.debug(f"[ComplexSessionController._load_next_task] Состояние UI до очистки: {ui_state_before}")
                    self.clear_ui_state()
                    ui_state_after = self.restore_ui_state()
                    logger.debug(f"[ComplexSessionController._load_next_task] Состояние UI после очистки: {ui_state_after}")
                except Exception as e:
                    logger.warning(f"[ComplexSessionController._load_next_task] Ошибка при очистке состояния UI: {e}", exc_info=True)
                
                # Следующая итерация сгенерирована, но мы еще не загружаем задание
                # Сначала показываем результаты завершенной итерации
                # Уведомляем UI о завершении итерации для показа результатов
                if hasattr(self, 'on_iteration_completed') and self.on_iteration_completed:
                    iteration_summary = self.session_manager.get_iteration_summary(self.current_session_id, completed_iteration)
                    if iteration_summary:
                        logger.info(f"[ComplexSessionController._load_next_task] IterationSummary создан: iteration={iteration_summary.iteration}, "
                                  f"total_tasks={iteration_summary.total_tasks}, successful_tasks={iteration_summary.successful_tasks}, "
                                  f"failed_tasks={iteration_summary.failed_tasks}, success_rate={iteration_summary.success_rate:.2%}")
                        logger.debug(f"[ComplexSessionController._load_next_task] Вызываем callback on_iteration_completed с summary типа {type(iteration_summary).__name__}")
                        # Сохраняем номер итерации, результаты которой были показаны
                        self._last_shown_iteration = completed_iteration
                        self.on_iteration_completed(iteration_summary)
                        # ВАЖНО: Не продолжаем загрузку следующего задания здесь
                        # UI покажет экран результатов итерации, и только после нажатия "Продолжить" будет вызван _load_next_task() снова
                        # Следующая итерация уже сгенерирована, поэтому при следующем вызове _load_next_task() будет загружено первое задание следующей итерации
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
            # Сессия завершена - очередь пуста
            logger.info(f"[ComplexSessionController._load_next_task] get_next_task() вернул None, сессия завершена (очередь пуста)")
            self._handle_session_completion()
            return
        
        task_ref = next_task_info['task_ref']
        difficulty = next_task_info['difficulty']
        
        logger.info(f"[ComplexSessionController._load_next_task] Получено следующее задание: task_ref={task_ref}, "
                   f"difficulty={difficulty}, iteration={next_task_info.get('iteration')}, "
                   f"index={next_task_info.get('index')}/{next_task_info.get('total')}")
        
        self.current_task_ref = task_ref
        
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
                self.save_ui_state("task", task_ref=task_ref)
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
                if session_result is not None and hasattr(session_result, "success"):
                    evaluation_result.success = bool(getattr(session_result, "success"))
            except Exception:
                logger.exception("[ComplexSessionController.submit_answer] Failed to sync evaluation_result.success with session_result.success")
            
            # ИСПРАВЛЕНИЕ: Сохраняем состояние UI после отправки ответа
            # Это гарантирует, что состояние будет сохранено даже если пользователь закроет приложение
            logger.debug("[ComplexSessionController.submit_answer] Сохраняем состояние UI после отправки ответа")
            try:
                self.save_ui_state("task_results", task_ref=task_ref, evaluation_result=evaluation_result)
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
                current_task_submitted = any(
                    result.task_ref == self.current_task_ref and
                    result.iteration_index == session.iteration
                    for result in session.completed_tasks
                )
                
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
            if screen_type in ("task", "task_results"):
                task_ref = kwargs.get("task_ref") or self.current_task_ref
                if task_ref:
                    new_ui_state["task_ref"] = task_ref
                    
                    # Для результатов задач не трогаем current_task_index, чтобы не сдвигать очередь новой итерации
                    if screen_type != "task_results":
                        # ИСПРАВЛЕНИЕ: Синхронизируем current_task_index с task_ref только если:
                        # 1. Текущий индекс указывает на задание, которое не соответствует task_ref
                        # 2. ИЛИ текущий индекс вне диапазона очереди
                        # НЕ синхронизируем, если текущий индекс уже указывает на правильное задание
                        # И не откатываем индекс назад при повторяющихся заданиях
                        skip_sync_due_to_iteration = False
                        try:
                            # Если есть информация об итерации результата и она меньше текущей - не синхронизируем
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
                                    logger.info("[ComplexSessionController.save_ui_state] Пропускаем синхронизацию current_task_index: результат из прошлой итерации "
                                                f"(result_iter={result_iter}, current_iter={current_iter}, task_ref={task_ref})")
                        except Exception as e:
                            logger.debug(f"[ComplexSessionController.save_ui_state] Не удалось определить итерацию для task_ref={task_ref}: {e}")
                        
                        if skip_sync_due_to_iteration:
                            pass
                        else:
                            if session.queue:
                                current_idx = session.current_task_index
                                # Если индекс уже вышел за пределы очереди, не трогаем его,
                                # чтобы логика завершения итерации могла сработать корректно.
                                if current_idx >= len(session.queue):
                                    logger.debug(
                                        "[ComplexSessionController.save_ui_state] current_task_index=%s вне диапазона (queue_len=%s), "
                                        "не синхронизируем по task_ref=%s",
                                        current_idx,
                                        len(session.queue),
                                        task_ref,
                                    )
                                else:
                                    # Проверяем, указывает ли текущий индекс на правильное задание
                                    if current_idx < len(session.queue):
                                        current_queued_task = session.queue[current_idx]
                                        if current_queued_task.task_ref == task_ref:
                                            # Текущий индекс уже указывает на правильное задание - не синхронизируем
                                            logger.debug(f"[ComplexSessionController.save_ui_state] current_task_index={current_idx} уже указывает на task_ref={task_ref}, пропускаем синхронизацию")
                                        else:
                                            # Текущий индекс указывает на другое задание - ищем правильный индекс
                                            found_idx = None
                                            for idx, queued_task in enumerate(session.queue):
                                                if queued_task.task_ref == task_ref:
                                                    found_idx = idx
                                                    # ИСПРАВЛЕНИЕ: Используем найденный индекс только если он >= текущего
                                                    # Это предотвращает откат индекса назад при повторяющихся заданиях
                                                    if found_idx >= current_idx:
                                                        if session.current_task_index != found_idx:
                                                            logger.info(f"[ComplexSessionController.save_ui_state] Синхронизируем current_task_index: "
                                                                       f"{session.current_task_index} -> {found_idx} (по task_ref={task_ref})")
                                                            session.current_task_index = found_idx
                                                        break
                                            if found_idx is None or found_idx < current_idx:
                                                logger.warning(f"[ComplexSessionController.save_ui_state] task_ref {task_ref} не найден в очереди после индекса {current_idx}, оставляем текущий индекс")
                else:
                    logger.warning("Cannot save UI state: task_ref not provided")
                    return False
                
                if screen_type == "task_results":
                    evaluation_result = kwargs.get("evaluation_result")
                    if evaluation_result:
                        # Сериализуем результат проверки в JSON-совместимый формат
                        if hasattr(evaluation_result, 'dict'):
                            # Pydantic модель
                            new_ui_state["evaluation_result"] = evaluation_result.dict()
                        elif hasattr(evaluation_result, '__dict__'):
                            # Обычный объект
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
                    self._last_ui_state.get("iteration_number") != new_ui_state.get("iteration_number") or
                    self._last_ui_state.get("evaluation_result") != new_ui_state.get("evaluation_result")
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