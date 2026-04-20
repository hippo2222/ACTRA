import sys
from datetime import date, datetime
from pathlib import Path

import pytest
from flask import Flask


ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from api.calendar_api import _invalidate_activity_cache, create_calendar_routes
from persistence.postgres import PostgresUnavailableError
from persistence.runtime import PersistenceRuntimeSettings
from services.calendar.calendar_service import CalendarService
from services.calendar.models import ComplexProgress, ComplexStatus, UserCalendarSettings


class _FakeHostedCalendarRepository:
    def __init__(self):
        self.payloads = {}
        self.writes = []

    def ensure_schema(self):
        return None

    def get_document(self, user_id: str, doc_kind: str):
        return self.payloads.get((user_id, doc_kind))

    def write_document(self, user_id: str, doc_kind: str, payload, *, updated_at: str):
        self.payloads[(user_id, doc_kind)] = payload
        self.writes.append(
            {
                "user_id": user_id,
                "doc_kind": doc_kind,
                "payload": payload,
                "updated_at": updated_at,
            }
        )


class _UnavailableHostedCalendarRepository:
    def ensure_schema(self):
        raise PostgresUnavailableError("postgres_dsn_missing")

    def get_document(self, user_id: str, doc_kind: str):
        raise PostgresUnavailableError("postgres_dsn_missing")

    def write_document(self, user_id: str, doc_kind: str, payload, *, updated_at: str):
        raise PostgresUnavailableError("postgres_dsn_missing")


class _ComplexServiceStub:
    def __init__(self, complexes=None):
        self._complexes = list(complexes or [])

    def get_all_complexes(self):
        return list(self._complexes)


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


def _build_calendar_service(tmp_path: Path, repository) -> CalendarService:
    CalendarService._hosted_schema_ready = False
    service = CalendarService(
        data_dir=str(tmp_path),
        user_id="calendar-user",
        persistence_settings=_build_hosted_settings(tmp_path),
    )
    service._calendar_repository = repository
    return service


def _build_app(calendar_service: CalendarService, *, complex_service=None):
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.secret_key = "calendar-hosted-gate"
    create_calendar_routes(app, calendar_service, complex_service=complex_service)
    return app


@pytest.fixture(autouse=True)
def _hosted_runtime(monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)
    _invalidate_activity_cache()
    yield
    _invalidate_activity_cache()
    CalendarService._hosted_schema_ready = False


def _seed_hosted_calendar_docs(repo: _FakeHostedCalendarRepository, *, user_id: str = "calendar-user"):
    today_iso = date.today().isoformat()
    repo.payloads[(user_id, "settings")] = UserCalendarSettings(
        user_id=user_id,
        daily_time_limit_minutes=30,
    ).to_dict()
    repo.payloads[(user_id, "progress")] = [
        ComplexProgress(
            complex_id="complex-1",
            user_id=user_id,
            status=ComplexStatus.IN_PROGRESS,
            health_score=0.42,
            last_reviewed_at=datetime.now(),
            total_attempts=3,
            total_tasks_completed=2,
        ).to_dict()
    ]
    repo.payloads[(user_id, "activity")] = {
        today_iso: {
            "tasks_attempted": 2,
            "tasks_solved": 1,
            "seconds_spent": 600,
            "completion_percent": 50,
            "microcards_reviews": 6,
            "microcards_correct": 5,
            "microcards_seconds_spent": 180,
        }
    }
    repo.payloads[(user_id, "notifications")] = {"dismissed": []}
    repo.payloads[(user_id, "sessions")] = []
    repo.payloads[(user_id, "rest_days")] = []


def test_hosted_calendar_today_and_health_routes_use_hosted_truth(tmp_path):
    repo = _FakeHostedCalendarRepository()
    _seed_hosted_calendar_docs(repo)
    service = _build_calendar_service(tmp_path, repo)

    shadow_dir = tmp_path / "user_calendar" / "calendar-user"
    shadow_dir.mkdir(parents=True, exist_ok=True)
    (shadow_dir / "settings.json").write_text('{"user_id":"calendar-user","daily_time_limit_minutes":5}', encoding="utf-8")
    (shadow_dir / "progress.json").write_text(
        '[{"complex_id":"shadow-complex","user_id":"calendar-user","status":"in_progress","health_score":0.99}]',
        encoding="utf-8",
    )

    app = _build_app(
        service,
        complex_service=_ComplexServiceStub([{"id": "complex-1", "name": "Hosted Complex", "tasks": []}]),
    )

    with app.test_client() as client:
        today_response = client.get("/api/calendar/today")
        health_response = client.get("/api/calendar/health")

    assert today_response.status_code == 200
    today_payload = today_response.get_json()
    assert today_payload["success"] is True
    assert today_payload["settings"]["daily_time_limit_minutes"] == 30
    assert today_payload["health_summary"]["complexes"][0]["complex_id"] == "complex-1"
    assert today_payload["health_summary"]["complexes"][0]["health_percent"] > 0

    assert health_response.status_code == 200
    health_payload = health_response.get_json()
    assert health_payload["success"] is True
    assert health_payload["complexes"][0]["name"] == "Hosted Complex"
    assert health_payload["complexes"][0]["complex_id"] == "complex-1"


def test_hosted_calendar_schedule_and_activity_routes_use_hosted_activity_truth(tmp_path):
    repo = _FakeHostedCalendarRepository()
    _seed_hosted_calendar_docs(repo)
    service = _build_calendar_service(tmp_path, repo)

    today_iso = date.today().isoformat()
    shadow_dir = tmp_path / "user_calendar" / "calendar-user"
    shadow_dir.mkdir(parents=True, exist_ok=True)
    (shadow_dir / "activity.json").write_text(
        '{"%s":{"tasks_attempted":99,"tasks_solved":99,"seconds_spent":9999,"microcards_reviews":99}}' % today_iso,
        encoding="utf-8",
    )

    app = _build_app(service)

    with app.test_client() as client:
        schedule_response = client.get("/api/calendar/schedule?days=3")
        activity_response = client.get("/api/calendar/activity?days=1")

    assert schedule_response.status_code == 200
    schedule_payload = schedule_response.get_json()
    assert schedule_payload["success"] is True
    assert len(schedule_payload["schedule"]) == 4
    assert any(item["date"] == today_iso and item["is_today"] for item in schedule_payload["schedule"])

    assert activity_response.status_code == 200
    activity_payload = activity_response.get_json()
    assert activity_payload["success"] is True
    today_item = next(item for item in activity_payload["activity"] if item["date"] == today_iso)
    assert today_item["tasks_attempted"] == 2
    assert today_item["microcards_reviews"] == 6
    assert today_item["activity_attempts_total"] == 8


def test_hosted_calendar_settings_route_persists_to_repository(tmp_path):
    repo = _FakeHostedCalendarRepository()
    _seed_hosted_calendar_docs(repo)
    service = _build_calendar_service(tmp_path, repo)

    shadow_dir = tmp_path / "user_calendar" / "calendar-user"
    shadow_dir.mkdir(parents=True, exist_ok=True)
    (shadow_dir / "settings.json").write_text('{"user_id":"calendar-user","daily_time_limit_minutes":5}', encoding="utf-8")

    app = _build_app(service)

    with app.test_client() as client:
        response = client.post("/api/calendar/settings", json={"daily_time_limit_minutes": 45})

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["success"] is True
    assert payload["settings"]["daily_time_limit_minutes"] == 45
    assert repo.payloads[("calendar-user", "settings")]["daily_time_limit_minutes"] == 45
    assert any(write["doc_kind"] == "settings" for write in repo.writes)
    assert "daily_time_limit_minutes\":5" in (shadow_dir / "settings.json").read_text(encoding="utf-8")


def test_hosted_calendar_today_route_returns_degraded_when_progress_storage_is_blocked(tmp_path):
    service = _build_calendar_service(tmp_path, _UnavailableHostedCalendarRepository())

    shadow_dir = tmp_path / "user_calendar" / "calendar-user"
    shadow_dir.mkdir(parents=True, exist_ok=True)
    (shadow_dir / "progress.json").write_text("[]", encoding="utf-8")

    app = _build_app(service)

    with app.test_client() as client:
        response = client.get("/api/calendar/today")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["success"] is False
    assert payload["route_contract"] == "public_calendar"
    assert payload["error"] == "hosted_shadow_read_blocked"
    assert payload["details"]["operation"] == "calendar.load_settings"


def test_hosted_calendar_activity_route_returns_degraded_when_activity_storage_is_blocked(tmp_path):
    service = _build_calendar_service(tmp_path, _UnavailableHostedCalendarRepository())
    service._storage_ready = True

    app = _build_app(service)

    with app.test_client() as client:
        response = client.get("/api/calendar/activity?days=1")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["success"] is False
    assert payload["error"] == "hosted_shadow_read_blocked"
    assert payload["details"]["operation"] == "calendar.load_activity"


def test_hosted_calendar_settings_route_returns_degraded_when_settings_storage_is_blocked(tmp_path):
    service = _build_calendar_service(tmp_path, _UnavailableHostedCalendarRepository())

    app = _build_app(service)

    with app.test_client() as client:
        response = client.post("/api/calendar/settings", json={"daily_time_limit_minutes": 45})

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["ok"] is False
    assert payload["success"] is False
    assert payload["error"] == "hosted_shadow_read_blocked"
    assert payload["details"]["operation"] == "calendar.load_settings"
