/* Capture the thumbnail of every library game from the real emulator.
   Boots the built page in Chromium, waits until the session reports running,
   lets the game draw its title screen, then screenshots the canvas element and
   saves it as thumbs/<id>.png (640 px wide, 16:10).

   Usage: node tools/capture-thumbs.mjs
   PW_CHROMIUM=/path/to/chrome overrides the bundled browser path. */

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.THUMB_PORT || 4175);
const BASE = `http://127.0.0.1:${PORT}/`;
const GAMES = [
  { id: 'digger', wait: 2200 },
  { id: 'doom', wait: 5200 },
  { id: 'dhrystone', wait: 2600 },
];

const server = spawn(process.execPath, ['tools/serve.mjs', String(PORT)], { stdio: 'ignore' });
const stopServer = () => { try { server.kill('SIGTERM'); } catch (_) { /* ignore */ } };
process.on('exit', stopServer);

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('local server did not start');
}

await waitForServer();
await mkdir('thumbs', { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console]', msg.text()); });
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

for (const game of GAMES) {
  await page.goto(`${BASE}?game=${game.id}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForFunction(() => window.__pkpilotReady === true, null, { timeout: 20000 });
  const started = Date.now();
  await page.click('#playBtn');
  await page.waitForFunction(
    () => window.__pkpilot && window.__pkpilot.snapshot().session.state === 'running',
    null,
    { timeout: 120000 },
  );
  console.log(`${game.id}: running in ${Date.now() - started} ms`);
  await page.waitForTimeout(game.wait);
  const canvas = await page.$('#dosStage canvas');
  if (!canvas) { console.log(`${game.id}: no canvas`); continue; }
  const box = await canvas.boundingBox();
  console.log(`${game.id}: canvas ${box && box.width}x${box.height}`);
  const png = await canvas.screenshot();
  await writeFile(`thumbs/${game.id}.png`, png);
  // full-size desktop screenshot of the player for the local review
  await page.screenshot({ path: `thumbs/${game.id}-page.png` });
  await page.evaluate(() => window.__pkpilot.cancel());
  await page.waitForTimeout(400);
}

await browser.close();
stopServer();
console.log('thumbs written');
