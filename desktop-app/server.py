"""Minimal HTTP server over SessionAPI.

This module runs a small Flask application that exposes a JSON API
for working with complex sessions via SessionAPI.

No HTML / webview, only JSON endpoints.
"""

import bcrypt
import smtplib
import socket
import ssl
import hashlib
import io
import json
import logging
import os
import random
import re
import secrets
import shutil
import sys
import tempfile
import threading
import queue
import time
import traceback
import uuid
from collections import deque
from datetime import datetime, date
from email.message import EmailMessage
from email.utils import formatdate
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from flask import (
    Flask,
    jsonify,
    request,
    has_request_context,
    send_file,
    send_from_directory,
    after_this_request,
    Response,
    stream_with_context,
)
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from api.complexes_api import validate_and_normalize_create_payload

# ---------------------------------------------------------------------------
# Import paths & logging
# ---------------------------------------------------------------------------

# Add desktop-app and project root to sys.path for relative imports
CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent

if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _resolve_frontend_root() -> Path:
    """Resolve frontend root both for source checkout and packaged runtime."""
    candidates: List[Path] = []

    # PyInstaller onefile extraction dir (if present).
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(Path(str(meipass)) / "frontend")

    candidates.extend(
        [
            PROJECT_ROOT / "frontend",
            CURRENT_DIR / "frontend",
            CURRENT_DIR / "_internal" / "frontend",
            PROJECT_ROOT / "_internal" / "frontend",
            CURRENT_DIR.parent / "_internal" / "frontend",
        ]
    )

    for candidate in candidates:
        if candidate.exists():
            return candidate

    # Keep old behavior as fallback to avoid surprising path changes.
    return PROJECT_ROOT / "frontend"

from task_system.core.logging_config import setup_logging, install_crash_handlers  # type: ignore

setup_logging(app_name="trainer-http", log_level=logging.INFO)
_DEBUG_ENV_VALUES = {"1", "true", "yes", "on"}
FLASK_DEBUG_ENABLED = str(os.environ.get("FLASK_DEBUG", "0")).strip().lower() in _DEBUG_ENV_VALUES
_crash_interval_env = os.environ.get("TRAINER_CRASH_DUMP_INTERVAL")
try:
    _crash_interval = float(_crash_interval_env) if _crash_interval_env else None
    if _crash_interval is not None and _crash_interval <= 0:
        _crash_interval = None
except Exception:
    _crash_interval = None
install_crash_handlers(app_name="trainer-http", dump_interval_seconds=_crash_interval)
root_logger = logging.getLogger()
logger = logging.getLogger(__name__)
EDITOR_LOG_PATH = PROJECT_ROOT / "logs" / "editor-image.log"
EDITOR_SCALE_LOG_DIR = PROJECT_ROOT / "logs" / "editor-scale"
EDITOR_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
EDITOR_SCALE_LOG_DIR.mkdir(parents=True, exist_ok=True)
editor_logger = logging.getLogger("editor.image")
if not editor_logger.handlers:
    editor_handler = logging.FileHandler(EDITOR_LOG_PATH, encoding="utf-8")
    editor_handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s [%(levelname)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    editor_logger.addHandler(editor_handler)
    editor_logger.setLevel(logging.INFO)
    editor_logger.propagate = False
if FLASK_DEBUG_ENABLED:
    logger.info("[HTTP] server.py loaded from %s pid=%s", __file__, os.getpid())
    logger.info(
        "[HTTP] root handlers=%s module handlers=%s",
        root_logger.handlers,
        logger.handlers,
    )

# Editor imports
from task_system.core.io.task_io import TaskIO
from task_system.core.models.task_data import TaskData
from task_system.migrations import CURRENT_SCHEMA_VERSION
from task_system.models.test_parser import TestFileParser
from task_system.models.test_task import TestTask

from werkzeug.utils import secure_filename
import unicodedata
import uuid as _uuid


def _make_safe_id(name: str) -> str:
    """Create a filesystem-safe ID from a (possibly Cyrillic) name.

    Unlike ``secure_filename`` which strips all non-ASCII chars, this helper
    keeps Cyrillic letters by doing a lightweight transliteration first.
    Falls back to a short UUID prefix when transliteration yields nothing.
    """
    _CYRILLIC_MAP = {
        "а": "a",
        "б": "b",
        "в": "v",
        "г": "g",
        "д": "d",
        "е": "e",
        "ё": "yo",
        "ж": "zh",
        "з": "z",
        "и": "i",
        "й": "j",
        "к": "k",
        "л": "l",
        "м": "m",
        "н": "n",
        "о": "o",
        "п": "p",
        "р": "r",
        "с": "s",
        "т": "t",
        "у": "u",
        "ф": "f",
        "х": "kh",
        "ц": "ts",
        "ч": "ch",
        "ш": "sh",
        "щ": "sch",
        "ъ": "",
        "ы": "y",
        "ь": "",
        "э": "e",
        "ю": "yu",
        "я": "ya",
    }
    lowered = name.strip().lower()
    chars = []
    for ch in lowered:
        if ch in _CYRILLIC_MAP:
            chars.append(_CYRILLIC_MAP[ch])
        elif ch.isascii() and (ch.isalnum() or ch in "_-"):
            chars.append(ch)
        elif ch in (" ", ".", "/", "\\"):
            chars.append("_")
        # else: skip
    result = "_".join(part for part in "".join(chars).split("_") if part)
    if not result:
        result = "item_" + _uuid.uuid4().hex[:8]
    return result


# ---------------------------------------------------------------------------
# Imports from desktop-app
# ---------------------------------------------------------------------------

from common.config_loader import load_config  # type: ignore
from common.extension_points_config import load_extension_points_config  # type: ignore

from services import (  # type: ignore
    TaskEvaluatorService,
    ProgressService,
    StorageService,
    ComplexService,
    UserService,
)
from services.complex_service import ConflictError  # type: ignore
from services.theory_service import (  # type: ignore
    TheoryService,
    TheoryConflictError,
    TheoryNotFoundError,
    TheoryValidationError,
)
from services.statistics_service import StatisticsService  # type: ignore
from services.difficulty_manager import DifficultyManager  # type: ignore
from services.adaptive_session_manager import AdaptiveSessionManager  # type: ignore
from services.microcards_service import MicrocardsService  # type: ignore
from services.microcards_analytics_service import MicrocardsAnalyticsService  # type: ignore
from common.watchdog import WatchdogService  # type: ignore

from logic import (  # type: ignore
    TaskController,
    SessionManager,
)
from logic.module_repository import ModuleRepository  # type: ignore
from logic.complex_session_controller import ComplexSessionController  # type: ignore

from api.session_api import SessionAPI  # type: ignore
from api.web_models.sequence_models import WebSequenceAnswer  # type: ignore
from api.calendar_api import create_calendar_routes  # type: ignore

# Task import parsers
try:
    from task_system.models.parsers import (
        OpenAnswerParser,
        SequenceParser,
        ClickTextParser,
        ClickWordsParser,
        TestImportParser,
        MicrocardParser,
    )

    PARSERS_AVAILABLE = True
except ImportError:
    PARSERS_AVAILABLE = False
    logger.warning("[HTTP] Task import parsers not available")

# Calendar imports
try:
    from services.calendar import CalendarService

    CALENDAR_AVAILABLE = True
except ImportError:
    CalendarService = None
    CALENDAR_AVAILABLE = False
    logger.warning("[HTTP] CalendarService not available")

# AI Generation Service
try:
    from services.ai_generation_service import AIGenerationService, AnalysisParseError
    from services.file_processor import FileProcessor

    AI_SERVICE_AVAILABLE = True
except ImportError:
    AIGenerationService = None  # type: ignore[assignment,misc]
    AnalysisParseError = ValueError  # type: ignore[assignment,misc]
    FileProcessor = None  # type: ignore[assignment,misc]
    AI_SERVICE_AVAILABLE = False
    logger.warning("[HTTP] AIGenerationService not available")


# Import Export Service
try:
    from services.import_export_service import ImportExportService

    IMPORT_EXPORT_AVAILABLE = True
except ImportError:
    ImportExportService = None
    IMPORT_EXPORT_AVAILABLE = False
    logger.warning("[HTTP] ImportExportService not available")

# Complex Import Export Service
try:
    from services.complex_import_export_service import ComplexImportExportService

    COMPLEX_IMPORT_EXPORT_AVAILABLE = True
except ImportError:
    ComplexImportExportService = None
    COMPLEX_IMPORT_EXPORT_AVAILABLE = False
    logger.warning("[HTTP] ComplexImportExportService not available")


# ---------------------------------------------------------------------------
# Application wiring (headless, without Tk/UI)
# ---------------------------------------------------------------------------


class AppContextHeadless:
    """Headless subset of TrainerApp used for HTTP server.

    Initializes only the services/logic needed for SessionAPI,
    without any Tkinter UI.
    """

    def __init__(self, data_dir: Optional[str] = None, user_id: str = "default_user") -> None:
        # Resolve data_dir via config if not provided
        if data_dir is None:
            config = load_config()
            data_dir = config["data_root"]

        # Ensure data_dir is absolute
        if not os.path.isabs(data_dir):
            self.data_dir = PROJECT_ROOT / data_dir
        else:
            self.data_dir = Path(data_dir)
        self.user_id = user_id
        initial_user_id = self.user_id

        # Init services
        self._init_services()

        # Resolve startup profile safely (guest mode was removed).
        self.user_id = self._resolve_startup_user_id(self.user_id)

        logger.info(
            "[HTTP] Initializing headless app context, data_dir=%s, user_id=%s",
            self.data_dir,
            self.user_id,
        )

        # Init logic and SessionAPI
        self._init_logic()

        # Ensure all services are switched to the resolved startup user.
        if self.user_id and self.user_id != initial_user_id:
            self.switch_user(self.user_id)

    def _resolve_startup_user_id(self, requested_user_id: Optional[str]) -> str:
        """Resolve active user id for startup from requested id / app_state / available users."""
        candidate = (requested_user_id or "").strip()
        if candidate == "guest":
            candidate = ""

        if candidate and candidate != "default_user":
            if self.user_service.get_user(candidate):
                return candidate
            logger.warning("[HTTP] Requested startup user not found: %s", candidate)

        last_id = (self.user_service.get_last_user_id() or "").strip()
        if last_id == "guest":
            logger.info("[HTTP] Ignoring legacy guest last_user_id from app_state")
            last_id = ""
        if last_id:
            if self.user_service.get_user(last_id):
                logger.info("[HTTP] Found last active user: %s", last_id)
                return last_id
            logger.warning("[HTTP] Stored last_user_id not found: %s", last_id)

        users = self.user_service.get_all_users()
        if users:
            return users[0].user_id
        return ""

    def switch_user(self, user_id: str) -> bool:
        """Switch current user across all services."""
        user = self.user_service.get_user(user_id)
        if not user:
            logger.error("[HTTP] Cannot switch to non-existent user: %s", user_id)
            return False
        user_name = user.name

        logger.info("[HTTP] Switching current user to: %s (%s)", user_id, user_name)
        self.user_id = user_id
        self.user_service.save_last_user_id(user_id)

        # Update ProgressService
        self.progress_service.switch_user(user_id)

        # Clear Statistics cache
        self.statistics_service.clear_cache(user_id)
        analytics_service = getattr(self, "microcards_analytics_service", None)
        if analytics_service is not None and hasattr(analytics_service, "clear_cache"):
            try:
                analytics_service.clear_cache(user_id)
            except Exception as exc:
                logger.warning("[HTTP] Failed to clear microcards analytics cache for user %s: %s", user_id, exc)

        # Re-init SessionAPI facade (or just update its user ID if needed)
        # Note: SessionAPI uses default_user_id but also takes user_id in methods
        self.session_api.default_user_id = user_id

        # Switch CalendarService to new user
        if self.calendar_service and hasattr(self.calendar_service, "switch_user"):
            self.calendar_service.switch_user(user_id)

        return True

    def _init_services(self) -> None:
        # Create EventBus for service communication
        from services.event_bus import EventBus

        self.event_bus = EventBus()
        logger.info("[HTTP] EventBus initialized")

        # Load extension points config for evaluator (same pattern as in TrainerApp)
        try:
            ep_config = load_extension_points_config()
            ep_ext = ep_config.get("extension_points", {})
            evaluator_cfg: Dict[str, Any] = {
                "evaluators": ep_ext.get("evaluators", {}),
                "ui_components": ep_ext.get("ui_components", {}),
            }
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception("[HTTP] Failed to load extension points config: %s", exc)
            evaluator_cfg = {"evaluators": {}, "ui_components": {}}

        # DifficultyManager
        self.difficulty_manager = DifficultyManager(config_path=None)
        logger.info("[HTTP] DifficultyManager initialized")

        # ProgressService (uses DifficultyManager and EventBus)
        self.progress_service = ProgressService(
            data_dir=str(self.data_dir),
            user_id=self.user_id,
            difficulty_manager=self.difficulty_manager,
            event_bus=self.event_bus,  # -> NEW: EventBus for progress events
        )
        logger.info("[HTTP] ProgressService initialized")

        # StorageService
        self.storage_service = StorageService(self.data_dir)
        logger.info("[HTTP] StorageService initialized")

        # ModuleRepository (нужен для статистики по типам задач)
        self.module_repository = ModuleRepository(self.storage_service)
        logger.info("[HTTP] ModuleRepository initialized")

        # ImportExportService
        self.import_export_service = None
        if IMPORT_EXPORT_AVAILABLE:
            try:
                self.import_export_service = ImportExportService(self.storage_service)
                logger.info("[HTTP] ImportExportService initialized")
            except Exception as e:
                logger.error("[HTTP] Failed to initialize ImportExportService: %s", e)

        # ComplexService
        self.complex_service = ComplexService(data_dir=str(self.data_dir))
        logger.info("[HTTP] ComplexService initialized")

        # TheoryService (shared rich-text notes in Delta format)
        self.theory_service = TheoryService(data_dir=str(self.data_dir))
        logger.info("[HTTP] TheoryService initialized")

        # ComplexImportExportService
        self.complex_import_export_service = None
        if COMPLEX_IMPORT_EXPORT_AVAILABLE:
            try:
                self.complex_import_export_service = ComplexImportExportService(
                    storage_service=self.storage_service,
                    complex_service=self.complex_service,
                    theory_service=self.theory_service,
                    task_import_export_service=self.import_export_service,
                )
                logger.info("[HTTP] ComplexImportExportService initialized")
            except Exception as e:
                logger.error("[HTTP] Failed to initialize ComplexImportExportService: %s", e)

        # TaskEvaluatorService
        self.task_evaluator = TaskEvaluatorService(config=evaluator_cfg)
        logger.info("[HTTP] TaskEvaluatorService initialized")

        # AdaptiveSessionManager
        # NOTE: TrainerApp wiring passes progress_service.progress_manager as user_progress_manager
        self.adaptive_session_manager = AdaptiveSessionManager(
            complex_service=self.complex_service,
            user_progress_manager=self.progress_service.progress_manager,
            difficulty_manager=self.difficulty_manager,
        )
        logger.info("[HTTP] AdaptiveSessionManager initialized")

        # User Service
        self.user_service = UserService(data_dir=str(self.data_dir))
        logger.info("[HTTP] UserService initialized")

        # Statistics Service (with EventBus for cache invalidation)
        self.statistics_service = StatisticsService(
            progress_service=self.progress_service,
            data_dir=str(self.data_dir),
            event_bus=self.event_bus,  # -> NEW: EventBus for automatic cache invalidation
        )
        logger.info("[HTTP] StatisticsService initialized")
        try:
            self.statistics_service.set_module_repository(self.module_repository)
            logger.info("[HTTP] StatisticsService configured with ModuleRepository")
        except Exception as exc:
            logger.warning("[HTTP] Failed to wire ModuleRepository into StatisticsService: %s", exc)

        # Calendar Service
        self.calendar_service = None
        if CALENDAR_AVAILABLE and CalendarService is not None:
            try:
                self.calendar_service = CalendarService(
                    data_dir=str(self.data_dir),
                    user_id=self.user_id,
                )
                logger.info("[HTTP] CalendarService initialized")
            except Exception as e:
                logger.error("[HTTP] Failed to initialize CalendarService: %s", e)
                self.calendar_service = None

    def _init_logic(self) -> None:
        # SessionManager for non-complex sessions (required by TaskController)
        self.session_manager = SessionManager()
        logger.info("[HTTP] SessionManager initialized")

        # TaskController
        self.task_controller = TaskController(
            self.task_evaluator,
            self.progress_service,
            self.session_manager,
            self.difficulty_manager,
        )
        logger.info("[HTTP] TaskController initialized")

        # ComplexSessionController
        self.complex_session_controller = ComplexSessionController(
            session_manager=self.adaptive_session_manager,
            task_controller=self.task_controller,
            storage_service=self.storage_service,
            complex_service=self.complex_service,
        )
        logger.info("[HTTP] ComplexSessionController initialized")

        # SessionAPI facade
        self.session_api = SessionAPI(
            session_controller=self.complex_session_controller,
            adaptive_session_manager=self.adaptive_session_manager,
            complex_service=self.complex_service,
            storage_service=self.storage_service,
            statistics_service=self.statistics_service,
            default_user_id=self.user_id,
        )
        logger.info("[HTTP] SessionAPI initialized")


# Single global headless context & API
_headless_app_ctx = AppContextHeadless()
session_api: SessionAPI = _headless_app_ctx.session_api
user_service: UserService = _headless_app_ctx.user_service
statistics_service: StatisticsService = _headless_app_ctx.statistics_service
theory_service: TheoryService = _headless_app_ctx.theory_service
calendar_service = _headless_app_ctx.calendar_service

# AI Generation Service (optional — works only if ai_config.json exists with valid keys)
_ai_service = None
_file_processor = None
if AI_SERVICE_AVAILABLE and AIGenerationService is not None:
    try:
        _ai_service = AIGenerationService(data_dir=_headless_app_ctx.data_dir)
        if _ai_service.is_configured:
            logger.info("[HTTP] AIGenerationService initialized with %d provider(s)",
                        len(_ai_service._providers))
        else:
            logger.info("[HTTP] AIGenerationService loaded but no providers configured")
        # FileProcessor uses config values from AIGenerationService
        if FileProcessor is not None:
            _file_processor = FileProcessor(
                allowed_extensions=_ai_service.allowed_extensions,
                max_file_size_mb=_ai_service.max_file_size_mb,
                max_word_count=_ai_service.max_word_count,
            )
            logger.info("[HTTP] FileProcessor initialized (max_file=%dMB, max_words=%d)",
                        _ai_service.max_file_size_mb, _ai_service.max_word_count)
    except Exception as e:
        logger.warning("[HTTP] Failed to initialize AIGenerationService: %s", e)
        _ai_service = None

# Directories with HTML UI screens and static assets
FRONTEND_ROOT = _resolve_frontend_root()
S1_UI_DIR = FRONTEND_ROOT / "S1"
S2_UI_DIR = FRONTEND_ROOT / "S2"
S3_UI_DIR = FRONTEND_ROOT / "S3"
MAINSCREEN_UI_DIR = FRONTEND_ROOT / "MainScreen"
WELCOME_UI_DIR = FRONTEND_ROOT / "Welcome"
COMPLEXES_UI_DIR = FRONTEND_ROOT / "Complexes"
TESTUI_DIR = FRONTEND_ROOT / "TestUI"
SEQUENCEUI_DIR = FRONTEND_ROOT / "SequenceUI"
CLICKUI_DIR = FRONTEND_ROOT / "ClickUI"
DRAWUI_DIR = FRONTEND_ROOT / "DrawUI"
OPENANSWERUI_DIR = FRONTEND_ROOT / "OpenAnswerUI"
MISTAKESUI_DIR = FRONTEND_ROOT / "MistakesUI"
EDITOR_UI_DIR = FRONTEND_ROOT / "Editor"
CALENDAR_UI_DIR = FRONTEND_ROOT / "Calendar"
STATISTICS_UI_DIR = FRONTEND_ROOT / "statistics"
MICROCARDS_UI_DIR = FRONTEND_ROOT / "Microcards"
ASSETS_DIR = FRONTEND_ROOT / "assets"


# ---------------------------------------------------------------------------
# Flask application & routes
# ---------------------------------------------------------------------------

# Create global watchdog
watchdog = WatchdogService(check_interval=2.0, hang_threshold=10.0, heartbeat_interval=60.0)

app = Flask(__name__, static_folder=str(EDITOR_UI_DIR), static_url_path="/ui/editor")
app.secret_key = secrets.token_hex(32)

# Initialize shared route context and register Blueprints
from routes._context import init_context
from routes.static_routes import static_bp
from routes.users_routes import users_bp
from routes.statistics_routes import statistics_bp
from routes.theories_routes import theories_bp
from routes.complexes_routes import complexes_bp
from routes.session_routes import session_bp
from routes.editor_routes import editor_bp
from routes.quick_access_routes import quick_access_bp
from routes.microcards_routes import microcards_bp
from routes.ai_routes import ai_bp
from routes.import_routes import import_bp
from routes.misc_routes import misc_bp

init_context(
    _headless_app_ctx,
    ai_service=_ai_service,
    file_processor=_file_processor,
    editor_logger=editor_logger,
    EDITOR_SCALE_LOG_DIR=EDITOR_SCALE_LOG_DIR,
    PROJECT_ROOT=PROJECT_ROOT,
    FLASK_DEBUG_ENABLED=FLASK_DEBUG_ENABLED,
    ui_dirs={
        "FRONTEND_ROOT": FRONTEND_ROOT,
        "S1_UI_DIR": S1_UI_DIR,
        "S2_UI_DIR": S2_UI_DIR,
        "S3_UI_DIR": S3_UI_DIR,
        "MAINSCREEN_UI_DIR": MAINSCREEN_UI_DIR,
        "WELCOME_UI_DIR": WELCOME_UI_DIR,
        "COMPLEXES_UI_DIR": COMPLEXES_UI_DIR,
        "TESTUI_DIR": TESTUI_DIR,
        "SEQUENCEUI_DIR": SEQUENCEUI_DIR,
        "CLICKUI_DIR": CLICKUI_DIR,
        "DRAWUI_DIR": DRAWUI_DIR,
        "OPENANSWERUI_DIR": OPENANSWERUI_DIR,
        "MISTAKESUI_DIR": MISTAKESUI_DIR,
        "EDITOR_UI_DIR": EDITOR_UI_DIR,
        "CALENDAR_UI_DIR": CALENDAR_UI_DIR,
        "STATISTICS_UI_DIR": STATISTICS_UI_DIR,
        "MICROCARDS_UI_DIR": MICROCARDS_UI_DIR,
        "ASSETS_DIR": ASSETS_DIR,
    },
)
app.register_blueprint(static_bp)
app.register_blueprint(users_bp)
app.register_blueprint(statistics_bp)
app.register_blueprint(theories_bp)
app.register_blueprint(complexes_bp)
app.register_blueprint(session_bp)
app.register_blueprint(editor_bp)
app.register_blueprint(quick_access_bp)
app.register_blueprint(microcards_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(import_bp)
app.register_blueprint(misc_bp)

# Register Calendar routes if available
if calendar_service:
    try:
        create_calendar_routes(
            app,
            calendar_service,
            complex_service=_headless_app_ctx.complex_service,
            session_api=_headless_app_ctx.session_api,
        )
        logger.info("[HTTP] Calendar routes registered")
    except Exception as exc:
        logger.error("[HTTP] Failed to register calendar routes: %s", exc)

# Make calendar_service available to session routes via context
from routes._context import set_extra as _set_extra_cal
_set_extra_cal("calendar_service", calendar_service)


# --- Watchdog Hooks ---
@app.before_request
def watchdog_start():
    req_id = id(request)
    meta = f"{request.method} {request.path}"
    watchdog.start_request(req_id, meta=meta)


@app.teardown_request
def watchdog_end(exception=None):
    req_id = id(request)
    watchdog.end_request(req_id)


def _log_route_map():
    try:
        rules = sorted(app.url_map.iter_rules(), key=lambda r: r.rule)
        logger.debug("[HTTP] URL map has %d rules", len(rules))
        for rule in rules:
            methods = sorted(m for m in (rule.methods or set()) if m not in {"HEAD", "OPTIONS"})
            view_fn = app.view_functions.get(rule.endpoint)
            logger.debug(
                "[HTTP] ROUTE rule=%s endpoint=%s handler=%s methods=%s",
                rule.rule,
                rule.endpoint,
                getattr(view_fn, "__name__", repr(view_fn)),
                methods,
            )
    except Exception as exc:
        logger.exception("[HTTP] Failed to log URL map: %s", exc)


_routes_logged = False


def _log_route_map_once():
    global _routes_logged
    if _routes_logged or not FLASK_DEBUG_ENABLED:
        return
    _routes_logged = True
    _log_route_map()


@app.before_request
def _log_request_handler_resolution():
    if not FLASK_DEBUG_ENABLED:
        return
    try:
        _log_route_map_once()
        endpoint = request.endpoint
        view_fn = app.view_functions.get(endpoint) if endpoint else None
        logger.debug(
            "[HTTP] before_request path=%s endpoint=%s handler=%s",
            request.path,
            endpoint,
            getattr(view_fn, "__name__", repr(view_fn)),
        )
    except Exception as exc:
        logger.exception("[HTTP] Failed logging before_request handler: %s", exc)


if FLASK_DEBUG_ENABLED:
    logger.debug("[HTTP] before_request hook installed: %s", _log_request_handler_resolution)


@app.errorhandler(Exception)
def handle_unhandled_exception(e):
    """Return JSON instead of HTML for unhandled exceptions."""
    logger.exception("[HTTP] Unhandled exception: %s", e)
    return jsonify({"ok": False, "error": "internal_server_error"}), 500


@app.route("/api/health", methods=["GET"])
def health_check():
    """Lightweight health endpoint for ConnectionMonitor."""
    return jsonify({"ok": True}), 200


if FLASK_DEBUG_ENABLED:

    @app.route("/api/debug/hang")
    def debug_hang():
        logger.warning("Starting deliberate hang for 15 seconds...")
        time.sleep(15)
        return jsonify({"ok": True, "msg": "Survived hang"})


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


@app.before_request
def _start_timing():
    request._start_time = time.time()


@app.after_request
def _log_http_request(response):
    try:
        duration = time.time() - getattr(request, "_start_time", time.time())
        status_code = getattr(response, "status_code", "?")

        path = request.full_path if request.query_string else request.path

        log_msg = "[HTTP_REQ][pid=%s] %s %s -> %s (%.3fs)" % (
            os.getpid(),
            request.method,
            path,
            status_code,
            duration,
        )

        # Production logging policy:
        # - WARNING: slow requests (>1s)
        # - DEBUG: full request trace only in debug mode
        if duration > 1.0:
            logger.warning("%s - SLOW REQUEST", log_msg)
        elif FLASK_DEBUG_ENABLED:
            logger.debug(log_msg)

        try:
            response.headers["X-Server-Pid"] = str(os.getpid())
            response.headers["X-Response-Time"] = "%.3fs" % duration
        except Exception:
            pass
        _flush_log_handlers()
    except Exception:
        pass
    return response


if FLASK_DEBUG_ENABLED:
    try:
        logger.debug(
            "[DEBUG_HOOKS_INSTALLED][pid=%s] http_req=1 ui_main_meta=1 client_log=1",
            os.getpid(),
        )
        _flush_log_handlers()
    except Exception:
        pass


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


def _get_user_dir(user_id: str) -> Path:
    return _headless_app_ctx.data_dir / "users" / user_id



# _ui_state_path, _read_ui_state, _write_ui_state moved to routes/quick_access_routes.py


LEGAL_DEFAULT_MANIFEST: Dict[str, Dict[str, str]] = {
    "terms": {
        "title": "Условия пользования",
        "version": "2026-02-15.1",
        "effective_at": "2026-02-15T00:00:00Z",
        "filename": "terms.md",
        "format": "markdown",
    },
    "privacy": {
        "title": "Политика приватности",
        "version": "2026-02-15.1",
        "effective_at": "2026-02-15T00:00:00Z",
        "filename": "privacy.md",
        "format": "markdown",
    },
}

FEEDBACK_TYPES = ("bug", "idea", "improvement", "question")
FEEDBACK_SEVERITIES = ("low", "medium", "high", "critical")
FEEDBACK_LOGS_MAX_FILES = 5
FEEDBACK_LOGS_MAX_LINES_PER_FILE = 300
FEEDBACK_LOGS_MAX_BYTES_PER_FILE = 64 * 1024
FEEDBACK_EMAIL_LOG_EXCERPT_MAX_CHARS = 4000
NETWORK_PROBE_DEFAULT_TIMEOUT_SEC = 2.0
NETWORK_PROBE_CACHE_TTL_SEC = 8.0
NETWORK_PROBE_TARGETS = (
    ("1.1.1.1", 53),
    ("8.8.8.8", 53),
    ("api.brevo.com", 443),
)
_network_probe_cache: Dict[str, Any] = {"checked_at": 0.0, "internet_online": None}
_network_probe_lock = threading.Lock()
UPDATE_CHECK_CACHE_MAX_AGE_SEC = 24 * 60 * 60
UPDATE_CHECK_DEFAULT_TIMEOUT_SEC = 3.0


def _legal_dir() -> Path:
    return FRONTEND_ROOT / "legal"


def _legal_manifest_path() -> Path:
    return _legal_dir() / "manifest.json"


def _load_legal_manifest() -> Dict[str, Dict[str, str]]:
    path = _legal_manifest_path()
    raw: Dict[str, Any]
    try:
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                raw = loaded
            else:
                raise ValueError("manifest_must_be_object")
        else:
            raw = {}
    except Exception as exc:
        logger.warning("[HTTP] Failed to read legal manifest %s: %s", path, exc)
        raw = {}

    normalized: Dict[str, Dict[str, str]] = {}
    for doc_type in ("terms", "privacy"):
        fallback = LEGAL_DEFAULT_MANIFEST[doc_type]
        src = raw.get(doc_type)
        if not isinstance(src, dict):
            src = {}

        normalized[doc_type] = {
            "title": str(src.get("title") or fallback["title"]).strip() or fallback["title"],
            "version": str(src.get("version") or fallback["version"]).strip()
            or fallback["version"],
            "effective_at": str(src.get("effective_at") or fallback["effective_at"]).strip()
            or fallback["effective_at"],
            "filename": str(src.get("filename") or fallback["filename"]).strip()
            or fallback["filename"],
            "format": str(src.get("format") or fallback["format"]).strip() or fallback["format"],
        }

    return normalized


def _legal_doc_path(
    doc_type: str, manifest: Optional[Dict[str, Dict[str, str]]] = None
) -> Optional[Path]:
    if doc_type not in ("terms", "privacy"):
        return None
    if manifest is None:
        manifest = _load_legal_manifest()
    filename = manifest.get(doc_type, {}).get("filename")
    if not filename:
        return None
    return _legal_dir() / filename


def _required_consent_versions() -> Dict[str, str]:
    manifest = _load_legal_manifest()
    return {
        "terms_version": manifest["terms"]["version"],
        "privacy_version": manifest["privacy"]["version"],
    }


def _extract_consent_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    consent_obj = payload.get("consent")
    if not isinstance(consent_obj, dict):
        consent_obj = {}

    accepted = consent_obj.get("accepted")
    if accepted is None:
        accepted = payload.get("accepted")

    return {
        "accepted": accepted is True,
        "terms_version": str(
            consent_obj.get("terms_version") or payload.get("terms_version") or ""
        ).strip(),
        "privacy_version": str(
            consent_obj.get("privacy_version") or payload.get("privacy_version") or ""
        ).strip(),
    }


def _has_explicit_consent_payload(payload: Dict[str, Any]) -> bool:
    if not isinstance(payload, dict):
        return False
    if isinstance(payload.get("consent"), dict):
        return True
    return any(key in payload for key in ("accepted", "terms_version", "privacy_version"))


def _validate_consent_payload(consent_payload: Dict[str, Any]) -> Dict[str, Any]:
    required = _required_consent_versions()
    accepted = bool(consent_payload.get("accepted"))
    terms_version = str(consent_payload.get("terms_version") or "").strip()
    privacy_version = str(consent_payload.get("privacy_version") or "").strip()

    if not accepted:
        return {"ok": False, "status_code": 400, "error": "consent_required"}

    if not terms_version or not privacy_version:
        return {"ok": False, "status_code": 400, "error": "consent_required"}

    if terms_version != required["terms_version"] or privacy_version != required["privacy_version"]:
        return {
            "ok": False,
            "status_code": 409,
            "error": "version_mismatch",
            "required": required,
            "provided": {
                "terms_version": terms_version,
                "privacy_version": privacy_version,
            },
        }

    return {"ok": True, "required": required}


def _consent_path(user_id: str) -> Path:
    return _get_user_dir(user_id) / "consent.json"


def _read_user_consent(user_id: str) -> Optional[Dict[str, Any]]:
    if not user_id:
        return None
    path = _consent_path(user_id)
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return None
        return data
    except Exception as exc:
        logger.warning("[HTTP] Failed to read consent for user %s: %s", user_id, exc)
        return None


def _write_user_consent(
    user_id: str,
    terms_version: str,
    privacy_version: str,
    *,
    source: str = "unknown",
) -> Dict[str, Any]:
    user_dir = _get_user_dir(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    path = _consent_path(user_id)

    consent_id = f"consent_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"
    payload: Dict[str, Any] = {
        "version": 1,
        "consent_id": consent_id,
        "user_id": user_id,
        "terms_version": terms_version,
        "privacy_version": privacy_version,
        "accepted_at": datetime.utcnow().isoformat() + "Z",
        "source": source,
    }

    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            dir=str(path.parent),
            delete=False,
            encoding="utf-8",
            suffix=".tmp",
        ) as tf:
            json.dump(payload, tf, ensure_ascii=False, indent=2)
            temp_name = tf.name
        os.replace(temp_name, str(path))
    finally:
        if temp_name and os.path.exists(temp_name):
            try:
                os.remove(temp_name)
            except Exception:
                pass

    return payload


def _get_consent_status(user_id: str) -> Dict[str, Any]:
    required = _required_consent_versions()
    accepted = _read_user_consent(user_id)

    if not accepted:
        return {
            "status": "missing",
            "required": required,
            "accepted": None,
        }

    accepted_terms = str(accepted.get("terms_version") or "").strip()
    accepted_privacy = str(accepted.get("privacy_version") or "").strip()
    if (
        accepted_terms != required["terms_version"]
        or accepted_privacy != required["privacy_version"]
    ):
        return {
            "status": "outdated",
            "required": required,
            "accepted": {
                "terms_version": accepted_terms,
                "privacy_version": accepted_privacy,
                "accepted_at": accepted.get("accepted_at"),
            },
        }

    return {
        "status": "up_to_date",
        "required": required,
        "accepted": {
            "terms_version": accepted_terms,
            "privacy_version": accepted_privacy,
            "accepted_at": accepted.get("accepted_at"),
        },
    }


# Deferred registration of consent helpers for routes/users_routes.py
from routes._context import set_extra as _set_extra
_set_extra("server_helpers", {
    "extract_consent_payload": _extract_consent_payload,
    "has_explicit_consent_payload": _has_explicit_consent_payload,
    "required_consent_versions": _required_consent_versions,
    "validate_consent_payload": _validate_consent_payload,
    "write_user_consent": _write_user_consent,
    "get_consent_status": _get_consent_status,
})


def _check_internet_connectivity(timeout_sec: float) -> bool:
    timeout = max(0.2, float(timeout_sec or NETWORK_PROBE_DEFAULT_TIMEOUT_SEC))
    for host, port in NETWORK_PROBE_TARGETS:
        try:
            with socket.create_connection((host, int(port)), timeout=timeout):
                return True
        except OSError:
            continue
    return False


def _get_cached_internet_connectivity(*, force: bool = False) -> bool:
    now = time.time()
    with _network_probe_lock:
        checked_at = float(_network_probe_cache.get("checked_at") or 0.0)
        cached_status = _network_probe_cache.get("internet_online")
        if (
            not force
            and isinstance(cached_status, bool)
            and now - checked_at <= NETWORK_PROBE_CACHE_TTL_SEC
        ):
            return cached_status

    probe_timeout = _env_float("ACTRA_NETWORK_PROBE_TIMEOUT_SEC", NETWORK_PROBE_DEFAULT_TIMEOUT_SEC)
    status = _check_internet_connectivity(probe_timeout)

    with _network_probe_lock:
        _network_probe_cache["checked_at"] = now
        _network_probe_cache["internet_online"] = status
    return status


def _get_app_version() -> str:
    try:
        from task_system import __version__ as task_system_version

        if isinstance(task_system_version, str) and task_system_version.strip():
            return task_system_version.strip()
    except Exception:
        pass

    try:
        version_file = PROJECT_ROOT / "task_system" / "VERSION"
        if version_file.exists():
            return version_file.read_text(encoding="utf-8").strip() or "0.0.0"
    except Exception:
        pass

    return "0.0.0"


def _update_manifest_url() -> str:
    env_value = str(os.environ.get("ACTRA_UPDATE_MANIFEST_URL") or "").strip()
    if env_value:
        return env_value

    config_value = _configured_update_manifest_url_from_config()
    if not config_value:
        return ""

    parsed = urlparse(config_value)
    scheme = (parsed.scheme or "").lower()
    if scheme in {"http", "https", "file"}:
        return config_value

    manifest_path = Path(config_value)
    if not manifest_path.is_absolute():
        manifest_path = PROJECT_ROOT / manifest_path
    return manifest_path.resolve().as_uri()


def _configured_update_manifest_url_from_config() -> str:
    try:
        config = load_config()
    except Exception:
        return ""
    return str(config.get("update_manifest_url") or "").strip()


def _manifest_url_requires_internet(manifest_url: str) -> bool:
    parsed = urlparse(str(manifest_url or "").strip())
    scheme = (parsed.scheme or "").lower()
    if scheme not in {"http", "https"}:
        return False
    host = (parsed.hostname or "").strip().lower()
    if host in {"localhost", "127.0.0.1", "::1"}:
        return False
    return True


def _update_cache_path() -> Path:
    return _headless_app_ctx.data_dir / "system" / "update_check_cache.json"


def _load_update_check_cache(manifest_url: str) -> Optional[Dict[str, Any]]:
    path = _update_cache_path()
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return None
        if str(data.get("manifest_url") or "") != manifest_url:
            return None
        result = data.get("result")
        if not isinstance(result, dict):
            return None
        checked_at_ts = float(data.get("checked_at_ts") or 0.0)
        return {"checked_at_ts": checked_at_ts, "result": result}
    except Exception:
        return None


def _save_update_check_cache(manifest_url: str, result: Dict[str, Any]) -> None:
    path = _update_cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "manifest_url": manifest_url,
        "checked_at_ts": time.time(),
        "result": result,
    }

    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            dir=str(path.parent),
            delete=False,
            encoding="utf-8",
            suffix=".tmp",
        ) as tf:
            json.dump(payload, tf, ensure_ascii=False, indent=2)
            temp_name = tf.name
        os.replace(temp_name, str(path))
    finally:
        if temp_name and os.path.exists(temp_name):
            try:
                os.remove(temp_name)
            except Exception:
                pass


def _compare_versions(left: str, right: str) -> int:
    left_val = str(left or "").strip()
    right_val = str(right or "").strip()
    try:
        from packaging import version as pkg_version

        lv = pkg_version.parse(left_val)
        rv = pkg_version.parse(right_val)
        if lv < rv:
            return -1
        if lv > rv:
            return 1
        return 0
    except Exception:
        pass

    def _fallback_key(raw: str) -> List[int]:
        cleaned = str(raw or "").strip().lstrip("vV")
        cleaned = cleaned.split("+", 1)[0].split("-", 1)[0]
        parts = []
        for token in cleaned.split("."):
            digits = "".join(ch for ch in token if ch.isdigit())
            parts.append(int(digits) if digits else 0)
        return parts or [0]

    lv = _fallback_key(left_val)
    rv = _fallback_key(right_val)
    max_len = max(len(lv), len(rv))
    lv.extend([0] * (max_len - len(lv)))
    rv.extend([0] * (max_len - len(rv)))
    if lv < rv:
        return -1
    if lv > rv:
        return 1
    return 0


def _fetch_update_manifest(
    manifest_url: str, timeout_sec: float, current_version: str
) -> Dict[str, Any]:
    req = Request(
        manifest_url,
        headers={
            "Accept": "application/json",
            "User-Agent": f"ACTRA/{current_version}",
            "Cache-Control": "no-cache",
        },
        method="GET",
    )
    with urlopen(req, timeout=timeout_sec) as resp:  # nosec B310 - URL is user/developer configured
        raw = resp.read()
    parsed = json.loads(raw.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("manifest_must_be_object")
    return parsed


def _build_update_status(*, force: bool = False) -> Dict[str, Any]:
    current_version = _get_app_version()
    manifest_url = _update_manifest_url()
    manifest_requires_internet = _manifest_url_requires_internet(manifest_url)
    internet_online = _get_cached_internet_connectivity(force=False)
    now_iso = datetime.utcnow().isoformat() + "Z"

    base: Dict[str, Any] = {
        "current_version": current_version,
        "latest_version": None,
        "update_available": False,
        "required_update": False,
        "minimum_required_version": None,
        "download_url": None,
        "notes_url": None,
        "published_at": None,
        "checked_at": now_iso,
        "internet_online": internet_online,
        "manifest_url_configured": bool(manifest_url),
        "manifest_requires_internet": manifest_requires_internet,
        "from_cache": False,
        "reason": "unknown",
    }

    if not _env_bool("ACTRA_UPDATE_CHECK_ENABLED", True):
        base["reason"] = "disabled"
        return base

    if not manifest_url:
        base["reason"] = "not_configured"
        return base

    cache = _load_update_check_cache(manifest_url)
    cache_ttl = max(60, _env_int("ACTRA_UPDATE_CHECK_INTERVAL_SEC", UPDATE_CHECK_CACHE_MAX_AGE_SEC))

    if cache and not force:
        checked_at_ts = float(cache.get("checked_at_ts") or 0.0)
        if time.time() - checked_at_ts <= cache_ttl:
            cached_result = dict(cache.get("result") or {})
            cached_result["from_cache"] = True
            cached_result["internet_online"] = internet_online
            return {**base, **cached_result}

    if manifest_requires_internet and not internet_online:
        if cache:
            cached_result = dict(cache.get("result") or {})
            cached_result["from_cache"] = True
            cached_result["internet_online"] = False
            cached_result["reason"] = "offline_cached"
            return {**base, **cached_result}
        base["reason"] = "offline"
        return base

    timeout_sec = max(
        1.0, _env_float("ACTRA_UPDATE_REQUEST_TIMEOUT_SEC", UPDATE_CHECK_DEFAULT_TIMEOUT_SEC)
    )
    try:
        manifest = _fetch_update_manifest(manifest_url, timeout_sec, current_version)
        latest_version = str(manifest.get("latest_version") or "").strip()
        if not latest_version:
            raise ValueError("latest_version_required")

        minimum_required = str(manifest.get("min_supported_version") or "").strip() or None
        update_available = _compare_versions(current_version, latest_version) < 0
        required_update = bool(
            minimum_required and _compare_versions(current_version, minimum_required) < 0
        )

        result = {
            **base,
            "latest_version": latest_version,
            "update_available": update_available,
            "required_update": required_update,
            "minimum_required_version": minimum_required,
            "download_url": str(manifest.get("download_url") or "").strip() or None,
            "notes_url": str(manifest.get("notes_url") or "").strip() or None,
            "published_at": str(manifest.get("published_at") or "").strip() or None,
            "checked_at": now_iso,
            "internet_online": True,
            "manifest_url_configured": True,
            "from_cache": False,
            "reason": "update_available" if update_available else "up_to_date",
        }
        _save_update_check_cache(manifest_url, result)
        return result
    except (URLError, HTTPError) as exc:
        logger.warning("[HTTP] Update check network error: %s", exc)
        if cache:
            cached_result = dict(cache.get("result") or {})
            cached_result["from_cache"] = True
            cached_result["internet_online"] = True
            cached_result["reason"] = "fetch_failed_cached"
            return {**base, **cached_result}
        base["reason"] = "fetch_failed"
        return base
    except Exception as exc:
        logger.warning("[HTTP] Update check failed: %s", exc)
        if cache:
            cached_result = dict(cache.get("result") or {})
            cached_result["from_cache"] = True
            cached_result["internet_online"] = True
            cached_result["reason"] = "manifest_invalid_cached"
            return {**base, **cached_result}
        base["reason"] = "manifest_invalid"
        return base


def _feedback_dir() -> Path:
    return _headless_app_ctx.data_dir / "feedback" / "tickets"


def _feedback_ticket_path(ticket_id: str) -> Path:
    safe_id = str(ticket_id or "").strip()
    return _feedback_dir() / f"{safe_id}.json"


def _feedback_logs_root() -> Path:
    return PROJECT_ROOT / "logs"


def _read_log_excerpt(path: Path, *, max_lines: int, max_bytes: int) -> Dict[str, Any]:
    """
    Read tail excerpt from log file with line and byte bounds.

    Returns dict with excerpt and truncation metadata.
    """
    tail: deque[str] = deque()
    tail_bytes = 0
    total_lines = 0

    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for raw_line in f:
            total_lines += 1
            line = raw_line.rstrip("\n")
            line_bytes = len(line.encode("utf-8", errors="replace")) + 1
            tail.append(line)
            tail_bytes += line_bytes

            while len(tail) > max_lines:
                removed = tail.popleft()
                tail_bytes -= len(removed.encode("utf-8", errors="replace")) + 1
            while tail and tail_bytes > max_bytes:
                removed = tail.popleft()
                tail_bytes -= len(removed.encode("utf-8", errors="replace")) + 1

    excerpt_lines = list(tail)
    truncated = total_lines > len(excerpt_lines)
    return {
        "excerpt": "\n".join(excerpt_lines),
        "total_lines": total_lines,
        "excerpt_lines": len(excerpt_lines),
        "truncated": truncated,
    }


def _collect_feedback_logs_payload() -> Dict[str, Any]:
    """Collect bounded log excerpts from PROJECT_ROOT/logs for bug reports."""
    logs_root = _feedback_logs_root()
    payload: Dict[str, Any] = {
        "collected_at": datetime.utcnow().isoformat() + "Z",
        "log_root": str(logs_root),
        "policy": {
            "max_files": FEEDBACK_LOGS_MAX_FILES,
            "max_lines_per_file": FEEDBACK_LOGS_MAX_LINES_PER_FILE,
            "max_bytes_per_file": FEEDBACK_LOGS_MAX_BYTES_PER_FILE,
        },
        "files": [],
    }

    if not logs_root.exists() or not logs_root.is_dir():
        payload["note"] = "logs_root_not_found"
        return payload

    try:
        candidates = [
            p for p in logs_root.rglob("*") if p.is_file() and p.suffix.lower() in {".log", ".txt"}
        ]
    except Exception as exc:
        logger.warning("[HTTP] Failed to enumerate logs for feedback: %s", exc)
        payload["note"] = "log_enumeration_failed"
        return payload

    if not candidates:
        payload["note"] = "no_log_files_found"
        return payload

    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    selected = candidates[:FEEDBACK_LOGS_MAX_FILES]
    files_out: List[Dict[str, Any]] = []

    for file_path in selected:
        try:
            stat = file_path.stat()
            excerpt_obj = _read_log_excerpt(
                file_path,
                max_lines=FEEDBACK_LOGS_MAX_LINES_PER_FILE,
                max_bytes=FEEDBACK_LOGS_MAX_BYTES_PER_FILE,
            )
            rel_path = file_path.relative_to(logs_root).as_posix()
            files_out.append(
                {
                    "path": rel_path,
                    "size_bytes": int(stat.st_size),
                    "modified_at": datetime.utcfromtimestamp(stat.st_mtime).isoformat() + "Z",
                    **excerpt_obj,
                }
            )
        except Exception as exc:
            logger.warning("[HTTP] Failed to collect log excerpt %s: %s", file_path, exc)

    payload["files"] = files_out
    return payload


def _build_feedback_ticket(payload: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    feedback_type = str(payload.get("type") or "").strip().lower()
    title = str(payload.get("title") or "").strip()
    description = str(payload.get("description") or "").strip()
    severity = str(payload.get("severity") or "medium").strip().lower()
    include_technical = bool(payload.get("include_technical_data"))
    include_logs = bool(payload.get("include_logs"))

    if feedback_type not in FEEDBACK_TYPES:
        raise ValueError("invalid_feedback_type")
    if len(title) < 3 or len(title) > 180:
        raise ValueError("invalid_title_length")
    if len(description) < 5 or len(description) > 10000:
        raise ValueError("invalid_description_length")
    if severity not in FEEDBACK_SEVERITIES:
        raise ValueError("invalid_severity")

    ticket_id = f"fb_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    technical_payload: Optional[Dict[str, Any]] = None
    if include_technical:
        technical_raw = payload.get("technical")
        if isinstance(technical_raw, dict):
            technical_payload = technical_raw
        else:
            technical_payload = {}

    logs_payload: Optional[Dict[str, Any]] = None
    if include_logs:
        logs_payload = _collect_feedback_logs_payload()

    return {
        "ticket_id": ticket_id,
        "user_id": user_id,
        "type": feedback_type,
        "title": title,
        "description": description,
        "severity": severity,
        "status": "new",
        "include_technical_data": include_technical,
        "include_logs": include_logs,
        "technical_payload": technical_payload,
        "logs_payload": logs_payload,
        "email_notification": {"sent": False, "reason": "pending"},
        "delivery": {
            "email_sent": False,
            "email_reason": "pending",
            "email_attempted_at": None,
        },
        "created_at": datetime.utcnow().isoformat() + "Z",
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }


def _save_feedback_ticket(ticket: Dict[str, Any]) -> Path:
    dst_dir = _feedback_dir()
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = _feedback_ticket_path(str(ticket.get("ticket_id") or ""))
    ticket["updated_at"] = datetime.utcnow().isoformat() + "Z"

    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            dir=str(dst_dir),
            delete=False,
            encoding="utf-8",
            suffix=".tmp",
        ) as tf:
            json.dump(ticket, tf, ensure_ascii=False, indent=2)
            temp_name = tf.name
        os.replace(temp_name, str(dst))
    finally:
        if temp_name and os.path.exists(temp_name):
            try:
                os.remove(temp_name)
            except Exception:
                pass
    return dst


def _load_feedback_ticket(path: Path) -> Optional[Dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        logger.warning("[HTTP] Failed to read feedback ticket %s: %s", path, exc)
        return None
    if not isinstance(data, dict):
        return None
    if not data.get("ticket_id"):
        data["ticket_id"] = path.stem
    return data


def _update_feedback_delivery_fields(
    ticket: Dict[str, Any], email_status: Dict[str, Any]
) -> Dict[str, Any]:
    sent = bool(email_status.get("sent"))
    reason = str(email_status.get("reason") or ("ok" if sent else "send_failed"))
    attempted_at = datetime.utcnow().isoformat() + "Z"

    ticket["email_notification"] = email_status
    ticket["delivery"] = {
        "email_sent": sent,
        "email_reason": reason,
        "email_attempted_at": attempted_at,
    }
    ticket["status"] = "delivered" if sent else "queued"
    ticket["updated_at"] = attempted_at
    return ticket


def _retry_pending_feedback_notifications(*, limit: int = 5) -> Dict[str, Any]:
    if not _get_cached_internet_connectivity(force=False):
        return {"attempted": 0, "sent": 0, "failed": 0, "skipped": "offline"}

    dst_dir = _feedback_dir()
    if not dst_dir.exists() or not dst_dir.is_dir():
        return {"attempted": 0, "sent": 0, "failed": 0}

    ticket_files = sorted(dst_dir.glob("*.json"), key=lambda p: p.stat().st_mtime)
    attempted = 0
    sent = 0
    failed = 0

    for path in ticket_files:
        if attempted >= limit:
            break
        ticket = _load_feedback_ticket(path)
        if not ticket:
            continue

        prev_status = ticket.get("email_notification")
        already_sent = isinstance(prev_status, dict) and bool(prev_status.get("sent"))
        if already_sent:
            continue

        attempted += 1
        ticket_user = user_service.get_user(str(ticket.get("user_id") or ""))
        email_status = _notify_feedback_via_email(ticket, ticket_user)
        _update_feedback_delivery_fields(ticket, email_status)
        _save_feedback_ticket(ticket)

        if email_status.get("sent"):
            sent += 1
        else:
            failed += 1

    return {"attempted": attempted, "sent": sent, "failed": failed}


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(str(raw).strip())
    except Exception:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(str(raw).strip())
    except Exception:
        return default


def _feedback_email_settings() -> Dict[str, Any]:
    """Load SMTP settings for developer feedback notification emails."""
    recipients_raw = str(os.environ.get("ACTRA_FEEDBACK_EMAIL_TO") or "actrafb@proton.me").strip()
    recipients = [item.strip() for item in recipients_raw.split(",") if item.strip()]

    smtp_user = str(os.environ.get("ACTRA_FEEDBACK_SMTP_USER") or "").strip()
    from_email = str(os.environ.get("ACTRA_FEEDBACK_SMTP_FROM") or "").strip() or smtp_user

    return {
        "enabled": _env_bool("ACTRA_FEEDBACK_EMAIL_ENABLED", True),
        "host": str(os.environ.get("ACTRA_FEEDBACK_SMTP_HOST") or "").strip(),
        "port": _env_int("ACTRA_FEEDBACK_SMTP_PORT", 587),
        "username": smtp_user,
        "password": str(os.environ.get("ACTRA_FEEDBACK_SMTP_PASSWORD") or ""),
        "from_email": from_email,
        "to_emails": recipients,
        "use_tls": _env_bool("ACTRA_FEEDBACK_SMTP_USE_TLS", True),
        "use_ssl": _env_bool("ACTRA_FEEDBACK_SMTP_USE_SSL", False),
        "timeout_sec": _env_float("ACTRA_FEEDBACK_SMTP_TIMEOUT_SEC", 15.0),
    }


def _build_feedback_email_subject(ticket: Dict[str, Any]) -> str:
    ticket_type = str(ticket.get("type") or "feedback").upper()
    severity = str(ticket.get("severity") or "medium").upper()
    title = str(ticket.get("title") or "").strip()
    if len(title) > 120:
        title = title[:117] + "..."
    return f"[ACTRA][{ticket_type}/{severity}] {title or 'New feedback'}"


def _build_feedback_email_body(ticket: Dict[str, Any], user: Optional[Any]) -> str:
    user_name = ""
    if user is not None:
        user_name = str(getattr(user, "name", "") or "").strip()

    lines: List[str] = [
        "New ACTRA feedback ticket received.",
        "",
        f"Ticket ID: {ticket.get('ticket_id')}",
        f"Created at (UTC): {ticket.get('created_at')}",
        f"User ID: {ticket.get('user_id')}",
        f"User name: {user_name or '-'}",
        f"Type: {ticket.get('type')}",
        f"Severity: {ticket.get('severity')}",
        "",
        f"Title: {ticket.get('title')}",
        "",
        "Description:",
        str(ticket.get("description") or ""),
    ]

    technical_payload = ticket.get("technical_payload")
    if isinstance(technical_payload, dict) and technical_payload:
        lines.extend(
            [
                "",
                "Technical payload:",
                json.dumps(technical_payload, ensure_ascii=False, indent=2),
            ]
        )

    logs_payload = ticket.get("logs_payload")
    if isinstance(logs_payload, dict):
        files = logs_payload.get("files")
        if isinstance(files, list):
            lines.extend(["", f"Log excerpts attached: {len(files)} file(s)."])
            for entry in files:
                if not isinstance(entry, dict):
                    continue
                path = str(entry.get("path") or "-")
                size_bytes = entry.get("size_bytes")
                modified_at = str(entry.get("modified_at") or "-")
                excerpt = str(entry.get("excerpt") or "")
                if len(excerpt) > FEEDBACK_EMAIL_LOG_EXCERPT_MAX_CHARS:
                    excerpt = (
                        excerpt[:FEEDBACK_EMAIL_LOG_EXCERPT_MAX_CHARS]
                        + "\n...[truncated for email]"
                    )
                lines.extend(
                    [
                        "",
                        f"--- LOG: {path} ---",
                        f"size_bytes={size_bytes} modified_at={modified_at}",
                        excerpt or "(empty excerpt)",
                    ]
                )
        note = logs_payload.get("note")
        if note:
            lines.extend(["", f"Log collection note: {note}"])

    return "\n".join(lines)


def _validate_feedback_email_settings(
    settings: Dict[str, Any], *, require_recipients: bool = True
) -> List[str]:
    missing: List[str] = []
    if not settings.get("host"):
        missing.append("ACTRA_FEEDBACK_SMTP_HOST")
    if not settings.get("from_email"):
        missing.append("ACTRA_FEEDBACK_SMTP_FROM or ACTRA_FEEDBACK_SMTP_USER")
    if require_recipients and not settings.get("to_emails"):
        missing.append("ACTRA_FEEDBACK_EMAIL_TO")
    return missing


def _smtp_send_email(settings: Dict[str, Any], msg: EmailMessage) -> None:
    use_ssl = bool(settings.get("use_ssl"))
    use_tls = bool(settings.get("use_tls")) and not use_ssl
    host = str(settings.get("host") or "")
    port = int(settings.get("port") or 587)
    timeout = float(settings.get("timeout_sec") or 15.0)
    username = str(settings.get("username") or "")
    password = str(settings.get("password") or "")

    if use_ssl:
        with smtplib.SMTP_SSL(host, port, timeout=timeout) as smtp:
            smtp.ehlo()
            if username:
                smtp.login(username, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=timeout) as smtp:
            smtp.ehlo()
            if use_tls:
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
            if username:
                smtp.login(username, password)
            smtp.send_message(msg)


def _notify_feedback_via_email(ticket: Dict[str, Any], user: Optional[Any]) -> Dict[str, Any]:
    """
    Best-effort email notification for incoming feedback.

    Returns status dict:
    - {"sent": True}
    - {"sent": False, "reason": "<reason>"}
    """
    settings = _feedback_email_settings()
    if not settings["enabled"]:
        return {"sent": False, "reason": "disabled"}

    missing = _validate_feedback_email_settings(settings, require_recipients=True)
    if missing:
        logger.warning("[HTTP] Feedback email notification skipped: missing %s", ", ".join(missing))
        return {"sent": False, "reason": "not_configured"}

    msg = EmailMessage()
    msg["Subject"] = _build_feedback_email_subject(ticket)
    msg["From"] = settings["from_email"]
    msg["To"] = ", ".join(settings["to_emails"])
    msg["Date"] = formatdate(localtime=False)
    msg["X-ACTRA-Feedback-Ticket"] = str(ticket.get("ticket_id") or "")
    msg.set_content(_build_feedback_email_body(ticket, user), subtype="plain", charset="utf-8")

    try:
        _smtp_send_email(settings, msg)
    except Exception as exc:
        logger.exception(
            "[HTTP] Failed to send feedback email for ticket %s: %s", ticket.get("ticket_id"), exc
        )
        return {"sent": False, "reason": "send_failed"}

    return {"sent": True}


def _send_feedback_test_email(
    *,
    to_email: Optional[str] = None,
    subject: Optional[str] = None,
    body: Optional[str] = None,
) -> Dict[str, Any]:
    """Send test email using current feedback SMTP settings."""
    settings = _feedback_email_settings()
    if not settings["enabled"]:
        return {"sent": False, "reason": "disabled"}

    override_to = (to_email or "").strip()
    if override_to:
        settings["to_emails"] = [override_to]

    missing = _validate_feedback_email_settings(settings, require_recipients=True)
    if missing:
        logger.warning("[HTTP] Feedback test email skipped: missing %s", ", ".join(missing))
        return {"sent": False, "reason": "not_configured", "missing": missing}

    final_subject = (subject or "").strip() or "[ACTRA][TEST] Feedback SMTP test"
    final_body = (body or "").strip() or (
        "This is a test email from ACTRA feedback channel.\n\n"
        f"UTC time: {datetime.utcnow().isoformat()}Z\n"
        f"SMTP host: {settings['host']}\n"
        f"SMTP port: {settings['port']}\n"
        f"Use TLS: {bool(settings.get('use_tls')) and not bool(settings.get('use_ssl'))}\n"
        f"Use SSL: {bool(settings.get('use_ssl'))}\n"
    )

    msg = EmailMessage()
    msg["Subject"] = final_subject
    msg["From"] = settings["from_email"]
    msg["To"] = ", ".join(settings["to_emails"])
    msg["Date"] = formatdate(localtime=False)
    msg["X-ACTRA-Feedback-Test"] = "1"
    msg.set_content(final_body, subtype="plain", charset="utf-8")

    try:
        _smtp_send_email(settings, msg)
    except Exception as exc:
        logger.exception("[HTTP] Failed to send feedback test email: %s", exc)
        return {"sent": False, "reason": "send_failed"}

    return {
        "sent": True,
        "to": settings["to_emails"],
        "from": settings["from_email"],
        "host": settings["host"],
        "port": int(settings["port"]),
        "use_tls": bool(settings.get("use_tls")) and not bool(settings.get("use_ssl")),
        "use_ssl": bool(settings.get("use_ssl")),
    }


# ── Register misc helpers for routes/misc_routes.py ───────────────────
from routes._context import set_extra as _set_extra_misc  # noqa: E402
_set_extra_misc("misc_helpers", {
    "user_service": user_service,
    "load_legal_manifest": _load_legal_manifest,
    "legal_doc_path": _legal_doc_path,
    "get_consent_status": _get_consent_status,
    "extract_consent_payload": _extract_consent_payload,
    "validate_consent_payload": _validate_consent_payload,
    "write_user_consent": _write_user_consent,
    "get_cached_internet_connectivity": _get_cached_internet_connectivity,
    "feedback_email_settings": _feedback_email_settings,
    "validate_feedback_email_settings": _validate_feedback_email_settings,
    "update_manifest_url": _update_manifest_url,
    "manifest_url_requires_internet": _manifest_url_requires_internet,
    "env_bool": _env_bool,
    "build_update_status": _build_update_status,
    "FEEDBACK_TYPES": FEEDBACK_TYPES,
    "FEEDBACK_SEVERITIES": FEEDBACK_SEVERITIES,
    "send_feedback_test_email": _send_feedback_test_email,
    "retry_pending_feedback_notifications": _retry_pending_feedback_notifications,
    "build_feedback_ticket": _build_feedback_ticket,
    "save_feedback_ticket": _save_feedback_ticket,
    "notify_feedback_via_email": _notify_feedback_via_email,
    "update_feedback_delivery_fields": _update_feedback_delivery_fields,
})


# _normalize_complex_id, _enrich_complex_with_theory_link, _get_complex_by_id moved to routes/_helpers.py


@app.post("/api/client-log")
def client_log():
    logger.debug(f"[CLIENT_LOG_ENTRY][pid={os.getpid()}] client_log endpoint called")
    try:
        data = request.get_json(silent=True) or {}
        tag = str(data.get("tag") or "client")
        payload = data.get("payload")
        try:
            payload_json = json.dumps(payload, ensure_ascii=False, default=str)
        except Exception:
            payload_json = json.dumps(str(payload), ensure_ascii=False)
        if len(payload_json) > 8000:
            payload_json = payload_json[:8000] + "...<truncated>"
        logger.info("[CLIENT_LOG] tag=%s payload=%s", tag, payload_json)
        _flush_log_handlers()
        return ("", 204)
    except Exception as e:
        logger.exception("[CLIENT_LOG] failed: %s", e)
        _flush_log_handlers()
        return jsonify({"error": "client_log_failed"}), 500


def _json_safe(obj: Any) -> Any:
    if obj is None:
        return None

    if isinstance(obj, (datetime, date)):
        try:
            return obj.isoformat()
        except Exception:
            return str(obj)

    obj_module = type(obj).__module__
    if obj_module and obj_module.split(".", 1)[0] == "numpy" and hasattr(obj, "item"):
        try:
            return obj.item()
        except Exception:
            pass

    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]

    return obj


@app.before_request
def _log_request() -> None:
    """Log incoming HTTP request (method + path).

    Тела запросов намеренно не логируем целиком, чтобы не зашумлять логи,
    кроме отдельных точек (submit/next), которые логируются отдельно.
    """

    if not FLASK_DEBUG_ENABLED:
        return

    try:
        logger.debug("[HTTP] %s %s", request.method, request.path)
    except Exception:
        # Логирование не должно ломать обработку запроса
        pass


@app.after_request
def _log_response(response):  # type: ignore[override]
    """Log outgoing HTTP response status for each request."""

    if not FLASK_DEBUG_ENABLED:
        return response

    try:
        logger.debug("[HTTP] %s %s -> %s", request.method, request.path, response.status)
    except Exception:
        pass
    return response


@app.route("/health", methods=["GET"])
def health() -> Any:
    return jsonify({"status": "ok"})



# NOTE: /ui/complexes, /ui/welcome, /Welcome/<path> routes moved to routes/static_routes.py



# NOTE: /api/users/should-welcome, /api/legal/*, /api/consent/*, /api/network/status,
# /api/update/check, /api/feedback/* routes moved to routes/misc_routes.py



# NOTE: /ui, /ui/main, /ui/complexes/create, /ui/TestUI, /ui/SequenceUI, /ui/ClickUI
# routes moved to routes/static_routes.py



# NOTE: /api/evaluation/messages route moved to routes/misc_routes.py



# NOTE: /ui/DrawUI, /ui/OpenAnswerUI, /ui/MistakesUI, /ui/editor, /ui/calendar,
# /ui/statistics, /ui/microcards, /assets, /favicon.ico routes moved to routes/static_routes.py


# ---------------------------------------------------------------------------
# Calendar API Routes — registered via create_calendar_routes() in calendar_api.py.
# Do NOT add standalone calendar routes here to avoid duplicate registration.
# ---------------------------------------------------------------------------



# NOTE: /api/editor/* CRUD + import/export routes moved to routes/editor_routes.py


# NOTE: /ui/session/<id>, /ui/S1/<path>, /ui/session/<id>/iteration/<id>,
# /ui/session/<id>/results routes moved to routes/static_routes.py



# NOTE: /api/session/<id>/start, /api/ui/quick-access/*, /api/ui/settings,
# /api/complexes, /api/complexes/<id> moved to routes/quick_access_routes.py


# ---------------------------------------------------------------------------
# User & Profiles API
# ---------------------------------------------------------------------------



# NOTE: GET /api/users moved to routes/users_routes.py

# _is_within_data_dir and _resolve_editor_image_path moved to routes/_helpers.py
from routes._helpers import _is_within_data_dir, _resolve_editor_image_path





# NOTE: POST /api/users, GET /api/users/current, POST /api/users/select,
# POST /api/users/update, POST /api/users/verify-password, POST /api/users/delete,
# GET /api/assets/avatars, GET /api/assets/avatars/<path> moved to routes/users_routes.py


# ---------------------------------------------------------------------------
# Statistics API
# ---------------------------------------------------------------------------



# NOTE: /api/statistics/*, /api/task-catalog moved to routes/statistics_routes.py



# NOTE: /api/theories/* routes moved to routes/theories_routes.py



# NOTE: /api/complexes/* CRUD routes moved to routes/complexes_routes.py



# NOTE: /api/session/*, /api/sessions/active, /api/local-image moved to routes/session_routes.py


# ---------------------------------------------------------------------------
# AI Generation API
# ---------------------------------------------------------------------------


# NOTE: /api/editor/ai/status, /analyze, /analyses, /analyses/<id>, /analyses/<id>/coverage
# routes moved to routes/ai_routes.py


# NOTE: /api/editor/theory/rollout/* routes moved to routes/microcards_routes.py



# NOTE: /api/microcards/*, /api/editor/microcards/* routes moved to routes/microcards_routes.py


@app.route("/api/editor/ai/generate", methods=["POST"])
def ai_generate() -> Any:
    """Phase 2: Generate tasks of selected types."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    if _ai_service is None or not _ai_service.is_configured:
        return jsonify({
            "ok": False,
            "error": "ai_unavailable",
            "message": "Сервис ИИ-генерации недоступен.",
        }), 503
    if not PARSERS_AVAILABLE:
        return jsonify({"ok": False, "error": "parsers_not_available"}), 500

    payload = request.get_json(silent=True) or {}
    material = payload.get("material", "")
    tasks_to_generate = payload.get("tasks_to_generate", [])
    ai_run_id = _safe_ai_run_id(payload.get("ai_run_id"))

    if not material or not isinstance(material, str):
        return jsonify({"ok": False, "error": "material_required"}), 400
    if not tasks_to_generate or not isinstance(tasks_to_generate, list):
        return jsonify({"ok": False, "error": "tasks_to_generate_required"}), 400

    material_language = _guess_language_code(material)
    output_language_pref = _normalize_output_language_request(payload, material_language)

    # Map task_type -> parser class
    _PARSER_MAP = {
        "TEST": TestImportParser,
        "OPEN_ANSWER": OpenAnswerParser,
        "SEQUENCE": SequenceParser,
        "CLICK_TEXT": ClickTextParser,
        "CLICK_WORDS": ClickWordsParser,
    }

    # Map task_type -> marker for parse_text
    _MARKER_MAP = {
        "TEST": "@TEST",
        "OPEN_ANSWER": "@OPEN_ANSWER",
        "SEQUENCE": "@SEQUENCE",
        "CLICK_TEXT": "@CLICK_TEXT",
        "CLICK_WORDS": "@CLICK_WORDS",
    }

    def _parse_ai_response_for_type(task_type_local: str, raw_response_local: str) -> tuple[list, Any, list]:
        parser_cls_local = _PARSER_MAP[task_type_local]
        marker_local = _MARKER_MAP[task_type_local]
        parsed_local = []
        parser_local = None
        parse_errors_local: List[str] = []
        try:
            parser_local = parser_cls_local()
            text_to_parse_local = raw_response_local or ""
            if marker_local not in text_to_parse_local:
                text_to_parse_local = f"{marker_local}\n{text_to_parse_local}"
            parsed_local = parser_local.parse_text(text_to_parse_local)
            if getattr(parser_local, "errors", None):
                parse_errors_local.extend(parser_local.errors)
        except Exception as parse_exc_local:
            logger.error("[HTTP] ai/generate parse %s failed: %s", task_type_local, parse_exc_local)
            parse_errors_local.append(f"Ошибка парсинга {task_type_local}: {str(parse_exc_local)}")
        return parsed_local, parser_local, parse_errors_local

    def _build_ai_preview_tasks(
        task_type_local: str,
        parsed_tasks_local: List[Dict[str, Any]],
        parser_local: Any,
        index_base_local: int = 0,
    ) -> List[Dict[str, Any]]:
        preview_tasks_local: List[Dict[str, Any]] = []
        parser_warnings_local = getattr(parser_local, "warnings", []) if parser_local is not None else []
        for i_local, task_local in enumerate(parsed_tasks_local):
            task_data_local = task_local.get("data", {})
            validation_issues_local = []

            for w in parser_warnings_local or []:
                if w.get("index", 0) != i_local:
                    continue
                if task_type_local == "TEST" and w.get("code") == "multiple_correct":
                    continue
                validation_issues_local.append({
                    "severity": w.get("severity", "warning"),
                    "message": w.get("message", ""),
                    "field": w.get("code", "unknown"),
                })

            try:
                validation_issues_local.extend(_validate_with_task_type(task_local.get("type", "unknown"), task_data_local))
            except Exception as validator_exc_local:
                logger.warning(
                    "[HTTP] ai/generate validation failed for %s #%s: %s",
                    task_type_local,
                    i_local,
                    validator_exc_local,
                )
                validation_issues_local.append({
                    "severity": "warning",
                    "message": f"Validation check failed: {validator_exc_local}",
                    "field": "validation_runtime",
                })

            status_local = "valid"
            if any(v.get("severity") == "error" for v in validation_issues_local):
                status_local = "error"
            elif validation_issues_local:
                status_local = "warning"

            preview_tasks_local.append({
                "index": index_base_local + i_local,
                "type": task_local.get("type", "unknown"),
                "name": task_local.get("name", f"Task #{i_local + 1}"),
                "prompt": task_local.get("prompt", ""),
                "data": task_data_local,
                "status": status_local,
                "validation_issues": validation_issues_local,
            })
        return preview_tasks_local

    def _preview_sort_key(task_type_local: str, preview_local: Dict[str, Any]) -> tuple:
        status_rank = {"valid": 0, "warning": 1, "error": 2}
        issues_local = preview_local.get("validation_issues") or []
        issue_fields = [str(v.get("field") or "") for v in issues_local if isinstance(v, dict)]
        critical_click_words = {"error_spans_count_high", "error_spans_count_low", "unbalanced_brackets"}
        critical_count = sum(1 for field in issue_fields if field in critical_click_words)
        grounding_info_local = _source_grounding_info_from_preview(preview_local) or {}
        semantic_dup_info_local = _semantic_duplicate_info_from_preview(preview_local) or {}
        grounding_weak_local = bool(grounding_info_local.get("weak"))
        semantic_dup_local = bool(semantic_dup_info_local.get("candidate"))
        try:
            grounding_score_local = float(grounding_info_local.get("score", 0.0) or 0.0)
        except Exception:
            grounding_score_local = 0.0
        try:
            semantic_dup_score_local = float(semantic_dup_info_local.get("score", 0.0) or 0.0)
        except Exception:
            semantic_dup_score_local = 0.0
        return (
            status_rank.get(str(preview_local.get("status") or "warning"), 1),
            critical_count if task_type_local == "CLICK_WORDS" else 0,
            1 if semantic_dup_local else 0,
            semantic_dup_score_local if semantic_dup_local else 0.0,
            1 if grounding_weak_local else 0,
            -grounding_score_local,
            len(issues_local),
            len(str(preview_local.get("prompt") or "")),
        )

    def _reindex_previews(previews_local: List[Dict[str, Any]], index_base_local: int) -> None:
        for offset_local, preview_local in enumerate(previews_local):
            if isinstance(preview_local, dict):
                preview_local["index"] = index_base_local + offset_local

    def _annotate_previews_source_grounding(
        previews_local: List[Dict[str, Any]],
        unit_contexts_local: List[Dict[str, Any]],
        *,
        task_type_hint_local: Optional[str] = None,
    ) -> None:
        if not isinstance(previews_local, list) or not unit_contexts_local:
            return
        for preview_local in previews_local:
            if not isinstance(preview_local, dict):
                continue
            task_type_preview_local = str(task_type_hint_local or preview_local.get("type") or "")
            _annotate_task_preview_source_grounding(
                preview_local,
                unit_contexts_local,
                task_type=task_type_preview_local,
            )

    def _count_weak_source_grounding_tasks(previews_local: List[Dict[str, Any]]) -> int:
        count_local = 0
        for preview_local in previews_local or []:
            grounding_local = _source_grounding_info_from_preview(preview_local) or {}
            if bool(grounding_local.get("weak")):
                count_local += 1
        return count_local

    def _annotate_previews_semantic_duplicates(previews_local: List[Dict[str, Any]], task_type_local: str) -> Dict[str, int]:
        if not isinstance(previews_local, list) or len(previews_local) < 2:
            return {"groups": 0, "tasks_marked": 0}
        return _annotate_semantic_duplicate_candidates(previews_local, task_type=task_type_local)

    def _count_semantic_duplicate_tasks(previews_local: List[Dict[str, Any]]) -> int:
        count_local = 0
        for preview_local in previews_local or []:
            dup_local = _semantic_duplicate_info_from_preview(preview_local) or {}
            if bool(dup_local.get("candidate")):
                count_local += 1
        return count_local

    def _has_remaining_providers_after(
        provider_name_local: Optional[str],
        preferred_provider_names_local: Optional[List[str]] = None,
    ) -> bool:
        if not provider_name_local:
            return False
        iter_chain_fn = getattr(_ai_service, "_iter_provider_chain", None)
        if not callable(iter_chain_fn):
            return False
        try:
            remaining = iter_chain_fn(
                start_after_provider=provider_name_local,
                preferred_provider_names=preferred_provider_names_local,
            )
            return bool(remaining)
        except Exception:
            return False

    def _provider_preferences_for_task_type(task_type_local: str) -> Optional[List[str]]:
        """Prefer stricter-format models first for parser-sensitive generation types."""
        task_type_norm = str(task_type_local or "").upper()
        # Arcee has shown better format discipline for parser-sensitive generation
        # (especially SEQUENCE and CLICK_WORDS) in benchmark runs.
        if task_type_norm in {"SEQUENCE", "CLICK_WORDS"}:
            return ["openrouter:3", "openrouter:2"]
        return None

    def _build_generate_format_repair_hint(task_type_local: str, expected_count_local: int) -> str:
        if task_type_local == "CLICK_TEXT":
            return (
                f"Format recovery mode. Return exactly {expected_count_local} @CLICK_TEXT blocks and no extra text. "
                "Each block must use strict syntax only: @CLICK_TEXT, then one line starting with # (question), "
                "then 3-6 answer lines starting with + or -. No Markdown, no prose, no numbering."
            )
        if task_type_local == "CLICK_WORDS":
            return (
                f"Format recovery mode. Return exactly {expected_count_local} @CLICK_WORDS blocks and no extra text. "
                "Use strict @CLICK_WORDS syntax only with matched [ ] markers for erroneous tokens."
            )
        if task_type_local == "SEQUENCE":
            return (
                f"Format recovery mode. Return exactly {expected_count_local} @SEQUENCE blocks and no extra text. "
                "Use strict parser syntax only: @SEQUENCE, one # line, at least 3 lines like 'element_1: ...', "
                "then one or more lines like 'level_1: element_1, element_2'. Levels must reference existing element_X IDs only."
            )
        if task_type_local == "TEST":
            return (
                f"Format recovery mode. Return exactly {expected_count_local} @TEST blocks and no extra text. "
                "Use strict parser syntax only (@TEST, # title, ? question, answer lines with + or -)."
            )
        if task_type_local == "OPEN_ANSWER":
            return (
                f"Format recovery mode. Return exactly {expected_count_local} @OPEN_ANSWER blocks and no extra text. "
                "Use strict parser syntax only."
            )
        return f"Format recovery mode. Return exactly {expected_count_local} blocks in strict parser syntax only."

    def _parse_probe_score(parsed_local: List[Dict[str, Any]], parse_errors_local: List[str]) -> tuple:
        return (
            len(parsed_local),
            -len(parse_errors_local),
        )

    def _generate_raw_with_parse_escalation(
        task_type_local: str,
        count_local: int,
        edu_units_local: List[Dict[str, Any]],
        *,
        extra_instructions_local: Optional[str] = None,
        preferred_provider_names_local: Optional[List[str]] = None,
    ) -> tuple[str, Optional[str], List[Dict[str, Any]]]:
        def _probe_test_repair_issue_count(previews_local: List[Dict[str, Any]]) -> int:
            count_bad_local = 0
            for preview_local in previews_local or []:
                if not isinstance(preview_local, dict):
                    continue
                issue_fields_local = {
                    str(issue.get("field") or "")
                    for issue in (preview_local.get("validation_issues") or [])
                    if isinstance(issue, dict)
                }
                has_issue_local = bool(issue_fields_local & {"questions", "no_correct_answer", "no_answers", "empty_question"})

                if not has_issue_local:
                    data_local = preview_local.get("data") or {}
                    questions_local = data_local.get("questions") if isinstance(data_local, dict) else None
                    if not isinstance(questions_local, list) or not questions_local:
                        has_issue_local = True
                    else:
                        for q_local in questions_local:
                            if not isinstance(q_local, dict):
                                has_issue_local = True
                                break
                            answers_local = q_local.get("answers") or []
                            if not isinstance(answers_local, list) or not answers_local:
                                has_issue_local = True
                                break
                            correct_flags_local = [
                                bool(a.get("correct", a.get("is_correct", False)))
                                for a in answers_local
                                if isinstance(a, dict)
                            ]
                            if not correct_flags_local or not any(correct_flags_local) or all(correct_flags_local):
                                has_issue_local = True
                                break
                if has_issue_local:
                    count_bad_local += 1
            return count_bad_local

        def _probe_sequence_repair_issue_count(previews_local: List[Dict[str, Any]]) -> int:
            count_bad_local = 0
            target_fields_local = {
                "elements",
                "levels",
                "duplicate_element_id",
                "too_few_elements",
                "unused_element",
                "too_many_levels",
            }
            for preview_local in previews_local or []:
                if not isinstance(preview_local, dict):
                    continue
                issue_fields_local = {
                    str(issue.get("field") or "")
                    for issue in (preview_local.get("validation_issues") or [])
                    if isinstance(issue, dict)
                }
                has_issue_local = bool(issue_fields_local & target_fields_local)
                if not has_issue_local:
                    data_local = preview_local.get("data") or {}
                    if not isinstance(data_local, dict):
                        has_issue_local = True
                    else:
                        elements_local = data_local.get("elements") or {}
                        levels_local = data_local.get("levels") or {}
                        if not elements_local or not levels_local:
                            has_issue_local = True
                        elif hasattr(elements_local, "__len__") and len(elements_local) < 3:
                            has_issue_local = True
                if has_issue_local:
                    count_bad_local += 1
            return count_bad_local

        raw_response_local, provider_name_local = _ai_service.generate_tasks(
            material,
            task_type_local,
            count_local,
            edu_units_local,
            target_language_override=output_language_pref.get("effective"),
            extra_instructions=extra_instructions_local,
            preferred_provider_names=preferred_provider_names_local,
        )
        chain_local = list(_ai_service.consume_last_provider_chain_attempts())

        parsed_probe_local, parser_probe_local, parse_probe_errors_local = _parse_ai_response_for_type(
            task_type_local,
            raw_response_local or "",
        )
        expected_count_local = max(1, int(count_local or 1))
        probe_preview_local: List[Dict[str, Any]] = []
        probe_repair_issue_count_local = 0
        probe_sequence_issue_count_local = 0
        if task_type_local == "TEST":
            probe_preview_local = _build_ai_preview_tasks(task_type_local, parsed_probe_local, parser_probe_local, index_base_local=0)
            probe_repair_issue_count_local = _probe_test_repair_issue_count(probe_preview_local)
        elif task_type_local == "SEQUENCE":
            probe_preview_local = _build_ai_preview_tasks(task_type_local, parsed_probe_local, parser_probe_local, index_base_local=0)
            probe_sequence_issue_count_local = _probe_sequence_repair_issue_count(probe_preview_local)

        needs_escalation = (
            bool(parse_probe_errors_local)
            or len(parsed_probe_local) < expected_count_local
            or (task_type_local == "TEST" and probe_repair_issue_count_local > 0)
            or (task_type_local == "SEQUENCE" and probe_sequence_issue_count_local > 0)
        )

        if not needs_escalation or not _has_remaining_providers_after(
            provider_name_local,
            preferred_provider_names_local=preferred_provider_names_local,
        ):
            return raw_response_local, provider_name_local, chain_local

        format_hint_local = _build_generate_format_repair_hint(task_type_local, expected_count_local)
        if extra_instructions_local:
            escalation_extra_local = f"{extra_instructions_local} {format_hint_local}"
        else:
            escalation_extra_local = format_hint_local

        try:
            escalated_raw_local, escalated_provider_name_local = _ai_service.generate_tasks(
                material,
                task_type_local,
                count_local,
                edu_units_local,
                target_language_override=output_language_pref.get("effective"),
                extra_instructions=escalation_extra_local,
                start_after_provider=provider_name_local,
                preferred_provider_names=preferred_provider_names_local,
            )
            chain_local.extend(_ai_service.consume_last_provider_chain_attempts())
        except Exception:
            chain_local.extend(_ai_service.consume_last_provider_chain_attempts())
            return raw_response_local, provider_name_local, chain_local

        escalated_parsed_local, escalated_parser_local, escalated_parse_errors_local = _parse_ai_response_for_type(
            task_type_local,
            escalated_raw_local or "",
        )
        escalated_repair_issue_count_local = 0
        escalated_sequence_issue_count_local = 0
        if task_type_local == "TEST":
            escalated_preview_local = _build_ai_preview_tasks(
                task_type_local,
                escalated_parsed_local,
                escalated_parser_local,
                index_base_local=0,
            )
            escalated_repair_issue_count_local = _probe_test_repair_issue_count(escalated_preview_local)
        elif task_type_local == "SEQUENCE":
            escalated_preview_local = _build_ai_preview_tasks(
                task_type_local,
                escalated_parsed_local,
                escalated_parser_local,
                index_base_local=0,
            )
            escalated_sequence_issue_count_local = _probe_sequence_repair_issue_count(escalated_preview_local)

        initial_score_local = (
            *_parse_probe_score(parsed_probe_local, parse_probe_errors_local),
            -probe_repair_issue_count_local if task_type_local == "TEST" else 0,
            -probe_sequence_issue_count_local if task_type_local == "SEQUENCE" else 0,
        )
        escalated_score_local = (
            *_parse_probe_score(escalated_parsed_local, escalated_parse_errors_local),
            -escalated_repair_issue_count_local if task_type_local == "TEST" else 0,
            -escalated_sequence_issue_count_local if task_type_local == "SEQUENCE" else 0,
        )

        if escalated_score_local > initial_score_local:
            return escalated_raw_local, escalated_provider_name_local, chain_local

        return raw_response_local, provider_name_local, chain_local

    results = []
    total_generated = 0
    total_valid = 0
    total_warnings = 0
    total_errors = 0
    by_type = {}

    for task_spec in tasks_to_generate:
        task_type = task_spec.get("task_type", "")
        count = task_spec.get("count", 3)
        edu_units = task_spec.get("educational_units", [])
        task_type_provider_preferences = _provider_preferences_for_task_type(task_type)
        edu_unit_ids = [
            u.get("id")
            for u in (edu_units if isinstance(edu_units, list) else [])
            if isinstance(u, dict) and u.get("id") is not None
        ]
        edu_unit_contexts = _compact_ai_unit_contexts(edu_units, max_units=10)

        if task_type not in _PARSER_MAP:
            results.append({
                "task_type": task_type,
                "status": "error",
                "error": f"Unknown task type: {task_type}",
                "tasks": [],
                "parsing_errors": [f"Неизвестный тип задания: {task_type}"],
                "generation_time_ms": 0,
                "educational_unit_ids": edu_unit_ids,
            })
            total_errors += 1
            continue

        subrequests = _plan_ai_generation_subrequests(task_type, count, edu_units)
        start_time = time.time()
        provider_name = None
        raw_chunks: List[str] = []
        parsing_errors = []
        subrequest_failures = 0
        provider_chain_attempts: List[Dict[str, Any]] = []

        for sub_idx, sub in enumerate(subrequests):
            sub_count = max(1, int(sub.get("count") or 1))
            sub_units = sub.get("educational_units") or []
            try:
                sub_raw_response, sub_provider_name, sub_chain_attempts = _generate_raw_with_parse_escalation(
                    task_type,
                    sub_count,
                    sub_units,
                    extra_instructions_local=None,
                    preferred_provider_names_local=task_type_provider_preferences,
                )
                if sub_provider_name and provider_name is None:
                    provider_name = sub_provider_name
                provider_chain_attempts.extend(sub_chain_attempts)
                if isinstance(sub_raw_response, str) and sub_raw_response.strip():
                    raw_chunks.append(sub_raw_response)
            except Exception as gen_exc:
                provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                subrequest_failures += 1
                logger.error(
                    "[HTTP] ai/generate %s subrequest %d/%d failed: %s",
                    task_type,
                    sub_idx + 1,
                    len(subrequests),
                    gen_exc,
                )
                parsing_errors.append(
                    f"Ошибка генерации {task_type} (part {sub_idx + 1}/{len(subrequests)}): {str(gen_exc)}"
                )

        if not raw_chunks:
            results.append({
                "task_type": task_type,
                "status": "error",
                "error": "all_subrequests_failed",
                "tasks": [],
                "parsing_errors": parsing_errors or [f"Ошибка генерации {task_type}"],
                "generation_time_ms": int((time.time() - start_time) * 1000),
                "educational_unit_ids": edu_unit_ids,
                "subrequest_count": len(subrequests),
                "provider_chain_attempts": provider_chain_attempts,
            })
            total_errors += 1
            continue

        raw_response = "\n\n".join(raw_chunks)
        requested_count = max(1, int(count or 1))

        # Parse the LLM response through the appropriate parser
        parsed_tasks, parser, parse_errors_local = _parse_ai_response_for_type(task_type, raw_response)
        if parse_errors_local:
            parsing_errors.extend(parse_errors_local)
        preview_tasks = _build_ai_preview_tasks(task_type, parsed_tasks, parser, index_base_local=0)
        _annotate_previews_source_grounding(preview_tasks, edu_unit_contexts, task_type_hint_local=task_type)

        repair_attempted = False
        repair_subrequest_count = 0

        def _valid_count(previews_local: List[Dict[str, Any]]) -> int:
            return sum(1 for p in previews_local if str(p.get("status") or "") == "valid")

        def _count_click_words_repair_issue_tasks(previews_local: List[Dict[str, Any]]) -> int:
            target_fields = {"error_spans_count_high", "error_spans_count_low", "unbalanced_brackets"}
            count_local = 0
            for p in previews_local:
                has_repair_issue = False
                for issue in (p.get("validation_issues") or []):
                    if str(issue.get("field") or "") in target_fields:
                        has_repair_issue = True
                        break
                if has_repair_issue:
                    count_local += 1
            return count_local

        def _has_click_words_repair_issues(previews_local: List[Dict[str, Any]]) -> bool:
            return _count_click_words_repair_issue_tasks(previews_local) > 0

        def _sequence_task_has_repairable_issues(preview_local: Dict[str, Any]) -> bool:
            if not isinstance(preview_local, dict):
                return False
            issue_fields_local = {
                str(issue.get("field") or "")
                for issue in (preview_local.get("validation_issues") or [])
                if isinstance(issue, dict)
            }
            if issue_fields_local & {
                "elements",
                "levels",
                "duplicate_element_id",
                "too_few_elements",
                "unused_element",
                "too_many_levels",
            }:
                return True
            if str(preview_local.get("status") or "") == "error":
                return True
            data_local = preview_local.get("data") or {}
            if not isinstance(data_local, dict):
                return True
            elements_local = data_local.get("elements") or {}
            levels_local = data_local.get("levels") or {}
            if not elements_local or not levels_local:
                return True
            if hasattr(elements_local, "__len__") and len(elements_local) < 3:
                return True
            return False

        def _count_sequence_repair_issue_tasks(previews_local: List[Dict[str, Any]]) -> int:
            return sum(1 for p in previews_local if _sequence_task_has_repairable_issues(p))

        def _test_task_has_repairable_issues(preview_local: Dict[str, Any]) -> bool:
            if not isinstance(preview_local, dict):
                return False

            issue_fields_local = {
                str(issue.get("field") or "")
                for issue in (preview_local.get("validation_issues") or [])
                if isinstance(issue, dict)
            }
            if issue_fields_local & {"questions", "no_correct_answer", "no_answers", "empty_question"}:
                return True

            data_local = preview_local.get("data") or {}
            if not isinstance(data_local, dict):
                return False
            questions_local = data_local.get("questions") or []
            if not isinstance(questions_local, list):
                return True

            for q_local in questions_local:
                if not isinstance(q_local, dict):
                    return True
                q_text_local = str(q_local.get("text") or "").strip()
                if not q_text_local:
                    return True
                answers_local = q_local.get("answers") or []
                if not isinstance(answers_local, list) or not answers_local:
                    return True

                normalized_answer_texts: List[str] = []
                correct_flags_local: List[bool] = []
                for ans_local in answers_local:
                    if not isinstance(ans_local, dict):
                        continue
                    ans_text_local = str(ans_local.get("text") or "").strip()
                    if not ans_text_local:
                        return True
                    normalized_answer_texts.append(re.sub(r"\s+", " ", ans_text_local).lower())
                    correct_flags_local.append(bool(ans_local.get("correct", ans_local.get("is_correct", False))))

                if not correct_flags_local:
                    return True
                if not any(correct_flags_local):
                    return True
                if all(correct_flags_local):
                    return True
                if len(set(normalized_answer_texts)) < len(normalized_answer_texts):
                    return True

            return False

        def _count_test_repair_issue_tasks(previews_local: List[Dict[str, Any]]) -> int:
            return sum(1 for p in previews_local if _test_task_has_repairable_issues(p))

        repair_count = 0
        if task_type == "CLICK_WORDS":
            current_valid_count = _valid_count(preview_tasks)
            if current_valid_count < requested_count and (
                _has_click_words_repair_issues(preview_tasks)
                or len(preview_tasks) != requested_count
                or bool(parsing_errors)
            ):
                repair_count = max(1, requested_count - current_valid_count)
        elif task_type == "TEST":
            current_valid_count = _valid_count(preview_tasks)
            test_issue_count = _count_test_repair_issue_tasks(preview_tasks)
            if test_issue_count > 0 or current_valid_count < requested_count or bool(parsing_errors):
                repair_count = max(1, min(requested_count, max(test_issue_count, requested_count - current_valid_count)))
        elif task_type == "CLICK_TEXT":
            current_valid_count = _valid_count(preview_tasks)
            if current_valid_count < requested_count and (
                len(preview_tasks) < requested_count
                or bool(parsing_errors)
            ):
                repair_count = max(1, requested_count - current_valid_count)
        elif task_type == "SEQUENCE":
            current_valid_count = _valid_count(preview_tasks)
            sequence_issue_count = _count_sequence_repair_issue_tasks(preview_tasks)
            if sequence_issue_count > 0 or current_valid_count < requested_count or bool(parsing_errors):
                repair_count = max(
                    1,
                    min(requested_count, max(sequence_issue_count, requested_count - current_valid_count)),
                )

        if repair_count > 0:
            repair_attempted = True
            if task_type == "CLICK_WORDS":
                repair_hint = (
                    f"Repair mode. Return exactly {repair_count} @CLICK_WORDS blocks and no extra blocks. "
                    "Each block must contain exactly 2-4 bracketed factual errors. "
                    "Use matched [ ] brackets only and wrap minimal erroneous token(s)."
                )
            elif task_type == "TEST":
                repair_hint = (
                    f"Repair mode. Return exactly {repair_count} @TEST blocks and no extra blocks. "
                    "Strict parser syntax only: @TEST, one # title line, one or more ? question lines, and answer lines prefixed with + or -. "
                    "Every question must have at least 2 answers, at least one correct (+) and at least one incorrect (-). "
                    "Avoid duplicate answer texts and trivial distractors."
                )
            elif task_type == "CLICK_TEXT":
                repair_hint = (
                    f"Repair mode. Return exactly {repair_count} @CLICK_TEXT blocks and no extra blocks. "
                    "Strict syntax only: @CLICK_TEXT, one # question line, then 3-6 answer lines prefixed with + or -. "
                    "No prose, no Markdown, no numbered lists."
                )
            else:
                repair_hint = (
                    f"Repair mode. Return exactly {repair_count} @SEQUENCE blocks and no extra blocks. "
                    "Use strict parser syntax only: @SEQUENCE, one # line, at least 3 element_X lines, then level_X lines "
                    "that reference only existing element_X IDs. Include the ordering principle in the # line. No prose or Markdown."
                )
            try:
                repair_raw_response, repair_provider_name, repair_chain_attempts = _generate_raw_with_parse_escalation(
                    task_type,
                    repair_count,
                    edu_units,
                    extra_instructions_local=repair_hint,
                    preferred_provider_names_local=task_type_provider_preferences,
                )
                repair_subrequest_count += 1
                if repair_provider_name and provider_name is None:
                    provider_name = repair_provider_name
                provider_chain_attempts.extend(repair_chain_attempts)
                repair_parsed_tasks, repair_parser, repair_parse_errors = _parse_ai_response_for_type(
                    task_type,
                    repair_raw_response or "",
                )
                if repair_parse_errors:
                    parsing_errors.extend([f"[repair-pass] {e}" for e in repair_parse_errors])
                repair_preview_tasks = _build_ai_preview_tasks(task_type, repair_parsed_tasks, repair_parser, index_base_local=0)
                _annotate_previews_source_grounding(repair_preview_tasks, edu_unit_contexts, task_type_hint_local=task_type)
                preview_tasks.extend(repair_preview_tasks)
            except Exception as repair_exc:
                provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                logger.warning("[HTTP] ai/generate repair-pass %s failed: %s", task_type, repair_exc)
                parsing_errors.append(f"Repair-pass failed for {task_type}: {str(repair_exc)}")

        if preview_tasks and (task_type in {"CLICK_WORDS", "SEQUENCE", "TEST"} or len(preview_tasks) > requested_count):
            preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))

        if len(preview_tasks) > requested_count:
            dropped_count = len(preview_tasks) - requested_count
            preview_tasks = preview_tasks[:requested_count]
            parsing_errors.append(
                f"Overgeneration trimmed for {task_type}: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
            )

        # Iterative fill for CLICK_WORDS:
        # if model still under-produces valid tasks after initial repair, try a few additional rounds.
        if task_type == "CLICK_WORDS":
            max_click_words_fill_rounds = 2
            fill_round = 0
            previous_valid_count = _valid_count(preview_tasks)
            while fill_round < max_click_words_fill_rounds and previous_valid_count < requested_count:
                fill_round += 1
                repair_attempted = True
                fill_count = max(1, requested_count - previous_valid_count)
                fill_hint = (
                    f"Iterative fill repair round {fill_round}. Return exactly {fill_count} @CLICK_WORDS blocks and no extra blocks. "
                    "Strict parser-safe syntax only. Each block must contain exactly 2-4 bracketed factual errors, "
                    "with matched [ ] markers around minimal erroneous token(s). Prefer short, clean tasks."
                )
                try:
                    fill_raw_response, fill_provider_name, fill_chain_attempts = _generate_raw_with_parse_escalation(
                        task_type,
                        fill_count,
                        edu_units,
                        extra_instructions_local=fill_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if fill_provider_name and provider_name is None:
                        provider_name = fill_provider_name
                    provider_chain_attempts.extend(fill_chain_attempts)
                    fill_parsed_tasks, fill_parser, fill_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        fill_raw_response or "",
                    )
                    if fill_parse_errors:
                        parsing_errors.extend([f"[iterative-repair-{fill_round}] {e}" for e in fill_parse_errors])
                    fill_preview_tasks = _build_ai_preview_tasks(task_type, fill_parsed_tasks, fill_parser, index_base_local=0)
                    _annotate_previews_source_grounding(fill_preview_tasks, edu_unit_contexts, task_type_hint_local=task_type)
                    if fill_preview_tasks:
                        preview_tasks.extend(fill_preview_tasks)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after iterative repair {fill_round}: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                    new_valid_count = _valid_count(preview_tasks)
                    if new_valid_count <= previous_valid_count:
                        parsing_errors.append(
                            f"Iterative repair {fill_round} made no valid-progress for {task_type} (valid {new_valid_count}/{requested_count})."
                        )
                        break
                    previous_valid_count = new_valid_count
                except Exception as fill_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate iterative repair-pass %s failed: %s", task_type, fill_exc)
                    parsing_errors.append(f"Iterative repair-pass failed for {task_type} (round {fill_round}): {str(fill_exc)}")
                    break

        # Iterative fill for SEQUENCE:
        # if model still under-produces valid tasks after initial repair, retry with stricter parser-aware format hints.
        if task_type == "SEQUENCE":
            max_sequence_fill_rounds = 2
            sequence_fill_round = 0
            previous_valid_count = _valid_count(preview_tasks)
            while sequence_fill_round < max_sequence_fill_rounds and previous_valid_count < requested_count:
                sequence_fill_round += 1
                repair_attempted = True
                fill_count = max(1, requested_count - previous_valid_count)
                sequence_fill_hint = (
                    f"Iterative fill repair round {sequence_fill_round}. Return exactly {fill_count} @SEQUENCE blocks and no extra blocks. "
                    "Strict parser syntax only: @SEQUENCE, one # line, at least 3 lines 'element_N: text', and one or more "
                    "lines 'level_N: element_1, element_2'. Levels must reference only declared element_N IDs. No prose or Markdown."
                )
                try:
                    seq_fill_raw_response, seq_fill_provider_name, seq_fill_chain_attempts = _generate_raw_with_parse_escalation(
                        task_type,
                        fill_count,
                        edu_units,
                        extra_instructions_local=sequence_fill_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if seq_fill_provider_name and provider_name is None:
                        provider_name = seq_fill_provider_name
                    provider_chain_attempts.extend(seq_fill_chain_attempts)
                    seq_fill_parsed_tasks, seq_fill_parser, seq_fill_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        seq_fill_raw_response or "",
                    )
                    if seq_fill_parse_errors:
                        parsing_errors.extend([f"[iterative-sequence-{sequence_fill_round}] {e}" for e in seq_fill_parse_errors])
                    seq_fill_preview_tasks = _build_ai_preview_tasks(task_type, seq_fill_parsed_tasks, seq_fill_parser, index_base_local=0)
                    _annotate_previews_source_grounding(seq_fill_preview_tasks, edu_unit_contexts, task_type_hint_local=task_type)
                    if seq_fill_preview_tasks:
                        preview_tasks.extend(seq_fill_preview_tasks)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after iterative repair {sequence_fill_round}: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                    new_valid_count = _valid_count(preview_tasks)
                    if new_valid_count <= previous_valid_count:
                        parsing_errors.append(
                            f"Iterative repair {sequence_fill_round} made no valid-progress for {task_type} (valid {new_valid_count}/{requested_count})."
                        )
                        break
                    previous_valid_count = new_valid_count
                except Exception as seq_fill_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate iterative repair-pass %s failed: %s", task_type, seq_fill_exc)
                    parsing_errors.append(f"Iterative repair-pass failed for {task_type} (round {sequence_fill_round}): {str(seq_fill_exc)}")
                    break

        # Iterative fill for TEST:
        # replace invalid/broken tests until valid-count is restored or progress stops.
        if task_type == "TEST":
            max_test_fill_rounds = 2
            test_fill_round = 0
            previous_valid_count = _valid_count(preview_tasks)
            while test_fill_round < max_test_fill_rounds and previous_valid_count < requested_count:
                test_fill_round += 1
                repair_attempted = True
                test_issue_count = _count_test_repair_issue_tasks(preview_tasks)
                fill_count = max(1, min(requested_count, max(test_issue_count, requested_count - previous_valid_count)))
                test_fill_hint = (
                    f"Iterative fill repair round {test_fill_round}. Return exactly {fill_count} @TEST blocks and no extra blocks. "
                    "Strict parser syntax only: @TEST, one # title line, one or more ? question lines, and answer lines starting with + or -. "
                    "Each question must have at least one correct (+) and at least one incorrect (-) answer, and no duplicate answer texts. "
                    "Use plausible distractors and avoid trivial duplicates."
                )
                try:
                    test_fill_raw_response, test_fill_provider_name, test_fill_chain_attempts = _generate_raw_with_parse_escalation(
                        task_type,
                        fill_count,
                        edu_units,
                        extra_instructions_local=test_fill_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if test_fill_provider_name and provider_name is None:
                        provider_name = test_fill_provider_name
                    provider_chain_attempts.extend(test_fill_chain_attempts)
                    test_fill_parsed_tasks, test_fill_parser, test_fill_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        test_fill_raw_response or "",
                    )
                    if test_fill_parse_errors:
                        parsing_errors.extend([f"[iterative-test-{test_fill_round}] {e}" for e in test_fill_parse_errors])
                    test_fill_preview_tasks = _build_ai_preview_tasks(task_type, test_fill_parsed_tasks, test_fill_parser, index_base_local=0)
                    _annotate_previews_source_grounding(test_fill_preview_tasks, edu_unit_contexts, task_type_hint_local=task_type)
                    if test_fill_preview_tasks:
                        preview_tasks.extend(test_fill_preview_tasks)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after iterative repair {test_fill_round}: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                    new_valid_count = _valid_count(preview_tasks)
                    if new_valid_count <= previous_valid_count:
                        parsing_errors.append(
                            f"Iterative repair {test_fill_round} made no valid-progress for {task_type} (valid {new_valid_count}/{requested_count})."
                        )
                        break
                    previous_valid_count = new_valid_count
                except Exception as test_fill_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate iterative repair-pass %s failed: %s", task_type, test_fill_exc)
                    parsing_errors.append(f"Iterative repair-pass failed for {task_type} (round {test_fill_round}): {str(test_fill_exc)}")
                    break

        # Cleanup layer for TEST:
        # even when requested count is met, replace remaining repairable test tasks.
        if task_type == "TEST" and len(preview_tasks) == requested_count:
            remaining_test_repairable = _count_test_repair_issue_tasks(preview_tasks)
            if remaining_test_repairable > 0:
                repair_attempted = True
                cleanup_test_count = max(1, min(requested_count, remaining_test_repairable))
                cleanup_test_hint = (
                    f"Cleanup repair mode. Return exactly {cleanup_test_count} @TEST blocks and no extra blocks. "
                    "Strict parser syntax only. Every question must include at least one + and one -, with non-empty texts and no duplicate answers. "
                    "Prioritize correctness and parser-valid structure over complexity."
                )
                try:
                    cleanup_test_raw, cleanup_test_provider, cleanup_test_chain = _generate_raw_with_parse_escalation(
                        task_type,
                        cleanup_test_count,
                        edu_units,
                        extra_instructions_local=cleanup_test_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if cleanup_test_provider and provider_name is None:
                        provider_name = cleanup_test_provider
                    provider_chain_attempts.extend(cleanup_test_chain)
                    cleanup_test_parsed, cleanup_test_parser, cleanup_test_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        cleanup_test_raw or "",
                    )
                    if cleanup_test_parse_errors:
                        parsing_errors.extend([f"[repair-pass-test-cleanup] {e}" for e in cleanup_test_parse_errors])
                    cleanup_test_previews = _build_ai_preview_tasks(task_type, cleanup_test_parsed, cleanup_test_parser, index_base_local=0)
                    _annotate_previews_source_grounding(cleanup_test_previews, edu_unit_contexts, task_type_hint_local=task_type)
                    if cleanup_test_previews:
                        preview_tasks.extend(cleanup_test_previews)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after cleanup repair: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                except Exception as cleanup_test_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate cleanup repair-pass %s failed: %s", task_type, cleanup_test_exc)
                    parsing_errors.append(f"Cleanup repair-pass failed for {task_type}: {str(cleanup_test_exc)}")

        # Cleanup layer for SEQUENCE:
        # even when requested count is met, replace parser-valid but validator-weak sequence tasks.
        if task_type == "SEQUENCE" and len(preview_tasks) == requested_count:
            remaining_sequence_repairable = _count_sequence_repair_issue_tasks(preview_tasks)
            if remaining_sequence_repairable > 0:
                repair_attempted = True
                cleanup_sequence_count = max(1, min(requested_count, remaining_sequence_repairable))
                cleanup_sequence_hint = (
                    f"Cleanup repair mode. Return exactly {cleanup_sequence_count} @SEQUENCE blocks and no extra blocks. "
                    "Strict parser syntax only: @SEQUENCE, one # line, at least 3 element_N lines, and level_N lines "
                    "using only declared element_N IDs. Use all elements in levels and avoid duplicate element IDs."
                )
                try:
                    cleanup_sequence_raw, cleanup_sequence_provider, cleanup_sequence_chain = _generate_raw_with_parse_escalation(
                        task_type,
                        cleanup_sequence_count,
                        edu_units,
                        extra_instructions_local=cleanup_sequence_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if cleanup_sequence_provider and provider_name is None:
                        provider_name = cleanup_sequence_provider
                    provider_chain_attempts.extend(cleanup_sequence_chain)
                    cleanup_sequence_parsed, cleanup_sequence_parser, cleanup_sequence_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        cleanup_sequence_raw or "",
                    )
                    if cleanup_sequence_parse_errors:
                        parsing_errors.extend([f"[repair-pass-sequence-cleanup] {e}" for e in cleanup_sequence_parse_errors])
                    cleanup_sequence_previews = _build_ai_preview_tasks(
                        task_type,
                        cleanup_sequence_parsed,
                        cleanup_sequence_parser,
                        index_base_local=0,
                    )
                    _annotate_previews_source_grounding(cleanup_sequence_previews, edu_unit_contexts, task_type_hint_local=task_type)
                    if cleanup_sequence_previews:
                        preview_tasks.extend(cleanup_sequence_previews)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after cleanup repair: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                except Exception as cleanup_sequence_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate cleanup repair-pass %s failed: %s", task_type, cleanup_sequence_exc)
                    parsing_errors.append(f"Cleanup repair-pass failed for {task_type}: {str(cleanup_sequence_exc)}")

        # Second cleanup layer for CLICK_WORDS:
        # even when the requested count is already met, try replacing remaining warning tasks.
        if task_type == "CLICK_WORDS" and len(preview_tasks) == requested_count:
            remaining_repairable = _count_click_words_repair_issue_tasks(preview_tasks)
            if remaining_repairable > 0:
                repair_attempted = True
                cleanup_repair_count = max(1, min(requested_count, remaining_repairable))
                cleanup_hint = (
                    f"Cleanup repair mode. Return exactly {cleanup_repair_count} @CLICK_WORDS blocks and no extra blocks. "
                    "Fix common parser/validator issues: use exactly 2-4 bracketed factual errors, matched [ ] only, "
                    "and wrap minimal erroneous token(s). Prioritize syntactically clean tasks over complexity."
                )
                try:
                    cleanup_raw_response, cleanup_provider_name, cleanup_chain_attempts = _generate_raw_with_parse_escalation(
                        task_type,
                        cleanup_repair_count,
                        edu_units,
                        extra_instructions_local=cleanup_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if cleanup_provider_name and provider_name is None:
                        provider_name = cleanup_provider_name
                    provider_chain_attempts.extend(cleanup_chain_attempts)
                    cleanup_parsed_tasks, cleanup_parser, cleanup_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        cleanup_raw_response or "",
                    )
                    if cleanup_parse_errors:
                        parsing_errors.extend([f"[repair-pass-2] {e}" for e in cleanup_parse_errors])
                    cleanup_previews = _build_ai_preview_tasks(task_type, cleanup_parsed_tasks, cleanup_parser, index_base_local=0)
                    _annotate_previews_source_grounding(cleanup_previews, edu_unit_contexts, task_type_hint_local=task_type)
                    preview_tasks.extend(cleanup_previews)
                    if preview_tasks:
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                    if len(preview_tasks) > requested_count:
                        dropped_count = len(preview_tasks) - requested_count
                        preview_tasks = preview_tasks[:requested_count]
                        parsing_errors.append(
                            f"Overgeneration trimmed for {task_type} after cleanup repair: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                        )
                except Exception as cleanup_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate cleanup repair-pass %s failed: %s", task_type, cleanup_exc)
                    parsing_errors.append(f"Cleanup repair-pass failed for {task_type}: {str(cleanup_exc)}")

        # Iterative cleanup for CLICK_WORDS warning tasks:
        # if count is already met but repairable warning-tasks remain (e.g. too many error spans),
        # keep attempting targeted replacements for a few rounds.
        if task_type == "CLICK_WORDS" and len(preview_tasks) == requested_count:
            max_click_words_cleanup_rounds = 2
            cleanup_round = 0
            previous_repairable_count = _count_click_words_repair_issue_tasks(preview_tasks)
            previous_valid_count = _valid_count(preview_tasks)
            while cleanup_round < max_click_words_cleanup_rounds and previous_repairable_count > 0:
                cleanup_round += 1
                repair_attempted = True
                iterative_cleanup_count = max(1, min(requested_count, previous_repairable_count))
                iterative_cleanup_hint = (
                    f"Iterative cleanup round {cleanup_round}. Return exactly {iterative_cleanup_count} @CLICK_WORDS blocks and no extra blocks. "
                    "Strict parser-safe syntax only. Each block must contain exactly 2-4 bracketed factual errors (never more than 4), "
                    "with matched [ ] markers and minimal erroneous token spans. Prefer short, clear tasks."
                )
                try:
                    iterative_cleanup_raw, iterative_cleanup_provider, iterative_cleanup_chain = _generate_raw_with_parse_escalation(
                        task_type,
                        iterative_cleanup_count,
                        edu_units,
                        extra_instructions_local=iterative_cleanup_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if iterative_cleanup_provider and provider_name is None:
                        provider_name = iterative_cleanup_provider
                    provider_chain_attempts.extend(iterative_cleanup_chain)
                    iterative_cleanup_parsed, iterative_cleanup_parser, iterative_cleanup_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        iterative_cleanup_raw or "",
                    )
                    if iterative_cleanup_parse_errors:
                        parsing_errors.extend([f"[repair-pass-click-words-cleanup-{cleanup_round}] {e}" for e in iterative_cleanup_parse_errors])
                    iterative_cleanup_previews = _build_ai_preview_tasks(
                        task_type,
                        iterative_cleanup_parsed,
                        iterative_cleanup_parser,
                        index_base_local=0,
                    )
                    _annotate_previews_source_grounding(iterative_cleanup_previews, edu_unit_contexts, task_type_hint_local=task_type)
                    if iterative_cleanup_previews:
                        preview_tasks.extend(iterative_cleanup_previews)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after iterative cleanup {cleanup_round}: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                    new_repairable_count = _count_click_words_repair_issue_tasks(preview_tasks)
                    new_valid_count = _valid_count(preview_tasks)
                    if new_repairable_count >= previous_repairable_count and new_valid_count <= previous_valid_count:
                        parsing_errors.append(
                            f"Iterative CLICK_WORDS cleanup {cleanup_round} made no quality progress ({new_valid_count} valid, {new_repairable_count} repairable warnings)."
                        )
                        break
                    previous_repairable_count = new_repairable_count
                    previous_valid_count = new_valid_count
                except Exception as iterative_cleanup_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate iterative cleanup %s failed: %s", task_type, iterative_cleanup_exc)
                    parsing_errors.append(
                        f"Iterative cleanup failed for {task_type} (round {cleanup_round}): {str(iterative_cleanup_exc)}"
                    )
                    break

        # Generic source-grounding cleanup:
        # when count is met but some tasks are weakly grounded in selected educational units, try replacing them.
        if len(preview_tasks) == requested_count and task_type in {"TEST", "CLICK_TEXT", "OPEN_ANSWER", "CLICK_WORDS", "SEQUENCE"}:
            weak_grounding_count = _count_weak_source_grounding_tasks(preview_tasks)
            if weak_grounding_count > 0:
                repair_attempted = True
                grounding_cleanup_count = max(1, min(requested_count, weak_grounding_count, 3))
                grounding_cleanup_hint = (
                    f"Source-grounding cleanup mode. Return exactly {grounding_cleanup_count} {('@' + task_type)} blocks and no extra blocks. "
                    "Ground every task strictly in the listed educational units and evidence snippets. "
                    "Reuse exact source anchors where applicable (numbers, dates, named categories, threshold terms) and avoid adding external details."
                )
                try:
                    grounding_cleanup_raw, grounding_cleanup_provider, grounding_cleanup_chain = _generate_raw_with_parse_escalation(
                        task_type,
                        grounding_cleanup_count,
                        edu_units,
                        extra_instructions_local=grounding_cleanup_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if grounding_cleanup_provider and provider_name is None:
                        provider_name = grounding_cleanup_provider
                    provider_chain_attempts.extend(grounding_cleanup_chain)
                    grounding_cleanup_parsed, grounding_cleanup_parser, grounding_cleanup_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        grounding_cleanup_raw or "",
                    )
                    if grounding_cleanup_parse_errors:
                        parsing_errors.extend([f"[repair-pass-grounding] {e}" for e in grounding_cleanup_parse_errors])
                    grounding_cleanup_previews = _build_ai_preview_tasks(
                        task_type,
                        grounding_cleanup_parsed,
                        grounding_cleanup_parser,
                        index_base_local=0,
                    )
                    _annotate_previews_source_grounding(grounding_cleanup_previews, edu_unit_contexts, task_type_hint_local=task_type)
                    if grounding_cleanup_previews:
                        preview_tasks.extend(grounding_cleanup_previews)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after grounding cleanup: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                except Exception as grounding_cleanup_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate source-grounding cleanup %s failed: %s", task_type, grounding_cleanup_exc)
                    parsing_errors.append(f"Source-grounding cleanup failed for {task_type}: {str(grounding_cleanup_exc)}")

        # Generic semantic-duplicate cleanup:
        # when count is met but tasks are too similar, try replacing duplicate-like tasks.
        if len(preview_tasks) == requested_count and task_type in {"TEST", "CLICK_TEXT", "OPEN_ANSWER", "CLICK_WORDS", "SEQUENCE"}:
            _annotate_previews_semantic_duplicates(preview_tasks, task_type)
            semantic_dup_count = _count_semantic_duplicate_tasks(preview_tasks)
            if semantic_dup_count > 0:
                repair_attempted = True
                semantic_cleanup_count = max(1, min(requested_count, semantic_dup_count, 3))
                semantic_cleanup_hint = (
                    f"Diversity cleanup mode. Return exactly {semantic_cleanup_count} {('@' + task_type)} blocks and no extra blocks. "
                    "Avoid semantic duplicates of each other: do not repeat the same fact, wording pattern, or identical answer logic. "
                    "Prefer different educational units and different cognitive operations (definition vs comparison vs mechanism vs rule vs numeric fact) "
                    "while staying strictly grounded in the listed educational units/evidence."
                )
                try:
                    semantic_cleanup_raw, semantic_cleanup_provider, semantic_cleanup_chain = _generate_raw_with_parse_escalation(
                        task_type,
                        semantic_cleanup_count,
                        edu_units,
                        extra_instructions_local=semantic_cleanup_hint,
                        preferred_provider_names_local=task_type_provider_preferences,
                    )
                    repair_subrequest_count += 1
                    if semantic_cleanup_provider and provider_name is None:
                        provider_name = semantic_cleanup_provider
                    provider_chain_attempts.extend(semantic_cleanup_chain)
                    semantic_cleanup_parsed, semantic_cleanup_parser, semantic_cleanup_parse_errors = _parse_ai_response_for_type(
                        task_type,
                        semantic_cleanup_raw or "",
                    )
                    if semantic_cleanup_parse_errors:
                        parsing_errors.extend([f"[repair-pass-semantic] {e}" for e in semantic_cleanup_parse_errors])
                    semantic_cleanup_previews = _build_ai_preview_tasks(
                        task_type,
                        semantic_cleanup_parsed,
                        semantic_cleanup_parser,
                        index_base_local=0,
                    )
                    _annotate_previews_source_grounding(semantic_cleanup_previews, edu_unit_contexts, task_type_hint_local=task_type)
                    if semantic_cleanup_previews:
                        preview_tasks.extend(semantic_cleanup_previews)
                        _annotate_previews_semantic_duplicates(preview_tasks, task_type)
                        preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
                        if len(preview_tasks) > requested_count:
                            dropped_count = len(preview_tasks) - requested_count
                            preview_tasks = preview_tasks[:requested_count]
                            parsing_errors.append(
                                f"Overgeneration trimmed for {task_type} after semantic cleanup: requested {requested_count}, kept {requested_count}, dropped {dropped_count}."
                            )
                except Exception as semantic_cleanup_exc:
                    provider_chain_attempts.extend(_ai_service.consume_last_provider_chain_attempts())
                    logger.warning("[HTTP] ai/generate semantic cleanup %s failed: %s", task_type, semantic_cleanup_exc)
                    parsing_errors.append(f"Semantic cleanup failed for {task_type}: {str(semantic_cleanup_exc)}")

        if repair_attempted and len(preview_tasks) < requested_count:
            parsing_errors.append(
                f"Repair-pass incomplete for {task_type}: requested {requested_count}, obtained {len(preview_tasks)}."
            )

        if preview_tasks:
            _annotate_previews_semantic_duplicates(preview_tasks, task_type)
            preview_tasks = sorted(preview_tasks, key=lambda p: _preview_sort_key(task_type, p))
            if len(preview_tasks) > requested_count:
                preview_tasks = preview_tasks[:requested_count]

        gen_time_ms = int((time.time() - start_time) * 1000)
        _reindex_previews(preview_tasks, total_generated)

        task_count = len(preview_tasks)
        total_generated += task_count
        by_type[task_type.lower()] = task_count

        results.append({
            "task_type": task_type,
            "status": "success" if preview_tasks else "error",
            "provider_used": provider_name if preview_tasks else None,
            "provider_chain_attempts": provider_chain_attempts,
            "tasks": preview_tasks,
            "parsing_errors": parsing_errors,
            "generation_time_ms": gen_time_ms,
            "educational_unit_ids": edu_unit_ids,
            "educational_units_context": edu_unit_contexts,
            "subrequest_count": len(subrequests) + repair_subrequest_count,
            "repair_pass_attempted": repair_attempted,
            "repair_subrequest_count": repair_subrequest_count,
        })

    quality_summary = _postprocess_ai_generate_results(
        material,
        results,
        expected_output_language=output_language_pref.get("effective"),
    )

    total_generated = 0
    total_valid = 0
    total_warnings = 0
    total_errors = 0
    by_type = {}
    for result in results:
        result_task_type = str(result.get("task_type", "")).lower()
        result_tasks = result.get("tasks", []) if isinstance(result.get("tasks"), list) else []
        if result_task_type:
            by_type[result_task_type] = by_type.get(result_task_type, 0) + len(result_tasks)
        total_generated += len(result_tasks)
        if result.get("status") == "error" and not result_tasks:
            total_errors += 1
        for t in result_tasks:
            status = t.get("status", "valid")
            if status == "error":
                total_errors += 1
            elif status == "warning":
                total_warnings += 1
            else:
                total_valid += 1

    response = {
        "ok": True,
        "ai_run_id": ai_run_id,
        "material_language": material_language,
        "output_language_mode": output_language_pref.get("mode"),
        "requested_output_language": output_language_pref.get("requested"),
        "effective_output_language": output_language_pref.get("effective"),
        "output_language_warning": output_language_pref.get("translation_warning"),
        "results": results,
        "provider_chain_attempts": [
            attempt
            for r in results
            if isinstance(r, dict)
            for attempt in (r.get("provider_chain_attempts") or [])
        ],
        "summary": {
            "total_generated": total_generated,
            "total_valid": total_valid,
            "total_warnings": total_warnings,
            "total_errors": total_errors,
            "by_type": by_type,
            "quality": quality_summary,
        },
        "parsing_errors": [],
    }

    try:
        active_provider = getattr(_ai_service, "_active_provider", None)
        provider_model = getattr(active_provider, "model", None) if active_provider else None
        _ai_run_merge_manifest(
            ai_run_id,
            {
                "phase": "generated",
                "provider_model": provider_model,
                "material_language": material_language,
                "output_language_mode": output_language_pref.get("mode"),
                "requested_output_language": output_language_pref.get("requested"),
                "effective_output_language": output_language_pref.get("effective"),
                "generation_summary": response.get("summary"),
            },
        )
        _ai_run_write_artifact(
            ai_run_id,
            "generation",
            {
                "run_id": ai_run_id,
                "created_at": _utc_now_iso(),
                "provider_model": provider_model,
                "material_stats": {
                    "word_count": len(material.split()),
                    "char_count": len(material),
                    "language": material_language,
                },
                "language_preferences": output_language_pref,
                "request": {
                    "tasks_to_generate": [
                        {
                            "task_type": spec.get("task_type"),
                            "count": spec.get("count"),
                            "educational_unit_ids": [
                                u.get("id")
                                for u in (spec.get("educational_units") or [])
                                if isinstance(u, dict)
                            ],
                        }
                        for spec in tasks_to_generate
                        if isinstance(spec, dict)
                    ],
                },
                "summary": response.get("summary"),
                "results": [
                    {
                        "task_type": r.get("task_type"),
                        "status": r.get("status"),
                        "provider_used": r.get("provider_used"),
                        "provider_chain_attempts": r.get("provider_chain_attempts") or [],
                        "educational_unit_ids": r.get("educational_unit_ids") or [],
                        "educational_units_context": r.get("educational_units_context") or [],
                        "generation_time_ms": r.get("generation_time_ms"),
                        "parsing_errors": r.get("parsing_errors") or [],
                        "tasks": [
                            {
                                "name": t.get("name"),
                                "type": t.get("type"),
                                "status": t.get("status"),
                                "hash": _stable_json_hash(_extract_task_preview_signature(t)),
                                "validation_issues": t.get("validation_issues") or [],
                                "ai_meta": t.get("ai_meta") if isinstance(t.get("ai_meta"), dict) else None,
                            }
                            for t in (r.get("tasks") or [])
                            if isinstance(t, dict)
                        ],
                    }
                    for r in results
                    if isinstance(r, dict)
                ],
            },
        )
    except Exception:
        logger.exception("[HTTP] Failed to persist ai-run generation artifact: %s", ai_run_id)

    logger.info(
        "[HTTP] ai/generate: total=%d valid=%d warnings=%d errors=%d types=%s",
        total_generated, total_valid, total_warnings, total_errors,
        list(by_type.keys()),
    )

    return jsonify(response)



# NOTE: /api/editor/ai/upload route moved to routes/ai_routes.py


# ---------------------------------------------------------------------------
# Task Import helpers (shared with _validate_with_task_type)
# ---------------------------------------------------------------------------


def _word_ranges(text: str) -> List[tuple[int, int]]:
    import re

    if not isinstance(text, str) or not text:
        return []
    return [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]


def _utc_now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"



# NOTE: _canonicalize_test_questions moved to routes/import_routes.py


def _stable_json_hash(data: Any) -> str:
    try:
        raw = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except Exception:
        raw = str(data)
    return hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()



# NOTE: _cleanup_import_idempotency_cache, _import_idempotency_get,
# _import_idempotency_reserve, _import_idempotency_store,
# _import_idempotency_release moved to routes/import_routes.py


def _safe_ai_run_id(value: Optional[str] = None) -> str:
    raw = (value or "").strip()
    if raw and re.fullmatch(r"[A-Za-z0-9._-]{6,128}", raw):
        return raw
    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    return f"ai_run_{ts}_{uuid.uuid4().hex[:10]}"


def _is_valid_ai_run_id(value: Optional[str]) -> bool:
    raw = str(value or "").strip()
    return bool(raw and re.fullmatch(r"[A-Za-z0-9._-]{6,128}", raw))


def _ai_runs_root() -> Path:
    root = _headless_app_ctx.data_dir / "ai_runs"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _ai_run_dir(run_id: str) -> Path:
    run_dir = _ai_runs_root() / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def _read_json_file(path: Path) -> Optional[Dict[str, Any]]:
    try:
        if not path.exists():
            return None
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        logger.exception("[HTTP] Failed to read JSON file: %s", path)
        return None


def _write_json_file(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    tmp.replace(path)


_EDITOR_FEATURE_FLAG_DEFAULTS: Dict[str, bool] = {
    "analysis_v2_schema": True,
    "analysis_report_blocks_v1": True,
    "analysis_report_renderer_v1": True,
    "editor_analysis_report_link": True,
    "analysis_coverage_in_editor": True,
    "microcards_mode": True,
    "microcards_pair_match": True,
}
_ENV_BOOL_TRUE = {"1", "true", "yes", "on", "enable", "enabled"}
_ENV_BOOL_FALSE = {"0", "false", "no", "off", "disable", "disabled"}
_THEORY_ROLLOUT_STAGE_ENV_KEY = "RP_THEORY_ROLLOUT_STAGE"
_THEORY_ROLLOUT_STAGE_SEQUENCE = [
    "legacy",
    "analysis_v2",
    "report_blocks",
    "report_renderer",
    "editor_link",
    "coverage",
    "microcards",
    "pair_match",
    "full",
]
_THEORY_ROLLOUT_STAGE_ALIASES = {
    "baseline": "legacy",
    "legacy_only": "legacy",
    "analysis": "analysis_v2",
    "v2": "analysis_v2",
    "analysis_v2_schema": "analysis_v2",
    "analysis_report_blocks_v1": "report_blocks",
    "reports": "report_renderer",
    "renderer": "report_renderer",
    "analysis_report_renderer_v1": "report_renderer",
    "editor_analysis_report_link": "editor_link",
    "analysis_coverage_in_editor": "coverage",
    "microcards_mode": "microcards",
    "microcards_pair_match": "pair_match",
    "all": "full",
    "complete": "full",
}
_THEORY_ROLLOUT_STAGE_FLAG_CAPS: Dict[str, Dict[str, bool]] = {
    "legacy": {
        "analysis_v2_schema": False,
        "analysis_report_blocks_v1": False,
        "analysis_report_renderer_v1": False,
        "editor_analysis_report_link": False,
        "analysis_coverage_in_editor": False,
        "microcards_mode": False,
        "microcards_pair_match": False,
    },
    "analysis_v2": {
        "analysis_v2_schema": True,
        "analysis_report_blocks_v1": False,
        "analysis_report_renderer_v1": False,
        "editor_analysis_report_link": False,
        "analysis_coverage_in_editor": False,
        "microcards_mode": False,
        "microcards_pair_match": False,
    },
    "report_blocks": {
        "analysis_v2_schema": True,
        "analysis_report_blocks_v1": True,
        "analysis_report_renderer_v1": False,
        "editor_analysis_report_link": False,
        "analysis_coverage_in_editor": False,
        "microcards_mode": False,
        "microcards_pair_match": False,
    },
    "report_renderer": {
        "analysis_v2_schema": True,
        "analysis_report_blocks_v1": True,
        "analysis_report_renderer_v1": True,
        "editor_analysis_report_link": False,
        "analysis_coverage_in_editor": False,
        "microcards_mode": False,
        "microcards_pair_match": False,
    },
    "editor_link": {
        "analysis_v2_schema": True,
        "analysis_report_blocks_v1": True,
        "analysis_report_renderer_v1": True,
        "editor_analysis_report_link": True,
        "analysis_coverage_in_editor": False,
        "microcards_mode": False,
        "microcards_pair_match": False,
    },
    "coverage": {
        "analysis_v2_schema": True,
        "analysis_report_blocks_v1": True,
        "analysis_report_renderer_v1": True,
        "editor_analysis_report_link": True,
        "analysis_coverage_in_editor": True,
        "microcards_mode": False,
        "microcards_pair_match": False,
    },
    "microcards": {
        "analysis_v2_schema": True,
        "analysis_report_blocks_v1": True,
        "analysis_report_renderer_v1": True,
        "editor_analysis_report_link": True,
        "analysis_coverage_in_editor": True,
        "microcards_mode": True,
        "microcards_pair_match": False,
    },
    "pair_match": {
        "analysis_v2_schema": True,
        "analysis_report_blocks_v1": True,
        "analysis_report_renderer_v1": True,
        "editor_analysis_report_link": True,
        "analysis_coverage_in_editor": True,
        "microcards_mode": True,
        "microcards_pair_match": True,
    },
    "full": {
        "analysis_v2_schema": True,
        "analysis_report_blocks_v1": True,
        "analysis_report_renderer_v1": True,
        "editor_analysis_report_link": True,
        "analysis_coverage_in_editor": True,
        "microcards_mode": True,
        "microcards_pair_match": True,
    },
}
_ANALYSIS_V2_CLIENT_FIELDS = {
    "analysis_schema_version",
    "capability_matrix_version",
    "capability_matrix_validation",
    "learning_chunks",
    "type_progression_suitability",
    "authoring_routes",
    "coverage_plan",
    "future_capabilities",
    "microcards_candidates",
    "report_blocks_version",
    "report_blocks",
    "report_lint",
}
_REPORT_BLOCKS_CLIENT_FIELDS = {"report_blocks_version", "report_blocks", "report_lint"}


def _get_theory_rollout_stage() -> str:
    raw = str(os.environ.get(_THEORY_ROLLOUT_STAGE_ENV_KEY, "") or "").strip().lower()
    if not raw:
        return "full"
    stage = _THEORY_ROLLOUT_STAGE_ALIASES.get(raw, raw)
    if stage not in _THEORY_ROLLOUT_STAGE_FLAG_CAPS:
        return "full"
    return stage


def _get_theory_rollout_stage_caps(stage: Optional[str] = None) -> Dict[str, bool]:
    resolved = stage or _get_theory_rollout_stage()
    caps = _THEORY_ROLLOUT_STAGE_FLAG_CAPS.get(resolved) or _THEORY_ROLLOUT_STAGE_FLAG_CAPS["full"]
    return {name: bool(caps.get(name, True)) for name in _EDITOR_FEATURE_FLAG_DEFAULTS.keys()}


def _apply_theory_rollout_stage_caps(flags: Dict[str, bool]) -> Dict[str, bool]:
    caps = _get_theory_rollout_stage_caps()
    out = {name: bool(flags.get(name, default)) for name, default in _EDITOR_FEATURE_FLAG_DEFAULTS.items()}
    for name in out.keys():
        out[name] = bool(out[name] and caps.get(name, True))
    return out


def _theory_rollout_prev_next(stage: Optional[str] = None) -> Tuple[Optional[str], Optional[str]]:
    current = stage or _get_theory_rollout_stage()
    try:
        idx = _THEORY_ROLLOUT_STAGE_SEQUENCE.index(current)
    except ValueError:
        idx = _THEORY_ROLLOUT_STAGE_SEQUENCE.index("full")
    prev_stage = _THEORY_ROLLOUT_STAGE_SEQUENCE[idx - 1] if idx > 0 else None
    next_stage = _THEORY_ROLLOUT_STAGE_SEQUENCE[idx + 1] if idx + 1 < len(_THEORY_ROLLOUT_STAGE_SEQUENCE) else None
    return prev_stage, next_stage


def _editor_feature_flag_env_key(flag_name: str) -> str:
    return f"RP_EDITOR_FF_{str(flag_name or '').strip().upper()}"


def _parse_env_bool(raw_value: Optional[str], default: bool) -> bool:
    if raw_value is None:
        return bool(default)
    low = str(raw_value).strip().lower()
    if low in _ENV_BOOL_TRUE:
        return True
    if low in _ENV_BOOL_FALSE:
        return False
    return bool(default)


def _get_editor_feature_flags() -> Dict[str, bool]:
    flags = {
        name: _parse_env_bool(os.environ.get(_editor_feature_flag_env_key(name)), default)
        for name, default in _EDITOR_FEATURE_FLAG_DEFAULTS.items()
    }
    flags = _apply_theory_rollout_stage_caps(flags)
    if not flags.get("analysis_v2_schema", True):
        flags["analysis_report_blocks_v1"] = False
        flags["analysis_report_renderer_v1"] = False
    if not flags.get("analysis_report_blocks_v1", True):
        flags["analysis_report_renderer_v1"] = False
    if not flags.get("microcards_mode", True):
        flags["microcards_pair_match"] = False
    return flags


def _is_editor_feature_enabled(flag_name: str) -> bool:
    return bool(_get_editor_feature_flags().get(str(flag_name or "").strip(), True))


def _feature_disabled_json(error_code: str, *, status_code: int = 404) -> Tuple[Any, int]:
    _emit_theory_rollout_telemetry(
        "feature_flag_blocked",
        error_code=str(error_code or "").strip() or "feature_disabled",
        status_code=int(status_code),
    )
    return jsonify({"ok": False, "error": error_code, "feature_flags": _get_editor_feature_flags()}), status_code


def _attach_editor_feature_flags(payload: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(payload or {})
    out["feature_flags"] = _get_editor_feature_flags()
    return out


_THEORY_ROLLOUT_TELEMETRY_LOCK = threading.Lock()
_THEORY_ROLLOUT_TELEMETRY_SCHEMA_VERSION = "1.0"


def _theory_rollout_telemetry_root() -> Path:
    root = Path(_headless_app_ctx.data_dir) / "telemetry"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _theory_rollout_telemetry_events_path() -> Path:
    return _theory_rollout_telemetry_root() / "theory_rollout_events.jsonl"


def _telemetry_safe_value(value: Any, *, depth: int = 0) -> Any:
    if depth >= 3:
        return None
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:512]
    if isinstance(value, Path):
        return str(value)[:512]
    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for idx, (k, v) in enumerate(value.items()):
            if idx >= 48:
                out["__truncated__"] = True
                break
            key = str(k)[:96]
            out[key] = _telemetry_safe_value(v, depth=depth + 1)
        return out
    if isinstance(value, (list, tuple, set)):
        out_list: List[Any] = []
        for idx, item in enumerate(value):
            if idx >= 64:
                out_list.append("__truncated__")
                break
            out_list.append(_telemetry_safe_value(item, depth=depth + 1))
        return out_list
    return str(value)[:512]


def _emit_theory_rollout_telemetry(event_name: str, **fields: Any) -> None:
    name = str(event_name or "").strip()
    if not name:
        return
    try:
        feature_flags = _get_editor_feature_flags()
        stage = _get_theory_rollout_stage()
        payload = {
            "schema_version": _THEORY_ROLLOUT_TELEMETRY_SCHEMA_VERSION,
            "id": f"trtevt_{uuid.uuid4().hex[:12]}",
            "event": name,
            "created_at": _utc_now_iso(),
            "rollout_stage": stage,
            "user_id": _headless_app_ctx.user_id or "guest",
            "feature_flags": feature_flags,
            "request_path": (request.path if has_request_context() else None),
            "request_method": (request.method if has_request_context() else None),
            "fields": _telemetry_safe_value(fields, depth=0),
        }
        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with _THEORY_ROLLOUT_TELEMETRY_LOCK:
            path = _theory_rollout_telemetry_events_path()
            with open(path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception as exc:
        logger.debug("[HTTP] theory rollout telemetry emit failed: %s", exc)


def _analysis_rollout_quality_fields(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    report_blocks = payload.get("report_blocks") if isinstance(payload.get("report_blocks"), list) else []
    report_lint = payload.get("report_lint") if isinstance(payload.get("report_lint"), dict) else {}
    future_capabilities = payload.get("future_capabilities") if isinstance(payload.get("future_capabilities"), list) else []
    duplicate_signals = report_lint.get("duplicate_content_signals")
    try:
        duplicate_signals_val = int(duplicate_signals) if duplicate_signals is not None else None
    except (TypeError, ValueError):
        duplicate_signals_val = None
    has_pair_matching_capability = any(
        isinstance(item, dict) and str(item.get("capability_id") or "").strip().lower() == "pair_matching"
        for item in future_capabilities
    )
    schema_version = payload.get("analysis_schema_version")
    return {
        "analysis_schema_version": (str(schema_version).strip() if schema_version is not None else None) or None,
        "report_blocks_version": (str(payload.get("report_blocks_version")).strip() if payload.get("report_blocks_version") is not None else None) or None,
        "report_blocks_count": len(report_blocks),
        "fallback_renderer_recommended": bool(report_lint.get("fallback_renderer_recommended")),
        "duplicate_content_signals": duplicate_signals_val,
        "future_capabilities_count": len(future_capabilities),
        "microcards_candidates_count": len(payload.get("microcards_candidates") or []) if isinstance(payload.get("microcards_candidates"), list) else 0,
        "learning_chunks_count": len(payload.get("learning_chunks") or []) if isinstance(payload.get("learning_chunks"), list) else 0,
        "authoring_routes_count": len(payload.get("authoring_routes") or []) if isinstance(payload.get("authoring_routes"), list) else 0,
        "warnings_count": len(payload.get("warnings") or []) if isinstance(payload.get("warnings"), list) else 0,
        "has_pair_matching_capability": has_pair_matching_capability,
        "analysis_v2_valid": str(schema_version or "").strip() == "2.0",
    }


def _read_theory_rollout_telemetry_events(limit: int = 5000) -> List[Dict[str, Any]]:
    path = _theory_rollout_telemetry_events_path()
    if not path.exists():
        return []
    max_items = max(1, min(int(limit or 5000), 20000))
    recent_lines: deque[str] = deque(maxlen=max_items)
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    recent_lines.append(line)
    except Exception:
        logger.exception("[HTTP] Failed to read theory rollout telemetry events: %s", path)
        return []
    out: List[Dict[str, Any]] = []
    for line in recent_lines:
        try:
            item = json.loads(line)
            if isinstance(item, dict):
                out.append(item)
        except Exception:
            continue
    return out


def _ratio_payload(numerator: int, denominator: int) -> Dict[str, Any]:
    value = None
    if denominator > 0:
        value = round(float(numerator) / float(denominator), 4)
    return {"numerator": int(numerator), "denominator": int(denominator), "value": value}


def _duplicate_signal_bucket(value: Optional[int]) -> str:
    if value is None:
        return "unknown"
    if value >= 5:
        return "5+"
    if value < 0:
        return "0"
    return str(int(value))


def _build_theory_rollout_telemetry_summary(limit: int = 5000) -> Dict[str, Any]:
    events = _read_theory_rollout_telemetry_events(limit=limit)
    by_event: Dict[str, int] = {}
    by_stage: Dict[str, int] = {}
    quality_samples = 0
    valid_v2_samples = 0
    fallback_recommended_samples = 0
    report_blocks_total = 0
    report_blocks_samples = 0
    duplicate_distribution: Dict[str, int] = {}
    pair_matching_capability_samples = 0
    analyses_with_pair_matching = 0
    deck_creations_from_analysis = 0
    deck_appends_from_analysis = 0
    pair_match_deck_creations = 0
    microcards_queue_opens = 0
    resumed_queue_sessions = 0
    microcards_reviews = 0
    pair_match_reviews = 0
    feature_flag_blocks = 0
    first_event_at = events[0].get("created_at") if events else None
    last_event_at = events[-1].get("created_at") if events else None

    for evt in events:
        event_name = str(evt.get("event") or "").strip() or "unknown"
        stage = str(evt.get("rollout_stage") or "").strip() or "unknown"
        by_event[event_name] = by_event.get(event_name, 0) + 1
        by_stage[stage] = by_stage.get(stage, 0) + 1
        fields = evt.get("fields") if isinstance(evt.get("fields"), dict) else {}

        schema_version = str(fields.get("analysis_schema_version") or "").strip() or None
        if schema_version:
            quality_samples += 1
            if schema_version == "2.0" and bool(fields.get("analysis_v2_valid", False)):
                valid_v2_samples += 1
            if bool(fields.get("fallback_renderer_recommended")):
                fallback_recommended_samples += 1
            rb_count = fields.get("report_blocks_count")
            try:
                if rb_count is not None:
                    rb_count_int = max(0, int(rb_count))
                    report_blocks_total += rb_count_int
                    report_blocks_samples += 1
            except (TypeError, ValueError):
                pass
            dup = fields.get("duplicate_content_signals")
            try:
                dup_int = int(dup) if dup is not None else None
            except (TypeError, ValueError):
                dup_int = None
            bucket = _duplicate_signal_bucket(dup_int)
            duplicate_distribution[bucket] = duplicate_distribution.get(bucket, 0) + 1
            pair_matching_capability_samples += 1
            if bool(fields.get("has_pair_matching_capability")):
                analyses_with_pair_matching += 1

        if event_name == "microcards_deck_created_from_analysis":
            deck_creations_from_analysis += 1
            try:
                if int(fields.get("pair_match_cards") or 0) > 0:
                    pair_match_deck_creations += 1
            except (TypeError, ValueError):
                pass
        elif event_name == "microcards_deck_appended_from_analysis":
            deck_appends_from_analysis += 1
        elif event_name == "microcards_queue_opened":
            microcards_queue_opens += 1
            if bool(fields.get("resumed_session")):
                resumed_queue_sessions += 1
        elif event_name == "microcards_review_submitted":
            microcards_reviews += 1
            if str(fields.get("card_type") or "").strip().lower() == "pair_match":
                pair_match_reviews += 1
        elif event_name == "feature_flag_blocked":
            feature_flag_blocks += 1

    avg_report_blocks = None
    if report_blocks_samples > 0:
        avg_report_blocks = round(report_blocks_total / report_blocks_samples, 2)

    return {
        "schema_version": "1.0",
        "events_window": len(events),
        "events_first_at": first_event_at,
        "events_last_at": last_event_at,
        "by_event": by_event,
        "by_rollout_stage": by_stage,
        "metrics": {
            "analysis_v2_valid_ratio": _ratio_payload(valid_v2_samples, quality_samples),
            "fallback_renderer_recommended_ratio": _ratio_payload(fallback_recommended_samples, quality_samples),
            "avg_report_blocks_size": avg_report_blocks,
            "duplicate_content_signals_distribution": duplicate_distribution,
            "analyses_with_pair_matching_ratio": _ratio_payload(analyses_with_pair_matching, pair_matching_capability_samples),
            "microdeck_creations_from_analysis": int(deck_creations_from_analysis),
            "microdeck_appends_from_analysis": int(deck_appends_from_analysis),
            "pair_match_deck_creations": int(pair_match_deck_creations),
            "microcards_queue_opens": int(microcards_queue_opens),
            "resumed_queue_sessions": int(resumed_queue_sessions),
            "pair_match_reviews": int(pair_match_reviews),
            "microcards_reviews_total": int(microcards_reviews),
            "feature_flag_blocks": int(feature_flag_blocks),
        },
    }


def _build_theory_rollout_migration_inventory() -> Dict[str, Any]:
    inventory: Dict[str, Any] = {
        "scan_status": "ok",
        "ai_runs": {
            "total_dirs": 0,
            "with_analysis_artifact": 0,
            "legacy_or_unknown": 0,
            "analysis_v2": 0,
            "with_report_blocks_v1": 0,
        },
        "microcards": {
            "decks_total": 0,
            "decks_by_schema_version": {},
            "user_review_states_files": 0,
            "user_review_events_files": 0,
            "user_review_sessions_files": 0,
        },
    }
    try:
        ai_root = _ai_runs_root()
        for run_dir in ai_root.iterdir():
            if not run_dir.is_dir():
                continue
            inventory["ai_runs"]["total_dirs"] += 1
            analysis_artifact = _read_json_file(run_dir / "analysis.json")
            if not isinstance(analysis_artifact, dict):
                continue
            inventory["ai_runs"]["with_analysis_artifact"] += 1
            result = analysis_artifact.get("result") if isinstance(analysis_artifact.get("result"), dict) else {}
            schema_version = str(result.get("analysis_schema_version") or "").strip()
            if schema_version == "2.0":
                inventory["ai_runs"]["analysis_v2"] += 1
            else:
                inventory["ai_runs"]["legacy_or_unknown"] += 1
            if str(result.get("report_blocks_version") or "").strip() == "1.0":
                inventory["ai_runs"]["with_report_blocks_v1"] += 1
    except Exception:
        logger.exception("[HTTP] theory rollout migration inventory ai_runs scan failed")
        inventory["scan_status"] = "partial_error"

    try:
        mc_root = Path(_headless_app_ctx.data_dir) / "microcards" / "decks"
        if mc_root.exists():
            for path in mc_root.glob("*.json"):
                deck = _read_json_file(path)
                if not isinstance(deck, dict):
                    continue
                inventory["microcards"]["decks_total"] += 1
                schema_version = str(deck.get("schema_version") or "unknown").strip() or "unknown"
                versions = inventory["microcards"]["decks_by_schema_version"]
                versions[schema_version] = int(versions.get(schema_version, 0)) + 1
        users_root = Path(_headless_app_ctx.data_dir) / "users"
        if users_root.exists():
            for user_dir in users_root.iterdir():
                if not user_dir.is_dir():
                    continue
                mc_user_root = user_dir / "microcards"
                if not mc_user_root.exists():
                    continue
                if (mc_user_root / "review_states.json").exists():
                    inventory["microcards"]["user_review_states_files"] += 1
                if (mc_user_root / "review_events.json").exists():
                    inventory["microcards"]["user_review_events_files"] += 1
                if (mc_user_root / "review_sessions.json").exists():
                    inventory["microcards"]["user_review_sessions_files"] += 1
    except Exception:
        logger.exception("[HTTP] theory rollout migration inventory microcards scan failed")
        inventory["scan_status"] = "partial_error"
    return inventory


def _build_theory_rollout_status_payload(*, include_inventory: bool = False, include_telemetry: bool = False, telemetry_limit: int = 5000) -> Dict[str, Any]:
    stage = _get_theory_rollout_stage()
    prev_stage, next_stage = _theory_rollout_prev_next(stage)
    flags = _get_editor_feature_flags()
    payload: Dict[str, Any] = {
        "stage": stage,
        "stage_env_key": _THEORY_ROLLOUT_STAGE_ENV_KEY,
        "available_stages": list(_THEORY_ROLLOUT_STAGE_SEQUENCE),
        "previous_stage": prev_stage,
        "next_stage": next_stage,
        "effective_feature_flags": flags,
        "stage_caps": _get_theory_rollout_stage_caps(stage),
        "rollback_guarantees": [
            "Rollout stage only gates feature exposure via flags; lowering stage does not delete ai_run or microcards data.",
            "analysis_json v2/report_blocks are additive and versioned; legacy clients continue reading legacy fields.",
            "Microdeck content is shared and review progress is user-scoped, so disabling microcards UI does not merge/erase progress data.",
            "Raw ai_run artifacts are persisted separately from derived UI rendering and can be reopened after re-enable.",
        ],
    }
    if include_inventory:
        payload["migration_inventory"] = _build_theory_rollout_migration_inventory()
    if include_telemetry:
        payload["telemetry"] = _build_theory_rollout_telemetry_summary(limit=telemetry_limit)
    return payload


def _route_steps_with_feature_flags(steps: Any, flags: Dict[str, bool]) -> List[Dict[str, Any]]:
    if not isinstance(steps, list):
        return []
    allow_microcards = bool(flags.get("microcards_mode", True))
    allow_pair_match = bool(flags.get("microcards_pair_match", True))
    normalized_steps: List[Dict[str, Any]] = []
    for step in steps:
        if not isinstance(step, dict):
            continue
        action_type = str(step.get("action_type") or "").strip().lower()
        microcard_mode = str(step.get("microcard_mode") or "").strip().lower()
        if action_type == "add_microcards":
            if not allow_microcards:
                continue
            if microcard_mode == "pair_match" and not allow_pair_match:
                continue
        normalized_steps.append(dict(step))
    return normalized_steps


def _sanitize_authoring_routes_for_client(routes: Any, flags: Dict[str, bool]) -> List[Dict[str, Any]]:
    if not isinstance(routes, list):
        return []
    sanitized: List[Dict[str, Any]] = []
    for route in routes:
        if not isinstance(route, dict):
            continue
        route_copy = dict(route)
        raw_steps = route.get("steps")
        if isinstance(raw_steps, list):
            route_copy["steps"] = _route_steps_with_feature_flags(raw_steps, flags)
        steps = route_copy.get("steps") if isinstance(route_copy.get("steps"), list) else []
        has_steps = len(steps) > 0
        has_micro_step = any(str(s.get("action_type") or "").strip().lower() == "add_microcards" for s in steps if isinstance(s, dict))
        has_progression_step = any(
            str(s.get("action_type") or "").strip().lower() == "use_task_type_progression" for s in steps if isinstance(s, dict)
        )

        original_steps = raw_steps if isinstance(raw_steps, list) else []
        if original_steps and not has_steps:
            continue

        target_surface = str(route_copy.get("target_surface") or "").strip().lower()
        route_kind = str(route_copy.get("route_kind") or "").strip().lower()
        if target_surface in {"microcards", "mixed"} and not has_micro_step:
            if target_surface == "microcards" and not has_progression_step:
                continue
            if target_surface == "microcards":
                route_copy["target_surface"] = "complexes" if has_progression_step else "editor_manual"
            elif target_surface == "mixed":
                route_copy["target_surface"] = "complexes" if has_progression_step else "editor_manual"

            if route_kind == "hybrid" and not has_micro_step and has_progression_step:
                route_copy["route_kind"] = "complex_progression"
            elif route_kind == "microcards_support" and not has_micro_step:
                route_copy["route_kind"] = "complex_progression" if has_progression_step else "manual_practice"

        sanitized.append(route_copy)
    return sanitized


def _sanitize_future_capabilities_for_client(future_caps: Any, flags: Dict[str, bool]) -> List[Dict[str, Any]]:
    if not isinstance(future_caps, list):
        return []
    allow_pair_match = bool(flags.get("microcards_mode", True) and flags.get("microcards_pair_match", True))
    out: List[Dict[str, Any]] = []
    for item in future_caps:
        if not isinstance(item, dict):
            continue
        capability_id = str(item.get("capability_id") or "").strip().lower()
        if capability_id == "pair_matching" and not allow_pair_match:
            continue
        out.append(dict(item))
    return out


def _sanitize_microcards_candidates_for_client(candidates: Any, flags: Dict[str, bool]) -> List[Dict[str, Any]]:
    if not isinstance(candidates, list):
        return []
    if not flags.get("microcards_mode", True):
        return []
    allow_pair_match = bool(flags.get("microcards_pair_match", True))
    out: List[Dict[str, Any]] = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        card_type = str(item.get("card_type") or "").strip().lower()
        if card_type == "pair_match" and not allow_pair_match:
            continue
        out.append(dict(item))
    return out


def _sanitize_analysis_response_for_client(payload: Dict[str, Any], *, flags: Optional[Dict[str, bool]] = None) -> Dict[str, Any]:
    out = dict(payload or {})
    ff = dict(flags or _get_editor_feature_flags())
    if not ff.get("analysis_v2_schema", True):
        for key in _ANALYSIS_V2_CLIENT_FIELDS:
            out.pop(key, None)
        out["feature_flags"] = ff
        return out

    if isinstance(out.get("authoring_routes"), list):
        out["authoring_routes"] = _sanitize_authoring_routes_for_client(out.get("authoring_routes"), ff)
    if isinstance(out.get("future_capabilities"), list):
        out["future_capabilities"] = _sanitize_future_capabilities_for_client(out.get("future_capabilities"), ff)
    if isinstance(out.get("microcards_candidates"), list):
        out["microcards_candidates"] = _sanitize_microcards_candidates_for_client(out.get("microcards_candidates"), ff)

    if not ff.get("analysis_report_blocks_v1", True):
        for key in _REPORT_BLOCKS_CLIENT_FIELDS:
            out.pop(key, None)

    out["feature_flags"] = ff
    return out


def _sanitize_analysis_for_microcards_backend(payload: Dict[str, Any], *, flags: Optional[Dict[str, bool]] = None) -> Dict[str, Any]:
    out = dict(payload or {})
    ff = dict(flags or _get_editor_feature_flags())
    if not ff.get("microcards_pair_match", True):
        if isinstance(out.get("future_capabilities"), list):
            out["future_capabilities"] = _sanitize_future_capabilities_for_client(out.get("future_capabilities"), ff)
        if isinstance(out.get("microcards_candidates"), list):
            out["microcards_candidates"] = _sanitize_microcards_candidates_for_client(out.get("microcards_candidates"), ff)
    return out


# ── M14: Microcards Productization Rollout Layer (independent from P13 theory rollout) ──

_MICROCARDS_PROD_FEATURE_FLAG_DEFAULTS: Dict[str, bool] = {
    "microcards_runtime_ui": True,
    "microcards_home_entry": True,
    "microcards_calendar_integration": True,
    "microcards_statistics_integration": True,
    "microcards_manual_editor": True,
    "microcards_text_import": True,
    "microcards_review_fx": True,
    "microcards_pair_match_runtime": True,
}

_MICROCARDS_ROLLOUT_STAGE_ENV_KEY = "RP_MICROCARDS_ROLLOUT_STAGE"

_MICROCARDS_ROLLOUT_STAGE_SEQUENCE = [
    "disabled",
    "runtime_hidden",
    "calendar_stats_only",
    "runtime_ui",
    "home_entry",
    "manual_editor",
    "text_import",
    "full",
]

_MICROCARDS_ROLLOUT_STAGE_ALIASES: Dict[str, str] = {
    "off": "disabled",
    "none": "disabled",
    "backend_only": "runtime_hidden",
    "hidden": "runtime_hidden",
    "cal_stats": "calendar_stats_only",
    "calendar": "calendar_stats_only",
    "runtime": "runtime_ui",
    "home": "home_entry",
    "manual": "manual_editor",
    "import": "text_import",
    "all": "full",
    "complete": "full",
    "enabled": "full",
}

_MICROCARDS_ROLLOUT_STAGE_FLAG_CAPS: Dict[str, Dict[str, bool]] = {
    "disabled": {
        "microcards_runtime_ui": False,
        "microcards_home_entry": False,
        "microcards_calendar_integration": False,
        "microcards_statistics_integration": False,
        "microcards_manual_editor": False,
        "microcards_text_import": False,
        "microcards_review_fx": False,
        "microcards_pair_match_runtime": False,
    },
    "runtime_hidden": {
        "microcards_runtime_ui": False,
        "microcards_home_entry": False,
        "microcards_calendar_integration": False,
        "microcards_statistics_integration": False,
        "microcards_manual_editor": False,
        "microcards_text_import": False,
        "microcards_review_fx": False,
        "microcards_pair_match_runtime": False,
    },
    "calendar_stats_only": {
        "microcards_runtime_ui": False,
        "microcards_home_entry": False,
        "microcards_calendar_integration": True,
        "microcards_statistics_integration": True,
        "microcards_manual_editor": False,
        "microcards_text_import": False,
        "microcards_review_fx": False,
        "microcards_pair_match_runtime": False,
    },
    "runtime_ui": {
        "microcards_runtime_ui": True,
        "microcards_home_entry": False,
        "microcards_calendar_integration": True,
        "microcards_statistics_integration": True,
        "microcards_manual_editor": False,
        "microcards_text_import": False,
        "microcards_review_fx": True,
        "microcards_pair_match_runtime": True,
    },
    "home_entry": {
        "microcards_runtime_ui": True,
        "microcards_home_entry": True,
        "microcards_calendar_integration": True,
        "microcards_statistics_integration": True,
        "microcards_manual_editor": False,
        "microcards_text_import": False,
        "microcards_review_fx": True,
        "microcards_pair_match_runtime": True,
    },
    "manual_editor": {
        "microcards_runtime_ui": True,
        "microcards_home_entry": True,
        "microcards_calendar_integration": True,
        "microcards_statistics_integration": True,
        "microcards_manual_editor": True,
        "microcards_text_import": False,
        "microcards_review_fx": True,
        "microcards_pair_match_runtime": True,
    },
    "text_import": {
        "microcards_runtime_ui": True,
        "microcards_home_entry": True,
        "microcards_calendar_integration": True,
        "microcards_statistics_integration": True,
        "microcards_manual_editor": True,
        "microcards_text_import": True,
        "microcards_review_fx": True,
        "microcards_pair_match_runtime": True,
    },
    "full": {
        "microcards_runtime_ui": True,
        "microcards_home_entry": True,
        "microcards_calendar_integration": True,
        "microcards_statistics_integration": True,
        "microcards_manual_editor": True,
        "microcards_text_import": True,
        "microcards_review_fx": True,
        "microcards_pair_match_runtime": True,
    },
}


def _get_microcards_rollout_stage() -> str:
    raw = str(os.environ.get(_MICROCARDS_ROLLOUT_STAGE_ENV_KEY, "") or "").strip().lower()
    if not raw:
        return "full"
    stage = _MICROCARDS_ROLLOUT_STAGE_ALIASES.get(raw, raw)
    if stage not in _MICROCARDS_ROLLOUT_STAGE_FLAG_CAPS:
        return "full"
    return stage


def _get_microcards_rollout_stage_caps(stage: Optional[str] = None) -> Dict[str, bool]:
    resolved = stage or _get_microcards_rollout_stage()
    caps = _MICROCARDS_ROLLOUT_STAGE_FLAG_CAPS.get(resolved) or _MICROCARDS_ROLLOUT_STAGE_FLAG_CAPS["full"]
    return {name: bool(caps.get(name, True)) for name in _MICROCARDS_PROD_FEATURE_FLAG_DEFAULTS.keys()}


def _get_microcards_prod_feature_flags() -> Dict[str, bool]:
    flags: Dict[str, bool] = {}
    for name, default in _MICROCARDS_PROD_FEATURE_FLAG_DEFAULTS.items():
        env_key = f"RP_MICROCARDS_FF_{str(name).strip().upper()}"
        flags[name] = _parse_env_bool(os.environ.get(env_key), default)
    caps = _get_microcards_rollout_stage_caps()
    for name in flags:
        flags[name] = bool(flags[name] and caps.get(name, True))
    if not flags.get("microcards_runtime_ui", True):
        flags["microcards_review_fx"] = False
        flags["microcards_pair_match_runtime"] = False
    return flags


def _is_microcards_prod_feature_enabled(flag_name: str) -> bool:
    return bool(_get_microcards_prod_feature_flags().get(str(flag_name or "").strip(), True))


def _microcards_prod_feature_disabled_json(error_code: str, *, status_code: int = 404) -> Tuple[Any, int]:
    _emit_microcards_prod_telemetry(
        "microcards_prod_feature_blocked",
        error_code=str(error_code or "").strip() or "feature_disabled",
        status_code=int(status_code),
    )
    return jsonify({"ok": False, "error": error_code, "microcards_feature_flags": _get_microcards_prod_feature_flags()}), status_code


def _microcards_rollout_prev_next(stage: Optional[str] = None) -> Tuple[Optional[str], Optional[str]]:
    current = stage or _get_microcards_rollout_stage()
    try:
        idx = _MICROCARDS_ROLLOUT_STAGE_SEQUENCE.index(current)
    except ValueError:
        idx = _MICROCARDS_ROLLOUT_STAGE_SEQUENCE.index("full")
    prev_stage = _MICROCARDS_ROLLOUT_STAGE_SEQUENCE[idx - 1] if idx > 0 else None
    next_stage = _MICROCARDS_ROLLOUT_STAGE_SEQUENCE[idx + 1] if idx + 1 < len(_MICROCARDS_ROLLOUT_STAGE_SEQUENCE) else None
    return prev_stage, next_stage


_MICROCARDS_PROD_TELEMETRY_LOCK = threading.Lock()
_MICROCARDS_PROD_TELEMETRY_SCHEMA_VERSION = "1.0"


def _microcards_prod_telemetry_events_path() -> Path:
    root = Path(_headless_app_ctx.data_dir) / "telemetry"
    root.mkdir(parents=True, exist_ok=True)
    return root / "microcards_prod_rollout_events.jsonl"


def _emit_microcards_prod_telemetry(event_name: str, **fields: Any) -> None:
    name = str(event_name or "").strip()
    if not name:
        return
    try:
        mc_flags = _get_microcards_prod_feature_flags()
        stage = _get_microcards_rollout_stage()
        payload = {
            "schema_version": _MICROCARDS_PROD_TELEMETRY_SCHEMA_VERSION,
            "id": f"mcpevt_{uuid.uuid4().hex[:12]}",
            "event": name,
            "created_at": _utc_now_iso(),
            "rollout_stage": stage,
            "user_id": _headless_app_ctx.user_id or "guest",
            "microcards_feature_flags": mc_flags,
            "request_path": (request.path if has_request_context() else None),
            "request_method": (request.method if has_request_context() else None),
            "fields": _telemetry_safe_value(fields, depth=0),
        }
        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with _MICROCARDS_PROD_TELEMETRY_LOCK:
            path = _microcards_prod_telemetry_events_path()
            with open(path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception as exc:
        logger.debug("[HTTP] microcards prod telemetry emit failed: %s", exc)


def _read_microcards_prod_telemetry_events(limit: int = 5000) -> List[Dict[str, Any]]:
    path = _microcards_prod_telemetry_events_path()
    if not path.exists():
        return []
    max_items = max(1, min(int(limit or 5000), 20000))
    recent_lines: deque[str] = deque(maxlen=max_items)
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    recent_lines.append(line)
    except Exception:
        logger.exception("[HTTP] Failed to read microcards prod telemetry events: %s", path)
        return []
    out: List[Dict[str, Any]] = []
    for line in recent_lines:
        try:
            item = json.loads(line)
            if isinstance(item, dict):
                out.append(item)
        except Exception:
            continue
    return out


def _build_microcards_prod_telemetry_summary(limit: int = 5000) -> Dict[str, Any]:
    events = _read_microcards_prod_telemetry_events(limit=limit)
    by_event: Dict[str, int] = {}
    by_stage: Dict[str, int] = {}
    runtime_opens = 0
    runtime_sessions_started = 0
    runtime_sessions_completed = 0
    manual_deck_creates = 0
    manual_card_creates = 0
    text_import_parses = 0
    text_import_executes = 0
    text_import_errors = 0
    backfill_runs = 0
    backfill_verify_failures = 0
    feature_blocks = 0
    first_event_at = events[0].get("created_at") if events else None
    last_event_at = events[-1].get("created_at") if events else None

    for evt in events:
        event_name = str(evt.get("event") or "").strip() or "unknown"
        stage = str(evt.get("rollout_stage") or "").strip() or "unknown"
        by_event[event_name] = by_event.get(event_name, 0) + 1
        by_stage[stage] = by_stage.get(stage, 0) + 1

        if event_name == "microcards_runtime_opened":
            runtime_opens += 1
        elif event_name == "microcards_runtime_session_started":
            runtime_sessions_started += 1
        elif event_name == "microcards_runtime_session_completed":
            runtime_sessions_completed += 1
        elif event_name == "microcards_manual_deck_created":
            manual_deck_creates += 1
        elif event_name == "microcards_manual_card_created":
            manual_card_creates += 1
        elif event_name == "microcards_text_import_parsed":
            text_import_parses += 1
        elif event_name == "microcards_text_import_executed":
            text_import_executes += 1
        elif event_name == "microcards_text_import_parse_error":
            text_import_errors += 1
        elif event_name == "microcards_backfill_run":
            backfill_runs += 1
        elif event_name == "microcards_backfill_verify_failed":
            backfill_verify_failures += 1
        elif event_name == "microcards_prod_feature_blocked":
            feature_blocks += 1

    return {
        "schema_version": "1.0",
        "events_window": len(events),
        "events_first_at": first_event_at,
        "events_last_at": last_event_at,
        "by_event": by_event,
        "by_rollout_stage": by_stage,
        "metrics": {
            "runtime_opens": runtime_opens,
            "runtime_sessions_started": runtime_sessions_started,
            "runtime_sessions_completed": runtime_sessions_completed,
            "manual_deck_creates": manual_deck_creates,
            "manual_card_creates": manual_card_creates,
            "text_import_parses": text_import_parses,
            "text_import_executes": text_import_executes,
            "text_import_errors": text_import_errors,
            "backfill_runs": backfill_runs,
            "backfill_verify_failures": backfill_verify_failures,
            "feature_blocks": feature_blocks,
        },
    }


def _build_microcards_prod_rollout_status_payload(*, include_telemetry: bool = False, telemetry_limit: int = 5000) -> Dict[str, Any]:
    stage = _get_microcards_rollout_stage()
    prev_stage, next_stage = _microcards_rollout_prev_next(stage)
    mc_flags = _get_microcards_prod_feature_flags()
    theory_flags = _get_editor_feature_flags()
    payload: Dict[str, Any] = {
        "stage": stage,
        "stage_env_key": _MICROCARDS_ROLLOUT_STAGE_ENV_KEY,
        "available_stages": list(_MICROCARDS_ROLLOUT_STAGE_SEQUENCE),
        "previous_stage": prev_stage,
        "next_stage": next_stage,
        "effective_feature_flags": mc_flags,
        "stage_caps": _get_microcards_rollout_stage_caps(stage),
        "theory_rollout_stage": _get_theory_rollout_stage(),
        "theory_feature_flags": theory_flags,
        "rollback_guarantees": [
            "Microcards prod rollout stage only gates feature exposure via flags; lowering stage does not delete deck/review/calendar data.",
            "Backend data (decks, review_events, activity.json) persists across all stage transitions.",
            "Disabling calendar/statistics integration hides mixed-activity fields in UI but does not revert backfill data.",
            "Re-enabling a stage restores full functionality without data loss.",
            "Backfill can be re-run safely (idempotent) after any stage change.",
        ],
    }
    if include_telemetry:
        payload["telemetry"] = _build_microcards_prod_telemetry_summary(limit=telemetry_limit)
    return payload


def _ai_run_merge_manifest(run_id: str, patch_data: Dict[str, Any]) -> None:
    run_dir = _ai_run_dir(run_id)
    manifest_path = run_dir / "run.json"
    manifest = _read_json_file(manifest_path) or {"run_id": run_id}
    if not isinstance(manifest, dict):
        manifest = {"run_id": run_id}
    manifest.update({k: v for k, v in (patch_data or {}).items() if v is not None})
    manifest.setdefault("created_at", _utc_now_iso())
    manifest["updated_at"] = _utc_now_iso()
    _write_json_file(manifest_path, manifest)


def _ai_run_write_artifact(run_id: str, artifact_name: str, payload: Dict[str, Any]) -> None:
    run_dir = _ai_run_dir(run_id)
    artifact_path = run_dir / f"{artifact_name}.json"
    _write_json_file(artifact_path, payload)


def _ai_run_build_reopen_analysis_response(run_id: str, *, apply_feature_flags: bool = True) -> Optional[Dict[str, Any]]:
    if not _is_valid_ai_run_id(run_id):
        return None
    run_dir = _ai_runs_root() / run_id
    if not run_dir.exists() or not run_dir.is_dir():
        return None

    manifest = _read_json_file(run_dir / "run.json") or {}
    if not isinstance(manifest, dict):
        manifest = {}
    analysis_artifact = _read_json_file(run_dir / "analysis.json") or {}
    if not isinstance(analysis_artifact, dict):
        return None

    result = analysis_artifact.get("result")
    if not isinstance(result, dict):
        return None

    material_stats = analysis_artifact.get("material_stats")
    if not isinstance(material_stats, dict):
        material_stats = {}
    lang_prefs = analysis_artifact.get("language_preferences")
    if not isinstance(lang_prefs, dict):
        lang_prefs = {}
    provider_chain_attempts = analysis_artifact.get("provider_chain_attempts")
    if not isinstance(provider_chain_attempts, list):
        provider_chain_attempts = manifest.get("provider_chain_attempts")
    if not isinstance(provider_chain_attempts, list):
        provider_chain_attempts = []

    source_file_info = manifest.get("source_file_info")
    if not isinstance(source_file_info, dict):
        source_file_info = None

    response: Dict[str, Any] = {
        "ok": True,
        "ai_run_id": run_id,
        "provider_used": analysis_artifact.get("provider_used") or manifest.get("provider_used"),
        "provider_model": analysis_artifact.get("provider_model") or manifest.get("provider_model"),
        "provider_chain_attempts": provider_chain_attempts,
        "material_language": material_stats.get("language") or manifest.get("material_language"),
        "output_language_mode": lang_prefs.get("mode") or manifest.get("output_language_mode"),
        "requested_output_language": lang_prefs.get("requested") or manifest.get("requested_output_language"),
        "effective_output_language": lang_prefs.get("effective") or manifest.get("effective_output_language"),
        "output_language_warning": lang_prefs.get("translation_warning"),
        "analysis_created_at": analysis_artifact.get("created_at"),
        "material_stats": material_stats,
        "source_file_info": source_file_info,
        "source_file_name": (
            manifest.get("source_file_name")
            or ((source_file_info or {}).get("name") if isinstance(source_file_info, dict) else None)
        ),
        "run_manifest": {
            "phase": manifest.get("phase"),
            "created_at": manifest.get("created_at"),
            "updated_at": manifest.get("updated_at"),
            "material_word_count": manifest.get("material_word_count"),
        },
    }
    response.update(result)
    if not apply_feature_flags:
        return response
    return _sanitize_analysis_response_for_client(response)


def _microcards_service() -> MicrocardsService:
    user_id = _headless_app_ctx.user_id or "default_user"
    return MicrocardsService(str(_headless_app_ctx.data_dir), user_id=user_id)


def _microcards_analytics_service() -> MicrocardsAnalyticsService:
    current_data_dir = str(_headless_app_ctx.data_dir)
    cached = getattr(_headless_app_ctx, "microcards_analytics_service", None)
    if isinstance(cached, MicrocardsAnalyticsService) and str(cached.data_dir) == current_data_dir:
        return cached
    service = MicrocardsAnalyticsService(current_data_dir)
    setattr(_headless_app_ctx, "microcards_analytics_service", service)
    return service


def _invalidate_microcards_analytics_cache(user_id: Optional[str] = None) -> bool:
    resolved_user_id = str(user_id or _headless_app_ctx.user_id or "default_user").strip() or "default_user"
    try:
        _microcards_analytics_service().clear_cache(resolved_user_id)
        return True
    except Exception as exc:
        logger.warning("[HTTP] M5 microcards analytics cache invalidation failed for user=%s: %s", resolved_user_id, exc)
        return False


_MICROCARDS_REVIEW_LIVE_INTEGRATION_LOCK = threading.Lock()
_MICROCARDS_REVIEW_LIVE_INTEGRATION_SCHEMA = "1.0"
_MICROCARDS_REVIEW_LIVE_INTEGRATION_HISTORY_LIMIT = 5000


def _microcards_review_live_integration_state_path(user_id: Optional[str] = None) -> Path:
    resolved_user_id = str(user_id or _headless_app_ctx.user_id or "default_user").strip() or "default_user"
    return Path(_headless_app_ctx.data_dir) / "users" / resolved_user_id / "microcards" / "live_integration_state.json"


def _microcards_review_live_integration_key(review_event: Dict[str, Any]) -> str:
    event_id = str(review_event.get("id") or "").strip()
    if event_id:
        return f"review_event:{event_id}"
    # Fallback for defensive compatibility if event id is missing/corrupted.
    fingerprint = {
        "card_id": review_event.get("card_id"),
        "session_id": review_event.get("session_id"),
        "reviewed_at": review_event.get("reviewed_at"),
        "rating": review_event.get("rating"),
    }
    return f"review_event_hash:{_stable_json_hash(fingerprint)}"


def _load_microcards_review_live_integration_state(user_id: str) -> Dict[str, Any]:
    payload = _read_json_file(_microcards_review_live_integration_state_path(user_id)) or {}
    keys_raw = payload.get("calendar_review_event_keys")
    if not isinstance(keys_raw, list):
        keys_raw = []

    normalized_keys: List[str] = []
    seen = set()
    for raw in keys_raw:
        key = str(raw or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        normalized_keys.append(key)

    return {
        "schema_version": str(payload.get("schema_version") or _MICROCARDS_REVIEW_LIVE_INTEGRATION_SCHEMA),
        "user_id": str(payload.get("user_id") or user_id).strip() or user_id,
        "calendar_review_event_keys": normalized_keys[-_MICROCARDS_REVIEW_LIVE_INTEGRATION_HISTORY_LIMIT:],
        "updated_at": payload.get("updated_at"),
        "applied_total": int(payload.get("applied_total") or 0),
    }


def _save_microcards_review_live_integration_state(user_id: str, state: Dict[str, Any]) -> None:
    payload = {
        "schema_version": _MICROCARDS_REVIEW_LIVE_INTEGRATION_SCHEMA,
        "user_id": str(user_id or "default_user"),
        "calendar_review_event_keys": list(
            (state.get("calendar_review_event_keys") if isinstance(state, dict) else []) or []
        )[-_MICROCARDS_REVIEW_LIVE_INTEGRATION_HISTORY_LIMIT:],
        "updated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "applied_total": int((state or {}).get("applied_total") or 0),
    }
    _write_json_file(_microcards_review_live_integration_state_path(user_id), payload)


def _apply_microcards_review_calendar_integration(
    *,
    user_id: str,
    deck_id: str,
    card_id: str,
    review_event: Dict[str, Any],
) -> Dict[str, Any]:
    if not CALENDAR_AVAILABLE or CalendarService is None:
        return {"applied": False, "skipped": True, "reason": "calendar_service_unavailable"}

    try:
        calendar_svc = CalendarService(
            data_dir=str(_headless_app_ctx.data_dir),
            user_id=user_id,
        )
    except Exception as exc:
        logger.warning("[HTTP] M1 microcards calendar integration init failed: %s", exc)
        return {"applied": False, "skipped": False, "reason": "calendar_service_init_failed"}

    record_review = getattr(calendar_svc, "record_microcards_review", None)
    if not callable(record_review):
        return {"applied": False, "skipped": True, "reason": "calendar_method_unavailable"}

    try:
        record_review(
            deck_id=str(deck_id or "").strip(),
            card_id=str(card_id or "").strip(),
            review_event=review_event,
        )
        return {"applied": True, "method": "record_microcards_review"}
    except Exception as exc:
        logger.warning("[HTTP] M1 microcards calendar integration failed: %s", exc)
        return {"applied": False, "skipped": False, "reason": "calendar_integration_failed"}


def _orchestrate_microcards_review_post_submit(
    *,
    deck_id: str,
    card_id: str,
    review_result: Dict[str, Any],
) -> Dict[str, Any]:
    user_id = str(_headless_app_ctx.user_id or "default_user").strip() or "default_user"
    review_event = review_result.get("review_event") if isinstance(review_result, dict) else None
    review_event = review_event if isinstance(review_event, dict) else {}
    integration_key = _microcards_review_live_integration_key(review_event) if review_event else ""

    calendar_status: Dict[str, Any] = {"applied": False, "skipped": True, "reason": "missing_review_event"}
    if integration_key:
        with _MICROCARDS_REVIEW_LIVE_INTEGRATION_LOCK:
            state = _load_microcards_review_live_integration_state(user_id)
            applied_keys = state.get("calendar_review_event_keys")
            if not isinstance(applied_keys, list):
                applied_keys = []
                state["calendar_review_event_keys"] = applied_keys
            applied_set = {str(v or "").strip() for v in applied_keys if str(v or "").strip()}

            if integration_key in applied_set:
                calendar_status = {
                    "applied": False,
                    "skipped": True,
                    "idempotent_skip": True,
                    "reason": "already_applied",
                    "integration_key": integration_key,
                }
            else:
                calendar_status = _apply_microcards_review_calendar_integration(
                    user_id=user_id,
                    deck_id=deck_id,
                    card_id=card_id,
                    review_event=review_event,
                )
                if bool(calendar_status.get("applied")):
                    applied_keys.append(integration_key)
                    state["calendar_review_event_keys"] = applied_keys[
                        -_MICROCARDS_REVIEW_LIVE_INTEGRATION_HISTORY_LIMIT:
                    ]
                    state["applied_total"] = int(state.get("applied_total") or 0) + 1
                    _save_microcards_review_live_integration_state(user_id, state)

    stats_cache_cleared = False
    stats_svc = getattr(_headless_app_ctx, "statistics_service", None)
    if stats_svc is not None and hasattr(stats_svc, "clear_cache"):
        try:
            stats_svc.clear_cache(user_id)
            stats_cache_cleared = True
        except Exception as exc:
            logger.warning("[HTTP] M1 microcards stats cache invalidation failed: %s", exc)
    analytics_cache_cleared = _invalidate_microcards_analytics_cache(user_id)

    if bool(calendar_status.get("idempotent_skip")):
        logger.debug(
            "[HTTP] M1 microcards review live integration idempotent skip user_id=%s key=%s",
            user_id,
            calendar_status.get("integration_key"),
        )
    elif bool(calendar_status.get("applied")):
        logger.debug(
            "[HTTP] M1 microcards review live integration applied user_id=%s deck_id=%s card_id=%s",
            user_id,
            deck_id,
            card_id,
        )
    elif not bool(calendar_status.get("skipped", True)):
        logger.warning(
            "[HTTP] M1 microcards review live integration not applied user_id=%s reason=%s",
            user_id,
            calendar_status.get("reason"),
        )

    return {
        "calendar_integration": calendar_status,
        "statistics_cache_cleared": stats_cache_cleared,
        "microcards_analytics_cache_cleared": analytics_cache_cleared,
    }



# ── Register microcards helpers for routes/microcards_routes.py ────────
from routes._context import set_extra as _set_extra_mc  # noqa: E402
_set_extra_mc("microcards_helpers", {
    "build_theory_rollout_status_payload": _build_theory_rollout_status_payload,
    "build_theory_rollout_telemetry_summary": _build_theory_rollout_telemetry_summary,
    "build_microcards_prod_rollout_status_payload": _build_microcards_prod_rollout_status_payload,
    "build_microcards_prod_telemetry_summary": _build_microcards_prod_telemetry_summary,
    "emit_microcards_prod_telemetry": _emit_microcards_prod_telemetry,
    "emit_theory_rollout_telemetry": _emit_theory_rollout_telemetry,
    "is_editor_feature_enabled": _is_editor_feature_enabled,
    "feature_disabled_json": _feature_disabled_json,
    "microcards_service": _microcards_service,
    "microcards_analytics_service": _microcards_analytics_service,
    "invalidate_microcards_analytics_cache": _invalidate_microcards_analytics_cache,
    "get_microcards_prod_feature_flags": _get_microcards_prod_feature_flags,
    "is_microcards_prod_feature_enabled": _is_microcards_prod_feature_enabled,
    "microcards_prod_feature_disabled_json": _microcards_prod_feature_disabled_json,
    "is_valid_ai_run_id": _is_valid_ai_run_id,
    "ai_run_build_reopen_analysis_response": _ai_run_build_reopen_analysis_response,
    "sanitize_analysis_for_microcards_backend": _sanitize_analysis_for_microcards_backend,
    "orchestrate_microcards_review_post_submit": _orchestrate_microcards_review_post_submit,
    "PARSERS_AVAILABLE": PARSERS_AVAILABLE,
    "MicrocardParser": MicrocardParser if PARSERS_AVAILABLE else None,
})


def _normalize_int_id_list(values: Any) -> List[int]:
    out: List[int] = []
    seen = set()
    if not isinstance(values, list):
        return out
    for raw in values:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            continue
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _normalize_str_id_list(values: Any) -> List[str]:
    out: List[str] = []
    seen = set()
    if not isinstance(values, list):
        return out
    for raw in values:
        value = str(raw or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _sanitize_source_grounding_meta(value: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(value, dict):
        return None
    out: Dict[str, Any] = {}
    if value.get("primary_unit_id") is not None:
        out["primary_unit_id"] = value.get("primary_unit_id")
    if value.get("primary_unit_title"):
        out["primary_unit_title"] = value.get("primary_unit_title")
    if isinstance(value.get("score"), (int, float)):
        out["score"] = float(value.get("score"))
    if isinstance(value.get("shared_token_count"), int):
        out["shared_token_count"] = int(value.get("shared_token_count"))
    if isinstance(value.get("shared_number_count"), int):
        out["shared_number_count"] = int(value.get("shared_number_count"))
    if isinstance(value.get("weak"), bool):
        out["weak"] = bool(value.get("weak"))
    return out or None


def _saved_task_to_grounding_preview(task_data: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(task_data, dict):
        return {}
    content = task_data.get("content")
    if not isinstance(content, dict):
        content = {}
    prompt = (
        task_data.get("prompt")
        or content.get("prompt")
        or content.get("question")
        or ""
    )
    preview: Dict[str, Any] = {
        "type": task_data.get("type"),
        "name": task_data.get("name") or task_data.get("id"),
        "prompt": prompt,
        "data": content,
    }
    subtype = task_data.get("subtype")
    if subtype:
        preview["subtype"] = subtype
    return preview


def _build_ai_analysis_topic_coverage_response(
    run_id: str,
    module_id: str,
    topic_id: str,
) -> Optional[Dict[str, Any]]:
    analysis_payload = _ai_run_build_reopen_analysis_response(run_id, apply_feature_flags=False)
    if analysis_payload is None:
        return None

    storage = _headless_app_ctx.storage_service
    topic = storage.get_topic(module_id, topic_id)
    if not topic:
        raise LookupError("topic_not_found")

    units = analysis_payload.get("educational_units") if isinstance(analysis_payload.get("educational_units"), list) else []
    chunks = analysis_payload.get("learning_chunks") if isinstance(analysis_payload.get("learning_chunks"), list) else []
    coverage_plan = analysis_payload.get("coverage_plan") if isinstance(analysis_payload.get("coverage_plan"), dict) else {}

    valid_unit_ids = {
        int(u.get("id"))
        for u in units
        if isinstance(u, dict) and isinstance(u.get("id"), (int, str)) and str(u.get("id")).strip().lstrip("-").isdigit()
    }
    valid_chunk_ids = {
        str(c.get("id")).strip()
        for c in chunks
        if isinstance(c, dict) and str(c.get("id") or "").strip()
    }

    unit_by_id: Dict[int, Dict[str, Any]] = {}
    for unit in units:
        if not isinstance(unit, dict):
            continue
        try:
            uid = int(unit.get("id"))
        except (TypeError, ValueError):
            continue
        unit_by_id[uid] = unit

    chunk_by_id: Dict[str, Dict[str, Any]] = {}
    chunk_units_map: Dict[str, set] = {}
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        cid = str(chunk.get("id") or "").strip()
        if not cid:
            continue
        chunk_by_id[cid] = chunk
        chunk_units_map[cid] = {
            uid for uid in _normalize_int_id_list(chunk.get("unit_ids")) if uid in valid_unit_ids
        }

    unit_targets = coverage_plan.get("unit_targets") if isinstance(coverage_plan.get("unit_targets"), list) else []
    unit_target_by_id: Dict[int, Dict[str, Any]] = {}
    for target in unit_targets:
        if not isinstance(target, dict):
            continue
        try:
            uid = int(target.get("unit_id"))
        except (TypeError, ValueError):
            continue
        unit_target_by_id[uid] = target

    chunk_targets = coverage_plan.get("chunk_targets") if isinstance(coverage_plan.get("chunk_targets"), list) else []
    chunk_target_by_id: Dict[str, Dict[str, Any]] = {}
    for target in chunk_targets:
        if not isinstance(target, dict):
            continue
        cid = str(target.get("chunk_id") or "").strip()
        if not cid:
            continue
        chunk_target_by_id[cid] = target

    unit_contexts_all = _compact_ai_unit_contexts(units, max_units=max(1, len(units) or 1))
    unit_context_by_id = {
        int(ctx.get("id")): ctx
        for ctx in unit_contexts_all
        if isinstance(ctx, dict) and isinstance(ctx.get("id"), (int, str)) and str(ctx.get("id")).strip().lstrip("-").isdigit()
    }

    unit_counts: Dict[int, int] = {uid: 0 for uid in unit_by_id.keys()}
    chunk_counts: Dict[str, int] = {cid: 0 for cid in chunk_by_id.keys()}
    unit_task_refs: Dict[int, List[Dict[str, Any]]] = {uid: [] for uid in unit_by_id.keys()}
    chunk_task_refs: Dict[str, List[Dict[str, Any]]] = {cid: [] for cid in chunk_by_id.keys()}

    tasks_summary: List[Dict[str, Any]] = []
    tasks_index: List[Dict[str, Any]] = storage.get_tasks(module_id, topic_id) or []

    tasks_total = 0
    tasks_linked_in_scope = 0
    tasks_without_links = 0
    tasks_foreign_run = 0
    weak_grounding_tasks = 0

    for task_ref in tasks_index:
        if not isinstance(task_ref, dict):
            continue
        task_id = str(task_ref.get("id") or "").strip()
        if not task_id:
            continue
        tasks_total += 1

        loaded = storage.load_task(module_id, topic_id, task_id)
        if not isinstance(loaded, dict):
            continue
        task_data = loaded.get("task_data")
        if not isinstance(task_data, dict):
            continue
        meta = task_data.get("meta")
        if not isinstance(meta, dict):
            meta = {}

        task_name = str(task_data.get("name") or task_ref.get("name") or task_id)
        task_type = str(task_data.get("type") or task_ref.get("type") or "unknown")
        task_subtype = task_data.get("subtype") or task_ref.get("subtype")
        task_ai_run_id = str(meta.get("ai_run_id") or "").strip() or None

        scope = "legacy_unscoped"
        if task_ai_run_id:
            scope = "match" if task_ai_run_id == run_id else "foreign_run"
        if scope == "foreign_run":
            tasks_foreign_run += 1

        linked_unit_ids = [uid for uid in _normalize_int_id_list(meta.get("educational_unit_ids")) if uid in valid_unit_ids]
        explicit_chunk_ids = [
            cid
            for cid in _normalize_str_id_list(meta.get("analysis_chunk_ids") or meta.get("chunk_ids"))
            if cid in valid_chunk_ids
        ]

        inferred_chunk_ids: List[str] = []
        if linked_unit_ids:
            linked_units_set = set(linked_unit_ids)
            for cid, chunk_unit_ids in chunk_units_map.items():
                if not chunk_unit_ids:
                    continue
                if linked_units_set.intersection(chunk_unit_ids):
                    inferred_chunk_ids.append(cid)

        seen_chunk_ids = set()
        linked_chunk_ids: List[str] = []
        for cid in explicit_chunk_ids + inferred_chunk_ids:
            if cid in seen_chunk_ids:
                continue
            seen_chunk_ids.add(cid)
            linked_chunk_ids.append(cid)

        chunk_link_mode = "none"
        if explicit_chunk_ids and inferred_chunk_ids:
            chunk_link_mode = "mixed"
        elif explicit_chunk_ids:
            chunk_link_mode = "explicit"
        elif linked_chunk_ids:
            chunk_link_mode = "inferred_from_units"

        in_selected_scope = scope != "foreign_run"
        has_links = bool(linked_unit_ids or linked_chunk_ids)
        if in_selected_scope and has_links:
            tasks_linked_in_scope += 1
        elif in_selected_scope and not has_links:
            tasks_without_links += 1

        grounding = None
        grounding_source = None
        if in_selected_scope:
            grounding = _sanitize_source_grounding_meta(meta.get("source_grounding"))
            if grounding:
                grounding_source = "meta"
            elif linked_unit_ids:
                preview = _saved_task_to_grounding_preview(task_data)
                linked_contexts = [unit_context_by_id[uid] for uid in linked_unit_ids if uid in unit_context_by_id]
                if linked_contexts:
                    computed_grounding = _evaluate_task_source_grounding(
                        preview,
                        linked_contexts,
                        task_type=str(task_type or ""),
                    )
                    if isinstance(computed_grounding, dict):
                        grounding = _sanitize_source_grounding_meta(computed_grounding)
                        grounding_source = "recomputed"

        weak_grounding = bool(isinstance(grounding, dict) and grounding.get("weak"))
        if in_selected_scope and weak_grounding:
            weak_grounding_tasks += 1

        task_warnings: List[str] = []
        if scope == "foreign_run":
            task_warnings.append("linked_to_other_ai_run")
        elif not has_links:
            task_warnings.append("no_analysis_links")
        if in_selected_scope and weak_grounding:
            task_warnings.append("weak_source_grounding")

        if in_selected_scope and has_links:
            ref_stub = {
                "task_id": task_id,
                "name": task_name,
                "type": task_type,
                "weak_grounding": weak_grounding,
            }
            for uid in linked_unit_ids:
                unit_counts[uid] = unit_counts.get(uid, 0) + 1
                unit_task_refs.setdefault(uid, []).append(ref_stub)
            for cid in linked_chunk_ids:
                chunk_counts[cid] = chunk_counts.get(cid, 0) + 1
                chunk_task_refs.setdefault(cid, []).append(ref_stub)

        tasks_summary.append(
            {
                "task_id": task_id,
                "name": task_name,
                "type": task_type,
                "subtype": task_subtype,
                "analysis_scope": scope,
                "analysis_ai_run_id": task_ai_run_id,
                "educational_unit_ids": linked_unit_ids,
                "analysis_chunk_ids": linked_chunk_ids,
                "analysis_chunk_ids_explicit": explicit_chunk_ids,
                "chunk_link_mode": chunk_link_mode,
                "source_grounding": grounding,
                "source_grounding_source": grounding_source,
                "weak_grounding": weak_grounding,
                "warnings": task_warnings,
            }
        )

    duplicate_unit_threshold_default = 3
    duplicate_chunk_threshold_default = 3

    unit_rows: List[Dict[str, Any]] = []
    units_overcovered = 0
    units_uncovered = 0
    must_cover_units_total = 0
    must_cover_units_uncovered = 0
    for uid in sorted(unit_by_id.keys()):
        unit = unit_by_id.get(uid) or {}
        target = unit_target_by_id.get(uid) or {}
        count = int(unit_counts.get(uid, 0) or 0)
        must_cover = bool(target.get("must_cover")) if target else False
        if must_cover:
            must_cover_units_total += 1
        is_gap = count == 0
        is_must_cover_gap = must_cover and is_gap
        if is_gap:
            units_uncovered += 1
        if is_must_cover_gap:
            must_cover_units_uncovered += 1
        is_duplicate = count >= duplicate_unit_threshold_default
        if is_duplicate:
            units_overcovered += 1
        unit_rows.append(
            {
                "unit_id": uid,
                "title": unit.get("title"),
                "type": unit.get("type"),
                "assessment_risk": unit.get("assessment_risk"),
                "must_cover": must_cover,
                "coverage_count": count,
                "is_gap": is_gap,
                "is_must_cover_gap": is_must_cover_gap,
                "is_duplicate": is_duplicate,
                "duplicate_threshold": duplicate_unit_threshold_default,
                "task_refs": (unit_task_refs.get(uid) or [])[:10],
                "recommended_surfaces": (
                    target.get("recommended_surfaces") if isinstance(target.get("recommended_surfaces"), list) else []
                ),
                "preferred_task_types": (
                    target.get("preferred_task_types") if isinstance(target.get("preferred_task_types"), list) else []
                ),
                "avoid_overtesting_with": (
                    target.get("avoid_overtesting_with") if isinstance(target.get("avoid_overtesting_with"), list) else []
                ),
            }
        )

    chunk_rows: List[Dict[str, Any]] = []
    chunks_overcovered = 0
    chunks_uncovered = 0
    for cid in sorted(chunk_by_id.keys()):
        chunk = chunk_by_id.get(cid) or {}
        target = chunk_target_by_id.get(cid) or {}
        count = int(chunk_counts.get(cid, 0) or 0)
        threshold_raw = target.get("max_primary_tasks_recommended")
        try:
            threshold = int(threshold_raw) if threshold_raw is not None else duplicate_chunk_threshold_default
        except (TypeError, ValueError):
            threshold = duplicate_chunk_threshold_default
        if threshold <= 0:
            threshold = duplicate_chunk_threshold_default
        is_gap = count == 0
        if is_gap:
            chunks_uncovered += 1
        is_duplicate = count > threshold
        if is_duplicate:
            chunks_overcovered += 1
        chunk_rows.append(
            {
                "chunk_id": cid,
                "title": chunk.get("title"),
                "chunk_type": chunk.get("chunk_type"),
                "coverage_count": count,
                "is_gap": is_gap,
                "is_duplicate": is_duplicate,
                "duplicate_threshold": threshold,
                "task_refs": (chunk_task_refs.get(cid) or [])[:10],
                "unit_ids": _normalize_int_id_list(chunk.get("unit_ids")),
                "route_ids": _normalize_str_id_list(
                    (target.get("route_ids") if isinstance(target, dict) else None) or chunk.get("route_ids")
                ),
                "max_primary_tasks_recommended": target.get("max_primary_tasks_recommended"),
            }
        )

    tasks_summary.sort(
        key=lambda row: (
            1 if row.get("analysis_scope") == "foreign_run" else 0,
            1 if row.get("warnings") else 0,
            str(row.get("name") or row.get("task_id") or "").lower(),
        )
    )

    warnings_out: List[str] = []
    if tasks_without_links > 0:
        warnings_out.append(
            f"{tasks_without_links} task(s) in selected topic have no unit/chunk links for this analysis."
        )
    if weak_grounding_tasks > 0:
        warnings_out.append(
            f"{weak_grounding_tasks} linked task(s) have weak source grounding and should be reviewed."
        )
    if tasks_foreign_run > 0:
        warnings_out.append(
            f"{tasks_foreign_run} task(s) are linked to a different ai_run and were excluded from this coverage view."
        )

    return {
        "ok": True,
        "ai_run_id": run_id,
        "module_id": module_id,
        "topic_id": topic_id,
        "topic_name": topic.get("name") if isinstance(topic, dict) else None,
        "analysis_schema_version": analysis_payload.get("analysis_schema_version"),
        "coverage_plan_version": (
            coverage_plan.get("coverage_plan_version") if isinstance(coverage_plan, dict) else None
        ),
        "summary": {
            "tasks_total": tasks_total,
            "tasks_linked_in_scope": tasks_linked_in_scope,
            "tasks_without_links": tasks_without_links,
            "tasks_foreign_run": tasks_foreign_run,
            "weak_grounding_tasks": weak_grounding_tasks,
            "units_total": len(unit_rows),
            "units_covered": len([r for r in unit_rows if int(r.get("coverage_count") or 0) > 0]),
            "units_uncovered": units_uncovered,
            "units_overcovered": units_overcovered,
            "must_cover_units_total": must_cover_units_total,
            "must_cover_units_uncovered": must_cover_units_uncovered,
            "chunks_total": len(chunk_rows),
            "chunks_covered": len([r for r in chunk_rows if int(r.get("coverage_count") or 0) > 0]),
            "chunks_uncovered": chunks_uncovered,
            "chunks_overcovered": chunks_overcovered,
        },
        "unit_coverage": unit_rows,
        "chunk_coverage": chunk_rows,
        "tasks": tasks_summary,
        "warnings": warnings_out,
    }


def _guess_language_code(text: str) -> str:
    if not isinstance(text, str) or not text.strip():
        return "unknown"
    cyr = sum(1 for ch in text if "а" <= ch.lower() <= "я" or ch.lower() == "ё")
    lat = sum(1 for ch in text if "a" <= ch.lower() <= "z")
    if cyr > lat * 1.3:
        return "ru"
    if lat > cyr * 1.3:
        return "en"
    if cyr == 0 and lat == 0:
        return "unknown"
    return "mixed"


def _extract_task_preview_signature(task: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(task, dict):
        return {}
    signature = {
        "type": task.get("type"),
        "name": task.get("name"),
        "prompt": (task.get("prompt") or task.get("data", {}).get("prompt", "")) if isinstance(task.get("data"), dict) else task.get("prompt"),
    }
    data = task.get("data", {})
    if isinstance(data, dict):
        # Exclude volatile/UI-only fields from duplicate hashing
        signature["data"] = {
            k: v for k, v in data.items()
            if k not in {"metadata", "question_count", "elements_count", "levels_count", "options_count", "correct_count", "text_length", "error_count"}
        }
    return signature


def _task_preview_semantic_blob(task_preview: Dict[str, Any]) -> str:
    """Semantic dedupe blob: text-heavy and stable enough for near-duplicate checks."""
    if not isinstance(task_preview, dict):
        return ""
    fragments: List[str] = []
    _collect_text_fragments_for_grounding(task_preview.get("name"), fragments)
    _collect_text_fragments_for_grounding(task_preview.get("prompt"), fragments)
    data = task_preview.get("data")
    if isinstance(data, dict):
        # Keep content-bearing fields; skip volatile counters/metadata.
        filtered = {
            k: v
            for k, v in data.items()
            if k not in {"metadata", "question_count", "elements_count", "levels_count", "options_count", "correct_count", "text_length", "error_count"}
        }
        _collect_text_fragments_for_grounding(filtered, fragments)
    if not fragments:
        return ""
    return re.sub(r"\s+", " ", " \n ".join(fragments)).strip()


def _char_ngrams(text: str, n: int = 4) -> set:
    if not isinstance(text, str):
        return set()
    cleaned = re.sub(r"\s+", " ", text.strip().lower())
    if len(cleaned) < n:
        return {cleaned} if cleaned else set()
    return {cleaned[i:i + n] for i in range(0, len(cleaned) - n + 1)}


def _semantic_duplicate_threshold(task_type: Optional[str]) -> float:
    tt = str(task_type or "").strip().lower()
    if tt == "click_words":
        return 0.72
    if tt in {"open_answer"}:
        return 0.78
    if tt in {"click_text", "test"}:
        return 0.82
    if tt in {"sequence", "sequence_assembly"}:
        return 0.75
    return 0.8


def _semantic_duplicate_similarity(task_a: Dict[str, Any], task_b: Dict[str, Any]) -> float:
    blob_a = _task_preview_semantic_blob(task_a)
    blob_b = _task_preview_semantic_blob(task_b)
    if not blob_a or not blob_b:
        return 0.0
    tokens_a = _grounding_token_set(blob_a)
    tokens_b = _grounding_token_set(blob_b)
    nums_a = _grounding_number_set(blob_a)
    nums_b = _grounding_number_set(blob_b)
    exact_hash_a = _stable_json_hash(_extract_task_preview_signature(task_a))
    exact_hash_b = _stable_json_hash(_extract_task_preview_signature(task_b))
    if exact_hash_a and exact_hash_a == exact_hash_b:
        return 1.0

    tok_union = len(tokens_a | tokens_b)
    tok_jaccard = (len(tokens_a & tokens_b) / tok_union) if tok_union else 0.0

    nums_union = len(nums_a | nums_b)
    num_jaccard = (len(nums_a & nums_b) / nums_union) if nums_union else 0.0

    ng_a = _char_ngrams(blob_a, 4)
    ng_b = _char_ngrams(blob_b, 4)
    ng_union = len(ng_a | ng_b)
    ng_jaccard = (len(ng_a & ng_b) / ng_union) if ng_union else 0.0

    # For short prompts n-grams are noisy; cap influence unless there is token overlap too.
    if tok_jaccard < 0.15 and ng_jaccard > 0.85:
        ng_jaccard *= 0.6

    score = (tok_jaccard * 0.6) + (ng_jaccard * 0.25) + (num_jaccard * 0.15)
    return round(min(1.0, max(0.0, score)), 4)


def _semantic_duplicate_info_from_preview(task_preview: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(task_preview, dict):
        return None
    ai_meta = task_preview.get("ai_meta")
    if not isinstance(ai_meta, dict):
        return None
    info = ai_meta.get("semantic_duplicate")
    return info if isinstance(info, dict) else None


def _clear_semantic_duplicate_annotations(task_previews: List[Dict[str, Any]]) -> None:
    for task in task_previews or []:
        if not isinstance(task, dict):
            continue
        ai_meta = task.get("ai_meta")
        if isinstance(ai_meta, dict):
            ai_meta.pop("semantic_duplicate", None)


def _annotate_semantic_duplicate_candidates(
    task_previews: List[Dict[str, Any]],
    *,
    task_type: Optional[str] = None,
) -> Dict[str, int]:
    """Annotate near-duplicate tasks within a same-type preview list (in-place).

    Marks weaker tasks in a near-duplicate cluster using `ai_meta.semantic_duplicate`.
    Returns counts for UI/cleanup heuristics.
    """
    if not isinstance(task_previews, list) or len(task_previews) < 2:
        return {"groups": 0, "tasks_marked": 0}

    _clear_semantic_duplicate_annotations(task_previews)
    threshold = _semantic_duplicate_threshold(task_type or (task_previews[0].get("type") if isinstance(task_previews[0], dict) else None))
    n = len(task_previews)
    parent = list(range(n))
    pair_best: Dict[tuple, float] = {}

    def _find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def _union(a: int, b: int) -> None:
        ra = _find(a)
        rb = _find(b)
        if ra != rb:
            parent[rb] = ra

    def _preview_quality_rank(preview: Dict[str, Any]) -> tuple:
        status_rank = {"valid": 0, "warning": 1, "error": 2}
        status = status_rank.get(str(preview.get("status") or "warning"), 1)
        issues = preview.get("validation_issues") or []
        grounding_info = _source_grounding_info_from_preview(preview) or {}
        try:
            grounding_score = float(grounding_info.get("score", 0.0) or 0.0)
        except Exception:
            grounding_score = 0.0
        return (
            status,
            len(issues),
            1 if grounding_info.get("weak") else 0,
            -grounding_score,
            -len(str(preview.get("prompt") or "")),
        )

    for i in range(n):
        a = task_previews[i]
        if not isinstance(a, dict):
            continue
        for j in range(i + 1, n):
            b = task_previews[j]
            if not isinstance(b, dict):
                continue
            score = _semantic_duplicate_similarity(a, b)
            if score < threshold:
                continue
            _union(i, j)
            pair_best[(i, j)] = score

    groups: Dict[int, List[int]] = {}
    for idx in range(n):
        groups.setdefault(_find(idx), []).append(idx)

    groups_marked = 0
    tasks_marked = 0
    for members in groups.values():
        if len(members) < 2:
            continue
        groups_marked += 1
        keeper_idx = sorted(members, key=lambda idx: _preview_quality_rank(task_previews[idx]))[0]
        for idx in members:
            if idx == keeper_idx:
                continue
            task = task_previews[idx]
            if not isinstance(task, dict):
                continue
            best_pair_score = 0.0
            best_peer_name = None
            best_peer_index = None
            for peer in members:
                if peer == idx:
                    continue
                i, j = (idx, peer) if idx < peer else (peer, idx)
                s = pair_best.get((i, j), 0.0)
                if s >= best_pair_score:
                    best_pair_score = s
                    peer_task = task_previews[peer] if 0 <= peer < len(task_previews) else {}
                    best_peer_name = peer_task.get("name") if isinstance(peer_task, dict) else None
                    best_peer_index = peer_task.get("index") if isinstance(peer_task, dict) else None

            task.setdefault("ai_meta", {})
            if isinstance(task.get("ai_meta"), dict):
                task["ai_meta"]["semantic_duplicate"] = {
                    "candidate": True,
                    "score": round(float(best_pair_score or 0.0), 4),
                    "group_size": len(members),
                    "similar_to_index": best_peer_index,
                    "similar_to_name": best_peer_name,
                }
            tasks_marked += 1

    return {"groups": groups_marked, "tasks_marked": tasks_marked}


def _append_validation_issue(task_preview: Dict[str, Any], issue: Dict[str, Any]) -> None:
    if not isinstance(task_preview, dict) or not isinstance(issue, dict):
        return
    issues = task_preview.setdefault("validation_issues", [])
    if not isinstance(issues, list):
        issues = []
        task_preview["validation_issues"] = issues
    issues.append(issue)
    if task_preview.get("status") == "valid":
        task_preview["status"] = "warning"


def _looks_language_mismatch(material_lang: str, text: str) -> bool:
    if material_lang not in {"ru", "en"}:
        return False
    task_lang = _guess_language_code(text or "")
    if task_lang == "unknown":
        return False
    if material_lang == "ru":
        return task_lang == "en"
    if material_lang == "en":
        return task_lang == "ru"
    return False


def _compact_ai_unit_contexts(units: Any, *, max_units: int = 8) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if not isinstance(units, list):
        return out
    for raw in units[: max(0, int(max_units))]:
        if not isinstance(raw, dict):
            continue
        evidence = re.sub(r"\s+", " ", str(raw.get("evidence") or "")).strip()
        if len(evidence) > 240:
            evidence = evidence[:237].rstrip() + "..."
        out.append(
            {
                "id": raw.get("id"),
                "title": str(raw.get("title") or "").strip(),
                "description": str(raw.get("description") or "").strip(),
                "evidence": evidence,
                "type": str(raw.get("type") or "").strip().lower() or None,
                "explicitness": str(raw.get("explicitness") or "").strip().lower() or None,
                "modality": str(raw.get("modality") or "").strip().lower() or None,
                "assessment_risk": str(raw.get("assessment_risk") or "").strip().lower() or None,
            }
        )
    return out


def _collect_text_fragments_for_grounding(value: Any, out: List[str], depth: int = 0) -> None:
    if depth > 5:
        return
    if isinstance(value, str):
        text = value.strip()
        if text:
            out.append(text)
        return
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        out.append(str(value))
        return
    if isinstance(value, dict):
        for key, item in value.items():
            key_norm = str(key or "").strip().lower()
            if key_norm in {"metadata", "ai_meta", "validation_issues"}:
                continue
            _collect_text_fragments_for_grounding(item, out, depth + 1)
        return
    if isinstance(value, list):
        for item in value[:80]:
            _collect_text_fragments_for_grounding(item, out, depth + 1)


def _task_preview_grounding_blob(task_preview: Dict[str, Any]) -> str:
    if not isinstance(task_preview, dict):
        return ""
    fragments: List[str] = []
    _collect_text_fragments_for_grounding(task_preview.get("name"), fragments)
    _collect_text_fragments_for_grounding(task_preview.get("prompt"), fragments)
    _collect_text_fragments_for_grounding(task_preview.get("data"), fragments)
    if not fragments:
        return ""
    joined = " \n ".join(fragments)
    return re.sub(r"\s+", " ", joined).strip()


def _grounding_token_set(text: str) -> set:
    if not isinstance(text, str) or not text.strip():
        return set()
    tokens = re.findall(r"[A-Za-z\u0400-\u04FF0-9][A-Za-z\u0400-\u04FF0-9_-]*", text.lower())
    out = set()
    for tok in tokens:
        if not tok:
            continue
        normalized = _normalize_grounding_token(tok)
        if not normalized:
            continue
        if any(ch.isdigit() for ch in normalized):
            out.add(normalized)
            continue
        if len(normalized) >= 4:
            out.add(normalized)
    return out


def _grounding_number_set(text: str) -> set:
    if not isinstance(text, str) or not text.strip():
        return set()
    return set(re.findall(r"\b\d+(?:[.,]\d+)?\b", text))


def _token_script_hint(token: str) -> str:
    if not isinstance(token, str) or not token:
        return "other"
    has_cyr = any("\u0400" <= ch <= "\u04FF" for ch in token)
    has_lat = any("a" <= ch.lower() <= "z" for ch in token)
    if has_cyr and has_lat:
        return "mixed"
    if has_cyr:
        return "cyr"
    if has_lat:
        return "lat"
    return "other"


def _normalize_grounding_token(token: str) -> str:
    t = str(token or "").strip().lower()
    if not t:
        return ""
    t = t.replace("ё", "е")
    t = t.strip("_-")
    if not t:
        return ""
    if any(ch.isdigit() for ch in t):
        return t

    script = _token_script_hint(t)
    # Lightweight suffix trimming for RU/UK-like forms to reduce false negatives.
    if script == "cyr" and len(t) >= 5:
        suffixes = (
            "иями", "ями", "ами", "еві", "ові", "ого", "ему", "ими", "ыми",
            "ість", "ости", "ення", "ання", "ями", "ями", "ях", "ах", "ою", "ею",
            "ий", "ый", "ій", "ая", "яя", "ое", "ее", "ые", "ие", "ой", "ей",
            "ам", "ям", "ом", "ем", "у", "ю", "а", "я", "ы", "и", "е", "о",
        )
        for suf in suffixes:
            if len(t) - len(suf) >= 4 and t.endswith(suf):
                t = t[: -len(suf)]
                break
    elif script == "lat" and len(t) >= 6:
        for suf in ("ization", "isation", "ations", "ation", "ments", "ment", "ingly", "ingly", "ingly", "ing", "edly", "edly", "ed", "ies", "es", "s"):
            if len(t) - len(suf) >= 4 and t.endswith(suf):
                t = t[: -len(suf)]
                break
    return t


def _common_prefix_len(a: str, b: str) -> int:
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


def _is_fuzzy_grounding_token_match(a: str, b: str) -> bool:
    if not a or not b or a == b:
        return False
    if any(ch.isdigit() for ch in a) or any(ch.isdigit() for ch in b):
        return False
    script_a = _token_script_hint(a)
    script_b = _token_script_hint(b)
    # Allow fuzzy only within same script family (RU/UK both Cyrillic).
    if script_a != script_b:
        return False
    min_pref = 4 if script_a == "cyr" else 5 if script_a == "lat" else 4
    cp = _common_prefix_len(a, b)
    if cp < min_pref:
        return False
    shorter = min(len(a), len(b))
    longer = max(len(a), len(b))
    if shorter <= 0:
        return False
    if (cp / shorter) < 0.6:
        return False
    if abs(len(a) - len(b)) > max(4, int(longer * 0.5)):
        return False
    return True


def _fuzzy_grounding_overlap_pairs(task_tokens: set, unit_tokens: set) -> List[Tuple[str, str]]:
    if not task_tokens or not unit_tokens:
        return []
    remaining_unit = set(unit_tokens)
    pairs: List[Tuple[str, str]] = []
    for t in sorted(task_tokens):
        best_u = None
        best_rank = None
        for u in list(remaining_unit):
            if not _is_fuzzy_grounding_token_match(t, u):
                continue
            cp = _common_prefix_len(t, u)
            rank = (cp, -abs(len(t) - len(u)))
            if best_rank is None or rank > best_rank:
                best_rank = rank
                best_u = u
        if best_u is not None:
            pairs.append((t, best_u))
            remaining_unit.discard(best_u)
    return pairs


def _source_grounding_threshold_relaxation(task_type: Optional[str], task_lang: str, unit_lang: str) -> float:
    tl = str(task_lang or "").lower()
    ul = str(unit_lang or "").lower()
    if not tl or not ul or tl in {"unknown", "mixed"} or ul in {"unknown", "mixed"}:
        return 1.0
    if tl == ul:
        return 1.0
    langs = {tl, ul}
    task_type_norm = str(task_type or "").strip().lower()
    if langs <= {"ru", "uk"}:
        return 0.75
    if "en" in langs and (("ru" in langs) or ("uk" in langs)):
        # Future-primary case: English material -> Russian/Ukrainian tasks via translation.
        # Relax lexical threshold because exact token overlap becomes weaker.
        if task_type_norm in {"open_answer", "click_words"}:
            return 0.6
        return 0.7
    return 0.85


def _source_grounding_weak_threshold(task_type: Optional[str]) -> float:
    task_type_norm = str(task_type or "").strip().lower()
    # CLICK_WORDS intentionally mutates source tokens, so lexical overlap is naturally lower.
    if task_type_norm == "click_words":
        return 0.03
    if task_type_norm in {"sequence_assembly", "sequence"}:
        return 0.05
    if task_type_norm in {"test", "open_answer"}:
        return 0.07
    if task_type_norm in {"click_text", "click"}:
        return 0.06
    return 0.06


def _source_grounding_info_from_preview(task_preview: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(task_preview, dict):
        return None
    ai_meta = task_preview.get("ai_meta")
    if not isinstance(ai_meta, dict):
        return None
    grounding = ai_meta.get("source_grounding")
    return grounding if isinstance(grounding, dict) else None


def _annotate_task_preview_source_grounding(
    task_preview: Dict[str, Any],
    unit_contexts: List[Dict[str, Any]],
    *,
    task_type: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    if not isinstance(task_preview, dict) or not isinstance(unit_contexts, list) or not unit_contexts:
        return None
    grounding_info = _evaluate_task_source_grounding(task_preview, unit_contexts, task_type=task_type)
    if grounding_info is None:
        return None
    task_preview.setdefault("ai_meta", {})
    if isinstance(task_preview.get("ai_meta"), dict):
        task_preview["ai_meta"]["source_grounding"] = grounding_info
    return grounding_info


def _evaluate_task_source_grounding(
    task_preview: Dict[str, Any],
    unit_contexts: List[Dict[str, Any]],
    *,
    task_type: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    if not isinstance(task_preview, dict) or not isinstance(unit_contexts, list) or not unit_contexts:
        return None

    task_blob = _task_preview_grounding_blob(task_preview)
    if not task_blob:
        return None

    task_tokens = _grounding_token_set(task_blob)
    task_numbers = _grounding_number_set(task_blob)
    task_lang = _guess_language_code(task_blob)
    if not task_tokens and not task_numbers:
        return None

    best_info: Optional[Dict[str, Any]] = None
    for unit in unit_contexts:
        if not isinstance(unit, dict):
            continue
        unit_blob = re.sub(
            r"\s+",
            " ",
            " ".join(
                [
                    str(unit.get("title") or ""),
                    str(unit.get("description") or ""),
                    str(unit.get("evidence") or ""),
                ]
            ),
        ).strip()
        if not unit_blob:
            continue
        unit_tokens = _grounding_token_set(unit_blob)
        unit_numbers = _grounding_number_set(unit_blob)
        unit_lang = _guess_language_code(unit_blob)
        shared_tokens = sorted(task_tokens & unit_tokens)
        shared_numbers = sorted(task_numbers & unit_numbers)
        fuzzy_pairs = _fuzzy_grounding_overlap_pairs(task_tokens - set(shared_tokens), unit_tokens - set(shared_tokens))

        denom_tokens = max(1, min(max(1, len(task_tokens)), max(1, len(unit_tokens))))
        token_overlap = min(1.0, (len(shared_tokens) + (0.6 * len(fuzzy_pairs))) / denom_tokens)
        num_overlap = 0.0
        if task_numbers or unit_numbers:
            num_overlap = len(shared_numbers) / max(1, min(max(1, len(task_numbers)), max(1, len(unit_numbers))))
        score = round((token_overlap * 0.8) + (num_overlap * 0.2), 4)
        threshold_relaxation = _source_grounding_threshold_relaxation(task_type, task_lang, unit_lang)

        candidate = {
            "primary_unit_id": unit.get("id"),
            "primary_unit_title": unit.get("title"),
            "score": score,
            "shared_token_count": len(shared_tokens),
            "shared_fuzzy_token_count": len(fuzzy_pairs),
            "shared_number_count": len(shared_numbers),
            "shared_tokens_sample": shared_tokens[:6],
            "shared_fuzzy_tokens_sample": [f"{a}~{b}" for a, b in fuzzy_pairs[:6]],
            "shared_numbers": shared_numbers[:6],
            "task_language": task_lang,
            "unit_language": unit_lang,
            "threshold_relaxation": threshold_relaxation,
        }
        if best_info is None:
            best_info = candidate
            continue
        if (
            candidate["score"] > best_info["score"]
            or (
                candidate["score"] == best_info["score"]
                and (
                    candidate["shared_token_count"] + candidate.get("shared_fuzzy_token_count", 0)
                    > best_info["shared_token_count"] + best_info.get("shared_fuzzy_token_count", 0)
                )
            )
        ):
            best_info = candidate

    if best_info is None:
        return None

    threshold = _source_grounding_weak_threshold(task_type)
    threshold = round(float(threshold) * float(best_info.get("threshold_relaxation", 1.0) or 1.0), 4)
    weak_grounding = (
        (best_info.get("score", 0.0) < threshold)
        or (
            best_info.get("shared_token_count", 0) == 0
            and best_info.get("shared_fuzzy_token_count", 0) == 0
            and best_info.get("shared_number_count", 0) == 0
        )
    )
    best_info["weak"] = bool(weak_grounding)
    best_info["weak_threshold"] = threshold
    return best_info


def _normalize_output_language_request(
    payload: Dict[str, Any],
    material_language: str,
) -> Dict[str, Any]:
    raw_mode = str((payload or {}).get("output_language_mode") or "same_as_material").strip().lower()
    mode = raw_mode if raw_mode in {"same_as_material", "custom"} else "same_as_material"
    raw_lang = str((payload or {}).get("output_language") or "").strip().lower()
    if raw_lang in {"", "auto", "same", "same_as_material"}:
        raw_lang = ""
    if raw_lang and not re.fullmatch(r"[a-z][a-z0-9_-]{0,15}", raw_lang):
        raw_lang = ""

    effective = raw_lang if (mode == "custom" and raw_lang) else material_language
    if effective not in {"ru", "en", "mixed"} and not re.fullmatch(r"[a-z][a-z0-9_-]{0,15}", str(effective or "")):
        effective = "unknown"

    translation_warning = None
    if mode == "custom" and raw_lang and material_language in {"ru", "en"} and raw_lang != material_language:
        translation_warning = (
            "Выбран язык заданий, отличный от языка материала. Перевод может быть посредственным, "
            "и задания, вероятно, потребуют доработки в редакторе."
        )

    return {
        "mode": mode,
        "requested": raw_lang or None,
        "effective": effective or "unknown",
        "translation_warning": translation_warning,
    }


# ── Register AI helpers for routes/ai_routes.py ───────────────────────
from routes._context import set_extra as _set_extra_ai  # noqa: E402
_set_extra_ai("ai_helpers", {
    "attach_editor_feature_flags": _attach_editor_feature_flags,
    "safe_ai_run_id": _safe_ai_run_id,
    "guess_language_code": _guess_language_code,
    "normalize_output_language_request": _normalize_output_language_request,
    "ai_run_merge_manifest": _ai_run_merge_manifest,
    "ai_run_write_artifact": _ai_run_write_artifact,
    "sanitize_analysis_response_for_client": _sanitize_analysis_response_for_client,
    "emit_theory_rollout_telemetry": _emit_theory_rollout_telemetry,
    "utc_now_iso": _utc_now_iso,
    "analysis_rollout_quality_fields": _analysis_rollout_quality_fields,
    "ai_runs_root": _ai_runs_root,
    "read_json_file": _read_json_file,
    "ai_run_build_reopen_analysis_response": _ai_run_build_reopen_analysis_response,
    "is_valid_ai_run_id": _is_valid_ai_run_id,
    "build_ai_analysis_topic_coverage_response": _build_ai_analysis_topic_coverage_response,
    "is_editor_feature_enabled": _is_editor_feature_enabled,
    "feature_disabled_json": _feature_disabled_json,
    "AnalysisParseError": AnalysisParseError,
})


def _ai_unit_planning_blob(unit: Dict[str, Any]) -> str:
    if not isinstance(unit, dict):
        return ""
    return f"{unit.get('title', '')} {unit.get('description', '')} {unit.get('type', '')}".lower()


def _score_unit_for_task_type(task_type: str, unit: Dict[str, Any]) -> int:
    blob = _ai_unit_planning_blob(unit)
    score = 0
    if task_type == "SEQUENCE":
        if any(k in blob for k in ["order", "sequence", "step", "stage", "chronolog", "rank", "category", "ordered", "поряд", "этап", "послед"]):
            score += 4
        if any(k in blob for k in ["classification", "категор"]):
            score += 2
    elif task_type == "CLICK_WORDS":
        if re.search(r"\d|%|p\s*[<=>]\s*0?\.\d+", blob):
            score += 4
        if any(k in blob for k in ["date", "year", "risk", "odds", "ratio", "report", "guidance", "дата", "риск", "требован", "отчет", "отчёт"]):
            score += 3
    elif task_type == "OPEN_ANSWER":
        if any(k in blob for k in ["mechan", "why", "how", "effect", "process", "reason", "влия", "механ", "процесс", "почему", "как"]):
            score += 3
        if any(k in blob for k in ["concept", "classification", "conceptual", "концеп"]):
            score += 1
    elif task_type == "CLICK_TEXT":
        if any(k in blob for k in ["difference", "distinction", "rule", "criteria", "risk", "accuracy", "чувств", "правил", "различ", "критер"]):
            score += 2
    elif task_type == "TEST":
        if any(k in blob for k in ["fact", "term", "definition", "classification", "date", "number", "факт", "термин", "определ", "категор", "дата"]):
            score += 2
    if unit.get("assessment_risk") == "high":
        score += 1  # often worth isolating to avoid hallucinated simplifications
    return score


def _plan_ai_generation_subrequests(
    task_type: str,
    count: int,
    educational_units: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Split one large AI generation request into smaller focused subrequests for better coverage."""
    safe_count = max(1, int(count or 1))
    units = [u for u in (educational_units or []) if isinstance(u, dict)]
    if safe_count <= 1 or len(units) <= 1:
        return [{"count": safe_count, "educational_units": units}]

    task_type = str(task_type or "").upper()
    if task_type == "SEQUENCE":
        max_subrequests = min(2, safe_count, len(units))
    elif task_type in {"OPEN_ANSWER", "CLICK_WORDS"}:
        max_subrequests = min(2, safe_count)
    else:
        max_subrequests = min(3, safe_count)

    if len(units) <= 3 and safe_count <= 3:
        return [{"count": safe_count, "educational_units": units}]

    units_sorted = sorted(
        units,
        key=lambda u: (
            -_score_unit_for_task_type(task_type, u),
            str(u.get("title") or ""),
        ),
    )

    # Prefer narrower unit bundles for higher-risk formats.
    if task_type == "SEQUENCE":
        target_units_per_sub = 1
    elif task_type == "OPEN_ANSWER":
        target_units_per_sub = 2
    elif task_type == "CLICK_WORDS":
        target_units_per_sub = 2
    else:
        target_units_per_sub = 3

    ideal_by_units = max(1, (len(units_sorted) + target_units_per_sub - 1) // target_units_per_sub)
    n_sub = max(1, min(max_subrequests, ideal_by_units))
    if n_sub <= 1:
        return [{"count": safe_count, "educational_units": units_sorted}]

    buckets: List[List[Dict[str, Any]]] = [[] for _ in range(n_sub)]
    # Snake distribution balances high-priority units across buckets.
    idx_order = list(range(n_sub)) + list(range(n_sub - 2, 0, -1))
    if not idx_order:
        idx_order = [0]
    for idx, unit in enumerate(units_sorted):
        bucket_idx = idx_order[idx % len(idx_order)]
        buckets[bucket_idx].append(unit)

    # Remove empty buckets (can happen when n_sub > len(units))
    buckets = [b for b in buckets if b]
    n_sub = len(buckets)
    if n_sub <= 1:
        return [{"count": safe_count, "educational_units": units_sorted}]

    base = safe_count // n_sub
    rem = safe_count % n_sub
    counts = [base + (1 if i < rem else 0) for i in range(n_sub)]
    # Guarantee at least 1 request count per bucket by borrowing from the largest bucket if needed.
    for i, c in enumerate(counts):
        if c > 0:
            continue
        donor_idx = max(range(n_sub), key=lambda j: counts[j])
        if counts[donor_idx] > 1:
            counts[donor_idx] -= 1
            counts[i] = 1
    counts = [c for c in counts if c > 0]
    buckets = [buckets[i] for i, c in enumerate([base + (1 if i < rem else 0) for i in range(n_sub)]) if c > 0] if len(counts) != n_sub else buckets

    planned: List[Dict[str, Any]] = []
    for i, c in enumerate(counts):
        planned.append({"count": int(c), "educational_units": buckets[i]})
    return planned or [{"count": safe_count, "educational_units": units_sorted}]


def _postprocess_ai_generate_results(
    material: str,
    results: List[Dict[str, Any]],
    expected_output_language: Optional[str] = None,
) -> Dict[str, Any]:
    """Add quality warnings and analytics to AI generation preview results."""
    material_lang = _guess_language_code(material)
    expected_lang = str(expected_output_language or material_lang or "unknown").strip().lower()
    flat_tasks: List[Dict[str, Any]] = []
    duplicate_buckets: Dict[str, List[Dict[str, Any]]] = {}
    sequence_risk_count = 0
    language_mismatch_count = 0
    source_grounding_warning_count = 0
    source_grounding_checked_tasks = 0
    semantic_duplicate_groups = 0
    semantic_duplicate_tasks = 0
    warning_fields_breakdown: Dict[str, int] = {}

    for result in results:
        if not isinstance(result, dict):
            continue
        task_type = str(result.get("task_type") or "")
        unit_ids = result.get("educational_unit_ids") or []
        unit_contexts = result.get("educational_units_context") or []
        tasks_in_result = result.get("tasks", []) or []
        if isinstance(tasks_in_result, list) and len(tasks_in_result) >= 2:
            sem_stats = _annotate_semantic_duplicate_candidates(tasks_in_result, task_type=task_type)
            semantic_duplicate_groups += int(sem_stats.get("groups", 0) or 0)
            semantic_duplicate_tasks += int(sem_stats.get("tasks_marked", 0) or 0)
        for task in tasks_in_result:
            if not isinstance(task, dict):
                continue
            flat_tasks.append(task)

            data = task.get("data") if isinstance(task.get("data"), dict) else {}
            prompt_text = str(task.get("prompt") or (data.get("prompt") if isinstance(data, dict) else "") or task.get("name") or "")
            signature_hash = _stable_json_hash(_extract_task_preview_signature(task))
            duplicate_buckets.setdefault(signature_hash, []).append(task)

            if _looks_language_mismatch(expected_lang, f"{task.get('name', '')}\n{prompt_text}"):
                _append_validation_issue(
                    task,
                    {
                        "severity": "warning",
                        "message": "Возможное несоответствие языка задания ожидаемому языку генерации",
                        "field": "language_mismatch",
                    },
                )
                language_mismatch_count += 1

            if task_type == "SEQUENCE":
                prompt_lower = prompt_text.lower()
                if any(phrase in prompt_lower for phrase in [
                    "злокачествен",
                    "подозрительн",
                    "suspiciousness",
                    "malignan",
                    "степени подозр",
                ]):
                    _append_validation_issue(
                        task,
                        {
                            "severity": "warning",
                            "message": "Проверьте, что порядок в SEQUENCE явно задан в исходном материале (возможен неявный рейтинг).",
                            "field": "implicit_sequence_order",
                        },
                    )
                    sequence_risk_count += 1
            grounding_info = _source_grounding_info_from_preview(task)
            if grounding_info is None:
                grounding_info = _evaluate_task_source_grounding(task, unit_contexts, task_type=task_type)
            if grounding_info is not None:
                source_grounding_checked_tasks += 1
                task.setdefault("ai_meta", {})
                if isinstance(task["ai_meta"], dict):
                    task["ai_meta"]["source_grounding"] = grounding_info
                if grounding_info.get("weak"):
                    _append_validation_issue(
                        task,
                        {
                            "severity": "warning",
                            "message": "Task may be weakly grounded in the selected educational units/evidence; verify source alignment.",
                            "field": "weak_source_grounding",
                        },
                    )
                    source_grounding_warning_count += 1
            semantic_dup_info = _semantic_duplicate_info_from_preview(task)
            if semantic_dup_info and semantic_dup_info.get("candidate"):
                _append_validation_issue(
                    task,
                    {
                        "severity": "warning",
                        "message": "Task is semantically too similar to another generated task; consider replacing one for better coverage/diversity.",
                        "field": "semantic_duplicate_task",
                    },
                )

            if isinstance(unit_ids, list):
                task.setdefault("ai_meta", {})
                if isinstance(task["ai_meta"], dict):
                    task["ai_meta"]["educational_unit_ids"] = list(unit_ids)

    duplicate_groups = 0
    duplicate_tasks_marked = 0
    for bucket in duplicate_buckets.values():
        if len(bucket) < 2:
            continue
        duplicate_groups += 1
        for task in bucket:
            _append_validation_issue(
                task,
                {
                    "severity": "warning",
                    "message": "Похоже на дубликат другого сгенерированного задания",
                    "field": "duplicate_task",
                },
            )
            duplicate_tasks_marked += 1

    # Aggregate warning fields after all postprocessing issues have been appended.
    for task in flat_tasks:
        if not isinstance(task, dict):
            continue
        for issue in (task.get("validation_issues") or []):
            if not isinstance(issue, dict):
                continue
            if str(issue.get("severity") or "warning") != "warning":
                continue
            field = str(issue.get("field") or "unknown")
            warning_fields_breakdown[field] = warning_fields_breakdown.get(field, 0) + 1

    warning_fields_breakdown = dict(
        sorted(
            warning_fields_breakdown.items(),
            key=lambda kv: (-int(kv[1]), str(kv[0])),
        )
    )

    return {
        "material_language": material_lang,
        "expected_output_language": expected_lang,
        "duplicate_groups": duplicate_groups,
        "duplicate_tasks": duplicate_tasks_marked,
        "language_mismatch_warnings": language_mismatch_count,
        "sequence_grounding_warnings": sequence_risk_count,
        "source_grounding_checked_tasks": source_grounding_checked_tasks,
        "source_grounding_warnings": source_grounding_warning_count,
        "semantic_duplicate_groups": semantic_duplicate_groups,
        "semantic_duplicate_tasks": semantic_duplicate_tasks,
        "warning_fields_breakdown": warning_fields_breakdown,
        "total_tasks": len(flat_tasks),
    }


def _normalize_click_import_data(task_data: Dict[str, Any]) -> Dict[str, Any]:
    data = dict(task_data or {})
    mode = str(data.get("mode") or "").strip().lower()
    if mode == "word_errors":
        mode = "text_errors"
    data["mode"] = mode
    data["subtype"] = data.get("subtype") or "error_detection"

    if mode == "text_choice":
        normalized_options = []
        raw_options = data.get("options", [])
        if isinstance(raw_options, list):
            for idx, opt in enumerate(raw_options):
                if not isinstance(opt, dict):
                    continue
                normalized_options.append(
                    {
                        "id": str(opt.get("id") or f"option_{idx + 1}"),
                        "text": str(opt.get("text", "")),
                        "is_correct": bool(opt.get("is_correct", opt.get("correct", False))),
                    }
                )
        data["options"] = normalized_options

    if mode == "text_errors":
        text = str(data.get("text", ""))
        spans = []
        raw_spans = data.get("error_spans")
        if isinstance(raw_spans, list):
            for span in raw_spans:
                if not isinstance(span, dict):
                    continue
                start = span.get("start")
                end = span.get("end")
                if not isinstance(start, int) or not isinstance(end, int):
                    continue
                spans.append(
                    {
                        "start": start,
                        "end": end,
                        "is_correct": bool(span.get("is_correct", False)),
                    }
                )
        if not spans:
            raw_indices = data.get("error_indices", [])
            if isinstance(raw_indices, list):
                ranges = _word_ranges(text)
                for raw_idx in raw_indices:
                    if not isinstance(raw_idx, int):
                        continue
                    if raw_idx < 0 or raw_idx >= len(ranges):
                        continue
                    start, end = ranges[raw_idx]
                    spans.append({"start": start, "end": end, "is_correct": False})
        data["error_spans"] = spans
        data.pop("error_indices", None)

    return data


def _validate_with_task_type(task_type: str, task_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Validate task data using lightweight import rules."""
    issues: List[Dict[str, Any]] = []

    try:
        data = task_data if isinstance(task_data, dict) else {}
        if task_type == "open_answer":
            question = str(data.get("question") or data.get("prompt") or "").strip()
            if not question:
                issues.append(
                    {
                        "severity": "error",
                        "message": "Вопрос не может быть пустым",
                        "field": "question",
                    }
                )
        elif task_type == "sequence_assembly":
            elements = data.get("elements") or []
            levels = data.get("levels") or []
            if not elements or len(elements) < 2:
                issues.append(
                    {
                        "severity": "error",
                        "message": "Требуется минимум 2 элемента",
                        "field": "elements",
                    }
                )
            if not levels:
                issues.append(
                    {
                        "severity": "error",
                        "message": "Требуется минимум 1 уровень",
                        "field": "levels",
                    }
                )
        elif task_type == "click":
            click_data = _normalize_click_import_data(data)
            mode = click_data.get("mode")
            if mode == "text_choice":
                options = click_data.get("options") or []
                if len(options) < 2:
                    issues.append(
                        {
                            "severity": "error",
                            "message": "Требуется минимум 2 варианта ответа",
                            "field": "options",
                        }
                    )
                correct_count = sum(
                    1 for opt in options if bool(opt.get("is_correct", opt.get("correct", False)))
                )
                if correct_count < 1:
                    issues.append(
                        {
                            "severity": "error",
                            "message": "Должен быть хотя бы один правильный вариант",
                            "field": "options",
                        }
                    )
            elif mode == "text_errors":
                text = str(click_data.get("text", ""))
                spans = click_data.get("error_spans") or []
                if not text.strip():
                    issues.append(
                        {
                            "severity": "error",
                            "message": "Текст не может быть пустым",
                            "field": "text",
                        }
                    )
                if not spans:
                    issues.append(
                        {
                            "severity": "error",
                            "message": "Требуется минимум 1 ошибка",
                            "field": "error_spans",
                        }
                    )
                else:
                    if "[" in text or "]" in text:
                        issues.append(
                            {
                                "severity": "warning",
                                "message": "Unparsed '[' or ']' found in CLICK_WORDS text; possible malformed bracket markup (e.g. multi-word bracket span).",
                                "field": "text_brackets_leftover",
                            }
                        )
                    if len(spans) < 2:
                        issues.append(
                            {
                                "severity": "warning",
                                "message": "CLICK_WORDS usually works better with 2-4 error spans.",
                                "field": "error_spans_count_low",
                            }
                        )
                    elif len(spans) > 5:
                        issues.append(
                            {
                                "severity": "warning",
                                "message": "CLICK_WORDS has too many error spans (recommended 2-4, practical max ~5).",
                                "field": "error_spans_count_high",
                            }
                        )
                    text_len = len(text)
                    for idx, span in enumerate(spans):
                        start = span.get("start") if isinstance(span, dict) else None
                        end = span.get("end") if isinstance(span, dict) else None
                        if (
                            not isinstance(start, int)
                            or not isinstance(end, int)
                            or start < 0
                            or end <= start
                            or end > text_len
                        ):
                            issues.append(
                                {
                                    "severity": "error",
                                    "message": f"Некорректный диапазон ошибки #{idx + 1}",
                                    "field": "error_spans",
                                }
                            )
                            break
            else:
                issues.append(
                    {
                        "severity": "error",
                        "message": "Неизвестный режим click-задачи",
                        "field": "mode",
                    }
                )
        elif task_type == "test":
            questions = data.get("questions") or []
            if not questions:
                issues.append(
                    {
                        "severity": "error",
                        "message": "Тест не содержит вопросов",
                        "field": "questions",
                    }
                )
            else:
                for qi, q in enumerate(questions):
                    if not isinstance(q, dict):
                        continue
                    if not str(q.get("text", "")).strip():
                        issues.append(
                            {
                                "severity": "error",
                                "message": f"Вопрос {qi+1}: пустой текст",
                                "field": "questions",
                            }
                        )
                    answers = q.get("answers") or []
                    if not answers:
                        issues.append(
                            {
                                "severity": "error",
                                "message": f"Вопрос {qi+1}: нет вариантов ответов",
                                "field": "questions",
                            }
                        )
                    elif not any(a.get("correct") for a in answers if isinstance(a, dict)):
                        issues.append(
                            {
                                "severity": "error",
                                "message": f"Вопрос {qi+1}: нет правильных ответов",
                                "field": "questions",
                            }
                        )
    except Exception as e:
        logger.exception("[import] _validate_with_task_type failed: %s", e)
        issues.append(
            {"severity": "error", "message": f"Validation failed: {e}", "field": "general"}
        )

    return issues


# ── Register import helpers for routes/import_routes.py ────────────────
from routes._context import set_extra as _set_extra_imp  # noqa: E402
_set_extra_imp("import_helpers", {
    "validate_with_task_type": _validate_with_task_type,
    "stable_json_hash": _stable_json_hash,
    "extract_task_preview_signature": _extract_task_preview_signature,
    "ai_run_write_artifact": _ai_run_write_artifact,
    "ai_run_merge_manifest": _ai_run_merge_manifest,
    "utc_now_iso": _utc_now_iso,
    "PARSERS_AVAILABLE": PARSERS_AVAILABLE,
    "CURRENT_SCHEMA_VERSION": CURRENT_SCHEMA_VERSION,
    "OpenAnswerParser": OpenAnswerParser if PARSERS_AVAILABLE else None,
    "SequenceParser": SequenceParser if PARSERS_AVAILABLE else None,
    "ClickTextParser": ClickTextParser if PARSERS_AVAILABLE else None,
    "ClickWordsParser": ClickWordsParser if PARSERS_AVAILABLE else None,
    "TestImportParser": TestImportParser if PARSERS_AVAILABLE else None,
})



# NOTE: _format_task_preview, _generate_unique_task_ids moved to routes/import_routes.py



# NOTE: _save_task_to_storage moved to routes/import_routes.py



# NOTE: /api/editor/tasks/delete, /export/text, /modules/delete, /topics/delete,
# /module/rename, /topic/rename, /import/parse, /import/execute
# routes moved to routes/import_routes.py


if __name__ == "__main__":
    # Start watchdog
    watchdog.start()
    try:
        import os
        port = int(os.environ.get("TRAINER_HTTP_PORT", 8000))
        # Default dev server
        _debug = FLASK_DEBUG_ENABLED
        app.run(host="127.0.0.1", port=port, debug=_debug, threaded=True)
    finally:
        watchdog.stop()
