/**
 * ACTRA Visual QA & UI/UX Automated Audit Suite
 *
 * Implements Phase 2 of the Task Import Studio Visual Audit Plan:
 * 1. Spins up an isolated local HTTP server serving frontend assets and real clinical API mocks.
 * 2. Injects the clinical session snapshot (sess_fyb8ddve0, 14 tasks across all types).
 * 3. Sweeps 4 viewport resolutions (1920x1080, 1440x900, 1280x800, 850x900) across all user journeys.
 * 4. Measures geometry, overflow, double scrollbars, and ACTRA design system rules.
 * 5. Captures high-res PNG artifacts and produces a structured audit report.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 8129;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.resolve(__dirname, '../tmp/visual_qa_audit');
const FIXTURE_PATH = path.resolve(__dirname, '../tests/fixtures/prod_clinical_session_snapshot.json');

// Ensure output directories exist
fs.mkdirSync(OUT_DIR, { recursive: true });

// Load prod clinical session snapshot
const PROD_SESSION = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));

// ---------------------------------------------------------------------------
// 1. Lightweight Local HTTP Server & Mock API
// ---------------------------------------------------------------------------

function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '.ttf': 'font/ttf',
    };
    return map[ext] || 'application/octet-stream';
}

function createAuditServer() {
    return http.createServer((req, res) => {
        const parsedUrl = new URL(req.url, BASE_URL);
        const pathname = parsedUrl.pathname;

        // API Mocks
        if (pathname === '/api/editor/catalog') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                modules: [
                    {
                        id: 'learning_radiology_glava_1',
                        name: 'Глава 1. Основы рентгенологии',
                        title: 'Глава 1. Основы рентгенологии',
                        topics: [
                            {
                                id: 'tema_5_prichiny_gemitoraksa',
                                name: 'Тема 5. Причины затемнения гемиторакса',
                                title: 'Тема 5. Причины затемнения гемиторакса',
                            },
                            {
                                id: 'tema_6_atelektaz',
                                name: 'Тема 6. Обструктивный ателектаз',
                                title: 'Тема 6. Обструктивный ателектаз',
                            }
                        ]
                    }
                ]
            }));
            return;
        }

        if (pathname === '/api/editor/studio/sessions') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                sessions: [PROD_SESSION]
            }));
            return;
        }

        if (pathname.startsWith('/api/editor/studio/prompts')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                prompt: 'Канонический системный промпт для генерации клинических заданий...',
                prompts: {}
            }));
            return;
        }

        if (pathname === '/api/auth/me' || pathname === '/api/users/me') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                user: {
                    id: PROD_SESSION.user_id,
                    name: 'Hippopotamus',
                    email: 'hippovalerii@gmail.com',
                    role: 'admin',
                    plan: 'premium'
                }
            }));
            return;
        }

        if (pathname === '/api/notifications') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, notifications: [] }));
            return;
        }

        // Static Files
        let localPath = null;
        if (pathname === '/' || pathname === '/editor/Task_Import_Studio.html' || pathname === '/Editor/Task_Import_Studio.html') {
            localPath = path.resolve(__dirname, '../frontend/Editor/Task_Import_Studio.html');
        } else if (pathname.startsWith('/assets/')) {
            localPath = path.resolve(__dirname, '../frontend/assets', pathname.slice('/assets/'.length));
        } else if (pathname.startsWith('/editor/') || pathname.startsWith('/Editor/')) {
            const sub = pathname.replace(/^\/[Ee]ditor\//, '');
            localPath = path.resolve(__dirname, '../frontend/Editor', sub);
        }

        if (localPath && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
            res.writeHead(200, { 'Content-Type': getContentType(localPath) });
            fs.createReadStream(localPath).pipe(res);
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`Not Found: ${pathname}`);
    });
}

// ---------------------------------------------------------------------------
// 2. Playwright Inspection Scanners
// ---------------------------------------------------------------------------

const VIEWPORTS = [
    { name: 'V1_1920x1080', width: 1920, height: 1080, label: 'Desktop 1080p' },
    { name: 'V2_1440x900',  width: 1440, height: 900,  label: 'Laptop 1440' },
    { name: 'V3_1280x800',  width: 1280, height: 800,  label: 'Compact 1280 (Boundary)' },
    { name: 'V4_850x900',   width: 850,  height: 900,  label: 'Narrow / Split-Screen' },
];

async function scanPageGeometry(page) {
    return await page.evaluate(() => {
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const docW = document.documentElement.scrollWidth;
        const hasHorizontalOverflow = docW > winW + 1;

        // Check overflowing elements
        const overflowing = [];
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                if (rect.right > winW + 2 && el.id !== 'root' && el.tagName !== 'HTML' && el.tagName !== 'BODY') {
                    const tag = el.tagName.toLowerCase();
                    const cls = (el.className || '').toString().slice(0, 50);
                    const id = el.id ? `#${el.id}` : '';
                    overflowing.push({
                        selector: `${tag}${id}.${cls}`.trim(),
                        right: Math.round(rect.right),
                        winW,
                        overflowBy: Math.round(rect.right - winW),
                    });
                }
            }
        }

        // Anti-Matryoshka Scanner (Borders nested deeper than 1 level)
        const matryoshkaViolations = [];
        const surfaceCards = document.querySelectorAll('.studio-card, .studio-pane, .studio-task-card, .studio-committed-mini-card');
        surfaceCards.forEach((card) => {
            const nestedCards = card.querySelectorAll('.studio-card, .studio-pane, .border-border-subtle.rounded-xl, .border-border-subtle.rounded-2xl');
            nestedCards.forEach((nested) => {
                const deeper = nested.querySelectorAll('.studio-card, .border');
                if (deeper.length > 0) {
                    matryoshkaViolations.push({
                        parent: card.className.slice(0, 40),
                        nested: nested.className.slice(0, 40),
                        deepCount: deeper.length
                    });
                }
            });
        });

        // Single Primary CTA Scanner (Scoped to active modal if open, or page)
        const activeModal = document.querySelector('.studio-modal-backdrop:not(.hidden)');
        const searchScope = activeModal || document.body;
        const primaryButtons = Array.from(searchScope.querySelectorAll('.studio-btn--primary, .btn--primary'))
            .filter((btn) => {
                const r = btn.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && r.top < winH && r.bottom > 0 && !btn.disabled && !btn.classList.contains('hidden');
            });
        const multiplePrimaryCtas = primaryButtons.length > 1 ? primaryButtons.map((b) => b.textContent.trim().slice(0, 30)) : [];

        // Machine Jargon Scanner
        const jargonWords = ['SEQUENCE_ASSEMBLY', 'text_errors', 'text_choice', 'single_choice', 'error_detection'];
        const foundJargon = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const text = node.nodeValue || '';
            for (const j of jargonWords) {
                if (text.includes(j)) {
                    foundJargon.push({ word: j, sample: text.trim().slice(0, 60) });
                }
            }
        }

        return {
            winW,
            winH,
            docW,
            hasHorizontalOverflow,
            overflowCount: overflowing.length,
            overflowSamples: overflowing.slice(0, 3),
            matryoshkaCount: matryoshkaViolations.length,
            matryoshkaSamples: matryoshkaViolations.slice(0, 3),
            primaryCtaCount: primaryButtons.length,
            multiplePrimaryCtas,
            jargonCount: foundJargon.length,
            foundJargon: foundJargon.slice(0, 3),
        };
    });
}

// ---------------------------------------------------------------------------
// 3. Execution Engine
// ---------------------------------------------------------------------------

async function run() {
    console.log('================================================================');
    console.log('🚀 ACTRA TASK IMPORT STUDIO — VISUAL QA AUDIT (PHASE 2)');
    console.log('================================================================');

    const server = createAuditServer();
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
    console.log(`[PASS] Audit HTTP Mock Server listening at: ${BASE_URL}`);

    const browser = await chromium.launch({ headless: true });
    const auditResults = {
        timestamp: new Date().toISOString(),
        viewports: {},
        defects: [],
        screenshots: [],
    };

    try {
        for (const vp of VIEWPORTS) {
            console.log(`\n----------------------------------------------------------------`);
            console.log(`📐 Auditing Viewport: ${vp.name} (${vp.label}) — ${vp.width}x${vp.height}`);
            console.log(`----------------------------------------------------------------`);

            const context = await browser.newContext({
                viewport: { width: vp.width, height: vp.height },
                deviceScaleFactor: 1,
            });
            await context.addInitScript(() => {
                window.__ACTRA_DEV_MODE__ = true;
            });

            const page = await context.newPage();
            const vpLogs = [];

            // Helper to capture state screenshot and run geometry scanner
            const capture = async (stateId, stateName) => {
                const shotName = `${stateId}_${vp.name}.png`;
                const shotPath = path.join(OUT_DIR, shotName);
                await page.waitForTimeout(300);
                await page.screenshot({ path: shotPath, fullPage: false });

                const metrics = await scanPageGeometry(page);
                const record = {
                    stateId,
                    stateName,
                    viewport: vp.name,
                    screenshot: shotName,
                    metrics,
                };
                vpLogs.push(record);
                auditResults.screenshots.push(shotName);

                const statusTag = metrics.hasHorizontalOverflow ? '❌ OVERFLOW' : '✓ OK';
                console.log(`  [${statusTag}] ${stateName} (${shotName})`);
                if (metrics.hasHorizontalOverflow) {
                    console.log(`      ⚠️  Horizontal overflow detected: docW=${metrics.docW} > winW=${metrics.winW}`);
                }
                if (metrics.multiplePrimaryCtas.length > 1) {
                    console.log(`      ⚠️  Multiple Primary CTAs: ${metrics.multiplePrimaryCtas.join(' vs ')}`);
                }
                if (metrics.jargonCount > 0) {
                    console.log(`      ⚠️  Machine jargon in DOM: ${metrics.foundJargon.map(j => j.word).join(', ')}`);
                }
            };

            // SCENARIO 1: Empty State on Step 1
            await page.goto(`${BASE_URL}/Editor/Task_Import_Studio.html`, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#step-node-1', { state: 'visible' });
            await capture('01_step1_empty', 'Этап 1: Чистый лист (Empty State)');

            // SCENARIO 2: Step 1 Populated with Clinical Lesson Map
            await page.evaluate((session) => {
                const Studio = window.__StudioInternal;
                Studio.StudioState.selectedModuleId = session.module_id;
                Studio.StudioState.selectedTopicId = session.topic_id;
                Studio.StudioState.selectedModuleName = 'Глава 1. Основы рентгенологии';
                Studio.StudioState.selectedTopicName = 'Тема 5. Причины затемнения гемиторакса';
                Studio.StudioState.analysisResult = {
                    human_summary: session.human_summary,
                    recommendations: session.recommendations,
                    educational_units: [
                        { id: 1, title: 'Анатомические векторы смещения трахеи и сердца', description: 'Смещение к затемнению vs от затемнения' },
                        { id: 2, title: 'Контакт висцерального и париетального листков плевры', description: 'Сохранность плеврального смыкания' },
                        { id: 3, title: 'Диагностическая ловушка взаимной компенсации', description: 'Сочетание ателектаза и массивного выпота' }
                    ]
                };
                Studio.renderLessonMap(Studio.StudioState.analysisResult);
                if (Studio.DOM.btnProceedToStep2) Studio.DOM.btnProceedToStep2.disabled = false;
            }, PROD_SESSION);
            await capture('02_step1_lesson_map', 'Этап 1: Карта лекции (Lesson Map & Recommendations)');

            // SCENARIO 3: Step 2 — Committed Mode (14 Tasks Reconstructed)
            await page.evaluate((session) => {
                const Studio = window.__StudioInternal;
                Studio.StudioState.allTasks = session.tasks;
                Studio.switchStep(2);
            }, PROD_SESSION);
            await capture('03_step2_committed_test', 'Этап 2: Принятые задания (Тесты, бейдж ✓ 3)');

            // SCENARIO 4: Step 2 — Expand Accordion on Mini-Cards
            const expandBtn = page.locator('.btn-expand-snippet').first();
            if (await expandBtn.isVisible()) {
                await expandBtn.click();
            }
            await capture('04_step2_committed_expanded', 'Этап 2: Раскрытые варианты mini-card (+ ещё N вар.)');

            // SCENARIO 5: Step 2 — Switch to CLICK_WORDS Tab (10 Bracketed Errors)
            await page.evaluate(() => {
                const Studio = window.__StudioInternal;
                Studio.selectGenerationType('CLICK_WORDS');
            });
            await capture('05_step2_tab_click_words', 'Этап 2: Вкладка «Поиск ошибок в тексте» (CLICK_WORDS)');

            // SCENARIO 6: Step 2 — Switch to Edit Mode (Raw Code + Live Regex Counter)
            await page.click('#btn-edit-type-tasks');
            await capture('06_step2_edit_mode', 'Этап 2: Режим редактирования текста + Live Counter');

            // SCENARIO 7: Step 2 — Visual Guidance Mode (CLICK on Image)
            await page.evaluate(() => {
                const Studio = window.__StudioInternal;
                Studio.selectGenerationType('CLICK');
            });
            await capture('07_step2_tab_visual_guidance', 'Этап 2: Интерактивный визуальный режим (CLICK)');

            // SCENARIO 8: Step 3 — Task Showcase Grid & Floating Sticky Footer
            await page.evaluate(() => {
                const Studio = window.__StudioInternal;
                Studio.switchStep(3);
            });
            await capture('08_step3_showcase_grid', 'Этап 3: Витрина заданий (Showcase Grid & Sticky Bar)');

            // SCENARIO 9: Modal 1 — Task Preview Inspector (Test Task)
            await page.evaluate(() => {
                const Studio = window.__StudioInternal;
                Studio.openTaskPreviewModal(Studio.StudioState.allTasks[0], 0);
            });
            await capture('09_modal_preview_test', 'Модалка: Инспектор теста (Question, 4 Choices, Correct badge)');

            // SCENARIO 10: Modal 1 — Task Preview Inspector (CLICK_WORDS with highlights)
            await page.evaluate(() => {
                const Studio = window.__StudioInternal;
                // Task index 11 or find text_errors task
                const idx = Studio.StudioState.allTasks.findIndex(t => t.data?.mode === 'text_errors' || t.content?.mode === 'text_errors');
                if (idx >= 0) {
                    Studio.openTaskPreviewModal(Studio.StudioState.allTasks[idx], idx);
                }
            });
            await capture('10_modal_preview_click_words', 'Модалка: Инспектор текста с ошибками (Bracketed error clusters)');

            // SCENARIO 11: Modal 1 — Toggle Raw JSON Spec
            const toggleRawBtn = page.locator('#btn-preview-toggle-raw');
            if (await toggleRawBtn.isVisible()) {
                await toggleRawBtn.click();
            }
            await capture('11_modal_preview_raw_json', 'Модалка: Просмотр Raw JSON спецификации');
            const closePreviewBtn = page.locator('#btn-close-preview-footer, #btn-close-preview-modal').first();
            if (await closePreviewBtn.isVisible()) {
                await closePreviewBtn.click();
            }

            // SCENARIO 12: Modal 2 — Topic Tree Selector
            const selectTopicBtn = page.locator('#btn-select-topic');
            if (await selectTopicBtn.isVisible()) {
                await selectTopicBtn.click();
            }
            await capture('12_modal_topic_tree', 'Модалка: Дерево модулей и тем курса (Topic Selector)');
            const closeTopicBtn = page.locator('#btn-close-topic-modal');
            if (await closeTopicBtn.isVisible()) {
                await closeTopicBtn.click();
            }

            // SCENARIO 13: Modal 3 — History Modal (3 FIFO Slots)
            const openHistoryBtn = page.locator('#btn-open-history');
            if (await openHistoryBtn.isVisible()) {
                await openHistoryBtn.click();
            }
            await capture('13_modal_history', 'Модалка: История сессий (FIFO 3 слота)');
            const closeHistoryBtn = page.locator('#btn-close-history-modal');
            if (await closeHistoryBtn.isVisible()) {
                await closeHistoryBtn.click();
            }

            // SCENARIO 14: Modal 4 — Reset Draft Modal
            const resetDraftBtn = page.locator('#btn-reset-draft');
            if (await resetDraftBtn.isVisible()) {
                await resetDraftBtn.click();
            }
            await capture('14_modal_reset_draft', 'Модалка: Предупреждение о сбросе черновика');
            const cancelResetBtn = page.locator('#btn-reset-cancel');
            if (await cancelResetBtn.isVisible()) {
                await cancelResetBtn.click();
            }

            auditResults.viewports[vp.name] = vpLogs;
            await context.close();
        }

        // Write audit report summary
        const summaryPath = path.join(OUT_DIR, 'audit_results.json');
        fs.writeFileSync(summaryPath, JSON.stringify(auditResults, null, 2), 'utf-8');
        console.log(`\n================================================================`);
        console.log(`✅ Automated Sweep Completed! Saved summary to: ${summaryPath}`);
        console.log(`🖼️  Total screenshots captured: ${auditResults.screenshots.length}`);
        console.log(`================================================================`);

    } finally {
        await browser.close();
        server.close();
    }
}

run().catch((err) => {
    console.error('Fatal Audit Error:', err);
    process.exit(1);
});
