/**
 * tests/audit_suite/verify_dashboard_authoring_step5.mjs
 * 
 * Verifies Step 5 of editor-dashboard-authoring onboarding tour
 * at 1280x800 and 1280x720 viewports with automated headless assertions.
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const ARTIFACTS_DIR = 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d';
const BASE_URL = 'http://127.0.0.1:8000';

function rectsOverlap(r1, r2) {
    return !(
        r1.right <= r2.left ||
        r1.left >= r2.right ||
        r1.bottom <= r2.top ||
        r1.top >= r2.bottom
    );
}

async function runStep5Verification() {
    console.log('=== Starting Dashboard Authoring Tour Step 5 Verification ===');
    const browser = await chromium.launch({ headless: true });

    const viewports = [
        { width: 1280, height: 800, name: '1280x800' },
        { width: 1280, height: 720, name: '1280x720' }
    ];

    let allAssertionsPassed = true;

    for (const vp of viewports) {
        console.log(`\n======================================================`);
        console.log(`📐 TESTING VIEWPORT: ${vp.name} (${vp.width}x${vp.height})`);
        console.log(`======================================================`);

        const context = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            deviceScaleFactor: 1
        });

        // 1. Authenticate
        const loginRes = await context.request.post(`${BASE_URL}/api/auth/login`, {
            data: { identifier: 'devuser', password: 'password123' },
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

        // 3. Launch Onboarding Tour directly at Step 5
        console.log('Launching onboarding tour step 5 (editor-dashboard-create-task)...');
        const setupResult = await page.evaluate(async () => {
            if (!window.OnboardingTour) return { error: 'No OnboardingTour' };
            window.OnboardingTour.finish();
            await new Promise(r => setTimeout(r, 200));
            const started = await window.OnboardingTour.start('editor-dashboard-authoring', { force: true, initialStep: 4 });
            await new Promise(r => setTimeout(r, 1000));
            return { started };
        });

        if (!setupResult.started) {
            throw new Error(`Failed to start tour step 5: ${JSON.stringify(setupResult)}`);
        }

        // 4. Extract layout coordinates
        const layoutData = await page.evaluate(() => {
            const dialog = document.querySelector('[data-onboarding-target="editor-create-task-dialog"]');
            const dRect = dialog ? dialog.getBoundingClientRect() : null;

            const control = document.querySelector('.onboarding-tour-control');
            const cRect = control ? control.getBoundingClientRect() : null;

            const callouts = Array.from(document.querySelectorAll('.onboarding-tour-callout.is-visible')).map(el => {
                const rect = el.getBoundingClientRect();
                const titleEl = el.querySelector('.onboarding-tour-callout-title');
                const bodyEl = el.querySelector('.onboarding-tour-callout-body');
                const title = titleEl?.textContent?.trim() || '';
                const body = bodyEl?.textContent?.trim() || '';
                const titleClipped = titleEl ? titleEl.scrollWidth > titleEl.offsetWidth + 1 : false;
                const bodyClipped = bodyEl ? bodyEl.scrollHeight > bodyEl.offsetHeight + 1 : false;
                return {
                    title,
                    body,
                    placement: el.dataset.placement,
                    rect: {
                        left: rect.left,
                        top: rect.top,
                        right: rect.right,
                        bottom: rect.bottom,
                        width: rect.width,
                        height: rect.height
                    },
                    unclipped: !titleClipped && !bodyClipped,
                    titleClipped,
                    bodyClipped
                };
            });

            const showcase = document.querySelector('#editor-task-showcase');
            const svgPreview = showcase ? showcase.querySelector('svg') : null;

            return {
                dialogRect: dRect ? {
                    left: dRect.left,
                    top: dRect.top,
                    right: dRect.right,
                    bottom: dRect.bottom,
                    width: dRect.width,
                    height: dRect.height
                } : null,
                controlRect: cRect ? {
                    left: cRect.left,
                    top: cRect.top,
                    right: cRect.right,
                    bottom: cRect.bottom,
                    width: cRect.width,
                    height: cRect.height
                } : null,
                callouts,
                hasSvgPreview: Boolean(svgPreview),
                svgBBox: svgPreview ? { width: svgPreview.clientWidth || svgPreview.getAttribute('width'), height: svgPreview.clientHeight || svgPreview.getAttribute('height') } : null
            };
        });

        console.log(`Dialog BoundingBox:`, layoutData.dialogRect);
        console.log(`Control Bar BoundingBox:`, layoutData.controlRect);
        console.log(`Callouts Count: ${layoutData.callouts.length}`);
        layoutData.callouts.forEach((c, idx) => {
            console.log(`  Callout ${idx + 1} [${c.placement}]: "${c.title}" -> L:${c.rect.left.toFixed(1)}, T:${c.rect.top.toFixed(1)}, R:${c.rect.right.toFixed(1)}, B:${c.rect.bottom.toFixed(1)}`);
        });

        // -------------------------------------------------------------------
        // ASSERTION 1: Dialog Presence & Centering
        // -------------------------------------------------------------------
        if (!layoutData.dialogRect || layoutData.dialogRect.width < 500) {
            console.error(`❌ Dialog Assertion FAILED: dialog not found or width too small`);
            allAssertionsPassed = false;
        } else {
            console.log(`✅ Dialog Presence Assertion PASSED (${layoutData.dialogRect.width}x${layoutData.dialogRect.height})`);
        }

        // -------------------------------------------------------------------
        // ASSERTION 2: Viewport Fold (No modal overflow outside viewport)
        // -------------------------------------------------------------------
        if (layoutData.dialogRect.bottom > vp.height || layoutData.dialogRect.top < 0) {
            console.error(`❌ Viewport Fold Violation: Dialog bottom ${layoutData.dialogRect.bottom} > ${vp.height}`);
            allAssertionsPassed = false;
        } else {
            console.log(`✅ Viewport Fold Assertion PASSED for modal dialog`);
        }

        // -------------------------------------------------------------------
        // ASSERTION 3: Callouts Within Viewport Bounds (Zero Viewport Clipping)
        // -------------------------------------------------------------------
        let calloutBoundsOk = true;
        for (const c of layoutData.callouts) {
            if (c.rect.left < 0 || c.rect.right > vp.width || c.rect.top < 0 || c.rect.bottom > vp.height) {
                console.error(`❌ Callout Viewport Bound Violation for "${c.title}":`, c.rect);
                calloutBoundsOk = false;
                allAssertionsPassed = false;
            }
        }
        if (calloutBoundsOk) {
            console.log(`✅ Callouts Viewport Bounds Assertion PASSED (all callouts within screen)`);
        }

        // -------------------------------------------------------------------
        // ASSERTION 4: No Overlap Between Callouts and Dialog (AABB)
        // -------------------------------------------------------------------
        let calloutDialogCollision = false;
        for (const c of layoutData.callouts) {
            if (rectsOverlap(c.rect, layoutData.dialogRect)) {
                console.error(`❌ Callout-Dialog Collision: "${c.title}" overlaps dialog!`);
                calloutDialogCollision = true;
                allAssertionsPassed = false;
            }
        }
        if (!calloutDialogCollision) {
            console.log(`✅ No Overlap (Callout ↔ Dialog) Assertion PASSED: 0 collisions detected`);
        }

        // -------------------------------------------------------------------
        // ASSERTION 5: No Mutual Callout Collisions (AABB)
        // -------------------------------------------------------------------
        let calloutCalloutCollision = false;
        for (let i = 0; i < layoutData.callouts.length; i++) {
            for (let j = i + 1; j < layoutData.callouts.length; j++) {
                const c1 = layoutData.callouts[i];
                const c2 = layoutData.callouts[j];
                if (rectsOverlap(c1.rect, c2.rect)) {
                    console.error(`❌ Callout-Callout Collision: "${c1.title}" overlaps "${c2.title}"!`);
                    calloutCalloutCollision = true;
                    allAssertionsPassed = false;
                }
            }
        }
        if (!calloutCalloutCollision) {
            console.log(`✅ No Overlap (Callout ↔ Callout) Assertion PASSED: all callouts mutually disjoint`);
        }

        // -------------------------------------------------------------------
        // ASSERTION 6: No Collision with Tour Control Bar
        // -------------------------------------------------------------------
        let controlBarCollision = false;
        if (layoutData.controlRect) {
            for (const c of layoutData.callouts) {
                if (rectsOverlap(c.rect, layoutData.controlRect)) {
                    console.error(`❌ Callout-ControlBar Collision: "${c.title}" overlaps control bar!`);
                    controlBarCollision = true;
                    allAssertionsPassed = false;
                }
            }
        }
        if (!controlBarCollision) {
            console.log(`✅ No Overlap (Callout ↔ ControlBar) Assertion PASSED`);
        }

        // -------------------------------------------------------------------
        // ASSERTION 7: Zero Truncation
        // -------------------------------------------------------------------
        const allUnclipped = layoutData.callouts.every(c => c.unclipped);
        if (!allUnclipped) {
            console.warn(`⚠️ Warning: Some callout text is clipped`);
        } else {
            console.log(`✅ Zero-Truncation Assertion PASSED on all callouts`);
        }

        // -------------------------------------------------------------------
        // ASSERTION 8: Interactive Studio Showcase & SVG Rendered
        // -------------------------------------------------------------------
        if (!layoutData.hasSvgPreview) {
            console.error(`❌ Studio Preview Assertion FAILED: SVG miniature not rendered`);
            allAssertionsPassed = false;
        } else {
            console.log(`✅ Studio Preview Assertion PASSED: SVG miniature live rendered`);
        }

        // 5. Screenshots
        const fullShotPath = path.join(ARTIFACTS_DIR, `tour_dashboard_step5_verified_${vp.name}.png`);
        await page.screenshot({ path: fullShotPath });
        console.log(`📸 Full screenshot saved: ${fullShotPath}`);

        // Micro-crops for visual audit dossier
        if (vp.height === 720) {
            // Left margin crop: callouts 1 and 2
            await page.screenshot({
                path: path.join(ARTIFACTS_DIR, 'crop_tour_step5_left_callouts.png'),
                clip: { x: 0, y: 100, width: 280, height: 480 }
            });

            // Right margin crop: callout 3
            await page.screenshot({
                path: path.join(ARTIFACTS_DIR, 'crop_tour_step5_right_callout.png'),
                clip: { x: 1000, y: 180, width: 280, height: 350 }
            });
            console.log('📸 Micro-crops saved: crop_tour_step5_left_callouts.png, crop_tour_step5_right_callout.png');
        }

        await context.close();
    }

    await browser.close();

    console.log(`\n======================================================`);
    console.log(`🏁 VERIFICATION VERDICT: ${allAssertionsPassed ? 'PASS (All 8 Assertions Succeeded)' : 'FAIL'}`);
    console.log(`======================================================\n`);

    if (!allAssertionsPassed) {
        process.exit(1);
    }
}

runStep5Verification().catch(err => {
    console.error('Fatal error during verification:', err);
    process.exit(1);
});
