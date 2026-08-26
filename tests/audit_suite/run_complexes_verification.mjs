import { chromium } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 8000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/complexes`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.abort();
      resolve(false);
    });
  });
}

async function startServer() {
  console.log('[Runner] Starting local Flask server...');
  const pythonExe = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : 'python3';
  const pyProcess = spawn(pythonExe, ['desktop-app/server.py'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TRAINER_HTTP_PORT: String(PORT)
    },
    stdio: 'pipe'
  });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isServerRunning()) {
      console.log('[Runner] Flask server is ready!');
      return pyProcess;
    }
  }
  throw new Error('Flask server failed to start within 30s');
}

async function runAudit() {
  let serverProcess = null;
  const alreadyRunning = await isServerRunning();
  if (!alreadyRunning) {
    serverProcess = await startServer();
  } else {
    console.log('[Runner] Using already running Flask server.');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const networkErrors = [];
  const networkResponses = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('favicon.ico') && !text.includes('404')) {
        consoleErrors.push({ text, location: msg.location() });
      }
    }
  });

  page.on('pageerror', (err) => {
    consoleErrors.push({ text: err.message, stack: err.stack });
  });

  page.on('response', (res) => {
    const url = res.url();
    const status = res.status();
    networkResponses.push({ url, status });
    if (status >= 400 && (url.includes('/complexes') || url.includes('/api/'))) {
      networkErrors.push({ url, status, statusText: res.statusText() });
    }
  });

  const results = [];
  function record(name, pass, details = '') {
    results.push({ name, pass, details });
    const mark = pass ? '✅ PASS' : '❌ FAIL';
    console.log(`${mark} | ${name}${details ? ' — ' + details : ''}`);
  }

  try {
    // -------------------------------------------------------------------------
    // 1. Network & Assets Validation
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Network & Static Assets ---');
    await page.goto(`${BASE_URL}/complexes`, { waitUntil: 'networkidle' });

    const cssResp = networkResponses.find((r) => r.url.endsWith('/complexes/complexes.css'));
    const jsResp = networkResponses.find((r) => r.url.endsWith('/complexes/complexes.js'));

    record('Static CSS (/complexes/complexes.css) HTTP 200', !!cssResp && cssResp.status === 200);
    record('Static JS (/complexes/complexes.js) HTTP 200', !!jsResp && jsResp.status === 200);

    // Wait for cards to render in DOM
    await page.waitForSelector('#complexes-list article.cx-card', { state: 'visible', timeout: 10000 });

    // -------------------------------------------------------------------------
    // 2. DOM Hierarchy & Semantics Inspection
    // -------------------------------------------------------------------------
    console.log('\n--- 2. DOM & Semantic Structure ---');
    const cardCount = await page.locator('#complexes-list article.cx-card').count();
    record('Rendered Complexes Cards in DOM', cardCount === 3, `Found ${cardCount} cards`);

    const firstCard = page.locator('#complexes-list article.cx-card').first();
    const hasAriaLabel = await firstCard.getAttribute('aria-labelledby');
    const hasH2 = await firstCard.locator('h2').count();
    record('Card uses semantic <article> with aria-labelledby and <h2>', !!hasAriaLabel && hasH2 > 0);

    const hasStartBtn = await firstCard.locator('.start-btn').count();
    const hasDetailBtn = await firstCard.locator('.detail-toggle-btn').count();
    const hasChevron = await firstCard.locator('.cx-toggle-chevron').count();
    const hasPinBtn = await firstCard.locator('.pin-btn').count();
    const hasMenuBtn = await firstCard.locator('.cx-card-menu-btn').count();

    record('Card Primary Actions (Start, Detail Toggle, Chevron)', hasStartBtn > 0 && hasDetailBtn > 0 && hasChevron > 0);
    record('Card Secondary Actions (Pin, Menu ⋮)', hasPinBtn > 0 && hasMenuBtn > 0);

    // -------------------------------------------------------------------------
    // 3. Live Search, Clear Button & Shortcuts
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Search, Clear & Shortcuts ---');
    const searchInput = page.locator('#complex-search-input');
    const searchClear = page.locator('#complex-search-clear');
    const summaryBadge = page.locator('#complex-filter-summary');

    // Type query "ЭКГ"
    await searchInput.fill('ЭКГ');
    const clearVisible = await searchClear.isVisible();
    record('Search clear button ✕ appears on input', clearVisible);

    const visibleAfterSearch = await page.locator('#complexes-list article.cx-card:not([hidden])').count();
    const summaryText1 = await summaryBadge.textContent();
    record('Search filters cards in DOM correctly', visibleAfterSearch === 1, `Visible: ${visibleAfterSearch}, Summary: "${summaryText1}"`);

    // Clear via button ✕
    await searchClear.click();
    const inputVal = await searchInput.inputValue();
    const visibleAfterClear = await page.locator('#complexes-list article.cx-card:not([hidden])').count();
    record('Clicking ✕ clears search input and restores list', inputVal === '' && visibleAfterClear === 3);

    // Test "/" shortcut
    await searchInput.blur();
    await page.keyboard.press('/');
    const isFocused = await searchInput.evaluate((el) => document.activeElement === el);
    record('Keyboard shortcut "/" focuses search input', isFocused);

    // Test Escape to clear & blur
    await searchInput.fill('алгоритм');
    const filteredCount = await page.locator('#complexes-list article.cx-card:not([hidden])').count();
    await page.keyboard.press('Escape');
    const valAfterEsc = await searchInput.inputValue();
    const isFocusedAfterEsc = await searchInput.evaluate((el) => document.activeElement === el);
    const visibleAfterEsc = await page.locator('#complexes-list article.cx-card:not([hidden])').count();
    record('Keyboard shortcut Escape clears and blurs search', filteredCount === 1 && valAfterEsc === '' && !isFocusedAfterEsc && visibleAfterEsc === 3);

    // -------------------------------------------------------------------------
    // 4. Sort Dropdown Inspection
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Sort Dropdown Inspection ---');
    const sortSelect = page.locator('#complex-sort-select');

    // Sort by name descending (Я → А)
    await sortSelect.selectOption('name-desc');
    let titles = await page.locator('#complexes-list article.cx-card:not([hidden]) h2').allTextContents();
    record('Sort by name descending (Я → А)', titles[0].includes('Ядерный') && titles[titles.length - 1].includes('Анализ'), `First: "${titles[0]}", Last: "${titles[titles.length - 1]}"`);

    // Sort by task count descending
    await sortSelect.selectOption('tasks-desc');
    titles = await page.locator('#complexes-list article.cx-card:not([hidden]) h2').allTextContents();
    record('Sort by task count descending', titles[0].includes('Базовые алгоритмы'), `First: "${titles[0]}" (5 tasks)`);

    // Sort by name ascending (А → Я)
    await sortSelect.selectOption('name-asc');
    titles = await page.locator('#complexes-list article.cx-card:not([hidden]) h2').allTextContents();
    record('Sort by name ascending (А → Я)', titles[0].includes('Анализ') && titles[titles.length - 1].includes('Ядерный'), `First: "${titles[0]}", Last: "${titles[titles.length - 1]}"`);

    // -------------------------------------------------------------------------
    // 5. Filter Chips Inspection
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Filter Chips Inspection ---');
    const mineChip = page.locator('.complex-filter-chip[data-filter="mine"]');
    const allChip = page.locator('.complex-filter-chip[data-filter="all"]');

    await mineChip.click();
    const mineActive = await mineChip.evaluate((el) => el.classList.contains('pill-info'));
    const allActive = await allChip.evaluate((el) => el.classList.contains('pill-info'));
    record('Filter chip "mine" activates and "all" deactivates', mineActive && !allActive);

    await allChip.click();
    const allRestored = await allChip.evaluate((el) => el.classList.contains('pill-info'));
    record('Filter chip "all" restores active state', allRestored);

    // -------------------------------------------------------------------------
    // 6. Context Menu ⋮ Dropdown
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Context Menu ⋮ Inspection ---');
    const menuBtn = page.locator('#complexes-list article.cx-card .cx-card-menu-btn').first();
    await menuBtn.click();

    const menuOpen = await page.locator('#complexes-list article.cx-card .cx-card-menu-dropdown:not([hidden])').count();
    record('Clicking ⋮ opens context menu dropdown', menuOpen === 1);

    await page.keyboard.press('Escape');
    const menuClosed = await page.locator('#complexes-list article.cx-card .cx-card-menu-dropdown:not([hidden])').count();
    record('Pressing Escape closes context menu', menuClosed === 0);

    // -------------------------------------------------------------------------
    // 7. Detail Accordion Panel
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Detail Accordion Panel ---');
    const detailToggleBtn = page.locator('#complexes-list article.cx-card .detail-toggle-btn').first();
    const detailPanel = page.locator('#complexes-list article.cx-card .detail-panel').first();
    const chevronEl = page.locator('#complexes-list article.cx-card .cx-toggle-chevron').first();

    await detailToggleBtn.click();
    const isExpanded = await detailPanel.evaluate((el) => el.classList.contains('expanded'));
    const isChevronRotated = await chevronEl.evaluate((el) => el.classList.contains('is-expanded'));
    record('Clicking "Подробнее" expands panel and rotates chevron', isExpanded && isChevronRotated);

    await detailToggleBtn.click();
    const isCollapsed = await detailPanel.evaluate((el) => !el.classList.contains('expanded'));
    record('Clicking "Подробнее" again collapses panel', isCollapsed);

    // -------------------------------------------------------------------------
    // 8. Theory Viewer Modal (Quill Delta Parsing)
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Theory Viewer Modal Inspection ---');
    const theoryCardBtn = page.locator('#complexes-list article.cx-card:has-text("Анализ ЭКГ и ритма") .theory-btn');
    const hasTheoryBtn = await theoryCardBtn.count();
    record('Theory button "📖 Теория" rendered on linked card', hasTheoryBtn > 0);

    if (hasTheoryBtn > 0) {
      await theoryCardBtn.click();
      const theoryDialog = page.locator('#complex-theory-viewer-dialog');
      await theoryDialog.waitFor({ state: 'visible', timeout: 5000 });
      record('Theory modal dialog opens (#complex-theory-viewer-dialog)', true);

      const h1Count = await theoryDialog.locator('.theory-rendered-view h1').count();
      const strongCount = await theoryDialog.locator('.theory-rendered-view strong').count();
      const listItemsCount = await theoryDialog.locator('.theory-rendered-view ul li').count();

      record('Theory rich formatting (H1 headings, bold, bullet lists)', h1Count > 0 && strongCount > 0 && listItemsCount === 3, `H1: ${h1Count}, List Items: ${listItemsCount}`);

      const closeBtn = theoryDialog.locator('button[data-action="close"]').first();
      await closeBtn.click();
      await page.waitForTimeout(300);
      const isDialogRemoved = (await page.locator('#complex-theory-viewer-dialog').count()) === 0;
      record('Closing theory modal works cleanly', isDialogRemoved);
    }

    // -------------------------------------------------------------------------
    // 9. Console and Network Errors Summary
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Console & Network Errors ---');
    record('Zero Uncaught Exceptions / Console Errors', consoleErrors.length === 0, consoleErrors.map((e) => e.text).join('; '));
    record('Zero HTTP / Network Request Errors (4xx/5xx)', networkErrors.length === 0, networkErrors.map((e) => `${e.url} [${e.status}]`).join('; '));

  } catch (err) {
    console.error('\n[Runner Error]:', err);
    record('Execution completed without runner errors', false, err.message);
  } finally {
    await browser.close();
    if (serverProcess) {
      serverProcess.kill();
    }
  }

  // Summary
  console.log('\n========================================');
  console.log('       FINAL VERIFICATION SUMMARY       ');
  console.log('========================================');
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`Total Checks: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  if (failed === 0) {
    console.log('>>> VERIFICATION VERDICT: PASS (100% SUCCESS) <<<');
  } else {
    console.log('>>> VERIFICATION VERDICT: FAIL <<<');
  }
}

runAudit();
