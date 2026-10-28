import { chromium } from 'playwright';
import path from 'path';

const BASE_URL = 'http://127.0.0.1:8000';
const OUT_DIR = 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d';

async function test1024() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    
    // Auth
    const loginRes = await context.request.post(`${BASE_URL}/api/auth/login`, {
        data: { identifier: 'devuser', password: 'password123' },
        headers: { Origin: BASE_URL }
    });
    if (!loginRes.ok()) throw new Error(`Login failed: ${loginRes.status()}`);

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    await page.evaluate(async () => {
        window.OnboardingTour.finish();
        await new Promise(r => setTimeout(r, 200));
        await window.OnboardingTour.start('editor-dashboard-authoring', { force: true, initialStep: 4 });
    });
    await page.waitForTimeout(1000);

    const data = await page.evaluate(() => {
        const dialog = document.querySelector('[data-onboarding-target="editor-create-task-dialog"]');
        const dRect = dialog ? dialog.getBoundingClientRect() : null;
        const stack = document.querySelector('.onboarding-tour-callout-stack');
        const sRect = stack ? stack.getBoundingClientRect() : null;
        const stackVisible = stack ? stack.classList.contains('is-visible') : false;
        const bodyStep = document.body.dataset.onboardingStepId;

        const callouts = Array.from(document.querySelectorAll('.onboarding-tour-callout')).map((el, i) => {
            const rect = el.getBoundingClientRect();
            const title = el.querySelector('.onboarding-tour-callout-title')?.textContent?.trim() || '';
            const isVisible = el.classList.contains('is-visible');
            return { i, title, isVisible, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } };
        });

        return { bodyStep, dRect, sRect, stackVisible, callouts };
    });

    console.log('Result at 1024x768:', JSON.stringify(data, null, 2));

    await page.screenshot({ path: path.join(OUT_DIR, 'tour_step5_1024x768_inspection.png'), fullPage: false });
    console.log('Screenshot saved to tour_step5_1024x768_inspection.png');

    await browser.close();
}

test1024().catch(console.error);
