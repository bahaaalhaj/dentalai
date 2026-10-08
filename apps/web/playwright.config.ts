import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  // Four independent real-database fixtures plus offline asset verification.
  // Per-test (60s) and assertion timeouts are unchanged; no retries are added.
  globalTimeout: 300000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { browserName: 'chromium', channel: 'chromium', headless: true, trace: 'retain-on-failure' },
});
