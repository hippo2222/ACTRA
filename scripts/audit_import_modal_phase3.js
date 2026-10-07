const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const REPORT_DIR = path.resolve(__dirname, '..', 'reports', 'import_modal_audit', 'phase_3');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function runPhase3Audit() {
    ensureDir(REPORT_DIR);
    const screenshotsDir = path.join(REPORT_DIR, 'screenshots');
    ensureDir(screenshotsDir);

    console.log(`[Phase 3 Audit] Starting audit on ${BASE_URL}...`);
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
    page.on('response', async res => {
        if (res.url().includes('/api/')) {
            console.log('[API Response]', res.status(), res.url());
            if (res.url().includes('/api/editor/import/parse')) {
                const body = await res.json().catch(() => null);
                console.log('[API /api/editor/import/parse body]:', JSON.stringify(body, null, 2));
            }
        }
    });
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
        console.log('[Phase 3 Audit] Logging in via /api/auth/login...');
        const loginRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
            data: {
                identifier: 'audit.user@actra.local',
                password: 'AuditPassword123!'
            }
        });
        console.log(`[Phase 3 Audit] Login status: ${loginRes.status()}`);

        console.log('[Phase 3 Audit] Navigating to /editor...');
        await page.goto(`${BASE_URL}/editor`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('[data-role="open-import-modal"]', { state: 'visible', timeout: 20000 });

        async function takeShot(name, description) {
            const shotPath = path.join(screenshotsDir, `${name}.png`);
            await page.screenshot({ path: shotPath, fullPage: false });
            console.log(`[Screenshot] ${name}.png - ${description}`);
            return shotPath;
        }

        // Open Import Modal
        await page.click('[data-role="open-import-modal"]');
        await page.waitForSelector('#import-modal', { state: 'visible', timeout: 5000 });
        await page.waitForTimeout(500);

        // --- Step 1: Select Module & Topic ---
        console.log('[Phase 3 Audit] Step 1: Configuring Module & Topic for text import...');
        const moduleSelect = await page.$('#import-module-select');
        if (moduleSelect) {
            const options = await page.$$eval('#import-module-select option', opts => opts.map(o => o.value).filter(Boolean));
            if (options.length > 0) {
                await page.selectOption('#import-module-select', options[0]);
                await page.waitForTimeout(300);
            }
        }
        const topicSelect = await page.$('#import-topic-select');
        if (topicSelect) {
            const topicOpts = await page.$$eval('#import-topic-select option', opts => opts.map(o => o.value).filter(Boolean));
            if (topicOpts.length > 0) {
                await page.selectOption('#import-topic-select', topicOpts[0]);
                await page.waitForTimeout(300);
            }
        }

        // Click Text mode card
        const textModeCard = await page.$('[data-role="import-mode-text"], [data-role="import-mode-card"][data-mode="text"]');
        if (textModeCard) {
            await textModeCard.click();
            await page.waitForTimeout(300);
        }

        const step1State = await page.evaluate(() => ({
            step: dashboard?.importManager?.currentStep,
            mod: dashboard?.importManager?.selectedModule,
            top: dashboard?.importManager?.selectedTopic
        }));
        console.log('[Phase 3 Audit] Step 1 State:', step1State);

        // Click Next to Step 2
        await page.click('[data-role="import-next"]');
        await page.waitForTimeout(500);

        // --- Step 2: Insert Sample Tasks Text ---
        console.log('[Phase 3 Audit] Step 2: Inserting multiple diverse tasks for testing preview...');
        const sampleText = `@TEST
# Вопрос по анатомии
? Что вырабатывает печень?
+ Желчь
- Инсулин
- Желудочный сок
- Слюну
> Желчь вырабатывается гепатоцитами печени.

@TEST
# Симптомы аппендицита
? Какой симптом указывает на аппендицит?
+ Симптом Щёткина-Блюмберга
- Симптом Кернига
- Симптом Бабинского
> Боль в правой подвздошной области.

@TEST
# Норма пульса
? Какова нормальная частота пульса у взрослого в покое?
+ 60-80 ударов в минуту
- 100-120 ударов в минуту
- 30-40 ударов в минуту
> В норме частота пульса составляет 60-80 уд/мин.`;

        await page.waitForSelector('#import-text-area', { state: 'visible', timeout: 10000 });
        await page.fill('#import-text-area', sampleText);
        // Trigger input event to update sourceText in importManager
        await page.dispatchEvent('#import-text-area', 'input');
        await page.waitForTimeout(400);

        const step2State = await page.evaluate(() => ({
            step: dashboard?.importManager?.currentStep,
            sourceTextLen: dashboard?.importManager?.sourceText?.length,
            nextDisabled: document.querySelector('[data-role="import-next"]')?.disabled
        }));
        console.log('[Phase 3 Audit] Step 2 State before clicking Next:', step2State);

        // Click Next to Step 3 (Parse and Preview)
        console.log('[Phase 3 Audit] Moving to Step 3 (Unified Preview Engine)...');
        await page.click('[data-role="import-next"]');
        await page.waitForTimeout(1200);

        const afterNextState = await page.evaluate(() => ({
            step: dashboard?.importManager?.currentStep,
            content: document.querySelector('#import-step-content')?.innerHTML?.slice(0, 500)
        }));
        console.log('[Phase 3 Audit] After Next Step state:', afterNextState);

        await page.waitForSelector('#preview-tasks-list', { state: 'visible', timeout: 10000 });
        await page.waitForTimeout(600);

        await takeShot('phase3_01_step3_initial_preview', 'Initial Preview with triage chips and unified cards');

        // Verify Step 3 UI Elements
        const filterStrip = await page.$('#preview-filter-strip-container');
        recordCheck('Triage Filter Strip Present', !!filterStrip, 'Filter strip container exists in DOM');

        const toolbar = await page.$('#preview-toolbar-container');
        recordCheck('Preview Toolbar Present', !!toolbar, 'Bulk actions toolbar container exists in DOM');

        const taskCards = await page.$$('[data-task-card]');
        recordCheck('Task Cards Count', taskCards.length === 3, `Found ${taskCards.length} task cards (expected 3)`);

        // Check Anti-Matryoshka (Border Depth)
        const maxBorderDepth = await page.evaluate(() => {
            const cards = document.querySelectorAll('[data-task-card]');
            let maxDepth = 0;
            cards.forEach(card => {
                function getDepth(el, current = 0) {
                    const style = window.getComputedStyle(el);
                    const hasBorder = (parseInt(style.borderWidth) || 0) > 0 && style.borderStyle !== 'none';
                    const next = hasBorder ? current + 1 : current;
                    let m = next;
                    for (const c of el.children) {
                        m = Math.max(m, getDepth(c, next));
                    }
                    return m;
                }
                maxDepth = Math.max(maxDepth, getDepth(card, 0));
            });
            return maxDepth;
        });
        recordCheck('Anti-Matryoshka Compliance', maxBorderDepth <= 2, `Max nested border depth within card is ${maxBorderDepth}`);

        // --- Test Inline Editing of Task Title ---
        console.log('[Phase 3 Audit] Testing Inline Title Editing...');
        const firstCardTitleBefore = await page.$eval('[data-task-card="0"] .task-card-title', el => el.textContent.trim());
        console.log(`Initial title of task 0: "${firstCardTitleBefore}"`);

        // Click pencil icon
        await page.click('[data-task-card="0"] button[title="Редактировать название задания"]');
        await page.waitForTimeout(300);

        const editWrapVisible = await page.$eval('[data-task-card="0"] .task-title-edit-wrap', el => !el.classList.contains('hidden'));
        recordCheck('Inline Edit Opened', editWrapVisible, 'Edit input container is visible');

        const editInput = await page.$('[data-task-card="0"] [data-role="task-title-edit-input"]');
        await editInput.fill('Острый аппендицит: клиническая диагностика');
        await page.waitForTimeout(200);

        // Click Save button (check icon)
        await page.click('[data-task-card="0"] [data-role="save-task-name"]');
        await page.waitForTimeout(300);

        const firstCardTitleAfter = await page.$eval('[data-task-card="0"] .task-card-title', el => el.textContent.trim());
        const editWrapClosed = await page.$eval('[data-task-card="0"] .task-title-edit-wrap', el => el.classList.contains('hidden'));
        recordCheck('Inline Edit Saved', firstCardTitleAfter === 'Острый аппендицит: клиническая диагностика' && editWrapClosed, `New title: "${firstCardTitleAfter}"`);

        await takeShot('phase3_02_after_title_edit', 'After saving inline title edit');

        // --- Test Task Exclusion & Dimming ---
        console.log('[Phase 3 Audit] Testing Task Exclusion and Dimming...');
        const excludeBtn0 = await page.$('[data-task-exclude-btn="0"]');
        const initialBtnText = await excludeBtn0.textContent();
        recordCheck('Initial Exclude Button Label', initialBtnText.trim() === 'Исключить', `Button label is "${initialBtnText.trim()}"`);

        // Click Exclude on task #0
        await excludeBtn0.click();
        await page.waitForTimeout(400);

        const isDimmed = await page.$eval('[data-task-card="0"]', el => el.classList.contains('task-card-excluded'));
        const isStrikethrough = await page.$eval('[data-task-card="0"] .task-card-title', el => el.classList.contains('line-through'));
        const newBtnText = await page.$eval('[data-task-exclude-btn="0"]', el => el.textContent.trim());
        const statusBadgeText = await page.$eval('[data-task-card="0"] [data-status-badge="0"]', el => el.textContent.trim());

        recordCheck('Excluded Card Dimming', isDimmed, 'Card has .task-card-excluded class');
        recordCheck('Excluded Title Strikethrough', isStrikethrough, 'Title has line-through styling');
        recordCheck('Button Switched to Include', newBtnText === 'Включить', `Button label now "${newBtnText}"`);
        recordCheck('Status Badge Shows Excluded', statusBadgeText.includes('Исключено'), `Badge text is "${statusBadgeText}"`);

        await takeShot('phase3_03_after_task_excluded', 'Task #0 dimmed and excluded with updated badge');

        // --- Test Triage Filter Chips ---
        console.log('[Phase 3 Audit] Testing Triage Filter Chips...');
        const excludedChip = await page.$('[data-filter="excluded"]');
        recordCheck('Excluded Filter Chip Visible', !!excludedChip, 'Excluded filter chip exists when tasks are excluded');

        if (excludedChip) {
            await excludedChip.click();
            await page.waitForTimeout(300);

            const card0Visible = await page.$eval('[data-task-card="0"]', el => el.style.display !== 'none' && !el.classList.contains('hidden'));
            const card1Visible = await page.$eval('[data-task-card="1"]', el => el.style.display !== 'none' && !el.classList.contains('hidden'));
            recordCheck('Filter Excluded Works', card0Visible && !card1Visible, 'Only excluded task #0 is shown');
            await takeShot('phase3_04_filter_excluded_active', 'Filter set to Excluded tasks');

            // Switch back to "Готовы" (valid)
            await page.click('[data-filter="valid"]');
            await page.waitForTimeout(300);

            const card0HiddenInValid = await page.$eval('[data-task-card="0"]', el => el.style.display === 'none' || el.classList.contains('hidden'));
            const card1VisibleInValid = await page.$eval('[data-task-card="1"]', el => el.style.display !== 'none' && !el.classList.contains('hidden'));
            recordCheck('Filter Valid Works', card0HiddenInValid && card1VisibleInValid, 'Excluded task #0 is hidden in Valid view');
            await takeShot('phase3_05_filter_valid_active', 'Filter set to Valid tasks');

            // Switch back to "Все" (all)
            await page.click('[data-filter="all"]');
            await page.waitForTimeout(300);
        }

        // Re-include task #0
        await page.click('[data-task-exclude-btn="0"]');
        await page.waitForTimeout(300);
        const restoredDimmed = await page.$eval('[data-task-card="0"]', el => el.classList.contains('task-card-excluded'));
        recordCheck('Task Re-included', !restoredDimmed, 'Card is no longer dimmed');

        // --- Test Bulk Selection and Actions ---
        console.log('[Phase 3 Audit] Testing Bulk Selection and Bulk Actions...');
        const selectAllCb = await page.$('#select-all-tasks');
        await selectAllCb.click();
        await page.waitForTimeout(300);

        const counterText = await page.$eval('#preview-selected-counter', el => el.textContent.trim());
        const bulkExcludeBtnDisabled = await page.$eval('[data-role="bulk-exclude-btn"]', el => el.disabled);
        recordCheck('Select All Works', counterText.includes('3') && !bulkExcludeBtnDisabled, `Counter: "${counterText}", Bulk Exclude disabled: ${bulkExcludeBtnDisabled}`);
        await takeShot('phase3_06_bulk_selection_active', 'All tasks selected via toolbar checkbox');

        // Perform Bulk Exclude
        await page.click('[data-role="bulk-exclude-btn"]');
        await page.waitForTimeout(400);

        const allDimmed = await page.$$eval('[data-task-card]', cards => cards.every(c => c.classList.contains('task-card-excluded')));
        recordCheck('Bulk Exclude Applied', allDimmed, 'All cards received .task-card-excluded');
        await takeShot('phase3_07_bulk_excluded', 'All tasks bulk excluded');

        // Select All again and Bulk Include
        await page.click('#select-all-tasks');
        await page.waitForTimeout(300);
        await page.click('[data-role="bulk-include-btn"]');
        await page.waitForTimeout(400);

        const noneDimmed = await page.$$eval('[data-task-card]', cards => cards.every(c => !c.classList.contains('task-card-excluded')));
        recordCheck('Bulk Include Applied', noneDimmed, 'All cards restored from exclusion');
        await takeShot('phase3_08_bulk_restored', 'All tasks bulk included');

        // Navigate back to Step 1 to test Archive mode
        console.log('[Phase 3 Audit] Switching to Archive Mode (P0-2 and Issues Accordion)...');
        await page.evaluate(() => {
            dashboard.importManager.goToStep(1);
            dashboard.importManager.importMode = 'archive';
            dashboard.importManager.renderCurrentStep();
        });
        await page.waitForTimeout(500);

        // Upload ZIP file
        const zipPath = path.resolve(__dirname, '..', 'reports', 'import_modal_audit', 'block_b', 'audit_test_archive.zip');
        const fileInput = await page.$('#import-file-input');
        if (fileInput) {
            await fileInput.setInputFiles(zipPath);
            await page.waitForTimeout(400);
        }

        // Click Next to Step 2 (Validation Check) -> advances to Step 3
        await page.click('[data-role="import-next"]');
        await page.waitForSelector('[data-role="archive-import-preview"]', { state: 'visible', timeout: 15000 });
        await page.waitForTimeout(600);

        // Verify full width layout (no grid-cols-2)
        const archiveListIsFullWidth = await page.$eval('#preview-tasks-list', el => {
            return !el.classList.contains('lg:grid-cols-2') && el.classList.contains('w-full');
        });
        recordCheck('Archive Layout 100% Width (No 50/50 Split)', archiveListIsFullWidth, 'Tasks list uses full width without 50/50 crowding');

        // Verify issues accordion
        const issuesAccordion = await page.$('[data-role="archive-import-issues"]');
        recordCheck('Archive Issues Accordion Present', !!issuesAccordion, 'Issues and warnings rendered inside structured accordion');

        await takeShot('phase3_09_archive_preview_fullwidth', 'Archive Preview with 100% full width and issues accordion');

        // Close modal
        await page.evaluate(() => dashboard.closeImportModal({ skipConfirm: true }));
        await page.waitForTimeout(500);

        // Write audit report summary
        const allPassed = results.checks.every(c => c.pass);
        results.overallStatus = allPassed ? 'PASS' : 'FAIL';
        fs.writeFileSync(path.join(REPORT_DIR, 'phase3_audit_results.json'), JSON.stringify(results, null, 2), 'utf-8');
        console.log(`\n[Phase 3 Audit] Completed! Overall Verdict: ${results.overallStatus}`);
        console.log(`[Phase 3 Audit] Passed: ${results.checks.filter(c => c.pass).length}/${results.checks.length}`);

    } catch (err) {
        console.error('[Phase 3 Audit] ERROR:', err);
        results.error = err.message;
        results.overallStatus = 'FAIL';
        fs.writeFileSync(path.join(REPORT_DIR, 'phase3_audit_results.json'), JSON.stringify(results, null, 2), 'utf-8');
    } finally {
        await browser.close();
    }
}

runPhase3Audit();
