import os
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:8000"
ARTIFACTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "artifacts", "stress_test"))
os.makedirs(ARTIFACTS_DIR, exist_ok=True)

def test_stress_wall_of_text():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        
        # Suppress onboarding
        context.add_init_script("""
            localStorage.setItem('actra_onboarding_disabled_v1', 'true');
            localStorage.setItem('actra_onboarding_seen_v1', JSON.stringify({
                'sequence-editor-authoring': { seen: true, finished: true }
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
        
        login_resp = context.request.post(
            f"{BASE_URL}/api/auth/login",
            data={"identifier": "devuser", "password": "password123"}
        )
        print(f"[QA] Login status: {login_resp.status}")
        
        page = context.new_page()
        page.goto(f"{BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?onboarding_preview=sequence-editor-authoring")
        page.wait_for_load_state("networkidle")
        time.sleep(1)
        
        page.evaluate("""() => {
            if (window.OnboardingTour && typeof window.OnboardingTour.finish === 'function') {
                window.OnboardingTour.finish({ seen: true });
            }
            document.querySelectorAll('.onboarding-tour-scrim, .onboarding-tour-popover, .onboarding-tour-dock, .onboarding-tour-callout, .onboarding-tour-card').forEach(el => el.remove());
        }""")
        time.sleep(0.3)
        
        wall_of_text = "\\n\\n".join([f"Параграф {i}: Длиннейший технологический протокол, содержащий детальные инструкции с граничными условиями давления, расхода реагентов и температурного режима. Шаг продолжается дальше и содержит список возможных ошибок и действий оператора." for i in range(1, 20)])
        
        # Setup task with 2 levels, wall of text in item 1.3 and bottom item 2.2
        page.evaluate(f"""() => {{
            const ed = window.editor;
            if (ed) {{
                ed.task.task_data.name = 'Стресс-тестирование стены текста';
                ed.updateTaskTitleDisplay('Стресс-тестирование стены текста');
                ed.levels = [
                    {{
                        levelId: 'lvl_1',
                        title: 'Уровень 1: Стандартные и длинные шаги',
                        items: [
                            {{ id: 'el_1', label: 'Короткий шаг 1.1' }},
                            {{ id: 'el_2', label: 'Обычный шаг 1.2 средней длины' }},
                            {{ id: 'el_3', label: '{wall_of_text}' }}
                        ]
                    }},
                    {{
                        levelId: 'lvl_2',
                        title: 'Уровень 2: Нижний уровень у границы экрана',
                        items: [
                            {{ id: 'el_4', label: 'Шаг 2.1 в самом низу' }},
                            {{ id: 'el_5', label: '{wall_of_text}' }}
                        ]
                    }}
                ];
                ed.renderUI();
            }}
        }}""")
        time.sleep(0.5)
        
        # Screenshot 1: Resting state with wall of text in both items
        page.screenshot(path=os.path.join(ARTIFACTS_DIR, "01_wall_of_text_resting.png"))
        print("[QA] Screenshot 1 captured (resting)")
        
        # Expand item 1.3
        page.evaluate("""() => {
            const cards = document.querySelectorAll('.sequence-block-card');
            if (cards.length >= 3) {
                window.editor.expandBlock(cards[2]);
            }
        }""")
        time.sleep(0.6)
        page.screenshot(path=os.path.join(ARTIFACTS_DIR, "02_wall_of_text_expanded_level1.png"))
        print("[QA] Screenshot 2 captured (item 1.3 expanded over Level 2)")
        
        # Check that Level 1 has .has-expanded-card and wrapper has it
        has_classes = page.evaluate("""() => {
            const level = document.querySelector('.sequence-level-card');
            const wrapper = document.querySelectorAll('.sequence-block-wrapper')[2];
            const card = document.querySelectorAll('.sequence-block-card')[2];
            const headerCollapse = card.querySelector('.sequence-block-header-collapse-btn');
            return {
                levelHasClass: level.classList.contains('has-expanded-card'),
                wrapperHasClass: wrapper.classList.contains('has-expanded-card'),
                headerCollapseVisible: window.getComputedStyle(headerCollapse).display !== 'none'
            };
        }""")
        print(f"Stacking classes check: {has_classes}")
        
        # Now collapse 1.3 and expand last item 2.2 at bottom of page
        page.evaluate("""() => {
            window.editor.collapseAllBlocks();
            const cards = document.querySelectorAll('.sequence-block-card');
            if (cards.length >= 5) {
                window.editor.expandBlock(cards[4]);
            }
        }""")
        time.sleep(0.8) # Allow smooth scroll to finish
        page.screenshot(path=os.path.join(ARTIFACTS_DIR, "03_bottom_item_wall_of_text_expanded.png"))
        print("[QA] Screenshot 3 captured (item 2.2 expanded at bottom with auto-scroll)")
        
        scroll_info = page.evaluate("""() => {
            const scrollEl = document.querySelector('main .flex-1.overflow-y-auto');
            const card = document.querySelectorAll('.sequence-block-card')[4];
            const collapseBtn = card.querySelector('.sequence-block-collapse-btn');
            const cardRect = card.getBoundingClientRect();
            const btnRect = collapseBtn ? collapseBtn.getBoundingClientRect() : null;
            return {
                cardTop: cardRect.top,
                cardBottom: cardRect.bottom,
                btnTop: btnRect ? btnRect.top : null,
                btnBottom: btnRect ? btnRect.bottom : null,
                windowHeight: window.innerHeight,
                isBtnVisibleInViewport: btnRect ? (btnRect.bottom <= window.innerHeight && btnRect.top >= 0) : false
            };
        }""")
        print(f"Bottom item scroll & boundary info: {scroll_info}")
        
        browser.close()

if __name__ == "__main__":
    test_stress_wall_of_text()
