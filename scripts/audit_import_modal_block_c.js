const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const REPORT_DIR = path.resolve(__dirname, '..', 'reports', 'import_modal_audit', 'block_c');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function runBlockCAudit() {
    ensureDir(REPORT_DIR);
    const screenshotsDir = path.join(REPORT_DIR, 'screenshots');
    ensureDir(screenshotsDir);

    console.log(`[Audit Block C] Starting audit on ${BASE_URL}...`);
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
        console.log('[Audit Block C] Logging in via /api/auth/login...');
        const loginRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
            data: {
                identifier: 'audit.user@actra.local',
                password: 'AuditPassword123!'
            }
        });
        console.log(`[Audit Block C] Login status: ${loginRes.status()}`);

        console.log('[Audit Block C] Navigating to /editor...');
        await page.goto(`${BASE_URL}/editor`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('[data-role="open-import-modal"]', { state: 'visible', timeout: 20000 });

        async function takeShot(name, description) {
            const shotPath = path.join(screenshotsDir, `${name}.png`);
            await page.screenshot({ path: shotPath, fullPage: false });
            console.log(`[Audit Block C] Screenshot captured: ${name}.png - ${description}`);
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
                    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
                        scrollableElements.push({
                            tag: el.tagName,
                            className: el.className,
                            scrollHeight: el.scrollHeight,
                            clientHeight: el.clientHeight
                        });
                    }
                });

                const primaryButtons = Array.from(modal.querySelectorAll('.btn--primary, .studio-btn--primary, [data-role="import-next"], .bg-primary'))
                    .filter(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';
                    })
                    .map(el => el.textContent.trim().replace(/\s+/g, ' '));

                const promptTextarea = document.querySelector('#ai-agent-prompt-textarea');
                const inputTextarea = document.querySelector('#import-text-area');

                return {
                    step: step,
                    maxBorderDepth: shell ? getMaxBorderDepth(shell) : 0,
                    scrollableContainersCount: scrollableElements.length,
                    scrollableContainers: scrollableElements,
                    hasNestedScroll: scrollableElements.length > 1,
                    primaryButtons: primaryButtons,
                    modalBox: shell ? shell.getBoundingClientRect() : null,
                    contentBox: content ? content.getBoundingClientRect() : null,
                    promptTextareaRows: promptTextarea ? promptTextarea.rows : null,
                    inputTextareaRows: inputTextarea ? inputTextarea.rows : null,
                };
            }, stepId);
        }

        // =========================================================================
        // SCENARIO C1: Шаг 1 — Режим «ИИ-генерация» и селекторы назначения
        // =========================================================================
        console.log('[Audit Block C] Executing Scenario C1: Step 1 AI mode...');
        await page.click('[data-role="open-import-modal"]');
        await page.waitForSelector('#import-modal[open]', { state: 'visible', timeout: 5000 });
        await page.waitForTimeout(400);

        // Click "ИИ-генерация"
        await page.click('[data-role="import-mode-ai"]');
        await page.waitForTimeout(400);

        metrics.scenarios['C1_initial'] = await inspectModalDom('C1_initial');
        await takeShot('C1_01_step1_ai_mode_selected', 'Режим ИИ-генерация выбран на Шаге 1');

        // Click "Далее" without selecting module/topic
        const nextBtn = page.locator('[data-role="import-next"]');
        await nextBtn.click();
        await page.waitForTimeout(600);
        metrics.scenarios['C1_no_selection'] = await inspectModalDom('C1_no_selection');
        await takeShot('C1_02_step1_ai_no_selection_warning', 'Клик Далее без выбора модуля и темы (предупреждение)');

        // Select module and topic
        await page.selectOption('#import-module-select', { index: 1 });
        await page.waitForTimeout(400);
        await page.selectOption('#import-topic-select', { index: 1 });
        await page.waitForTimeout(400);

        metrics.scenarios['C1_target_selected'] = await inspectModalDom('C1_target_selected');
        await takeShot('C1_03_step1_ai_target_selected', 'Модуль и тема выбраны');

        // =========================================================================
        // SCENARIO C2: Шаг 2 — Промпты, шаблоны и валидация
        // =========================================================================
        console.log('[Audit Block C] Executing Scenario C2: Step 2 Prompts & Templates...');
        await nextBtn.click();
        await page.waitForTimeout(600);

        metrics.scenarios['C2_open_answer'] = await inspectModalDom('C2_open_answer');
        await takeShot('C2_01_step2_ai_template_open_answer', 'Шаблон Открытый ответ по умолчанию');

        // Switch to sequence_assembly
        await page.selectOption('#ai-agent-template-type', 'sequence_assembly');
        await page.waitForTimeout(300);
        await takeShot('C2_02_step2_ai_template_sequence', 'Шаблон Последовательность');

        // Switch to test
        await page.selectOption('#ai-agent-template-type', 'test');
        await page.waitForTimeout(300);
        await takeShot('C2_03_step2_ai_template_test', 'Шаблон Тест');

        // Switch to click_text
        await page.selectOption('#ai-agent-template-type', 'click_text');
        await page.waitForTimeout(300);
        await takeShot('C2_04_step2_ai_template_click_text', 'Шаблон Клик / Выбор утверждений');

        // Switch to click_words
        await page.selectOption('#ai-agent-template-type', 'click_words');
        await page.waitForTimeout(300);
        await takeShot('C2_05_step2_ai_template_click_words', 'Шаблон Поиск ошибок в тексте');

        // Empty submit
        await nextBtn.click();
        await page.waitForTimeout(500);
        await takeShot('C2_06_step2_ai_empty_submit_warning', 'Попытка отправки пустого поля');

        // Syntax error submission
        await page.fill('#import-text-area', '@DRAW\n# Неподдерживаемый маркер\nПопытка импортировать неподдерживаемый маркер рисования');
        await page.waitForTimeout(300);
        await nextBtn.click();
        await page.waitForTimeout(800);
        metrics.scenarios['C2_syntax_error'] = await inspectModalDom('C2_syntax_error');
        await takeShot('C2_07_step2_ai_syntax_error', 'Синтаксическая ошибка разметки ИИ-ответа');

        // =========================================================================
        // SCENARIO C3: Шаг 2 -> Шаг 3 — Валидный AI-текст и предпросмотр заданий
        // =========================================================================
        console.log('[Audit Block C] Executing Scenario C3: Valid Multi-Task & Preview...');
        // Ensure we are back on Step 2 with clean state
        await page.evaluate(() => {
            dashboard.importManager.goToStep(2);
            dashboard.importManager.parsedResult = null;
            dashboard.importManager.renderCurrentStep();
        });
        await page.waitForTimeout(400);

        const validAiText = `@OPEN_ANSWER
# Диагностика инсулиномы у взрослых
Опишите пробу с 72-часовым голоданием и диагностические критерии гипогликемического синдрома.
==
Контроль гликемии, уровня С-пептида и инсулина в сыворотке каждые 6 часов. Тест прекращается при гликемии ниже 2.2 ммоль/л и наличии симптомов нейрогликопении.

@TEST
# Триада Уиппла при гипогликемии
? Какой критерий входит в классическую диагностическую триаду Уиппла?
+ Быстрое купирование симптомов после внутривенного введения глюкозы
- Стойкая артериальная гипертензия выше 160 мм рт. ст.
- Повышение уровня щелочной фосфатазы в сыворотке крови
- Снижение суточного диуреза менее 500 мл

@SEQUENCE
# Алгоритм купирования тяжелой гипогликемии
element_1: Оценка сознания и проходимости дыхательных путей
element_2: Внутривенное струйное введение 40% раствора глюкозы
element_3: Внутримышечное введение 1 мг глюкагона при невозможности венозного доступа
element_4: Повторный контроль гликемии через 15 минут
level_1: element_1
level_2: element_2
level_3: element_3
level_4: element_4`;

        await page.fill('#import-text-area', validAiText);
        await page.waitForTimeout(500); // Allow live counter debounce
        metrics.scenarios['C3_input'] = await inspectModalDom('C3_input');
        await takeShot('C3_01_step2_ai_valid_multi_task_input', 'Валидный многозадачный ответ нейросети введен');

        // Click Далее to advance to Step 3
        await nextBtn.click();
        await page.waitForTimeout(1000);
        metrics.scenarios['C3_preview'] = await inspectModalDom('C3_preview');
        await takeShot('C3_02_step3_ai_preview_full', 'Шаг 3: Полный предпросмотр сгенерированных заданий');

        // Inline edit task name
        const firstCardTitle = page.locator('h4[onclick*="startEditName"]').first();
        if (await firstCardTitle.count() > 0) {
            await firstCardTitle.click();
            await page.waitForTimeout(300);
            await takeShot('C3_03_step3_ai_task_inline_edit', 'Инлайн-редактирование названия задачи');
            // Press Escape to cancel edit
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
        }

        // Exclude one task
        const excludeBtn = page.locator('[data-task-exclude-btn="0"]').first();
        if (await excludeBtn.count() > 0) {
            await excludeBtn.click();
            await page.waitForTimeout(400);
            await takeShot('C3_04_step3_ai_task_excluded', 'Первое задание исключено из импорта');
        }

        // =========================================================================
        // SCENARIO C4: Шаг 4 (Подтверждение) и Material Analysis
        // =========================================================================
        console.log('[Audit Block C] Executing Scenario C4: Step 4 Confirmation & Material Analysis...');
        await nextBtn.click();
        await page.waitForTimeout(600);
        metrics.scenarios['C4_confirmation'] = await inspectModalDom('C4_confirmation');
        await takeShot('C4_01_step4_ai_confirmation_ready', 'Шаг 4: Подтверждение импорта заданий ИИ');

        // Test Material Analysis in Step 2
        console.log('[Audit Block C] Testing Material Analysis...');
        await page.evaluate(() => {
            dashboard.importManager.setModalPurpose('theory_analysis');
            dashboard.importManager.theorySubMode = 'analysis';
            dashboard.importManager.currentStep = 2;
            dashboard.importManager.aiTemplateType = 'material_analysis';
            dashboard.importManager.renderCurrentStep();
        });
        await page.waitForTimeout(500);

        // Fill with valid material analysis output
        const validMaterialAnalysis = `<human_summary>
Методический разбор темы "Эндокринология и патогенез инсулиномы":
Материал охватывает ключевые клинические проявления, диагностические критерии (триада Уиппла) и алгоритмы неотложной терапии гипогликемии. Рекомендуется использовать сочетание открытого ответа для глубокого разбора и тестов для контроля базовых симптомов.
</human_summary>
<analysis_json>
{
  "educational_units": [
    { "id": 1, "title": "Патогенез гипогликемического синдрома", "type": "process" },
    { "id": 2, "title": "Диагностические критерии триады Уиппла", "type": "fact" },
    { "id": 3, "title": "Купирование гипогликемической комы", "type": "process" }
  ],
  "recommendations": [
    { "task_type": "OPEN_ANSWER", "editor_label": "Открытый ответ", "covers_units": [1], "priority": "high", "count": 2, "rationale": "Развернутый клинический разбор" },
    { "task_type": "TEST", "editor_label": "Тест", "covers_units": [2], "priority": "medium", "count": 4, "rationale": "Проверка диагностических критериев" },
    { "task_type": "SEQUENCE", "editor_label": "Последовательность", "covers_units": [3], "priority": "high", "count": 1, "rationale": "Отработка алгоритма реанимационных действий" }
  ]
}
</analysis_json>`;

        await page.fill('#import-text-area', validMaterialAnalysis);
        await page.waitForTimeout(400);
        await takeShot('C4_02_step2_material_analysis_input', 'Ввод ответа анализа материала с XML-тегами');

        // Click action button to parse analysis
        await page.evaluate(async () => {
            await dashboard.importManager.handleNext();
        });
        await page.waitForTimeout(1000);
        metrics.scenarios['C4_material_analysis_parsed'] = await inspectModalDom('C4_material_analysis_parsed');
        await takeShot('C4_03_step2_material_analysis_coverage_map', 'Разобранный анализ материала: карта покрытия и рекомендации');

        // Test broken material analysis
        await page.evaluate(() => {
            dashboard.importManager.theorySubMode = 'analysis';
            dashboard.importManager.renderCurrentStep();
            dashboard.importManager.sourceText = '<human_summary>Обзор темы</human_summary><analysis_json>{\n  broken_json_without_quotes\n</analysis_json>';
            const ta = document.getElementById('import-text-area');
            if (ta) ta.value = dashboard.importManager.sourceText;
        });
        await page.evaluate(async () => {
            await dashboard.importManager.handleNext();
        });
        await page.waitForTimeout(800);
        await takeShot('C4_04_step2_material_analysis_parse_error', 'Ошибка разбора поврежденного анализа материала');

        // =========================================================================
        // RESPONSIVE SCENARIOS
        // =========================================================================
        console.log('[Audit Block C] Executing Responsive Scenarios...');
        // Reset to standard import mode
        await page.evaluate(() => {
            dashboard.importManager.setModalPurpose('import');
            dashboard.importManager.importMode = 'ai';
            dashboard.importManager.currentStep = 2;
            dashboard.importManager.aiTemplateType = 'open_answer';
            dashboard.importManager.sourceText = '';
            dashboard.importManager.parsedResult = null;
            dashboard.importManager.renderCurrentStep();
        });
        await page.waitForTimeout(400);

        // Laptop 1366x768
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.waitForTimeout(400);
        metrics.scenarios['responsive_1366_step2'] = await inspectModalDom('responsive_1366_step2');
        await takeShot('C_RESPONSIVE_01_step2_ai_laptop_1366x768', 'Шаг 2 ИИ-режима на экране ноутбука 1366x768');

        // Go to Step 3 on 1366x768
        await page.evaluate(async () => {
            dashboard.importManager.sourceText = `@OPEN_ANSWER\n# Задание 1\nВопрос\n==\nОтвет\n\n@TEST\n# Тест 1\n? Вопрос?\n+ Да\n- Нет`;
            await dashboard.importManager.handleNext();
        });
        await page.waitForTimeout(800);
        metrics.scenarios['responsive_1366_step3'] = await inspectModalDom('responsive_1366_step3');
        await takeShot('C_RESPONSIVE_02_step3_ai_preview_laptop_1366x768', 'Шаг 3 ИИ-режима на экране ноутбука 1366x768');

        // Tablet / Compact 1024x768
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.evaluate(() => {
            dashboard.importManager.goToStep(2);
            dashboard.importManager.sourceText = '';
            dashboard.importManager.renderCurrentStep();
        });
        await page.waitForTimeout(500);
        metrics.scenarios['responsive_1024_step2'] = await inspectModalDom('responsive_1024_step2');
        await takeShot('C_RESPONSIVE_03_step2_ai_compact_1024x768', 'Шаг 2 ИИ-режима на компактном экране 1024x768');

        // Save metrics
        fs.writeFileSync(path.join(REPORT_DIR, 'metrics.json'), JSON.stringify(metrics, null, 2), 'utf-8');
        console.log('[Audit Block C] Audit finished successfully. Metrics saved.');

    } catch (err) {
        console.error('[Audit Block C] Test failed with error:', err);
        throw err;
    } finally {
        await browser.close();
    }
}

runBlockCAudit().catch(err => {
    console.error('[Audit Block C] Fatal exit:', err);
    process.exit(1);
});
