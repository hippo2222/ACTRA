from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from services.user_service import USER_PLAN_PREMIUM, parse_premium_expires_at

logger = logging.getLogger(__name__)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class PaddleService:
    """Paddle Billing API v2 Service.

    Handles Webhook HMAC SHA256 signature verification, idempotency logging,
    and grants user Premium plan status (14, 30, or 90 days) upon successful transactions.
    """

    def __init__(
        self,
        *,
        billing_service: Any,
        user_service: Any,
        data_dir: str,
        environment: Optional[str] = None,
        api_key: Optional[str] = None,
        client_token: Optional[str] = None,
        webhook_secret: Optional[str] = None,
    ) -> None:
        self.billing_service = billing_service
        self.user_service = user_service
        self.data_dir = Path(data_dir)

        self.environment = (
            str(environment or os.environ.get("PADDLE_ENVIRONMENT") or "production")
            .strip()
            .lower()
        )
        self.api_key = str(api_key or os.environ.get("PADDLE_API_KEY") or "").strip()
        self.client_token = str(client_token or os.environ.get("PADDLE_CLIENT_TOKEN") or "").strip()
        self.webhook_secret = str(webhook_secret or os.environ.get("PADDLE_WEBHOOK_SECRET") or "").strip()

        self.price_14d = str(os.environ.get("PADDLE_PRICE_ID_14D") or "pri_01kwqcbc8nbz9wh34jtp0arctz").strip()
        self.price_30d = str(os.environ.get("PADDLE_PRICE_ID_30D") or "pri_01kwqccmf32mnnt98ek3d3xapf").strip()
        self.price_90d = str(os.environ.get("PADDLE_PRICE_ID_90D") or "pri_01kwqce6k2khvmsxr22yw446ry").strip()

        self._shadow_events_path = self.data_dir / "paddle_events.json"

    def get_public_config(self) -> Dict[str, Any]:
        """Return public Paddle configuration for frontend SDK (Paddle.js)."""
        return {
            "ok": True,
            "environment": self.environment,
            "client_token": self.client_token,
            "prices": {
                "14d": self.price_14d,
                "30d": self.price_30d,
                "90d": self.price_90d,
            },
        }

    def verify_signature(self, raw_body: bytes, signature_header: str) -> bool:
        """Verify Paddle API v2 Webhook HMAC-SHA256 signature.

        Header format: ts=<timestamp>;h1=<hmac_sha256_hex>
        """
        if not self.webhook_secret:
            logger.warning("[PaddleService] PADDLE_WEBHOOK_SECRET is not set. Skipping verification in dev mode if explicitly empty.")
            # Allow fallback if secret not configured yet in local dev environment
            if self.environment == "sandbox":
                return True
            return False

        if not signature_header:
            logger.warning("[PaddleService] Missing Paddle-Signature header.")
            return False

        parts: Dict[str, str] = {}
        for item in signature_header.split(";"):
            if "=" in item:
                k, v = item.split("=", 1)
                parts[k.strip()] = v.strip()

        ts = parts.get("ts")
        h1 = parts.get("h1")

        if not ts or not h1:
            logger.warning("[PaddleService] Invalid Paddle-Signature header format: %s", signature_header)
            return False

        try:
            body_str = raw_body.decode("utf-8")
        except UnicodeDecodeError:
            logger.warning("[PaddleService] Failed to decode raw body as UTF-8.")
            return False

        signed_payload = f"{ts}:{body_str}"
        expected_h1 = hmac.new(
            self.webhook_secret.encode("utf-8"),
            signed_payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        is_valid = hmac.compare_digest(expected_h1.lower(), h1.lower())
        if not is_valid:
            logger.warning("[PaddleService] Webhook signature mismatch!")
        return is_valid

    def handle_webhook_event(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Process incoming Paddle webhook event with idempotency check."""
        if not isinstance(payload, dict):
            raise ValueError("invalid_payload_format")

        event_id = str(payload.get("event_id") or "").strip()
        event_type = str(payload.get("event_type") or "").strip().lower()
        data = payload.get("data") or {}

        if not event_id:
            raise ValueError("missing_event_id")

        if self._is_event_processed(event_id):
            logger.info("[PaddleService] Event %s already processed (idempotent skip).", event_id)
            return {"ok": True, "skipped": True, "reason": "already_processed", "event_id": event_id}

        user_id = self._extract_user_id(data)
        result_meta: Dict[str, Any] = {"event_id": event_id, "event_type": event_type, "user_id": user_id}

        if event_type == "transaction.completed":
            if user_id:
                user, days = self._grant_premium_from_transaction(user_id, data)
                result_meta["granted_premium"] = True
                result_meta["period_days"] = days
                result_meta["user_id"] = user.user_id
        elif event_type in ("subscription.created", "subscription.updated"):
            status = str(data.get("status") or "").strip().lower()
            if user_id and status in ("active", "trialing"):
                user = self._grant_premium_from_subscription(user_id, data)
                result_meta["subscription_status"] = status
                result_meta["user_id"] = user.user_id
        elif event_type == "subscription.canceled":
            result_meta["subscription_canceled"] = True
            logger.info("[PaddleService] Subscription canceled for user_id=%s data=%s", user_id, data.get("id"))

        self._record_processed_event(event_id, event_type, payload)
        return {"ok": True, **result_meta}

    def _extract_user_id(self, data: Dict[str, Any]) -> Optional[str]:
        if not isinstance(data, dict):
            return None
        custom_data = data.get("custom_data")
        if isinstance(custom_data, dict):
            uid = str(custom_data.get("user_id") or "").strip()
            if uid:
                return uid
        passthrough = str(data.get("passthrough") or "").strip()
        if passthrough:
            try:
                pt_json = json.loads(passthrough)
                if isinstance(pt_json, dict) and pt_json.get("user_id"):
                    return str(pt_json["user_id"]).strip()
            except Exception:
                return passthrough
        return None

    def _resolve_period_days_from_items(self, items: List[Dict[str, Any]]) -> int:
        if isinstance(items, list):
            for item in items:
                price_id = str(item.get("price", {}).get("id") or item.get("price_id") or "").strip()
                if price_id == self.price_14d:
                    return 14
                if price_id == self.price_30d:
                    return 30
                if price_id == self.price_90d:
                    return 90
        return 30

    def _grant_premium_from_transaction(self, user_id: str, data: Dict[str, Any]) -> tuple[Any, int]:
        user = self.user_service.get_user(user_id)
        if user is None:
            raise ValueError(f"user_not_found: {user_id}")

        items = data.get("items") or []
        period_days = self._resolve_period_days_from_items(items if isinstance(items, list) else [])
        updated_user = self._extend_user_premium(user, days=period_days)
        return updated_user, period_days

    def _grant_premium_from_subscription(self, user_id: str, data: Dict[str, Any]) -> Any:
        user = self.user_service.get_user(user_id)
        if user is None:
            raise ValueError(f"user_not_found: {user_id}")

        billing_period = data.get("current_billing_period") or {}
        end_iso = str(billing_period.get("ends_at") or billing_period.get("end") or "").strip()

        if end_iso:
            dt_end = parse_premium_expires_at(end_iso)
            if dt_end is not None:
                user.plan = USER_PLAN_PREMIUM
                user.premium_expires_at = dt_end.isoformat().replace("+00:00", "Z")
                self.user_service.update_user(user)
                return self.user_service.get_user(user_id) or user

        return self._extend_user_premium(user, days=30)

    def _extend_user_premium(self, user: Any, days: int) -> Any:
        now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        current_expiry = parse_premium_expires_at(getattr(user, "premium_expires_at", None))
        base = current_expiry if current_expiry and current_expiry > now_dt else now_dt
        next_expiry = base + timedelta(days=days)
        user.plan = USER_PLAN_PREMIUM
        user.premium_expires_at = next_expiry.isoformat().replace("+00:00", "Z")
        self.user_service.update_user(user)
        return self.user_service.get_user(user.user_id) or user

    def _is_event_processed(self, event_id: str) -> bool:
        events = self._read_shadow_events()
        return any(str(evt.get("event_id")) == event_id for evt in events)

    def _record_processed_event(self, event_id: str, event_type: str, payload: Dict[str, Any]) -> None:
        events = self._read_shadow_events()
        events.append(
            {
                "event_id": event_id,
                "event_type": event_type,
                "processed_at": utc_now_iso(),
            }
        )
        self._write_shadow_events(events)

    def _read_shadow_events(self) -> List[Dict[str, Any]]:
        try:
            if not self._shadow_events_path.exists():
                return []
            payload = json.loads(self._shadow_events_path.read_text(encoding="utf-8"))
            items = payload.get("events") if isinstance(payload, dict) else payload
            if not isinstance(items, list):
                return []
            return [item for item in items if isinstance(item, dict)]
        except Exception:
            return []

    def _write_shadow_events(self, events: List[Dict[str, Any]]) -> None:
        self._shadow_events_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"events": events[-500:]}
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=str(self._shadow_events_path.parent), delete=False, suffix=".tmp"
        ) as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            temp_name = handle.name
        Path(temp_name).replace(self._shadow_events_path)
