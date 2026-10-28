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

  console.log('=== TEST 1: Undo/Redo Text Preservation (Issue 6) ===');
  // 1a. Find first leaf card and change its textarea value
  let leafCard = await page.$('.se-node-card:has(.add-node-item-btn)');
  const textarea = await leafCard.$('.block-title-input');
  await textarea.click();
  await textarea.fill('Гепаринотерапия и реперфузия');
  await page.keyboard.press('Tab'); // Trigger blur to flush history save
  await page.waitForTimeout(400);

  const cardNodeId = await leafCard.getAttribute('data-node-id');
  const countBeforeBranch = await page.$$eval('.se-node-card', cards => cards.length);

  // 1b. Add a column/sibling node
  await page.evaluate(() => {
    document.querySelectorAll('.se-node-footer').forEach(f => {
      f.style.opacity = '1';
      f.style.visibility = 'visible';
    });
  });
  await page.waitForTimeout(100);

  const addColBtn = await leafCard.$('.add-sibling-node-btn');
  await addColBtn.click();
  await page.waitForTimeout(300);

  const countAfterBranch = await page.$$eval('.se-node-card', cards => cards.length);
  console.log(`Cards count before branch=${countBeforeBranch}, after branch=${countAfterBranch}`);

  // 1c. Hit Ctrl+Z to undo
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);

  const countAfterUndo = await page.$$eval('.se-node-card', cards => cards.length);
  const textAfterUndo = await page.$eval(`.se-node-card[data-node-id="${cardNodeId}"] .block-title-input`, el => el.value);

  console.log(`Cards count after undo=${countAfterUndo}, text after undo="${textAfterUndo}"`);
  if (countAfterUndo === countBeforeBranch && textAfterUndo === 'Гепаринотерапия и реперфузия') {
    console.log('✅ PASS: Undo reverted added card while PRESERVING typed text!');
  } else {
    throw new Error(`Undo failed: count=${countAfterUndo}, text="${textAfterUndo}"`);
  }

  console.log('=== TEST 2: Empty Slot Validation & Canvas Highlighting (Issue 7) ===');
  // Re-acquire leafCard after DOM re-render
  leafCard = await page.$(`.se-node-card[data-node-id="${cardNodeId}"]`);
  await page.evaluate(() => {
    document.querySelectorAll('.se-node-footer').forEach(f => {
      f.style.opacity = '1';
      f.style.visibility = 'visible';
    });
  });
  await page.waitForTimeout(100);

  // 2a. Add an empty element to group in leafCard
  const addItemBtn = await leafCard.$('.add-node-item-btn');
  await addItemBtn.click();
  await page.waitForTimeout(300);

  // Leave it empty and trigger save
  await page.evaluate(() => window.editor.saveTask());
  await page.waitForTimeout(400);

  // Check validation state
  const validationState = await leafCard.evaluate(card => {
    const errorTextarea = card.querySelector('.se-field--error');
    const isFocused = document.activeElement === errorTextarea;
    return {
      cardHasError: card.classList.contains('se-node-card--error'),
      cardHasShake: card.classList.contains('se-shake'),
      textareaHasError: Boolean(errorTextarea),
      isTextareaFocused: isFocused
    };
  });
  console.log('Validation DOM State:', JSON.stringify(validationState, null, 2));

  // Check toast notification content
  const toasts = await page.$$eval('#notify-toast-container, .toast, .notification, [role="alert"], [class*="toast"]', els => els.map(e => e.innerText.trim()).filter(Boolean));
  console.log('Toasts surfaced:', toasts);

  // Capture crop of highlighted error card
  await leafCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await leafCard.screenshot({ path: `${ARTIFACTS_DIR}/crop_stage3_s2_validation_error.png` });
  console.log('Saved crop_stage3_s2_validation_error.png');

  // Full page screenshots
  await page.screenshot({ path: `${ARTIFACTS_DIR}/stage3_s2_verified_1280x720.png`, fullPage: false });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${ARTIFACTS_DIR}/stage3_s2_verified_1280x800.png`, fullPage: false });

  // 2b. Verify that typing in error field removes the error classes
  await page.keyboard.type('Дополнительный заполненный элемент');
  await page.waitForTimeout(200);

  const errorsAfterTyping = await leafCard.evaluate(card => ({
    textareaError: Boolean(card.querySelector('.se-field--error')),
    cardError: card.classList.contains('se-node-card--error')
  }));
  console.log('Errors after typing text:', errorsAfterTyping);

  await browser.close();
  console.log('Stage 3 verification script finished successfully.');
}

main().catch(console.error);
