import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from api.session_api import SessionAPI  # type: ignore
from services.linked_complex_runtime import build_linked_runtime_complex_id  # type: ignore


class _DummyController:
    def __init__(self, session_manager):
        self.current_session_id = None
        self._session_manager = session_manager

    def start_session(self, complex_id, user_id, start_iteration=1):
        self.current_session_id = "session-linked"
        self._session_manager._session = SimpleNamespace(id="session-linked", user_id=user_id, complex_id=complex_id)
        return True

    def get_current_session_stats(self):
        return {
            "current_iter": 1,
            "progress": 0,
            "index_in_queue": 0,
            "total_in_queue": 1,
        }


class _DummySessionManager:
    def __init__(self):
        self._session = None
        self._active_sessions = {}
        self.session_repository = MagicMock()

    def get_session(self, session_id):
        if self._session and getattr(self._session, "id", None) == session_id:
            return self._session
        return None


class _DummyComplexService:
    def __init__(self):
        self._complexes_cache = {}

    def get_complex(self, complex_id):
        return self._complexes_cache.get(complex_id)


def test_start_session_registers_linked_runtime_complex(monkeypatch):
    runtime_complex_service = _DummyComplexService()
    session_manager = _DummySessionManager()
    controller = _DummyController(session_manager)
    api = SessionAPI(
        controller,
        session_manager,
        runtime_complex_service,
        storage_service=MagicMock(),
        statistics_service=MagicMock(),
    )

    library_entry_id = "complex_library::demo::abc123"
    runtime_complex_id = build_linked_runtime_complex_id(library_entry_id)
    ctx_payload = SimpleNamespace(
        catalog_service=SimpleNamespace(
            get_complex_library_entry=lambda entry_id, requested_by_user_id: {
                "ok": True,
                "library_entry": {
                    "library_entry_id": entry_id,
                    "access_state": "active",
                    "access_reason": "Public catalog publication",
                    "resolved_version_id": "version-1",
                },
                "item": {
                    "item_id": "catalog-item-1",
                },
                "snapshot": {
                    "complex": {
                        "id": "workspace-complex",
                        "name": "Linked Mammography",
                        "description": "Read-only source",
                        "tasks": ["module-a/topic-a/task-a"],
                        "chains": [],
                        "settings": {"adaptive_difficulty": True},
                    },
                },
            }
        )
    )

    import routes._context as ctx_module  # type: ignore

    monkeypatch.setattr(ctx_module, "get_ctx", lambda: ctx_payload)

    result = api.start_session(runtime_complex_id, user_id="reader")

    assert result["ok"] is True
    registered = runtime_complex_service.get_complex(runtime_complex_id)
    assert registered is not None
    assert registered.id == runtime_complex_id
    assert registered.name == "Linked Mammography"
    assert getattr(registered, "linked_library_entry_id", "") == library_entry_id
    assert getattr(registered, "content_scope", "") == "linked_library"


def test_start_session_revalidates_cached_linked_runtime_complex(monkeypatch):
    runtime_complex_service = _DummyComplexService()
    session_manager = _DummySessionManager()
    controller = _DummyController(session_manager)
    api = SessionAPI(
        controller,
        session_manager,
        runtime_complex_service,
        storage_service=MagicMock(),
        statistics_service=MagicMock(),
    )

    library_entry_id = "complex_library::demo::deleted"
    runtime_complex_id = build_linked_runtime_complex_id(library_entry_id)
    runtime_complex_service._complexes_cache[runtime_complex_id] = object()
    ctx_payload = SimpleNamespace(
        catalog_service=SimpleNamespace(
            get_complex_library_entry=lambda entry_id, requested_by_user_id: {
                "ok": True,
                "library_entry": {
                    "library_entry_id": entry_id,
                    "access_state": "deleted_source",
                    "access_reason": "Source complex was deleted by the author.",
                    "resolved_version_id": None,
                },
                "snapshot": None,
            }
        )
    )

    import routes._context as ctx_module  # type: ignore

    monkeypatch.setattr(ctx_module, "get_ctx", lambda: ctx_payload)

    result = api.start_session(runtime_complex_id, user_id="reader")

    assert result["ok"] is False
    assert result["error"] == "complex_library_entry_not_accessible"
    assert controller.current_session_id is None
