from __future__ import annotations

import json
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from persistence.postgres import PostgresUnavailableError, postgres_connection
from persistence.runtime import PersistenceRuntimeSettings
from services.user_service import (
    USER_PLAN_PREMIUM,
    User,
    parse_premium_expires_at,
    resolve_effective_plan,
)


SUPPORTED_PREMIUM_PERIOD_DAYS = (14, 30, 90)
BILLING_STATUS_PENDING = "pending"
BILLING_STATUS_ACTIVATED = "activated"
BILLING_STATUS_CANCELLED = "cancelled"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class BillingService:
    """Internal billing MVP: orders are requests, admins activate premium manually."""

    def __init__(
        self,
        *,
        data_dir: str,
        user_service: Any,
        persistence_settings: Optional[PersistenceRuntimeSettings] = None,
    ) -> None:
        self.data_dir = Path(data_dir)
        self.user_service = user_service
        self.persistence_settings = persistence_settings
        self._shadow_path = self.data_dir / "billing_orders.json"

    def ensure_schema(self) -> None:
        if not self._use_postgres():
            return
        with postgres_connection(self._postgres_dsn()) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS actra_billing_orders (
                        order_id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        period_days INTEGER NOT NULL,
                        status TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        activated_at TEXT NULL,
                        cancelled_at TEXT NULL,
                        admin_user_id TEXT NULL,
                        meta JSONB NOT NULL DEFAULT '{}'::jsonb
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS actra_billing_orders_user_status_idx
                    ON actra_billing_orders (user_id, status, created_at DESC)
                    """
                )

    def get_status(self, user_id: Any) -> Dict[str, Any]:
        user = self.user_service.get_user(str(user_id or "").strip())
        if user is None:
            return {"ok": False, "error": "user_not_found"}
        return {
            "ok": True,
            "user": user.to_api_dict(),
            "effective_plan": resolve_effective_plan(user),
            "premium_expires_at": getattr(user, "premium_expires_at", None),
            "supported_period_days": list(SUPPORTED_PREMIUM_PERIOD_DAYS),
            "pending_orders": self.list_orders(user_id=user.user_id, status=BILLING_STATUS_PENDING),
        }

    def create_order(self, user_id: Any, period_days: Any) -> Dict[str, Any]:
        clean_user_id = str(user_id or "").strip()
        days = self._normalize_period_days(period_days)
        if not clean_user_id:
            raise ValueError("user_id_required")
        if self.user_service.get_user(clean_user_id) is None:
            raise ValueError("user_not_found")

        now = utc_now_iso()
        order = {
            "order_id": f"bill_{uuid.uuid4().hex}",
            "user_id": clean_user_id,
            "period_days": days,
            "status": BILLING_STATUS_PENDING,
            "created_at": now,
            "updated_at": now,
            "activated_at": None,
            "cancelled_at": None,
            "admin_user_id": None,
            "meta": {},
        }
        self._insert_order(order)
        return order

    def list_orders(self, *, user_id: Any = None, status: Any = None, limit: int = 100) -> List[Dict[str, Any]]:
        clean_user_id = str(user_id or "").strip()
        clean_status = str(status or "").strip().lower()
        items = self._read_orders()
        if clean_user_id:
            items = [item for item in items if str(item.get("user_id") or "").strip() == clean_user_id]
        if clean_status:
            items = [item for item in items if str(item.get("status") or "").strip().lower() == clean_status]
        items.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
        return items[: max(1, min(int(limit or 100), 500))]

    def activate_order(self, order_id: Any, *, admin_user_id: Any = "") -> Dict[str, Any]:
        clean_order_id = str(order_id or "").strip()
        order = self.get_order(clean_order_id)
        if order is None:
            raise ValueError("order_not_found")
        if str(order.get("status") or "").strip().lower() != BILLING_STATUS_PENDING:
            raise ValueError("order_not_pending")

        user = self._grant_premium_days(
            order.get("user_id"),
            order.get("period_days"),
        )
        now = utc_now_iso()
        order.update(
            {
                "status": BILLING_STATUS_ACTIVATED,
                "updated_at": now,
                "activated_at": now,
                "admin_user_id": str(admin_user_id or "").strip() or None,
            }
        )
        self._update_order(order)
        return {"order": order, "user": user.to_api_dict()}

    def cancel_order(self, order_id: Any, *, admin_user_id: Any = "") -> Dict[str, Any]:
        clean_order_id = str(order_id or "").strip()
        order = self.get_order(clean_order_id)
        if order is None:
            raise ValueError("order_not_found")
        if str(order.get("status") or "").strip().lower() != BILLING_STATUS_PENDING:
            raise ValueError("order_not_pending")
        now = utc_now_iso()
        order.update(
            {
                "status": BILLING_STATUS_CANCELLED,
                "updated_at": now,
                "cancelled_at": now,
                "admin_user_id": str(admin_user_id or "").strip() or None,
            }
        )
        self._update_order(order)
        return {"order": order}

    def grant_premium(self, user_id: Any, period_days: Any, *, admin_user_id: Any = "") -> Dict[str, Any]:
        user = self._grant_premium_days(user_id, period_days)
        return {"user": user.to_api_dict(), "admin_user_id": str(admin_user_id or "").strip() or None}

    def get_order(self, order_id: Any) -> Optional[Dict[str, Any]]:
        clean_order_id = str(order_id or "").strip()
        if not clean_order_id:
            return None
        for item in self._read_orders():
            if str(item.get("order_id") or "").strip() == clean_order_id:
                return item
        return None

    def _grant_premium_days(self, user_id: Any, period_days: Any) -> User:
        clean_user_id = str(user_id or "").strip()
        days = self._normalize_period_days(period_days)
        user = self.user_service.get_user(clean_user_id)
        if user is None:
            raise ValueError("user_not_found")

        if str(getattr(user, "plan", "") or "").strip().lower() == USER_PLAN_PREMIUM and not str(getattr(user, "premium_expires_at", "") or "").strip():
            return user

        now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        current_expiry = parse_premium_expires_at(getattr(user, "premium_expires_at", None))
        base = current_expiry if current_expiry and current_expiry > now_dt else now_dt
        next_expiry = base + timedelta(days=days)
        user.plan = USER_PLAN_PREMIUM
        user.premium_expires_at = next_expiry.isoformat().replace("+00:00", "Z")
        if not self.user_service.update_user(user):
            raise ValueError("premium_grant_failed")
        return self.user_service.get_user(clean_user_id) or user

    def _normalize_period_days(self, value: Any) -> int:
        try:
            days = int(value)
        except (TypeError, ValueError):
            raise ValueError("invalid_period_days")
        if days not in SUPPORTED_PREMIUM_PERIOD_DAYS:
            raise ValueError("invalid_period_days")
        return days

    def _use_postgres(self) -> bool:
        settings = self.persistence_settings
        return bool(settings and settings.runtime_mode == "hosted_web" and self._postgres_dsn())

    def _postgres_dsn(self) -> str:
        return str(getattr(self.persistence_settings, "postgres_dsn", "") or "").strip()

    def _read_orders(self) -> List[Dict[str, Any]]:
        if self._use_postgres():
            try:
                self.ensure_schema()
                with postgres_connection(self._postgres_dsn()) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            SELECT order_id, user_id, period_days, status, created_at, updated_at,
                                   activated_at, cancelled_at, admin_user_id, meta
                            FROM actra_billing_orders
                            """
                        )
                        rows = cur.fetchall()
                return [self._row_to_order(row) for row in rows]
            except PostgresUnavailableError:
                pass
        return self._read_shadow_orders()

    def _insert_order(self, order: Dict[str, Any]) -> None:
        if self._use_postgres():
            try:
                self.ensure_schema()
                with postgres_connection(self._postgres_dsn()) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            INSERT INTO actra_billing_orders (
                                order_id, user_id, period_days, status, created_at, updated_at,
                                activated_at, cancelled_at, admin_user_id, meta
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                            """,
                            (
                                order.get("order_id"),
                                order.get("user_id"),
                                int(order.get("period_days") or 0),
                                order.get("status"),
                                order.get("created_at"),
                                order.get("updated_at"),
                                order.get("activated_at"),
                                order.get("cancelled_at"),
                                order.get("admin_user_id"),
                                json.dumps(order.get("meta") or {}, ensure_ascii=False),
                            ),
                        )
                return
            except PostgresUnavailableError:
                pass
        items = self._read_shadow_orders()
        items.append(dict(order))
        self._write_shadow_orders(items)

    def _update_order(self, order: Dict[str, Any]) -> None:
        if self._use_postgres():
            try:
                self.ensure_schema()
                with postgres_connection(self._postgres_dsn()) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE actra_billing_orders
                            SET status = %s, updated_at = %s, activated_at = %s,
                                cancelled_at = %s, admin_user_id = %s, meta = %s::jsonb
                            WHERE order_id = %s
                            """,
                            (
                                order.get("status"),
                                order.get("updated_at"),
                                order.get("activated_at"),
                                order.get("cancelled_at"),
                                order.get("admin_user_id"),
                                json.dumps(order.get("meta") or {}, ensure_ascii=False),
                                order.get("order_id"),
                            ),
                        )
                return
            except PostgresUnavailableError:
                pass
        items = self._read_shadow_orders()
        for index, item in enumerate(items):
            if str(item.get("order_id") or "") == str(order.get("order_id") or ""):
                items[index] = dict(order)
                self._write_shadow_orders(items)
                return
        items.append(dict(order))
        self._write_shadow_orders(items)

    def _read_shadow_orders(self) -> List[Dict[str, Any]]:
        try:
            if not self._shadow_path.exists():
                return []
            payload = json.loads(self._shadow_path.read_text(encoding="utf-8"))
            items = payload.get("orders") if isinstance(payload, dict) else payload
            if not isinstance(items, list):
                return []
            return [self._normalize_order(item) for item in items if isinstance(item, dict)]
        except Exception:
            return []

    def _write_shadow_orders(self, items: List[Dict[str, Any]]) -> None:
        self._shadow_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"orders": [self._normalize_order(item) for item in items]}
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=str(self._shadow_path.parent), delete=False, suffix=".tmp") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            temp_name = handle.name
        Path(temp_name).replace(self._shadow_path)

    @staticmethod
    def _row_to_order(row: Any) -> Dict[str, Any]:
        return BillingService._normalize_order(
            {
                "order_id": str(row[0] or ""),
                "user_id": str(row[1] or ""),
                "period_days": int(row[2] or 0),
                "status": str(row[3] or ""),
                "created_at": str(row[4] or ""),
                "updated_at": str(row[5] or ""),
                "activated_at": (str(row[6]).strip() if row[6] is not None else None) or None,
                "cancelled_at": (str(row[7]).strip() if row[7] is not None else None) or None,
                "admin_user_id": (str(row[8]).strip() if row[8] is not None else None) or None,
                "meta": row[9] if isinstance(row[9], dict) else {},
            }
        )

    @staticmethod
    def _normalize_order(item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "order_id": str(item.get("order_id") or "").strip(),
            "user_id": str(item.get("user_id") or "").strip(),
            "period_days": int(item.get("period_days") or 0),
            "status": str(item.get("status") or BILLING_STATUS_PENDING).strip().lower() or BILLING_STATUS_PENDING,
            "created_at": str(item.get("created_at") or "").strip(),
            "updated_at": str(item.get("updated_at") or "").strip(),
            "activated_at": (str(item.get("activated_at")).strip() if item.get("activated_at") else None),
            "cancelled_at": (str(item.get("cancelled_at")).strip() if item.get("cancelled_at") else None),
            "admin_user_id": (str(item.get("admin_user_id")).strip() if item.get("admin_user_id") else None),
            "meta": dict(item.get("meta") or {}) if isinstance(item.get("meta"), dict) else {},
        }
