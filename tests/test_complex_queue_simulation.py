"""Simulation tests for complex queue dynamics within a single iteration.

Uses real exported data from export_complexes_20260512_204510.
Focus: how the queue changes as questions are answered, especially for
scattered test tasks. Includes a critical bug-detection test (C1).
"""
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from unittest.mock import MagicMock

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
EXPORT_DIR = ROOT_DIR / "export_complexes_20260512_204510"

for _p in [str(DESKTOP_APP_DIR), str(ROOT_DIR)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

from services.adaptive_session_manager import AdaptiveSessionManager  # noqa: E402
from services.complex_service import ComplexService  # noqa: E402
from services.difficulty_manager import DifficultyManager  # noqa: E402
from services.session_repository import SessionRepository  # noqa: E402
from services.storage_service import StorageService  # noqa: E402
from services.user_progress_manager import UserProgressManager  # noqa: E402
from task_system.core.models.complex_models import (  # noqa: E402
    Complex,
    ComplexSession,
    QueuedTask,
    SessionTaskResult,
)

pytestmark = pytest.mark.skipif(
    not EXPORT_DIR.exists(),
    reason="Export directory not found; run from project root",
)

# ── Constants ─────────────────────────────────────────────────────────────────
COMPLEX_ID = "d91ad43f-98be-4a7d-8e16-e43cfbf371c0"
USER_ID = "sim_user_01"
MODULE = "learning_radiology_glava_1"
TOPIC = "tema_1_tekhnicheski_pravilnyj_rentgen_ogk"
IMG11_REF = f"{MODULE}/{TOPIC}/img_11"
CLICK_REF = f"{MODULE}/{TOPIC}/task_53cfc607"


# ── Queue-inspection helpers ──────────────────────────────────────────────────

def queue_snapshot(session: ComplexSession) -> List[Tuple]:
    return [
        (t.task_ref, getattr(t, "test_question_index", None), t.is_retry, t.difficulty)
        for t in session.queue[session.current_task_index:]
    ]


def count_retry_slots(session: ComplexSession, task_ref: str) -> int:
    in_q = sum(1 for t in session.queue if t.task_ref == task_ref and t.is_retry)
    in_d = sum(
        1
        for t in (getattr(session, "deferred_retry_tasks", None) or [])
        if t.task_ref == task_ref and t.is_retry
    )
    return in_q + in_d


def pending_retry_slots(session: ComplexSession, task_ref: str) -> List[QueuedTask]:
    return [
        t for t in session.queue[session.current_task_index:]
        if t.task_ref == task_ref and t.is_retry
    ]


def assert_no_plain_duplicates(session: ComplexSession) -> None:
    seen: set = set()
    for t in session.queue:
        if t.is_retry:
            continue
        key = (t.task_ref, getattr(t, "test_question_index", None))
        assert key not in seen, f"Duplicate non-retry slot: {key}"
        seen.add(key)


# ── Submission helpers ────────────────────────────────────────────────────────

def _scattered_rd(task_ref, q_idx, success, difficulty, iteration):
    return {
        "task_ref": task_ref, "success": success, "time_spent": 1,
        "difficulty": difficulty, "score": 1.0 if success else 0.0,
        "details": {
            "task_type": "test", "test_display_mode": "scattered",
            # session_api.py sends shown_question_indices for every scattered
            # submit — required for the scattered guard in _process_test_partial_retry.
            "shown_question_indices": [q_idx],
            "failed_subtests": [] if success else [{"index": q_idx}],
        },
        "expected_iteration": iteration,
    }


def _together_rd(task_ref, failed_indices, difficulty, iteration):
    return {
        "task_ref": task_ref, "success": not failed_indices,
        "time_spent": 1, "difficulty": difficulty, "score": 1.0 if not failed_indices else 0.5,
        "details": {
            "task_type": "test", "test_display_mode": "together",
            "failed_subtests": [{"index": i} for i in failed_indices],
        },
        "expected_iteration": iteration,
    }


def _click_rd(task_ref, success, difficulty, iteration):
    return {
        "task_ref": task_ref, "success": success, "time_spent": 1,
        "difficulty": difficulty, "score": 1.0 if success else 0.0,
        "details": {"task_type": "click"},
        "expected_iteration": iteration,
    }


def submit_scattered_q(mgr, sid, session, task_ref, q_idx, success, difficulty=1):
    return mgr.submit_result(sid, _scattered_rd(task_ref, q_idx, success, difficulty, session.iteration))


def submit_together_test(mgr, sid, session, task_ref, failed_indices, difficulty=1):
    return mgr.submit_result(sid, _together_rd(task_ref, failed_indices, difficulty, session.iteration))


def advance_to(mgr, sid, session, *, stop_ref, stop_q=None, max_steps=400) -> Optional[Dict]:
    """Drain queue until we serve (stop_ref, stop_q) slot. Returns that slot's info."""
    for _ in range(max_steps):
        info = mgr.get_next_task(sid)
        if info is None:
            return None
        tr, qi = info.get("task_ref"), info.get("test_question_index")
        if tr == stop_ref and (stop_q is None or qi == stop_q):
            return info
        # answer correctly to consume
        it = info.get("iteration", session.iteration)
        if info.get("display_mode") == "scattered":
            mgr.submit_result(sid, _scattered_rd(tr, qi or 0, True, info["difficulty"], it))
        else:
            mgr.submit_result(sid, _click_rd(tr, True, info["difficulty"], it))
    return None


# ── Fixture wiring ────────────────────────────────────────────────────────────

def _load_real_complex() -> Complex:
    path = EXPORT_DIR / "complexes" / f"{COMPLEX_ID}.json"
    with open(path, encoding="utf-8") as f:
        return Complex(**json.load(f))


def _make_mock_storage() -> MagicMock:
    modules_dir = EXPORT_DIR / "modules"

    def _load_task(module_id, topic_id, task_id):
        p = modules_dir / module_id / "topics" / topic_id / "tasks" / task_id / "task.json"
        if p.exists():
            with open(p, encoding="utf-8") as f:
                return {"task_data": json.load(f)}
        raise FileNotFoundError(str(p))

    mock = MagicMock(spec=StorageService)
    mock.load_task.side_effect = _load_task
    return mock


def _build_manager(complex_obj: Optional[Complex] = None) -> Tuple[AdaptiveSessionManager, Complex]:
    if complex_obj is None:
        complex_obj = _load_real_complex()
    mock_cs = MagicMock(spec=ComplexService)
    mock_cs.get_complex.return_value = complex_obj
    mock_ss = _make_mock_storage()
    dm = DifficultyManager(storage_service=mock_ss)
    mock_sr = MagicMock(spec=SessionRepository)
    mock_sr.save_session.return_value = None
    mock_upm = MagicMock(spec=UserProgressManager)
    mock_upm.user_id = USER_ID
    mock_upm.save_attempt.return_value = None
    mock_upm.data_dir = "."

    mgr = AdaptiveSessionManager(
        complex_service=mock_cs, user_progress_manager=mock_upm,
        difficulty_manager=dm, storage_service=mock_ss, session_repository=mock_sr,
    )
    modules_dir = EXPORT_DIR / "modules"

    def _check(task_ref: str) -> bool:
        parts = task_ref.split("/")
        if len(parts) < 3:
            return False
        return (modules_dir / parts[0] / "topics" / parts[1] / "tasks" / parts[-1] / "task.json").exists()

    mgr._check_task_file_exists = _check
    return mgr, complex_obj


@pytest.fixture
def sim():
    mgr, complex_obj = _build_manager()
    session = mgr.start_session(COMPLEX_ID, USER_ID)
    return mgr, session, session.id, complex_obj


# ── Group A: Initial queue ────────────────────────────────────────────────────

class TestA_InitialQueue:

    def test_A1_all_tasks_present_no_plain_duplicates(self, sim):
        mgr, session, sid, complex_obj = sim
        snap = queue_snapshot(session)
        present = {ref for ref, _, _, _ in snap}
        for ref in complex_obj.tasks:
            if ref not in session.broken_tasks:
                assert ref in present, f"Missing: {ref}"
        assert_no_plain_duplicates(session)
        assert all(not ir for _, _, ir, _ in snap), "is_retry=True in initial queue"

    def test_A2_img11_expands_to_correct_scattered_slots(self, sim):
        """img_11 has 21 questions → should produce 21 scattered slots in iteration 1."""
        mgr, session, sid, _ = sim
        slots = [t for t in session.queue if t.task_ref == IMG11_REF]
        # Real task has 21 questions (verified from task.json)
        IMG11_QUESTION_COUNT = 21
        assert len(slots) == IMG11_QUESTION_COUNT, f"Expected {IMG11_QUESTION_COUNT}, got {len(slots)}"
        assert sorted(t.test_question_index for t in slots) == list(range(IMG11_QUESTION_COUNT))
        assert all(t.display_mode == "scattered" for t in slots)

    def test_A3_all_slots_start_at_difficulty_1(self, sim):
        mgr, session, sid, _ = sim
        for t in session.queue:
            assert t.difficulty == 1


# ── Group B: Scattered retry happy path ──────────────────────────────────────

class TestB_ScatteredRetryDynamics:

    def test_B1_wrong_answer_inserts_near_retry_and_deferred(self, sim):
        mgr, session, sid, _ = sim
        info = advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=3)
        assert info is not None, "Could not reach img_11 q=3"
        submit_scattered_q(mgr, sid, session, IMG11_REF, 3, success=False)

        snap = queue_snapshot(session)
        near_pos = next((i for i, (r, q, ir, _) in enumerate(snap) if r == IMG11_REF and q == 3 and ir), None)
        assert near_pos is not None, "No near retry slot for q=3 found in queue"
        # Note: exact position depends on jitter+rebalance; position threshold tested by F1.

        tfs = (getattr(session, "test_failed_subtests", {}) or {})
        assert 3 in (tfs.get(IMG11_REF) or []), f"test_failed_subtests missing 3: {tfs}"

        deferred = [t for t in (getattr(session, "deferred_retry_tasks", []) or [])
                    if t.task_ref == IMG11_REF and getattr(t, "test_question_index", None) == 3]
        assert len(deferred) >= 1, "No deferred control copy for q=3"

    def test_B2_near_retry_correct_clears_key_no_new_retries(self, sim):
        mgr, session, sid, _ = sim
        advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=3)
        submit_scattered_q(mgr, sid, session, IMG11_REF, 3, success=False)

        retry_info = advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=3)
        assert retry_info is not None and retry_info.get("is_retry")
        pending_before = len(pending_retry_slots(session, IMG11_REF))
        submit_scattered_q(mgr, sid, session, IMG11_REF, 3, success=True)
        pending_after = len(pending_retry_slots(session, IMG11_REF))
        assert pending_after <= pending_before, "Unexpected new retry after correct answer"

    def test_B3_near_retry_wrong_again_adds_second_retry(self, sim):
        mgr, session, sid, _ = sim
        advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=3)
        submit_scattered_q(mgr, sid, session, IMG11_REF, 3, success=False)

        retry_info = advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=3)
        assert retry_info is not None
        copies_before = count_retry_slots(session, IMG11_REF)
        submit_scattered_q(mgr, sid, session, IMG11_REF, 3, success=False)
        copies_after = count_retry_slots(session, IMG11_REF)
        assert copies_after > copies_before, "Expected additional retry slot after second fail"
        assert copies_after <= 5, f"Exceeded max_copies=5: {copies_after}"

    def test_B4_two_wrong_questions_share_budget_no_duplicates(self, sim):
        mgr, session, sid, _ = sim
        advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=3)
        submit_scattered_q(mgr, sid, session, IMG11_REF, 3, success=False)

        info7 = advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=7)
        assert info7 is not None
        submit_scattered_q(mgr, sid, session, IMG11_REF, 7, success=False)

        total = count_retry_slots(session, IMG11_REF)
        assert total <= 5, f"Budget exceeded: {total}"
        pending_q_indices = {t.test_question_index for t in pending_retry_slots(session, IMG11_REF)}
        assert 7 in pending_q_indices, f"No pending retry for q=7: {pending_q_indices}"


# ── Group C: State contamination (bug detection) ──────────────────────────────

class TestC_StateContamination:

    def test_C1_correct_q6_must_not_erase_failed_q5_tracking(self, sim):
        """
        _process_test_partial_retry is called for every scattered question.
        When Q6 is submitted correctly while test_failed_subtests[img11]=[5],
        the scattered guard must detect that Q6 (shown_question_indices=[6])
        is NOT in known_failed=[5] and skip the partial-retry path —
        leaving the key for Q5 intact.

        We call submit_result for Q6 directly (without advance_to) to avoid
        consuming the near-retry slot for Q5 which would legitimately delete
        the key through the normal partial-retry path.
        """
        mgr, session, sid, _ = sim
        info5 = advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=5)
        assert info5 is not None, "Could not reach img_11 q=5"
        submit_scattered_q(mgr, sid, session, IMG11_REF, 5, success=False)

        tfs_after_q5 = dict(getattr(session, "test_failed_subtests", {}) or {})
        assert 5 in (tfs_after_q5.get(IMG11_REF) or []), \
            f"Precondition: q5 should be in test_failed_subtests. Got: {tfs_after_q5}"

        # Submit Q6 DIRECTLY — bypassing advance_to so we do NOT consume the
        # near-retry slot for Q5 (which would legitimately clear the key).
        # The scatter guard should detect shown=[6] ∩ known_failed={5} = ∅
        # and leave test_failed_subtests untouched.
        submit_scattered_q(mgr, sid, session, IMG11_REF, 6, success=True)

        tfs_after_q6 = dict(getattr(session, "test_failed_subtests", {}) or {})
        assert IMG11_REF in tfs_after_q6, (
            f"SCATTER GUARD FAILED: test_failed_subtests key deleted after Q6 correct!\n"
            f"Before Q6: {tfs_after_q5}\nAfter Q6: {tfs_after_q6}"
        )
        assert 5 in tfs_after_q6.get(IMG11_REF, []), (
            f"SCATTER GUARD FAILED: index 5 removed from test_failed_subtests after Q6 correct.\n"
            f"State: {tfs_after_q6}"
        )

    def test_C2_retry_q5_wrong_not_falsely_success_after_key_deletion(self, sim):
        """
        Cascading verification of C1 fix: after the fix, the key for Q5 is NOT
        deleted when Q6 is submitted correctly (scatter guard prevents it).
        Therefore when we submit Q5 wrong again (simulating the retry slot),
        the partial-retry path correctly fires (shown=[5] ∩ known_failed={5} = {5})
        and must return success=False because Q5 is still wrong.

        Previously: key deleted → retry treated as first attempt → wrong answer
        returned result.success (which was False for the submit, but the key was
        gone so no partial-retry narrowing occurred).
        """
        mgr, session, sid, _ = sim
        advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=5)
        submit_scattered_q(mgr, sid, session, IMG11_REF, 5, success=False)

        # C1 precondition: key must survive Q6 correct (scatter guard)
        tfs_before = dict(getattr(session, "test_failed_subtests", {}) or {})
        assert 5 in (tfs_before.get(IMG11_REF) or []), \
            f"Precondition failed: Q5 not tracked. Got: {tfs_before}"
        submit_scattered_q(mgr, sid, session, IMG11_REF, 6, success=True)  # direct, no advance
        tfs_after_q6 = dict(getattr(session, "test_failed_subtests", {}) or {})
        assert 5 in (tfs_after_q6.get(IMG11_REF) or []), \
            f"C1 precondition still failing: key deleted by Q6. Got: {tfs_after_q6}"

        # Now submit Q5 wrong again — simulates the near-retry slot being answered wrong
        result = submit_scattered_q(mgr, sid, session, IMG11_REF, 5, success=False)
        assert not result.success, (
            f"SCATTER GUARD REGRESSION: Q5 retry returned success=True despite wrong answer! "
            f"(partial-retry path should have fired: still_wrong=[5])"
        )

    def test_C3_log_state_machine_for_three_wrong_questions(self, sim):
        """
        Observability test: walk through img_11, answer q=1,4,9 wrong.
        Log test_failed_subtests after each wrong answer.
        Verify retry slots were generated for those questions.
        """
        mgr, session, sid, _ = sim
        wrong = {1, 4, 9}
        submitted_wrong: set = set()
        states: List[dict] = []

        for _ in range(300):
            info = advance_to(mgr, sid, session, stop_ref=IMG11_REF, max_steps=50)
            if info is None:
                break
            q_idx = info.get("test_question_index")
            if q_idx is None:
                break
            is_retry = info.get("is_retry", False)
            if not is_retry and q_idx in wrong:
                submit_scattered_q(mgr, sid, session, IMG11_REF, q_idx, success=False)
                submitted_wrong.add(q_idx)
                states.append(dict(getattr(session, "test_failed_subtests", {}) or {}))
            else:
                submit_scattered_q(mgr, sid, session, IMG11_REF, q_idx, success=True)
            if submitted_wrong == wrong:
                break

        assert submitted_wrong == wrong, f"Could not submit all wrong answers; got {submitted_wrong}"
        total_retries = count_retry_slots(session, IMG11_REF)
        assert total_retries >= 1, "Expected at least some retry slots after 3 wrong answers"
        assert total_retries <= 5, f"Exceeded max_copies=5: {total_retries}"

    def test_C4_two_failures_one_retry_correct_keeps_other_tracked(self, sim):
        """Two scattered questions fail (Q5 and Q7), then the Q5 retry is answered
        correctly. The partial-retry path must remove ONLY the covered-and-correct
        question (Q5) from test_failed_subtests and KEEP the sibling failure (Q7).
        Before the hardening, a single-question scattered submit replaced the whole
        key, silently dropping Q7. C1–C3 only ever track one failed question on the
        partial-retry path, so this multi-failure case was an uncovered gap."""
        mgr, session, sid, _ = sim
        advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=5)
        submit_scattered_q(mgr, sid, session, IMG11_REF, 5, success=False)
        submit_scattered_q(mgr, sid, session, IMG11_REF, 7, success=False)

        tfs = set((getattr(session, "test_failed_subtests", {}) or {}).get(IMG11_REF, []))
        assert {5, 7} <= tfs, f"Precondition: both Q5 and Q7 tracked. Got: {tfs}"

        # Answer the Q5 retry correctly (direct submit simulating its retry slot).
        submit_scattered_q(mgr, sid, session, IMG11_REF, 5, success=True)

        tfs_after = set((getattr(session, "test_failed_subtests", {}) or {}).get(IMG11_REF, []))
        assert 7 in tfs_after, (
            "Sibling failure Q7 was dropped from test_failed_subtests after the Q5 "
            f"retry was answered correctly. Got: {tfs_after}"
        )
        assert 5 not in tfs_after, (
            f"Resolved question Q5 must be removed from tracking. Got: {tfs_after}"
        )
        # Defense-in-depth: Q7 also remains a pending/deferred retry slot.
        q7_pending = any(
            getattr(t, "test_question_index", None) == 7 and t.is_retry
            for t in list(session.queue[session.current_task_index:])
            + (getattr(session, "deferred_retry_tasks", None) or [])
        )
        assert q7_pending, "Q7 retry slot must remain pending"


# ── Group D: Together-mode test ───────────────────────────────────────────────

class TestD_TogetherMode:
    """img_11 with scattered mode REMOVED → behaves as a together-mode test."""

    @pytest.fixture
    def together_sim(self):
        real = _load_real_complex()
        sd = real.settings.dict()
        tqdm = dict(sd.get("test_question_display_modes", {}))
        tqdm.pop(IMG11_REF, None)
        from task_system.core.models.complex_models import ComplexSettings
        ns = ComplexSettings(**{**sd, "test_question_display_modes": tqdm})
        modified = real.copy(update={"settings": ns})
        mgr, _ = _build_manager(complex_obj=modified)
        session = mgr.start_session(COMPLEX_ID, USER_ID)
        return mgr, session, session.id

    def test_D1_together_wrong_adds_near_retry_and_deferred(self, together_sim):
        mgr, session, sid = together_sim
        info = advance_to(mgr, sid, session, stop_ref=IMG11_REF)
        assert info is not None
        assert info.get("display_mode") in (None, "together")
        assert info.get("test_question_index") is None

        submit_together_test(mgr, sid, session, IMG11_REF, failed_indices=[0, 2])

        tfs = getattr(session, "test_failed_subtests", {}) or {}
        assert sorted(tfs.get(IMG11_REF) or []) == [0, 2]

        near = [t for t in session.queue[session.current_task_index:]
                if t.task_ref == IMG11_REF and t.is_retry]
        assert len(near) >= 1, "Expected near retry for together-mode"
        assert all(t.test_question_index is None for t in near)

        deferred = [t for t in (getattr(session, "deferred_retry_tasks", []) or [])
                    if t.task_ref == IMG11_REF]
        assert len(deferred) >= 1, "Expected deferred control copy"

    def test_D2_together_partial_retry_narrows_down(self, together_sim):
        mgr, session, sid = together_sim
        info = advance_to(mgr, sid, session, stop_ref=IMG11_REF)
        assert info is not None
        submit_together_test(mgr, sid, session, IMG11_REF, failed_indices=[0, 2])

        retry_info = advance_to(mgr, sid, session, stop_ref=IMG11_REF)
        assert retry_info is not None and retry_info.get("is_retry")
        submit_together_test(mgr, sid, session, IMG11_REF, failed_indices=[2])

        tfs = getattr(session, "test_failed_subtests", {}) or {}
        assert tfs.get(IMG11_REF) == [2], f"Expected [2], got {tfs.get(IMG11_REF)}"

    def test_D3_together_all_correct_clears_key(self, together_sim):
        mgr, session, sid = together_sim
        info = advance_to(mgr, sid, session, stop_ref=IMG11_REF)
        assert info is not None
        submit_together_test(mgr, sid, session, IMG11_REF, failed_indices=[0, 2])

        retry_info = advance_to(mgr, sid, session, stop_ref=IMG11_REF)
        assert retry_info is not None and retry_info.get("is_retry")
        result = submit_together_test(mgr, sid, session, IMG11_REF, failed_indices=[])
        assert result.success
        tfs = getattr(session, "test_failed_subtests", {}) or {}
        assert IMG11_REF not in tfs, f"Key should be deleted, got {tfs}"


# ── Group E: max_copies budget ────────────────────────────────────────────────

class TestE_MaxCopiesBudget:

    @pytest.fixture
    def tight_sim(self):
        real = _load_real_complex()
        sd = real.settings.dict()
        from task_system.core.models.complex_models import ComplexSettings
        ns = ComplexSettings(**{**sd, "smart_retry_max_copies_per_task": 4})
        modified = real.copy(update={"settings": ns})
        mgr, _ = _build_manager(complex_obj=modified)
        session = mgr.start_session(COMPLEX_ID, USER_ID)
        return mgr, session, session.id

    def test_E1_budget_shared_across_all_questions(self, tight_sim):
        mgr, session, sid = tight_sim
        advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=3)
        submit_scattered_q(mgr, sid, session, IMG11_REF, 3, success=False)
        advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=7)
        submit_scattered_q(mgr, sid, session, IMG11_REF, 7, success=False)
        assert count_retry_slots(session, IMG11_REF) <= 4

        info9 = advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=9)
        if info9 is None:
            return
        submit_scattered_q(mgr, sid, session, IMG11_REF, 9, success=False)
        assert count_retry_slots(session, IMG11_REF) <= 4, "Budget exceeded after 3rd wrong"

    def test_E2_consumed_copies_still_count_toward_limit(self, sim):
        mgr, session, sid, _ = sim
        advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=3)
        submit_scattered_q(mgr, sid, session, IMG11_REF, 3, success=False)
        copies_after_fail = count_retry_slots(session, IMG11_REF)

        retry_info = advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=3)
        if retry_info is None:
            pytest.skip("No retry slot reachable")
        submit_scattered_q(mgr, sid, session, IMG11_REF, 3, success=True)
        copies_after_retry = count_retry_slots(session, IMG11_REF)
        assert copies_after_retry == copies_after_fail, (
            f"Consumed copies should still count: before={copies_after_fail}, after={copies_after_retry}"
        )


# ── Group F: Rebalance after insertion ────────────────────────────────────────

class TestF_Rebalance:

    def test_F1_near_retry_stays_within_reasonable_distance(self, sim):
        """
        Near retry should appear within near_offset + near_jitter_max + rebalance_window
        positions from current_task_index. With near_offset=2, jitter_max=2, the
        rebalance window can shift it up to a few more positions, so we allow up to 12.
        """
        mgr, session, sid, _ = sim
        advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=3)
        submit_scattered_q(mgr, sid, session, IMG11_REF, 3, success=False)

        snap = queue_snapshot(session)
        near_pos = next((i for i, (r, q, ir, _) in enumerate(snap)
                         if r == IMG11_REF and q == 3 and ir), None)
        assert near_pos is not None, "Near retry not found"
        # Allow up to near_offset(2) + jitter_max(2) + rebalance_headroom(8) = 12
        assert near_pos <= 12, f"Near retry too far after rebalance: pos={near_pos}"

    @pytest.mark.xfail(
        strict=True,
        reason=(
            "BUG: _rebalance_queue_tail does not fully enforce max_same_type_run=3 "
            "after a retry is inserted into the queue. When img_11 retry is placed "
            "between other 'test'-type tasks (img_2.12, img_2.2._a, img_2.2_b, etc.), "
            "the resulting run of 4 different test-type task_refs violates the invariant. "
            "Root cause: the rebalance window (12-24 slots from current_idx) may not "
            "cover the insertion region, or the sort algorithm doesn't redistribute "
            "test blocks when multiple test tasks are adjacent. "
            "Fix: either widen the rebalance window or re-sort with global awareness "
            "of existing test-block positions."
        ),
    )
    def test_F2_no_type_run_exceeds_max_same_type_run_after_retry(self, sim):
        """
        After inserting a retry, no two *different* task_refs of the same type should
        form a run longer than max_same_type_run=3 in the collapsed view.

        NOTE: Scattered-mode test questions (img_11 q0..q20) all share the same
        task_ref and are all of type 'test'. They intentionally appear in a block
        within the iteration — this is by design (grouped test delivery). We only
        enforce the run limit across *distinct* task_refs, not within a single task's
        scattered slots.

        STATUS: BUG CONFIRMED (marked xfail) — rebalance leaves run=4 after retry insert.
        """
        mgr, session, sid, _ = sim
        advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=3)
        submit_scattered_q(mgr, sid, session, IMG11_REF, 3, success=False)

        pending = session.queue[session.current_task_index:]

        # Build a collapsed view: merge consecutive slots of the same task_ref+type
        # into a single logical entry (scattered questions of one test = one block).
        collapsed: List[str] = []
        for t in pending:
            tt = mgr._get_task_type(t.task_ref)
            # Use (task_ref, type) as the block key so each distinct task_ref gets its own run
            block_key = f"{tt}::{t.task_ref}"
            if not collapsed or collapsed[-1] != block_key:
                collapsed.append(block_key)

        # Now check that no two *different* task_refs of the same type run > 3
        run = 1
        for i in range(1, len(collapsed)):
            prev_type = collapsed[i - 1].split("::")[0]
            curr_type = collapsed[i].split("::")[0]
            run = run + 1 if curr_type == prev_type else 1
            assert run <= 3, (
                f"Different-task type run={run} > max_same_type_run=3 at collapsed pos {i}: "
                f"{collapsed[max(0,i-3):i+2]}"
            )


# ── Group G: Deferred retries in next iteration ───────────────────────────────

class TestG_DeferredRetries:

    def _drain_to_next_iter(self, mgr, session, sid):
        iter1 = session.iteration
        for _ in range(600):
            info = mgr.get_next_task(sid)
            if info is None or session.iteration != iter1:
                break
            tr, diff = info["task_ref"], info["difficulty"]
            qi = info.get("test_question_index") or 0
            it = info.get("iteration", iter1)
            if info.get("display_mode") == "scattered":
                mgr.submit_result(sid, _scattered_rd(tr, qi, True, diff, it))
            else:
                mgr.submit_result(sid, _click_rd(tr, True, diff, it))

    def test_G1_deferred_retry_placed_in_next_iteration_queue(self, sim):
        mgr, session, sid, _ = sim
        info5 = advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=5)
        assert info5 is not None
        submit_scattered_q(mgr, sid, session, IMG11_REF, 5, success=False)
        assert any(
            t.task_ref == IMG11_REF and getattr(t, "test_question_index", None) == 5
            for t in (getattr(session, "deferred_retry_tasks", []) or [])
        ), "Expected deferred slot for q=5"

        self._drain_to_next_iter(mgr, session, sid)
        assert session.iteration == 2, f"Expected iteration 2, got {session.iteration}"

        in_iter2 = [t for t in session.queue
                    if t.task_ref == IMG11_REF
                    and getattr(t, "test_question_index", None) == 5
                    and t.is_retry]
        assert len(in_iter2) >= 1, "Deferred retry not placed in iteration 2 queue"
        assert (getattr(session, "deferred_retry_tasks", None) or []) == [], \
            "deferred_retry_tasks should be cleared after placement"

    def test_G2_iter2_has_both_planned_and_deferred_for_q5(self, sim):
        mgr, session, sid, _ = sim
        info5 = advance_to(mgr, sid, session, stop_ref=IMG11_REF, stop_q=5)
        assert info5 is not None
        submit_scattered_q(mgr, sid, session, IMG11_REF, 5, success=False)

        self._drain_to_next_iter(mgr, session, sid)
        assert session.iteration == 2

        all_q5 = [t for t in session.queue
                  if t.task_ref == IMG11_REF
                  and getattr(t, "test_question_index", None) == 5]
        planned = [t for t in all_q5 if not t.is_retry]
        retried = [t for t in all_q5 if t.is_retry]
        assert len(planned) >= 1, "Expected planned slot for img_11 q=5 in iter 2"
        assert len(retried) >= 1, "Expected deferred retry slot for img_11 q=5 in iter 2"
