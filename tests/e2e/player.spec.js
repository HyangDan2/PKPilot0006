import { expect, test } from '@playwright/test';
import { bootGame, installEngine, snapshot, stub, waitReady } from './util.js';

test.describe('player runtime', () => {
  test('boots a library game into the stage', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);

    await expect(page.locator('#screenOverlay')).toBeVisible();
    await expect(page.locator('#overlayTitle')).toContainText('Digger');

    await page.click('.game-card[data-game="digger"]');
    await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'running', null, { timeout: 20000 });

    await expect(page.locator('#screenOverlay')).toBeHidden();
    await expect(page.locator('#dosStage canvas')).toBeVisible();
    await expect(page.locator('#stateChip')).toHaveText('실행 중');
    await expect(page.locator('#restartBtn')).toBeEnabled();
    await expect(page.locator('#muteBtn')).toBeEnabled();
    await expect(page.locator('.game-card[data-game="digger"]')).toHaveClass(/is-running/);

    const events = await stub(page);
    expect(events.boots).toHaveLength(1);
    expect(events.boots[0]).toContain('digger.jsdos');
  });

  test('routes physical keys through the CommandInterface (DOOM profile)', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'doom');

    await page.keyboard.down('w');
    await page.keyboard.up('w');
    await page.keyboard.down('ArrowUp');
    await page.keyboard.up('ArrowUp');
    await page.keyboard.down('j');
    await page.keyboard.up('j');

    const { keys } = await stub(page);
    // DOOM's bundle is WASD native: W -> 87, arrows -> 265, J -> Ctrl 341
    expect(keys).toContainEqual([87, true]);
    expect(keys).toContainEqual([87, false]);
    expect(keys).toContainEqual([265, true]);
    expect(keys).toContainEqual([265, false]);
    expect(keys).toContainEqual([341, true]);
    expect(keys).toContainEqual([341, false]);
  });

  test('an arrow-driven game maps W to its movement key', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');

    await page.keyboard.down('w');
    await page.keyboard.up('w');
    const { keys } = await stub(page);
    expect(keys).toContainEqual([265, true]); // ArrowUp, not the letter W
    expect(keys).not.toContainEqual([87, true]);
  });

  test('a held key survives a second source and is released once', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');

    const result = await page.evaluate(async () => {
      const { input } = window.__pkpilot;
      input.press('KeyW', 'test:a');
      input.press('KeyW', 'test:b');
      input.release('KeyW', 'test:a');
      const stillHeld = input.isHeld('KeyW');
      input.release('KeyW', 'test:b');
      return { stillHeld, after: input.isHeld('KeyW') };
    });
    expect(result.stillHeld).toBe(true);
    expect(result.after).toBe(false);
    const { keys } = await stub(page);
    const w = keys.filter(([code]) => code === 87);
    expect(w.filter(([, down]) => down)).toHaveLength(1);
    expect(w.filter(([, down]) => !down)).toHaveLength(1);
  });

  test('types repeated characters without dropping one', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');

    await page.evaluate(() => window.__pkpilot.typeText('aaa'));
    await page.waitForFunction(() => window.__pkpilot.snapshot().input.queued === 0, null, { timeout: 5000 });

    const { keys } = await stub(page);
    const a = keys.filter(([code]) => code === 65);
    expect(a.filter(([, down]) => down)).toHaveLength(3);
    expect(a.filter(([, down]) => !down)).toHaveLength(3);
  });

  test('mute and volume reach the emulator', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');

    await page.click('#muteBtn');
    await expect(page.locator('#muteBtn')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#muteBtn');
    await expect(page.locator('#muteBtn')).toHaveAttribute('aria-pressed', 'false');

    const { volumes } = await stub(page);
    expect(volumes).toContain(0);
    expect(volumes.at(-1)).toBe(1);
  });

  test('restart stops the old instance and boots a fresh generation', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');
    const first = await snapshot(page);

    await page.click('#restartBtn');
    await page.waitForFunction((generation) => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.state === 'running' && snap.session.generation > generation;
    }, first.session.generation, { timeout: 20000 });

    const events = await stub(page);
    expect(events.boots).toHaveLength(2);
    expect(events.stops).toBe(1);
    expect(events.doubleStops).toBe(0);
    const after = await snapshot(page);
    expect(after.session.disposals).toBe(1);
  });

  test('picking another game mid-boot supersedes the first request', async ({ page }) => {
    await installEngine(page, { init: { fail: 'never' } });
    await page.goto('/');
    await waitReady(page);

    await page.click('.game-card[data-game="digger"]');
    await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'booting', null, { timeout: 5000 });
    await page.evaluate(() => {
      // let the first request finish its 4 s boot budget slowly, then switch
      window.__pkpilot.library.onSelect(window.__pkpilot.games.find((game) => game.id === 'doom'));
    });

    await page.waitForFunction(() => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.currentId === 'doom' && snap.session.generation === 2;
    }, null, { timeout: 10000 });
    expect((await snapshot(page)).session.state).toBe('booting');

    // cancel so the test does not sit on the boot timeout
    await page.evaluate(() => window.__pkpilot.cancel());
    await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'idle', null, { timeout: 8000 });
  });

  test('cancelling a boot returns the screen to idle', async ({ page }) => {
    await installEngine(page, { init: { fail: 'never' } });
    await page.goto('/');
    await waitReady(page);
    await page.click('#playBtn');
    await expect(page.locator('#cancelBtn')).toBeVisible();
    await page.click('#cancelBtn');
    await expect(page.locator('#cancelBtn')).toBeHidden();
    await expect(page.locator('#playBtn')).toBeVisible();
    expect((await snapshot(page)).session.state).toBe('idle');
  });

  test('30 game switches keep one runtime and release the other 29', async ({ page }) => {
    await installEngine(page, { init: { ciDelay: 20 } });
    await page.goto('/');
    await waitReady(page);

    const ids = ['digger', 'doom', 'dhrystone'];
    for (let i = 0; i < 30; i += 1) {
      await page.evaluate((index) => {
        const game = window.__pkpilot.games[index % 3];
        return window.__pkpilot.boot(game);
      }, i);
      await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'running', null, { timeout: 15000 });
    }

    const snap = await snapshot(page);
    const events = await stub(page);
    expect(events.boots).toHaveLength(30);
    expect(events.stops).toBe(29);
    expect(events.doubleStops).toBe(0);
    expect(snap.input.held).toEqual([]);
    expect(snap.session.state).toBe('running');
    expect(ids).toContain(snap.target);
    // only one canvas is in the stage after all those switches
    expect(await page.locator('#dosStage canvas').count()).toBe(1);
  });

  test('blur and tab-hide release every held key', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');

    await page.keyboard.down('w');
    expect((await snapshot(page)).input.held.length).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForFunction(() => window.__pkpilot.snapshot().input.held.length === 0, null, { timeout: 3000 });

    const { keys } = await stub(page);
    expect(keys.at(-1)).toEqual([265, false]); // the mapped ArrowUp was lifted
  });
});

test.describe('local bundle', () => {
  test('a dropped .jsdos runs and a replacement revokes the old Blob URL', async ({ page }) => {
    await page.addInitScript(() => {
      window.__revoked = [];
      const original = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = (url) => { window.__revoked.push(url); return original(url); };
    });
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);

    const first = { name: 'my-game.jsdos', mimeType: 'application/zip', buffer: Buffer.from('PK\u0003\u0004first-bundle') };
    await page.setInputFiles('#fileInput', first);
    await page.waitForFunction(() => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.state === 'running' && snap.target === 'local';
    }, null, { timeout: 20000 });
    const firstBoot = (await stub(page)).boots.at(-1);
    expect(firstBoot).toMatch(/^blob:/);
    await expect(page.locator('#fileNote')).toContainText('my-game.jsdos');

    const second = { name: 'other.zip', mimeType: 'application/zip', buffer: Buffer.from('PK\u0003\u0004second-bundle') };
    await page.setInputFiles('#fileInput', second);
    await page.waitForFunction(() => window.__stub.boots.length >= 2, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'running', null, { timeout: 20000 });

    const boots = (await stub(page)).boots;
    expect(boots).toHaveLength(2);
    expect(boots[1]).toMatch(/^blob:/);
    expect(boots[1]).not.toBe(boots[0]);
    const revoked = await page.evaluate(() => window.__revoked);
    expect(revoked).toContain(boots[0]);
  });

  test('a file that is not a bundle is refused with a reason', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    // load the stubbed engine first, so the boot counter exists to assert on
    await page.evaluate(() => window.__pkpilot.engine.load());
    await page.setInputFiles('#fileInput', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.locator('#fileNote')).toContainText('.jsdos 또는 .zip');
    expect((await stub(page)).boots).toHaveLength(0);
  });
});
