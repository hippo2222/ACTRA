import pytest
from typing import List
from task_system.core.models.complex_models import QueuedTask
import sys
import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from services.adaptive_session_manager import AdaptiveSessionManager

class DummyAdaptiveSessionManager:
    def _get_task_type(self, task_ref: str) -> str:
        # Упрощенная логика: "m/t/test_1" -> "test"
        return task_ref.split("/")[-1].split("_")[0]

    def _chunk_variety_key(self, chunk: List[QueuedTask]) -> str:
        return AdaptiveSessionManager._chunk_variety_key(self, chunk)

    def _break_monotony_runs(self, chunks: List[List[QueuedTask]], max_run: int) -> List[List[QueuedTask]]:
        return AdaptiveSessionManager._break_monotony_runs(self, chunks, max_run)

def test_chunk_variety_key():
    mgr = DummyAdaptiveSessionManager()
    
    # 1. Одиночное задание
    chunk1 = [QueuedTask(task_ref="m/t/test_1", difficulty=1)]
    assert mgr._chunk_variety_key(chunk1) == "test"
    
    # 2. Связка (chain)
    chunk2 = [
        QueuedTask(task_ref="m/t/test_1", difficulty=1),
        QueuedTask(task_ref="m/t/click_1", difficulty=1)
    ]
    assert mgr._chunk_variety_key(chunk2) == "chain"
    
    # 3. Scattered вопрос
    chunk3 = [QueuedTask(task_ref="m/t/test_1", difficulty=1, display_mode="scattered", test_question_index=0)]
    assert mgr._chunk_variety_key(chunk3) == "scattered_q"

def test_break_monotony_runs():
    mgr = DummyAdaptiveSessionManager()
    
    # Функция хелпер для создания чанков
    def make_chunk(ref: str, mode: str = "together") -> List[QueuedTask]:
        return [QueuedTask(task_ref=ref, difficulty=1, display_mode=mode)]
        
    def make_chain(ref1: str, ref2: str) -> List[QueuedTask]:
        return [
            QueuedTask(task_ref=ref1, difficulty=1),
            QueuedTask(task_ref=ref2, difficulty=1)
        ]

    # Создаем тестовую очередь: 5 тестов, 2 клика.
    # Чтобы разбить 5 тестов на блоки по 2, нужно 2 "перебивки".
    chunks = [
        make_chunk("m/t/test_1"),
        make_chunk("m/t/test_2"),
        make_chunk("m/t/test_3"),
        make_chunk("m/t/test_4"),
        make_chunk("m/t/click_1"),
        make_chunk("m/t/click_2"),
        make_chunk("m/t/test_5"),
    ]
    
    # max_run = 2
    # Теперь перебивок достаточно, длинных серий быть не должно.
    result = mgr._break_monotony_runs(chunks, max_run=2)
    
    # Проверяем ключи результата
    keys = [mgr._chunk_variety_key(c) for c in result]
    
    # Не должно быть >2 одинаковых ключей подряд
    count = 0
    last_key = None
    for k in keys:
        if k == last_key:
            count += 1
            assert count <= 2, f"Found run of >2 for key {k}"
        else:
            last_key = k
            count = 1
            
    assert len(result) == len(chunks)

def test_break_monotony_runs_no_options():
    mgr = DummyAdaptiveSessionManager()
    
    def make_chunk(ref: str) -> List[QueuedTask]:
        return [QueuedTask(task_ref=ref, difficulty=1)]

    # Только один тип, перебивать нечем
    chunks = [make_chunk("m/t/test_1") for _ in range(5)]
    
    result = mgr._break_monotony_runs(chunks, max_run=2)
    
    keys = [mgr._chunk_variety_key(c) for c in result]
    assert keys == ["test"] * 5
    assert len(result) == 5

def test_break_monotony_runs_with_chains_and_scattered():
    mgr = DummyAdaptiveSessionManager()
    
    def make_chunk(ref: str, mode: str = "together") -> List[QueuedTask]:
        return [QueuedTask(task_ref=ref, difficulty=1, display_mode=mode)]
        
    def make_chain(ref1: str, ref2: str) -> List[QueuedTask]:
        return [
            QueuedTask(task_ref=ref1, difficulty=1),
            QueuedTask(task_ref=ref2, difficulty=1)
        ]

    chunks = [
        make_chunk("m/t/test_1", "scattered"),
        make_chunk("m/t/test_1", "scattered"),
        make_chunk("m/t/test_1", "scattered"),
        make_chunk("m/t/test_1", "scattered"),
        make_chain("m/t/test_2", "m/t/click_1"),
        make_chunk("m/t/click_2"),
    ]
    
    # max_run = 2. У нас 4 scattered_q, 1 chain, 1 click
    # Ожидаемый порядок ключей не должен содержать >2 scattered_q подряд
    result = mgr._break_monotony_runs(chunks, max_run=2)
    keys = [mgr._chunk_variety_key(c) for c in result]
    
    count = 0
    last_key = None
    for k in keys:
        if k == last_key:
            count += 1
            assert count <= 2, f"Found run of >2 for key {k}: {keys}"
        else:
            last_key = k
            count = 1
            
    assert len(result) == len(chunks)
