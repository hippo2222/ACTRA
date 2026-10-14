"""
scripts/capture_tour_and_reference.py

Capture screenshots of the sequence editor onboarding tour and Reference page.
"""

import os
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:8000"
ARTIFACTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "artifacts", "sequence_tour_audit"))
os.makedirs(ARTIFACTS_DIR, exist_ok=True)


def capture_all():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800})

        # Dev login via API
        login_resp = context.request.post(
            f"{BASE_URL}/api/auth/login",
            data={"identifier": "devuser", "password": "password123"}
        )
        print(f"[QA] Login status: {login_resp.status}")

        page = context.new_page()

        # 1. Capture Reference page with sequence tour selected
        print("[QA] Capturing Reference Page for Sequence Editor...")
        page.goto(f"{BASE_URL}/reference#sequence-editor-authoring")
        page.wait_for_load_state("networkidle")
        time.sleep(1)

        # Ensure the tour item is selected/clicked and scrolled into view
        page.evaluate("""() => {
            const btn = document.querySelector('[data-reference-tour-id="sequence-editor-authoring"]');
            if (btn) {
                btn.click();
                btn.scrollIntoView({ block: 'center', behavior: 'instant' });
            }
        }""")
        time.sleep(3)
        ref_shot = os.path.join(ARTIFACTS_DIR, "01_reference_page.png")
        page.screenshot(path=ref_shot)

        # 2. Capture Onboarding Tour steps 1 through 5 in Editor
        print("[QA] Capturing Editor Onboarding Tour steps...")
        page.goto(f"{BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?onboarding_preview=sequence-editor-authoring")
        page.wait_for_load_state("networkidle")
        time.sleep(2)

        # Start tour explicitly at step 0
        page.evaluate("""() => {
            if (window.OnboardingTour && typeof window.OnboardingTour.start === 'function') {
                window.OnboardingTour.start('sequence-editor-authoring', { force: true });
            }
        }""")
        time.sleep(1.5)

        for step_idx in range(5):
            print(f"[QA] Capturing Step {step_idx + 1}...")
            step_shot = os.path.join(ARTIFACTS_DIR, f"02_tour_step_{step_idx + 1}.png")
            page.screenshot(path=step_shot)

            if step_idx < 4:
                # Click next
                next_btn = page.query_selector('button[data-onboarding-action="next"]')
                if next_btn:
                    next_btn.click()
                    time.sleep(1.5)
                else:
                    print(f"[QA] Warning: Next button not found on step {step_idx + 1}")

        browser.close()
        print("[QA] Tour and Reference capture completed successfully!")


if __name__ == "__main__":
    capture_all()
