import { test, expect } from '../helpers/audit_fixture.mjs';
import { cleanUserByName, fetchLastEmailLink } from '../helpers/db_helper.mjs';

const TEST_USER_NAME = 'AuditUser';
const TEST_USER_EMAIL = 'audit_user@localhost.test';
const TEST_USER_PASSWORD = 'audit_password_123';
const MAILPIT_URL = 'http://127.0.0.1:8025';

test.describe('Scenario 1: Welcome, Registration & Access Recovery', () => {
  
  test.beforeAll(async () => {
    const baseURL = process.env.BASE_URL || 'http://localhost:8000';
    // Clear out any existing audit user before the test starts to ensure a clean state
    await cleanUserByName(baseURL, TEST_USER_NAME, TEST_USER_PASSWORD);
  });

  test('1.1 Registration Flow', async ({ page }) => {
    test.setTimeout(90000);
    // 1. Land on the welcome page
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.captureAuditScreenshot('welcome_page_loaded');

    // 2. Click "Начать обучение" button to open registration form
    const startLearningBtn = page.locator('button:has-text("Начать обучение")').filter({ visible: true }).first();
    await startLearningBtn.click();
    await page.waitForSelector('#modeOnboarding', { state: 'visible' });
    await page.captureAuditScreenshot('registration_form_visible');

    // 3. Fill in the form but with a short password to test validation
    await page.fill('#onboardingName', TEST_USER_NAME);
    await page.fill('#onboardingEmail', TEST_USER_EMAIL);
    await page.fill('#onboardingPassword', '123'); // short password
    await page.fill('#onboardingPasswordConfirm', '123');

    // Accept legal checkboxes
    await page.check('#onboardingAcceptTerms');
    await page.check('#onboardingAcceptPrivacy');
    await page.check('#onboardingAcceptRefund');

    // Submit and audit validation UI
    await page.click('#onboardingCreateBtn');
    const errorMsgLocator = page.locator('#onboardingError');
    await expect(errorMsgLocator).toBeVisible();
    await page.captureAuditScreenshot('registration_validation_error');

    // 4. Fill in a valid password
    await page.fill('#onboardingPassword', TEST_USER_PASSWORD);
    await page.fill('#onboardingPasswordConfirm', TEST_USER_PASSWORD);
    await page.captureAuditScreenshot('registration_form_filled_correctly');

    // 5. Submit form
    await page.click('#onboardingCreateBtn');

    // 6. Audit email verification screen
    await page.waitForSelector('#onboardingVerificationPanel', { state: 'visible' });
    await page.captureAuditScreenshot('onboarding_verification_panel');

    // 7. Polling Mailpit to fetch the email verification link
    const verifyLink = await fetchLastEmailLink(
      MAILPIT_URL,
      TEST_USER_EMAIL,
      /href="([^"]+verify_email_token=[^"]+)"/
    );

    // 8. Open verify link in a new tab to verify the user email
    const verifyPage = await page.context().newPage();
    await verifyPage.goto(verifyLink);
    await verifyPage.waitForLoadState('networkidle');
    await verifyPage.close();

    // 9. Now click "Перейти в ACTRA" button on the onboarding verification panel
    await page.click('#onboardingVerificationContinueBtn');

    // 10. Verify navigation to the main page (/main)
    await page.waitForURL('**/main');
    await page.waitForLoadState('networkidle');
    await page.captureAuditScreenshot('dashboard_loaded_first_time');

    // 11. Skip onboarding tour if active
    const tourCloseBtn = page.locator('.introjs-skipbutton');
    if (await tourCloseBtn.count() > 0) {
      await tourCloseBtn.click();
      await page.waitForTimeout(500);
    }
    
    // 12. Verify empty state of the dashboard
    await page.captureAuditScreenshot('dashboard_empty_state');
  });

  test('1.2 Password Recovery Flow', async ({ page }) => {
    test.setTimeout(90000);
    // 1. Navigate back to the welcome page to verify logout and recovery
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Select "Войти" (Log in)
    const loginCard = page.locator('button:has-text("Войти")').first();
    await loginCard.click();
    await page.waitForSelector('#modeLogin', { state: 'visible' });
    
    // 2. Open forgot password modal
    await page.click('#forgotPasswordLink');
    await page.waitForSelector('#forgotPasswordModal', { state: 'visible' });
    await page.captureAuditScreenshot('forgot_password_modal_open');

    // 3. Fill in email for recovery
    await page.fill('#forgotPasswordIdentifierInput', TEST_USER_EMAIL);
    await page.captureAuditScreenshot('forgot_password_filled');

    // 4. Submit recovery request
    await page.click('#forgotPasswordRequestBtn');
    
    // Wait for recovery email sent success status
    await page.waitForSelector('#forgotPasswordRequestStatus.text-success', { state: 'visible' });
    await page.captureAuditScreenshot('forgot_password_request_success');

    // 5. Fetch reset link from Mailpit
    const resetLink = await fetchLastEmailLink(
      MAILPIT_URL,
      TEST_USER_EMAIL,
      /href="([^"]+reset_password_token=[^"]+)"/
    );

    // 6. Navigate to the reset link in the browser
    await page.goto(resetLink);
    await page.waitForLoadState('networkidle');
    
    // The page should auto-open the reset password panel of the modal
    await page.waitForSelector('#forgotPasswordModal', { state: 'visible' });
    await page.waitForSelector('#forgotPasswordResetPanel', { state: 'visible' });
    await page.captureAuditScreenshot('reset_password_panel_visible');

    // 7. Enter new password
    const NEW_PASSWORD = 'new_audit_password_123';
    await page.fill('#forgotPasswordNewPassword', NEW_PASSWORD);
    await page.fill('#forgotPasswordConfirmPassword', NEW_PASSWORD);
    await page.captureAuditScreenshot('reset_password_filled');

    // 8. Submit password reset (it automatically logs user in and redirects to /main)
    await page.click('#forgotPasswordResetBtn');
    
    // Wait for successful auto-login navigation to /main
    await page.waitForURL('**/main');
    await page.waitForLoadState('networkidle');
    await page.captureAuditScreenshot('dashboard_loaded_after_password_reset');

    // 9. Now log out and try logging in manually with the new password
    await page.evaluate(async () => await fetch('/api/auth/logout', { method: 'POST' }));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Go to login mode
    const loginBtn = page.locator('button:has-text("Войти")').first();
    await loginBtn.click();
    await page.waitForSelector('#modeLogin', { state: 'visible' });

    // Login with new credentials
    await page.fill('#loginIdentifier', TEST_USER_EMAIL);
    await page.fill('#loginPassword', NEW_PASSWORD);
    await page.click('#loginSubmitBtn');

    // Verify successful login
    await page.waitForURL('**/main');
    await page.waitForLoadState('networkidle');
    await page.captureAuditScreenshot('dashboard_loaded_after_manual_login_with_new_password');
  });

});
