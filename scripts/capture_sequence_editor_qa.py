"""
scripts/capture_sequence_editor_qa.py

Capture comprehensive visual states of Sequence Assembly Editor for cold-eye audit.
"""

import os
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:8000"
ARTIFACTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "artifacts", "sequence_audit"))
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


def capture_all():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        disable_onboarding(context)

        # Dev login
        login_resp = context.request.post(
            f"{BASE_URL}/api/auth/login",
            data={"identifier": "devuser", "password": "password123"}
        )
        print(f"[QA] Login status: {login_resp.status}")

        page = context.new_page()

        def clean_tour():
            page.evaluate("""() => {
                if (window.OnboardingTour && typeof window.OnboardingTour.finish === 'function') {
                    window.OnboardingTour.finish({ seen: true });
                }
                document.querySelectorAll('.onboarding-tour-scrim, .onboarding-tour-popover, .onboarding-tour-dock, .onboarding-tour-callout, .onboarding-tour-card').forEach(el => el.remove());
            }""")
            time.sleep(0.3)

        # 1. Default blank state
        print("[QA] Capturing Scenario 1: Blank / Default State...")
        page.goto(f"{BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?onboarding_preview=sequence-editor-authoring")
        page.wait_for_load_state("networkidle")
        time.sleep(1)
        clean_tour()
        page.evaluate("""() => {
            const ed = window.editor;
            if (ed) {
                ed.task.task_data.name = 'Новое задание';
                ed.updateTaskTitleDisplay('Новое задание');
                const prompt = document.querySelector('#prompt-textarea');
                if (prompt) prompt.value = '';
                ed.levels = [ed.createEmptyLevel()];
                ed.renderUI();
            }
        }""")
        time.sleep(0.5)
        shot1 = os.path.join(ARTIFACTS_DIR, "01_default_blank.png")
        page.screenshot(path=shot1)

        # 2. Standard filled task
        print("[QA] Capturing Scenario 2: Standard Populated Task...")
        page.evaluate("""() => {
            const ed = window.editor;
            if (ed) {
                ed.task.task_data.name = 'Приготовление рабочего раствора';
                ed.updateTaskTitleDisplay('Приготовление рабочего раствора');
                const prompt = document.querySelector('#prompt-textarea');
                if (prompt) prompt.value = 'Расположите этапы приготовления раствора по двум уровням: подготовка и выполнение.';
                ed.levels = [
                    {
                        levelId: 'lvl_1',
                        title: 'Подготовка',
                        items: [
                            { id: 'el_1', label: 'Проверить мерную колбу' },
                            { id: 'el_2', label: 'Отмерить растворитель' }
                        ]
                    },
                    {
                        levelId: 'lvl_2',
                        title: 'Выполнение',
                        items: [
                            { id: 'el_3', label: 'Добавить вещество' },
                            { id: 'el_4', label: 'Перемешать раствор' }
                        ]
                    }
                ];
                ed.renderUI();
            }
        }""")
        time.sleep(1)
        clean_tour()
        shot2 = os.path.join(ARTIFACTS_DIR, "02_standard_populated.png")
        page.screenshot(path=shot2)

        # 3. Multiline element bug reproduction (>2 lines and long text)
        print("[QA] Capturing Scenario 3: Multiline Element Bug Reproduction...")
        page.evaluate("""() => {
            const ed = window.editor;
            if (ed && ed.levels && ed.levels.length > 0) {
                // Add a block with long multiline text in Level 1
                ed.levels[0].items.push({
                    id: 'elem_multiline_test',
                    label: 'Первая строка длинного описания шага процедуры\\nВторая строка с важными деталями и условиями выполнения\\nТретья строка, которая должна обрезаться или скрываться\\nЧетвёртая строка с контролем качества',
                    image: null
                });
                // Also add an extra long single-line block
                ed.levels[0].items.push({
                    id: 'elem_long_single',
                    label: 'Непрерывный длинный текст без переносов строк для проверки горизонтального переполнения и многоточия внутри карточки шага',
                    image: null
                });
                ed.renderUI();
            }
        }""")
        time.sleep(1)
        shot3 = os.path.join(ARTIFACTS_DIR, "03_multiline_bug_reproduction.png")
        page.screenshot(path=shot3)

        # Focus inside the multiline textarea to see edit state
        page.evaluate("""() => {
            const textareas = document.querySelectorAll('.block-title-input');
            if (textareas.length >= 3) {
                textareas[2].focus();
            }
        }""")
        time.sleep(0.5)
        shot3_focused = os.path.join(ARTIFACTS_DIR, "03b_multiline_focused.png")
        page.screenshot(path=shot3_focused)

        # 4. Stress test: Many elements in a level (horizontal overflow & scroll)
        print("[QA] Capturing Scenario 4: Many Elements (Horizontal Overflow)...")
        page.evaluate("""() => {
            const ed = window.editor;
            if (ed && ed.levels) {
                const items = [];
                for (let i = 1; i <= 8; i++) {
                    items.push({
                        id: 'step_' + i,
                        label: 'Этап ' + i + ': Выполнение регламентных действий по протоколу',
                        image: null
                    });
                }
                ed.levels[0].items = items;
                ed.renderUI();
            }
        }""")
        time.sleep(1)
        shot4 = os.path.join(ARTIFACTS_DIR, "04_many_elements_horizontal_scroll.png")
        page.screenshot(path=shot4)

        # 5. Stress test: Many levels (vertical scroll) and long level names
        print("[QA] Capturing Scenario 5: Many Levels & Hierarchy...")
        page.evaluate("""() => {
            const ed = window.editor;
            if (ed) {
                ed.levels = [
                    { levelId: 'l1', title: 'Этап I: Предварительная деконтаминация и подготовка инструментов', items: [{ id: 's1', label: 'Шаг 1.1' }, { id: 's2', label: 'Шаг 1.2' }] },
                    { levelId: 'l2', title: 'Этап II: Основная фаза химического синтеза', items: [{ id: 's3', label: 'Шаг 2.1' }, { id: 's4', label: 'Шаг 2.2' }] },
                    { levelId: 'l3', title: 'Этап III: Фильтрация, очистка и осаждение продукта', items: [{ id: 's5', label: 'Шаг 3.1' }] },
                    { levelId: 'l4', title: 'Этап IV: Выходной инструментальный контроль и стандартизация', items: [{ id: 's6', label: 'Шаг 4.1' }, { id: 's7', label: 'Шаг 4.2' }] }
                ];
                ed.renderUI();
            }
        }""")
        time.sleep(1)
        shot5 = os.path.join(ARTIFACTS_DIR, "05_many_levels_vertical.png")
        page.screenshot(path=shot5)

        # 6. Sidebar inspection (settings interaction)
        print("[QA] Capturing Scenario 6: Sidebar Details...")
        page.evaluate("""() => {
            document.querySelectorAll('.onboarding-tour-scrim, .onboarding-tour-popover').forEach(el => el.remove());
            const chk = document.querySelector('#order-inside-matters');
            if (chk) {
                chk.checked = !chk.checked;
                chk.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (window.editor) window.editor.updateSettingsHelpText();
        }""")
        time.sleep(0.5)
        shot6 = os.path.join(ARTIFACTS_DIR, "06_sidebar_settings_toggle.png")
        page.screenshot(path=shot6)

        # 7. Dark theme inspection
        print("[QA] Capturing Scenario 7: Dark Theme...")
        page.evaluate("""() => {
            if (window.ThemeManager) {
                window.ThemeManager.setTheme('dark-a');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark-a');
                document.documentElement.classList.add('dark');
            }
        }""")
        time.sleep(1)
        shot7 = os.path.join(ARTIFACTS_DIR, "07_dark_theme.png")
        page.screenshot(path=shot7)

        browser.close()
        print("[QA] All screenshots captured successfully!")


if __name__ == "__main__":
    capture_all()
