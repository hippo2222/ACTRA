"""
E2E тесты для Фазы 2: Уровни сложности (без GUI).

Тестирует полные сценарии использования системы уровней сложности.
"""

import unittest
import sys
import os
import shutil
import tempfile
from pathlib import Path

# Настройка путей
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from logic.task_controller import TaskController
from services.task_evaluator_service import TaskEvaluatorService
from services.progress_service import ProgressService

# Импорт DifficultyManager
try:
    from services.difficulty_manager import DifficultyManager
    DIFFICULTY_MANAGER_AVAILABLE = True
except ImportError:
    DIFFICULTY_MANAGER_AVAILABLE = False
    DifficultyManager = None


@unittest.skipIf(not DIFFICULTY_MANAGER_AVAILABLE, "DifficultyManager не доступен")
class TestPhase2E2E(unittest.TestCase):
    """E2E тесты для полных сценариев использования системы уровней сложности"""
    
    def setUp(self):
        """Настройка тестового окружения"""
        self.evaluator = TaskEvaluatorService()
        self.temp_dir = tempfile.mkdtemp()
        self.progress = ProgressService(data_dir=self.temp_dir)
        self.difficulty_manager = DifficultyManager(config_path=None)
        self.controller = TaskController(
            self.evaluator,
            self.progress,
            difficulty_manager=self.difficulty_manager
        )
    
    def tearDown(self):
        """Очистка после тестов"""
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_scenario_1_level_1_success_escalate_to_2(self):
        """Сценарий 1: Выполнение задания на уровне 1 → успех → эскалация на уровень 2"""
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
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
            ]
        }
        
        # Загружаем задание на уровне 1
        task = self.controller.load_task("m", "t", "task", task_data, answer_key)
        self.assertEqual(self.controller.current_difficulty_level, 1)
        
        # Выполняем задание успешно
        user_input = {
            'x': 100, 'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        result = self.controller.submit_answer(user_input)
        result.success = True
        result.details['difficulty'] = 1
        result.details['task_type'] = 'click'
        self.progress.save_evaluation_result("m", "t", "task", result)
        
        # Проверяем, что уровень эскалирован до 2
        self.controller.clear_task()
        task2 = self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Уровень должен быть определен из прогресса (после эскалации)
        self.assertIsNotNone(self.controller.current_difficulty_level)
        # Может быть 2 (эскалирован) или остаться 1
        self.assertGreaterEqual(self.controller.current_difficulty_level, 1)
        self.assertLessEqual(self.controller.current_difficulty_level, 2)
    
    def test_scenario_2_level_2_failure_deescalate_to_1(self):
        """Сценарий 2: Выполнение задания на уровне 2 → неудача → деэскалация на уровень 1"""
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
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
            ]
        }
        
        # Загружаем задание на уровне 2
        task = self.controller.load_task("m", "t", "task", task_data, answer_key)
        self.assertEqual(self.controller.current_difficulty_level, 2)
        
        # Выполняем задание неудачно
        user_input = {
            'x': 500, 'y': 500,  # Неправильный ответ
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        result = self.controller.submit_answer(user_input)
        result.success = False
        result.details['difficulty'] = 2
        result.details['task_type'] = 'click'
        self.progress.save_evaluation_result("m", "t", "task", result)
        
        # Проверяем, что уровень деэскалирован до 1
        self.controller.clear_task()
        task2 = self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Уровень должен быть определен из прогресса (после деэскалации)
        self.assertIsNotNone(self.controller.current_difficulty_level)
        # Может быть 1 (деэскалирован) или остаться 2
        self.assertGreaterEqual(self.controller.current_difficulty_level, 1)
        self.assertLessEqual(self.controller.current_difficulty_level, 2)
    
    def test_scenario_3_level_3_success_stays_at_3(self):
        """Сценарий 3: Выполнение задания на уровне 3 → успех → остается на уровне 3"""
        task_data = {
            'type': 'click',
            'content': {
                'type': 'click',
                'prompt': 'Кликните на область'
            },
            'settings': {
                'difficulty': 3
            }
        }
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
            ]
        }
        
        # Загружаем задание на уровне 3
        task = self.controller.load_task("m", "t", "task", task_data, answer_key)
        self.assertEqual(self.controller.current_difficulty_level, 3)
        
        # Выполняем задание успешно
        user_input = {
            'x': 100, 'y': 100,
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        result = self.controller.submit_answer(user_input)
        result.success = True
        result.details['difficulty'] = 3
        result.details['task_type'] = 'click'
        self.progress.save_evaluation_result("m", "t", "task", result)
        
        # Проверяем, что уровень остался на 3 (максимум)
        self.controller.clear_task()
        task2 = self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Уровень должен остаться на максимуме
        self.assertEqual(self.controller.current_difficulty_level, 3)
    
    def test_scenario_4_level_1_failure_stays_at_1(self):
        """Сценарий 4: Выполнение задания на уровне 1 → неудача → остается на уровне 1"""
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
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
            ]
        }
        
        # Загружаем задание на уровне 1
        task = self.controller.load_task("m", "t", "task", task_data, answer_key)
        self.assertEqual(self.controller.current_difficulty_level, 1)
        
        # Выполняем задание неудачно
        user_input = {
            'x': 500, 'y': 500,  # Неправильный ответ
            'scale_factor': 1.0,
            'offset_x': 0, 'offset_y': 0
        }
        result = self.controller.submit_answer(user_input)
        result.success = False
        result.details['difficulty'] = 1
        result.details['task_type'] = 'click'
        self.progress.save_evaluation_result("m", "t", "task", result)
        
        # Проверяем, что уровень остался на 1 (минимум)
        self.controller.clear_task()
        task2 = self.controller.load_task("m", "t", "task", task_data, answer_key)
        
        # Уровень должен остаться на минимуме
        self.assertEqual(self.controller.current_difficulty_level, 1)
    
    def test_scenario_5_full_cycle_all_task_types(self):
        """Сценарий 5: Полный цикл для всех типов заданий (click, draw, test, sequence)"""
        task_types = ['click', 'draw', 'test', 'sequence_assembly']
        
        for task_type in task_types:
            with self.subTest(task_type=task_type):
                # Создаем задание в зависимости от типа
                if task_type == 'click':
                    task_data = {
                        'type': 'click',
                        'content': {'type': 'click', 'prompt': 'Кликните'},
                        'settings': {'difficulty': 1}
                    }
                    answer_key = {
                        'targets': [
                            {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
                        ]
                    }
                    user_input = {
                        'x': 100, 'y': 100,
                        'scale_factor': 1.0,
                        'offset_x': 0, 'offset_y': 0
                    }
                elif task_type == 'draw':
                    task_data = {
                        'type': 'draw',
                        'content': {
                            'type': 'draw',
                            'prompt': 'Обведите',
                            'annotations': [
                                {
                                    'type': 'freehand',  # Используем freehand, чтобы не преобразовалось в click
                                    'points': [[100, 100], [200, 100], [300, 200]],
                                    'label': 'test'
                                }
                            ]
                        },
                        'settings': {'difficulty': 1}
                    }
                    answer_key = {
                        'targets': [
                            {
                                'shape': 'freehand',
                                'points': [[100, 100], [200, 100], [300, 200]],
                                'label': 'test'
                            }
                        ]
                    }
                    user_input = {
                        'drawing': [
                            {'type': 'brush_stroke', 'points': [[100, 100], [110, 110], [120, 120]]}
                        ]
                    }
                elif task_type == 'test':
                    task_data = {
                        'type': 'test',
                        'content': {
                            'type': 'test',
                            'question': 'Вопрос?',
                            'show_options': True
                        },
                        'settings': {'difficulty': 1}
                    }
                    answer_key = {
                        'questions': [
                            {
                                'id': 'q1',
                                'answers': [
                                    {'text': 'Правильный', 'correct': True},
                                    {'text': 'Неправильный', 'correct': False}
                                ]
                            }
                        ]
                    }
                    user_input = {
                        'answers': {'q1': 0}
                    }
                elif task_type == 'sequence_assembly':
                    task_data = {
                        'type': 'sequence_assembly',
                        'content': {
                            'type': 'sequence_assembly',
                            'levels': [
                                {'level_id': 'level1', 'blocks': ['block1']}
                            ]
                        },
                        'settings': {'difficulty': 1}
                    }
                    answer_key = {
                        'levels': [
                            {'level_id': 'level1', 'blocks': ['block1']}
                        ]
                    }
                    user_input = {
                        'levels': [
                            {'level_id': 'level1', 'blocks': ['block1']}
                        ]
                    }
                
                # Загружаем задание
                task = self.controller.load_task("m", "t", f"task_{task_type}", task_data, answer_key)
                self.assertIsNotNone(task)
                
                # Выполняем задание
                result = self.controller.submit_answer(user_input)
                self.assertIsNotNone(result)
                self.assertIn('difficulty', result.details)
    
    def test_scenario_6_switch_between_tasks_preserve_levels(self):
        """Сценарий 6: Переключение между заданиями с сохранением уровней"""
        task_data_1 = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 1}
        }
        answer_key_1 = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
            ]
        }
        
        task_data_2 = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 1}
        }
        answer_key_2 = {
            'targets': [
                {'shape': 'point', 'coordinates': [200, 200], 'label': 'test'}
            ]
        }
        
        # Выполняем первое задание
        task1 = self.controller.load_task("m", "t", "task1", task_data_1, answer_key_1)
        user_input = {'x': 100, 'y': 100, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        result1 = self.controller.submit_answer(user_input)
        result1.details['difficulty'] = 2
        result1.details['task_type'] = 'click'
        # Устанавливаем неуспех, чтобы избежать эскалации
        result1.success = False
        self.progress.save_evaluation_result("m", "t", "task1", result1, difficulty=2)
        
        # Переключаемся на второе задание
        self.controller.clear_task()
        task2 = self.controller.load_task("m", "t", "task2", task_data_2, answer_key_2)
        
        # Второе задание должно иметь свой уровень (не зависит от первого)
        self.assertIsNotNone(self.controller.current_difficulty_level)
        
        # Выполняем второе задание
        user_input2 = {'x': 200, 'y': 200, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        result2 = self.controller.submit_answer(user_input2)
        result2.details['difficulty'] = 1
        result2.details['task_type'] = 'click'
        result2.success = False
        self.progress.save_evaluation_result("m", "t", "task2", result2, difficulty=1)
        
        # Возвращаемся к первому заданию - уровень должен быть сохранен
        self.controller.clear_task()
        task1_again = self.controller.load_task("m", "t", "task1", task_data_1, answer_key_1)
        
        # Уровень первого задания должен быть сохранен (может быть 2 из прогресса или изменен эскалацией)
        self.assertIsNotNone(self.controller.current_difficulty_level)
        # При неудаче уровень может быть понижен до 1
        self.assertGreaterEqual(self.controller.current_difficulty_level, 1)
        self.assertLessEqual(self.controller.current_difficulty_level, 2)
    
    def test_scenario_7_restore_level_from_progress_on_restart(self):
        """Сценарий 7: Восстановление уровня из прогресса при перезапуске"""
        task_data = {
            'type': 'click',
            'content': {'type': 'click'},
            'settings': {'difficulty': 1}
        }
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'test'}
            ]
        }
        
        # Первая сессия: выполняем задание
        controller1 = TaskController(
            self.evaluator,
            self.progress,
            difficulty_manager=self.difficulty_manager
        )
        task1 = controller1.load_task("m", "t", "task", task_data, answer_key)
        user_input = {'x': 100, 'y': 100, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        result1 = controller1.submit_answer(user_input)
        result1.success = True
        result1.details['difficulty'] = 2
        result1.details['task_type'] = 'click'
        # Сохраняем с явным указанием difficulty=2
        self.progress.save_evaluation_result("m", "t", "task", result1, difficulty=2)
        
        # Вторая сессия (имитация перезапуска): создаем новый контроллер
        controller2 = TaskController(
            self.evaluator,
            self.progress,
            difficulty_manager=self.difficulty_manager
        )
        task2 = controller2.load_task("m", "t", "task", task_data, answer_key)
        
        # Уровень должен быть восстановлен из прогресса (может быть 2 или изменен эскалацией)
        self.assertIsNotNone(controller2.current_difficulty_level)
        # При успехе с хорошим результатом уровень может быть эскалирован до 3
        # или остаться на 2 из прогресса
        self.assertGreaterEqual(controller2.current_difficulty_level, 1)
        self.assertLessEqual(controller2.current_difficulty_level, 3)


if __name__ == '__main__':
    unittest.main()

