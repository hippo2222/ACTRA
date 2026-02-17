import threading
import time
import sys
import traceback
import logging

logger = logging.getLogger(__name__)


class WatchdogService:
    """
    Background service that monitors the application for hangs.

    Features:
    1. Heartbeat: Logs an 'Alive' message periodically to prove the process is running.
    2. Request Monitoring: Tracks active HTTP requests. If a request takes longer
       than `hang_threshold`, it dumps the stack trace of all threads to the log.
    """

    def __init__(self, check_interval: float = 5.0, hang_threshold: float = 30.0, heartbeat_interval: float = 60.0) -> None:
        self.check_interval = check_interval
        self.hang_threshold = hang_threshold
        self.heartbeat_interval = heartbeat_interval

        self._running = False
        self._thread: threading.Thread | None = None
        self._active_requests: dict[int, float] = {}
        self._lock = threading.Lock()
        self._last_heartbeat = 0.0
        self._last_dump: dict[int, float] = {}
        self.repeat_dump_interval = 60.0  # дедуп логов для одного и того же req_id

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, name="WatchdogThread", daemon=True)
        self._thread.start()
        logger.info(
            "WatchdogService started (Threshold: %ss, Heartbeat: %ss)",
            self.hang_threshold,
            self.heartbeat_interval,
        )

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)

    def start_request(self, req_id: int, meta: str | None = None) -> None:
        """Начинаем отслеживать запрос.

        Args:
            req_id: Уникальный id (обычно id(request)).
            meta: опциональная строка с методом/путём для логов.
        """
        now = time.time()
        with self._lock:
            self._active_requests[req_id] = now
        if meta:
            logger.info("[WATCHDOG] Tracking request %s started at %.2f (%s)", req_id, now, meta)

    def end_request(self, req_id: int) -> None:
        with self._lock:
            self._active_requests.pop(req_id, None)

    def _run_loop(self) -> None:
        self._last_heartbeat = time.time()

        while self._running:
            try:
                now = time.time()

                # 1. Heartbeat
                if now - self._last_heartbeat > self.heartbeat_interval:
                    thread_count = threading.active_count()
                    req_count = len(self._active_requests)
                    logger.info(
                        "[WATCHDOG] HEARTBEAT: Process is alive. Threads: %s, Active Requests: %s",
                        thread_count,
                        req_count,
                    )
                    self._last_heartbeat = now

                # 2. Check for hangs
                stuck_requests: list[tuple[int, float]] = []
                with self._lock:
                    for req_id, start_time in self._active_requests.items():
                        duration = now - start_time
                        if duration > self.hang_threshold:
                            stuck_requests.append((req_id, duration))

                if stuck_requests:
                    self._dump_stack_traces(stuck_requests)
                    time.sleep(10)

                time.sleep(self.check_interval)

            except Exception as e:  # pragma: no cover - defensive guard
                logger.error("Watchdog loop error: %s", e, exc_info=True)
                time.sleep(5)

    def _dump_stack_traces(self, stuck_requests: list[tuple[int, float]]) -> None:
        logger.warning("!!! POSSIBLE HANG DETECTED !!! Found %s stuck requests.", len(stuck_requests))
        for req_id, duration in stuck_requests:
            should_dump = False
            last_dump = self._last_dump.get(req_id, 0.0)
            now = time.time()
            if (now - last_dump) > self.repeat_dump_interval:
                should_dump = True
                self._last_dump[req_id] = now

            logger.warning("  -> Request %s running for %.2fs%s",
                           req_id,
                           duration,
                           "" if should_dump else " (stack trace suppressed)")

            if not should_dump:
                continue

        logger.warning("Dumping stack traces of all threads:")

        try:
            frames = sys._current_frames()
            for thread_id, frame in frames.items():
                thread_name = "Unknown"
                for thread in threading.enumerate():
                    if thread.ident == thread_id:
                        thread_name = thread.name
                        break

                logger.warning("--- Thread %s (%s) ---", thread_id, thread_name)
                stack = "".join(traceback.format_stack(frame))
                logger.warning("\n%s", stack)
                logger.warning("--------------------------------")
        except Exception as e:
            logger.error("Failed to dump stack traces: %s", e)
