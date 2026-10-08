import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  globalTimeout: 180000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { browserName: 'chromium', channel: 'chromium', headless: true, trace: 'retain-on-failure' },
});
