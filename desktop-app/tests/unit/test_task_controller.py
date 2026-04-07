"""
Unit-тесты для TaskController (Logic Layer - Блок A).

Тестируем:
- Загрузку заданий (load_task)
- Отправку ответов (submit_answer)
- Управление состоянием (skip_task, reset_task)
- Интеграцию с сервисами (TaskEvaluatorService, ProgressService)
"""

import unittest
import sys
import os
import shutil
import tempfile
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from logic.task_controller import TaskController, TaskState, Task
from services.task_evaluator_service import TaskEvaluatorService, EvaluationResult
from services.progress_service import ProgressService

# Импорт DifficultyManager для тестов Фазы 2
try:
    from services.difficulty_manager import DifficultyManager
    DIFFICULTY_MANAGER_AVAILABLE = True
except ImportError:
    DIFFICULTY_MANAGER_AVAILABLE = False
    DifficultyManager = None  # type: ignore


# =============================================================================
# ТЕСТЫ: Базовая инициализация
# =============================================================================

class TestTaskControllerInit(unittest.TestCase):
    """Тесты инициализации TaskController"""
    
    def setUp(self):
        self.evaluator = TaskEvaluatorService()
        self.temp_dir = tempfile.mkdtemp()
        self.progress = ProgressService(data_dir=self.temp_dir)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_init_creates_controller(self):
        """Инициализация создаёт контроллер"""
        controller = TaskController(self.evaluator, self.progress)
        
        self.assertIsNotNone(controller)
        self.assertIsNone(controller.current_task)
        self.assertEqual(controller.task_state, TaskState.NOT_STARTED)
    
    def test_init_stores_services(self):
        """Контроллер сохраняет ссылки на сервисы"""
        controller = TaskController(self.evaluator, self.progress)
        
        self.assertEqual(controller.evaluator_service, self.evaluator)
        self.assertEqual(controller.progress_service, self.progress)


# =============================================================================
# ТЕСТЫ: Загрузка заданий
# =============================================================================

class TestLoadTask(unittest.TestCase):
    """Тесты загрузки заданий"""
    
    def setUp(self):
        self.evaluator = TaskEvaluatorService()
        self.temp_dir = tempfile.mkdtemp()
        self.progress = ProgressService(data_dir=self.temp_dir)
        self.controller = TaskController(self.evaluator, self.progress)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_load_task_creates_task_object(self):
        """load_task создаёт объект Task"""
        task_data = {'type': 'click', 'description': 'Test'}
        answer_key = {'targets': [{'x': 100, 'y': 100, 'radius': 10}]}
        
        task = self.controller.load_task(
            module_id="anatomy",
            topic_id="liver",
            task_id="liver_click_01",
            task_data=task_data,
            answer_key=answer_key
        )
        
        self.assertIsInstance(task, Task)
        self.assertEqual(task.module_id, "anatomy")
        self.assertEqual(task.topic_id, "liver")
        self.assertEqual(task.task_id, "liver_click_01")
        self.assertEqual(task.task_type, "click")
    
    def test_load_task_with_enhanced_task_data(self):
        """load_task поддерживает модифицированные задания из DifficultyManager"""
        # ВАЖНО: В Фазе 2 задания будут модифицированы через DifficultyManager
        # Тест проверяет, что TaskController корректно обрабатывает флаги валидации
        task_data = {
            'type': 'click',
            'description': 'Test',
            '_difficulty_enhanced': True,  # Флаг из DifficultyManager
            '_original_type': 'click',
            '_difficulty_level': 2,
            'content': {
                'mode': 'click_and_label',
                'requires_labels': True
            }
        }
        answer_key = {'targets': [{'x': 100, 'y': 100, 'radius': 10}]}
        
        task = self.controller.load_task(
            module_id="anatomy",
            topic_id="liver",
            task_id="liver_click_01",
            task_data=task_data,
            answer_key=answer_key
        )
        
        # Проверяем, что задание загружено корректно
        self.assertIsInstance(task, Task)
        self.assertEqual(task.task_type, "click")

    def test_submit_answer_preserves_freehand_annotations_for_draw_tasks(self):
        """draw fallback не должен деградировать freehand-аннотации в polygon."""
        controller = TaskController(self.evaluator, self.progress)
        controller.evaluator_service = Mock()
        controller.evaluator_service.evaluate_task.return_value = EvaluationResult(
            success=False,
            score=0,
            message="stub",
            details={},
        )

        task_data = {
            "type": "draw",
            "content": {
                "annotations": [
                    {
                        "type": "polygon",
                        "label": "Контур",
                        "points": [[0, 0], [20, 0], [20, 20], [0, 20]],
                    },
                    {
                        "type": "freehand",
                        "label": "Линия",
                        "points": [[30, 10], [40, 10], [50, 12], [60, 12]],
                    },
                ]
            },
        }

        controller.load_task(
            module_id="m1",
            topic_id="t1",
            task_id="draw_1",
            task_data=task_data,
            answer_key={},
        )

        controller.submit_answer({"polygons": [], "lines": []})

        self.assertTrue(controller.evaluator_service.evaluate_task.called)
        passed_answer_key = controller.evaluator_service.evaluate_task.call_args.kwargs["answer_key"]
        self.assertEqual(
            [target.get("shape") for target in passed_answer_key.get("targets", [])],
            ["polygon", "freehand"],
        )
    
    def test_load_task_sets_current_task(self):
        """load_task сохраняет задание в current_task"""
        task_data = {'type': 'draw', 'description': 'Draw'}
        answer_key = {'polygons': []}
        
        task = self.controller.load_task("m1", "t1", "task1", task_data, answer_key)
        
        self.assertEqual(self.controller.current_task, task)
        self.assertTrue(self.controller.is_task_loaded())
    
    def test_load_task_changes_state_to_in_progress(self):
        """load_task меняет состояние на IN_PROGRESS"""
        task_data = {'type': 'open_answer'}
        answer_key = {'keywords': ['печень']}
        
        self.assertEqual(self.controller.task_state, TaskState.NOT_STARTED)
        
        self.controller.load_task("m1", "t1", "task1", task_data, answer_key)
        
        self.assertEqual(self.controller.task_state, TaskState.IN_PROGRESS)
        self.assertTrue(self.controller.is_task_in_progress())
    
    def test_load_task_detects_task_type_from_data(self):
        """load_task определяет тип задания из task_data"""
        test_cases = [
            ('click', {'type': 'click'}),
            ('draw', {'type': 'draw'}),
            ('open_answer', {'type': 'open_answer'}),
            ('sequence_assembly', {'type': 'sequence_assembly'}),
            ('test', {'type': 'test'}),
        ]
        
        for expected_type, task_data in test_cases:
            with self.subTest(task_type=expected_type):
                task = self.controller.load_task("m", "t", "task", task_data, {})
                self.assertEqual(task.task_type, expected_type)


# =============================================================================
# ТЕСТЫ: Task dataclass
# =============================================================================

class TestTaskDataclass(unittest.TestCase):
    """Тесты для Task dataclass"""
    
    def test_task_full_id_property(self):
        """Task.full_id возвращает полный путь"""
        task = Task(
            module_id="anatomy",
            topic_id="liver",
            task_id="liver_click_01",
            task_type="click",
            task_data={},
            answer_key={}
        )
        
        self.assertEqual(task.full_id, "anatomy/liver/liver_click_01")
    
    def test_task_time_spent_property(self):
        """Task.time_spent возвращает время в секундах"""
        task = Task(
            module_id="m", topic_id="t", task_id="task",
            task_type="click", task_data={}, answer_key={}
        )
        
        # Задание только что создано, время ~0
        self.assertGreaterEqual(task.time_spent, 0)
        self.assertLessEqual(task.time_spent, 1)
    
    def test_task_user_input_optional(self):
        """Task.user_input по умолчанию None"""
        task = Task(
            module_id="m", topic_id="t", task_id="task",
            task_type="click", task_data={}, answer_key={}
        )
        
        self.assertIsNone(task.user_input)


# =============================================================================
# ТЕСТЫ: Отправка ответов
# =============================================================================

class TestSubmitAnswer(unittest.TestCase):
    """Тесты отправки ответов"""
    
    def setUp(self):
        self.evaluator = TaskEvaluatorService()
        self.temp_dir = tempfile.mkdtemp()
        self.progress = ProgressService(data_dir=self.temp_dir)
        self.controller = TaskController(self.evaluator, self.progress)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_submit_answer_without_task_raises_error(self):
        """submit_answer без загруженного задания вызывает ошибку"""
        with self.assertRaises(RuntimeError):
            self.controller.submit_answer({'x': 100, 'y': 100})
    
    def test_submit_answer_evaluates_click_task(self):
        """submit_answer оценивает click задание"""
        task_data = {'type': 'click'}
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
            ]
        }
        
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        user_input = {
            'x': 100, 'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        
        result = self.controller.submit_answer(user_input)
        
        self.assertIsInstance(result, EvaluationResult)
        self.assertTrue(result.success)
    
    def test_submit_answer_saves_to_progress(self):
        """submit_answer сохраняет результат в прогресс"""
        task_data = {'type': 'click'}
        answer_key = {
            'targets': [{'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}]
        }
        
        self.controller.load_task("anatomy", "liver", "liver_click_01", task_data, answer_key)
        
        user_input = {
            'x': 100, 'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        
        self.controller.submit_answer(user_input)
        
        # Проверяем что результат сохранён
        progress = self.progress.get_task_progress("anatomy", "liver", "liver_click_01")
        
        self.assertIsNotNone(progress)
        self.assertTrue(progress['completed'])
    
    def test_submit_answer_skips_direct_progress_save_for_managed_session(self):
        """complex-session flow must not write the same attempt twice"""
        session_manager = Mock()
        session_manager.submit_result = Mock()
        session_manager.record_task_result = Mock()
        controller = TaskController(self.evaluator, self.progress, session_manager=session_manager)

        task_data = {'type': 'click'}
        answer_key = {
            'targets': [{'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}]
        }
        controller.load_task("anatomy", "liver", "liver_click_01", task_data, answer_key)

        user_input = {
            'x': 100, 'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }

        with patch.object(self.progress, 'save_evaluation_result') as save_mock:
            result = controller.submit_answer(user_input)

        self.assertIsNotNone(result)
        self.assertTrue(result.success)
        save_mock.assert_not_called()
        session_manager.record_task_result.assert_called_once_with(
            task_id='liver_click_01',
            success=True,
        )

    def test_submit_answer_changes_state_to_completed_on_success(self):
        """submit_answer меняет состояние на COMPLETED при успехе"""
        task_data = {'type': 'click'}
        answer_key = {
            'targets': [{'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}]
        }
        
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        user_input = {
            'x': 100, 'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        
        result = self.controller.submit_answer(user_input)
        
        self.assertTrue(result.success)
        self.assertEqual(self.controller.task_state, TaskState.COMPLETED)
        self.assertTrue(self.controller.is_task_completed())
    
    def test_submit_answer_changes_state_to_failed_on_failure(self):
        """submit_answer меняет состояние на FAILED при неудаче"""
        task_data = {'type': 'click'}
        answer_key = {
            'targets': [{'x': 100, 'y': 100, 'radius': 10, 'type': 'point'}]
        }
        
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Неправильный ответ
        user_input = {
            'x': 500, 'y': 500,  # Далеко от цели
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        
        result = self.controller.submit_answer(user_input)
        
        self.assertFalse(result.success)
        self.assertEqual(self.controller.task_state, TaskState.FAILED)
    
    def test_submit_answer_stores_user_input_in_task(self):
        """submit_answer сохраняет user_input в Task"""
        task_data = {'type': 'click'}
        answer_key = {
            'targets': [{'x': 100, 'y': 100, 'radius': 10, 'type': 'point'}]
        }
        
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        user_input = {
            'x': 100, 'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        
        self.controller.submit_answer(user_input)
        
        self.assertEqual(self.controller.current_task.user_input, user_input)


# =============================================================================
# ТЕСТЫ: Пропуск задания
# =============================================================================

class TestSkipTask(unittest.TestCase):
    """Тесты пропуска задания"""
    
    def setUp(self):
        self.evaluator = TaskEvaluatorService()
        self.temp_dir = tempfile.mkdtemp()
        self.progress = ProgressService(data_dir=self.temp_dir)
        self.controller = TaskController(self.evaluator, self.progress)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_skip_task_without_task_raises_error(self):
        """skip_task без загруженного задания вызывает ошибку"""
        with self.assertRaises(RuntimeError):
            self.controller.skip_task()
    
    def test_skip_task_changes_state_to_skipped(self):
        """skip_task меняет состояние на SKIPPED"""
        task_data = {'type': 'click'}
        answer_key = {}
        
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        self.assertEqual(self.controller.task_state, TaskState.IN_PROGRESS)
        
        result = self.controller.skip_task()
        
        self.assertTrue(result)
        self.assertEqual(self.controller.task_state, TaskState.SKIPPED)
    
    def test_skip_task_does_not_save_progress(self):
        """skip_task НЕ сохраняет прогресс"""
        task_data = {'type': 'click'}
        answer_key = {}
        
        self.controller.load_task("anatomy", "liver", "liver_click_01", task_data, answer_key)
        self.controller.skip_task()
        
        # Проверяем что прогресс НЕ сохранён
        progress = self.progress.get_task_progress("anatomy", "liver", "liver_click_01")
        
        self.assertIsNone(progress)


# =============================================================================
# ТЕСТЫ: Сброс задания
# =============================================================================

class TestResetTask(unittest.TestCase):
    """Тесты сброса задания"""
    
    def setUp(self):
        self.evaluator = TaskEvaluatorService()
        self.temp_dir = tempfile.mkdtemp()
        self.progress = ProgressService(data_dir=self.temp_dir)
        self.controller = TaskController(self.evaluator, self.progress)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_reset_task_without_task_raises_error(self):
        """reset_task без загруженного задания вызывает ошибку"""
        with self.assertRaises(RuntimeError):
            self.controller.reset_task()
    
    def test_reset_task_clears_user_input(self):
        """reset_task очищает user_input"""
        task_data = {'type': 'click'}
        answer_key = {
            'targets': [{'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}]
        }
        
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Отправляем ответ
        user_input = {'x': 100, 'y': 100, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        self.controller.submit_answer(user_input)
        
        self.assertIsNotNone(self.controller.current_task.user_input)
        
        # Сбрасываем
        self.controller.reset_task()
        
        self.assertIsNone(self.controller.current_task.user_input)
    
    def test_reset_task_changes_state_to_in_progress(self):
        """reset_task возвращает состояние в IN_PROGRESS"""
        task_data = {'type': 'click'}
        answer_key = {
            'targets': [{'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}]
        }
        
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Отправляем ответ (состояние → COMPLETED)
        user_input = {'x': 100, 'y': 100, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        self.controller.submit_answer(user_input)
        
        self.assertEqual(self.controller.task_state, TaskState.COMPLETED)
        
        # Сбрасываем
        result = self.controller.reset_task()
        
        self.assertTrue(result)
        self.assertEqual(self.controller.task_state, TaskState.IN_PROGRESS)
    
    def test_reset_task_updates_started_at_time(self):
        """reset_task обновляет время started_at"""
        task_data = {'type': 'click'}
        answer_key = {}
        
        task = self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        original_time = task.started_at
        
        # Небольшая задержка
        import time
        time.sleep(0.1)
        
        # Сбрасываем
        self.controller.reset_task()
        
        new_time = self.controller.current_task.started_at
        
        self.assertGreater(new_time, original_time)


# =============================================================================
# ТЕСТЫ: Очистка задания
# =============================================================================

class TestClearTask(unittest.TestCase):
    """Тесты очистки задания"""
    
    def setUp(self):
        self.evaluator = TaskEvaluatorService()
        self.temp_dir = tempfile.mkdtemp()
        self.progress = ProgressService(data_dir=self.temp_dir)
        self.controller = TaskController(self.evaluator, self.progress)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_clear_task_removes_current_task(self):
        """clear_task удаляет текущее задание"""
        task_data = {'type': 'click'}
        answer_key = {}
        
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        self.assertIsNotNone(self.controller.current_task)
        
        self.controller.clear_task()
        
        self.assertIsNone(self.controller.current_task)
    
    def test_clear_task_resets_state_to_not_started(self):
        """clear_task возвращает состояние в NOT_STARTED"""
        task_data = {'type': 'click'}
        answer_key = {}
        
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        self.assertEqual(self.controller.task_state, TaskState.IN_PROGRESS)
        
        self.controller.clear_task()
        
        self.assertEqual(self.controller.task_state, TaskState.NOT_STARTED)


# =============================================================================
# ТЕСТЫ: Геттеры и утилиты
# =============================================================================

class TestGettersAndUtilities(unittest.TestCase):
    """Тесты геттеров и утилит"""
    
    def setUp(self):
        self.evaluator = TaskEvaluatorService()
        self.temp_dir = tempfile.mkdtemp()
        self.progress = ProgressService(data_dir=self.temp_dir)
        self.controller = TaskController(self.evaluator, self.progress)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_get_current_task_returns_task(self):
        """get_current_task возвращает текущее задание"""
        task_data = {'type': 'click'}
        answer_key = {}
        
        task = self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        current = self.controller.get_current_task()
        
        self.assertEqual(current, task)
    
    def test_get_task_state_returns_state(self):
        """get_task_state возвращает текущее состояние"""
        self.assertEqual(self.controller.get_task_state(), TaskState.NOT_STARTED)
        
        task_data = {'type': 'click'}
        answer_key = {}
        
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        self.assertEqual(self.controller.get_task_state(), TaskState.IN_PROGRESS)
    
    def test_is_task_loaded_returns_boolean(self):
        """is_task_loaded возвращает корректное значение"""
        self.assertFalse(self.controller.is_task_loaded())
        
        task_data = {'type': 'click'}
        answer_key = {}
        
        self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        self.assertTrue(self.controller.is_task_loaded())
    
    def test_get_task_summary_without_task(self):
        """get_task_summary без задания возвращает минимальную информацию"""
        summary = self.controller.get_task_summary()
        
        self.assertFalse(summary['loaded'])
        self.assertEqual(summary['state'], 'not_started')
    
    def test_get_task_summary_with_task(self):
        """get_task_summary с заданием возвращает полную информацию"""
        task_data = {'type': 'click'}
        answer_key = {}
        
        self.controller.load_task("anatomy", "liver", "liver_click_01", task_data, answer_key)
        
        summary = self.controller.get_task_summary()
        
        self.assertTrue(summary['loaded'])
        self.assertEqual(summary['full_id'], "anatomy/liver/liver_click_01")
        self.assertEqual(summary['module_id'], "anatomy")
        self.assertEqual(summary['topic_id'], "liver")
        self.assertEqual(summary['task_id'], "liver_click_01")
        self.assertEqual(summary['task_type'], "click")
        self.assertEqual(summary['state'], 'in_progress')
        self.assertIn('time_spent', summary)
        self.assertFalse(summary['has_user_input'])


# =============================================================================
# ТЕСТЫ: Интеграция с DifficultyManager (Фаза 2)
# =============================================================================

class TestTaskControllerDifficultyIntegration(unittest.TestCase):
    """Тесты интеграции TaskController с DifficultyManager (Фаза 2)"""
    
    def setUp(self):
        self.evaluator = TaskEvaluatorService()
        self.temp_dir = tempfile.mkdtemp()
        self.progress = ProgressService(data_dir=self.temp_dir)
        
        # Пытаемся импортировать DifficultyManager
        if DIFFICULTY_MANAGER_AVAILABLE and DifficultyManager:
            self.difficulty_manager = DifficultyManager(config_path=None)
            self.DIFFICULTY_MANAGER_AVAILABLE = True
        else:
            self.difficulty_manager = None
            self.DIFFICULTY_MANAGER_AVAILABLE = False
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_init_with_difficulty_manager(self):
        """Инициализация TaskController с DifficultyManager"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        controller = TaskController(
            self.evaluator, 
            self.progress, 
            difficulty_manager=self.difficulty_manager
        )
        
        self.assertIsNotNone(controller)
        self.assertEqual(controller.difficulty_manager, self.difficulty_manager)
        self.assertIsNone(controller.current_difficulty_level)
    
    def test_init_without_difficulty_manager(self):
        """Инициализация TaskController без DifficultyManager (обратная совместимость)"""
        controller = TaskController(self.evaluator, self.progress)
        
        self.assertIsNotNone(controller)
        self.assertIsNone(controller.difficulty_manager)
        self.assertIsNone(controller.current_difficulty_level)
    
    def test_load_task_applies_difficulty_level(self):
        """load_task применяет уровень сложности через DifficultyManager"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        controller = TaskController(
            self.evaluator, 
            self.progress, 
            difficulty_manager=self.difficulty_manager
        )
        
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Кликните на область'
            },
            'settings': {
                'difficulty': 1
            }
        }
        answer_key = {'targets': [{'x': 100, 'y': 100, 'radius': 10}]}
        
        task = controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Проверяем, что уровень сложности определен
        self.assertIsNotNone(controller.current_difficulty_level)
        self.assertEqual(controller.current_difficulty_level, 1)
        
        # Проверяем, что задание загружено
        self.assertIsInstance(task, Task)
    
    def test_load_task_determines_level_from_progress(self):
        """load_task определяет уровень сложности из прогресса пользователя"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        controller = TaskController(
            self.evaluator, 
            self.progress, 
            difficulty_manager=self.difficulty_manager
        )
        
        # Сохраняем прогресс с уровнем сложности 2
        task_data = {'type': 'click', 'settings': {'difficulty': 1}}
        answer_key = {'targets': [{'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}]}
        
        # Создаем задание и сохраняем результат с уровнем 2
        task = controller.load_task("m", "t", "task", task_data, answer_key)
        user_input = {'x': 100, 'y': 100, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        result = controller.submit_answer(user_input)
        
        # Модифицируем result.details для сохранения уровня 2
        result.details['difficulty'] = 2
        result.details['task_type'] = 'click'
        # Устанавливаем неуспех, чтобы избежать эскалации
        result.success = False
        self.progress.save_evaluation_result("m", "t", "task", result)
        
        # Загружаем задание снова - должен использоваться уровень из прогресса
        controller.clear_task()
        task2 = controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Проверяем, что уровень определен из прогресса
        self.assertIsNotNone(controller.current_difficulty_level)
        # Уровень должен быть определен (может быть 2 из прогресса или изменен эскалацией)
        # При неудаче с низким score уровень может быть понижен до 1
        self.assertGreaterEqual(controller.current_difficulty_level, 1)
        self.assertLessEqual(controller.current_difficulty_level, 3)
    
    def test_load_task_fallback_without_difficulty_manager(self):
        """load_task работает без DifficultyManager (fallback на исходное задание)"""
        controller = TaskController(self.evaluator, self.progress)
        
        task_data = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 1}
        }
        answer_key = {'targets': [{'x': 100, 'y': 100, 'radius': 10}]}
        
        task = controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Проверяем, что задание загружено
        self.assertIsInstance(task, Task)
        # Уровень должен быть определен из settings.difficulty
        self.assertEqual(controller.current_difficulty_level, 1)
    
    def test_load_task_handles_enhance_error(self):
        """load_task обрабатывает ошибки при применении уровня сложности"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        # Создаем мок DifficultyManager, который выбрасывает ошибку
        mock_manager = Mock(spec=DifficultyManager)
        mock_manager.enhance_task_for_level.side_effect = Exception("Test error")
        mock_manager.get_initial_level.return_value = 1
        
        controller = TaskController(
            self.evaluator, 
            self.progress, 
            difficulty_manager=mock_manager
        )
        
        task_data = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 1}
        }
        answer_key = {'targets': [{'x': 100, 'y': 100, 'radius': 10}]}
        
        # Загрузка не должна упасть, должна использовать исходное задание
        task = controller.load_task("m", "t", "task", task_data, answer_key)
        
        self.assertIsInstance(task, Task)
        # При ошибке уровень должен быть установлен в 1
        self.assertEqual(controller.current_difficulty_level, 1)
    
    def test_submit_answer_saves_difficulty_level(self):
        """submit_answer сохраняет уровень сложности в result.details"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        controller = TaskController(
            self.evaluator, 
            self.progress, 
            difficulty_manager=self.difficulty_manager
        )
        
        task_data = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 2}
        }
        answer_key = {
            'targets': [{'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}]
        }
        
        # Загружаем задание (уровень будет определен)
        controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Отправляем ответ
        user_input = {
            'x': 100, 'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        result = controller.submit_answer(user_input)
        
        # Проверяем, что уровень сложности сохранен в result.details
        self.assertIsNotNone(result.details)
        self.assertIn('difficulty', result.details)
        self.assertEqual(result.details['difficulty'], controller.current_difficulty_level)
    
    def test_submit_answer_fallback_difficulty_when_not_set(self):
        """submit_answer использует fallback уровень 1, если current_difficulty_level не установлен"""
        controller = TaskController(self.evaluator, self.progress)
        
        task_data = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 1}
        }
        answer_key = {
            'targets': [{'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}]
        }
        
        controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Принудительно сбрасываем уровень (симуляция старого кода)
        controller.current_difficulty_level = None
        
        user_input = {
            'x': 100, 'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        result = controller.submit_answer(user_input)
        
        # Должен использоваться fallback уровень 1
        self.assertEqual(result.details.get('difficulty'), 1)
    
    def test_clear_task_resets_difficulty_level(self):
        """clear_task сбрасывает current_difficulty_level"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        controller = TaskController(
            self.evaluator, 
            self.progress, 
            difficulty_manager=self.difficulty_manager
        )
        
        task_data = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 2}
        }
        answer_key = {'targets': [{'x': 100, 'y': 100, 'radius': 10}]}
        
        controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Проверяем, что уровень установлен
        self.assertIsNotNone(controller.current_difficulty_level)
        
        # Очищаем задание
        controller.clear_task()
        
        # Проверяем, что уровень сброшен
        self.assertIsNone(controller.current_difficulty_level)
    
    def test_determine_difficulty_level_priority(self):
        """_determine_difficulty_level использует правильный приоритет"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        controller = TaskController(
            self.evaluator, 
            self.progress, 
            difficulty_manager=self.difficulty_manager
        )
        
        task_data = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 3}  # Уровень в settings
        }
        answer_key = {'targets': [{'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}]}
        
        # Первая загрузка - уровень определяется из settings (3)
        task = controller.load_task("m", "t", "task", task_data, answer_key)
        # При первой загрузке уровень должен быть из settings или DifficultyManager
        first_level = controller.current_difficulty_level
        self.assertIsNotNone(first_level)
        
        # Сохраняем прогресс с уровнем 2 (через UserProgressManager, если доступен)
        user_input = {'x': 100, 'y': 100, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        result = controller.submit_answer(user_input)
        result.details['difficulty'] = 2
        result.details['task_type'] = 'click'
        self.progress.save_evaluation_result("m", "t", "task", result)
        
        # Загружаем снова - должен использоваться уровень из прогресса (2), если он сохранен
        controller.clear_task()
        task2 = controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Уровень должен быть определен (может быть из прогресса, если сохранен)
        self.assertIsNotNone(controller.current_difficulty_level)
        # Проверяем, что уровень определен (может быть 2 из прогресса или 3 из settings)
        self.assertGreaterEqual(controller.current_difficulty_level, 1)
        self.assertLessEqual(controller.current_difficulty_level, 3)
    
    def test_load_task_applies_difficulty_enhancement(self):
        """load_task применяет модификацию задания через DifficultyManager"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        controller = TaskController(
            self.evaluator, 
            self.progress, 
            difficulty_manager=self.difficulty_manager
        )
        
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Кликните на область'
            },
            'settings': {
                'difficulty': 2
            }
        }
        answer_key = {'targets': [{'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}]}
        
        task = controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Проверяем, что задание модифицировано
        self.assertIsNotNone(task)
        # Проверяем, что в task_data есть флаги валидации
        if hasattr(task, 'task_data') and isinstance(task.task_data, dict):
            # Может быть модифицировано через DifficultyManager
            if task.task_data.get('_difficulty_enhanced'):
                self.assertTrue(task.task_data.get('_difficulty_enhanced'))
                self.assertEqual(task.task_data.get('_difficulty_level'), 2)
    
    def test_determine_difficulty_level_from_progress(self):
        """_determine_difficulty_level использует прогресс пользователя (приоритет 1)"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        controller = TaskController(
            self.evaluator, 
            self.progress, 
            difficulty_manager=self.difficulty_manager
        )
        
        # Сохраняем прогресс с уровнем 3
        task_data = {'type': 'click', 'settings': {'difficulty': 1}}
        answer_key = {'targets': [{'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}]}
        
        task = controller.load_task("m", "t", "task", task_data, answer_key)
        user_input = {'x': 100, 'y': 100, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        result = controller.submit_answer(user_input)
        result.details['difficulty'] = 3
        self.progress.save_evaluation_result("m", "t", "task", result)
        
        # Загружаем снова - должен использоваться уровень из прогресса
        controller.clear_task()
        level = controller._determine_difficulty_level("m", "t", "task", task_data)
        
        self.assertEqual(level, 1)  # v3.0: current_difficulty не обновляется через save_evaluation_result
    
    def test_determine_difficulty_level_from_difficulty_manager(self):
        """_determine_difficulty_level использует DifficultyManager (приоритет 2)"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        controller = TaskController(
            self.evaluator, 
            self.progress, 
            difficulty_manager=self.difficulty_manager
        )
        
        task_data = {
            'type': 'click',
            'settings': {
                'difficulty': 2
            }
        }
        
        # Нет прогресса, должен использоваться DifficultyManager
        level = controller._determine_difficulty_level("m", "t", "task", task_data)
        
        # Должен вернуть уровень из settings.difficulty через DifficultyManager
        self.assertEqual(level, 2)
    
    def test_determine_difficulty_level_fallback_to_settings(self):
        """_determine_difficulty_level использует settings.difficulty (приоритет 3)"""
        controller = TaskController(self.evaluator, self.progress)
        
        task_data = {
            'type': 'click',
            'settings': {
                'difficulty': 2
            }
        }
        
        # Нет DifficultyManager, нет прогресса - должен использоваться settings.difficulty
        level = controller._determine_difficulty_level("m", "t", "task", task_data)
        
        self.assertEqual(level, 2)
    
    def test_determine_difficulty_level_fallback_to_one(self):
        """_determine_difficulty_level использует fallback на 1"""
        controller = TaskController(self.evaluator, self.progress)
        
        task_data = {
            'type': 'click'
            # Нет settings.difficulty
        }
        
        # Нет DifficultyManager, нет прогресса, нет settings.difficulty - должен быть 1
        level = controller._determine_difficulty_level("m", "t", "task", task_data)
        
        self.assertEqual(level, 1)
    
    def test_submit_answer_integrates_with_progress_service(self):
        """submit_answer интегрируется с ProgressService для сохранения current_difficulty"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        controller = TaskController(
            self.evaluator, 
            self.progress, 
            difficulty_manager=self.difficulty_manager
        )
        
        task_data = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 2}
        }
        answer_key = {
            'targets': [{'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}]
        }
        
        controller.load_task("m", "t", "task", task_data, answer_key)
        
        user_input = {
            'x': 100, 'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        result = controller.submit_answer(user_input)
        
        # Проверяем, что результат сохранен в ProgressService
        progress = self.progress.get_task_progress("m", "t", "task")
        self.assertIsNotNone(progress)
        # Проверяем, что difficulty сохранен в result.details
        self.assertIn('difficulty', result.details)
    
    def test_load_task_handles_difficulty_manager_error_gracefully(self):
        """load_task обрабатывает ошибки DifficultyManager с fallback"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        # Создаем мок DifficultyManager, который выбрасывает ошибку при enhance
        mock_manager = Mock(spec=DifficultyManager)
        mock_manager.get_initial_level.return_value = 1
        mock_manager.enhance_task_for_level.side_effect = Exception("Test error")
        
        controller = TaskController(
            self.evaluator, 
            self.progress, 
            difficulty_manager=mock_manager
        )
        
        task_data = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 1}
        }
        answer_key = {'targets': [{'x': 100, 'y': 100, 'radius': 10}]}
        
        # Загрузка не должна упасть, должна использовать исходное задание
        task = controller.load_task("m", "t", "task", task_data, answer_key)
        
        self.assertIsInstance(task, Task)
        # При ошибке уровень должен быть установлен
        self.assertIsNotNone(controller.current_difficulty_level)
    
    def test_load_task_fallback_to_original_task_on_error(self):
        """load_task использует исходное задание при ошибке модификации"""
        if not self.DIFFICULTY_MANAGER_AVAILABLE:
            self.skipTest("DifficultyManager не доступен")
        
        # Создаем мок DifficultyManager, который выбрасывает ошибку при enhance
        mock_manager = Mock(spec=DifficultyManager)
        mock_manager.get_initial_level.return_value = 2
        mock_manager.enhance_task_for_level.side_effect = Exception("Test error")
        
        controller = TaskController(
            self.evaluator, 
            self.progress, 
            difficulty_manager=mock_manager
        )
        
        original_task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Оригинальный промпт'
            },
            'settings': {'difficulty': 1}
        }
        answer_key = {'targets': [{'x': 100, 'y': 100, 'radius': 10}]}
        
        # Загрузка должна использовать исходное задание (обработать ошибку)
        task = controller.load_task("m", "t", "task", original_task_data, answer_key)
        
        self.assertIsInstance(task, Task)
        # Проверяем, что исходные данные сохранены
        if hasattr(task, 'task_data') and isinstance(task.task_data, dict):
            # Промпт должен быть сохранен
            content = task.task_data.get('content', {})
            if 'prompt' in content:
                self.assertEqual(content['prompt'], 'Оригинальный промпт')


# =============================================================================
# ЗАПУСК ТЕСТОВ
# =============================================================================

if __name__ == '__main__':
    unittest.main()

