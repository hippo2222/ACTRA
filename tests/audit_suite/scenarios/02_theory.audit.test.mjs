import { test, expect } from '../helpers/audit_fixture.mjs';
import { cleanUserByName, fetchLastEmailLink } from '../helpers/db_helper.mjs';

const TEST_USER_NAME = 'AuditUser';
const TEST_USER_EMAIL = 'audit_user@localhost.test';
const TEST_USER_PASSWORD = 'audit_password_123';
const MAILPIT_URL = 'http://127.0.0.1:8025';

test.describe('Scenario 2: Theory Article Creation & Editing', () => {

  test.beforeEach(async ({ page }) => {
    // 1. Disable auto-starting onboarding tours to prevent race conditions and demo data pollution
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

  test('2.1 Theory Creation, S3 Simulated Upload, and Publication', async ({ page }) => {
    test.setTimeout(90000);
    // 1. Navigate to the Theory Editor page
    await page.goto('/editor/Theory_Editor.html');
    await page.waitForLoadState('networkidle');
    
    // 2. Audit empty state of the editor
    const titleInput = page.locator('#theory-title');
    const editorSurface = page.locator('#theory-editor');
    await expect(titleInput).toHaveValue('');
    await expect(editorSurface).toHaveText('');
    await page.captureAuditScreenshot('theory_editor_empty_state');

    // 3. Fill in the title and content
    const testTitle = 'Электромагнитные волны';
    const testBody = 'Электромагнитные волны — это электромагнитные колебания, распространяющиеся в пространстве с конечной скоростью.';
    await titleInput.fill(testTitle);
    await editorSurface.fill(testBody);
    await page.captureAuditScreenshot('theory_editor_text_filled');

    // 4. Save the theory manually
    await page.click('#theory-save-btn');
    await page.waitForSelector('#theory-status-pill:has-text("Теория сохранена")', { state: 'attached' });
    await page.captureAuditScreenshot('theory_editor_saved_manually');

    // 5. Upload a mock image via S3 simulated upload
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('#theory-image-btn');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'waves_chart.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    });

    // Wait for the uploaded image element to be inserted in the editor
    await page.waitForSelector('#theory-editor img.theory-image', { state: 'visible' });
    await page.captureAuditScreenshot('theory_editor_image_uploaded');

    // Save again after image upload
    await page.click('#theory-save-btn');
    await page.waitForSelector('#theory-status-pill:has-text("Теория сохранена")', { state: 'attached' });

    // 6. Get the theory ID from the updated URL query params
    const currentUrl = page.url();
    const theoryId = new URL(currentUrl).searchParams.get('theory_id');
    expect(theoryId).not.toBeNull();
    console.log(`[Scenario 2] Created theory ID: ${theoryId}`);

    // 7. Click publish button to trigger the publication modal (use $eval to bypass mobile overlay)
    await page.$eval('#theory-publish-btn', el => el.click());
    await page.waitForSelector('.bg-scrim', { state: 'visible' });
    await page.captureAuditScreenshot('theory_publish_modal_open');

    // 8. Select "access_code" visibility mode
    await page.$eval('input[name="theory-publish-visibility"][value="access_code"]', el => el.click());
    await page.captureAuditScreenshot('theory_publish_modal_code_selected');

    // 9. Publish version
    await page.$eval('button[data-role="publish-version"]', el => el.click());
    
    // Verify successful publication message (feedback element or any text confirmation)
    await page.locator(':text("Публикация обновлена")').waitFor({ state: 'attached', timeout: 30000 });
    await page.captureAuditScreenshot('theory_publish_modal_success');

    // Verify that the access code display is updated and is not empty
    const accessCodeEl = page.locator('#theory-publish-access-code');
    await expect(accessCodeEl).not.toContainText('Код будет создан после публикации');
    const accessCodeText = await accessCodeEl.textContent();
    console.log(`[Scenario 2] Generated Access Code: ${accessCodeText}`);

    // Close modal ($eval bypasses toast overlay that intercepts pointer events on mobile)
    await page.$eval('button[data-role="close"]', el => el.click());
    await page.waitForSelector('.bg-scrim', { state: 'detached' });
  });

  test('2.2 Autosave Drafts, Restoration, & Republishing', async ({ page }) => {
    test.setTimeout(90000);
    // 1. Open the editor to create a new blank theory
    await page.goto('/editor/Theory_Editor.html');
    await page.waitForLoadState('networkidle');

    // 2. Type some draft content
    const draftTitle = 'Временный черновик теории';
    const draftContent = 'Этот текст должен быть автоматически сохранен в sessionStorage как черновик.';
    await page.fill('#theory-title', draftTitle);
    await page.fill('#theory-editor', draftContent);

    // 3. Manually trigger autosave in page context (which has access to globals)
    await page.evaluate(() => {
      if (typeof theoryEditorState !== 'undefined') {
        theoryEditorState.dirty = true;
      }
      if (typeof saveTheoryDraftNow === 'function') {
        saveTheoryDraftNow();
      }
    });

    // 4. Reload the page to simulate navigating away
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 5. Verify that the custom confirmation dialog pops up asking to restore draft
    await page.waitForSelector('button[data-role="confirm"]', { state: 'visible' });
    await page.captureAuditScreenshot('restore_draft_confirm_visible');

    // 6. Click confirm to restore the draft
    await page.click('button[data-role="confirm"]');
    await page.waitForSelector('#theory-status-pill:has-text("Черновик восстановлен")', { state: 'attached' });

    // Verify the restored fields
    await expect(page.locator('#theory-title')).toHaveValue(draftTitle);
    await expect(page.locator('#theory-editor')).toContainText(draftContent);
    await page.captureAuditScreenshot('theory_draft_successfully_restored');

    // 7. Save the theory manually to create a database record
    await page.click('#theory-save-btn');
    await page.waitForSelector('#theory-status-pill:has-text("Теория сохранена")', { state: 'attached' });

    // 8. Publish the restored draft (use $eval to bypass mobile overlay)
    await page.$eval('#theory-publish-btn', el => el.click());
    await page.waitForSelector('.bg-scrim', { state: 'visible' });
    
    // Choose public visibility and publish
    await page.$eval('input[name="theory-publish-visibility"][value="public"]', el => el.click());
    await page.$eval('button[data-role="publish-version"]', el => el.click());
    
    // Verify publish success
    await page.locator(':text("Публикация обновлена")').waitFor({ state: 'attached', timeout: 30000 });
    await page.captureAuditScreenshot('restored_theory_published_successfully');
  });

  test('2.3 Security: XSS Sanitization in Quill Delta', async ({ page }) => {
    test.setTimeout(90000);
    // 1. Navigate to the Theory Editor page
    await page.goto('/editor/Theory_Editor.html');
    await page.waitForLoadState('networkidle');

    // 2. Set the theory content using page.evaluate to inject malicious delta
    await page.evaluate(() => {
      const maliciousDelta = {
        ops: [
          { insert: 'Безопасный текст\n' },
          {
            insert: 'Вредоносная ссылка',
            attributes: {
              link: 'javascript:alert("XSS")'
            }
          },
          { insert: '\nЕще текст\n' }
        ]
      };
      if (typeof setTheoryEditorContent === 'function') {
        setTheoryEditorContent('Тест XSS безопасности', maliciousDelta);
      }
    });

    // 3. Save the theory
    await page.click('#theory-save-btn');
    await page.waitForSelector('#theory-status-pill:has-text("Теория сохранена")', { state: 'attached' });

    // 4. Get the theory ID from the updated URL query params
    const currentUrl = page.url();
    const theoryId = new URL(currentUrl).searchParams.get('theory_id');
    expect(theoryId).not.toBeNull();

    // 5. Fetch the saved theory content via backend API and verify sanitization
    const response = await page.evaluate(async (tid) => {
      const resp = await fetch(`/api/theories/${encodeURIComponent(tid)}`);
      return resp.json();
    }, theoryId);

    expect(response.ok).toBe(true);
    const savedDelta = response.item.delta;
    console.log('[XSS Test] Saved delta:', JSON.stringify(savedDelta));

    // Verify that the link attribute starting with "javascript:" was stripped
    const linkOp = savedDelta.ops.find(op => op.attributes && op.attributes.link);
    expect(linkOp).toBeUndefined(); // Should be undefined because the javascript: link should be sanitized/stripped
  });

});
