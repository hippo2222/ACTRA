"""
Phase 6 — Сквозной интеграционный тест (End-to-End).

Полный путь пользователя через HTTP API:
  1. Создать пользователя
  2. Выбрать пользователя
  3. Создать модуль → топик → задачу (test-type)
  4. Сохранить данные задачи
  5. Собрать комплекс
  6. Запустить сессию → пройти все задачи
  7. Проверить итоги сессии
  8. Проверить статистику
  9. Проверить календарь
 10. Заморозить комплекс
 11. Разморозить комплекс
 12. Удалить тестовые данные (cleanup)
"""

import sys
import json
import shutil
import uuid
from pathlib import Path

import pytest

# Ensure desktop-app is on sys.path
DESKTOP_APP_DIR = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from server import app, _headless_app_ctx  # type: ignore


# ---------------------------------------------------------------------------
# Unique names to avoid collision with real data
# ---------------------------------------------------------------------------
_UID = uuid.uuid4().hex[:8]
MODULE_NAME = f"e2e_mod_{_UID}"
TOPIC_NAME = f"e2e_topic_{_UID}"
TASK_NAME = f"e2e_task_{_UID}"
COMPLEX_NAME = f"E2E Complex {_UID}"
USER_NAME = f"E2E User {_UID}"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def client():
    """Flask test client."""
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture(scope="module")
def state():
    """Shared mutable dict to pass identifiers between ordered test steps."""
    return {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _ok(resp, msg=""):
    """Assert HTTP 2xx and JSON .ok / .success is truthy."""
    data = resp.get_json()
    assert resp.status_code < 400, (
        f"[{msg}] HTTP {resp.status_code}: {json.dumps(data, ensure_ascii=False, default=str)}"
    )
    # API uses either "ok" or "success" as the boolean flag
    flag = data.get("ok") or data.get("success")
    assert flag, f"[{msg}] Response not ok: {json.dumps(data, ensure_ascii=False, default=str)}"
    return data


# ============================================================================
# Tests — executed in order via pytest-ordering or file-level sequential run
# ============================================================================

class TestPhase6E2E:
    """Ordered E2E journey — each method depends on the previous one."""

    # Shared state across all methods in the class
    _state: dict = {}
    _original_user_id: str = ""

    # ------------------------------------------------------------------
    # Step 1: Create user
    # ------------------------------------------------------------------
    def test_01_create_user(self, client):
        data = _ok(
            client.post("/api/users", json={"name": USER_NAME}),
            "create_user",
        )
        user = data["user"]
        self._state["user_id"] = user["user_id"]
        assert user["name"] == USER_NAME

    # ------------------------------------------------------------------
    # Step 2: Select user
    # ------------------------------------------------------------------
    def test_02_select_user(self, client):
        TestPhase6E2E._original_user_id = _headless_app_ctx.user_id
        data = _ok(
            client.post("/api/users/select", json={"user_id": self._state["user_id"]}),
            "select_user",
        )

    # ------------------------------------------------------------------
    # Step 3a: Create module
    # ------------------------------------------------------------------
    def test_03a_create_module(self, client):
        data = _ok(
            client.post("/api/editor/module/new", json={"name": MODULE_NAME}),
            "create_module",
        )
        self._state["module_id"] = data["module_id"]

    # ------------------------------------------------------------------
    # Step 3b: Create topic
    # ------------------------------------------------------------------
    def test_03b_create_topic(self, client):
        data = _ok(
            client.post("/api/editor/topic/new", json={
                "module_id": self._state["module_id"],
                "name": TOPIC_NAME,
            }),
            "create_topic",
        )
        self._state["topic_id"] = data["topic_id"]

    # ------------------------------------------------------------------
    # Step 3c: Create task (test type)
    # ------------------------------------------------------------------
    def test_03c_create_task(self, client):
        data = _ok(
            client.post("/api/editor/task/new", json={
                "module_id": self._state["module_id"],
                "topic_id": self._state["topic_id"],
                "task_name": TASK_NAME,
                "task_type": "test",
            }),
            "create_task",
        )
        self._state["task_id"] = data["task_id"]

    # ------------------------------------------------------------------
    # Step 4: Save task data (one question, single-choice)
    # ------------------------------------------------------------------
    def test_04_save_task_data(self, client):
        mid = self._state["module_id"]
        tid = self._state["topic_id"]
        task_id = self._state["task_id"]

        task_payload = {
            "id": task_id,
            "type": "test",
            "meta": {
                "task_schema_version": "1.2",
                "name": TASK_NAME,
                "module": mid,
                "topic": tid,
                "id": task_id,
            },
            "content": {
                "questions": [
                    {
                        "id": 0,
                        "text": "Столица Франции?",
                        "answers": [
                            {"text": "Париж", "correct": True},
                            {"text": "Лондон", "correct": False},
                            {"text": "Берлин", "correct": False},
                        ],
                    }
                ],
                "test_type": "single_choice",
                "settings": {
                    "shuffle_questions": False,
                    "shuffle_answers": False,
                    "passing_score": 70,
                },
            },
            "settings": {
                "difficulty": 1,
                "time_limit": None,
                "allow_hints": False,
            },
        }

        data = _ok(
            client.post(f"/api/editor/task/{mid}/{tid}/{task_id}", json=task_payload),
            "save_task",
        )

    # ------------------------------------------------------------------
    # Step 5: Create complex
    # ------------------------------------------------------------------
    def test_05_create_complex(self, client):
        mid = self._state["module_id"]
        tid = self._state["topic_id"]
        task_id = self._state["task_id"]
        task_ref = f"{mid}/{tid}/{task_id}"

        data = _ok(
            client.post("/api/complexes", json={
                "name": COMPLEX_NAME,
                "description": "E2E test complex",
                "tasks": [task_ref],
            }),
            "create_complex",
        )
        self._state["complex_id"] = data["item"]["id"]

    # ------------------------------------------------------------------
    # Step 6a: Start session
    # ------------------------------------------------------------------
    def test_06a_start_session(self, client):
        cid = self._state["complex_id"]
        uid = self._state["user_id"]

        data = _ok(
            client.post(f"/api/session/{cid}/start", json={
                "user_id": uid,
                "start_iteration": 1,
            }),
            "start_session",
        )
        self._state["session_id"] = data["session_id"]

    # ------------------------------------------------------------------
    # Step 6b: Get current task
    # ------------------------------------------------------------------
    def test_06b_get_current_task(self, client):
        sid = self._state["session_id"]
        resp = client.get(f"/api/session/{sid}/task")
        assert resp.status_code == 200, f"get_task HTTP {resp.status_code}"
        data = resp.get_json()
        assert data.get("ok") is not False, f"get_task failed: {data}"

        # Extract the task_id from the response
        task_data = data.get("task_data") or data.get("task", {}).get("task_data") or {}
        task_id_from_server = (
            data.get("task_id")
            or task_data.get("id")
            or data.get("task", {}).get("task_id")
        )
        self._state["current_task_id"] = task_id_from_server

    # ------------------------------------------------------------------
    # Step 6c: Submit correct answer
    # ------------------------------------------------------------------
    def test_06c_submit_answer(self, client):
        sid = self._state["session_id"]
        task_id = self._state["current_task_id"]
        assert task_id, "No task_id obtained from previous step"

        resp = client.post(f"/api/session/{sid}/task/submit", json={
            "task_id": task_id,
            "user_input": {
                "answers": {"0": 0},       # question 0, answer index 0 = correct
            },
        })
        data = resp.get_json()
        # Accept 200 or 409 (task_id_mismatch if session auto-advanced)
        assert resp.status_code in (200, 409), (
            f"submit HTTP {resp.status_code}: {data}"
        )
        if resp.status_code == 200:
            self._state["submit_ok"] = True
        else:
            self._state["submit_ok"] = False

    # ------------------------------------------------------------------
    # Step 6d: Advance / check session completion
    # ------------------------------------------------------------------
    def test_06d_advance_session(self, client):
        sid = self._state["session_id"]
        # Try to advance — with a single task, session should complete
        resp = client.post(f"/api/session/{sid}/task/next")
        data = resp.get_json()
        # 410 = session_completed, 200 = more tasks, 400 = other
        self._state["session_completed"] = (
            resp.status_code == 410
            or (isinstance(data, dict) and data.get("error") == "session_completed")
        )

    # ------------------------------------------------------------------
    # Step 7: Check iteration / final results
    # ------------------------------------------------------------------
    def test_07_check_results(self, client):
        sid = self._state["session_id"]

        # Iteration results
        resp = client.get(f"/api/session/{sid}/iteration-results")
        # May be 200 or 404 depending on session state
        iter_data = resp.get_json()

        # Final results
        resp2 = client.get(f"/api/session/{sid}/final-results")
        final_data = resp2.get_json()

        # At least one of them should have data
        has_iter = resp.status_code == 200 and iter_data.get("ok") is not False
        has_final = resp2.status_code == 200 and final_data.get("ok") is not False
        assert has_iter or has_final, (
            f"Neither iteration nor final results available: "
            f"iter={resp.status_code} final={resp2.status_code}"
        )

    # ------------------------------------------------------------------
    # Step 8: Check statistics
    # ------------------------------------------------------------------
    def test_08_check_statistics(self, client):
        uid = self._state["user_id"]

        # Overall stats
        resp = client.get(f"/api/statistics/overall?user_id={uid}")
        assert resp.status_code == 200, f"stats HTTP {resp.status_code}"
        data = resp.get_json()
        assert data.get("ok") is True, f"stats failed: {data}"

        # Time dynamics
        resp2 = client.get(f"/api/statistics/time-dynamics?user_id={uid}&days=7")
        assert resp2.status_code == 200

    # ------------------------------------------------------------------
    # Step 9: Check calendar
    # ------------------------------------------------------------------
    def test_09_check_calendar(self, client):
        resp = client.get("/api/calendar/today")
        data = resp.get_json()
        # Calendar may return success=True or just work
        assert resp.status_code == 200, f"calendar HTTP {resp.status_code}: {data}"

        # Activity heatmap
        resp2 = client.get("/api/calendar/activity?days=7")
        assert resp2.status_code == 200

    # ------------------------------------------------------------------
    # Step 9b: Record calendar attempt (creates IN_PROGRESS progress)
    # ------------------------------------------------------------------
    def test_09b_record_calendar_attempt(self, client):
        cid = self._state["complex_id"]
        task_id = self._state["task_id"]
        resp = client.post("/api/calendar/attempt", json={
            "task_id": task_id,
            "complex_id": cid,
            "user_grading": 1,
            "response_time_seconds": 10.0,
        })
        data = resp.get_json()
        assert resp.status_code == 200, f"record_attempt HTTP {resp.status_code}: {data}"

    # ------------------------------------------------------------------
    # Step 10: Freeze complex
    # ------------------------------------------------------------------
    def test_10_freeze_complex(self, client):
        cid = self._state["complex_id"]
        resp = client.post(f"/api/calendar/complex/{cid}/freeze", json={"days": 30})
        data = resp.get_json()
        assert resp.status_code == 200, f"freeze HTTP {resp.status_code}: {data}"
        assert data.get("success") is True or data.get("ok") is True, (
            f"freeze failed: {data}"
        )

    # ------------------------------------------------------------------
    # Step 11: Unfreeze complex
    # ------------------------------------------------------------------
    def test_11_unfreeze_complex(self, client):
        cid = self._state["complex_id"]
        resp = client.post(f"/api/calendar/complex/{cid}/unfreeze")
        data = resp.get_json()
        assert resp.status_code == 200, f"unfreeze HTTP {resp.status_code}: {data}"
        assert data.get("success") is True or data.get("ok") is True, (
            f"unfreeze failed: {data}"
        )

    # ------------------------------------------------------------------
    # Step 12: Cleanup — delete test data, restore original user
    # ------------------------------------------------------------------
    def test_99_cleanup(self, client):
        errors = []

        # Delete complex
        cid = self._state.get("complex_id")
        if cid:
            r = client.delete(f"/api/complexes/{cid}")
            if r.status_code >= 400:
                errors.append(f"delete complex: {r.status_code}")

        # Delete task
        mid = self._state.get("module_id")
        tid = self._state.get("topic_id")
        task_id = self._state.get("task_id")
        if mid and tid and task_id:
            r = client.delete(f"/api/editor/task/{mid}/{tid}/{task_id}")
            if r.status_code >= 400:
                errors.append(f"delete task: {r.status_code}")

        # Remove module directory from disk
        if mid:
            mod_dir = _headless_app_ctx.storage_service.modules_dir / mid
            if mod_dir.exists():
                shutil.rmtree(mod_dir, ignore_errors=True)
            _headless_app_ctx.storage_service.reload_modules()

        # Delete user
        uid = self._state.get("user_id")
        if uid:
            r = client.post("/api/users/delete", json={"user_id": uid})
            if r.status_code >= 400:
                errors.append(f"delete user: {r.status_code}")

        # Restore original active user
        if TestPhase6E2E._original_user_id:
            client.post("/api/users/select", json={
                "user_id": TestPhase6E2E._original_user_id,
            })

        # Non-fatal: log but don't fail the test on cleanup issues
        if errors:
            print(f"[Phase6 cleanup warnings] {errors}")
