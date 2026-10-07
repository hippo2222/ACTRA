const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const REPORT_DIR = path.resolve(__dirname, '..', 'reports', 'import_modal_audit', 'phase_4');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function runPhase4Audit() {
    ensureDir(REPORT_DIR);
    const screenshotsDir = path.join(REPORT_DIR, 'screenshots');
    ensureDir(screenshotsDir);

    console.log(`[Phase 4 Audit] Starting audit on ${BASE_URL}...`);
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
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
    page.on('console', msg => console.log('[Browser Console]', msg.type(), msg.text()));

    await page.route('**/api/ui/settings', route => {
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, settings: { onboarding: { disabled: true, seen: { 'editor-dashboard-authoring': 999 } } } })
        });
    });

    const results = {
        collectedAt: new Date().toISOString(),
        checks: []
    };

    function recordCheck(name, pass, details = '') {
        results.checks.push({ name, pass, details });
        console.log(`[Check] ${pass ? 'PASS' : 'FAIL'} - ${name}: ${details}`);
    }

    try {
        console.log('[Phase 4 Audit] Logging in via /api/auth/login...');
        const loginRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
            data: {
                identifier: 'audit.user@actra.local',
                password: 'AuditPassword123!'
            }
        });
        console.log(`[Phase 4 Audit] Login status: ${loginRes.status()}`);

        console.log('[Phase 4 Audit] Navigating to /editor...');
        await page.goto(`${BASE_URL}/editor`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('[data-role="open-import-modal"]', { state: 'visible', timeout: 20000 });

        // Open Import Modal
        await page.click('[data-role="open-import-modal"]');
        await page.waitForSelector('#import-modal', { state: 'visible', timeout: 10000 });

        // =========================================================================
        // SCENARIO 4A: Step 4 All Valid Tasks (Flat Surface-1, Pluralization 2 tasks, Zero false warnings)
        // =========================================================================
        console.log('[Phase 4 Audit] Setting up Scenario 4A (All valid tasks)...');
        await page.evaluate(() => {
            const im = window.dashboard.importManager;
            im.importMode = 'archive';
            im.selectedModule = 'mod_cardiology';
            im.selectedModuleName = 'Кардиология';
            im.selectedTopic = 'topic_ecg';
            im.selectedTopicName = 'ЭКГ Диагностика';
            im.conflictResolution = 'skip';
            im.excludedTasks.clear();
            im.selectedTasks.clear();
            im.parsedResult = {
                archive_version: '2.0.0',
                workspace_limits: { plan: 'premium', unlimited: true },
                tasks: [
                    { id: 'task_1', title: 'Инфаркт миокарда', type: 'open_answer', status: 'valid', data: { prompt: 'Опишите зубцы Q' } },
                    { id: 'task_2', title: 'Блокада ножек пучка Гиса', type: 'test', status: 'valid', data: { question_count: 4 } }
                ],
                warnings: [],
                errors: []
            };
            im.currentStep = 4;
            im.renderCurrentStep();
            im.updateNavigationButtons();
        });

        await page.waitForTimeout(400);

        const s4aTitle = await page.textContent('[data-role="import-content"] h3');
        const s4aDesc = await page.textContent('[data-role="import-content"] p');
        const s4aNextBtnText = await page.textContent('[data-role="import-next"]');
        const s4aNextDisabled = await page.$eval('[data-role="import-next"]', el => el.disabled);
        const s4aSuccessBox = await page.$eval('[data-role="import-content"] .border-success-light', el => !!el).catch(() => false);

        recordCheck('Scenario 4A: Ready Title', s4aTitle.includes('Готово к импорту'), s4aTitle);
        recordCheck('Scenario 4A: Pluralization 2 tasks', s4aDesc.includes('2 задания'), s4aDesc);
        recordCheck('Scenario 4A: Zero false warnings (Success Box present)', s4aSuccessBox, 'Green verified box rendered');
        recordCheck('Scenario 4A: Import button active', !s4aNextDisabled && s4aNextBtnText.includes('Импортировать'), `Disabled: ${s4aNextDisabled}, Text: ${s4aNextBtnText}`);

        await page.screenshot({
            path: path.join(screenshotsDir, '01_step4_all_valid.png'),
            fullPage: false
        });

        // =========================================================================
        // SCENARIO 4B: Step 4 Singular Form (1 задание)
        // =========================================================================
        console.log('[Phase 4 Audit] Setting up Scenario 4B (Single task pluralization)...');
        await page.evaluate(() => {
            const im = window.dashboard.importManager;
            im.parsedResult.tasks = [
                { id: 'task_1', title: 'Инфаркт миокарда', type: 'open_answer', status: 'valid', data: { prompt: 'Опишите зубцы Q' } }
            ];
            im.renderCurrentStep();
            im.updateNavigationButtons();
        });

        await page.waitForTimeout(300);

        const s4bDesc = await page.textContent('[data-role="import-content"] p');
        recordCheck('Scenario 4B: Singular form (1 задание)', s4bDesc.includes('1 задание') && !s4bDesc.includes('1 заданий'), s4bDesc);

        await page.screenshot({
            path: path.join(screenshotsDir, '02_step4_single_task_plural.png'),
            fullPage: false
        });

        // =========================================================================
        // SCENARIO 4C: Step 4 With Blocked Errors (Skip errors notice)
        // =========================================================================
        console.log('[Phase 4 Audit] Setting up Scenario 4C (Errors present)...');
        await page.evaluate(() => {
            const im = window.dashboard.importManager;
            im.parsedResult.tasks = [
                { id: 'task_1', title: 'Инфаркт миокарда', type: 'open_answer', status: 'valid', data: { prompt: 'Опишите зубцы Q' } },
                { id: 'task_2', title: 'Поврежденное задание', type: 'test', status: 'error', data: {}, issues: ['Отсутствуют варианты'] },
                { id: 'task_3', title: 'Исключенное задание', type: 'click', status: 'valid', data: {} }
            ];
            im.excludedTasks.clear();
            im.excludedTasks.add(2); // Task 3 excluded
            im.renderCurrentStep();
            im.updateNavigationButtons();
        });

        await page.waitForTimeout(300);

        const s4cWarningBox = await page.$eval('[data-role="import-content"] .border-warning-light', el => !!el).catch(() => false);
        const s4cWarningText = await page.textContent('[data-role="import-content"] .border-warning-light');

        recordCheck('Scenario 4C: Warning Box present when errors exist', s4cWarningBox, 'Yellow warning box rendered');
        recordCheck('Scenario 4C: Warning text pluralized and clear', s4cWarningText.includes('1 задание') && s4cWarningText.includes('пропущены'), s4cWarningText);

        await page.screenshot({
            path: path.join(screenshotsDir, '03_step4_with_blocked_errors.png'),
            fullPage: false
        });

        // =========================================================================
        // SCENARIO 4D: Nothing to Import (All excluded or broken)
        // =========================================================================
        console.log('[Phase 4 Audit] Setting up Scenario 4D (Nothing to import)...');
        await page.evaluate(() => {
            const im = window.dashboard.importManager;
            im.excludedTasks.add(0); // Exclude the only valid task
            im.renderCurrentStep();
            im.updateNavigationButtons();
        });

        await page.waitForTimeout(300);

        const s4dTitle = await page.textContent('[data-role="import-content"] h3');
        const s4dNextBtn = await page.textContent('[data-role="import-next"]');
        const s4dNextDisabled = await page.$eval('[data-role="import-next"]', el => el.disabled);
        const s4dErrorBox = await page.$eval('[data-role="import-content"] .border-error-light', el => !!el).catch(() => false);

        recordCheck('Scenario 4D: Disabled Title', s4dTitle.includes('Импорт недоступен'), s4dTitle);
        recordCheck('Scenario 4D: Error Box rendered', s4dErrorBox, 'Red error box rendered');
        recordCheck('Scenario 4D: Next button disabled with message', s4dNextDisabled && s4dNextBtn.includes('Нечего импортировать'), `Text: ${s4dNextBtn}, Disabled: ${s4dNextDisabled}`);

        await page.screenshot({
            path: path.join(screenshotsDir, '04_step4_nothing_to_import.png'),
            fullPage: false
        });

        // =========================================================================
        // SCENARIO 4E: Plan Limit Exceeded
        // =========================================================================
        console.log('[Phase 4 Audit] Setting up Scenario 4E (Limit exceeded)...');
        await page.evaluate(() => {
            const im = window.dashboard.importManager;
            im.excludedTasks.clear();
            im.parsedResult.workspace_limits = {
                plan: 'free',
                unlimited: false,
                tasks: { remaining_personal: 0 }
            };
            im.renderCurrentStep();
            im.updateNavigationButtons();
        });

        await page.waitForTimeout(300);

        const s4eTitle = await page.textContent('[data-role="import-content"] h3');
        const s4eNextBtn = await page.textContent('[data-role="import-next"]');
        const s4eNextDisabled = await page.$eval('[data-role="import-next"]', el => el.disabled);

        recordCheck('Scenario 4E: Limit Title', s4eTitle.includes('Импорт недоступен'), s4eTitle);
        recordCheck('Scenario 4E: Next button blocked with limit text', s4eNextDisabled && s4eNextBtn.includes('Превышен лимит'), `Text: ${s4eNextBtn}, Disabled: ${s4eNextDisabled}`);

        await page.screenshot({
            path: path.join(screenshotsDir, '05_step4_limit_exceeded.png'),
            fullPage: false
        });

        // =========================================================================
        // SCENARIO 4F: Dynamic Progress Bar & Execution State
        // =========================================================================
        console.log('[Phase 4 Audit] Setting up Scenario 4F (Progress bar)...');
        await page.evaluate(() => {
            const im = window.dashboard.importManager;
            im.parsedResult.workspace_limits = { plan: 'premium', unlimited: true };
            im.renderCurrentStep();
            im.updateNavigationButtons();
        });

        await page.waitForTimeout(300);

        await page.evaluate(() => {
            const im = window.dashboard.importManager;
            im.showImportProgressBar('Импорт заданий в каталог...');
            im.updateImportProgress(65, 'Задание 2 из 3');
        });

        await page.waitForTimeout(200);

        const s4fProgressVisible = await page.$eval('#import-progress-bar-container', el => !el.classList.contains('hidden'));
        const s4fProgressPercent = await page.textContent('#import-progress-percent');
        const s4fProgressLabel = await page.textContent('#import-progress-label');
        const s4fNextBtnText = await page.textContent('[data-role="import-next"]');

        recordCheck('Scenario 4F: Progress container visible', s4fProgressVisible, 'Visible in Step 4 DOM');
        recordCheck('Scenario 4F: Progress percentage updated', s4fProgressPercent.includes('65%'), s4fProgressPercent);
        recordCheck('Scenario 4F: Progress label updated', s4fProgressLabel.includes('Задание 2 из 3'), s4fProgressLabel);
        recordCheck('Scenario 4F: Button text shows percentage', s4fNextBtnText.includes('65%'), s4fNextBtnText);

        await page.screenshot({
            path: path.join(screenshotsDir, '06_step4_progress_bar_active.png'),
            fullPage: false
        });

        // =========================================================================
        // SCENARIO 4G: Workspace Import Confirm Step
        // =========================================================================
        console.log('[Phase 4 Audit] Setting up Scenario 4G (Workspace Import Confirm)...');
        await page.evaluate(() => {
            const im = window.dashboard.importManager;
            im.workspaceImportState = {
                request: { sourceComplexId: 'complex_cardio_master' },
                preview: {
                    workspace: { complex_id: 'complex_cardio_master' },
                    summary: {
                        total_nodes: { modules: 2, topics: 4, tasks: 12, theories: 3 },
                        created_counts: { modules: 1, topics: 2, tasks: 8, theories: 1 },
                        reused_counts: { modules: 1, topics: 2, tasks: 4, theories: 2 }
                    }
                },
                executePayload: {
                    ok: true,
                    workspace: { complex_id: 'complex_cardio_master_copy_1' }
                }
            };
            const content = document.querySelector('[data-role="import-content"]');
            if (content) {
                content.innerHTML = im.renderWorkspaceImportConfirmStep();
            }
        });

        await page.waitForTimeout(300);

        const s4gHtml = await page.$eval('[data-role="import-content"]', el => el.innerHTML);

        recordCheck('Scenario 4G: Zero raw "Complex ID"', !s4gHtml.includes('>Complex ID<'), 'Replaced with localized label');
        recordCheck('Scenario 4G: Zero raw "Tasks"', !s4gHtml.includes('>Tasks<'), 'Replaced with localized label');
        recordCheck('Scenario 4G: Zero raw "Открыть copy"', !s4gHtml.includes('Открыть copy'), 'Clean Russian button text');
        recordCheck('Scenario 4G: Proper pluralized counts rendered', s4gHtml.includes('заданий') || s4gHtml.includes('задание'), 'Pluralized tasks count rendered');

        await page.screenshot({
            path: path.join(screenshotsDir, '07_step4_workspace_import_confirm.png'),
            fullPage: false
        });

        console.log('[Phase 4 Audit] All scenarios completed successfully.');

    } catch (err) {
        console.error('[Phase 4 Audit] Error occurred:', err);
        recordCheck('Execution without unhandled errors', false, err.message);
    } finally {
        fs.writeFileSync(
            path.join(REPORT_DIR, 'audit_phase4_report.json'),
            JSON.stringify(results, null, 2),
            'utf-8'
        );
        await browser.close();
    }
}

runPhase4Audit().catch(console.error);
