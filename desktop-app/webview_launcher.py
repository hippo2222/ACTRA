"""Launcher that runs the Flask HTTP server in background and opens a pywebview window.

This keeps the existing `server.py` unchanged (it can still be run
standalone for development with `python server.py`).

Usage (development):

    python webview_launcher.py

By default it will:
- start the Flask app from `server.py` on http://127.0.0.1:8000
- wait until /health responds
- open a pywebview window with that URL (or S1 URL if TRAINER_SESSION_ID is set).

You can set environment variable TRAINER_SESSION_ID to open S1 directly, e.g.:

    set TRAINER_SESSION_ID=your-session-id-here
    python webview_launcher.py

Later this can be switched to `/ui/complexes` or another start page
when such UI is implemented.
"""

from __future__ import annotations

import os
import sys
import threading
import time
import base64
from typing import Optional, IO
from urllib.request import urlopen
from urllib.error import URLError
import warnings
import socket
from pathlib import Path

import webview  # pywebview

app = None  # will be initialized in main() after console/stdio setup
_REDIRECTED_STDIO_FILE: Optional[IO[str]] = None
PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from task_system.core.logging_config import setup_logging, install_crash_handlers  # type: ignore


def _svg_to_data_uri(path: Path) -> Optional[str]:
    if not path.exists():
        return None
    try:
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    except Exception:
        return None
    return f"data:image/svg+xml;base64,{encoded}"


def _build_splash_logo_html() -> str:
    animated_uri = _svg_to_data_uri(PROJECT_ROOT / "frontend" / "assets" / "logo_animated.svg")
    static_uri = _svg_to_data_uri(PROJECT_ROOT / "frontend" / "assets" / "logo.svg")

    if animated_uri and static_uri:
        return (
            f'<img class="logo-animated" src="{animated_uri}" alt="ACTRA logo" />'
            f'<img class="logo-static" src="{static_uri}" alt="" aria-hidden="true" />'
        )
    if static_uri:
        return f'<img class="logo-static-only" src="{static_uri}" alt="ACTRA logo" />'
    return '<span class="logo-fallback">A</span>'


SPLASH_LOGO_HTML = _build_splash_logo_html()


SPLASH_HTML = """<!doctype html>
<html lang=\"ru\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>ACTRA</title>
    <style>
      :root{--bg:#0b1220;--card:#111a2e;--text:#e6edf7;--muted:#a9b6cc;--accent:#4c8dff;}
      html,body{height:100%;margin:0;font-family:Segoe UI,Inter,system-ui,-apple-system,Arial,sans-serif;background:var(--bg);color:var(--text);}
      .wrap{height:100%;display:flex;align-items:center;justify-content:center;padding:24px;}
      .card{width:min(520px,100%);background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.10);border-radius:16px;padding:28px 26px;box-shadow:0 22px 60px rgba(0,0,0,.35);}
      .row{display:flex;align-items:center;gap:12px;margin-bottom:12px;}
      .logo{width:40px;height:40px;border-radius:10px;background:rgba(76,141,255,.18);display:flex;align-items:center;justify-content:center;border:1px solid rgba(76,141,255,.25);color:var(--accent);}
      .logo img{width:28px;height:28px;object-fit:contain;display:block;}
      .logo .logo-static{display:none;}
      .logo .logo-static-only{display:block;}
      .logo-fallback{font-size:18px;font-weight:800;line-height:1;}
      @media (prefers-reduced-motion: reduce){
        .logo .logo-animated{display:none;}
        .logo .logo-static{display:block;}
      }
      h1{font-size:18px;margin:0;}
      p{margin:10px 0 0 0;color:var(--muted);line-height:1.4;font-size:13.5px;}
      .bar{height:10px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:18px;}
      .bar > div{height:100%;width:35%;background:linear-gradient(90deg,var(--accent),rgba(76,141,255,.5));border-radius:999px;animation:move 1.15s infinite ease-in-out;}
      @keyframes move{0%{transform:translateX(-120%)} 50%{transform:translateX(120%)} 100%{transform:translateX(300%)}}
      .hint{margin-top:12px;font-size:12px;color:rgba(233,240,255,.55)}
    </style>
  </head>
  <body>
    <div class=\"wrap\">
      <div class=\"card\">
        <div class=\"row\">
          <div class=\"logo\">__SPLASH_LOGO__</div>
          <div>
            <h1>ACTRA запускается…</h1>
            <p>Инициализируем движок тренировок и интерфейс.</p>
          </div>
        </div>
        <div class=\"bar\"><div></div></div>
        <div class=\"hint\">Если запуск занимает больше 15 секунд — возможно, порт 8000 занят.</div>
      </div>
    </div>
  </body>
</html>"""

SPLASH_HTML = SPLASH_HTML.replace("__SPLASH_LOGO__", SPLASH_LOGO_HTML)


def _error_html(message: str) -> str:
    safe_msg = (message or "Не удалось запустить приложение.").replace("<", "&lt;").replace(">", "&gt;")
    return f"""<!doctype html>
<html lang=\"ru\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>ACTRA — Ошибка запуска</title>
    <style>
      :root{{--bg:#0b1220;--card:#111a2e;--text:#e6edf7;--muted:#a9b6cc;--accent:#4c8dff;--danger:#ff5a7a;}}
      html,body{{height:100%;margin:0;font-family:Segoe UI,Inter,system-ui,-apple-system,Arial,sans-serif;background:var(--bg);color:var(--text);}}
      .wrap{{height:100%;display:flex;align-items:center;justify-content:center;padding:24px;}}
      .card{{width:min(560px,100%);background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.10);border-radius:16px;padding:28px 26px;box-shadow:0 22px 60px rgba(0,0,0,.35);}}
      h1{{font-size:18px;margin:0;display:flex;align-items:center;gap:10px;}}
      .dot{{width:10px;height:10px;border-radius:50%;background:var(--danger);box-shadow:0 0 0 4px rgba(255,90,122,.12);}}
      p{{margin:10px 0 0 0;color:var(--muted);line-height:1.4;font-size:13.5px;}}
      pre{{margin:14px 0 0 0;white-space:pre-wrap;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.08);padding:12px;border-radius:12px;color:rgba(233,240,255,.85);font-size:12.5px;}}
      .actions{{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;}}
      button{{appearance:none;border:0;border-radius:12px;padding:10px 14px;font-weight:700;cursor:pointer;}}
      .primary{{background:var(--accent);color:white;}}
      .ghost{{background:transparent;color:rgba(233,240,255,.85);border:1px solid rgba(255,255,255,.15);}}
      .note{{margin-top:10px;font-size:12px;color:rgba(233,240,255,.55)}}
    </style>
  </head>
  <body>
    <div class=\"wrap\">
      <div class=\"card\">
        <h1><span class=\"dot\"></span>Не удалось запустить ACTRA</h1>
        <p>Проверь, что порт <b>8000</b> свободен и приложение имеет доступ к папке данных.</p>
        <pre>{safe_msg}</pre>
        <div class=\"actions\">
          <button class=\"primary\" onclick=\"window.pywebview.api.retry()\">Повторить</button>
          <button class=\"ghost\" onclick=\"window.pywebview.api.quit()\">Закрыть</button>
        </div>
        <div class=\"note\">Для отладки можно включить консоль: <code>TRAINER_SHOW_CONSOLE=1</code></div>
      </div>
    </div>
  </body>
</html>"""


def _hide_console_window_if_possible() -> None:
    if os.environ.get("TRAINER_SHOW_CONSOLE") in ("1", "true", "True", "YES", "yes"):
        return

    if sys.platform != "win32":
        return

    try:
        import ctypes  # noqa: PLC0415

        kernel32 = ctypes.windll.kernel32
        user32 = ctypes.windll.user32

        hwnd = kernel32.GetConsoleWindow()
        if hwnd:
            user32.ShowWindow(hwnd, 0)
            try:
                kernel32.FreeConsole()
            except Exception:
                pass
    except Exception:
        return


def _redirect_stdio_if_hidden() -> None:
    if os.environ.get("TRAINER_SHOW_CONSOLE") in ("1", "true", "True", "YES", "yes"):
        return
    global _REDIRECTED_STDIO_FILE
    try:
        log_path = LOG_DIR / "webview_launcher_stdout.log"
        _REDIRECTED_STDIO_FILE = open(log_path, "a", encoding="utf-8")
        sys.stdout = _REDIRECTED_STDIO_FILE  # type: ignore[assignment]
        sys.stderr = _REDIRECTED_STDIO_FILE  # type: ignore[assignment]
    except Exception:
        return


def _quiet_flask_logging() -> None:
    try:
        import logging

        logging.getLogger("werkzeug").setLevel(logging.ERROR)
        pw_logger = logging.getLogger("pywebview")
        pw_logger.setLevel(logging.CRITICAL)
        pw_logger.propagate = False
        pw_logger.disabled = True
        global app
        if app is not None and hasattr(app, "logger"):
            app.logger.setLevel(logging.ERROR)
    except Exception:
        return


def _run_flask_server() -> None:
    """Run the Flask development server in the current process.

    This is executed in a background thread. We disable the reloader and
    debug mode, because pywebview already runs its own event loop.
    """
    
    # FORCED LOG: Function entry
    import logging
    logger = logging.getLogger("launcher")
    logger.info(f"[RUN_FLASK_ENTRY][pid={os.getpid()}] _run_flask_server called")

    global app
    if app is None:
        logger.error("[RUN_FLASK_ENTRY] Flask app is None")
        raise RuntimeError("Flask app is not initialized")
    else:
        logger.info(f"[RUN_FLASK_ENTRY] Flask app is initialized: {type(app)}")

    # Host/port must match what the webview opens
    port = int(os.environ.get("TRAINER_HTTP_PORT") or "8000")
    
    # FORCED LOG: Use working launcher logger instead of server logger
    logger.info(f"[LOGGER_WORKAROUND][pid={os.getpid()}] Using launcher logger, about to start Flask")
    logger.info(f"[FLASK_STARTING][pid={os.getpid()}] About to start Flask on 127.0.0.1:{port}")
    
    try:
        app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)
        logger.info(f"[FLASK_FINISHED][pid={os.getpid()}] app.run returned normally")
    except Exception as e:
        logger.error(f"[FLASK_ERROR][pid={os.getpid()}] app.run failed: {e}")
        raise


def _pick_http_port(preferred: int = 8000) -> int:
    env = os.environ.get("TRAINER_HTTP_PORT")
    if env:
        requested = int(env)
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", requested))
        except OSError as e:
            raise RuntimeError(f"TRAINER_HTTP_PORT={requested} is already in use") from e
        finally:
            try:
                s.close()
            except Exception:
                pass
        return requested

    # Default: enforce a single well-known port so we never attach to a stale server.
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", preferred))
        return preferred
    except OSError as e:
        raise RuntimeError(f"Port {preferred} is already in use") from e
    finally:
        try:
            s.close()
        except Exception:
            pass


def _wait_for_server(url: str, timeout: float = 10.0) -> bool:
    """Wait until the given URL becomes reachable or timeout is exceeded.

    Uses stdlib urllib to avoid extra dependencies.
    """

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urlopen(url, timeout=1.0) as resp:  # nosec B310 - local HTTP
                if 200 <= resp.status < 500:
                    return True
        except URLError:
            time.sleep(0.3)
        except Exception:
            # Any other error: small delay and retry
            time.sleep(0.3)
    return False


def _get_start_url(base_url: str) -> str:
    """Return the UI start URL with cache-busting parameter."""
    from time import time
    cache_buster = int(time() * 1000)  # Current timestamp in ms
    session_id = os.environ.get("TRAINER_SESSION_ID")
    if session_id:
        return f"{base_url}/ui/session/{session_id}?_cb={cache_buster}&force={cache_buster}"
    return f"{base_url}/ui/welcome?_cb={cache_buster}&force={cache_buster}"


def main() -> None:
    import logging

    _hide_console_window_if_possible()
    _redirect_stdio_if_hidden()

    # Reduce noisy warnings in terminal output
    warnings.filterwarnings("ignore", message=r"pkg_resources is deprecated as an API\..*")

    show_console = os.environ.get("TRAINER_SHOW_CONSOLE") in ("1", "true", "True", "YES", "yes")
    setup_logging(app_name="trainer-launcher", log_level=logging.INFO, console=show_console)
    _crash_interval_env = os.environ.get("TRAINER_CRASH_DUMP_INTERVAL")
    try:
        _crash_interval = float(_crash_interval_env) if _crash_interval_env else None
        if _crash_interval is not None and _crash_interval <= 0:
            _crash_interval = None
    except Exception:
        _crash_interval = None
    install_crash_handlers(app_name="trainer-launcher", dump_interval_seconds=_crash_interval)

    # Import server only after we have hidden console and redirected stdout/stderr
    # to avoid warnings/log spam creating or using a console window.
    global app
    from server import app as _flask_app  # type: ignore
    app = _flask_app

    _quiet_flask_logging()

    # Choose a port for THIS run. By default we enforce :8000.
    try:
        port = _pick_http_port(8000)
    except Exception as e:
        # Do not attach to any existing server. Show a clear error instead.
        window_title = "ACTRA"

        class _Api:
            def __init__(self) -> None:
                self.window: Optional[webview.Window] = None

            def retry(self) -> None:
                return

            def quit(self) -> None:
                try:
                    if self.window:
                        self.window.destroy()
                except Exception:
                    return

        api = _Api()
        window = webview.create_window(window_title, html=_error_html(str(e)), js_api=api)
        api.window = window
        webview.start(debug=False)
        return

    os.environ["TRAINER_HTTP_PORT"] = str(port)

    base_url = f"http://127.0.0.1:{port}"
    health_url = f"{base_url}/health"
    start_url = _get_start_url(base_url)

    server_error: dict[str, str] = {}

    def server_thread_target() -> None:
        import logging
        logger = logging.getLogger("launcher")
        logger.info(f"[SERVER_THREAD_STARTING][pid={os.getpid()}] About to call _run_flask_server for port {port}")
        try:
            _run_flask_server()
            logger.info(f"[SERVER_THREAD_FINISHED][pid={os.getpid()}] _run_flask_server returned normally")
        except OSError as e:
            # Port in use detection (Windows: 10048, POSIX: 98)
            logger.error(f"[SERVER_THREAD_ERROR][pid={os.getpid()}] OSError in _run_flask_server: {e}")
            if getattr(e, "errno", None) in (98, 10048):
                server_error["message"] = (
                    f"Порт {port} уже занят другим процессом. "
                    "Закройте другой экземпляр приложения/сервера и попробуйте снова."
                )
            else:
                server_error["message"] = f"Не удалось запустить сервер: {e}"
            return
        except Exception as e:
            logger.error(f"[SERVER_THREAD_ERROR][pid={os.getpid()}] Exception in _run_flask_server: {e}")
            server_error["message"] = f"Не удалось запустить сервер: {e}"
            return

    def wait_and_navigate(window: webview.Window, start_url: str) -> None:
        ok = _wait_for_server(health_url, timeout=15.0)
        if ok:
            window.load_url(start_url)
            return

        msg = server_error.get("message") or f"Timeout waiting for {health_url}"
        window.load_html(_error_html(msg))

    # 1) Start Flask server in background thread
    logger = logging.getLogger("launcher")
    logger.info(f"[THREAD_STARTING][pid={os.getpid()}] About to start Flask thread for port {port}")
    
    flask_thread = threading.Thread(target=server_thread_target, daemon=True)
    flask_thread.start()
    logger.info(f"[THREAD_STARTED][pid={os.getpid()}] Flask thread started for port {port}")

    class _Api:
        def __init__(self) -> None:
            self.window_uid: Optional[int] = None

        def _get_window(self) -> Optional[webview.Window]:
            if self.window_uid is None:
                return None
            try:
                for win in webview.windows:
                    if win.uid == self.window_uid:
                        return win
            except Exception:
                pass
            return None

        def set_window(self, window_uid: int) -> None:
            self.window_uid = window_uid

        def retry(self) -> None:
            window = self._get_window()
            if not window:
                return
            try:
                window.load_html(SPLASH_HTML)
                threading.Thread(target=wait_and_navigate, args=(window, start_url), daemon=True).start()
            except Exception:
                return

        def quit(self) -> None:
            window = self._get_window()
            if not window:
                return
            try:
                window.destroy()
            except Exception:
                return

    api = _Api()

    # 3) Open pywebview window (splash first) with JS API
    window_title = f"ACTRA ({port})"
    
    window = webview.create_window(
        window_title, 
        html=SPLASH_HTML, 
        js_api=api, 
        min_size=(1024, 768)
    )
    api.set_window(window.uid)

    # 3) Wait in background; show error UI on failure
    threading.Thread(target=wait_and_navigate, args=(window, start_url), daemon=True).start()
    webview.start(debug=False)


if __name__ == "__main__":
    main()

