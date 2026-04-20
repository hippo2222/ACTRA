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

from persistence.hosted_session_repository import HostedSessionRepository as HostedSessionDocumentRepository
from persistence.postgres import PostgresUnavailableError
from services.hosted_shadow_fallback import HostedShadowFallbackMixin
from task_system.core.models.complex_models import (
    ComplexSession,
    COMPLEX_SESSION_VERSION
)
from pydantic import ValidationError

logger = logging.getLogger(__name__)


class SessionRepository:
    """
    Репозиторий для управления файлами сессий.

    Основной формат хранения: один файл на session_id.
    Legacy-совместимость: старые файлы {complex_id}.json по-прежнему читаются.
    Путь к файлам: data/users/{user_id}/sessions/{session_id}.json
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

        obj_module = type(obj).__module__
        if obj_module and obj_module.split(".", 1)[0] == "numpy" and hasattr(obj, "item"):
            try:
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
    
    def _get_session_file_path(self, session_id: str, user_id: str) -> Path:
        """
        Получить путь к файлу сессии.
        
        Args:
            session_id: ID сессии
            user_id: ID пользователя
            
        Returns:
            Path: Путь к файлу {session_id}.json
        """
        sessions_dir = self._get_sessions_dir(user_id)
        return sessions_dir / f"{session_id}.json"

    def _get_legacy_session_file_path(self, complex_id: str, user_id: str) -> Path:
        """Путь к legacy-файлу, сохранённому по complex_id."""
        sessions_dir = self._get_sessions_dir(user_id)
        return sessions_dir / f"{complex_id}.json"

    def _coerce_datetime(self, value: Any) -> Optional[datetime]:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                normalized = value.replace("Z", "+00:00")
                return datetime.fromisoformat(normalized)
            except Exception:
                return None
        return None

    def _session_recency_score(self, session: ComplexSession) -> float:
        candidates: List[datetime] = []
        ui_state = getattr(session, "ui_state", None) or {}
        if isinstance(ui_state, dict):
            last_updated = self._coerce_datetime(ui_state.get("last_updated"))
            if last_updated is not None:
                candidates.append(last_updated)

        for value in (
            getattr(session, "paused_at", None),
            getattr(session, "start_time", None),
        ):
            coerced = self._coerce_datetime(value)
            if coerced is not None:
                candidates.append(coerced)

        if not candidates:
            return 0.0
        return max(dt.timestamp() for dt in candidates)

    def _session_file_preference_key(self, session: ComplexSession, session_file: Path) -> Any:
        session_id = str(getattr(session, "id", "") or "").strip()
        is_primary_filename = int(bool(session_id) and session_file.stem == session_id)
        try:
            file_mtime = session_file.stat().st_mtime
        except Exception:
            file_mtime = 0.0
        return (
            is_primary_filename,
            self._session_recency_score(session),
            file_mtime,
            str(session_file),
        )

    def _complex_session_preference_key(self, session: ComplexSession) -> Any:
        return (
            int(bool(getattr(session, "is_active", False))),
            int(bool(getattr(session, "paused", False))),
            self._session_recency_score(session),
            str(getattr(session, "id", "") or ""),
        )

    def _delete_file(self, session_file: Path) -> bool:
        if not session_file.exists():
            return True
        try:
            session_file.unlink()
            return True
        except Exception as exc:
            self.logger.error(f"Error deleting session file {session_file}: {exc}", exc_info=True)
            return False

    def _load_session_from_file(self, session_file: Path) -> Optional[ComplexSession]:
        if not session_file.exists():
            return None

        try:
            with open(session_file, "r", encoding="utf-8") as f:
                json_content = f.read()

            session_data = json.loads(json_content)
            version = session_data.get("version", 0)
            if version < COMPLEX_SESSION_VERSION:
                self.logger.warning(
                    f"Session file has outdated version {version} (current: {COMPLEX_SESSION_VERSION}). "
                    f"Deleting file: {session_file}"
                )
                self._delete_file(session_file)
                return None

            if hasattr(ComplexSession, "model_validate_json"):
                return ComplexSession.model_validate_json(json_content)
            return ComplexSession.parse_raw(json_content)

        except ValidationError as e:
            self.logger.error(
                f"Validation error loading session from {session_file}: {e}. "
                f"Deleting invalid file."
            )
            self._delete_file(session_file)
            return None
        except json.JSONDecodeError as e:
            self.logger.error(
                f"JSON decode error loading session from {session_file}: {e}. "
                f"Deleting corrupted file."
            )
            self._delete_file(session_file)
            return None
        except Exception as e:
            self.logger.error(f"Error loading session from {session_file}: {e}", exc_info=True)
            return None
    
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
            
            session_file = self._get_session_file_path(session.id, user_id)
            legacy_session_file = self._get_legacy_session_file_path(session.complex_id, user_id)

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

            # Миграция legacy-формата: если старый complex_id-файл хранит ту же session.id,
            # убираем дубликат после успешной записи нового session_id-файла.
            if legacy_session_file != session_file and legacy_session_file.exists():
                legacy_session = self._load_session_from_file(legacy_session_file)
                if legacy_session is not None:
                    legacy_session_id = str(getattr(legacy_session, "id", "") or "").strip()
                    if legacy_session_id == str(session.id):
                        self._delete_file(legacy_session_file)
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
        candidates = [
            session
            for session in self.load_all_sessions(user_id)
            if str(getattr(session, "complex_id", "") or "").strip() == complex_id
        ]
        if not candidates:
            legacy_file = self._get_legacy_session_file_path(complex_id, user_id)
            self.logger.debug(
                f"Session file not found: {legacy_file} (complex_id={complex_id}, user_id={user_id})"
            )
            return None

        selected = max(candidates, key=self._complex_session_preference_key)
        if selected.user_id != user_id:
            self.logger.warning(
                f"Session user_id mismatch: session.user_id={selected.user_id}, "
                f"requested user_id={user_id}. Returning session anyway."
            )

        self.logger.info(
            f"Session loaded: {selected.id} for complex {complex_id}, "
            f"user_id={selected.user_id} (requested: {user_id})"
        )
        return selected
    
    def load_session_by_session_id(self, user_id: str, session_id: str) -> Optional[ComplexSession]:
        """
        Найти и загрузить сессию по session_id, пробегая все файлы пользователя.
        Используется для восстановления паузы, когда известен только session_id.
        """
        direct_file = self._get_session_file_path(session_id, user_id)
        direct_session = self._load_session_from_file(direct_file)
        if direct_session is not None:
            if str(getattr(direct_session, "id", "") or "").strip() == session_id:
                return direct_session

        for session in self.load_all_sessions(user_id):
            if str(getattr(session, "id", "") or "").strip() == session_id:
                return session
        return None

    def delete_session_by_session_id(self, session_id: str, user_id: str) -> bool:
        sessions_dir = self._get_sessions_dir(user_id)
        if not sessions_dir.exists():
            return True

        deleted_any = False
        success = True
        direct_file = self._get_session_file_path(session_id, user_id)
        if direct_file.exists():
            success = self._delete_file(direct_file) and success
            deleted_any = True

        for session_file in sessions_dir.glob("*.json"):
            if session_file == direct_file:
                continue
            session = self._load_session_from_file(session_file)
            if session is None:
                continue
            if str(getattr(session, "id", "") or "").strip() != session_id:
                continue
            success = self._delete_file(session_file) and success
            deleted_any = True

        if not deleted_any:
            self.logger.debug(f"Session file does not exist for session_id={session_id}, user_id={user_id}")
        else:
            self.logger.info(f"Session deleted: session_id={session_id} for user {user_id}")
        return success

    def delete_session(self, complex_id: str, user_id: str) -> bool:
        """
        Удалить все файлы сессий для комплекса.
        
        Args:
            complex_id: ID комплекса
            user_id: ID пользователя
            
        Returns:
            bool: True если файл удален или не существовал, False в случае ошибки
        """
        success = True
        deleted_any = False
        for session in self.load_all_sessions(user_id):
            if str(getattr(session, "complex_id", "") or "").strip() != complex_id:
                continue
            session_id = str(getattr(session, "id", "") or "").strip()
            if not session_id:
                continue
            success = self.delete_session_by_session_id(session_id, user_id) and success
            deleted_any = True

        legacy_file = self._get_legacy_session_file_path(complex_id, user_id)
        if legacy_file.exists():
            success = self._delete_file(legacy_file) and success
            deleted_any = True

        if not deleted_any:
            self.logger.debug(f"Session file does not exist: complex_id={complex_id}, user_id={user_id}")
            return True

        self.logger.info(f"Sessions deleted for complex {complex_id} and user {user_id}")
        return success
    
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
                    session_id = str(getattr(session, "id", "") or "").strip()
                    complex_id = session.complex_id
                    if session_id:
                        self.delete_session_by_session_id(session_id, user_id)
                    else:
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
        
        loaded_by_session_id: Dict[str, Any] = {}
        for session_file in sessions_dir.glob("*.json"):
            try:
                session = self._load_session_from_file(session_file)
                if session is None:
                    continue
                session_id = str(getattr(session, "id", "") or "").strip() or session_file.stem
                candidate_key = self._session_file_preference_key(session, session_file)
                existing = loaded_by_session_id.get(session_id)
                if existing is None or candidate_key > existing[1]:
                    loaded_by_session_id[session_id] = (session, candidate_key)
            except Exception as e:
                self.logger.error(
                    f"Error processing session file {session_file}: {e}",
                    exc_info=True
                )
                continue
        return [entry[0] for entry in loaded_by_session_id.values()]


class HostedSessionRepository(HostedShadowFallbackMixin, SessionRepository):
    """Hosted session repository with Postgres source of truth and optional shadow fallback."""

    def __init__(self, data_dir: str, persistence_settings: Any):
        super().__init__(data_dir=data_dir)
        self.persistence_settings = persistence_settings
        self._hosted_repository: Optional[HostedSessionDocumentRepository] = None
        self._storage_ready = False
        self._init_hosted_shadow_fallback_state()

    @property
    def hosted_storage_ready(self) -> bool:
        return bool(self._storage_ready)

    def ensure_persistence_ready(self) -> None:
        if self._storage_ready:
            return
        self._get_hosted_repository().ensure_schema()
        self._storage_ready = True

    def _get_hosted_repository(self) -> HostedSessionDocumentRepository:
        if self._hosted_repository is None:
            if self.persistence_settings is None:
                raise RuntimeError("hosted_session_repository_requires_persistence_settings")
            self._hosted_repository = HostedSessionDocumentRepository(
                getattr(self.persistence_settings, "postgres_dsn", "")
            )
        return self._hosted_repository

    def _normalize_session_payload(self, session: ComplexSession) -> Dict[str, Any]:
        if hasattr(session, "model_dump"):
            payload = session.model_dump(mode="python")
        else:
            payload = json.loads(session.json())
        return self._json_safe(payload)

    def _deserialize_session_payload(self, payload: Any) -> Optional[ComplexSession]:
        if not isinstance(payload, dict):
            return None

        version = payload.get("version", 0)
        if version < COMPLEX_SESSION_VERSION:
            return None

        if hasattr(ComplexSession, "model_validate"):
            return ComplexSession.model_validate(payload)
        return ComplexSession.parse_obj(payload)

    def _session_updated_at(self, session: ComplexSession) -> str:
        ui_state = getattr(session, "ui_state", None) or {}
        if isinstance(ui_state, dict):
            last_updated = ui_state.get("last_updated") or ui_state.get("updated_at")
            if isinstance(last_updated, str) and last_updated.strip():
                return last_updated.strip()

        for value in (
            getattr(session, "paused_at", None),
            getattr(session, "end_time", None),
            getattr(session, "start_time", None),
        ):
            if isinstance(value, datetime):
                return value.isoformat()

        return datetime.utcnow().isoformat()

    def _promote_shadow_sessions(self, sessions: List[ComplexSession], user_id: str) -> None:
        if not sessions:
            return
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError:
            return

        repo = self._get_hosted_repository()
        for session in sessions:
            try:
                clean_session_user_id = str(getattr(session, "user_id", "") or user_id).strip() or user_id
                repo.upsert_session(
                    session_id=str(getattr(session, "id", "") or "").strip(),
                    user_id=clean_session_user_id,
                    complex_id=str(getattr(session, "complex_id", "") or "").strip(),
                    is_active=bool(getattr(session, "is_active", False)),
                    paused=bool(getattr(session, "paused", False)),
                    updated_at=self._session_updated_at(session),
                    payload=self._normalize_session_payload(session),
                )
            except Exception:
                self.logger.debug(
                    "[HostedSessionRepository] Failed to promote shadow session %s",
                    getattr(session, "id", None),
                    exc_info=True,
                )

    def save_session(self, session: ComplexSession, user_id: str) -> bool:
        if user_id == "guest":
            self.logger.info("[HostedSessionRepository] Guest session not persisted")
            return True

        if session.user_id != user_id:
            self.logger.warning(
                "Session user_id mismatch: session.user_id=%s, provided user_id=%s. Using session.user_id.",
                session.user_id,
                user_id,
            )
            user_id = session.user_id

        try:
            self.ensure_persistence_ready()
            self._get_hosted_repository().upsert_session(
                session_id=str(session.id),
                user_id=str(user_id),
                complex_id=str(session.complex_id),
                is_active=bool(session.is_active),
                paused=bool(session.paused),
                updated_at=self._session_updated_at(session),
                payload=self._normalize_session_payload(session),
            )
            try:
                super().delete_session_by_session_id(str(session.id), str(user_id))
            except Exception:
                self.logger.debug(
                    "[HostedSessionRepository] Failed to delete shadow session after hosted save: %s",
                    session.id,
                    exc_info=True,
                )
            return True
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("save_session", exc)
            return super().save_session(session, user_id)

    def load_all_sessions(self, user_id: str) -> List[ComplexSession]:
        clean_user_id = str(user_id or "").strip()
        if not clean_user_id:
            return []

        try:
            self.ensure_persistence_ready()
            rows = self._get_hosted_repository().list_sessions_for_user(user_id=clean_user_id)
            loaded: List[ComplexSession] = []
            invalid_session_ids: List[str] = []
            for row in rows:
                try:
                    session = self._deserialize_session_payload(row.get("payload"))
                except ValidationError:
                    session = None
                except Exception:
                    self.logger.exception(
                        "[HostedSessionRepository] Failed to deserialize hosted session %s",
                        row.get("session_id"),
                    )
                    session = None

                if session is None:
                    session_id = str(row.get("session_id") or "").strip()
                    if session_id:
                        invalid_session_ids.append(session_id)
                    continue

                loaded.append(session)

            for session_id in invalid_session_ids:
                try:
                    self._get_hosted_repository().delete_session_by_session_id(
                        user_id=clean_user_id,
                        session_id=session_id,
                    )
                except Exception:
                    self.logger.debug(
                        "[HostedSessionRepository] Failed to delete invalid hosted session %s",
                        session_id,
                        exc_info=True,
                    )

            if loaded:
                return loaded

            shadow_sessions = super().load_all_sessions(clean_user_id)
            self._promote_shadow_sessions(shadow_sessions, clean_user_id)
            return shadow_sessions
        except PostgresUnavailableError as exc:
            self._log_shadow_read_fallback("load_all_sessions", exc)
            return super().load_all_sessions(clean_user_id)

    def load_session_by_session_id(self, user_id: str, session_id: str) -> Optional[ComplexSession]:
        clean_user_id = str(user_id or "").strip()
        clean_session_id = str(session_id or "").strip()
        if not clean_user_id or not clean_session_id:
            return None

        try:
            self.ensure_persistence_ready()
            row = self._get_hosted_repository().get_session_by_session_id(
                user_id=clean_user_id,
                session_id=clean_session_id,
            )
            if row is not None:
                session = self._deserialize_session_payload(row.get("payload"))
                if session is not None:
                    return session
                self._get_hosted_repository().delete_session_by_session_id(
                    user_id=clean_user_id,
                    session_id=clean_session_id,
                )

            shadow_session = super().load_session_by_session_id(clean_user_id, clean_session_id)
            if shadow_session is not None:
                self._promote_shadow_sessions([shadow_session], clean_user_id)
            return shadow_session
        except PostgresUnavailableError as exc:
            self._log_shadow_read_fallback("load_session_by_session_id", exc)
            return super().load_session_by_session_id(clean_user_id, clean_session_id)

    def delete_session_by_session_id(self, session_id: str, user_id: str) -> bool:
        clean_user_id = str(user_id or "").strip()
        clean_session_id = str(session_id or "").strip()
        if not clean_user_id or not clean_session_id:
            return True

        try:
            self.ensure_persistence_ready()
            self._get_hosted_repository().delete_session_by_session_id(
                user_id=clean_user_id,
                session_id=clean_session_id,
            )
            try:
                super().delete_session_by_session_id(clean_session_id, clean_user_id)
            except Exception:
                self.logger.debug(
                    "[HostedSessionRepository] Failed to delete shadow session during hosted delete: %s",
                    clean_session_id,
                    exc_info=True,
                )
            return True
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("delete_session_by_session_id", exc)
            return super().delete_session_by_session_id(clean_session_id, clean_user_id)

