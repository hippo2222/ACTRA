"""Users & Profiles API routes.

Endpoints:
- GET    /api/users                  - List all user profiles
- POST   /api/users                  - Create a new user profile
- GET    /api/users/current          - Get currently active user
- POST   /api/users/select           - Switch active user
- POST   /api/users/avatar           - Upload a custom avatar for the current user
- POST   /api/users/update           - Update user profile
- POST   /api/users/change-password  - Change current user password
- POST   /api/users/verify-password  - Verify user password
- POST   /api/users/delete           - Delete user profile
- GET    /api/users/ai-keys          - Get current user AI keys (masked)
- POST   /api/users/ai-keys          - Save AI keys for current user
- POST   /api/users/ai-keys/validate - Validate a single AI key
- GET    /api/assets/avatars         - List available avatar files
- GET    /api/assets/avatars/<path>  - Serve avatar image
"""

import io
import logging
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import bcrypt
from flask import Blueprint, jsonify, request, send_file, send_from_directory

from persistence.hosted_asset_repository import HostedAssetRepository
from persistence.hosted_calendar_repository import HostedCalendarRepository
from persistence.hosted_catalog_repository import HostedCatalogRepository
from persistence.hosted_complex_statistics_repository import HostedComplexStatisticsRepository
from persistence.hosted_microcards_repository import HostedMicrocardsRepository
from persistence.hosted_microcards_review_repository import HostedMicrocardsReviewRepository
from persistence.hosted_progress_repository import HostedProgressRepository
from persistence.postgres import postgres_connection
from routes._context import (
    get_authenticated_user_id,
    get_ctx,
    get_current_user_id,
    get_extra,
    is_hosted_web_runtime,
    logout_authenticated_user,
)
from routes._helpers import _maybe_hosted_shadow_write_error_response
from services.hosted_shadow_fallback import HostedShadowWriteFallbackDisabledError

logger = logging.getLogger(__name__)

users_bp = Blueprint("users", __name__)

_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_ALLOWED_AVATAR_INPUT_FORMATS = {"PNG", "JPEG", "WEBP"}
_AVATAR_RENDER_SIZE = 512
_LEGACY_DEFAULT_AVATAR_FILES = frozenset({
    "1.png",
    "2.png",
    "3.png",
    "4.png",
    "5.png",
    "6.png",
    "7.png",
})
_SETTINGS_RATE_LIMITS: Dict[str, Dict[str, int]] = {
    "change_email": {"limit": 4, "window_seconds": 60},
    "resend_email_change": {"limit": 6, "window_seconds": 60},
}
_SETTINGS_RATE_LIMIT_STATE: Dict[str, list[float]] = {}
_SETTINGS_RATE_LIMIT_LOCK = threading.RLock()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _h(name: str):
    """Get a server helper function by name."""
    helpers = get_extra("server_helpers", {})
    return helpers[name]


def _client_fingerprint() -> str:
    forwarded = str(request.headers.get("X-Forwarded-For") or "").strip()
    if forwarded:
        return str(forwarded.split(",")[0]).strip() or "unknown"
    real_ip = str(request.headers.get("X-Real-IP") or "").strip()
    if real_ip:
        return real_ip
    return str(request.remote_addr or "unknown").strip() or "unknown"


def _settings_rate_limit_response(retry_after_seconds: int):
    retry_after = max(1, int(retry_after_seconds or 1))
    return (
        jsonify(
            {
                "ok": False,
                "error": "too_many_requests",
                "message": "\u0421\u043b\u0438\u0448\u043a\u043e\u043c \u043c\u043d\u043e\u0433\u043e \u043f\u043e\u043f\u044b\u0442\u043e\u043a. \u041f\u043e\u0434\u043e\u0436\u0434\u0438\u0442\u0435 \u043d\u0435\u043c\u043d\u043e\u0433\u043e \u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0441\u043d\u043e\u0432\u0430.",
                "retry_after_seconds": retry_after,
            }
        ),
        429,
        {"Retry-After": str(retry_after)},
    )


def _apply_settings_rate_limit(scope: str):
    config = _SETTINGS_RATE_LIMITS.get(str(scope or "").strip())
    if not config:
        return None

    limit = int(config.get("limit", 0) or 0)
    window_seconds = int(config.get("window_seconds", 0) or 0)
    if limit <= 0 or window_seconds <= 0:
        return None

    subject_key = _client_fingerprint()
    user_service = getattr(get_ctx(), "user_service", None)
    limiter = getattr(user_service, "consume_rate_limit", None)
    if callable(limiter):
        try:
            verdict = limiter(
                str(scope or "").strip(),
                subject_key,
                limit=limit,
                window_seconds=window_seconds,
            )
            if not bool((verdict or {}).get("allowed", True)):
                return _settings_rate_limit_response(int((verdict or {}).get("retry_after_seconds") or 1))
            return None
        except Exception:
            logger.exception(
                "[HTTP] Shared settings rate limit failed for scope %s; falling back to process-local limiter",
                scope,
            )

    bucket = f"{scope}:{subject_key}"
    now = time.monotonic()
    with _SETTINGS_RATE_LIMIT_LOCK:
        attempts = [
            stamp
            for stamp in _SETTINGS_RATE_LIMIT_STATE.get(bucket, [])
            if now - stamp < float(window_seconds)
        ]
        if len(attempts) >= limit:
            oldest = attempts[0] if attempts else now
            retry_after = max(1, int(window_seconds - (now - oldest)) + 1)
            _SETTINGS_RATE_LIMIT_STATE[bucket] = attempts
            return _settings_rate_limit_response(retry_after)
        attempts.append(now)
        _SETTINGS_RATE_LIMIT_STATE[bucket] = attempts
    return None


def _get_user_info_dict(user_id: str) -> Optional[Dict[str, Any]]:
    """Helper to return a flat user dict for an existing profile."""
    user = get_ctx().user_service.get_user(user_id)
    return user.to_api_dict() if user else None


def _require_hosted_authenticated_user_id() -> Optional[str]:
    user_id = get_authenticated_user_id()
    return str(user_id or "").strip() or None


def _normalize_email(user_service: Any, email: Any) -> str:
    normalizer = getattr(user_service, "normalize_email", None)
    if callable(normalizer):
        return str(normalizer(email) or "").strip().lower()
    return str(email or "").strip().lower()


def _validate_email(user_service: Any, email: str) -> None:
    validator = getattr(user_service, "validate_email", None)
    if callable(validator):
        validator(email)
        return

    clean_email = _normalize_email(user_service, email)
    if not clean_email:
        raise ValueError("email_required")
    if len(clean_email) > 255 or not _EMAIL_PATTERN.match(clean_email):
        raise ValueError("invalid_email")


def _email_exists(user_service: Any, email: str, *, exclude_user_id: Optional[str] = None) -> bool:
    repository = getattr(user_service, "repository", None)
    checker = getattr(repository, "email_exists", None)
    if callable(checker):
        return bool(checker(email, exclude_user_id=exclude_user_id))

    for existing_user in user_service.get_all_users():
        if exclude_user_id and existing_user.user_id == exclude_user_id:
            continue
        if _normalize_email(user_service, getattr(existing_user, "email", "")) == email:
            return True
    return False


def _pending_email_exists(user_service: Any, email: str, *, exclude_user_id: Optional[str] = None) -> bool:
    repository = getattr(user_service, "repository", None)
    checker = getattr(repository, "pending_email_exists", None)
    if callable(checker):
        return bool(checker(email, exclude_user_id=exclude_user_id))

    for existing_user in user_service.get_all_users():
        if exclude_user_id and existing_user.user_id == exclude_user_id:
            continue
        if _normalize_email(user_service, getattr(existing_user, "pending_email", "")) == email:
            return True
    return False


def _email_delivery_error_response(status: Dict[str, Any], user: Optional[Any] = None):
    reason = str((status or {}).get("reason") or "verification_send_failed").strip() or "verification_send_failed"
    code_map = {
        "already_verified": 409,
        "email_missing": 400,
        "pending_email_missing": 400,
        "disabled": 503,
        "not_configured": 503,
        "missing_base_url": 503,
        "send_failed": 502,
        "issue_failed": 500,
    }
    body: Dict[str, Any] = {"ok": False, "error": reason, "verification_email": status}
    if user is not None and hasattr(user, "to_api_dict"):
        body["user"] = user.to_api_dict()
    return jsonify(body), code_map.get(reason, 500)


def _email_change_unavailable_response():
    return (
        jsonify(
            {
                "ok": False,
                "error": "email_change_unavailable",
                "message": "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u0441\u043c\u0435\u043d\u0443 \u043f\u043e\u0447\u0442\u044b \u0434\u043b\u044f \u044d\u0442\u043e\u0433\u043e \u0430\u0434\u0440\u0435\u0441\u0430. \u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0434\u0440\u0443\u0433\u043e\u0439 email \u0438\u043b\u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0437\u0436\u0435.",
            }
        ),
        409,
    )


def _name_exists(user_service: Any, name: str, *, exclude_user_id: Optional[str] = None) -> bool:
    clean_name = str(name or "").strip()
    repository = getattr(user_service, "repository", None)
    checker = getattr(repository, "name_exists", None)
    if callable(checker):
        return bool(checker(clean_name, exclude_user_id=exclude_user_id))

    lowered = clean_name.lower()
    for existing_user in user_service.get_all_users():
        if exclude_user_id and existing_user.user_id == exclude_user_id:
            continue
        if str(getattr(existing_user, "name", "") or "").strip().lower() == lowered:
            return True
    return False


def _resolve_user_id_from_request(payload: Optional[Dict[str, Any]] = None) -> Optional[str]:
    if is_hosted_web_runtime():
        return _require_hosted_authenticated_user_id()

    ctx = get_ctx()
    candidate = None
    if payload is not None:
        candidate = payload.get("user_id")
    if not candidate:
        candidate = request.form.get("user_id")
    if not candidate:
        candidate = ctx.user_id
    return str(candidate or "").strip() or None


def _try_self_service_shadow_profile_update(
    user_service: Any,
    user: Any,
    *,
    operation: str,
) -> Optional[bool]:
    if not is_hosted_web_runtime():
        return None

    authenticated_user_id = _require_hosted_authenticated_user_id()
    target_user_id = str(getattr(user, "user_id", "") or "").strip()
    if not authenticated_user_id or authenticated_user_id != target_user_id:
        return None

    shadow_updater = getattr(user_service, "_shadow_update_user", None)
    if not callable(shadow_updater):
        return None

    logger.warning(
        "[HTTP][DEV-FALLBACK] Using self-service shadow profile update for %s on user %s because hosted persistence write is unavailable",
        operation,
        target_user_id,
    )
    return bool(shadow_updater(user))


def _is_legacy_default_avatar(filename: str) -> bool:
    clean_name = Path(str(filename or "").strip()).name.lower()
    return clean_name in _LEGACY_DEFAULT_AVATAR_FILES


def _build_default_avatar_svg(size: int = 256) -> bytes:
    safe_size = max(64, min(1024, int(size or 256)))
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{safe_size}" height="{safe_size}" viewBox="0 0 128 128" fill="none">
  <rect width="128" height="128" rx="32" fill="#F3F4F6"/>
  <circle cx="64" cy="46" r="18" fill="#CBD5E1"/>
  <path d="M32 99C35.5 83.8 48.7 74 64 74C79.3 74 92.5 83.8 96 99" fill="#CBD5E1"/>
</svg>"""
    return svg.encode("utf-8")


def _payload_owned_by_user(payload: Any, user_id: str, *, ownership_keys: Optional[List[str]] = None) -> bool:
    if not isinstance(payload, dict):
        return False
    clean_user_id = str(user_id or "").strip()
    if not clean_user_id:
        return False
    keys = ownership_keys or ["created_by_user_id", "owner_user_id", "user_id"]
    for key in keys:
        if str(payload.get(key) or "").strip() == clean_user_id:
            return True
    return False


def _task_owned_by_user(task_payload: Any, user_id: str) -> bool:
    if _payload_owned_by_user(task_payload, user_id):
        return True
    if not isinstance(task_payload, dict):
        return False
    metadata = task_payload.get("metadata")
    if _payload_owned_by_user(metadata, user_id):
        return True
    task_data = task_payload.get("task_data")
    if isinstance(task_data, dict):
        return _payload_owned_by_user(task_data.get("meta"), user_id)
    return False


def _delete_user_owned_workspace_content(ctx: Any, user_id: str) -> Dict[str, int]:
    report = {
        "tasks_deleted": 0,
        "topics_deleted": 0,
        "modules_deleted": 0,
        "complexes_deleted": 0,
        "theories_deleted": 0,
    }
    clean_user_id = str(user_id or "").strip()
    if not clean_user_id:
        return report

    storage_service = getattr(ctx, "storage_service", None)
    if storage_service is not None:
        try:
            modules = list(storage_service.load_modules() or [])
        except Exception:
            logger.exception("[HTTP] Failed to enumerate workspace catalog for account deletion of %s", clean_user_id)
            raise

        owned_module_ids = set()
        owned_topic_refs = set()
        owned_task_refs = set()

        for module in modules:
            if not isinstance(module, dict):
                continue
            module_id = str(module.get("id") or "").strip()
            if not module_id:
                continue
            if _payload_owned_by_user(module, clean_user_id):
                owned_module_ids.add(module_id)
                continue
            for topic in module.get("topics") or []:
                if not isinstance(topic, dict):
                    continue
                topic_id = str(topic.get("id") or "").strip()
                if not topic_id:
                    continue
                if _payload_owned_by_user(topic, clean_user_id):
                    owned_topic_refs.add((module_id, topic_id))
                    continue
                for task in topic.get("tasks") or []:
                    if not isinstance(task, dict):
                        continue
                    task_id = str(task.get("id") or "").strip()
                    if not task_id:
                        continue
                    if _task_owned_by_user(task, clean_user_id):
                        owned_task_refs.add((module_id, topic_id, task_id))

        for module_id, topic_id, task_id in sorted(owned_task_refs):
            if getattr(storage_service, "delete_task", None) and storage_service.delete_task(module_id, topic_id, task_id):
                report["tasks_deleted"] += 1

        for module_id, topic_id in sorted(owned_topic_refs):
            if module_id in owned_module_ids:
                continue
            if getattr(storage_service, "delete_topic", None) and storage_service.delete_topic(module_id, topic_id):
                report["topics_deleted"] += 1

        for module_id in sorted(owned_module_ids):
            if getattr(storage_service, "delete_module", None) and storage_service.delete_module(module_id):
                report["modules_deleted"] += 1

    complex_service = getattr(ctx, "complex_service", None)
    if complex_service is not None and getattr(complex_service, "get_all_complexes", None):
        try:
            for complex_obj in list(complex_service.get_all_complexes() or []):
                if str(getattr(complex_obj, "created_by_user_id", "") or "").strip() != clean_user_id:
                    continue
                complex_id = str(getattr(complex_obj, "id", "") or "").strip()
                if not complex_id:
                    continue
                if complex_service.delete_complex(complex_id):
                    report["complexes_deleted"] += 1
        except Exception:
            logger.exception("[HTTP] Failed to delete owned complexes for account %s", clean_user_id)
            raise

    theory_service = getattr(ctx, "theory_service", None)
    if theory_service is not None and getattr(theory_service, "list_theories", None):
        try:
            for theory in list(theory_service.list_theories() or []):
                if not isinstance(theory, dict):
                    continue
                if str(theory.get("created_by_user_id") or "").strip() != clean_user_id:
                    continue
                theory_id = str(theory.get("id") or "").strip()
                if not theory_id:
                    continue
                theory_service.delete_theory(theory_id)
                report["theories_deleted"] += 1
        except Exception:
            logger.exception("[HTTP] Failed to delete owned theories for account %s", clean_user_id)
            raise

    return report


def _resolve_managed_storage_path(ctx: Any, storage_root: str, storage_rel_path: str) -> Optional[Path]:
    clean_root = str(storage_root or "").strip()
    clean_rel_path = str(storage_rel_path or "").strip()
    if not clean_root or not clean_rel_path:
        return None

    persistence_settings = getattr(ctx, "persistence_runtime", None)
    if clean_root == "data_root":
        return (Path(ctx.data_dir) / clean_rel_path).resolve()
    if clean_root == "state_root" and persistence_settings is not None:
        return (Path(persistence_settings.state_root) / clean_rel_path).resolve()
    return None


def _delete_user_avatar_files(ctx: Any, user: Any) -> int:
    user_id = str(getattr(user, "user_id", "") or "").strip()
    if not user_id:
        return 0

    avatar_dir = Path(ctx.data_dir) / "avatars"
    if not avatar_dir.exists():
        return 0

    deleted = 0
    seen_paths = set()
    pattern = f"user-{user_id}-*.*"
    for candidate in avatar_dir.glob(pattern):
        if not candidate.is_file():
            continue
        resolved = candidate.resolve()
        if resolved in seen_paths:
            continue
        seen_paths.add(resolved)
        try:
            candidate.unlink(missing_ok=True)
            deleted += 1
        except Exception:
            logger.warning("[HTTP] Failed to remove avatar file %s during account deletion", candidate, exc_info=True)

    current_avatar = Path(str(getattr(user, "avatar_seed", "") or "").strip()).name
    if current_avatar and not _is_legacy_default_avatar(current_avatar):
        current_path = (avatar_dir / current_avatar).resolve()
        if current_path not in seen_paths and current_path.exists() and current_path.is_file():
            try:
                current_path.unlink(missing_ok=True)
                deleted += 1
            except Exception:
                logger.warning("[HTTP] Failed to remove active avatar %s during account deletion", current_path, exc_info=True)

    return deleted


def _delete_owned_hosted_postgres_records(ctx: Any, user_id: str) -> Dict[str, int]:
    report = {
        "sessions_deleted": 0,
        "progress_deleted": 0,
        "statistics_deleted": 0,
        "calendar_docs_deleted": 0,
        "microcards_review_docs_deleted": 0,
        "microcards_decks_deleted": 0,
        "catalog_items_deleted": 0,
        "catalog_versions_deleted": 0,
        "catalog_theory_entries_deleted": 0,
        "catalog_complex_entries_deleted": 0,
        "assets_deleted": 0,
        "asset_files_deleted": 0,
    }
    clean_user_id = str(user_id or "").strip()
    persistence_settings = getattr(ctx, "persistence_runtime", None)
    dsn = str(getattr(persistence_settings, "postgres_dsn", "") or "").strip()
    if not clean_user_id or not dsn:
        return report

    HostedProgressRepository(dsn).ensure_schema()
    HostedComplexStatisticsRepository(dsn).ensure_schema()
    HostedCalendarRepository(dsn).ensure_schema()
    HostedMicrocardsReviewRepository(dsn).ensure_schema()
    HostedMicrocardsRepository(dsn).ensure_schema()
    HostedCatalogRepository(dsn).ensure_schema()
    HostedAssetRepository(dsn).ensure_schema()

    session_repository = getattr(ctx, "session_repository", None)
    if session_repository is not None and getattr(session_repository, "load_all_sessions", None):
        try:
            sessions = list(session_repository.load_all_sessions(clean_user_id) or [])
            for session in sessions:
                session_id = str(getattr(session, "id", "") or "").strip()
                if not session_id:
                    continue
                if session_repository.delete_session_by_session_id(session_id, clean_user_id):
                    report["sessions_deleted"] += 1
        except Exception:
            logger.exception("[HTTP] Failed to delete active sessions for account %s", clean_user_id)
            raise

    owned_catalog_item_ids: List[str] = []
    owned_complex_item_ids: List[str] = []
    owned_theory_item_ids: List[str] = []
    owned_asset_paths: List[Path] = []
    owned_microcards_deck_ids: List[str] = []

    with postgres_connection(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT item_id, content_type
                FROM actra_catalog_items
                WHERE owner_user_id = %s
                """,
                (clean_user_id,),
            )
            for row in cur.fetchall() or []:
                item_id = str((row or [None])[0] or "").strip()
                content_type = str((row or [None, None])[1] or "").strip().lower()
                if not item_id:
                    continue
                owned_catalog_item_ids.append(item_id)
                if content_type == "complex":
                    owned_complex_item_ids.append(item_id)
                elif content_type == "theory":
                    owned_theory_item_ids.append(item_id)

            cur.execute(
                """
                SELECT asset_id, storage_root, storage_rel_path
                FROM actra_hosted_assets
                WHERE owner_user_id = %s
                """,
                (clean_user_id,),
            )
            for row in cur.fetchall() or []:
                storage_root = str((row or [None, None, None])[1] or "").strip()
                storage_rel_path = str((row or [None, None, None])[2] or "").strip()
                resolved_path = _resolve_managed_storage_path(ctx, storage_root, storage_rel_path)
                if resolved_path is not None:
                    owned_asset_paths.append(resolved_path)

            cur.execute(
                """
                SELECT deck_id
                FROM actra_hosted_microcards_decks
                WHERE coalesce(payload->'meta'->>'created_by_user_id', '') = %s
                """,
                (clean_user_id,),
            )
            for row in cur.fetchall() or []:
                deck_id = str((row or [None])[0] or "").strip()
                if deck_id:
                    owned_microcards_deck_ids.append(deck_id)

            cur.execute(
                """
                DELETE FROM actra_hosted_progress_documents
                WHERE user_id = %s
                """,
                (clean_user_id,),
            )
            report["progress_deleted"] = int(cur.rowcount or 0)

            cur.execute(
                """
                DELETE FROM actra_hosted_complex_statistics_documents
                WHERE user_id = %s
                """,
                (clean_user_id,),
            )
            report["statistics_deleted"] = int(cur.rowcount or 0)

            cur.execute(
                """
                DELETE FROM actra_hosted_calendar_documents
                WHERE user_id = %s
                """,
                (clean_user_id,),
            )
            report["calendar_docs_deleted"] = int(cur.rowcount or 0)

            cur.execute(
                """
                DELETE FROM actra_hosted_microcards_user_documents
                WHERE user_id = %s
                """,
                (clean_user_id,),
            )
            report["microcards_review_docs_deleted"] = int(cur.rowcount or 0)

            cur.execute(
                """
                DELETE FROM actra_complex_library_entries
                WHERE user_id = %s
                """,
                (clean_user_id,),
            )
            report["catalog_complex_entries_deleted"] += int(cur.rowcount or 0)

            cur.execute(
                """
                DELETE FROM actra_theory_library_entries
                WHERE user_id = %s
                """,
                (clean_user_id,),
            )
            report["catalog_theory_entries_deleted"] += int(cur.rowcount or 0)

            for item_id in owned_complex_item_ids:
                cur.execute(
                    """
                    DELETE FROM actra_complex_library_entries
                    WHERE catalog_item_id = %s
                    """,
                    (item_id,),
                )
                report["catalog_complex_entries_deleted"] += int(cur.rowcount or 0)

            for item_id in owned_theory_item_ids:
                cur.execute(
                    """
                    DELETE FROM actra_theory_library_entries
                    WHERE catalog_item_id = %s
                    """,
                    (item_id,),
                )
                report["catalog_theory_entries_deleted"] += int(cur.rowcount or 0)

            cur.execute(
                """
                DELETE FROM actra_catalog_versions
                WHERE owner_user_id = %s
                """,
                (clean_user_id,),
            )
            report["catalog_versions_deleted"] = int(cur.rowcount or 0)

            cur.execute(
                """
                DELETE FROM actra_catalog_items
                WHERE owner_user_id = %s
                """,
                (clean_user_id,),
            )
            report["catalog_items_deleted"] = int(cur.rowcount or 0)

            cur.execute(
                """
                DELETE FROM actra_hosted_microcards_decks
                WHERE coalesce(payload->'meta'->>'created_by_user_id', '') = %s
                """,
                (clean_user_id,),
            )
            report["microcards_decks_deleted"] = int(cur.rowcount or 0)

            cur.execute(
                """
                DELETE FROM actra_hosted_assets
                WHERE owner_user_id = %s
                """,
                (clean_user_id,),
            )
            report["assets_deleted"] = int(cur.rowcount or 0)

    for asset_path in owned_asset_paths:
        try:
            if asset_path.exists() and asset_path.is_file():
                asset_path.unlink(missing_ok=True)
                report["asset_files_deleted"] += 1
        except Exception:
            logger.warning("[HTTP] Failed to remove managed asset blob %s during account deletion", asset_path, exc_info=True)

    decks_root = Path(ctx.data_dir) / "microcards" / "decks"
    for deck_id in owned_microcards_deck_ids:
        deck_path = decks_root / f"{deck_id}.json"
        try:
            if deck_path.exists() and deck_path.is_file():
                deck_path.unlink(missing_ok=True)
        except Exception:
            logger.warning("[HTTP] Failed to remove shadow microcards deck %s during account deletion", deck_path, exc_info=True)

    runtime_user_root = persistence_settings.user_runtime_root(clean_user_id) if persistence_settings is not None else None
    if runtime_user_root and runtime_user_root.exists():
        shutil.rmtree(runtime_user_root, ignore_errors=True)

    return report


def _delete_hosted_account_related_data(ctx: Any, user: Any) -> Dict[str, int]:
    clean_user_id = str(getattr(user, "user_id", "") or "").strip()
    if not clean_user_id:
        return {}

    report: Dict[str, int] = {}
    report.update(_delete_user_owned_workspace_content(ctx, clean_user_id))
    report.update(_delete_owned_hosted_postgres_records(ctx, clean_user_id))
    report["avatar_files_deleted"] = _delete_user_avatar_files(ctx, user)
    return report


# ---------------------------------------------------------------------------
# List users
# ---------------------------------------------------------------------------

@users_bp.route("/api/users", methods=["GET"])
def list_users() -> Any:
    """List all available user profiles."""
    try:
        if is_hosted_web_runtime():
            return jsonify({"ok": False, "error": "legacy_profiles_api_disabled"}), 403
        users = get_ctx().user_service.get_all_users()
        items = [u.to_api_dict() for u in users]
        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        logger.exception("[HTTP] Failed to list users: %s", exc)
        return jsonify({"ok": False, "error": "list_users_failed"}), 500


# ---------------------------------------------------------------------------
# Create user
# ---------------------------------------------------------------------------

@users_bp.route("/api/users", methods=["POST"])
def create_user() -> Any:
    """Create a new user profile."""
    try:
        if is_hosted_web_runtime():
            return jsonify({"ok": False, "error": "use_auth_register"}), 410
        payload = request.get_json(silent=True) or {}
        name = payload.get("name")
        if not name or not name.strip():
            return (
                jsonify(
                    {"ok": False, "error": "name_required", "message": "Имя не может быть пустым"}
                ),
                400,
            )

        ctx = get_ctx()
        user_service = ctx.user_service

        consent_payload = _h("extract_consent_payload")(payload)
        legacy_implicit_consent = not _h("has_explicit_consent_payload")(payload)
        if legacy_implicit_consent:
            # Backward compatibility: old clients/tests send only `name`.
            required_versions = _h("required_consent_versions")()
            consent_payload = {
                "accepted": True,
                "terms_version": required_versions["terms_version"],
                "privacy_version": required_versions["privacy_version"],
            }
        validation = _h("validate_consent_payload")(consent_payload)
        if not validation.get("ok"):
            body: Dict[str, Any] = {"ok": False, "error": validation.get("error")}
            if validation.get("error") == "version_mismatch":
                body["required"] = validation.get("required")
                body["provided"] = validation.get("provided")
            return jsonify(body), int(validation.get("status_code", 400))

        avatar_seed = payload.get("avatar_seed")

        user = user_service.create_user(name.strip())

        # Apply requested avatar (if provided) after profile creation.
        if isinstance(avatar_seed, str) and avatar_seed.strip():
            user.avatar_seed = avatar_seed.strip()
            user_service.update_user(user)

        _h("write_user_consent")(
            user.user_id,
            consent_payload["terms_version"],
            consent_payload["privacy_version"],
            source=(
                "profile_create_legacy_implicit" if legacy_implicit_consent else "profile_create"
            ),
        )
        return jsonify({"ok": True, "user": user.to_api_dict()})
    except ValueError as ve:
        # Ошибки валидации
        logger.warning(f"[HTTP] User creation validation error: {ve}")
        return jsonify({"ok": False, "error": "validation_error", "message": str(ve)}), 400
    except Exception as exc:
        # Системные ошибки
        logger.exception(f"[HTTP] Failed to create user: {exc}")
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "user_creation_failed",
                    "message": "Внутренняя ошибка сервера",
                }
            ),
            500,
        )


# ---------------------------------------------------------------------------
# Current user
# ---------------------------------------------------------------------------

@users_bp.route("/api/users/current", methods=["GET"])
def get_current_user() -> Any:
    """Get the currently active user profile."""
    try:
        user_id = get_current_user_id(guest_if_missing=False) if is_hosted_web_runtime() else get_ctx().user_id
        if is_hosted_web_runtime() and not user_id:
            return jsonify({"ok": False, "error": "authentication_required"}), 401
        user_info = _get_user_info_dict(user_id)
        if not user_info:
            return jsonify({"ok": False, "error": "user_not_found"}), 404
        return jsonify({"ok": True, "user": user_info})
    except Exception as exc:
        logger.exception("[HTTP] Failed to get current user: %s", exc)
        return jsonify({"ok": False, "error": "user_get_failed"}), 500


@users_bp.route("/api/workspace-limits/summary", methods=["GET"])
def get_workspace_limits_summary() -> Any:
    try:
        user_id = get_current_user_id(guest_if_missing=False) if is_hosted_web_runtime() else get_ctx().user_id
        clean_user_id = str(user_id or "").strip()
        if is_hosted_web_runtime() and not clean_user_id:
            return jsonify({"ok": False, "error": "authentication_required"}), 401
        if clean_user_id == "guest":
            return jsonify({"ok": False, "error": "guest_cannot_read_workspace_limits"}), 403
        payload = get_ctx().workspace_limits_service.get_summary(clean_user_id)
        return jsonify(payload)
    except Exception as exc:
        logger.exception("[HTTP] Failed to get workspace limits summary: %s", exc)
        return jsonify({"ok": False, "error": "workspace_limits_summary_failed"}), 500


# ---------------------------------------------------------------------------
# Select user
# ---------------------------------------------------------------------------

@users_bp.route("/api/users/select", methods=["POST"])
def select_user() -> Any:
    """Switch the current active user."""
    try:
        if is_hosted_web_runtime():
            return jsonify({"ok": False, "error": "use_auth_login"}), 410
        payload = request.get_json(silent=True) or {}
        user_id = payload.get("user_id")
        if not user_id:
            return jsonify({"ok": False, "error": "user_id_required"}), 400
        if user_id == "guest":
            return jsonify({"ok": False, "error": "guest_mode_removed"}), 400

        ctx = get_ctx()
        success = ctx.switch_user(user_id)
        if not success:
            return jsonify({"ok": False, "error": "user_switch_failed"}), 404

        user_info = _get_user_info_dict(ctx.user_id)
        return jsonify({"ok": True, "user": user_info})
    except Exception as exc:
        logger.exception("[HTTP] Failed to switch user: %s", exc)
        return jsonify({"ok": False, "error": "user_switch_failed"}), 500


# ---------------------------------------------------------------------------
# Update user
# ---------------------------------------------------------------------------

@users_bp.route("/api/users/update", methods=["POST"])
def update_user_profile() -> Any:
    """Update user profile details (name, avatar, password, etc.)."""
    try:
        payload = request.get_json(silent=True) or {}
        ctx = get_ctx()
        user_service = ctx.user_service
        user_id = _resolve_user_id_from_request(payload)
        if is_hosted_web_runtime() and not user_id:
            return jsonify({"ok": False, "error": "authentication_required"}), 401

        user = user_service.get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        if user.password_hash and user.security_settings.get("require_password_on_edit"):
            password = payload.get("verification_password")
            if not password:
                return jsonify({"ok": False, "error": "password_required_for_edit"}), 401

            if not user_service.verify_password(user_id, password):
                return jsonify({"ok": False, "error": "invalid_password"}), 401

        requested_email = None
        current_email = _normalize_email(user_service, getattr(user, "email", ""))
        current_pending_email = _normalize_email(user_service, getattr(user, "pending_email", ""))

        if "name" in payload:
            name = payload["name"].strip()
            if not name or len(name) < 2 or len(name) > 50:
                return (
                    jsonify(
                        {
                            "ok": False,
                            "error": "invalid_name_length",
                            "message": "Имя должно содержать от 2 до 50 символов",
                        }
                    ),
                    400,
                )

            forbidden_chars = ["/", "\\", "<", ">", ":", "\"", "|", "?", "*"]
            if any(char in name for char in forbidden_chars):
                return (
                    jsonify(
                        {
                            "ok": False,
                            "error": "invalid_name_chars",
                            "message": "Имя содержит недопустимые символы",
                        }
                    ),
                    400,
                )

            if name.lower() != user.name.lower() and _name_exists(
                user_service,
                name,
                exclude_user_id=user.user_id,
            ):
                return (
                    jsonify(
                        {
                            "ok": False,
                            "error": "duplicate_name",
                            "message": "Пользователь с таким именем уже существует",
                        }
                    ),
                    400,
                )

            user.name = name

        if "email" in payload:
            email = _normalize_email(user_service, payload.get("email"))
            try:
                _validate_email(user_service, email)
            except ValueError as exc:
                error_code = str(exc) if str(exc) in {"email_required", "invalid_email"} else "invalid_email"
                return jsonify({"ok": False, "error": error_code}), 400

            if is_hosted_web_runtime():
                requested_email = email
                if requested_email not in {current_email, current_pending_email}:
                    limited = _apply_settings_rate_limit("change_email")
                    if limited is not None:
                        return limited
                    if (
                        _email_exists(user_service, requested_email, exclude_user_id=user.user_id)
                        or _pending_email_exists(user_service, requested_email, exclude_user_id=user.user_id)
                    ):
                        return _email_change_unavailable_response()
            else:
                if email != current_email and _email_exists(
                    user_service,
                    email,
                    exclude_user_id=user.user_id,
                ):
                    return jsonify({"ok": False, "error": "email_already_exists"}), 400
                user.email = email

        if "avatar_seed" in payload:
            user.avatar_seed = payload["avatar_seed"]
        if "password" in payload:
            pwd = payload["password"]
            if pwd:
                user.password_hash = bcrypt.hashpw(pwd.encode("utf-8"), bcrypt.gensalt()).decode(
                    "utf-8"
                )
                user.security_settings["require_password_on_login"] = True
            else:
                user.password_hash = None
                user.security_settings["require_password_on_login"] = False
        if "security_settings" in payload:
            user.security_settings.update(payload["security_settings"])

        try:
            success = user_service.update_user(user)
        except HostedShadowWriteFallbackDisabledError:
            shadow_success = _try_self_service_shadow_profile_update(
                user_service,
                user,
                operation="change_password",
            )
            if shadow_success is None:
                raise
            success = shadow_success
        if not success:
            return jsonify({"ok": False, "error": "update_failed"}), 500

        refreshed_user = user_service.get_user(user.user_id) or user

        if is_hosted_web_runtime() and requested_email is not None:
            pending_issuer = _h("issue_auth_pending_email_verification_email")
            if requested_email == current_email:
                return jsonify(
                    {
                        "ok": True,
                        "user": refreshed_user.to_api_dict(),
                        "email_change_pending": bool(getattr(refreshed_user, "pending_email", None)),
                    }
                )

            if requested_email != current_pending_email:
                stager = getattr(user_service, "stage_pending_email_change", None)
                if not callable(stager):
                    return jsonify({"ok": False, "error": "email_change_unavailable"}), 501
                staged_user = stager(refreshed_user.user_id, requested_email)
                if staged_user is None:
                    return jsonify({"ok": False, "error": "update_failed"}), 500
                refreshed_user = user_service.get_user(refreshed_user.user_id) or staged_user

            verification_email = pending_issuer(
                refreshed_user,
                request_base_url=request.host_url,
            )
            refreshed_user = user_service.get_user(refreshed_user.user_id) or refreshed_user
            if not bool(verification_email.get("sent")):
                return _email_delivery_error_response(verification_email, refreshed_user)

            return jsonify(
                {
                    "ok": True,
                    "user": refreshed_user.to_api_dict(),
                    "email_change_pending": True,
                    "verification_email": verification_email,
                }
            )

        return jsonify({"ok": True, "user": refreshed_user.to_api_dict()})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to update user profile: %s", exc)
        return jsonify({"ok": False, "error": "user_update_failed"}), 500


@users_bp.route("/api/users/resend-email-change", methods=["POST"])
def resend_user_email_change() -> Any:
    """Re-send verification email for a pending hosted email change."""
    try:
        if not is_hosted_web_runtime():
            return jsonify({"ok": False, "error": "hosted_only"}), 410

        user_id = _require_hosted_authenticated_user_id()
        if not user_id:
            return jsonify({"ok": False, "error": "authentication_required"}), 401

        user_service = get_ctx().user_service
        user = user_service.get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404
        if not str(getattr(user, "pending_email", "") or "").strip():
            return jsonify({"ok": False, "error": "pending_email_missing"}), 400
        limited = _apply_settings_rate_limit("resend_email_change")
        if limited is not None:
            return limited

        verification_email = _h("issue_auth_pending_email_verification_email")(
            user,
            request_base_url=request.host_url,
        )
        refreshed_user = user_service.get_user(user.user_id) or user
        if not bool(verification_email.get("sent")):
            return _email_delivery_error_response(verification_email, refreshed_user)

        return jsonify(
            {
                "ok": True,
                "user": refreshed_user.to_api_dict(),
                "email_change_pending": True,
                "verification_email": verification_email,
            }
        )
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to resend pending email change verification: %s", exc)
        return jsonify({"ok": False, "error": "resend_email_change_failed"}), 500


@users_bp.route("/api/users/change-password", methods=["POST"])

def change_user_password() -> Any:
    """Change the current user's password with explicit current-password verification."""
    try:
        payload = request.get_json(silent=True) or {}
        user_id = _resolve_user_id_from_request(payload)
        if is_hosted_web_runtime() and not user_id:
            return jsonify({"ok": False, "error": "authentication_required"}), 401

        user_service = get_ctx().user_service
        user = user_service.get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        current_password = str(payload.get("current_password") or "")
        new_password = str(payload.get("new_password") or "")

        if len(new_password) < 8:
            return jsonify({"ok": False, "error": "invalid_password"}), 400

        if user.password_hash:
            if not current_password:
                return jsonify({"ok": False, "error": "current_password_required"}), 400
            if not user_service.verify_password(user.user_id, current_password):
                return jsonify({"ok": False, "error": "current_password_invalid"}), 401

        user.password_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode(
            "utf-8"
        )
        user.security_settings["require_password_on_login"] = True
        try:
            success = user_service.update_user(user)
        except HostedShadowWriteFallbackDisabledError:
            shadow_success = _try_self_service_shadow_profile_update(
                user_service,
                user,
                operation="update_profile",
            )
            if shadow_success is None:
                raise
            success = shadow_success
        if not success:
            return jsonify({"ok": False, "error": "update_failed"}), 500

        return jsonify({"ok": True})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to change user password: %s", exc)
        return jsonify({"ok": False, "error": "password_change_failed"}), 500


# ---------------------------------------------------------------------------
# Verify password
# ---------------------------------------------------------------------------

@users_bp.route("/api/users/verify-password", methods=["POST"])
def verify_user_password() -> Any:
    """Verify a user password without switching or updating."""
    try:
        payload = request.get_json(silent=True) or {}
        if is_hosted_web_runtime():
            user_id = _require_hosted_authenticated_user_id()
            if not user_id:
                return jsonify({"ok": False, "error": "authentication_required"}), 401
        else:
            user_id = payload.get("user_id")
        password = payload.get("password")

        if not user_id or not password:
            return jsonify({"ok": False, "error": "params_missing"}), 400

        user_service = get_ctx().user_service
        user = user_service.get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        if not user.password_hash:
            return jsonify({"ok": True, "verified": True})

        is_valid = user_service.verify_password(user_id, password)
        return jsonify({"ok": True, "verified": is_valid})
    except Exception as exc:
        logger.exception("[HTTP] Failed to verify password: %s", exc)
        return jsonify({"ok": False, "error": "verify_failed"}), 500


# ---------------------------------------------------------------------------
# Delete user
# ---------------------------------------------------------------------------

@users_bp.route("/api/users/delete", methods=["POST"])
def delete_user_profile() -> Any:
    """Delete user profile and all its data."""
    try:
        payload = request.get_json(silent=True) or {}
        if is_hosted_web_runtime():
            user_id = _require_hosted_authenticated_user_id()
            if not user_id:
                return jsonify({"ok": False, "error": "authentication_required"}), 401
        else:
            user_id = payload.get("user_id")

        if not user_id:
            return jsonify({"ok": False, "error": "user_id_required"}), 400

        ctx = get_ctx()
        user_service = ctx.user_service

        # Verify password if set
        user = user_service.get_user(user_id)
        if user and user.password_hash:
            password = payload.get("verification_password")
            if not password:
                return jsonify({"ok": False, "error": "password_required_for_delete"}), 401

            if not user_service.verify_password(user_id, password):
                return jsonify({"ok": False, "error": "invalid_password"}), 401

        if is_hosted_web_runtime() and user is not None:
            _delete_hosted_account_related_data(ctx, user)

        success = user_service.delete_user(user_id)
        if not success:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        # If deleted user was current, switch to another existing user if possible.
        if is_hosted_web_runtime():
            logout_authenticated_user()
        elif ctx.user_id == user_id:
            remaining = user_service.get_all_users()
            if remaining:
                ctx.switch_user(remaining[0].user_id)
            else:
                ctx.user_id = ""
                ctx.session_api.default_user_id = ""
                user_service.save_last_user_id("")

        return jsonify({"ok": True})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to delete user profile: %s", exc)
        return jsonify({"ok": False, "error": "delete_failed"}), 500


# ---------------------------------------------------------------------------
# AI Keys management
# ---------------------------------------------------------------------------

_ALLOWED_AI_PROVIDERS = {"openrouter", "gemini", "groq"}

_PROVIDER_META = {
    "openrouter": {
        "label": "OpenRouter",
        "hint": "Получите бесплатный ключ на openrouter.ai/keys",
        "url": "https://openrouter.ai/keys",
        "prefix": "sk-or-",
    },
    "gemini": {
        "label": "Google Gemini",
        "hint": "Получите ключ на aistudio.google.com/apikey",
        "url": "https://aistudio.google.com/apikey",
        "prefix": "AI",
    },
    "groq": {
        "label": "Groq",
        "hint": "Получите ключ на console.groq.com/keys",
        "url": "https://console.groq.com/keys",
        "prefix": "gsk_",
    },
}


def _mask_key(key: str) -> str:
    """Mask an API key for safe display: show first 6 and last 4 chars."""
    if not key or len(key) < 12:
        return "****" if key else ""
    return key[:6] + "****" + key[-4:]


@users_bp.route("/api/users/ai-keys", methods=["GET"])
def get_ai_keys() -> Any:
    """Return current user's AI keys (masked) and provider metadata."""
    try:
        ctx = get_ctx()
        user_id = _require_hosted_authenticated_user_id() if is_hosted_web_runtime() else ctx.user_id
        if is_hosted_web_runtime() and not user_id:
            return jsonify({"ok": False, "error": "authentication_required"}), 401
        user = ctx.user_service.get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        ai_keys = (user.settings or {}).get("ai_keys", {})
        if not isinstance(ai_keys, dict):
            ai_keys = {}

        masked = {}
        has_any = False
        for name in ("openrouter", "gemini", "groq"):
            raw = str(ai_keys.get(name, "") or "").strip()
            masked[name] = {
                "masked": _mask_key(raw),
                "has_key": bool(raw),
                **_PROVIDER_META.get(name, {}),
            }
            if raw:
                has_any = True

        return jsonify({
            "ok": True,
            "providers": masked,
            "has_any_key": has_any,
        })
    except Exception as exc:
        logger.exception("[HTTP] Failed to get AI keys: %s", exc)
        return jsonify({"ok": False, "error": "ai_keys_get_failed"}), 500


@users_bp.route("/api/users/ai-keys", methods=["POST"])
def save_ai_keys() -> Any:
    """Save AI keys to current user's profile settings and reload AI service."""
    try:
        ctx = get_ctx()
        user_service = ctx.user_service
        user_id = _require_hosted_authenticated_user_id() if is_hosted_web_runtime() else ctx.user_id
        if is_hosted_web_runtime() and not user_id:
            return jsonify({"ok": False, "error": "authentication_required"}), 401
        user = user_service.get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        payload = request.get_json(silent=True) or {}
        keys_input = payload.get("keys", {})
        if not isinstance(keys_input, dict):
            return jsonify({"ok": False, "error": "invalid_payload"}), 400

        # Merge with existing keys so partial updates do not wipe untouched providers.
        existing_keys = (user.settings or {}).get("ai_keys", {})
        if not isinstance(existing_keys, dict):
            existing_keys = {}
        clean_keys: Dict[str, str] = {
            name: str(existing_keys.get(name, "") or "").strip()
            for name in _ALLOWED_AI_PROVIDERS
            if str(existing_keys.get(name, "") or "").strip()
        }
        for name in _ALLOWED_AI_PROVIDERS:
            if name not in keys_input:
                continue
            val = str(keys_input.get(name, "") or "").strip()
            if val:
                clean_keys[name] = val
            else:
                clean_keys.pop(name, None)

        # Save into user settings
        if user.settings is None:
            user.settings = {}
        user.settings["ai_keys"] = clean_keys
        try:
            success = user_service.update_user(user)
        except HostedShadowWriteFallbackDisabledError:
            shadow_success = _try_self_service_shadow_profile_update(
                user_service,
                user,
                operation="save_ai_keys",
            )
            if shadow_success is None:
                raise
            success = shadow_success
        if not success:
            return jsonify({"ok": False, "error": "save_failed"}), 500

        # Reload AI service with new keys
        from routes._context import get_ai_service
        ai_svc = get_ai_service()
        if ai_svc is not None:
            if clean_keys:
                ai_svc.apply_user_keys(clean_keys)
            else:
                ai_svc.reload_config()

        return jsonify({
            "ok": True,
            "has_any_key": bool(clean_keys),
            "configured_providers": list(clean_keys.keys()),
        })
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to save AI keys: %s", exc)
        return jsonify({"ok": False, "error": "ai_keys_save_failed"}), 500


@users_bp.route("/api/users/ai-keys/validate", methods=["POST"])
def validate_ai_key() -> Any:
    """Validate a single AI key by pinging the provider."""
    try:
        payload = request.get_json(silent=True) or {}
        provider_name = str(payload.get("provider", "")).strip()
        api_key = str(payload.get("api_key", "")).strip()

        if provider_name not in _ALLOWED_AI_PROVIDERS:
            return jsonify({"ok": False, "error": "unknown_provider"}), 400
        if not api_key:
            return jsonify({"ok": False, "error": "empty_key"}), 400

        from routes._context import get_ai_service
        ai_svc = get_ai_service()
        if ai_svc is None:
            return jsonify({"ok": False, "error": "ai_service_unavailable"}), 503

        # Build a temporary provider and ping it
        from services.ai_generation_service import (
            OpenRouterProvider, GeminiProvider, GroqProvider,
        )
        provider_classes = {
            "openrouter": OpenRouterProvider,
            "gemini": GeminiProvider,
            "groq": GroqProvider,
        }
        cls = provider_classes.get(provider_name)
        if cls is None:
            return jsonify({"ok": False, "error": "unknown_provider"}), 400

        provider = cls(api_key=api_key, timeout=15)
        is_valid = provider.ping()

        return jsonify({
            "ok": True,
            "valid": is_valid,
            "provider": provider_name,
        })
    except Exception as exc:
        logger.exception("[HTTP] AI key validation failed: %s", exc)
        return jsonify({"ok": False, "error": "validation_failed"}), 500


# ---------------------------------------------------------------------------
# Avatars
# ---------------------------------------------------------------------------

@users_bp.route("/api/users/avatar", methods=["POST"])
def upload_user_avatar() -> Any:
    """Upload and save a custom avatar for the current user."""
    try:
        user_id = _resolve_user_id_from_request()
        if is_hosted_web_runtime() and not user_id:
            return jsonify({"ok": False, "error": "authentication_required"}), 401

        ctx = get_ctx()
        user_service = ctx.user_service
        user = user_service.get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        upload = request.files.get("file")
        if upload is None or not str(upload.filename or "").strip():
            return jsonify({"ok": False, "error": "file_required"}), 400

        avatar_dir = Path(ctx.data_dir) / "avatars"
        avatar_dir.mkdir(parents=True, exist_ok=True)

        try:
            from PIL import Image, ImageOps  # type: ignore

            upload.stream.seek(0)
            with Image.open(upload.stream) as src:
                detected_format = str(src.format or "").upper()
                if detected_format not in _ALLOWED_AVATAR_INPUT_FORMATS:
                    return jsonify({"ok": False, "error": "unsupported_image_type"}), 400

                image = ImageOps.exif_transpose(src).convert("RGBA")
                resampling = getattr(Image, "Resampling", Image)
                crop_side = max(1, min(image.width, image.height))
                crop_left = max(0, (image.width - crop_side) // 2)
                crop_top = max(0, (image.height - crop_side) // 2)
                image = image.crop(
                    (
                        crop_left,
                        crop_top,
                        crop_left + crop_side,
                        crop_top + crop_side,
                    )
                )
                canvas = image.resize(
                    (_AVATAR_RENDER_SIZE, _AVATAR_RENDER_SIZE),
                    resampling.LANCZOS,
                )

                avatar_name = f"user-{user.user_id}-{uuid.uuid4().hex[:12]}.png"
                avatar_path = avatar_dir / avatar_name
                canvas.save(avatar_path, format="PNG", optimize=True)
        except Exception as exc:
            logger.warning("[HTTP] Avatar upload rejected for %s: %s", user_id, exc)
            return jsonify({"ok": False, "error": "invalid_image"}), 400

        previous_avatar = user.avatar_seed
        user.avatar_seed = avatar_name
        try:
            updated = user_service.update_user(user)
        except HostedShadowWriteFallbackDisabledError:
            shadow_success = _try_self_service_shadow_profile_update(
                user_service,
                user,
                operation="upload_avatar",
            )
            if shadow_success is None:
                raise
            updated = shadow_success
        if not updated:
            try:
                avatar_path.unlink(missing_ok=True)
            except Exception:
                pass
            user.avatar_seed = previous_avatar
            return jsonify({"ok": False, "error": "update_failed"}), 500

        return jsonify({"ok": True, "user": user.to_api_dict()})
    except Exception as exc:
        degraded_response = _maybe_hosted_shadow_write_error_response(exc)
        if degraded_response is not None:
            return degraded_response
        logger.exception("[HTTP] Failed to upload user avatar: %s", exc)
        return jsonify({"ok": False, "error": "avatar_upload_failed"}), 500


@users_bp.route("/api/assets/avatars", methods=["GET"])
def list_avatars() -> Any:
    """List available custom avatar files."""
    try:
        avatar_dir = Path(get_ctx().data_dir) / "avatars"
        if not avatar_dir.exists():
            avatar_dir.mkdir(parents=True, exist_ok=True)

        extensions = {".png", ".jpg", ".jpeg", ".svg", ".webp"}
        files = [
            f.name
            for f in avatar_dir.iterdir()
            if f.suffix.lower() in extensions and not _is_legacy_default_avatar(f.name)
        ]
        return jsonify({"ok": True, "files": sorted(files)})
    except Exception as exc:
        logger.exception("[HTTP] Failed to list avatars: %s", exc)
        return jsonify({"ok": False, "error": "list_failed"}), 500


@users_bp.route("/api/assets/avatars/<path:filename>")
def serve_avatar(filename: str) -> Any:
    """Serve custom user avatars from the data/avatars folder."""
    avatar_dir = Path(get_ctx().data_dir) / "avatars"
    if not avatar_dir.exists():
        avatar_dir.mkdir(parents=True, exist_ok=True)
    if _is_legacy_default_avatar(filename):
        try:
            requested_size = int(str(request.args.get("size") or "256"))
        except Exception:
            requested_size = 256
        resp = send_file(io.BytesIO(_build_default_avatar_svg(requested_size)), mimetype="image/svg+xml")
        try:
            resp.headers["Cache-Control"] = "public, max-age=300"
        except Exception:
            pass
        return resp
    trim_param = str(request.args.get("trim") or "").strip().lower()
    trim_enabled = trim_param in {"1", "true", "yes", "on"}

    if not trim_enabled:
        return send_from_directory(str(avatar_dir), filename)

    try:
        base_dir = avatar_dir.resolve()
        target = (base_dir / filename).resolve()
        if not target.exists() or not target.is_file():
            return jsonify({"ok": False, "error": "avatar_not_found"}), 404
        try:
            target.relative_to(base_dir)
        except ValueError:
            return jsonify({"ok": False, "error": "avatar_path_invalid"}), 400

        # Keep SVG/raw files untouched; trim is useful for raster avatars with white margins.
        if target.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            return send_file(str(target))

        try:
            requested_size = int(str(request.args.get("size") or "256"))
        except Exception:
            requested_size = 256
        requested_size = max(64, min(1024, requested_size))

        from PIL import Image  # type: ignore

        with Image.open(target) as src:
            img = src.convert("RGBA")
            pixels = img.load()
            w, h = img.size

            # Convert near-white pixels to transparent so outer white paddings disappear.
            for y in range(h):
                for x in range(w):
                    r, g, b, a = pixels[x, y]
                    if a > 0 and r >= 245 and g >= 245 and b >= 245:
                        pixels[x, y] = (r, g, b, 0)

            bbox = img.getbbox()
            if bbox:
                img = img.crop(bbox)

            iw, ih = img.size
            side = max(iw, ih, 1)
            square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            square.paste(img, ((side - iw) // 2, (side - ih) // 2))

            if side != requested_size:
                resampling = getattr(Image, "Resampling", Image)
                square = square.resize((requested_size, requested_size), resampling.LANCZOS)

            out = io.BytesIO()
            square.save(out, format="PNG", optimize=True)
            out.seek(0)

        resp = send_file(out, mimetype="image/png")
        try:
            resp.headers["Cache-Control"] = "public, max-age=300"
        except Exception:
            pass
        return resp
    except Exception as exc:
        logger.warning("[HTTP] Avatar trim failed for %s: %s", filename, exc)
        return send_from_directory(str(avatar_dir), filename)
