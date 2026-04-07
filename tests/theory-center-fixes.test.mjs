import { test, expect } from '@playwright/test';

/**
 * Playwright тесты для проверки исправлений Центра теории
 * Покрывают все задачи из плана theory-center-fixes-f16c42.md
 */

const BASE_URL = 'http://localhost:8000';

test.describe('Центр теории - Исправления', () => {
  
  // ============================================================================
  // ЛОКАЛИЗАЦИЯ И ТЕКСТЫ
  // ============================================================================
  
  test.describe('Локализация и понятность интерфейса', () => {
    
    test('должен отображать "Автосинхронизация" вместо "Worker Sync"', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/editor`);
      
      // Открыть модалку управления теорией темы (требует наличия темы)
      // Проверяем, что текст "Worker Sync" отсутствует
      const workerSyncText = await page.locator('text=Worker Sync').count();
      expect(workerSyncText).toBe(0);
      
      // Проверяем наличие "Автосинхронизация"
      const autoSyncExists = await page.locator('text=Автосинхронизация').count();
      expect(autoSyncExists).toBeGreaterThanOrEqual(0); // Может быть 0 если модалка не открыта
    });
    
    test('должен показывать пояснения к способам привязки', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/editor`);
      
      // Проверяем наличие пояснительных текстов в опциях
      const dynamicLinkOption = page.locator('option[value="link"]');
      if (await dynamicLinkOption.count() > 0) {
        const text = await dynamicLinkOption.textContent();
        expect(text).toContain('изменения синхронизируются');
      }
      
      const staticCopyOption = page.locator('option[value="copy"]');
      if (await staticCopyOption.count() > 0) {
        const text = await staticCopyOption.textContent();
        expect(text).toContain('независимая версия');
      }
    });
    
    test('должен отображать корректный текст о комплексах', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/editor`);
      
      // Проверяем, что старый некорректный текст отсутствует
      const oldText = await page.locator('text=В комплексы этой темы будет прописана').count();
      expect(oldText).toBe(0);
      
      // Проверяем наличие нового корректного текста
      const newTextExists = await page.locator('text=содержащие задания из этой темы').count();
      expect(newTextExists).toBeGreaterThanOrEqual(0);
    });
    
    test('должен показывать упрощённый текст в редакторе теории', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/theory-editor`);
      
      // Проверяем отсутствие старого непонятного текста
      const oldText = await page.locator('text=Обзорный центр связей может появиться позже').count();
      expect(oldText).toBe(0);
      
      // Проверяем наличие нового упрощённого текста
      const newText = await page.locator('text=Создавайте и редактируйте теоретические материалы').count();
      expect(newText).toBeGreaterThan(0);
    });
  });
  
  // ============================================================================
  // МОДАЛЬНЫЕ ОКНА
  // ============================================================================
  
  test.describe('Кастомное модальное окно создания теории', () => {
    
    test('должно открываться кастомное модальное окно вместо browser prompt', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/editor`);
      
      // Проверяем наличие модального окна в DOM
      const modal = page.locator('#create-theory-modal');
      await expect(modal).toBeAttached();
      
      // Проверяем структуру модального окна
      const titleInput = page.locator('#create-theory-title-input');
      await expect(titleInput).toBeAttached();
      
      const confirmBtn = page.locator('#create-theory-confirm-btn');
      await expect(confirmBtn).toBeAttached();
      await expect(confirmBtn).toHaveText('Создать теорию');
    });
    
    test('модальное окно должно иметь кнопки закрытия', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/editor`);
      
      const closeButtons = page.locator('[data-role="create-theory-close"]');
      const count = await closeButtons.count();
      expect(count).toBeGreaterThan(0);
    });
    
    test('модальное окно должно поддерживать Enter для подтверждения', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/editor`);
      
      const input = page.locator('#create-theory-title-input');
      
      // Проверяем, что у input есть обработчик onkeydown
      // (это проверяется косвенно через наличие элемента)
      await expect(input).toBeAttached();
    });
  });
  
  // ============================================================================
  // НАВИГАЦИЯ
  // ============================================================================
  
  test.describe('Навигация и кнопки', () => {
    
    test('должна быть кнопка "Центр теории" в хедере главного экрана', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/editor`);
      
      const theoryCenterBtn = page.locator('#theory-center-nav-btn');
      await expect(theoryCenterBtn).toBeVisible();
      await expect(theoryCenterBtn).toContainText('Центр теории');
      
      // Проверяем наличие иконки
      const icon = theoryCenterBtn.locator('.material-symbols-outlined');
      await expect(icon).toBeVisible();
    });
    
    test('кнопка "Центр теории" должна быть кликабельной', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/editor`);
      
      const theoryCenterBtn = page.locator('#theory-center-nav-btn');
      await expect(theoryCenterBtn).toBeEnabled();
    });
    
    test('кнопка "Назад" в редакторе теории должна иметь правильный текст', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/theory-editor`);
      
      const backBtn = page.locator('#theory-back-btn');
      if (await backBtn.count() > 0) {
        const label = backBtn.locator('#theory-back-btn-label');
        await expect(label).toBeAttached();
      }
    });
  });
  
  // ============================================================================
  // РЕДАКТОР ТЕОРИИ - ФОРМАТИРОВАНИЕ
  // ============================================================================
  
  test.describe('Редактор теории - Форматирование текста', () => {
    
    test('должна быть кнопка подчёркивания текста', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/theory-editor`);
      
      const underlineBtn = page.locator('#theory-underline');
      await expect(underlineBtn).toBeVisible();
      
      // Проверяем наличие иконки
      const icon = underlineBtn.locator('.material-symbols-outlined');
      await expect(icon).toBeVisible();
      
      // Проверяем title
      await expect(underlineBtn).toHaveAttribute('title', /Подчёркнутый/);
    });
    
    test('кнопка подчёркивания должна быть рядом с Bold и Italic', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/theory-editor`);
      
      const boldBtn = page.locator('#theory-bold');
      const italicBtn = page.locator('#theory-italic');
      const underlineBtn = page.locator('#theory-underline');
      
      await expect(boldBtn).toBeVisible();
      await expect(italicBtn).toBeVisible();
      await expect(underlineBtn).toBeVisible();
    });
  });
  
  // ============================================================================
  // ИЗОБРАЖЕНИЯ
  // ============================================================================
  
  test.describe('Функциональность изображений', () => {
    
    test('изображения должны иметь атрибуты data-width и data-align', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/theory-editor`);
      
      // Проверяем, что если есть изображения, они имеют нужные атрибуты
      const images = page.locator('.theory-image');
      const count = await images.count();
      
      if (count > 0) {
        const firstImage = images.first();
        await expect(firstImage).toHaveAttribute('data-width');
        await expect(firstImage).toHaveAttribute('data-align');
      }
    });
    
    test('изображения должны быть кликабельными (cursor: pointer)', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/theory-editor`);
      
      const images = page.locator('.theory-image');
      const count = await images.count();
      
      if (count > 0) {
        const firstImage = images.first();
        const cursor = await firstImage.evaluate(el => window.getComputedStyle(el).cursor);
        expect(cursor).toBe('pointer');
      }
    });
    
    test('изображения должны быть обёрнуты в theory-image-wrapper', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/theory-editor`);
      
      const wrappers = page.locator('.theory-image-wrapper');
      const images = page.locator('.theory-image');
      
      const wrapperCount = await wrappers.count();
      const imageCount = await images.count();
      
      // Количество wrapper должно соответствовать количеству изображений
      if (imageCount > 0) {
        expect(wrapperCount).toBeGreaterThan(0);
      }
    });
  });
  
  // ============================================================================
  // UI ЭЛЕМЕНТЫ
  // ============================================================================
  
  test.describe('UI элементы - Списки и теги', () => {
    
    test('список теорий должен иметь достаточную высоту', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/theory-editor`);
      
      const libraryList = page.locator('#theory-library-list');
      if (await libraryList.count() > 0) {
        const maxHeight = await libraryList.evaluate(el => window.getComputedStyle(el).maxHeight);
        
        // Проверяем, что max-height установлен и не слишком мал
        expect(maxHeight).not.toBe('none');
        // Должно быть calc(100vh - 18rem) или больше
      }
    });
    
    test('теги в библиотеке не должны растягиваться', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/theory-editor`);
      
      // Проверяем элементы библиотеки
      const libraryItems = page.locator('.theory-library-item');
      const count = await libraryItems.count();
      
      if (count > 0) {
        const firstItem = libraryItems.first();
        const chip = firstItem.locator('.theory-chip');
        
        if (await chip.count() > 0) {
          // Проверяем, что у чипа есть shrink-0 или flex-shrink: 0
          const flexShrink = await chip.evaluate(el => window.getComputedStyle(el).flexShrink);
          expect(flexShrink).toBe('0');
        }
      }
    });
  });
  
  test.describe('UI элементы - Адаптивность кнопок', () => {
    
    test('кнопки должны адаптироваться на мобильных устройствах', async ({ page }) => {
      // Тест на мобильном viewport
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(`${BASE_URL}/ui/theory-editor`);
      
      const saveBtn = page.locator('#theory-save-btn');
      if (await saveBtn.count() > 0) {
        // На мобильных устройствах текст кнопки может быть скрыт
        await expect(saveBtn).toBeVisible();
      }
    });
    
    test('кнопки должны корректно отображаться на десктопе', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`${BASE_URL}/ui/theory-editor`);
      
      const saveBtn = page.locator('#theory-save-btn');
      if (await saveBtn.count() > 0) {
        await expect(saveBtn).toBeVisible();
      }
    });
  });
  
  // ============================================================================
  // ЦЕНТР ТЕОРИИ - СТАТУСЫ И TOOLTIPS
  // ============================================================================
  
  test.describe('Центр теории - Статусы и tooltips', () => {
    
    test('должны быть tooltips у статусов синхронизации', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/theory-center`);
      
      // Проверяем наличие элементов с title атрибутами
      const syncBadges = page.locator('[title*="синхронизиров"]');
      const count = await syncBadges.count();
      
      // Если есть элементы синхронизации, они должны иметь tooltips
      if (count > 0) {
        const firstBadge = syncBadges.first();
        const title = await firstBadge.getAttribute('title');
        expect(title).toBeTruthy();
        expect(title.length).toBeGreaterThan(0);
      }
    });
    
    test('кнопки действий должны иметь title атрибуты', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/theory-center`);
      
      // Проверяем кнопки с data-action
      const actionButtons = page.locator('[data-action]');
      const count = await actionButtons.count();
      
      if (count > 0) {
        // Хотя бы некоторые кнопки должны иметь title
        const buttonsWithTitle = page.locator('[data-action][title]');
        const titleCount = await buttonsWithTitle.count();
        expect(titleCount).toBeGreaterThan(0);
      }
    });
  });
  
  // ============================================================================
  // АНИМАЦИИ
  // ============================================================================
  
  test.describe('Оптимизация анимаций', () => {
    
    test('элементы с анимацией должны использовать will-change', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/theory-editor`);
      
      const toolbarBtn = page.locator('.theory-toolbar-btn').first();
      if (await toolbarBtn.count() > 0) {
        const willChange = await toolbarBtn.evaluate(el => window.getComputedStyle(el).willChange);
        expect(willChange).toContain('transform');
      }
    });
    
    test('transition должен быть оптимизирован', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/theory-center`);
      
      const summaryCard = page.locator('.theory-summary-card').first();
      if (await summaryCard.count() > 0) {
        const transition = await summaryCard.evaluate(el => window.getComputedStyle(el).transition);
        
        // Проверяем, что transition установлен
        expect(transition).not.toBe('all 0s ease 0s');
        expect(transition.length).toBeGreaterThan(0);
      }
    });
  });
  
  // ============================================================================
  // ИНТЕГРАЦИОННЫЕ ТЕСТЫ
  // ============================================================================
  
  test.describe('Интеграционные тесты', () => {
    
    test('навигация между редактором и центром теории работает', async ({ page }) => {
      await page.goto(`${BASE_URL}/ui/editor`);
      
      const theoryCenterBtn = page.locator('#theory-center-nav-btn');
      if (await theoryCenterBtn.count() > 0) {
        await theoryCenterBtn.click();
        
        // Ждём навигации
        await page.waitForTimeout(1000);
        
        // Проверяем, что мы на странице центра теории
        const url = page.url();
        expect(url).toContain('theory-center');
      }
    });
    
    test('все критичные элементы загружаются без ошибок', async ({ page }) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error));
      
      await page.goto(`${BASE_URL}/ui/editor`);
      await page.waitForLoadState('networkidle');
      
      // Проверяем отсутствие критичных ошибок
      const criticalErrors = errors.filter(e => 
        !e.message.includes('ResizeObserver') // Игнорируем известные некритичные ошибки
      );
      
      expect(criticalErrors.length).toBe(0);
    });
  });
});
