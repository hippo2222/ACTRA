"""
Тесты для StatisticsService.

Проверяет:
- Агрегацию статистики из task_history
- Определение слабых областей
- Производительность по типам заданий
- Кэширование результатов
"""

import unittest
import tempfile
import shutil
import time
import json
import sys
from pathlib import Path
from datetime import datetime, timedelta

# Добавляем путь к desktop-app для импортов
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.progress_service import ProgressService
from services.statistics_service import StatisticsService


class TestStatisticsService(unittest.TestCase):
    """Тесты для StatisticsService"""
    
    def setUp(self):
        """Создаём тестовые данные"""
        self.test_dir = tempfile.mkdtemp()
        self.user_id = "test_user"
        
        # Создаём ProgressService
        self.progress_service = ProgressService(
            data_dir=self.test_dir,
            user_id=self.user_id
        )
        
        # Создаём StatisticsService
        self.statistics_service = StatisticsService(
            progress_service=self.progress_service,
            data_dir=self.test_dir
        )
        
        # Добавляем тестовые данные
        self._add_test_data()
    
    def tearDown(self):
        """Удаляем временную директорию"""
        shutil.rmtree(self.test_dir)
    
    def _add_test_data(self):
        """Добавляет тестовые данные для статистики"""
        # Успешные попытки
        self.progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=1,
            success=True,
            score=90.0,
            time_spent=60
        )
        self.progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_002",
            difficulty=1,
            success=True,
            score=85.0,
            time_spent=45
        )
        
        # Неуспешные попытки
        self.progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_02",
            task_id="task_003",
            difficulty=1,
            success=False,
            score=40.0,
            time_spent=120
        )
        self.progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_02",
            task_id="task_003",
            difficulty=1,
            success=False,
            score=50.0,
            time_spent=100
        )
        
        # Попытки на разных уровнях сложности
        self.progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=2,
            success=True,
            score=80.0,
            time_spent=90
        )
        self.progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=3,
            success=True,
            score=75.0,
            time_spent=150
        )

    def _write_json(self, path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    
    def test_aggregate_statistics(self):
        """Тест агрегации статистики"""
        stats = self.statistics_service.aggregate_statistics(self.user_id)
        
        # Проверяем общие метрики
        self.assertEqual(stats["total_tasks_attempted"], 6)
        self.assertEqual(stats["total_tasks_completed"], 4)

    def test_streak_from_complex_completions(self):
        """Проверяем расчёт streak_days/streak_best/streak_gap по завершениям комплексов"""
        pm = self.progress_service.progress_manager
        today = datetime.utcnow().date()
        pm.add_complex_completion(complex_id="c1", session_id="s1", timestamp=(today - timedelta(days=4)).isoformat())
        pm.add_complex_completion(complex_id="c2", session_id="s2", timestamp=(today - timedelta(days=2)).isoformat())
        pm.add_complex_completion(complex_id="c3", session_id="s3", timestamp=today.isoformat())

        stats = self.statistics_service.aggregate_statistics(self.user_id, force_refresh=True)
        self.assertEqual(stats.get("streak_days"), 3)
        self.assertEqual(stats.get("streak_best"), 3)
        self.assertEqual(stats.get("streak_gap"), 1)

    def test_time_dynamics_streak_gap(self):
        """Проверяем streak_gap и streak_break в динамике по датам завершения комплексов"""
        pm = self.progress_service.progress_manager
        today = datetime.utcnow().date()
        # Завершения с разрывом в 2 дня между вторым и третьим
        pm.add_complex_completion(complex_id="c1", session_id="s1", timestamp=(today - timedelta(days=5)).isoformat())
        pm.add_complex_completion(complex_id="c2", session_id="s2", timestamp=(today - timedelta(days=2)).isoformat())

        dynamics = self.statistics_service.get_time_dynamics(self.user_id, days=7, force_refresh=True)
        # Ищем запись дня последнего completion
        target_date = (today - timedelta(days=2)).isoformat()
        entry = next((d for d in dynamics if d["date"] == target_date), None)
        self.assertIsNotNone(entry)
        # gap между completions 2 дня => streak_gap=2, streak_break=True
        self.assertGreaterEqual(entry.get("streak_gap", 0), 2)
        self.assertTrue(entry.get("streak_break"))
    
    def test_get_weak_areas(self):
        """Тест получения слабых областей"""
        weak_areas = self.statistics_service.get_weak_areas(
            user_id=self.user_id,
            threshold=0.70
        )
        
        # topic_02 имеет success_rate 0.0 (0 успешных из 2 попыток)
        self.assertEqual(len(weak_areas), 1)
        self.assertEqual(weak_areas[0]["module"], "module_01")
        self.assertEqual(weak_areas[0]["topic"], "topic_02")
        self.assertAlmostEqual(weak_areas[0]["success_rate"], 0.0, places=2)
        self.assertEqual(weak_areas[0]["attempts"], 2)
    
    def test_get_weak_areas_empty(self):
        """Тест получения слабых областей при отсутствии слабых тем"""
        # Добавляем только успешные попытки
        self.progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_03",
            task_id="task_004",
            difficulty=1,
            success=True,
            score=90.0,
            time_spent=60
        )
        
        weak_areas = self.statistics_service.get_weak_areas(
            user_id=self.user_id,
            threshold=0.50  # Низкий порог
        )
        
        # topic_02 все еще слабая (0.0), но topic_03 успешная
        self.assertGreaterEqual(len(weak_areas), 1)
    
    def test_get_performance_by_type(self):
        """Тест производительности по типам заданий"""
        performance = self.statistics_service.get_performance_by_type(self.user_id)
        
        # Проверяем наличие поля
        self.assertIsInstance(performance, dict)
        
        # Пока тип определяется как "unknown" (см. _extract_task_type)
        # В будущем можно расширить для определения реальных типов
        if "unknown" in performance:
            self.assertGreater(performance["unknown"]["attempts"], 0)
    
    def test_cache_functionality(self):
        """Тест кэширования статистики"""
        # Первый вызов - должен вычислить
        stats1 = self.statistics_service.aggregate_statistics(self.user_id)
        
        # Второй вызов - должен вернуть из кэша
        stats2 = self.statistics_service.aggregate_statistics(self.user_id)
        
        # Данные должны быть одинаковыми
        self.assertEqual(stats1["total_tasks_attempted"], stats2["total_tasks_attempted"])
        self.assertEqual(stats1["last_updated"], stats2["last_updated"])
    
    def test_cache_force_refresh(self):
        """Тест принудительного обновления кэша"""
        # Первый вызов
        stats1 = self.statistics_service.aggregate_statistics(self.user_id)
        
        # Добавляем новую попытку
        self.progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_005",
            difficulty=1,
            success=True,
            score=95.0,
            time_spent=50
        )
        
        # Второй вызов без force_refresh - должен вернуть старый кэш
        stats2 = self.statistics_service.aggregate_statistics(self.user_id)
        self.assertEqual(stats1["total_tasks_attempted"], stats2["total_tasks_attempted"])
        
        # Третий вызов с force_refresh - должен пересчитать
        stats3 = self.statistics_service.aggregate_statistics(self.user_id, force_refresh=True)
        self.assertGreater(stats3["total_tasks_attempted"], stats2["total_tasks_attempted"])
    
    def test_cache_ttl(self):
        """Тест TTL кэша"""
        # Устанавливаем короткий TTL для теста
        self.statistics_service._cache_ttl = 0.1  # 100ms
        
        # Первый вызов
        stats1 = self.statistics_service.aggregate_statistics(self.user_id)
        
        # Ждём истечения TTL
        time.sleep(0.15)
        
        # Второй вызов - должен пересчитать
        stats2 = self.statistics_service.aggregate_statistics(self.user_id)
        
        # Данные должны быть одинаковыми (но пересчитанными)
        self.assertEqual(stats1["total_tasks_attempted"], stats2["total_tasks_attempted"])
    
    def test_clear_cache(self):
        """Тест очистки кэша"""
        # Заполняем кэш
        self.statistics_service.aggregate_statistics(self.user_id)
        
        # Проверяем, что кэш заполнен (формат ключа: stats_{user_id}_{days})
        cache_keys = [k for k in self.statistics_service._cache if k.startswith(f"stats_{self.user_id}_")]
        self.assertGreater(len(cache_keys), 0)
        
        # Очищаем кэш
        self.statistics_service.clear_cache(self.user_id)
        
        # Проверяем, что кэш очищен
        cache_keys_after = [k for k in self.statistics_service._cache if k.startswith(f"stats_{self.user_id}_")]
        self.assertEqual(len(cache_keys_after), 0, f"Cache keys remaining for {self.user_id}: {cache_keys_after}")
    
    def test_clear_all_cache(self):
        """Тест очистки всего кэша"""
        # Заполняем кэш для нескольких пользователей
        self.statistics_service.aggregate_statistics("user1")
        self.statistics_service.aggregate_statistics("user2")
        
        # Проверяем, что кэш заполнен
        self.assertGreater(len(self.statistics_service._cache), 0)
        
        # Очищаем весь кэш
        self.statistics_service.clear_cache()
        
        # Проверяем, что кэш пуст
        self.assertEqual(len(self.statistics_service._cache), 0)
    
    def test_get_time_dynamics(self):
        """Тест динамики по времени"""
        # Добавляем попытку с текущей датой
        self.progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_006",
            difficulty=1,
            success=True,
            score=88.0,
            time_spent=70
        )
        
        # Получаем динамику за последние 30 дней
        dynamics = self.statistics_service.get_time_dynamics(self.user_id, days=30)
        
        # Должна быть хотя бы одна запись
        self.assertGreater(len(dynamics), 0)
        
        # Проверяем структуру
        if dynamics:
            self.assertIn("date", dynamics[0])
            self.assertIn("attempts", dynamics[0])
            self.assertIn("success_rate", dynamics[0])
            self.assertIn("success_rate_start", dynamics[0])
            self.assertIn("success_rate_delta", dynamics[0])
            self.assertIn("success_rate_smooth", dynamics[0])
            self.assertIn("study_minutes", dynamics[0])
            self.assertIn("total_attempts", dynamics[0])
            self.assertIn("events", dynamics[0])

    def test_m6_aggregate_statistics_additive_mixed_contract(self):
        """M6: overall statistics should include additive mixed microcards/activity fields."""
        now_local = datetime.now().replace(microsecond=0)
        today = now_local.date()
        day_old_1 = (today - timedelta(days=4)).isoformat()
        day_old_2 = (today - timedelta(days=3)).isoformat()
        day_recent_1 = (today - timedelta(days=1)).isoformat()
        day_recent_2 = today.isoformat()

        self._write_json(
            Path(self.test_dir) / "user_calendar" / self.user_id / "activity.json",
            {
                day_old_1: {"activity_attempts_total": 1, "completion_percent": 20},
                day_old_2: {"activity_attempts_total": 1, "completion_percent": 20},
                day_recent_1: {"activity_attempts_total": 1, "completion_percent": 20},
                day_recent_2: {"activity_attempts_total": 1, "completion_percent": 20},
            },
        )

        self._write_json(
            Path(self.test_dir) / "microcards" / "decks" / "deck_m6.json",
            {
                "id": "deck_m6",
                "cards": [{"id": "card_1", "card_type": "fact_recall", "status": "active"}],
            },
        )
        self._write_json(
            Path(self.test_dir) / "users" / self.user_id / "microcards" / "review_states.json",
            {
                "schema_version": "1.0",
                "user_id": self.user_id,
                "items": {"card_1": {"status": "new"}},
            },
        )
        self._write_json(
            Path(self.test_dir) / "users" / self.user_id / "microcards" / "review_events.json",
            {
                "schema_version": "1.0",
                "user_id": self.user_id,
                "items": [
                    {
                        "id": "evt_m6_1",
                        "reviewed_at": now_local.isoformat(timespec="seconds"),
                        "rating": "good",
                        "response_time_ms": 2000,
                        "was_correct": True,
                        "details": {"card_type": "fact_recall"},
                    },
                    {
                        "id": "evt_m6_2",
                        "reviewed_at": (now_local - timedelta(days=1)).isoformat(timespec="seconds"),
                        "rating": "again",
                        "response_time_ms": 1000,
                        "was_correct": False,
                        "details": {"card_type": "pair_match", "is_perfect": False},
                    },
                ],
            },
        )

        stats = self.statistics_service.aggregate_statistics(self.user_id, force_refresh=True)

        self.assertIn("activity_streak_days", stats)
        self.assertIn("activity_streak_best", stats)
        self.assertEqual(stats["activity_streak_days"], 2)
        self.assertEqual(stats["activity_streak_best"], 2)

        self.assertIn("microcards", stats)
        self.assertEqual(stats["microcards"]["reviews_total"], 2)
        self.assertAlmostEqual(stats["microcards"]["correct_rate"], 0.5, places=3)
        self.assertEqual(stats["microcards"]["time_spent_seconds"], 3)
        self.assertEqual(stats["microcards"]["decks_active"], 1)
        self.assertIn("fact_recall", stats["microcards"]["by_card_type"])
        self.assertIn("pair_match", stats["microcards"]["by_card_type"])
        self.assertEqual(stats["microcards"]["ratings_distribution"]["good"], 1)
        self.assertEqual(stats["microcards"]["ratings_distribution"]["again"], 1)

        self.assertIn("learning_sources", stats)
        self.assertEqual(stats["learning_sources"]["tasks"]["attempts"], stats["total_tasks_attempted"])
        self.assertEqual(stats["learning_sources"]["tasks"]["time_spent_seconds"], stats["total_time_spent"])
        self.assertEqual(stats["learning_sources"]["microcards"]["attempts"], 2)
        self.assertEqual(stats["learning_sources"]["microcards"]["time_spent_seconds"], 3)
        self.assertEqual(
            stats["learning_sources"]["combined"]["attempts"],
            stats["learning_sources"]["tasks"]["attempts"] + stats["learning_sources"]["microcards"]["attempts"],
        )
        self.assertEqual(
            stats["learning_sources"]["combined"]["time_spent_seconds"],
            stats["learning_sources"]["tasks"]["time_spent_seconds"]
            + stats["learning_sources"]["microcards"]["time_spent_seconds"],
        )

    def test_m6_time_dynamics_mixed_fields(self):
        """M6: time dynamics should expose daily microcards + combined breakdown fields."""
        today_iso = datetime.now().date().isoformat()
        yesterday_iso = (datetime.now().date() - timedelta(days=1)).isoformat()

        self._write_json(
            Path(self.test_dir) / "user_calendar" / self.user_id / "activity.json",
            {
                yesterday_iso: {
                    "microcards_reviews": 4,
                    "microcards_correct": 2,
                    "microcards_seconds_spent": 240,
                    "activity_attempts_total": 4,
                    "completion_percent": 0,
                },
                today_iso: {
                    "microcards_reviews": 1,
                    "microcards_correct": 1,
                    "microcards_seconds_spent": 120,
                    "activity_attempts_total": 1,
                    "completion_percent": 0,
                },
            },
        )

        dynamics = self.statistics_service.get_time_dynamics(self.user_id, days=2, force_refresh=True)
        self.assertEqual(len(dynamics), 2)
        by_date = {row["date"]: row for row in dynamics}

        yesterday = by_date.get(yesterday_iso)
        self.assertIsNotNone(yesterday)
        self.assertEqual(yesterday["attempts"], 0)  # legacy unique-task semantics stays unchanged
        self.assertEqual(yesterday["total_attempts"], 0)
        self.assertEqual(yesterday["microcards_reviews"], 4)
        self.assertAlmostEqual(yesterday["microcards_correct_rate"], 0.5, places=3)
        self.assertEqual(yesterday["microcards_study_minutes"], 4)
        self.assertEqual(yesterday["combined_study_minutes"], 4)
        self.assertEqual(yesterday["source_breakdown"]["tasks"]["attempts"], 0)
        self.assertEqual(yesterday["source_breakdown"]["microcards"]["attempts"], 4)
        self.assertEqual(yesterday["activity_attempts_total"], 4)

        today = by_date.get(today_iso)
        self.assertIsNotNone(today)
        self.assertIn("source_breakdown", today)
        self.assertIn("microcards_reviews", today)
        self.assertEqual(today["source_breakdown"]["tasks"]["attempts"], today["total_attempts"])
        self.assertEqual(
            today["activity_attempts_total"],
            today["source_breakdown"]["tasks"]["attempts"] + today["source_breakdown"]["microcards"]["attempts"],
        )
    
    def test_get_time_dynamics_empty(self):
        """Тест динамики по времени при отсутствии данных"""
        # Создаём новый сервис без данных
        new_service = StatisticsService(
            progress_service=ProgressService(
                data_dir=self.test_dir,
                user_id="empty_user"
            )
        )
        
        dynamics = new_service.get_time_dynamics("empty_user", days=30)
        # With gap filling logic, we now expect 30 days of "0" stats even if empty
        self.assertEqual(len(dynamics), 30)
        for entry in dynamics:
            self.assertEqual(entry["attempts"], 0)
    
    def test_empty_statistics(self):
        """Тест статистики для пользователя без данных"""
        empty_service = StatisticsService(
            progress_service=ProgressService(
                data_dir=self.test_dir,
                user_id="empty_user"
            )
        )
        
        stats = empty_service.aggregate_statistics("empty_user")
        
        # Проверяем, что возвращается пустая статистика
        self.assertEqual(stats["total_tasks_attempted"], 0)
        self.assertEqual(stats["total_tasks_completed"], 0)
        self.assertEqual(stats["success_rate"], 0.0)
        self.assertEqual(stats["average_score"], 0.0)
        self.assertEqual(stats["total_time_spent"], 0)
        self.assertEqual(stats["by_task_type"], {})
    
    def test_aggregate_statistics_empty_history(self):
        """Тест агрегации при пустой истории"""
        # Создаём новый сервис для пользователя без данных
        empty_progress = ProgressService(
            data_dir=self.test_dir,
            user_id="empty_user"
        )
        empty_stats = StatisticsService(progress_service=empty_progress)
        
        stats = empty_stats.aggregate_statistics("empty_user")
        
        # Проверяем, что все метрики равны нулю
        self.assertEqual(stats["total_tasks_attempted"], 0)
        self.assertEqual(stats["total_tasks_completed"], 0)
        self.assertEqual(stats["success_rate"], 0.0)
        self.assertEqual(stats["average_score"], 0.0)
        self.assertEqual(stats["total_time_spent"], 0)
        
        # Проверяем структуру
        self.assertIsInstance(stats["by_task_type"], dict)
        self.assertIn("last_updated", stats)
    
    def test_get_weak_areas_threshold(self):
        """Тест получения слабых областей с разными порогами"""
        # Добавляем данные с разной успешностью
        # topic_01: 100% успешность (2 успешных из 2)
        # topic_02: 0% успешность (0 успешных из 2)
        # topic_03: 50% успешность (1 успешный из 2)
        
        # topic_03: 1 успешная, 1 неуспешная
        self.progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_03",
            task_id="task_007",
            difficulty=1,
            success=True,
            score=80.0,
            time_spent=60
        )
        self.progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_03",
            task_id="task_008",
            difficulty=1,
            success=False,
            score=40.0,
            time_spent=120
        )
        
        # Порог 0.70 - должны быть topic_02 и topic_03
        weak_areas_70 = self.statistics_service.get_weak_areas(
            user_id=self.user_id,
            threshold=0.70
        )
        self.assertGreaterEqual(len(weak_areas_70), 2)
        
        # Порог 0.50 - должна быть только topic_02
        weak_areas_50 = self.statistics_service.get_weak_areas(
            user_id=self.user_id,
            threshold=0.50
        )
        # topic_02 имеет 0% успешность
        topic_02_found = any(
            area["topic"] == "topic_02" for area in weak_areas_50
        )
        self.assertTrue(topic_02_found)
        
        # Порог 0.30 - не должно быть слабых областей (все >= 30%)
        weak_areas_30 = self.statistics_service.get_weak_areas(
            user_id=self.user_id,
            threshold=0.30
        )
        # topic_02 все еще слабая (0%)
        self.assertGreaterEqual(len(weak_areas_30), 1)
    
    def test_get_performance_by_type_all_types(self):
        """Тест производительности по всем типам заданий"""
        # Добавляем попытки для разных типов заданий
        # (В текущей реализации тип определяется как "unknown", но структура должна поддерживать разные типы)
        
        performance = self.statistics_service.get_performance_by_type(self.user_id)
        
        # Проверяем, что возвращается словарь
        self.assertIsInstance(performance, dict)
        
        # Проверяем структуру данных для каждого типа
        for task_type, data in performance.items():
            self.assertIn("attempts", data)
            self.assertIn("success_rate", data)
            self.assertIn("average_score", data)
            self.assertIsInstance(data["attempts"], int)
            self.assertIsInstance(data["success_rate"], (int, float))
            self.assertIsInstance(data["average_score"], (int, float))
    
    def test_cache_invalidation(self):
        """Тест инвалидации кэша при обновлении данных"""
        # Заполняем кэш
        stats1 = self.statistics_service.aggregate_statistics(self.user_id)
        
        # Проверяем, что кэш заполнен
        cache_keys = [k for k in self.statistics_service._cache if k.startswith(f"stats_{self.user_id}_")]
        self.assertGreater(len(cache_keys), 0)
        cache_key = cache_keys[0] # берем первый найденный ключ
        
        # Добавляем новую попытку
        self.progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_009",
            difficulty=1,
            success=True,
            score=95.0,
            time_spent=50
        )
        
        # Кэш должен остаться (не инвалидируется автоматически БЕЗ EventBus)
        # В этом тесте EventBus не подключен к StatisticsService
        self.assertIn(cache_key, self.statistics_service._cache)
        
        # Сохраняем timestamp до обновления
        first_cached_data, first_cached_timestamp = self.statistics_service._cache[cache_key]
        
        # Небольшая задержка для гарантии обновления timestamp
        import time
        time.sleep(0.01)
        
        # Но при force_refresh должен пересчитаться
        stats2 = self.statistics_service.aggregate_statistics(
            self.user_id,
            force_refresh=True
        )
        
        # Проверяем, что данные обновились
        self.assertGreater(stats2["total_tasks_attempted"], stats1["total_tasks_attempted"])
        
        # Проверяем, что кэш обновился (timestamp должен быть больше или равен)
        # Получаем актуальный ключ (может быть тот же)
        current_cache_keys = [k for k in self.statistics_service._cache if k.startswith(f"stats_{self.user_id}_")]
        self.assertGreater(len(current_cache_keys), 0)
        current_key = current_cache_keys[0]
        
        cached_data, cached_timestamp = self.statistics_service._cache[current_key]
        self.assertGreaterEqual(cached_timestamp, first_cached_timestamp)
        # Проверяем, что timestamp является числом
        self.assertIsInstance(cached_timestamp, (int, float))
    
    def test_statistics_consistency(self):
        """Тест консистентности статистики при множественных обновлениях"""
        # Выполняем множественные обновления
        for i in range(10):
            self.progress_service.save_detailed_attempt(
                module_id="module_01",
                topic_id="topic_01",
                task_id=f"task_{i:03d}",
                difficulty=1,
                success=(i % 2 == 0),  # Чередуем успешные и неуспешные
                score=50.0 + (i * 5),
                time_spent=60 + i
            )
        
        # Получаем статистику с force_refresh
        stats = self.statistics_service.aggregate_statistics(
            self.user_id,
            force_refresh=True
        )
        
        # Проверяем консистентность данных
        # total_tasks_attempted должно быть равно сумме всех попыток
        # (исходные 6 + новые 10 = 16)
        self.assertEqual(stats["total_tasks_attempted"], 16)
        
        # Проверяем, что success_rate вычислен правильно
        # Исходные: 4 успешных из 6
        # Новые: 5 успешных из 10 (четные индексы)
        # Всего: 9 успешных из 16 = 0.5625
        expected_success_rate = 9 / 16
        self.assertAlmostEqual(stats["success_rate"], expected_success_rate, places=2)
        
        # Проверяем, что average_score вычислен правильно
        self.assertGreater(stats["average_score"], 0.0)
        self.assertLessEqual(stats["average_score"], 100.0)
        
        # Проверяем, что при повторном запросе данные консистентны
        stats2 = self.statistics_service.aggregate_statistics(
            self.user_id,
            force_refresh=True
        )
        
        self.assertEqual(stats["total_tasks_attempted"], stats2["total_tasks_attempted"])
        self.assertAlmostEqual(stats["success_rate"], stats2["success_rate"], places=2)
        self.assertAlmostEqual(stats["average_score"], stats2["average_score"], places=1)


if __name__ == '__main__':
    unittest.main()

