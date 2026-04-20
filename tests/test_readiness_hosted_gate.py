import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

import server  # type: ignore
import routes._context as ctx_module  # type: ignore


def _ready_service(
    *,
    storage_ready: bool = True,
    shadow_fallback_active: bool = False,
    shadow_read_fallback_blocked: bool = False,
    shadow_write_fallback_blocked: bool = False,
):
    return type(
        "ReadyServiceStub",
        (),
        {
            "hosted_storage_ready": storage_ready,
            "hosted_shadow_fallback_active": shadow_fallback_active,
            "hosted_shadow_read_fallback_blocked": shadow_read_fallback_blocked,
            "hosted_shadow_write_fallback_blocked": shadow_write_fallback_blocked,
        },
    )()


def _persistence_runtime_stub(tmp_path: Path, *, storage_mode: str = "hosted_split", hosted_contract_ready: bool = True):
    state_root = tmp_path / "runtime_state"
    state_root.mkdir(parents=True, exist_ok=True)
    return type(
        "PersistenceRuntimeStub",
        (),
        {
            "state_root": state_root,
            "storage_mode": storage_mode,
            "hosted_contract_ready": hosted_contract_ready,
            "hosted_contract_errors": [] if hosted_contract_ready else ["missing_env:ACTRA_POSTGRES_DSN"],
            "hosted_shadow_write_fallback_enabled": False,
        },
    )()


def _build_app_ctx(tmp_path: Path, *, storage_mode: str = "hosted_split"):
    ready_service = _ready_service()
    return type(
        "Ctx",
        (),
        {
            "data_dir": tmp_path,
            "storage_service": ready_service,
            "asset_service": ready_service,
            "session_api": object(),
            "session_repository": ready_service,
            "persistence_runtime": _persistence_runtime_stub(tmp_path, storage_mode=storage_mode),
            "user_service": ready_service,
            "progress_service": ready_service,
            "statistics_service": ready_service,
            "calendar_service": ready_service,
            "complex_service": ready_service,
            "theory_service": ready_service,
            "catalog_service": ready_service,
        },
    )()


def test_ready_payload_exports_finish_line_subsystems_with_gates(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.delenv("ACTRA_AUTH_EMAIL_ENABLED", raising=False)
    monkeypatch.delenv("ACTRA_AUTH_SMTP_HOST", raising=False)
    monkeypatch.delenv("ACTRA_AUTH_SMTP_FROM", raising=False)
    monkeypatch.delenv("ACTRA_AUTH_SMTP_USER", raising=False)
    monkeypatch.delenv("ACTRA_AUTH_PUBLIC_BASE_URL", raising=False)
    monkeypatch.delenv("RP_EDITOR_FF_AI_MODE", raising=False)

    app_ctx = _build_app_ctx(tmp_path)
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)

    with server.app.test_client() as client:
        response = client.get("/api/ready")

    assert response.status_code == 200
    payload = response.get_json()
    finish_line = payload["finish_line"]
    subsystems = finish_line["subsystems"]
    launch_contract = payload["launch_contract"]

    assert subsystems["main_quick_access"]["finish_line_status"] == "green"
    assert subsystems["main_quick_access"]["official_gate"] == "npm run smoke:main-quick-access:hosted"
    assert subsystems["statistics_progress"]["official_gate"] == "npm run smoke:statistics:hosted"
    assert subsystems["readiness_degraded_signaling"]["finish_line_status"] == "green"
    assert subsystems["readiness_degraded_signaling"]["official_gate"] == "npm run smoke:readiness:hosted"

    assert subsystems["auth_email_lifecycle"]["finish_line_status"] == "transitional"
    assert subsystems["auth_email_lifecycle"]["runtime_status"] == "transitional"
    assert subsystems["auth_email_lifecycle"]["runtime_signals"]["auth_public_base_url_configured"] is False
    missing = subsystems["auth_email_lifecycle"]["runtime_signals"]["auth_email_missing"]
    assert "ACTRA_AUTH_SMTP_HOST" in missing
    assert "ACTRA_AUTH_SMTP_FROM or ACTRA_AUTH_SMTP_USER" in missing

    assert launch_contract["official_gate"] == "npm run smoke:launch-contract:hosted"
    assert launch_contract["companion_infra_gate"] == "npm run smoke:complex-passage:hosted:infra"
    assert launch_contract["runtime_signals"]["hosted_storage_mode"] is True
    assert launch_contract["runtime_signals"]["stable_secret_key"] is False
    assert launch_contract["runtime_signals"]["session_cookie_secure"] is True
    assert launch_contract["runtime_signals"]["hosted_dev_auth_bridge_disabled"] is True
    assert launch_contract["runtime_signals"]["hosted_shadow_write_fallback_disabled"] is True

    assert "auth_email_lifecycle" in finish_line["summary"]["release_blockers"]
    assert "import_export" in finish_line["summary"]["release_blockers"]
    assert "hosted_infra_launch" in finish_line["summary"]["release_blockers"]


def test_ready_payload_marks_auth_and_launch_runtime_green_when_hosted_env_is_present(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_AUTH_EMAIL_ENABLED", "1")
    monkeypatch.setenv("ACTRA_AUTH_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("ACTRA_AUTH_SMTP_FROM", "no-reply@example.com")
    monkeypatch.setenv("ACTRA_AUTH_PUBLIC_BASE_URL", "https://actra.example.com")
    monkeypatch.setenv("ACTRA_SECRET_KEY", "launch-secret-key")
    monkeypatch.delenv("ACTRA_HOSTED_DEV_AUTH_BRIDGE", raising=False)
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)
    monkeypatch.delenv("RP_EDITOR_FF_AI_MODE", raising=False)

    app_ctx = _build_app_ctx(tmp_path, storage_mode="hosted_split")
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)

    with server.app.test_client() as client:
        response = client.get("/api/ready")

    assert response.status_code == 200
    payload = response.get_json()
    subsystems = payload["finish_line"]["subsystems"]
    launch_contract = payload["launch_contract"]

    assert subsystems["auth_email_lifecycle"]["runtime_ready"] is True
    assert subsystems["auth_email_lifecycle"]["runtime_status"] == "green"
    assert subsystems["hosted_infra_launch"]["runtime_ready"] is True
    assert subsystems["hosted_infra_launch"]["runtime_status"] == "green"
    assert subsystems["ai_editor_extras"]["runtime_ready"] is True
    assert subsystems["ai_editor_extras"]["runtime_status"] == "green"
    assert launch_contract["status"] == "green"
    assert launch_contract["runtime_ready"] is True
