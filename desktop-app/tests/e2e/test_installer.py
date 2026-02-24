import sys
import subprocess

def test_install_pw():
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pytest-playwright", "playwright"])
    subprocess.check_call([sys.executable, "-m", "playwright", "install", "chromium"])
