import { chromium } from 'playwright';
import path from 'path';

const ARTIFACTS_DIR = 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d';
const BASE_URL = 'http://127.0.0.1:8000';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { identifier: 'devuser', password: 'password123' },
    headers: { Origin: BASE_URL }
  });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`);

  for (const theme of ['light-a', 'dark-a']) {
    await page.evaluate((th) => {
      document.documentElement.setAttribute('data-theme', th);
      window.dashboard.showCreateTaskModal();
      window.dashboard.syncTaskTypePicker();
    }, theme);
    await page.waitForTimeout(300);
    await page.click('.editor-task-type-card[data-type="test"]');
    await page.waitForTimeout(300);

    const activeCard = page.locator('.editor-task-type-card.is-active');
    await activeCard.screenshot({
      path: path.join(ARTIFACTS_DIR, `crop_active_card_${theme}.png`)
    });

    const archetypesList = page.locator('.editor-studio-archetypes');
    await archetypesList.screenshot({
      path: path.join(ARTIFACTS_DIR, `crop_archetypes_list_${theme}.png`)
    });

    const showcaseHeader = page.locator('.editor-showcase-header-row');
    await showcaseHeader.screenshot({
      path: path.join(ARTIFACTS_DIR, `crop_showcase_pills_${theme}.png`)
    });

    const modal = page.locator('.editor-dialog-shell-studio');
    await modal.screenshot({
      path: path.join(ARTIFACTS_DIR, `studio_modal_test_verified_${theme}.png`)
    });
  }

  await browser.close();
  console.log('High-res micro crops generated successfully.');
})();
