const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/audit_suite/scenarios',
  testMatch: '**/*.audit.test.mjs',
  timeout: 90000,
  fullyParallel: false, // Run sequentially for predictable DB/state behavior
  workers: 1,           // Use a single worker to prevent database race conditions
  retries: 0,           // No retries; we want to catch every single failure immediately
  reporter: [
    ['html', { outputFolder: 'tests/audit_suite/reports/html-report' }],
    ['list']
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5000',
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    }
  ]
});
