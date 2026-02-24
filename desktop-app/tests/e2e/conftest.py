import sys
import os
import subprocess
import socket
import time
import pytest
from urllib.request import urlopen
from urllib.error import URLError

def get_free_port():
    """Get a random free port on localhost."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port

def wait_for_server(url, timeout=15.0):
    """Wait until the server is responsive."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urlopen(url, timeout=1.0) as response:
                if response.status == 200:
                    return True
        except URLError:
            pass
        finally:
            time.sleep(0.5)
    return False

@pytest.fixture(scope="session")
def local_server():
    """Start the Flask server from server.py in a background process."""
    port = get_free_port()
    base_url = f"http://127.0.0.1:{port}"
    
    # We use python server.py to start it just like the user would or via webview_launcher
    # We pass the port using the environment variable that server.py or launcher expects
    env = os.environ.copy()
    env["TRAINER_HTTP_PORT"] = str(port)
    env["FLASK_DEBUG"] = "0"
    
    # Overwrite ai_config.json with mock for testing
    import json
    import shutil
    # __file__ is desktop-app/tests/e2e/conftest.py
    # need to go up 3 levels to reach the project root where 'data' is located
    data_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data"))
    os.makedirs(data_dir, exist_ok=True)
    ai_config_path = os.path.join(data_dir, "ai_config.json")
    backup_path = os.path.join(data_dir, "ai_config.json.bak")
    
    if os.path.exists(ai_config_path):
        shutil.copy2(ai_config_path, backup_path)
    
    with open(ai_config_path, "w", encoding="utf-8") as f:
        json.dump({
            "timeout_seconds": 10,
            "max_retries": 0,
            "fallback_order": ["mock"],
            "providers": {
                "mock": {"enabled": True, "api_key": "test"}
            }
        }, f)

    # Open log files to prevent pipe buffer blocking
    log_out = open("e2e_server_stdout.log", "w")
    log_err = open("e2e_server_stderr.log", "w")

    # Start the server
    process = subprocess.Popen(
        [sys.executable, "server.py"],
        env=env,
        stdout=log_out,
        stderr=log_err,
        cwd=os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    )
    
    # Wait for the server to be healthy
    health_url = f"{base_url}/api/health"
    if not wait_for_server(health_url):
        process.kill()
        log_out.close()
        log_err.close()
        out = open("e2e_server_stdout.log", "r").read()
        err = open("e2e_server_stderr.log", "r").read()
        raise RuntimeError(f"Server failed to start on {port}.\nStdout: {out}\nStderr: {err}")
    
    yield base_url
    
    # Teardown: kill the server process
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
    finally:
        log_out.close()
        log_err.close()
        
        # Restore AI Config
        if os.path.exists(backup_path):
            os.replace(backup_path, ai_config_path)
        elif os.path.exists(ai_config_path):
            os.remove(ai_config_path)
