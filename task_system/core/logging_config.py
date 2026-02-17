"""
Централизованная настройка логирования для проекта ACTRA.

Предоставляет единую функцию setup_logging() для настройки логирования
во всех приложениях проекта (trainer, editor, etc.).
"""

import atexit
import faulthandler
import logging
import sys
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional

_CRASH_SETUP_DONE = False
_CRASH_FILE_HANDLE: Optional[object] = None
_ORIGINAL_EXCEPTHOOK = None
_ORIGINAL_THREADING_EXCEPTHOOK = None


def _cleanup_old_logs(log_dir: Path, max_files: int = 10) -> None:
    """
    Удаляет старые лог-файлы, оставляя только последние max_files.
    
    Args:
        log_dir: Директория с логами
        max_files: Максимальное количество логов для хранения
    """
    try:
        # Получаем все .log файлы
        log_files = list(log_dir.glob("*.log"))
        
        # Если файлов меньше или равно лимиту, ничего не делаем
        if len(log_files) <= max_files:
            return
        
        # Сортируем по времени изменения (самые старые первыми)
        log_files.sort(key=lambda f: f.stat().st_mtime)
        
        # Удаляем самые старые
        files_to_delete = log_files[:-max_files]  # Все кроме последних max_files
        for file in files_to_delete:
            try:
                file.unlink()
            except Exception as e:
                logging.warning(f"Failed to delete old log file {file.name}: {e}")
        
    
    except Exception as e:
        logging.warning(f"Failed to cleanup old logs: {e}")


def setup_logging(
    app_name: str = "actra",
    log_level: int = logging.DEBUG,
    log_dir: Optional[Path] = None,
    console: bool = True
) -> logging.Logger:
    """
    Настраивает логирование для приложения.
    
    Создает директорию для логов (если не существует), настраивает
    файловый и консольный handlers, устанавливает единый формат логов.
    
    Args:
        app_name: Имя приложения (trainer, editor и т.д.)
        log_level: Уровень логирования (по умолчанию DEBUG)
        log_dir: Директория для логов (если None, создаётся в корне проекта)
        console: Выводить ли логи в консоль (по умолчанию True)
    
    Returns:
        Настроенный logger для данного модуля
    
    Example:
        >>> from task_system.core.logging_config import setup_logging
        >>> setup_logging(app_name="trainer", log_level=logging.DEBUG)
        >>> import logging
        >>> logger = logging.getLogger(__name__)
        >>> logger.info("Application started")
    """
    # Определяем директорию для логов
    if log_dir is None:
        # Ищем корень проекта (где находится task_system)
        # Предполагаем структуру: project_root/task_system/core/logging_config.py
        current_file = Path(__file__)
        # Поднимаемся на 3 уровня: core -> task_system -> project_root
        project_root = current_file.parent.parent.parent
        log_dir = project_root / "logs"
    else:
        log_dir = Path(log_dir)
    
    # Создаём директорию для логов
    log_dir.mkdir(exist_ok=True)
    
    # Очищаем старые логи (оставляем не более 10 файлов)
    _cleanup_old_logs(log_dir, max_files=10)
    
    # Создаём файл лога с временной меткой
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = log_dir / f"{app_name}_{timestamp}.log"
    
    # Настраиваем формат логов
    log_format = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    date_format = '%Y-%m-%d %H:%M:%S'
    
    # Получаем root logger и очищаем существующие handlers (если есть)
    root_logger = logging.getLogger()
    
    # Удаляем существующие handlers перед добавлением новых
    # Это предотвращает накопление handlers при многократных вызовах setup_logging
    if root_logger.handlers:
        for handler in root_logger.handlers[:]:
            root_logger.removeHandler(handler)
    
    # Файловый handler
    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setLevel(log_level)
    file_handler.setFormatter(logging.Formatter(log_format, date_format))
    root_logger.addHandler(file_handler)
    
    # Консольный handler (опционально)
    if console:
        console_handler = logging.StreamHandler()
        console_handler.setLevel(log_level)
        console_handler.setFormatter(logging.Formatter(log_format, date_format))
        root_logger.addHandler(console_handler)
    
    # Устанавливаем уровень логирования
    root_logger.setLevel(log_level)

    # Локальные переопределения уровней для конкретных модулей
    # Например, детализируем логи веб-сервера редактора независимо от общего уровня.
    logging.getLogger("desktop-app.server").setLevel(logging.DEBUG)
    logging.getLogger("server").setLevel(logging.DEBUG)
    
    # Создаём и возвращаем logger для этого модуля
    logger = logging.getLogger(__name__)
    logger.info(f"Logging initialized for {app_name}, log file: {log_file}")
    
    return logger


def install_crash_handlers(
    app_name: str = "actra",
    log_dir: Optional[Path] = None,
    dump_interval_seconds: Optional[float] = None,
) -> Optional[Path]:
    """
    Устанавливает обработчики падений и пишет подробности в отдельный crash-лог.

    Это фиксирует:
    - необработанные исключения (sys.excepthook),
    - исключения в потоках (threading.excepthook),
    - фатальные ошибки интерпретатора (faulthandler).

    Args:
        app_name: Имя приложения для имени crash-файла.
        log_dir: Каталог логов (если None, использует logs/ в корне проекта).
        dump_interval_seconds: Если задано, периодически пишет стек всех потоков.
    """
    global _CRASH_SETUP_DONE, _CRASH_FILE_HANDLE, _ORIGINAL_EXCEPTHOOK, _ORIGINAL_THREADING_EXCEPTHOOK
    if _CRASH_SETUP_DONE:
        return None

    if log_dir is None:
        current_file = Path(__file__)
        project_root = current_file.parent.parent.parent
        log_dir = project_root / "logs"
    else:
        log_dir = Path(log_dir)
    log_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    crash_file = log_dir / f"{app_name}_crash_{timestamp}.log"

    try:
        crash_handle = open(crash_file, "a", encoding="utf-8")
    except Exception:
        return None

    _CRASH_FILE_HANDLE = crash_handle

    try:
        faulthandler.enable(file=crash_handle, all_threads=True)
        if dump_interval_seconds:
            faulthandler.dump_traceback_later(
                dump_interval_seconds,
                repeat=True,
                file=crash_handle,
            )
    except Exception:
        pass

    def _log_unhandled(exc_type, exc, tb) -> None:
        logging.getLogger("crash").error(
            "Unhandled exception", exc_info=(exc_type, exc, tb)
        )
        if _ORIGINAL_EXCEPTHOOK:
            try:
                _ORIGINAL_EXCEPTHOOK(exc_type, exc, tb)
            except Exception:
                pass

    def _log_thread_exception(args) -> None:
        logging.getLogger("crash").error(
            "Unhandled thread exception",
            exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
        )
        if _ORIGINAL_THREADING_EXCEPTHOOK:
            try:
                _ORIGINAL_THREADING_EXCEPTHOOK(args)
            except Exception:
                pass

    _ORIGINAL_EXCEPTHOOK = sys.excepthook
    sys.excepthook = _log_unhandled

    if hasattr(threading, "excepthook"):
        _ORIGINAL_THREADING_EXCEPTHOOK = threading.excepthook
        threading.excepthook = _log_thread_exception  # type: ignore[assignment]

    def _on_exit() -> None:
        try:
            crash_handle.write("Process exiting (atexit)\n")
            crash_handle.flush()
        except Exception:
            pass

    atexit.register(_on_exit)

    _CRASH_SETUP_DONE = True
    return crash_file
