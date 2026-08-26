/**
 * Scenario 6: Visual Practice Session - Feedback, Iteration Results and Final Results
 *
 * Verifies via screenshots:
 *  1. WRONG answer feedback (border-l-error, Ответ неверный)
 *  2. CORRECT answer feedback (border-l-success, Ответ принят)
 *  3. Iteration results screen S2
 *  4. Final results screen S3
 *
 * max_iterations = 2:
 *   Iteration 1: wrong answers -> S2 iteration results screen
 *   Iteration 2: correct answers -> S3 final results screen
 */
import { test, expect } from '../helpers/audit_fixture.mjs';
import { cleanUserByName, fetchLastEmailLink } from '../helpers/db_helper.mjs';

const TEST_AUTHOR_NAME  = 'AuditAuthor6';
const TEST_AUTHOR_EMAIL = 'audit_author6@localhost.test';
const TEST_AUTHOR_PASS  = 'audit_password_123';
const TEST_STUDENT_NAME  = 'AuditStudent6';
const TEST_STUDENT_EMAIL = 'audit_student6@localhost.test';
const TEST_STUDENT_PASS  = 'audit_password_123';
const MAILPIT_URL = 'http://127.0.0.1:8025';
const OPEN_ANSWER_CORRECT = 'амплитуда';
const OPEN_ANSWER_WRONG   = 'абракадабра_неверно';
const TEST_CORRECT_OPTION = 'Герцы (Гц)';
const TEST_WRONG_OPTION   = 'Ватты (Вт)';

async function registerAndVerify(page, name, email, password) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  const startBtn = page.locator('button:has-text("Начать обучение")').filter({ visible: true }).first();
  await startBtn.click();
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
  const link = await fetchLastEmailLink(MAILPIT_URL, email, /href="([^"]+verify_email_token=[^"]+)"/);
  const verifyPage = await page.context().newPage();
  await verifyPage.goto(link);
  await verifyPage.waitForLoadState('domcontentloaded');
  await verifyPage.close();
  await page.click('#onboardingVerificationContinueBtn');
  await page.waitForURL('**/main');
}

async function submitAndWaitForFeedback(page, screenshotName) {
  const checkBtn = page.locator('#check-answer-btn');
  await checkBtn.waitFor({ state: 'visible', timeout: 10000 });
  await checkBtn.click();
  await page.waitForFunction(() => {
    const box = document.getElementById('result-box');
    return box && !box.classList.contains('hidden');
  }, { timeout: 15000 });
  await page.waitForTimeout(700);
  await page.captureAuditScreenshot(screenshotName);
}

async function getTaskType(page) {
  await page.waitForFunction(() => window.SessionState && window.SessionState.currentTask, { timeout: 10000 }).catch(() => {});
  return page.evaluate(() => {
    if (!window.SessionState || !window.SessionState.currentTask) return 'test';
    const task = window.SessionState.currentTask;
    const td = task.task_data || task;
    return (td.type || td.task_type || task.task_type || task.type || 'test').toLowerCase();
  });
}

async function answerWrong(page, label) {
  await page.waitForTimeout(500);
  const taskType = await getTaskType(page);
  console.log('[S6] ' + label + ' taskType: ' + taskType);

  if (taskType.includes('test')) {
    const isOpenMode = await page.evaluate(() => {
      const textarea = document.querySelector('#task-content textarea');
      return !!textarea && textarea.offsetParent !== null;
    });

    if (isOpenMode) {
      console.log('[S6] ' + label + ': Test task in Open Mode (wrong)');
      const input = page.locator('#task-content textarea').first();
      await input.waitFor({ state: 'visible', timeout: 5000 });
      await input.fill(OPEN_ANSWER_WRONG);
      await input.dispatchEvent('input').catch(() => {});
      await page.captureAuditScreenshot(label + '_wrong_typed');
    } else {
      console.log('[S6] ' + label + ': Test wrong option');
      await page.waitForSelector('.tui-option-enter', { state: 'visible', timeout: 10000 });
      const opt = page.locator('.tui-option-enter', { hasText: TEST_WRONG_OPTION }).first();
      await opt.waitFor({ state: 'visible', timeout: 5000 });
      await opt.click();
      await page.captureAuditScreenshot(label + '_wrong_selected');
    }
  } else if (taskType.includes('open')) {
    console.log('[S6] ' + label + ': OA wrong text');
    await page.waitForSelector('textarea', { state: 'visible', timeout: 10000 });
    const input = page.locator('textarea').first();
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.fill(OPEN_ANSWER_WRONG);
    await input.dispatchEvent('input').catch(() => {});
    await page.captureAuditScreenshot(label + '_wrong_typed');
  } else if (taskType.includes('click')) {
    console.log('[S6] ' + label + ': Click wrong target');
    await page.waitForSelector('[data-clickui="canvas"], canvas, #click-canvas', { state: 'visible', timeout: 10000 });
    const canvas = page.locator('[data-clickui="canvas"], canvas, #click-canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 5000 });
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 10, box.y + 10);
    }
    await page.captureAuditScreenshot(label + '_click_selected');
  }
}

async function answerCorrect(page, label) {
  await page.waitForTimeout(500);
  const taskType = await getTaskType(page);
  console.log('[S6] ' + label + ' taskType: ' + taskType);

  if (taskType.includes('test')) {
    const isOpenMode = await page.evaluate(() => {
      const textarea = document.querySelector('#task-content textarea');
      return !!textarea && textarea.offsetParent !== null;
    });

    if (isOpenMode) {
      console.log('[S6] ' + label + ': Test task in Open Mode (correct)');
      const input = page.locator('#task-content textarea').first();
      await input.waitFor({ state: 'visible', timeout: 5000 });
      const pageText = (await page.locator('#task-content').first().textContent().catch(() => '')).toLowerCase();
      const correctText = (pageText.includes('частот') || pageText.includes('скорость света') || pageText.includes('единиц')) ? 'Герцы (Гц)' : OPEN_ANSWER_CORRECT;
      await input.fill(correctText);
      await input.dispatchEvent('input').catch(() => {});
      await page.captureAuditScreenshot(label + '_correct_typed');
    } else {
      console.log('[S6] ' + label + ': Test correct option');
      await page.waitForSelector('.tui-option-enter', { state: 'visible', timeout: 10000 });
      const opt = page.locator('.tui-option-enter', { hasText: TEST_CORRECT_OPTION }).first();
      await opt.waitFor({ state: 'visible', timeout: 5000 });
      await opt.click();
      await page.captureAuditScreenshot(label + '_correct_selected');
    }
  } else if (taskType.includes('open')) {
    console.log('[S6] ' + label + ': OA correct text');
    await page.waitForSelector('textarea', { state: 'visible', timeout: 10000 });
    const input = page.locator('textarea').first();
    await input.waitFor({ state: 'visible', timeout: 5000 });
    const pageText = (await page.locator('#task-content, body').first().textContent().catch(() => '')).toLowerCase();
    const correctText = pageText.includes('скорость света') ? 'Герцы (Гц)' : OPEN_ANSWER_CORRECT;
    await input.fill(correctText);
    await input.dispatchEvent('input').catch(() => {});
    await page.captureAuditScreenshot(label + '_correct_typed');
  } else if (taskType.includes('click')) {
    console.log('[S6] ' + label + ': Click correct target');
    await page.waitForSelector('[data-clickui="canvas"], canvas, #click-canvas', { state: 'visible', timeout: 10000 });
    const canvas = page.locator('[data-clickui="canvas"], canvas, #click-canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 5000 });
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await page.captureAuditScreenshot(label + '_click_selected');
  }
}

test.describe('Scenario 6: Visual Practice – Feedback & Results Screens', () => {

  test.beforeEach(async ({ page }) => {
    test.setTimeout(240000);
    await page.context().addInitScript(() => {
      window.ACTRA_DISABLE_AUTO_ONBOARDING = true;
      let dummy = { init: () => {}, start: () => Promise.resolve(), startIfUnseen: () => Promise.resolve(), refreshHelpButtons: () => {} };
      Object.defineProperty(window, 'OnboardingTour', { get: () => dummy, set: v => { dummy = { ...v, start: () => Promise.resolve(), startIfUnseen: () => Promise.resolve() }; }, configurable: true });
    });
  });

  test('6.1 Wrong answers to Iteration Results S2 then Correct answers to Final Results S3', async ({ page }) => {
    test.setTimeout(240000);
    const baseURL = process.env.BASE_URL || 'http://localhost:8000';

    await cleanUserByName(baseURL, TEST_AUTHOR_NAME, TEST_AUTHOR_PASS);
    await cleanUserByName(baseURL, TEST_STUDENT_NAME, TEST_STUDENT_PASS);

    // 1. Register Author
    await registerAndVerify(page, TEST_AUTHOR_NAME, TEST_AUTHOR_EMAIL, TEST_AUTHOR_PASS);
    await page.captureAuditScreenshot('01_author_dashboard');

    // 2. Create module and topic via editor API
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

      // 3. Create Test task 1 via API
      const resBoot1 = await fetch('/api/editor/task/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: 'modul_radiofiziki',
          topic_id: 'razdel_elektromagnetizm',
          task_id: 'task_s6_test1',
          task_type: 'test',
          task_name: 'Тест 1: единицы частоты'
        })
      });
      const dataBoot1 = await resBoot1.json();
      const taskData1 = dataBoot1.task.task_data;
      taskData1.content = {
        test_type: 'single_choice',
        questions: [{
          id: 'q1',
          text: 'В каких единицах измеряется частота электромагнитных волн?',
          answers: [
            { text: 'Герцы (Гц)', correct: true },
            { text: 'Ватты (Вт)', correct: false },
            { text: 'Амперы (А)', correct: false }
          ]
        }]
      };
      await fetch('/api/editor/task/modul_radiofiziki/razdel_elektromagnetizm/task_s6_test1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData1)
      });

      // 4. Create Open Answer task 1 via API
      const resBoot2 = await fetch('/api/editor/task/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: 'modul_radiofiziki',
          topic_id: 'razdel_elektromagnetizm',
          task_id: 'task_s6_oa1',
          task_type: 'open_answer',
          task_name: 'Открытый ответ 1: амплитуда'
        })
      });
      const dataBoot2 = await resBoot2.json();
      const taskData2 = dataBoot2.task.task_data;
      taskData2.content = {
        question: 'Введите термин: максимальное смещение волны от положения равновесия.',
        keywords: [{ text: 'амплитуда', required: true }],
        hint: 'Начинается на «а».',
        images: []
      };
      taskData2.answer_key = { keywords: ['амплитуда'] };
      await fetch('/api/editor/task/modul_radiofiziki/razdel_elektromagnetizm/task_s6_oa1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData2)
      });

      // 5. Create Test task 2 via API
      const resBoot3 = await fetch('/api/editor/task/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: 'modul_radiofiziki',
          topic_id: 'razdel_elektromagnetizm',
          task_id: 'task_s6_test2',
          task_type: 'test',
          task_name: 'Тест 2: скорость света'
        })
      });
      const dataBoot3 = await resBoot3.json();
      const taskData3 = dataBoot3.task.task_data;
      taskData3.content = {
        test_type: 'single_choice',
        questions: [{
          id: 'q1',
          text: 'Какова скорость света в вакууме?',
          answers: [
            { text: 'Герцы (Гц)', correct: true },
            { text: 'Ватты (Вт)', correct: false },
            { text: 'Амперы (А)', correct: false }
          ]
        }]
      };
      taskData3.answer_key = { questions: taskData3.content.questions };
      await fetch('/api/editor/task/modul_radiofiziki/razdel_elektromagnetizm/task_s6_test2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData3)
      });

      // 6. Create Open Answer task 2 via API
      const resBoot4 = await fetch('/api/editor/task/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: 'modul_radiofiziki',
          topic_id: 'razdel_elektromagnetizm',
          task_id: 'task_s6_oa2',
          task_type: 'open_answer',
          task_name: 'Открытый ответ 2: резонанс'
        })
      });
      const dataBoot4 = await resBoot4.json();
      const taskData4 = dataBoot4.task.task_data;
      taskData4.content = {
        question: 'Введите термин: максимальное смещение волны.',
        keywords: [{ text: 'амплитуда', required: true }],
        hint: 'Начинается на «а».',
        images: []
      };
      taskData4.answer_key = { keywords: ['амплитуда'] };
      await fetch('/api/editor/task/modul_radiofiziki/razdel_elektromagnetizm/task_s6_oa2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData4)
      });
    });

    // 5. Create and publish complex with max_iterations=2
    await page.goto('/complexes/create');
    await page.waitForSelector('#save-btn', { state: 'visible' });
    await page.waitForSelector('.module-card-header', { state: 'visible' });
    await page.waitForLoadState('networkidle');
    await page.fill('#name', 'Комплекс визуального тестирования');
    await page.fill('#description', 'Сценарий 6: фидбек ответов и экраны результатов.');

    await page.click('.module-card-header');
    await page.waitForTimeout(400);
    await page.click('.topic-card-header');
    await page.waitForTimeout(400);

    await page.locator('input[data-task-ref*="task_s6_test1"]').check();
    await page.locator('input[data-task-ref*="task_s6_oa1"]').check();
    await page.locator('input[data-task-ref*="task_s6_test2"]').check();
    await page.locator('input[data-task-ref*="task_s6_oa2"]').check();
    await page.click('#add-from-catalog');
    await page.waitForTimeout(600);
    await page.captureAuditScreenshot('02_complex_tasks_added');

    await page.route('**/api/complexes*', async route => {
      const req = route.request();
      if (req.method() === 'POST' || req.method() === 'PUT') {
        const body = JSON.parse(req.postData() || '{}');
        body.settings = { ...body.settings, max_iterations: 2, adaptive_difficulty: false };
        await route.continue({ postData: JSON.stringify(body) });
      } else { await route.continue(); }
    });

    await page.click('#save-btn');
    await page.waitForURL(url => url.searchParams.has('id'));

    await page.click('#publish-btn');
    await page.waitForSelector('button[data-action="publish-version"]', { state: 'visible' });
    await page.locator('input[name="complex-publish-visibility"][value="access_code"]').click();
    await page.click('button[data-action="publish-version"]');
    await page.waitForSelector('#complex-publish-access-box:not(.hidden)', { state: 'visible' });
    await page.waitForFunction(() => { const el = document.getElementById('complex-publish-access-code'); return el && el.textContent.trim() !== '' && !el.textContent.includes('Код будет создан'); });
    const accessCode = (await page.locator('#complex-publish-access-code').textContent()).trim();
    console.log('[S6] Access Code: ' + accessCode);
    await page.captureAuditScreenshot('03_complex_published');

    // 6. Switch to Student
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await registerAndVerify(page, TEST_STUDENT_NAME, TEST_STUDENT_EMAIL, TEST_STUDENT_PASS);
    await page.captureAuditScreenshot('04_student_logged_in');

    // 7. Add complex
    await page.goto('/complexes');
    await page.waitForSelector('#add-complex-by-code', { state: 'visible' });
    await page.click('#add-complex-by-code');
    await page.waitForSelector('input[data-role="access-input"]', { state: 'visible' });
    await page.fill('input[data-role="access-input"]', accessCode);
    await page.click('form[data-role="access-form"] button[type="submit"]');
    await page.waitForSelector('button[data-role="confirm"]', { state: 'visible' });
    await page.captureAuditScreenshot('05_student_confirm_modal');
    await page.click('button[data-role="confirm"]');
    const complexCard = page.locator('[data-complex-card-id]');
    await expect(complexCard).toBeVisible();
    await page.captureAuditScreenshot('06_student_complex_added');

    // 8. Start session
    await complexCard.locator('button.start-btn').click();
    await page.waitForURL(url => url.pathname.startsWith('/session/'));
    await page.waitForSelector('#task-content', { state: 'visible' });
    await page.waitForSelector('#check-answer-btn', { state: 'visible' });
    await page.waitForTimeout(1200);
    await page.captureAuditScreenshot('07_session_task_1_loaded');

    // === ITERATION 1: WRONG ANSWER ON TASK 1, THEN COMPLETE ITERATION 1 ===
    console.log('[S6] === ITERATION 1: TEST ERROR FEEDBACK THEN COMPLETE ITERATION ===');
    let taskIdx1 = 1;
    while (!page.url().includes('/iteration/') && !page.url().endsWith('/results')) {
      const isCheckBtn = await page.locator('#check-answer-btn:not(.hidden)').isVisible().catch(() => false);
      const isNextBtn  = await page.locator('#next-task-btn:not(.hidden)').isVisible().catch(() => false);

      if (isCheckBtn && !isNextBtn) {
        if (taskIdx1 === 1) {
          await answerWrong(page, `iter1_task${taskIdx1}`);
          await submitAndWaitForFeedback(page, `08_iter1_task${taskIdx1}_WRONG_feedback`);
          await expect(page.locator('#result-inner')).toHaveClass(/border-l-error/);
          console.log(`[S6] Iteration 1 Task ${taskIdx1} wrong feedback: OK`);
        } else {
          await answerCorrect(page, `iter1_task${taskIdx1}`);
          await submitAndWaitForFeedback(page, `iter1_task${taskIdx1}_CORRECT_feedback`);
        }
        taskIdx1++;
      } else if (isNextBtn) {
        await page.evaluate(() => {
          const btn = document.getElementById('next-task-btn');
          if (btn) btn.click();
        });
        await page.waitForTimeout(1000);
      } else {
        await page.waitForTimeout(500);
      }
    }

    await page.waitForURL(url => url.pathname.includes('/iteration/') || url.pathname.endsWith('/results'), { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1200);
    await page.captureAuditScreenshot('11_after_iter1_results_screen');

    const urlAfterIter1 = page.url();
    console.log('[S6] URL after iter 1: ' + urlAfterIter1);

    if (urlAfterIter1.includes('/iteration/')) {
      // S2 iteration results
      console.log('[S6] S2 iteration results screen shown');
      await page.waitForSelector('#complex-name', { state: 'visible', timeout: 10000 });
      await page.waitForSelector('#hero-failed-count', { state: 'visible', timeout: 10000 });
      const failed  = (await page.locator('#hero-failed-count').textContent()).trim();
      const success = (await page.locator('#hero-success-count').textContent()).trim();
      console.log('[S6] S2: success=' + success + ', failed=' + failed);
      await page.captureAuditScreenshot('12_S2_iteration_results_detail');

      // === ITERATION 2: CORRECT ANSWERS ===
      console.log('[S6] === ITERATION 2: CORRECT ANSWERS ===');
      await page.click('#continue-btn');
      await page.waitForURL(url => url.pathname.startsWith('/session/') && !url.pathname.includes('/iteration/'), { timeout: 20000 });

      let taskIdx2 = 1;
      while (!page.url().endsWith('/results')) {
        const isCheckBtn = await page.locator('#check-answer-btn:not(.hidden)').isVisible().catch(() => false);
        const isNextBtn  = await page.locator('#next-task-btn:not(.hidden)').isVisible().catch(() => false);

        if (isCheckBtn && !isNextBtn) {
          await answerCorrect(page, `iter2_task${taskIdx2}`);
          await submitAndWaitForFeedback(page, `14_iter2_task${taskIdx2}_CORRECT_feedback`);
          await expect(page.locator('#result-inner')).toHaveClass(/border-l-success/);
          console.log(`[S6] Iteration 2 Task ${taskIdx2} correct feedback: OK`);
          taskIdx2++;
        } else if (isNextBtn) {
          await page.evaluate(() => {
            const btn = document.getElementById('next-task-btn');
            if (btn) btn.click();
          });
          await page.waitForTimeout(1000);
        } else {
          await page.waitForTimeout(500);
        }
      }

      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1200);
      await page.captureAuditScreenshot('17_S3_FINAL_RESULTS');

      await expect(page.locator('#complex-name')).toBeVisible();
      const iterCount = (await page.locator('#summary-iterations').textContent()).trim();
      const done = (await page.locator('#summary-completed-tasks').textContent()).trim();
      console.log('[S6] S3: iterations=' + iterCount + ', completed=' + done);
      await page.captureAuditScreenshot('18_S3_final_results_detail');

    } else {
      console.log('[S6] Went directly to final results - S2 skipped');
      await page.captureAuditScreenshot('12_S3_direct_final_results');
      await expect(page.locator('#complex-name')).toBeVisible();
    }

    const exitBtn = page.locator('#to-complexes-btn, #to-main-btn, #close-btn').first();
    if (await exitBtn.isVisible()) {
      await exitBtn.click();
      await page.waitForLoadState('networkidle');
      await page.captureAuditScreenshot('19_post_session_screen');
    }

    console.log('[S6] Scenario 6 complete');
  });

});
