"""
scripts/capture_import_modal_qa.py

Cold-Eye Visual Audit & Headless Assertions Gate for Task Import Modal.
Strict compliance with AGENTS.md Section 10:
- Viewport: 1280x800
- 5 Headless Assertions (Zero-Truncation, No-Overlap Collision AABB, Viewport Fold, Stacking Context, Dismiss Control Reachability)
- Dynamic States Matrix (idle, focused, heavy-stress-payload, step 3 idle, step 3 active edit, worst-case geometry)
"""

import os
import sys
import time
import json
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:8000"
ARTIFACTS_DIR = r"C:\Users\ASUS\.gemini\antigravity\brain\894a4ca0-2b71-4953-a9cf-f42118175923\import_modal_audit"
os.makedirs(ARTIFACTS_DIR, exist_ok=True)


def disable_onboarding(context):
    context.add_init_script("""
        localStorage.setItem('actra_onboarding_disabled_v1', 'true');
        localStorage.setItem('actra_onboarding_seen_v1', JSON.stringify({
            'sequence-editor-authoring': { seen: true, finished: true },
            'editor-dashboard-authoring': { seen: true, finished: true },
            'main-dashboard-work-contour': { seen: true, finished: true }
        }));
        const injectStyle = () => {
            const s = document.createElement('style');
            s.id = 'qa-suppress-tour';
            s.textContent = `
                .onboarding-tour-dock,
                .onboarding-tour-callout,
                .onboarding-tour-scrim,
                .onboarding-tour-card,
                .onboarding-first-run-card,
                .onboarding-tour-popover {
                    display: none !important;
                    visibility: hidden !important;
                    pointer-events: none !important;
                }
            `;
            if (document.head) document.head.appendChild(s);
            else document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s));
        };
        injectStyle();
    """)


def run_headless_assertions(page, state_name):
    """Run the 5 deterministic assertions required by AGENTS.md Section 10."""
    print(f"\n[ASSERTION GATE: {state_name}] Running checks...")
    results = page.evaluate("""() => {
        const issues = [];

        // 1. Zero-Truncation Assertion
        const checkTruncation = (selector, label) => {
            const els = document.querySelectorAll(selector);
            els.forEach((el, i) => {
                // Ignore elements intentionally clamped or empty
                if (el.classList.contains('line-clamp-2') || el.classList.contains('truncate')) return;
                if (el.offsetWidth > 0 && el.scrollWidth > el.offsetWidth + 1) {
                    issues.push({
                        type: 'ZERO_TRUNCATION',
                        selector: `${label} [${i}]: ${selector}`,
                        text: el.textContent.trim().slice(0, 30),
                        scrollWidth: el.scrollWidth,
                        offsetWidth: el.offsetWidth
                    });
                }
            });
        };

        checkTruncation('#import-modal h2', 'Modal Header H2');
        checkTruncation('#import-modal .editor-import-step-label', 'Stepper Label');
        checkTruncation('[data-role="import-title-group"] label', 'Title Input Label');
        checkTruncation('[data-role="import-next"]', 'Next Button');
        checkTruncation('[data-role="import-prev"]', 'Prev Button');

        // 2. No-Overlap Collision Assertion (AABB)
        const checkOverlap = (selA, selB, label) => {
            const elA = document.querySelector(selA);
            const elB = document.querySelector(selB);
            if (!elA || !elB) return;
            const rA = elA.getBoundingClientRect();
            const rB = elB.getBoundingClientRect();
            if (rA.width === 0 || rA.height === 0 || rB.width === 0 || rB.height === 0) return;

            const overlapX = Math.max(0, Math.min(rA.right, rB.right) - Math.max(rA.left, rB.left));
            const overlapY = Math.max(0, Math.min(rA.bottom, rB.bottom) - Math.max(rA.top, rB.top));

            if (overlapX > 2 && overlapY > 2) {
                issues.push({
                    type: 'NO_OVERLAP_COLLISION',
                    label,
                    overlap: { x: overlapX, y: overlapY },
                    rectA: rA,
                    rectB: rB
                });
            }
        };

        checkOverlap('[data-role="import-title-group"]', '#import-text-area', 'Title Group vs Textarea');
        checkOverlap('[data-role="auto-detect-banner"]', '[data-role="import-title-group"]', 'Banner vs Title Group');
        checkOverlap('.editor-import-footer', '.editor-import-content-shell', 'Footer vs Content Shell');

        // 3. Viewport Fold Assertion (1280x800)
        const modal = document.querySelector('#import-modal .editor-import-modal-shell') || document.querySelector('#import-modal');
        if (modal) {
            const mRect = modal.getBoundingClientRect();
            if (mRect.bottom > 805) {
                issues.push({
                    type: 'VIEWPORT_FOLD_OVERFLOW',
                    bottom: mRect.bottom,
                    viewportHeight: window.innerHeight,
                    message: `Modal bottom (${mRect.bottom}px) exceeds viewport 800px`
                });
            }
        }
        const nextBtn = document.querySelector('[data-role="import-next"]');
        if (nextBtn) {
            const bRect = nextBtn.getBoundingClientRect();
            if (bRect.bottom > 800) {
                issues.push({
                    type: 'VIEWPORT_FOLD_CTA_OFFSCREEN',
                    bottom: bRect.bottom,
                    message: `Primary CTA bottom (${bRect.bottom}px) exceeds 800px fold`
                });
            }
        }

        // 4. Stacking Context Integrity Assertion (elementFromPoint)
        const dismissBtn = document.querySelector('[data-role="close-import-modal"]');
        if (dismissBtn) {
            const dRect = dismissBtn.getBoundingClientRect();
            const cx = dRect.left + dRect.width / 2;
            const cy = dRect.top + dRect.height / 2;
            const topEl = document.elementFromPoint(cx, cy);
            if (topEl && !dismissBtn.contains(topEl) && topEl !== dismissBtn) {
                issues.push({
                    type: 'STACKING_CONTEXT_OCCLUDED',
                    target: 'Close Modal Button',
                    occludedBy: topEl.outerHTML.slice(0, 100)
                });
            }
        }

        // 5. Dismiss Control Reachability Assertion
        if (dismissBtn) {
            const dRect = dismissBtn.getBoundingClientRect();
            if (dRect.top < 0 || dRect.bottom > window.innerHeight || dRect.left < 0 || dRect.right > window.innerWidth) {
                issues.push({
                    type: 'DISMISS_CONTROL_UNREACHABLE',
                    rect: dRect,
                    viewport: { w: window.innerWidth, h: window.innerHeight }
                });
            }
        }

        return issues;
    }""")

    if results:
        print(f"  [WARN] {len(results)} issues found in {state_name}:")
        for iss in results:
            print(f"    - {iss['type']}: {iss.get('message', json.dumps(iss, ensure_ascii=False))}")
    else:
        print(f"  [PASS] All 5 Headless Assertions passed for {state_name}!")
    return results


def capture_all():
    audit_report = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "viewport": {"width": 1280, "height": 800},
        "states": {}
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        disable_onboarding(context)

        # Login
        print("[QA] Logging in as devuser...")
        login_resp = context.request.post(
            f"{BASE_URL}/api/auth/login",
            data=json.dumps({"identifier": "devuser", "password": "password123"}),
            headers={"Content-Type": "application/json"}
        )
        print(f"[QA] Login status: {login_resp.status}")

        page = context.new_page()

        # Open Editor Dashboard
        print("[QA] Navigating to /editor/...")
        page.goto(f"{BASE_URL}/editor/")
        page.wait_for_load_state("networkidle")
        page.wait_for_function("() => window.dashboard && window.dashboard.importManager")
        time.sleep(1.0)

        # Ensure modal is open and on Step 2 (Text Import)
        print("[QA] Opening Import Modal...")
        page.evaluate("""() => {
            if (window.dashboard && window.dashboard.showImportModal) {
                window.dashboard.showImportModal();
            }
        }""")
        time.sleep(0.8)

        # Select first module and topic to enable Step 2
        page.evaluate("""() => {
            const im = window.dashboard.importManager;
            if (im) {
                im.importMode = 'text';
                // Pick first available module and topic
                const catalog = window.dashboard.catalog || [];
                if (catalog.length > 0) {
                    im.selectedModule = catalog[0].id;
                    im.selectedModuleName = catalog[0].name;
                    if (catalog[0].topics && catalog[0].topics.length > 0) {
                        im.selectedTopic = catalog[0].topics[0].id;
                        im.selectedTopicName = catalog[0].topics[0].name;
                    }
                }
                im.currentStep = 2;
                im.renderCurrentStep();
                im.updateStepUI();
            }
        }""")
        time.sleep(0.5)

        # -------------------------------------------------------------
        # State 1: Step 2 Idle (Blank / Default with new Title Input)
        # -------------------------------------------------------------
        print("\n[QA] Capturing Scenario 1: Step 2 Idle...")
        page.evaluate("""() => {
            const im = window.dashboard.importManager;
            im.sourceText = '';
            im.importTaskTitle = '';
            im.renderCurrentStep();
        }""")
        time.sleep(0.4)
        issues1 = run_headless_assertions(page, "01_step2_idle")
        shot1 = os.path.join(ARTIFACTS_DIR, "01_step2_idle.png")
        page.screenshot(path=shot1)
        audit_report["states"]["01_step2_idle"] = {"screenshot": "01_step2_idle.png", "issues": issues1}

        # -------------------------------------------------------------
        # State 2: Step 2 Focused (Active input with focus ring)
        # -------------------------------------------------------------
        print("\n[QA] Capturing Scenario 2: Step 2 Focused / Active Input...")
        title_input = page.locator("#import-task-title-input")
        title_input.focus()
        title_input.fill("Протокол базовой сердечно-легочной реанимации (BLS 2025)")
        time.sleep(0.3)
        issues2 = run_headless_assertions(page, "02_step2_focused")
        shot2 = os.path.join(ARTIFACTS_DIR, "02_step2_focused.png")
        page.screenshot(path=shot2)
        audit_report["states"]["02_step2_focused"] = {"screenshot": "02_step2_focused.png", "issues": issues2}

        # -------------------------------------------------------------
        # State 3: Step 2 Heavy Stress Payload (>2500 chars, long text)
        # -------------------------------------------------------------
        print("\n[QA] Capturing Scenario 3: Step 2 Heavy Stress Payload...")
        stress_text = """@TEST
@ title: Расширенная дифференциальная диагностика и интенсивная терапия шоковых состояний у взрослых пациентов в ОРИТ
? Какой целевой показатель среднего артериального давления (САД / MAP) рекомендован протоколами Surviving Sepsis Campaign при септическом шоке после инфузионной нагрузки?
+ 65 мм рт. ст. и выше
- 50 мм рт. ст.
- 90 мм рт. ст.
- 110 мм рт. ст.

? Какой вазопрессор является препаратом первого выбора при рефрактерной гипотензии на фоне септического шока?
+ Норадреналин (норэпинефрин)
- Допамин в низких дозах
- Адреналин в качестве монотерапии
- Фенилэфрин

@SEQUENCE
@ title: Алгоритм действий реанимационной бригады при остановке кровообращения с ритмами фибрилляции желудочков и желудочковой тахикардии без пульса
# Расположите этапы базовой и специализированной помощи в строгом хронологическом порядке
element_1: Оценить безопасность, проверить сознание и наличие нормального дыхания
element_2: Начать компрессии грудной клетки с частотой 100-120 в мин и глубиной 5-6 см
element_3: Наложить электроды дефибриллятора и выполнить оценку ритма
element_4: Нанести первый разряд дефибриллятора (150-200 Дж бифазный) и немедленно возобновить СЛР на 2 минуты
element_5: После 3-го разряда ввести адреналин 1 мг внутривенно и амиодарон 300 мг болюсно
level_1 [Первичный осмотр и базовый протокол]: element_1, element_2
level_2 [Дефибрилляция и мониторинг ритма]: element_3, element_4
level_3 [Фармакотерапия рефрактерной ФЖ]: element_5

@CLICK_TEXT
@ title: Проверка знаний критических ошибок при проведении закрытого массажа сердца у взрослого пациента
# Определите ошибки в представленных действиях реаниматора
+ Проведение пауз на вентиляцию длительностью более 10 секунд
- Полное расправление грудной клетки после каждого нажатия
- Расположение рук на нижней половине грудины строго по средней линии
"""
        page.evaluate(f"""() => {{
            const im = window.dashboard.importManager;
            im.sourceText = {json.dumps(stress_text)};
            im.renderCurrentStep();
            const ta = document.getElementById('import-text-area');
            if (ta) {{
                ta.value = {json.dumps(stress_text)};
                im._updateLiveCounter(ta.value);
                im.updateHeaderStats(ta.value);
            }}
        }}""")
        time.sleep(0.5)
        issues3 = run_headless_assertions(page, "03_step2_heavy_stress_payload")
        shot3 = os.path.join(ARTIFACTS_DIR, "03_step2_heavy_stress_payload.png")
        page.screenshot(path=shot3)
        audit_report["states"]["03_step2_heavy_stress_payload"] = {"screenshot": "03_step2_heavy_stress_payload.png", "issues": issues3}

        # -------------------------------------------------------------
        # Transition to Step 3: Parse and Preview
        # -------------------------------------------------------------
        print("\n[QA] Transitioning to Step 3 (Parse & Preview)...")
        page.evaluate("""async () => {
            const im = window.dashboard.importManager;
            const res = await im.parseText(im.sourceText, im.selectedModule, im.selectedTopic, im.importTaskTitle);
            im.parsedResult = res;
            im.currentStep = 3;
            im.renderCurrentStep();
            im.updateStepUI();
        }""")
        time.sleep(1.0)

        # -------------------------------------------------------------
        # State 4: Step 3 Idle (Open Task Card Title Inputs)
        # -------------------------------------------------------------
        print("\n[QA] Capturing Scenario 4: Step 3 Idle Preview Cards...")
        issues4 = run_headless_assertions(page, "04_step3_idle")
        shot4 = os.path.join(ARTIFACTS_DIR, "04_step3_idle.png")
        page.screenshot(path=shot4)
        audit_report["states"]["04_step3_idle"] = {"screenshot": "04_step3_idle.png", "issues": issues4}

        # -------------------------------------------------------------
        # State 5: Step 3 Active Edit (Typing into Card 0's Title Input)
        # -------------------------------------------------------------
        print("\n[QA] Capturing Scenario 5: Step 3 Active Card Title Edit...")
        card_input = page.locator('[data-task-title-input="0"]')
        card_input.focus()
        card_input.fill("Редактированное название: Протокол шока в ОРИТ (финальная редакция)")
        time.sleep(0.4)
        issues5 = run_headless_assertions(page, "05_step3_active_edit")
        shot5 = os.path.join(ARTIFACTS_DIR, "05_step3_active_edit.png")
        page.screenshot(path=shot5)
        audit_report["states"]["05_step3_active_edit"] = {"screenshot": "05_step3_active_edit.png", "issues": issues5}

        # -------------------------------------------------------------
        # State 6: Step 3 Worst-Case Geometry (Bottom card at sticky footer)
        # -------------------------------------------------------------
        print("\n[QA] Capturing Scenario 6: Step 3 Worst-Case Geometry...")
        page.evaluate("""() => {
            const container = document.querySelector('.editor-import-content-shell');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }""")
        time.sleep(0.5)
        issues6 = run_headless_assertions(page, "06_step3_worst_case_geometry")
        shot6 = os.path.join(ARTIFACTS_DIR, "06_step3_worst_case_geometry.png")
        page.screenshot(path=shot6)
        audit_report["states"]["06_step3_worst_case_geometry"] = {"screenshot": "06_step3_worst_case_geometry.png", "issues": issues6}

        browser.close()

    report_path = os.path.join(ARTIFACTS_DIR, "audit_report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(audit_report, f, ensure_ascii=False, indent=2)

    print("\n========================================================")
    print(f"Cold-Eye Visual Audit Complete!")
    print(f"Artifacts saved in: {ARTIFACTS_DIR}")
    print("========================================================\n")


if __name__ == "__main__":
    capture_all()
