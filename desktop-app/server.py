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
from typing import Any, Dict, List, Optional

from flask import (
    Flask,
    jsonify,
    request,
    send_file,
    send_from_directory,
    after_this_request,
    Response,
    stream_with_context,
)
from urllib.parse import unquote
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

# Directories with HTML UI screens and static assets
S1_UI_DIR = PROJECT_ROOT / "frontend" / "S1"
S2_UI_DIR = PROJECT_ROOT / "frontend" / "S2"
S3_UI_DIR = PROJECT_ROOT / "frontend" / "S3"
MAINSCREEN_UI_DIR = PROJECT_ROOT / "frontend" / "MainScreen"
WELCOME_UI_DIR = PROJECT_ROOT / "frontend" / "Welcome"
COMPLEXES_UI_DIR = PROJECT_ROOT / "frontend" / "Complexes"
TESTUI_DIR = PROJECT_ROOT / "frontend" / "TestUI"
SEQUENCEUI_DIR = PROJECT_ROOT / "frontend" / "SequenceUI"
CLICKUI_DIR = PROJECT_ROOT / "frontend" / "ClickUI"
DRAWUI_DIR = PROJECT_ROOT / "frontend" / "DrawUI"
OPENANSWERUI_DIR = PROJECT_ROOT / "frontend" / "OpenAnswerUI"
MISTAKESUI_DIR = PROJECT_ROOT / "frontend" / "MistakesUI"
EDITOR_UI_DIR = PROJECT_ROOT / "frontend" / "Editor"
CALENDAR_UI_DIR = PROJECT_ROOT / "frontend" / "Calendar"
STATISTICS_UI_DIR = PROJECT_ROOT / "frontend" / "statistics"
ASSETS_DIR = PROJECT_ROOT / "frontend" / "assets"


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
    return PROJECT_ROOT / "frontend" / "legal"


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
    return str(os.environ.get("ACTRA_UPDATE_MANIFEST_URL") or "").strip()


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

    if not internet_online:
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


try:
    import numpy as np  # type: ignore
except Exception:
    np = None


def _json_safe(obj: Any) -> Any:
    if obj is None:
        return None

    if isinstance(obj, (datetime, date)):
        try:
            return obj.isoformat()
        except Exception:
            return str(obj)

    if np is not None:
        try:
            if isinstance(obj, np.generic):
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
        updates_configured = bool(
            _env_bool("ACTRA_UPDATE_CHECK_ENABLED", True) and _update_manifest_url()
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
                    "available_now": updates_configured and internet_online,
                    "requires_internet": True,
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
        stats_list = _headless_app_ctx.statistics_service.get_complex_statistics(user_id)
        for s in stats_list:
            if isinstance(s, dict) and "complex_id" in s:
                complex_stats_map[s["complex_id"]] = s
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
                    "progress": c_stats.get("progress", 0),
                    "solved": c_stats.get("solved", 0),
                    "total": c_stats.get("total", 0),
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
    task: Dict[str, Any], module_id: str, topic_id: str, task_id: str, modules_dir: Path
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
        # Create task directory
        task_dir = modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        task_dir.mkdir(parents=True, exist_ok=True)

        # Prepare task.json data
        task_json_data = {
            "id": task_id,
            "name": task.get("name", task_id),
            "type": task.get("type", "unknown"),
            "description": "",
            "meta": {
                "created_at": datetime.now().isoformat(),
                "imported": True,
                "import_date": datetime.now().isoformat(),
                "import_source": "text",
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
            questions = data.get("questions", [])
            # Determine test_type from questions
            has_multiple = any(
                sum(1 for a in q.get("answers", []) if a.get("correct")) > 1
                for q in questions
                if isinstance(q, dict)
            )
            test_type = "multiple_choice" if has_multiple else "single_choice"
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

        if not module_id or not topic_id:
            return jsonify({"ok": False, "error": "module_id_and_topic_id_required"}), 400

        if not isinstance(tasks, list) or not tasks:
            return jsonify({"ok": False, "error": "tasks_required"}), 400

        # Validate module and topic exist
        storage_service = _headless_app_ctx.storage_service
        module = storage_service.get_module(module_id)
        if not module:
            return jsonify({"ok": False, "error": "module_not_found"}), 400

        topic = storage_service.get_topic(module_id, topic_id)
        if not topic:
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

                # Save to storage
                success = _save_task_to_storage(
                    full_task, module_id, topic_id, task_id, modules_dir
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

        logger.info(
            "[HTTP] import/execute: module=%s topic=%s imported=%s errors=%s",
            module_id,
            topic_id,
            len(imported_ids),
            len(errors),
        )

        return jsonify(response)

    except Exception as exc:
        logger.exception("[HTTP] Failed to execute import: %s", exc)
        return jsonify({"ok": False, "error": "import_failed"}), 500


if __name__ == "__main__":
    # Start watchdog
    watchdog.start()
    try:
        # Default dev server on http://127.0.0.1:8000
        _debug = FLASK_DEBUG_ENABLED
        app.run(host="127.0.0.1", port=8000, debug=_debug, threaded=True)
    finally:
        watchdog.stop()
