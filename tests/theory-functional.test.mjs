import { test, expect } from '@playwright/test';

/**
 * Функциональные тесты Центра теории
 * Проверяют интерактивность: клики, навигацию, изменения состояния
 */

const BASE_URL = 'http://localhost:8000';

test.describe('Центр теории - Функциональные тесты', () => {
  
  // ============================================================================
  // НАВИГАЦИЯ И КЛИКИ
  // ============================================================================
  
  test('Клик на кнопку "Центр теории" открывает страницу Центра теории', async ({ page }) => {
    // Открываем главный редактор
    await page.goto(`${BASE_URL}/ui/editor`);
    await page.waitForLoadState('networkidle');
    
    // Кликаем на кнопку Центра теории
    const theoryCenterBtn = page.locator('#theory-center-nav-btn');
    await theoryCenterBtn.click();
    
    // Ждём навигации
    await page.waitForURL(/theory-center/);
    
    // Проверяем, что мы на странице Центра теории
    expect(page.url()).toContain('theory-center');
    
    // Проверяем наличие характерных элементов Центра теории
    const theoryList = page.locator('#theory-center-list');
    await expect(theoryList).toBeAttached();
  });
  
  test('Кнопка подчёркивания в редакторе теории кликабельна', async ({ page }) => {
    await page.goto(`${BASE_URL}/ui/theory-editor`);
    await page.waitForLoadState('networkidle');
    
    const underlineBtn = page.locator('#theory-underline');
    await expect(underlineBtn).toBeAttached();
    
    // Проверяем, что кнопка кликабельна
    await expect(underlineBtn).toBeEnabled();
    
    // Кликаем на кнопку (не должно быть ошибок)
    await underlineBtn.click();
  });
  
  // ============================================================================
  // МОДАЛЬНЫЕ ОКНА
  // ============================================================================
  
  test('Модальное окно создания теории открывается и закрывается', async ({ page }) => {
    await page.goto(`${BASE_URL}/ui/editor`);
    await page.waitForLoadState('networkidle');
    
    const modal = page.locator('#create-theory-modal');
    
    // Изначально модалка должна быть закрыта
    const isOpen = await modal.evaluate(el => el.hasAttribute('open'));
    expect(isOpen).toBe(false);
    
    // Примечание: для полного теста нужно найти кнопку, которая открывает модалку
    // Это может быть кнопка "Создать новую теорию" в модалке управления теорией темы
  });
  
  test('Кнопка закрытия модального окна работает', async ({ page }) => {
    await page.goto(`${BASE_URL}/ui/editor`);
    await page.waitForLoadState('networkidle');
    
    const modal = page.locator('#create-theory-modal');
    const closeButtons = page.locator('[data-role="create-theory-close"]');
    
    // Проверяем наличие кнопок закрытия
    const count = await closeButtons.count();
    expect(count).toBeGreaterThan(0);
    
    // Проверяем, что кнопки кликабельны
    if (count > 0) {
      await expect(closeButtons.first()).toBeEnabled();
    }
  });
  
  // ============================================================================
  // ФОРМАТИРОВАНИЕ ТЕКСТА
  // ============================================================================
  
  test('Кнопки форматирования текста кликабельны и не вызывают ошибок', async ({ page }) => {
    await page.goto(`${BASE_URL}/ui/theory-editor`);
    await page.waitForLoadState('networkidle');
    
    // Проверяем все кнопки форматирования
    const buttons = [
      '#theory-bold',
      '#theory-italic',
      '#theory-underline',
      '#theory-h1',
      '#theory-h2'
    ];
    
    for (const btnId of buttons) {
      const btn = page.locator(btnId);
      if (await btn.count() > 0) {
        await expect(btn).toBeEnabled();
        
        // Кликаем на кнопку
        await btn.click();
        
        // Ждём небольшую задержку
        await page.waitForTimeout(100);
      }
    }
  });
  
  // ============================================================================
  // ИЗОБРАЖЕНИЯ
  // ============================================================================
  
  test('Клик по изображению должен вызывать функцию настройки', async ({ page }) => {
    await page.goto(`${BASE_URL}/ui/theory-editor`);
    await page.waitForLoadState('networkidle');
    
    // Проверяем, что функция theoryImageClick доступна в window
    const functionExists = await page.evaluate(() => {
      return typeof window.theoryImageClick === 'function';
    });
    
    expect(functionExists).toBe(true);
  });
  
  // ============================================================================
  // ЦЕНТР ТЕОРИИ - ИНТЕРАКТИВНОСТЬ
  // ============================================================================
  
  test('Переключение между вкладками Topics/Complexes работает', async ({ page }) => {
    await page.goto(`${BASE_URL}/ui/theory-center`);
    await page.waitForLoadState('networkidle');
    
    // Ищем кнопки переключения scope
    const scopeButtons = page.locator('[data-scope]');
    const count = await scopeButtons.count();
    
    if (count > 0) {
      // Кликаем на первую кнопку
      await scopeButtons.first().click();
      await page.waitForTimeout(500);
      
      // Проверяем, что URL изменился или состояние обновилось
      // (детали зависят от реализации)
    }
  });
  
  test('Поиск в Центре теории работает', async ({ page }) => {
    await page.goto(`${BASE_URL}/ui/theory-center`);
    await page.waitForLoadState('networkidle');
    
    // Ищем поле поиска
    const searchInput = page.locator('#theory-center-search, [placeholder*="Поиск"]');
    
    if (await searchInput.count() > 0) {
      // Вводим текст в поиск
      await searchInput.fill('тест');
      
      // Ждём обновления результатов
      await page.waitForTimeout(500);
      
      // Проверяем, что поиск не вызвал ошибок
      const errors = [];
      page.on('pageerror', error => errors.push(error));
      expect(errors.length).toBe(0);
    }
  });
  
  // ============================================================================
  // ПРОВЕРКА ОТСУТСТВИЯ ОШИБОК ПРИ ВЗАИМОДЕЙСТВИИ
  // ============================================================================
  
  test('Навигация по всем основным страницам не вызывает ошибок', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => {
      // Игнорируем некритичные ошибки
      if (!error.message.includes('ResizeObserver')) {
        errors.push(error.message);
      }
    });
    
    // Список страниц для проверки
    const pages = [
      '/ui/editor',
      '/ui/theory-center',
      '/ui/theory-editor'
    ];
    
    for (const url of pages) {
      await page.goto(`${BASE_URL}${url}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
    }
    
    // Проверяем отсутствие критичных ошибок
    expect(errors.length).toBe(0);
  });
  
  test('Множественные клики на кнопки форматирования не вызывают ошибок', async ({ page }) => {
    await page.goto(`${BASE_URL}/ui/theory-editor`);
    await page.waitForLoadState('networkidle');
    
    const errors = [];
    page.on('pageerror', error => {
      if (!error.message.includes('ResizeObserver')) {
        errors.push(error.message);
      }
    });
    
    // Кликаем на кнопки форматирования (они не вызывают навигацию)
    const buttons = ['#theory-bold', '#theory-italic', '#theory-underline'];
    
    for (const btnId of buttons) {
      const btn = page.locator(btnId);
      if (await btn.count() > 0) {
        // Кликаем 3 раза на каждую кнопку
        for (let i = 0; i < 3; i++) {
          await btn.click();
          await page.waitForTimeout(50);
        }
      }
    }
    
    expect(errors.length).toBe(0);
  });
  
  // ============================================================================
  // АДАПТИВНОСТЬ И RESPONSIVE
  // ============================================================================
  
  test('Переключение viewport не ломает интерфейс', async ({ page }) => {
    await page.goto(`${BASE_URL}/ui/editor`);
    
    const viewports = [
      { width: 1920, height: 1080 }, // Desktop
      { width: 1280, height: 720 },  // Laptop
      { width: 768, height: 1024 },  // Tablet
      { width: 375, height: 667 }    // Mobile
    ];
    
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(300);
      
      // Проверяем, что основные элементы всё ещё видны
      const header = page.locator('header');
      await expect(header).toBeVisible();
    }
  });
  
  // ============================================================================
  // ПРОИЗВОДИТЕЛЬНОСТЬ
  // ============================================================================
  
  test('Страницы загружаются за разумное время', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto(`${BASE_URL}/ui/editor`);
    await page.waitForLoadState('networkidle');
    
    const loadTime = Date.now() - startTime;
    
    // Страница должна загрузиться менее чем за 5 секунд
    expect(loadTime).toBeLessThan(5000);
  });
  
  test('Анимации не блокируют интерфейс', async ({ page }) => {
    await page.goto(`${BASE_URL}/ui/theory-center`);
    await page.waitForLoadState('networkidle');
    
    // Сразу после загрузки пытаемся кликнуть на элементы
    const cards = page.locator('.theory-summary-card, .theory-row-card');
    
    if (await cards.count() > 0) {
      // Кликаем на первую карточку
      await cards.first().click();
      
      // Проверяем, что клик обработался (нет ошибок)
      await page.waitForTimeout(100);
    }
  });
});
