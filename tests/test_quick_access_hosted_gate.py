import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

import server  # type: ignore
import routes._context as ctx_module  # type: ignore
import routes.quick_access_routes as quick_access_routes  # type: ignore
from persistence.postgres import PostgresUnavailableError
from services.hosted_shadow_fallback import HostedShadowReadFallbackDisabledError
from services.user_service import User


class _FakeHostedIdentityRepository:
    def __init__(self, user=None, *, fail_reads: bool = False):
        self.user = user
        self.fail_reads = fail_reads

    def get_user(self, user_id: str):
        if self.fail_reads:
            raise PostgresUnavailableError("postgres_dsn_missing")
        if self.user is not None and self.user.user_id == user_id:
            return self.user
        return None


class _FakeHostedUserService:
    def __init__(self, user=None, *, fail_reads: bool = False):
        self.repository = _FakeHostedIdentityRepository(user, fail_reads=fail_reads)
        self.updated_users = []
        self._shadow_read_fallback_blocked = False

    def ensure_persistence_ready(self):
        if self.repository.fail_reads:
            raise PostgresUnavailableError("postgres_dsn_missing")

    def get_user(self, user_id: str):
        if self.repository.user is not None and self.repository.user.user_id == user_id:
            return self.repository.user
        return None

    def update_user(self, user: User) -> bool:
        self.updated_users.append(user)
        self.repository.user = user
        return True


@dataclass
class _FakePausedSession:
    id: str
    user_id: str
    complex_id: str
    paused: bool = True
    is_active: bool = True
    current_task_index: int = 2
    iteration: int = 1
    queue: list | None = None
    paused_at: datetime | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    last_resume_source: str | None = "quick_access"
    last_resumed_at: datetime | None = None


class _FakeSessionRepository:
    def __init__(self, sessions=None, *, fail_list: bool = False):
        self.sessions = list(sessions or [])
        self.fail_list = fail_list

    def list_active_sessions(self, user_id: str):
        if self.fail_list:
            raise HostedShadowReadFallbackDisabledError(
                "session_repository.list_active_sessions",
                reason="postgres_dsn_missing",
            )
        return [
            {"session_id": session.id}
            for session in self.sessions
            if session.user_id == user_id
        ]

    def load_session_by_session_id(self, *, user_id: str, session_id: str):
        for session in self.sessions:
            if session.user_id == user_id and session.id == session_id:
                return session
        return None


class _FakeSessionAPI:
    def __init__(self, session_repository):
        self._session_manager = type(
            "SessionManager",
            (),
            {"session_repository": session_repository, "_active_sessions": {}},
        )()

    def get_resume_target(self, session):
        return {
            "session_id": session.id,
            "complex_id": session.complex_id,
            "screen": "resume",
        }


class _FakeStatisticsService:
    def __init__(self, payload=None):
        self.payload = payload or {}

    def get_complex_statistics(self, user_id: str):
        return self.payload


@dataclass
class _FakeHealthItem:
    complex_id: str
    health_percent: int
    status: str
    is_critical: bool
    last_practice_date: date | None


class _FakeCalendarService:
    def __init__(self, items=None):
        self.items = list(items or [])

    def _get_all_progress(self, user_id: str):
        return self.items


def _make_user(*, user_id: str = "user-main", settings=None) -> User:
    return User(
        user_id=user_id,
        name="Hosted User",
        created_at="2026-04-19T10:00:00Z",
        settings=dict(settings or {}),
    )


def _install_hosted_runtime(monkeypatch, tmp_path, *, user_service, session_api, statistics_service, calendar_service):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_HOSTED_DEV_AUTH_BRIDGE", raising=False)

    app_ctx = type(
        "Ctx",
        (),
        {
            "user_service": user_service,
            "session_api": session_api,
            "statistics_service": statistics_service,
            "data_dir": tmp_path,
            "user_id": "",
        },
    )()
    extra = dict(getattr(ctx_module, "_extra", {}))
    extra["calendar_service"] = calendar_service
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(ctx_module, "_extra", extra)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)
    return app_ctx


def _login_hosted_user(client, user_id: str = "user-main") -> None:
    with client.session_transaction() as session:
        session[ctx_module._AUTH_USER_ID_SESSION_KEY] = user_id


@pytest.fixture
def client():
    with server.app.test_client() as c:
        yield c


def test_hosted_quick_access_returns_paused_pin_recent_metadata(client, monkeypatch, tmp_path):
    user = _make_user(
        settings={
            "web_ui_state": {
                "pinned": ["complex-1"],
                "recent": ["complex-2"],
            }
        }
    )
    paused_session = _FakePausedSession(
        id="session-1",
        user_id="user-main",
        complex_id="complex-1",
        queue=["task-1", "task-2", "task-3"],
        paused_at=datetime(2026, 4, 19, 12, 0, 0),
        start_time=datetime(2026, 4, 19, 11, 30, 0),
        last_resumed_at=datetime(2026, 4, 19, 11, 45, 0),
    )
    user_service = _FakeHostedUserService(user)
    session_api = _FakeSessionAPI(_FakeSessionRepository([paused_session]))
    statistics_service = _FakeStatisticsService(
        {
            "complex-1": {"aggregated": {"success_rate": 82, "wins": 9, "attempts": 11}},
            "complex-2": {"aggregated": {"success_rate": 50, "wins": 2, "attempts": 4}},
        }
    )
    calendar_service = _FakeCalendarService(
        [
            _FakeHealthItem(
                complex_id="complex-1",
                health_percent=64,
                status="warning",
                is_critical=False,
                last_practice_date=date.today() - timedelta(days=2),
            )
        ]
    )
    _install_hosted_runtime(
        monkeypatch,
        tmp_path,
        user_service=user_service,
        session_api=session_api,
        statistics_service=statistics_service,
        calendar_service=calendar_service,
    )
    monkeypatch.setattr(
        quick_access_routes,
        "_get_complex_by_id",
        lambda complex_id: {
            "complex-1": {"id": "complex-1", "title": "Pinned complex"},
            "complex-2": {"id": "complex-2", "title": "Recent complex"},
        }.get(complex_id),
    )

    _login_hosted_user(client)
    response = client.get("/api/ui/quick-access")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["pinned"] == ["complex-1"]
    assert payload["recent"] == ["complex-2"]
    assert payload["paused_complex_ids"] == ["complex-1"]
    assert [item["complex"]["id"] for item in payload["items"]] == ["complex-1", "complex-2"]
    first_item = payload["items"][0]
    assert first_item["is_pinned"] is True
    assert first_item["stats"] == {"progress": 82, "solved": 9, "total": 11}
    assert first_item["health"]["health_percent"] == 64
    assert first_item["paused_session"]["session_id"] == "session-1"
    assert first_item["paused_session"]["resume_target"]["screen"] == "resume"
    assert first_item["paused_session"]["display_task_index"] == 1


def test_hosted_quick_access_mutations_persist_in_user_profile_settings(client, monkeypatch, tmp_path):
    user = _make_user()
    user_service = _FakeHostedUserService(user)
    _install_hosted_runtime(
        monkeypatch,
        tmp_path,
        user_service=user_service,
        session_api=_FakeSessionAPI(_FakeSessionRepository()),
        statistics_service=_FakeStatisticsService(),
        calendar_service=_FakeCalendarService(),
    )
    monkeypatch.setattr(
        quick_access_routes,
        "_get_complex_by_id",
        lambda complex_id: {"id": complex_id, "title": complex_id},
    )

    _login_hosted_user(client)

    pin_response = client.post("/api/ui/quick-access/pin", json={"complex_id": "complex-1"})
    settings_response = client.post("/api/ui/settings", json={"settings": {"theme": "forest"}})
    recent_response = client.post("/api/ui/quick-access/recent", json={"complex_id": "complex-2"})
    unpin_response = client.post("/api/ui/quick-access/unpin", json={"complex_id": "complex-1"})
    remove_response = client.post("/api/ui/quick-access/remove", json={"complex_id": "complex-2"})
    state_response = client.get("/api/ui/quick-access")
    ui_settings_response = client.get("/api/ui/settings")

    assert pin_response.status_code == 200
    assert settings_response.status_code == 200
    assert recent_response.status_code == 200
    assert unpin_response.status_code == 200
    assert remove_response.status_code == 200
    assert state_response.status_code == 200
    assert ui_settings_response.status_code == 200

    payload = state_response.get_json()
    settings_payload = ui_settings_response.get_json()
    assert payload["pinned"] == []
    assert payload["recent"] == []
    assert settings_payload["settings"]["theme"] == "forest"
    assert user_service.updated_users
    assert user.settings["web_ui_state"]["settings"]["theme"] == "forest"
    assert (tmp_path / "users" / "user-main" / "ui_state.json").exists() is False


def test_hosted_quick_access_remove_dismisses_paused_session_card(client, monkeypatch, tmp_path):
    user = _make_user()
    paused_session = _FakePausedSession(
        id="session-1",
        user_id="user-main",
        complex_id="complex-1",
        queue=["task-1", "task-2"],
        paused_at=datetime(2026, 4, 19, 12, 0, 0),
    )
    user_service = _FakeHostedUserService(user)
    _install_hosted_runtime(
        monkeypatch,
        tmp_path,
        user_service=user_service,
        session_api=_FakeSessionAPI(_FakeSessionRepository([paused_session])),
        statistics_service=_FakeStatisticsService(),
        calendar_service=_FakeCalendarService(),
    )
    monkeypatch.setattr(
        quick_access_routes,
        "_get_complex_by_id",
        lambda complex_id: {"id": complex_id, "title": complex_id},
    )

    _login_hosted_user(client)

    before_response = client.get("/api/ui/quick-access")
    remove_response = client.post("/api/ui/quick-access/remove", json={"complex_id": "complex-1"})
    after_response = client.get("/api/ui/quick-access")

    assert before_response.status_code == 200
    assert remove_response.status_code == 200
    assert after_response.status_code == 200
    before_payload = before_response.get_json()
    after_payload = after_response.get_json()
    assert [item["complex"]["id"] for item in before_payload["items"]] == ["complex-1"]
    assert before_payload["paused_complex_ids"] == ["complex-1"]
    assert after_payload["items"] == []
    assert after_payload["paused_complex_ids"] == []
    assert user.settings["web_ui_state"]["dismissed"] == ["complex-1"]


def test_hosted_quick_access_returns_degraded_when_identity_storage_is_blocked(client, monkeypatch, tmp_path):
    user_service = _FakeHostedUserService(_make_user(), fail_reads=True)
    _install_hosted_runtime(
        monkeypatch,
        tmp_path,
        user_service=user_service,
        session_api=_FakeSessionAPI(_FakeSessionRepository()),
        statistics_service=_FakeStatisticsService(),
        calendar_service=_FakeCalendarService(),
    )

    _login_hosted_user(client)
    response = client.get("/api/ui/quick-access")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["error"] == "hosted_shadow_read_blocked"
    assert payload["details"]["operation"] == "quick_access.ui_state"
    assert payload["details"]["source_of_truth"] == "postgres"
    assert user_service._shadow_read_fallback_blocked is True


def test_hosted_quick_access_returns_degraded_when_session_repository_is_blocked(client, monkeypatch, tmp_path):
    user = _make_user(
        settings={
            "web_ui_state": {
                "pinned": ["complex-1"],
            }
        }
    )
    user_service = _FakeHostedUserService(user)
    _install_hosted_runtime(
        monkeypatch,
        tmp_path,
        user_service=user_service,
        session_api=_FakeSessionAPI(_FakeSessionRepository(fail_list=True)),
        statistics_service=_FakeStatisticsService(),
        calendar_service=_FakeCalendarService(),
    )
    monkeypatch.setattr(
        quick_access_routes,
        "_get_complex_by_id",
        lambda complex_id: {"id": complex_id, "title": complex_id},
    )

    _login_hosted_user(client)
    response = client.get("/api/ui/quick-access")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["error"] == "hosted_shadow_read_blocked"
    assert payload["details"]["operation"] == "session_repository.list_active_sessions"
    assert payload["details"]["source_of_truth"] == "postgres"
