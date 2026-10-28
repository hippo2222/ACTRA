"""
Seed and verify S1 clinical hierarchy live test stand in PostgreSQL and Flask.
"""

import json
import os
import sys
from pathlib import Path
import requests

BASE_URL = os.environ.get("ACTRA_BASE_URL", "http://127.0.0.1:8000")
FIXTURES_DIR = Path(__file__).parent


def run_seed_and_verify():
    session = requests.Session()

    # 1. Register or login user
    user_payload = {
        "name": "Dr. Clinical Expert",
        "login": "clinical_expert",
        "email": "clinical_expert@actra.local",
        "password": "Clinical.Pass1!",
        "avatar_seed": "1.png",
    }
    reg_resp = session.post(f"{BASE_URL}/api/auth/register", json=user_payload)
    if not reg_resp.ok:
        login_resp = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"identifier": user_payload["email"], "password": user_payload["password"]},
        )
        assert login_resp.ok, f"Failed to authenticate: {login_resp.text}"

    me_resp = session.get(f"{BASE_URL}/api/auth/me")
    assert me_resp.ok, f"Failed to get current user: {me_resp.text}"
    user_data = me_resp.json()
    user_id = user_data.get("user", {}).get("user_id")
    print(f"[Stand] Authenticated as {user_id} ({user_data.get('user', {}).get('name')})")

    # 2. Ensure Module and Topic
    cat_resp = session.get(f"{BASE_URL}/api/editor/catalog")
    assert cat_resp.ok, f"Failed to get editor catalog: {cat_resp.text}"
    catalog = cat_resp.json()
    modules = catalog.get("modules", [])

    module_id = "neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya"
    topic_id = "differentsialnaya_diagnostika_i_stratifikatsiya_riska"

    mod_row = next((m for m in modules if m.get("id") == module_id or m.get("module_id") == module_id), None)
    if not mod_row:
        m_resp = session.post(
            f"{BASE_URL}/api/editor/module/new",
            json={"name": "Неотложные состояния: Пульмонология и Кардиология"},
        )
        if m_resp.ok:
            created_mod = m_resp.json()
            module_id = created_mod.get("module_id") or created_mod.get("id") or module_id
            print(f"[Stand] Created module: {module_id}")
        else:
            print(f"[Stand] Module creation response: {m_resp.text}")
    else:
        module_id = mod_row.get("id") or mod_row.get("module_id")
        print(f"[Stand] Module exists: {module_id}")

    # Ensure topic
    top_row = None
    if mod_row:
        top_row = next((t for t in mod_row.get("topics", []) if t.get("id") == topic_id or t.get("topic_id") == topic_id), None)

    if not top_row:
        t_resp = session.post(
            f"{BASE_URL}/api/editor/topic/new",
            json={"module_id": module_id, "name": "Дифференциальная диагностика и стратификация риска"},
        )
        if t_resp.ok:
            created_top = t_resp.json()
            topic_id = created_top.get("topic_id") or created_top.get("id") or topic_id
            print(f"[Stand] Created topic: {topic_id}")
        else:
            print(f"[Stand] Topic creation response: {t_resp.text}")
    else:
        topic_id = top_row.get("id") or top_row.get("topic_id")
        print(f"[Stand] Topic exists: {topic_id}")

    # 3. Load & Save Task 5.1 (ТЭЛА)
    with open(FIXTURES_DIR / "table_5_1_tela_stratification.json", "r", encoding="utf-8") as f:
        t1_raw = json.load(f)

    task1_id = "task_5_1_tela_stratification"
    task1_payload = {
        "id": task1_id,
        "type": "sequence_assembly",
        "meta": {
            "task_schema_version": "1.2",
            "name": t1_raw["meta"]["name"],
            "title": t1_raw["meta"]["title"],
            "module": module_id,
            "topic": topic_id,
            "id": task1_id,
        },
        "content": t1_raw["content"],
        "settings": t1_raw.get("settings", {
            "display_mode": "hierarchy",
            "color_differentiation": True,
            "difficulty": 1,
        }),
    }
    save_t1_resp = session.post(
        f"{BASE_URL}/api/editor/task/{module_id}/{topic_id}/{task1_id}",
        json=task1_payload,
    )
    assert save_t1_resp.ok, f"Failed to save task 5.1: {save_t1_resp.text}"
    print(f"[Stand] Saved Task 5.1 ({task1_id})")

    # 4. Load & Save Task 5.2 (Пневмоторакс)
    with open(FIXTURES_DIR / "table_5_2_pneumothorax_differentiation.json", "r", encoding="utf-8") as f:
        t2_raw = json.load(f)

    task2_id = "task_5_2_pneumothorax_differentiation"
    task2_payload = {
        "id": task2_id,
        "type": "sequence_assembly",
        "meta": {
            "task_schema_version": "1.2",
            "name": t2_raw["meta"]["name"],
            "title": t2_raw["meta"]["title"],
            "module": module_id,
            "topic": topic_id,
            "id": task2_id,
        },
        "content": t2_raw["content"],
        "settings": t2_raw.get("settings", {
            "display_mode": "hierarchy",
            "color_differentiation": True,
            "difficulty": 1,
        }),
    }
    save_t2_resp = session.post(
        f"{BASE_URL}/api/editor/task/{module_id}/{topic_id}/{task2_id}",
        json=task2_payload,
    )
    assert save_t2_resp.ok, f"Failed to save task 5.2: {save_t2_resp.text}"
    print(f"[Stand] Saved Task 5.2 ({task2_id})")

    # 5. Create or Update Complex
    complex_id = "clinical_hierarchy_complex"
    complex_payload = {
        "id": complex_id,
        "name": "Клинический стенд: ТЭЛА и Острая патология плевры (Иерархии)",
        "description": "Сквозной клинический тренажер S1 для Таблиц 5.1 и 5.2 высокой информационной плотности",
        "tasks": [
            f"{module_id}/{topic_id}/{task1_id}",
            f"{module_id}/{topic_id}/{task2_id}",
        ],
        "settings": {
            "adaptive_difficulty": False,
            "escalation_on_success": False,
            "error_pool_enabled": False,
            "max_iterations": 1,
            "smart_retry_training_control_enabled": False,
        },
    }
    
    list_cx_resp = session.get(f"{BASE_URL}/api/complexes")
    existing_items = list_cx_resp.json().get("items", []) if list_cx_resp.ok else []
    exists = any(item.get("id") == complex_id for item in existing_items)

    if exists:
        c_resp = session.put(f"{BASE_URL}/api/complexes/{complex_id}", json=complex_payload)
        print(f"[Stand] Updating existing complex: {complex_id}")
    else:
        c_resp = session.post(f"{BASE_URL}/api/complexes", json=complex_payload)
        print(f"[Stand] Creating complex: {complex_id}")

    assert c_resp.ok, f"Failed to create/update complex: {c_resp.text}"
    print(f"[Stand] Created/updated complex: {complex_id}")

    # 6. Start Live S1 Session
    start_resp = session.post(
        f"{BASE_URL}/api/session/{complex_id}/start",
        json={"force": True, "user_id": user_id},
    )
    assert start_resp.ok, f"Failed to start session: {start_resp.text}"
    session_info = start_resp.json()
    session_id = session_info.get("session_id")
    assert session_id, f"Missing session_id in start response: {session_info}"
    print(f"[Stand] Live S1 Session started: {session_id}")

    # 7. Evaluate both tasks in the live session
    for step in range(1, 3):
        t_fetch = session.get(f"{BASE_URL}/api/session/{session_id}/task")
        assert t_fetch.ok, f"Failed to get task at step {step}: {t_fetch.text}"
        t_envelope = t_fetch.json()
        task = t_envelope.get("task", {})
        current_task_id = task.get("task_id")
        td = task.get("task_data", {})
        
        display_mode = td.get("display_mode")
        levels = td.get("levels", [])
        elements = td.get("elements", [])
        nodes = td.get("nodes", [])

        assert display_mode == "hierarchy", f"Step {step}: expected display_mode == 'hierarchy', got {display_mode}"
        assert len(levels) in {3, 4}, f"Step {step}: unexpected tiers count {len(levels)}"
        assert len(elements) in {8, 9}, f"Step {step}: unexpected elements count {len(elements)}"
        assert len(nodes) in {8, 9}, f"Step {step}: unexpected nodes count {len(nodes)}"

        print(f"[Stand] Step {step}: Task {current_task_id} loaded ({len(levels)} tiers, {len(nodes)} nodes, {len(elements)} elements)")

        # Prepare correct answer payload
        user_answer = {
            "display_mode": "hierarchy",
            "levels": [
                {"level_id": l["level_id"], "blocks": l.get("blocks", l.get("slots", []))}
                for l in levels
            ],
            "nodes": [
                {
                    "node_id": n["node_id"],
                    "level_id": n["level_id"],
                    "parent_id": n.get("parent_id"),
                    "blocks": n.get("blocks", n.get("slots", [])),
                }
                for n in nodes
            ],
        }

        # Submit answer
        sub_resp = session.post(
            f"{BASE_URL}/api/session/{session_id}/task/submit",
            json={"task_id": current_task_id, "user_input": user_answer},
        )
        assert sub_resp.ok, f"Step {step}: Failed to submit answer: {sub_resp.text}"
        sub_data = sub_resp.json()
        eval_res = sub_data.get("result", {})
        assert eval_res.get("success") is True, f"Step {step}: expected success=True, got {eval_res}"
        assert eval_res.get("score") == 100.0, f"Step {step}: expected score=100.0, got {eval_res.get('score')}"
        print(f"[Stand] Step {step}: Task {current_task_id} evaluated with 100% score (PASS)")

        # Advance to next task if not the last
        if step < 2:
            next_resp = session.post(f"{BASE_URL}/api/session/{session_id}/task/next", json={})
            assert next_resp.ok, f"Failed to advance to next task: {next_resp.text}"
            print(f"[Stand] Step {step}: Advanced to next task")

    # 8. Start a fresh live session for Playwright visual audit
    fresh_start = session.post(
        f"{BASE_URL}/api/session/{complex_id}/start",
        json={"force": True, "user_id": user_id},
    )
    assert fresh_start.ok, f"Failed to start fresh session for visual audit: {fresh_start.text}"
    fresh_session_id = fresh_start.json().get("session_id")

    # Export session metadata for Playwright
    cookies_dict = session.cookies.get_dict()
    info = {
        "baseUrl": BASE_URL,
        "complexId": complex_id,
        "sessionId": fresh_session_id,
        "completedSessionId": session_id,
        "userId": user_id,
        "sessionUrl": f"{BASE_URL}/session/{fresh_session_id}",
        "cookies": cookies_dict,
        "cookieHeader": "; ".join([f"{k}={v}" for k, v in cookies_dict.items()]),
    }
    info_path = FIXTURES_DIR / "live_stand_session_info.json"
    with open(info_path, "w", encoding="utf-8") as f:
        json.dump(info, f, indent=2, ensure_ascii=False)
    print(f"[Stand] Visual audit session created: {fresh_session_id}")
    print(f"[Stand] Session metadata written to {info_path}")
    print("[Stand] ALL S1 STAND API VERIFICATIONS PASSED!")


if __name__ == "__main__":
    run_seed_and_verify()
