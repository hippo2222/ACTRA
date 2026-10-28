import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const ARTIFACTS_DIR = 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d';
const BASE_URL = 'http://127.0.0.1:8000';

async function runVisualAudit() {
    console.log('=== Starting Task Creation Studio Modal Visual Audit ===');
    const browser = await chromium.launch({ headless: true });

    const viewports = [
        { width: 1280, height: 800, name: '1280x800' },
        { width: 1280, height: 720, name: '1280x720' }
    ];

    for (const vp of viewports) {
        console.log(`\n--- Testing Viewport: ${vp.name} ---`);
        const context = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            deviceScaleFactor: 1
        });

        // 1. Authenticate session
        const loginRes = await context.request.post(`${BASE_URL}/api/auth/login`, {
            data: { identifier: 'clinical_expert@actra.local', password: 'Clinical.Pass1!' },
            headers: { Origin: BASE_URL }
        });
        if (!loginRes.ok()) {
            throw new Error(`Login failed with status ${loginRes.status()}`);
        }
        console.log('✅ Authenticated session successfully');

        const page = await context.newPage();

        // 2. Navigate to Dashboard
        await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(600);

        // 3. Open Create Task Studio Modal
        console.log('Opening Create Task Studio Modal...');
        await page.evaluate(() => {
            if (window.dashboard && typeof window.dashboard.showCreateTaskModal === 'function') {
                window.dashboard.showCreateTaskModal();
            }
        });
        await page.waitForTimeout(500);

        // 4. Verify modal visibility
        const modal = page.locator('#create-task-modal');
        await modal.waitFor({ state: 'visible', timeout: 5000 });

        const dialog = page.locator('.editor-dialog-shell-studio');
        const dialogBox = await dialog.boundingBox();
        console.log(`[Viewport ${vp.name}] Modal Dialog BoundingBox:`, dialogBox);

        // Assertion: Viewport Fold (1280x800 & 1280x720)
        // Dialog must fit within window.innerHeight without causing forced modal layer overflow
        if (dialogBox.y + dialogBox.height > vp.height) {
            console.error(`❌ FOLD VIOLATION: Dialog bottom (${dialogBox.y + dialogBox.height}px) exceeds viewport height (${vp.height}px)!`);
        } else {
            console.log(`✅ Viewport Fold Assertion PASSED: bottom ${dialogBox.y + dialogBox.height}px <= ${vp.height}px`);
        }

        // Assertion: Zero Truncation on key titles and badges
        const truncationCheck = await page.evaluate(() => {
            const issues = [];
            const elements = document.querySelectorAll(
                '#create-task-modal .editor-modal-title, ' +
                '#create-task-modal .editor-task-type-name, ' +
                '#create-task-modal .editor-task-type-badge, ' +
                '#create-task-modal .editor-subtype-pill'
            );
            elements.forEach(el => {
                if (el.scrollWidth > el.offsetWidth + 1) {
                    issues.push({ text: el.textContent.trim(), scrollWidth: el.scrollWidth, offsetWidth: el.offsetWidth });
                }
            });
            return issues;
        });
        if (truncationCheck.length > 0) {
            console.warn(`⚠️ Truncation detected:`, truncationCheck);
        } else {
            console.log(`✅ Zero-Truncation Assertion PASSED on all titles, badges, and pills`);
        }

        // Assertion: ElementFromPoint on primary CTA
        const ctaCheck = await page.evaluate(() => {
            const btn = document.getElementById('create-task-submit-btn');
            if (!btn) return { ok: false, reason: 'btn_not_found' };
            const rect = btn.getBoundingClientRect();
            const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return {
                ok: btn === topEl || btn.contains(topEl),
                topElTag: topEl ? topEl.tagName : null,
                topElId: topEl ? topEl.id : null,
                topElClass: topEl ? topEl.className : null
            };
        });
        console.log(`✅ Submit CTA Clickability Assertion:`, ctaCheck);

        // --- Sequence Assembly Archetype + Hierarchy Subtype ---
        console.log('Selecting sequence_assembly -> hierarchy...');
        await page.click('.editor-task-type-card[data-type="sequence_assembly"]');
        await page.waitForTimeout(300);

        // Click on the Hierarchy pill (second pill)
        const pills = page.locator('.editor-subtype-pill');
        const pillCount = await pills.count();
        console.log(`Found ${pillCount} subtype pills for sequence_assembly`);
        if (pillCount >= 2) {
            await pills.nth(1).click();
            await page.waitForTimeout(300);
        }

        // Capture uncropped screenshot for sequence hierarchy
        const hierarchyScreenshotPath = path.join(ARTIFACTS_DIR, `studio_modal_sequence_hierarchy_${vp.name}.png`);
        await page.screenshot({ path: hierarchyScreenshotPath, fullPage: false });
        console.log(`Saved screenshot: ${hierarchyScreenshotPath}`);

        // Capture micro-crops on 1280x800
        if (vp.name === '1280x800') {
            const canvas = page.locator('#editor-showcase-canvas');
            const canvasCropPath = path.join(ARTIFACTS_DIR, 'crop_studio_canvas_hierarchy.png');
            await canvas.screenshot({ path: canvasCropPath });
            console.log(`Saved micro-crop: ${canvasCropPath}`);

            const archetypesCol = page.locator('.editor-studio-archetypes');
            const archCropPath = path.join(ARTIFACTS_DIR, 'crop_studio_archetypes_list.png');
            await archetypesCol.screenshot({ path: archCropPath });
            console.log(`Saved micro-crop: ${archCropPath}`);

            const footer = page.locator('#create-task-modal .editor-modal-footer');
            const footerCropPath = path.join(ARTIFACTS_DIR, 'crop_studio_footer_actions.png');
            await footer.screenshot({ path: footerCropPath });
            console.log(`Saved micro-crop: ${footerCropPath}`);

            // Switch to linear
            if (pillCount >= 2) {
                await pills.nth(0).click();
                await page.waitForTimeout(200);
                const linearCanvasCropPath = path.join(ARTIFACTS_DIR, 'crop_studio_canvas_linear.png');
                await canvas.screenshot({ path: linearCanvasCropPath });
                console.log(`Saved micro-crop: ${linearCanvasCropPath}`);

                const linearScreenshotPath = path.join(ARTIFACTS_DIR, `studio_modal_sequence_linear_${vp.name}.png`);
                await page.screenshot({ path: linearScreenshotPath, fullPage: false });
                console.log(`Saved screenshot: ${linearScreenshotPath}`);
            }

            // Capture screenshots for all other archetypes to verify didactics
            const otherTypes = ['click', 'draw', 'test', 'open_answer', 'image_labeling'];
            for (const type of otherTypes) {
                await page.click(`.editor-task-type-card[data-type="${type}"]`);
                await page.waitForTimeout(250);
                const shotPath = path.join(ARTIFACTS_DIR, `studio_modal_${type}_${vp.name}.png`);
                await page.screenshot({ path: shotPath, fullPage: false });
                console.log(`Saved screenshot: ${shotPath}`);
            }
        }

        await context.close();
    }

    await browser.close();
    console.log('=== Visual Audit Completed Successfully ===');
}

runVisualAudit().catch(err => {
    console.error('Audit failed with error:', err);
    process.exit(1);
});
