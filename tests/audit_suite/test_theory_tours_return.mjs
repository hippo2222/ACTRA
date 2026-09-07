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
    console.log('[Test] Server already running at', BASE_URL);
    return null;
  }
  console.log('[Test] Starting local Flask server...');
  const pythonPath = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python';
  const cleanEnv = { ...process.env, TRAINER_HTTP_PORT: '8000' };
  delete cleanEnv.ACTRA_RUNTIME_MODE;
  const serverProcess = spawn(pythonPath, ['desktop-app/server.py'], {
    cwd: process.cwd(),
    env: cleanEnv,
    stdio: 'ignore',
  });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await checkServerReady(BASE_URL)) {
      console.log('[Test] Flask server is ready!');
      return serverProcess;
    }
  }
  throw new Error('Server failed to start');
}

async function run() {
  const server = await startServerIfNeeded();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  console.log('\n=== Authenticating User ===');
  await page.goto(`${BASE_URL}/`);
  await page.evaluate(async () => {
    try {
      let usersResp = await fetch('/api/users');
      let users = await usersResp.json();
      let uid = users.users?.[0]?.id || users.users?.[0]?.user_id;
      if (!uid) {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Тестовый Пользователь', role: 'student' }),
        });
        const created = await res.json();
        uid = created.user?.id || created.user?.user_id;
      }
      if (uid) {
        await fetch('/api/users/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: uid }),
        });
      }
    } catch (e) {
      console.error('Auth error in page:', e);
    }
  });
  await page.waitForTimeout(500);

  console.log('\n=== TEST 1: Theory Center Library Tour (Reference Preview) ===');
  await page.goto(`${BASE_URL}/theory-center?onboarding_preview=theory-center-library&reference_embed=1`, { waitUntil: 'networkidle' });
  console.log('Page URL:', page.url());
  await page.waitForSelector('.onboarding-tour-control', { state: 'visible', timeout: 5000 });

  let label1 = await page.textContent('.onboarding-tour-control-label');
  console.log('Step 1 label:', label1.trim());
  if (!label1.includes('1/2')) throw new Error(`Expected step 1/2, got ${label1}`);

  let nextBtn = page.locator('.onboarding-tour-control [data-onboarding-action="next"]');
  let nextText = (await nextBtn.textContent()).trim();
  console.log('Step 1 primary button:', nextText);
  if (nextText !== 'Далее') throw new Error(`Expected "Далее", got "${nextText}"`);

  // Click Next -> Step 2
  await nextBtn.click();
  await page.waitForSelector('.onboarding-tour-control-label:has-text("2/2")', { timeout: 6000 });

  let label2 = await page.textContent('.onboarding-tour-control-label');
  console.log('Step 2 label:', label2.trim());

  let step2Primary = page.locator('.onboarding-tour-control .onboarding-tour-button--primary');
  let step2Action = await step2Primary.getAttribute('data-onboarding-action');
  let step2Text = (await step2Primary.textContent()).trim();
  console.log(`Step 2 primary button: action="${step2Action}", text="${step2Text}"`);

  if (step2Action !== 'prev' || step2Text !== 'Вернуться') {
    throw new Error(`Expected primary button "Вернуться" (action="prev"), but found "${step2Text}" (action="${step2Action}")`);
  }

  // Click "Вернуться" -> Should go back to Step 1
  await step2Primary.click();
  await page.waitForSelector('.onboarding-tour-control-label:has-text("1/2")', { timeout: 6000 });

  let labelAfterBack = await page.textContent('.onboarding-tour-control-label');
  console.log('Step after clicking "Вернуться":', labelAfterBack.trim());

  console.log('PASS: Theory Center returns to previous state correctly!');

  console.log('\n=== TEST 2: Theory Editor Authoring Tour (Reference Preview) ===');
  await page.goto(`${BASE_URL}/theory-editor?onboarding_preview=theory-editor-authoring&reference_embed=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.onboarding-tour-control', { state: 'visible', timeout: 5000 });

  let teLabel1 = await page.textContent('.onboarding-tour-control-label');
  console.log('TE Step 1 label:', teLabel1.trim());
  if (!teLabel1.includes('1/3')) throw new Error(`Expected step 1/3, got ${teLabel1}`);

  // Next -> Step 2
  await page.click('.onboarding-tour-control [data-onboarding-action="next"]');
  await page.waitForSelector('.onboarding-tour-control-label:has-text("2/3")', { timeout: 6000 });
  let teLabel2 = await page.textContent('.onboarding-tour-control-label');
  console.log('TE Step 2 label:', teLabel2.trim());

  // Next -> Step 3
  await page.click('.onboarding-tour-control [data-onboarding-action="next"]');
  await page.waitForSelector('.onboarding-tour-control-label:has-text("3/3")', { timeout: 6000 });
  let teLabel3 = await page.textContent('.onboarding-tour-control-label');
  console.log('TE Step 3 label:', teLabel3.trim());

  let teStep3Primary = page.locator('.onboarding-tour-control .onboarding-tour-button--primary');
  let teStep3Action = await teStep3Primary.getAttribute('data-onboarding-action');
  let teStep3Text = (await teStep3Primary.textContent()).trim();
  console.log(`TE Step 3 primary button: action="${teStep3Action}", text="${teStep3Text}"`);

  if (teStep3Action !== 'prev' || teStep3Text !== 'Вернуться') {
    throw new Error(`Expected primary button "Вернуться" (action="prev"), but found "${teStep3Text}" (action="${teStep3Action}")`);
  }

  // Click "Вернуться" -> Should go back to Step 2
  await teStep3Primary.click();
  await page.waitForSelector('.onboarding-tour-control-label:has-text("2/3")', { timeout: 6000 });

  let teLabelAfterBack = await page.textContent('.onboarding-tour-control-label');
  console.log('TE Step after clicking "Вернуться":', teLabelAfterBack.trim());

  console.log('PASS: Theory Editor returns to previous state correctly!');

  console.log('\n=== TEST 3: Demo State Restoration on Tour Finish ===');
  // Load Theory Center with tour, then finish it via Close
  await page.goto(`${BASE_URL}/theory-center?onboarding_preview=theory-center-library`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.onboarding-tour-control', { state: 'visible', timeout: 5000 });

  // Click Close button
  await page.click('.onboarding-tour-control [data-onboarding-action="skip"]');
  await page.waitForTimeout(500);

  const isTourActive = await page.evaluate(() => document.body.classList.contains('onboarding-tour-active'));
  const bodyTourId = await page.evaluate(() => document.body.dataset.onboardingTourId);
  const urlSearchParams = await page.evaluate(() => window.location.search);
  console.log('After finish: isTourActive =', isTourActive, ', bodyTourId =', bodyTourId, ', searchParams =', urlSearchParams);

  if (isTourActive || bodyTourId) {
    throw new Error('Tour overlay should be inactive after finishing');
  }
  if (urlSearchParams.includes('onboarding_preview')) {
    throw new Error('URL params should be cleaned after finishing tour');
  }
  console.log('PASS: Demo state cleanup and restoration verified!');

  if (pageErrors.length) {
    throw new Error('Page errors detected: ' + JSON.stringify(pageErrors));
  }

  console.log('\n========================================');
  console.log('ALL VERIFICATION CHECKS PASSED (100%)');
  console.log('========================================');

  await browser.close();
  if (server) server.kill();
}

run().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
