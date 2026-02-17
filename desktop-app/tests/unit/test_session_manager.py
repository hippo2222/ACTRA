"""
Unit-тесты для SessionManager (Logic Layer - Блок B).

Тестируем:
- Управление сессией (start_session, end_session)
- Навигацию (next_task, previous_task, jump_to_task)
- Прогресс (get_progress_in_topic, is_first_task, is_last_task)
- Статистику (get_session_duration, get_session_summary)
"""

import unittest
import sys
import time
from pathlib import Path
from datetime import timedelta

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from logic.session_manager import SessionManager
from logic.task_controller import Task


# =============================================================================
# HELPER: Создание тестовых Task объектов
# =============================================================================

def create_test_task(module_id: str, topic_id: str, task_id: str, task_type: str = "click") -> Task:
    """Создаёт тестовый Task объект"""
    return Task(
        module_id=module_id,
        topic_id=topic_id,
        task_id=task_id,
        task_type=task_type,
        task_data={'type': task_type, 'description': f'Test task {task_id}'},
        answer_key={}
    )


# =============================================================================
# ТЕСТЫ: Инициализация
# =============================================================================

class TestSessionManagerInit(unittest.TestCase):
    """Тесты инициализации SessionManager"""
    
    def test_init_creates_empty_session(self):
        """Инициализация создаёт пустую сессию"""
        session = SessionManager()
        
        self.assertIsNone(session.current_module)
        self.assertIsNone(session.current_topic)
        self.assertEqual(session.current_task_index, 0)
        self.assertEqual(len(session.tasks_in_topic), 0)
        self.assertIsNone(session.session_start_time)
    
    def test_init_session_not_active(self):
        """После инициализации сессия не активна"""
        session = SessionManager()
        
        self.assertFalse(session.is_session_active())


# =============================================================================
# ТЕСТЫ: Начало и завершение сессии
# =============================================================================

class TestStartEndSession(unittest.TestCase):
    """Тесты start_session и end_session"""
    
    def test_start_session_sets_module_and_topic(self):
        """start_session устанавливает модуль и тему"""
        session = SessionManager()
        tasks = [
            create_test_task("anatomy", "liver", "task1"),
            create_test_task("anatomy", "liver", "task2"),
        ]
        
        session.start_session(module_id="anatomy", topic_id="liver", tasks=tasks)
        
        self.assertEqual(session.current_module, "anatomy")
        self.assertEqual(session.current_topic, "liver")
    
    def test_start_session_sets_tasks(self):
        """start_session сохраняет список заданий"""
        session = SessionManager()
        tasks = [
            create_test_task("m1", "t1", "task1"),
            create_test_task("m1", "t1", "task2"),
            create_test_task("m1", "t1", "task3"),
        ]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        self.assertEqual(len(session.tasks_in_topic), 3)
        self.assertEqual(session.tasks_in_topic, tasks)
    
    def test_start_session_sets_index_to_zero(self):
        """start_session устанавливает индекс на первое задание"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(5)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        self.assertEqual(session.current_task_index, 0)
    
    def test_start_session_records_start_time(self):
        """start_session записывает время начала"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", "task1")]
        
        self.assertIsNone(session.session_start_time)
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        self.assertIsNotNone(session.session_start_time)
        self.assertTrue(session.is_session_active())
    
    def test_end_session_clears_all_fields(self):
        """end_session очищает все поля"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", "task1")]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        self.assertTrue(session.is_session_active())
        
        session.end_session()
        
        self.assertIsNone(session.current_module)
        self.assertIsNone(session.current_topic)
        self.assertEqual(session.current_task_index, 0)
        self.assertEqual(len(session.tasks_in_topic), 0)
        self.assertIsNone(session.session_start_time)
        self.assertFalse(session.is_session_active())


# =============================================================================
# ТЕСТЫ: Получение текущего задания
# =============================================================================

class TestGetCurrentTask(unittest.TestCase):
    """Тесты get_current_task"""
    
    def test_get_current_task_returns_first_task(self):
        """get_current_task возвращает первое задание после start_session"""
        session = SessionManager()
        task1 = create_test_task("m1", "t1", "task1")
        task2 = create_test_task("m1", "t1", "task2")
        
        session.start_session(module_id="m1", topic_id="t1", tasks=[task1, task2])
        
        current = session.get_current_task()
        
        self.assertEqual(current, task1)
        self.assertEqual(current.task_id, "task1")
    
    def test_get_current_task_returns_none_for_empty_session(self):
        """get_current_task возвращает None если сессия пустая"""
        session = SessionManager()
        
        current = session.get_current_task()
        
        self.assertIsNone(current)
    
    def test_get_current_task_returns_none_for_empty_tasks_list(self):
        """get_current_task возвращает None если список заданий пуст"""
        session = SessionManager()
        
        session.start_session(module_id="m1", topic_id="t1", tasks=[])
        
        current = session.get_current_task()
        
        self.assertIsNone(current)


# =============================================================================
# ТЕСТЫ: Навигация - next_task
# =============================================================================

class TestNextTask(unittest.TestCase):
    """Тесты next_task"""
    
    def test_next_task_moves_to_second_task(self):
        """next_task переходит ко второму заданию"""
        session = SessionManager()
        task1 = create_test_task("m1", "t1", "task1")
        task2 = create_test_task("m1", "t1", "task2")
        task3 = create_test_task("m1", "t1", "task3")
        
        session.start_session(module_id="m1", topic_id="t1", tasks=[task1, task2, task3])
        
        # Сейчас на task1
        self.assertEqual(session.get_current_task(), task1)
        
        # Переходим к следующему
        next_t = session.next_task()
        
        self.assertEqual(next_t, task2)
        self.assertEqual(session.current_task_index, 1)
    
    def test_next_task_increments_index(self):
        """next_task увеличивает current_task_index"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(5)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        self.assertEqual(session.current_task_index, 0)
        
        session.next_task()
        self.assertEqual(session.current_task_index, 1)
        
        session.next_task()
        self.assertEqual(session.current_task_index, 2)
    
    def test_next_task_returns_none_at_end(self):
        """next_task возвращает None при достижении конца списка"""
        session = SessionManager()
        task1 = create_test_task("m1", "t1", "task1")
        task2 = create_test_task("m1", "t1", "task2")
        
        session.start_session(module_id="m1", topic_id="t1", tasks=[task1, task2])
        
        # task1 → task2
        next_t = session.next_task()
        self.assertEqual(next_t, task2)
        
        # task2 → None (конец)
        next_t = session.next_task()
        self.assertIsNone(next_t)
    
    def test_next_task_returns_none_for_empty_tasks(self):
        """next_task возвращает None если список заданий пуст"""
        session = SessionManager()
        
        session.start_session(module_id="m1", topic_id="t1", tasks=[])
        
        next_t = session.next_task()
        
        self.assertIsNone(next_t)


# =============================================================================
# ТЕСТЫ: Навигация - previous_task
# =============================================================================

class TestPreviousTask(unittest.TestCase):
    """Тесты previous_task"""
    
    def test_previous_task_moves_back(self):
        """previous_task возвращается к предыдущему заданию"""
        session = SessionManager()
        task1 = create_test_task("m1", "t1", "task1")
        task2 = create_test_task("m1", "t1", "task2")
        task3 = create_test_task("m1", "t1", "task3")
        
        session.start_session(module_id="m1", topic_id="t1", tasks=[task1, task2, task3])
        
        # Переходим на task2
        session.next_task()
        self.assertEqual(session.current_task_index, 1)
        
        # Возвращаемся на task1
        prev_t = session.previous_task()
        
        self.assertEqual(prev_t, task1)
        self.assertEqual(session.current_task_index, 0)
    
    def test_previous_task_stops_at_zero(self):
        """previous_task не уходит ниже индекса 0"""
        session = SessionManager()
        task1 = create_test_task("m1", "t1", "task1")
        task2 = create_test_task("m1", "t1", "task2")
        
        session.start_session(module_id="m1", topic_id="t1", tasks=[task1, task2])
        
        # Уже на task1 (index 0)
        self.assertEqual(session.current_task_index, 0)
        
        # Пытаемся пойти назад
        prev_t = session.previous_task()
        
        # Остаёмся на task1
        self.assertEqual(prev_t, task1)
        self.assertEqual(session.current_task_index, 0)
    
    def test_previous_task_returns_none_for_empty_tasks(self):
        """previous_task возвращает None если список заданий пуст"""
        session = SessionManager()
        
        session.start_session(module_id="m1", topic_id="t1", tasks=[])
        
        prev_t = session.previous_task()
        
        self.assertIsNone(prev_t)


# =============================================================================
# ТЕСТЫ: Проверки навигации
# =============================================================================

class TestNavigationChecks(unittest.TestCase):
    """Тесты can_go_next и can_go_previous"""
    
    def test_can_go_next_true_when_not_at_end(self):
        """can_go_next возвращает True если не в конце"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        # На первом задании из трёх
        self.assertTrue(session.can_go_next())
    
    def test_can_go_next_false_when_at_end(self):
        """can_go_next возвращает False если в конце"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        # Переходим к последнему заданию
        session.next_task()
        session.next_task()
        
        # Сейчас на последнем
        self.assertFalse(session.can_go_next())
    
    def test_can_go_previous_false_at_start(self):
        """can_go_previous возвращает False в начале"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        # На первом задании
        self.assertFalse(session.can_go_previous())
    
    def test_can_go_previous_true_after_next(self):
        """can_go_previous возвращает True после next_task"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        session.next_task()
        
        # Теперь можем вернуться назад
        self.assertTrue(session.can_go_previous())


# =============================================================================
# ТЕСТЫ: Прогресс в теме
# =============================================================================

class TestProgressInTopic(unittest.TestCase):
    """Тесты get_progress_in_topic"""
    
    def test_get_progress_returns_correct_tuple(self):
        """get_progress_in_topic возвращает (current, total)"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(5)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        current, total = session.get_progress_in_topic()
        
        self.assertEqual(current, 1)  # Первое задание (1-indexed)
        self.assertEqual(total, 5)
    
    def test_get_progress_updates_after_next(self):
        """get_progress_in_topic обновляется после next_task"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        # Первое задание
        current, total = session.get_progress_in_topic()
        self.assertEqual(current, 1)
        
        # Переходим ко второму
        session.next_task()
        current, total = session.get_progress_in_topic()
        self.assertEqual(current, 2)
        
        # Переходим к третьему
        session.next_task()
        current, total = session.get_progress_in_topic()
        self.assertEqual(current, 3)


# =============================================================================
# ТЕСТЫ: Проверки первого/последнего задания
# =============================================================================

class TestFirstLastTask(unittest.TestCase):
    """Тесты is_first_task и is_last_task"""
    
    def test_is_first_task_true_at_start(self):
        """is_first_task возвращает True в начале"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        self.assertTrue(session.is_first_task())
    
    def test_is_first_task_false_after_next(self):
        """is_first_task возвращает False после next_task"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        session.next_task()
        
        self.assertFalse(session.is_first_task())
    
    def test_is_last_task_false_at_start(self):
        """is_last_task возвращает False в начале"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        self.assertFalse(session.is_last_task())
    
    def test_is_last_task_true_at_end(self):
        """is_last_task возвращает True на последнем задании"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        # Переходим к последнему
        session.next_task()
        session.next_task()
        
        self.assertTrue(session.is_last_task())


# =============================================================================
# ТЕСТЫ: Длительность сессии
# =============================================================================

class TestSessionDuration(unittest.TestCase):
    """Тесты get_session_duration"""
    
    def test_get_session_duration_returns_timedelta(self):
        """get_session_duration возвращает timedelta"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", "task1")]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        duration = session.get_session_duration()
        
        self.assertIsInstance(duration, timedelta)
    
    def test_get_session_duration_increases_over_time(self):
        """get_session_duration увеличивается со временем"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", "task1")]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        duration1 = session.get_session_duration()
        
        # Небольшая задержка
        time.sleep(0.1)
        
        duration2 = session.get_session_duration()
        
        self.assertGreater(duration2, duration1)
    
    def test_get_session_duration_returns_zero_for_inactive_session(self):
        """get_session_duration возвращает 0 если сессия не начата"""
        session = SessionManager()
        
        duration = session.get_session_duration()
        
        self.assertEqual(duration, timedelta(0))


# =============================================================================
# ТЕСТЫ: Прямая навигация
# =============================================================================

class TestJumpToTask(unittest.TestCase):
    """Тесты jump_to_task"""
    
    def test_jump_to_task_moves_to_specific_index(self):
        """jump_to_task переходит к заданию по индексу"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(5)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        # Сразу переходим к task3 (индекс 2)
        task = session.jump_to_task(2)
        
        self.assertEqual(task.task_id, "task2")
        self.assertEqual(session.current_task_index, 2)
    
    def test_jump_to_task_returns_none_for_invalid_index(self):
        """jump_to_task возвращает None для невалидного индекса"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        # Индекс вне диапазона
        task = session.jump_to_task(10)
        
        self.assertIsNone(task)
    
    def test_jump_to_task_negative_index_returns_none(self):
        """jump_to_task возвращает None для отрицательного индекса"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        task = session.jump_to_task(-1)
        
        self.assertIsNone(task)


# =============================================================================
# ТЕСТЫ: Поиск задания по ID
# =============================================================================

class TestGetTaskById(unittest.TestCase):
    """Тесты get_task_by_id"""
    
    def test_get_task_by_id_finds_task(self):
        """get_task_by_id находит задание по ID"""
        session = SessionManager()
        task1 = create_test_task("m1", "t1", "liver_click_01")
        task2 = create_test_task("m1", "t1", "liver_click_02")
        task3 = create_test_task("m1", "t1", "liver_draw_01")
        
        session.start_session(module_id="m1", topic_id="t1", tasks=[task1, task2, task3])
        
        found = session.get_task_by_id("liver_draw_01")
        
        self.assertEqual(found, task3)
    
    def test_get_task_by_id_returns_none_if_not_found(self):
        """get_task_by_id возвращает None если не найдено"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        found = session.get_task_by_id("nonexistent_task")
        
        self.assertIsNone(found)


# =============================================================================
# ТЕСТЫ: Информация о сессии
# =============================================================================

class TestSessionSummary(unittest.TestCase):
    """Тесты get_session_summary"""
    
    def test_get_session_summary_returns_dict(self):
        """get_session_summary возвращает словарь"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="m1", topic_id="t1", tasks=tasks)
        
        summary = session.get_session_summary()
        
        self.assertIsInstance(summary, dict)
    
    def test_get_session_summary_contains_expected_keys(self):
        """get_session_summary содержит все ожидаемые ключи"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="anatomy", topic_id="liver", tasks=tasks)
        
        summary = session.get_session_summary()
        
        self.assertIn('active', summary)
        self.assertIn('module_id', summary)
        self.assertIn('topic_id', summary)
        self.assertIn('current_task_index', summary)
        self.assertIn('total_tasks', summary)
        self.assertIn('progress', summary)
        self.assertIn('is_first', summary)
        self.assertIn('is_last', summary)
        self.assertIn('duration_seconds', summary)
    
    def test_get_session_summary_values_correct(self):
        """get_session_summary возвращает корректные значения"""
        session = SessionManager()
        tasks = [create_test_task("m1", "t1", f"task{i}") for i in range(3)]
        
        session.start_session(module_id="anatomy", topic_id="liver", tasks=tasks)
        
        summary = session.get_session_summary()
        
        self.assertTrue(summary['active'])
        self.assertEqual(summary['module_id'], "anatomy")
        self.assertEqual(summary['topic_id'], "liver")
        self.assertEqual(summary['current_task_index'], 0)
        self.assertEqual(summary['total_tasks'], 3)
        self.assertEqual(summary['progress'], '1/3')
        self.assertTrue(summary['is_first'])
        self.assertFalse(summary['is_last'])
    
    def test_get_session_summary_for_inactive_session(self):
        """get_session_summary для неактивной сессии"""
        session = SessionManager()
        
        summary = session.get_session_summary()
        
        self.assertFalse(summary['active'])
        self.assertIsNone(summary['module_id'])
        self.assertIsNone(summary['topic_id'])
        self.assertEqual(summary['total_tasks'], 0)
        self.assertEqual(summary['progress'], '0/0')


# =============================================================================
# ЗАПУСК ТЕСТОВ
# =============================================================================

if __name__ == '__main__':
    unittest.main()

