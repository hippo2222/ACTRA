import { test, expect } from '../helpers/audit_fixture.mjs';
import { cleanUserByName, fetchLastEmailLink } from '../helpers/db_helper.mjs';

const TEST_USER_NAME = 'AuditResilienceUser';
const TEST_USER_EMAIL = 'audit_resilience@localhost.test';
const TEST_USER_PASSWORD = 'resilience_password_123';
const MAILPIT_URL = 'http://127.0.0.1:8025';

test.describe('Scenario 7: System Resilience, Network Faults, and Empty Recommendations', () => {

  test.beforeEach(async ({ page }) => {
    // Disable auto-starting onboarding tours
    await page.context().addInitScript(() => {
      window.ACTRA_DISABLE_AUTO_ONBOARDING = true;
    });

    const baseURL = process.env.BASE_URL || 'http://localhost:8000';
    await cleanUserByName(baseURL, TEST_USER_NAME, TEST_USER_PASSWORD);

    // Register a fresh test user
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const startLearningBtn = page.locator('button:has-text("Начать обучение")').filter({ visible: true }).first();
    await startLearningBtn.click();
    await page.waitForSelector('#modeOnboarding', { state: 'visible' });

    await page.fill('#onboardingName', TEST_USER_NAME);
    await page.fill('#onboardingEmail', TEST_USER_EMAIL);
    await page.fill('#onboardingPassword', TEST_USER_PASSWORD);
    await page.fill('#onboardingPasswordConfirm', TEST_USER_PASSWORD);
    await page.check('#onboardingAcceptTerms');
    await page.check('#onboardingAcceptPrivacy');
    await page.check('#onboardingAcceptRefund');
    await page.click('#onboardingCreateBtn');

    await page.waitForSelector('#onboardingVerificationPanel', { state: 'visible' });

    const verifyLink = await fetchLastEmailLink(
      MAILPIT_URL,
      TEST_USER_EMAIL,
      /href="([^"]+verify_email_token=[^"]+)"/
    );

    const verifyPage = await page.context().newPage();
    await verifyPage.goto(verifyLink);
    await verifyPage.waitForLoadState('networkidle');
    await verifyPage.close();

    await page.click('#onboardingVerificationContinueBtn');
    await page.waitForURL('**/main');
  });

  test('7.1 S3 Upload Network/503 Fault Tolerance', async ({ page }) => {
    test.setTimeout(90000);
    // 1. Open the Theory Editor
    await page.goto('/editor/Theory_Editor.html');
    await page.waitForLoadState('networkidle');

    // 2. Intercept upload requests and mock a 503 service unavailable error (simulating S3 failure)
    await page.route('**/upload-image', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 's3_storage_unavailable' })
      });
    });

    // 3. Fill in the title and content
    await page.fill('#theory-title', 'Тестирование устойчивости');
    await page.fill('#theory-editor', 'Проверка поведения системы при отключении хранилища S3.');

    // 4. Trigger file upload
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('#theory-image-btn');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'broken_upload.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    });

    // 5. Verify that the UI displays a clean error toast notification
    await page.waitForSelector('#notify-toast-container div[role="status"]', { state: 'visible' });
    await page.captureAuditScreenshot('resilience_s3_upload_503_toast');

    // 6. Verify that the save button is still active and can save the text content
    await page.click('#theory-save-btn');
    await page.waitForSelector('#theory-status-pill:has-text("Теория сохранена")', { state: 'attached' });
    await page.captureAuditScreenshot('resilience_text_saved_after_upload_error');
  });

  test('7.2 Practice Session Recommendation End & Completion Redirect', async ({ page }) => {
    test.setTimeout(90000);
    // 1. Create a dummy session ID
    const dummySessionId = 'session_resilience_test_99999';

    // 2. Intercept the session details endpoint
    await page.route(`**/api/session/${dummySessionId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          item: {
            id: dummySessionId,
            complex_id: 'dummy_complex_id',
            iteration: 1,
            paused: false
          }
        })
      });
    });

    // Intercept complexes details fetch to return dummy name
    await page.route('**/api/complexes/dummy_complex_id', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          item: {
            id: 'dummy_complex_id',
            name: 'Резервный комплекс устойчивости'
          }
        })
      });
    });

    // Intercept current task fetch to return 410 (Session Completed)
    await page.route(`**/api/session/${dummySessionId}/task`, async (route) => {
      await route.fulfill({
        status: 410,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'session_completed' })
      });
    });

    // Intercept next task endpoint (HTTP 410)
    await page.route(`**/api/session/${dummySessionId}/task/next`, async (route) => {
      await route.fulfill({
        status: 410,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'session_completed' })
      });
    });

    // Intercept iteration results to allow redirection
    await page.route(`**/api/session/${dummySessionId}/results/iteration`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          results: {
            iteration: 1,
            has_next_iteration: false
          }
        })
      });
    });

    // Intercept final-results details fetch
    await page.route(`**/api/session/${dummySessionId}/final-results`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          results: {
            iteration: 1,
            has_next_iteration: false,
            score: { correct_count: 2, total_count: 2, percent: 100 },
            time_spent_seconds: 10,
            iterations_summary: [
              { iteration: 1, score: { correct_count: 2, total_count: 2, percent: 100 }, time_spent_seconds: 10 }
            ],
            wrong_tasks: []
          }
        })
      });
    });

    // Intercept iteration-results details fetch
    await page.route(`**/api/session/${dummySessionId}/iteration-results*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          results: {
            iteration: 1,
            has_next_iteration: false,
            score: { correct_count: 2, total_count: 2, percent: 100 },
            time_spent_seconds: 10
          }
        })
      });
    });

    // 3. Navigate to S1 session page with the dummy session ID
    await page.goto(`/session/${encodeURIComponent(dummySessionId)}`);
    await page.waitForLoadState('networkidle');

    // 4. Verify that the page redirects to the results page (/results)
    await page.waitForURL(`**/session/${dummySessionId}/results`);
    await page.captureAuditScreenshot('resilience_completed_session_redirect');
  });

});
