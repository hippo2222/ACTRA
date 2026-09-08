const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:8000';
const CROPS_DIR = 'C:/Users/ASUS/.gemini/antigravity/brain/7a4be3d0-864a-469a-960e-8f656d4d0cf0/crops';

fs.mkdirSync(CROPS_DIR, { recursive: true });

async function getAuthCookie() {
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'stress-tester', password: 'Password123!' })
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
  const cookieHeader = loginRes.headers.get('set-cookie');
  const match = cookieHeader ? cookieHeader.match(/actra_session=([^;]+)/) : null;
  if (!match) throw new Error('Cookie missing');
  return match[1];
}

async function run() {
  console.log('🚀 Starting Rigorous Visual Inspection Suite...');
  const cookieValue = await getAuthCookie();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2
  });

  // Suppress onboarding tour scrims
  await context.addInitScript(() => {
    try {
      localStorage.setItem("actra_onboarding_disabled_v1", "true");
      localStorage.setItem("actra_onboarding_seen_v1", "true");
      localStorage.setItem("actra:onboarding:complex-editor-authoring:completed", "true");
      localStorage.setItem("actra:onboarding:complex-editor-authoring", "completed");
      window.ACTRA_DISABLE_AUTO_ONBOARDING = true;
    } catch (e) {}
  });

  await context.addCookies([{
    name: 'actra_session',
    value: cookieValue,
    domain: '127.0.0.1',
    path: '/'
  }]);

  const page = await context.newPage();
  await page.goto(`${BASE_URL}/complexes/create`, { waitUntil: 'networkidle', timeout: 30000 });

  // Remove any leftover onboarding scrims
  await page.evaluate(() => {
    document.querySelectorAll('.onboarding-tour-scrim, .onboarding-tour-popover, .onboarding-tour-target-highlight').forEach(el => el.remove());
    document.body.classList.remove('onboarding-tour-active');
  });

  // Expand theory section using the same method as stress_test_theory_blocks.js
  await page.waitForSelector('#theory-header', { timeout: 10000 });
  await page.click('#theory-header');
  await page.waitForSelector('#theory-mode', { state: 'visible', timeout: 5000 });
  await page.selectOption('#theory-mode', 'new');
  await page.waitForSelector('#theory-editor-wrap', { state: 'visible', timeout: 5000 });
  await page.waitForSelector('#theory-block-mode-toggle', { state: 'visible', timeout: 5000 });

  // Populate editor with rich physics text
  await page.evaluate(() => {
    const editor = document.getElementById('theory-editor');
    if (editor) {
      editor.innerHTML = `
        <h1>Электромагнитная теория и основы радиотехники</h1>
        <p>Электромагнитные волны возникают при ускоренном движении электрических зарядов. Волна распространяется в пространстве со скоростью света.</p>
        <h2>Закон Ома для участка цепи</h2>
        <p>Сила тока в участке цепи прямо пропорциональна напряжению на концах этого участка и обратно пропорциональна его сопротивлению: <strong>I = U / R</strong>.</p>
        <blockquote>Первое правило Кирхгофа: сумма токов, сходящихся в узле, равна нулю.</blockquote>
      `;
    }
  });
  await page.waitForTimeout(300);

  // Remove any leftover onboarding scrims before clicking
  await page.evaluate(() => {
    document.querySelectorAll('.onboarding-tour-scrim, .onboarding-tour-popover, .onboarding-tour-target-highlight').forEach(el => el.remove());
    document.body.classList.remove('onboarding-tour-active');
  });

  // Turn on blocks mode
  const toggleBtn = page.locator('#theory-block-mode-toggle');
  await toggleBtn.click({ force: true });
  await page.waitForTimeout(300);

  console.log('📸 Capturing Crop 01: Header action buttons...');
  const headerBtnsContainer = page.locator('#theory-blocks-management-section .flex.items-center.gap-1\\.5.flex-shrink-0');
  await headerBtnsContainer.screenshot({ path: path.join(CROPS_DIR, '01_header_buttons.png') });

  console.log('📸 Capturing Crop 02: Inline create form...');
  const addBtn = page.locator('#theory-add-block-btn');
  await addBtn.click();
  await page.waitForTimeout(250);
  const inlineForm = page.locator('#theory-block-create-form-row .theory-block-create-form');
  await inlineForm.screenshot({ path: path.join(CROPS_DIR, '02_inline_create_form.png') });

  // Verify cancel button centering & input height
  const formGeo = await page.evaluate(() => {
    const input = document.getElementById('theory-block-name-input').getBoundingClientRect();
    const confirm = document.getElementById('theory-block-create-confirm-btn').getBoundingClientRect();
    const cancel = document.getElementById('theory-block-create-cancel-btn').getBoundingClientRect();
    const icon = document.querySelector('#theory-block-create-cancel-btn .material-symbols-outlined').getBoundingClientRect();
    return {
      deltaTop: Math.abs(input.top - confirm.top) + Math.abs(confirm.top - cancel.top),
      inputHeight: input.height,
      confirmHeight: confirm.height,
      cancelHeight: cancel.height,
      cancelWidth: cancel.width,
      iconOverflow: icon.bottom - cancel.bottom
    };
  });
  console.log('Form Geometry Audit:', JSON.stringify(formGeo));
  if (formGeo.iconOverflow > 0.5) throw new Error(`Cancel icon overflows button by ${formGeo.iconOverflow}px`);

  // Create Block 1
  await page.fill('#theory-block-name-input', 'Основы электродинамики');
  await page.click('#theory-block-create-confirm-btn');
  await page.waitForTimeout(300);

  console.log('📸 Capturing Crop 03: Floating selection panel...');
  await page.evaluate(() => {
    const ed = document.getElementById('theory-editor');
    const p2 = ed.querySelectorAll('p')[1];
    const range = document.createRange();
    range.selectNodeContents(p2);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    ed.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const floatingPanel = page.locator('#theory-block-floating-panel');
  await floatingPanel.screenshot({ path: path.join(CROPS_DIR, '03_floating_selection_panel.png') });

  // Click the block chip in floating panel to apply highlight
  await page.locator('#theory-floating-block-chips button').first().click();
  await page.waitForTimeout(300);

  console.log('📸 Capturing Crop 04: Theory block card...');
  const firstCard = page.locator('.theory-block-card').first();
  await firstCard.screenshot({ path: path.join(CROPS_DIR, '04_theory_block_card.png') });

  console.log('📸 Capturing Crop 05: Task picker - Empty State...');
  await page.evaluate(() => { window.state.selectedTasks = []; });
  await page.locator('.theory-block-card .add-task-link-btn').first().click();
  await page.waitForTimeout(300);
  const picker = page.locator('#theory-block-task-picker');
  await picker.screenshot({ path: path.join(CROPS_DIR, '05_task_picker_empty_state.png') });

  console.log('📸 Capturing Crop 06: Task picker - Populated with tasks...');
  await page.evaluate(() => {
    window.state.selectedTasks = [
      { ref: 'task-ohm-1', label: 'Задание 1: Закон Ома для участка цепи' },
      { ref: 'task-kirch-2', label: 'Задание 2: Правила Кирхгофа и расчет узлов' },
      { ref: 'task-em-3', label: 'Задание 3: Электромагнитная индукция Фарадея' }
    ];
    if (typeof closeTheoryBlockTaskPicker === 'function') closeTheoryBlockTaskPicker();
    const btn = document.querySelector('.theory-block-card .add-task-link-btn');
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);
  await picker.screenshot({ path: path.join(CROPS_DIR, '06_task_picker_with_tasks.png') });

  console.log('📸 Capturing Crop 07: Task picker checked + card chip...');
  const chk1 = page.locator('#theory-task-picker-content input[type="checkbox"]').first();
  await chk1.check();
  await page.waitForTimeout(250);
  const chk2 = page.locator('#theory-task-picker-content input[type="checkbox"]').nth(1);
  await chk2.check();
  await page.waitForTimeout(300);

  const cardAndPickerArea = page.locator('#theory-blocks-management-section');
  await cardAndPickerArea.screenshot({ path: path.join(CROPS_DIR, '07_card_and_picker_combined.png') });

  console.log('📸 Capturing Crop 08: Card bound chips row...');
  const chipsRow = page.locator('.theory-block-card .flex.flex-wrap.items-center.gap-1\\.5').first();
  await chipsRow.screenshot({ path: path.join(CROPS_DIR, '08_card_bound_chips_row.png') });

  // Close picker
  await page.click('#theory-title');
  await page.waitForTimeout(250);

  console.log('📸 Capturing Crop 09: Inline rename active...');
  await page.locator('.theory-block-card .edit-block-btn').first().click();
  await page.waitForTimeout(200);
  await firstCard.screenshot({ path: path.join(CROPS_DIR, '09_card_inline_rename.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  console.log('📸 Capturing Crop 10: Delete modal custom UI...');
  await page.locator('.theory-block-card .delete-block-btn').first().click();
  await page.waitForTimeout(350);
  const deleteModal = page.locator('[data-role="confirm-card"]');
  await deleteModal.screenshot({ path: path.join(CROPS_DIR, '10_delete_modal_custom.png') });
  await page.locator('[data-role="cancel"]').click();
  await page.waitForTimeout(300);

  console.log('📸 Capturing Crop 11: High-density scrollable container (6 blocks)...');
  for (let i = 2; i <= 6; i++) {
    await addBtn.click();
    await page.fill('#theory-block-name-input', `Теоретический модуль ${i}`);
    await page.click('#theory-block-create-confirm-btn');
    await page.waitForTimeout(150);
  }
  const blocksList = page.locator('#theory-blocks-list');
  await blocksList.screenshot({ path: path.join(CROPS_DIR, '11_scrollable_cards_container.png') });

  console.log('📸 Capturing Crop 12: Mobile 375px view...');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  const mobileSection = page.locator('#theory-blocks-management-section');
  await mobileSection.screenshot({ path: path.join(CROPS_DIR, '12_mobile_view_375px.png') });

  console.log('✅ Rigorous Visual Inspection Suite completed successfully!');
  await browser.close();
}

run().catch(err => {
  console.error('❌ Audit Failed:', err);
  process.exit(1);
});
