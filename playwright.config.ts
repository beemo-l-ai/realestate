import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],

  use: {
    headless: process.env.HEADLESS === '1',
    viewport: { width: 1400, height: 900 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    // Reuse a logged-in session by saving storage state once.
    storageState: process.env.CHATGPT_STORAGE_STATE || undefined,
  },
});
