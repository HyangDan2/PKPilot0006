/* E2E helpers: a fake js-dos module served through request interception, so the
   suite exercises the real loader / runtime / input wiring without downloading
   a WASM emulator. `window.__stub` records what the app sent to the emulator. */

export const STUB_SOURCE = `
window.__stub = { boots: [], keys: [], stops: 0, volumes: [], doubleStops: 0, bootsAt: [] };
window.Dos = function (target, options) {
  const cfg = window.__PK6_STUB__ || {};
  const state = window.__stub;
  state.boots.push(String(options.url));
  state.bootsAt.push(Date.now());

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 400;
  canvas.id = 'stubCanvas';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, 640, 400);
    ctx.fillStyle = '#C9B8F3';
    ctx.font = '28px monospace';
    ctx.fillText('STUB DOS', 36, 80);
    ctx.fillStyle = '#8B6CE8';
    ctx.fillRect(36, 100, 240, 6);
  }
  target.appendChild(canvas);

  let stopped = false;
  const props = {
    stop: async () => {
      if (stopped) { state.doubleStops += 1; return; }
      stopped = true;
      state.stops += 1;
      canvas.remove();
    },
    setVolume: (value) => { state.volumes.push(value); },
    exit: async () => {},
  };

  const mode = cfg.fail;
  if (mode !== 'never') {
    setTimeout(() => {
      if (stopped) return;
      if (mode === 'no-ci') return;               // boot timeout path
      if (mode === 'canvas') {                    // ci without a canvas
        canvas.remove();
      }
      options.onEvent('emu-ready');
      options.onEvent('ci-ready', { sendKeyEvent: (code, down) => state.keys.push([code, down]) });
    }, cfg.ciDelay ?? 150);
  }
  return props;
};
`;

/** Serve the stub for any js-dos script request and mute the js-dos stylesheet. */
export async function installEngine(page, { init = {}, css = '' } = {}) {
  await page.addInitScript((config) => {
    window.__PK6_CONFIG__ = Object.assign({
      engineTimeoutMs: 4000,
      enginePollMs: 40,
      bootTimeoutMs: 4000,
      frameTimeoutMs: 1500,
      bootPollMs: 40,
      charTapMs: 20,
      charGapMs: 10,
    }, config);
  }, init);
  await page.addInitScript((cfg) => { window.__PK6_STUB__ = cfg; }, init);
  await page.route('**/js-dos.css', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: css }));
  await page.route('**/js-dos.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: STUB_SOURCE,
  }));
}

/** Make every js-dos script request fail (network error) or hang. */
export async function breakEngine(page, { mode = 'network', init = {} } = {}) {
  await page.addInitScript((config) => {
    window.__PK6_CONFIG__ = Object.assign({ engineTimeoutMs: 1200, enginePollMs: 40 }, config);
  }, init);
  await page.route('**/js-dos.css', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  if (mode === 'network') {
    await page.route('**/js-dos.js', (route) => route.abort('failed'));
  } else {
    await page.route('**/js-dos.js', () => new Promise(() => { /* never answers */ }));
  }
}

export async function waitReady(page) {
  await page.waitForFunction(() => window.__pkpilotReady === true, null, { timeout: 20000 });
}

export async function snapshot(page) {
  return page.evaluate(() => window.__pkpilot.snapshot());
}

export async function bootGame(page, id) {
  await page.click(`.game-card[data-game="${id}"]`);
  await page.waitForFunction(
    (gameId) => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.state === 'running' && snap.target === gameId;
    },
    id,
    { timeout: 30000 },
  );
}

export function stub(page) {
  return page.evaluate(() => window.__stub);
}
