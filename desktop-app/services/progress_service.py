"""
Progress Service - Wrapper над UserProgressManager для упрощённого API.

Предоставляет интеграцию между TaskEvaluatorService и UserProgressManager,
упрощая сохранение результатов оценки заданий.

НЕДЕЛЯ 2, Блок B: Progress Service
"""

from typing import Dict, Any, Optional, List, TYPE_CHECKING
import logging

# Импортируем новый UserProgressManager
from services.user_progress_manager import UserProgressManager

# Импортируем EvaluationResult из Блока A
from services.task_evaluator_service import EvaluationResult

if TYPE_CHECKING:
    from services.difficulty_manager import DifficultyManager


class ProgressService:
    """
    Сервис для управления прогрессом пользователя.
    
    Wrapper над UserProgressManager, предоставляющий:
    - Упрощённый API для сохранения результатов
    - Интеграцию с EvaluationResult из TaskEvaluatorService
    - Методы для получения статистики и прогресса
    
    Использование:
        service = ProgressService(data_dir="path/to/data")
        
        # Сохранение результата оценки
        service.save_evaluation_result(
            module_id="module_01",
            topic_id="topic_anatomy",
            task_id="task_liver_click",
            result=evaluation_result
        )
        
        # Получение прогресса
        progress = service.get_task_progress(module_id, topic_id, task_id)
        stats = service.get_overall_statistics()
    """
    
    def __init__(self, data_dir: str, user_id: str = "default_user", 
                 difficulty_manager: Optional['DifficultyManager'] = None,
                 event_bus: Optional[Any] = None):
        """
        Инициализация ProgressService.
        
        Args:
            data_dir: Путь к директории с данными
            user_id: ID пользователя (для мультипользовательской поддержки)
            difficulty_manager: DifficultyManager для эскалации уровней (опционально, Шаг 2.7)
        """
        self.data_dir = data_dir
        self.user_id = user_id
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Инициализируем UserProgressManager с DifficultyManager и EventBus
        self.progress_manager = UserProgressManager(
            data_dir=data_dir,
            user_id=user_id,
            difficulty_manager=difficulty_manager,
            event_bus=event_bus  # ← NEW: EventBus for progress events
        )
    
    def switch_user(self, user_id: str):
        """
        Переключает сервис на другого пользователя.
        
        Обновляет user_id и делегирует переключение в UserProgressManager.
        
        Args:
            user_id: ID нового пользователя
        """
        self.user_id = user_id
        self.progress_manager.switch_user(user_id)
    
    # =========================================================================
    # СОХРАНЕНИЕ РЕЗУЛЬТАТОВ
    # =========================================================================
    
    def save_evaluation_result(self, module_id: str, topic_id: str, 
                               task_id: str, result: EvaluationResult,
                               difficulty: int = 1, time_spent: int = 0,
                               complex_id: Optional[str] = None,
                               iteration: Optional[int] = None) -> bool:
        """
        Сохраняет результат оценки задания из TaskEvaluatorService.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
            result: EvaluationResult из TaskEvaluatorService
            difficulty: Уровень сложности (1-3), по умолчанию 1
            time_spent: Время выполнения в секундах, по умолчанию 0
            complex_id: ID комплекса (опционально)
            iteration: Номер итерации (опционально)
        
        Returns:
            bool: True если сохранение успешно
        
        Example:
            >>> service = ProgressService(data_dir="./data")
            >>> evaluator = TaskEvaluatorService()
            >>> result = evaluator.evaluate_task('click', user_input, answer_key)
            >>> service.save_evaluation_result("mod1", "topic1", "task1", result, difficulty=2)
            True
        """
        # GUEST MODE PROTECTION: не сохраняем результаты для гостя
        if self.user_id == "guest":
            self.logger.info("[ProgressService] Skipping save_evaluation_result for guest user")
            return False
        
        try:
            # Извлекаем difficulty из details, если не передан явно
            if difficulty == 1 and result.details:
                difficulty = result.details.get('difficulty', difficulty)
            
            # Извлекаем time_spent из details, если есть
            if time_spent == 0 and result.details:
                time_spent = result.details.get('time_spent', 0)
            
            # Извлекаем complex_id и iteration из details, если не переданы явно
            if complex_id is None and result.details:
                complex_id = result.details.get('complex_id', None)
            if iteration is None and result.details:
                iteration = result.details.get('iteration', None)
            
            # Извлекаем task_type из details для эскалации уровней (Шаг 2.7)
            task_type = None
            if result.details:
                task_type = result.details.get('task_type', None)
            
            # Сохраняем попытку через новый UserProgressManager
            success = self.progress_manager.save_attempt(
                module_id=module_id,
                topic_id=topic_id,
                task_id=task_id,
                difficulty=difficulty,
                success=result.success,
                time_spent=time_spent,
                complex_id=complex_id,
                iteration=iteration,
                task_type=task_type,
                score=result.score
            )
            
            if success:
                self.logger.info(
                    f"Saved result for {module_id}/{topic_id}/{task_id}: "
                    f"success={result.success}, difficulty={difficulty}"
                )
            
            return success
            
        except Exception as e:
            self.logger.error(f"Failed to save evaluation result: {e}")
            return False
    
    def save_detailed_attempt(self, module_id: str, topic_id: str, task_id: str,
                             difficulty: int, success: bool,
                             time_spent: int = 0, complex_id: Optional[str] = None,
                             iteration: Optional[int] = None,
                             additional_details: Optional[Dict[str, Any]] = None,
                             score: Optional[float] = None) -> bool:
        """
        Сохраняет детальную попытку выполнения задания с поддержкой уровней сложности.
        
        Этот метод предоставляет полный контроль над сохранением попытки,
        включая уровень сложности и дополнительные детали.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
            difficulty: Уровень сложности (1-3), обязательный параметр
            success: Успешность попытки
            time_spent: Время выполнения в секундах, по умолчанию 0
            complex_id: ID комплекса (опционально)
            iteration: Номер итерации (опционально)
            additional_details: Дополнительные детали для сохранения (опционально)
        
        Returns:
            bool: True если сохранение успешно
        
        Example:
            >>> service = ProgressService(data_dir="./data")
            >>> service.save_detailed_attempt(
            ...     module_id="module_01",
            ...     topic_id="topic_anatomy",
            ...     task_id="task_liver_click",
            ...     difficulty=2,
            ...     success=True,
            ...     time_spent=120,
            ...     complex_id="complex_01",
            ...     iteration=3
            ... )
            True
        """
        # GUEST MODE PROTECTION: не сохраняем результаты для гостя
        if self.user_id == "guest":
            self.logger.info("[ProgressService] Skipping save_detailed_attempt for guest user")
            return False
        
        try:
            # Валидация difficulty
            if difficulty < 1 or difficulty > 3:
                self.logger.error(f"Invalid difficulty: {difficulty}. Must be 1-3")
                return False
            
            # Сохраняем попытку через UserProgressManager
            success_result = self.progress_manager.save_attempt(
                module_id=module_id,
                topic_id=topic_id,
                task_id=task_id,
                difficulty=difficulty,
                success=success,
                time_spent=time_spent,
                complex_id=complex_id,
                iteration=iteration,
                score=score
            )
            
            if success_result:
                self.logger.info(
                    f"Saved detailed attempt for {module_id}/{topic_id}/{task_id}: "
                    f"success={success}, difficulty={difficulty}, "
                    f"time_spent={time_spent}s"
                )
            
            return success_result
            
        except Exception as e:
            self.logger.error(f"Failed to save detailed attempt: {e}")
            return False
    
    def save_task_result(self, module_id: str, topic_id: str, task_id: str,
                        success: bool, difficulty: int = 1,
                        time_spent: int = 0, **kwargs) -> bool:
        """
        Сохраняет результат задания (упрощённый вариант без EvaluationResult).
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
            success: Прошёл ли пользователь задание
            difficulty: Уровень сложности (1-3), по умолчанию 1
            time_spent: Время выполнения в секундах, по умолчанию 0
            **kwargs: Дополнительные поля (complex_id, iteration)
        
        Returns:
            bool: True если сохранение успешно
        """
        # GUEST MODE PROTECTION: не сохраняем результаты для гостя
        if self.user_id == "guest":
            self.logger.info("[ProgressService] Skipping save_task_result for guest user")
            return False
        
        try:
            success_result = self.progress_manager.save_attempt(
                module_id=module_id,
                topic_id=topic_id,
                task_id=task_id,
                difficulty=difficulty,
                success=success,
                time_spent=time_spent,
                complex_id=kwargs.get('complex_id'),
                iteration=kwargs.get('iteration')
            )
            
            if success_result:
                self.logger.info(
                    f"Saved result for {module_id}/{topic_id}/{task_id}: "
                    f"success={success}, difficulty={difficulty}"
                )
            
            return success_result
            
        except Exception as e:
            self.logger.error(f"Failed to save task result: {e}")
            return False
    
    # =========================================================================
    # ПОЛУЧЕНИЕ ПРОГРЕССА
    # =========================================================================
    
    def get_task_history(self, module_id: str, topic_id: str, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Получает историю попыток для задания.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            dict или None: {
                "attempts": [...],
                "current_difficulty": int,
                "mastery_level": str
            }
        """
        try:
            return self.progress_manager.get_task_history(module_id, topic_id, task_id)
        except Exception as e:
            self.logger.error(f"Failed to get task history: {e}")
            return None
    
    def get_task_progress(self, module_id: str, topic_id: str, 
                         task_id: str) -> Optional[Dict[str, Any]]:
        """
        Получает прогресс выполнения конкретного задания.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            dict или None: {
                'completed': bool,
                'attempts': list,
                'attempts_count': int,
                'best_score': float,
                'last_attempt': dict,
                'all_attempts': list,
                'current_difficulty': int,
                'mastery_level': str
            }
        """
        try:
            task_history = self.progress_manager.get_task_history(
                module_id=module_id,
                topic_id=topic_id,
                task_id=task_id
            )
            
            if not task_history:
                return None
            
            attempts = task_history.get("attempts", [])
            
            # Для версии 3.0 используем готовые данные из meta (O(1))
            if "meta" in task_history:
                meta = task_history["meta"]
                attempts_count = meta.get("total_attempts", len(attempts))
                success_rate = meta.get("success_rate", 0.0)
                completed = success_rate > 0
            else:
                # Для версии 2.0 вычисляем на лету (обратная совместимость)
                successful_attempts = [a for a in attempts if a.get("success", False)]
                attempts_count = len(attempts)
                completed = len(successful_attempts) > 0
            
            # Последняя попытка
            last_attempt = attempts[-1] if attempts else None
            
            return {
                'completed': completed,
                'attempts': attempts,
                'attempts_count': attempts_count,
                'last_attempt': last_attempt,
                'all_attempts': attempts,
                'current_difficulty': task_history.get("current_difficulty", 1),
                'mastery_level': task_history.get("mastery_level", "beginner")
            }
        except Exception as e:
            self.logger.error(f"Failed to get task progress: {e}")
            return None
    
    def get_topic_progress(self, module_id: str, topic_id: str) -> Optional[Dict[str, Any]]:
        """
        Получает прогресс по теме.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
        
        Returns:
            dict или None: {
                'total_tasks': int,
                'completed_tasks': int,
                'completion_percentage': float,
                'average_score': float
            }
        
        Note: В новой реализации требуется информация о всех заданиях темы,
        которая должна быть получена из StorageService. Пока возвращаем None.
        """
        # TODO: Реализовать получение прогресса по теме на основе task_history
        # Требуется интеграция со StorageService для получения списка заданий
        self.logger.warning("get_topic_progress not fully implemented in new UserProgressManager")
        return None
    
    def get_module_progress(self, module_id: str) -> Optional[Dict[str, Any]]:
        """
        Получает прогресс по модулю.
        
        Args:
            module_id: ID модуля
        
        Returns:
            dict или None: {
                'total_topics': int,
                'completed_topics': int,
                'total_tasks': int,
                'completed_tasks': int,
                'completion_percentage': float,
                'average_score': float
            }
        
        Note: В новой реализации требуется информация о всех заданиях модуля,
        которая должна быть получена из StorageService. Пока возвращаем None.
        """
        # TODO: Реализовать получение прогресса по модулю на основе task_history
        # Требуется интеграция со StorageService для получения списка заданий
        self.logger.warning("get_module_progress not fully implemented in new UserProgressManager")
        return None
    
    def get_overall_statistics(self) -> Dict[str, Any]:
        """
        Получает общую статистику пользователя.
        
        Для версии 3.0 использует готовые поля из global_stats (O(1) вместо O(N)).
        Для версии 2.0 использует итерацию по массивам (обратная совместимость).
        
        Returns:
            dict: {
                'total_tasks_completed': int,
                'total_attempts': int,
                'total_time_spent': int
            }
        """
        try:
            progress_data = self.progress_manager.get_progress_data()
            version = progress_data.get("version", "2.0")
            
            # Для версии 3.0 используем готовые агрегаты из global_stats
            if version == "3.0" and "global_stats" in progress_data:
                global_stats = progress_data["global_stats"]
                task_history = progress_data.get("task_history", {})
                
                # Читаем из global_stats (O(1))
                total_attempts = global_stats.get("total_attempts", 0)
                total_time_spent = int(global_stats.get("total_time_seconds", 0))
                
                # Для completed_tasks нужно пройти по task_history,
                # но это O(M) где M - количество заданий, а не O(N) где N - все попытки
                completed_tasks = set()
                
                for task_ref, task_data in task_history.items():
                    # Используем meta для получения success_rate (O(1) вместо поиска в массиве)
                    if "meta" in task_data:
                        meta = task_data["meta"]
                        success_rate = meta.get("success_rate", 0.0)
                        
                        # Задание считается завершенным, если success_rate > 0
                        if success_rate > 0:
                            completed_tasks.add(task_ref)
                    else:
                        # Fallback для заданий без meta (старые данные)
                        attempts = task_data.get("attempts", [])
                        if attempts:
                            successful = any(a.get("success", False) for a in attempts)
                            if successful:
                                completed_tasks.add(task_ref)
                
                return {
                    'total_tasks_completed': len(completed_tasks),
                    'total_attempts': total_attempts,
                    'total_time_spent': total_time_spent
                }
            else:
                # Для версии 2.0 используем старый алгоритм (обратная совместимость)
                task_history = progress_data.get("task_history", {})
                
                total_attempts = 0
                total_time_spent = 0
                completed_tasks = set()
                
                for task_ref, task_data in task_history.items():
                    attempts = task_data.get("attempts", [])
                    total_attempts += len(attempts)
                    
                    for attempt in attempts:
                        total_time_spent += attempt.get("time_spent", 0)
                        
                        if attempt.get("success", False):
                            completed_tasks.add(task_ref)
                
                return {
                    'total_tasks_completed': len(completed_tasks),
                    'total_attempts': total_attempts,
                    'total_time_spent': total_time_spent
                }
        except Exception as e:
            self.logger.error(f"Failed to get overall statistics: {e}")
            return {
                'total_tasks_completed': 0,
                'total_attempts': 0,
                'total_time_spent': 0
            }
    
    # =========================================================================
    # УТИЛИТЫ
    # =========================================================================
    
    def is_task_completed(self, module_id: str, topic_id: str, 
                         task_id: str) -> bool:
        """
        Проверяет, завершено ли задание.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            bool: True если задание завершено хотя бы один раз
        """
        progress = self.get_task_progress(module_id, topic_id, task_id)
        return progress.get('completed', False) if progress else False
    
    def get_attempts_count(self, module_id: str, topic_id: str, 
                          task_id: str) -> int:
        """
        Получает количество попыток выполнения задания.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            int: Количество попыток
        """
        attempts = self.progress_manager.get_all_attempts(module_id, topic_id, task_id)
        return len(attempts)
    
    def reset_task_progress(self, module_id: str, topic_id: str, 
                           task_id: str) -> bool:
        """
        Сбрасывает прогресс по заданию (удаляет все попытки).
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            bool: True если сброс успешен
        """
        try:
            success = self.progress_manager.reset_task_history(module_id, topic_id, task_id)
            if success:
                self.logger.info(f"Reset progress for {module_id}/{topic_id}/{task_id}")
            return success
        except Exception as e:
            self.logger.error(f"Failed to reset task progress: {e}")
            return False
    
    def remove_last_attempt(self, module_id: str, topic_id: str, task_id: str) -> bool:
        """
        Удаляет последнюю попытку выполнения задания.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            bool: True если удаление успешно
        """
        try:
            success = self.progress_manager.remove_last_attempt(module_id, topic_id, task_id)
            if success:
                self.logger.info(f"Removed last attempt for {module_id}/{topic_id}/{task_id}")
            return success
        except Exception as e:
            self.logger.error(f"Failed to remove last attempt: {e}")
            return False
    
    def export_progress(self) -> Dict[str, Any]:
        """
        Экспортирует весь прогресс пользователя.
        
        Returns:
            dict: Полные данные прогресса
        """
        return self.progress_manager.get_progress_data()
    
    def get_mistake_bank(self) -> List[Dict[str, Any]]:
        """
        Возвращает список ошибок из mistake_bank.
        """
        history = self.progress_manager.get_progress_data()
        mistake_bank = history.get("mistake_bank", [])
        
        if history.get("version") == "3.0":
            normalized_mistake_bank: List[Dict[str, Any]] = []
            for task_ref, task_entry in history.get("task_history", {}).items():
                attempts = task_entry.get("attempts", [])
                if not attempts:
                    continue
                
                last_attempt = attempts[-1]
                if last_attempt.get("success"):
                    # Последняя попытка успешна — задача не должна попадать в mistake_bank
                    continue
                
                failed_attempts = [a for a in attempts if not a.get("success", False)]
                if not failed_attempts:
                    continue
                
                last_failed = max(failed_attempts, key=lambda a: a.get("timestamp", ""))
                parts = task_ref.split("/")
                normalized_mistake_bank.append({
                    "module": parts[0] if len(parts) > 0 else "",
                    "topic": parts[1] if len(parts) > 1 else "",
                    "task": parts[2] if len(parts) > 2 else task_ref,
                    "level": last_failed.get("difficulty", task_entry.get("current_difficulty", 1)),
                    "fail_count": len(failed_attempts),
                    "last_failed": last_failed.get("timestamp"),
                })
            mistake_bank = normalized_mistake_bank
        
        mistake_bank = sorted(mistake_bank, key=lambda x: x.get("fail_count", 0), reverse=True)
        return mistake_bank
    
    def get_mistakes_for_task(self, module_id: str, topic_id: str, task_id: str) -> List[Dict[str, Any]]:
        """
        Получает ошибки для конкретного задания.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            List[Dict[str, Any]]: Список ошибок для задания
        """
        return self.progress_manager.get_mistakes_for_task(module_id, topic_id, task_id)
    
    def get_progress_summary(self) -> str:
        """
        Возвращает краткое резюме прогресса (для отладки/логирования).
        
        Returns:
            str: Текстовое резюме
        """
        stats = self.get_overall_statistics()
        return (
            f"Progress Summary:\n"
            f"  Tasks completed: {stats.get('total_tasks_completed', 0)}\n"
            f"  Total attempts: {stats.get('total_attempts', 0)}\n"
            f"  Average score: {stats.get('average_score', 0.0):.1f}%"
        )


# Экспортируемые классы
__all__ = ['ProgressService']

