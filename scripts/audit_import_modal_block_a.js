const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const REPORT_DIR = path.resolve(__dirname, '..', 'reports', 'import_modal_audit', 'block_a');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

const SAMPLE_VALID_TEXT = `
@OPEN_ANSWER
# В чём основная причина гипогликемии при инсулиноме?
= Гиперинсулинемия приводит к усиленной утилизации глюкозы периферическими тканями и угнетению глюконеогенеза в печени.

@SEQUENCE
# Укажите правильный порядок этапов сердечно-легочной реанимации
element_1: Оценка безопасности и сознания
element_2: Вызов скорой помощи
element_3: Компрессии грудной клетки
element_4: Искусственные вдохи
level_1: element_1
level_2: element_2
level_3: element_3
level_4: element_4

@CLICK_WORDS
# Выделите ключевые симптомы перитонита
Пациент жалуется на [острую] [боль], доскообразное напряжение мышц живота и [положительный] симптом Щёткина-Блюмберга.

@TEST
# Контрольный тест по физиологии дыхания
? Какая нормальная частота дыхательных движений у взрослого в покое?
+ 12-20
- 6-10
- 25-30
- 35-40
`.trim();

const SAMPLE_INVALID_TEXT = `
@DRAW
# Нарисуйте контур сердца
[неподдерживаемый маркер]

@OPEN_ANSWER
# Вопрос без эталонного ответа
`.trim();

async function runBlockAAudit() {
    ensureDir(REPORT_DIR);
    const screenshotsDir = path.join(REPORT_DIR, 'screenshots');
    ensureDir(screenshotsDir);

    console.log(`[Audit Block A] Starting audit on ${BASE_URL}...`);
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1
    });

    await context.addInitScript(() => {
        localStorage.setItem('actra_onboarding_disabled_v1', 'true');
        localStorage.setItem('actra_onboarding_seen_v1', JSON.stringify({
            'editor-dashboard-authoring': { seen: true, finished: true },
            'main-dashboard-work-contour': { seen: true, finished: true }
        }));
    });

    const page = await context.newPage();
    await page.route('**/api/ui/settings', route => {
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, settings: { onboarding: { disabled: true, seen: { 'editor-dashboard-authoring': 999 } } } })
        });
    });

    const metrics = {
        collectedAt: new Date().toISOString(),
        scenarios: {},
        domIssues: []
    };

    try {
        console.log('[Audit Block A] Logging in via /api/auth/login...');
        const loginRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
            data: {
                identifier: 'audit.user@actra.local',
                password: 'AuditPassword123!'
            }
        });
        console.log(`[Audit Block A] Login status: ${loginRes.status()}`);

        // 1. Navigate to editor
        console.log('[Audit Block A] Navigating to /editor...');
        await page.goto(`${BASE_URL}/editor`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('[data-role="open-import-modal"]', { state: 'visible', timeout: 20000 });

        // Helper for screenshot
        async function takeShot(name, description) {
            const shotPath = path.join(screenshotsDir, `${name}.png`);
            await page.screenshot({ path: shotPath, fullPage: false });
            console.log(`[Audit Block A] Screenshot captured: ${name}.png - ${description}`);
            return shotPath;
        }

        // Helper to inspect modal DOM metrics
        async function inspectModalDom(stepId) {
            return await page.evaluate((step) => {
                const modal = document.querySelector('#import-modal');
                if (!modal) return null;

                const shell = modal.querySelector('.editor-import-modal-shell');
                const content = modal.querySelector('.editor-import-content-shell');

                // Compute border nesting depth
                function getMaxBorderDepth(el, depth = 0) {
                    let maxD = depth;
                    const style = window.getComputedStyle(el);
                    const hasBorder = (parseInt(style.borderWidth) || 0) > 0 && style.borderStyle !== 'none';
                    const currentDepth = hasBorder ? depth + 1 : depth;
                    if (currentDepth > maxD) maxD = currentDepth;
                    for (const child of el.children) {
                        const childD = getMaxBorderDepth(child, currentDepth);
                        if (childD > maxD) maxD = childD;
                    }
                    return maxD;
                }

                // Find nested scrollbars
                const scrollableElements = [];
                const allElements = shell.querySelectorAll('*');
                allElements.forEach((el) => {
                    const style = window.getComputedStyle(el);
                    const overflowY = style.overflowY;
                    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
                        scrollableElements.push({
                            tag: el.tagName,
                            className: el.className,
                            scrollHeight: el.scrollHeight,
                            clientHeight: el.clientHeight
                        });
                    }
                });

                // Check emojis in task cards
                const emojisFound = [];
                const cards = shell.querySelectorAll('.border-2, [data-role="archive-import-task-card"]');
                cards.forEach(c => {
                    const text = c.innerText;
                    const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
                    if (emojiRegex.test(text)) {
                        emojisFound.push(text.slice(0, 40));
                    }
                });

                // Count buttons and CTAs
                const primaryButtons = Array.from(shell.querySelectorAll('.bg-primary, .btn--primary')).map(b => b.innerText.trim());

                return {
                    step,
                    maxBorderDepth: getMaxBorderDepth(shell),
                    scrollableContainersCount: scrollableElements.length,
                    scrollableContainers: scrollableElements,
                    hasNestedScroll: scrollableElements.length > 1,
                    emojisFoundCount: emojisFound.length,
                    primaryButtons,
                    modalBox: shell.getBoundingClientRect(),
                    contentBox: content ? content.getBoundingClientRect() : null
                };
            }, stepId);
        }

        // =========================================================================
        // SCENARIO A1: Step 1 Initial state & Validation
        // =========================================================================
        console.log('[Audit Block A] Running Scenario A1: Step 1...');
        await page.click('[data-role="open-import-modal"]');
        await page.waitForSelector('#import-modal[open]', { state: 'visible', timeout: 5000 });
        await page.waitForTimeout(600); // allow scaleIn animation

        // Ensure text mode is selected
        const textModeBtn = page.locator('[data-role="import-mode-text"]');
        if (await textModeBtn.count() > 0) {
            await textModeBtn.click();
            await page.waitForTimeout(300);
        }

        await takeShot('A1_01_step1_initial_state', 'Шаг 1: начальный вид текстового импорта');
        metrics.scenarios.A1_initial = await inspectModalDom('A1_initial');

        // Click next with empty module/topic selection
        console.log('[Audit Block A] Triggering empty selection validation...');
        await page.click('[data-role="import-next"]');
        await page.waitForTimeout(600);
        await takeShot('A1_02_step1_empty_validation', 'Шаг 1: валидация при попытке перейти без модуля/темы');

        // Select available module and topic
        const moduleSelect = page.locator('#import-module-select');
        const options = await moduleSelect.locator('option').all();
        let selectedModValue = '';
        for (const opt of options) {
            const val = await opt.getAttribute('value');
            if (val) {
                selectedModValue = val;
                break;
            }
        }

        if (selectedModValue) {
            await moduleSelect.selectOption(selectedModValue);
            await page.waitForTimeout(400);

            const topicSelect = page.locator('#import-topic-select');
            const topicOpts = await topicSelect.locator('option').all();
            for (const tOpt of topicOpts) {
                const tVal = await tOpt.getAttribute('value');
                if (tVal) {
                    await topicSelect.selectOption(tVal);
                    break;
                }
            }
            await page.waitForTimeout(300);
        }

        await takeShot('A1_03_step1_selected_ready', 'Шаг 1: выбран модуль и тема, готов к переходу');

        // =========================================================================
        // SCENARIO A2: Step 2 Text input & Templates
        // =========================================================================
        console.log('[Audit Block A] Running Scenario A2: Step 2 Text Input...');
        await page.click('[data-role="import-next"]');
        await page.waitForTimeout(600); // animation transition

        await takeShot('A2_01_step2_empty_state', 'Шаг 2: пустое поле ввода текста и шаблон ИИ');
        metrics.scenarios.A2_empty = await inspectModalDom('A2_empty');

        // Try Next with empty textarea
        await page.click('[data-role="import-next"]');
        await page.waitForTimeout(500);
        await takeShot('A2_02_step2_empty_validation_toast', 'Шаг 2: валидация пустого поля ввода текста');

        // Fill invalid syntax
        console.log('[Audit Block A] Filling invalid text syntax...');
        const textarea = page.locator('#import-text-area');
        await textarea.fill(SAMPLE_INVALID_TEXT);
        await page.waitForTimeout(300);
        await takeShot('A2_03_step2_invalid_text_input', 'Шаг 2: введен текст с неподдерживаемым маркером @DRAW');

        // Click next -> trigger parse -> expect syntax error banner
        await page.click('[data-role="import-next"]');
        await page.waitForTimeout(1000);
        await takeShot('A2_04_step2_syntax_error_feedback', 'Шаг 2: отображение ошибок парсинга после отправки');
        metrics.scenarios.A2_syntax_errors = await inspectModalDom('A2_syntax_errors');

        // Clear and fill valid multi-task text
        console.log('[Audit Block A] Filling valid multi-task text...');
        const activeTextarea = page.locator('#import-text-area');
        await activeTextarea.fill(SAMPLE_VALID_TEXT);
        await page.waitForTimeout(300);
        await takeShot('A2_05_step2_valid_multi_task_input', 'Шаг 2: введен валидный текст с 4 типами заданий');

        // =========================================================================
        // SCENARIO A3: Step 3 Preview & Bulk Operations
        // =========================================================================
        console.log('[Audit Block A] Running Scenario A3: Step 3 Preview...');
        await page.click('[data-role="import-next"]');
        await page.waitForTimeout(1500); // wait for parse and transition

        await takeShot('A3_01_step3_preview_full', 'Шаг 3: общий вид предпросмотра распарсенных заданий');
        metrics.scenarios.A3_preview = await inspectModalDom('A3_preview');

        // Scroll to examine task cards in detail
        const contentShell = page.locator('.editor-import-content-shell');
        await contentShell.evaluate(el => el.scrollTop = 300);
        await page.waitForTimeout(300);
        await takeShot('A3_02_step3_task_cards_scrolled', 'Шаг 3: прокрутка к карточкам заданий (эмодзи, чипы, метаданные)');

        // Inline edit task name test
        const firstTaskTitle = page.locator('.editor-import-content-shell h4.cursor-pointer').first();
        if (await firstTaskTitle.count() > 0) {
            await firstTaskTitle.click();
            await page.waitForTimeout(300);
            await takeShot('A3_03_step3_inline_edit_name', 'Шаг 3: инлайн-редактирование названия задания в карточке');
            // blur by pressing Enter or clicking away
            await page.keyboard.press('Enter');
            await page.waitForTimeout(200);
        }

        // Test bulk exclusion
        console.log('[Audit Block A] Testing selection and exclusion...');
        const taskCheckboxes = page.locator('[data-task-checkbox]');
        if (await taskCheckboxes.count() > 1) {
            // Check second checkbox
            await taskCheckboxes.nth(1).check();
            await page.waitForTimeout(300);
            await takeShot('A3_04_step3_task_selected', 'Шаг 3: выбрано задание #2 через чекбокс');

            // Click exclude button
            const excludeBtn = page.locator('button:has-text("Исключить выбранные"), button:has-text("Исключить")').first();
            if (await excludeBtn.count() > 0) {
                await excludeBtn.click();
                await page.waitForTimeout(400);
                await takeShot('A3_05_step3_task_excluded_state', 'Шаг 3: задание исключено (полупрозрачность, статус)');
            }
        }

        // =========================================================================
        // SCENARIO A4: Step 4 Confirmation
        // =========================================================================
        console.log('[Audit Block A] Running Scenario A4: Step 4 Confirmation...');
        await page.click('[data-role="import-next"]');
        await page.waitForTimeout(800);

        await takeShot('A4_01_step4_confirmation_ready', 'Шаг 4: подтверждение импорта (состояние готовности)');
        metrics.scenarios.A4_confirmation = await inspectModalDom('A4_confirmation');

        // Back to Step 3 and exclude ALL tasks to check blocked state
        console.log('[Audit Block A] Testing Step 4 blocked state...');
        await page.click('[data-role="import-prev"]');
        await page.waitForTimeout(800);

        // Select All and Exclude
        const selectAllCb = page.locator('#select-all-tasks');
        if (await selectAllCb.count() > 0) {
            if (!await selectAllCb.isChecked()) {
                await selectAllCb.click();
                await page.waitForTimeout(300);
            }
            const bulkExcludeBtn = page.locator('button:has-text("Исключить выбранные")');
            if (await bulkExcludeBtn.count() > 0) {
                await bulkExcludeBtn.click();
                await page.waitForTimeout(400);
            }
        }

        // Go to Step 4 again
        await page.click('[data-role="import-next"]');
        await page.waitForTimeout(800);
        await takeShot('A4_02_step4_confirmation_blocked', 'Шаг 4: блокировка импорта (все задания исключены)');

        // =========================================================================
        // SCENARIO A_RESPONSIVE: Laptop 1366x768 & Small 1024x768
        // =========================================================================
        console.log('[Audit Block A] Testing responsive viewports...');
        // Back to Step 3
        await page.click('[data-role="import-prev"]');
        await page.waitForTimeout(600);

        // Change viewport to 1366x768
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.waitForTimeout(500);
        await takeShot('A_RESPONSIVE_01_step3_laptop_1366x768', 'Адаптивность: Шаг 3 на экране ноутбука 1366x768');
        metrics.scenarios.responsive_1366 = await inspectModalDom('responsive_1366');

        // Change viewport to 1024x768
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.waitForTimeout(500);
        await takeShot('A_RESPONSIVE_02_step3_compact_1024x768', 'Адаптивность: Шаг 3 на компактном экране 1024x768');

        // Save metrics JSON
        fs.writeFileSync(path.join(REPORT_DIR, 'metrics.json'), JSON.stringify(metrics, null, 2), 'utf8');
        console.log('[Audit Block A] Audit completed successfully! Metrics saved.');

    } catch (err) {
        console.error('[Audit Block A] Error during audit run:', err);
        throw err;
    } finally {
        await browser.close();
    }
}

runBlockAAudit().then(() => {
    console.log('[Audit Block A] Process exited cleanly.');
    process.exit(0);
}).catch((err) => {
    console.error('[Audit Block A] Process failed:', err);
    process.exit(1);
});
