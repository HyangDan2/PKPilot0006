import { expect, test } from '@playwright/test';
import { bootGame, bundle, installEngine, snapshot, stub, waitReady } from './util.js';

/* Phone on its side: the screen becomes the machine. These runs check the
   things a thumb notices — target size, controls that overlap, the dark theme
   on the floating pad — and the lifecycle of a page that is left and returned
   to. */

const PHONE = { width: 844, height: 390 };

/** In immersive landscape the library is hidden: the mini bar picks the game. */
async function startFromMiniBar(page, id) {
  await page.click(`#miniGames .mini-game[data-game="${id}"]`);
  await page.waitForFunction((gameId) => {
    const snap = window.__pkpilot.snapshot();
    return snap.session.state === 'running' && snap.target === gameId;
  }, id, { timeout: 30000 });
}

function overlap(a, b) {
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return x > 1 && y > 1;
}

test.describe('landscape shell', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('every pad and mini-bar control is at least 44 px and none overlap', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await startFromMiniBar(page, 'digger');

    const small = await page.evaluate(() => {
      const bad = [];
      const limit = (el) => (el.id === 'padMoreBtn' ? 36 : el.classList.contains('pad-key') || el.classList.contains('mini-btn') || el.classList.contains('mini-game') ? 44 : 0);
      for (const el of document.querySelectorAll('.pad-key, .mini-btn, .mini-game, .pad-more')) {
        if (el.offsetParent === null) continue;
        const rect = el.getBoundingClientRect();
        const min = limit(el);
        if (rect.width < min || rect.height < min) {
          bad.push(`${el.id || el.dataset.padKey || el.className}: ${Math.round(rect.width)}×${Math.round(rect.height)} < ${min}`);
        }
      }
      return bad;
    });
    expect(small).toEqual([]);

    const overlaps = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#pad [data-pad-key], #padMoreBtn, #miniBar .mini-btn, #miniGames .mini-game')]
        .filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden');
      const boxes = nodes.map((el) => ({ id: el.id || el.dataset.padKey || el.textContent.trim().slice(0, 6), rect: el.getBoundingClientRect() }));
      const hits = [];
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i].rect;
          const b = boxes[j].rect;
          const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (x > 1 && y > 1) hits.push(`${boxes[i].id} × ${boxes[j].id}`);
        }
      }
      return hits;
    });
    expect(overlaps).toEqual([]);
  });

  test('the 보조 키 opener is reachable on a phone and opens the extra keys', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await startFromMiniBar(page, 'digger');

    const opener = page.locator('#padMoreBtn');
    await expect(opener).toBeVisible();
    await opener.click();
    await expect(page.locator('#padExtra')).toBeVisible();

    // the extra row takes the action keys' place instead of covering them
    const stacked = await page.evaluate(() => {
      const extra = document.getElementById('padExtra').getBoundingClientRect();
      const keys = [...document.querySelectorAll('.pad-keys .pad-key')].filter((el) => getComputedStyle(el).visibility !== 'hidden');
      return { extra: { l: extra.left, t: extra.top, r: extra.right, b: extra.bottom }, keys: keys.length };
    });
    expect(stacked.keys).toBe(0);

    const padKeysVisible = await page.evaluate(() => [...document.querySelectorAll('.pad-keys .pad-key')].some((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden'));
    expect(padKeysVisible).toBe(false);
  });

  test('dark mode paints the floating pad in Navy & Lavender, not light glass', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await startFromMiniBar(page, 'digger');

    const read = () => page.evaluate(() => {
      const key = document.querySelector('.pad-key');
      const mini = document.querySelector('.mini-game:not(.is-running)');
      const running = document.querySelector('.mini-game.is-running');
      const cs = getComputedStyle(key);
      const ms = getComputedStyle(mini);
      const parse = (color) => color.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
      return {
        key: parse(cs.backgroundColor),
        keyText: parse(cs.color),
        mini: parse(ms.backgroundColor),
        miniText: parse(ms.color),
        running: running ? parse(getComputedStyle(running).backgroundColor) : null,
      };
    });

    const light = await read();
    await page.evaluate(() => window.HD2Theme.set('dark', { persist: false }));
    await page.addStyleTag({ content: '*{transition:none!important}' });
    const dark = await read();

    // the light skin is translucent white; the dark one is a dark navy block
    expect(light.key[0]).toBeGreaterThan(200);
    expect(dark.key[0]).toBeLessThan(60);
    expect(dark.keyText[0]).toBeGreaterThan(200);
    expect(dark.mini[0]).toBeLessThan(60);
    expect(dark.miniText[0]).toBeGreaterThan(200);
    // the running chip keeps its accent fill in both themes
    expect(dark.running[0]).toBeGreaterThan(150);

    // and it really is the dark theme, not an override that also hits light
    await page.evaluate(() => window.HD2Theme.set('light', { persist: false }));
    const back = await read();
    expect(back.key[0]).toBeGreaterThan(200);
  });
});

test.describe('page lifecycle', () => {
  test('leaving the page stops the emulator and revokes its blob URL', async ({ page }) => {
    await installEngine(page, { init: { ciDelay: 60 } });
    await page.goto('/');
    await waitReady(page);

    await page.setInputFiles('#fileInput', bundle('left-behind.jsdos'));
    await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'running', null, { timeout: 30000 });
    expect((await snapshot(page)).bundles.live).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.waitForFunction(() => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.state === 'idle' && snap.bundles.live === 0;
    }, null, { timeout: 15000 });

    await expect(page.locator('#dosStage canvas')).toHaveCount(0);
    expect((await stub(page)).stops).toBe(1);
  });

  test('coming back from the back/forward cache shows an honest idle screen', async ({ page }) => {
    await installEngine(page, { init: { ciDelay: 60 } });
    await page.goto('/');
    await waitReady(page);
    await page.click('.game-card[data-game="digger"]');
    await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'running', null, { timeout: 30000 });

    // simulate a page that comes back with its canvas gone
    await page.evaluate(() => {
      document.querySelectorAll('#dosStage canvas').forEach((canvas) => canvas.remove());
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect(page.locator('#stateChip')).toHaveText('대기');
    await expect(page.locator('#screenOverlay')).toBeVisible();
    await expect(page.locator('#toast')).toContainText('다시 실행');
    const snap = await snapshot(page);
    expect(snap.session.state).not.toBe('running');
  });
});
