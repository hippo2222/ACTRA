import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:8000';

async function checkComputed() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    
    const loginRes = await context.request.post(`${BASE_URL}/api/auth/login`, {
        data: { identifier: 'devuser', password: 'password123' },
        headers: { Origin: BASE_URL }
    });
    if (!loginRes.ok()) throw new Error(`Login failed: ${loginRes.status()}`);

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    await page.evaluate(async () => {
        window.dashboard.closeModals();
        await window.OnboardingTour.finish();
        await new Promise(r => setTimeout(r, 400));
        await window.OnboardingTour.start('editor-dashboard-authoring', { force: true, initialStep: 4 });
        await new Promise(r => setTimeout(r, 800));
    });

    const info = await page.evaluate(() => {
        const dialog = document.querySelector('[data-onboarding-target="editor-create-task-dialog"]');
        const dRect = dialog ? dialog.getBoundingClientRect() : null;
        const stack = document.querySelector('.onboarding-tour-callout-stack');
        const stackStyle = stack ? window.getComputedStyle(stack) : null;
        const callout = document.querySelector('.onboarding-tour-callout');
        const calloutStyle = callout ? window.getComputedStyle(callout) : null;
        return {
            dRect,
            bodyStepId: document.body.dataset.onboardingStepId,
            stack: stack ? {
                className: stack.className,
                display: stackStyle.display,
                position: stackStyle.position,
                bottom: stackStyle.bottom,
                left: stackStyle.left,
                right: stackStyle.right,
                height: stackStyle.height,
                rect: stack.getBoundingClientRect()
            } : null,
            callout: callout ? {
                className: callout.className,
                position: calloutStyle.position,
                left: calloutStyle.left,
                top: calloutStyle.top,
                rect: callout.getBoundingClientRect()
            } : null
        };
    });

    console.log('Computed info at 1024x768:', JSON.stringify(info, null, 2));
    await browser.close();
}

checkComputed().catch(console.error);
