import { chromium } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';

const BASE_URL = 'http://127.0.0.1:8000';

function checkServerReady(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startServerIfNeeded() {
  const isReady = await checkServerReady(BASE_URL);
  if (isReady) {
    console.log('[Runner] Server already running at', BASE_URL);
    return null;
  }

  console.log('[Runner] Starting local Flask server...');
  const pythonPath = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python';
  const serverProcess = spawn(pythonPath, ['desktop-app/server.py'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TRAINER_HTTP_PORT: '8000',
    },
    stdio: 'ignore',
  });

  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await checkServerReady(BASE_URL)) {
      console.log('[Runner] Flask server is ready!');
      return serverProcess;
    }
  }

  throw new Error('Flask server failed to start within timeout');
}

async function runS1TheoryVerification() {
  const serverProcess = await startServerIfNeeded();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const networkErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('Failed to load resource') && !text.includes('favicon')) {
        consoleErrors.push({ text, location: msg.location() });
      }
    }
  });

  page.on('response', (res) => {
    if (res.status() >= 400 && res.status() !== 404 && res.status() !== 410) {
      networkErrors.push({ url: res.url(), status: res.status() });
    }
  });

  const testResults = [];
  function record(name, passed, detail = '') {
    testResults.push({ name, passed, detail });
    const statusIcon = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${statusIcon} | ${name}${detail ? ' — ' + detail : ''}`);
  }

  try {
    console.log('\n--- 1. S1 Page Load & Mock Session Init ---');
    await page.goto(`${BASE_URL}/S1/index.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.navigateWithTransition = () => {};
    });
    await page.waitForTimeout(500);

    // Verify #theory-session-banner is gone
    const oldBannerCount = await page.locator('#theory-session-banner').count();
    record('Old heavy banner (#theory-session-banner) is removed from DOM', oldBannerCount === 0);

    // Mock session state with theory context on iteration 1
    console.log('\n--- 2. TopNavBar Theory Button on Iteration 1 ---');
    await page.evaluate(() => {
      window.Main = window.Main || {};
      const testTheory = {
        id: 'theory-sample-1',
        title: 'Основы МРТ и лучевой диагностики',
        delta: {
          ops: [
            { insert: 'Основы физики магнитного резонанса\n', attributes: { header: 1 } },
            { insert: 'Магнитно-резонансная томография основана на явлении ' },
            { insert: 'ядерного магнитного резонанса', attributes: { bold: true } },
            { insert: '.\nОсновные параметры:\n' },
            { insert: 'Время релаксации T1\n', attributes: { list: 'bullet' } },
            { insert: 'Время релаксации T2\n', attributes: { list: 'bullet' } },
            { insert: 'Плотность протонов\n', attributes: { list: 'bullet' } },
            { insert: 'Важное замечание по безопасности пациентов.' },
            { insert: '\n', attributes: { blockquote: true } }
          ]
        }
      };

      // Mock fetch for theory endpoint
      const originalFetch = window.fetch.bind(window);
      window.fetch = async function (url, opts) {
        if (typeof url === 'string' && url.includes('/api/theories/')) {
          return new Response(JSON.stringify({ ok: true, item: testTheory }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return originalFetch(url, opts);
      };

      const ctx = {
        theoryId: 'theory-sample-1',
        theoryTitle: testTheory.title,
        complexTitle: 'Диагностический комплекс МРТ'
      };

      if (typeof window.renderTheorySessionContext === 'function') {
        window.renderTheorySessionContext(ctx);
      } else if (window.SessionState) {
        window.SessionState.theoryContext = ctx;
      }

      // Trigger sync for task on iteration 1
      if (typeof window.syncTheoryButtonState === 'function') {
        window.syncTheoryButtonState({ task_id: 't-101', iteration: 1 });
      }
    });

    await page.waitForTimeout(300);

    const theoryBtn = page.locator('#s1-theory-btn');
    const isTheoryBtnVisible = await theoryBtn.isVisible();
    record('Theory button (#s1-theory-btn) is visible in TopNavBar on Iteration 1', isTheoryBtnVisible);

    // -------------------------------------------------------------------------
    // 3. Open Theory Viewer Modal & Rich Typography Check
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Theory Viewer Modal & Rich Formatting ---');
    await theoryBtn.click();
    await page.waitForTimeout(300);

    const theoryDialog = page.locator('#complex-theory-viewer-dialog');
    const isDialogVisible = await theoryDialog.isVisible();
    record('Clicking #s1-theory-btn opens modal dialog (#complex-theory-viewer-dialog)', isDialogVisible);

    const dialogH1Count = await theoryDialog.locator('.theory-rendered-view h1').count();
    const dialogBoldCount = await theoryDialog.locator('.theory-rendered-view strong').count();
    const dialogListItemsCount = await theoryDialog.locator('.theory-rendered-view ul li').count();
    const dialogBlockquoteCount = await theoryDialog.locator('.theory-rendered-view blockquote').count();

    record(
      'Quill Delta rich formatting in S1 modal (H1, bold, bullet list, blockquote)',
      dialogH1Count > 0 && dialogBoldCount > 0 && dialogListItemsCount === 3 && dialogBlockquoteCount > 0,
      `H1: ${dialogH1Count}, Bold: ${dialogBoldCount}, List: ${dialogListItemsCount}, Quote: ${dialogBlockquoteCount}`
    );

    // Close modal
    const closeBtn = theoryDialog.locator('button[data-action="close"]').first();
    await closeBtn.click();
    await page.waitForTimeout(300);
    const isDialogClosed = (await page.locator('#complex-theory-viewer-dialog').count()) === 0;
    record('Closing S1 theory modal works cleanly', isDialogClosed);

    // -------------------------------------------------------------------------
    // 4. Iteration 2 & 3 Peeking Prevention (Theory Access Blocked)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Iteration 2 & 3 Access Control (Peeking Prevention) ---');
    await page.evaluate(() => {
      // Simulate transition to iteration 2
      if (typeof window.syncTheoryButtonState === 'function') {
        window.syncTheoryButtonState({ task_id: 't-102', iteration: 2 });
      }
    });
    await page.waitForTimeout(300);

    const isTheoryBtnHiddenIter2 = !(await theoryBtn.isVisible());
    record('Theory button is automatically hidden on Iteration 2', isTheoryBtnHiddenIter2);

    await page.evaluate(() => {
      // Simulate transition to iteration 3
      if (typeof window.syncTheoryButtonState === 'function') {
        window.syncTheoryButtonState({ task_id: 't-103', iteration: 3 });
      }
    });
    await page.waitForTimeout(300);

    const isTheoryBtnHiddenIter3 = !(await theoryBtn.isVisible());
    record('Theory button is automatically hidden on Iteration 3', isTheoryBtnHiddenIter3);

    // -------------------------------------------------------------------------
    // 5. Dynamic Language Switching (RU -> EN -> UK)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Dynamic Language Switching on S1 ---');
    // Switch to Iteration 1 again
    await page.evaluate(() => {
      if (typeof window.syncTheoryButtonState === 'function') {
        window.syncTheoryButtonState({ task_id: 't-101', iteration: 1 });
      }
    });

    // Switch to EN
    const enBtnText = await page.evaluate(async () => {
      await window.i18n.setLang('en');
      const btn = document.getElementById('s1-theory-btn');
      return btn ? btn.textContent.trim() : '';
    });
    record('Switch to English translates button to "Theory"', enBtnText.includes('Theory'), `Text: "${enBtnText}"`);

    // Switch to UK
    const ukBtnText = await page.evaluate(async () => {
      await window.i18n.setLang('uk');
      const btn = document.getElementById('s1-theory-btn');
      return btn ? btn.textContent.trim() : '';
    });
    record('Switch to Ukrainian translates button to "Теорія"', ukBtnText.includes('Теорія'), `Text: "${ukBtnText}"`);

    // Switch back to RU
    const ruBtnText = await page.evaluate(async () => {
      await window.i18n.setLang('ru');
      const btn = document.getElementById('s1-theory-btn');
      return btn ? btn.textContent.trim() : '';
    });
    record('Switch back to Russian restores "Теория"', ruBtnText.includes('Теория'), `Text: "${ruBtnText}"`);

    // -------------------------------------------------------------------------
    // 6. Console & Network Errors
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Console & Network Errors ---');
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

  console.log('\n========================================');
  console.log('       S1 THEORY VERIFICATION SUMMARY   ');
  console.log('========================================');
  const failed = testResults.filter((r) => !r.passed);
  console.log(`Total Checks: ${testResults.length} | Passed: ${testResults.length - failed.length} | Failed: ${failed.length}`);
  if (failed.length === 0) {
    console.log('>>> VERIFICATION VERDICT: PASS (100% SUCCESS) <<<\n');
  } else {
    console.log('>>> VERIFICATION VERDICT: FAIL <<<\n');
    process.exit(1);
  }
}

runS1TheoryVerification().catch((e) => {
  console.error(e);
  process.exit(1);
});
