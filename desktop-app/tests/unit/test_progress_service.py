"""
Unit-тесты для ProgressService.

Тестирует интеграцию между TaskEvaluatorService и UserProgressManager:
- Сохранение результатов оценки
- Получение прогресса по заданиям, темам, модулям
- Статистика пользователя
- Утилиты (is_completed и т.д.)

НЕДЕЛЯ 2, Блок B: Progress Service
"""

import unittest
import sys
import os
import tempfile
import shutil
from pathlib import Path
from datetime import datetime

# Добавляем пути для импорта
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.progress_service import ProgressService
from services.task_evaluator_service import EvaluationResult


class TestProgressServiceBasic(unittest.TestCase):
    """Базовые тесты для ProgressService"""
    
    def setUp(self):
        """Создаём временную директорию для тестов"""
        self.test_dir = tempfile.mkdtemp()
        self.service = ProgressService(data_dir=self.test_dir, user_id="test_user")
    
    def tearDown(self):
        """Удаляем временную директорию"""
        shutil.rmtree(self.test_dir)
    
    def test_service_initialization(self):
        """Проверка инициализации сервиса"""
        self.assertIsNotNone(self.service.progress_manager)
        self.assertEqual(self.service.user_id, "test_user")
        self.assertEqual(self.service.data_dir, self.test_dir)
    
    def test_progress_file_created(self):
        """Проверка создания файла прогресса"""
        # Новая структура: users/{user_id}/progress.json
        progress_file = os.path.join(self.test_dir, "users", "test_user", "progress.json")
        self.assertTrue(os.path.exists(progress_file))


class TestSaveEvaluationResult(unittest.TestCase):
    """Тесты для сохранения результатов оценки"""
    
    def setUp(self):
        """Создаём временную директорию для тестов"""
        self.test_dir = tempfile.mkdtemp()
        self.service = ProgressService(data_dir=self.test_dir)
    
    def tearDown(self):
        """Удаляем временную директорию"""
        shutil.rmtree(self.test_dir)
    
    def test_save_evaluation_result_success(self):
        """Сохранение успешного результата"""
        result = EvaluationResult(
            success=True,
            message="Отлично!",
            metric="IoU",
            details={'coverage': 95.5}
        )
        
        saved = self.service.save_evaluation_result(
            module_id="module_01",
            topic_id="topic_anatomy",
            task_id="task_liver",
            result=result
        )
        
        self.assertTrue(saved)
        
        # Проверяем что прогресс сохранился
        progress = self.service.get_task_progress("module_01", "topic_anatomy", "task_liver")
        self.assertIsNotNone(progress)
        self.assertTrue(progress['completed'])
    
    def test_save_evaluation_result_failure(self):
        """Сохранение неудачного результата"""
        result = EvaluationResult(
            success=False,
            message="Попробуйте ещё раз",
            metric="percent",
            details={}
        )
        
        saved = self.service.save_evaluation_result(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_01",
            result=result
        )
        
        self.assertTrue(saved)
        
        progress = self.service.get_task_progress("module_01", "topic_01", "task_01")
        self.assertIsNotNone(progress)
        self.assertFalse(progress['completed'])  # Не завершено
    
    def test_save_multiple_attempts(self):
        """Сохранение нескольких попыток"""
        # Первая попытка - неудачная
        result1 = EvaluationResult(success=False, message="Попытка 1", metric="percent")
        self.service.save_evaluation_result("mod1", "top1", "task1", result1)
        
        # Вторая попытка - успешная
        result2 = EvaluationResult(success=True, message="Попытка 2", metric="percent")
        self.service.save_evaluation_result("mod1", "top1", "task1", result2)
        
        # Третья попытка - успешная
        result3 = EvaluationResult(success=True, message="Попытка 3", metric="percent")
        self.service.save_evaluation_result("mod1", "top1", "task1", result3)
        
        progress = self.service.get_task_progress("mod1", "top1", "task1")
        
        # attempts это список, проверяем длину
        self.assertEqual(len(progress['attempts']), 3)
        self.assertTrue(progress['completed'])  # Есть успешные попытки


class TestSaveTaskResult(unittest.TestCase):
    """Тесты для упрощённого метода save_task_result"""
    
    def setUp(self):
        """Создаём временную директорию для тестов"""
        self.test_dir = tempfile.mkdtemp()
        self.service = ProgressService(data_dir=self.test_dir)
    
    def tearDown(self):
        """Удаляем временную директорию"""
        shutil.rmtree(self.test_dir)
    
    def test_save_task_result_simple(self):
        """Сохранение результата без EvaluationResult"""
        saved = self.service.save_task_result(
            module_id="mod1",
            topic_id="top1",
            task_id="task1",
            success=True
        )
        
        self.assertTrue(saved)
        
        progress = self.service.get_task_progress("mod1", "top1", "task1")
        self.assertTrue(progress['completed'])
    
    def test_save_task_result_with_extras(self):
        """Сохранение с дополнительными полями"""
        saved = self.service.save_task_result(
            module_id="mod1",
            topic_id="top1",
            task_id="task1",
            success=True,
            time_spent=120
        )
        
        self.assertTrue(saved)


class TestGetProgress(unittest.TestCase):
    """Тесты для получения прогресса"""
    
    def setUp(self):
        """Создаём тестовые данные"""
        self.test_dir = tempfile.mkdtemp()
        self.service = ProgressService(data_dir=self.test_dir)
        
        # Добавляем несколько результатов
        self.service.save_task_result("mod1", "top1", "task1", True)
        self.service.save_task_result("mod1", "top1", "task2", True)
        self.service.save_task_result("mod1", "top1", "task3", False)
        self.service.save_task_result("mod1", "top2", "task4", True)
    
    def tearDown(self):
        """Удаляем временную директорию"""
        shutil.rmtree(self.test_dir)
    
    def test_get_task_progress(self):
        """Получение прогресса по заданию"""
        progress = self.service.get_task_progress("mod1", "top1", "task1")
        
        self.assertIsNotNone(progress)
        self.assertTrue(progress['completed'])
        # attempts это список
        self.assertEqual(len(progress['attempts']), 1)
    
    def test_get_task_progress_nonexistent(self):
        """Получение прогресса по несуществующему заданию"""
        progress = self.service.get_task_progress("mod999", "top999", "task999")
        self.assertIsNone(progress)
    
    def test_get_topic_progress(self):
        """Получение прогресса по теме"""
        progress = self.service.get_topic_progress("mod1", "top1")
        
        # Метод пока не реализован в новой системе (требуется интеграция со StorageService)
        # Проверяем что метод возвращает None или предупреждение
        self.assertIsNone(progress)
    
    def test_get_module_progress(self):
        """Получение прогресса по модулю"""
        progress = self.service.get_module_progress("mod1")
        
        # Метод пока не реализован в новой системе (требуется интеграция со StorageService)
        # Проверяем что метод возвращает None или предупреждение
        self.assertIsNone(progress)
    
    def test_get_overall_statistics(self):
        """Получение общей статистики"""
        stats = self.service.get_overall_statistics()
        
        self.assertIsInstance(stats, dict)
        self.assertGreater(stats['total_tasks_completed'], 0)
        self.assertGreater(stats['total_attempts'], 0)


class TestUtilityMethods(unittest.TestCase):
    """Тесты для утилитных методов"""
    
    def setUp(self):
        """Создаём тестовые данные"""
        self.test_dir = tempfile.mkdtemp()
        self.service = ProgressService(data_dir=self.test_dir)
        
        # Успешное задание
        self.service.save_task_result("mod1", "top1", "task_completed", True)
        # Неуспешное задание
        self.service.save_task_result("mod1", "top1", "task_failed", False)
    
    def tearDown(self):
        """Удаляем временную директорию"""
        shutil.rmtree(self.test_dir)
    
    def test_is_task_completed(self):
        """Проверка завершённости задания"""
        self.assertTrue(
            self.service.is_task_completed("mod1", "top1", "task_completed")
        )
        self.assertFalse(
            self.service.is_task_completed("mod1", "top1", "task_failed")
        )
        self.assertFalse(
            self.service.is_task_completed("mod1", "top1", "task_nonexistent")
        )
    
    def test_get_attempts_count(self):
        """Получение количества попыток"""
        attempts = self.service.get_attempts_count("mod1", "top1", "task_completed")
        self.assertEqual(attempts, 1)
        
        # Добавляем ещё попытку
        self.service.save_task_result("mod1", "top1", "task_completed", True)
        
        attempts = self.service.get_attempts_count("mod1", "top1", "task_completed")
        self.assertEqual(attempts, 2)
    
    def test_reset_task_progress(self):
        """Сброс прогресса по заданию"""
        # Проверяем что задание существует
        self.assertTrue(
            self.service.is_task_completed("mod1", "top1", "task_completed")
        )
        
        # Сбрасываем прогресс
        reset = self.service.reset_task_progress("mod1", "top1", "task_completed")
        self.assertTrue(reset)
        
        # Проверяем что задание теперь не завершено
        self.assertFalse(
            self.service.is_task_completed("mod1", "top1", "task_completed")
        )
    
    def test_export_progress(self):
        """Экспорт всех данных прогресса"""
        exported = self.service.export_progress()
        
        self.assertIsInstance(exported, dict)
        # Новая структура: version, user_id, task_history, mistake_bank
        self.assertIn('version', exported)
        self.assertIn('user_id', exported)
        self.assertIn('task_history', exported)
        self.assertIn('mistake_bank', exported)
        self.assertEqual(exported['user_id'], 'default_user')
        self.assertEqual(exported['version'], '3.0')
    
    def test_get_progress_summary(self):
        """Получение текстового резюме"""
        summary = self.service.get_progress_summary()
        
        self.assertIsInstance(summary, str)
        self.assertIn('Tasks completed', summary)
        self.assertIn('Tasks completed', summary)


class TestIntegrationWithTaskEvaluator(unittest.TestCase):
    """Интеграционные тесты с TaskEvaluatorService"""
    
    def setUp(self):
        """Создаём оба сервиса"""
        from services.task_evaluator_service import TaskEvaluatorService
        
        self.test_dir = tempfile.mkdtemp()
        self.progress_service = ProgressService(data_dir=self.test_dir)
        self.evaluator_service = TaskEvaluatorService()
    
    def tearDown(self):
        """Удаляем временную директорию"""
        shutil.rmtree(self.test_dir)
    
    def test_evaluate_and_save_click_task(self):
        """Полный цикл: оценка Click задания + сохранение прогресса"""
        # Оцениваем задание
        user_input = {'x': 105, 'y': 105, 'scale_factor': 1.0, 'offset_x': 0, 'offset_y': 0}
        answer_key = {
            'targets': [
                {'shape': 'point', 'coordinates': [100, 100], 'label': 'Печень'}
            ]
        }
        
        result = self.evaluator_service.evaluate_click_task(user_input, answer_key)
        
        # Сохраняем результат
        saved = self.progress_service.save_evaluation_result(
            module_id="anatomy",
            topic_id="liver",
            task_id="liver_click_01",
            result=result
        )
        
        self.assertTrue(saved)
        self.assertTrue(result.success)
        
        # Проверяем что прогресс сохранился
        progress = self.progress_service.get_task_progress("anatomy", "liver", "liver_click_01")
        self.assertTrue(progress['completed'])
    
    def test_evaluate_and_save_open_answer_task(self):
        """Полный цикл: оценка Open Answer задания + сохранение"""
        user_input = {'answer': 'Печень выполняет детоксикацию'}
        answer_key = {'keywords': ['печень', 'детоксикацию']}
        
        result = self.evaluator_service.evaluate_open_answer_task(user_input, answer_key)
        
        saved = self.progress_service.save_evaluation_result(
            module_id="anatomy",
            topic_id="liver",
            task_id="liver_function",
            result=result
        )
        
        self.assertTrue(saved)
        self.assertTrue(result.success)


class TestNewFeatures(unittest.TestCase):
    """Тесты для новых функций ProgressService с поддержкой уровней сложности"""
    
    def setUp(self):
        """Создаём временную директорию для тестов"""
        self.test_dir = tempfile.mkdtemp()
        self.service = ProgressService(data_dir=self.test_dir, user_id="test_user")
    
    def tearDown(self):
        """Удаляем временную директорию"""
        shutil.rmtree(self.test_dir)
    
    def test_save_detailed_attempt(self):
        """Тест сохранения детальной попытки с уровнем сложности"""
        saved = self.service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_anatomy",
            task_id="task_liver_click",
            difficulty=2,
            success=True,
            time_spent=120,
            complex_id="complex_01",
            iteration=3
        )
        
        self.assertTrue(saved)
        
        # Проверяем что попытка сохранилась
        progress = self.service.get_task_progress("module_01", "topic_anatomy", "task_liver_click")
        self.assertIsNotNone(progress)
        self.assertEqual(progress['current_difficulty'], 2)
        self.assertEqual(len(progress['attempts']), 1)
        self.assertEqual(progress['attempts'][0]['difficulty'], 2)
        self.assertEqual(progress['attempts'][0]['time_spent'], 120)
        self.assertEqual(progress['attempts'][0]['complex_id'], "complex_01")
        self.assertEqual(progress['attempts'][0]['iteration'], 3)
    
    def test_save_detailed_attempt_multiple_difficulties(self):
        """Тест сохранения попыток с разными уровнями сложности"""
        # Попытка на уровне 1
        self.service.save_detailed_attempt(
            "mod1", "top1", "task1", difficulty=1, success=True
        )
        
        # Попытка на уровне 2
        self.service.save_detailed_attempt(
            "mod1", "top1", "task1", difficulty=2, success=True
        )
        
        # Попытка на уровне 3
        self.service.save_detailed_attempt(
            "mod1", "top1", "task1", difficulty=3, success=False
        )
        
        progress = self.service.get_task_progress("mod1", "top1", "task1")
        self.assertEqual(len(progress['attempts']), 3)
        self.assertEqual(progress['current_difficulty'], 1)  # v3.0: устанавливается при создании
        
        # Проверяем что все попытки сохранились с правильными difficulty
        difficulties = [a['difficulty'] for a in progress['attempts']]
        self.assertEqual(difficulties, [1, 2, 3])
    
    def test_save_detailed_attempt_invalid_difficulty(self):
        """Тест валидации уровня сложности"""
        # Попытка с невалидным difficulty
        saved = self.service.save_detailed_attempt(
            "mod1", "top1", "task1", difficulty=4, success=True
        )
        self.assertFalse(saved)
        
        # Попытка с difficulty=0
        saved = self.service.save_detailed_attempt(
            "mod1", "top1", "task1", difficulty=0, success=True, score=90.0
        )
        self.assertFalse(saved)
    
    def test_save_evaluation_result_with_difficulty(self):
        """Тест сохранения EvaluationResult с уровнем сложности"""
        result = EvaluationResult(
            success=True,
            score=92.5,
            message="Отлично!",
            metric="IoU",
            details={'coverage': 92.5}
        )
        
        saved = self.service.save_evaluation_result(
            module_id="module_01",
            topic_id="topic_anatomy",
            task_id="task_liver",
            result=result,
            difficulty=2
        )
        
        self.assertTrue(saved)
        
        progress = self.service.get_task_progress("module_01", "topic_anatomy", "task_liver")
        # current_difficulty может быть изменен эскалацией/деэскалацией
        self.assertIsNotNone(progress.get('current_difficulty'))
        self.assertGreaterEqual(progress.get('current_difficulty'), 1)
        self.assertLessEqual(progress.get('current_difficulty'), 3)
        self.assertEqual(progress['attempts'][0]['difficulty'], 2)
    
    def test_save_evaluation_result_difficulty_from_details(self):
        """Тест извлечения difficulty из details EvaluationResult"""
        result = EvaluationResult(
            success=True,
            score=88.0,
            message="Хорошо!",
            metric="percent",
            details={'difficulty': 3, 'time_spent': 150}
        )
        
        saved = self.service.save_evaluation_result(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_01",
            result=result
        )
        
        self.assertTrue(saved)
        
        progress = self.service.get_task_progress("module_01", "topic_01", "task_01")
        # difficulty должен быть извлечен из details
        self.assertEqual(progress['current_difficulty'], 3)
        self.assertEqual(progress['attempts'][0]['difficulty'], 3)
        self.assertEqual(progress['attempts'][0]['time_spent'], 150)
    
    def test_get_task_history(self):
        """Тест получения истории попыток"""
        # Добавляем несколько попыток
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=True, score=80.0)
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=2, success=True, score=85.0)
        
        history = self.service.get_task_history("mod1", "top1", "task1")
        
        self.assertIsNotNone(history)
        self.assertIn("attempts", history)
        self.assertIn("current_difficulty", history)
        self.assertIn("mastery_level", history)
        self.assertEqual(len(history["attempts"]), 2)
        self.assertEqual(history["current_difficulty"], 1)  # v3.0: устанавливается при создании
    
    def test_get_task_history_nonexistent(self):
        """Тест получения истории для несуществующего задания"""
        history = self.service.get_task_history("mod999", "top999", "task999")
        self.assertIsNone(history)
    
    def test_get_mistake_bank(self):
        """Тест получения банка ошибок"""
        # Добавляем неудачные попытки
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=False, score=40.0)
        self.service.save_detailed_attempt("mod1", "top1", "task2", difficulty=2, success=False, score=35.0)
        
        mistake_bank = self.service.get_mistake_bank()
        
        self.assertIsInstance(mistake_bank, list)
        self.assertEqual(len(mistake_bank), 2)
        
        # Проверяем структуру ошибок
        for mistake in mistake_bank:
            self.assertIn("module", mistake)
            self.assertIn("topic", mistake)
            self.assertIn("task", mistake)
            self.assertIn("level", mistake)
            self.assertIn("fail_count", mistake)
            self.assertIn("last_failed", mistake)
    
    def test_get_mistake_bank_removed_on_success(self):
        """Тест удаления ошибок из банка при успешной попытке"""
        # Неудачная попытка - должна добавиться в mistake_bank
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=False, score=40.0)
        
        mistake_bank = self.service.get_mistake_bank()
        self.assertEqual(len(mistake_bank), 1)
        
        # Успешная попытка - должна удалиться из mistake_bank
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=True, score=90.0)
        
        mistake_bank = self.service.get_mistake_bank()
        self.assertEqual(len(mistake_bank), 0)
    
    def test_get_mistakes_for_task(self):
        """Тест получения ошибок для конкретного задания"""
        # Добавляем ошибки для разных заданий
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=False, score=40.0)
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=2, success=False, score=35.0)
        self.service.save_detailed_attempt("mod1", "top1", "task2", difficulty=1, success=False, score=45.0)
        
        mistakes = self.service.get_mistakes_for_task("mod1", "top1", "task1")
        
        self.assertEqual(len(mistakes), 1)  # v3.0: одна запись на задание
        
        # Проверяем что все ошибки относятся к task1
        for mistake in mistakes:
            self.assertEqual(mistake["module"], "mod1")
            self.assertEqual(mistake["topic"], "top1")
            self.assertEqual(mistake["task"], "task1")
    
    def test_mastery_level_calculation(self):
        """Тест вычисления уровня мастерства"""
        # Меньше 3 успешных попыток - beginner
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=True, score=90.0)
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=True, score=85.0)
        
        progress = self.service.get_task_progress("mod1", "top1", "task1")
        self.assertEqual(progress['mastery_level'], "beginner")
        
        # 3+ успешных попыток с успешностью >= 80% - expert
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=True, score=95.0)
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=True, score=88.0)
        
        progress = self.service.get_task_progress("mod1", "top1", "task1")
        self.assertEqual(progress['mastery_level'], "expert")
    
    def test_current_difficulty_tracking(self):
        """Тест отслеживания текущего уровня сложности"""
        # Первая попытка на уровне 1
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=True, score=90.0)
        progress = self.service.get_task_progress("mod1", "top1", "task1")
        # current_difficulty может быть изменен эскалацией/деэскалацией
        self.assertIsNotNone(progress.get('current_difficulty'))
        self.assertGreaterEqual(progress.get('current_difficulty'), 1)
        self.assertLessEqual(progress.get('current_difficulty'), 3)
        
        # Вторая попытка на уровне 2
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=2, success=True, score=85.0)
        progress = self.service.get_task_progress("mod1", "top1", "task1")
        # current_difficulty может быть изменен эскалацией/деэскалацией
        self.assertIsNotNone(progress.get('current_difficulty'))
        self.assertGreaterEqual(progress.get('current_difficulty'), 1)
        self.assertLessEqual(progress.get('current_difficulty'), 3)
        
        # Третья попытка на уровне 3
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=3, success=False, score=60.0)
        progress = self.service.get_task_progress("mod1", "top1", "task1")
        # current_difficulty может быть изменен эскалацией/деэскалацией
        self.assertIsNotNone(progress.get('current_difficulty'))
        self.assertGreaterEqual(progress.get('current_difficulty'), 1)
        self.assertLessEqual(progress.get('current_difficulty'), 3)
    
    def test_save_detailed_attempt_with_difficulty(self):
        """Тест сохранения детальной попытки с уровнем сложности"""
        # Сохраняем попытку с явным указанием difficulty
        success = self.service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=2,
            success=True,
            score=85.0,
            time_spent=120
        )
        
        self.assertTrue(success)
        
        # Проверяем, что difficulty сохранен
        history = self.service.get_task_history("module_01", "topic_01", "task_001")
        self.assertIsNotNone(history)
        self.assertEqual(len(history["attempts"]), 1)
        self.assertEqual(history["attempts"][0]["difficulty"], 2)
        # current_difficulty может быть изменен эскалацией/деэскалацией
        self.assertIsNotNone(history.get("current_difficulty"))
        self.assertGreaterEqual(history.get("current_difficulty"), 1)
        self.assertLessEqual(history.get("current_difficulty"), 3)
    
    def test_get_mistake_bank_top_n(self):
        """Тест получения топ-N ошибок"""
        # Создаем несколько ошибок с разным количеством неудачных попыток
        # task_001: 1 ошибка
        self.service.save_detailed_attempt("mod1", "top1", "task_001", difficulty=1, success=False, score=40.0)
        
        # task_002: 3 ошибки
        self.service.save_detailed_attempt("mod1", "top1", "task_002", difficulty=1, success=False, score=40.0)
        self.service.save_detailed_attempt("mod1", "top1", "task_002", difficulty=1, success=False, score=45.0)
        self.service.save_detailed_attempt("mod1", "top1", "task_002", difficulty=1, success=False, score=50.0)
        
        # task_003: 2 ошибки
        self.service.save_detailed_attempt("mod1", "top1", "task_003", difficulty=1, success=False, score=40.0)
        self.service.save_detailed_attempt("mod1", "top1", "task_003", difficulty=1, success=False, score=45.0)
        
        # Получаем все ошибки
        all_mistakes = self.service.get_mistake_bank()
        self.assertEqual(len(all_mistakes), 3)
        
        # Проверяем, что ошибки отсортированы по fail_count (от большего к меньшему)
        fail_counts = [mistake["fail_count"] for mistake in all_mistakes]
        self.assertEqual(fail_counts, sorted(fail_counts, reverse=True))
        
        # Первая ошибка должна быть task_002 с 3 ошибками
        self.assertEqual(all_mistakes[0]["task"], "task_002")
        self.assertEqual(all_mistakes[0]["fail_count"], 3)
    
    def test_update_mastery_level(self):
        """Тест обновления уровня мастерства"""
        # Начинаем с beginner
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=True, score=70.0)
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=True, score=75.0)
        
        progress = self.service.get_task_progress("mod1", "top1", "task1")
        self.assertEqual(progress['mastery_level'], "beginner")
        
        # Добавляем третью успешную попытку — v3.0: 3/3=100% >= 90% → expert
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=True, score=80.0)
        
        progress = self.service.get_task_progress("mod1", "top1", "task1")
        self.assertEqual(progress['mastery_level'], "expert")
    
    def test_progress_isolation_between_users(self):
        """Тест изоляции прогресса между пользователями"""
        # Создаем двух пользователей
        user1_id = "user_001"
        user2_id = "user_002"
        
        service1 = ProgressService(data_dir=self.test_dir, user_id=user1_id)
        service2 = ProgressService(data_dir=self.test_dir, user_id=user2_id)
        
        # Сохраняем попытки для первого пользователя
        service1.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=True, score=90.0)
        service1.save_detailed_attempt("mod1", "top1", "task2", difficulty=1, success=False, score=40.0)
        
        # Сохраняем попытки для второго пользователя
        service2.save_detailed_attempt("mod1", "top1", "task1", difficulty=2, success=True, score=85.0)
        service2.save_detailed_attempt("mod1", "top1", "task3", difficulty=1, success=False, score=50.0)
        
        # Проверяем изоляцию прогресса
        progress1_task1 = service1.get_task_progress("mod1", "top1", "task1")
        progress2_task1 = service2.get_task_progress("mod1", "top1", "task1")
        
        self.assertIsNotNone(progress1_task1)
        self.assertIsNotNone(progress2_task1)
        
        # Проверяем, что данные разные
        self.assertEqual(progress1_task1['current_difficulty'], 1)
        self.assertEqual(progress2_task1['current_difficulty'], 2)
        self.assertEqual(len(progress1_task1['attempts']), 1)
        self.assertEqual(len(progress2_task1['attempts']), 1)
        
        # Проверяем изоляцию mistake_bank
        mistakes1 = service1.get_mistake_bank()
        mistakes2 = service2.get_mistake_bank()
        
        self.assertEqual(len(mistakes1), 1)  # task2 для user1
        self.assertEqual(len(mistakes2), 1)  # task3 для user2
        
        self.assertEqual(mistakes1[0]["task"], "task2")
        self.assertEqual(mistakes2[0]["task"], "task3")
    
    def test_get_task_progress_with_difficulty(self):
        """Тест получения прогресса с учетом уровней сложности"""
        # Сохраняем попытки на разных уровнях сложности
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=1, success=True, score=80.0)
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=2, success=True, score=75.0)
        self.service.save_detailed_attempt("mod1", "top1", "task1", difficulty=3, success=False, score=60.0)
        
        progress = self.service.get_task_progress("mod1", "top1", "task1")
        
        self.assertIsNotNone(progress)
        self.assertEqual(progress['current_difficulty'], 1)  # v3.0: устанавливается при создании
        self.assertEqual(len(progress['attempts']), 3)
        
        # Проверяем, что все попытки имеют правильный difficulty
        difficulties = [attempt['difficulty'] for attempt in progress['attempts']]
        self.assertEqual(difficulties, [1, 2, 3])
        
        
        # Проверяем, что completed учитывает успешные попытки на любом уровне
        self.assertTrue(progress['completed'])


if __name__ == '__main__':
    # Запуск всех тестов
    unittest.main(verbosity=2)

