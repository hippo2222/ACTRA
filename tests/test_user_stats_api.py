import os
import uuid

import pytest
import requests


def _resolve_base_url() -> str:
    """Resolve a reachable API base URL across common local ports."""
    candidates = [
        os.getenv("USER_STATS_API_BASE"),
        "http://127.0.0.1:8000",  # desktop-app/server.py default
        "http://localhost:8000",
        "http://127.0.0.1:5000",
        "http://localhost:5000",
    ]
    candidates = [c for c in candidates if c]

    errors = []
    for base in candidates:
        for path in ("/api/health", "/health", "/"):
            url = f"{base}{path}"
            try:
                response = requests.get(
                    url,
                    timeout=1.5,
                    proxies={"http": None, "https": None},
                )
                if response.status_code < 500:
                    return base
                errors.append(f"{url}: HTTP {response.status_code}")
            except requests.exceptions.RequestException as exc:
                errors.append(f"{url}: {exc}")

    pytest.skip(
        "API server is not reachable on common hosts/ports.\n"
        + "\n".join(errors)
    )


def test_user_flow():
    print("--- Testing User Flow ---")
    base_url = _resolve_base_url()

    # 1. Create a new user
    user_name = f"TestUser_{uuid.uuid4().hex[:6]}"
    print(f"Creating user: {user_name}")
    resp = requests.post(f"{base_url}/api/users", json={"name": user_name})
    assert resp.status_code == 200
    user_data = resp.json()["user"]
    user_id = user_data["user_id"]
    print(f"Created user with ID: {user_id}")

    # 2. List all users and verify the new user is there
    resp = requests.get(f"{base_url}/api/users")
    assert resp.status_code == 200
    users = resp.json()["items"]
    assert any(u["user_id"] == user_id for u in users)
    print(f"User {user_id} found in users list")

    # 3. Select the user
    print(f"Selecting user: {user_id}")
    resp = requests.post(f"{base_url}/api/users/select", json={"user_id": user_id})
    assert resp.status_code == 200
    assert resp.json()["user"]["user_id"] == user_id

    # 4. Verify current user
    resp = requests.get(f"{base_url}/api/users/current")
    assert resp.status_code == 200
    assert resp.json()["user"]["user_id"] == user_id
    print("User selection verified")


def test_statistics():
    print("\n--- Testing Statistics API ---")
    base_url = _resolve_base_url()

    # Get overall stats
    resp = requests.get(f"{base_url}/api/statistics/overall")
    assert resp.status_code == 200
    stats = resp.json()["stats"]
    print(f"Overall stats retrieved: Mastered={stats.get('tasks_mastered', 0)}")

    # Get time dynamics
    resp = requests.get(f"{base_url}/api/statistics/time-dynamics")
    assert resp.status_code == 200
    dynamics = resp.json()["dynamics"]
    print(f"Time dynamics retrieved: {len(dynamics)} days of data")


if __name__ == "__main__":
    base_url = _resolve_base_url()
    try:
        requests.get(base_url, timeout=1.5)
    except requests.exceptions.ConnectionError:
        print(f"Error: Server not running at {base_url}. Please start server.py first.")
        exit(1)

    try:
        test_user_flow()
        test_statistics()
        print("\nSUCCESS: All API tests passed!")
    except Exception as e:
        print(f"\nFAILED: {e}")
        import traceback
        traceback.print_exc()
