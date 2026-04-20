import os
import sys
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock

import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

import server  # type: ignore
import routes._context as ctx_module  # type: ignore
from persistence.postgres import PostgresUnavailableError
from persistence.runtime import PersistenceRuntimeSettings
from services.hosted_shadow_fallback import HostedShadowReadFallbackDisabledError
from services.statistics_service import StatisticsService


class _DummyUserService:
    def get_user(self, user_id: str):
        clean = str(user_id or "").strip()
        if not clean:
            return None
        return type("User", (), {"user_id": clean, "settings": {}})()


class _FakeHostedCalendarRepository:
    def __init__(self):
        self.payloads = {}

    def get_document(self, user_id: str, doc_kind: str):
        return self.payloads.get((user_id, doc_kind))


class _UnavailableHostedCalendarRepository:
    def get_document(self, user_id: str, doc_kind: str):
        raise PostgresUnavailableError("postgres_dsn_missing")


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


def _make_progress_service(user_id="stats-user", task_history=None, complex_completions=None):
    progress_service = MagicMock()
    progress_service.user_id = user_id
    progress_service.progress_manager = MagicMock()
    progress_service.progress_manager.get_progress_data.return_value = {
        "task_history": task_history or {},
        "complex_completions": complex_completions or [],
    }
    progress_service.progress_manager.hosted_storage_ready = True
    progress_service.progress_manager.ensure_hosted_persistence_ready.return_value = None
    return progress_service


def _install_hosted_ctx(monkeypatch, tmp_path, *, statistics_service):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_HOSTED_DEV_AUTH_BRIDGE", raising=False)
    app_ctx = type(
        "Ctx",
        (),
        {
            "statistics_service": statistics_service,
            "user_service": _DummyUserService(),
            "complex_service": None,
            "catalog_service": None,
            "user_id": "",
            "data_dir": tmp_path,
        },
    )()
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)
    monkeypatch.setattr(ctx_module, "_extra", dict(getattr(ctx_module, "_extra", {})))
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)


def _login(client, user_id: str = "stats-user") -> None:
    with client.session_transaction() as session:
        session[ctx_module._AUTH_USER_ID_SESSION_KEY] = user_id


@pytest.fixture
def client():
    with server.app.test_client() as c:
        yield c


def test_hosted_statistics_overall_route_uses_hosted_progress_truth(client, monkeypatch, tmp_path):
    task_history = {
        "mod/topic/task1": {
            "attempts": [
                {"success": True, "time_spent": 120, "timestamp": "2026-04-19T10:00:00"},
                {"success": False, "time_spent": 60, "timestamp": "2026-04-19T11:00:00"},
            ],
            "meta": {"success_rate": 0.5},
            "current_difficulty": 1,
            "mastery_level": "beginner",
        }
    }
    progress_service = _make_progress_service(task_history=task_history)
    statistics_service = StatisticsService(
        progress_service,
        data_dir=str(tmp_path),
        persistence_settings=_build_hosted_settings(tmp_path),
    )
    statistics_service._microcards_analytics_service = False
    fake_calendar_repo = _FakeHostedCalendarRepository()
    fake_calendar_repo.payloads[("stats-user", "activity")] = {}
    statistics_service._calendar_repository = fake_calendar_repo
    _install_hosted_ctx(monkeypatch, tmp_path, statistics_service=statistics_service)

    _login(client)
    response = client.get("/api/statistics/overall")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    stats = payload["stats"]
    assert stats["total_tasks_attempted"] == 2
    assert stats["tasks_mastered"] == 1
    assert stats["success_rate"] == 0.5
    assert stats["total_time_spent"] == 180


def test_hosted_statistics_time_dynamics_route_uses_hosted_calendar_truth(client, monkeypatch, tmp_path):
    today_iso = date.today().isoformat()
    progress_service = _make_progress_service(
        task_history={
            "mod/topic/task1": {
                "attempts": [
                    {"success": True, "time_spent": 120, "timestamp": f"{today_iso}T10:00:00"},
                ]
            }
        }
    )
    statistics_service = StatisticsService(
        progress_service,
        data_dir=str(tmp_path),
        persistence_settings=_build_hosted_settings(tmp_path),
    )
    statistics_service._microcards_analytics_service = False
    fake_calendar_repo = _FakeHostedCalendarRepository()
    fake_calendar_repo.payloads[("stats-user", "activity")] = {
        today_iso: {
            "microcards_reviews": 5,
            "microcards_correct": 4,
            "microcards_seconds_spent": 300,
        }
    }
    statistics_service._calendar_repository = fake_calendar_repo

    shadow_dir = tmp_path / "user_calendar" / "stats-user"
    shadow_dir.mkdir(parents=True)
    (shadow_dir / "activity.json").write_text(
        '{"%s":{"microcards_reviews":99,"microcards_correct":99,"microcards_seconds_spent":999}}' % today_iso,
        encoding="utf-8",
    )

    _install_hosted_ctx(monkeypatch, tmp_path, statistics_service=statistics_service)
    _login(client)
    response = client.get("/api/statistics/time-dynamics?days=1")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    dynamics = payload["dynamics"]
    assert dynamics[-1]["date"] == today_iso
    assert dynamics[-1]["microcards_reviews"] == 5
    assert dynamics[-1]["microcards_study_minutes"] == 5


def test_hosted_statistics_overall_route_returns_degraded_when_progress_storage_is_blocked(client, monkeypatch, tmp_path):
    progress_service = _make_progress_service()
    progress_service.progress_manager.hosted_storage_ready = False
    progress_service.progress_manager.ensure_hosted_persistence_ready.side_effect = PostgresUnavailableError(
        "postgres_dsn_missing"
    )
    statistics_service = StatisticsService(
        progress_service,
        data_dir=str(tmp_path),
        persistence_settings=_build_hosted_settings(tmp_path),
    )
    statistics_service._microcards_analytics_service = False
    _install_hosted_ctx(monkeypatch, tmp_path, statistics_service=statistics_service)

    _login(client)
    response = client.get("/api/statistics/overall")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["error"] == "hosted_shadow_read_blocked"
    assert payload["details"]["operation"] == "statistics._load_progress_data"


def test_hosted_statistics_time_dynamics_route_returns_degraded_when_calendar_storage_is_blocked(client, monkeypatch, tmp_path):
    today_iso = date.today().isoformat()
    progress_service = _make_progress_service(
        task_history={
            "mod/topic/task1": {
                "attempts": [
                    {"success": True, "time_spent": 60, "timestamp": f"{today_iso}T09:00:00"},
                ]
            }
        }
    )
    statistics_service = StatisticsService(
        progress_service,
        data_dir=str(tmp_path),
        persistence_settings=_build_hosted_settings(tmp_path),
    )
    statistics_service._microcards_analytics_service = False
    statistics_service._calendar_repository = _UnavailableHostedCalendarRepository()
    _install_hosted_ctx(monkeypatch, tmp_path, statistics_service=statistics_service)

    _login(client)
    response = client.get("/api/statistics/time-dynamics?days=1")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["error"] == "hosted_shadow_read_blocked"
    assert payload["details"]["operation"] == "statistics._load_calendar_activity"
