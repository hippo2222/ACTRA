import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8000';

test.describe('Центр теории - Базовые проверки', () => {
  
  test('Страница редактора загружается без ошибок', async ({ page }) => {
    await page.goto(`${BASE_URL}/editor`);
    
    // Проверяем, что страница загрузилась
    await expect(page).toHaveTitle(/ACTRA/);
    
    // Проверяем наличие основных элементов
    const header = page.locator('header');
    await expect(header).toBeVisible();
  });
  
  test('Кнопка "Центр теории" присутствует в хедере', async ({ page }) => {
    await page.goto(`${BASE_URL}/editor`);
    await page.waitForLoadState('networkidle');
    
    // Ищем кнопку по ID
    const theoryCenterBtn = page.locator('#theory-center-nav-btn');
    await expect(theoryCenterBtn).toBeVisible({ timeout: 10000 });
    
    // Проверяем текст кнопки
    await expect(theoryCenterBtn).toContainText('Центр теории');
  });
  
  test('Текст "Worker Sync" отсутствует на странице (заменён на "Автосинхронизация")', async ({ page }) => {
    await page.goto(`${BASE_URL}/editor`);
    await page.waitForLoadState('networkidle');
    
    // Получаем весь текст страницы
    const pageContent = await page.content();
    
    // Проверяем, что старый текст "Worker Sync" отсутствует
    expect(pageContent).not.toContain('Worker Sync');
    
    // Проверяем, что новый текст "Автосинхронизация" присутствует в HTML
    expect(pageContent).toContain('Автосинхронизация');
  });
});
