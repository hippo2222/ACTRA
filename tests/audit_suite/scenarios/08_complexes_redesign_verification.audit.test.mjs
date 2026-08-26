import { test, expect } from '../helpers/audit_fixture.mjs';
import { cleanUserByName, fetchLastEmailLink } from '../helpers/db_helper.mjs';

const TEST_USER_NAME = 'AuditComplexesUser';
const TEST_USER_EMAIL = 'audit_complexes_user@localhost.test';
const TEST_USER_PASSWORD = 'audit_password_123';
const MAILPIT_URL = 'http://127.0.0.1:8025';

test.describe('Scenario 8: Complexes Redesign Full Functionality Audit (DOM, Network, Console, Interactivity)', () => {

  test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);

    // Disable auto-onboarding tours to prevent overlays from interfering with click targets
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

    // Register and verify test user
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const startBtn = page.locator('button:has-text("Начать обучение")').filter({ visible: true }).first();
    await startBtn.click();
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

    // Bootstrap test theory and test complexes via API
    await page.evaluate(async () => {
      // 1. Create a rich formatted theory
      const theoryRes = await fetch('/api/theories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Основы ЭКГ диагностики',
          delta: {
            ops: [
              { insert: 'Руководство по анализу ЭКГ\n', attributes: { header: 1 } },
              { insert: 'Основные зубцы и интервалы:\n', attributes: { bold: true } },
              { insert: 'Зубец P — деполяризация предсердий\n', attributes: { list: 'bullet' } },
              { insert: 'Комплекс QRS — деполяризация желудочков\n', attributes: { list: 'bullet' } },
              { insert: 'Зубец T — реполяризация желудочков\n', attributes: { list: 'bullet' } },
              { insert: 'Внимание: ', attributes: { bold: true, color: '#e53e3e' } },
              { insert: 'всегда оценивайте ритм комплексно.\n' }
            ]
          }
        })
      });
      const theoryData = await theoryRes.json();
      const theoryId = theoryData.theory_id || theoryData.id;

      // 2. Create Complex A with theory (3 tasks)
      await fetch('/api/complexes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Анализ ЭКГ и ритма',
          description: 'Комплексный анализ зубцов P, QRS, T и определение нарушений ритма.',
          theory_link: theoryId,
          tasks: [
            'task_ecg_1',
            'task_ecg_2',
            'task_ecg_3'
          ]
        })
      });

      // 3. Create Complex B without theory (5 tasks)
      await fetch('/api/complexes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Базовые алгоритмы сортировки',
          description: 'Практические задания по алгоритмам быстрой и пирамидальной сортировки.',
          tasks: [
            'task_sort_1',
            'task_sort_2',
            'task_sort_3',
            'task_sort_4',
            'task_sort_5'
          ]
        })
      });

      // 4. Create Complex C (1 task)
      await fetch('/api/complexes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Ядерный магнитный резонанс',
          description: 'Спектроскопия ЯМР и определение химических сдвигов молекул.',
          tasks: [
            'task_nmr_1'
          ]
        })
      });
    });
  });

  test('8.1 Network, DOM, Console, Search, Sort, Filter, Menus, Accordion & Theory Modal', async ({ page }) => {
    // -------------------------------------------------------------
    // 1. Network & Assets Validation: Load /complexes
    // -------------------------------------------------------------
    const networkResponses = [];
    page.on('response', (res) => {
      if (res.url().includes('/complexes')) {
        networkResponses.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto('/complexes');
    await page.waitForLoadState('networkidle');

    // Verify static CSS and JS are loaded successfully with 200 OK
    const cssResponse = networkResponses.find(r => r.url.endsWith('/complexes/complexes.css'));
    const jsResponse = networkResponses.find(r => r.url.endsWith('/complexes/complexes.js'));
    expect(cssResponse).toBeDefined();
    expect(cssResponse.status).toBe(200);
    expect(jsResponse).toBeDefined();
    expect(jsResponse.status).toBe(200);

    // Wait for cards to render in DOM
    await page.waitForSelector('#complexes-list article.cx-card', { state: 'visible' });
    const initialCards = await page.locator('#complexes-list article.cx-card').count();
    expect(initialCards).toBe(3);

    // -------------------------------------------------------------
    // 2. DOM Structure & Semantic Verification
    // -------------------------------------------------------------
    const firstCard = page.locator('#complexes-list article.cx-card').first();
    await expect(firstCard).toHaveAttribute('aria-labelledby');
    await expect(firstCard.locator('h2')).toBeVisible();

    // Verify primary actions
    await expect(firstCard.locator('.start-btn')).toBeVisible();
    await expect(firstCard.locator('.detail-toggle-btn')).toBeVisible();
    await expect(firstCard.locator('.cx-toggle-chevron')).toBeVisible();

    // Verify secondary actions
    await expect(firstCard.locator('.pin-btn')).toBeVisible();
    await expect(firstCard.locator('.cx-card-menu-btn')).toBeVisible();

    // Verify toolbar elements
    await expect(page.locator('#complex-search-input')).toBeVisible();
    await expect(page.locator('#complex-sort-select')).toBeVisible();
    await expect(page.locator('#complex-filter-summary')).toBeVisible();
    await expect(page.locator('.cx-filter-row')).toBeVisible();

    await page.captureAuditScreenshot('01_initial_complexes_rendered');

    // -------------------------------------------------------------
    // 3. Live Search, Clear Button & Keyboard Shortcuts
    // -------------------------------------------------------------
    const searchInput = page.locator('#complex-search-input');
    const searchClear = page.locator('#complex-search-clear');
    const summaryBadge = page.locator('#complex-filter-summary');

    // Type query "ЭКГ"
    await searchInput.fill('ЭКГ');
    await expect(searchClear).toBeVisible();

    // In DOM, only 1 card should remain visible
    const visibleCardsAfterSearch = await page.locator('#complexes-list article.cx-card:not([hidden])').count();
    expect(visibleCardsAfterSearch).toBe(1);
    await expect(summaryBadge).toHaveText('1 из 3');
    await page.captureAuditScreenshot('02_search_filtered_state');

    // Click search clear button ✕
    await searchClear.click();
    await expect(searchInput).toHaveValue('');
    await expect(searchClear).toBeHidden();
    const visibleAfterClear = await page.locator('#complexes-list article.cx-card:not([hidden])').count();
    expect(visibleAfterClear).toBe(3);
    await expect(summaryBadge).toHaveText(/Все: 3|3 из 3/);

    // Test Shortcut: Blur focus, then press "/"
    await searchInput.blur();
    await page.keyboard.press('/');
    await expect(searchInput).toBeFocused();

    // Type query "алгоритм" and press Escape to clear & blur
    await searchInput.fill('алгоритм');
    expect(await page.locator('#complexes-list article.cx-card:not([hidden])').count()).toBe(1);
    await page.keyboard.press('Escape');
    await expect(searchInput).toHaveValue('');
    await expect(searchInput).not.toBeFocused();
    expect(await page.locator('#complexes-list article.cx-card:not([hidden])').count()).toBe(3);
    await page.captureAuditScreenshot('03_search_shortcuts_tested');

    // -------------------------------------------------------------
    // 4. Sort Selection via Dropdown
    // -------------------------------------------------------------
    const sortSelect = page.locator('#complex-sort-select');

    // Sort by name descending (Я → А)
    await sortSelect.selectOption('name-desc');
    let cardTitles = await page.locator('#complexes-list article.cx-card h2').allTextContents();
    expect(cardTitles[0]).toContain('Ядерный магнитный резонанс');
    expect(cardTitles[2]).toContain('Анализ ЭКГ и ритма');
    await page.captureAuditScreenshot('04_sorted_name_desc');

    // Sort by task count descending
    await sortSelect.selectOption('tasks-desc');
    cardTitles = await page.locator('#complexes-list article.cx-card h2').allTextContents();
    expect(cardTitles[0]).toContain('Базовые алгоритмы сортировки'); // 5 tasks
    await page.captureAuditScreenshot('05_sorted_tasks_desc');

    // Sort by name ascending (А → Я)
    await sortSelect.selectOption('name-asc');
    cardTitles = await page.locator('#complexes-list article.cx-card h2').allTextContents();
    expect(cardTitles[0]).toContain('Анализ ЭКГ и ритма');
    expect(cardTitles[2]).toContain('Ядерный магнитный резонанс');
    await page.captureAuditScreenshot('06_sorted_name_asc');

    // -------------------------------------------------------------
    // 5. Filter Chips Interaction
    // -------------------------------------------------------------
    const mineChip = page.locator('.complex-filter-chip[data-filter="mine"]');
    const allChip = page.locator('.complex-filter-chip[data-filter="all"]');

    await mineChip.click();
    await expect(mineChip).toHaveClass(/pill-info/);
    await expect(allChip).not.toHaveClass(/pill-info/);
    expect(await page.locator('#complexes-list article.cx-card:not([hidden])').count()).toBe(3);

    await allChip.click();
    await expect(allChip).toHaveClass(/pill-info/);
    await page.captureAuditScreenshot('07_filters_tested');

    // -------------------------------------------------------------
    // 6. Context Menu ⋮ Open & Close Interaction
    // -------------------------------------------------------------
    const menuBtn = page.locator('#complexes-list article.cx-card .cx-card-menu-btn').first();
    await menuBtn.click();

    const menuDropdown = page.locator('#complexes-list article.cx-card .cx-card-menu-dropdown.is-open');
    await expect(menuDropdown).toBeVisible();
    await expect(menuDropdown.locator('button:has-text("Редактировать")')).toBeVisible();
    await expect(menuDropdown.locator('button:has-text("Экспорт")')).toBeVisible();
    await expect(menuDropdown.locator('button:has-text("Удалить комплекс")')).toBeVisible();
    await page.captureAuditScreenshot('08_context_menu_open');

    // Close on Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('.cx-card-menu-dropdown.is-open')).toHaveCount(0);

    // -------------------------------------------------------------
    // 7. Accordion Detail Panel Interaction
    // -------------------------------------------------------------
    const detailBtn = page.locator('#complexes-list article.cx-card .detail-toggle-btn').first();
    const chevron = page.locator('#complexes-list article.cx-card .cx-toggle-chevron').first();
    const detailPanel = page.locator('#complexes-list article.cx-card .detail-panel').first();

    await detailBtn.click();
    await expect(detailPanel).toHaveClass(/expanded/);
    await expect(chevron).toHaveClass(/is-expanded/);
    await page.captureAuditScreenshot('09_detail_panel_expanded');

    await detailBtn.click();
    await expect(detailPanel).not.toHaveClass(/expanded/);
    await expect(chevron).not.toHaveClass(/is-expanded/);

    // -------------------------------------------------------------
    // 8. Theory Modal Viewer Verification
    // -------------------------------------------------------------
    // Find the card with the theory button (Complex A)
    const theoryBtn = page.locator('#complexes-list article.cx-card:has-text("Анализ ЭКГ и ритма") .theory-btn');
    await expect(theoryBtn).toBeVisible();
    await theoryBtn.click();

    const theoryDialog = page.locator('#complex-theory-viewer-dialog');
    await expect(theoryDialog).toBeVisible();

    // Verify rich rendered Quill Delta content
    const renderedTheory = theoryDialog.locator('.theory-rendered-view');
    await expect(renderedTheory).toBeVisible();
    await expect(renderedTheory.locator('h1')).toHaveText('Руководство по анализу ЭКГ');
    await expect(renderedTheory.locator('strong')).toBeVisible();
    await expect(renderedTheory.locator('ul li')).toHaveCount(3);
    await page.captureAuditScreenshot('10_theory_viewer_rendered');

    // Close theory modal
    const closeTheoryBtn = theoryDialog.locator('#complex-theory-viewer-close');
    await closeTheoryBtn.click();
    await expect(theoryDialog).not.toBeVisible();
    await page.captureAuditScreenshot('11_theory_viewer_closed');
  });

});
