"""
Calendar API - HTTP эндпоинты для календаря обучения.

Эндпоинты:
- GET  /api/calendar/today          - План на сегодня
- POST /api/calendar/settings       - Обновить настройки
- GET  /api/calendar/schedule       - Расписание на несколько дней
- POST /api/calendar/session/start  - Начать сессию
- POST /api/calendar/session/{id}/complete - Завершить сессию
- POST /api/calendar/complex/{id}/freeze   - Заморозить комплекс
- POST /api/calendar/complex/{id}/unfreeze - Разморозить комплекс
- POST /api/calendar/complex/{id}/mastered - Отметить освоенным
- GET  /api/calendar/health         - Здоровье памяти
- GET  /api/calendar/activity       - Данные для heatmap
- POST /api/calendar/notification/{id}/dismiss - Закрыть уведомление
- POST /api/calendar/attempt        - Записать попытку задачи
"""

from typing import Any, Dict, List, Optional
import logging
import os
import inspect
import re
from datetime import datetime, timedelta

from routes._helpers import _maybe_hosted_shadow_write_error_response

logger = logging.getLogger(__name__)

_RAW_ID_RE = re.compile(
    r"^(?:[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$",
    re.IGNORECASE,
)

# Простое кеширование для /api/calendar/activity
_activity_cache = {
    "data": None,
    "timestamp": None,
    "ttl_seconds": 60,
}


def _invalidate_activity_cache():
    """Сбросить кеш активности после мутирующих операций."""
    _activity_cache["data"] = None
    _activity_cache["timestamp"] = None


def _calendar_error_response(exc: Exception):
    hosted_response = _maybe_hosted_shadow_write_error_response(
        exc,
        extra_payload={
            "success": False,
            "route_contract": "public_calendar",
        },
        status=503,
    )
    if hosted_response is not None:
        return hosted_response
    return {"success": False, "error": str(exc)}, 500


def create_calendar_routes(app, calendar_service, complex_service=None, session_api=None):
    """
    Создать роуты для календаря.
    
    Args:
        app: Flask/Bottle приложение
        calendar_service: CalendarService instance
        complex_service: ComplexService для получения списка комплексов
    """
    
    # =========================================================================
    # GET /api/calendar/today
    # =========================================================================
    def _normalize_complex_obj(c):
        """Convert complex object (dict/pydantic/attr) to dict."""
        try:
            if hasattr(c, "dict"):
                return c.dict()
            if isinstance(c, dict):
                return c
            return {
                "id": getattr(c, "id", None) or getattr(c, "complex_id", ""),
                "complex_id": getattr(c, "complex_id", None) or getattr(c, "id", ""),
                "name": getattr(c, "name", ""),
                "tasks": getattr(c, "tasks", []) or [],
                "status": getattr(c, "status", None),
            }
        except Exception:
            logger.exception("Failed to normalize complex object", extra={"complex": str(c)})
            return {}

    def _is_raw_display_id(value):
        text = str(value or "").strip()
        return bool(text and _RAW_ID_RE.match(text))

    def _resolve_complex_display_name(obj, complex_id=""):
        """Return a user-facing complex name; never expose storage ids as names."""
        candidates = [
            obj.get("name"),
            obj.get("title"),
            obj.get("display_name"),
            obj.get("complex_name"),
        ]
        for nested_key in ("metadata", "meta", "details"):
            nested = obj.get(nested_key)
            if isinstance(nested, dict):
                candidates.extend([
                    nested.get("name"),
                    nested.get("title"),
                    nested.get("display_name"),
                ])

        for candidate in candidates:
            text = str(candidate or "").strip()
            if text and text != str(complex_id or "").strip() and not _is_raw_display_id(text):
                return text
        return "Комплекс без названия"

    @app.route("/api/calendar/today", methods=["GET"])
    def get_today_plan():
        """
        Получить план на сегодня.
        
        Returns:
            {
                "daily_plan": {...},
                "notifications": [...],
                "streak_info": {...},
                "health_summary": {...},
                "schedule_strip": [...],
                "settings": {...},
                "is_adapted": bool
            }
        """
        try:
            # Получаем пул задач из complex_service
            task_pool = {}
            complex_names = {}
            current_complex = None
            current_complex_id = None

            # Определяем текущий комплекс на основе прогресса календаря
            try:
                for p in calendar_service.get_all_progress() or []:
                    if getattr(p, "status", None) and p.status.value == "in_progress":
                        current_complex_id = p.complex_id
                        break
            except Exception:
                current_complex_id = None
            
            if complex_service:
                complexes = complex_service.get_all_complexes()
                for c in complexes:
                    obj = _normalize_complex_obj(c)
                    cid = obj.get("id") or obj.get("complex_id") or ""
                    display_name = _resolve_complex_display_name(obj, cid)
                    raw_tasks = obj.get("tasks", []) or []
                    normalized_tasks = []
                    for t in raw_tasks:
                        if isinstance(t, dict):
                            task_obj = dict(t)
                            nested_complex = task_obj.get("complex") if isinstance(task_obj.get("complex"), dict) else {}
                            task_name = task_obj.get("complex_name") or nested_complex.get("name") or display_name
                            task_obj["complex_name"] = display_name if _is_raw_display_id(task_name) else task_name
                            normalized_tasks.append(task_obj)
                        else:
                            normalized_tasks.append({
                                "task_id": str(t),
                                "complex_name": display_name,
                                "duration": 150,
                            })
                    task_pool[cid] = normalized_tasks
                    complex_names[cid] = display_name

                    # Текущий комплекс = первый комплекс, который отмечен in_progress в календарном прогрессе
                    if current_complex is None and current_complex_id and cid == current_complex_id:
                        current_complex = c
            
            result = calendar_service.get_today_plan(
                task_pool=task_pool,
                current_complex=current_complex,
                complex_names=complex_names,
            )

            # Runtime debug to verify which scheduler implementation is used
            try:
                settings = calendar_service.get_settings()
                scheduler = getattr(calendar_service, "scheduler_service", None)
                scheduler_cls = scheduler.__class__ if scheduler else None
                scheduler_file = inspect.getsourcefile(scheduler_cls) if scheduler_cls else None
                calculated_target = scheduler.calculate_daily_mix_size(settings.daily_time_limit_minutes) if scheduler else None

                result["debug"] = {
                    "daily_time_limit_minutes": settings.daily_time_limit_minutes,
                    "calculated_daily_mix_target": calculated_target,
                    "scheduler_class": f"{scheduler_cls.__module__}.{scheduler_cls.__name__}" if scheduler_cls else None,
                    "scheduler_source_file": scheduler_file,
                }
            except Exception:
                # Never break response due to debug collection
                pass
            
            return {"success": True, **result}
        
        except Exception as e:
            logger.exception("Error in get_today_plan")
            return _calendar_error_response(e)
    
    # =========================================================================
    # POST /api/calendar/settings
    # =========================================================================
    @app.route("/api/calendar/settings", methods=["POST"])
    def update_settings():
        """
        Обновить настройки календаря.
        
        Body:
            {
                "daily_time_limit_minutes": 30,  // optional
                "schedule_mode": "daily"         // optional
            }
        """
        try:
            from flask import request
            data = request.get_json() or {}
            
            result = {"success": True}
            
            if "daily_time_limit_minutes" in data:
                r = calendar_service.update_time_limit(data["daily_time_limit_minutes"])
                result["settings"] = r.get("settings")
            
            if "schedule_mode" in data:
                r = calendar_service.switch_schedule_mode(data["schedule_mode"])
                result["settings"] = r.get("settings")
            
            return result
        
        except Exception as e:
            logger.error(f"Error in update_settings: {e}")
            return _calendar_error_response(e)
    
    # =========================================================================
    # GET /api/calendar/schedule
    # =========================================================================
    @app.route("/api/calendar/schedule", methods=["GET"])
    def get_schedule():
        """
        Получить расписание на несколько дней.
        
        Query params:
            days: int (default 5)
        """
        try:
            from flask import request
            days = request.args.get("days", 5, type=int)
            
            settings = calendar_service.get_settings()
            activity = calendar_service.get_activity_history()
            
            schedule = calendar_service.scheduler_service.build_schedule_strip(
                user_id=calendar_service.user_id,
                days_count=days,
                schedule_mode=settings.schedule_mode.value,
                activity_history=activity,
                available_minutes=settings.daily_time_limit_minutes,
            )
            
            return {
                "success": True,
                "schedule": [d.to_dict() for d in schedule],
            }
        
        except Exception as e:
            logger.error(f"Error in get_schedule: {e}")
            return _calendar_error_response(e)
    
    # =========================================================================
    # POST /api/calendar/session/start
    # =========================================================================
    @app.route("/api/calendar/session/start", methods=["POST"])
    def start_session():
        """
        Начать сессию обучения.
        
        Body:
            {
                "session_type": "daily_mix" | "new_material" | "unplanned",
                "complex_id": "..."  // optional, for new_material
            }
        """
        try:
            from flask import request
            data = request.get_json() or {}
            
            session_type = data.get("session_type", "daily_mix")
            complex_id = data.get("complex_id")
            
            # For daily_mix we proxy to SessionAPI to create a custom session with task_refs
            if session_type == "daily_mix" and session_api:
                # Build today's plan to get daily_mix tasks
                task_pool = {}
                complex_names = {}
                current_complex = None
                if complex_service:
                    complexes = complex_service.get_all_complexes()
                    for c in complexes:
                        obj = _normalize_complex_obj(c)

                        cid = obj.get("id", None) or obj.get("complex_id", "")
                        display_name = _resolve_complex_display_name(obj, cid)
                        raw_tasks = obj.get("tasks", []) or []
                        normalized_tasks = []
                        for t in raw_tasks:
                            if isinstance(t, dict):
                                task_obj = dict(t)
                                nested_complex = task_obj.get("complex") if isinstance(task_obj.get("complex"), dict) else {}
                                task_name = task_obj.get("complex_name") or nested_complex.get("name") or display_name
                                task_obj["complex_name"] = display_name if _is_raw_display_id(task_name) else task_name
                                normalized_tasks.append(task_obj)
                            else:
                                normalized_tasks.append({
                                    "task_id": str(t),
                                    "complex_name": display_name,
                                    "duration": 150,
                                })
                        task_pool[cid] = normalized_tasks
                        complex_names[cid] = display_name
                        status = obj.get("status", None)
                        if not current_complex and status == "in_progress":
                            current_complex = c
                
                plan = calendar_service.get_today_plan(
                    task_pool=task_pool,
                    current_complex=current_complex,
                    complex_names=complex_names,
                )
                daily_mix = (plan.get("daily_plan") or {}).get("daily_mix") or []
                
                # Build task_refs from daily_mix
                task_refs = []
                for task_item in daily_mix:
                    if not isinstance(task_item, dict):
                        continue
                    
                    task_id = task_item.get("task_id")
                    complex_id = task_item.get("complex_id")
                    
                    if not task_id or not complex_id:
                        continue
                    
                    # Try to find task_ref from complex tasks
                    # task_ref format: module/topic/task_id
                    task_ref = None
                    if complex_service:
                        try:
                            complex_obj = complex_service.get_complex(complex_id)
                            if complex_obj:
                                tasks = getattr(complex_obj, "tasks", []) if hasattr(complex_obj, "tasks") else complex_obj.get("tasks", [])
                                for t in tasks:
                                    # tasks is a list of task_refs (module/topic/task_id)
                                    if isinstance(t, str) and t.endswith(f"/{task_id}"):
                                        task_ref = t
                                        break
                                    elif isinstance(t, str) and task_id in t:
                                        task_ref = t
                                        break
                        except Exception as e:
                            logger.warning(f"Failed to get complex {complex_id}: {e}")
                    
                    if task_ref:
                        task_refs.append(task_ref)
                    else:
                        logger.warning(f"Could not find task_ref for task_id={task_id} in complex_id={complex_id}")

                logger.info("[calendar.start_session] daily_mix: task_refs BEFORE dedup=%s", task_refs)

                # Deduplicate while preserving order to avoid duplicate tasks in daily_mix queues
                if task_refs:
                    seen = set()
                    deduped = []
                    for ref in task_refs:
                        if ref in seen:
                            continue
                        seen.add(ref)
                        deduped.append(ref)
                    if len(deduped) != len(task_refs):
                        logger.warning(
                            "[calendar.start_session] Removed %s duplicate task_refs from daily_mix (kept %s)",
                            len(task_refs) - len(deduped),
                            len(deduped),
                        )
                    task_refs = deduped

                logger.info("[calendar.start_session] daily_mix: task_refs AFTER dedup=%s", task_refs)

                if not task_refs:
                    return {"success": False, "error": "no_daily_mix_tasks"}, 400
                
                # Start custom session with task_refs
                logger.info("[calendar.start_session] daily_mix: calling start_custom_session with task_refs=%s, user_id=%s", task_refs, getattr(calendar_service, "user_id", None))
                start_res = session_api.start_custom_session(
                    task_refs=task_refs,
                    user_id=getattr(calendar_service, "user_id", None)
                )
                logger.info("[calendar.start_session] daily_mix: start_custom_session returned: %s", start_res)
                ok = start_res.get("ok") or start_res.get("success")
                if ok:
                    return {"success": True, **start_res}
                return {"success": False, "error": start_res.get("error", "failed_to_start_session")}, 400
            
            # Default behavior (new_material/unplanned or no session_api)
            result = calendar_service.start_session(
                session_type=session_type,
                complex_id=complex_id,
            )
            
            return {"success": True, **result}
        
        except Exception as e:
            logger.error(f"Error in start_session: {e}")
            return _calendar_error_response(e)
    
    # =========================================================================
    # POST /api/calendar/session/<id>/complete
    # =========================================================================
    @app.route("/api/calendar/session/<session_id>/complete", methods=["POST"])
    def complete_session(session_id: str):
        """
        Завершить сессию.
        
        Body:
            {
                "tasks_completed": 5,
                "active_time_seconds": 600
            }
        """
        try:
            from flask import request
            data = request.get_json() or {}
            
            result = calendar_service.complete_session(
                session_id=session_id,
                tasks_completed=data.get("tasks_completed", 0),
                active_time_seconds=data.get("active_time_seconds", 0),
            )
            
            _invalidate_activity_cache()
            return result
        
        except Exception as e:
            logger.error(f"Error in complete_session: {e}")
            return _calendar_error_response(e)
    
    # =========================================================================
    # POST /api/calendar/complex/<id>/freeze
    # =========================================================================
    @app.route("/api/calendar/complex/<complex_id>/freeze", methods=["POST"])
    def freeze_complex(complex_id: str):
        """
        Заморозить комплекс.
        
        Body:
            {
                "days": 30 | 60 | 90
            }
        """
        try:
            from flask import request
            data = request.get_json() or {}
            days = data.get("days", 30)
            
            result = calendar_service.freeze_complex(complex_id, days)
            return result
        
        except Exception as e:
            logger.error(f"Error in freeze_complex: {e}")
            return _calendar_error_response(e)
    
    # =========================================================================
    # POST /api/calendar/complex/<id>/unfreeze
    # =========================================================================
    @app.route("/api/calendar/complex/<complex_id>/unfreeze", methods=["POST"])
    def unfreeze_complex(complex_id: str):
        """Разморозить комплекс."""
        try:
            result = calendar_service.unfreeze_complex(complex_id)
            return result
        
        except Exception as e:
            logger.error(f"Error in unfreeze_complex: {e}")
            return _calendar_error_response(e)
    
    # =========================================================================
    # POST /api/calendar/complex/<id>/mastered
    # =========================================================================
    @app.route("/api/calendar/complex/<complex_id>/mastered", methods=["POST"])
    def mark_mastered(complex_id: str):
        """Отметить комплекс как освоенный."""
        try:
            result = calendar_service.mark_complex_mastered(complex_id)
            return result
        
        except Exception as e:
            logger.error(f"Error in mark_mastered: {e}")
            return _calendar_error_response(e)
    
    # =========================================================================
    # GET /api/calendar/health
    # =========================================================================
    @app.route("/api/calendar/health", methods=["GET"])
    def get_health():
        """
        Получить сводку по здоровью памяти.
        
        Returns:
            {
                "overall_health": 0.87,
                "overall_health_percent": 87,
                "complexes": [...],
                "critical_count": 1
            }
        """
        try:
            all_progress = calendar_service.get_all_progress()
            
            # Получаем названия комплексов
            complex_names = {}
            if complex_service:
                for c in complex_service.get_all_complexes():
                    obj = _normalize_complex_obj(c)
                    cid = obj.get("id") or obj.get("complex_id") or ""
                    complex_names[cid] = _resolve_complex_display_name(obj, cid)
            
            summary = calendar_service._build_health_summary(all_progress, complex_names)
            
            return {"success": True, **summary.to_dict()}
        
        except Exception as e:
            logger.error(f"Error in get_health: {e}")
            return _calendar_error_response(e)
    
    # =========================================================================
    # GET /api/calendar/activity
    # =========================================================================
    @app.route("/api/calendar/activity", methods=["GET"])
    def get_activity():
        """
        Получить данные активности для heatmap.
        
        Query params:
            days: int (default 30)
        """
        try:
            from flask import request
            days = request.args.get("days", 30, type=int)
            
            # Проверяем кеш (только для days=30, чтобы не усложнять)
            now = datetime.now()
            if (
                days == 30
                and _activity_cache["data"] is not None
                and _activity_cache["timestamp"] is not None
                and (now - _activity_cache["timestamp"]).total_seconds() < _activity_cache["ttl_seconds"]
            ):
                logger.debug("Returning cached activity data")
                return _activity_cache["data"]
            
            activity = calendar_service.get_activity_for_heatmap(days)
            
            response = {
                "success": True,
                "activity": activity,
                "days_count": len(activity),
            }
            
            # Кешируем результат для days=30
            if days == 30:
                _activity_cache["data"] = response
                _activity_cache["timestamp"] = now
            
            return response
        
        except Exception as e:
            logger.error(f"Error in get_activity: {e}")
            return _calendar_error_response(e)
    
    # =========================================================================
    # POST /api/calendar/notification/<id>/dismiss
    # =========================================================================
    @app.route("/api/calendar/notification/<notification_id>/dismiss", methods=["POST"])
    def dismiss_notification(notification_id: str):
        """Закрыть уведомление."""
        try:
            result = calendar_service.dismiss_notification(notification_id)
            return result
        
        except Exception as e:
            logger.error(f"Error in dismiss_notification: {e}")
            return _calendar_error_response(e)
    
    # =========================================================================
    # POST /api/calendar/attempt
    # =========================================================================
    @app.route("/api/calendar/attempt", methods=["POST"])
    def record_attempt():
        """
        Записать попытку выполнения задачи.
        
        Body:
            {
                "task_id": "...",
                "complex_id": "...",
                "user_grading": 0 | 1,
                "response_time_seconds": 45.5,
                "confidence_rating": 4  // optional, Stage 2
            }
        """
        try:
            from flask import request
            data = request.get_json() or {}
            
            result = calendar_service.record_task_attempt(
                task_id=data["task_id"],
                complex_id=data["complex_id"],
                user_grading=data.get("user_grading", 0),
                response_time_seconds=data.get("response_time_seconds", 0),
                confidence_rating=data.get("confidence_rating"),
            )
            
            _invalidate_activity_cache()
            return result
        
        except KeyError as e:
            return {"success": False, "error": f"Missing field: {e}"}, 400
        except Exception as e:
            logger.error(f"Error in record_attempt: {e}")
            return _calendar_error_response(e)
    
    # =========================================================================
    # GET /api/calendar/rest-days
    # =========================================================================
    @app.route("/api/calendar/rest-days", methods=["GET"])
    def get_rest_days():
        """Получить список выходных дней."""
        try:
            rest_days = calendar_service.get_rest_days()
            return {"success": True, "rest_days": rest_days}
        except Exception as e:
            logger.error(f"Error in get_rest_days: {e}")
            return _calendar_error_response(e)
    
    # =========================================================================
    # POST /api/calendar/rest-days/<date_str>
    # =========================================================================
    @app.route("/api/calendar/rest-days/<date_str>", methods=["POST"])
    def mark_rest_day(date_str: str):
        """
        Отметить день как выходной.
        
        Body: {"reason": "manual"}
        """
        try:
            from flask import request
            data = request.get_json() or {}
            reason = data.get("reason", "manual")
            
            success = calendar_service.mark_rest_day(date_str, reason)
            
            if success:
                return {"success": True, "date": date_str}
            
            return {"success": False, "error": "Failed to mark rest day"}, 500
        except Exception as e:
            logger.error(f"Error in mark_rest_day: {e}")
            return _calendar_error_response(e)
    
    # =========================================================================
    # DELETE /api/calendar/rest-days/<date_str>
    # =========================================================================
    @app.route("/api/calendar/rest-days/<date_str>", methods=["DELETE"])
    def unmark_rest_day(date_str: str):
        """Снять отметку выходного дня."""
        try:
            success = calendar_service.unmark_rest_day(date_str)
            
            if success:
                return {"success": True, "date": date_str}
            
            return {"success": False, "error": "Failed to unmark rest day"}, 500
        except Exception as e:
            logger.error(f"Error in unmark_rest_day: {e}")
            return _calendar_error_response(e)
    
    logger.info("Calendar API routes registered")
    return app


# =============================================================================
# STANDALONE REGISTRATION (for server.py integration)
# =============================================================================

def register_calendar_api(app, data_dir: str, user_id: Optional[str] = None):
    """
    Зарегистрировать Calendar API в приложении.
    
    Args:
        app: Flask приложение
        data_dir: Директория с данными
        user_id: ID пользователя
    """
    from services.calendar import CalendarService
    
    calendar_service = CalendarService(
        data_dir=data_dir,
        user_id=user_id or "default_user",
    )
    
    # Пытаемся получить complex_service если доступен
    complex_service = None
    try:
        from services.complex_service import ComplexService
        complex_service = ComplexService(data_dir)
    except ImportError:
        logger.warning("ComplexService not available, calendar will work with limited features")
    
    return create_calendar_routes(app, calendar_service, complex_service)
