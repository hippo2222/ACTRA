import { test as baseTest, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export const test = baseTest.extend({
  page: async ({ page }, use, testInfo) => {
    const consoleErrors = [];
    const failedRequests = [];
    
    // Create a clean, unique name for the screenshot directory for this test run
    const cleanTestTitle = testInfo.title.replace(/[^a-zA-Z0-9]/g, '_');
    const screenshotDir = path.join(
      process.cwd(),
      'tests/audit_suite/reports/screenshots',
      `${cleanTestTitle}_${Date.now()}`
    );
    
    // 1. Monitor console messages
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      // Fail on error logs
      if (type === 'error') {
        // Exclude generic favicon 404 errors and aborted/canceled fetch requests from reload/navigation
        if (text.includes('favicon.ico') || text.includes('404') || text.includes('Failed to fetch') || text.includes('Failed to load statistics') || text.includes('410') || text.includes('GONE') || text.includes('s3_storage_unavailable') || text.includes('503')) {
          return;
        }
        consoleErrors.push({
          type: 'console-error',
          text,
          location: msg.location()
        });
      }
    });

    // 2. Monitor uncaught JS exceptions
    page.on('pageerror', exception => {
      consoleErrors.push({
        type: 'uncaught-exception',
        text: exception.message,
        stack: exception.stack
      });
    });

    // 3. Monitor failed network requests (HTTP status >= 400)
    page.on('response', response => {
      const status = response.status();
      const url = response.url();
      
      // We focus strictly on API and main application requests (ignoring external third-party requests if any)
      if (status >= 400 && (url.includes('/api/') || url.includes('/session/') || url.includes('/theory/'))) {
        // Exclude expected 404 errors when task editor checks if a new task draft already exists
        if (status === 404 && url.includes('/api/editor/task/')) {
          return;
        }
        // Exclude expected 410 GONE when session is completed normally
        if (status === 410 && url.includes('/task')) {
          return;
        }
        // Exclude expected 503 during upload resilience test
        if (status === 503 && url.includes('upload-image')) {
          return;
        }
        failedRequests.push({
          type: 'http-error-response',
          url,
          status,
          statusText: response.statusText()
        });
      }
    });

    page.on('requestfailed', request => {
      const url = request.url();
      const failure = request.failure()?.errorText || 'Network request failed';
      
      if (failure.includes('net::ERR_ABORTED')) {
        return;
      }
      
      if (url.includes('/api/') || url.includes('/session/') || url.includes('/theory/')) {
        failedRequests.push({
          type: 'network-failure',
          url,
          status: 'FAILED',
          statusText: failure
        });
      }
    });

    // 4. Custom helper: capture visual states dynamically
    let stepCounter = 0;
    page.captureAuditScreenshot = async (stepName) => {
      stepCounter++;
      const cleanStepName = stepName.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `${String(stepCounter).padStart(2, '0')}_${cleanStepName}.png`;
      const filePath = path.join(screenshotDir, fileName);
      
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      
      // We capture the full scrollable page to inspect layout overflows
      await page.screenshot({ path: filePath, fullPage: true });
      console.log(`[Audit UI] Saved screen state to: ${filePath}`);
      return filePath;
    };

    // Run the actual test logic
    await use(page);

    // 5. Enforce strict checks after test completes
    if (consoleErrors.length > 0) {
      const details = consoleErrors
        .map(err => `[${err.type.toUpperCase()}] ${err.text} ${err.stack ? '\nStack: ' + err.stack : ''}`)
        .join('\n');
      throw new Error(`Audit Failure: Console error(s) detected during test execution!\n${details}`);
    }

    if (failedRequests.length > 0) {
      const details = failedRequests
        .map(req => `[${req.type.toUpperCase()} - ${req.status}] ${req.url} (${req.statusText})`)
        .join('\n');
      throw new Error(`Audit Failure: HTTP / API request failure(s) detected during test execution!\n${details}`);
    }
  }
});

export { expect };
