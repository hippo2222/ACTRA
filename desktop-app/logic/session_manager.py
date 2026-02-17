"""
Session Manager - Управление текущей сессией пользователя.

Отвечает за:
- Хранение состояния текущей сессии (модуль, тема, задания)
- Навигацию между заданиями (next, previous)
- Отслеживание прогресса в теме
- Подсчёт времени сессии
- Поддержку смешанных сессий (марафон по ошибкам)

НЕДЕЛЯ 2, Logic Layer - Блок B: Session Manager
Этап 3: Рефакторинг для поддержки смешанных сессий
"""

from typing import Optional, List, Tuple, Dict, Any
from datetime import datetime, timedelta
from dataclasses import dataclass

# Импортируем Task из task_controller
from logic.task_controller import Task


class SessionManager:
    """
    Менеджер сессии пользователя.
    
    Управляет текущим состоянием обучения:
    - Текущий модуль и тема (опционально для смешанных сессий)
    - Источник сессии (например, "topic", "mistake_bank")
    - Список заданий в сессии
    - Индекс текущего задания
    - Время начала сессии
    
    Использование:
        session = SessionManager()
        
        # Начать обычную сессию (тема)
        session.start_session(
            module_id="anatomy",
            topic_id="liver",
            tasks=[task1, task2, task3]
        )
        
        # Начать смешанную сессию (марафон по ошибкам)
        session.start_mixed_session(
            tasks=[task1, task2, task3],  # Задания из разных модулей/тем
            source="mistake_bank"
        )
        
        # Навигация
        current = session.get_current_task()
        next_task = session.next_task()
        prev_task = session.previous_task()
        
        # Прогресс
        current_idx, total = session.get_progress_in_topic()
        print(f"Задание {current_idx} из {total}")
        
        # Завершить сессию
        session.end_session()
    """
    
    def __init__(self):
        """
        Инициализация SessionManager.
        
        Создаёт пустую сессию (не начата).
        """
        # Текущий модуль и тема (опционально для смешанных сессий)
        self.current_module: Optional[str] = None
        self.current_topic: Optional[str] = None
        
        # Источник сессии (например, "topic", "mistake_bank")
        self.session_source: Optional[str] = None
        
        # Задания и навигация
        self.current_task_index: int = 0
        self.tasks_in_topic: List[Task] = []
        
        # Время сессии
        self.session_start_time: Optional[datetime] = None
        
        # Результаты текущей сессии {task_id: {'success': bool, 'score': float, 'attempts': int}}
        self.session_results: Dict[str, Dict[str, Any]] = {}
    
    # =========================================================================
    # УПРАВЛЕНИЕ СЕССИЕЙ
    # =========================================================================
    
    def start_session(self, module_id: str, topic_id: str, tasks: List[Task]) -> None:
        """
        Начать новую сессию обучения (для обычной темы).
        
        Устанавливает:
        - Текущий модуль и тему
        - Список заданий
        - Индекс на первое задание (0)
        - Время начала сессии
        - Источник сессии: "topic"
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            tasks: Список заданий в теме
        
        Example:
            >>> session = SessionManager()
            >>> session.start_session(
            ...     module_id="anatomy",
            ...     topic_id="liver",
            ...     tasks=[task1, task2, task3]
            ... )
            >>> print(session.current_module)
            'anatomy'
        """
        self.current_module = module_id
        self.current_topic = topic_id
        self.session_source = "topic"
        self.tasks_in_topic = tasks
        self.current_task_index = 0
        self.session_start_time = datetime.now()
        # Очищаем результаты предыдущей сессии
        self.session_results = {}
    
    def start_mixed_session(self, tasks: List[Task], source: str = "mistake_bank") -> None:
        """
        Начать смешанную сессию (например, марафон по ошибкам).
        
        Отвязана от жестких module_id/topic_id, позволяет работать с заданиями
        из разных модулей и тем.
        
        Устанавливает:
        - Список заданий (могут быть из разных модулей/тем)
        - Индекс на первое задание (0)
        - Время начала сессии
        - Источник сессии (например, "mistake_bank")
        
        Args:
            tasks: Список заданий (могут быть из разных модулей/тем)
            source: Источник сессии (по умолчанию "mistake_bank")
        
        Example:
            >>> session = SessionManager()
            >>> # Задания из разных модулей/тем
            >>> tasks = [task1, task2, task3]  # task1 из m1/t1, task2 из m2/t3, и т.д.
            >>> session.start_mixed_session(tasks, source="mistake_bank")
            >>> print(session.session_source)
            'mistake_bank'
        """
        # Для смешанной сессии module/topic не устанавливаются
        self.current_module = None
        self.current_topic = None
        self.session_source = source
        self.tasks_in_topic = tasks
        self.current_task_index = 0
        self.session_start_time = datetime.now()
        # Очищаем результаты предыдущей сессии
        self.session_results = {}
    
    def end_session(self) -> None:
        """
        Завершить текущую сессию.
        
        Очищает все поля сессии.
        
        Example:
            >>> session.start_session("m1", "t1", [task1, task2])
            >>> session.end_session()
            >>> print(session.current_module)
            None
        """
        self.current_module = None
        self.current_topic = None
        self.session_source = None
        self.current_task_index = 0
        self.tasks_in_topic = []
        self.session_start_time = None
        self.session_results = {}
    
    def is_session_active(self) -> bool:
        """
        Проверить, активна ли сессия.
        
        Returns:
            bool: True если сессия начата
        """
        return self.session_start_time is not None
    
    # =========================================================================
    # НАВИГАЦИЯ ПО ЗАДАНИЯМ
    # =========================================================================
    
    def get_current_task(self) -> Optional[Task]:
        """
        Получить текущее задание.
        
        Returns:
            Task или None если список заданий пуст
        
        Example:
            >>> task = session.get_current_task()
            >>> print(task.task_id if task else "No task")
            'liver_click_01'
        """
        if not self.tasks_in_topic:
            return None
        
        if 0 <= self.current_task_index < len(self.tasks_in_topic):
            return self.tasks_in_topic[self.current_task_index]
        
        return None
    
    def next_task(self) -> Optional[Task]:
        """
        Перейти к следующему заданию.
        
        Инкрементирует current_task_index и возвращает следующее задание.
        Если достигнут конец списка, возвращает None.
        
        Returns:
            Task или None если достигнут конец темы
        
        Example:
            >>> session.start_session("m1", "t1", [task1, task2, task3])
            >>> session.next_task()  # Переход на task2
            <Task: task2>
            >>> session.next_task()  # Переход на task3
            <Task: task3>
            >>> session.next_task()  # Конец списка
            None
        """
        if not self.tasks_in_topic:
            return None
        
        # Пытаемся перейти к следующему
        self.current_task_index += 1
        
        # Проверяем, не вышли ли за пределы
        if self.current_task_index >= len(self.tasks_in_topic):
            # Вышли за пределы - конец темы
            return None
        
        return self.tasks_in_topic[self.current_task_index]
    
    def previous_task(self) -> Optional[Task]:
        """
        Вернуться к предыдущему заданию.
        
        Декрементирует current_task_index (но не ниже 0).
        Возвращает предыдущее задание.
        
        Returns:
            Task или None если список пуст
        
        Example:
            >>> session.start_session("m1", "t1", [task1, task2, task3])
            >>> session.next_task()  # → task2
            >>> session.previous_task()  # ← task1
            <Task: task1>
            >>> session.previous_task()  # Уже на первом
            <Task: task1>
        """
        if not self.tasks_in_topic:
            return None
        
        # Декрементируем индекс (но не ниже 0)
        self.current_task_index = max(0, self.current_task_index - 1)
        
        return self.tasks_in_topic[self.current_task_index]
    
    def can_go_next(self) -> bool:
        """
        Проверить, можно ли перейти к следующему заданию.
        
        Returns:
            bool: True если есть следующее задание
        """
        if not self.tasks_in_topic:
            return False
        
        return self.current_task_index < len(self.tasks_in_topic) - 1
    
    def can_go_previous(self) -> bool:
        """
        Проверить, можно ли вернуться к предыдущему заданию.
        
        Returns:
            bool: True если есть предыдущее задание
        """
        return self.current_task_index > 0
    
    # =========================================================================
    # ПРОГРЕСС И СТАТИСТИКА
    # =========================================================================
    
    def get_progress_in_topic(self) -> Tuple[int, int]:
        """
        Получить прогресс в теме.
        
        Returns:
            Tuple[int, int]: (current_number, total_tasks)
            где current_number - номер текущего задания (1-indexed)
        
        Example:
            >>> session.start_session("m1", "t1", [task1, task2, task3])
            >>> session.get_progress_in_topic()
            (1, 3)  # Первое задание из трёх
            >>> session.next_task()
            >>> session.get_progress_in_topic()
            (2, 3)  # Второе задание из трёх
        """
        total_tasks = len(self.tasks_in_topic)
        current_number = self.current_task_index + 1  # 1-indexed
        
        return (current_number, total_tasks)
    
    def is_first_task(self) -> bool:
        """
        Проверить, является ли текущее задание первым в теме.
        
        Returns:
            bool: True если current_task_index == 0
        """
        return self.current_task_index == 0
    
    def is_last_task(self) -> bool:
        """
        Проверить, является ли текущее задание последним в теме.
        
        Returns:
            bool: True если текущее задание - последнее
        
        Example:
            >>> session.start_session("m1", "t1", [task1, task2, task3])
            >>> session.is_last_task()
            False
            >>> session.next_task()
            >>> session.next_task()  # На task3
            >>> session.is_last_task()
            True
        """
        if not self.tasks_in_topic:
            return False
        
        return self.current_task_index == len(self.tasks_in_topic) - 1
    
    def get_session_duration(self) -> timedelta:
        """
        Получить время с начала сессии.
        
        Returns:
            timedelta: Время с момента start_session()
            Если сессия не начата, возвращает timedelta(0)
        
        Example:
            >>> session.start_session("m1", "t1", [task1])
            >>> # ... пользователь работает ...
            >>> duration = session.get_session_duration()
            >>> print(f"Сессия длится {duration.seconds} секунд")
        """
        if self.session_start_time is None:
            return timedelta(0)
        
        return datetime.now() - self.session_start_time
    
    # =========================================================================
    # ПРЯМАЯ НАВИГАЦИЯ
    # =========================================================================
    
    def jump_to_task(self, task_index: int) -> Optional[Task]:
        """
        Перейти к заданию по индексу.
        
        Args:
            task_index: Индекс задания (0-based)
        
        Returns:
            Task или None если индекс вне диапазона
        
        Example:
            >>> session.start_session("m1", "t1", [task1, task2, task3])
            >>> session.jump_to_task(2)  # Сразу на task3
            <Task: task3>
        """
        if not self.tasks_in_topic:
            return None
        
        if 0 <= task_index < len(self.tasks_in_topic):
            self.current_task_index = task_index
            return self.tasks_in_topic[task_index]
        
        return None
    
    def get_task_by_id(self, task_id: str) -> Optional[Task]:
        """
        Найти задание по task_id в текущей теме.
        
        Args:
            task_id: ID задания
        
        Returns:
            Task или None если не найдено
        
        Example:
            >>> task = session.get_task_by_id("liver_click_01")
            >>> print(task.task_id if task else "Not found")
        """
        for task in self.tasks_in_topic:
            if task.task_id == task_id:
                return task
        
        return None
    
    # =========================================================================
    # ИНФОРМАЦИЯ О СЕССИИ
    # =========================================================================
    
    def get_session_summary(self) -> dict:
        """
        Получить краткую информацию о сессии.
        
        Returns:
            dict: Информация о текущей сессии
        
        Example:
            >>> summary = session.get_session_summary()
            >>> print(summary)
            {
                'active': True,
                'module_id': 'anatomy',
                'topic_id': 'liver',
                'session_source': 'topic',
                'current_task_index': 0,
                'total_tasks': 3,
                'progress': '1/3',
                'is_first': True,
                'is_last': False,
                'duration_seconds': 45
            }
        """
        if not self.is_session_active():
            return {
                'active': False,
                'module_id': None,
                'topic_id': None,
                'session_source': None,
                'current_task_index': 0,
                'total_tasks': 0,
                'progress': '0/0',
                'is_first': False,
                'is_last': False,
                'duration_seconds': 0
            }
        
        current_num, total = self.get_progress_in_topic()
        duration = self.get_session_duration()
        
        return {
            'active': True,
            'module_id': self.current_module,
            'topic_id': self.current_topic,
            'session_source': self.session_source,
            'current_task_index': self.current_task_index,
            'total_tasks': total,
            'progress': f'{current_num}/{total}',
            'is_first': self.is_first_task(),
            'is_last': self.is_last_task(),
            'duration_seconds': int(duration.total_seconds())
        }
    
    # =========================================================================
    # РЕЗУЛЬТАТЫ СЕССИИ
    # =========================================================================
    
    def record_task_result(self, task_id: str, success: bool):
        """
        Записать результат выполнения задания в текущей сессии.
        
        Args:
            task_id: ID задания
            success: Успешность выполнения
        
        Example:
            >>> session.start_session("m1", "t1", [task1, task2])
            >>> session.record_task_result("task1", success=True)
            >>> session.record_task_result("task1", success=False)  # Повторная попытка
            >>> results = session.get_session_task_results()
            >>> print(results["task1"])
            {'success': True, 'attempts': 2}
        """
        if task_id not in self.session_results:
            self.session_results[task_id] = {
                'success': False,
                'attempts': 0
            }
        
        # Обновляем результат
        current = self.session_results[task_id]
        current['attempts'] += 1
        if success:
            current['success'] = True
    
    def get_session_task_results(self) -> Dict[str, Dict[str, Any]]:
        """
        Получить результаты заданий текущей сессии.
        
        Returns:
            dict: {task_id: {'success': bool, 'attempts': int}}
        
        Example:
            >>> session.start_session("m1", "t1", [task1, task2])
            >>> session.record_task_result("task1", success=True, score=95.0)
            >>> results = session.get_session_task_results()
            >>> print(results)
            {'task1': {'success': True, 'score': 95.0, 'attempts': 1}}
        """
        return self.session_results.copy()


# Экспортируемые классы
__all__ = ['SessionManager']

