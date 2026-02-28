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


def _ui_state_path(user_id: str) -> Path:
    return _get_user_dir(user_id) / "ui_state.json"


def _read_ui_state(user_id: str) -> Dict[str, Any]:
    user_dir = _get_user_dir(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    path = _ui_state_path(user_id)
    if not path.exists():
        return {
            "version": 1,
            "user_id": user_id,
            "updated_at": datetime.now().isoformat(),
            "pinned": [],
            "recent": [],
        }

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("ui_state_must_be_object")
        if data.get("version") != 1:
            data["version"] = 1
        if data.get("user_id") != user_id:
            data["user_id"] = user_id
        if not isinstance(data.get("pinned"), list):
            data["pinned"] = []
        if not isinstance(data.get("recent"), list):
            data["recent"] = []
        return data
    except Exception as exc:
        logger.exception("[HTTP] Failed to read ui_state for user %s: %s", user_id, exc)
        return {
            "version": 1,
            "user_id": user_id,
            "updated_at": datetime.now().isoformat(),
            "pinned": [],
            "recent": [],
        }


def _write_ui_state(user_id: str, data: Dict[str, Any]) -> None:
    user_dir = _get_user_dir(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    path = _ui_state_path(user_id)
    data["version"] = 1
    data["user_id"] = user_id
    data["updated_at"] = datetime.now().isoformat()

    dir_path = str(path.parent)
    final_path = str(path)

    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            dir=dir_path,
            delete=False,
            encoding="utf-8",
            suffix=".tmp",
        ) as tf:
            json.dump(data, tf, ensure_ascii=False, indent=2)
            temp_name = tf.name

        try:
            os.replace(temp_name, final_path)
        except OSError:
            if os.path.exists(final_path):
                os.remove(final_path)
            os.rename(temp_name, final_path)
    finally:
        if temp_name and os.path.exists(temp_name):
            try:
                os.remove(temp_name)
            except Exception:
                pass


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


def _normalize_complex_id(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    v = value.strip()
    return v or None


def _enrich_complex_with_theory_link(obj: Dict[str, Any]) -> Dict[str, Any]:
    """Attach cached theory metadata to complex payload for UI convenience."""
    theory_link = obj.get("theory_link")
    if not isinstance(theory_link, dict):
        obj["has_theory"] = False
        return obj

    theory_id = theory_link.get("theory_id")
    if not isinstance(theory_id, str) or not theory_id.strip():
        obj["has_theory"] = False
        return obj

    try:
        theory_item = _headless_app_ctx.theory_service.get_theory(
            theory_id.strip(), include_delta=False
        )
        theory_link["title_cache"] = theory_item.get("title", "")
        theory_link["updated_at"] = theory_item.get("updated_at")
        obj["has_theory"] = True
    except TheoryNotFoundError:
        theory_link["missing"] = True
        obj["has_theory"] = False
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.warning("[HTTP] Failed to enrich theory link for complex %s: %s", obj.get("id"), exc)
        obj["has_theory"] = False
    return obj


def _get_complex_by_id(complex_id: str) -> Optional[Dict[str, Any]]:
    try:
        complexes = _headless_app_ctx.complex_service.get_all_complexes()
        for c in complexes:
            obj = c.dict()
            if obj.get("id") == complex_id:
                created_at = obj.get("created_at")
                updated_at = obj.get("updated_at")
                if created_at is not None:
                    obj["created_at"] = (
                        created_at.isoformat()
                        if hasattr(created_at, "isoformat")
                        else str(created_at)
                    )
                if updated_at is not None:
                    obj["updated_at"] = (
                        updated_at.isoformat()
                        if hasattr(updated_at, "isoformat")
                        else str(updated_at)
                    )
                obj = _enrich_complex_with_theory_link(obj)
                return obj
        return None
    except Exception as exc:
        logger.exception("[HTTP] Failed to resolve complex by id %s: %s", complex_id, exc)
        return None


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


@app.route("/ui/complexes", methods=["GET"])
def serve_complexes_ui() -> Any:
    """Serve the complexes list HTML UI (S0)."""
    if not COMPLEXES_UI_DIR.exists():
        logger.error("[HTTP] COMPLEXES_UI_DIR does not exist: %s", COMPLEXES_UI_DIR)
        return jsonify({"ok": False, "error": "complexes_ui_not_found"}), 500

    resp = send_from_directory(COMPLEXES_UI_DIR, "index.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@app.route("/ui/welcome", methods=["GET"])
def serve_welcome_ui() -> Any:
    """Serve the Welcome / onboarding screen."""
    if not WELCOME_UI_DIR.exists():
        logger.error("[HTTP] WELCOME_UI_DIR does not exist: %s", WELCOME_UI_DIR)
        return jsonify({"ok": False, "error": "welcome_ui_not_found"}), 500
    resp = send_from_directory(WELCOME_UI_DIR, "welcome.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@app.route("/Welcome/<path:filename>", methods=["GET"])
def serve_welcome_static(filename: str) -> Any:
    """Serve static files (JS/CSS) for the Welcome screen."""
    if not WELCOME_UI_DIR.exists():
        return jsonify({"ok": False, "error": "welcome_ui_not_found"}), 500
    return send_from_directory(WELCOME_UI_DIR, filename)


@app.route("/api/users/should-welcome", methods=["GET"])
def should_welcome() -> Any:
    """Determine whether the Welcome Screen should be shown and in which mode."""
    try:
        users = user_service.get_all_users()
        items = [u.to_api_dict() for u in users]

        if len(users) == 0:
            return jsonify(
                {
                    "ok": True,
                    "show_welcome": True,
                    "mode": "onboarding",
                    "profiles": [],
                }
            )

        if len(users) == 1:
            user = users[0]
            api_dict = user.to_api_dict()
            has_login_password = api_dict.get("has_password") and api_dict.get(
                "security_settings", {}
            ).get("require_password_on_login")
            if has_login_password:
                return jsonify(
                    {
                        "ok": True,
                        "show_welcome": True,
                        "mode": "login",
                        "profiles": [api_dict],
                    }
                )
            else:
                return jsonify(
                    {
                        "ok": True,
                        "show_welcome": False,
                        "auto_select_user_id": user.user_id,
                    }
                )

        return jsonify(
            {
                "ok": True,
                "show_welcome": True,
                "mode": "select",
                "profiles": items,
            }
        )
    except Exception as exc:
        logger.exception("[HTTP] should-welcome failed: %s", exc)
        return jsonify({"ok": False, "error": "should_welcome_failed"}), 500


@app.route("/api/legal/current", methods=["GET"])
def legal_current() -> Any:
    """Return current versions of legal documents."""
    try:
        manifest = _load_legal_manifest()
        return jsonify({"ok": True, "documents": manifest})
    except Exception as exc:
        logger.exception("[HTTP] Failed to load legal current manifest: %s", exc)
        return jsonify({"ok": False, "error": "legal_load_failed"}), 500


@app.route("/api/legal/document/<string:doc_type>", methods=["GET"])
def legal_document(doc_type: str) -> Any:
    """Return legal document content and metadata."""
    if doc_type not in ("terms", "privacy"):
        return jsonify({"ok": False, "error": "document_not_found"}), 404

    try:
        manifest = _load_legal_manifest()
        meta = manifest.get(doc_type) or {}
        path = _legal_doc_path(doc_type, manifest=manifest)
        if path is None or not path.exists():
            return jsonify({"ok": False, "error": "document_not_found"}), 404

        content = path.read_text(encoding="utf-8")
        return jsonify(
            {
                "ok": True,
                "document": {
                    "doc_type": doc_type,
                    "title": meta.get("title"),
                    "version": meta.get("version"),
                    "effective_at": meta.get("effective_at"),
                    "format": meta.get("format"),
                    "content": content,
                },
            }
        )
    except Exception as exc:
        logger.exception("[HTTP] Failed to load legal document %s: %s", doc_type, exc)
        return jsonify({"ok": False, "error": "document_load_failed"}), 500


@app.route("/api/consent/status", methods=["GET"])
def consent_status() -> Any:
    """Return current consent status for user (missing/outdated/up_to_date)."""
    try:
        user_id = request.args.get("user_id") or _headless_app_ctx.user_id
        if not user_id:
            return jsonify({"ok": False, "error": "user_id_required"}), 400
        user = user_service.get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        status = _get_consent_status(user_id)
        return jsonify({"ok": True, **status})
    except Exception as exc:
        logger.exception("[HTTP] Failed to load consent status: %s", exc)
        return jsonify({"ok": False, "error": "consent_status_failed"}), 500


@app.route("/api/consent/accept", methods=["POST"])
def consent_accept() -> Any:
    """Persist user consent for current legal versions."""
    try:
        payload = request.get_json(silent=True) or {}
        user_id = payload.get("user_id") or _headless_app_ctx.user_id
        if not user_id:
            return jsonify({"ok": False, "error": "user_id_required"}), 400
        user = user_service.get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        consent_payload = _extract_consent_payload(payload)
        validation = _validate_consent_payload(consent_payload)
        if not validation.get("ok"):
            body: Dict[str, Any] = {"ok": False, "error": validation.get("error")}
            if validation.get("error") == "version_mismatch":
                body["required"] = validation.get("required")
                body["provided"] = validation.get("provided")
            return jsonify(body), int(validation.get("status_code", 400))

        saved = _write_user_consent(
            user_id,
            consent_payload["terms_version"],
            consent_payload["privacy_version"],
            source=str(payload.get("source") or "user_action"),
        )
        return jsonify(
            {
                "ok": True,
                "consent_id": saved.get("consent_id"),
                "accepted_at": saved.get("accepted_at"),
            }
        )
    except Exception as exc:
        logger.exception("[HTTP] Failed to accept consent: %s", exc)
        return jsonify({"ok": False, "error": "consent_accept_failed"}), 500


@app.route("/api/network/status", methods=["GET"])
def network_status() -> Any:
    """Return connectivity info for offline-first UX hints."""
    try:
        internet_online = _get_cached_internet_connectivity(force=False)
        feedback_settings = _feedback_email_settings()
        feedback_missing = _validate_feedback_email_settings(
            feedback_settings, require_recipients=True
        )
        feedback_delivery_configured = (
            bool(feedback_settings.get("enabled")) and not feedback_missing
        )
        manifest_url = _update_manifest_url()
        updates_configured = bool(_env_bool("ACTRA_UPDATE_CHECK_ENABLED", True) and manifest_url)
        updates_requires_internet = (
            bool(updates_configured) and _manifest_url_requires_internet(manifest_url)
        )

        return jsonify(
            {
                "ok": True,
                "offline_first": True,
                "internet_online": internet_online,
                "feedback_delivery": {
                    "configured": feedback_delivery_configured,
                    "available_now": feedback_delivery_configured and internet_online,
                    "requires_internet": True,
                    "missing_config": feedback_missing,
                },
                "updates": {
                    "configured": updates_configured,
                    "available_now": updates_configured
                    and (internet_online or not updates_requires_internet),
                    "requires_internet": updates_requires_internet,
                },
            }
        )
    except Exception as exc:
        logger.exception("[HTTP] Failed to resolve network status: %s", exc)
        return jsonify({"ok": False, "error": "network_status_failed"}), 500


@app.route("/api/update/check", methods=["GET"])
def update_check() -> Any:
    """Check whether a newer app version is available."""
    try:
        force_raw = str(request.args.get("force") or "").strip().lower()
        force = force_raw in {"1", "true", "yes", "on"}
        result = _build_update_status(force=force)
        return jsonify({"ok": True, **result})
    except Exception as exc:
        logger.exception("[HTTP] Failed to check updates: %s", exc)
        return jsonify({"ok": False, "error": "update_check_failed"}), 500


@app.route("/api/feedback/options", methods=["GET"])
def feedback_options() -> Any:
    return jsonify(
        {"ok": True, "types": list(FEEDBACK_TYPES), "severity": list(FEEDBACK_SEVERITIES)}
    )


@app.route("/api/feedback/test-email", methods=["POST"])
def feedback_test_email() -> Any:
    """Send test email for feedback SMTP channel."""
    try:
        payload = request.get_json(silent=True) or {}
        to_email = str(payload.get("to_email") or "").strip() or None
        subject = str(payload.get("subject") or "").strip() or None
        body = str(payload.get("body") or "").strip() or None

        status = _send_feedback_test_email(to_email=to_email, subject=subject, body=body)
        if status.get("sent"):
            return jsonify({"ok": True, **status})

        reason = str(status.get("reason") or "send_failed")
        status_code = 400 if reason in {"disabled", "not_configured"} else 502
        return jsonify({"ok": False, **status}), status_code
    except Exception as exc:
        logger.exception("[HTTP] Failed to send feedback test email: %s", exc)
        return jsonify({"ok": False, "error": "feedback_test_email_failed"}), 500


@app.route("/api/feedback/retry-pending", methods=["POST"])
def feedback_retry_pending() -> Any:
    """Retry email delivery for previously queued feedback tickets."""
    try:
        payload = request.get_json(silent=True) or {}
        requested_limit = payload.get("limit", 5)
        try:
            limit = int(requested_limit)
        except Exception:
            limit = 5
        limit = max(1, min(limit, 50))

        summary = _retry_pending_feedback_notifications(limit=limit)
        return jsonify({"ok": True, **summary})
    except Exception as exc:
        logger.exception("[HTTP] Failed to retry pending feedback notifications: %s", exc)
        return jsonify({"ok": False, "error": "feedback_retry_failed"}), 500


@app.route("/api/feedback", methods=["POST"])
def feedback_submit() -> Any:
    """Submit feedback ticket from active/existing user."""
    try:
        payload = request.get_json(silent=True) or {}
        user_id = payload.get("user_id") or _headless_app_ctx.user_id
        if not user_id:
            return jsonify({"ok": False, "error": "user_id_required"}), 400
        user = user_service.get_user(user_id)
        if not user:
            return jsonify({"ok": False, "error": "user_not_found"}), 404

        ticket = _build_feedback_ticket(payload, user_id=user_id)
        _save_feedback_ticket(ticket)
        if _get_cached_internet_connectivity(force=False):
            email_status = _notify_feedback_via_email(ticket, user)
        else:
            email_status = {"sent": False, "reason": "offline"}
        _update_feedback_delivery_fields(ticket, email_status)
        _save_feedback_ticket(ticket)
        return (
            jsonify(
                {
                    "ok": True,
                    "ticket_id": ticket["ticket_id"],
                    "email_notification": email_status,
                }
            ),
            201,
        )
    except ValueError as ve:
        return jsonify({"ok": False, "error": str(ve)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to save feedback: %s", exc)
        return jsonify({"ok": False, "error": "feedback_submit_failed"}), 500


@app.route("/ui", methods=["GET"])
@app.route("/ui/main", methods=["GET"])
def serve_main_ui() -> Any:
    if not MAINSCREEN_UI_DIR.exists():
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


if FLASK_DEBUG_ENABLED:

    @app.route("/api/debug/ui-main", methods=["GET"])
    def debug_ui_main() -> Any:
        logger.debug(f"[DEBUG_UI_MAIN][pid={os.getpid()}] debug_ui_main endpoint called")
        main_path = MAINSCREEN_UI_DIR / "Main.html"
        result = {"ok": True, "pid": os.getpid(), "main": _file_debug_meta(main_path)}
        logger.debug(f"[DEBUG_UI_MAIN][pid={os.getpid()}] returning result: {result}")
        return result


@app.route("/ui/complexes/create", methods=["GET"])
def serve_complexes_create_ui() -> Any:
    if not COMPLEXES_UI_DIR.exists():
        logger.error("[HTTP] COMPLEXES_UI_DIR does not exist: %s", COMPLEXES_UI_DIR)
        return jsonify({"ok": False, "error": "complexes_ui_not_found"}), 500

    resp = send_from_directory(COMPLEXES_UI_DIR, "create.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@app.route("/ui/TestUI/<path:filename>", methods=["GET"])
def serve_testui_static(filename: str) -> Any:
    """Serve static JS/CSS/assets for the TestUI module used by S1.

    This allows paths like ../TestUI/TestUI.web.js in S1/index.html to be resolved
    as /ui/TestUI/TestUI.web.js.
    """
    if not TESTUI_DIR.exists():
        logger.error("[HTTP] TESTUI_DIR does not exist: %s", TESTUI_DIR)
        return jsonify({"ok": False, "error": "testui_not_found"}), 500

    return send_from_directory(TESTUI_DIR, filename)


@app.route("/ui/SequenceUI/<path:filename>", methods=["GET"])
def serve_sequenceui_static(filename: str) -> Any:
    if not SEQUENCEUI_DIR.exists():
        logger.error("[HTTP] SEQUENCEUI_DIR does not exist: %s", SEQUENCEUI_DIR)
        return jsonify({"ok": False, "error": "sequenceui_not_found"}), 500

    return send_from_directory(SEQUENCEUI_DIR, filename)


@app.route("/ui/ClickUI/<path:filename>", methods=["GET"])
def serve_clickui_static(filename: str) -> Any:
    if not CLICKUI_DIR.exists():
        logger.error("[HTTP] CLICKUI_DIR does not exist: %s", CLICKUI_DIR)
        return jsonify({"ok": False, "error": "clickui_not_found"}), 500

    return send_from_directory(CLICKUI_DIR, filename)


@app.route("/api/evaluation/messages", methods=["GET"])
def get_evaluation_messages() -> Any:
    """Return all evaluation messages for frontend usage."""
    from services.evaluation_messages import MESSAGES

    return jsonify(MESSAGES)


@app.route("/ui/DrawUI/<path:filename>", methods=["GET"])
def serve_drawui_static(filename: str) -> Any:
    if not DRAWUI_DIR.exists():
        logger.error("[HTTP] DRAWUI_DIR does not exist: %s", DRAWUI_DIR)
        return jsonify({"ok": False, "error": "drawui_not_found"}), 500

    return send_from_directory(DRAWUI_DIR, filename)


@app.route("/ui/OpenAnswerUI/<path:filename>", methods=["GET"])
def serve_openanswerui_static(filename: str) -> Any:
    if not OPENANSWERUI_DIR.exists():
        logger.error("[HTTP] OPENANSWERUI_DIR does not exist: %s", OPENANSWERUI_DIR)
        return jsonify({"ok": False, "error": "openanswerui_not_found"}), 500

    return send_from_directory(OPENANSWERUI_DIR, filename)


@app.route("/ui/MistakesUI/<path:filename>", methods=["GET"])
def serve_mistakesui_static(filename: str) -> Any:
    if not MISTAKESUI_DIR.exists():
        logger.error("[HTTP] MISTAKESUI_DIR does not exist: %s", MISTAKESUI_DIR)
        return jsonify({"ok": False, "error": "mistakesui_not_found"}), 500

    return send_from_directory(MISTAKESUI_DIR, filename)


@app.route("/ui/editor", methods=["GET"])
@app.route("/ui/editor/", methods=["GET"])
def serve_editor_dashboard() -> Any:
    """Serve the Editor Main Dashboard."""
    if not EDITOR_UI_DIR.exists():
        logger.error("[HTTP] EDITOR_UI_DIR does not exist: %s", EDITOR_UI_DIR)
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500

    resp = send_from_directory(EDITOR_UI_DIR, "Main_Dashboard.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@app.route("/ui/editor/<path:filename>", methods=["GET"])
def serve_editor_file(filename: str) -> Any:
    """Serve any file (HTML, CSS, JS) from the Editor directory."""
    if not EDITOR_UI_DIR.exists():
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500

    return send_from_directory(EDITOR_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Calendar UI Routes
# ---------------------------------------------------------------------------


@app.route("/ui/calendar.css", methods=["GET"])
def serve_calendar_css_direct() -> Any:
    """Serve calendar.css specifically."""
    if not CALENDAR_UI_DIR.exists():
        return jsonify({"ok": False, "error": "calendar_ui_not_found"}), 500
    return send_from_directory(CALENDAR_UI_DIR, "calendar.css")


@app.route("/ui/calendar", methods=["GET"])
@app.route("/ui/calendar/", methods=["GET"])
def serve_calendar_ui() -> Any:
    """Serve the Calendar page."""
    if not CALENDAR_UI_DIR.exists():
        logger.error("[HTTP] CALENDAR_UI_DIR does not exist: %s", CALENDAR_UI_DIR)
        return jsonify({"ok": False, "error": "calendar_ui_not_found"}), 500

    resp = send_from_directory(CALENDAR_UI_DIR, "calendar.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@app.route("/ui/calendar/<path:filename>", methods=["GET"])
def serve_calendar_file(filename: str) -> Any:
    """Serve Calendar static files (CSS, JS)."""
    if not CALENDAR_UI_DIR.exists():
        return jsonify({"ok": False, "error": "calendar_ui_not_found"}), 500
    return send_from_directory(CALENDAR_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Statistics UI Routes
# ---------------------------------------------------------------------------


@app.route("/ui/statistics", methods=["GET"])
@app.route("/ui/statistics/", methods=["GET"])
def serve_statistics_ui() -> Any:
    """Serve the Statistics page."""
    if not STATISTICS_UI_DIR.exists():
        logger.error("[HTTP] STATISTICS_UI_DIR does not exist: %s", STATISTICS_UI_DIR)
        return jsonify({"ok": False, "error": "statistics_ui_not_found"}), 500

    resp = send_from_directory(STATISTICS_UI_DIR, "statistics.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@app.route("/ui/statistics/<path:filename>", methods=["GET"])
def serve_statistics_file(filename: str) -> Any:
    """Serve Statistics static files (CSS, JS)."""
    if not STATISTICS_UI_DIR.exists():
        return jsonify({"ok": False, "error": "statistics_ui_not_found"}), 500
    return send_from_directory(STATISTICS_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Microcards Runtime UI Routes (M10)
# ---------------------------------------------------------------------------


@app.route("/ui/microcards", methods=["GET"])
@app.route("/ui/microcards/", methods=["GET"])
def serve_microcards_ui() -> Any:
    """Serve the Microcards runtime review page (M10)."""
    if not MICROCARDS_UI_DIR.exists():
        logger.error("[HTTP] MICROCARDS_UI_DIR does not exist: %s", MICROCARDS_UI_DIR)
        return jsonify({"ok": False, "error": "microcards_ui_not_found"}), 500

    resp = send_from_directory(MICROCARDS_UI_DIR, "microcards.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@app.route("/ui/microcards/<path:filename>", methods=["GET"])
def serve_microcards_file(filename: str) -> Any:
    """Serve Microcards static files (CSS, JS)."""
    if not MICROCARDS_UI_DIR.exists():
        return jsonify({"ok": False, "error": "microcards_ui_not_found"}), 500
    return send_from_directory(MICROCARDS_UI_DIR, filename)


@app.route("/assets/<path:filename>", methods=["GET"])
def serve_assets(filename: str) -> Any:
    """Serve global static assets (CSS, fonts)."""
    if not ASSETS_DIR.exists():
        logger.error("[HTTP] ASSETS_DIR does not exist: %s", ASSETS_DIR)
        return jsonify({"ok": False, "error": "assets_dir_not_found"}), 500
    return send_from_directory(ASSETS_DIR, filename)


@app.route("/ui/assets/<path:filename>", methods=["GET"])
def serve_ui_assets(filename: str) -> Any:
    """Serve global static assets via /ui/assets for relative links."""
    if not ASSETS_DIR.exists():
        logger.error("[HTTP] ASSETS_DIR does not exist: %s", ASSETS_DIR)
        return jsonify({"ok": False, "error": "assets_dir_not_found"}), 500
    return send_from_directory(ASSETS_DIR, filename)


@app.route("/favicon.ico")
def favicon() -> Any:
    return "", 204


# ---------------------------------------------------------------------------
# Calendar API Routes — registered via create_calendar_routes() in calendar_api.py.
# Do NOT add standalone calendar routes here to avoid duplicate registration.
# ---------------------------------------------------------------------------


@app.route("/api/editor/catalog", methods=["GET"])
def get_editor_catalog() -> Any:
    """Return the full module/topic/task hierarchy for the editor."""
    try:
        modules = _headless_app_ctx.storage_service.load_modules()
        return jsonify({"ok": True, "modules": modules})
    except Exception as exc:
        logger.exception("[HTTP] Failed to get editor catalog: %s", exc)
        return jsonify({"ok": False, "error": "catalog_load_failed"}), 500


@app.route("/api/editor/task/<module_id>/<topic_id>/<task_id>", methods=["GET"])
def get_editor_task(module_id: str, topic_id: str, task_id: str) -> Any:
    """Load full task data for editing."""
    try:
        data = _headless_app_ctx.storage_service.load_task(module_id, topic_id, task_id)
        if not data:
            return jsonify({"ok": False, "error": "task_not_found"}), 404
        return jsonify({"ok": True, "task": data})
    except Exception as exc:
        logger.exception("[HTTP] Failed to load editor task: %s", exc)
        return jsonify({"ok": False, "error": "task_load_failed"}), 500


@app.route("/api/editor/task/<module_id>/<topic_id>/<task_id>", methods=["POST"])
def save_editor_task(module_id: str, topic_id: str, task_id: str) -> Any:
    """Save updated task data from the editor."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.json
        if not payload:
            return jsonify({"ok": False, "error": "payload_required"}), 400

        success = _headless_app_ctx.storage_service.save_task(
            module_id, topic_id, task_id, payload, validate=True
        )

        if success:
            return jsonify({"ok": True})
        else:
            return jsonify({"ok": False, "error": "save_failed"}), 500

    except Exception as exc:
        logger.exception("[HTTP] Failed to save editor task: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/editor/task/<module_id>/<topic_id>/<task_id>", methods=["DELETE"])
def delete_editor_task(module_id: str, topic_id: str, task_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        success = _headless_app_ctx.storage_service.delete_task(module_id, topic_id, task_id)
        if success:
            return jsonify({"ok": True})
        else:
            return (
                jsonify({"ok": False, "error": "delete_failed"}),
                500,
            )  # or 404 handled inside service logs

    except Exception as exc:
        logger.exception("[HTTP] Failed to delete editor task: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# _ensure_task_registered removed (logic moved to StorageService)


# ---------------------------------------------------------------------------
# Import / Export API
# ---------------------------------------------------------------------------


@app.route("/api/editor/export/tasks", methods=["POST"])
def export_tasks() -> Any:
    """Export selected tasks to a ZIP archive."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_export"}), 403
    svc = _headless_app_ctx.import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        payload = request.get_json(silent=True) or {}
        tasks = payload.get("tasks", [])

        if not tasks:
            return jsonify({"ok": False, "error": "tasks_required"}), 400

        zip_path = svc.create_export_archive(tasks)
        filename = f"export_tasks_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"

        @after_this_request
        def remove_file(response):
            try:
                if os.path.exists(zip_path):
                    os.remove(zip_path)
            except Exception:
                pass
            return response

        return send_file(
            zip_path, as_attachment=True, download_name=filename, mimetype="application/zip"
        )
    except Exception as exc:
        logger.exception("[HTTP] Export failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/editor/export/bulk", methods=["POST"])
def export_bulk() -> Any:
    """Export all tasks from a module or topic as ZIP."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_export"}), 403
    svc = _headless_app_ctx.import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        payload = request.get_json(silent=True) or {}
        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")  # optional — if omitted, export whole module

        if not module_id:
            return jsonify({"ok": False, "error": "module_id_required"}), 400

        storage = _headless_app_ctx.storage_service
        tasks_to_export = []

        modules = storage.load_modules()
        for mod in modules:
            if mod["id"] != module_id:
                continue
            for topic in mod.get("topics", []):
                if topic_id and topic["id"] != topic_id:
                    continue
                for task in topic.get("tasks", []):
                    tasks_to_export.append(
                        {
                            "module_id": module_id,
                            "topic_id": topic["id"],
                            "task_id": task["id"],
                        }
                    )

        if not tasks_to_export:
            return jsonify({"ok": False, "error": "no_tasks_found"}), 404

        zip_path = svc.create_export_archive(tasks_to_export)
        scope = topic_id or module_id
        filename = f"export_{scope}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"

        @after_this_request
        def remove_file(response):
            try:
                if os.path.exists(zip_path):
                    os.remove(zip_path)
            except Exception:
                pass
            return response

        return send_file(
            zip_path, as_attachment=True, download_name=filename, mimetype="application/zip"
        )
    except Exception as exc:
        logger.exception("[HTTP] Bulk export failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


# Cache for uploaded archives between check/confirm (avoids double upload)
_import_archive_cache: Dict[str, tuple] = {}  # cache_id -> (temp_path, timestamp)
_IMPORT_CACHE_MAX_AGE = 600  # 10 minutes
_IMPORT_CACHE_MAX_SIZE = 10  # max simultaneous cached archives


def _cleanup_import_cache():
    """Remove expired cache entries and enforce size limit."""
    now = time.time()
    expired = [
        k for k, (p, ts) in _import_archive_cache.items() if now - ts > _IMPORT_CACHE_MAX_AGE
    ]
    for k in expired:
        p, _ = _import_archive_cache.pop(k, (None, 0))
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass
    # Evict oldest if over size limit
    while len(_import_archive_cache) >= _IMPORT_CACHE_MAX_SIZE:
        oldest_key = min(_import_archive_cache, key=lambda k: _import_archive_cache[k][1])
        p, _ = _import_archive_cache.pop(oldest_key, (None, 0))
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass


@app.route("/api/editor/import/check", methods=["POST"])
def import_check() -> Any:
    """Validate archive before import. Caches archive for subsequent confirm."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403
    svc = _headless_app_ctx.import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        _cleanup_import_cache()

        if "file" not in request.files:
            return jsonify({"ok": False, "error": "file_required"}), 400

        file = request.files["file"]
        if not file or file.filename == "":
            return jsonify({"ok": False, "error": "no_selected_file"}), 400

        # Save temp
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        temp_path = tmp.name
        tmp.close()
        file.save(temp_path)

        report = svc.validate_import_archive(temp_path)

        # Cache the archive for confirm step
        import uuid as _uuid

        cache_id = _uuid.uuid4().hex
        _import_archive_cache[cache_id] = (temp_path, time.time())

        if isinstance(report, dict):
            report["cache_id"] = cache_id

        return jsonify(report)

    except Exception as exc:
        logger.exception("[HTTP] Import check failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/editor/import/confirm", methods=["POST"])
def import_confirm() -> Any:
    """Execute import with progress streaming."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403
    svc = _headless_app_ctx.import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        # Parse per-task conflict overrides (index -> resolution)
        per_task_conflict = {}
        try:
            raw_ptc = request.form.get("per_task_conflict", "")
            if raw_ptc:
                per_task_conflict = json.loads(raw_ptc)
        except (json.JSONDecodeError, TypeError):
            pass

        params = {
            "conflict_resolution": request.form.get("conflict_resolution", "skip"),
            "target_module_id": request.form.get("target_module_id"),
            "target_topic_id": request.form.get("target_topic_id"),
            "skip_errors": request.form.get("skip_errors") == "true",
            "per_task_conflict": per_task_conflict,
        }

        temp_path = None
        cached = False

        # Try to use cached archive from check step
        cache_id = request.form.get("cache_id", "")
        if cache_id and cache_id in _import_archive_cache:
            temp_path, _ = _import_archive_cache.pop(cache_id)
            cached = True

        # Fall back to file upload
        if not temp_path or not os.path.exists(temp_path):
            if "file" not in request.files:
                return jsonify({"ok": False, "error": "file_required"}), 400
            file = request.files["file"]
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
            temp_path = tmp.name
            tmp.close()
            file.save(temp_path)

        q = queue.Queue()

        def worker():
            try:

                def progress(curr, total, status):
                    q.put({"type": "progress", "current": curr, "total": total, "status": status})

                res = svc.import_tasks_atomic(temp_path, params, progress_callback=progress)
                q.put({"type": "result", "data": res})
            except Exception as e:
                logger.exception("Import worker failed")
                q.put({"type": "error", "error": str(e)})
            finally:
                q.put(None)  # Sentinel

        threading.Thread(target=worker, daemon=True).start()

        def generator():
            try:
                while True:
                    item = q.get()
                    if item is None:
                        break
                    yield json.dumps(item) + "\n"
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except Exception:
                        pass

        return Response(stream_with_context(generator()), mimetype="application/x-ndjson")

    except Exception as exc:
        logger.exception("[HTTP] Import confirm setup failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


# Cache for complex import archives
_complex_import_archive_cache: Dict[str, tuple] = {}  # cache_id -> (temp_path, timestamp)
_COMPLEX_IMPORT_CACHE_MAX_AGE = 600
_COMPLEX_IMPORT_CACHE_MAX_SIZE = 10


def _cleanup_complex_import_cache():
    now = time.time()
    expired = [
        k
        for k, (p, ts) in _complex_import_archive_cache.items()
        if now - ts > _COMPLEX_IMPORT_CACHE_MAX_AGE
    ]
    for k in expired:
        p, _ = _complex_import_archive_cache.pop(k, (None, 0))
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass
    while len(_complex_import_archive_cache) >= _COMPLEX_IMPORT_CACHE_MAX_SIZE:
        oldest_key = min(
            _complex_import_archive_cache, key=lambda k: _complex_import_archive_cache[k][1]
        )
        p, _ = _complex_import_archive_cache.pop(oldest_key, (None, 0))
        if p and os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass


@app.route("/api/complexes/export", methods=["POST"])
def export_complexes_bundle() -> Any:
    """Export selected complexes (with dependencies) to a package archive."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_export"}), 403
    svc = _headless_app_ctx.complex_import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        payload = request.get_json(silent=True) or {}
        complex_ids = payload.get("complex_ids")
        if not isinstance(complex_ids, list):
            single_id = payload.get("complex_id")
            complex_ids = [single_id] if isinstance(single_id, str) and single_id.strip() else []
        complex_ids = [
            str(cid).strip() for cid in complex_ids if isinstance(cid, str) and str(cid).strip()
        ]
        if not complex_ids:
            return jsonify({"ok": False, "error": "complex_ids_required"}), 400

        options = {
            "include_tasks": payload.get("include_tasks", True),
            "include_theories": payload.get("include_theories", True),
        }
        zip_path = svc.create_export_archive(complex_ids, options=options)
        filename = f"export_complexes_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"

        @after_this_request
        def remove_file(response):
            try:
                if os.path.exists(zip_path):
                    os.remove(zip_path)
            except Exception:
                pass
            return response

        return send_file(
            zip_path,
            as_attachment=True,
            download_name=filename,
            mimetype="application/zip",
        )
    except Exception as exc:
        logger.exception("[HTTP] Complex export failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/complexes/import/check", methods=["POST"])
def import_complexes_check() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403
    svc = _headless_app_ctx.complex_import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        _cleanup_complex_import_cache()

        if "file" not in request.files:
            return jsonify({"ok": False, "error": "file_required"}), 400
        file = request.files["file"]
        if not file or file.filename == "":
            return jsonify({"ok": False, "error": "no_selected_file"}), 400

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        temp_path = tmp.name
        tmp.close()
        file.save(temp_path)

        report = svc.validate_import_archive(temp_path)
        cache_id = _uuid.uuid4().hex
        _complex_import_archive_cache[cache_id] = (temp_path, time.time())
        if isinstance(report, dict):
            report["cache_id"] = cache_id
        return jsonify(report)
    except Exception as exc:
        logger.exception("[HTTP] Complex import check failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/complexes/import/confirm", methods=["POST"])
def import_complexes_confirm() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403
    svc = _headless_app_ctx.complex_import_export_service
    if not svc:
        return jsonify({"ok": False, "error": "service_not_available"}), 503

    try:
        params = {
            "complex_conflict_resolution": request.form.get(
                "complex_conflict_resolution", "new_id"
            ),
            "task_conflict_resolution": request.form.get("task_conflict_resolution", "skip"),
            "theory_conflict_resolution": request.form.get(
                "theory_conflict_resolution",
                "reuse_if_same_hash",
            ),
            "skip_errors": request.form.get("skip_errors") == "true",
            "atomic_mode": request.form.get("atomic_mode", "bundle"),
        }

        temp_path = None
        cache_id = request.form.get("cache_id", "")
        if cache_id and cache_id in _complex_import_archive_cache:
            temp_path, _ = _complex_import_archive_cache.pop(cache_id)

        if not temp_path or not os.path.exists(temp_path):
            if "file" not in request.files:
                return jsonify({"ok": False, "error": "file_required"}), 400
            file = request.files["file"]
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
            temp_path = tmp.name
            tmp.close()
            file.save(temp_path)

        q = queue.Queue()

        def worker():
            try:

                def progress(curr, total, status):
                    q.put({"type": "progress", "current": curr, "total": total, "status": status})

                res = svc.import_complexes_atomic(temp_path, params, progress_callback=progress)
                q.put({"type": "result", "data": res})
            except Exception as e:
                logger.exception("Complex import worker failed")
                q.put({"type": "error", "error": str(e)})
            finally:
                q.put(None)

        threading.Thread(target=worker, daemon=True).start()

        def generator():
            try:
                while True:
                    item = q.get()
                    if item is None:
                        break
                    yield json.dumps(item) + "\n"
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except Exception:
                        pass

        return Response(stream_with_context(generator()), mimetype="application/x-ndjson")

    except Exception as exc:
        logger.exception("[HTTP] Complex import confirm setup failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/editor/test/import", methods=["POST"])
def import_test_from_file() -> Any:
    """Import test questions using TestFileParser."""
    temp_path = None
    try:
        if "file" not in request.files:
            return jsonify({"ok": False, "error": "file_required"}), 400

        file = request.files["file"]
        if not file or file.filename == "":
            return jsonify({"ok": False, "error": "no_selected_file"}), 400

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix or ".txt")
        temp_path = tmp.name
        file.save(temp_path)
        tmp.close()

        parser = TestFileParser()
        test_task = parser.create_test_from_file(temp_path)
        content = test_task.to_dict()
        return jsonify({"ok": True, "content": content})
    except Exception as exc:
        logger.exception("[HTTP] Failed to import test: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


@app.route("/api/editor/test/export", methods=["POST"])
def export_test_to_file() -> Any:
    """Export provided test content to a text file."""
    try:
        payload = request.json
        if not payload:
            return jsonify({"ok": False, "error": "payload_required"}), 400

        test_data = {
            "type": "test",
            "test_type": payload.get("test_type", "multiple_choice"),
            "questions": payload.get("questions", []),
            "settings": payload.get("settings", {}),
        }

        test_task = TestTask(test_data)
        parser = TestFileParser()

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".txt", mode="w", encoding="utf-8")
        temp_path = tmp.name
        tmp.close()

        parser.export_test_to_file(test_task, temp_path)

        filename = payload.get("filename") or f"test_{int(time.time())}.txt"

        @after_this_request
        def remove_file(response):
            try:
                os.remove(temp_path)
            except Exception:
                pass
            return response

        return send_file(
            temp_path,
            as_attachment=True,
            download_name=secure_filename(filename),
            mimetype="text/plain",
        )
    except Exception as exc:
        logger.exception("[HTTP] Failed to export test: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/editor/logs/scale", methods=["POST"])
def save_editor_scale_log() -> Any:
    """Persist ClickEditor scale/zoom log to file for debugging."""
    try:
        payload = request.json
        if not payload:
            return jsonify({"ok": False, "error": "payload_required"}), 400

        module_id = payload.get("module") or "unknown_module"
        topic_id = payload.get("topic") or "unknown_topic"
        task_id = payload.get("task") or "unknown_task"
        entries = payload.get("entries") or []
        meta = payload.get("meta") or {}

        if not isinstance(entries, list) or not entries:
            return jsonify({"ok": False, "error": "entries_required"}), 400

        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        safe_module = secure_filename(str(module_id))
        safe_topic = secure_filename(str(topic_id))
        safe_task = secure_filename(str(task_id))
        filename = f"{safe_module}_{safe_topic}_{safe_task}_{timestamp}.json"
        file_path = EDITOR_SCALE_LOG_DIR / filename

        payload_to_save = {
            "module": module_id,
            "topic": topic_id,
            "task": task_id,
            "meta": meta,
            "entries": entries,
            "labelMode": payload.get("labelMode"),
            "image": payload.get("image"),
        }

        with open(file_path, "w", encoding="utf-8") as fh:
            json.dump(payload_to_save, fh, ensure_ascii=False, indent=2)

        logger.info("[HTTP] Saved editor scale log %s", file_path)
        return jsonify({"ok": True, "path": str(file_path.relative_to(PROJECT_ROOT))})
    except Exception as exc:
        logger.exception("[HTTP] Failed to save editor scale log: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/editor/task/new", methods=["POST"])
def create_editor_task() -> Any:
    """Create a new task with initial data."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.json
        if not payload:
            return jsonify({"ok": False, "error": "payload_required"}), 400

        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")
        task_name = payload.get("task_name")
        task_type = payload.get("task_type")

        if not all([module_id, topic_id, task_name, task_type]):
            return jsonify({"ok": False, "error": "missing_required_fields"}), 400

        task_id = _headless_app_ctx.storage_service.create_task(
            module_id, topic_id, task_name, task_type
        )

        if task_id:
            return jsonify({"ok": True, "task_id": task_id})
        else:
            return jsonify({"ok": False, "error": "create_failed"}), 500

    except Exception as exc:
        logger.exception("[HTTP] Failed to create editor task: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/editor/module/new", methods=["POST"])
def create_editor_module() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.json
        name = payload.get("name")
        if not name:
            return jsonify({"ok": False, "error": "name_required"}), 400

        module_id = _make_safe_id(name)
        if not module_id:
            return jsonify({"ok": False, "error": "invalid_module_name"}), 400
        module_dir = _headless_app_ctx.storage_service.modules_dir / module_id
        module_dir.mkdir(parents=True, exist_ok=True)

        with open(module_dir / "module.json", "w", encoding="utf-8") as f:
            json.dump(
                {"id": module_id, "name": name, "topics": []}, f, indent=2, ensure_ascii=False
            )

        _headless_app_ctx.storage_service.reload_modules()
        return jsonify({"ok": True, "module_id": module_id})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/editor/topic/new", methods=["POST"])
def create_editor_topic() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.json
        module_id = payload.get("module_id")
        name = payload.get("name")
        if not all([module_id, name]):
            return jsonify({"ok": False, "error": "missing_params"}), 400

        topic_id = _make_safe_id(name)
        if not topic_id:
            return jsonify({"ok": False, "error": "invalid_topic_name"}), 400
        topic_dir = _headless_app_ctx.storage_service.modules_dir / module_id / "topics" / topic_id
        topic_dir.mkdir(parents=True, exist_ok=True)
        (topic_dir / "tasks").mkdir(exist_ok=True)

        with open(topic_dir / "topic.json", "w", encoding="utf-8") as f:
            json.dump({"id": topic_id, "name": name, "tasks": []}, f, indent=2, ensure_ascii=False)

        _headless_app_ctx.storage_service.reload_modules()
        return jsonify({"ok": True, "topic_id": topic_id})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


def _resolve_task_dir(module_id: str, topic_id: str, task_id: str) -> Path:
    return (
        _headless_app_ctx.storage_service.modules_dir
        / module_id
        / "topics"
        / topic_id
        / "tasks"
        / task_id
    )


# _copy_editor_images removed (logic moved to StorageService)


@app.route("/api/editor/upload-image", methods=["POST"])
def upload_editor_image() -> Any:
    """Upload image for a specific task and return its relative path."""
    try:
        module_id = request.form.get("module")
        topic_id = request.form.get("topic")
        task_id = request.form.get("task")

        if not all([module_id, topic_id, task_id]):
            return jsonify({"ok": False, "error": "missing_params"}), 400

        if "file" not in request.files:
            return jsonify({"ok": False, "error": "file_required"}), 400

        file = request.files["file"]
        if file.filename == "":
            return jsonify({"ok": False, "error": "no_selected_file"}), 400

        filename = secure_filename(file.filename)

        task_dir = _resolve_task_dir(module_id, topic_id, task_id)
        images_dir = task_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)

        file_path = images_dir / filename
        counter = 1
        while file_path.exists():
            stem = Path(filename).stem
            suffix = Path(filename).suffix
            file_path = images_dir / f"{stem}_{counter:02d}{suffix}"
            counter += 1

        file.save(str(file_path))
        relative_path = os.path.relpath(file_path, _headless_app_ctx.data_dir).replace("\\", "/")

        logger.info("[HTTP] Image uploaded for task %s: %s", task_id, relative_path)
        return jsonify({"ok": True, "path": relative_path})

    except Exception as exc:
        logger.exception("[HTTP] Failed to upload image: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/editor/image", methods=["GET"])
def serve_editor_image() -> Any:
    """Special endpoint for editor to serve images from any module path."""
    if FLASK_DEBUG_ENABLED:
        logger.debug(
            "[HTTP] serve_editor_image invoked logger=%s level=%s enabled=%s propagate=%s handlers=%s",
            logger.name,
            logger.level,
            logger.isEnabledFor(logging.DEBUG),
            logger.propagate,
            logger.handlers,
        )
    module_id = request.args.get("module")
    topic_id = request.args.get("topic")
    task_id = request.args.get("task")
    path = request.args.get("path")
    editor_logger.info(
        "REQUEST /api/editor/image path=%s module=%s topic=%s task=%s",
        path,
        module_id,
        topic_id,
        task_id,
    )
    if not path:
        logger.warning("[HTTP] /api/editor/image without 'path' parameter")
        editor_logger.warning(
            "MISSING_PATH /api/editor/image module=%s topic=%s task=%s",
            module_id,
            topic_id,
            task_id,
        )
        return jsonify({"ok": False, "error": "path_required"}), 400

    target = _resolve_editor_image_path(
        path,
        module_id=module_id,
        topic_id=topic_id,
        task_id=task_id,
    )
    if not target:
        logger.warning(
            "[HTTP] /api/editor/image not found path=%s data_dir=%s",
            path,
            _headless_app_ctx.data_dir,
        )
        editor_logger.warning(
            "NOT_FOUND /api/editor/image path=%s module=%s topic=%s task=%s",
            path,
            module_id,
            topic_id,
            task_id,
        )
        return jsonify({"ok": False, "error": "image_not_found"}), 404

    logger.info("[HTTP] /api/editor/image serving %s", target)
    editor_logger.info(
        "SERVING /api/editor/image path=%s module=%s topic=%s task=%s resolved=%s",
        path,
        module_id,
        topic_id,
        task_id,
        target,
    )
    resp = send_file(str(target))
    resp.headers["Cache-Control"] = "private, max-age=3600"
    return resp


@app.route("/ui/session/<string:session_id>", methods=["GET"])
def serve_session_ui(session_id: str) -> Any:
    """Serve the S1 HTML UI for a given session.

    The page itself reads sessionId from the URL (path or query),
    so here we only need to return index.html.
    """
    if not S1_UI_DIR.exists():
        logger.error("[HTTP] S1_UI_DIR does not exist: %s", S1_UI_DIR)
        return jsonify({"ok": False, "error": "s1_ui_not_found"}), 500

    # index.html reads sessionId from URL (last path segment or ?sessionId=)
    return send_from_directory(S1_UI_DIR, "index.html")


@app.route("/ui/S1/<path:filename>", methods=["GET"])
def serve_session_static(filename: str) -> Any:
    """Serve static assets for S1 (JS/CSS)."""
    if not S1_UI_DIR.exists():
        logger.error("[HTTP] S1_UI_DIR does not exist: %s", S1_UI_DIR)
        return jsonify({"ok": False, "error": "s1_ui_not_found"}), 500
    target = S1_UI_DIR / filename
    if not target.exists():
        logger.warning("[HTTP] S1 static not found: %s", target)
        return jsonify({"ok": False, "error": "file_not_found"}), 404
    return send_from_directory(S1_UI_DIR, filename)


@app.route("/ui/session/<string:session_id>/iteration/<string:iteration_id>", methods=["GET"])
def serve_iteration_results_ui(session_id: str, iteration_id: str) -> Any:
    """Serve the S2 HTML UI for iteration results.

    The page reads session/iteration from the URL, here только отдаём index.html.
    """
    if not S2_UI_DIR.exists():
        logger.error("[HTTP] S2_UI_DIR does not exist: %s", S2_UI_DIR)
        return jsonify({"ok": False, "error": "s2_ui_not_found"}), 500

    return send_from_directory(S2_UI_DIR, "index.html")


@app.route("/ui/session/<string:session_id>/results", methods=["GET"])
def serve_session_results_ui(session_id: str) -> Any:
    """Serve the S3 HTML UI for final session results."""
    if not S3_UI_DIR.exists():
        logger.error("[HTTP] S3_UI_DIR does not exist: %s", S3_UI_DIR)
        return jsonify({"ok": False, "error": "s3_ui_not_found"}), 500

    return send_from_directory(S3_UI_DIR, "index.html")


@app.route(
    "/api/session/<string:complex_id>/start", methods=["POST"], endpoint="start_complex_session"
)
def start_complex_session(complex_id: str) -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = payload.get("user_id") or _headless_app_ctx.user_id
    start_iteration = payload.get("start_iteration", 1)
    force = payload.get("force", False)

    # MISSING-3 fix: проверяем наличие паузированной сессии для этого комплекса
    if not force:
        try:
            sm = getattr(session_api, "_session_manager", None)
            repo = sm.session_repository if sm is not None else None
            if repo is not None:
                existing = repo.load_session(complex_id, user_id)
                if (
                    existing
                    and getattr(existing, "is_active", False)
                    and getattr(existing, "paused", False)
                ):
                    return (
                        jsonify(
                            {
                                "ok": False,
                                "error": "paused_session_exists",
                                "session_id": existing.id,
                                "paused_at": _json_safe(getattr(existing, "paused_at", None)),
                            }
                        ),
                        409,
                    )
        except Exception:
            logger.warning(
                "[HTTP] Failed to check for existing paused session for complex %s",
                complex_id,
                exc_info=True,
            )

    data = session_api.start_session(
        complex_id=complex_id, user_id=user_id, start_iteration=start_iteration
    )
    status = 200 if data.get("ok") else 400
    return jsonify(data), status


@app.route("/api/ui/quick-access", methods=["GET"])
def get_quick_access() -> Any:
    user_id = request.args.get("user_id") or _headless_app_ctx.user_id
    state = _read_ui_state(user_id)

    pinned = [x for x in state.get("pinned", []) if isinstance(x, str)]
    recent = [x for x in state.get("recent", []) if isinstance(x, str)]

    paused_sessions_by_complex: Dict[str, Dict[str, Any]] = {}
    try:
        sm = getattr(session_api, "_session_manager", None)
        repo = sm.session_repository if sm is not None else None
        if repo is not None:
            sessions_meta = repo.list_active_sessions(user_id)
            for meta in sessions_meta:
                session_id = meta.get("session_id")
                if not session_id:
                    continue

                loaded = repo.load_session_by_session_id(user_id=user_id, session_id=session_id)
                if not loaded:
                    continue
                if not getattr(loaded, "is_active", True):
                    continue
                if not getattr(loaded, "paused", False):
                    continue

                complex_id = getattr(loaded, "complex_id", None)
                if not complex_id:
                    continue

                paused_at = getattr(loaded, "paused_at", None)
                start_time = getattr(loaded, "start_time", None)
                end_time = getattr(loaded, "end_time", None)
                ts_candidates = [
                    dt.timestamp()
                    for dt in (paused_at, end_time, start_time)
                    if hasattr(dt, "timestamp")
                ]
                sort_ts = max(ts_candidates) if ts_candidates else 0.0

                payload = {
                    "session_id": loaded.id,
                    "complex_id": complex_id,
                    "paused": True,
                    "paused_at": _json_safe(paused_at),
                    "start_time": _json_safe(start_time),
                    "iteration": getattr(loaded, "iteration", None),
                    "current_task_index": getattr(loaded, "current_task_index", None),
                    "total_tasks": len(getattr(loaded, "queue", []) or []),
                    "_sort_ts": sort_ts,
                }

                prev = paused_sessions_by_complex.get(complex_id)
                if prev is None or payload["_sort_ts"] >= prev.get("_sort_ts", 0):
                    paused_sessions_by_complex[complex_id] = payload
    except Exception:
        pass

    seen = set()
    ordered_ids = []
    paused_ids = sorted(
        paused_sessions_by_complex.keys(),
        key=lambda cid: paused_sessions_by_complex.get(cid, {}).get("_sort_ts", 0),
        reverse=True,
    )
    for cid in paused_ids + pinned + recent:
        if cid in seen:
            continue
        seen.add(cid)
        ordered_ids.append(cid)

    # Fetch stats and health (safe fallback if services missing)
    complex_stats_map = {}
    try:
        stats_dict = _headless_app_ctx.statistics_service.get_complex_statistics(user_id)
        if isinstance(stats_dict, dict):
            complex_stats_map = stats_dict
    except Exception:
        pass

    health_map = {}
    try:
        if calendar_service:
            # calendar_service methods usually return objects, not dicts, but let's check
            # get_health_summary uses _build_health_summary which returns an object that has to_dict()
            # We need a way to get health per complex.
            # Use internal helper or just get the summary and parse
            all_p = calendar_service._get_all_progress(user_id)
            for item in all_p:
                # item is CalendarProgressRow
                health_map[item.complex_id] = {
                    "health_percent": item.health_percent,
                    "status": (
                        item.status.value if hasattr(item.status, "value") else str(item.status)
                    ),
                    "is_critical": item.is_critical,
                    "days_since_last": (
                        (date.today() - item.last_practice_date).days
                        if item.last_practice_date
                        else None
                    ),
                }
    except Exception:
        pass

    items = []
    for cid in ordered_ids:
        cobj = _get_complex_by_id(cid)
        if not cobj:
            continue

        # Merge stats
        c_stats = complex_stats_map.get(cid, {})
        c_aggregated = c_stats.get("aggregated", {}) if isinstance(c_stats, dict) else {}
        c_health = health_map.get(cid, {})

        paused_info = paused_sessions_by_complex.get(cid)
        if paused_info:
            paused_info = {k: v for k, v in paused_info.items() if k != "_sort_ts"}

        items.append(
            {
                "complex": cobj,
                "is_pinned": cid in pinned,
                "is_recent": cid in recent,
                "stats": {
                    "progress": c_aggregated.get("success_rate", 0),
                    "solved": c_aggregated.get("wins", 0),
                    "total": c_aggregated.get("attempts", 0),
                },
                "health": c_health,
                "paused_session": paused_info,
            }
        )

    return jsonify(
        {
            "ok": True,
            "items": items,
            "pinned": pinned,
            "recent": recent,
            "paused_complex_ids": paused_ids,
        }
    )


@app.route("/api/ui/quick-access/pin", methods=["POST"])
def pin_quick_access() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = payload.get("user_id") or _headless_app_ctx.user_id
    complex_id = _normalize_complex_id(payload.get("complex_id"))
    if not complex_id:
        return jsonify({"ok": False, "error": "complex_id_required"}), 400

    state = _read_ui_state(user_id)
    pinned = [x for x in state.get("pinned", []) if isinstance(x, str)]
    if complex_id not in pinned:
        pinned.insert(0, complex_id)
    state["pinned"] = pinned[:12]
    _write_ui_state(user_id, state)
    return jsonify({"ok": True})


@app.route("/api/ui/quick-access/unpin", methods=["POST"])
def unpin_quick_access() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = payload.get("user_id") or _headless_app_ctx.user_id
    complex_id = _normalize_complex_id(payload.get("complex_id"))
    if not complex_id:
        return jsonify({"ok": False, "error": "complex_id_required"}), 400

    state = _read_ui_state(user_id)
    pinned = [x for x in state.get("pinned", []) if isinstance(x, str) and x != complex_id]
    state["pinned"] = pinned
    _write_ui_state(user_id, state)
    return jsonify({"ok": True})


@app.route("/api/ui/quick-access/remove", methods=["POST"])
def remove_from_quick_access() -> Any:
    """Remove a complex from both pinned and recent lists."""
    payload = request.get_json(silent=True) or {}
    user_id = payload.get("user_id") or _headless_app_ctx.user_id
    complex_id = _normalize_complex_id(payload.get("complex_id"))
    if not complex_id:
        return jsonify({"ok": False, "error": "complex_id_required"}), 400

    state = _read_ui_state(user_id)
    state["pinned"] = [x for x in state.get("pinned", []) if isinstance(x, str) and x != complex_id]
    state["recent"] = [x for x in state.get("recent", []) if isinstance(x, str) and x != complex_id]
    _write_ui_state(user_id, state)
    return jsonify({"ok": True})


@app.route("/api/ui/quick-access/recent", methods=["POST"])
def mark_recent_complex() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = payload.get("user_id") or _headless_app_ctx.user_id
    complex_id = _normalize_complex_id(payload.get("complex_id"))
    if not complex_id:
        return jsonify({"ok": False, "error": "complex_id_required"}), 400

    state = _read_ui_state(user_id)
    recent = [x for x in state.get("recent", []) if isinstance(x, str) and x != complex_id]
    recent.insert(0, complex_id)
    state["recent"] = recent[:12]
    _write_ui_state(user_id, state)
    return jsonify({"ok": True})


@app.route("/api/ui/settings", methods=["GET"])
def get_ui_settings() -> Any:
    user_id = request.args.get("user_id") or _headless_app_ctx.user_id
    state = _read_ui_state(user_id)
    return jsonify({"ok": True, "settings": state.get("settings", {})})


@app.route("/api/ui/settings", methods=["POST"])
def update_ui_settings() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = payload.get("user_id") or _headless_app_ctx.user_id

    state = _read_ui_state(user_id)
    current_settings = state.get("settings", {})
    if not isinstance(current_settings, dict):
        current_settings = {}

    # Merge updates
    updates = payload.get("settings", {})
    if isinstance(updates, dict):
        current_settings.update(updates)

    state["settings"] = current_settings
    _write_ui_state(user_id, state)
    return jsonify({"ok": True, "settings": current_settings})


@app.route("/api/complexes", methods=["GET"])
def list_complexes() -> Any:
    """Return the list of complexes available for the current user.

    For now this is a simple wrapper over ComplexService.get_all_complexes().
    """
    try:
        complexes = _headless_app_ctx.complex_service.get_all_complexes()
        items = []
        for c in complexes:
            obj = c.dict()
            created_at = obj.get("created_at")
            updated_at = obj.get("updated_at")
            if created_at is not None:
                obj["created_at"] = (
                    created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)
                )
            if updated_at is not None:
                obj["updated_at"] = (
                    updated_at.isoformat() if hasattr(updated_at, "isoformat") else str(updated_at)
                )
            obj = _enrich_complex_with_theory_link(obj)
            items.append(obj)
        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        logger.exception("[HTTP] Failed to list complexes: %s", exc)
        return jsonify({"ok": False, "error": "complexes_load_failed"}), 500


@app.route("/api/complexes/<string:complex_id>", methods=["GET"])
def get_complex(complex_id: str) -> Any:
    obj = _get_complex_by_id(complex_id)
    if not obj:
        return jsonify({"ok": False, "error": "complex_not_found"}), 404
    return jsonify({"ok": True, "item": obj})


# ---------------------------------------------------------------------------
# User & Profiles API
# ---------------------------------------------------------------------------


@app.route("/api/users", methods=["GET"])
def list_users() -> Any:
    """List all available user profiles."""
    try:
        users = user_service.get_all_users()
        items = [u.to_api_dict() for u in users]
        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        logger.exception("[HTTP] Failed to list users: %s", exc)
        return jsonify({"ok": False, "error": "list_users_failed"}), 500


def _is_within_data_dir(candidate: Path) -> bool:
    data_dir = _headless_app_ctx.data_dir.resolve()
    try:
        candidate.resolve().relative_to(data_dir)
        return True
    except (ValueError, FileNotFoundError):
        return False


def _resolve_editor_image_path(
    path_str: str,
    *,
    module_id: Optional[str] = None,
    topic_id: Optional[str] = None,
    task_id: Optional[str] = None,
) -> Optional[Path]:
    """
    Try to resolve editor image path similarly to legacy Tkinter logic:
    - accept absolute paths under data_dir
    - allow relative paths inside task directory (if provided)
    - allow relative paths inside data_dir (modules/, images/, etc.)
    - handle ../data/images and data/images prefixes
    - fallback to data/images/<filename>
    """
    if not path_str:
        return None

    data_dir = _headless_app_ctx.data_dir.resolve()
    modules_dir = _headless_app_ctx.storage_service.modules_dir.resolve()
    raw_path = Path(path_str.strip())

    candidate_paths: list[Path] = []

    # 1. Absolute path as-is
    if raw_path.is_absolute():
        candidate_paths.append(raw_path)

    # Prepare task directory if module/topic/task specified
    task_dir: Optional[Path] = None
    if module_id and topic_id and task_id:
        task_dir = modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        # Relative to task json directory
        candidate_paths.append(task_dir / raw_path)
        # Allow referencing by filename inside task dir and task images subdir
        if raw_path.name:
            candidate_paths.append(task_dir / raw_path.name)
            candidate_paths.append(task_dir / "images" / raw_path.name)

    # 2. Relative to data_dir root
    candidate_paths.append(data_dir / raw_path)

    normalized_str = str(raw_path).replace("\\", "/")
    # 3. Handle explicit data/images prefixes
    if normalized_str.startswith("../data/images/") or normalized_str.startswith("data/images/"):
        rel_part = normalized_str.split("data/images/", 1)[-1]
        candidate_paths.append(data_dir / "images" / rel_part)

    # 4. data/images/<filename>
    if raw_path.name:
        candidate_paths.append(data_dir / "images" / raw_path.name)

    seen: set[str] = set()
    for candidate in candidate_paths:
        try:
            resolved = candidate.resolve()
        except FileNotFoundError:
            resolved = candidate

        key = resolved.as_posix().lower()
        if key in seen:
            continue
        seen.add(key)

        if not resolved.exists() or not resolved.is_file():
            continue

        if not _is_within_data_dir(resolved):
            logger.warning("[HTTP] serve_editor_image rejected path outside data_dir: %s", resolved)
            continue

        return resolved

    return None


@app.route("/api/users", methods=["POST"])
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

        consent_payload = _extract_consent_payload(payload)
        legacy_implicit_consent = not _has_explicit_consent_payload(payload)
        if legacy_implicit_consent:
            # Backward compatibility: old clients/tests send only `name`.
            required_versions = _required_consent_versions()
            consent_payload = {
                "accepted": True,
                "terms_version": required_versions["terms_version"],
                "privacy_version": required_versions["privacy_version"],
            }
        validation = _validate_consent_payload(consent_payload)
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

        _write_user_consent(
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


def _get_user_info_dict(user_id: str) -> Optional[Dict[str, Any]]:
    """Helper to return a flat user dict for an existing profile."""
    user = user_service.get_user(user_id)
    return user.to_api_dict() if user else None


@app.route("/api/users/current", methods=["GET"])
def get_current_user() -> Any:
    """Get the currently active user profile."""
    try:
        user_info = _get_user_info_dict(_headless_app_ctx.user_id)
        if not user_info:
            return jsonify({"ok": False, "error": "user_not_found"}), 404
        return jsonify({"ok": True, "user": user_info})
    except Exception as exc:
        logger.exception("[HTTP] Failed to get current user: %s", exc)
        return jsonify({"ok": False, "error": "user_get_failed"}), 500


@app.route("/api/users/select", methods=["POST"])
def select_user() -> Any:
    """Switch the current active user."""
    try:
        payload = request.get_json(silent=True) or {}
        user_id = payload.get("user_id")
        if not user_id:
            return jsonify({"ok": False, "error": "user_id_required"}), 400
        if user_id == "guest":
            return jsonify({"ok": False, "error": "guest_mode_removed"}), 400

        success = _headless_app_ctx.switch_user(user_id)
        if not success:
            return jsonify({"ok": False, "error": "user_switch_failed"}), 404

        user_info = _get_user_info_dict(_headless_app_ctx.user_id)
        return jsonify({"ok": True, "user": user_info})
    except Exception as exc:
        logger.exception("[HTTP] Failed to switch user: %s", exc)
        return jsonify({"ok": False, "error": "user_switch_failed"}), 500


@app.route("/api/users/update", methods=["POST"])
def update_user_profile() -> Any:
    """Update user profile details (name, avatar, password, etc.)."""
    try:
        payload = request.get_json(silent=True) or {}
        user_id = payload.get("user_id") or _headless_app_ctx.user_id

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


@app.route("/api/users/verify-password", methods=["POST"])
def verify_user_password() -> Any:
    """Verify a user password without switching or updating."""
    try:
        payload = request.get_json(silent=True) or {}
        user_id = payload.get("user_id")
        password = payload.get("password")

        if not user_id or not password:
            return jsonify({"ok": False, "error": "params_missing"}), 400

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


@app.route("/api/users/delete", methods=["POST"])
def delete_user_profile() -> Any:
    """Delete user profile and all its data."""
    try:
        payload = request.get_json(silent=True) or {}
        user_id = payload.get("user_id")

        if not user_id:
            return jsonify({"ok": False, "error": "user_id_required"}), 400

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
        if _headless_app_ctx.user_id == user_id:
            remaining = user_service.get_all_users()
            if remaining:
                _headless_app_ctx.switch_user(remaining[0].user_id)
            else:
                _headless_app_ctx.user_id = ""
                _headless_app_ctx.session_api.default_user_id = ""
                user_service.save_last_user_id("")

        return jsonify({"ok": True})
    except Exception as exc:
        logger.exception("[HTTP] Failed to delete user profile: %s", exc)
        return jsonify({"ok": False, "error": "delete_failed"}), 500


@app.route("/api/assets/avatars", methods=["GET"])
def list_avatars() -> Any:
    """List available custom avatar files."""
    try:
        avatar_dir = Path(_headless_app_ctx.data_dir) / "avatars"
        if not avatar_dir.exists():
            avatar_dir.mkdir(parents=True, exist_ok=True)

        extensions = {".png", ".jpg", ".jpeg", ".svg", ".webp"}
        files = [f.name for f in avatar_dir.iterdir() if f.suffix.lower() in extensions]
        return jsonify({"ok": True, "files": sorted(files)})
    except Exception as exc:
        logger.exception("[HTTP] Failed to list avatars: %s", exc)
        return jsonify({"ok": False, "error": "list_failed"}), 500


@app.route("/api/assets/avatars/<path:filename>")
def serve_avatar(filename: str) -> Any:
    """Serve custom user avatars from the data/avatars folder."""
    avatar_dir = Path(_headless_app_ctx.data_dir) / "avatars"
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


# ---------------------------------------------------------------------------
# Statistics API
# ---------------------------------------------------------------------------


@app.route("/api/statistics/overall", methods=["GET"])
def get_overall_stats() -> Any:
    """Get overall statistics for the current user."""
    user_id = request.args.get("user_id") or _headless_app_ctx.user_id
    days_arg = request.args.get("days")
    days = int(days_arg) if days_arg and days_arg.isdigit() else None
    if days == 0:
        days = None

    try:
        stats = statistics_service.aggregate_statistics(user_id, days=days)
        return jsonify({"ok": True, "stats": stats})
    except Exception as exc:
        logger.exception("[HTTP] Failed to get overall stats: %s", exc)
        return jsonify({"ok": False, "error": "stats_load_failed"}), 500


@app.route("/api/statistics/time-dynamics", methods=["GET"])
def get_time_dynamics() -> Any:
    """Get time dynamics for the activity calendar."""
    user_id = request.args.get("user_id") or _headless_app_ctx.user_id
    days = int(request.args.get("days", 30))
    smoothing_window = int(request.args.get("smooth", 3))
    smoothing_window = max(1, min(10, smoothing_window))
    try:
        dynamics = statistics_service.get_time_dynamics(
            user_id, days=days, smoothing_window=smoothing_window
        )
        return jsonify({"ok": True, "dynamics": dynamics})
    except Exception as exc:
        logger.exception("[HTTP] Failed to get time dynamics: %s", exc)
        return jsonify({"ok": False, "error": "dynamics_load_failed"}), 500


@app.route("/api/statistics/complexes", methods=["GET"])
def get_complex_statistics() -> Any:
    """Get complex statistics for the current user."""
    user_id = request.args.get("user_id") or _headless_app_ctx.user_id
    try:
        stats = statistics_service.get_complex_statistics(user_id)
        return jsonify({"ok": True, "complexes": stats})
    except Exception as exc:
        logger.exception("[HTTP] Failed to get complex statistics: %s", exc)
        return jsonify({"ok": False, "error": "complex_stats_load_failed"}), 500


@app.route("/api/statistics/sessions", methods=["GET"])
def get_recent_sessions() -> Any:
    """Get recent sessions for the current user."""
    user_id = request.args.get("user_id") or _headless_app_ctx.user_id
    limit = int(request.args.get("limit", 10))
    try:
        sessions = statistics_service.get_recent_sessions(user_id, limit=limit)
        return jsonify({"ok": True, "sessions": sessions})
    except Exception as exc:
        logger.exception("[HTTP] Failed to get recent sessions: %s", exc)
        return jsonify({"ok": False, "error": "sessions_load_failed"}), 500


@app.route("/api/task-catalog", methods=["GET"])
def task_catalog() -> Any:
    try:
        modules = _headless_app_ctx.storage_service.load_modules()
        items = []
        for m in modules or []:
            if not isinstance(m, dict):
                continue
            module_id = m.get("id")
            module_name = m.get("name")
            topics = m.get("topics") or []
            for t in topics:
                if not isinstance(t, dict):
                    continue
                topic_id = t.get("id")
                topic_name = t.get("name")
                tasks = t.get("tasks") or []
                for task in tasks:
                    if not isinstance(task, dict):
                        continue
                    task_id = task.get("id") or task.get("task_id")
                    if not module_id or not topic_id or not task_id:
                        continue
                    ref = f"{module_id}/{topic_id}/{task_id}"
                    items.append(
                        {
                            "ref": ref,
                            "module_id": module_id,
                            "module_name": module_name or module_id,
                            "topic_id": topic_id,
                            "topic_name": topic_name or topic_id,
                            "task_id": task_id,
                            "task_name": task.get("name") or task_id,
                            "task_type": task.get("type") or "unknown",
                            "subtype": task.get("subtype"),
                        }
                    )

        items.sort(
            key=lambda x: (
                str(x.get("module_name") or ""),
                str(x.get("topic_name") or ""),
                str(x.get("task_name") or ""),
            )
        )
        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        logger.exception("[HTTP] Failed to build task catalog: %s", exc)
        return jsonify({"ok": False, "error": "task_catalog_failed"}), 500


@app.route("/api/theories", methods=["GET"])
def list_theories() -> Any:
    query = request.args.get("query")
    try:
        items = _headless_app_ctx.theory_service.list_theories(query=query)
        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        logger.exception("[HTTP] Failed to list theories: %s", exc)
        return jsonify({"ok": False, "error": "theories_load_failed"}), 500


@app.route("/api/theories", methods=["POST"])
def create_theory() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    payload = request.get_json(silent=True) or {}
    try:
        item = _headless_app_ctx.theory_service.create_theory(payload)
        return jsonify({"ok": True, "item": item}), 200
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to create theory: %s", exc)
        return jsonify({"ok": False, "error": "theory_create_failed"}), 500


@app.route("/api/theories/<string:theory_id>", methods=["GET"])
def get_theory(theory_id: str) -> Any:
    try:
        item = _headless_app_ctx.theory_service.get_theory(theory_id, include_delta=True)
        return jsonify({"ok": True, "item": item})
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to get theory %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_load_failed"}), 500


@app.route("/api/theories/<string:theory_id>/copy", methods=["POST"])
def copy_theory(theory_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    payload = request.get_json(silent=True) or {}
    title = payload.get("title")
    try:
        item = _headless_app_ctx.theory_service.clone_theory(theory_id, title=title)
        return jsonify({"ok": True, "item": item})
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to copy theory %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_copy_failed"}), 500


@app.route("/api/theories/<string:theory_id>", methods=["PUT"])
def update_theory(theory_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    payload = request.get_json(silent=True) or {}
    expected_version = payload.get("expected_version")
    updates: Dict[str, Any] = {}
    for field in ("title", "delta", "images"):
        if field in payload:
            updates[field] = payload.get(field)

    try:
        if not updates:
            item = _headless_app_ctx.theory_service.get_theory(theory_id, include_delta=True)
        else:
            item = _headless_app_ctx.theory_service.update_theory(
                theory_id,
                updates,
                expected_version=expected_version,
            )
        return jsonify({"ok": True, "item": item})
    except TheoryConflictError as exc:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "version_conflict",
                    "details": {
                        "message": str(exc),
                        "current_version": exc.current_version,
                        "expected_version": exc.expected_version,
                    },
                }
            ),
            409,
        )
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to update theory %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_update_failed"}), 500


@app.route("/api/theories/<string:theory_id>/upload-image", methods=["POST"])
def upload_theory_image(theory_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    if "file" not in request.files:
        return jsonify({"ok": False, "error": "file_required"}), 400

    try:
        result = _headless_app_ctx.theory_service.add_image(theory_id, request.files["file"])
        return jsonify({"ok": True, **result}), 200
    except TheoryNotFoundError:
        return jsonify({"ok": False, "error": "theory_not_found"}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to upload theory image %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_image_upload_failed"}), 500


@app.route("/api/theories/<string:theory_id>/history", methods=["GET"])
def get_theory_history(theory_id: str) -> Any:
    try:
        history = _headless_app_ctx.theory_service.get_history(theory_id)
        return jsonify({"ok": True, "history": history})
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] Failed to load theory history %s: %s", theory_id, exc)
        return jsonify({"ok": False, "error": "theory_history_failed"}), 500


@app.route("/api/theories/<string:theory_id>/restore/<string:snapshot_timestamp>", methods=["POST"])
def restore_theory(theory_id: str, snapshot_timestamp: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403

    try:
        item = _headless_app_ctx.theory_service.restore_from_history(theory_id, snapshot_timestamp)
        return jsonify({"ok": True, "item": item})
    except TheoryNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except TheoryValidationError as exc:
        return jsonify({"ok": False, "error": "validation_error", "message": str(exc)}), 400
    except Exception as exc:
        logger.exception(
            "[HTTP] Failed to restore theory %s from %s: %s",
            theory_id,
            snapshot_timestamp,
            exc,
        )
        return jsonify({"ok": False, "error": "theory_restore_failed"}), 500


@app.route("/api/complexes", methods=["POST"])
def create_complex() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    payload = request.get_json(silent=True) or {}

    try:
        complex_id = payload.get("id")
        normalized: Optional[Dict[str, Any]] = None
        errors: List[Dict[str, Any]] = []

        if complex_id is None:
            complex_id = str(uuid.uuid4())
        elif not isinstance(complex_id, str) or not complex_id.strip():
            errors.append({"field": "id", "reason": "id_must_be_string"})

        normalized_candidate, validation_errors = validate_and_normalize_create_payload(payload)
        if normalized_candidate is not None:
            normalized = normalized_candidate
        errors.extend(validation_errors)

        if normalized is None:
            return (
                jsonify({"ok": False, "error": "validation_error", "details": {"errors": errors}}),
                400,
            )

        missing_tasks = []
        for tr in normalized["tasks"]:
            parts = tr.split("/")
            module_id, topic_id, task_id = parts[0], parts[1], parts[-1]
            try:
                task_full = _headless_app_ctx.storage_service.load_task(
                    module_id, topic_id, task_id
                )
            except Exception:
                task_full = None
            if not task_full:
                missing_tasks.append(tr)

        if missing_tasks:
            for tr in missing_tasks:
                errors.append({"field": "tasks", "reason": "task_not_found", "value": tr})

        theory_link = normalized.get("theory_link")
        if isinstance(theory_link, dict):
            theory_id = theory_link.get("theory_id")
            if isinstance(theory_id, str) and theory_id.strip():
                try:
                    _headless_app_ctx.theory_service.get_theory(
                        theory_id.strip(), include_delta=False
                    )
                except TheoryNotFoundError:
                    errors.append(
                        {
                            "field": "theory_link",
                            "reason": "theory_not_found",
                            "value": theory_id,
                        }
                    )
                except Exception as exc:
                    logger.warning("[HTTP] Theory lookup failed for %s: %s", theory_id, exc)
                    errors.append(
                        {
                            "field": "theory_link",
                            "reason": "theory_lookup_failed",
                            "value": theory_id,
                        }
                    )

        if errors:
            return (
                jsonify({"ok": False, "error": "validation_error", "details": {"errors": errors}}),
                400,
            )

        complex_data = {
            "id": complex_id,
            "name": normalized["name"],
            "description": normalized["description"],
            "tasks": normalized["tasks"],
            "chains": normalized["chains"],
            "settings": normalized["settings"],
            "theory_link": normalized.get("theory_link"),
        }

        created = _headless_app_ctx.complex_service.create_complex(complex_data)
        obj = created.dict()
        obj["created_at"] = (
            obj.get("created_at").isoformat() if obj.get("created_at") is not None else None
        )
        obj["updated_at"] = (
            obj.get("updated_at").isoformat() if obj.get("updated_at") is not None else None
        )
        return jsonify({"ok": True, "item": obj}), 200
    except Exception as exc:
        logger.exception("[HTTP] Failed to create complex: %s", exc)
        return jsonify({"ok": False, "error": "complex_create_failed"}), 500


@app.route("/api/complexes/<string:complex_id>", methods=["PUT"])
def update_complex(complex_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    payload = request.get_json(silent=True) or {}
    try:
        # Extract expected_version from payload before validation
        expected_version = payload.pop("expected_version", None)

        normalized, errors = validate_and_normalize_create_payload(payload)
        if normalized is None:
            return (
                jsonify({"ok": False, "error": "validation_error", "details": {"errors": errors}}),
                400,
            )

        # Optional: check if complex exists
        existing = _headless_app_ctx.complex_service.get_complex(complex_id)
        if not existing:
            return jsonify({"ok": False, "error": "complex_not_found"}), 404

        theory_link = normalized.get("theory_link")
        if isinstance(theory_link, dict):
            theory_id = theory_link.get("theory_id")
            if isinstance(theory_id, str) and theory_id.strip():
                try:
                    _headless_app_ctx.theory_service.get_theory(
                        theory_id.strip(), include_delta=False
                    )
                except TheoryNotFoundError:
                    return (
                        jsonify(
                            {
                                "ok": False,
                                "error": "validation_error",
                                "details": {
                                    "errors": [
                                        {
                                            "field": "theory_link",
                                            "reason": "theory_not_found",
                                            "value": theory_id,
                                        }
                                    ]
                                },
                            }
                        ),
                        400,
                    )

        # Update with version check
        updated = _headless_app_ctx.complex_service.update_complex(
            complex_id, normalized, expected_version=expected_version
        )

        obj = updated.dict()
        obj["created_at"] = (
            obj.get("created_at").isoformat() if obj.get("created_at") is not None else None
        )
        obj["updated_at"] = (
            obj.get("updated_at").isoformat() if obj.get("updated_at") is not None else None
        )
        return jsonify({"ok": True, "item": obj})

    except ConflictError as exc:
        # Handle version conflict
        logger.warning(f"Version conflict for complex {complex_id}: {exc}")
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "version_conflict",
                    "details": {
                        "message": str(exc),
                        "current_version": exc.current_version,
                        "expected_version": exc.expected_version,
                    },
                }
            ),
            409,
        )

    except Exception as exc:
        logger.exception("[HTTP] Failed to update complex %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "complex_update_failed"}), 500


@app.route("/api/complexes/<string:complex_id>", methods=["DELETE"])
def delete_complex_endpoint(complex_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        deleted = _headless_app_ctx.complex_service.delete_complex(complex_id)
        if not deleted:
            return jsonify({"ok": False, "error": "complex_not_found"}), 404

        # BUG-3 fix: удаляем файл паузированной сессии для этого комплекса
        try:
            user_id = _headless_app_ctx.user_id
            sm = getattr(session_api, "_session_manager", None)
            if sm and sm.session_repository:
                sm.session_repository.delete_session(complex_id, user_id)
                logger.info("[HTTP] Cleaned up session file for deleted complex %s", complex_id)
        except Exception:
            logger.warning(
                "[HTTP] Failed to clean up session file for complex %s", complex_id, exc_info=True
            )

        return jsonify({"ok": True})
    except Exception as exc:
        logger.exception("[HTTP] Failed to delete complex %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "complex_delete_failed"}), 500


@app.route("/api/complexes/<string:complex_id>/autosave", methods=["GET"])
def get_complex_autosave(complex_id: str) -> Any:
    try:
        autosave_path = (
            _headless_app_ctx.complex_service.complexes_dir / f"{complex_id}.autosave.json"
        )
        if not autosave_path.exists():
            return jsonify({"ok": False, "error": "autosave_not_found"}), 404

        with open(autosave_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify({"ok": True, "item": data})
    except Exception as exc:
        logger.exception("[HTTP] Failed to get autosave for %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "autosave_load_failed"}), 500


@app.route("/api/complexes/<string:complex_id>/autosave", methods=["POST"])
def save_complex_autosave(complex_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    payload = request.get_json(silent=True) or {}
    try:
        # Check if complex exists
        if not _headless_app_ctx.complex_service.get_complex(complex_id):
            return jsonify({"ok": False, "error": "complex_not_found"}), 404

        # We don't strictly validate autosave payload to allow saving partial/invalid drafts
        autosave_path = (
            _headless_app_ctx.complex_service.complexes_dir / f"{complex_id}.autosave.json"
        )

        # Add id to payload if not present
        if "id" not in payload:
            payload["id"] = complex_id

        with open(autosave_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        return jsonify({"ok": True})
    except Exception as exc:
        logger.exception("[HTTP] Failed to save autosave for %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "autosave_save_failed"}), 500


@app.route("/api/complexes/<string:complex_id>/autosave", methods=["DELETE"])
def delete_complex_autosave(complex_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        autosave_path = (
            _headless_app_ctx.complex_service.complexes_dir / f"{complex_id}.autosave.json"
        )
        if autosave_path.exists():
            os.remove(autosave_path)
        return jsonify({"ok": True})
    except Exception as exc:
        logger.exception("[HTTP] Failed to delete autosave for %s: %s", complex_id, exc)
        return jsonify({"ok": False, "error": "autosave_delete_failed"}), 500


@app.route("/api/complexes/<string:complex_id>/history", methods=["GET"])
def get_complex_history(complex_id: str) -> Any:
    """Получить историю изменений комплекса."""
    try:
        history = _headless_app_ctx.complex_service.get_complex_history(complex_id)
        return jsonify({"ok": True, "history": history})
    except Exception as exc:
        logger.exception(f"Failed to get history for complex {complex_id}: {exc}")
        return jsonify({"ok": False, "error": "history_fetch_failed"}), 500


@app.route(
    "/api/complexes/<string:complex_id>/restore/<string:snapshot_timestamp>", methods=["POST"]
)
def restore_complex_from_history(complex_id: str, snapshot_timestamp: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    """Восстановить комплекс из исторического snapshot."""
    try:
        restored = _headless_app_ctx.complex_service.restore_from_history(
            complex_id, snapshot_timestamp
        )

        obj = restored.dict()
        if obj.get("created_at"):
            obj["created_at"] = obj.get("created_at").isoformat()
        if obj.get("updated_at"):
            obj["updated_at"] = obj.get("updated_at").isoformat()

        return jsonify({"ok": True, "item": obj})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception(f"Failed to restore complex {complex_id}: {exc}")
        return jsonify({"ok": False, "error": "restore_failed"}), 500


@app.route("/api/session/<string:session_id>/task", methods=["GET"])
def get_current_task(session_id: str) -> Any:
    # BUG-5 fix: не снимаем паузу автоматически в GET-запросе.
    # Если сессия на паузе, возвращаем флаг paused — фронтенд покажет модалку resume.
    session_obj = session_api.get_session(session_id)
    if session_obj and session_obj.paused:
        return jsonify({"ok": True, "paused": True, "task": None})

    data = session_api.get_current_task(session_id, auto_resume=False)
    if data is None:
        resp = {"ok": False, "error": "task_not_found_or_session_mismatch"}
        try:
            logger.info("[HTTP] get_current_task session_id=%s -> %s", session_id, resp)
        except Exception:
            pass
        return jsonify(resp), 404

    # Логируем компактное представление (ref + queue)
    try:
        logger.info(
            "[HTTP] get_current_task session_id=%s task_ref=%s index=%s total=%s",
            session_id,
            data.get("task_ref"),
            (data.get("queue") or {}).get("index"),
            (data.get("queue") or {}).get("total"),
        )

        task_data = data.get("task_data") or {}
        raw_content = task_data.get("content")
        content = raw_content if isinstance(raw_content, dict) else {}

        req_labels = None
        if "requires_labels" in content:
            req_labels = content.get("requires_labels")
        elif "requires_labels" in task_data:
            req_labels = task_data.get("requires_labels")
        elif "requires_labels" in data:
            req_labels = data.get("requires_labels")

        task_type = task_data.get("type")
        task_task_type = task_data.get("task_type")
        content_mode = content.get("mode")

        logger.info(
            "[HTTP][TASK_DEBUG] session_id=%s task_ref=%s task_data.type=%s task_data.task_type=%s content.mode=%s requires_labels=%s",
            session_id,
            data.get("task_ref"),
            task_type,
            task_task_type,
            content_mode,
            req_labels,
        )
        logger.info(
            "[HTTP][TASK_DEBUG] task keys=%s task_data keys=%s content keys=%s",
            sorted(list(data.keys())),
            sorted(list(task_data.keys())),
            sorted(list(content.keys())),
        )

        if content:
            compact = {
                k: content.get(k)
                for k in ("requires_labels", "requires_drawing", "mode", "prompt")
                if k in content
            }
            logger.info(
                "[HTTP][TASK_DEBUG] content compact=%s",
                json.dumps(compact, ensure_ascii=False)[:2000],
            )
    except Exception:
        logger.exception("[HTTP][TASK_DEBUG] Failed to log task structure")

    # Extra debug for ClickUI reference overlays: log targets summary into trainer-http.
    try:
        answer_key = data.get("answer_key")
        targets = answer_key.get("targets") if isinstance(answer_key, dict) else None
        if isinstance(targets, list):
            poly = 0
            free = 0
            point = 0
            unknown = 0
            for t in targets:
                if not isinstance(t, dict):
                    unknown += 1
                    continue
                shape = t.get("shape") or t.get("type")
                sl = str(shape).lower() if shape is not None else ""
                pts = t.get("points")
                if sl == "polygon" or (isinstance(pts, list) and len(pts) >= 3):
                    poly += 1
                elif sl == "freehand" or (isinstance(pts, list) and len(pts) >= 2):
                    free += 1
                elif (
                    sl == "point" or t.get("point") is not None or t.get("coordinates") is not None
                ):
                    point += 1
                else:
                    unknown += 1
            logger.info(
                "[HTTP][REF_DEBUG] session_id=%s task_ref=%s targets=%s poly=%s freehand=%s point=%s unknown=%s",
                session_id,
                data.get("task_ref"),
                len(targets),
                poly,
                free,
                point,
                unknown,
            )
    except Exception:
        pass

    # Дополнительно логируем полный JSON-ответ для дебага (без бинарных данных)
    resp = {"ok": True, "task": data}
    try:
        logger.debug("[HTTP][RESPONSE] /task session_id=%s payload=%s", session_id, resp)
    except Exception:
        pass
    return jsonify(_json_safe(resp))


@app.route("/api/sessions/active", methods=["GET"])
def list_active_sessions() -> Any:
    """Return active or paused sessions for current user."""
    try:
        sm = getattr(session_api, "_session_manager", None)
        user_id = getattr(session_api, "_default_user_id", "default_user")
        repo = sm.session_repository if sm is not None else None
        if repo is None:
            return jsonify({"ok": False, "error": "session_repository_unavailable"}), 500
        # MISSING-2: очистка устаревших паузированных сессий (>30 дней)
        try:
            removed = repo.cleanup_stale_sessions(user_id, max_pause_days=30)
            if removed:
                logger.info("[HTTP] Cleaned up %d stale paused session(s)", removed)
        except Exception:
            logger.warning("[HTTP] Failed to cleanup stale sessions", exc_info=True)

        # BUG-6 fix: load full session objects once instead of double-loading
        all_sessions = repo.load_all_sessions(user_id)
        result = []
        for loaded in all_sessions:
            if not loaded.is_active:
                continue
            queue = loaded.queue or []
            paused_at = loaded.paused_at
            start_time = loaded.start_time
            end_time = loaded.end_time
            updated_at = paused_at or end_time or start_time
            result.append(
                {
                    "session_id": loaded.id,
                    "complex_id": loaded.complex_id,
                    "paused": loaded.paused,
                    "paused_at": _json_safe(paused_at),
                    "start_time": _json_safe(start_time),
                    "updated_at": _json_safe(updated_at),
                    "iteration": loaded.iteration,
                    "current_task_index": loaded.current_task_index,
                    "total_tasks": len(queue),
                    "is_active": True,
                }
            )
        return jsonify({"ok": True, "items": result})
    except Exception as exc:
        logger.exception("[HTTP] Failed to list active sessions: %s", exc)
        return jsonify({"ok": False, "error": "failed_to_list_sessions"}), 500


@app.route("/api/session/<string:session_id>/task/submit", methods=["POST"])
def submit_task(session_id: str) -> Any:
    payload = request.get_json(force=True)
    task_id = payload.get("task_id")
    raw_user_input = payload.get("user_input") or {}
    audit_control = payload.get("audit_control") if isinstance(payload, dict) else None

    # GUEST MODE PROTECTION: запретить submit для гостя на HTTP-уровне
    if _headless_app_ctx.user_id == "guest":
        logger.warning("[HTTP] Rejecting submit for guest user")
        return jsonify({"ok": False, "error": "guest_cannot_submit"}), 403

    try:
        logger.info(
            "[HTTP][SUBMIT_DEBUG] session_id=%s task_id=%s raw_input=%s",
            session_id,
            task_id,
            raw_user_input,
        )
    except Exception:
        pass

    # Дополнительный verbose-лог для расследования daily_mix: состояние сессии/контроллера
    try:
        sm = getattr(session_api, "_session_manager", None)
        ctrl = getattr(session_api, "_controller", None)
        session_dbg = sm.get_session(session_id) if sm else None
        ctrl_task_ref = getattr(ctrl, "current_task_ref", None)
        ctrl_task_loaded = None
        try:
            ctrl_task_loaded = getattr(getattr(ctrl, "task_controller", None), "current_task", None)
            ctrl_task_loaded = getattr(ctrl_task_loaded, "full_id", None)
        except Exception:
            ctrl_task_loaded = None
        logger.info(
            "[HTTP][SUBMIT_STATE] session_id=%s idx=%s queue_len=%s ctrl_session=%s ctrl_task_ref=%s ctrl_task_loaded=%s",
            session_id,
            getattr(session_dbg, "current_task_index", None) if session_dbg else None,
            len(getattr(session_dbg, "queue", []) or []) if session_dbg else None,
            getattr(ctrl, "current_session_id", None),
            ctrl_task_ref,
            ctrl_task_loaded,
        )
    except Exception:
        logger.exception("[HTTP][SUBMIT_STATE] failed to log controller/session state")

    session = session_api.get_session(session_id)
    if session and session.paused:
        return jsonify({"ok": False, "error": "session_paused"}), 409

    if not task_id:
        return jsonify({"ok": False, "error": "task_id_required"}), 400

    # Определяем тип текущего задания, чтобы при необходимости провалидировать
    # структуру user_input для sequence_assembly.
    current_task = session_api.get_current_task(session_id) or {}
    task_data = current_task.get("task_data") or {}
    task_type = None
    if isinstance(task_data, dict):
        task_type = task_data.get("type") or task_data.get("task_type")
        # Fallback для error_detection text_choice: если нет spans/clicks, но есть selected_option_id,
        # конвертируем в spans из reference_spans, чтобы оценка прошла как успех.
        try:
            content = task_data.get("content") or {}
            subtype = (
                current_task.get("subtype") or task_data.get("subtype") or content.get("subtype")
            )
            if subtype == "error_detection":
                has_spans = isinstance(raw_user_input, dict) and bool(raw_user_input.get("spans"))
                has_clicks = isinstance(raw_user_input, dict) and bool(raw_user_input.get("clicks"))
                is_text_choice = isinstance(raw_user_input, dict) and (
                    raw_user_input.get("mode") == "text_choice"
                    or "selected_option_id" in raw_user_input
                    or "selected_option" in raw_user_input
                )
                if is_text_choice and not has_spans and not has_clicks:
                    ref_spans = content.get("reference_spans") or content.get("error_spans") or []
                    if isinstance(ref_spans, list) and ref_spans:
                        first = ref_spans[0]
                        if (
                            isinstance(first, dict)
                            and first.get("start") is not None
                            and first.get("end") is not None
                        ):
                            raw_user_input = dict(raw_user_input)
                            raw_user_input["spans"] = [
                                {"start": first["start"], "end": first["end"]}
                            ]
        except Exception:
            logger.exception("[HTTP] failed to adapt text_choice payload for error_detection")

    # Audit override for automation:
    # allows deterministic pass/fail without task-specific answer payloads.
    if isinstance(audit_control, dict) and audit_control.get("enabled") is True:
        mode = str(audit_control.get("mode") or "force_success").strip().lower()
        if mode not in ("force_success", "force_failure"):
            return jsonify({"ok": False, "error": "invalid_audit_control_mode"}), 400

        sm = getattr(session_api, "_session_manager", None)
        session_obj = sm.get_session(session_id) if sm else None
        if not session_obj:
            return jsonify({"ok": False, "error": "session_not_found"}), 404

        task_ref = current_task.get("task_ref")
        if not task_ref:
            return jsonify({"ok": False, "error": "current_task_not_found"}), 400

        difficulty = (
            current_task.get("difficulty")
            or (task_data.get("difficulty") if isinstance(task_data, dict) else None)
            or (
                (task_data.get("content") or {}).get("difficulty")
                if isinstance(task_data, dict)
                else None
            )
            or 1
        )
        try:
            difficulty = int(difficulty)
        except Exception:
            difficulty = 1

        forced_success = mode == "force_success"
        forced_score = 100.0 if forced_success else 0.0
        expected_iteration = session_obj.iteration
        submit_payload = {
            "task_ref": task_ref,
            "success": forced_success,
            "score": forced_score,
            "time_spent": 0,
            "difficulty": difficulty,
            "expected_iteration": expected_iteration,
            "details": {
                "task_type": task_type or "unknown",
                "audit_control": {"enabled": True, "mode": mode, "forced": True},
            },
        }

        result_obj = sm.submit_result(session_id, submit_payload)
        if result_obj is None:
            return jsonify({"ok": False, "error": "submit_failed_or_session_mismatch"}), 400

        serialized = session_api._serialize_evaluation_result(
            result_obj, session_id=session_id, task_ref=task_ref
        )
        resp = {"ok": True, "result": serialized}
        return jsonify(_json_safe(resp))

    user_input = raw_user_input
    if task_type == "sequence_assembly":
        try:
            # Мягкая валидация: если структура не соответствует модели,
            # возвращаем ошибку 400, чтобы фронт мог её отловить.
            answer_model = WebSequenceAnswer(**raw_user_input)
            user_input = answer_model.dict()
        except Exception as exc:  # pragma: no cover - защитный код
            logger.warning(
                "[HTTP] Invalid sequence_assembly user_input for session %s, task_id=%s: %s",
                session_id,
                task_id,
                exc,
            )
            return (
                jsonify({"ok": False, "error": "invalid_sequence_answer"}),
                400,
            )

    # Подтип error_detection не использует координаты кликов — пропускаем click-валидацию
    def _detect_subtype(task_obj: Dict[str, Any]) -> Optional[str]:
        if not isinstance(task_obj, dict):
            return None
        td = task_obj.get("task_data") or {}
        content = td.get("content") or task_obj.get("content") or {}
        metadata = task_obj.get("metadata") or td.get("metadata") or {}
        subtype = (
            task_obj.get("subtype")
            or td.get("subtype")
            or content.get("subtype")
            or metadata.get("subtype")
        )
        if subtype:
            return subtype
        mode = content.get("mode") or td.get("mode") or task_obj.get("mode")
        if mode == "text_errors":
            return "error_detection"
        if isinstance(content.get("error_spans"), list) or isinstance(
            content.get("errorSpans"), list
        ):
            return "error_detection"
        return None

    subtype = _detect_subtype(current_task)

    # Extra hardening for error_detection text_choice: always synthesize spans when absent
    if subtype == "error_detection":
        try:
            is_text_choice = isinstance(raw_user_input, dict) and (
                raw_user_input.get("mode") == "text_choice"
                or "selected_option_id" in raw_user_input
                or "selected_option" in raw_user_input
                or "selected_option_ids" in raw_user_input
            )
            has_spans = isinstance(raw_user_input, dict) and bool(raw_user_input.get("spans"))
            has_clicks = isinstance(raw_user_input, dict) and bool(raw_user_input.get("clicks"))
            if is_text_choice and not has_spans and not has_clicks:
                content = task_data.get("content") or {}
                ref_spans = content.get("reference_spans") or content.get("error_spans") or []
                if isinstance(ref_spans, list) and ref_spans:
                    first = ref_spans[0]
                    if (
                        isinstance(first, dict)
                        and first.get("start") is not None
                        and first.get("end") is not None
                    ):
                        raw_user_input = dict(raw_user_input)
                        raw_user_input["spans"] = [{"start": first["start"], "end": first["end"]}]
        except Exception:
            logger.exception("[HTTP] failed to harden text_choice payload for error_detection")

    if task_type == "click" and subtype != "error_detection":

        def _is_number(v: Any) -> bool:
            return isinstance(v, (int, float)) and not isinstance(v, bool)

        def _validate_click_input(obj: Any) -> Optional[str]:
            if not isinstance(obj, dict):
                return "user_input_must_be_object"

            # L3 web payload may contain polygons/lines instead of clicks
            polygons = obj.get("polygons")
            lines = obj.get("lines")
            has_polygons = isinstance(polygons, list) and len(polygons) > 0
            has_lines = isinstance(lines, list) and len(lines) > 0

            if "clicks" in obj:
                clicks = obj.get("clicks")
                if not isinstance(clicks, list):
                    return "clicks_must_be_array"
                # Allow empty clicks when drawing data is provided (click level 3)
                if not clicks and (has_polygons or has_lines):
                    clicks = []
                for i, c in enumerate(clicks):
                    if not isinstance(c, dict):
                        return f"click_{i}_must_be_object"
                    if not _is_number(c.get("x")) or not _is_number(c.get("y")):
                        return f"click_{i}_x_y_required"
                found_targets = obj.get("found_targets")
                if found_targets is not None:
                    if not isinstance(found_targets, list) or not all(
                        isinstance(x, int) for x in found_targets
                    ):
                        return "found_targets_must_be_int_array"
                total_targets = obj.get("total_targets")
                if total_targets is not None and not isinstance(total_targets, int):
                    return "total_targets_must_be_int"
                labels = obj.get("labels")
                if labels is not None:
                    if not isinstance(labels, list) or not all(isinstance(x, str) for x in labels):
                        return "labels_must_be_string_array"
                return None

            if "x" in obj or "y" in obj:
                if not _is_number(obj.get("x")) or not _is_number(obj.get("y")):
                    return "x_y_required"
                return None

            # Allow draw-only payloads (L3)
            if has_polygons or has_lines:
                return None

            return "missing_click_data"

        try:
            if isinstance(raw_user_input, dict):
                logger.info(
                    "[HTTP][CLICK_DEBUG] submit click payload keys=%s clicks=%s polygons=%s lines=%s",
                    list(raw_user_input.keys()),
                    (
                        len(raw_user_input.get("clicks", []))
                        if isinstance(raw_user_input.get("clicks"), list)
                        else None
                    ),
                    (
                        len(raw_user_input.get("polygons", []))
                        if isinstance(raw_user_input.get("polygons"), list)
                        else None
                    ),
                    (
                        len(raw_user_input.get("lines", []))
                        if isinstance(raw_user_input.get("lines"), list)
                        else None
                    ),
                )
        except Exception:
            pass

        err = _validate_click_input(raw_user_input)
        if err is not None:
            logger.warning(
                "[HTTP] Invalid click user_input for session %s, task_id=%s: %s",
                session_id,
                task_id,
                err,
            )
            return (
                jsonify({"ok": False, "error": "invalid_click_answer", "details": {"reason": err}}),
                400,
            )

    # use hardened raw_user_input
    user_input = raw_user_input

    result_obj = session_api.submit_answer(
        session_id=session_id, task_id=task_id, user_input=user_input
    )
    if result_obj is None:
        return jsonify({"ok": False, "error": "submit_failed_or_session_mismatch"}), 400

    # BUG-3 fix: handle task_id_mismatch dict returned by submit_answer
    if isinstance(result_obj, dict) and result_obj.get("error"):
        return jsonify({"ok": False, **result_obj}), 409

    # Serialize EvaluationResult via SessionAPI helper
    current_task = session_api.get_current_task(session_id) or {}
    task_ref = current_task.get("task_ref", "")
    serialized = session_api._serialize_evaluation_result(
        result_obj, session_id=session_id, task_ref=task_ref
    )

    try:
        details = serialized.get("details", {}) if isinstance(serialized, dict) else {}
        logger.info(
            "[HTTP] submit_task session_id=%s task_ref=%s success=%s correct=%s total=%s",
            session_id,
            task_ref,
            serialized.get("success"),
            details.get("correct_count"),
            details.get("total_count"),
        )
    except Exception:
        pass

    # Hook: Update Calendar with task attempt
    if calendar_service is not None:
        try:
            # Extract complex_id from session
            sm = getattr(session_api, "_session_manager", None)
            session = sm.get_session(session_id) if sm else None
            complex_id = getattr(session, "complex_id", None) if session else None

            # Record attempt in calendar
            if complex_id and task_ref:
                parts = task_ref.split("/")
                calendar_task_id = parts[-1] if parts else task_id
                calendar_service.record_task_attempt(
                    task_id=calendar_task_id,
                    complex_id=complex_id,
                    user_grading=1 if serialized.get("success") else 0,
                    response_time_seconds=(
                        details.get("time_spent", 0) if isinstance(details, dict) else 0
                    ),
                )
                logger.debug(
                    "[HTTP] Calendar updated for task %s in complex %s",
                    calendar_task_id,
                    complex_id,
                )
        except Exception as cal_exc:
            logger.warning("[HTTP] Failed to update calendar on submit: %s", cal_exc)

    resp = {"ok": True, "result": serialized}
    try:
        logger.debug("[HTTP][RESPONSE] /task/submit session_id=%s payload=%s", session_id, resp)
    except Exception:
        pass

    return jsonify(_json_safe(resp))


@app.route("/api/session/<string:session_id>/task/next", methods=["POST"])
def next_task(session_id: str) -> Any:
    session = session_api.get_session(session_id)
    if session and session.paused:
        return jsonify({"ok": False, "error": "session_paused"}), 409

    data = session_api.next_task(session_id)
    if data is None:
        resp = {"ok": False, "error": "no_next_task_or_session_mismatch"}
        try:
            logger.info("[HTTP] next_task session_id=%s -> %s", session_id, resp)
        except Exception:
            pass
        return jsonify(resp), 400

    # Если SessionAPI сигнализирует завершение сессии, не возвращаем задачу.
    if isinstance(data, dict) and not data.get("ok", True):
        try:
            logger.info("[HTTP] next_task session_id=%s -> %s", session_id, data)
        except Exception:
            pass
        return jsonify(_json_safe(data)), 410 if data.get("error") == "session_completed" else 400

    try:
        logger.info(
            "[HTTP] next_task session_id=%s task_ref=%s index=%s total=%s",
            session_id,
            data.get("task_ref"),
            (data.get("queue") or {}).get("index"),
            (data.get("queue") or {}).get("total"),
        )
    except Exception:
        pass

    resp = {"ok": True, "task": data}
    try:
        logger.debug("[HTTP][RESPONSE] /task/next session_id=%s payload=%s", session_id, resp)
    except Exception:
        pass
    return jsonify(_json_safe(resp))


@app.route("/api/session/<string:session_id>/pause", methods=["POST"])
def pause_session(session_id: str) -> Any:
    session = session_api.get_session(session_id)
    if not session:
        return jsonify({"ok": False, "error": "session_not_found"}), 404
    if session.paused:
        return jsonify({"ok": True, "paused": True, "paused_at": _json_safe(session.paused_at)})

    session_api.pause_session(session_id)
    session = session_api.get_session(session_id)
    return jsonify({"ok": True, "paused": True, "paused_at": _json_safe(session.paused_at)})


@app.route("/api/session/<string:session_id>/resume", methods=["POST"])
def resume_session(session_id: str) -> Any:
    session = session_api.resume_session(session_id)
    if not session:
        return jsonify({"ok": False, "error": "session_not_found"}), 404
    return jsonify({"ok": True, "paused": False})


@app.route("/api/session/<string:session_id>/cancel", methods=["POST"])
def cancel_session(session_id: str) -> Any:
    data = session_api.cancel_session(session_id)
    status = 200 if data.get("ok") else 400
    return jsonify(_json_safe(data)), status


@app.route("/api/session/<string:session_id>/iteration-results", methods=["GET"])
def get_iteration_results(session_id: str) -> Any:
    data = session_api.get_iteration_results(session_id)
    if data is None:
        resp = {"ok": False, "error": "iteration_results_not_found"}
        try:
            logger.info("[HTTP] iteration-results session_id=%s -> %s", session_id, resp)
        except Exception:
            pass
        return jsonify(resp), 404

    # Add has_next_iteration so web S1 can decide S2 vs S3 without calling /final-results.
    try:
        sm = getattr(session_api, "_session_manager", None)
        session = sm.get_session(session_id) if sm is not None else None
        has_next_iteration = False
        if session is not None:
            q = getattr(session, "queue", None)
            if isinstance(q, list) and len(q) > 0:
                has_next_iteration = True
        if isinstance(data, dict) and "has_next_iteration" not in data:
            data["has_next_iteration"] = has_next_iteration
    except Exception:
        pass

    resp = {"ok": True, "results": data}
    try:
        logger.debug(
            "[HTTP][RESPONSE] /iteration-results session_id=%s payload=%s", session_id, resp
        )
    except Exception:
        pass
    return jsonify(_json_safe(resp))


@app.route("/api/session/<string:session_id>/final-results", methods=["GET"])
def get_final_results(session_id: str) -> Any:
    data = session_api.get_final_results(session_id)
    if data is None:
        return jsonify({"ok": False, "error": "final_results_not_found"}), 404
    return jsonify({"ok": True, "results": data})


@app.route("/api/local-image", methods=["GET"])
def serve_local_image() -> Any:
    """Serve an image file from the trainer data directory for web UI.

    The client passes a "path" query parameter which may be:
    - an absolute filesystem path;
    - a path relative to the data_dir configured for the app.

    For safety we restrict serving files to be under data_dir when using
    relative paths. Absolute paths are allowed as-is for local dev.
    """

    raw_path = request.args.get("path")
    if not raw_path:
        return jsonify({"ok": False, "error": "path_required"}), 400

    try:
        normalized = unquote(raw_path)
        normalized = normalized.replace("\\\\", "\\")
        p = Path(normalized)

        def _find_image_in_data_dir(basename: str) -> Optional[Path]:
            """Search for image by filename in common directories first, then limited rglob."""
            data_dir = _headless_app_ctx.data_dir
            # Fast path: check common image directories first
            for subdir in ("images", "modules"):
                candidate_dir = data_dir / subdir
                if candidate_dir.is_dir():
                    for match in candidate_dir.rglob(basename):
                        if match.is_file():
                            return match.resolve()
            # Slow fallback: limited rglob on full data_dir
            count = 0
            for match in data_dir.rglob(basename):
                if match.is_file():
                    return match.resolve()
                count += 1
                if count >= 20:
                    break
            return None

        if p.is_absolute():
            target = p.resolve()

            if not target.exists() or not target.is_file():
                found_abs = _find_image_in_data_dir(p.name)
                if found_abs is not None:
                    target = found_abs
        else:
            candidate = (_headless_app_ctx.data_dir / normalized).resolve()
            if candidate.exists() and candidate.is_file():
                target = candidate
            else:
                found = _find_image_in_data_dir(p.name)
                if found is None:
                    return jsonify({"ok": False, "error": "image_not_found"}), 404
                target = found

        if not target.exists() or not target.is_file():
            logger.info(
                "[HTTP] local-image not found: raw=%s normalized=%s resolved=%s",
                raw_path,
                normalized,
                target,
            )
            return jsonify({"ok": False, "error": "image_not_found"}), 404

        if not _is_within_data_dir(target):
            logger.warning(
                "[HTTP] local-image rejected path outside data_dir: raw=%s resolved=%s",
                raw_path,
                target,
            )
            return jsonify({"ok": False, "error": "image_not_found"}), 404

        logger.debug(
            "[HTTP] local-image serve: raw=%s normalized=%s resolved=%s",
            raw_path,
            normalized,
            target,
        )
        resp = send_file(str(target))
        resp.headers["Cache-Control"] = "private, max-age=3600"
        return resp
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("[HTTP] Failed to serve local image: %s", exc)
        return jsonify({"ok": False, "error": "image_serve_failed"}), 500


# ---------------------------------------------------------------------------
# AI Generation API
# ---------------------------------------------------------------------------


@app.route("/api/editor/ai/status", methods=["GET"])
def ai_status() -> Any:
    """Check AI provider availability and daily limits."""
    if _ai_service is None or not _ai_service.is_configured:
        return jsonify(_attach_editor_feature_flags({
            "ok": True,
            "ai_available": False,
            "active_provider": None,
            "providers": {},
            "daily_limit": {
                "files_remaining": 0,
                "max_files_per_day": 3,
                "resets_at": None,
            },
        }))
    try:
        user_id = _headless_app_ctx.user_id or "default_user"
        result = _ai_service.get_status(user_id)
        return jsonify(_attach_editor_feature_flags(result if isinstance(result, dict) else {"ok": True}))
    except Exception as exc:
        logger.exception("[HTTP] ai/status error: %s", exc)
        return jsonify(_attach_editor_feature_flags({"ok": False, "error": "status_check_failed"})), 500


@app.route("/api/editor/ai/analyze", methods=["POST"])
def ai_analyze() -> Any:
    """Phase 1: Analyze material and return recommendations."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    if _ai_service is None or not _ai_service.is_configured:
        return jsonify(_attach_editor_feature_flags({
            "ok": False,
            "error": "ai_unavailable",
            "provider_chain_attempts": provider_chain_attempts,
            "fallback": "manual",
            "message": "Извините, сервис ИИ-генерации временно недоступен. "
                       "Пожалуйста, попробуйте позже или воспользуйтесь ручным режимом.",
        })), 503

    payload = request.get_json(silent=True) or {}
    material = payload.get("material", "")
    requested_run_id = payload.get("ai_run_id")
    source_file_info = payload.get("source_file_info")
    if source_file_info is not None and not isinstance(source_file_info, dict):
        source_file_info = None

    if not material or not isinstance(material, str):
        return jsonify({"ok": False, "error": "material_required"}), 400

    material = material.strip()
    if len(material) > _ai_service.max_text_length:
        return jsonify({
            "ok": False,
            "error": "material_too_long",
            "message": f"Текст слишком длинный ({len(material)} символов). "
                       f"Максимум — {_ai_service.max_text_length} символов.",
        }), 400

    word_count = len(material.split())
    if word_count < 50:
        return jsonify({
            "ok": False,
            "error": "material_too_short",
            "message": "Слишком мало текста для анализа. Нужно хотя бы 50 слов учебного материала.",
        }), 400

    material_language = _guess_language_code(material)
    output_language_pref = _normalize_output_language_request(payload, material_language)

    try:
        ai_run_id = _safe_ai_run_id(requested_run_id)
        analysis_result, provider_name = _ai_service.analyze_material(
            material,
            target_language_override=output_language_pref.get("effective"),
        )
        provider_chain_attempts = _ai_service.consume_last_provider_chain_attempts()
        if output_language_pref.get("translation_warning"):
            warnings = list(analysis_result.warnings or [])
            if output_language_pref["translation_warning"] not in warnings:
                warnings.append(output_language_pref["translation_warning"])
            analysis_result.warnings = warnings
        analysis_result.target_language = output_language_pref.get("effective") or analysis_result.target_language
        active_provider = getattr(_ai_service, "_active_provider", None)
        provider_model = getattr(active_provider, "model", None) if active_provider else None
        try:
            _ai_run_merge_manifest(
                ai_run_id,
                {
                    "phase": "analyzed",
                    "material_language": material_language,
                    "output_language_mode": output_language_pref.get("mode"),
                    "requested_output_language": output_language_pref.get("requested"),
                    "effective_output_language": output_language_pref.get("effective"),
                    "material_word_count": word_count,
                    "provider_used": provider_name,
                    "provider_model": provider_model,
                    "provider_chain_attempts": provider_chain_attempts,
                    "source_file_info": source_file_info,
                    "source_file_name": (
                        (source_file_info or {}).get("name")
                        or (source_file_info or {}).get("filename")
                    ),
                },
            )
            _ai_run_write_artifact(
                ai_run_id,
                "analysis",
                {
                    "run_id": ai_run_id,
                    "created_at": _utc_now_iso(),
                    "provider_used": provider_name,
                    "provider_model": provider_model,
                    "provider_chain_attempts": provider_chain_attempts,
                    "material_stats": {
                        "word_count": word_count,
                        "char_count": len(material),
                        "language": material_language,
                    },
                    "language_preferences": output_language_pref,
                    "result": analysis_result.to_dict(),
                },
            )
        except Exception:
            logger.exception("[HTTP] Failed to persist ai-run analysis artifact: %s", ai_run_id)
        response = _sanitize_analysis_response_for_client({
            "ok": True,
            "ai_run_id": ai_run_id,
            "provider_used": provider_name,
            "provider_model": provider_model,
            "provider_chain_attempts": provider_chain_attempts,
            "material_language": material_language,
            "output_language_mode": output_language_pref.get("mode"),
            "requested_output_language": output_language_pref.get("requested"),
            "effective_output_language": output_language_pref.get("effective"),
            "output_language_warning": output_language_pref.get("translation_warning"),
            **analysis_result.to_dict(),
        })
        logger.info(
            "[HTTP] ai/analyze: provider=%s units=%d recommendations=%d",
            provider_name,
            len(analysis_result.educational_units),
            len(analysis_result.recommendations),
        )
        _emit_theory_rollout_telemetry(
            "analysis_analyze_success",
            ai_run_id=ai_run_id,
            provider_used=provider_name,
            provider_model=provider_model,
            material_language=material_language,
            output_language=output_language_pref.get("effective"),
            **_analysis_rollout_quality_fields(response),
        )
        return jsonify(response)

    except AnalysisParseError as ve:
        logger.warning("[HTTP] ai/analyze parse failed: %s", ve)
        provider_chain_attempts = _ai_service.consume_last_provider_chain_attempts()
        try:
            _ai_run_merge_manifest(
                ai_run_id,
                {
                    "phase": "analysis_parse_failed",
                    "provider_used": getattr(ve, "provider_name", None),
                    "provider_chain_attempts": provider_chain_attempts,
                    "parse_error": str(ve),
                },
            )
            _ai_run_write_artifact(
                ai_run_id,
                "analysis_parse_error",
                {
                    "run_id": ai_run_id,
                    "created_at": _utc_now_iso(),
                    "provider_used": getattr(ve, "provider_name", None),
                    "error": str(ve),
                    "provider_chain_attempts": provider_chain_attempts,
                    "raw_response_preview": (getattr(ve, "raw_text", "") or "")[:4000],
                    "raw_response": getattr(ve, "raw_text", "") or "",
                    "material_stats": {
                        "word_count": word_count,
                        "char_count": len(material),
                        "language": _guess_language_code(material),
                    },
                },
            )
        except Exception:
            logger.exception("[HTTP] Failed to persist ai-run analysis parse-error artifact: %s", ai_run_id)
        return jsonify({
            "ok": False,
            "error": "analysis_parse_failed",
            "provider_chain_attempts": provider_chain_attempts,
            "message": "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ РѕС‚РІРµС‚ РР.",
        }), 502

    except ValueError as ve:
        logger.warning("[HTTP] ai/analyze parse failed: %s", ve)
        provider_chain_attempts = _ai_service.consume_last_provider_chain_attempts()
        return jsonify({
            "ok": False,
            "error": "analysis_parse_failed",
            "provider_chain_attempts": provider_chain_attempts,
            "message": "Не удалось обработать ответ ИИ.",
        }), 502

    except RuntimeError as re_:
        logger.error("[HTTP] ai/analyze all providers failed: %s", re_)
        provider_chain_attempts = _ai_service.consume_last_provider_chain_attempts()
        return jsonify({
            "ok": False,
            "error": "ai_unavailable",
            "provider_chain_attempts": provider_chain_attempts,
            "fallback": "manual",
            "message": "Извините, сервис ИИ-генерации временно недоступен. "
                       "Пожалуйста, попробуйте позже или воспользуйтесь ручным режимом.",
        }), 503

    except Exception as exc:
        logger.exception("[HTTP] ai/analyze unexpected error: %s", exc)
        provider_chain_attempts = _ai_service.consume_last_provider_chain_attempts()
        return jsonify({"ok": False, "error": "analysis_failed", "provider_chain_attempts": provider_chain_attempts}), 500


@app.route("/api/editor/ai/analyses", methods=["GET"])
def ai_list_analyses() -> Any:
    """List persisted theory analyses (ai_run artifacts with analysis.json)."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403

    try:
        limit_raw = str(request.args.get("limit", "20") or "20").strip()
        try:
            limit = int(limit_raw)
        except ValueError:
            limit = 20
        limit = max(1, min(100, limit))

        rows: List[Tuple[str, Dict[str, Any]]] = []
        root = _ai_runs_root()
        for run_dir in root.iterdir():
            if not run_dir.is_dir():
                continue
            run_id = run_dir.name
            if not _is_valid_ai_run_id(run_id):
                continue

            analysis_artifact = _read_json_file(run_dir / "analysis.json")
            if not isinstance(analysis_artifact, dict):
                continue
            result = analysis_artifact.get("result")
            if not isinstance(result, dict):
                continue

            manifest = _read_json_file(run_dir / "run.json") or {}
            if not isinstance(manifest, dict):
                manifest = {}
            material_stats = analysis_artifact.get("material_stats")
            if not isinstance(material_stats, dict):
                material_stats = {}
            lang_prefs = analysis_artifact.get("language_preferences")
            if not isinstance(lang_prefs, dict):
                lang_prefs = {}

            row = {
                "ai_run_id": run_id,
                "phase": manifest.get("phase") or "analyzed",
                "created_at": analysis_artifact.get("created_at") or manifest.get("created_at"),
                "updated_at": manifest.get("updated_at") or analysis_artifact.get("created_at"),
                "provider_used": analysis_artifact.get("provider_used") or manifest.get("provider_used"),
                "provider_model": analysis_artifact.get("provider_model") or manifest.get("provider_model"),
                "material_language": material_stats.get("language") or manifest.get("material_language"),
                "material_word_count": material_stats.get("word_count") or manifest.get("material_word_count"),
                "material_char_count": material_stats.get("char_count"),
                "output_language_mode": lang_prefs.get("mode") or manifest.get("output_language_mode"),
                "effective_output_language": (
                    lang_prefs.get("effective") or manifest.get("effective_output_language")
                ),
                "requested_output_language": (
                    lang_prefs.get("requested") or manifest.get("requested_output_language")
                ),
                "source_file_name": (
                    manifest.get("source_file_name")
                    or ((manifest.get("source_file_info") or {}).get("name") if isinstance(manifest.get("source_file_info"), dict) else None)
                ),
                "has_analysis": True,
                "analysis_schema_version": result.get("analysis_schema_version"),
                "report_blocks_version": result.get("report_blocks_version"),
                "units_count": len(result.get("educational_units") or []),
                "recommendations_count": len(result.get("recommendations") or []),
                "learning_chunks_count": len(result.get("learning_chunks") or []),
                "authoring_routes_count": len(result.get("authoring_routes") or []),
                "future_capabilities_count": len(result.get("future_capabilities") or []),
                "microcards_candidates_count": len(result.get("microcards_candidates") or []),
                "warnings_count": len(result.get("warnings") or []),
                "human_summary": result.get("human_summary"),
            }
            sort_key = str(row.get("updated_at") or row.get("created_at") or "")
            rows.append((sort_key, row))

        rows.sort(key=lambda item: (item[0], item[1].get("ai_run_id") or ""), reverse=True)
        return jsonify({"ok": True, "items": [row for _, row in rows[:limit]]})
    except Exception as exc:
        logger.exception("[HTTP] ai/analyses list error: %s", exc)
        return jsonify({"ok": False, "error": "ai_runs_list_failed"}), 500


@app.route("/api/editor/ai/analyses/<run_id>", methods=["GET"])
def ai_get_analysis_run(run_id: str) -> Any:
    """Reopen a persisted theory analysis by ai_run_id."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    if not _is_valid_ai_run_id(run_id):
        return jsonify({"ok": False, "error": "invalid_ai_run_id"}), 400

    try:
        payload = _ai_run_build_reopen_analysis_response(run_id)
        if payload is None:
            return jsonify({"ok": False, "error": "analysis_not_found"}), 404
        _emit_theory_rollout_telemetry(
            "analysis_payload_served",
            ai_run_id=run_id,
            source="reopen",
            **_analysis_rollout_quality_fields(payload),
        )
        return jsonify(payload)
    except Exception as exc:
        logger.exception("[HTTP] ai/analyses open error run_id=%s: %s", run_id, exc)
        return jsonify({"ok": False, "error": "analysis_reopen_failed"}), 500


@app.route("/api/editor/ai/analyses/<run_id>/coverage", methods=["GET"])
def ai_get_analysis_topic_coverage(run_id: str) -> Any:
    """Coverage + grounding summary for one editor topic against a selected ai_run analysis."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    if not _is_editor_feature_enabled("analysis_coverage_in_editor"):
        return _feature_disabled_json("analysis_coverage_disabled", status_code=404)
    if not _is_valid_ai_run_id(run_id):
        return jsonify({"ok": False, "error": "invalid_ai_run_id"}), 400

    module_id = str(request.args.get("module_id") or "").strip()
    topic_id = str(request.args.get("topic_id") or "").strip()
    if not module_id:
        return jsonify({"ok": False, "error": "module_id_required"}), 400
    if not topic_id:
        return jsonify({"ok": False, "error": "topic_id_required"}), 400

    try:
        payload = _build_ai_analysis_topic_coverage_response(run_id, module_id, topic_id)
        if payload is None:
            return jsonify({"ok": False, "error": "analysis_not_found"}), 404
        summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
        _emit_theory_rollout_telemetry(
            "analysis_coverage_served",
            ai_run_id=run_id,
            module_id=module_id,
            topic_id=topic_id,
            tasks_total=summary.get("tasks_total"),
            tasks_linked_in_scope=summary.get("tasks_linked_in_scope"),
            must_cover_units_uncovered=summary.get("must_cover_units_uncovered"),
            weak_grounding_tasks=summary.get("weak_grounding_tasks"),
        )
        return jsonify(payload)
    except ValueError as exc:
        # StorageService may raise on invalid ids.
        logger.warning("[HTTP] ai/analyses coverage invalid ids run_id=%s: %s", run_id, exc)
        return jsonify({"ok": False, "error": "invalid_topic_ref"}), 400
    except LookupError as exc:
        if str(exc) == "topic_not_found":
            return jsonify({"ok": False, "error": "topic_not_found"}), 404
        logger.warning("[HTTP] ai/analyses coverage lookup failed run_id=%s: %s", run_id, exc)
        return jsonify({"ok": False, "error": "coverage_lookup_failed"}), 404
    except Exception as exc:
        logger.exception("[HTTP] ai/analyses coverage error run_id=%s: %s", run_id, exc)
        return jsonify({"ok": False, "error": "analysis_coverage_failed"}), 500


@app.route("/api/editor/theory/rollout/status", methods=["GET"])
def theory_rollout_status() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    include_telemetry = str(request.args.get("include_telemetry") or "").strip().lower() in {"1", "true", "yes", "on"}
    try:
        telemetry_limit = max(1, min(int(request.args.get("telemetry_limit") or 5000), 20000))
    except Exception:
        telemetry_limit = 5000
    payload = _build_theory_rollout_status_payload(
        include_inventory=True,
        include_telemetry=include_telemetry,
        telemetry_limit=telemetry_limit,
    )
    return jsonify({"ok": True, "rollout": payload})


@app.route("/api/editor/theory/rollout/telemetry", methods=["GET"])
def theory_rollout_telemetry() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    try:
        limit = max(1, min(int(request.args.get("limit") or 5000), 20000))
    except Exception:
        limit = 5000
    telemetry = _build_theory_rollout_telemetry_summary(limit=limit)
    rollout = _build_theory_rollout_status_payload(include_inventory=False, include_telemetry=False)
    return jsonify({"ok": True, "rollout": rollout, "telemetry": telemetry})


# ── M14: Microcards Productization Rollout endpoints ──────────────────


@app.route("/api/microcards/rollout/status", methods=["GET"])
def microcards_prod_rollout_status() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    include_telemetry = str(request.args.get("include_telemetry") or "").strip().lower() in {"1", "true", "yes", "on"}
    try:
        telemetry_limit = max(1, min(int(request.args.get("telemetry_limit") or 5000), 20000))
    except Exception:
        telemetry_limit = 5000
    payload = _build_microcards_prod_rollout_status_payload(
        include_telemetry=include_telemetry,
        telemetry_limit=telemetry_limit,
    )
    return jsonify({"ok": True, "rollout": payload})


@app.route("/api/microcards/rollout/telemetry", methods=["GET"])
def microcards_prod_rollout_telemetry() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    try:
        limit = max(1, min(int(request.args.get("limit") or 5000), 20000))
    except Exception:
        limit = 5000
    telemetry = _build_microcards_prod_telemetry_summary(limit=limit)
    rollout = _build_microcards_prod_rollout_status_payload(include_telemetry=False)
    return jsonify({"ok": True, "rollout": rollout, "telemetry": telemetry})


@app.route("/api/microcards/runtime/telemetry", methods=["POST"])
def microcards_runtime_telemetry() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    payload = request.get_json(silent=True) or {}
    event_name = str(payload.get("event") or "").strip()
    allowed_events = {
        "microcards_runtime_opened",
        "microcards_runtime_session_started",
        "microcards_runtime_session_completed",
    }
    if event_name not in allowed_events:
        return jsonify({"ok": False, "error": "invalid_event"}), 400
    fields = payload.get("fields") if isinstance(payload.get("fields"), dict) else {}
    _emit_microcards_prod_telemetry(event_name, **fields)
    return jsonify({"ok": True, "event": event_name})


@app.route("/api/microcards/summary", methods=["GET"])
def microcards_summary() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)

    include_dynamics = str(request.args.get("include_dynamics") or "").strip().lower() in {"1", "true", "yes", "on"}
    force_refresh = str(request.args.get("force_refresh") or "").strip().lower() in {"1", "true", "yes", "on"}
    try:
        dynamics_days = max(1, min(int(request.args.get("days") or 30), 3650))
    except Exception:
        dynamics_days = 30

    try:
        user_id = _headless_app_ctx.user_id or "default_user"
        svc = _microcards_analytics_service()
        payload = svc.get_summary(
            user_id=user_id,
            force_refresh=force_refresh,
            include_dynamics=include_dynamics,
            dynamics_days=dynamics_days,
        )
        payload["microcards_feature_flags"] = _get_microcards_prod_feature_flags()
        return jsonify({"ok": True, **payload})
    except Exception as exc:
        logger.exception("[HTTP] microcards summary failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_summary_failed"}), 500


@app.route("/api/editor/microcards/decks", methods=["GET"])
def microcards_list_decks() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    try:
        limit = max(1, min(int(request.args.get("limit") or 50), 200))
    except Exception:
        limit = 50
    try:
        svc = _microcards_service()
        items = svc.list_decks(limit=limit)
        _emit_theory_rollout_telemetry(
            "microcards_decks_listed",
            items_count=len(items),
            limit=limit,
        )
        return jsonify({"ok": True, "items": items, "user_id": _headless_app_ctx.user_id})
    except Exception as exc:
        logger.exception("[HTTP] microcards/decks list failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_list_failed"}), 500


@app.route("/api/editor/microcards/decks/<string:deck_id>", methods=["GET"])
def microcards_get_deck(deck_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    try:
        svc = _microcards_service()
        deck = svc.get_deck(deck_id)
        if not isinstance(deck, dict):
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
        _emit_theory_rollout_telemetry(
            "microcards_deck_opened",
            deck_id=deck_id,
            cards_total=len(deck.get("cards") or []) if isinstance(deck.get("cards"), list) else 0,
        )
        return jsonify({"ok": True, "deck": deck, "user_id": _headless_app_ctx.user_id})
    except Exception as exc:
        logger.exception("[HTTP] microcards/decks/%s get failed: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_get_failed"}), 500


@app.route("/api/editor/microcards/decks/from-analysis", methods=["POST"])
def microcards_create_deck_from_analysis() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    run_id = str(payload.get("ai_run_id") or "").strip()
    if not run_id:
        return jsonify({"ok": False, "error": "ai_run_id_required"}), 400
    if not _is_valid_ai_run_id(run_id):
        return jsonify({"ok": False, "error": "invalid_ai_run_id"}), 400

    try:
        analysis_payload = _ai_run_build_reopen_analysis_response(run_id, apply_feature_flags=False)
        if analysis_payload is None:
            return jsonify({"ok": False, "error": "analysis_not_found"}), 404
        selector = payload.get("selector") if isinstance(payload.get("selector"), dict) else {}
        if bool(selector.get("pair_match_only")) and not _is_editor_feature_enabled("microcards_pair_match"):
            return _feature_disabled_json("microcards_pair_match_disabled", status_code=400)
        deck_name = payload.get("name")
        analysis_payload = _sanitize_analysis_for_microcards_backend(analysis_payload)
        svc = _microcards_service()
        deck = svc.create_deck_from_analysis(
            analysis_payload,
            ai_run_id=run_id,
            selector=selector,
            deck_name=str(deck_name).strip() if isinstance(deck_name, str) else None,
        )
        _invalidate_microcards_analytics_cache(_headless_app_ctx.user_id or "default_user")
        cards = deck.get("cards") if isinstance(deck.get("cards"), list) else []
        pair_match_cards = sum(
            1
            for c in cards
            if isinstance(c, dict) and str(c.get("card_type") or "").strip().lower() == "pair_match"
        )
        _emit_theory_rollout_telemetry(
            "microcards_deck_created_from_analysis",
            ai_run_id=run_id,
            deck_id=deck.get("id"),
            cards_total=len(cards),
            pair_match_cards=pair_match_cards,
            selector_scope=(selector.get("scope") if isinstance(selector, dict) else None),
            pair_match_only=bool(selector.get("pair_match_only")) if isinstance(selector, dict) else False,
        )
        return jsonify(
            {
                "ok": True,
                "deck": deck,
                "deck_summary": {
                    "id": deck.get("id"),
                    "name": deck.get("name"),
                    "cards_total": len(deck.get("cards") or []),
                    "selector": deck.get("selector") or {},
                },
                "user_id": _headless_app_ctx.user_id,
            }
        )
    except Exception as exc:
        logger.exception("[HTTP] microcards/decks/from-analysis failed run_id=%s: %s", run_id, exc)
        return jsonify({"ok": False, "error": "microcards_create_failed"}), 500


@app.route("/api/editor/microcards/decks/<string:deck_id>/append-from-analysis", methods=["POST"])
def microcards_append_to_deck_from_analysis(deck_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    run_id = str(payload.get("ai_run_id") or "").strip()
    if not run_id:
        return jsonify({"ok": False, "error": "ai_run_id_required"}), 400
    if not _is_valid_ai_run_id(run_id):
        return jsonify({"ok": False, "error": "invalid_ai_run_id"}), 400
    try:
        analysis_payload = _ai_run_build_reopen_analysis_response(run_id, apply_feature_flags=False)
        if analysis_payload is None:
            return jsonify({"ok": False, "error": "analysis_not_found"}), 404
        selector = payload.get("selector") if isinstance(payload.get("selector"), dict) else {}
        if bool(selector.get("pair_match_only")) and not _is_editor_feature_enabled("microcards_pair_match"):
            return _feature_disabled_json("microcards_pair_match_disabled", status_code=400)
        analysis_payload = _sanitize_analysis_for_microcards_backend(analysis_payload)
        svc = _microcards_service()
        result = svc.append_cards_from_analysis_to_deck(
            deck_id=deck_id,
            analysis_payload=analysis_payload,
            ai_run_id=run_id,
            selector=selector,
        )
        _invalidate_microcards_analytics_cache(_headless_app_ctx.user_id or "default_user")
        deck = result.get("deck") if isinstance(result.get("deck"), dict) else {}
        _emit_theory_rollout_telemetry(
            "microcards_deck_appended_from_analysis",
            ai_run_id=run_id,
            deck_id=deck_id,
            added_cards=int(result.get("added_cards") or 0),
            skipped_duplicates=int(result.get("skipped_duplicates") or 0),
            selector_scope=(selector.get("scope") if isinstance(selector, dict) else None),
            pair_match_only=bool(selector.get("pair_match_only")) if isinstance(selector, dict) else False,
        )
        return jsonify(
            {
                "ok": True,
                "deck": deck,
                "deck_summary": {
                    "id": deck.get("id"),
                    "name": deck.get("name"),
                    "cards_total": len(deck.get("cards") or []),
                    "selector": deck.get("selector") or {},
                },
                "added_cards": int(result.get("added_cards") or 0),
                "skipped_duplicates": int(result.get("skipped_duplicates") or 0),
                "user_id": _headless_app_ctx.user_id,
            }
        )
    except LookupError as exc:
        if str(exc) == "deck_not_found":
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
        logger.warning("[HTTP] microcards append lookup failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_append_lookup_failed"}), 404
    except Exception as exc:
        logger.exception("[HTTP] microcards append failed deck_id=%s run_id=%s: %s", deck_id, run_id, exc)
        return jsonify({"ok": False, "error": "microcards_append_failed"}), 500


@app.route("/api/editor/microcards/decks/<string:deck_id>/queue", methods=["GET"])
def microcards_get_deck_queue(deck_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    try:
        limit = max(1, min(int(request.args.get("limit") or 20), 100))
    except Exception:
        limit = 20
    restart = str(request.args.get("restart") or "").strip().lower() in {"1", "true", "yes", "on"}
    try:
        svc = _microcards_service()
        queue_payload = svc.get_due_queue(deck_id, limit=limit, resume=True, restart=restart)
        session = queue_payload.get("session") if isinstance(queue_payload.get("session"), dict) else {}
        cursor_val = int(queue_payload.get("cursor") or 0)
        _emit_theory_rollout_telemetry(
            "microcards_queue_opened",
            deck_id=deck_id,
            limit=limit,
            restart=restart,
            resumed_session=bool(session.get("id")) and not restart and cursor_val > 0,
            cursor=cursor_val,
            queue_count=int(queue_payload.get("queue_count") or 0),
            current_card_type=(
                (queue_payload.get("current_card") or {}).get("card_type")
                if isinstance(queue_payload.get("current_card"), dict)
                else None
            ),
        )
        return jsonify({"ok": True, **queue_payload, "user_id": _headless_app_ctx.user_id})
    except LookupError as exc:
        if str(exc) == "deck_not_found":
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
        logger.warning("[HTTP] microcards queue lookup failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_queue_lookup_failed"}), 404
    except Exception as exc:
        logger.exception("[HTTP] microcards/decks/%s/queue failed: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_queue_failed"}), 500


@app.route("/api/editor/microcards/review/submit", methods=["POST"])
def microcards_submit_review() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    deck_id = str(payload.get("deck_id") or "").strip()
    card_id = str(payload.get("card_id") or "").strip()
    rating = str(payload.get("rating") or "").strip().lower()
    session_id = str(payload.get("session_id") or "").strip() or None
    if not deck_id:
        return jsonify({"ok": False, "error": "deck_id_required"}), 400
    if not card_id:
        return jsonify({"ok": False, "error": "card_id_required"}), 400
    if rating not in {"again", "hard", "good", "easy"}:
        return jsonify({"ok": False, "error": "invalid_rating"}), 400

    try:
        svc = _microcards_service()
        result = svc.submit_review(
            deck_id=deck_id,
            card_id=card_id,
            rating=rating,
            session_id=session_id,
            response=payload.get("response"),
            response_time_ms=payload.get("response_time_ms") if isinstance(payload.get("response_time_ms"), int) else None,
        )
        try:
            _orchestrate_microcards_review_post_submit(
                deck_id=deck_id,
                card_id=card_id,
                review_result=result if isinstance(result, dict) else {},
            )
        except Exception as orchestration_exc:
            logger.warning(
                "[HTTP] M1 microcards post-submit orchestration failed (non-fatal): %s",
                orchestration_exc,
            )
        review_event = result.get("review_event") if isinstance(result.get("review_event"), dict) else {}
        details = review_event.get("details") if isinstance(review_event.get("details"), dict) else {}
        _emit_theory_rollout_telemetry(
            "microcards_review_submitted",
            deck_id=deck_id,
            card_id=card_id,
            rating=rating,
            card_type=details.get("card_type"),
            was_correct=review_event.get("was_correct"),
            partial_score=details.get("partial_score"),
            session_id=review_event.get("session_id"),
        )
        return jsonify({"ok": True, **result, "user_id": _headless_app_ctx.user_id})
    except LookupError as exc:
        if str(exc) == "deck_not_found":
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
        if str(exc) == "card_not_found":
            return jsonify({"ok": False, "error": "card_not_found"}), 404
        if str(exc) == "session_not_found":
            return jsonify({"ok": False, "error": "session_not_found"}), 404
        logger.warning("[HTTP] microcards review lookup failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_review_lookup_failed"}), 404
    except ValueError as exc:
        err = str(exc)
        if err in {
            "session_deck_mismatch",
            "session_completed",
            "session_queue_exhausted",
            "session_card_mismatch",
        }:
            return jsonify({"ok": False, "error": err}), 409
        logger.warning("[HTTP] microcards review invalid submit: %s", exc)
        return jsonify({"ok": False, "error": "microcards_review_invalid_submit"}), 400
    except Exception as exc:
        logger.exception("[HTTP] microcards review submit failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_review_submit_failed"}), 500


# ── M11: Manual deck/card CRUD endpoints ──────────────────────────────


@app.route("/api/editor/microcards/decks/create-manual", methods=["POST"])
def microcards_create_deck_manual() -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    if not _is_microcards_prod_feature_enabled("microcards_manual_editor"):
        return _microcards_prod_feature_disabled_json("microcards_manual_editor_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name_required"}), 400
    tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []
    target_language = str(payload.get("target_language") or "unknown").strip()
    try:
        svc = _microcards_service()
        deck = svc.create_deck_manual(name=name, tags=tags, target_language=target_language)
        _invalidate_microcards_analytics_cache(_headless_app_ctx.user_id or "default_user")
        _emit_theory_rollout_telemetry(
            "microcards_manual_deck_created",
            deck_id=deck.get("id"),
            name=name,
        )
        _emit_microcards_prod_telemetry(
            "microcards_manual_deck_created",
            deck_id=deck.get("id"),
            name=name,
        )
        return jsonify({"ok": True, "deck": deck, "user_id": _headless_app_ctx.user_id})
    except Exception as exc:
        logger.exception("[HTTP] microcards create-manual failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_create_manual_failed"}), 500


@app.route("/api/editor/microcards/decks/<string:deck_id>/rename", methods=["POST"])
def microcards_rename_deck(deck_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    if not _is_microcards_prod_feature_enabled("microcards_manual_editor"):
        return _microcards_prod_feature_disabled_json("microcards_manual_editor_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    new_name = str(payload.get("name") or "").strip()
    if not new_name:
        return jsonify({"ok": False, "error": "name_required"}), 400
    try:
        svc = _microcards_service()
        deck = svc.rename_deck(deck_id, new_name)
        return jsonify({"ok": True, "deck": deck, "user_id": _headless_app_ctx.user_id})
    except LookupError:
        return jsonify({"ok": False, "error": "deck_not_found"}), 404
    except Exception as exc:
        logger.exception("[HTTP] microcards rename failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_rename_failed"}), 500


@app.route("/api/editor/microcards/decks/<string:deck_id>/archive", methods=["POST"])
def microcards_archive_deck(deck_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    if not _is_microcards_prod_feature_enabled("microcards_manual_editor"):
        return _microcards_prod_feature_disabled_json("microcards_manual_editor_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    archive = payload.get("archive", True)
    try:
        svc = _microcards_service()
        deck = svc.archive_deck(deck_id, archive=bool(archive))
        _invalidate_microcards_analytics_cache(_headless_app_ctx.user_id or "default_user")
        return jsonify({"ok": True, "deck": deck, "user_id": _headless_app_ctx.user_id})
    except LookupError:
        return jsonify({"ok": False, "error": "deck_not_found"}), 404
    except Exception as exc:
        logger.exception("[HTTP] microcards archive failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_archive_failed"}), 500


@app.route("/api/editor/microcards/decks/<string:deck_id>", methods=["DELETE"])
def microcards_delete_deck(deck_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    if not _is_microcards_prod_feature_enabled("microcards_manual_editor"):
        return _microcards_prod_feature_disabled_json("microcards_manual_editor_disabled", status_code=404)
    try:
        svc = _microcards_service()
        deleted = svc.delete_deck(deck_id)
        if not deleted:
            return jsonify({"ok": False, "error": "deck_not_found"}), 404
        _invalidate_microcards_analytics_cache(_headless_app_ctx.user_id or "default_user")
        return jsonify({"ok": True, "deleted": True, "user_id": _headless_app_ctx.user_id})
    except Exception as exc:
        logger.exception("[HTTP] microcards delete failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_delete_failed"}), 500


@app.route("/api/editor/microcards/decks/<string:deck_id>/cards", methods=["POST"])
def microcards_create_card(deck_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    if not _is_microcards_prod_feature_enabled("microcards_manual_editor"):
        return _microcards_prod_feature_disabled_json("microcards_manual_editor_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    card_type = str(payload.get("card_type") or "fact_recall").strip().lower()
    front_text = str(payload.get("front_text") or "").strip()
    tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []
    difficulty_hint = str(payload.get("difficulty_hint") or "medium").strip()
    if not front_text:
        return jsonify({"ok": False, "error": "front_text_required"}), 400
    try:
        svc = _microcards_service()
        if card_type == "pair_match":
            # M15: pair_match card creation
            pairs = payload.get("pairs")
            if not isinstance(pairs, list):
                return jsonify({"ok": False, "error": "pairs_required"}), 400
            card = svc.create_pair_match_card_manual(
                deck_id=deck_id,
                front_text=front_text,
                pairs=pairs,
                tags=tags,
                difficulty_hint=difficulty_hint,
            )
            _invalidate_microcards_analytics_cache(_headless_app_ctx.user_id or "default_user")
            _emit_theory_rollout_telemetry(
                "microcards_pair_match_card_created",
                deck_id=deck_id,
                card_id=card.get("id"),
            )
        else:
            back_text = str(payload.get("back_text") or "").strip()
            if not back_text:
                return jsonify({"ok": False, "error": "back_text_required"}), 400
            card = svc.create_card_manual(
                deck_id=deck_id,
                front_text=front_text,
                back_text=back_text,
                tags=tags,
                difficulty_hint=difficulty_hint,
            )
            _invalidate_microcards_analytics_cache(_headless_app_ctx.user_id or "default_user")
            _emit_theory_rollout_telemetry(
                "microcards_manual_card_created",
                deck_id=deck_id,
                card_id=card.get("id"),
            )
        return jsonify({"ok": True, "card": card, "user_id": _headless_app_ctx.user_id})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        err = str(exc)
        status = 409 if err == "duplicate_card" else 400
        return jsonify({"ok": False, "error": err}), status
    except Exception as exc:
        logger.exception("[HTTP] microcards create card failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_create_card_failed"}), 500


@app.route("/api/editor/microcards/decks/<string:deck_id>/cards/<string:card_id>", methods=["PUT"])
def microcards_update_card(deck_id: str, card_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    if not _is_microcards_prod_feature_enabled("microcards_manual_editor"):
        return _microcards_prod_feature_disabled_json("microcards_manual_editor_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    card_type = str(payload.get("card_type") or "").strip().lower()
    try:
        svc = _microcards_service()
        # M15: pair_match card update with structured pairs
        if card_type == "pair_match" or "pairs" in payload:
            pm_kwargs: dict = {}
            if "front_text" in payload:
                pm_kwargs["front_text"] = str(payload["front_text"] or "").strip() or None
            if "pairs" in payload:
                pm_kwargs["pairs"] = payload["pairs"] if isinstance(payload["pairs"], list) else None
            if "tags" in payload:
                pm_kwargs["tags"] = payload["tags"] if isinstance(payload["tags"], list) else None
            if "difficulty_hint" in payload:
                pm_kwargs["difficulty_hint"] = str(payload["difficulty_hint"] or "").strip() or None
            if "status" in payload:
                pm_kwargs["status"] = str(payload["status"] or "").strip() or None
            card = svc.update_pair_match_card(deck_id=deck_id, card_id=card_id, **pm_kwargs)
            _invalidate_microcards_analytics_cache(_headless_app_ctx.user_id or "default_user")
            _emit_theory_rollout_telemetry(
                "microcards_pair_match_card_updated",
                deck_id=deck_id,
                card_id=card_id,
            )
        else:
            kwargs: dict = {}
            if "front_text" in payload:
                kwargs["front_text"] = str(payload["front_text"] or "").strip() or None
            if "back_text" in payload:
                kwargs["back_text"] = str(payload["back_text"] or "").strip() or None
            if "tags" in payload:
                kwargs["tags"] = payload["tags"] if isinstance(payload["tags"], list) else None
            if "difficulty_hint" in payload:
                kwargs["difficulty_hint"] = str(payload["difficulty_hint"] or "").strip() or None
            if "status" in payload:
                kwargs["status"] = str(payload["status"] or "").strip() or None
            card = svc.update_card(deck_id=deck_id, card_id=card_id, **kwargs)
            _invalidate_microcards_analytics_cache(_headless_app_ctx.user_id or "default_user")
        return jsonify({"ok": True, "card": card, "user_id": _headless_app_ctx.user_id})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        err = str(exc)
        status = 409 if err == "duplicate_card" else 400
        return jsonify({"ok": False, "error": err}), status
    except Exception as exc:
        logger.exception("[HTTP] microcards update card failed deck=%s card=%s: %s", deck_id, card_id, exc)
        return jsonify({"ok": False, "error": "microcards_update_card_failed"}), 500


@app.route("/api/editor/microcards/decks/<string:deck_id>/cards/<string:card_id>", methods=["DELETE"])
def microcards_delete_card(deck_id: str, card_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    if not _is_microcards_prod_feature_enabled("microcards_manual_editor"):
        return _microcards_prod_feature_disabled_json("microcards_manual_editor_disabled", status_code=404)
    try:
        svc = _microcards_service()
        svc.delete_card(deck_id, card_id)
        _invalidate_microcards_analytics_cache(_headless_app_ctx.user_id or "default_user")
        return jsonify({"ok": True, "deleted": True, "user_id": _headless_app_ctx.user_id})
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("[HTTP] microcards delete card failed deck=%s card=%s: %s", deck_id, card_id, exc)
        return jsonify({"ok": False, "error": "microcards_delete_card_failed"}), 500


@app.route("/api/editor/microcards/decks/<string:deck_id>/reorder-cards", methods=["POST"])
def microcards_reorder_cards(deck_id: str) -> Any:
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    if not _is_microcards_prod_feature_enabled("microcards_manual_editor"):
        return _microcards_prod_feature_disabled_json("microcards_manual_editor_disabled", status_code=404)
    payload = request.get_json(silent=True) or {}
    card_ids = payload.get("card_ids")
    if not isinstance(card_ids, list) or not card_ids:
        return jsonify({"ok": False, "error": "card_ids_required"}), 400
    try:
        svc = _microcards_service()
        deck = svc.reorder_cards(deck_id, card_ids)
        return jsonify({
            "ok": True,
            "deck_summary": {
                "id": deck.get("id"),
                "name": deck.get("name"),
                "cards_total": len(deck.get("cards") or []),
            },
            "user_id": _headless_app_ctx.user_id,
        })
    except LookupError:
        return jsonify({"ok": False, "error": "deck_not_found"}), 404
    except Exception as exc:
        logger.exception("[HTTP] microcards reorder failed deck_id=%s: %s", deck_id, exc)
        return jsonify({"ok": False, "error": "microcards_reorder_failed"}), 500


# ── M12: Microcards text import endpoints ──────────────────────────────


@app.route("/api/editor/microcards/import/parse-text", methods=["POST"])
def microcards_import_parse_text() -> Any:
    """Parse @MICROCARD text and return preview payload."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    if not _is_microcards_prod_feature_enabled("microcards_text_import"):
        return _microcards_prod_feature_disabled_json("microcards_text_import_disabled", status_code=404)
    if not PARSERS_AVAILABLE:
        return jsonify({"ok": False, "error": "parsers_not_available"}), 500

    payload = request.get_json(silent=True) or {}
    text = payload.get("text", "")
    if not text or not isinstance(text, str):
        return jsonify({"ok": False, "error": "text_required"}), 400

    try:
        parser = MicrocardParser()
        result = parser.parse_text(text)

        _emit_theory_rollout_telemetry(
            "microcards_text_import_parsed",
            total=result.get("summary", {}).get("total", 0),
            valid=result.get("summary", {}).get("valid", 0),
            errors=result.get("summary", {}).get("errors", 0),
        )
        _emit_microcards_prod_telemetry(
            "microcards_text_import_parsed",
            total=result.get("summary", {}).get("total", 0),
            valid=result.get("summary", {}).get("valid", 0),
            errors=result.get("summary", {}).get("errors", 0),
        )

        logger.info(
            "[HTTP] microcards/import/parse-text: total=%s valid=%s errors=%s",
            result.get("summary", {}).get("total", 0),
            result.get("summary", {}).get("valid", 0),
            result.get("summary", {}).get("errors", 0),
        )
        return jsonify(result)

    except Exception as exc:
        logger.exception("[HTTP] microcards import parse-text failed: %s", exc)
        _emit_theory_rollout_telemetry(
            "microcards_text_import_parse_error",
            error=str(exc)[:200],
        )
        _emit_microcards_prod_telemetry(
            "microcards_text_import_parse_error",
            error=str(exc)[:200],
        )
        return jsonify({"ok": False, "error": "microcards_parse_failed"}), 500


@app.route("/api/editor/microcards/import/execute-text", methods=["POST"])
def microcards_import_execute_text() -> Any:
    """Execute microcards text import — create or append to deck."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_microcards"}), 403
    if not _is_editor_feature_enabled("microcards_mode"):
        return _feature_disabled_json("microcards_mode_disabled", status_code=404)
    if not _is_microcards_prod_feature_enabled("microcards_text_import"):
        return _microcards_prod_feature_disabled_json("microcards_text_import_disabled", status_code=404)

    payload = request.get_json(silent=True) or {}
    items = payload.get("items")
    mode = str(payload.get("mode", "create_deck")).strip()
    target_deck_id = str(payload.get("target_deck_id") or "").strip() or None
    deck_name = str(payload.get("deck_name") or "").strip() or None
    target_language = str(payload.get("target_language") or "unknown").strip()

    if not isinstance(items, list) or not items:
        return jsonify({"ok": False, "error": "items_required"}), 400
    if mode not in ("create_deck", "append_to_deck"):
        return jsonify({"ok": False, "error": "invalid_mode"}), 400
    if mode == "append_to_deck" and not target_deck_id:
        return jsonify({"ok": False, "error": "target_deck_id_required"}), 400

    try:
        svc = _microcards_service()
        result = svc.import_cards_from_parsed(
            parsed_items=items,
            mode=mode,
            target_deck_id=target_deck_id,
            deck_name=deck_name,
            target_language=target_language,
        )
        _invalidate_microcards_analytics_cache(_headless_app_ctx.user_id or "default_user")

        deck = result.get("deck") if isinstance(result.get("deck"), dict) else {}
        _emit_theory_rollout_telemetry(
            "microcards_text_import_executed",
            mode=mode,
            deck_id=deck.get("id"),
            added_cards=result.get("added_cards", 0),
            skipped_duplicates=result.get("skipped_duplicates", 0),
            skipped_errors=result.get("skipped_errors", 0),
        )
        _emit_microcards_prod_telemetry(
            "microcards_text_import_executed",
            mode=mode,
            deck_id=deck.get("id"),
            added_cards=result.get("added_cards", 0),
            skipped_duplicates=result.get("skipped_duplicates", 0),
            skipped_errors=result.get("skipped_errors", 0),
        )

        logger.info(
            "[HTTP] microcards/import/execute-text: mode=%s deck=%s added=%s dupes=%s errors=%s",
            mode,
            deck.get("id"),
            result.get("added_cards", 0),
            result.get("skipped_duplicates", 0),
            result.get("skipped_errors", 0),
        )
        return jsonify({
            "ok": True,
            "mode": mode,
            "deck_id": deck.get("id"),
            "deck_name": deck.get("name"),
            "added_cards": result.get("added_cards", 0),
            "skipped_duplicates": result.get("skipped_duplicates", 0),
            "skipped_errors": result.get("skipped_errors", 0),
            "user_id": _headless_app_ctx.user_id,
        })

    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("[HTTP] microcards import execute-text failed: %s", exc)
        return jsonify({"ok": False, "error": "microcards_execute_failed"}), 500


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


@app.route("/api/editor/ai/upload", methods=["POST"])
def ai_upload() -> Any:
    """Upload a file (PDF/DOCX/TXT) and extract text via FileProcessor."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_use_ai"}), 403
    if _ai_service is None or not _ai_service.is_configured:
        return jsonify({"ok": False, "error": "ai_unavailable"}), 503
    if _file_processor is None:
        return jsonify({"ok": False, "error": "file_processor_unavailable"}), 500

    user_id = _headless_app_ctx.user_id or "default_user"

    # Check daily limit
    allowed, remaining, max_files = _ai_service.check_daily_limit(user_id)
    if not allowed:
        return jsonify({
            "ok": False,
            "error": "daily_limit_exceeded",
            "message": f"Вы уже загрузили {max_files} файлов сегодня — это максимум на сутки. "
                       "Лимит обновится завтра в 00:00.",
        }), 429

    if "file" not in request.files:
        return jsonify({"ok": False, "error": "file_required"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"ok": False, "error": "file_required"}), 400

    file_bytes = file.read()
    result = _file_processor.process_file(file_bytes, file.filename)

    if not result.ok:
        # Map error codes to HTTP status codes
        _ERROR_STATUS = {
            "file_too_large": 400,
            "unsupported_format": 400,
            "file_empty": 400,
            "no_text_layer": 400,
            "too_few_words": 400,
            "server_missing_library": 500,
            "extraction_failed": 500,
        }
        status = _ERROR_STATUS.get(result.error_code, 400)
        return jsonify({
            "ok": False,
            "error": result.error_code,
            "message": result.error_message,
        }), status

    # Increment daily counter
    _ai_service.increment_daily_usage(user_id)

    logger.info(
        "[HTTP] ai/upload: file=%s format=%s size=%sMB words=%d",
        file.filename,
        result.file_info.get("format", "?"),
        result.file_info.get("size_mb", "?"),
        result.word_count,
    )

    return jsonify({
        "ok": True,
        "extracted_text": result.extracted_text,
        "word_count": result.word_count,
        "file_info": result.file_info,
        "warnings": result.warnings,
    })


# ---------------------------------------------------------------------------
# Task Import API
# ---------------------------------------------------------------------------


def _get_parser_for_marker(marker: str):
    """Get appropriate parser for task type marker."""
    if not PARSERS_AVAILABLE:
        return None

    _PARSER_REGISTRY = {
        "@OPEN_ANSWER": OpenAnswerParser,
        "@SEQUENCE": SequenceParser,
        "@CLICK_TEXT": ClickTextParser,
        "@CLICK_WORDS": ClickWordsParser,
        "@TEST": TestImportParser,
    }
    marker = marker.strip().upper()
    cls = _PARSER_REGISTRY.get(marker)
    return cls() if cls else None


def _word_ranges(text: str) -> List[tuple[int, int]]:
    import re

    if not isinstance(text, str) or not text:
        return []
    return [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]


_IMPORT_EXECUTE_IDEMPOTENCY_LOCK = threading.Lock()
_IMPORT_EXECUTE_IDEMPOTENCY_CACHE: Dict[str, Dict[str, Any]] = {}
_IMPORT_EXECUTE_IDEMPOTENCY_TTL_SECONDS = 15 * 60


def _utc_now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _canonicalize_test_questions(questions: Any) -> tuple[List[Dict[str, Any]], str]:
    """Normalize TEST questions to backend schema (`correct`) and infer test_type."""
    if not isinstance(questions, list):
        return [], "single_choice"

    normalized_questions: List[Dict[str, Any]] = []
    has_multiple_correct = False

    for q_idx, q in enumerate(questions):
        if not isinstance(q, dict):
            continue
        normalized_answers: List[Dict[str, Any]] = []
        correct_count = 0
        for a_idx, ans in enumerate(q.get("answers", []) or []):
            if not isinstance(ans, dict):
                continue
            is_correct = bool(ans.get("correct", ans.get("is_correct", False)))
            if is_correct:
                correct_count += 1
            normalized_answer = dict(ans)
            normalized_answer["correct"] = is_correct
            normalized_answer["is_correct"] = is_correct
            if not normalized_answer.get("id"):
                normalized_answer["id"] = f"q{q_idx + 1}_a{a_idx + 1}"
            normalized_answers.append(normalized_answer)
        if correct_count > 1:
            has_multiple_correct = True
        normalized_q = dict(q)
        normalized_q["answers"] = normalized_answers
        if "id" not in normalized_q:
            normalized_q["id"] = q_idx
        normalized_questions.append(normalized_q)

    return normalized_questions, ("multiple_choice" if has_multiple_correct else "single_choice")


def _stable_json_hash(data: Any) -> str:
    try:
        raw = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except Exception:
        raw = str(data)
    return hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()


def _cleanup_import_idempotency_cache() -> None:
    now = time.time()
    stale_keys = [
        key for key, item in _IMPORT_EXECUTE_IDEMPOTENCY_CACHE.items()
        if now - float(item.get("created_ts", 0)) > _IMPORT_EXECUTE_IDEMPOTENCY_TTL_SECONDS
    ]
    for key in stale_keys:
        _IMPORT_EXECUTE_IDEMPOTENCY_CACHE.pop(key, None)


def _import_idempotency_get(idempotency_key: str, request_fingerprint: str) -> Optional[Dict[str, Any]]:
    if not idempotency_key:
        return None
    with _IMPORT_EXECUTE_IDEMPOTENCY_LOCK:
        _cleanup_import_idempotency_cache()
        item = _IMPORT_EXECUTE_IDEMPOTENCY_CACHE.get(idempotency_key)
        if not item:
            return None
        if item.get("request_fingerprint") != request_fingerprint:
            return {"conflict": True}
        if item.get("in_progress"):
            return {"in_progress": True}
        cached_response = dict(item.get("response") or {})
        cached_response["idempotent_replay"] = True
        return cached_response


def _import_idempotency_reserve(idempotency_key: str, request_fingerprint: str) -> Optional[Dict[str, Any]]:
    if not idempotency_key:
        return None
    with _IMPORT_EXECUTE_IDEMPOTENCY_LOCK:
        _cleanup_import_idempotency_cache()
        item = _IMPORT_EXECUTE_IDEMPOTENCY_CACHE.get(idempotency_key)
        if item:
            if item.get("request_fingerprint") != request_fingerprint:
                return {"conflict": True}
            if item.get("in_progress"):
                return {"in_progress": True}
            cached_response = dict(item.get("response") or {})
            cached_response["idempotent_replay"] = True
            return cached_response
        _IMPORT_EXECUTE_IDEMPOTENCY_CACHE[idempotency_key] = {
            "created_ts": time.time(),
            "request_fingerprint": request_fingerprint,
            "in_progress": True,
            "response": None,
        }
        return None


def _import_idempotency_store(idempotency_key: str, request_fingerprint: str, response: Dict[str, Any]) -> None:
    if not idempotency_key:
        return
    with _IMPORT_EXECUTE_IDEMPOTENCY_LOCK:
        _cleanup_import_idempotency_cache()
        _IMPORT_EXECUTE_IDEMPOTENCY_CACHE[idempotency_key] = {
            "created_ts": time.time(),
            "request_fingerprint": request_fingerprint,
            "in_progress": False,
            "response": dict(response or {}),
        }


def _import_idempotency_release(idempotency_key: str, request_fingerprint: str) -> None:
    if not idempotency_key:
        return
    with _IMPORT_EXECUTE_IDEMPOTENCY_LOCK:
        item = _IMPORT_EXECUTE_IDEMPOTENCY_CACHE.get(idempotency_key)
        if not item:
            return
        if item.get("request_fingerprint") == request_fingerprint and item.get("in_progress"):
            _IMPORT_EXECUTE_IDEMPOTENCY_CACHE.pop(idempotency_key, None)


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


def _format_task_preview(
    task: Dict[str, Any], index: int, validation_issues: List[Dict]
) -> Dict[str, Any]:
    """Format task for preview response."""
    task_type = task.get("type", "unknown")

    # Determine status based on validation issues
    has_errors = any(issue.get("severity") == "error" for issue in validation_issues)
    has_warnings = any(issue.get("severity") == "warning" for issue in validation_issues)

    if has_errors:
        status = "error"
    elif has_warnings:
        status = "warning"
    else:
        status = "valid"

    # Keep full task payload in preview so execute step can save without data loss.
    raw_data = task.get("data", {})
    if not isinstance(raw_data, dict):
        raw_data = {}
    preview_data = (
        _normalize_click_import_data(raw_data) if task_type == "click" else dict(raw_data)
    )
    if not preview_data.get("prompt"):
        preview_data["prompt"] = task.get("prompt", "")

    if task_type == "sequence_assembly":
        elements = preview_data.get("elements", {})
        levels = preview_data.get("levels", {})
        preview_data["elements_count"] = len(elements) if hasattr(elements, "__len__") else 0
        preview_data["levels_count"] = len(levels) if hasattr(levels, "__len__") else 0
    elif task_type == "click":
        mode = preview_data.get("mode", "")
        if mode == "text_choice":
            options = preview_data.get("options", [])
            preview_data["options_count"] = len(options) if isinstance(options, list) else 0
            preview_data["correct_count"] = sum(
                1
                for opt in (options if isinstance(options, list) else [])
                if isinstance(opt, dict) and bool(opt.get("is_correct", opt.get("correct", False)))
            )
            preview_data["mode"] = "text_choice"
        elif mode in ("text_errors", "word_errors"):
            spans = preview_data.get("error_spans", [])
            indices = preview_data.get("error_indices", [])
            preview_data["text_length"] = len(str(preview_data.get("text", "")))
            preview_data["error_count"] = (
                len(spans)
                if isinstance(spans, list) and spans
                else (len(indices) if isinstance(indices, list) else 0)
            )
            preview_data["mode"] = "text_errors"
    elif task_type == "test":
        questions = preview_data.get("questions", [])
        preview_data["question_count"] = len(questions) if isinstance(questions, list) else 0

    return {
        "index": index,
        "type": task_type,
        "name": task.get("name", f"Task #{index + 1}"),
        "status": status,
        "data": preview_data,
        "validation": {"issues": validation_issues},
    }


def _generate_unique_task_ids(
    storage_service: StorageService, module_id: str, topic_id: str, count: int
) -> List[str]:
    """Generate `count` unique task IDs in one batch (O(1) calls to storage)."""
    import uuid

    existing_tasks = storage_service.get_tasks(module_id, topic_id)
    existing_ids = {t.get("id") for t in existing_tasks}
    ids: List[str] = []
    while len(ids) < count:
        task_id = f"task_{uuid.uuid4().hex[:12]}"
        if task_id not in existing_ids:
            existing_ids.add(task_id)
            ids.append(task_id)
    return ids


def _save_task_to_storage(
    task: Dict[str, Any],
    module_id: str,
    topic_id: str,
    task_id: str,
    modules_dir: Path,
    import_context: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Save task to file system.

    Args:
        task: Task data to save
        module_id: Module ID
        topic_id: Topic ID
        task_id: Task ID
        data_dir: Data directory path

    Returns:
        True if successful, False otherwise
    """
    try:
        import_context = import_context if isinstance(import_context, dict) else {}
        import_source = str(import_context.get("source") or "text").strip().lower() or "text"
        ai_run_id = str(import_context.get("ai_run_id") or "").strip() or None

        # Create task directory
        task_dir = modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        task_dir.mkdir(parents=True, exist_ok=True)

        # Prepare task.json data
        now_iso = datetime.now().isoformat()
        task_json_data = {
            "id": task_id,
            "name": task.get("name", task_id),
            "type": task.get("type", "unknown"),
            "description": "",
            "meta": {
                "created_at": now_iso,
                "imported": True,
                "import_date": now_iso,
                "import_source": import_source,
                "module": module_id,
                "topic": topic_id,
                "id": task_id,
                "name": task.get("name", task_id),
                "task_schema_version": CURRENT_SCHEMA_VERSION,
            },
        }

        # Merge parser-provided metadata into meta/content
        task_metadata = task.get("data", {}).get("metadata", {})
        if task_metadata:
            if "difficulty" in task_metadata:
                task_json_data["meta"]["difficulty"] = task_metadata["difficulty"]
            if "tags" in task_metadata:
                task_json_data["meta"]["tags"] = task_metadata["tags"]
            for extra_key in ("max_length", "time_limit", "case_sensitive"):
                if extra_key in task_metadata:
                    task_json_data["meta"][extra_key] = task_metadata[extra_key]
            for passthrough_key in ("language", "source_file_name"):
                if passthrough_key in task_metadata and passthrough_key not in task_json_data["meta"]:
                    task_json_data["meta"][passthrough_key] = task_metadata[passthrough_key]

        if ai_run_id:
            task_json_data["meta"]["ai_run_id"] = ai_run_id
        ai_provider = import_context.get("ai_provider")
        if ai_provider:
            task_json_data["meta"]["ai_provider"] = ai_provider
        ai_model = import_context.get("ai_model")
        if ai_model:
            task_json_data["meta"]["ai_model"] = ai_model
        source_file_info = import_context.get("source_file_info")
        if isinstance(source_file_info, dict):
            source_file_name = source_file_info.get("name") or source_file_info.get("filename")
            if source_file_name:
                task_json_data["meta"]["source_file_name"] = source_file_name
        source_file_name = import_context.get("source_file_name")
        if source_file_name and not task_json_data["meta"].get("source_file_name"):
            task_json_data["meta"]["source_file_name"] = source_file_name

        task_ai_meta = task.get("ai_meta")
        if isinstance(task_ai_meta, dict):
            unit_ids = task_ai_meta.get("educational_unit_ids")
            if isinstance(unit_ids, list) and unit_ids:
                task_json_data["meta"]["educational_unit_ids"] = list(unit_ids)
            source_grounding = task_ai_meta.get("source_grounding")
            if isinstance(source_grounding, dict):
                grounded_meta = {}
                if source_grounding.get("primary_unit_id") is not None:
                    grounded_meta["primary_unit_id"] = source_grounding.get("primary_unit_id")
                if source_grounding.get("primary_unit_title"):
                    grounded_meta["primary_unit_title"] = source_grounding.get("primary_unit_title")
                if isinstance(source_grounding.get("score"), (int, float)):
                    grounded_meta["score"] = float(source_grounding.get("score"))
                if isinstance(source_grounding.get("shared_token_count"), int):
                    grounded_meta["shared_token_count"] = int(source_grounding.get("shared_token_count"))
                if isinstance(source_grounding.get("shared_number_count"), int):
                    grounded_meta["shared_number_count"] = int(source_grounding.get("shared_number_count"))
                if isinstance(source_grounding.get("weak"), bool):
                    grounded_meta["weak"] = bool(source_grounding.get("weak"))
                if grounded_meta:
                    task_json_data["meta"]["source_grounding"] = grounded_meta
            if task_ai_meta.get("provider_used") and not task_json_data["meta"].get("ai_provider"):
                task_json_data["meta"]["ai_provider"] = task_ai_meta.get("provider_used")
            if task_ai_meta.get("run_id") and not task_json_data["meta"].get("ai_run_id"):
                task_json_data["meta"]["ai_run_id"] = task_ai_meta.get("run_id")

        # Add type-specific data
        if task.get("type") == "open_answer":
            oa_data = task.get("data", {})
            oa_content = {
                "question": oa_data.get("question", task.get("prompt", "")),
                "prompt": oa_data.get("question", task.get("prompt", "")),
            }
            if oa_data.get("keywords"):
                oa_content["keywords"] = oa_data["keywords"]
            if oa_data.get("reference_answer"):
                oa_content["reference_answer"] = oa_data["reference_answer"]
            if oa_data.get("max_length"):
                oa_content["max_length"] = oa_data["max_length"]
            if isinstance(oa_data.get("min_keywords"), int):
                oa_content["min_keywords"] = oa_data["min_keywords"]
            if isinstance(oa_data.get("require_all_keywords"), bool):
                oa_content["require_all_keywords"] = oa_data["require_all_keywords"]
            task_json_data["content"] = oa_content
        elif task.get("type") == "sequence_assembly":
            data = task.get("data", {})
            # Convert to editor format
            sequence = []
            levels = data.get("levels", {})
            for level_num in sorted(levels.keys(), key=lambda k: int(k)):
                level_elements = levels[level_num]
                level_items = []
                for element_id in level_elements:
                    element_text = data.get("elements", {}).get(element_id, element_id)
                    level_items.append({"id": element_id, "label": element_text})
                sequence.append(
                    {
                        "id": f"level_{level_num}",
                        "title": f"Level {level_num}",
                        "items": level_items,
                    }
                )

            task_json_data["content"] = {
                "prompt": task.get("prompt", ""),
                "sequence": sequence,
                "order_inside_matters": True,
                "level_order_matters": True,
            }
        elif task.get("type") == "click":
            data = _normalize_click_import_data(task.get("data", {}))
            task_json_data["subtype"] = data.get("subtype", "error_detection")

            if data.get("mode") == "text_choice":
                task_json_data["content"] = {
                    "prompt": task.get("prompt", ""),
                    "mode": "text_choice",
                    "subtype": "error_detection",
                    "options": data.get("options", []),
                }
            elif data.get("mode") == "text_errors":
                content = {
                    "prompt": task.get("prompt", ""),
                    "mode": "text_errors",
                    "subtype": "error_detection",
                    "text": data.get("text", ""),
                    "error_spans": data.get("error_spans", []),
                }
                if isinstance(data.get("required_correct"), int):
                    content["required_correct"] = data.get("required_correct")
                if isinstance(data.get("reference_text"), str):
                    content["reference_text"] = data.get("reference_text")
                if isinstance(data.get("reference_spans"), list):
                    content["reference_spans"] = data.get("reference_spans")
                task_json_data["content"] = content
            else:
                raise ValueError(f"Unsupported click import mode: {data.get('mode')}")
        elif task.get("type") == "test":
            data = task.get("data", {})
            questions, inferred_test_type = _canonicalize_test_questions(data.get("questions", []))
            requested_test_type = str(data.get("test_type") or "").strip()
            if requested_test_type in {"single_choice", "multiple_choice"}:
                test_type = (
                    "multiple_choice"
                    if inferred_test_type == "multiple_choice" or requested_test_type == "multiple_choice"
                    else "single_choice"
                )
            else:
                test_type = inferred_test_type
            task_json_data["content"] = {
                "test_type": test_type,
                "questions": questions,
                "settings": data.get(
                    "settings",
                    {
                        "shuffle_questions": True,
                        "shuffle_answers": True,
                        "time_limit": None,
                        "passing_score": 70,
                    },
                ),
            }

        # Save task.json
        task_json_path = task_dir / "task.json"
        with open(task_json_path, "w", encoding="utf-8") as f:
            json.dump(task_json_data, f, indent=2, ensure_ascii=False)

        logger.info(f"[HTTP] Saved imported task: {module_id}/{topic_id}/{task_id}")
        return True

    except Exception as exc:
        logger.exception(f"[HTTP] Failed to save task {task_id}: {exc}")
        return False


@app.route("/api/editor/tasks/delete", methods=["POST"])
def delete_editor_tasks() -> Any:
    """Delete tasks from the editor."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.get_json(silent=True) or {}
        tasks = payload.get("tasks", [])

        if not tasks:
            return jsonify({"ok": False, "error": "no_tasks_provided"}), 400

        deleted_count = 0
        errors = []

        for task_info in tasks:
            module_id = task_info.get("module_id")
            topic_id = task_info.get("topic_id")
            task_id = task_info.get("task_id")

            if not module_id or not topic_id or not task_id:
                errors.append(f"Invalid task data: {task_info}")
                continue

            success = _headless_app_ctx.storage_service.delete_task(module_id, topic_id, task_id)
            if success:
                deleted_count += 1
            else:
                errors.append(f"Failed to delete {task_id}")

        return jsonify({"ok": True, "deleted": deleted_count, "errors": errors})

    except Exception as exc:
        logger.exception("[HTTP] Failed to delete tasks: %s", exc)
        return jsonify({"ok": False, "error": "delete_failed"}), 500


@app.route("/api/editor/export/text", methods=["POST"])
def export_tasks_to_text() -> Any:
    """Export selected tasks back to marker text format."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_export"}), 403
    payload = request.get_json(silent=True) or {}
    task_refs = payload.get("tasks", [])
    if not task_refs:
        return jsonify({"ok": False, "error": "no_tasks"}), 400

    storage = _headless_app_ctx.storage_service
    lines: List[str] = []

    for ref in task_refs:
        mid = ref.get("module_id")
        tid = ref.get("topic_id")
        task_id = ref.get("task_id")
        if not mid or not tid or not task_id:
            continue
        task_path = storage.modules_dir / mid / "topics" / tid / "tasks" / task_id / "task.json"
        if not task_path.exists():
            continue
        try:
            with open(task_path, "r", encoding="utf-8") as f:
                td = json.load(f)
        except Exception:
            continue

        ttype = td.get("type", "")
        content = td.get("content", {})
        if not isinstance(content, dict):
            continue

        if ttype == "open_answer":
            lines.append("@OPEN_ANSWER")
            lines.append(f"# {content.get('question', content.get('prompt', ''))}")
            if content.get("reference_answer"):
                lines.append(f"= {content['reference_answer']}")
            for kw in content.get("keywords", []):
                lines.append(f"* {kw}")
            lines.append("")
        elif ttype == "sequence_assembly":
            lines.append("@SEQUENCE")
            lines.append(f"# {content.get('prompt', '')}")
            seq = content.get("sequence", [])
            elem_idx = 1
            for level in seq:
                for item in level.get("items", []):
                    lines.append(f"element_{elem_idx}: {item.get('label', '')}")
                    elem_idx += 1
            level_idx = 1
            elem_counter = 1
            for level in seq:
                ids = []
                for item in level.get("items", []):
                    ids.append(f"element_{elem_counter}")
                    elem_counter += 1
                lines.append(f"level_{level_idx}: {', '.join(ids)}")
                level_idx += 1
            lines.append("")
        elif ttype == "click":
            mode = content.get("mode", "")
            if mode == "text_choice":
                lines.append("@CLICK_TEXT")
                lines.append(f"# {content.get('prompt', '')}")
                for opt in content.get("options", []):
                    prefix = "+" if opt.get("is_correct") else "-"
                    lines.append(f"{prefix} {opt.get('text', '')}")
                lines.append("")
            elif mode in ("text_errors", "word_errors"):
                lines.append("@CLICK_WORDS")
                lines.append(f"# {content.get('prompt', '')}")
                raw_text = content.get("text", "")
                error_spans = content.get("error_spans", [])
                if error_spans and isinstance(error_spans, list):
                    # Rebuild text with [brackets] around error spans (sorted desc to preserve offsets)
                    sorted_spans = sorted(
                        [
                            s
                            for s in error_spans
                            if isinstance(s, dict)
                            and isinstance(s.get("start"), int)
                            and isinstance(s.get("end"), int)
                        ],
                        key=lambda s: s["start"],
                        reverse=True,
                    )
                    marked = raw_text
                    for span in sorted_spans:
                        start, end = span["start"], span["end"]
                        if 0 <= start < end <= len(marked):
                            marked = marked[:start] + "[" + marked[start:end] + "]" + marked[end:]
                    lines.append(marked)
                else:
                    lines.append(raw_text)
                lines.append("")
            else:
                # Unsupported click mode (e.g. draw) — skip with comment
                logger.warning(
                    f"[export/text] Skipping unsupported click mode: {mode} for task {task_id}"
                )
                lines.append(f"# [Пропущено: неподдерживаемый режим click — {mode}]")
                lines.append("")
        elif ttype == "test":
            lines.append("@TEST")
            if content.get("prompt"):
                lines.append(f"# {content['prompt']}")
            for q in content.get("questions", []):
                lines.append(f"? {q.get('text', '')}")
                for a in q.get("answers", []):
                    prefix = "+" if a.get("is_correct", a.get("correct")) else "-"
                    lines.append(f"{prefix} {a.get('text', '')}")
                lines.append("")

    return jsonify({"ok": True, "text": "\n".join(lines)})


@app.route("/api/editor/modules/delete", methods=["POST"])
def delete_editor_module() -> Any:
    """Delete a module via editor."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.get_json(silent=True) or {}
        module_id = payload.get("module_id")

        if not module_id:
            return jsonify({"ok": False, "error": "module_id_required"}), 400

        success = _headless_app_ctx.storage_service.delete_module(module_id)
        if success:
            return jsonify({"ok": True})
        else:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": "module_delete_failed",
                        "message": "Module not found or could not be deleted",
                    }
                ),
                404,
            )

    except Exception as exc:
        logger.exception("[HTTP] Failed to delete module %s: %s", payload.get("module_id"), exc)
        return jsonify({"ok": False, "error": "delete_failed"}), 500


@app.route("/api/editor/topics/delete", methods=["POST"])
def delete_editor_topic() -> Any:
    """Delete a topic via editor."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.get_json(silent=True) or {}
        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")

        if not module_id or not topic_id:
            return jsonify({"ok": False, "error": "module_id_and_topic_id_required"}), 400

        success = _headless_app_ctx.storage_service.delete_topic(module_id, topic_id)
        if success:
            return jsonify({"ok": True})
        else:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": "topic_delete_failed",
                        "message": "Topic not found or could not be deleted",
                    }
                ),
                404,
            )

    except Exception as exc:
        logger.exception(
            "[HTTP] Failed to delete topic %s/%s: %s",
            payload.get("module_id"),
            payload.get("topic_id"),
            exc,
        )
        return jsonify({"ok": False, "error": "delete_failed"}), 500


@app.route("/api/editor/module/rename", methods=["POST"])
def rename_editor_module() -> Any:
    """Rename a module (change display name, keep folder ID)."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.get_json(silent=True) or {}
        module_id = payload.get("module_id")
        new_name = payload.get("name", "").strip()

        if not module_id or not new_name:
            return jsonify({"ok": False, "error": "module_id_and_name_required"}), 400

        success = _headless_app_ctx.storage_service.rename_module(module_id, new_name)
        if success:
            return jsonify({"ok": True})
        else:
            return jsonify({"ok": False, "error": "rename_failed"}), 404
    except Exception as exc:
        logger.exception("[HTTP] Failed to rename module %s: %s", payload.get("module_id"), exc)
        return jsonify({"ok": False, "error": "rename_failed"}), 500


@app.route("/api/editor/topic/rename", methods=["POST"])
def rename_editor_topic() -> Any:
    """Rename a topic (change display name, keep folder ID)."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_edit"}), 403
    try:
        payload = request.get_json(silent=True) or {}
        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")
        new_name = payload.get("name", "").strip()

        if not module_id or not topic_id or not new_name:
            return jsonify({"ok": False, "error": "module_id_topic_id_and_name_required"}), 400

        success = _headless_app_ctx.storage_service.rename_topic(module_id, topic_id, new_name)
        if success:
            return jsonify({"ok": True})
        else:
            return jsonify({"ok": False, "error": "rename_failed"}), 404
    except Exception as exc:
        logger.exception(
            "[HTTP] Failed to rename topic %s/%s: %s",
            payload.get("module_id"),
            payload.get("topic_id"),
            exc,
        )
        return jsonify({"ok": False, "error": "rename_failed"}), 500


@app.route("/api/editor/import/parse", methods=["POST"])
def import_parse() -> Any:
    """Parse text with tasks and return preview."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403
    if not PARSERS_AVAILABLE:
        return jsonify({"ok": False, "error": "parsers_not_available"}), 500

    payload = request.get_json(silent=True) or {}

    try:
        # Validate payload
        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")
        text = payload.get("text", "")

        if not module_id or not topic_id:
            return jsonify({"ok": False, "error": "module_id_and_topic_id_required"}), 400

        if not text or not isinstance(text, str):
            return jsonify({"ok": False, "error": "text_required"}), 400

        # Detect markers and parse
        all_tasks = []
        all_parsing_errors = []
        marker_counts = {}
        all_warnings = []  # (global_index, warning_dict)
        supported_markers = ("@OPEN_ANSWER", "@SEQUENCE", "@CLICK_TEXT", "@CLICK_WORDS", "@TEST")
        excluded_markers = ("@DRAW",)

        import re

        def _has_marker_line(raw_text: str, marker: str) -> bool:
            pattern = rf"(?mi)^\s*{re.escape(marker)}(?:\s|$)"
            return re.search(pattern, raw_text) is not None

        found_excluded = [marker for marker in excluded_markers if _has_marker_line(text, marker)]
        if found_excluded:
            all_parsing_errors.append(
                "Маркеры "
                + ", ".join(found_excluded)
                + " не поддерживаются в текстовом импорте. "
                + "Используйте только: "
                + ", ".join(supported_markers)
                + "."
            )

        # Try each parser
        parsers = [
            ("@OPEN_ANSWER", OpenAnswerParser()),
            ("@SEQUENCE", SequenceParser()),
            ("@CLICK_TEXT", ClickTextParser()),
            ("@CLICK_WORDS", ClickWordsParser()),
            ("@TEST", TestImportParser()),
        ]

        for marker, parser in parsers:
            if _has_marker_line(text, marker):
                try:
                    global_offset = len(all_tasks)
                    tasks = parser.parse_text(text)
                    all_tasks.extend(tasks)

                    # Track counts by type
                    for task in tasks:
                        task_type = task.get("type", "unknown")
                        marker_counts[task_type] = marker_counts.get(task_type, 0) + 1

                    # Collect warnings with corrected global indices
                    for warning in parser.warnings:
                        local_idx = warning.get("index", 0)
                        all_warnings.append((global_offset + local_idx, warning))

                    # Collect parsing errors
                    if parser.errors:
                        all_parsing_errors.extend(parser.errors)

                except Exception as parse_exc:
                    logger.exception(f"[HTTP] Parser {marker} failed: {parse_exc}")
                    all_parsing_errors.append(f"Parser {marker} error: {str(parse_exc)}")

        # Validate tasks and build preview
        preview_tasks = []
        valid_count = 0
        warning_count = 0
        error_count = 0

        for i, task in enumerate(all_tasks):
            task_type = task.get("type")
            task_data = task.get("data", {})

            # Add parser-level validation issues (using corrected global indices)
            validation_issues = []
            for global_idx, warning in all_warnings:
                if global_idx == i:
                    validation_issues.append(
                        {
                            "severity": warning.get("severity", "warning"),
                            "message": warning.get("message", ""),
                            "field": warning.get("code", "unknown"),
                        }
                    )

            # Validate using TaskType validators
            try:
                validator_issues = _validate_with_task_type(task_type, task_data)
                validation_issues.extend(validator_issues)
            except Exception as e:
                logging.error(f"[Import Parse] Validation error for task {i}: {str(e)}")
                validation_issues.append(
                    {
                        "severity": "error",
                        "message": f"Validation failed: {str(e)}",
                        "field": "general",
                    }
                )

            # Format preview
            preview = _format_task_preview(task, i, validation_issues)
            preview_tasks.append(preview)

            # Update counts
            if preview["status"] == "error":
                error_count += 1
            elif preview["status"] == "warning":
                warning_count += 1
            else:
                valid_count += 1

        # Build summary
        summary = {
            "total": len(all_tasks),
            "valid": valid_count,
            "warnings": warning_count,
            "errors": error_count,
            "by_type": marker_counts,
        }

        # Build response
        response = {
            "ok": True,
            "summary": summary,
            "tasks": preview_tasks,
            "parsing_errors": all_parsing_errors,
            "notes": [],
        }
        response["notes"].append(
            "В текстовом импорте активны маркеры: @OPEN_ANSWER, @SEQUENCE, @CLICK_TEXT, @CLICK_WORDS, @TEST. "
            "Клик поддерживается только для подтипа Ошибки (error_detection). "
            "Рисование (@DRAW) и координатные/полигональные click-задачи не поддерживаются."
        )
        # MISSING-6: Warn about image limitation in text import
        if all_tasks:
            response["notes"].append(
                "Текстовый импорт не поддерживает изображения. "
                "Для задач с изображениями используйте импорт из ZIP-архива."
            )

        logger.info(
            "[HTTP] import/parse: module=%s topic=%s total=%s valid=%s warnings=%s errors=%s",
            module_id,
            topic_id,
            summary["total"],
            summary["valid"],
            summary["warnings"],
            summary["errors"],
        )

        return jsonify(response)

    except Exception as exc:
        logger.exception("[HTTP] Failed to parse import text: %s", exc)
        return jsonify({"ok": False, "error": "parse_failed"}), 500


@app.route("/api/editor/import/execute", methods=["POST"])
def import_execute() -> Any:
    """Execute import - save parsed tasks to storage."""
    if _headless_app_ctx.user_id == "guest":
        return jsonify({"ok": False, "error": "guest_cannot_import"}), 403
    if not PARSERS_AVAILABLE:
        return jsonify({"ok": False, "error": "parsers_not_available"}), 500

    payload = request.get_json(silent=True) or {}

    try:
        # Validate payload
        module_id = payload.get("module_id")
        topic_id = payload.get("topic_id")
        tasks = payload.get("tasks", [])
        import_context = payload.get("import_context", {})
        if not isinstance(import_context, dict):
            import_context = {}
        idempotency_key = str(payload.get("idempotency_key") or "").strip()

        if not module_id or not topic_id:
            return jsonify({"ok": False, "error": "module_id_and_topic_id_required"}), 400

        if not isinstance(tasks, list) or not tasks:
            return jsonify({"ok": False, "error": "tasks_required"}), 400

        request_fingerprint = _stable_json_hash(
            {
                "module_id": module_id,
                "topic_id": topic_id,
                "tasks": [_extract_task_preview_signature(t) for t in tasks],
                "import_context": {
                    "source": import_context.get("source"),
                    "ai_run_id": import_context.get("ai_run_id"),
                },
            }
        )
        cached_response = _import_idempotency_reserve(idempotency_key, request_fingerprint)
        if cached_response:
            if cached_response.get("conflict"):
                return jsonify({"ok": False, "error": "idempotency_key_conflict"}), 409
            if cached_response.get("in_progress"):
                return jsonify({"ok": False, "error": "idempotency_key_in_progress"}), 409
            logger.info(
                "[HTTP] import/execute idempotent replay: module=%s topic=%s key=%s",
                module_id,
                topic_id,
                idempotency_key,
            )
            return jsonify(cached_response)

        # Validate module and topic exist
        storage_service = _headless_app_ctx.storage_service
        module = storage_service.get_module(module_id)
        if not module:
            _import_idempotency_release(idempotency_key, request_fingerprint)
            return jsonify({"ok": False, "error": "module_not_found"}), 400

        topic = storage_service.get_topic(module_id, topic_id)
        if not topic:
            _import_idempotency_release(idempotency_key, request_fingerprint)
            return jsonify({"ok": False, "error": "topic_not_found"}), 400

        # Filter importable tasks
        importable_tasks = [
            (i, task) for i, task in enumerate(tasks) if task.get("status", "unknown") != "error"
        ]

        # Batch-generate unique IDs
        task_ids = _generate_unique_task_ids(
            storage_service, module_id, topic_id, len(importable_tasks)
        )
        modules_dir = storage_service.modules_dir

        imported_ids = []
        errors = []
        saved_dirs = []  # Track saved dirs for rollback

        for idx, (i, task) in enumerate(importable_tasks):
            try:
                task_id = task_ids[idx]

                # Reconstruct full task from preview
                full_task = {
                    "name": task.get("name", f"Task #{i + 1}"),
                    "type": task.get("type", "unknown"),
                    "prompt": task.get("data", {}).get("prompt", ""),
                    "data": task.get("data", {}),
                }
                if isinstance(task.get("ai_meta"), dict):
                    full_task["ai_meta"] = task.get("ai_meta")

                # Save to storage
                success = _save_task_to_storage(
                    full_task,
                    module_id,
                    topic_id,
                    task_id,
                    modules_dir,
                    import_context=import_context,
                )

                if success:
                    imported_ids.append(task_id)
                    saved_dirs.append(
                        modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
                    )
                else:
                    errors.append(f"Failed to save task {i}")
                    # Rollback all previously saved tasks
                    for d in saved_dirs:
                        try:
                            import shutil

                            shutil.rmtree(d, ignore_errors=True)
                        except Exception:
                            pass
                    imported_ids.clear()
                    break

            except Exception as task_exc:
                logger.exception(f"[HTTP] Failed to import task {i}: {task_exc}")
                errors.append(f"Task {i}: {str(task_exc)}")
                # Rollback on exception
                for d in saved_dirs:
                    try:
                        import shutil

                        shutil.rmtree(d, ignore_errors=True)
                    except Exception:
                        pass
                imported_ids.clear()
                break

        # Reload modules cache to pick up new tasks
        storage_service.reload_modules()

        response = {
            "ok": True,
            "imported": len(imported_ids),
            "task_ids": imported_ids,
            "errors": errors,
        }
        if idempotency_key:
            response["idempotency_key"] = idempotency_key
        _import_idempotency_store(idempotency_key, request_fingerprint, response)

        ai_run_id = str(import_context.get("ai_run_id") or "").strip()
        if ai_run_id:
            try:
                _ai_run_write_artifact(
                    ai_run_id,
                    "import",
                    {
                        "run_id": ai_run_id,
                        "created_at": _utc_now_iso(),
                        "module_id": module_id,
                        "topic_id": topic_id,
                        "imported_count": len(imported_ids),
                        "task_ids": imported_ids,
                        "errors": errors,
                        "idempotency_key": idempotency_key or None,
                        "source_context": {
                            "source": import_context.get("source"),
                            "ai_provider": import_context.get("ai_provider"),
                            "source_file_name": (
                                import_context.get("source_file_name")
                                or (import_context.get("source_file_info") or {}).get("name")
                                or (import_context.get("source_file_info") or {}).get("filename")
                            ),
                        },
                    },
                )
                _ai_run_merge_manifest(
                    ai_run_id,
                    {
                        "import_completed_at": _utc_now_iso(),
                        "imported_count": len(imported_ids),
                        "module_id": module_id,
                        "topic_id": topic_id,
                    },
                )
            except Exception:
                logger.exception("[HTTP] Failed to persist ai-run import artifact: %s", ai_run_id)

        logger.info(
            "[HTTP] import/execute: module=%s topic=%s imported=%s errors=%s",
            module_id,
            topic_id,
            len(imported_ids),
            len(errors),
        )

        return jsonify(response)

    except Exception as exc:
        try:
            _import_idempotency_release(
                str((payload or {}).get("idempotency_key") or "").strip(),
                locals().get("request_fingerprint", ""),
            )
        except Exception:
            pass
        logger.exception("[HTTP] Failed to execute import: %s", exc)
        return jsonify({"ok": False, "error": "import_failed"}), 500


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
