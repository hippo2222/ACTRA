"""
Unit tests for SessionRepository — T19 coverage plan.

Covers:
- Init and directory creation
- _json_safe (datetime, dict, list, numpy-like, None)
- _get_sessions_dir, _get_session_file_path
- save_session / load_session round-trip
- save_session guest mode protection
- save_session user_id mismatch
- load_session version check (outdated → delete)
- load_session invalid JSON → delete
- delete_session
- load_all_sessions
- list_active_sessions
- load_session_by_session_id
"""

import sys
import os
import json
import pytest
from datetime import datetime, date
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.session_repository import SessionRepository


@pytest.fixture
def repo(tmp_path):
    return SessionRepository(data_dir=str(tmp_path))


# ═══════════════════════════════════════════════════════════════════
# Init
# ═══════════════════════════════════════════════════════════════════


class TestInit:
    def test_creates_users_dir(self, tmp_path):
        repo = SessionRepository(data_dir=str(tmp_path))
        assert (tmp_path / "users").is_dir()


# ═══════════════════════════════════════════════════════════════════
# _json_safe
# ═══════════════════════════════════════════════════════════════════


class TestJsonSafe:
    def test_none(self, repo):
        assert repo._json_safe(None) is None

    def test_datetime(self, repo):
        dt = datetime(2024, 6, 15, 10, 30)
        result = repo._json_safe(dt)
        assert isinstance(result, str)
        assert "2024" in result

    def test_date(self, repo):
        d = date(2024, 6, 15)
        result = repo._json_safe(d)
        assert isinstance(result, str)

    def test_dict(self, repo):
        result = repo._json_safe({"key": datetime(2024, 1, 1)})
        assert isinstance(result["key"], str)

    def test_list(self, repo):
        result = repo._json_safe([datetime(2024, 1, 1), "text"])
        assert isinstance(result[0], str)
        assert result[1] == "text"

    def test_passthrough(self, repo):
        assert repo._json_safe(42) == 42
        assert repo._json_safe("hello") == "hello"


# ═══════════════════════════════════════════════════════════════════
# Path helpers
# ═══════════════════════════════════════════════════════════════════


class TestPathHelpers:
    def test_sessions_dir(self, repo, tmp_path):
        result = repo._get_sessions_dir("user1")
        assert result == tmp_path / "users" / "user1" / "sessions"

    def test_session_file_path(self, repo, tmp_path):
        result = repo._get_session_file_path("session1", "user1")
        assert result == tmp_path / "users" / "user1" / "sessions" / "session1.json"

    def test_legacy_session_file_path(self, repo, tmp_path):
        result = repo._get_legacy_session_file_path("complex1", "user1")
        assert result == tmp_path / "users" / "user1" / "sessions" / "complex1.json"


# ═══════════════════════════════════════════════════════════════════
# save_session
# ═══════════════════════════════════════════════════════════════════


class TestSaveSession:
    def _mock_session(self, sid="sess1", complex_id="c1", user_id="user1"):
        session = MagicMock()
        session.id = sid
        session.complex_id = complex_id
        session.user_id = user_id
        session.model_dump.return_value = {
            "id": sid, "complex_id": complex_id, "user_id": user_id,
            "version": 1, "iteration": 1,
        }
        return session

    def test_save_creates_file(self, repo):
        session = self._mock_session()
        result = repo.save_session(session, "user1")
        assert result is True
        path = repo._get_session_file_path("sess1", "user1")
        assert path.exists()

    def test_guest_not_persisted(self, repo):
        session = self._mock_session(user_id="guest")
        result = repo.save_session(session, "guest")
        assert result is True
        path = repo._get_session_file_path("sess1", "guest")
        assert not path.exists()

    def test_user_id_mismatch_uses_session(self, repo):
        session = self._mock_session(user_id="real_user")
        result = repo.save_session(session, "wrong_user")
        assert result is True
        # File saved under session.user_id
        path = repo._get_session_file_path("sess1", "real_user")
        assert path.exists()


# ═══════════════════════════════════════════════════════════════════
# load_session
# ═══════════════════════════════════════════════════════════════════


class TestLoadSession:
    def test_not_found(self, repo):
        result = repo.load_session("nonexistent", "user1")
        assert result is None

    def test_invalid_json_deleted(self, repo):
        sessions_dir = repo._get_sessions_dir("user1")
        sessions_dir.mkdir(parents=True, exist_ok=True)
        path = repo._get_legacy_session_file_path("c1", "user1")
        path.write_text("{bad json", encoding="utf-8")

        result = repo.load_session("c1", "user1")
        assert result is None
        assert not path.exists()  # corrupted file deleted

    def test_outdated_version_deleted(self, repo):
        sessions_dir = repo._get_sessions_dir("user1")
        sessions_dir.mkdir(parents=True, exist_ok=True)
        path = repo._get_legacy_session_file_path("c1", "user1")
        path.write_text(json.dumps({"id": "s1", "version": 0}), encoding="utf-8")

        result = repo.load_session("c1", "user1")
        assert result is None
        assert not path.exists()

    def test_prefers_paused_session_when_multiple_sessions_share_complex(self, repo):
        sessions_dir = repo._get_sessions_dir("user1")
        sessions_dir.mkdir(parents=True, exist_ok=True)
        older = repo._get_session_file_path("sess_old", "user1")
        newer = repo._get_session_file_path("sess_new", "user1")
        older.write_text(
            json.dumps(
                {
                    "id": "sess_old",
                    "complex_id": "c1",
                    "user_id": "user1",
                    "version": 1,
                    "iteration": 1,
                    "is_active": True,
                    "paused": False,
                    "start_time": "2026-03-20T10:00:00",
                }
            ),
            encoding="utf-8",
        )
        newer.write_text(
            json.dumps(
                {
                    "id": "sess_new",
                    "complex_id": "c1",
                    "user_id": "user1",
                    "version": 1,
                    "iteration": 1,
                    "is_active": True,
                    "paused": True,
                    "paused_at": "2026-03-21T11:30:00",
                    "start_time": "2026-03-21T09:00:00",
                }
            ),
            encoding="utf-8",
        )

        result = repo.load_session("c1", "user1")
        assert result is not None
        assert result.id == "sess_new"


# ═══════════════════════════════════════════════════════════════════
# delete_session
# ═══════════════════════════════════════════════════════════════════


class TestDeleteSession:
    def test_not_found_returns_true(self, repo):
        assert repo.delete_session("c1", "user1") is True

    def test_deletes_file(self, repo):
        sessions_dir = repo._get_sessions_dir("user1")
        sessions_dir.mkdir(parents=True, exist_ok=True)
        path = repo._get_legacy_session_file_path("c1", "user1")
        path.write_text("{}", encoding="utf-8")

        assert repo.delete_session("c1", "user1") is True
        assert not path.exists()

    def test_delete_session_by_session_id_keeps_sibling_session(self, repo):
        def _mock_session(sid, complex_id):
            session = MagicMock()
            session.id = sid
            session.complex_id = complex_id
            session.user_id = "user1"
            session.model_dump.return_value = {
                "id": sid,
                "complex_id": complex_id,
                "user_id": "user1",
                "version": 1,
                "iteration": 1,
            }
            return session

        s1 = _mock_session("sess1", "c1")
        s2 = _mock_session("sess2", "c1")

        assert repo.save_session(s1, "user1") is True
        assert repo.save_session(s2, "user1") is True

        assert repo.delete_session_by_session_id("sess1", "user1") is True
        assert repo.load_session_by_session_id("user1", "sess1") is None
        assert repo.load_session_by_session_id("user1", "sess2") is not None


# ═══════════════════════════════════════════════════════════════════
# load_all_sessions / list_active_sessions
# ═══════════════════════════════════════════════════════════════════


class TestLoadAll:
    def test_no_dir(self, repo):
        assert repo.load_all_sessions("user1") == []

    def test_list_active_empty(self, repo):
        result = repo.list_active_sessions("user1")
        assert result == []


# ═══════════════════════════════════════════════════════════════════
# load_session_by_session_id
# ═══════════════════════════════════════════════════════════════════


class TestLoadBySessionId:
    def test_not_found(self, repo):
        assert repo.load_session_by_session_id("user1", "nonexistent") is None

    def test_no_sessions_dir(self, repo):
        assert repo.load_session_by_session_id("user1", "s1") is None

    def test_keeps_session_with_open_iteration_timestamp_end(self, repo):
        sessions_dir = repo._get_sessions_dir("user1")
        sessions_dir.mkdir(parents=True, exist_ok=True)
        path = repo._get_session_file_path("sess_open", "user1")
        path.write_text(
            json.dumps(
                {
                    "id": "sess_open",
                    "complex_id": "c1",
                    "user_id": "user1",
                    "version": 1,
                    "iteration": 1,
                    "is_active": True,
                    "paused": True,
                    "paused_at": "2026-03-28T14:24:08.482144",
                    "start_time": "2026-03-28T14:20:00",
                    "iteration_timestamps": {
                        "1": {
                            "start": "2026-03-28T14:20:00",
                            "end": None,
                        }
                    },
                }
            ),
            encoding="utf-8",
        )

        loaded = repo.load_session_by_session_id("user1", "sess_open")

        assert loaded is not None
        assert loaded.id == "sess_open"
        assert loaded.paused is True
        assert loaded.iteration_timestamps[1]["end"] is None
        assert path.exists()

        active_items = repo.list_active_sessions("user1")
        assert active_items == [
            {
                "complex_id": "c1",
                "session_id": "sess_open",
                "start_time": loaded.start_time,
                "iteration": 1,
                "current_task_index": 0,
                "is_active": True,
            }
        ]

    def test_loads_legacy_complex_file_by_session_id(self, repo):
        sessions_dir = repo._get_sessions_dir("user1")
        sessions_dir.mkdir(parents=True, exist_ok=True)
        path = repo._get_legacy_session_file_path("c1", "user1")
        path.write_text(
            json.dumps(
                {
                    "id": "sess_legacy",
                    "complex_id": "c1",
                    "user_id": "user1",
                    "version": 1,
                    "iteration": 1,
                }
            ),
            encoding="utf-8",
        )

        loaded = repo.load_session_by_session_id("user1", "sess_legacy")
        assert loaded is not None
        assert loaded.id == "sess_legacy"
