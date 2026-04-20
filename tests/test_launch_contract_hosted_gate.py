import sys
from pathlib import Path

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


def _persistence_runtime_stub(
    tmp_path: Path,
    *,
    storage_mode: str = "hosted_split",
    hosted_contract_ready: bool = True,
    hosted_shadow_write_fallback_enabled: bool = False,
):
    state_root = tmp_path / "runtime_state"
    state_root.mkdir(parents=True, exist_ok=True)
    return type(
        "PersistenceRuntimeStub",
        (),
        {
            "state_root": state_root,
            "storage_mode": storage_mode,
            "hosted_contract_ready": hosted_contract_ready,
            "hosted_contract_errors": []
            if hosted_contract_ready
            else ["missing_env:ACTRA_POSTGRES_DSN"],
            "hosted_shadow_write_fallback_enabled": hosted_shadow_write_fallback_enabled,
        },
    )()


def _build_app_ctx(
    tmp_path: Path,
    *,
    storage_mode: str = "hosted_split",
    hosted_shadow_write_fallback_enabled: bool = False,
):
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
            "persistence_runtime": _persistence_runtime_stub(
                tmp_path,
                storage_mode=storage_mode,
                hosted_shadow_write_fallback_enabled=hosted_shadow_write_fallback_enabled,
            ),
            "user_service": ready_service,
            "progress_service": ready_service,
            "statistics_service": ready_service,
            "calendar_service": ready_service,
            "complex_service": ready_service,
            "theory_service": ready_service,
            "catalog_service": ready_service,
        },
    )()


def test_launch_contract_flags_default_secret_and_missing_auth_baseline(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_SECRET_KEY", "change-me-before-production")
    monkeypatch.setenv("ACTRA_AUTH_EMAIL_ENABLED", "0")
    monkeypatch.delenv("ACTRA_AUTH_SMTP_HOST", raising=False)
    monkeypatch.delenv("ACTRA_AUTH_SMTP_FROM", raising=False)
    monkeypatch.delenv("ACTRA_AUTH_SMTP_USER", raising=False)
    monkeypatch.delenv("ACTRA_AUTH_PUBLIC_BASE_URL", raising=False)
    monkeypatch.delenv("ACTRA_HOSTED_DEV_AUTH_BRIDGE", raising=False)
    monkeypatch.delenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", raising=False)

    app_ctx = _build_app_ctx(tmp_path, storage_mode="hosted_split")
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)

    with server.app.test_client() as client:
        response = client.get("/api/ready")

    assert response.status_code == 200
    payload = response.get_json()
    launch_contract = payload["launch_contract"]

    assert launch_contract["status"] == "transitional"
    assert launch_contract["runtime_ready"] is False
    assert launch_contract["runtime_signals"]["hosted_storage_mode"] is True
    assert launch_contract["runtime_signals"]["secret_key_configured"] is True
    assert launch_contract["runtime_signals"]["secret_key_uses_default_placeholder"] is True
    assert launch_contract["runtime_signals"]["stable_secret_key"] is False
    assert launch_contract["runtime_signals"]["auth_public_base_url_configured"] is False
    assert launch_contract["runtime_signals"]["auth_email_enabled"] is False
    assert "ACTRA_AUTH_EMAIL_ENABLED" in launch_contract["runtime_signals"]["auth_email_missing"]


def test_launch_contract_detects_explicit_shadow_and_dev_bridge_degradation(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    monkeypatch.setenv("ACTRA_SECRET_KEY", "launch-secret-key")
    monkeypatch.setenv("ACTRA_AUTH_EMAIL_ENABLED", "1")
    monkeypatch.setenv("ACTRA_AUTH_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("ACTRA_AUTH_SMTP_FROM", "no-reply@example.com")
    monkeypatch.setenv("ACTRA_AUTH_PUBLIC_BASE_URL", "https://actra.example.com")
    monkeypatch.setenv("ACTRA_HOSTED_DEV_AUTH_BRIDGE", "1")
    monkeypatch.setenv("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", "1")

    app_ctx = _build_app_ctx(
        tmp_path,
        storage_mode="hosted_split",
        hosted_shadow_write_fallback_enabled=True,
    )
    monkeypatch.setattr(server, "_headless_app_ctx", app_ctx)
    monkeypatch.setattr(ctx_module, "_app_ctx", app_ctx)

    with server.app.test_client() as client:
        response = client.get("/api/ready")

    assert response.status_code == 200
    payload = response.get_json()
    launch_contract = payload["launch_contract"]

    assert launch_contract["status"] == "transitional"
    assert launch_contract["runtime_ready"] is False
    assert launch_contract["runtime_signals"]["hosted_dev_auth_bridge_disabled"] is False
    assert launch_contract["runtime_signals"]["hosted_shadow_write_fallback_disabled"] is False
