"""
scripts/capture_import_modal_role_audit.py

Phase 1 Automation for Section 11 of AGENTS.md (Multi-Role Subagent Panel Protocol).
Captures 10 high-fidelity screenshots at 1280x800 for the task import modal
across all 3 reviewer roles (First-Time UX, Didactics/Ergonomics, Visual Guardian).
"""

import os
import sys
import time
import json
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:8000"
ARTIFACTS_DIR = r"C:\Users\ASUS\.gemini\antigravity\brain\894a4ca0-2b71-4953-a9cf-f42118175923\import_modal_role_audit"
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


STRESS_PAYLOAD_TEXT = """@TEST
@ title: Расширенная дифференциальная диагностика и интенсивная терапия шоковых состояний у взрослых пациентов в ОРИТ
? Какой целевой показатель среднего артериального давления (САД / MAP) рекомендован протоколами Surviving Sepsis Campaign при септическом шоке после завершения первичной инфузионной нагрузки?
+ 65 мм рт. ст. и выше
- 50 мм рт. ст.
- 85-90 мм рт. ст. рутинно для всех пациентов
- 110 мм рт. ст.

? Какой вазопрессор является препаратом первого выбора при рефрактерной артериальной гипотензии на фоне септического шока?
+ Норадреналин (норэпинефрин) в титруемой дозе
- Допамин в низких («почечных») дозах
- Адреналин в качестве стартовой монотерапии
- Фенилэфрин

@SEQUENCE
@ title: Алгоритм действий специализированной реанимационной бригады при остановке кровообращения с ритмами фибрилляции желудочков и желудочковой тахикардии без пульса
# Расположите этапы реанимационной помощи в строгом хронологическом порядке согласно клиническим рекомендациям 2025 года
element_1: Оценить безопасность места происшествия, проверить реакцию пациента на вербальные и тактильные стимулы, позвать на помощь
element_2: Начать высококачественные компрессии грудной клетки с частотой 100-120 в минуту и глубиной 5-6 см без гипервентиляции
element_3: Наложить адгезивные электроды дефибриллятора и выполнить первичную оценку ритма по монитору
element_4: Нанести первый разряд дефибриллятора (150-200 Дж бифазный) и немедленно возобновить компрессии грудной клетки на 2 минуты
element_5: После 3-го разряда ввести адреналин 1 мг внутривенно и амиодарон 300 мг болюсно в центральный или периферический венозный доступ
level_1 [Первичный осмотр и базовый протокол СЛР]: element_1, element_2
level_2 [Дефибрилляция и мониторинг кардиоритма]: element_3, element_4
level_3 [Фармакотерапия рефрактерной ФЖ / ЖТ]: element_5

@CLICK_TEXT
@ title: Экспертная проверка знаний критических ошибок при проведении закрытого массажа сердца у взрослого пациента
# Определите все критические ошибки в представленном описании действий медицинского персонала
+ Проведение пауз на оценку ритма и искусственную вентиляцию длительностью более 10 секунд
- Полное расправление грудной клетки после каждого компрессионного сжатия
+ Опирание ладонями на грудную клетку пациента в фазе декомпрессии без отрыва рук
- Частота компрессий в интервале от 100 до 120 нажатий в минуту

@OPEN_ANSWER
@ title: Расчет стартовой инфузионной терапии при ожоговом шоке по модифицированной формуле Паркланда
? Укажите формулу расчета объема кристаллоидных растворов в первые 24 часа после тяжелой термической травмы у взрослого пациента массой 70 кг с площадью ожога 30% поверхности тела:
= 4 мл * 70 кг * 30% = 8400 мл с введением 50% объема в первые 8 часов от момента травмы
"""


def capture_role_audit_matrix():
    manifest = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "viewport": {"width": 1280, "height": 800},
        "screenshots": []
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        disable_onboarding(context)

        # 1. Login
        print("[QA] Logging in as devuser...")
        login_resp = context.request.post(
            f"{BASE_URL}/api/auth/login",
            data=json.dumps({"identifier": "devuser", "password": "password123"}),
            headers={"Content-Type": "application/json"}
        )
        print(f"[QA] Login status: {login_resp.status}")

        page = context.new_page()

        # 2. Open Editor Dashboard
        print("[QA] Navigating to /editor/...")
        page.goto(f"{BASE_URL}/editor/")
        page.wait_for_load_state("networkidle")
        page.wait_for_function("() => window.dashboard && window.dashboard.importManager")
        time.sleep(1.0)

        # -------------------------------------------------------------
        # Shot 1: Step 1 Format Choice / Blank State
        # -------------------------------------------------------------
        print("\n[QA] Capturing Shot 1: Step 1 Format Choice / Initial Modal...")
        page.evaluate("""() => {
            if (window.dashboard && window.dashboard.showImportModal) {
                window.dashboard.showImportModal();
            }
            const im = window.dashboard.importManager;
            if (im) {
                im.currentStep = 1;
                im.renderCurrentStep();
                im.updateStepUI();
            }
        }""")
        time.sleep(0.6)
        
        # Deterministic Geometry & Underflow Assertions Gate for Step 1
        metrics = page.evaluate("""() => {
            const shell = document.querySelector('#import-modal .editor-import-modal-shell');
            const contentShell = document.querySelector('#import-modal .editor-import-content-shell');
            const innerContent = contentShell ? contentShell.firstElementChild : null;
            const footer = document.querySelector('#import-modal .editor-import-footer');
            if (!shell || !contentShell || !innerContent || !footer) return null;

            const shellRect = shell.getBoundingClientRect();
            const contentRect = contentShell.getBoundingClientRect();
            const innerRect = innerContent.getBoundingClientRect();
            const footerRect = footer.getBoundingClientRect();

            const modeGrid = document.querySelector('#import-modal .import-mode-grid');
            const targetSection = document.querySelector('#import-modal .import-section-target');
            const historySection = document.querySelector('#import-modal .import-section-history');
            
            let modeToTargetGap = 0;
            let targetToHistoryGap = 0;
            if (modeGrid && targetSection) {
                const modeRect = modeGrid.getBoundingClientRect();
                const targetRect = targetSection.getBoundingClientRect();
                modeToTargetGap = targetRect.top - modeRect.bottom;
            }
            if (targetSection && historySection) {
                const targetRect = targetSection.getBoundingClientRect();
                const histRect = historySection.getBoundingClientRect();
                targetToHistoryGap = histRect.top - targetRect.bottom;
            }

            return {
                shellWidth: shellRect.width,
                shellHeight: shellRect.height,
                contentHeight: contentRect.height,
                innerHeight: innerRect.height,
                bottomVoid: footerRect.top - innerRect.bottom,
                densityRatio: innerRect.height / contentRect.height,
                modeToTargetGap: modeToTargetGap,
                targetToHistoryGap: targetToHistoryGap,
                hasVerticalScroll: contentShell.scrollHeight > contentShell.clientHeight + 2
            };
        }""")
        print(f"[QA GATE] Step 1 Geometry Metrics: {metrics}")
        if metrics:
            assert not metrics["hasVerticalScroll"], f"Step 1 has vertical scroll!"
            assert metrics["bottomVoid"] <= 48, f"Step 1 has dead white void ({metrics['bottomVoid']:.1f}px > 48px)!"
            assert metrics["densityRatio"] >= 0.70, f"Step 1 density ratio too low ({metrics['densityRatio']:.2f} < 0.70)!"
            assert metrics["shellWidth"] <= 820, f"Step 1 shell is too wide ({metrics['shellWidth']:.1f}px > 820px)!"
            assert metrics["modeToTargetGap"] >= 16, f"Mode to Target gap too small ({metrics['modeToTargetGap']:.1f}px < 16px)!"
            assert metrics["targetToHistoryGap"] >= 16, f"Target to History gap too small ({metrics['targetToHistoryGap']:.1f}px < 16px)!"

        shot1_path = os.path.join(ARTIFACTS_DIR, "01_step1_format_choice.png")
        page.screenshot(path=shot1_path)
        manifest["screenshots"].append({
            "id": "01_step1_format_choice",
            "file": "01_step1_format_choice.png",
            "role_focus": ["Role 1 (First-Time UX)", "Role 3 (Visual Guardian)"],
            "description": "Шаг 1: Первое впечатление. Выбор модуля, темы и формата импорта (Текст / ZIP / AI)."
        })

        # -------------------------------------------------------------
        # Transition to Step 2 (Pick Module & Topic)
        # -------------------------------------------------------------
        page.evaluate("""() => {
            const im = window.dashboard.importManager;
            im.importMode = 'text';
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
            im.sourceText = '';
            im.importTaskTitle = '';
            im.renderCurrentStep();
            im.updateStepUI();
        }""")
        time.sleep(0.5)

        # -------------------------------------------------------------
        # Shot 2: Step 2 Blank Idle (Empty Editor with Title Input)
        # -------------------------------------------------------------
        print("\n[QA] Capturing Shot 2: Step 2 Blank Idle...")
        shot2_path = os.path.join(ARTIFACTS_DIR, "02_step2_blank_idle.png")
        page.screenshot(path=shot2_path)
        manifest["screenshots"].append({
            "id": "02_step2_blank_idle",
            "file": "02_step2_blank_idle.png",
            "role_focus": ["Role 1 (First-Time UX)", "Role 3 (Visual Guardian)"],
            "description": "Шаг 2: Чистое состояние. Инпут названия с плейсхолдером, пустое текстовое поле, панель шпаргалки 60/40."
        })

        # -------------------------------------------------------------
        # Shot 3: Step 2 Focused Title
        # -------------------------------------------------------------
        print("\n[QA] Capturing Shot 3: Step 2 Focused Title Input...")
        title_input = page.locator("#import-task-title-input")
        title_input.focus()
        title_input.fill("Алгоритм базовой сердечно-легочной реанимации у взрослых (BLS 2025)")
        time.sleep(0.3)
        shot3_path = os.path.join(ARTIFACTS_DIR, "03_step2_focused_title.png")
        page.screenshot(path=shot3_path)
        manifest["screenshots"].append({
            "id": "03_step2_focused_title",
            "file": "03_step2_focused_title.png",
            "role_focus": ["Role 3 (Visual Guardian)", "Role 1 (First-Time UX)"],
            "description": "Шаг 2: Активное состояние фокуса. Проверка focus-ring и контрастности инпута названия."
        })

        # -------------------------------------------------------------
        # Shot 4: Step 2 Heavy Stress Payload (>2500 chars)
        # -------------------------------------------------------------
        print("\n[QA] Capturing Shot 4: Step 2 Heavy Stress Payload...")
        page.evaluate(f"""() => {{
            const im = window.dashboard.importManager;
            im.sourceText = {json.dumps(STRESS_PAYLOAD_TEXT)};
            im.renderCurrentStep();
            const ta = document.getElementById('import-text-area');
            if (ta) {{
                ta.value = {json.dumps(STRESS_PAYLOAD_TEXT)};
                im._updateLiveCounter(ta.value);
                im.updateHeaderStats(ta.value);
            }}
        }}""")
        time.sleep(0.5)
        shot4_path = os.path.join(ARTIFACTS_DIR, "04_step2_heavy_stress_payload.png")
        page.screenshot(path=shot4_path)
        manifest["screenshots"].append({
            "id": "04_step2_heavy_stress_payload",
            "file": "04_step2_heavy_stress_payload.png",
            "role_focus": ["Role 2 (Didactics & Ergonomics)", "Role 3 (Visual Guardian)"],
            "description": "Шаг 2: Стресс-нагрузка. Большой клинический текст (>2500 символов, 5 заданий разных типов), счетчики символов."
        })

        # -------------------------------------------------------------
        # Transition to Step 3: Parse & Preview
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
        # Shot 5: Step 3 Preview Standard
        # -------------------------------------------------------------
        print("\n[QA] Capturing Shot 5: Step 3 Preview Standard...")
        shot5_path = os.path.join(ARTIFACTS_DIR, "05_step3_preview_standard.png")
        page.screenshot(path=shot5_path)
        manifest["screenshots"].append({
            "id": "05_step3_preview_standard",
            "file": "05_step3_preview_standard.png",
            "role_focus": ["Role 2 (Didactics & Ergonomics)", "Role 1 (First-Time UX)"],
            "description": "Шаг 3: Предпросмотр карточек. Открытые инпуты названий заданий, бейджи типов и сложности, чекбоксы выбора."
        })

        # -------------------------------------------------------------
        # Shot 6: Step 3 Active Edit Focus
        # -------------------------------------------------------------
        print("\n[QA] Capturing Shot 6: Step 3 Active Edit Focus on Card Title...")
        card_input = page.locator('[data-task-title-input="0"]')
        card_input.focus()
        card_input.fill("Редактированное название: Протокол шока в ОРИТ (финальная редакция)")
        time.sleep(0.4)
        shot6_path = os.path.join(ARTIFACTS_DIR, "06_step3_active_edit_focus.png")
        page.screenshot(path=shot6_path)
        manifest["screenshots"].append({
            "id": "06_step3_active_edit_focus",
            "file": "06_step3_active_edit_focus.png",
            "role_focus": ["Role 3 (Visual Guardian)", "Role 2 (Didactics & Ergonomics)"],
            "description": "Шаг 3: Активное редактирование названия на карточке. Проверка focus-ring и отсутствия сброса курсора."
        })

        # -------------------------------------------------------------
        # Shot 7: Step 3 Heavy Cards Scroll
        # -------------------------------------------------------------
        print("\n[QA] Capturing Shot 7: Step 3 Heavy Cards Scroll...")
        page.evaluate("""() => {
            const container = document.querySelector('.editor-import-content-shell');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }""")
        time.sleep(0.4)
        shot7_path = os.path.join(ARTIFACTS_DIR, "07_step3_heavy_cards_scroll.png")
        page.screenshot(path=shot7_path)
        manifest["screenshots"].append({
            "id": "07_step3_heavy_cards_scroll",
            "file": "07_step3_heavy_cards_scroll.png",
            "role_focus": ["Role 3 (Visual Guardian)", "Role 2 (Didactics & Ergonomics)"],
            "description": "Шаг 3: Скролл длинного списка карточек до подвала. Проверка прилипания футера и отсутствия наездов."
        })

        # -------------------------------------------------------------
        # Shot 8: Dark Theme Step 2
        # -------------------------------------------------------------
        print("\n[QA] Capturing Shot 8: Dark Theme Step 2...")
        page.evaluate("""() => {
            if (window.ThemeManager) {
                window.ThemeManager.setTheme('dark-a');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark-a');
                document.documentElement.classList.add('dark');
            }
            const im = window.dashboard.importManager;
            im.currentStep = 2;
            im.renderCurrentStep();
            im.updateStepUI();
        }""")
        time.sleep(0.5)
        shot8_path = os.path.join(ARTIFACTS_DIR, "08_dark_theme_step2.png")
        page.screenshot(path=shot8_path)
        manifest["screenshots"].append({
            "id": "08_dark_theme_step2",
            "file": "08_dark_theme_step2.png",
            "role_focus": ["Role 3 (Visual Guardian)"],
            "description": "Шаг 2 в темной теме ('Ночь' / dark-a). Проверка читаемости текста, контрастности границ и полей ввода."
        })

        # -------------------------------------------------------------
        # Shot 9: Dark Theme Step 3
        # -------------------------------------------------------------
        print("\n[QA] Capturing Shot 9: Dark Theme Step 3...")
        page.evaluate("""() => {
            const im = window.dashboard.importManager;
            im.currentStep = 3;
            im.renderCurrentStep();
            im.updateStepUI();
        }""")
        time.sleep(0.5)
        shot9_path = os.path.join(ARTIFACTS_DIR, "09_dark_theme_step3.png")
        page.screenshot(path=shot9_path)
        manifest["screenshots"].append({
            "id": "09_dark_theme_step3",
            "file": "09_dark_theme_step3.png",
            "role_focus": ["Role 3 (Visual Guardian)"],
            "description": "Шаг 3 в темной теме ('Ночь' / dark-a). Контрастность карточек предпросмотра, бейджей и CTA-кнопок."
        })

        # -------------------------------------------------------------
        # Shot 10: Data Loss Prevention (Dismiss Attempt with Data)
        # -------------------------------------------------------------
        print("\n[QA] Capturing Shot 10: Data Loss Prevention Dialog...")
        # Reset to light theme for dialog inspection
        page.evaluate("""() => {
            if (window.ThemeManager) {
                window.ThemeManager.setTheme('light-a');
            } else {
                document.documentElement.setAttribute('data-theme', 'light-a');
                document.documentElement.classList.remove('dark');
            }
            // Trigger closeImportModal which initiates confirmAction when meaningful state exists
            window.dashboard.closeImportModal();
        }""")
        time.sleep(0.6)
        shot10_path = os.path.join(ARTIFACTS_DIR, "10_data_loss_dismiss_attempt.png")
        page.screenshot(path=shot10_path)
        manifest["screenshots"].append({
            "id": "10_data_loss_dismiss_attempt",
            "file": "10_data_loss_dismiss_attempt.png",
            "role_focus": ["Role 1 (First-Time UX)", "Role 2 (Didactics & Ergonomics)"],
            "description": "Попытка закрытия модалки с набранным контентом. Проверка появления диалога подтверждения (DLP)."
        })

        browser.close()

    manifest_path = os.path.join(ARTIFACTS_DIR, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print("\n========================================================")
    print(f"Phase 1 Complete! 10 Screenshots captured successfully.")
    print(f"Manifest written to: {manifest_path}")
    print("========================================================\n")


if __name__ == "__main__":
    capture_role_audit_matrix()
