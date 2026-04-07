/**
 * Simple test to verify error detection task reload shows correct UI
 */
import { test, expect } from '@playwright/test';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'http://localhost:8000';
const moduleId = 'test_tsentr_teorii';
const topicId = 'test_tema_bez_teorii';
const taskId = `task_test_${Date.now()}`;

test('error_detection_task_shows_correct_ui_on_reload', async ({ page }) => {
  // Capture console for debugging
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    if (text.includes('[DEBUG]') || text.includes('ERROR')) {
      console.log('BROWSER:', text);
    }
  });

  page.on('pageerror', error => {
    console.error('PAGE ERROR:', error.message);
  });

  console.log('Step 1: Create new error detection task');
  await page.goto(`${BASE_URL}/ui/editor/Point_Annotation.html?module=${moduleId}&topic=${topicId}&task=${taskId}&new=true&type=click&name=TestErrorTask`);
  
  // Wait for editor to load
  await page.waitForFunction(() => {
    const overlay = document.querySelector('.fixed.inset-0.z-50.bg-bg-main');
    return !overlay || overlay.classList.contains('hidden') || window.getComputedStyle(overlay).display === 'none';
  }, { timeout: 30000 });
  
  await page.waitForSelector('#save-task-btn', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1000);

  console.log('Step 2: Switch to Errors mode');
  await page.click('#mode-errors-btn');
  await page.waitForTimeout(2000); // Wait for errors pane to load

  console.log('Step 3: Switch to text_errors submode');
  const textErrorsBtn = page.locator('[data-subtask-mode="text_errors"]');
  await textErrorsBtn.waitFor({ state: 'visible', timeout: 5000 });
  await textErrorsBtn.click();
  await page.waitForTimeout(500);

  console.log('Step 4: Add some text and error span');
  await page.locator('[data-errors-text-editor]').fill('Test error detection task');
  await page.waitForTimeout(300);
  
  // Add error span
  const addSpanBtn = page.locator('[data-add-error-span-btn]');
  await addSpanBtn.click();
  await page.waitForTimeout(300);
  
  // Fill span data
  await page.locator('[data-span-start-input]').last().fill('0');
  await page.locator('[data-span-end-input]').last().fill('4');
  await page.waitForTimeout(300);

  console.log('Step 5: Save task');
  await page.click('#save-task-btn');
  await page.waitForTimeout(2000);

  console.log('Step 6: Reload task (open existing task)');
  await page.goto(`${BASE_URL}/ui/editor/Point_Annotation.html?module=${moduleId}&topic=${topicId}&task=${taskId}`);
  
  // Wait for editor to load
  await page.waitForFunction(() => {
    const overlay = document.querySelector('.fixed.inset-0.z-50.bg-bg-main');
    return !overlay || overlay.classList.contains('hidden') || window.getComputedStyle(overlay).display === 'none';
  }, { timeout: 30000 });
  
  await page.waitForSelector('#save-task-btn', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(2000); // Wait for async operations

  console.log('Step 7: Verify Errors UI is shown');
  
  // Check that errors pane is visible
  const errorsModePane = page.locator('#errors-mode-pane');
  const clickModePane = page.locator('#click-mode-pane');
  
  const errorsVisible = await errorsModePane.isVisible();
  const clickVisible = await clickModePane.isVisible();
  
  console.log('Errors pane visible:', errorsVisible);
  console.log('Click pane visible:', clickVisible);
  
  // Print relevant debug logs
  console.log('\n=== Debug Logs ===');
  logs.filter(log => log.includes('[DEBUG]')).forEach(log => console.log(log));
  
  // Verify
  expect(errorsVisible).toBe(true);
  expect(clickVisible).toBe(false);
  
  // Verify data is loaded
  const textValue = await page.locator('[data-errors-text-editor]').inputValue();
  expect(textValue).toBe('Test error detection task');
  
  console.log('✅ Test passed - Errors UI shown correctly on reload');

  // Cleanup
  try {
    const taskPath = join('data', 'modules', moduleId, 'topics', topicId, 'tasks', taskId, 'task.json');
    if (existsSync(taskPath)) {
      unlinkSync(taskPath);
      console.log('Cleaned up test task');
    }
  } catch (e) {
    console.log('Cleanup error:', e.message);
  }
});
