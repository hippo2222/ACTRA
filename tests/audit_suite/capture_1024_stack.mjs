import { chromium } from 'playwright';
import path from 'path';

const BASE_URL = 'http://127.0.0.1:8000';
const OUT_DIR = 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d';

async function capture() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    
    await context.request.post(`${BASE_URL}/api/auth/login`, {
        data: { identifier: 'devuser', password: 'password123' },
        headers: { Origin: BASE_URL }
    });

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

    await page.screenshot({ path: path.join(OUT_DIR, 'tour_step5_1024x768_stack_render.png') });
    console.log('Saved tour_step5_1024x768_stack_render.png');
    await browser.close();
}

capture().catch(console.error);
