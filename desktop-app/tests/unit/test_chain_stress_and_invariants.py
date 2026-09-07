import math
from collections import Counter
from datetime import datetime
from unittest.mock import MagicMock

import pytest

from api.complexes_api import validate_and_normalize_create_payload
from services.adaptive_session_manager import AdaptiveSessionManager
from task_system.core.models.complex_models import (
    ChainDefinition,
    Complex,
    ComplexSession,
    ComplexSettings,
    QueuedTask,
)


def _make_mock_manager():
    cs = MagicMock()
    upm = MagicMock()
    dm = MagicMock()
    dm.get_available_levels.return_value = [1, 2, 3]
    dm.get_smart_retry_config.return_value = {
        "near_offset": 2,
        "near_jitter_max": 0,
        "max_copies": 5,
        "training_control_enabled": True,
    }
    ss = MagicMock()
    sr = MagicMock()
    mgr = AdaptiveSessionManager(cs, upm, dm, ss, sr)
    mgr._check_task_file_exists = MagicMock(return_value=True)
    mgr._get_task_type = MagicMock(return_value="click")
    return mgr


# ═══════════════════════════════════════════════════════════════════
# 1. Инвариантные тесты (Property-based Tests)
# ═══════════════════════════════════════════════════════════════════


class TestChainInvariants:
    """Инвариантные проверки математической корректности порядка заданий."""

    def setup_method(self):
        self.mgr = _make_mock_manager()

    @pytest.mark.parametrize(
        "mode", ["never", "from_iteration_2", "only_iteration_3", "always", "custom"]
    )
    @pytest.mark.parametrize("iteration", [1, 2, 3, 4, 5])
    def test_invariant_conservation_multiset(self, mode, iteration):
        """Инвариант сохранности: элементы сцепки никогда не теряются и не дублируются."""
        chain_refs = ["mod/top/t1", "mod/top/t2", "mod/top/t3", "mod/top/t4"]
        tasks = [QueuedTask(task_ref=r, difficulty=1) for r in chain_refs]
        chain = ChainDefinition(
            tasks=chain_refs,
            shuffle_mode=mode,
            shuffle_iterations=[2, 4] if mode == "custom" else [],
        )

        chunks = self.mgr._group_tasks_into_chunks(
            tasks,
            [chain],
            iteration=iteration,
            seed_base=f"session_test_seed_{iteration}",
            allow_shuffle=True,
        )

        assert len(chunks) == 1
        chunk_refs = [t.task_ref for t in chunks[0]]
        # Мультимножества должны быть строго равны
        assert Counter(chunk_refs) == Counter(chain_refs)
        assert len(chunk_refs) == len(chain_refs)

    def test_invariant_contiguity_in_session_queue(self):
        """Инвариант неделимости: задания сцепки обязаны идти строго непрерывным блоком в очереди."""
        all_refs = [f"mod/top/t_{i}" for i in range(10)]
        chain_refs = ["mod/top/t_2", "mod/top/t_5", "mod/top/t_7"]
        chain = ChainDefinition(tasks=chain_refs, shuffle_mode="always")

        complex_obj = Complex(
            id="c_contiguity",
            name="Contiguity Complex",
            tasks=all_refs,
            chains=[chain],
            settings=ComplexSettings(adaptive_difficulty=True),
        )

        for seed_idx in range(25):
            session = ComplexSession(
                id=f"sess_contiguity_{seed_idx}",
                complex_id=complex_obj.id,
                user_id="u1",
            )
            # Формируем очередь через session manager
            self.mgr.complex_service.get_complex.return_value = complex_obj
            self.mgr._generate_initial_queue(session, complex_obj)

            queue_refs = [t.task_ref for t in session.queue]
            indices = [queue_refs.index(r) for r in chain_refs]
            # Разность между макс и мин индексом должна быть в точности len(chain) - 1
            assert max(indices) - min(indices) == len(chain_refs) - 1, (
                f"Сцепка {chain_refs} разорвана посторонними заданиями в очереди: {queue_refs}"
            )

    def test_invariant_seed_determinism_1000_runs(self):
        """Инвариант детерминированности: 1000 запусков с одинаковым seed дают один и тот же порядок."""
        tasks = [QueuedTask(task_ref=f"mod/top/t_{i}", difficulty=1) for i in range(8)]
        chain = ChainDefinition(
            tasks=[f"mod/top/t_{i}" for i in range(8)], shuffle_mode="always"
        )

        reference = [
            t.task_ref
            for t in self.mgr._group_tasks_into_chunks(
                tasks, [chain], iteration=2, seed_base="deterministic_fixed_seed"
            )[0]
        ]

        for _ in range(1000):
            run = [
                t.task_ref
                for t in self.mgr._group_tasks_into_chunks(
                    tasks, [chain], iteration=2, seed_base="deterministic_fixed_seed"
                )[0]
            ]
            assert run == reference

    def test_invariant_entropy_uniform_distribution(self):
        """Инвариант энтропии: случайное распределение перестановок не имеет перекоса (тест хи-квадрат)."""
        chain_refs = ["task_A", "task_B", "task_C", "task_D"]
        tasks = [QueuedTask(task_ref=r, difficulty=1) for r in chain_refs]
        chain = ChainDefinition(tasks=chain_refs, shuffle_mode="always")

        n_samples = 120
        first_elements = []
        for i in range(n_samples):
            chunk = self.mgr._group_tasks_into_chunks(
                tasks, [chain], iteration=1, seed_base=f"entropy_session_{i}"
            )[0]
            first_elements.append(chunk[0].task_ref)

        counts = Counter(first_elements)
        expected = n_samples / len(chain_refs)  # 30 для каждого
        # Хи-квадрат: sum((O - E)^2 / E)
        chi_sq = sum(((counts[r] - expected) ** 2) / expected for r in chain_refs)
        # Критическое значение хи-квадрат для 3 степеней свободы при p=0.01 равно 11.34
        assert chi_sq < 11.34, f"Перекос распределения случайности: chi_sq={chi_sq}, counts={counts}"


# ═══════════════════════════════════════════════════════════════════
# 2. Стресс-кейсы граничных условий
# ═══════════════════════════════════════════════════════════════════


class TestChainStressBoundaries:
    """Стресс-тестирование граничных и экстремальных ситуаций."""

    def setup_method(self):
        self.mgr = _make_mock_manager()

    def test_stress_extreme_length_chain(self):
        """Экстремально длинная сцепка (25 заданий): скорость, сохранение порядка и элементов."""
        refs = [f"mod/top/task_{i:02d}" for i in range(25)]
        tasks = [QueuedTask(task_ref=r, difficulty=1) for r in refs]
        chain = ChainDefinition(tasks=refs, shuffle_mode="always")

        t0 = datetime.utcnow()
        chunks = self.mgr._group_tasks_into_chunks(
            tasks, [chain], iteration=1, seed_base="extreme_chain_seed"
        )
        t_elapsed = (datetime.utcnow() - t0).total_seconds()

        assert t_elapsed < 0.05, f"Группировка выполнялась слишком долго: {t_elapsed}с"
        assert len(chunks) == 1
        assert len(chunks[0]) == 25
        assert Counter([t.task_ref for t in chunks[0]]) == Counter(refs)
        # За 25 элементов при 'always' порядок обязан поменяться
        assert [t.task_ref for t in chunks[0]] != refs

    def test_stress_multiple_independent_chains(self):
        """5 независимых сцепок с разными режимами перемешивания в одном комплексе."""
        chain1 = ChainDefinition(tasks=[f"a{i}" for i in range(5)], shuffle_mode="never")
        chain2 = ChainDefinition(tasks=[f"b{i}" for i in range(5)], shuffle_mode="from_iteration_2")
        chain3 = ChainDefinition(tasks=[f"c{i}" for i in range(5)], shuffle_mode="only_iteration_3")
        chain4 = ChainDefinition(tasks=[f"d{i}" for i in range(5)], shuffle_mode="always")
        chain5 = ChainDefinition(
            tasks=[f"e{i}" for i in range(5)], shuffle_mode="custom", shuffle_iterations=[1, 3]
        )

        all_chains = [chain1, chain2, chain3, chain4, chain5]
        all_refs = [r for c in all_chains for r in c.tasks]
        tasks = [QueuedTask(task_ref=r, difficulty=1) for r in all_refs]

        # Итерация 1
        chunks_it1 = self.mgr._group_tasks_into_chunks(
            tasks, all_chains, iteration=1, seed_base="multi_seed_alpha"
        )
        assert [t.task_ref for t in chunks_it1[0]] == chain1.tasks  # never
        assert [t.task_ref for t in chunks_it1[1]] == chain2.tasks  # from_iteration_2 not active on 1
        assert [t.task_ref for t in chunks_it1[2]] == chain3.tasks  # only_iteration_3 not active on 1
        assert [t.task_ref for t in chunks_it1[3]] != chain4.tasks  # always active
        assert [t.task_ref for t in chunks_it1[4]] != chain5.tasks  # custom (1 in [1, 3]) active

        # Итерация 2
        chunks_it2 = self.mgr._group_tasks_into_chunks(
            tasks, all_chains, iteration=2, seed_base="multi_seed_beta"
        )
        assert [t.task_ref for t in chunks_it2[0]] == chain1.tasks  # never
        assert [t.task_ref for t in chunks_it2[1]] != chain2.tasks  # from_iteration_2 active on 2
        assert [t.task_ref for t in chunks_it2[2]] == chain3.tasks  # only_iteration_3 not active on 2
        assert [t.task_ref for t in chunks_it2[3]] != chain4.tasks  # always active
        assert [t.task_ref for t in chunks_it2[4]] == chain5.tasks  # custom (2 not in [1, 3]) inactive

        # Итерация 3
        chunks_it3 = self.mgr._group_tasks_into_chunks(
            tasks, all_chains, iteration=3, seed_base="multi_seed_gamma"
        )
        assert [t.task_ref for t in chunks_it3[0]] == chain1.tasks  # never
        assert [t.task_ref for t in chunks_it3[1]] != chain2.tasks  # from_iteration_2 active on 3
        assert [t.task_ref for t in chunks_it3[2]] != chain3.tasks  # only_iteration_3 active on 3
        assert [t.task_ref for t in chunks_it3[3]] != chain4.tasks  # always active
        assert [t.task_ref for t in chunks_it3[4]] != chain5.tasks  # custom (3 in [1, 3]) active

        # Все чанки сохраняют мультимножества
        for idx, ch in enumerate(all_chains):
            assert Counter([t.task_ref for t in chunks_it1[idx]]) == Counter(ch.tasks)
            assert Counter([t.task_ref for t in chunks_it2[idx]]) == Counter(ch.tasks)
            assert Counter([t.task_ref for t in chunks_it3[idx]]) == Counter(ch.tasks)

    def test_stress_scattered_test_question_slots_atomic_movement(self):
        """Вопросы scattered-теста не разрываются другими заданиями сцепки при перемешивании."""
        tasks = [
            QueuedTask(task_ref="open_ans", difficulty=1),
            QueuedTask(task_ref="test_exam", difficulty=1, test_question_index=0),
            QueuedTask(task_ref="test_exam", difficulty=1, test_question_index=1),
            QueuedTask(task_ref="test_exam", difficulty=1, test_question_index=2),
            QueuedTask(task_ref="test_exam", difficulty=1, test_question_index=3),
            QueuedTask(task_ref="click_task", difficulty=1),
        ]
        chain = ChainDefinition(
            tasks=["open_ans", "test_exam", "click_task"], shuffle_mode="always"
        )

        for seed in ["test_seed_a", "test_seed_b", "test_seed_c", "test_seed_d"]:
            chunk = self.mgr._group_tasks_into_chunks(
                tasks, [chain], iteration=1, seed_base=seed
            )[0]
            indices = [idx for idx, t in enumerate(chunk) if t.task_ref == "test_exam"]
            assert indices == list(range(indices[0], indices[0] + 4)), (
                f"Слоты теста разорваны: {indices}"
            )

    def test_stress_smart_retry_isolation_on_failure(self):
        """Совершение ошибки внутри сцепки: Smart Retry вставляет ретрай на +2, сцепка не захватывает его."""
        chain = ChainDefinition(tasks=["task_A", "task_B", "task_C"], shuffle_mode="never")
        complex_obj = Complex(
            id="c_retry",
            name="Retry Complex",
            tasks=["task_A", "task_B", "task_C", "task_D", "task_E"],
            chains=[chain],
            settings=ComplexSettings(
                adaptive_difficulty=True,
                smart_retry_near_offset=2,
                smart_retry_near_jitter_max=0,
            ),
        )

        session = ComplexSession(
            id="s_retry_test",
            complex_id="c_retry",
            user_id="u1",
            queue=[
                QueuedTask(task_ref="task_A", difficulty=1, is_retry=False),
                QueuedTask(task_ref="task_B", difficulty=1, is_retry=False),
                QueuedTask(task_ref="task_C", difficulty=1, is_retry=False),
                QueuedTask(task_ref="task_D", difficulty=1, is_retry=False),
                QueuedTask(task_ref="task_E", difficulty=1, is_retry=False),
            ],
            iteration=1,
            current_task_index=0,
        )

        self.mgr.complex_service.get_complex.return_value = complex_obj
        self.mgr._active_sessions[session.id] = session

        # Ученик берет первое задание сцепки (task_A)
        first_task = self.mgr.get_next_task(session.id)
        assert first_task["task_ref"] == "task_A"
        assert session.current_task_index == 1

        # Ученик ошибается на первом задании сцепки (task_A)
        result = self.mgr.submit_result(
            session.id,
            {"task_ref": "task_A", "success": False, "time_spent": 15, "difficulty": 1},
        )
        assert result.success is False

        # В очереди появились ретраи task_A
        retry_copies = [t for t in session.queue if t.task_ref == "task_A" and t.is_retry]
        assert len(retry_copies) >= 1

        # Оставшиеся задания сцепки task_B и task_C остаются неразрывными и упорядоченными
        pos_b = [i for i, t in enumerate(session.queue) if t.task_ref == "task_B" and not t.is_retry][0]
        pos_c = [i for i, t in enumerate(session.queue) if t.task_ref == "task_C" and not t.is_retry][0]
        assert pos_c == pos_b + 1, "Задания сцепки task_B и task_C разорваны в очереди после ребалансировки"

        # Smart Retry Guard: ни один ретрай не должен быть включен в сцепку
        chunks = self.mgr._group_tasks_into_chunks(session.queue, [chain])
        retry_chunks = [c for c in chunks if any(x.is_retry for x in c)]
        assert all(len(c) == 1 for c in retry_chunks), "Ретрай попал внутрь составного чанка сцепки"

    def test_stress_partial_chain_degradation_on_next_iteration(self):
        """Если часть заданий сцепки освоена на уровне 3, на следующей итерации сцепка не падает."""
        # Сцепка из 3 заданий. На 2-й итерации осталось только 1 задание (task_C)
        chain = ChainDefinition(tasks=["task_A", "task_B", "task_C"], shuffle_mode="always")
        tasks_iter2 = [QueuedTask(task_ref="task_C", difficulty=2)]

        # Проверяем, что чанк из 1 элемента возвращается без исключений
        chunks = self.mgr._group_tasks_into_chunks(
            tasks_iter2, [chain], iteration=2, seed_base="degradation_seed"
        )
        assert len(chunks) == 1
        assert len(chunks[0]) == 1
        assert chunks[0][0].task_ref == "task_C"


# ═══════════════════════════════════════════════════════════════════
# 3. Фаззинг API и защита от битых данных
# ═══════════════════════════════════════════════════════════════════


class TestChainApiFuzzing:
    """Фаззинг валидации структуры сцепок в API."""

    def test_fuzzing_rejects_non_array_chains(self):
        payload = {
            "name": "Fuzz 1",
            "tasks": ["m/t/1", "m/t/2"],
            "chains": "this_is_not_an_array",
        }
        norm, errs = validate_and_normalize_create_payload(payload)
        assert norm is None
        assert any(e["reason"] == "chains_must_be_array" for e in errs)

    def test_fuzzing_rejects_bad_chain_elements(self):
        payload = {
            "name": "Fuzz 2",
            "tasks": ["m/t/1", "m/t/2"],
            "chains": [12345, None, "string_instead_of_array_or_object"],
        }
        norm, errs = validate_and_normalize_create_payload(payload)
        assert norm is None
        reasons = [e["reason"] for e in errs]
        assert "chain_must_be_array_or_object" in reasons

    def test_fuzzing_rejects_empty_tasks_in_dict_chain(self):
        payload = {
            "name": "Fuzz 3",
            "tasks": ["m/t/1", "m/t/2"],
            "chains": [{"tasks": [], "shuffle_mode": "always"}],
        }
        norm, errs = validate_and_normalize_create_payload(payload)
        assert norm is None
        assert any(e["reason"] == "chain_tasks_must_be_non_empty_array" for e in errs)

    def test_fuzzing_rejects_non_string_shuffle_mode(self):
        payload = {
            "name": "Fuzz 4",
            "tasks": ["m/t/1", "m/t/2"],
            "chains": [{"tasks": ["m/t/1", "m/t/2"], "shuffle_mode": {"bad": "type"}}],
        }
        norm, errs = validate_and_normalize_create_payload(payload)
        assert norm is None
        assert any(e["reason"] == "shuffle_mode_must_be_string" for e in errs)

    def test_fuzzing_rejects_invalid_shuffle_mode_name(self):
        payload = {
            "name": "Fuzz 5",
            "tasks": ["m/t/1", "m/t/2"],
            "chains": [{"tasks": ["m/t/1", "m/t/2"], "shuffle_mode": "completely_bogus_mode"}],
        }
        norm, errs = validate_and_normalize_create_payload(payload)
        assert norm is None
        assert any(e["reason"] == "invalid_chain_shuffle_mode" for e in errs)

    def test_fuzzing_rejects_custom_iterations_negative_and_out_of_bounds(self):
        payload = {
            "name": "Fuzz 6",
            "tasks": ["m/t/1", "m/t/2"],
            "settings": {"max_iterations": 3},
            "chains": [
                {
                    "tasks": ["m/t/1", "m/t/2"],
                    "shuffle_mode": "custom",
                    "shuffle_iterations": [-5, 0, 999, "not_int"],
                }
            ],
        }
        norm, errs = validate_and_normalize_create_payload(payload)
        assert norm is None
        reasons = {e["reason"] for e in errs}
        assert "iteration_must_be_positive" in reasons
        assert "iteration_exceeds_max_iterations" in reasons
        assert "iteration_must_be_integer" in reasons
