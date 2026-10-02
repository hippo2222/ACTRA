#!/usr/bin/env python3
"""Safe Read-Only snapshot export of a clinical analysis session from prod PostgreSQL."""
import json
import subprocess
import sys
from pathlib import Path

PROD_HOST = "root@91.99.223.246"
SESSION_ID = "sess_fyb8ddve0"
OUTPUT_FILE = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "prod_clinical_session_snapshot.json"

SQL_QUERY = (
    "SELECT row_to_json(s) FROM ("
    "  SELECT session_id, user_id, module_id, topic_id, created_at, updated_at, status, human_summary, recommendations, tasks "
    "  FROM actra_hosted_ai_analysis_sessions "
    f"  WHERE session_id = '{SESSION_ID}'"
    ") s;"
)

REMOTE_CMD = f'docker exec actra-postgres-1 psql -U actra -d actra -t -A -c "{SQL_QUERY}"'

def main():
    print(f"Connecting to {PROD_HOST} in read-only mode to fetch session {SESSION_ID}...")
    cmd = ["ssh", "-o", "StrictHostKeyChecking=no", PROD_HOST, REMOTE_CMD]
    
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        print(f"SSH Error (code {result.returncode}):\n{result.stderr}", file=sys.stderr)
        sys.exit(1)

    raw_output = result.stdout.strip()
    if not raw_output:
        print("Error: Empty response returned from PostgreSQL", file=sys.stderr)
        sys.exit(1)

    try:
        session_data = json.loads(raw_output)
    except Exception as exc:
        print(f"Error parsing JSON output: {exc}\nRaw output starts with: {raw_output[:200]}", file=sys.stderr)
        sys.exit(1)

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(session_data, f, ensure_ascii=False, indent=2)

    tasks = session_data.get("tasks", [])
    recs = session_data.get("recommendations", [])
    print(f"\n[PASS] Snapshot successfully saved to: {OUTPUT_FILE}")
    print(f"  - Session ID:       {session_data.get('session_id')}")
    print(f"  - User:             {session_data.get('user_id')}")
    print(f"  - Module:           {session_data.get('module_id')}")
    print(f"  - Topic:            {session_data.get('topic_id')}")
    print(f"  - Created At:       {session_data.get('created_at')}")
    print(f"  - Recommendations:  {len(recs)}")
    print(f"  - Tasks Count:      {len(tasks)}")

if __name__ == "__main__":
    main()
