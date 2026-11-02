import { defineConfig } from '@playwright/test';

// Run against an isolated server/database; see README for the command.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  outputDir: '/tmp/falcon-time-playwright-results',
  reporter: 'list',
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:4318/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4318',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: { width: 1488, height: 1058 },
    locale: 'ru-RU',
    timezoneId: 'Asia/Yerevan',
    trace: 'retain-on-failure',
  },
});
