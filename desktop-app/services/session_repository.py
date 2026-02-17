# desktop-app/services/session_repository.py
"""
SessionRepository - сервис для управления JSON-файлами сессий.

Отвечает за:
- Сохранение сессий в файлы
- Загрузку сессий из файлов
- Удаление сессий
- Сканирование активных сессий
"""

import json
import logging
import os
import tempfile
from datetime import datetime, date
from pathlib import Path
from typing import Optional, List, Dict, Any

try:
    import numpy as np  # type: ignore
except Exception:  # pragma: no cover
    np = None

from task_system.core.models.complex_models import (
    ComplexSession,
    COMPLEX_SESSION_VERSION
)
from pydantic import ValidationError

logger = logging.getLogger(__name__)


class SessionRepository:
    """
    Репозиторий для управления файлами сессий.
    
    Один файл на комплекс (принудительное ограничение одной активной сессией на комплекс).
    Путь к файлам: data/users/{user_id}/sessions/{complex_id}.json
    """
    
    def __init__(self, data_dir: str = None):
        """
        Инициализация SessionRepository.
        
        Args:
            data_dir: Путь к директории с данными (если None, используется config.json)
        """
        # Импортируем load_config только если data_dir не указан
        if data_dir is None:
            from common.config_loader import load_config
            config = load_config()
            data_dir = config.get("data_root", "data")
        
        self.data_dir = Path(data_dir)
        self.users_dir = self.data_dir / "users"
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Создаем директорию users, если её нет
        self.users_dir.mkdir(parents=True, exist_ok=True)
        
        self.logger.info(f"SessionRepository initialized with data_dir: {self.data_dir}")

    def _json_safe(self, obj: Any) -> Any:
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
            return {str(k): self._json_safe(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [self._json_safe(v) for v in obj]

        return obj
    
    def _get_sessions_dir(self, user_id: str) -> Path:
        """
        Получить путь к директории сессий пользователя.
        
        Args:
            user_id: ID пользователя
            
        Returns:
            Path: Путь к директории sessions
        """
        return self.users_dir / user_id / "sessions"
    
    def _get_session_file_path(self, complex_id: str, user_id: str) -> Path:
        """
        Получить путь к файлу сессии.
        
        Args:
            complex_id: ID комплекса
            user_id: ID пользователя
            
        Returns:
            Path: Путь к файлу {complex_id}.json
        """
        sessions_dir = self._get_sessions_dir(user_id)
        return sessions_dir / f"{complex_id}.json"
    
    def save_session(self, session: ComplexSession, user_id: str) -> bool:
        """
        Сохранить сессию в файл.
        
        Args:
            session: Объект ComplexSession для сохранения
            user_id: ID пользователя
            
        Returns:
            bool: True если сохранение успешно, False в случае ошибки
        """
        try:
            # GUEST MODE PROTECTION: не сохраняем сессии гостя на диск
            if user_id == "guest":
                self.logger.info("[SessionRepository] Guest session not persisted (in-memory only)")
                return True  # Сигнализируем успех, но ничего не сохраняем
            
            # ИСПРАВЛЕНИЕ: Проверяем, что user_id совпадает с session.user_id
            if session.user_id != user_id:
                self.logger.warning(
                    f"Session user_id mismatch: session.user_id={session.user_id}, "
                    f"provided user_id={user_id}. Using session.user_id."
                )
                user_id = session.user_id
            
            sessions_dir = self._get_sessions_dir(user_id)
            sessions_dir.mkdir(parents=True, exist_ok=True)
            
            session_file = self._get_session_file_path(session.complex_id, user_id)

            # Pydantic v2: model_dump_json больше не принимает ensure_ascii.
            # Поэтому делаем model_dump() + json.dumps(... ensure_ascii=False).
            if hasattr(session, "model_dump"):
                # Важно: mode="json" может падать на numpy scalar (numpy.bool_, numpy.int64 и т.п.)
                # ещё до того, как мы успеем их конвертировать. Поэтому сначала делаем python dump.
                payload = self._json_safe(session.model_dump(mode="python"))
                json_content = json.dumps(payload, indent=2, ensure_ascii=False)
            else:
                # Fallback для совместимости со старыми моделями Pydantic v1
                json_content = session.json(indent=2, ensure_ascii=False)
            
            # Атомарная запись: temp file + rename
            dir_path = str(session_file.parent)
            temp_name = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="w",
                    dir=dir_path,
                    delete=False,
                    encoding="utf-8",
                    suffix=".tmp",
                ) as tf:
                    tf.write(json_content)
                    temp_name = tf.name
                try:
                    os.replace(temp_name, str(session_file))
                except OSError:
                    if os.path.exists(str(session_file)):
                        os.remove(str(session_file))
                    os.rename(temp_name, str(session_file))
                temp_name = None
            finally:
                if temp_name and os.path.exists(temp_name):
                    try:
                        os.remove(temp_name)
                    except Exception:
                        pass
            
            # ИСПРАВЛЕНИЕ: Логируем user_id для диагностики
            self.logger.info(
                f"Session saved: {session.id} for complex {session.complex_id}, "
                f"user_id={user_id}, file={session_file}"
            )
            return True
            
        except Exception as e:
            self.logger.error(
                f"Error saving session {session.id} for user_id={user_id}: {e}",
                exc_info=True
            )
            return False
    
    def load_session(self, complex_id: str, user_id: str) -> Optional[ComplexSession]:
        """
        Загрузить сессию из файла.
        
        Args:
            complex_id: ID комплекса
            user_id: ID пользователя
            
        Returns:
            Optional[ComplexSession]: Загруженная сессия или None если файл не найден/невалиден
        """
        session_file = self._get_session_file_path(complex_id, user_id)
        
        if not session_file.exists():
            self.logger.debug(f"Session file not found: {session_file} (complex_id={complex_id}, user_id={user_id})")
            return None
        
        try:
            # Читаем JSON из файла
            with open(session_file, 'r', encoding='utf-8') as f:
                json_content = f.read()
            
            # Парсим JSON для проверки версии
            session_data = json.loads(json_content)
            
            # Проверка версии: если версия отсутствует или меньше текущей -> удалить файл
            version = session_data.get('version', 0)
            if version < COMPLEX_SESSION_VERSION:
                self.logger.warning(
                    f"Session file has outdated version {version} (current: {COMPLEX_SESSION_VERSION}). "
                    f"Deleting file: {session_file}"
                )
                session_file.unlink()
                return None
            
            # Десериализация через Pydantic v2/v1.
            if hasattr(ComplexSession, "model_validate_json"):
                session = ComplexSession.model_validate_json(json_content)
            else:
                session = ComplexSession.parse_raw(json_content)
            
            # ИСПРАВЛЕНИЕ: Проверяем, что user_id в сессии совпадает с запрошенным
            if session.user_id != user_id:
                self.logger.warning(
                    f"Session user_id mismatch: session.user_id={session.user_id}, "
                    f"requested user_id={user_id}. Returning session anyway."
                )
            
            self.logger.info(
                f"Session loaded: {session.id} for complex {complex_id}, "
                f"user_id={session.user_id} (requested: {user_id})"
            )
            return session
            
        except ValidationError as e:
            self.logger.error(
                f"Validation error loading session from {session_file}: {e}. "
                f"Deleting invalid file."
            )
            # Удаляем невалидный файл
            try:
                session_file.unlink()
            except Exception as delete_error:
                self.logger.error(f"Error deleting invalid session file: {delete_error}")
            return None
            
        except json.JSONDecodeError as e:
            self.logger.error(
                f"JSON decode error loading session from {session_file}: {e}. "
                f"Deleting corrupted file."
            )
            # Удаляем поврежденный файл
            try:
                session_file.unlink()
            except Exception as delete_error:
                self.logger.error(f"Error deleting corrupted session file: {delete_error}")
            return None
            
        except Exception as e:
            self.logger.error(f"Error loading session from {session_file}: {e}", exc_info=True)
            return None
    
    def load_session_by_session_id(self, user_id: str, session_id: str) -> Optional[ComplexSession]:
        """
        Найти и загрузить сессию по session_id, пробегая все файлы пользователя.
        Используется для восстановления паузы, когда известен только session_id.
        """
        sessions_dir = self._get_sessions_dir(user_id)
        if not sessions_dir.exists():
            return None
        
        for session_file in sessions_dir.glob("*.json"):
            try:
                with open(session_file, "r", encoding="utf-8") as f:
                    json_content = f.read()
                session_data = json.loads(json_content)
                if session_data.get("id") != session_id:
                    continue
                if session_data.get("version", 0) < COMPLEX_SESSION_VERSION:
                    self.logger.warning(
                        f"Session file {session_file} has outdated version {session_data.get('version')}, skipping"
                    )
                    continue
                if hasattr(ComplexSession, "model_validate_json"):
                    session = ComplexSession.model_validate_json(json_content)
                else:
                    session = ComplexSession.parse_raw(json_content)
                return session
            except Exception as exc:
                self.logger.warning(f"Failed to load session from {session_file}: {exc}")
                continue
        return None
    
    def delete_session(self, complex_id: str, user_id: str) -> bool:
        """
        Удалить файл сессии.
        
        Args:
            complex_id: ID комплекса
            user_id: ID пользователя
            
        Returns:
            bool: True если файл удален или не существовал, False в случае ошибки
        """
        session_file = self._get_session_file_path(complex_id, user_id)
        
        if not session_file.exists():
            self.logger.debug(f"Session file does not exist: {session_file}")
            return True
        
        try:
            session_file.unlink()
            self.logger.info(f"Session deleted: {complex_id} for user {user_id}")
            return True
            
        except Exception as e:
            self.logger.error(f"Error deleting session file {session_file}: {e}", exc_info=True)
            return False
    
    def list_active_sessions(self, user_id: str) -> List[Dict[str, Any]]:
        """
        Сканировать папку сессий и вернуть список валидных активных сессий.
        
        Args:
            user_id: ID пользователя
            
        Returns:
            List[Dict[str, Any]]: Список метаданных валидных сессий:
                [{"complex_id": str, "start_time": datetime, "session_id": str, ...}]
        """
        sessions = self.load_all_sessions(user_id)
        active_sessions = []
        for session in sessions:
            active_sessions.append({
                "complex_id": session.complex_id,
                "session_id": session.id,
                "start_time": session.start_time,
                "iteration": session.iteration,
                "current_task_index": session.current_task_index,
                "is_active": session.is_active,
            })
        self.logger.info(f"Found {len(active_sessions)} active sessions for user {user_id}")
        return active_sessions

    def cleanup_stale_sessions(self, user_id: str, max_pause_days: int = 30) -> int:
        """
        Удалить паузированные сессии, которые на паузе дольше max_pause_days дней.
        
        Args:
            user_id: ID пользователя
            max_pause_days: Максимальное количество дней на паузе
            
        Returns:
            int: Количество удалённых сессий
        """
        sessions = self.load_all_sessions(user_id)
        now = datetime.utcnow()
        removed = 0
        for session in sessions:
            if not session.paused:
                continue
            paused_at = session.paused_at
            if not paused_at:
                continue
            try:
                days_paused = (now - paused_at).total_seconds() / 86400
                if days_paused > max_pause_days:
                    complex_id = session.complex_id
                    self.delete_session(complex_id, user_id)
                    self.logger.info(
                        f"Cleaned up stale paused session {session.id} "
                        f"(complex={complex_id}, paused {days_paused:.0f} days)"
                    )
                    removed += 1
            except Exception as e:
                self.logger.warning(f"Error checking stale session {session.id}: {e}")
        return removed

    def load_all_sessions(self, user_id: str) -> List[ComplexSession]:
        """
        Загрузить все валидные сессии пользователя из папки.
        
        Args:
            user_id: ID пользователя
            
        Returns:
            List[ComplexSession]: Список полных объектов сессий
        """
        sessions_dir = self._get_sessions_dir(user_id)
        
        if not sessions_dir.exists():
            self.logger.debug(f"Sessions directory does not exist: {sessions_dir}")
            return []
        
        result = []
        for session_file in sessions_dir.glob("*.json"):
            try:
                complex_id = session_file.stem
                session = self.load_session(complex_id, user_id)
                if session is not None:
                    result.append(session)
            except Exception as e:
                self.logger.error(
                    f"Error processing session file {session_file}: {e}",
                    exc_info=True
                )
                continue
        return result

