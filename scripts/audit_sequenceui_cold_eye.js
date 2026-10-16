const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const AUDIT_URL = `${BASE_URL}/SequenceUI/audit.html`;
const REPORT_DIR = path.resolve(__dirname, '..', 'reports', 'sequenceui_cold_eye_audit');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Heavy stress clinical algorithm payload (ALS / ERC 2025 guidelines)
const HEAVY_STRESS_TASK = {
    task_data: {
        content: {
            prompt: "Клинический стресс-алгоритм: Расширенная сердечно-легочная реанимация (ALS) при фибрилляции желудочков и желудочковой тахикардии без пульса",
            elements: [
                { id: "step_1", text: "Подтверждение остановки кровообращения, вызов реанимационной бригады и начало непрерывных компрессий 30:2 с минимизацией пауз" },
                { id: "step_2", text: "Подключение дефибриллятора / монитора, оценка ритма: подтверждение шокового ритма (ФЖ / ЖТ без пульса)" },
                { id: "step_3", text: "Набор заряда и нанесение первого разряда дефибриллятора (бифазный 150–200 Дж) с немедленным возобновлением СЛР на 2 минуты" },
                { id: "step_4", text: "Обеспечение венозного или внутрикостного доступа (в/в или в/к), подготовка адреналина 1 мг и амиодарона 300 мг" },
                { id: "step_5", text: "Оценка ритма через 2 минуты СЛР: сохранение шокового ритма, нанесение второго разряда и немедленное возобновление СЛР" },
                { id: "step_6", text: "Введение эпинефрина (адреналина) 1 мг в/в болюсно после третьего неэффективного разряда с повторением каждые 3–5 минут" },
                { id: "step_7", text: "Введение антиаритмика первого ряда: амиодарон 300 мг в/в болюсно после третьего разряда (при рефрактерной ФЖ/ЖТ)" },
                { id: "step_8", text: "Протекция дыхательных путей (надгортанный воздуховод или эндотрахеальная интубация с капнографией EtCO2)" },
                { id: "step_9", text: "Идентификация и коррекция обратимых причин остановки: 4Г (гипоксия, гиповолемия, гипо/гиперкалиемия, гипотермия)" },
                { id: "step_10", text: "Идентификация и коррекция обратимых причин: 4Т (тампонада сердца, токсины, напряженный пневмоторакс, тромбоэмболия)" },
            ],
            levels: [
                { level_id: "lvl_1", label: "Фаза 1: Первичная дефибрилляция и базовый доступ", blocks: ["slot_1", "slot_2"] },
                { level_id: "lvl_2", label: "Фаза 2: Второй цикл СЛР и подготовка фармакотерапии", blocks: ["slot_3", "slot_4"] },
                { level_id: "lvl_3", label: "Фаза 3: Введение адреналина и антиаритмика", blocks: ["slot_5", "slot_6"] },
                { level_id: "lvl_4", label: "Фаза 4: Расширенное управление дыхательными путями", blocks: ["slot_7", "slot_8"] },
                { level_id: "lvl_5", label: "Фаза 5: Поиск и устранение обратимых причин (4Г / 4Т)", blocks: ["slot_9", "slot_10"] },
            ],
            settings: {
                difficulty: 1,
                level_order_matters: true,
                sequence_within_level_matters: true,
                shuffle_elements: false,
            },
        },
    },
};

// Task with duplicate elements for badge checking
const DUPLICATES_TASK = {
    task_data: {
        content: {
            prompt: "Распределение лекарственных препаратов и растворов по этапам инфузионной терапии",
            elements: [
                { id: "drug_1_a", text: "Раствор натрия хлорида 0.9% 500 мл" },
                { id: "drug_1_b", text: "Раствор натрия хлорида 0.9% 500 мл" },
                { id: "drug_2_a", text: "Раствор глюкозы 5% 400 мл" },
                { id: "drug_2_b", text: "Раствор глюкозы 5% 400 мл" },
                { id: "drug_3", text: "Раствор Рингера лактат 500 мл" },
            ],
            levels: [
                { level_id: "lvl_1", label: "Начальная регидратация", blocks: ["slot_1", "slot_2"] },
                { level_id: "lvl_2", label: "Поддерживающая инфузия", blocks: ["slot_3", "slot_4"] },
            ],
            settings: {
                difficulty: 1,
                level_order_matters: true,
                sequence_within_level_matters: false,
                shuffle_elements: false,
            },
        },
    },
};

async function runHeadlessAssertions(page) {
    return await page.evaluate(() => {
        const results = {
            truncations: [],
            aabOverlaps: [],
            silentClips: [],
            antiGlueGaps: [],
            antiPhantomCss: [],
        };

        // 1. Zero-Truncation Assertion
        const textElements = document.querySelectorAll(
            '[data-sequenceui="available-item"], [data-sequenceui-placed-item="true"], h1, h2, h3, button, [data-sequenceui="available-duplicate-count"]'
        );
        textElements.forEach((el) => {
            // Check only visible elements
            if (el.offsetWidth > 0 && el.offsetHeight > 0) {
                // If it's line-clamped by intention, title must exist
                const isLineClamped = el.classList.contains('line-clamp-3') || el.querySelector('.line-clamp-3');
                if (isLineClamped) {
                    const textNode = el.querySelector('.line-clamp-3') || el;
                    if (!textNode.title && !el.title && !el.getAttribute('aria-label')) {
                        results.truncations.push({
                            selector: el.tagName + '.' + el.className.split(' ').slice(0, 2).join('.'),
                            text: el.textContent.trim().slice(0, 40),
                            reason: 'Line-clamp without descriptive title/aria-label',
                        });
                    }
                } else if (el.scrollWidth > el.offsetWidth + 2) {
                    results.truncations.push({
                        selector: el.tagName + '.' + el.className.split(' ').slice(0, 2).join('.'),
                        text: el.textContent.trim().slice(0, 40),
                        scrollWidth: el.scrollWidth,
                        offsetWidth: el.offsetWidth,
                    });
                }
            }
        });

        // 2. No-Overlap Collision Assertion (AABB) between placed items and slots
        const placedItems = Array.from(document.querySelectorAll('[data-sequenceui-placed-item="true"]'));
        for (let i = 0; i < placedItems.length; i++) {
            for (let j = i + 1; j < placedItems.length; j++) {
                const r1 = placedItems[i].getBoundingClientRect();
                const r2 = placedItems[j].getBoundingClientRect();
                const overlap = !(
                    r1.right <= r2.left ||
                    r1.left >= r2.right ||
                    r1.bottom <= r2.top ||
                    r1.top >= r2.bottom
                );
                if (overlap) {
                    results.aabOverlaps.push({
                        item1: placedItems[i].dataset.sequenceuiElementId,
                        item2: placedItems[j].dataset.sequenceuiElementId,
                    });
                }
            }
        }

        // 3. Silent-Clipping DOM Scanner
        const overflowContainers = Array.from(document.querySelectorAll('*')).filter((el) => {
            const cs = window.getComputedStyle(el);
            return (
                (cs.overflowY === 'hidden' || cs.overflow === 'hidden') &&
                el.offsetHeight > 40 &&
                el.offsetWidth > 100
            );
        });

        overflowContainers.forEach((container) => {
            if (container.scrollHeight > container.clientHeight + 2) {
                // If container has hidden overflow and its scrollHeight exceeds clientHeight, content is clipped
                results.silentClips.push({
                    tagName: container.tagName,
                    className: container.className.slice(0, 60),
                    scrollHeight: container.scrollHeight,
                    clientHeight: container.clientHeight,
                });
            }
        });

        // 4. Anti-Glue & Vertical Rhythm
        const levels = Array.from(document.querySelectorAll('[data-sequenceui-level-id]'));
        for (let i = 0; i < levels.length - 1; i++) {
            const r1 = levels[i].getBoundingClientRect();
            const r2 = levels[i + 1].getBoundingClientRect();
            const gap = r2.top - r1.bottom;
            if (gap < 8) {
                results.antiGlueGaps.push({
                    level1: levels[i].getAttribute('data-sequenceui-level-id'),
                    level2: levels[i + 1].getAttribute('data-sequenceui-level-id'),
                    gap,
                });
            }
        }

        // 5. Anti-Phantom-CSS
        const sampleAvailable = document.querySelector('.seq-available-item');
        if (sampleAvailable) {
            const cs = window.getComputedStyle(sampleAvailable);
            if (cs.cursor !== 'grab' && cs.cursor !== 'pointer') {
                results.antiPhantomCss.push({
                    class: '.seq-available-item',
                    expected: 'cursor: grab',
                    actual: cs.cursor,
                });
            }
        }

        return results;
    });
}

async function captureMicroCrop(page, clipRect, outputPath) {
    if (!clipRect || clipRect.width <= 0 || clipRect.height <= 0) return false;
    // Add 12px padding around clip
    const pad = 12;
    const x = Math.max(0, clipRect.x - pad);
    const y = Math.max(0, clipRect.y - pad);
    const width = Math.min(1280 - x, clipRect.width + pad * 2);
    const height = Math.min(800 - y, clipRect.height + pad * 2);

    await page.screenshot({
        path: outputPath,
        clip: { x, y, width, height },
    });
    return true;
}

async function main() {
    console.log(`[Audit] Starting Cold-Eye Visual Gate on ${AUDIT_URL}...`);
    ensureDir(REPORT_DIR);

    const dir800 = path.join(REPORT_DIR, '1280x800');
    const dir720 = path.join(REPORT_DIR, '1280x720');
    const dirCrops = path.join(REPORT_DIR, 'micro_crops');
    ensureDir(dir800);
    ensureDir(dir720);
    ensureDir(dirCrops);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const assertionAuditLog = [];

    try {
        // =========================================================================
        // VIEWPORT 1: 1280x800
        // =========================================================================
        console.log(`[Audit] === Testing 1280x800 Viewport ===`);
        const context800 = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            deviceScaleFactor: 1,
        });
        const login800 = await context800.request.post(`${BASE_URL}/api/auth/login`, {
            data: { identifier: 'devuser', password: 'password123' },
        });
        console.log(`[Audit] 1280x800 Login status: ${login800.status()}`);

        const page = await context800.newPage();

        // 1. Scenario 01: Idle Blank
        await page.goto(AUDIT_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-sequenceui="available-sidebar"]', { timeout: 15000 });
        await page.waitForTimeout(500);

        const idle800Path = path.join(dir800, '01_idle_blank.png');
        await page.screenshot({ path: idle800Path, fullPage: false });
        console.log(`[Audit] Saved: ${idle800Path}`);

        let assertions = await runHeadlessAssertions(page);
        assertionAuditLog.push({ scenario: '01_idle_blank_800p', assertions });

        // 2. Scenario 02: Active Drag Available -> Hover over Slot
        const firstAvailable = await page.$('[data-sequenceui="available-item"]');
        const firstSlot = await page.$('[data-sequenceui-slot="true"]');
        const availBox = await firstAvailable.boundingBox();
        const slotBox = await firstSlot.boundingBox();

        // Perform pointer down on available item, move towards slot
        await page.mouse.move(availBox.x + availBox.width / 2, availBox.y + availBox.height / 2);
        await page.mouse.down();
        // Move > 4px to trigger drag controller
        await page.mouse.move(slotBox.x + slotBox.width / 2, slotBox.y + slotBox.height / 2, { steps: 8 });
        await page.waitForTimeout(150);

        const activeDragPath = path.join(dir800, '02_active_drag_available.png');
        await page.screenshot({ path: activeDragPath, fullPage: false });
        console.log(`[Audit] Saved: ${activeDragPath}`);

        // Micro-crop: Drag Avatar & Slot Hover
        const dragAvatarEl = await page.$('.fixed.z-\\[999999\\]');
        if (dragAvatarEl) {
            const avatarBox = await dragAvatarEl.boundingBox();
            await captureMicroCrop(page, avatarBox, path.join(dirCrops, 'crop_drag_avatar.png'));
        }
        await captureMicroCrop(page, slotBox, path.join(dirCrops, 'crop_slot_hover.png'));

        // Drop into slot
        await page.mouse.up();
        await page.waitForTimeout(300);

        // 3. Scenario 03: Partially Placed & Slot-to-Slot Swap
        // Place second item into slot 1
        const secondAvailable = await page.$('[data-sequenceui="available-item"]');
        const secondSlot = await page.$('[data-sequenceui-slot="true"][data-sequenceui-slot-idx="0"]'); // in level 2 or next slot
        if (secondAvailable && secondSlot) {
            const bAvail = await secondAvailable.boundingBox();
            const bSlot = await secondSlot.boundingBox();
            await page.mouse.move(bAvail.x + bAvail.width / 2, bAvail.y + bAvail.height / 2);
            await page.mouse.down();
            await page.mouse.move(bSlot.x + bSlot.width / 2, bSlot.y + bSlot.height / 2, { steps: 8 });
            await page.mouse.up();
            await page.waitForTimeout(300);
        }

        const partialPath = path.join(dir800, '03_partially_placed_and_slot_swap.png');
        await page.screenshot({ path: partialPath, fullPage: false });
        console.log(`[Audit] Saved: ${partialPath}`);

        assertions = await runHeadlessAssertions(page);
        assertionAuditLog.push({ scenario: '03_partially_placed_800p', assertions });

        // Micro-crop: Placed Boundary
        const placedEl = await page.$('[data-sequenceui-placed-item="true"]');
        if (placedEl) {
            const placedBox = await placedEl.boundingBox();
            await captureMicroCrop(page, placedBox, path.join(dirCrops, 'crop_placed_boundary.png'));
        }

        // 4. Scenario 04: Drag to Sidebar (Return)
        const placedToReturn = await page.$('[data-sequenceui-placed-item="true"]');
        const sidebarEl = await page.$('[data-sequenceui="available-sidebar"]');
        if (placedToReturn && sidebarEl) {
            const pBox = await placedToReturn.boundingBox();
            const sBox = await sidebarEl.boundingBox();
            await page.mouse.move(pBox.x + pBox.width / 2, pBox.y + pBox.height / 2);
            await page.mouse.down();
            await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2, { steps: 8 });
            await page.mouse.up();
            await page.waitForTimeout(300);
        }

        const returnedPath = path.join(dir800, '04_drag_to_sidebar.png');
        await page.screenshot({ path: returnedPath, fullPage: false });
        console.log(`[Audit] Saved: ${returnedPath}`);

        // 5. Scenario 05: Heavy Stress Payload (Wall of Text & 10 steps)
        await page.evaluate((stressTask) => {
            window.renderSequenceTask(stressTask);
        }, HEAVY_STRESS_TASK);
        await page.waitForTimeout(300);

        const stress800Path = path.join(dir800, '05_heavy_stress_payload.png');
        await page.screenshot({ path: stress800Path, fullPage: false });
        console.log(`[Audit] Saved: ${stress800Path}`);

        assertions = await runHeadlessAssertions(page);
        assertionAuditLog.push({ scenario: '05_heavy_stress_payload_800p', assertions });

        // Micro-crop: Inter-level gap
        const levels = await page.$$('[data-sequenceui-level-id]');
        if (levels.length >= 2) {
            const l1 = await levels[0].boundingBox();
            const l2 = await levels[1].boundingBox();
            const gapBox = {
                x: l1.x,
                y: l1.y + l1.height - 10,
                width: l1.width,
                height: (l2.y - (l1.y + l1.height)) + 20,
            };
            await captureMicroCrop(page, gapBox, path.join(dirCrops, 'crop_inter_level_gap.png'));
        }

        // 6. Scenario 06: Duplicates Badge Check
        await page.evaluate((dupTask) => {
            window.renderSequenceTask(dupTask);
        }, DUPLICATES_TASK);
        await page.waitForTimeout(300);

        const dupBadge = await page.$('[data-sequenceui="available-duplicate-count"]');
        if (dupBadge) {
            const badgeBox = await dupBadge.boundingBox();
            await captureMicroCrop(page, badgeBox, path.join(dirCrops, 'crop_duplicate_badge.png'));
        }

        await context800.close();

        // =========================================================================
        // VIEWPORT 2: 1280x720 (Compact Laptop Fold)
        // =========================================================================
        console.log(`[Audit] === Testing 1280x720 Viewport (Compact Fold) ===`);
        const context720 = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            deviceScaleFactor: 1,
        });
        const login720 = await context720.request.post(`${BASE_URL}/api/auth/login`, {
            data: { identifier: 'devuser', password: 'password123' },
        });
        console.log(`[Audit] 1280x720 Login status: ${login720.status()}`);

        const page720 = await context720.newPage();

        await page720.goto(AUDIT_URL, { waitUntil: 'domcontentloaded' });
        await page720.waitForSelector('[data-sequenceui="available-sidebar"]', { timeout: 15000 });
        await page720.waitForTimeout(500);

        const idle720Path = path.join(dir720, '01_idle_blank_720p.png');
        await page720.screenshot({ path: idle720Path, fullPage: false });
        console.log(`[Audit] Saved: ${idle720Path}`);

        assertions = await runHeadlessAssertions(page720);
        assertionAuditLog.push({ scenario: '01_idle_blank_720p', assertions });

        // Heavy stress on 720p
        await page720.evaluate((stressTask) => {
            window.renderSequenceTask(stressTask);
        }, HEAVY_STRESS_TASK);
        await page720.waitForTimeout(300);

        const stress720Path = path.join(dir720, '05_heavy_stress_payload_720p.png');
        await page720.screenshot({ path: stress720Path, fullPage: false });
        console.log(`[Audit] Saved: ${stress720Path}`);

        assertions = await runHeadlessAssertions(page720);
        assertionAuditLog.push({ scenario: '05_heavy_stress_payload_720p', assertions });

        // Worst-case geometry: bottom slot near fold
        const lowestSlot = await page720.$('[data-sequenceui-level-id="lvl_5"]');
        if (lowestSlot) {
            const box = await lowestSlot.boundingBox();
            await captureMicroCrop(page720, box, path.join(dir720, '06_worst_case_geometry_720p.png'));
        }

        await context720.close();

    } finally {
        await browser.close();
    }

    // Write audit assertion results
    const summaryJsonPath = path.join(REPORT_DIR, 'audit_summary.json');
    fs.writeFileSync(summaryJsonPath, JSON.stringify(assertionAuditLog, null, 2), 'utf8');
    console.log(`[Audit] Headless assertion log saved to: ${summaryJsonPath}`);

    // Generate markdown summary
    const mdLines = [
        '# SequenceUI Cold-Eye Visual Audit — Phase 1 & 2 Results',
        '',
        `**Execution Date:** ${new Date().toISOString()}`,
        `**Target URL:** ${AUDIT_URL}`,
        '',
        '## 1. Headless Assertions Summary',
        '',
        '| Scenario | Truncations | AABB Overlaps | Silent Clips | Rhythm Gaps (<8px) | Phantom CSS Issues |',
        '|---|---|---|---|---|---|',
    ];

    assertionAuditLog.forEach((entry) => {
        const a = entry.assertions;
        mdLines.push(
            `| \`${entry.scenario}\` | ${a.truncations.length} | ${a.aabOverlaps.length} | ${a.silentClips.length} | ${a.antiGlueGaps.length} | ${a.antiPhantomCss.length} |`
        );
    });

    mdLines.push('');
    mdLines.push('## 2. Generated Screenshots & Micro-Crops');
    mdLines.push('');
    mdLines.push('### 1280x800 Viewport');
    mdLines.push('- `reports/sequenceui_cold_eye_audit/1280x800/01_idle_blank.png`');
    mdLines.push('- `reports/sequenceui_cold_eye_audit/1280x800/02_active_drag_available.png`');
    mdLines.push('- `reports/sequenceui_cold_eye_audit/1280x800/03_partially_placed_and_slot_swap.png`');
    mdLines.push('- `reports/sequenceui_cold_eye_audit/1280x800/04_drag_to_sidebar.png`');
    mdLines.push('- `reports/sequenceui_cold_eye_audit/1280x800/05_heavy_stress_payload.png`');
    mdLines.push('');
    mdLines.push('### 1280x720 Viewport');
    mdLines.push('- `reports/sequenceui_cold_eye_audit/1280x720/01_idle_blank_720p.png`');
    mdLines.push('- `reports/sequenceui_cold_eye_audit/1280x720/05_heavy_stress_payload_720p.png`');
    mdLines.push('- `reports/sequenceui_cold_eye_audit/1280x720/06_worst_case_geometry_720p.png`');
    mdLines.push('');
    mdLines.push('### Micro-Crop Matrix');
    mdLines.push('- `reports/sequenceui_cold_eye_audit/micro_crops/crop_drag_avatar.png`');
    mdLines.push('- `reports/sequenceui_cold_eye_audit/micro_crops/crop_slot_hover.png`');
    mdLines.push('- `reports/sequenceui_cold_eye_audit/micro_crops/crop_placed_boundary.png`');
    mdLines.push('- `reports/sequenceui_cold_eye_audit/micro_crops/crop_inter_level_gap.png`');
    mdLines.push('- `reports/sequenceui_cold_eye_audit/micro_crops/crop_duplicate_badge.png`');

    const summaryMdPath = path.join(REPORT_DIR, 'audit_summary.md');
    fs.writeFileSync(summaryMdPath, mdLines.join('\n'), 'utf8');
    console.log(`[Audit] Markdown summary saved to: ${summaryMdPath}`);
    console.log(`[Audit] Cold-Eye Visual Audit Phase 1 & 2 completed successfully.`);
}

main().catch((err) => {
    console.error(`[Audit Error]`, err);
    process.exit(1);
});
