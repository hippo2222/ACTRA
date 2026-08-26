import { test, expect } from '../helpers/audit_fixture.mjs';
import { cleanUserByName, fetchLastEmailLink } from '../helpers/db_helper.mjs';

const TEST_AUTHOR_NAME = 'AuditAuthor';
const TEST_AUTHOR_EMAIL = 'audit_author@localhost.test';
const TEST_AUTHOR_PASSWORD = 'audit_password_123';

const TEST_STUDENT_NAME = 'AuditStudent';
const TEST_STUDENT_EMAIL = 'audit_student@localhost.test';
const TEST_STUDENT_PASSWORD = 'audit_password_123';

const MAILPIT_URL = 'http://127.0.0.1:8025';

// Helper function to register and verify a user
async function registerAndVerifyUser(page, name, email, password) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const startLearningBtn = page.locator('button:has-text("Начать обучение")').filter({ visible: true }).first();
  await startLearningBtn.click();
  await page.waitForSelector('#modeOnboarding', { state: 'visible' });

  await page.fill('#onboardingName', name);
  await page.fill('#onboardingEmail', email);
  await page.fill('#onboardingPassword', password);
  await page.fill('#onboardingPasswordConfirm', password);
  await page.check('#onboardingAcceptTerms');
  await page.check('#onboardingAcceptPrivacy');
  await page.check('#onboardingAcceptRefund');
  await page.click('#onboardingCreateBtn');

  await page.waitForSelector('#onboardingVerificationPanel', { state: 'visible' });

  const verifyLink = await fetchLastEmailLink(
    MAILPIT_URL,
    email,
    /href="([^"]+verify_email_token=[^"]+)"/
  );

  const verifyPage = await page.context().newPage();
  await verifyPage.goto(verifyLink);
  await verifyPage.waitForLoadState('domcontentloaded');
  await verifyPage.close();

  await page.click('#onboardingVerificationContinueBtn');
  await page.waitForURL('**/main');
}

// 100x100 solid color PNG for click task verification
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAANElEQVR42u3PMQEAAAgEIDfq3zSmyAecgIF1NREICAgICAgICAgICAgICAgICAgICAgICAjIDR1E2gABtrR4sgAAAABJRU5ErkJggg==';

test.describe('Scenario 5: Practice Session E2E', () => {

  test.beforeEach(async ({ page }) => {
    test.setTimeout(80000);

    // Disable onboarding tours globally
    await page.context().addInitScript(() => {
      window.ACTRA_DISABLE_AUTO_ONBOARDING = true;
      
      let dummyInstance = {
        init: () => {},
        start: () => Promise.resolve(),
        startIfUnseen: () => Promise.resolve(),
        refreshHelpButtons: () => {}
      };
      
      Object.defineProperty(window, 'OnboardingTour', {
        get: () => dummyInstance,
        set: (val) => {
          dummyInstance = {
            ...val,
            start: () => Promise.resolve(),
            startIfUnseen: () => Promise.resolve()
          };
        },
        configurable: true
      });
    });
  });

  test('5.1-5.3 Practice Session Flow with Access Code, Test & Click Tasks, Results', async ({ page }) => {
    test.setTimeout(120000);
    const baseURL = process.env.BASE_URL || 'http://localhost:8000';

    // 1. Clean DB states for all users
    await cleanUserByName(baseURL, 'AuditUser', 'audit_password_123');
    await cleanUserByName(baseURL, TEST_AUTHOR_NAME, TEST_AUTHOR_PASSWORD);
    await cleanUserByName(baseURL, TEST_STUDENT_NAME, TEST_STUDENT_PASSWORD);

    // 2. Register Author
    await registerAndVerifyUser(page, TEST_AUTHOR_NAME, TEST_AUTHOR_EMAIL, TEST_AUTHOR_PASSWORD);

    // 3. Pre-create Module, Topic, 2 Tasks (Test, Click), and 1 Theory via API under Author's session
    await page.evaluate(async ({ TEST_IMAGE_BASE64 }) => {
      const catalogRes = await fetch('/api/editor/catalog');
      const catalogData = await catalogRes.json();
      const modules = catalogData.modules || [];
      
      let moduleId = '';
      const existingMod = modules.find(m => m.name === 'Модуль Радиофизики');
      if (existingMod) {
        moduleId = existingMod.id;
      } else {
        const resMod = await fetch('/api/editor/module/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Модуль Радиофизики' })
        });
        const dataMod = await resMod.json();
        moduleId = dataMod.module_id;
      }
      
      const mod = modules.find(m => m.id === moduleId);
      const existingTopic = mod?.topics?.find(t => t.name === 'Раздел Электромагнетизм');
      if (!existingTopic && moduleId) {
        await fetch('/api/editor/topic/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ module_id: moduleId, name: 'Раздел Электромагнетизм' })
        });
      }

      // Task 1: Test Type (Multiple choice)
      const resBoot1 = await fetch('/api/editor/task/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: 'modul_radiofiziki',
          topic_id: 'razdel_elektromagnetizm',
          task_id: 'task_test_freq',
          task_type: 'test',
          task_name: 'Тест выбора ответа частоты'
        })
      });
      const dataBoot1 = await resBoot1.json();
      const taskData1 = dataBoot1.task.task_data;
      taskData1.content = {
        test_type: 'single_choice',
        questions: [
          {
            id: 'q1',
            text: 'В каких единицах измеряется частота электромагнитных волн?',
            answers: [
              { text: 'Герцы (Гц)', correct: true },
              { text: 'Метры (м)', correct: false }
            ]
          }
        ]
      };
      await fetch('/api/editor/task/modul_radiofiziki/razdel_elektromagnetizm/task_test_freq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData1)
      });

      // Task 2: Click Type (Point annotation)
      const resBoot2 = await fetch('/api/editor/task/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: 'modul_radiofiziki',
          topic_id: 'razdel_elektromagnetizm',
          task_id: 'task_click_ant',
          task_type: 'click',
          task_name: 'Тест клика по антенне'
        })
      });
      // Upload image for click task first to get asset_id
      const byteCharacters = atob(TEST_IMAGE_BASE64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], {type: 'image/png'});
      const formData = new FormData();
      formData.append('file', blob, 'antenna.png');
      formData.append('module', 'modul_radiofiziki');
      formData.append('topic', 'razdel_elektromagnetizm');
      formData.append('task', 'task_click_ant');
      const uploadRes = await fetch('/api/editor/upload-image', {
        method: 'POST',
        body: formData
      });
      const uploadData = await uploadRes.json();

      const dataBoot2 = await resBoot2.json();
      const taskData2 = dataBoot2.task.task_data;
      taskData2.content = {
        image: 'antenna.png',
        image_asset_id: uploadData.asset_id,
        image_asset_url: uploadData.asset_url,
        prompt: 'Кликните на антенну',
        required_correct: 1,
        annotations: [{ id: 'a1', type: 'polygon', points: [[0, 0], [100, 0], [100, 100], [0, 100]] }]
      };
      await fetch('/api/editor/task/modul_radiofiziki/razdel_elektromagnetizm/task_click_ant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData2)
      });

      // Theory
      await fetch('/api/theories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Теория электромагнитных волн',
          delta: { ops: [{ insert: 'Введение в теорию волн...' }] }
        })
      });
    }, { TEST_IMAGE_BASE64 });

    // 4. Create and publish complex by Author
    await page.goto('/complexes/create');
    await page.waitForSelector('#save-btn', { state: 'visible' });
    await page.waitForSelector('.module-card-header', { state: 'visible' });
    await page.waitForLoadState('networkidle');
    await page.fill('#name', 'Комплекс радиоволнового контроля');
    await page.fill('#description', 'Пройдите практику по определению частот и поиску оборудования.');

    // Link theory (only expand if collapsed)
    const chevronText = await page.locator('#theory-header-chevron').textContent();
    if (chevronText.trim() === 'add') {
      await page.click('#theory-header');
    }
    await page.selectOption('#theory-mode', 'link');
    await page.dispatchEvent('#theory-mode', 'change');
    await page.waitForSelector('#theory-link-picker option:has-text("Теория электромагнитных волн")', { state: 'attached' });
    await page.selectOption('#theory-link-picker', { label: 'Теория электромагнитных волн' });

    // Add tasks
    await page.click('.module-card-header');
    await page.click('.topic-card-header');
    await page.locator('input[data-task-ref*="task_test_freq"]').check();
    await page.locator('input[data-task-ref*="task_click_ant"]').check();
    await page.click('#add-from-catalog');

    // Save complex
    await page.route('**/api/complexes*', async route => {
      const request = route.request();
      const method = request.method();
      if (method === 'POST' || method === 'PUT') {
        const postData = JSON.parse(request.postData() || '{}');
        postData.settings = postData.settings || {};
        postData.settings.max_iterations = 1;
        postData.settings.adaptive_difficulty = false;
        await route.continue({ postData: JSON.stringify(postData) });
      } else {
        await route.continue();
      }
    });

    await page.click('#save-btn');
    await page.waitForURL(url => url.searchParams.has('id'));

    // Publish complex with access code
    await page.click('#publish-btn');
    await page.waitForSelector('button[data-action="publish-version"]', { state: 'visible' });
    await page.locator('input[name="complex-publish-visibility"][value="access_code"]').click();
    await page.click('button[data-action="publish-version"]');

    // Read access code
    await page.waitForSelector('#complex-publish-access-box:not(.hidden)', { state: 'visible' });
    await page.waitForFunction(() => {
      const el = document.getElementById('complex-publish-access-code');
      return el && el.textContent.trim() !== '' && !el.textContent.includes('Код будет создан');
    });
    const rawAccessCode = await page.locator('#complex-publish-access-code').textContent();
    expect(rawAccessCode).not.toBeNull();
    const accessCode = rawAccessCode.trim();
    console.log(`[Scenario 5] Generated Access Code: ${accessCode}`);

    // Log out Author
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());

    // 5. Register Student
    await registerAndVerifyUser(page, TEST_STUDENT_NAME, TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD);

    // 6. Go to Complexes dashboard & add complex by code
    await page.goto('/complexes');
    await page.waitForSelector('#add-complex-by-code', { state: 'visible' });
    await page.captureAuditScreenshot('student_complexes_dashboard_empty');

    await page.click('#add-complex-by-code');
    await page.waitForSelector('input[data-role="access-input"]', { state: 'visible' });
    await page.fill('input[data-role="access-input"]', accessCode);
    await page.captureAuditScreenshot('student_entering_code');
    await page.click('form[data-role="access-form"] button[type="submit"]');

    // Wait for confirm dialog and confirm
    await page.waitForSelector('button[data-role="confirm"]', { state: 'visible' });
    await page.captureAuditScreenshot('student_confirm_addition_modal');
    await page.click('button[data-role="confirm"]');

    // Verify card is added
    const complexCard = page.locator('[data-complex-card-id]');
    await expect(complexCard).toBeVisible();
    await page.captureAuditScreenshot('student_complex_added_to_library');

    // 7. Start practice session
    const startBtn = complexCard.locator('button.start-btn');
    await startBtn.click();

    // Verify redirection to session URL
    await page.waitForURL(url => url.pathname.startsWith('/session/'));
    await page.waitForSelector('#task-content', { state: 'visible' });
    await page.captureAuditScreenshot('session_started_first_task');

    // 8. Practice session - Dynamic order handling
    const isClickFirst = await page.locator('[data-clickui="viewport"] img').isVisible();
    const nextBtn = page.locator('#next-task-btn');

    if (isClickFirst) {
      console.log("[Scenario 5] Click task is presented first");
      // Complete Click task (Task 1)
      const viewportImg = page.locator('[data-clickui="viewport"] img');
      await viewportImg.click();
      await page.captureAuditScreenshot('task_1_image_clicked');
      await page.click('#check-answer-btn');
      await expect(nextBtn).toBeEnabled();
      await page.captureAuditScreenshot('task_1_checked');
      await nextBtn.click();

      // Complete Test task (Task 2)
      await page.waitForSelector('.tui-option-enter', { state: 'visible' });
      await page.locator('.tui-option-enter', { hasText: 'Герцы (Гц)' }).click();
      await page.captureAuditScreenshot('task_2_option_selected');
      await page.click('#check-answer-btn');
      await expect(nextBtn).toBeEnabled();
      await page.captureAuditScreenshot('task_2_checked');
      await nextBtn.click();
    } else {
      console.log("[Scenario 5] Test task is presented first");
      // Complete Test task (Task 1)
      await page.waitForSelector('.tui-option-enter', { state: 'visible' });
      await page.locator('.tui-option-enter', { hasText: 'Герцы (Гц)' }).click();
      await page.captureAuditScreenshot('task_1_option_selected');
      await page.click('#check-answer-btn');
      await expect(nextBtn).toBeEnabled();
      await page.captureAuditScreenshot('task_1_checked');
      await nextBtn.click();

      // Complete Click task (Task 2)
      const viewportImg = page.locator('[data-clickui="viewport"] img');
      await expect(viewportImg).toBeVisible();
      await page.waitForTimeout(500);
      await viewportImg.click();
      await page.captureAuditScreenshot('task_2_image_clicked');
      await page.click('#check-answer-btn');
      await expect(nextBtn).toBeEnabled();
      await page.captureAuditScreenshot('task_2_checked');
      await nextBtn.click();
    }

    // 10. Verify redirection to results
    await page.waitForURL(url => url.pathname.endsWith('/results'));
    await page.waitForSelector('#complex-name', { state: 'visible' });

    // Assert correct completed tasks count and complex title
    await expect(page.locator('#complex-name')).toHaveText('Комплекс радиоволнового контроля');
    await expect(page.locator('#summary-completed-tasks')).toHaveText('2');

    await page.captureAuditScreenshot('session_results_s3');
  });

});
