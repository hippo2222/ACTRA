import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:8000';

async function testTour() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    
    // Auth
    const loginRes = await context.request.post(`${BASE_URL}/api/auth/login`, {
        data: { identifier: 'devuser', password: 'password123' },
        headers: { Origin: BASE_URL }
    });
    if (!loginRes.ok()) throw new Error(`Login failed: ${loginRes.status()}`);

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    console.log('--- Starting Tour at Step 0 ---');
    await page.evaluate(async () => {
        window.OnboardingTour.finish();
        await new Promise(r => setTimeout(r, 200));
        await window.OnboardingTour.start('editor-dashboard-authoring', { force: true, initialStep: 0 });
    });
    await page.waitForTimeout(600);
    let active = await page.evaluate(() => window.OnboardingTour.isActive());
    let stepId = await page.evaluate(() => window.OnboardingTour.getActiveStep()?.id);
    console.log(`Tour active at step 0: ${active}, step: ${stepId}`);

    console.log('--- Navigating to Step 4 (last step, index 4: editor-dashboard-create-task) ---');
    await page.evaluate(async () => {
        // Step forward through steps
        const tour = window.OnboardingTour.getActiveTour();
        const step = tour.steps[4];
        // Go directly or click next
        const nextBtn = document.querySelector('[data-onboarding-action="next"]');
        if (nextBtn) nextBtn.click();
    });
    // Let's do 4 clicks or start directly at initialStep: 4
    await page.evaluate(async () => {
        window.OnboardingTour.finish();
        await new Promise(r => setTimeout(r, 200));
        await window.OnboardingTour.start('editor-dashboard-authoring', { force: true, initialStep: 4 });
    });
    await page.waitForTimeout(1000);
    active = await page.evaluate(() => window.OnboardingTour.isActive());
    stepId = await page.evaluate(() => window.OnboardingTour.getActiveStep()?.id);
    console.log(`Tour active at step 4: ${active}, step: ${stepId}`);

    console.log('--- Clicking "Назад" button on Step 4 ---');
    const backBtn = await page.locator('[data-onboarding-action="prev"]');
    if (await backBtn.count() > 0) {
        await backBtn.click();
        await page.waitForTimeout(1000);
        active = await page.evaluate(() => window.OnboardingTour.isActive());
        stepId = await page.evaluate(() => window.OnboardingTour.getActiveStep()?.id);
        console.log(`AFTER CLICKING "Назад": Tour active: ${active}, step: ${stepId}`);
        if (!active) {
            console.error('FAIL: Tour died when going back!');
        } else {
            console.log('SUCCESS: Tour is alive on step:', stepId);
        }
    } else {
        console.log('No prev button found');
    }

    console.log('--- Moving forward to Step 4 again ---');
    const nextBtn = await page.locator('[data-onboarding-action="next"]');
    if (await nextBtn.count() > 0) {
        await nextBtn.click();
        await page.waitForTimeout(1000);
        active = await page.evaluate(() => window.OnboardingTour.isActive());
        stepId = await page.evaluate(() => window.OnboardingTour.getActiveStep()?.id);
        console.log(`FORWARD TO STEP 4: Tour active: ${active}, step: ${stepId}`);
    }

    console.log('--- Testing user-initiated close of modal on Step 4 (clicking [X]) ---');
    const closeBtn = await page.locator('#create-task-modal .editor-modal-close-btn');
    if (await closeBtn.count() > 0) {
        await closeBtn.click();
        await page.waitForTimeout(800);
        active = await page.evaluate(() => window.OnboardingTour.isActive());
        const modalVisible = await page.evaluate(() => {
            const m = document.getElementById('create-task-modal');
            return m && !m.classList.contains('hidden');
        });
        console.log(`AFTER USER CLOSE: Tour active: ${active} (expected false), Modal visible: ${modalVisible} (expected false)`);
        if (active || modalVisible) {
            console.error('FAIL: Tour or modal still active after user close!');
        } else {
            console.log('SUCCESS: Tour and modal cleanly closed!');
        }
    }

    await browser.close();
}

testTour().catch(console.error);
