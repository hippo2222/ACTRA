#!/usr/bin/env python3
"""
ACTRA Clinical Tasks Production Import Script.

Deploys Table 5.1 (PE Stratification) and Table 5.2 (Pneumothorax Differentiation)
along with the Training Complex to any ACTRA environment (Local, Staging, Production).

Usage:
    python import_clinical_tasks_prod.py --url https://your-actra-prod.com --login admin@actra.local --password "Secret"
    python import_clinical_tasks_prod.py --url http://127.0.0.1:8000 --cookie "session=..."
"""

import argparse
import json
import os
import sys
from pathlib import Path
import requests

SCRIPT_DIR = Path(__file__).resolve().parent


def parse_args():
    parser = argparse.ArgumentParser(description="Import ACTRA Demonstration Clinical Hierarchy Tasks to Production")
    parser.add_argument("--url", default=os.environ.get("ACTRA_BASE_URL", "http://127.0.0.1:8000"), help="Base URL of ACTRA (e.g. https://actra.example.com)")
    parser.add_argument("--login", default=os.environ.get("ACTRA_ADMIN_LOGIN", "clinical_expert@actra.local"), help="User login or email (must have Editor/Admin rights)")
    parser.add_argument("--password", default=os.environ.get("ACTRA_ADMIN_PASSWORD", "Clinical.Pass1!"), help="User password")
    parser.add_argument("--cookie", default=os.environ.get("ACTRA_SESSION_COOKIE", ""), help="Pre-authenticated session cookie value (optional)")
    return parser.parse_args()


def main():
    args = parse_args()
    base_url = args.url.rstrip("/")
    session = requests.Session()

    print(f"\n=======================================================")
    print(f"  ACTRA: Deploy Clinical Hierarchy Demonstration Tasks")
    print(f"  Target: {base_url}")
    print(f"=======================================================\n")

    # 1. Authentication
    if args.cookie:
        session.cookies.set("session", args.cookie)
        print("[Auth] Using provided session cookie.")
    else:
        print(f"[Auth] Authenticating as '{args.login}'...")
        login_resp = session.post(
            f"{base_url}/api/auth/login",
            json={"identifier": args.login, "password": args.password},
            headers={"Origin": base_url},
        )
        if not login_resp.ok:
            print(f"[ERROR] Authentication failed (HTTP {login_resp.status_code}): {login_resp.text}")
            sys.exit(1)
        print("[Auth] Authentication successful.")

    # Verify session
    me_resp = session.get(f"{base_url}/api/auth/me")
    if not me_resp.ok:
        print(f"[ERROR] Failed to verify current user session: {me_resp.text}")
        sys.exit(1)
    user_data = me_resp.json().get("user", {})
    user_id = user_data.get("user_id") or user_data.get("id")
    user_name = user_data.get("name") or args.login
    print(f"[Auth] Logged in as: {user_name} (ID: {user_id})\n")

    # 2. Ensure Module and Topic
    module_id = "neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya"
    topic_id = "differentsialnaya_diagnostika_i_stratifikatsiya_riska"

    cat_resp = session.get(f"{base_url}/api/editor/catalog")
    catalog = cat_resp.json() if cat_resp.ok else {}
    modules = catalog.get("modules", [])

    mod_row = next((m for m in modules if (m.get("id") == module_id or m.get("module_id") == module_id)), None)
    if not mod_row:
        print(f"[Module] Creating module '{module_id}'...")
        m_resp = session.post(
            f"{base_url}/api/editor/module/new",
            json={"name": "Неотложные состояния: Пульмонология и Кардиология"},
            headers={"Origin": base_url},
        )
        if not m_resp.ok:
            print(f"[WARN] Module creation returned: {m_resp.text}. Proceeding with standard ID.")
        else:
            mod_data = m_resp.json()
            module_id = mod_data.get("module_id") or mod_data.get("id") or module_id
            print(f"[Module] Created module: {module_id}")
    else:
        print(f"[Module] Module exists: {module_id}")

    # Ensure topic
    top_row = None
    if mod_row:
        top_row = next((t for t in mod_row.get("topics", []) if (t.get("id") == topic_id or t.get("topic_id") == topic_id)), None)

    if not top_row:
        print(f"[Topic] Creating topic '{topic_id}'...")
        t_resp = session.post(
            f"{base_url}/api/editor/topic/new",
            json={"module_id": module_id, "name": "Дифференциальная диагностика и стратификация риска"},
            headers={"Origin": base_url},
        )
        if not t_resp.ok:
            print(f"[WARN] Topic creation returned: {t_resp.text}. Proceeding with standard ID.")
        else:
            top_data = t_resp.json()
            topic_id = top_data.get("topic_id") or top_data.get("id") or topic_id
            print(f"[Topic] Created topic: {topic_id}")
    else:
        print(f"[Topic] Topic exists: {topic_id}")

    # 3. Load & Upload Task 5.1 (ТЭЛА)
    task1_file = SCRIPT_DIR / "table_5_1_tela_stratification.json"
    with open(task1_file, "r", encoding="utf-8") as f:
        t1_payload = json.load(f)

    task1_id = t1_payload.get("id", "task_5_1_tela_stratification")
    t1_payload["meta"]["module"] = module_id
    t1_payload["meta"]["topic"] = topic_id

    print(f"\n[Task 1] Uploading '{t1_payload['meta']['name']}' ({task1_id})...")
    save_t1 = session.post(
        f"{base_url}/api/editor/task/{module_id}/{topic_id}/{task1_id}",
        json=t1_payload,
        headers={"Origin": base_url},
    )
    if not save_t1.ok:
        print(f"[ERROR] Failed to save Task 1 (HTTP {save_t1.status_code}): {save_t1.text}")
        sys.exit(1)
    print(f"[Task 1] ✔ Saved successfully!")

    # 4. Load & Upload Task 5.2 (Пневмоторакс / Ателектаз / Выпот)
    task2_file = SCRIPT_DIR / "table_5_2_pneumothorax_differentiation.json"
    with open(task2_file, "r", encoding="utf-8") as f:
        t2_payload = json.load(f)

    task2_id = t2_payload.get("id", "task_5_2_pneumothorax_differentiation")
    t2_payload["meta"]["module"] = module_id
    t2_payload["meta"]["topic"] = topic_id

    print(f"[Task 2] Uploading '{t2_payload['meta']['name']}' ({task2_id})...")
    save_t2 = session.post(
        f"{base_url}/api/editor/task/{module_id}/{topic_id}/{task2_id}",
        json=t2_payload,
        headers={"Origin": base_url},
    )
    if not save_t2.ok:
        print(f"[ERROR] Failed to save Task 2 (HTTP {save_t2.status_code}): {save_t2.text}")
        sys.exit(1)
    print(f"[Task 2] ✔ Saved successfully!")

    # 5. Create or Update Training Complex
    complex_file = SCRIPT_DIR / "clinical_hierarchy_complex.json"
    with open(complex_file, "r", encoding="utf-8") as f:
        complex_payload = json.load(f)

    complex_id = complex_payload.get("id", "clinical_hierarchy_complex")
    complex_payload["tasks"] = [
        f"{module_id}/{topic_id}/{task1_id}",
        f"{module_id}/{topic_id}/{task2_id}",
    ]

    print(f"\n[Complex] Configuring training complex '{complex_id}'...")
    list_cx = session.get(f"{base_url}/api/complexes")
    existing_complexes = list_cx.json().get("items", []) if list_cx.ok else []
    exists = any(c.get("id") == complex_id for c in existing_complexes)

    if exists:
        c_resp = session.put(f"{base_url}/api/complexes/{complex_id}", json=complex_payload, headers={"Origin": base_url})
    else:
        c_resp = session.post(f"{base_url}/api/complexes", json=complex_payload, headers={"Origin": base_url})

    if not c_resp.ok:
        print(f"[WARN] Complex save returned: {c_resp.text}")
    else:
        print(f"[Complex] ✔ Complex configured successfully!")

    # 6. Verification: Start session test
    print(f"\n[Verification] Testing student session startup...")
    start_resp = session.post(
        f"{base_url}/api/session/{complex_id}/start",
        json={"force": True},
        headers={"Origin": base_url},
    )
    if start_resp.ok:
        start_info = start_resp.json()
        session_id = start_info.get("session_id")
        print(f"[Verification] ✔ Student S1 session initialized! (Session ID: {session_id})")
        print(f"               Direct Student URL: {base_url}/session/{session_id}")
    else:
        print(f"[WARN] Session start check response: {start_resp.text}")

    print(f"\n=======================================================")
    print(f"  DEPLOYMENT COMPLETE!")
    print(f"  Editor URL Task 5.1: {base_url}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module={module_id}&topic={topic_id}&task={task1_id}")
    print(f"  Editor URL Task 5.2: {base_url}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module={module_id}&topic={topic_id}&task={task2_id}")
    print(f"=======================================================\n")


if __name__ == "__main__":
    main()
