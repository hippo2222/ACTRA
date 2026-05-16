import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * THEORY EDITOR IMAGE POPOVER — COMPREHENSIVE AUDIT
 * 
 * Парадигма: universal_audit_paradigm.md
 * Источник правды: data/theories/{theory_id}.json (delta format)
 * Область: редактор теории, image popover, image attributes persistence
 * 
 * 4-СЛОЙНАЯ ПРОВЕРКА НА КАЖДОМ ШАГЕ:
 *   1. UI — что видит пользователь (popover geometry, image DOM attributes, editor structure)
 *   2. Network — что уходит/приходит (PUT /api/theories/:id request/response body)
 *   3. File — источник правды (theory.json delta ops with image insert + attributes)
 *   4. Reload — персистентность (full page reload → UI re-renders from disk → state correct)
 * 
 * КРИТИЧЕСКИЕ ПРАВИЛА:
 *   ⭐ Minimal workflow ПЕРВЫМ — базовый сценарий без лишних действий
 *   ⭐ Reload/reopen ОБЯЗАТЕЛЬНО — каждый тест включает reload цикл
 *   ⭐ Ждём ДИНАМИЧЕСКИЙ контент, не статичный HTML шаблон
 *   ⭐ Timeout ≥ 30s для async операций (навигация, сеть, ожидание контента)
 *   ⭐ Артефакты на каждом шаге (screenshot, network payload/response, file JSON snapshot)
 *   ⭐ Негативные сценарии обязательны (попытка сохранить без title, закрыть без сохранения)
 */

const BASE_URL = 'http://localhost:8000';
const EDITOR_URL = `${BASE_URL}/theory-editor`;
const DATA_DIR = path.join(process.cwd(), 'data', 'complexes', 'theories');

// Увеличенные таймауты согласно парадигме
test.setTimeout(120000); // 2 минуты на весь тест

// ===========================================================================
// HELPERS — 4-layer verification utilities
// ===========================================================================

/**
 * Навигация с ожиданием ДИНАМИЧЕСКОГО контента (не статичного HTML)
 */
async function navigateToEditor(page, theoryId = null) {
  const url = theoryId ? `${EDITOR_URL}?theory_id=${encodeURIComponent(theoryId)}` : EDITOR_URL;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  
  // Ждём НЕ статичный контейнер, а динамически загруженный editor
  await page.waitForSelector('#theory-editor', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(800); // Дополнительное время для JS-инициализации
}

/**
 * LAYER 1: DOM Code Snapshot
 * Читаем HTML/CSS КОД страницы напрямую — это и есть состояние UI.
 * Не нужно смотреть в браузер — достаточно анализировать код до/после.
 */
async function captureDOMSnapshot(page, stepName) {
  // Полный HTML snapshot
  const fullHTML = await page.content();
  
  // Извлекаем критические фрагменты кода для анализа
  const snapshot = await page.evaluate(() => {
    const popover = document.getElementById('theory-image-popover');
    const img = document.querySelector('#theory-editor .theory-image');
    const wrapper = img?.closest('.theory-image-wrapper');
    const editor = document.getElementById('theory-editor');
    
    return {
      // Popover HTML code
      popover: popover ? {
        outerHTML: popover.outerHTML,
        className: popover.className,
        classList: Array.from(popover.classList),
        style: popover.getAttribute('style') || '',
        computedDisplay: window.getComputedStyle(popover).display,
        computedPosition: window.getComputedStyle(popover).position,
        computedZIndex: window.getComputedStyle(popover).zIndex,
        sliderHTML: document.getElementById('theory-image-modal-width')?.outerHTML || null,
        sliderValue: document.getElementById('theory-image-modal-width')?.value || null,
        labelHTML: document.getElementById('theory-image-modal-width-label')?.outerHTML || null,
        labelText: document.getElementById('theory-image-modal-width-label')?.textContent?.trim() || null,
        activeAlignBtn: popover.querySelector('.theory-image-align-btn.active')?.outerHTML || null,
        activeRotateBtn: popover.querySelector('.theory-image-rotate-btn.active')?.outerHTML || null,
      } : null,
      
      // Image HTML code
      image: img ? {
        outerHTML: img.outerHTML,
        attributes: {
          'data-width': img.getAttribute('data-width'),
          'data-align': img.getAttribute('data-align'),
          'data-rotate': img.getAttribute('data-rotate'),
          'data-path': img.getAttribute('data-path'),
          'class': img.getAttribute('class'),
          'style': img.getAttribute('style'),
          'onmousedown': img.getAttribute('onmousedown'),
          'onclick': img.getAttribute('onclick'),
        },
        inlineStyle: {
          width: img.style.width,
          maxWidth: img.style.maxWidth,
          transform: img.style.transform,
        },
        wrapperHTML: wrapper?.outerHTML || null,
        wrapperAttributes: wrapper ? {
          'class': wrapper.getAttribute('class'),
          'contenteditable': wrapper.getAttribute('contenteditable'),
          'style': wrapper.getAttribute('style'),
        } : null,
      } : null,
      
      // Editor structure code
      editor: editor ? {
        innerHTML: editor.innerHTML,
        childCount: editor.childElementCount,
        childNodes: Array.from(editor.childNodes).map(node => ({
          nodeType: node.nodeType,
          nodeName: node.nodeName,
          nodeValue: node.nodeValue,
          outerHTML: node.outerHTML || null,
          textContent: node.textContent?.substring(0, 100) || null,
        })),
        paragraphs: Array.from(editor.querySelectorAll('p')).map(p => ({
          innerHTML: p.innerHTML,
          textContent: p.textContent,
          hasImage: !!p.querySelector('.theory-image-wrapper'),
          isEmpty: p.innerHTML === '' || p.innerHTML === '<br>' || p.textContent.trim() === '',
        })),
      } : null,
      
      // Global state variables (если доступны)
      globalState: {
        imageModalTargetImg: typeof window._imageModalTargetImg !== 'undefined' ? 
          (window._imageModalTargetImg ? 'exists' : 'null') : 'undefined',
        popoverJustOpened: typeof window._popoverJustOpened !== 'undefined' ?
          window._popoverJustOpened : 'undefined',
      },
      
      timestamp: Date.now(),
    };
  });
  
  // Сохраняем HTML артефакты для diff-анализа
  const artifactDir = 'playwright-report';
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }
  
  const timestamp = Date.now();
  fs.writeFileSync(
    path.join(artifactDir, `dom-${stepName}-${timestamp}.html`),
    fullHTML,
    'utf8'
  );
  
  fs.writeFileSync(
    path.join(artifactDir, `dom-${stepName}-${timestamp}.json`),
    JSON.stringify(snapshot, null, 2),
    'utf8'
  );
  
  return snapshot;
}

/**
 * LAYER 2: Network Interception
 * Перехватываем POST /api/theories (новая теория) или PUT /api/theories/:id (существующая)
 */
async function interceptSaveRequest(page) {
  return new Promise((resolve) => {
    const handler = async (response) => {
      const url = response.url();
      const method = response.request().method();
      
      // POST /api/theories (новая теория) или PUT /api/theories/:id (существующая)
      if (url.includes('/api/theories') && (method === 'POST' || method === 'PUT')) {
        const requestBody = response.request().postData();
        const responseBody = await response.json().catch(() => null);
        
        page.off('response', handler);
        resolve({
          url,
          method,
          status: response.status(),
          ok: response.ok(),
          requestPayload: requestBody ? JSON.parse(requestBody) : null,
          responseBody,
        });
      }
    };
    
    page.on('response', handler);
    
    // Timeout fallback
    setTimeout(() => {
      page.off('response', handler);
      resolve(null);
    }, 35000);
  });
}

/**
 * LAYER 3: File System — читаем theory.json напрямую с диска
 * Структура: 
 *   data/complexes/theories/{theory_id}/theory.json — метаданные
 *   data/complexes/theories/{theory_id}/body.delta.json — Delta контент
 */
function readTheoryFile(theoryId) {
  const theoryDir = path.join(DATA_DIR, theoryId);
  const metaPath = path.join(theoryDir, 'theory.json');
  const deltaPath = path.join(theoryDir, 'body.delta.json');
  
  if (!fs.existsSync(metaPath)) {
    return { exists: false, path: metaPath, theoryDir };
  }
  
  const metaRaw = fs.readFileSync(metaPath, 'utf8');
  const meta = JSON.parse(metaRaw);
  
  // Читаем delta из отдельного файла
  let delta = null;
  let imageOps = [];
  
  if (fs.existsSync(deltaPath)) {
    const deltaRaw = fs.readFileSync(deltaPath, 'utf8');
    delta = JSON.parse(deltaRaw);
    
    // Извлекаем image ops из delta
    imageOps = (delta.ops || []).filter(op => 
      op.insert && typeof op.insert === 'object' && op.insert.image
    );
  }
  
  return {
    exists: true,
    path: metaPath,
    deltaPath,
    theoryDir,
    title: meta.title,
    meta,
    delta,
    imageOps,
  };
}

/**
 * LAYER 4: Reload — полная перезагрузка страницы и проверка UI
 */
async function reloadAndVerify(page, theoryId, expectedUIState) {
  await page.goto(`${EDITOR_URL}?theory_id=${encodeURIComponent(theoryId)}`, {
    waitUntil: 'networkidle',
    timeout: 60000,
  });
  
  // Ждём динамический контент — изображение должно отрендериться в DOM
  // Используем 'attached' вместо 'visible' т.к. тестовые изображения могут не загрузиться (404)
  // но структура DOM и атрибуты — это то, что мы проверяем
  await page.waitForSelector('#theory-editor .theory-image', { 
    state: 'attached', 
    timeout: 30000 
  });
  await page.waitForTimeout(1000);
  
  const reloadedState = await captureDOMSnapshot(page, 'after-reload');
  
  // Проверяем, что UI state совпадает с ожидаемым
  if (expectedUIState.image) {
    expect(reloadedState.image.attributes['data-width'], 'image width after reload').toBe(expectedUIState.image['data-width']);
    expect(reloadedState.image.attributes['data-align'], 'image align after reload').toBe(expectedUIState.image['data-align']);
    expect(reloadedState.image.attributes['data-rotate'], 'image rotate after reload').toBe(expectedUIState.image['data-rotate']);
    expect(reloadedState.image.inlineStyle.width, 'image style.width after reload').toBe(expectedUIState.image.styleWidth);
    expect(reloadedState.image.inlineStyle.transform, 'image style.transform after reload').toBe(expectedUIState.image.styleTransform);
  }
  
  return reloadedState;
}

/**
 * Создаёт новую теорию с изображением через UI (имитация реального workflow)
 */
async function createTheoryWithImage(page) {
  // Начинаем с пустой теории
  await page.evaluate(() => {
    if (typeof window.startNewTheory === 'function') {
      window.startNewTheory();
    }
  });
  await page.waitForTimeout(600);
  
  // Инжектим fake image (как если бы пользователь загрузил через UI)
  await page.evaluate(() => {
    const editor = document.getElementById('theory-editor');
    if (!editor) throw new Error('theory-editor not found');
    
    editor.innerHTML = '';
    
    const p = document.createElement('p');
    const wrapper = document.createElement('span');
    wrapper.className = 'theory-image-wrapper';
    wrapper.setAttribute('contenteditable', 'false');
    wrapper.style.cssText = 'display:block;';
    
    const img = document.createElement('img');
    img.src = '/assets/logo.png';
    img.className = 'theory-image';
    img.setAttribute('data-path', '/api/local-image?path=test/fake-audit.png');
    img.setAttribute('data-width', '100%');
    img.setAttribute('data-align', 'left');
    img.setAttribute('data-rotate', '0');
    img.style.cssText = 'max-width:100%;width:100%;border-radius:12px;cursor:pointer;';
    img.onmousedown = function(e) { e.preventDefault(); };
    img.onclick = function(e) { window.theoryImageClick(this, e); };
    
    wrapper.appendChild(img);
    p.appendChild(wrapper);
    editor.appendChild(p);
  });
  
  await page.waitForTimeout(400);
}

// ===========================================================================
// SUITE 1: MINIMAL WORKFLOW (⭐ КРИТИЧНО — запускается ПЕРВЫМ)
// ===========================================================================

test.describe('⭐ MINIMAL WORKFLOW — базовый сценарий', () => {
  
  test('S01_minimal_popover_open_close', async ({ page }) => {
    /**
     * ID: S01_minimal_popover_open_close
     * Тип: minimal workflow
     * Предусловие: редактор теории открыт, есть изображение
     * Шаги:
     *   1. Кликнуть на изображение
     *   2. Popover открывается рядом с изображением
     *   3. Кликнуть на кнопку закрытия
     *   4. Popover скрывается
     * Проверяем: UI (popover display, geometry) + editor structure (no extra nodes)
     * Ожидаемый результат: OK
     */
    
    await navigateToEditor(page);
    await createTheoryWithImage(page);
    
    // STEP 1: Baseline — popover hidden
    const baseline = await captureDOMSnapshot(page, 's01-baseline');
    expect(baseline.popover, 'popover exists').not.toBeNull();
    expect(baseline.popover.classList, 'popover hidden on load').toContain('popover-hidden');
    expect(baseline.popover.computedDisplay, 'display:none when hidden').toBe('none');
    expect(baseline.image, 'image exists').not.toBeNull();
    
    const baselineEditorChildCount = baseline.editor.childCount;
    
    // STEP 2: Click image → popover opens
    await page.evaluate(() => {
      document.querySelector('#theory-editor .theory-image')?.click();
    });
    await page.waitForTimeout(300);
    
    const afterOpen = await captureDOMSnapshot(page, 's01-after-open');
    expect(afterOpen.popover.classList, 'popover visible after click').not.toContain('popover-hidden');
    expect(afterOpen.popover.computedDisplay, 'display not none').not.toBe('none');
    expect(afterOpen.popover.computedPosition, 'position:fixed').toBe('fixed');
    expect(Number(afterOpen.popover.computedZIndex), 'z-index high').toBeGreaterThanOrEqual(999);
    
    // Проверяем что popover имеет inline style с top/left (позиционирован)
    expect(afterOpen.popover.style, 'popover positioned').toMatch(/top:/);
    expect(afterOpen.popover.style, 'popover positioned').toMatch(/left:/);
    
    // Editor structure unchanged
    expect(afterOpen.editor.childCount, 'no extra nodes after open').toBe(baselineEditorChildCount);
    
    // STEP 3: Close popover
    await page.evaluate(() => {
      document.getElementById('theory-image-popover-close')?.click();
    });
    await page.waitForTimeout(300);
    
    const afterClose = await captureDOMSnapshot(page, 's01-after-close');
    expect(afterClose.popover.classList, 'popover hidden after close').toContain('popover-hidden');
    expect(afterClose.popover.computedDisplay, 'display:none after close').toBe('none');
    expect(afterClose.editor.childCount, 'no extra nodes after close').toBe(baselineEditorChildCount);
  });
  
  test('S02_minimal_change_width_and_save', async ({ page }) => {
    /**
     * ID: S02_minimal_change_width_and_save
     * Тип: minimal workflow + roundtrip
     * Предусловие: редактор теории, изображение
     * Шаги:
     *   1. Открыть popover
     *   2. Изменить ширину на 60%
     *   3. Сохранить теорию
     *   4. Проверить все 4 слоя
     * Проверяем: UI + Network + File + Reload
     * Ожидаемый результат: OK — ширина сохраняется на всех слоях
     */
    
    await navigateToEditor(page);
    await createTheoryWithImage(page);
    
    // STEP 1: Open popover
    await page.evaluate(() => {
      document.querySelector('#theory-editor .theory-image')?.click();
    });
    await page.waitForTimeout(300);
    
    const beforeChange = await captureDOMSnapshot(page, 's02-before-change');
    expect(beforeChange.image.attributes['data-width']).toBe('100%');
    
    // STEP 2: Change width to 60%
    await page.evaluate(() => {
      const slider = document.getElementById('theory-image-modal-width');
      slider.value = '60';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(500);
    
    // LAYER 1: UI check
    const afterChange = await captureDOMSnapshot(page, 's02-after-change');
    expect(afterChange.image.attributes['data-width'], 'data-width updated').toBe('60%');
    expect(afterChange.image.inlineStyle.width, 'style.width updated').toBe('60%');
    expect(afterChange.image.inlineStyle.maxWidth, 'style.maxWidth updated').toBe('60%');
    expect(afterChange.popover.sliderValue, 'slider value').toBe('60');
    expect(afterChange.popover.labelText, 'label text').toBe('60%');
    
    // STEP 3: Save theory
    const uniqueTitle = `Audit Test ${Date.now()}`;
    await page.locator('#theory-title').fill(uniqueTitle, { timeout: 10000 });
    
    const networkPromise = interceptSaveRequest(page);
    await page.locator('#theory-save-btn').click({ timeout: 10000 });
    
    // LAYER 2: Network check
    const networkData = await networkPromise;
    console.log('[S02] Network data:', JSON.stringify(networkData, null, 2));
    expect(networkData, 'network request captured').not.toBeNull();
    expect(networkData.ok, 'HTTP 200').toBe(true);
    expect(networkData.requestPayload.title, 'title in payload').toBe(uniqueTitle);
    
    // Проверяем delta в payload содержит image op с width=60%
    const imageOpsInPayload = networkData.requestPayload.delta.ops.filter(op =>
      op.insert && typeof op.insert === 'object' && op.insert.image
    );
    expect(imageOpsInPayload.length, 'image op in payload').toBeGreaterThan(0);
    expect(imageOpsInPayload[0].attributes?.width, 'width in payload').toBe('60%');
    
    await page.waitForTimeout(2500);
    
    // Извлекаем theory ID из response body (для POST) или URL (для PUT)
    let theoryId;
    if (networkData.responseBody?.item?.id) {
      theoryId = networkData.responseBody.item.id;
      console.log('[S02] Theory ID from response:', theoryId);
    } else {
      const currentUrl = page.url();
      console.log('[S02] Current URL:', currentUrl);
      const match = currentUrl.match(/[?&]id=([^&#]+)/);
      if (!match) {
        throw new Error(`Cannot extract theory ID. URL: ${currentUrl}, Response: ${JSON.stringify(networkData.responseBody)}`);
      }
      theoryId = decodeURIComponent(match[1]);
      console.log('[S02] Theory ID from URL:', theoryId);
    }
    
    // LAYER 3: File check
    const fileData = readTheoryFile(theoryId);
    expect(fileData.exists, 'theory file exists on disk').toBe(true);
    expect(fileData.title, 'title in file').toBe(uniqueTitle);
    expect(fileData.imageOps.length, 'image ops in file').toBeGreaterThan(0);
    expect(fileData.imageOps[0].attributes?.width, 'width in file').toBe('60%');
    
    // LAYER 4: Reload check
    await reloadAndVerify(page, theoryId, {
      image: {
        'data-width': '60%',
        'data-align': 'left',
        'data-rotate': '0',
        styleWidth: '60%',
        styleTransform: '',
      },
    });
  });
});

// ===========================================================================
// SUITE 2: RELOAD/REOPEN (⭐ КРИТИЧНО)
// ===========================================================================

test.describe('⭐ RELOAD/REOPEN — персистентность данных', () => {
  
  test('S03_full_roundtrip_width_align_rotate', async ({ page }) => {
    /**
     * ID: S03_full_roundtrip_width_align_rotate
     * Тип: roundtrip + reload/reopen
     * Предусловие: редактор теории
     * Шаги:
     *   1. Создать теорию с изображением
     *   2. Изменить width=55%, align=center, rotate=90
     *   3. Сохранить
     *   4. Reload страницы
     *   5. Проверить UI показывает правильное состояние
     * Проверяем: все 4 слоя
     * Ожидаемый результат: OK — все атрибуты выживают roundtrip
     */
    
    await navigateToEditor(page);
    await createTheoryWithImage(page);
    
    // Open popover
    await page.evaluate(() => {
      document.querySelector('#theory-editor .theory-image')?.click();
    });
    await page.waitForTimeout(300);
    
    // Apply settings: width=55%, align=center, rotate=90
    await page.evaluate(() => {
      const slider = document.getElementById('theory-image-modal-width');
      slider.value = '55';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      
      document.querySelector('#theory-image-popover .theory-image-align-btn[data-align="center"]')?.click();
      document.querySelector('#theory-image-popover .theory-image-rotate-btn[data-rotate="90"]')?.click();
    });
    await page.waitForTimeout(800);
    
    // LAYER 1: UI before save
    const beforeSave = await captureDOMSnapshot(page, 's03-before-save');
    expect(beforeSave.image.attributes['data-width']).toBe('55%');
    expect(beforeSave.image.attributes['data-align']).toBe('center');
    expect(beforeSave.image.attributes['data-rotate']).toBe('90');
    expect(beforeSave.image.inlineStyle.transform).toContain('rotate(90deg)');  
    expect(beforeSave.image.wrapperAttributes.style).toContain('text-align: center');
    
    // Save
    const uniqueTitle = `Roundtrip Test ${Date.now()}`;
    await page.locator('#theory-title').fill(uniqueTitle, { timeout: 10000 });
    
    const networkPromise = interceptSaveRequest(page);
    await page.locator('#theory-save-btn').click({ timeout: 10000 });
    const networkData = await networkPromise;
    
    console.log('[S03] Network data:', JSON.stringify(networkData, null, 2));
    
    await page.waitForTimeout(2500);
    
    // Извлекаем theory ID из response body (для POST) или URL (для PUT)
    let theoryId;
    if (networkData?.responseBody?.item?.id) {
      theoryId = networkData.responseBody.item.id;
      console.log('[S03] Theory ID from response:', theoryId);
    } else {
      const currentUrl = page.url();
      console.log('[S03] Current URL:', currentUrl);
      const match = currentUrl.match(/[?&]id=([^&#]+)/);
      if (!match) {
        throw new Error(`Cannot extract theory ID. URL: ${currentUrl}, Response: ${JSON.stringify(networkData?.responseBody)}`);
      }
      theoryId = decodeURIComponent(match[1]);
      console.log('[S03] Theory ID from URL:', theoryId);
    }
    
    // LAYER 2: Network
    expect(networkData.requestPayload.delta.ops.find(op => op.insert?.image)?.attributes).toMatchObject({
      width: '55%',
      align: 'center',
      rotate: '90',
    });
    
    // LAYER 3: File
    const fileData = readTheoryFile(theoryId);
    expect(fileData.imageOps[0].attributes).toMatchObject({
      width: '55%',
      align: 'center',
      rotate: '90',
    });
    
    // LAYER 4: Full page reload
    await page.goto(`${EDITOR_URL}?theory_id=${encodeURIComponent(theoryId)}`, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    await page.waitForSelector('#theory-editor .theory-image', { state: 'attached', timeout: 30000 });
    await page.waitForTimeout(1200);
    
    const afterReload = await captureDOMSnapshot(page, 's03-after-reload');
    
    // Все атрибуты должны совпадать с before-save
    expect(afterReload.image.attributes['data-width'], 'width after reload').toBe('55%');
    expect(afterReload.image.inlineStyle.width, 'style.width after reload').toBe('55%');
    expect(afterReload.image.inlineStyle.maxWidth, 'style.maxWidth after reload').toBe('55%');
    expect(afterReload.image.attributes['data-align'], 'align after reload').toBe('center');
    expect(afterReload.image.wrapperAttributes.style, 'wrapper text-align after reload').toMatch(/text-align:\s*center/);
    expect(afterReload.image.attributes['class'], 'className mx-auto after reload').toContain('mx-auto');
    expect(afterReload.image.attributes['data-rotate'], 'rotate after reload').toBe('90');
    expect(afterReload.image.inlineStyle.transform, 'transform after reload').toContain('rotate(90deg');
    
    // Popover должен быть скрыт после reload
    expect(afterReload.popover.classList, 'popover hidden after reload').toContain('popover-hidden');
  });
});

// ===========================================================================
// SUITE 3: EDITOR STRUCTURE INTEGRITY — no extra lines
// ===========================================================================

test.describe('Editor structure integrity — no extra blank lines', () => {
  
  test('S04_no_extra_lines_on_popover_interactions', async ({ page }) => {
    /**
     * ID: S04_no_extra_lines_on_popover_interactions
     * Тип: edge case / regression
     * Предусловие: редактор с изображением
     * Шаги:
     *   1. Baseline: записать editor.childElementCount
     *   2. Открыть popover
     *   3. Изменить width
     *   4. Изменить align
     *   5. Изменить rotate
     *   6. Закрыть popover
     *   7. Проверить editor.childElementCount не изменился
     * Проверяем: UI (editor structure)
     * Ожидаемый результат: OK — никаких лишних узлов не добавляется
     */
    
    await navigateToEditor(page);
    await createTheoryWithImage(page);
    
    const baseline = await captureDOMSnapshot(page, 's04-baseline');
    const baselineCount = baseline.editor.childCount;
    const baselineEmptyP = baseline.editor.paragraphs.filter(p => p.isEmpty).length;
    
    // Open
    await page.evaluate(() => document.querySelector('#theory-editor .theory-image')?.click());
    await page.waitForTimeout(300);
    const afterOpen = await captureDOMSnapshot(page, 's04-after-open');
    expect(afterOpen.editor.childCount, 'after open').toBe(baselineCount);
    
    // Change width
    await page.evaluate(() => {
      const s = document.getElementById('theory-image-modal-width');
      s.value = '50';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const afterWidth = await captureDOMSnapshot(page, 's04-after-width');
    expect(afterWidth.editor.childCount, 'after width').toBe(baselineCount);
    
    // Change align
    await page.evaluate(() => {
      document.querySelector('#theory-image-popover .theory-image-align-btn[data-align="center"]')?.click();
    });
    await page.waitForTimeout(300);
    const afterAlign = await captureDOMSnapshot(page, 's04-after-align');
    expect(afterAlign.editor.childCount, 'after align').toBe(baselineCount);
    
    // Change rotate
    await page.evaluate(() => {
      document.querySelector('#theory-image-popover .theory-image-rotate-btn[data-rotate="90"]')?.click();
    });
    await page.waitForTimeout(300);
    const afterRotate = await captureDOMSnapshot(page, 's04-after-rotate');
    expect(afterRotate.editor.childCount, 'after rotate').toBe(baselineCount);
    
    // Close
    await page.evaluate(() => document.getElementById('theory-image-popover-close')?.click());
    await page.waitForTimeout(300);
    const afterClose = await captureDOMSnapshot(page, 's04-after-close');
    expect(afterClose.editor.childCount, 'after close').toBe(baselineCount);
    expect(afterClose.editor.paragraphs.filter(p => p.isEmpty).length, 'no extra empty paragraphs').toBe(baselineEmptyP);
  });
  
  test('S05_multiple_open_close_cycles_no_accumulation', async ({ page }) => {
    /**
     * ID: S05_multiple_open_close_cycles_no_accumulation
     * Тип: regression
     * Предусловие: редактор с изображением
     * Шаги:
     *   1. Baseline
     *   2. Открыть/закрыть popover 5 раз
     *   3. Проверить editor.childElementCount и totalChildNodes не изменились
     * Проверяем: UI (editor structure)
     * Ожидаемый результат: OK — нет утечки узлов
     */
    
    await navigateToEditor(page);
    await createTheoryWithImage(page);
    
    const baseline = await captureDOMSnapshot(page, 's05-baseline');
    const baselineCount = baseline.editor.childCount;
    
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => document.querySelector('#theory-editor .theory-image')?.click());
      await page.waitForTimeout(200);
      await page.evaluate(() => document.getElementById('theory-image-popover-close')?.click());
      await page.waitForTimeout(200);
    }
    
    const afterCycles = await captureDOMSnapshot(page, 's05-after-cycles');
    expect(afterCycles.editor.childCount, 'no node accumulation').toBe(baselineCount);
  });
});

// ===========================================================================
// SUITE 4: NEGATIVE SCENARIOS — валидация и edge cases
// ===========================================================================

test.describe('Negative scenarios — валидация', () => {
  
  test('S06_close_methods_all_work', async ({ page }) => {
    /**
     * ID: S06_close_methods_all_work
     * Тип: happy path (все способы закрытия)
     * Предусловие: редактор с изображением, popover открыт
     * Шаги:
     *   1. Закрыть через кнопку X
     *   2. Открыть снова, закрыть через Escape
     *   3. Открыть снова, закрыть через outside click
     * Проверяем: UI (popover hidden after each close)
     * Ожидаемый результат: OK — все методы работают
     */
    
    await navigateToEditor(page);
    await createTheoryWithImage(page);
    
    // Method 1: Close button
    await page.evaluate(() => document.querySelector('#theory-editor .theory-image')?.click());
    await page.waitForTimeout(300);
    let state = await captureDOMSnapshot(page, 's06-open-1');
    expect(state.popover.classList).not.toContain('popover-hidden');
    
    await page.evaluate(() => document.getElementById('theory-image-popover-close')?.click());
    await page.waitForTimeout(300);
    state = await captureDOMSnapshot(page, 's06-close-1');
    expect(state.popover.classList, 'closed via button').toContain('popover-hidden');
    
    // Method 2: Escape key
    await page.evaluate(() => document.querySelector('#theory-editor .theory-image')?.click());
    await page.waitForTimeout(300);
    state = await captureDOMSnapshot(page, 's06-open-2');
    expect(state.popover.classList).not.toContain('popover-hidden');
    
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    state = await captureDOMSnapshot(page, 's06-close-2');
    expect(state.popover.classList, 'closed via Escape').toContain('popover-hidden');
    
    // Method 3: Outside click
    await page.evaluate(() => document.querySelector('#theory-editor .theory-image')?.click());
    await page.waitForTimeout(300);
    state = await captureDOMSnapshot(page, 's06-open-3');
    expect(state.popover.classList).not.toContain('popover-hidden');
    
    await page.locator('#theory-title').click({ timeout: 10000 });
    await page.waitForTimeout(300);
    state = await captureDOMSnapshot(page, 's06-close-3');
    expect(state.popover.classList, 'closed via outside click').toContain('popover-hidden');
  });
  
  test('S07_popover_stays_open_on_internal_interactions', async ({ page }) => {
    /**
     * ID: S07_popover_stays_open_on_internal_interactions
     * Тип: edge case
     * Предусловие: popover открыт
     * Шаги:
     *   1. Кликнуть на slider
     *   2. Кликнуть на align button
     *   3. Кликнуть на rotate button
     *   4. Проверить popover всё ещё открыт
     * Проверяем: UI (popover не закрывается случайно)
     * Ожидаемый результат: OK — popover остаётся открытым
     */
    
    await navigateToEditor(page);
    await createTheoryWithImage(page);
    
    await page.evaluate(() => document.querySelector('#theory-editor .theory-image')?.click());
    await page.waitForTimeout(300);
    
    // Interact with slider
    await page.evaluate(() => {
      const s = document.getElementById('theory-image-modal-width');
      s.value = '60';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    let state = await captureDOMSnapshot(page, 's07-after-slider');
    expect(state.popover.classList, 'popover open after slider').not.toContain('popover-hidden');
    
    // Interact with align button
    await page.evaluate(() => {
      document.querySelector('#theory-image-popover .theory-image-align-btn[data-align="center"]')?.click();
    });
    await page.waitForTimeout(300);
    state = await captureDOMSnapshot(page, 's07-after-align');
    expect(state.popover.classList, 'popover open after align').not.toContain('popover-hidden');
    
    // Interact with rotate button
    await page.evaluate(() => {
      document.querySelector('#theory-image-popover .theory-image-rotate-btn[data-rotate="90"]')?.click();
    });
    await page.waitForTimeout(300);
    state = await captureDOMSnapshot(page, 's07-after-rotate');
    expect(state.popover.classList, 'popover open after rotate').not.toContain('popover-hidden');
  });
});
