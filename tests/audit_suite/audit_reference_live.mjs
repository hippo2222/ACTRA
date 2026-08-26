import { chromium } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';

const PORT = 8000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/reference`, (res) => {
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

async function auditReference() {
  let serverProcess = null;
  const alreadyRunning = await isServerRunning();
  if (!alreadyRunning) {
    serverProcess = await startServer();
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const networkErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!t.includes('favicon.ico') && !t.includes('404')) {
        consoleErrors.push({ text: t, location: msg.location() });
      }
    }
  });

  page.on('pageerror', (err) => {
    consoleErrors.push({ text: err.message, stack: err.stack });
  });

  page.on('response', (res) => {
    const status = res.status();
    const url = res.url();
    if (status >= 400 && !url.includes('favicon.ico')) {
      networkErrors.push({ url, status, text: res.statusText() });
    }
  });

  try {
    console.log('--- Loading /reference page ---');
    await page.goto(`${BASE_URL}/reference`, { waitUntil: 'networkidle' });

    const title = await page.title();
    console.log('Page Title:', title);

    // Expand all categories so all buttons are visible and accessible
    const categoryToggles = page.locator('[data-reference-toggle-category]');
    const catCount = await categoryToggles.count();
    console.log(`Found ${catCount} categories, expanding all...`);
    for (let c = 0; c < catCount; c++) {
      await categoryToggles.nth(c).click();
      await page.waitForTimeout(100);
    }

    const tourButtons = page.locator('.reference-toc__tour-row [data-reference-tour-id]');
    const tourCount = await tourButtons.count();
    console.log(`\n--- Testing ${tourCount} unique tour entries in Reference Preview ---`);

    for (let i = 0; i < tourCount; i++) {
      const btn = tourButtons.nth(i);
      const tourId = await btn.getAttribute('data-reference-tour-id');
      const tourTitle = await btn.locator('.reference-toc__title').textContent();
      
      await btn.click();
      await page.waitForTimeout(700);

      const previewSrc = await page.locator('[data-reference-preview-frame]').getAttribute('src');
      const noticeText = await page.locator('[data-reference-preview-notice]').textContent();

      console.log(`[Tour ${i + 1}/${tourCount}] ${tourId} ("${tourTitle?.trim()}")`);
      console.log(`  -> iframe src: ${previewSrc}`);
      if (noticeText && noticeText.trim()) {
        console.log(`  -> Notice: ${noticeText.trim()}`);
      }
    }

    console.log('\n--- Console Errors on /reference ---');
    console.log(`Total console errors: ${consoleErrors.length}`);
    consoleErrors.forEach((e) => console.log(`  ERROR: ${e.text}`));

    console.log('\n--- Network Errors on /reference ---');
    console.log(`Total network errors: ${networkErrors.length}`);
    networkErrors.forEach((e) => console.log(`  NET ERR: ${e.url} [${e.status}]`));
  } finally {
    await browser.close();
    if (serverProcess) {
      serverProcess.kill();
    }
  }
}

auditReference().catch((err) => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
