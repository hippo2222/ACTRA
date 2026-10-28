import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:8000';
const ARTIFACTS_DIR = 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { identifier: 'clinical_expert@actra.local', password: 'Clinical.Pass1!' },
    headers: { Origin: BASE_URL }
  });
  const page = await context.newPage();
  const editorUrl = `${BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module=neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya&topic=differentsialnaya_diagnostika_i_stratifikatsiya_riska&task=task_5_1_tela_stratification`;
  await page.goto(editorUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('.se-hierarchy-shell', { timeout: 15000 });
  await page.waitForSelector('.se-node-card', { timeout: 15000 });
  await page.waitForTimeout(1000);

  console.log('--- 1. Testing Zoom Slider Presence & Geometry ---');
  const sliderInfo = await page.evaluate(() => {
    const slider = document.querySelector('#se-zoom-slider');
    const container = document.querySelector('.se-zoom-controls');
    if (!slider || !container) return null;
    const sR = slider.getBoundingClientRect();
    const cR = container.getBoundingClientRect();
    return {
      exists: true,
      min: slider.min,
      max: slider.max,
      step: slider.step,
      value: slider.value,
      width: sR.width,
      insideContainer: sR.left >= cR.left && sR.right <= cR.right
    };
  });
  console.log('Slider Info:', JSON.stringify(sliderInfo, null, 2));

  console.log('--- 2. Testing Two-Way Slider Sync ---');
  // 2a. Move slider to 125 via input event
  await page.evaluate(() => {
    const slider = document.querySelector('#se-zoom-slider');
    slider.value = 125;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);

  const syncAfterSlider = await page.evaluate(() => {
    const resetBtn = document.querySelector('#se-zoom-reset');
    const stage = document.querySelector('#se-hierarchy-stage');
    return {
      zoomText: resetBtn?.textContent.trim(),
      transform: stage?.style.transform
    };
  });
  console.log('State after slider -> 125:', syncAfterSlider);

  // 2b. Click zoom-out button
  await page.click('#se-zoom-out');
  await page.waitForTimeout(300);

  const syncAfterZoomOut = await page.evaluate(() => {
    const slider = document.querySelector('#se-zoom-slider');
    const resetBtn = document.querySelector('#se-zoom-reset');
    return {
      sliderValue: slider?.value,
      zoomText: resetBtn?.textContent.trim()
    };
  });
  console.log('State after zoom-out click:', syncAfterZoomOut);

  // Reset zoom to fit
  await page.click('#se-zoom-reset');
  await page.waitForTimeout(400);

  // Capture zoom controls screenshot
  const zoomControls = await page.$('.se-zoom-controls');
  if (zoomControls) {
    await zoomControls.screenshot({ path: `${ARTIFACTS_DIR}/crop_stage2_s2_zoom_controls.png` });
    console.log('Saved crop_stage2_s2_zoom_controls.png');
  }

  console.log('--- 3. Testing Kinetic Add Item to Leaf Node ---');
  // Find a leaf card
  const leafCard = await page.$('.se-node-card:has(.add-node-item-btn)');
  const initialItemsCount = await leafCard.$$eval('.se-node-item-row', els => els.length);
  console.log('Initial items count in leaf card:', initialItemsCount);

  // Make footer visible
  await page.evaluate(() => {
    document.querySelectorAll('.se-node-footer').forEach(f => {
      f.style.opacity = '1';
      f.style.visibility = 'visible';
    });
  });
  await page.waitForTimeout(100);

  // Click add item button
  const addItemBtn = await leafCard.$('.add-node-item-btn');
  await addItemBtn.click();

  // Check that the new row was appended and had animation class
  const enteringInfo = await leafCard.$$eval('.se-node-item-row', els => {
    const last = els[els.length - 1];
    return {
      count: els.length,
      lastClasses: last?.className,
      isTextareaFocused: document.activeElement === last?.querySelector('textarea')
    };
  });
  console.log('State immediately after addItem click:', enteringInfo);

  // Fill in sample text in newly added item
  await page.keyboard.type('Дополнительный клинический критерий (тест)');
  await page.waitForTimeout(300);

  // Capture screenshot of expanded card
  await leafCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await leafCard.screenshot({ path: `${ARTIFACTS_DIR}/crop_stage2_s2_item_entering.png` });
  console.log('Saved crop_stage2_s2_item_entering.png');

  console.log('--- 4. Testing Kinetic Delete Item from Leaf Node ---');
  const itemsBeforeDelete = await leafCard.$$eval('.se-node-item-row', els => els.length);
  const delBtn = await leafCard.$('.delete-node-item');
  if (delBtn) {
    await delBtn.click();
    // Verify exiting class added during transition
    const exitingFound = await leafCard.$$eval('.se-node-item-row--exiting', els => els.length > 0);
    console.log('Exiting animation class triggered:', exitingFound);

    // Wait for animation to complete
    await page.waitForTimeout(250);
    const itemsAfterDelete = await leafCard.$$eval('.se-node-item-row', els => els.length);
    console.log(`Items count: before=${itemsBeforeDelete}, after=${itemsAfterDelete}`);
  }

  // 5. Full page screenshots
  await page.screenshot({ path: `${ARTIFACTS_DIR}/stage2_s2_verified_1280x720.png`, fullPage: false });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${ARTIFACTS_DIR}/stage2_s2_verified_1280x800.png`, fullPage: false });

  await browser.close();
  console.log('Stage 2 verification completed successfully.');
}

main().catch(console.error);
