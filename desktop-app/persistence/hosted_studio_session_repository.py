from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
import uuid

from persistence.postgres import postgres_connection, PostgresUnavailableError

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class HostedStudioSessionRepository:
    """Postgres-backed repository for AI task import studio sessions with max 3 FIFO retention."""

    def __init__(self, dsn: Optional[str] = None, *, fallback_dir: Optional[Path] = None) -> None:
        self._dsn = str(dsn or "").strip()
        self._fallback_dir = fallback_dir

    def ensure_schema(self) -> None:
        if not self._dsn:
            if self._fallback_dir:
                self._fallback_dir.mkdir(parents=True, exist_ok=True)
            return

        try:
            with postgres_connection(self._dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS actra_hosted_ai_analysis_sessions (
                            session_id TEXT PRIMARY KEY,
                            user_id TEXT NOT NULL,
                            module_id TEXT NOT NULL DEFAULT '',
                            topic_id TEXT NOT NULL DEFAULT '',
                            created_at TEXT NOT NULL,
                            updated_at TEXT NOT NULL,
                            human_summary TEXT NOT NULL DEFAULT '',
                            recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
                            tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
                            status TEXT NOT NULL DEFAULT 'draft'
                        )
                        """
                    )
                    cur.execute(
                        """
                        CREATE INDEX IF NOT EXISTS idx_actra_ai_analysis_sessions_user
                        ON actra_hosted_ai_analysis_sessions (user_id, created_at DESC)
                        """
                    )
        except PostgresUnavailableError:
            logger.warning("[StudioSessionRepo] Postgres unavailable during ensure_schema; relying on fallback")
            if self._fallback_dir:
                self._fallback_dir.mkdir(parents=True, exist_ok=True)

    def save_session(self, user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        clean_user_id = str(user_id or "").strip()
        if not clean_user_id:
            raise ValueError("user_id is required")

        data = payload if isinstance(payload, dict) else {}
        session_id = str(data.get("session_id") or data.get("id") or "").strip()
        if not session_id:
            session_id = f"session_{uuid.uuid4().hex[:16]}"

        now_iso = _utc_now_iso()
        created_at = str(data.get("created_at") or "").strip() or now_iso
        updated_at = now_iso
        module_id = str(data.get("module_id") or "").strip()
        topic_id = str(data.get("topic_id") or "").strip()
        human_summary = str(data.get("human_summary") or "").strip()
        recommendations = data.get("recommendations") if isinstance(data.get("recommendations"), list) else []
        tasks = data.get("tasks") if isinstance(data.get("tasks"), list) else []
        status = str(data.get("status") or "draft").strip()

        normalized_session: Dict[str, Any] = {
            "session_id": session_id,
            "user_id": clean_user_id,
            "module_id": module_id,
            "topic_id": topic_id,
            "created_at": created_at,
            "updated_at": updated_at,
            "human_summary": human_summary,
            "recommendations": recommendations,
            "tasks": tasks,
            "status": status,
        }

        if self._dsn:
            try:
                with postgres_connection(self._dsn) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            INSERT INTO actra_hosted_ai_analysis_sessions (
                                session_id, user_id, module_id, topic_id,
                                created_at, updated_at, human_summary,
                                recommendations, tasks, status
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)
                            ON CONFLICT (session_id) DO UPDATE
                            SET
                                module_id = EXCLUDED.module_id,
                                topic_id = EXCLUDED.topic_id,
                                updated_at = EXCLUDED.updated_at,
                                human_summary = EXCLUDED.human_summary,
                                recommendations = EXCLUDED.recommendations,
                                tasks = EXCLUDED.tasks,
                                status = EXCLUDED.status
                            """,
                            (
                                session_id,
                                clean_user_id,
                                module_id,
                                topic_id,
                                created_at,
                                updated_at,
                                human_summary,
                                json.dumps(recommendations, ensure_ascii=False),
                                json.dumps(tasks, ensure_ascii=False),
                                status,
                            ),
                        )
                        # FIFO rotation: keep at most 3 sessions per user
                        cur.execute(
                            """
                            DELETE FROM actra_hosted_ai_analysis_sessions
                            WHERE user_id = %s
                              AND session_id NOT IN (
                                  SELECT session_id
                                  FROM actra_hosted_ai_analysis_sessions
                                  WHERE user_id = %s
                                  ORDER BY created_at DESC
                                  LIMIT 3
                              )
                            """,
                            (clean_user_id, clean_user_id),
                        )
                return normalized_session
            except PostgresUnavailableError:
                logger.warning("[StudioSessionRepo] Postgres unavailable during save_session; saving to fallback")

        return self._save_fallback(clean_user_id, normalized_session)

    def list_sessions(self, user_id: str, limit: int = 3) -> List[Dict[str, Any]]:
        clean_user_id = str(user_id or "").strip()
        if not clean_user_id:
            return []

        if self._dsn:
            try:
                with postgres_connection(self._dsn) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            SELECT session_id, user_id, module_id, topic_id,
                                   created_at, updated_at, human_summary,
                                   recommendations, tasks, status
                            FROM actra_hosted_ai_analysis_sessions
                            WHERE user_id = %s
                            ORDER BY created_at DESC
                            LIMIT %s
                            """,
                            (clean_user_id, max(1, limit)),
                        )
                        rows = cur.fetchall() or []

                sessions: List[Dict[str, Any]] = []
                for r in rows:
                    sessions.append({
                        "session_id": str(r[0]),
                        "user_id": str(r[1]),
                        "module_id": str(r[2] or ""),
                        "topic_id": str(r[3] or ""),
                        "created_at": str(r[4] or ""),
                        "updated_at": str(r[5] or ""),
                        "human_summary": str(r[6] or ""),
                        "recommendations": self._json_value(r[7], []),
                        "tasks": self._json_value(r[8], []),
                        "status": str(r[9] or "draft"),
                    })
                return sessions
            except PostgresUnavailableError:
                logger.warning("[StudioSessionRepo] Postgres unavailable during list_sessions; reading from fallback")

        return self._list_fallback(clean_user_id, limit=limit)

    def get_session(self, user_id: str, session_id: str) -> Optional[Dict[str, Any]]:
        clean_user_id = str(user_id or "").strip()
        clean_session_id = str(session_id or "").strip()
        if not clean_user_id or not clean_session_id:
            return None

        if self._dsn:
            try:
                with postgres_connection(self._dsn) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            SELECT session_id, user_id, module_id, topic_id,
                                   created_at, updated_at, human_summary,
                                   recommendations, tasks, status
                            FROM actra_hosted_ai_analysis_sessions
                            WHERE user_id = %s AND session_id = %s
                            LIMIT 1
                            """,
                            (clean_user_id, clean_session_id),
                        )
                        row = cur.fetchone()
                if row:
                    return {
                        "session_id": str(row[0]),
                        "user_id": str(row[1]),
                        "module_id": str(row[2] or ""),
                        "topic_id": str(row[3] or ""),
                        "created_at": str(row[4] or ""),
                        "updated_at": str(row[5] or ""),
                        "human_summary": str(row[6] or ""),
                        "recommendations": self._json_value(row[7], []),
                        "tasks": self._json_value(row[8], []),
                        "status": str(row[9] or "draft"),
                    }
                return None
            except PostgresUnavailableError:
                logger.warning("[StudioSessionRepo] Postgres unavailable during get_session; reading from fallback")

        return self._get_fallback(clean_user_id, clean_session_id)

    def delete_session(self, user_id: str, session_id: str) -> bool:
        clean_user_id = str(user_id or "").strip()
        clean_session_id = str(session_id or "").strip()
        if not clean_user_id or not clean_session_id:
            return False

        if self._dsn:
            try:
                with postgres_connection(self._dsn) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            DELETE FROM actra_hosted_ai_analysis_sessions
                            WHERE user_id = %s AND session_id = %s
                            """,
                            (clean_user_id, clean_session_id),
                        )
                        deleted = int(cur.rowcount or 0)
                return deleted > 0
            except PostgresUnavailableError:
                logger.warning("[StudioSessionRepo] Postgres unavailable during delete_session; deleting from fallback")

        return self._delete_fallback(clean_user_id, clean_session_id)

    def clear_sessions(self, user_id: str) -> int:
        clean_user_id = str(user_id or "").strip()
        if not clean_user_id:
            return 0

        if self._dsn:
            try:
                with postgres_connection(self._dsn) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "DELETE FROM actra_hosted_ai_analysis_sessions WHERE user_id = %s",
                            (clean_user_id,),
                        )
                        return int(cur.rowcount or 0)
            except PostgresUnavailableError:
                pass

        return self._clear_fallback(clean_user_id)

    # --- Fallback File Operations ---

    def _user_fallback_dir(self, user_id: str) -> Path:
        base = self._fallback_dir or Path(".actra_runtime") / "studio_sessions"
        d = base / user_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _save_fallback(self, user_id: str, session: Dict[str, Any]) -> Dict[str, Any]:
        udir = self._user_fallback_dir(user_id)
        filepath = udir / f"{session['session_id']}.json"
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(session, f, ensure_ascii=False, indent=2)

        # Enforce max 3
        self._enforce_fallback_limit(user_id, limit=3)
        return session

    def _list_fallback(self, user_id: str, limit: int = 3) -> List[Dict[str, Any]]:
        udir = self._user_fallback_dir(user_id)
        sessions: List[Dict[str, Any]] = []
        for file in udir.glob("*.json"):
            try:
                with open(file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    sessions.append(data)
            except Exception:
                continue

        sessions.sort(key=lambda s: str(s.get("created_at") or ""), reverse=True)
        return sessions[:max(1, limit)]

    def _get_fallback(self, user_id: str, session_id: str) -> Optional[Dict[str, Any]]:
        udir = self._user_fallback_dir(user_id)
        filepath = udir / f"{session_id}.json"
        if not filepath.is_file():
            return None
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def _delete_fallback(self, user_id: str, session_id: str) -> bool:
        udir = self._user_fallback_dir(user_id)
        filepath = udir / f"{session_id}.json"
        if filepath.is_file():
            try:
                filepath.unlink()
                return True
            except OSError:
                return False
        return False

    def _clear_fallback(self, user_id: str) -> int:
        udir = self._user_fallback_dir(user_id)
        count = 0
        for file in udir.glob("*.json"):
            try:
                file.unlink()
                count += 1
            except OSError:
                pass
        return count

    def _enforce_fallback_limit(self, user_id: str, limit: int = 3) -> None:
        sessions = self._list_fallback(user_id, limit=100)
        if len(sessions) > limit:
            for stale in sessions[limit:]:
                self._delete_fallback(user_id, stale.get("session_id", ""))

    @staticmethod
    def _json_value(value: Any, default: Any = None) -> Any:
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return default
        return default
