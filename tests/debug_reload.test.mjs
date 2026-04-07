import { test } from '@playwright/test';

const BASE_URL = 'http://localhost:8000';
const moduleId = 'test_tsentr_teorii';
const topicId = 'test_tema_bez_teorii';
const taskId = 'task_debug_reload';

test('debug_reload', async ({ page }) => {
  // Capture all console messages
  page.on('console', msg => {
    console.log(`[${msg.type()}]`, msg.text());
  });

  // Capture errors
  page.on('pageerror', error => {
    console.error('PAGE ERROR:', error.message);
  });

  // Navigate to editor
  console.log('Opening editor...');
  await page.goto(`${BASE_URL}/ui/editor/Point_Annotation.html?module=${moduleId}&topic=${topicId}&task=${taskId}&new=true&type=click&name=DebugReload`);
  
  // Wait a bit to see what happens
  await page.waitForTimeout(10000);
  
  console.log('Test complete');
});
