/* Shared Playwright launcher for the local tooling.
   The sandbox has a low process limit, so a launch can fail with
   “fork/pthread_create: Resource temporarily unavailable”. Retrying with a
   short backoff and a small renderer footprint keeps the tooling reliable. */

import { chromium } from '@playwright/test';

export const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-device-discovery-notifications',
  '--renderer-process-limit=2',
];

export async function launchBrowser({ attempts = 4, headless = true } = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await chromium.launch({
        executablePath: process.env.PW_CHROMIUM || undefined,
        args: CHROME_ARGS,
        headless,
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1200 * (i + 1)));
    }
  }
  throw lastError;
}
