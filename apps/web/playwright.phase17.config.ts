import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e-phase17',
  timeout: 60000,
  globalTimeout: 600000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { browserName: 'chromium', channel: 'chromium', headless: true, trace: 'retain-on-failure' },
});
