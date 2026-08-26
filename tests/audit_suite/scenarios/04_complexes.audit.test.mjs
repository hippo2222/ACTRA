import { test, expect } from '../helpers/audit_fixture.mjs';
import { cleanUserByName, fetchLastEmailLink } from '../helpers/db_helper.mjs';

const TEST_USER_NAME = 'AuditUser';
const TEST_USER_EMAIL = 'audit_user@localhost.test';
const TEST_USER_PASSWORD = 'audit_password_123';
const MAILPIT_URL = 'http://127.0.0.1:8025';

test.describe('Scenario 4: Complex Creation, Editing & Limits', () => {

  test.beforeEach(async ({ page }) => {
    // 1. Set ample timeout for email registration and UI initialization
    test.setTimeout(60000);

    // 2. Disable onboarding tours globally
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

    const baseURL = process.env.BASE_URL || 'http://localhost:8000';
    await cleanUserByName(baseURL, TEST_USER_NAME, TEST_USER_PASSWORD);
    await cleanUserByName(baseURL, 'AuditAuthor', 'audit_password_123');
    await cleanUserByName(baseURL, 'AuditStudent', 'audit_password_123');

    // Register a fresh test user
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

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
    await verifyPage.waitForLoadState('domcontentloaded');
    await verifyPage.close();

    await page.click('#onboardingVerificationContinueBtn');
    await page.waitForURL('**/main');

    // Pre-create catalog elements: Module, Topic, 2 Tasks, and 1 Theory
    await page.evaluate(async () => {
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

      // 3. Task 1 (Click Type)
      const resBoot1 = await fetch('/api/editor/task/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: 'modul_radiofiziki',
          topic_id: 'razdel_elektromagnetizm',
          task_id: 'task_click_antenna',
          task_type: 'click',
          task_name: 'Тест клика по антенне'
        })
      });
      const dataBoot1 = await resBoot1.json();
      const taskData1 = dataBoot1.task.task_data;
      taskData1.content = {
        image: 'test_image.png',
        prompt: 'Кликните на антенну',
        required_correct: 1,
        annotations: [{ id: 'a1', type: 'polygon', points: [{x:50, y:50}, {x:55, y:55}, {x:45, y:55}] }]
      };
      await fetch('/api/editor/task/modul_radiofiziki/razdel_elektromagnetizm/task_click_antenna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData1)
      });

      // 4. Task 2 (Draw Type)
      const resBoot2 = await fetch('/api/editor/task/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: 'modul_radiofiziki',
          topic_id: 'razdel_elektromagnetizm',
          task_id: 'task_draw_sine',
          task_type: 'draw',
          task_name: 'Тест рисования графика'
        })
      });
      const dataBoot2 = await resBoot2.json();
      const taskData2 = dataBoot2.task.task_data;
      taskData2.content = {
        image: 'test_image.png',
        prompt: 'Нарисуйте синусоиду',
        required_correct: 1,
        path: [{x:20, y:50}, {x:50, y:30}, {x:80, y:50}]
      };
      await fetch('/api/editor/task/modul_radiofiziki/razdel_elektromagnetizm/task_draw_sine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData2)
      });

      // 5. Theory
      await fetch('/api/theories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Теория электромагнитных волн',
          delta: { ops: [{ insert: 'Введение в теорию волн...' }] }
        })
      });
    });
  });

  test('4.1 Complex Creation, Theory Linking, Task Addition, Reordering & Publication', async ({ page }) => {
    // 1. Go to Complexes dashboard
    await page.goto('/complexes');
    await page.waitForSelector('#create-complex', { state: 'visible' });
    await page.captureAuditScreenshot('complexes_dashboard_empty');

    // 2. Click Create Complex to open the editor
    await page.click('#create-complex');
    await page.waitForSelector('#save-btn', { state: 'visible' });
    await page.waitForSelector('.module-card-header', { state: 'visible' });
    await page.captureAuditScreenshot('complex_editor_empty');

    // 3. Fill basic information
    await page.fill('#name', 'Комплекс по Электродинамике');
    await page.fill('#description', 'Сборник заданий на определение резонанса и колебаний.');

    // 4. Link pre-created theory
    await page.click('#theory-header');
    await page.selectOption('#theory-mode', 'link');
    // Wait for the theories dropdown to be loaded and select our theory
    await page.waitForSelector('#theory-link-picker option:has-text("Теория электромагнитных волн")', { state: 'attached' });
    await page.selectOption('#theory-link-picker', { label: 'Теория электромагнитных волн' });
    await page.captureAuditScreenshot('complex_editor_theory_linked');

    // 5. Expand catalog tree and select both tasks
    await page.click('.module-card-header');
    await page.click('.topic-card-header');
    
    // Check checkboxes for both tasks
    await page.locator('input[data-task-ref*="task_click_antenna"]').check();
    await page.locator('input[data-task-ref*="task_draw_sine"]').check();
    
    // Add them to the complex
    await page.click('#add-from-catalog');
    
    // Verify count badge shows 2
    await page.waitForSelector('#selected-count:has-text("2")', { state: 'visible' });
    await page.captureAuditScreenshot('complex_editor_tasks_added');

    // 6. Programmatically reorder tasks to ensure no flaky UI interactions
    const firstRefBefore = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#selected-cards .task-card-premium'));
      return cards.map(c => c.getAttribute('data-selected-task-ref'))[0];
    });

    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#selected-cards .task-card-premium'));
      if (cards.length >= 2) {
        const sourceCard = cards[0];
        const targetCard = cards[1];
        
        const dataTransfer = new DataTransfer();
        
        const dragStartEvent = new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer
        });
        sourceCard.dispatchEvent(dragStartEvent);
        
        const dragOverEvent = new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer
        });
        targetCard.dispatchEvent(dragOverEvent);
        
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer
        });
        targetCard.dispatchEvent(dropEvent);
      }
    });
    
    const firstRefAfter = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#selected-cards .task-card-premium'));
      return cards.map(c => c.getAttribute('data-selected-task-ref'))[0];
    });
    expect(firstRefBefore).not.toBe(firstRefAfter);
    await page.captureAuditScreenshot('complex_editor_tasks_reordered');

    // 7. Save complex
    await page.click('#save-btn');
    // Wait for URL to update with the new complex ID (URL has ?id=...)
    await page.waitForURL(url => url.searchParams.has('id'));
    await page.captureAuditScreenshot('complex_editor_saved');

    // 8. Open Publication dialog
    await page.click('#publish-btn');
    await page.waitForSelector('button[data-action="publish-version"]', { state: 'visible' });
    await page.captureAuditScreenshot('complex_editor_publish_modal');

    // Choose access code visibility
    await page.locator('input[name="complex-publish-visibility"][value="access_code"]').click();
    await page.captureAuditScreenshot('complex_editor_visibility_selected');

    // Publish
    await page.click('button[data-action="publish-version"]');
    
    // Wait for the access code box to become visible
    await page.waitForSelector('#complex-publish-access-box:not(.hidden)', { state: 'visible' });
    const accessCodeText = await page.locator('#complex-publish-access-code').textContent();
    expect(accessCodeText).not.toBeNull();
    expect(accessCodeText.trim()).not.toBe('');
    console.log(`[Scenario 4] Published complex access code: ${accessCodeText.trim()}`);
    await page.captureAuditScreenshot('complex_editor_published_with_code');

    // Close modal
    await page.locator('button[data-action="close"]').first().click();
    await page.waitForSelector('.cx-publish-modal-panel', { state: 'detached' });
  });

  test('4.2 Personal Complexes Creation Limit Check (Free Plan)', async ({ page }) => {
    // 1. Pre-create 5 complexes via API to exhaust the Free plan limits (limit = 5)
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        await fetch('/api/complexes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Архивный комплекс ${i + 1}`,
            description: `Сгенерированный комплекс ${i + 1}`,
            tasks: ["modul_radiofiziki/razdel_elektromagnetizm/task_click_antenna"]
          })
        });
      }
    });

    // 2. Open create complex editor
    await page.goto('/complexes/create');
    await page.waitForSelector('#save-btn', { state: 'visible' });
    await page.waitForSelector('.module-card-header', { state: 'visible' });

    // 3. Verify limit warning banner is visible (or has text updated) and save button is disabled
    const banner = page.locator('#complex-limit-banner');
    
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText(/Достигнут личный лимит комплексов/);
    
    const saveBtn = page.locator('#save-btn');
    await expect(saveBtn).toBeDisabled();
    
    await page.captureAuditScreenshot('complex_editor_limit_reached');
  });

});
