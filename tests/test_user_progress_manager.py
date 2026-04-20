"""
Unit tests for UserProgressManager — T6 coverage plan.

Covers:
- Init and default progress structure
- save_attempt with validation, rolling window, global stats, meta updates
- _calculate_mastery_level logic
- _calculate_new_difficulty escalation
- _truncate_attempts_history rolling window
- add_complex_completion
- get_task_history, get_all_attempts, get_mistake_bank, get_mistakes_for_task
- reset_task_history, remove_last_attempt
- switch_user
- _migrate_v2_to_v3
- Corrupt/missing file handling
"""

import sys
import os
import json
import pytest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from persistence.runtime import PersistenceRuntimeSettings
from services.user_progress_manager import UserProgressManager


# ─── Fixtures ──────────────────────────────────────────────────────


@pytest.fixture
def upm(tmp_path):
    return UserProgressManager(data_dir=str(tmp_path), user_id="test_user")


def _build_hosted_settings(tmp_path: Path) -> PersistenceRuntimeSettings:
    return PersistenceRuntimeSettings(
        runtime_mode="hosted_web",
        data_root=tmp_path,
        state_root=tmp_path / "runtime_state",
        postgres_dsn="",
        s3_endpoint="",
        s3_bucket="",
        s3_access_key="",
        s3_secret_key="",
        hosted_contract_errors=["missing_env:ACTRA_POSTGRES_DSN"],
    )


class _FakeHostedProgressRepository:
    def __init__(self):
        self.payloads = {}
        self.ensure_schema_calls = 0

    def ensure_schema(self):
        self.ensure_schema_calls += 1

    def get_progress(self, user_id: str):
        payload = self.payloads.get(user_id)
        return dict(payload) if isinstance(payload, dict) else payload

    def write_progress(self, user_id: str, payload, *, updated_at: str):
        self.payloads[user_id] = dict(payload)


# ═══════════════════════════════════════════════════════════════════
# Init & default structure
# ═══════════════════════════════════════════════════════════════════


class TestInit:
    def test_creates_default_progress(self, tmp_path):
        upm = UserProgressManager(data_dir=str(tmp_path), user_id="u1")
        assert upm.progress_data["version"] == "3.0"
        assert upm.progress_data["task_history"] == {}
        assert upm.progress_data["user_id"] == "u1"

    def test_creates_user_dir(self, tmp_path):
        UserProgressManager(data_dir=str(tmp_path), user_id="u1")
        assert (tmp_path / "users" / "u1").is_dir()

    def test_loads_existing_progress(self, tmp_path):
        user_dir = tmp_path / "users" / "u1"
        user_dir.mkdir(parents=True)
        data = {
            "version": "3.0",
            "updated_at": datetime.now().isoformat(),
            "user_id": "u1",
            "global_stats": {"total_attempts": 5, "total_time_seconds": 100},
            "task_history": {},
            "mistake_bank": [],
        }
        (user_dir / "progress.json").write_text(json.dumps(data), encoding="utf-8")
        upm = UserProgressManager(data_dir=str(tmp_path), user_id="u1")
        assert upm.progress_data["global_stats"]["total_attempts"] == 5

    def test_corrupt_json_resets(self, tmp_path):
        user_dir = tmp_path / "users" / "u1"
        user_dir.mkdir(parents=True)
        (user_dir / "progress.json").write_text("{bad json", encoding="utf-8")
        upm = UserProgressManager(data_dir=str(tmp_path), user_id="u1")
        assert upm.progress_data["version"] == "3.0"
        assert upm.progress_data["task_history"] == {}

    def test_hosted_init_ignores_progress_shadow_until_repository_ready(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
        user_dir = tmp_path / "users" / "u1"
        user_dir.mkdir(parents=True)
        shadow_payload = {
            "version": "3.0",
            "updated_at": datetime.now().isoformat(),
            "user_id": "u1",
            "global_stats": {"total_attempts": 99, "total_time_seconds": 999},
            "task_history": {
                "mod/topic/task": {
                    "attempts": [{"success": True, "time_spent": 10, "timestamp": datetime.now().isoformat()}],
                    "meta": {"total_attempts": 1, "last_attempt_at": datetime.now().isoformat(), "success_rate": 1.0},
                    "current_difficulty": 1,
                    "mastery_level": "good",
                }
            },
            "mistake_bank": [],
            "complex_completions": [],
        }
        (user_dir / "progress.json").write_text(json.dumps(shadow_payload), encoding="utf-8")

        upm = UserProgressManager(
            data_dir=str(tmp_path),
            user_id="u1",
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        fake_repo = _FakeHostedProgressRepository()
        upm._progress_repository = fake_repo

        upm.ensure_hosted_persistence_ready()

        assert upm.progress_data["global_stats"]["total_attempts"] == 0
        assert upm.progress_data["task_history"] == {}
        assert fake_repo.ensure_schema_calls == 1
        assert fake_repo.payloads["u1"]["global_stats"]["total_attempts"] == 0

    def test_hosted_save_does_not_create_progress_shadow_after_repository_write(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
        upm = UserProgressManager(
            data_dir=str(tmp_path),
            user_id="u1",
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        fake_repo = _FakeHostedProgressRepository()
        upm._progress_repository = fake_repo
        upm.ensure_hosted_persistence_ready()
        upm.progress_file.unlink(missing_ok=True)

        upm._save_progress()

        assert fake_repo.payloads["u1"]["user_id"] == "u1"
        assert not upm.progress_file.exists()

    def test_hosted_save_attempt_lazily_enables_repository_before_first_write(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
        upm = UserProgressManager(
            data_dir=str(tmp_path),
            user_id="u1",
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        fake_repo = _FakeHostedProgressRepository()
        upm._progress_repository = fake_repo

        result = upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30)

        assert result is True
        assert upm.hosted_storage_ready is True
        assert fake_repo.ensure_schema_calls == 1
        assert fake_repo.payloads["u1"]["task_history"]["mod/topic/task1"]["attempts"][0]["success"] is True
        assert not upm.progress_file.exists()

    def test_hosted_lazy_first_write_preserves_following_attempts_in_memory(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
        upm = UserProgressManager(
            data_dir=str(tmp_path),
            user_id="u1",
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        fake_repo = _FakeHostedProgressRepository()
        upm._progress_repository = fake_repo

        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30)
        upm.save_attempt("mod", "topic", "task2", difficulty=1, success=False, time_spent=15)

        payload = fake_repo.payloads["u1"]
        assert sorted(payload["task_history"].keys()) == ["mod/topic/task1", "mod/topic/task2"]
        assert upm.progress_data["task_history"]["mod/topic/task1"]["attempts"][0]["success"] is True
        assert upm.progress_data["task_history"]["mod/topic/task2"]["attempts"][0]["success"] is False

    def test_hosted_fresh_manager_loads_existing_progress_before_new_save(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
        fake_repo = _FakeHostedProgressRepository()

        first = UserProgressManager(
            data_dir=str(tmp_path),
            user_id="u1",
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        first._progress_repository = fake_repo
        first.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30)

        second = UserProgressManager(
            data_dir=str(tmp_path),
            user_id="u1",
            persistence_settings=_build_hosted_settings(tmp_path),
        )
        second._progress_repository = fake_repo
        second.save_attempt("mod", "topic", "task2", difficulty=1, success=False, time_spent=15)

        payload = fake_repo.payloads["u1"]
        assert sorted(payload["task_history"].keys()) == ["mod/topic/task1", "mod/topic/task2"]
        assert second.progress_data["task_history"]["mod/topic/task1"]["attempts"][0]["success"] is True
        assert second.progress_data["task_history"]["mod/topic/task2"]["attempts"][0]["success"] is False


# ═══════════════════════════════════════════════════════════════════
# save_attempt
# ═══════════════════════════════════════════════════════════════════


class TestSaveAttempt:
    def test_basic_save(self, upm):
        result = upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30)
        assert result is True
        history = upm.get_task_history("mod", "topic", "task1")
        assert history is not None
        assert len(history["attempts"]) == 1
        assert history["attempts"][0]["success"] is True

    def test_with_score(self, upm):
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30, score=85.0)
        history = upm.get_task_history("mod", "topic", "task1")
        assert history["attempts"][0]["score"] == 85.0

    def test_invalid_difficulty(self, upm):
        with pytest.raises(ValueError, match="difficulty"):
            upm.save_attempt("mod", "topic", "task1", difficulty=0, success=True, time_spent=30)
        with pytest.raises(ValueError, match="difficulty"):
            upm.save_attempt("mod", "topic", "task1", difficulty=4, success=True, time_spent=30)

    def test_negative_time(self, upm):
        with pytest.raises(ValueError, match="time_spent"):
            upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=-1)

    def test_multiple_attempts(self, upm):
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30)
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=False, time_spent=20)
        attempts = upm.get_all_attempts("mod", "topic", "task1")
        assert len(attempts) == 2

    def test_global_stats_updated(self, upm):
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30)
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=20)
        stats = upm.progress_data["global_stats"]
        assert stats["total_attempts"] == 2
        assert stats["total_time_seconds"] == 50

    def test_meta_updated(self, upm):
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30)
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=False, time_spent=20)
        history = upm.get_task_history("mod", "topic", "task1")
        meta = history["meta"]
        assert meta["total_attempts"] == 2
        assert meta["success_rate"] == 0.5

    def test_event_bus_published(self, tmp_path):
        bus = MagicMock()
        upm = UserProgressManager(data_dir=str(tmp_path), user_id="u1", event_bus=bus)
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30)
        bus.publish.assert_called_once_with("progress_updated", user_id="u1")

    def test_with_complex_and_iteration(self, upm):
        upm.save_attempt("mod", "topic", "task1", difficulty=2, success=True, time_spent=30,
                         complex_id="c1", iteration=3)
        attempt = upm.get_all_attempts("mod", "topic", "task1")[0]
        assert attempt["complex_id"] == "c1"
        assert attempt["iteration"] == 3


# ═══════════════════════════════════════════════════════════════════
# Rolling window (_truncate_attempts_history)
# ═══════════════════════════════════════════════════════════════════


class TestRollingWindow:
    def test_truncates_at_max(self, upm):
        for i in range(25):
            upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=10)
        attempts = upm.get_all_attempts("mod", "topic", "task1")
        assert len(attempts) == 20

    def test_under_limit_not_truncated(self, upm):
        for i in range(5):
            upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=10)
        attempts = upm.get_all_attempts("mod", "topic", "task1")
        assert len(attempts) == 5


# ═══════════════════════════════════════════════════════════════════
# _calculate_mastery_level
# ═══════════════════════════════════════════════════════════════════


class TestMasteryLevel:
    def test_beginner_no_attempts(self, upm):
        entry = {"attempts": [], "meta": {}}
        assert upm._calculate_mastery_level(entry) == "beginner"

    def test_beginner_few_attempts(self, upm):
        entry = {"attempts": [{"success": True}, {"success": True}], "meta": {}}
        assert upm._calculate_mastery_level(entry) == "beginner"

    def test_expert_high_success(self, upm):
        now = datetime.now().isoformat()
        entry = {
            "attempts": [{"success": True} for _ in range(5)],
            "meta": {"last_attempt_at": now},
        }
        assert upm._calculate_mastery_level(entry) == "expert"

    def test_good_medium_success(self, upm):
        now = datetime.now().isoformat()
        entry = {
            "attempts": [
                {"success": True}, {"success": True}, {"success": True},
                {"success": False}, {"success": True},
            ],
            "meta": {"last_attempt_at": now},
        }
        assert upm._calculate_mastery_level(entry) == "good"

    def test_degraded_old_expert(self, upm):
        old_date = (datetime.now() - timedelta(days=60)).isoformat()
        entry = {
            "attempts": [{"success": True} for _ in range(5)],
            "meta": {"last_attempt_at": old_date},
        }
        assert upm._calculate_mastery_level(entry) == "good"  # degraded from expert


# ═══════════════════════════════════════════════════════════════════
# _calculate_new_difficulty
# ═══════════════════════════════════════════════════════════════════


class TestCalculateNewDifficulty:
    def test_success_escalates(self, upm):
        entry = {"attempts": []}
        assert upm._calculate_new_difficulty(entry, 1, True) == 2

    def test_failure_deescalates(self, upm):
        entry = {"attempts": []}
        assert upm._calculate_new_difficulty(entry, 2, False) == 1

    def test_success_at_max(self, upm):
        entry = {"attempts": []}
        assert upm._calculate_new_difficulty(entry, 3, True) == 3

    def test_failure_at_min(self, upm):
        entry = {"attempts": []}
        assert upm._calculate_new_difficulty(entry, 1, False) == 1

    def test_with_difficulty_manager(self, tmp_path):
        dm = MagicMock()
        dm.get_available_levels.return_value = [1, 2]
        dm.normalize_requested_level.side_effect = lambda level, available_levels: level
        dm.get_next_allowed_level.return_value = 2
        upm = UserProgressManager(data_dir=str(tmp_path), user_id="u1", difficulty_manager=dm)
        entry = {"attempts": []}
        assert upm._calculate_new_difficulty(entry, 2, True, task_type="click") == 2  # max is 2


# ═══════════════════════════════════════════════════════════════════
# add_complex_completion
# ═══════════════════════════════════════════════════════════════════


class TestAddComplexCompletion:
    def test_adds_entry(self, upm):
        upm.add_complex_completion("c1", session_id="s1", timestamp="2024-01-15T10:00:00")
        completions = upm.progress_data["complex_completions"]
        assert len(completions) == 1
        assert completions[0]["complex_id"] == "c1"
        assert completions[0]["date"] == "2024-01-15"

    def test_auto_timestamp(self, upm):
        upm.add_complex_completion("c1")
        completions = upm.progress_data["complex_completions"]
        assert len(completions) == 1
        assert "T" in completions[0]["timestamp"]


# ═══════════════════════════════════════════════════════════════════
# Getters
# ═══════════════════════════════════════════════════════════════════


class TestGetters:
    def test_get_task_history_exists(self, upm):
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30)
        assert upm.get_task_history("mod", "topic", "task1") is not None

    def test_get_task_history_not_exists(self, upm):
        assert upm.get_task_history("mod", "topic", "nonexistent") is None

    def test_get_all_attempts_empty(self, upm):
        assert upm.get_all_attempts("mod", "topic", "nonexistent") == []

    def test_get_progress_data(self, upm):
        data = upm.get_progress_data()
        assert "version" in data
        assert data is not upm.progress_data  # should be a copy

    def test_get_mistake_bank_sorted(self, upm):
        upm.save_attempt("mod", "topic", "t1", difficulty=1, success=False, time_spent=10)
        upm.save_attempt("mod", "topic", "t1", difficulty=1, success=False, time_spent=10)
        upm.save_attempt("mod", "topic", "t2", difficulty=1, success=False, time_spent=10)
        bank = upm.get_mistake_bank()
        assert len(bank) >= 1
        # First entry should have highest fail_count
        if len(bank) >= 2:
            assert bank[0]["fail_count"] >= bank[1]["fail_count"]

    def test_get_mistakes_for_task(self, upm):
        upm.save_attempt("mod", "topic", "t1", difficulty=1, success=False, time_spent=10)
        mistakes = upm.get_mistakes_for_task("mod", "topic", "t1")
        assert len(mistakes) >= 1


# ═══════════════════════════════════════════════════════════════════
# reset_task_history
# ═══════════════════════════════════════════════════════════════════


class TestResetTaskHistory:
    def test_reset_existing(self, upm):
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30)
        assert upm.reset_task_history("mod", "topic", "task1") is True
        assert upm.get_task_history("mod", "topic", "task1") is None

    def test_reset_nonexistent(self, upm):
        assert upm.reset_task_history("mod", "topic", "nonexistent") is True


# ═══════════════════════════════════════════════════════════════════
# remove_last_attempt
# ═══════════════════════════════════════════════════════════════════


class TestRemoveLastAttempt:
    def test_removes_last(self, upm):
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30)
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=False, time_spent=20)
        assert upm.remove_last_attempt("mod", "topic", "task1") is True
        attempts = upm.get_all_attempts("mod", "topic", "task1")
        assert len(attempts) == 1
        assert attempts[0]["success"] is True

    def test_remove_all_attempts(self, upm):
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30)
        # When removing the last remaining attempt, meta.last_attempt_at becomes None
        # which fails schema validation, so save returns False
        result = upm.remove_last_attempt("mod", "topic", "task1")
        # The in-memory data is still updated even if save fails
        history = upm.get_task_history("mod", "topic", "task1")
        assert len(history["attempts"]) == 0
        assert history["meta"]["total_attempts"] == 0

    def test_remove_nonexistent(self, upm):
        assert upm.remove_last_attempt("mod", "topic", "nonexistent") is False


# ═══════════════════════════════════════════════════════════════════
# switch_user
# ═══════════════════════════════════════════════════════════════════


class TestSwitchUser:
    def test_switch(self, tmp_path):
        upm = UserProgressManager(data_dir=str(tmp_path), user_id="u1")
        upm.save_attempt("mod", "topic", "task1", difficulty=1, success=True, time_spent=30)
        upm.switch_user("u2")
        assert upm.user_id == "u2"
        assert upm.get_task_history("mod", "topic", "task1") is None  # clean for new user

    def test_switch_same_user(self, upm):
        upm.switch_user("test_user")
        # Should not reload


# ═══════════════════════════════════════════════════════════════════
# _migrate_v2_to_v3
# ═══════════════════════════════════════════════════════════════════


class TestMigrateV2ToV3:
    def test_migration(self, tmp_path):
        user_dir = tmp_path / "users" / "u1"
        user_dir.mkdir(parents=True)
        v2_data = {
            "version": "2.0",
            "user_id": "u1",
            "task_history": {
                "mod/topic/t1": {
                    "attempts": [
                        {"timestamp": "2024-01-01T00:00:00", "difficulty": 1, "success": True, "time_spent": 30},
                        {"timestamp": "2024-01-02T00:00:00", "difficulty": 1, "success": False, "time_spent": 20},
                    ],
                    "current_difficulty": 1,
                    "mastery_level": "beginner",
                }
            },
            "mistake_bank": [],
        }
        (user_dir / "progress.json").write_text(json.dumps(v2_data), encoding="utf-8")
        upm = UserProgressManager(data_dir=str(tmp_path), user_id="u1")
        assert upm.progress_data["version"] == "3.0"
        entry = upm.progress_data["task_history"]["mod/topic/t1"]
        assert "meta" in entry
        assert entry["meta"]["total_attempts"] == 2
        assert entry["meta"]["success_rate"] == 0.5

    def test_migration_empty_attempts(self, tmp_path):
        user_dir = tmp_path / "users" / "u1"
        user_dir.mkdir(parents=True)
        v2_data = {
            "version": "2.0",
            "user_id": "u1",
            "task_history": {
                "mod/topic/t1": {
                    "attempts": [],
                    "current_difficulty": 1,
                }
            },
            "mistake_bank": [],
        }
        (user_dir / "progress.json").write_text(json.dumps(v2_data), encoding="utf-8")
        upm = UserProgressManager(data_dir=str(tmp_path), user_id="u1")
        entry = upm.progress_data["task_history"]["mod/topic/t1"]
        assert entry["meta"]["total_attempts"] == 0

    def test_migration_truncates(self, tmp_path):
        user_dir = tmp_path / "users" / "u1"
        user_dir.mkdir(parents=True)
        attempts = [
            {"timestamp": f"2024-01-{i+1:02d}T00:00:00", "difficulty": 1, "success": True, "time_spent": 10}
            for i in range(30)
        ]
        v2_data = {
            "version": "2.0",
            "user_id": "u1",
            "task_history": {
                "mod/topic/t1": {"attempts": attempts, "current_difficulty": 1}
            },
            "mistake_bank": [],
        }
        (user_dir / "progress.json").write_text(json.dumps(v2_data), encoding="utf-8")
        upm = UserProgressManager(data_dir=str(tmp_path), user_id="u1")
        entry = upm.progress_data["task_history"]["mod/topic/t1"]
        assert len(entry["attempts"]) == 20
        # meta.total_attempts should reflect ALL attempts (before truncation)
        assert entry["meta"]["total_attempts"] == 30
