const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const REPORT_DIR = path.resolve(__dirname, '..', 'reports', 'import_modal_audit', 'block_b');
const CORRUPT_ZIP_PATH = path.join(REPORT_DIR, 'corrupt_test.zip');
const VALID_ZIP_PATH = path.join(REPORT_DIR, 'audit_test_archive.zip');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function runBlockBAudit() {
    ensureDir(REPORT_DIR);
    const screenshotsDir = path.join(REPORT_DIR, 'screenshots');
    ensureDir(screenshotsDir);

    console.log(`[Audit Block B] Starting audit on ${BASE_URL}...`);
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
        console.log('[Audit Block B] Logging in via /api/auth/login...');
        const loginRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
            data: {
                identifier: 'audit.user@actra.local',
                password: 'AuditPassword123!'
            }
        });
        console.log(`[Audit Block B] Login status: ${loginRes.status()}`);

        // Navigate to editor
        console.log('[Audit Block B] Navigating to /editor...');
        await page.goto(`${BASE_URL}/editor`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('[data-role="open-import-modal"]', { state: 'visible', timeout: 20000 });

        async function takeShot(name, description) {
            const shotPath = path.join(screenshotsDir, `${name}.png`);
            await page.screenshot({ path: shotPath, fullPage: false });
            console.log(`[Audit Block B] Screenshot captured: ${name}.png - ${description}`);
            return shotPath;
        }

        async function inspectModalDom(stepId) {
            return await page.evaluate((step) => {
                const modal = document.querySelector('#import-modal');
                if (!modal) return null;

                const shell = modal.querySelector('.editor-import-modal-shell');
                const content = modal.querySelector('.editor-import-content-shell');

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

                const cards = Array.from(shell.querySelectorAll('[data-role="archive-import-task-card"]')).map(c => {
                    return {
                        title: c.querySelector('.text-base.font-bold')?.innerText.trim() || '',
                        statusBadge: c.querySelector('span.rounded-full')?.innerText.trim() || '',
                        isExcluded: c.classList.contains('opacity-60'),
                        hasConflictSelect: !!c.querySelector('select')
                    };
                });

                const primaryButtons = Array.from(shell.querySelectorAll('.bg-primary, .btn--primary')).map(b => b.innerText.trim());

                return {
                    step,
                    maxBorderDepth: getMaxBorderDepth(shell),
                    scrollableContainersCount: scrollableElements.length,
                    scrollableContainers: scrollableElements,
                    hasNestedScroll: scrollableElements.length > 1,
                    archiveCardsCount: cards.length,
                    archiveCards: cards,
                    primaryButtons,
                    modalBox: shell.getBoundingClientRect(),
                    contentBox: content ? content.getBoundingClientRect() : null
                };
            }, stepId);
        }

        // =========================================================================
        // SCENARIO B1: Step 1 Archive Initial State & Selection
        // =========================================================================
        console.log('[Audit Block B] Running Scenario B1: Step 1 Archive Initial...');
        await page.click('[data-role="open-import-modal"]');
        await page.waitForSelector('#import-modal[open]', { state: 'visible', timeout: 5000 });
        await page.waitForTimeout(600);

        // Switch to archive mode
        const archiveModeBtn = page.locator('[data-role="import-mode-archive"]');
        await archiveModeBtn.click();
        await page.waitForTimeout(400);

        await takeShot('B1_01_step1_archive_initial', 'Шаг 1: начальный вид режима «Из архива»');
        metrics.scenarios.B1_initial = await inspectModalDom('B1_initial');

        // Expand Target Override collapsible
        const overrideToggle = page.locator('span:has-text("Дополнительно (Target Override)")');
        if (await overrideToggle.count() > 0) {
            await overrideToggle.click();
            await page.waitForTimeout(300);
            await takeShot('B1_02_step1_archive_override_expanded', 'Шаг 1: развернута панель переопределения модуля/темы');
        }

        // Try clicking Next without file selected -> trigger validation warning
        console.log('[Audit Block B] Triggering empty archive validation...');
        await page.click('[data-role="import-next"]');
        await page.waitForTimeout(500);
        await takeShot('B1_03_step1_archive_no_file_warning', 'Шаг 1: валидация при попытке продолжить без файла архива');

        // =========================================================================
        // SCENARIO B2: Step 2 File Selection & Corrupt File Feedback
        // =========================================================================
        console.log('[Audit Block B] Running Scenario B2: Corrupt ZIP handling...');
        const fileInput = page.locator('#import-file-input');
        await fileInput.setInputFiles(CORRUPT_ZIP_PATH);
        await page.waitForTimeout(400);
        await takeShot('B2_01_step1_corrupt_file_selected', 'Шаг 1: выбран поврежденный ZIP-файл');

        // Click next -> sends to backend /api/editor/import/check -> fails -> toast + return to Step 1
        await page.click('[data-role="import-next"]');
        await page.waitForTimeout(1000);
        await takeShot('B2_02_step1_corrupt_file_error_toast', 'Шаг 1: сообщение об ошибке проверки поврежденного архива');
        metrics.scenarios.B2_corrupt_feedback = await inspectModalDom('B2_corrupt_feedback');

        // =========================================================================
        // SCENARIO B3: Step 3 Archive Preview with Diverse Tasks
        // =========================================================================
        console.log('[Audit Block B] Running Scenario B3: Valid rich archive preview...');
        await fileInput.setInputFiles(VALID_ZIP_PATH);
        await page.waitForTimeout(400);
        await takeShot('B3_00_step1_valid_archive_selected', 'Шаг 1: выбран валидный архив с заданиями');

        // Click next -> check step -> preview step
        await page.click('[data-role="import-next"]');
        await page.waitForSelector('[data-role="archive-import-preview"]', { state: 'visible', timeout: 15000 });
        await page.waitForTimeout(800);

        await takeShot('B3_01_step3_archive_preview_full', 'Шаг 3: предпросмотр архива (сводка, конфликты, ошибки)');
        metrics.scenarios.B3_preview = await inspectModalDom('B3_preview');

        // Scroll to examine conflict card and error card
        const contentShell = page.locator('.editor-import-content-shell');
        await contentShell.evaluate(el => el.scrollTop = 380);
        await page.waitForTimeout(400);
        await takeShot('B3_02_step3_archive_conflict_and_error_cards', 'Шаг 3: карточки конфликта (overwrite) и ошибки (corrupt JSON)');

        // Change conflict resolution dropdown on the conflict task card
        const perTaskConflictSelect = page.locator('[data-role="archive-import-task-card"] select').first();
        if (await perTaskConflictSelect.count() > 0) {
            await perTaskConflictSelect.selectOption('new_id');
            await page.waitForTimeout(300);
            await takeShot('B3_03_step3_archive_per_task_conflict_dropdown', 'Шаг 3: выбран режим разрешения конфликта «Создать копию (новый ID)»');
        }

        // Test individual exclude button on Task 1
        const firstExcludeBtn = page.locator('[data-task-exclude-btn]').first();
        if (await firstExcludeBtn.count() > 0) {
            await firstExcludeBtn.click();
            await page.waitForTimeout(400);
            await takeShot('B3_04_step3_archive_task_excluded', 'Шаг 3: задание #1 исключено вручную (приглушение opacity-60)');
        }

        // Test bulk selection and bulk exclusion
        console.log('[Audit Block B] Testing bulk actions...');
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
                await takeShot('B3_05_step3_archive_bulk_excluded', 'Шаг 3: все задания исключены через массовые действия');
            }
        }

        // =========================================================================
        // SCENARIO B4: Step 4 Confirmation
        // =========================================================================
        console.log('[Audit Block B] Running Scenario B4: Step 4 Confirmation...');
        // All tasks excluded -> Step 4 should be BLOCKED
        await page.click('[data-role="import-next"]');
        await page.waitForTimeout(800);
        await takeShot('B4_02_step4_archive_confirmation_blocked', 'Шаг 4: подтверждение импорта архива (заблокировано, все исключены)');

        // Return to Step 3 and include tasks back
        await page.click('[data-role="import-prev"]');
        await page.waitForTimeout(800);

        if (await selectAllCb.count() > 0) {
            if (!await selectAllCb.isChecked()) {
                await selectAllCb.click();
                await page.waitForTimeout(200);
            }
            const bulkIncludeBtn = page.locator('button:has-text("Включить выбранные")');
            if (await bulkIncludeBtn.count() > 0) {
                await bulkIncludeBtn.click();
                await page.waitForTimeout(400);
            }
        }

        // Advance to Step 4 in READY state
        await page.click('[data-role="import-next"]');
        await page.waitForTimeout(800);
        await takeShot('B4_01_step4_archive_confirmation_ready', 'Шаг 4: подтверждение импорта архива (состояние готовности)');
        metrics.scenarios.B4_confirmation = await inspectModalDom('B4_confirmation');

        // =========================================================================
        // SCENARIO B_RESPONSIVE: Screen Resolutions
        // =========================================================================
        console.log('[Audit Block B] Testing responsive viewports...');
        // Back to Step 3
        await page.click('[data-role="import-prev"]');
        await page.waitForTimeout(600);

        // Viewport 1366x768 (Laptop)
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.waitForTimeout(500);
        await takeShot('B_RESPONSIVE_01_step3_archive_laptop_1366x768', 'Адаптивность: архивный Шаг 3 на ноутбуке 1366x768');
        metrics.scenarios.responsive_1366 = await inspectModalDom('responsive_1366');

        // Viewport 1024x768 (Compact)
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.waitForTimeout(500);
        await takeShot('B_RESPONSIVE_02_step3_archive_compact_1024x768', 'Адаптивность: архивный Шаг 3 на компактном экране 1024x768');

        // Save metrics
        fs.writeFileSync(path.join(REPORT_DIR, 'metrics.json'), JSON.stringify(metrics, null, 2), 'utf8');
        console.log('[Audit Block B] Audit completed successfully! Metrics saved.');

    } catch (err) {
        console.error('[Audit Block B] Error during audit run:', err);
        throw err;
    } finally {
        await browser.close();
    }
}

runBlockBAudit().then(() => {
    console.log('[Audit Block B] Process exited cleanly.');
    process.exit(0);
}).catch((err) => {
    console.error('[Audit Block B] Process failed:', err);
    process.exit(1);
});
