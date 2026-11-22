import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PK6_PORT || 4183);
const baseURL = process.env.PK6_BASE || `http://127.0.0.1:${PORT}/`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '.playwright-artifacts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM || undefined,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--renderer-process-limit=2'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      // a phone's metrics and touch input, on the engine this host can run:
      // WebKit (real iOS Safari) needs system libraries this sandbox does not
      // have, so the mobile pass is Chromium with the iPhone 13 profile
      name: 'mobile',
      testMatch: ['**/mobile.spec.js', '**/landscape.spec.js', '**/qa-v2.spec.js', '**/player.spec.js'],
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
  ],
  webServer: process.env.PK6_BASE
    ? undefined
    : {
        command: `node tools/serve.mjs ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
