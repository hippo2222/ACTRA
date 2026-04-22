"""Static / UI-serving routes.

All routes that serve HTML pages and static assets (CSS, JS, images)
via ``send_from_directory``.  No business logic — pure file serving.
"""

import hashlib
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from flask import Blueprint, jsonify, redirect, send_from_directory

from routes._context import get_ctx, get_extra

logger = logging.getLogger(__name__)

static_bp = Blueprint("static_ui", __name__)


# ---------------------------------------------------------------------------
# Helpers (used only by UI routes)
# ---------------------------------------------------------------------------

def _get_ui_dirs() -> Dict[str, Path]:
    """Return the dict of UI directory paths stored during init_context."""
    return get_extra("ui_dirs", {})


def _file_debug_meta(path: Path) -> Dict[str, Any]:
    try:
        if not path.exists() or not path.is_file():
            return {"exists": False, "path": str(path)}

        raw = path.read_bytes()
        st = path.stat()
        return {
            "exists": True,
            "path": str(path),
            "size": st.st_size,
            "mtime": datetime.fromtimestamp(st.st_mtime).isoformat(),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
    except Exception as exc:
        return {"exists": False, "path": str(path), "error": str(exc)}


def _flush_log_handlers() -> None:
    try:
        candidates = [logging.getLogger(), logging.getLogger(__name__), logging.getLogger("server")]
        for lg in candidates:
            for h in list(getattr(lg, "handlers", []) or []):
                try:
                    h.flush()
                except Exception:
                    pass

        # Best-effort: flush handlers attached to any configured logger
        mgr = getattr(logging.getLogger(), "manager", None)
        logger_dict = getattr(mgr, "loggerDict", {}) if mgr else {}
        for lg in logger_dict.values():
            handlers = getattr(lg, "handlers", None)
            if not handlers:
                continue
            for h in list(handlers):
                try:
                    h.flush()
                except Exception:
                    pass
    except Exception:
        return


# ---------------------------------------------------------------------------
# Complexes UI
# ---------------------------------------------------------------------------

@static_bp.route("/ui/complexes", methods=["GET"])
def serve_complexes_ui() -> Any:
    """Serve the complexes list HTML UI (S0)."""
    dirs = _get_ui_dirs()
    COMPLEXES_UI_DIR = dirs.get("COMPLEXES_UI_DIR")
    if not COMPLEXES_UI_DIR or not COMPLEXES_UI_DIR.exists():
        logger.error("[HTTP] COMPLEXES_UI_DIR does not exist: %s", COMPLEXES_UI_DIR)
        return jsonify({"ok": False, "error": "complexes_ui_not_found"}), 500

    resp = send_from_directory(COMPLEXES_UI_DIR, "index.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/complexes/create", methods=["GET"])
def serve_complexes_create_ui() -> Any:
    dirs = _get_ui_dirs()
    COMPLEXES_UI_DIR = dirs.get("COMPLEXES_UI_DIR")
    if not COMPLEXES_UI_DIR or not COMPLEXES_UI_DIR.exists():
        logger.error("[HTTP] COMPLEXES_UI_DIR does not exist: %s", COMPLEXES_UI_DIR)
        return jsonify({"ok": False, "error": "complexes_ui_not_found"}), 500

    resp = send_from_directory(COMPLEXES_UI_DIR, "create.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


# ---------------------------------------------------------------------------
# Catalog UI
# ---------------------------------------------------------------------------

@static_bp.route("/ui/catalog", methods=["GET"])
@static_bp.route("/ui/catalog/", methods=["GET"])
def serve_catalog_ui() -> Any:
    """Serve the public catalog UI."""
    dirs = _get_ui_dirs()
    CATALOG_UI_DIR = dirs.get("CATALOG_UI_DIR")
    if not CATALOG_UI_DIR or not CATALOG_UI_DIR.exists():
        logger.error("[HTTP] CATALOG_UI_DIR does not exist: %s", CATALOG_UI_DIR)
        return jsonify({"ok": False, "error": "catalog_ui_not_found"}), 500

    resp = send_from_directory(CATALOG_UI_DIR, "index.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/catalog", methods=["GET"])
@static_bp.route("/catalog/", methods=["GET"])
def serve_catalog_ui_alias() -> Any:
    """Legacy-friendly alias for the public catalog UI."""
    return redirect("/ui/catalog")


@static_bp.route("/ui/catalog/<path:filename>", methods=["GET"])
def serve_catalog_file(filename: str) -> Any:
    """Serve Catalog static files (HTML, JS)."""
    dirs = _get_ui_dirs()
    CATALOG_UI_DIR = dirs.get("CATALOG_UI_DIR")
    if not CATALOG_UI_DIR or not CATALOG_UI_DIR.exists():
        return jsonify({"ok": False, "error": "catalog_ui_not_found"}), 500
    return send_from_directory(CATALOG_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Welcome UI
# ---------------------------------------------------------------------------

@static_bp.route("/", methods=["GET"])
def serve_root_ui_alias() -> Any:
    """Send the browser through the canonical UI entrypoint."""
    return redirect("/ui")


@static_bp.route("/ui/welcome", methods=["GET"])
def serve_welcome_ui() -> Any:
    """Serve the Welcome / onboarding screen."""
    dirs = _get_ui_dirs()
    WELCOME_UI_DIR = dirs.get("WELCOME_UI_DIR")
    if not WELCOME_UI_DIR or not WELCOME_UI_DIR.exists():
        logger.error("[HTTP] WELCOME_UI_DIR does not exist: %s", WELCOME_UI_DIR)
        return jsonify({"ok": False, "error": "welcome_ui_not_found"}), 500
    resp = send_from_directory(WELCOME_UI_DIR, "welcome.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/Welcome/<path:filename>", methods=["GET"])
def serve_welcome_static(filename: str) -> Any:
    """Serve static files (JS/CSS) for the Welcome screen."""
    dirs = _get_ui_dirs()
    WELCOME_UI_DIR = dirs.get("WELCOME_UI_DIR")
    if not WELCOME_UI_DIR or not WELCOME_UI_DIR.exists():
        return jsonify({"ok": False, "error": "welcome_ui_not_found"}), 500
    return send_from_directory(WELCOME_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Main Screen UI
# ---------------------------------------------------------------------------

@static_bp.route("/ui", methods=["GET"])
@static_bp.route("/ui/main", methods=["GET"])
def serve_main_ui() -> Any:
    dirs = _get_ui_dirs()
    MAINSCREEN_UI_DIR = dirs.get("MAINSCREEN_UI_DIR")
    if not MAINSCREEN_UI_DIR or not MAINSCREEN_UI_DIR.exists():
        logger.error("[HTTP] MAINSCREEN_UI_DIR does not exist: %s", MAINSCREEN_UI_DIR)
        return jsonify({"ok": False, "error": "mainscreen_ui_not_found"}), 500

    main_path = MAINSCREEN_UI_DIR / "Main.html"
    try:
        meta = _file_debug_meta(main_path)
        logger.info("[HTTP][UI_MAIN] serve %s", json.dumps(meta, ensure_ascii=False))
        _flush_log_handlers()
    except Exception:
        pass

    resp = send_from_directory(MAINSCREEN_UI_DIR, "Main.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


# ---------------------------------------------------------------------------
# Task UI modules (TestUI, SequenceUI, ClickUI, DrawUI, OpenAnswerUI, MistakesUI)
# ---------------------------------------------------------------------------

@static_bp.route("/ui/TestUI/<path:filename>", methods=["GET"])
def serve_testui_static(filename: str) -> Any:
    """Serve static JS/CSS/assets for the TestUI module used by S1.

    This allows paths like ../TestUI/TestUI.web.js in S1/index.html to be resolved
    as /ui/TestUI/TestUI.web.js.
    """
    dirs = _get_ui_dirs()
    TESTUI_DIR = dirs.get("TESTUI_DIR")
    if not TESTUI_DIR or not TESTUI_DIR.exists():
        logger.error("[HTTP] TESTUI_DIR does not exist: %s", TESTUI_DIR)
        return jsonify({"ok": False, "error": "testui_not_found"}), 500

    return send_from_directory(TESTUI_DIR, filename)


@static_bp.route("/ui/SequenceUI/<path:filename>", methods=["GET"])
def serve_sequenceui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    SEQUENCEUI_DIR = dirs.get("SEQUENCEUI_DIR")
    if not SEQUENCEUI_DIR or not SEQUENCEUI_DIR.exists():
        logger.error("[HTTP] SEQUENCEUI_DIR does not exist: %s", SEQUENCEUI_DIR)
        return jsonify({"ok": False, "error": "sequenceui_not_found"}), 500

    return send_from_directory(SEQUENCEUI_DIR, filename)


@static_bp.route("/ui/ClickUI/<path:filename>", methods=["GET"])
def serve_clickui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    CLICKUI_DIR = dirs.get("CLICKUI_DIR")
    if not CLICKUI_DIR or not CLICKUI_DIR.exists():
        logger.error("[HTTP] CLICKUI_DIR does not exist: %s", CLICKUI_DIR)
        return jsonify({"ok": False, "error": "clickui_not_found"}), 500

    return send_from_directory(CLICKUI_DIR, filename)


@static_bp.route("/ui/DrawUI/<path:filename>", methods=["GET"])
def serve_drawui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    DRAWUI_DIR = dirs.get("DRAWUI_DIR")
    if not DRAWUI_DIR or not DRAWUI_DIR.exists():
        logger.error("[HTTP] DRAWUI_DIR does not exist: %s", DRAWUI_DIR)
        return jsonify({"ok": False, "error": "drawui_not_found"}), 500

    return send_from_directory(DRAWUI_DIR, filename)


@static_bp.route("/ui/OpenAnswerUI/<path:filename>", methods=["GET"])
def serve_openanswerui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    OPENANSWERUI_DIR = dirs.get("OPENANSWERUI_DIR")
    if not OPENANSWERUI_DIR or not OPENANSWERUI_DIR.exists():
        logger.error("[HTTP] OPENANSWERUI_DIR does not exist: %s", OPENANSWERUI_DIR)
        return jsonify({"ok": False, "error": "openanswerui_not_found"}), 500

    return send_from_directory(OPENANSWERUI_DIR, filename)


@static_bp.route("/ui/MistakesUI/<path:filename>", methods=["GET"])
def serve_mistakesui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    MISTAKESUI_DIR = dirs.get("MISTAKESUI_DIR")
    if not MISTAKESUI_DIR or not MISTAKESUI_DIR.exists():
        logger.error("[HTTP] MISTAKESUI_DIR does not exist: %s", MISTAKESUI_DIR)
        return jsonify({"ok": False, "error": "mistakesui_not_found"}), 500

    return send_from_directory(MISTAKESUI_DIR, filename)


# ---------------------------------------------------------------------------
# Theory Center UI
# ---------------------------------------------------------------------------

@static_bp.route("/ui/theory-center", methods=["GET"])
@static_bp.route("/ui/theory-center/", methods=["GET"])
def serve_theory_center_ui() -> Any:
    """Serve the standalone Theory Center overview UI."""
    dirs = _get_ui_dirs()
    EDITOR_UI_DIR = dirs.get("EDITOR_UI_DIR")
    if not EDITOR_UI_DIR or not EDITOR_UI_DIR.exists():
        logger.error("[HTTP] EDITOR_UI_DIR does not exist: %s", EDITOR_UI_DIR)
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500

    resp = send_from_directory(EDITOR_UI_DIR, "Theory_Center.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/editor/theory_center.js", methods=["GET"])
def serve_theory_center_js() -> Any:
    """Serve the Theory Center JavaScript directly."""
    dirs = _get_ui_dirs()
    EDITOR_UI_DIR = dirs.get("EDITOR_UI_DIR")
    if not EDITOR_UI_DIR or not EDITOR_UI_DIR.exists():
        logger.error("[HTTP] EDITOR_UI_DIR does not exist: %s", EDITOR_UI_DIR)
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500
    return send_from_directory(EDITOR_UI_DIR, "theory_center.js")


@static_bp.route("/ui/theory-editor", methods=["GET"])
@static_bp.route("/ui/theory-editor/", methods=["GET"])
def serve_theory_editor_ui() -> Any:
    """Serve the Theory Editor UI."""
    dirs = _get_ui_dirs()
    EDITOR_UI_DIR = dirs.get("EDITOR_UI_DIR")
    if not EDITOR_UI_DIR or not EDITOR_UI_DIR.exists():
        logger.error("[HTTP] EDITOR_UI_DIR does not exist: %s", EDITOR_UI_DIR)
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500

    resp = send_from_directory(EDITOR_UI_DIR, "Theory_Editor.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


# ---------------------------------------------------------------------------
# Editor UI
# ---------------------------------------------------------------------------

@static_bp.route("/ui/editor", methods=["GET"])
@static_bp.route("/ui/editor/", methods=["GET"])
def serve_editor_dashboard() -> Any:
    """Serve the Editor Main Dashboard."""
    dirs = _get_ui_dirs()
    EDITOR_UI_DIR = dirs.get("EDITOR_UI_DIR")
    if not EDITOR_UI_DIR or not EDITOR_UI_DIR.exists():
        logger.error("[HTTP] EDITOR_UI_DIR does not exist: %s", EDITOR_UI_DIR)
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500

    resp = send_from_directory(EDITOR_UI_DIR, "Main_Dashboard.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/editor/<path:filename>", methods=["GET"])
def serve_editor_file(filename: str) -> Any:
    """Serve any file (HTML, CSS, JS) from the Editor directory."""
    dirs = _get_ui_dirs()
    EDITOR_UI_DIR = dirs.get("EDITOR_UI_DIR")
    if not EDITOR_UI_DIR or not EDITOR_UI_DIR.exists():
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500

    return send_from_directory(EDITOR_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Calendar UI Routes
# ---------------------------------------------------------------------------

@static_bp.route("/ui/calendar.css", methods=["GET"])
def serve_calendar_css_direct() -> Any:
    """Serve calendar.css specifically."""
    dirs = _get_ui_dirs()
    CALENDAR_UI_DIR = dirs.get("CALENDAR_UI_DIR")
    if not CALENDAR_UI_DIR or not CALENDAR_UI_DIR.exists():
        return jsonify({"ok": False, "error": "calendar_ui_not_found"}), 500
    return send_from_directory(CALENDAR_UI_DIR, "calendar.css")


@static_bp.route("/ui/calendar", methods=["GET"])
@static_bp.route("/ui/calendar/", methods=["GET"])
def serve_calendar_ui() -> Any:
    """Serve the Calendar page."""
    dirs = _get_ui_dirs()
    CALENDAR_UI_DIR = dirs.get("CALENDAR_UI_DIR")
    if not CALENDAR_UI_DIR or not CALENDAR_UI_DIR.exists():
        logger.error("[HTTP] CALENDAR_UI_DIR does not exist: %s", CALENDAR_UI_DIR)
        return jsonify({"ok": False, "error": "calendar_ui_not_found"}), 500

    resp = send_from_directory(CALENDAR_UI_DIR, "calendar.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/calendar/<path:filename>", methods=["GET"])
def serve_calendar_file(filename: str) -> Any:
    """Serve Calendar static files (CSS, JS)."""
    dirs = _get_ui_dirs()
    CALENDAR_UI_DIR = dirs.get("CALENDAR_UI_DIR")
    if not CALENDAR_UI_DIR or not CALENDAR_UI_DIR.exists():
        return jsonify({"ok": False, "error": "calendar_ui_not_found"}), 500
    return send_from_directory(CALENDAR_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Statistics UI Routes
# ---------------------------------------------------------------------------

@static_bp.route("/ui/statistics", methods=["GET"])
@static_bp.route("/ui/statistics/", methods=["GET"])
def serve_statistics_ui() -> Any:
    """Serve the Statistics page."""
    dirs = _get_ui_dirs()
    STATISTICS_UI_DIR = dirs.get("STATISTICS_UI_DIR")
    if not STATISTICS_UI_DIR or not STATISTICS_UI_DIR.exists():
        logger.error("[HTTP] STATISTICS_UI_DIR does not exist: %s", STATISTICS_UI_DIR)
        return jsonify({"ok": False, "error": "statistics_ui_not_found"}), 500

    resp = send_from_directory(STATISTICS_UI_DIR, "statistics.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/statistics/<path:filename>", methods=["GET"])
def serve_statistics_file(filename: str) -> Any:
    """Serve Statistics static files (CSS, JS)."""
    dirs = _get_ui_dirs()
    STATISTICS_UI_DIR = dirs.get("STATISTICS_UI_DIR")
    if not STATISTICS_UI_DIR or not STATISTICS_UI_DIR.exists():
        return jsonify({"ok": False, "error": "statistics_ui_not_found"}), 500
    return send_from_directory(STATISTICS_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Microcards Runtime UI Routes (M10)
# ---------------------------------------------------------------------------

@static_bp.route("/ui/microcards", methods=["GET"])
@static_bp.route("/ui/microcards/", methods=["GET"])
def serve_microcards_ui() -> Any:
    """Serve the Microcards runtime review page (M10)."""
    dirs = _get_ui_dirs()
    MICROCARDS_UI_DIR = dirs.get("MICROCARDS_UI_DIR")
    if not MICROCARDS_UI_DIR or not MICROCARDS_UI_DIR.exists():
        logger.error("[HTTP] MICROCARDS_UI_DIR does not exist: %s", MICROCARDS_UI_DIR)
        return jsonify({"ok": False, "error": "microcards_ui_not_found"}), 500

    resp = send_from_directory(MICROCARDS_UI_DIR, "microcards.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/microcards/<path:filename>", methods=["GET"])
def serve_microcards_file(filename: str) -> Any:
    """Serve Microcards static files (CSS, JS)."""
    dirs = _get_ui_dirs()
    MICROCARDS_UI_DIR = dirs.get("MICROCARDS_UI_DIR")
    if not MICROCARDS_UI_DIR or not MICROCARDS_UI_DIR.exists():
        return jsonify({"ok": False, "error": "microcards_ui_not_found"}), 500
    return send_from_directory(MICROCARDS_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Settings UI Routes
# ---------------------------------------------------------------------------

@static_bp.route("/ui/settings", methods=["GET"])
@static_bp.route("/ui/settings/", methods=["GET"])
def serve_settings_ui() -> Any:
    """Serve the Settings page (AI keys, etc.)."""
    dirs = _get_ui_dirs()
    SETTINGS_UI_DIR = dirs.get("SETTINGS_UI_DIR")
    if not SETTINGS_UI_DIR or not SETTINGS_UI_DIR.exists():
        logger.error("[HTTP] SETTINGS_UI_DIR does not exist: %s", SETTINGS_UI_DIR)
        return jsonify({"ok": False, "error": "settings_ui_not_found"}), 500

    resp = send_from_directory(SETTINGS_UI_DIR, "settings.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/settings/<path:filename>", methods=["GET"])
def serve_settings_file(filename: str) -> Any:
    """Serve Settings static files (CSS, JS)."""
    dirs = _get_ui_dirs()
    SETTINGS_UI_DIR = dirs.get("SETTINGS_UI_DIR")
    if not SETTINGS_UI_DIR or not SETTINGS_UI_DIR.exists():
        return jsonify({"ok": False, "error": "settings_ui_not_found"}), 500
    return send_from_directory(SETTINGS_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------

@static_bp.route("/assets/<path:filename>", methods=["GET"])
def serve_assets(filename: str) -> Any:
    """Serve global static assets (CSS, fonts)."""
    dirs = _get_ui_dirs()
    ASSETS_DIR = dirs.get("ASSETS_DIR")
    if not ASSETS_DIR or not ASSETS_DIR.exists():
        logger.error("[HTTP] ASSETS_DIR does not exist: %s", ASSETS_DIR)
        return jsonify({"ok": False, "error": "assets_dir_not_found"}), 500
    return send_from_directory(ASSETS_DIR, filename)


@static_bp.route("/ui/assets/<path:filename>", methods=["GET"])
def serve_ui_assets(filename: str) -> Any:
    """Serve global static assets via /ui/assets for relative links."""
    dirs = _get_ui_dirs()
    ASSETS_DIR = dirs.get("ASSETS_DIR")
    if not ASSETS_DIR or not ASSETS_DIR.exists():
        logger.error("[HTTP] ASSETS_DIR does not exist: %s", ASSETS_DIR)
        return jsonify({"ok": False, "error": "assets_dir_not_found"}), 500
    return send_from_directory(ASSETS_DIR, filename)


@static_bp.route("/favicon.ico")
def favicon() -> Any:
    return "", 204


# ---------------------------------------------------------------------------
# Session UI routes (S1, S2, S3)
# ---------------------------------------------------------------------------

@static_bp.route("/ui/session/<string:session_id>", methods=["GET"])
def serve_session_ui(session_id: str) -> Any:
    """Serve the S1 HTML UI for a given session.

    The session_id is consumed by the frontend JS — we only need to serve the HTML here.
    """
    dirs = _get_ui_dirs()
    try:
        ctx = get_ctx()
        session_api = getattr(ctx, "session_api", None)
        requested_user_id = getattr(ctx, "user_id", None)
        if session_api is not None:
            session = session_api.get_session(session_id, user_id=requested_user_id)
            if session is not None:
                ui_state = getattr(session, "ui_state", None) or {}
                ui_screen_type = (
                    ui_state.get("screen_type")
                    if isinstance(ui_state, dict)
                    else None
                )
                should_redirect = bool(getattr(session, "paused", False)) or ui_screen_type in {
                    "iteration_results",
                    "final_results",
                }
                if should_redirect:
                    resume_target = session_api.get_resume_target(session)
                    resume_url = (
                        resume_target.get("url")
                        if isinstance(resume_target, dict)
                        else None
                    )
                    session_url = f"/ui/session/{session_id}"
                    if isinstance(resume_url, str) and resume_url and resume_url != session_url:
                        logger.info(
                            "[HTTP] serve_session_ui redirect session_id=%s -> %s",
                            session_id,
                            resume_url,
                        )
                        return redirect(resume_url)
    except Exception:
        logger.exception(
            "[HTTP] Failed to resolve resume target for session %s before serving S1",
            session_id,
        )

    S1_UI_DIR = dirs.get("S1_UI_DIR")
    if not S1_UI_DIR or not S1_UI_DIR.exists():
        return jsonify({"ok": False, "error": "s1_ui_not_found"}), 500
    return send_from_directory(S1_UI_DIR, "index.html")


@static_bp.route("/ui/S1/<path:filename>", methods=["GET"])
def serve_session_static(filename: str) -> Any:
    """Serve static assets for S1 (JS/CSS)."""
    dirs = _get_ui_dirs()
    S1_UI_DIR = dirs.get("S1_UI_DIR")
    if not S1_UI_DIR or not S1_UI_DIR.exists():
        logger.error("[HTTP] S1_UI_DIR does not exist: %s", S1_UI_DIR)
        return jsonify({"ok": False, "error": "s1_ui_not_found"}), 500

    return send_from_directory(S1_UI_DIR, filename)


@static_bp.route("/ui/session/<string:session_id>/iteration/<string:iteration_id>", methods=["GET"])
def serve_iteration_results_ui(session_id: str, iteration_id: str) -> Any:
    """Serve the S2 HTML UI for iteration results.

    Both session_id and iteration_id are consumed by the frontend JS.
    """
    dirs = _get_ui_dirs()
    S2_UI_DIR = dirs.get("S2_UI_DIR")
    if not S2_UI_DIR or not S2_UI_DIR.exists():
        return jsonify({"ok": False, "error": "s2_ui_not_found"}), 500
    return send_from_directory(S2_UI_DIR, "index.html")


@static_bp.route("/ui/session/<string:session_id>/results", methods=["GET"])
def serve_session_results_ui(session_id: str) -> Any:
    """Serve the S3 HTML UI for final session results."""
    dirs = _get_ui_dirs()
    S3_UI_DIR = dirs.get("S3_UI_DIR")
    if not S3_UI_DIR or not S3_UI_DIR.exists():
        logger.error("[HTTP] S3_UI_DIR does not exist: %s", S3_UI_DIR)
        return jsonify({"ok": False, "error": "s3_ui_not_found"}), 500
    return send_from_directory(S3_UI_DIR, "index.html")
