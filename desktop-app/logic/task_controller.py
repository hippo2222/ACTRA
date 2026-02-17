"""
Task Controller - Управление жизненным циклом задания.

Координирует работу сервисов для:
- Загрузки заданий
- Оценки ответов пользователя
- Сохранения прогресса
- Управления состоянием (skip, reset)

НЕДЕЛЯ 2, Logic Layer - Блок A: Task Controller
"""

import sys
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime
import logging

# Добавляем пути для импорта
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# Импортируем систему исключений
from task_system.core.exceptions import TaskLoadError, EvaluationError

# Импортируем сервисы из Блоков A, B, C
from services.task_evaluator_service import TaskEvaluatorService, EvaluationResult
from services.progress_service import ProgressService
# ImageService можно импортировать при необходимости

# Импортируем DifficultyManager для Фазы 2
try:
    from services.difficulty_manager import DifficultyManager
    DIFFICULTY_MANAGER_AVAILABLE = True
except ImportError:
    DIFFICULTY_MANAGER_AVAILABLE = False
    DifficultyManager = None  # type: ignore


class TaskState(Enum):
    """
    Состояния жизненного цикла задания.
    
    Переходы:
        NOT_STARTED → IN_PROGRESS (load_task)
        IN_PROGRESS → COMPLETED (submit_answer с success)
        IN_PROGRESS → FAILED (submit_answer с failure)
        IN_PROGRESS → SKIPPED (skip_task)
        IN_PROGRESS → IN_PROGRESS (reset_task)
    """
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class Task:
    """
    Данные задания.
    
    Содержит всю информацию о текущем задании:
    - ID и метаданные
    - Данные задания (content)
    - Правильные ответы (answer_key)
    - Пользовательский ввод
    """
    module_id: str
    topic_id: str
    task_id: str
    task_type: str  # 'click', 'draw', 'open_answer', 'sequence_assembly', 'test'
    task_data: Dict[str, Any]  # Содержимое task.json
    answer_key: Dict[str, Any]  # Правильные ответы
    
    # Пользовательский ввод (заполняется по мере выполнения)
    user_input: Optional[Any] = None
    
    # Время начала задания
    started_at: datetime = field(default_factory=datetime.now)
    
    @property
    def full_id(self) -> str:
        """Полный ID задания"""
        return f"{self.module_id}/{self.topic_id}/{self.task_id}"
    
    @property
    def time_spent(self) -> int:
        """Время выполнения в секундах"""
        return int((datetime.now() - self.started_at).total_seconds())


class TaskController:
    """
    Контроллер для управления жизненным циклом задания.
    
    Координирует работу сервисов:
    - TaskEvaluatorService - оценка ответов
    - ProgressService - сохранение прогресса
    - DifficultyManager - применение уровней сложности (Фаза 2)
    
    Использование:
        controller = TaskController(evaluator_service, progress_service, difficulty_manager=difficulty_manager)
        
        # Загрузка задания
        task = controller.load_task(module_id, topic_id, task_id, task_data, answer_key)
        
        # Отправка ответа
        result = controller.submit_answer(user_input)
        
        # Управление
        controller.skip_task()
        controller.reset_task()
    """
    
    def __init__(self, 
                 evaluator_service: TaskEvaluatorService,
                 progress_service: ProgressService,
                 session_manager: Optional['SessionManager'] = None,
                 difficulty_manager: Optional['DifficultyManager'] = None):
        """
        Инициализация TaskController.
        
        Args:
            evaluator_service: Сервис для оценки заданий
            progress_service: Сервис для сохранения прогресса
            session_manager: Менеджер сессии (опционально, для записи результатов текущей сессии)
            difficulty_manager: Менеджер уровней сложности (опционально, для Фазы 2)
        """
        self.evaluator_service = evaluator_service
        self.progress_service = progress_service
        self.session_manager = session_manager
        self.difficulty_manager = difficulty_manager
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Текущее задание
        self.current_task: Optional[Task] = None
        self.task_state: TaskState = TaskState.NOT_STARTED
        self.current_difficulty_level: Optional[int] = None
        
        # Флаг для явного указания уровня сложности из UI
        self._explicit_difficulty_level: Optional[int] = None
        
        # Флаг для явного указания уровня сложности из UI
        self._explicit_difficulty_level: Optional[int] = None
    
    # =========================================================================
    # ЗАГРУЗКА ЗАДАНИЯ
    # =========================================================================
    
    def load_task(self, module_id: str, topic_id: str, task_id: str,
                  task_data: Dict[str, Any], answer_key: Dict[str, Any]) -> Task:
        """
        Загружает задание и готовит к выполнению.
        
        Применяет уровень сложности через DifficultyManager (если доступен):
        - Определяет уровень сложности из прогресса пользователя или начального уровня
        - Модифицирует задание в памяти для выбранного уровня
        - Сохраняет уровень для последующего использования в submit_answer()
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
            task_data: Содержимое task.json (будет модифицировано через DifficultyManager)
            answer_key: Правильные ответы
        
        Returns:
            Task: Загруженное задание (с модифицированными данными для уровня сложности)
        
        Example:
            >>> task = controller.load_task(
            ...     "anatomy", "liver", "liver_click_01",
            ...     task_data={'type': 'click', ...},
            ...     answer_key={'targets': [...]}
            ... )
            >>> print(task.task_type)
            'click'
        """
        try:
            self.logger.debug(
                f"Загрузка задания: {module_id}/{topic_id}/{task_id}"
            )
            
            # 1. Определяем уровень сложности
            difficulty_level = self._determine_difficulty_level(
                module_id, topic_id, task_id, task_data
            )
            self.current_difficulty_level = difficulty_level
            
            # 2. Применяем уровень сложности (если DifficultyManager доступен)
            enhanced_task_data = task_data
            if self.difficulty_manager:
                task_ref = f"{module_id}/{topic_id}/{task_id}"
                try:
                    enhanced_task_data = self.difficulty_manager.enhance_task_for_level(
                        task_data,
                        level=difficulty_level,
                        task_ref=task_ref
                    )
                    self.logger.debug(
                        f"Применен уровень сложности {difficulty_level} для задания {task_ref}"
                    )
                except Exception as e:
                    # При ошибке используем исходное задание (fallback на уровень 1)
                    self.logger.warning(
                        f"Ошибка при применении уровня сложности для задания {module_id}/{topic_id}/{task_id}: {e}, "
                        f"используем исходное задание"
                    )
                    enhanced_task_data = task_data
                    # Устанавливаем уровень 1 при ошибке
                    self.current_difficulty_level = 1
            else:
                # DifficultyManager не доступен - используем исходное задание
                self.logger.debug(
                    f"DifficultyManager не доступен, используем исходное задание"
                )
            
            # 3. Определяем тип задания из модифицированного задания
            task_type = enhanced_task_data.get('type', 'click')
            if not task_type:
                task_type = enhanced_task_data.get('content', {}).get('type', 'click')
            
            # Проверяем флаги валидации из DifficultyManager (если задание уже модифицировано)
            if enhanced_task_data.get('_difficulty_enhanced'):
                stored_level = enhanced_task_data.get('_difficulty_level', difficulty_level)
                original_type = enhanced_task_data.get('_original_type', task_type)
                self.logger.info(
                    f"Задание модифицировано для уровня сложности {stored_level}, "
                    f"исходный тип: {original_type}, текущий тип: {task_type}"
                )
                # Синхронизируем уровень из флагов
                if stored_level != difficulty_level:
                    self.logger.warning(
                        f"Несоответствие уровней: определен {difficulty_level}, "
                        f"в задании {stored_level}, используем {stored_level}"
                    )
                    self.current_difficulty_level = stored_level
            
            if not task_type:
                raise TaskLoadError(
                    f"Task type not specified for task {module_id}/{topic_id}/{task_id}",
                    details={'module_id': module_id, 'topic_id': topic_id, 'task_id': task_id}
                )
            
            # 4. Создаём объект Task с модифицированными данными
            task = Task(
                module_id=module_id,
                topic_id=topic_id,
                task_id=task_id,
                task_type=task_type,
                task_data=enhanced_task_data,  # Используем модифицированное задание
                answer_key=answer_key
            )
            
            # 5. Сохраняем как текущее задание
            self.current_task = task
            self.task_state = TaskState.IN_PROGRESS
            
            self.logger.info(
                f"Задание загружено: {task.full_id} (тип: {task_type}, уровень: {self.current_difficulty_level})"
            )
            
            return task
        
        except TaskLoadError:
            # Re-raise TaskLoadError as is
            raise
        except Exception as e:
            self.logger.exception(f"Error loading task: {module_id}/{topic_id}/{task_id}")
            raise TaskLoadError(
                f"Error loading task: {e}",
                details={'module_id': module_id, 'topic_id': topic_id, 'task_id': task_id, 'error_type': type(e).__name__}
            ) from e
    
    def _determine_difficulty_level(
        self, module_id: str, topic_id: str, task_id: str, task_data: Dict[str, Any]
    ) -> int:
        """
        Определяет уровень сложности для задания.
        
        Приоритет определения:
        1. Явно установленный уровень (если был установлен из UI через _explicit_difficulty_level)
        2. Из DifficultyManager.get_initial_level() (если доступен) - всегда возвращает 1 для новых заданий
        3. Fallback: settings.difficulty из задания или 1
        
        НЕ использует прогресс для начального уровня при открытии задания из директории.
        Всегда начинаем с уровня 1. Прогресс используется только для эскалации после выполнения.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
            task_data: Данные задания
        
        Returns:
            int: Уровень сложности (1, 2, или 3)
        """
        # 1. Проверяем, не установлен ли уровень явно (из UI)
        if hasattr(self, '_explicit_difficulty_level') and self._explicit_difficulty_level is not None:
            level = self._explicit_difficulty_level
            self.logger.debug(
                f"Уровень сложности установлен явно из UI: {level} "
                f"для задания {module_id}/{topic_id}/{task_id}"
            )
            # Сбрасываем флаг после использования
            self._explicit_difficulty_level = None
            return level
        
        # 1.5. Пробуем взять уровень из сохранённого прогресса
        try:
            if self.progress_service:
                progress = self.progress_service.get_task_progress(module_id, topic_id, task_id)
                if progress and 'current_difficulty' in progress:
                    level = int(progress.get('current_difficulty') or 1)
                    self.logger.debug(
                        f"Уровень сложности восстановлен из прогресса: {level} "
                        f"для задания {module_id}/{topic_id}/{task_id}"
                    )
                    return level
        except Exception as e:
            self.logger.debug(
                f"Не удалось получить уровень из прогресса для {module_id}/{topic_id}/{task_id}: {e}"
            )
        
        # 2. Использовать DifficultyManager для определения начального уровня (всегда 1 для новых заданий)
        if self.difficulty_manager:
            try:
                initial_level = self.difficulty_manager.get_initial_level(task_data)
                self.logger.debug(
                    f"Уровень сложности определен через DifficultyManager: {initial_level} "
                    f"для задания {module_id}/{topic_id}/{task_id}"
                )
                return initial_level
            except Exception as e:
                self.logger.debug(
                    f"Не удалось определить уровень через DifficultyManager: {e}, "
                    f"используем fallback"
                )
        
        # 3. Fallback: использовать settings.difficulty из задания или 1
        default_level = task_data.get('settings', {}).get('difficulty', 1)
        self.logger.debug(
            f"Уровень сложности определен из settings.difficulty: {default_level} "
            f"для задания {module_id}/{topic_id}/{task_id}"
        )
        return default_level
    
    # =========================================================================
    # ОТПРАВКА ОТВЕТА
    # =========================================================================
    
    def submit_answer(self, user_input: Any) -> EvaluationResult:
        """
        Отправляет ответ пользователя на оценку и сохраняет результат.
        
        Args:
            user_input: Ответ пользователя (формат зависит от типа задания)
        
        Returns:
            EvaluationResult: Результат оценки
        
        Raises:
            RuntimeError: Если задание не загружено
        
        Example:
            >>> # Для click задания
            >>> result = controller.submit_answer({
            ...     'x': 100, 'y': 100,
            ...     'scale_factor': 1.0,
            ...     'offset_x': 0, 'offset_y': 0
            ... })
            >>> print(result.success)
            True
        """
        if not self.current_task:
            error_msg = "No task loaded. Call load_task() first."
            self.logger.error(error_msg)
            raise RuntimeError(error_msg)
        
        task = self.current_task
        
        # Сохраняем пользовательский ввод
        task.user_input = user_input
        
        # Получаем уровень сложности (используем сохраненный или fallback на 1)
        difficulty_level = self.current_difficulty_level if self.current_difficulty_level is not None else 1
        
        self.logger.debug(
            f"Отправка ответа для задания {task.full_id} "
            f"(тип: {task.task_type}, уровень: {difficulty_level})"
        )
        
        # Для тестов answer_key пустой, нужно передать task_data
        # (правильные ответы находятся в task_data['questions'])
        answer_key_or_data = task.answer_key if task.answer_key else task.task_data
        
        # Совместимость: для draw используем task_data, если в answer_key нет targets с полигонами
        if task.task_type == 'draw':
            def _has_polygon_targets(obj):
                try:
                    if not isinstance(obj, dict):
                        return False
                    targets = obj.get('targets', [])
                    if not targets:
                        return False
                    # Проверяем наличие хотя бы одного полигона
                    # Полигон может быть без поля 'shape', если есть 'points' - это тоже полигон
                    for target in targets:
                        points = target.get('points', [])
                        # Если есть points и их >= 3, это полигон (даже без shape)
                        if isinstance(points, list) and len(points) >= 3:
                            return True
                        # Или явно указано shape == 'polygon'
                        if target.get('shape') == 'polygon' and points:
                            if len(points) >= 3:
                                return True
                    return False
                except Exception:
                    return False
            
            def _convert_annotations_to_targets(task_data_dict):
                """Преобразует аннотации из task_data в формат targets"""
                try:
                    # Получаем annotations из content
                    content = task_data_dict.get('content', {})
                    if isinstance(content, dict):
                        annotations = content.get('annotations', [])
                    else:
                        annotations = task_data_dict.get('annotations', [])
                    
                    if not annotations:
                        return None
                    
                    # Преобразуем аннотации в targets
                    targets = []
                    for ann in annotations:
                        if isinstance(ann, dict):
                            # Проверяем тип аннотации
                            ann_type = ann.get('type', '')
                            points = ann.get('points', [])
                            
                            # Если это полигон и есть точки
                            if (ann_type == 'polygon' or points) and isinstance(points, list) and len(points) >= 3:
                                target = {
                                    'shape': 'polygon',
                                    'points': points,
                                    'label': ann.get('label', '')
                                }
                                targets.append(target)
                    
                    if targets:
                        return {'targets': targets}
                    return None
                except Exception as e:
                    self.logger.warning(f"Ошибка преобразования аннотаций: {e}")
                    return None
            
            if not _has_polygon_targets(answer_key_or_data):
                # Если в answer_key нет полигонов, пробуем преобразовать аннотации из task_data
                if isinstance(task.task_data, dict):
                    converted = _convert_annotations_to_targets(task.task_data)
                    if converted:
                        answer_key_or_data = converted
                    elif isinstance(task.task_data, dict) and 'targets' in task.task_data:
                        # Если в task_data уже есть targets, используем их
                        answer_key_or_data = task.task_data
        
        # Совместимость: для open_answer используем task_data, если в answer_key нет ключевых слов
        if task.task_type == 'open_answer':
            def _has_keywords(obj):
                try:
                    if not isinstance(obj, dict):
                        return False
                    if obj.get('keywords'):
                        return True
                    content = obj.get('content', {})
                    return bool(content.get('keywords'))
                except Exception:
                    return False
            if not _has_keywords(answer_key_or_data):
                answer_key_or_data = task.task_data
        
        # Совместимость: для sequence_assembly используем task_data,
        # если в answer_key отсутствуют levels/correct_sequence (частый случай)
        if task.task_type == 'sequence_assembly':
            def _has_levels(obj):
                try:
                    if not isinstance(obj, dict):
                        return False
                    if obj.get('levels') or obj.get('correct_sequence'):
                        return True
                    content = obj.get('content', {})
                    return bool(content.get('levels') or content.get('correct_sequence'))
                except Exception:
                    return False
            if not _has_levels(answer_key_or_data):
                answer_key_or_data = task.task_data
        
        # Оценка через TaskEvaluatorService (Блок A)
        # Pass task_data to evaluator for accessing settings (e.g., tolerancePx)
        try:
            result = self.evaluator_service.evaluate_task(
                task_type=task.task_type,
                user_input=user_input,
                answer_key=answer_key_or_data,
                task_data=task.task_data
            )
        except EvaluationError:
            # Re-raise EvaluationError as is
            raise
        except Exception as e:
            self.logger.exception(f"Error evaluating task {task.full_id}")
            raise EvaluationError(
                f"Error evaluating task: {e}",
                details={
                    'module_id': task.module_id,
                    'topic_id': task.topic_id,
                    'task_id': task.task_id,
                    'task_type': task.task_type,
                    'error_type': type(e).__name__
                }
            ) from e
        
        # Обновляем состояние в зависимости от результата
        if result.success:
            self.task_state = TaskState.COMPLETED
        else:
            self.task_state = TaskState.FAILED
        
        # Добавляем difficulty в result.details для сохранения
        if result.details is None:
            result.details = {}
        
        # Используем сохраненный уровень сложности (из load_task)
        # Если не установлен, используем fallback
        if 'difficulty' not in result.details:
            result.details['difficulty'] = difficulty_level
        
        # Добавляем time_spent
        if 'time_spent' not in result.details:
            result.details['time_spent'] = task.time_spent
        
        # Добавляем task_type для эскалации уровней (Шаг 2.7)
        if 'task_type' not in result.details:
            result.details['task_type'] = task.task_type
        
        # Сохранение прогресса через ProgressService (Блок B)
        try:
            self.progress_service.save_evaluation_result(
                module_id=task.module_id,
                topic_id=task.topic_id,
                task_id=task.task_id,
                result=result
            )
        except Exception as e:
            self.logger.warning(f"Failed to save progress for task {task.full_id}: {e}")
            # Не выбрасываем исключение для сохранения прогресса
        
        # Записываем результат в SessionManager для текущей сессии
        if self.session_manager:
            try:
                self.session_manager.record_task_result(
                    task_id=task.task_id,
                    success=result.success
                )
            except Exception as e:
                self.logger.warning(f"Failed to record task result in session: {e}")
        
        self.logger.info(
            f"Task {task.full_id}: {result.success} "
            f"(time: {task.time_spent}s, difficulty: {difficulty_level})"
        )
        
        return result
    
    # =========================================================================
    # УПРАВЛЕНИЕ СОСТОЯНИЕМ
    # =========================================================================
    
    def skip_task(self) -> bool:
        """
        Пропускает текущее задание.
        
        Задание помечается как SKIPPED, прогресс НЕ сохраняется.
        
        Returns:
            bool: True если задание было пропущено
        
        Raises:
            RuntimeError: Если задание не загружено
        
        Example:
            >>> controller.load_task(...)
            >>> controller.skip_task()
            True
        """
        if not self.current_task:
            error_msg = "No task loaded. Call load_task() first."
            self.logger.error(error_msg)
            raise RuntimeError(error_msg)
        
        task = self.current_task
        
        # Помечаем как пропущенное
        self.task_state = TaskState.SKIPPED
        
        self.logger.info(f"Task {task.full_id} skipped")
        
        # НЕ сохраняем в прогресс
        return True
    
    def reset_task(self) -> bool:
        """
        Сбрасывает задание в начальное состояние.
        
        Очищает пользовательский ввод, возвращает состояние в IN_PROGRESS.
        Время started_at обновляется.
        Также удаляет все попытки из базы данных.
        
        Returns:
            bool: True если задание было сброшено
        
        Raises:
            RuntimeError: Если задание не загружено
        
        Example:
            >>> controller.load_task(...)
            >>> controller.submit_answer(wrong_answer)  # Неправильный ответ
            >>> controller.reset_task()  # Попробуем ещё раз
            True
        """
        if not self.current_task:
            error_msg = "No task loaded. Call load_task() first."
            self.logger.error(error_msg)
            raise RuntimeError(error_msg)
        
        task = self.current_task
        
        # ИСПРАВЛЕНИЕ: Удаляем все попытки из базы данных
        try:
            self.progress_service.reset_task_progress(
                module_id=task.module_id,
                topic_id=task.topic_id,
                task_id=task.task_id
            )
            self.logger.info(f"Reset task history for {task.full_id}")
        except Exception as e:
            self.logger.warning(f"Failed to reset task history: {e}")
            # Продолжаем выполнение, даже если не удалось сбросить историю
        
        # Очищаем пользовательский ввод
        task.user_input = None
        
        # Обновляем время начала
        task.started_at = datetime.now()
        
        # Возвращаем состояние в IN_PROGRESS
        self.task_state = TaskState.IN_PROGRESS
        
        self.logger.info(f"Task {task.full_id} reset")
        
        return True
    
    def clear_task(self) -> None:
        """
        Очищает текущее задание.
        
        Используется при переходе к другому заданию.
        """
        if self.current_task:
            self.logger.debug(f"Cleared task: {self.current_task.full_id}")
        
        self.current_task = None
        self.task_state = TaskState.NOT_STARTED
        self.current_difficulty_level = None
    
    # =========================================================================
    # ГЕТТЕРЫ
    # =========================================================================
    
    def get_current_task(self) -> Optional[Task]:
        """
        Получает текущее задание.
        
        Returns:
            Task или None если задание не загружено
        """
        return self.current_task
    
    def get_task_state(self) -> TaskState:
        """
        Получает состояние текущего задания.
        
        Returns:
            TaskState
        """
        return self.task_state
    
    def is_task_loaded(self) -> bool:
        """Проверяет, загружено ли задание"""
        return self.current_task is not None
    
    def is_task_completed(self) -> bool:
        """Проверяет, завершено ли задание успешно"""
        return self.task_state == TaskState.COMPLETED
    
    def is_task_in_progress(self) -> bool:
        """Проверяет, выполняется ли задание в данный момент"""
        return self.task_state == TaskState.IN_PROGRESS
    
    # =========================================================================
    # СТАТИСТИКА
    # =========================================================================
    
    def get_task_summary(self) -> Dict[str, Any]:
        """
        Получает краткую информацию о текущем задании.
        
        Returns:
            dict: Информация о задании
        """
        if not self.current_task:
            return {
                'loaded': False,
                'state': self.task_state.value
            }
        
        task = self.current_task
        
        return {
            'loaded': True,
            'full_id': task.full_id,
            'module_id': task.module_id,
            'topic_id': task.topic_id,
            'task_id': task.task_id,
            'task_type': task.task_type,
            'state': self.task_state.value,
            'time_spent': task.time_spent,
            'has_user_input': task.user_input is not None
        }


# Экспортируемые классы
__all__ = ['TaskController', 'TaskState', 'Task']

