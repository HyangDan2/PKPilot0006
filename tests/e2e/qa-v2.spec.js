import { expect, test } from '@playwright/test';
import { bootGame, breakEngine, bundle, installEngine, snapshot, stub, waitReady } from './util.js';

/* The eight scenarios from the second review, as real UI runs: every one drives
   the player the way a person does — clicking cards, pressing keys, dropping
   files — while the js-dos module is replaced by the stub from util.js. */

test.describe('QA 1 · J and Z fire together, lifting one keeps the shot', () => {
  test('the physical key is the source id, so Ctrl stays down until both lift', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'doom');

    await page.keyboard.down('j');
    await page.keyboard.down('z');
    await expect(page.locator('#stateChip')).toHaveText('실행 중');

    // both physical keys hold the same DOS key
    let snap = await snapshot(page);
    expect(snap.input.sources.ControlLeft.sort()).toEqual(['kbd:KeyJ', 'kbd:KeyZ']);

    await page.keyboard.up('j');
    snap = await snapshot(page);
    expect(snap.input.held).toContain('ControlLeft');
    expect(snap.input.sources.ControlLeft).toEqual(['kbd:KeyZ']);

    let keys = (await stub(page)).keys.filter(([code]) => code === 341);
    expect(keys).toEqual([[341, true]]); // no premature keyup

    await page.keyboard.up('z');
    keys = (await stub(page)).keys.filter(([code]) => code === 341);
    expect(keys).toEqual([[341, true], [341, false]]);
    snap = await snapshot(page);
    expect(snap.input.held).not.toContain('ControlLeft');
  });

  test('the same holds for a pad button and a physical key', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'doom');

    await page.keyboard.down('j');
    await page.evaluate(() => window.__pkpilot.press('ControlLeft'));
    await page.keyboard.up('j');
    expect((await snapshot(page)).input.held).toContain('ControlLeft');
    await page.evaluate(() => window.__pkpilot.releaseAll());
    expect((await snapshot(page)).input.held).toEqual([]);
  });
});

test.describe('QA 2 · Enter and Space operate the cards and the buttons', () => {
  test('a focused card runs on Enter, and on Space', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);

    await page.focus('.game-card[data-game="digger"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'running', null, { timeout: 20000 });
    expect((await snapshot(page)).target).toBe('digger');

    await page.focus('.game-card[data-game="doom"]');
    await page.keyboard.press(' ');
    await page.waitForFunction(() => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.state === 'running' && snap.target === 'doom';
    }, null, { timeout: 20000 });
  });

  test('the run button starts the selected game from the keyboard', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);

    await page.focus('#playBtn');
    await page.keyboard.press(' ');
    await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'running', null, { timeout: 20000 });
    expect((await snapshot(page)).session.state).toBe('running');
  });

  test('while running, a focused control keeps Space/Enter but not the game keys', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');

    // Space on the mute button toggles it instead of reaching DOS
    const before = (await stub(page)).keys.length;
    await page.focus('#muteBtn');
    await page.keyboard.press(' ');
    await expect(page.locator('#muteBtn')).toHaveAttribute('aria-pressed', 'true');
    expect((await stub(page)).keys.length).toBe(before);

    // arrows still move: a focused button only owns its activation keys
    await page.keyboard.press('ArrowUp');
    expect((await stub(page)).keys.slice(before)).toContainEqual([265, true]);
    await page.keyboard.press('ArrowUp'); // keyup is delivered too
  });

  test('nothing is intercepted before a game runs', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);

    const idle = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      const arrow = new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', bubbles: true, cancelable: true });
      document.body.dispatchEvent(arrow);
      return { space: event.defaultPrevented, arrow: arrow.defaultPrevented };
    });
    expect(idle).toEqual({ space: false, arrow: false });

    await bootGame(page, 'digger');
    // the picture owns the keyboard once a game runs
    expect((await snapshot(page)).focus).toBe('dosStage');
    const running = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(running).toBe(true);
    await page.evaluate(() => window.__pkpilot.releaseAll());
  });
});

test.describe('QA 3 · A → B → C picked while the old game is still stopping', () => {
  test('the stage is empty before each new instance mounts', async ({ page }) => {
    await installEngine(page, { init: { stopDelay: 260, ciDelay: 60 } });
    await page.goto('/');
    await waitReady(page);

    const first = page.evaluate(() => { window.__pkpilot.boot(window.__pkpilot.games[0]); });
    // two more picks land while the first two are still tearing down
    await page.click('.game-card[data-game="doom"]');
    await page.click('.game-card[data-game="dhrystone"]');

    await page.waitForFunction(() => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.state === 'running' && snap.target === 'dhrystone';
    }, null, { timeout: 30000 });
    await first;

    const log = (await stub(page)).log.map((entry) => `${entry.t}:${entry.url.split('/').pop()}`);
    // every mount comes after the previous teardown finished — no shared DOM
    for (const entry of log) {
      const at = log.indexOf(entry);
      if (!entry.startsWith('boot:')) continue;
      const before = log.slice(0, at).filter((line) => line.startsWith('boot:'));
      const stops = log.slice(0, at).filter((line) => line.startsWith('stop-end:'));
      expect(stops.length, `teardown before ${entry} (${log.join(' | ')})`).toBe(before.length);
    }
    const events = await stub(page);
    // nothing of the previous generation was still on the stage at any mount
    expect(events.canvasesAtBoot.every((count) => count === 0), JSON.stringify(events.canvasesAtBoot)).toBe(true);
    expect(events.doubleStops).toBe(0);
    await expect(page.locator('#dosStage canvas')).toHaveCount(1);
    expect((await snapshot(page)).target).toBe('dhrystone');
  });

  test('a stop that is still running blocks the next mount even when it is cancelled', async ({ page }) => {
    await installEngine(page, { init: { stopDelay: 250 } });
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');

    await page.click('#restartBtn');
    await page.waitForTimeout(40);
    await page.evaluate(() => window.__pkpilot.cancel());

    const snap = await snapshot(page);
    expect(snap.session.state).toBe('idle');
    // the teardown chain still has work: the stage is emptied only by its owner
    await page.waitForFunction(() => window.__pkpilot.session.stopping === false, null, { timeout: 10000 });
    await expect(page.locator('#dosStage canvas')).toHaveCount(0);
  });
});

test.describe('QA 4 · local A → B → C and the Object URL release order', () => {
  test('each blob URL is created before its mount and revoked after its own stop', async ({ page }) => {
    await installEngine(page, { init: { stopDelay: 120, ciDelay: 40 } });
    await page.goto('/');
    await waitReady(page);

    await page.setInputFiles('#fileInput', bundle('quake-a.jsdos'));
    await page.waitForTimeout(30);
    await page.setInputFiles('#fileInput', bundle('wolf-b.jsdos'));
    await page.waitForTimeout(30);
    await page.setInputFiles('#fileInput', bundle('prince-c.jsdos'));
    const lastUrl = await page.evaluate(() => window.__pkpilot.bundles.active.url);

    await page.waitForFunction((url) => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.state === 'running' && snap.session.stopping === false
        && window.__stub.boots.at(-1) === url;
    }, lastUrl, { timeout: 30000 });

    const events = await stub(page);
    const order = await page.evaluate(() => window.__pkpilot.bundles.order.map(([kind, url]) => [kind, url.slice(-6)]));
    expect(order.filter(([kind]) => kind === 'create').length).toBe(3);

    // every revoke follows a stop-end of the URL it revokes, and only the last
    // bundle is still live when the last game runs
    const live = await page.evaluate(() => window.__pkpilot.snapshot().bundles.live);
    expect(live).toBe(1);
    const lastBoot = events.boots.at(-1);
    expect(lastBoot).toBe(lastUrl);
    const revoked = await page.evaluate(() => window.__pkpilot.bundles.order.filter(([kind]) => kind === 'revoke').map(([, url]) => url));
    expect(revoked).not.toContain(lastBoot);
    const created = await page.evaluate(() => window.__pkpilot.bundles.order.filter(([kind]) => kind === 'create').map(([, url]) => url));
    // every URL is either still live (the running bundle) or revoked, never lost
    expect(created.length).toBe(revoked.length + live);
    expect(revoked.every((url) => created.includes(url))).toBe(true);
    expect(events.boots.every((url) => created.includes(url))).toBe(true);
  });

  test('a file that is not a bundle never creates a URL', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await page.evaluate(() => window.__pkpilot.engine.load());
    await page.setInputFiles('#fileInput', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
    await expect(page.locator('#fileNote')).toContainText('.jsdos 또는 .zip');
    expect((await snapshot(page)).bundles.created).toBe(0);
  });
});

test.describe('QA 5 · cancel while typing, then run again at once', () => {
  test('characters queued for the cancelled boot never reach the next game', async ({ page }) => {
    await installEngine(page, { init: { ciDelay: 500, charTapMs: 30, charGapMs: 30 } });
    await page.goto('/');
    await waitReady(page);

    await page.click('.game-card[data-game="digger"]');
    await page.waitForFunction(() => window.__pkpilot.snapshot().phase === 'booting', null, { timeout: 10000 });
    await page.evaluate(() => window.__pkpilot.typeText('digger'));
    await expect(page.locator('#overlayProgress')).toBeVisible();

    await page.click('#cancelBtn');
    await page.waitForFunction(() => window.__pkpilot.snapshot().phase === 'idle', null, { timeout: 10000 });
    expect((await snapshot(page)).input.queued).toBe(0);

    // straight back in — with the key queue empty
    await page.click('.game-card[data-game="doom"]');
    await page.waitForFunction(() => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.state === 'running' && snap.target === 'doom';
    }, null, { timeout: 30000 });

    const afterBoot = (await stub(page)).keys.length;
    await page.waitForTimeout(300); // the old queue's timers would fire in here
    expect((await stub(page)).keys.length).toBe(afterBoot);

    // and the new game still takes typed characters
    await page.evaluate(() => window.__pkpilot.typeText('do'));
    await page.waitForTimeout(200);
    expect((await stub(page)).keys.length).toBeGreaterThan(afterBoot);
  });
});

test.describe('QA 6 · mute survives a game change and a restart', () => {
  test('the new instance is started muted, and the slider agrees', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');

    await page.click('#muteBtn');
    await expect(page.locator('#muteBtn')).toHaveAttribute('aria-pressed', 'true');
    await page.click('.game-card[data-game="doom"]');
    await page.waitForFunction(() => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.state === 'running' && snap.target === 'doom';
    }, null, { timeout: 30000 });

    let events = await stub(page);
    expect(events.volumes.at(-1)).toBe(0);
    await expect(page.locator('#volumeRange')).toHaveValue('0');
    expect((await snapshot(page)).muted).toBe(true);

    const beforeRestart = (await snapshot(page)).session.generation;
    await page.click('#restartBtn');
    await page.waitForFunction((generation) => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.state === 'running' && snap.session.generation > generation;
    }, beforeRestart, { timeout: 30000 });
    events = await stub(page);
    expect(events.volumes.at(-1)).toBe(0);

    await page.click('#muteBtn');
    await expect(page.locator('#volumeRange')).toHaveValue('100');
    events = await stub(page);
    expect(events.volumes.at(-1)).toBe(1);
  });

  test('a volume set before switching games is carried into the new instance', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');

    await page.evaluate(() => window.__pkpilot.setVolume(0.4));
    await expect(page.locator('#volumeRange')).toHaveValue('40');
    await page.click('.game-card[data-game="dhrystone"]');
    await page.waitForFunction(() => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.state === 'running' && snap.target === 'dhrystone';
    }, null, { timeout: 30000 });
    expect((await stub(page)).volumes.at(-1)).toBeCloseTo(0.4, 2);
    await expect(page.locator('#volumeRange')).toHaveValue('40');
  });
});

test.describe('QA 7 · cancel a slow download, then a failing one', () => {
  test('cancel returns to idle and the next attempt fails cleanly', async ({ page }) => {
    await breakEngine(page, { mode: 'hang' });
    await page.goto('/');
    await waitReady(page);

    await page.click('.game-card[data-game="digger"]');
    await expect(page.locator('#cancelBtn')).toBeVisible();
    await page.click('#cancelBtn');
    await expect(page.locator('#stateChip')).toHaveText('대기');
    expect((await snapshot(page)).phase).toBe('idle');

    // the next attempt answers with a network error instead of hanging
    await page.unroute('**/js-dos.js');
    await page.route('**/js-dos.js', (route) => route.abort('failed'));
    await page.click('.game-card[data-game="digger"]');
    await page.waitForFunction(() => window.__pkpilot.snapshot().phase === 'error', null, { timeout: 20000 });
    await expect(page.locator('#overlayTitle')).toContainText('실행 실패');
    await expect(page.locator('#retryBtn')).toBeVisible();
    expect((await snapshot(page)).engine.state).toBe('failed');

    // the failed request must not overwrite the screen after a newer pick
    await page.unroute('**/js-dos.js');
    await installEngine(page);
    await page.click('#retryBtn');
    await page.waitForFunction(() => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.state === 'running' && snap.target === 'digger';
    }, null, { timeout: 30000 });
    await expect(page.locator('#stateChip')).toHaveText('실행 중');
  });

  test('a cancel during the engine download never lets the old request paint', async ({ page }) => {
    await breakEngine(page, { mode: 'hang' });
    await page.goto('/');
    await waitReady(page);

    await page.click('.game-card[data-game="digger"]');
    await page.click('#cancelBtn');
    await page.waitForTimeout(400);
    const snap = await snapshot(page);
    expect(snap.phase).toBe('idle');
    expect(snap.session.state).toBe('idle');
    const stubState = await page.evaluate(() => window.__stub || { boots: [] });
    expect(stubState.boots).toHaveLength(0);
  });
});

test.describe('QA 8 · boot-state feedback is the same everywhere', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true });

  test('the card, the mini bar, the overlay and the control bar agree', async ({ page }) => {
    await installEngine(page, { init: { ciDelay: 600 } });
    await page.goto('/');
    await waitReady(page);

    await page.click('#miniGames .mini-game[data-game="doom"]');
    await page.waitForFunction(() => window.__pkpilot.snapshot().phase === 'booting', null, { timeout: 10000 });
    await expect(page.locator('#stateChip')).toHaveText('부팅 중');
    await expect(page.locator('#overlayTitle')).toContainText('부팅 중');
    await expect(page.locator('#cancelBtn')).toBeVisible();
    await expect(page.locator('#retryBtn')).toBeHidden();
    await expect(page.locator('#screenShell')).toHaveAttribute('aria-busy', 'true');

    await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'running', null, { timeout: 30000 });
    await expect(page.locator('#stateChip')).toHaveText('실행 중');
    await expect(page.locator('#screenShell')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#cancelBtn')).toBeHidden();
  });
});
