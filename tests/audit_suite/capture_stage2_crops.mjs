import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.request.post('http://127.0.0.1:8000/api/auth/login', {
    data: { identifier: 'clinical_expert@actra.local', password: 'Clinical.Pass1!' },
    headers: { Origin: 'http://127.0.0.1:8000' }
  });
  const page = await context.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  const editorUrl = 'http://127.0.0.1:8000/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module=neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya&topic=differentsialnaya_diagnostika_i_stratifikatsiya_riska&task=task_5_1_tela_stratification';
  await page.goto(editorUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('.se-hierarchy-shell', { timeout: 15000 });
  await page.waitForSelector('.se-node-card', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Fill sample column titles on the loaded clinical task to showcase live UI tags
  await page.evaluate(() => {
    const inputs = document.querySelectorAll('.col-title-input');
    if (inputs[0]) {
      inputs[0].value = 'Пневмоторакс';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (inputs[1]) {
      inputs[1].value = 'Обтурационный ателектаз';
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.waitForTimeout(600);

  const corner = await page.$('.se-grid-corner-spacer');
  if (corner) {
    const bbox = await corner.boundingBox();
    if (bbox) {
      await page.screenshot({
        path: 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d/crop_stage2_corner_spacer.png',
        clip: { x: Math.max(0, bbox.x - 10), y: Math.max(0, bbox.y - 10), width: bbox.width + 120, height: bbox.height + 60 }
      });
    }
  }

  const colHeader = await page.$('.se-col-header-cell');
  if (colHeader) {
    const bbox = await colHeader.boundingBox();
    if (bbox) {
      await page.screenshot({
        path: 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d/crop_stage2_col_header.png',
        clip: { x: Math.max(0, bbox.x - 10), y: Math.max(0, bbox.y - 10), width: bbox.width + 20, height: bbox.height + 20 }
      });
    }
  }

  const nodeTag = await page.$('.se-node-col-tag');
  if (nodeTag) {
    const bbox = await nodeTag.boundingBox();
    if (bbox) {
      await page.screenshot({
        path: 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d/crop_stage2_node_col_tag.png',
        clip: { x: Math.max(0, bbox.x - 30), y: Math.max(0, bbox.y - 15), width: bbox.width + 220, height: bbox.height + 30 }
      });
    }
  }

  await page.screenshot({ path: 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d/stage2_s2_verified_1280x800.png' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d/stage2_s2_verified_1280x720.png' });

  await browser.close();
  console.log('Verified screenshots and crops generated successfully!');
}

run();
