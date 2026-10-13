"""
scripts/visual_qa_capture.py

Standardized Visual QA Capture Tool for ACTRA.
Captures real-browser screenshots via Playwright for adversarial UI/UX audits.

Usage:
    python scripts/visual_qa_capture.py --target import_step2 --output artifacts/import_step2.png
    python scripts/visual_qa_capture.py --target editor --output artifacts/editor.png
    python scripts/visual_qa_capture.py --target catalog
"""

import argparse
import os
import sys
import time
from playwright.sync_api import sync_playwright


def get_default_output(target: str) -> str:
    artifacts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "artifacts"))
    os.makedirs(artifacts_dir, exist_ok=True)
    return os.path.join(artifacts_dir, f"visual_qa_{target}.png")


def run_capture(target: str, output_path: str, base_url: str = "http://127.0.0.1:8000", width: int = 1280, height: int = 800):
    output_abs = os.path.abspath(output_path)
    os.makedirs(os.path.dirname(output_abs), exist_ok=True)

    print(f"[Visual QA] Starting capture: target='{target}', viewport={width}x{height}")
    print(f"[Visual QA] Server base URL: {base_url}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": width, "height": height})
        page = context.new_page()

        # Step 1: Login via API session bridge
        login_resp = context.request.post(
            f"{base_url}/api/auth/login",
            data={"identifier": "devuser", "password": "password123"}
        )
        if login_resp.status != 200:
            print(f"[Visual QA] Warning: Dev login returned status {login_resp.status}. Proceeding as guest.")
        else:
            print("[Visual QA] Auth: Logged in as devuser.")

        # Step 2: Navigate based on target
        if target == "welcome":
            page.goto(f"{base_url}/welcome")
            page.wait_for_load_state("networkidle")
            time.sleep(1)

        elif target == "catalog":
            page.goto(f"{base_url}/catalog")
            page.wait_for_load_state("networkidle")
            time.sleep(1)

        elif target.startswith("import_") or target == "editor":
            page.goto(f"{base_url}/editor")
            page.wait_for_load_state("networkidle")
            time.sleep(1)

            if target == "import_step1":
                page.evaluate("""() => {
                    if (window.dashboard) {
                        window.dashboard.showImportModal();
                    }
                }""")
                time.sleep(1)

            elif target == "import_step2":
                page.evaluate("""() => {
                    if (window.dashboard) {
                        window.dashboard.showImportModal();
                        if (window.dashboard.importManager) {
                            window.dashboard.importManager.goToStep(2);
                        }
                    }
                }""")
                time.sleep(1)

            elif target == "import_step2_ai":
                page.evaluate("""() => {
                    if (window.dashboard) {
                        window.dashboard.showImportModal();
                        if (window.dashboard.importManager) {
                            window.dashboard.importManager.importMode = 'ai';
                            window.dashboard.importManager.goToStep(2);
                        }
                    }
                }""")
                time.sleep(1)

            elif target == "import_step3":
                page.evaluate("""() => {
                    if (window.dashboard) {
                        window.dashboard.showImportModal();
                        if (window.dashboard.importManager) {
                            window.dashboard.importManager.sourceText = "@TEST\\n# Пример\\n? Вопрос?\\n+ Да\\n- Нет";
                            window.dashboard.importManager.goToStep(3);
                        }
                    }
                }""")
                time.sleep(1)

        else:
            # Generic direct navigation
            page.goto(f"{base_url}/{target.lstrip('/')}")
            page.wait_for_load_state("networkidle")
            time.sleep(1)

        # Step 3: Take screenshot
        page.screenshot(path=output_abs)
        browser.close()

    print(f"[Visual QA] Screenshot captured successfully: {output_abs}")
    return output_abs


def main():
    parser = argparse.ArgumentParser(description="ACTRA Visual QA Screenshot Tool")
    parser.add_argument("--target", default="import_step2", help="Target screen/modal (default: import_step2)")
    parser.add_argument("--output", default=None, help="Output PNG path (default: artifacts/visual_qa_<target>.png)")
    parser.add_argument("--url", default="http://127.0.0.1:8000", help="Base URL (default: http://127.0.0.1:8000)")
    parser.add_argument("--width", type=int, default=1280, help="Viewport width (default: 1280)")
    parser.add_argument("--height", type=int, default=800, help="Viewport height (default: 800)")

    args = parser.parse_args()
    output_path = args.output or get_default_output(args.target)

    run_capture(
        target=args.target,
        output_path=output_path,
        base_url=args.url,
        width=args.width,
        height=args.height
    )


if __name__ == "__main__":
    main()
