/* Live screenshots for the delivery report.
   Captures the deployed page at desktop and phone sizes, plus the player while
   a game is running (the emulator picture is the point of a player-first
   redesign). Writes into work/pkpilot0006/.

   Usage: node tools/shots.mjs [base-url]
   Default base: https://hyangdan2.github.io/PKPilot0006/ */

import { launchBrowser } from './pw-lib.mjs';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] || 'https://hyangdan2.github.io/PKPilot0006/';
const OUT = '../pkpilot0006';
await mkdir(OUT, { recursive: true });

const browser = await launchBrowser();
const errors = [];

async function capture(name, viewport, { touch = false, fullPage = true, action = null, waitMs = 1200 } = {}) {
  const context = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon|404/.test(message.text())) errors.push(`${name}: ${message.text()}`);
  });
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.__pkpilotReady === true, null, { timeout: 30000 });
  await page.waitForTimeout(waitMs);
  if (action) await action(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`${name}: ${viewport.width}×${viewport.height} overflow=${overflow}`);
  await context.close();
  return overflow;
}

const results = [];
results.push(await capture('redesign-pc', { width: 1440, height: 900 }));
results.push(await capture('redesign-mobile', { width: 390, height: 844, }, { touch: true }));

// the same two sizes with a game actually running
results.push(await capture('redesign-pc-running', { width: 1440, height: 900 }, {
  action: async (page) => {
    await page.click('.game-card[data-game="digger"]');
    await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'running', null, { timeout: 120000 });
    await page.waitForTimeout(2500);
  },
}));
results.push(await capture('redesign-mobile-landscape', { width: 844, height: 390 }, {
  touch: true,
  fullPage: false,
  action: async (page) => {
    await page.click('#miniGames .mini-game[data-game="doom"]');
    await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'running', null, { timeout: 120000 });
    await page.waitForTimeout(3000);
  },
}));

await browser.close();
if (errors.length) console.log('page errors:', errors);
console.log('overflows:', results, 'errors:', errors.length);
