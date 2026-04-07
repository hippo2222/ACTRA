/**
 * Helper функции для тестов Центра теории
 */

export const BASE_URL = 'http://localhost:5000';

/**
 * Ожидание загрузки страницы без ошибок
 */
export async function waitForPageLoad(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500); // Дополнительное время для анимаций
}

/**
 * Проверка отсутствия критичных ошибок в консоли
 */
export function setupErrorTracking(page) {
  const errors = [];
  const warnings = [];
  
  page.on('pageerror', error => {
    errors.push(error.message);
  });
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    } else if (msg.type() === 'warning') {
      warnings.push(msg.text());
    }
  });
  
  return { errors, warnings };
}

/**
 * Открытие модалки управления теорией темы
 */
export async function openTopicTheoryModal(page, moduleId, topicId) {
  // Предполагается, что на странице есть кнопка для открытия модалки
  const button = page.locator(`[data-module-id="${moduleId}"][data-topic-id="${topicId}"]`);
  if (await button.count() > 0) {
    await button.click();
    await page.waitForSelector('#topic-theory-modal[open]', { timeout: 5000 });
    return true;
  }
  return false;
}

/**
 * Проверка видимости элемента с учётом анимаций
 */
export async function waitForElementVisible(page, selector, timeout = 5000) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
  await page.waitForTimeout(300); // Ждём завершения анимации
}

/**
 * Создание тестовой теории
 */
export async function createTestTheory(page, title = 'Test Theory') {
  const modal = page.locator('#create-theory-modal');
  const input = page.locator('#create-theory-title-input');
  const confirmBtn = page.locator('#create-theory-confirm-btn');
  
  // Открываем модалку (предполагается, что она уже открыта)
  await input.fill(title);
  await confirmBtn.click();
  
  // Ждём закрытия модалки
  await page.waitForSelector('#create-theory-modal:not([open])', { timeout: 5000 });
}

/**
 * Проверка CSS свойства элемента
 */
export async function getCSSProperty(page, selector, property) {
  const element = page.locator(selector).first();
  return await element.evaluate((el, prop) => {
    return window.getComputedStyle(el)[prop];
  }, property);
}

/**
 * Проверка наличия tooltip
 */
export async function hasTooltip(page, selector) {
  const element = page.locator(selector).first();
  const title = await element.getAttribute('title');
  return title && title.length > 0;
}

/**
 * Симуляция клика с ожиданием
 */
export async function clickAndWait(page, selector, waitTime = 500) {
  await page.locator(selector).click();
  await page.waitForTimeout(waitTime);
}

/**
 * Проверка адаптивности на разных размерах экрана
 */
export const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
  wide: { width: 1920, height: 1080 }
};

/**
 * Тестирование на разных viewport'ах
 */
export async function testOnViewports(page, testFn) {
  const results = {};
  
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(300);
    results[name] = await testFn(page, viewport);
  }
  
  return results;
}

/**
 * Проверка производительности анимаций
 */
export async function checkAnimationPerformance(page, selector) {
  const element = page.locator(selector).first();
  
  const metrics = await element.evaluate(el => {
    const style = window.getComputedStyle(el);
    return {
      transition: style.transition,
      willChange: style.willChange,
      transform: style.transform
    };
  });
  
  return metrics;
}

/**
 * Скриншот элемента для визуального тестирования
 */
export async function takeElementScreenshot(page, selector, name) {
  const element = page.locator(selector).first();
  await element.screenshot({ path: `screenshots/${name}.png` });
}

/**
 * Проверка доступности (a11y)
 */
export async function checkAccessibility(page, selector) {
  const element = page.locator(selector).first();
  
  const a11y = await element.evaluate(el => {
    return {
      hasAriaLabel: !!el.getAttribute('aria-label'),
      hasTitle: !!el.getAttribute('title'),
      hasAlt: el.tagName === 'IMG' ? !!el.getAttribute('alt') : null,
      tabIndex: el.tabIndex,
      role: el.getAttribute('role')
    };
  });
  
  return a11y;
}

/**
 * Ожидание появления toast-уведомления
 */
export async function waitForToast(page, expectedText = null, timeout = 5000) {
  // Предполагаемый селектор для toast
  const toastSelector = '.toast, [role="alert"], .notification';
  
  try {
    await page.waitForSelector(toastSelector, { state: 'visible', timeout });
    
    if (expectedText) {
      const toast = page.locator(toastSelector);
      const text = await toast.textContent();
      return text.includes(expectedText);
    }
    
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Проверка корректности Delta формата изображения
 */
export async function checkImageDeltaFormat(page, imageSelector) {
  const image = page.locator(imageSelector).first();
  
  const attrs = await image.evaluate(el => {
    return {
      dataPath: el.getAttribute('data-path'),
      dataWidth: el.getAttribute('data-width'),
      dataAlign: el.getAttribute('data-align'),
      src: el.getAttribute('src'),
      style: el.getAttribute('style')
    };
  });
  
  return attrs;
}

/**
 * Симуляция загрузки изображения
 */
export async function uploadTestImage(page, filePath) {
  const fileInput = page.locator('#theory-image-input');
  await fileInput.setInputFiles(filePath);
  await page.waitForTimeout(1000); // Ждём загрузки
}

/**
 * Проверка flex-layout элементов
 */
export async function checkFlexLayout(page, containerSelector) {
  const container = page.locator(containerSelector).first();
  
  const layout = await container.evaluate(el => {
    const style = window.getComputedStyle(el);
    const children = Array.from(el.children).map(child => {
      const childStyle = window.getComputedStyle(child);
      return {
        flexGrow: childStyle.flexGrow,
        flexShrink: childStyle.flexShrink,
        flexBasis: childStyle.flexBasis
      };
    });
    
    return {
      display: style.display,
      flexDirection: style.flexDirection,
      justifyContent: style.justifyContent,
      alignItems: style.alignItems,
      children
    };
  });
  
  return layout;
}
