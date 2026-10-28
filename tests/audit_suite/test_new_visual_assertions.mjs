import { chromium } from 'playwright';
import {
    assertScrollportSafetyMargin,
    assertParentCornerContainment,
    assertNoGamificationSlop,
    assertDomZeroGhost,
    assertCornerCurvatureIntegrity
} from './helpers/visual_assertions.mjs';

const BASE_URL = process.env.ACTRA_BASE_URL || 'http://127.0.0.1:8000';

(async () => {
    console.log('=== Running New Visual Engineering Assertions Suite ===');
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    
    // Login
    const loginRes = await context.request.post(`${BASE_URL}/api/auth/login`, {
        data: { identifier: 'devuser', password: 'password123' },
        headers: { Origin: BASE_URL }
    });
    if (!loginRes.ok()) throw new Error('Login failed');

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`);

    for (const theme of ['light-a', 'dark-a']) {
        console.log(`\n--- Validating Theme: ${theme} ---`);
        await page.evaluate((th) => {
            document.documentElement.setAttribute('data-theme', th);
            window.dashboard.showCreateTaskModal();
            window.dashboard.syncTaskTypePicker();
        }, theme);
        await page.waitForTimeout(300);

        // Click test card to activate
        await page.click('.editor-task-type-card[data-type="test"]');
        await page.waitForTimeout(200);

        // 1. assertScrollportSafetyMargin
        await assertScrollportSafetyMargin(page, '.editor-studio-archetypes', '.editor-task-type-card', 4);
        console.log('  ✔ assertScrollportSafetyMargin passed (>= 4px clearance on all cards)');

        // 2. assertParentCornerContainment
        await assertParentCornerContainment(page, '.editor-showcase-header-row', '.editor-subtype-pills');
        console.log('  ✔ assertParentCornerContainment passed (pills inside parent rounded corner bounds)');

        // 3. assertNoGamificationSlop
        await assertNoGamificationSlop(page, '#create-task-modal');
        console.log('  ✔ assertNoGamificationSlop passed (zero synthetic gamification phrases)');

        // 4. assertDomZeroGhost
        await assertDomZeroGhost(page, ['#editor-showcase-counter']);
        console.log('  ✔ assertDomZeroGhost passed (counter element completely purged from DOM)');

        // 5. assertCornerCurvatureIntegrity
        await assertCornerCurvatureIntegrity(page, '.editor-task-type-card.is-active');
        console.log('  ✔ assertCornerCurvatureIntegrity passed (active card corner curvature unclipped)');
    }

    await browser.close();
    console.log('\n=== All New Visual Engineering Assertions PASSED (10/10) ===');
})();
