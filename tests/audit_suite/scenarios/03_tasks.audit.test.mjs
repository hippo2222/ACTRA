import { test, expect } from '../helpers/audit_fixture.mjs';
import { cleanUserByName, fetchLastEmailLink } from '../helpers/db_helper.mjs';

const TEST_USER_NAME = 'AuditUser';
const TEST_USER_EMAIL = 'audit_user@localhost.test';
const TEST_USER_PASSWORD = 'audit_password_123';
const MAILPIT_URL = 'http://127.0.0.1:8025';

// 100x100 solid green PNG base64 string
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAANElEQVR42u3PMQEAAAgEIDfq3zSmyAecgIF1NREICAgICAgICAgICAgICAgICAgICAgICAjIDR1E2gABtrR4sgAAAABJRU5ErkJggg==';

async function startTaskCreation(page, taskName, taskType) {
  // Open the task creation modal programmatically
  await page.evaluate(() => {
    if (window.dashboard && typeof window.dashboard.showCreateTaskModal === 'function') {
      window.dashboard.showCreateTaskModal();
    }
  });
  
  // Wait for the modal to be visible
  await page.waitForSelector('#create-task-modal', { state: 'visible' });
  
  // Select our custom created module and topic
  const moduleSelect = page.locator('#task-module-select');
  await moduleSelect.selectOption({ label: 'Модуль Радиофизики' });
  
  const topicSelect = page.locator('#task-topic-select');
  await topicSelect.selectOption({ label: 'Раздел Электромагнетизм' });
  
  // Input task name
  await page.fill('#task-name-input', taskName);
  
  // Select task type
  const typeSelect = page.locator('#task-type-select');
  await typeSelect.selectOption(taskType);
  
  // Click create task button and wait for redirection (query param 'task' contains the ID)
  await Promise.all([
    page.waitForURL(url => url.searchParams.has('task')),
    page.click('#create-task-submit-btn')
  ]);
}

test.describe('Scenario 3: Task Creation & Editing (By Task Type)', () => {

  test.beforeEach(async ({ page }) => {
    // Increase test timeout to 60s to accommodate email verification and catalog pre-creation
    test.setTimeout(60000);

    // 1. Disable onboarding tours globally using a read-only mock object
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

    // Go to Main Dashboard
    await page.goto('/editor/Main_Dashboard.html');
    await page.waitForSelector('[data-role="create-task-card"]', { state: 'visible' });

    // Pre-create Module & Topic via API safely
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
    });

    await page.reload();
    // Wait for the sidebar folder listing 'Модуль Радиофизики' to appear to ensure catalog data is fully loaded in UI
    await page.waitForSelector('text=Модуль Радиофизики', { state: 'visible' });
  });

  test('3.1 Click Task (Point Annotation)', async ({ page }) => {
    // 1. Create task and wait for task load hydration
    await startTaskCreation(page, 'Тест клика по антенне', 'click');
    await page.waitForSelector('#save-task-btn', { state: 'visible' });
    await page.waitForFunction(() => window.editor && window.editor.task);
    await page.captureAuditScreenshot('click_editor_loaded');

    // 2. Upload simulated 100x100 image (use $eval to bypass mobile overlay blocking)
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.$eval('#change-image-btn', el => el.click());
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'antenna.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TEST_IMAGE_BASE64, 'base64')
    });
    
    // Wait for the upload request to finish and a short timeout for stage rendering
    await page.waitForResponse(response => response.url().includes('/api/editor/upload-image') && response.status() === 200);
    await page.waitForTimeout(500);

    // 3. Set prompt description
    await page.fill('#prompt-textarea', 'Укажите точку подключения коаксиального кабеля к антенне.');

    // 4. Programmatically add polygon annotation using the editor's internal API
    //    (mouse/pointer events don't fire correctly on touch-emulated mobile)
    await page.evaluate(() => {
      const ed = window.editor;
      if (!ed) return;
      // Set up drawing state: polygon mode with 3 pre-set points (normalized coords 0-100)
      ed.drawingPolygon = true;
      ed.currentPolygonPoints = [[20, 20], [50, 20], [35, 50]];
      ed.finishCurrentPolygon();
    });
    await page.captureAuditScreenshot('click_editor_annotation_placed');

    // 5. Fill required correct points (now enabled because annotation is placed!)
    await page.fill('#required-correct-input', '1');

    // 6. Save the task
    await page.$eval('#save-task-btn', el => el.click());
    await page.waitForSelector('#save-status-text:has-text("Сохранено")', { state: 'attached' });
    await page.captureAuditScreenshot('click_editor_saved_successfully');
  });

  test('3.2 Draw Task (Freehand Annotation)', async ({ page }) => {
    // 1. Create task and wait for task load hydration
    await startTaskCreation(page, 'Тест рисования графика', 'draw');
    await page.waitForSelector('#save-task-btn', { state: 'visible' });
    await page.waitForFunction(() => window.editor && window.editor.task);
    await page.captureAuditScreenshot('draw_editor_loaded');

    // 2. Upload simulated 100x100 image first (use $eval to bypass mobile overlay blocking)
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.$eval('#change-image-btn', el => el.click());
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'graph_grid.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TEST_IMAGE_BASE64, 'base64')
    });
    
    // Wait for the upload request to finish and a short timeout for stage rendering
    await page.waitForResponse(response => response.url().includes('/api/editor/upload-image') && response.status() === 200);
    await page.waitForTimeout(500);

    // 3. Select freehand tool (use $eval to bypass mobile overlay blocking)
    await page.$eval('#freehand-tool-btn', el => el.click());

    // 4. Set prompt description
    await page.fill('#prompt-textarea', 'Нарисуйте синусоиду электромагнитного колебания.');

    // 5. Programmatically add freehand annotation using editor's internal API
    //    (mouse/pointer events don't fire correctly on touch-emulated mobile)
    await page.evaluate(() => {
      const ed = window.editor;
      if (!ed) return;
      // Use editor's freehand drawing API directly
      ed.startFreehandDrawing([20, 40]);
      ed.addFreehandPoint([35, 25]);
      ed.addFreehandPoint([50, 40]);
      ed.addFreehandPoint([65, 25]);
      ed.addFreehandPoint([80, 40]);
      ed.finishFreehandDrawing();
    });
    await page.captureAuditScreenshot('draw_editor_freehand_path_drawn');

    // 6. Save the task
    await page.$eval('#save-task-btn', el => el.click());
    await page.waitForSelector('#save-status-text:has-text("Сохранено")', { state: 'attached' });
    await page.captureAuditScreenshot('draw_editor_saved_successfully');
  });

  test('3.3 Test Task (Multiple Choice Questions)', async ({ page }) => {
    // 1. Create task and wait for task load hydration
    await startTaskCreation(page, 'Тест выбора ответа частоты', 'test');
    await page.waitForSelector('#save-task-btn', { state: 'visible' });
    await page.waitForFunction(() => window.editor && window.editor.task);
    await page.captureAuditScreenshot('test_editor_loaded');

    // 2. Fill question text
    await page.fill('#question-textarea', 'В каких единицах измеряется частота электромагнитных волн?');

    // 3. Fill options
    // Add third option since by default there might be 2 option rows
    const optionsCount = await page.locator('#options-container .option-row').count();
    if (optionsCount < 3) {
      await page.click('#add-option-btn');
    }

    // Input values
    await page.locator('.option-row__textarea[data-option-index="0"]').fill('Герцы (Гц)');
    await page.locator('.option-row__textarea[data-option-index="1"]').fill('Метры (м)');
    await page.locator('.option-row__textarea[data-option-index="2"]').fill('Секунды (с)');

    // Toggle option A as correct
    await page.locator('.option-letter').nth(0).click();
    await page.captureAuditScreenshot('test_editor_options_filled');

    // 4. Save the task
    await page.click('#save-task-btn');
    await page.waitForSelector('#save-status-text:has-text("Сохранено")', { state: 'visible' });
    await page.captureAuditScreenshot('test_editor_saved_successfully');
  });

  test('3.4 Sequence Assembly Task (Ordering steps)', async ({ page }) => {
    // 1. Create task and wait for task load hydration
    await startTaskCreation(page, 'Порядок сборки радиоприемника', 'sequence_assembly');
    await page.waitForSelector('#save-task-btn', { state: 'visible' });
    await page.waitForFunction(() => window.editor && window.editor.task);
    await page.captureAuditScreenshot('sequence_editor_loaded');

    // 2. Set description
    await page.fill('#prompt-textarea', 'Упорядочите шаги сборки детекторного приемника от первого к последнему.');

    // 3. Fill first level details
    const firstLevelTitle = page.locator('.level-title-input').first();
    await firstLevelTitle.fill('Шаг 1: Подключение антенны');

    // Add block to first level
    await page.click('.sequence-add-block-btn');
    await page.locator('.block-title-input').first().fill('Подсоединить длинный провод антенны к гнезду');

    // 4. Add second level
    await page.click('#add-level-btn');
    const secondLevel = page.locator('.level-title-input').nth(1);
    await secondLevel.fill('Шаг 2: Заземление');

    // Add block to second level
    await page.locator('.sequence-add-block-btn').nth(1).click();
    await page.locator('.block-title-input').nth(1).fill('Подключить заземление к холодному концу катушки');
    await page.captureAuditScreenshot('sequence_editor_levels_configured');

    // 5. Save the task
    await page.$eval('#save-task-btn', el => el.click());
    await page.waitForSelector('#save-status-text:has-text("Сохранено")', { state: 'attached' });
    await page.captureAuditScreenshot('sequence_editor_saved_successfully');
  });

  test('3.5 Open Answer Task (Textual Reasoning)', async ({ page }) => {
    // 1. Create task and wait for task load hydration
    await startTaskCreation(page, 'Объяснение принципа резонанса', 'open_answer');
    await page.waitForSelector('#save-task-btn', { state: 'visible' });
    await page.waitForFunction(() => window.editor && window.editor.task);
    await page.captureAuditScreenshot('open_answer_editor_loaded');

    // 2. Fill question prompt
    await page.fill('#question-textarea', 'Почему при резонансе амплитуда колебаний резко возрастает?');

    // 3. Fill ideal reference answer
    await page.fill('#reference-textarea', 'Амплитуда возрастает, так как частота вынуждающей силы совпадает с собственной частотой колебательной системы.');

    // 4. Split reference text programmatically to ensure input/change events are processed
    await page.evaluate(() => {
      if (window.editor) {
        window.editor.splitKeywords();
      }
    });
    
    // 5. Select at least one generated keyword to be required (needed to pass frontend validation)
    await page.waitForSelector('.keyword-tag', { state: 'visible' });
    await page.locator('.keyword-tag').first().click();
    await page.captureAuditScreenshot('open_answer_editor_filled');

    // 6. Save the task
    await page.click('#save-task-btn');
    await page.waitForSelector('#save-status-text:has-text("Сохранено")', { state: 'visible' });
    await page.captureAuditScreenshot('open_answer_editor_saved_successfully');
  });

  test('3.6 Mistakes Mode Task (Errors click detection)', async ({ page }) => {
    // 1. Create click task and wait for task load hydration
    await startTaskCreation(page, 'Поиск ошибок на принципиальной схеме', 'click');
    await page.waitForSelector('#save-task-btn', { state: 'visible' });
    await page.waitForFunction(() => window.editor && window.editor.task);
    await page.captureAuditScreenshot('mistakes_mode_editor_loaded');

    // 2. Switch click editor to Mistakes (errors) mode
    await page.click('#mode-errors-btn');
    await page.captureAuditScreenshot('mistakes_mode_switched');

    // 3. Fill in error detection text (prompt is optional and collapsed in Mistakes mode)
    await page.fill('[data-errors-text-editor]', 'Радиосвязь осуществляется с помощью электромагнтиных волн.');

    // 4. Programmatically set text selection and add error span (avoiding flaky DOM selection)
    await page.evaluate(() => {
      if (window.editor) {
        window.editor.errorsTextSelection = { start: 40, end: 57 }; // "электромагнтиных"
        window.editor.handleErrorsAddSpan();
      }
    });
    await page.captureAuditScreenshot('mistakes_mode_spot_placed');

    // 5. Save the task
    await page.click('#save-task-btn');
    await page.waitForSelector('#save-status-text:has-text("Сохранено")', { state: 'visible' });
    await page.captureAuditScreenshot('mistakes_mode_saved_successfully');
  });

});
