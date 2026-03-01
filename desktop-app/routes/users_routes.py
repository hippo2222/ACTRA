"""Users & Profiles API routes.

Endpoints:
- GET    /api/users                  - List all user profiles
- POST   /api/users                  - Create a new user profile
- GET    /api/users/current          - Get currently active user
- POST   /api/users/select           - Switch active user
- POST   /api/users/update           - Update user profile
- POST   /api/users/verify-password  - Verify user password
- POST   /api/users/delete           - Delete user profile
- GET    /api/assets/avatars         - List available avatar files
- GET    /api/assets/avatars/<path>  - Serve avatar image
"""

import io
import logging
from pathlib import Path
from typing import Any, Dict, Optional

import bcrypt
from flask import Blueprint, jsonify, request, send_file, send_from_directory

from routes._context import get_ctx, get_extra

logger = logging.getLogger(__name__)

users_bp = Blueprint("users", __name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _h(name: str):
    """Get a server helper function by name."""
    helpers = get_extra("server_helpers", {})
    return helpers[name]


def _get_user_info_dict(user_id: str) -> Optional[Dict[str, Any]]:
    """Helper to return a flat user dict for an existing profile."""
    user = get_ctx().user_service.get_user(user_id)
    return user.to_api_dict() if user else None


# ---------------------------------------------------------------------------
# List users
# ---------------------------------------------------------------------------

@users_bp.route("/api/users", methods=["GET"])
def list_users() -> Any:
    """List all available user profiles."""
    try:
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
        user_info = _get_user_info_dict(get_ctx().user_id)
        if not user_info:
            return jsonify({"ok": False, "error": "user_not_found"}), 404
        return jsonify({"ok": True, "user": user_info})
    except Exception as exc:
        logger.exception("[HTTP] Failed to get current user: %s", exc)
        return jsonify({"ok": False, "error": "user_get_failed"}), 500


# ---------------------------------------------------------------------------
# Select user
# ---------------------------------------------------------------------------

@users_bp.route("/api/users/select", methods=["POST"])
def select_user() -> Any:
    """Switch the current active user."""
    try:
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
        user_id = payload.get("user_id") or ctx.user_id

        user = user_service.get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        # Check for password if required by current security settings
        if user.password_hash and user.security_settings.get("require_password_on_edit"):
            password = payload.get("verification_password")
            if not password:
                return jsonify({"ok": False, "error": "password_required_for_edit"}), 401

            if not user_service.verify_password(user_id, password):
                return jsonify({"ok": False, "error": "invalid_password"}), 401

        # Apply updates
        if "name" in payload:
            name = payload["name"].strip()
            # Validate name
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

            # Check forbidden characters
            forbidden_chars = ["/", "\\", "<", ">", ":", '"', "|", "?", "*"]
            if any(char in name for char in forbidden_chars):
                return (
                    jsonify(
                        {
                            "ok": False,
                            "error": "invalid_name_chars",
                            "message": f"Имя содержит недопустимые символы",
                        }
                    ),
                    400,
                )

            # Check duplicate name (only if name is actually changing)
            if name.lower() != user.name.lower() and user_service._check_duplicate_name(name):
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
        if "avatar_seed" in payload:
            user.avatar_seed = payload["avatar_seed"]
        if "password" in payload:
            # Empty password means remove password
            pwd = payload["password"]
            if pwd:
                # Use bcrypt for new passwords
                user.password_hash = bcrypt.hashpw(pwd.encode("utf-8"), bcrypt.gensalt()).decode(
                    "utf-8"
                )
            else:
                user.password_hash = None
        if "security_settings" in payload:
            user.security_settings.update(payload["security_settings"])

        success = user_service.update_user(user)
        if not success:
            return jsonify({"ok": False, "error": "update_failed"}), 500

        return jsonify({"ok": True, "user": user.to_api_dict()})
    except Exception as exc:
        logger.exception("[HTTP] Failed to update user profile: %s", exc)
        return jsonify({"ok": False, "error": "user_update_failed"}), 500


# ---------------------------------------------------------------------------
# Verify password
# ---------------------------------------------------------------------------

@users_bp.route("/api/users/verify-password", methods=["POST"])
def verify_user_password() -> Any:
    """Verify a user password without switching or updating."""
    try:
        payload = request.get_json(silent=True) or {}
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

        success = user_service.delete_user(user_id)
        if not success:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        # If deleted user was current, switch to another existing user if possible.
        if ctx.user_id == user_id:
            remaining = user_service.get_all_users()
            if remaining:
                ctx.switch_user(remaining[0].user_id)
            else:
                ctx.user_id = ""
                ctx.session_api.default_user_id = ""
                user_service.save_last_user_id("")

        return jsonify({"ok": True})
    except Exception as exc:
        logger.exception("[HTTP] Failed to delete user profile: %s", exc)
        return jsonify({"ok": False, "error": "delete_failed"}), 500


# ---------------------------------------------------------------------------
# Avatars
# ---------------------------------------------------------------------------

@users_bp.route("/api/assets/avatars", methods=["GET"])
def list_avatars() -> Any:
    """List available custom avatar files."""
    try:
        avatar_dir = Path(get_ctx().data_dir) / "avatars"
        if not avatar_dir.exists():
            avatar_dir.mkdir(parents=True, exist_ok=True)

        extensions = {".png", ".jpg", ".jpeg", ".svg", ".webp"}
        files = [f.name for f in avatar_dir.iterdir() if f.suffix.lower() in extensions]
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
