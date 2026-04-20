from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


logger = logging.getLogger(__name__)

_HOSTED_REQUIRED_ENV_KEYS = (
    "ACTRA_POSTGRES_DSN",
    "ACTRA_S3_ENDPOINT",
    "ACTRA_S3_BUCKET",
    "ACTRA_S3_ACCESS_KEY",
    "ACTRA_S3_SECRET_KEY",
)
HOSTED_SHADOW_WRITE_FALLBACK_ENV = "ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK"


def _runtime_mode() -> str:
    raw = str(os.environ.get("ACTRA_RUNTIME_MODE") or "").strip().lower()
    if raw in {"hosted_web", "legacy_local"}:
        return raw
    return "legacy_local"


def _resolve_path(raw_value: Optional[str], *, fallback: Path, project_root: Path) -> Path:
    raw = str(raw_value or "").strip()
    if not raw:
        return fallback
    path = Path(raw)
    if not path.is_absolute():
        path = project_root / path
    return path.resolve()


@dataclass(frozen=True)
class PersistenceRuntimeSettings:
    runtime_mode: str
    data_root: Path
    state_root: Path
    postgres_dsn: str
    s3_endpoint: str
    s3_bucket: str
    s3_access_key: str
    s3_secret_key: str
    hosted_contract_errors: List[str]

    @property
    def storage_mode(self) -> str:
        return "hosted_split" if self.runtime_mode == "hosted_web" else "legacy_filesystem"

    @property
    def hosted_contract_ready(self) -> bool:
        return len(self.hosted_contract_errors) == 0

    @property
    def hosted_shadow_write_fallback_enabled(self) -> bool:
        if self.runtime_mode != "hosted_web":
            return True
        raw = str(os.environ.get(HOSTED_SHADOW_WRITE_FALLBACK_ENV) or "").strip().lower()
        return raw in {"1", "true", "yes", "on"}

    def telemetry_root(self) -> Path:
        return self.state_root / "telemetry"

    def ai_runs_root(self) -> Path:
        return self.state_root / "ai_runs"

    def users_runtime_root(self) -> Path:
        return self.state_root / "users"

    def asset_blobs_root(self) -> Path:
        return self.state_root / "asset_blobs"

    def user_runtime_root(self, user_id: Optional[str]) -> Path:
        resolved_user_id = str(user_id or "guest").strip() or "guest"
        return self.users_runtime_root() / resolved_user_id

    def microcards_review_live_integration_state_path(self, user_id: Optional[str]) -> Path:
        return self.user_runtime_root(user_id) / "microcards" / "live_integration_state.json"

    def ensure_runtime_dirs(self) -> None:
        self.state_root.mkdir(parents=True, exist_ok=True)
        self.telemetry_root().mkdir(parents=True, exist_ok=True)
        self.ai_runs_root().mkdir(parents=True, exist_ok=True)
        self.users_runtime_root().mkdir(parents=True, exist_ok=True)
        self.asset_blobs_root().mkdir(parents=True, exist_ok=True)


def resolve_persistence_runtime_settings(
    *,
    data_root: Path,
    project_root: Path,
) -> PersistenceRuntimeSettings:
    runtime_mode = _runtime_mode()
    default_state_root = (
        data_root.parent / "runtime_state" if runtime_mode == "hosted_web" else data_root
    )
    state_root = _resolve_path(
        os.environ.get("ACTRA_RUNTIME_STATE_ROOT"),
        fallback=default_state_root,
        project_root=project_root,
    )

    hosted_contract_errors: List[str] = []
    if runtime_mode == "hosted_web":
        for env_name in _HOSTED_REQUIRED_ENV_KEYS:
            if not str(os.environ.get(env_name) or "").strip():
                hosted_contract_errors.append(f"missing_env:{env_name}")

    return PersistenceRuntimeSettings(
        runtime_mode=runtime_mode,
        data_root=data_root.resolve(),
        state_root=state_root,
        postgres_dsn=str(os.environ.get("ACTRA_POSTGRES_DSN") or "").strip(),
        s3_endpoint=str(os.environ.get("ACTRA_S3_ENDPOINT") or "").strip(),
        s3_bucket=str(os.environ.get("ACTRA_S3_BUCKET") or "").strip(),
        s3_access_key=str(os.environ.get("ACTRA_S3_ACCESS_KEY") or "").strip(),
        s3_secret_key=str(os.environ.get("ACTRA_S3_SECRET_KEY") or "").strip(),
        hosted_contract_errors=hosted_contract_errors,
    )


def validate_hosted_persistence_contract(
    settings: PersistenceRuntimeSettings,
    *,
    strict: bool = False,
) -> List[str]:
    errors = list(settings.hosted_contract_errors)
    if settings.runtime_mode != "hosted_web":
        return errors

    if errors:
        message = "Hosted persistence contract is incomplete: " + ", ".join(errors)
        if strict:
            raise RuntimeError(message)
        logger.warning("[PERSISTENCE] %s", message)
    return errors
