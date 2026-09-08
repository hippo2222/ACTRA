const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:8000';
const REPORT_DIR = path.resolve(__dirname, '../reports/theory_blocks_stress');
const SCREENSHOT_DIR = path.join(REPORT_DIR, 'screenshots');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function getAuthCookie() {
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'stress-tester', password: 'Password123!' })
  });
  if (!loginRes.ok) {
    throw new Error(`Login failed with status ${loginRes.status}`);
  }
  const cookieHeader = loginRes.headers.get('set-cookie');
  const match = cookieHeader.match(/actra_session=([^;]+)/);
  if (!match) throw new Error('Could not parse actra_session cookie');
  return match[1];
}

async function run() {
  console.log('🚀 Starting Theory Blocks Comprehensive Stress Test...');
  const cookieValue = await getAuthCookie();
  console.log('🔑 Auth cookie obtained successfully');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  // Suppress onboarding tour scrims
  await context.addInitScript(() => {
    try {
      localStorage.setItem("actra_onboarding_disabled_v1", "true");
      localStorage.setItem("actra_onboarding_seen_v1", "true");
      window.ACTRA_DISABLE_AUTO_ONBOARDING = true;
    } catch (_) {}
  });

  await context.addCookies([{
    name: 'actra_session',
    value: cookieValue,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax'
  }]);

  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleLogs.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    consoleLogs.push(`[UNCAUGHT] ${err.message}`);
    console.error('❌ Page Error:', err.message);
  });

  const results = [];

  async function snap(name, description) {
    const filename = `${name}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: false });
    console.log(`📸 [Screenshot] ${filename} - ${description}`);
    results.push({ name, description, filepath });
  }

  try {
    // ==========================================
    // 0. INITIAL LOAD & EXPAND THEORY SECTION
    // ==========================================
    console.log('\n--- Test 0: Initial Page Load & Expand Theory Section ---');
    await page.goto(`${BASE_URL}/complexes/create`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('#theory-header', { timeout: 10000 });
    await snap('00_initial_load', 'Редактор комплекса загружен');

    // Click theory header to expand collapsible section
    await page.click('#theory-header');
    await page.waitForSelector('#theory-mode', { state: 'visible', timeout: 5000 });

    // Switch mode to "new" (Новая теория)
    await page.selectOption('#theory-mode', 'new');
    await page.waitForSelector('#theory-editor-wrap', { state: 'visible', timeout: 5000 });
    await page.waitForSelector('#theory-block-mode-toggle', { state: 'visible', timeout: 5000 });
    await snap('00_theory_editor_opened', 'Секция теории открыта, режим «Новая теория», тулбар с кнопкой «Блоки» виден');

    // Populate theory editor with rich dummy text
    await page.evaluate(() => {
      const editor = document.getElementById('theory-editor');
      editor.innerHTML = `
        <h1>Электромагнитная теория и основы радиотехники</h1>
        <p>Электромагнитные волны возникают при ускоренном движении электрических зарядов. Волна распространяется в пространстве со скоростью света.</p>
        <h2>Закон Ома для участка цепи</h2>
        <p>Сила тока в участке цепи прямо пропорциональна напряжению на концах этого участка и обратно пропорциональна его сопротивлению: <strong>I = U / R</strong>.</p>
        <blockquote>Первое правило Кирхгофа: сумма токов, сходящихся в узле, равна нулю.</blockquote>
        <h2>Колебательный контур</h2>
        <p>Колебательный контур состоит из катушки индуктивности и конденсатора. Частота свободных колебаний определяется формулой Томсона.</p>
        <ul>
          <li>Индуктивность измеряется в Генри (Гн);</li>
          <li>Емкость измеряется в Фарадах (Ф);</li>
          <li>Период T = 2π√(LC).</li>
        </ul>
        <p>Заключительный вывод: правильный расчет радиоцепей требует строгого понимания взаимосвязи параметров.</p>
      `;
    });

    // ==========================================
    // 1. CHAOS / IRRATIONAL USER: Rapid Toggle
    // ==========================================
    console.log('\n--- Test 1: Chaos Rapid Toggle ---');
    for (let i = 0; i < 15; i++) {
      await page.click('#theory-block-mode-toggle');
    }
    // ensure it ends up in active mode
    const isChecked = await page.getAttribute('#theory-block-mode-toggle', 'aria-checked');
    if (isChecked !== 'true') {
      await page.click('#theory-block-mode-toggle');
    }
    await page.waitForTimeout(300);
    await snap('01_mode_activated', 'Режим блоков включен: кнопка «Блоки» активна, панель блоков ВЫШЕ редактора');

    // ==========================================
    // 2. CHAOS USER: Empty, Spaces, Escape, Double Cancel
    // ==========================================
    console.log('\n--- Test 2: Chaos Form Input & Validation ---');
    // Click "Новый блок"
    await page.click('#theory-add-block-btn');
    await snap('02_inline_form_opened', 'Inline-форма создания блока раскрыта над редактором');

    // Press Escape to cancel
    await page.keyboard.press('Escape');
    const formHiddenAfterEsc = await page.evaluate(() => {
      return document.getElementById('theory-block-create-form-row').classList.contains('hidden');
    });
    console.log('✓ Form closed on Escape:', formHiddenAfterEsc);

    // Open again, clear and enter only spaces, press Enter
    await page.click('#theory-add-block-btn');
    const input = page.locator('#theory-block-name-input');
    await input.fill('     ');
    await page.keyboard.press('Enter');

    // Verify it was NOT created with blank spaces
    const blockCardsCount0 = await page.locator('.theory-block-card').count();
    console.log('✓ Blocks count after empty spaces input:', blockCardsCount0);

    // Cancel button click
    await page.click('#theory-block-create-cancel-btn');

    // ==========================================
    // 3. XSS & CRAZY CHARACTERS IN BLOCK NAME
    // ==========================================
    console.log('\n--- Test 3: XSS & Special Characters Test ---');
    await page.click('#theory-add-block-btn');
    const xssPayload = '<script>alert("xss")</script> & <b>Test</b> 🔥 "quote"';
    await input.fill(xssPayload);
    await page.click('#theory-block-create-confirm-btn');
    await page.waitForTimeout(200);
    await snap('03_xss_block_created', 'Блок с XSS и спецсимволами создан, экранирование безопасно');

    // Verify raw html wasn't executed
    const scriptTagsCount = await page.evaluate(() => {
      const card = document.querySelector('.theory-block-card');
      return card ? card.querySelectorAll('script').length : 0;
    });
    console.log('✓ Script tags injected into DOM:', scriptTagsCount);

    // ==========================================
    // 4. INLINE RENAME: Normal, Empty, Escape
    // ==========================================
    console.log('\n--- Test 4: Inline Rename in Block Card ---');
    // Double click to rename
    await page.dblclick('.block-label-display');
    await page.waitForSelector('.block-label-edit:not(.hidden)');
    const renameInput = page.locator('.block-label-edit:not(.hidden)');
    await renameInput.fill('Основы электродинамики');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await snap('04_block_renamed', 'Блок успешно переименован inline без prompt');

    // ==========================================
    // 5. HIGH VOLUME / STRESS CREATION (8 BLOCKS)
    // ==========================================
    console.log('\n--- Test 5: High Volume Creation ---');
    const blockNames = [
      'Закон Ома',
      'Правила Кирхгофа',
      'Колебательный контур',
      'Формула Томсона',
      'Индуктивность катушки',
      'Емкость конденсатора',
      'Резонанс напряжений',
    ];

    for (const bName of blockNames) {
      await page.click('#theory-add-block-btn');
      await input.fill(bName);
      await page.click('#theory-block-create-confirm-btn');
      await page.waitForTimeout(50);
    }

    const totalBlockCards = await page.locator('.theory-block-card').count();
    console.log('✓ Total blocks created:', totalBlockCards);
    await snap('05_eight_blocks_scrollable', 'Секция блоков компактно прокручивается и не выталкивает редактор');

    // ==========================================
    // 6. TEXT SELECTION & FLOATING PANEL STRESS
    // ==========================================
    console.log('\n--- Test 6: Text Selection & Floating Panel ---');
    // Ensure editor is in view and select first paragraph
    await page.evaluate(() => {
      const editor = document.getElementById('theory-editor');
      editor.scrollIntoView({ behavior: 'instant', block: 'center' });
      const p = editor.querySelector('p');
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    await snap('06_floating_panel_visible', 'Плавающая панель с чипами блоков появилась над выделенным текстом');

    // Click the first block chip in floating panel
    await page.click('#theory-floating-block-chips button:first-child');
    await page.waitForTimeout(200);
    await snap('07_text_highlighted_block1', 'Выделенный абзац подсвечен цветом первого блока');

    // Select second paragraph (Law of Ohm) and click "Закон Ома" chip
    await page.evaluate(() => {
      const editor = document.getElementById('theory-editor');
      editor.scrollIntoView({ behavior: 'instant', block: 'center' });
      const paragraphs = editor.querySelectorAll('p');
      const p = paragraphs[1]; // second p
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    // In floating panel, click block chip for "Закон Ома"
    await page.evaluate(() => {
      const chips = document.querySelectorAll('#theory-floating-block-chips button');
      for (const chip of chips) {
        if (chip.textContent.includes('Закон Ома')) {
          chip.click();
          break;
        }
      }
    });
    await page.waitForTimeout(200);
    await snap('08_two_highlights', 'Два разных фрагмента подсвечены разными цветами');

    // ==========================================
    // 7. FLOATING PANEL: "+ Новый блок" with Selection Retention
    // ==========================================
    console.log('\n--- Test 7: Floating Panel "+ Новый блок" with Selection ---');
    // Select the blockquote
    await page.evaluate(() => {
      const editor = document.getElementById('theory-editor');
      editor.scrollIntoView({ behavior: 'instant', block: 'center' });
      const bq = editor.querySelector('blockquote');
      const range = document.createRange();
      range.selectNodeContents(bq);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    // Click "+ Новый блок" in the floating panel
    await page.click('#theory-floating-add-block-btn');
    await page.waitForTimeout(200);
    await snap('09_floating_create_new_block', 'Клик по «+ Новый блок» в floating panel: форма открылась, диапазон сохранен');

    // Submit new block name
    await input.fill('Цитата Кирхгофа');
    await page.click('#theory-block-create-confirm-btn');
    await page.waitForTimeout(200);
    await snap('10_quote_highlighted_immediately', 'Новый блок создан и сразу применился к ранее выделенному тексту');

    // ==========================================
    // 8. TASK BINDING INTERACTION
    // ==========================================
    console.log('\n--- Test 8: Task Binding Dropdown & Unbind ---');
    // Open dropdown in first card
    await page.evaluate(() => {
      const card = document.querySelector('.theory-block-card');
      const addBtn = card?.querySelector('.add-task-link-btn');
      if (addBtn) addBtn.click();
    });
    await page.waitForTimeout(200);
    await snap('11_task_dropdown_opened', 'Меню привязки заданий открыто в карточке блока');

    // Click inside the section to close dropdown safely (avoid header back button)
    await page.click('#theory-title');
    await page.waitForTimeout(200);

    // ==========================================
    // 9. NOTIFICATIONUI CONFIRM DELETION
    // ==========================================
    console.log('\n--- Test 9: Deletion via NotificationUI Modal ---');
    // Scroll cards section into view
    await page.locator('#theory-blocks-management-section').scrollIntoViewIfNeeded();
    const firstDeleteBtn = page.locator('.theory-block-card .delete-block-btn').first();
    await firstDeleteBtn.click();
    await page.waitForTimeout(400);
    await snap('12_delete_modal_custom_ui', 'Кастомный диалог подтверждения удаления NotificationUI (НЕ нативный alert/confirm)');

    // Click cancel in NotificationUI dialog
    const cancelModalBtn = page.locator('[data-role="cancel"]');
    if (await cancelModalBtn.isVisible().catch(() => false)) {
      await cancelModalBtn.click();
      console.log('✓ Deletion cancelled via NotificationUI modal');
    }
    await page.waitForTimeout(400);

    // Now delete with confirmation
    await firstDeleteBtn.click();
    await page.waitForTimeout(400);
    const confirmModalBtn = page.locator('[data-role="confirm"]');
    if (await confirmModalBtn.isVisible().catch(() => false)) {
      await confirmModalBtn.click();
      await page.waitForTimeout(400);
      console.log('✓ Deletion confirmed via NotificationUI modal');
    }
    await snap('13_after_deletion', 'Блок удален, список блоков и счетчик обновлены');

    // ==========================================
    // 10. VIEWPORT RESPONSIVENESS: Mobile 375px & Tablet 768px
    // ==========================================
    console.log('\n--- Test 10: Responsive Viewports ---');
    // Tablet 768px
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(300);
    await snap('14_tablet_768px', 'Планшетный экран 768px: адаптивность тулбара и блоков');

    // Mobile 375px
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);
    await snap('15_mobile_375px', 'Мобильный экран 375px: секция блоков компактна и адаптивна');

    // Reset viewport to desktop
    await page.setViewportSize({ width: 1440, height: 900 });

    console.log('\n✅ All stress test scenarios executed successfully!');
  } catch (err) {
    console.error('❌ Test execution error:', err);
    await snap('99_error_state', `Ошибка во время теста: ${err.message}`);
    throw err;
  } finally {
    await browser.close();

    // Summary output
    console.log('\n--- Summary of Captured Screenshots ---');
    results.forEach(r => console.log(`- ${r.name}: ${r.description}`));

    if (consoleLogs.length > 0) {
      console.log('\n--- Page Console Warnings / Errors ---');
      consoleLogs.forEach(l => console.log(l));
    }
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
