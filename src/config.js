/* ==========================================================================
   HD2Lab | DOS Player — runtime configuration
   Timeouts and engine versions live in one place so the UI, the loader and
   the test suite can never disagree about them.
   `window.__PK6_CONFIG__` (set before the module graph loads) overrides the
   timings; the end-to-end suite uses it to keep failure paths short.
   ========================================================================== */

const overrides = (typeof window !== 'undefined' && window.__PK6_CONFIG__) || {};

function ms(name, fallback) {
  const value = Number(overrides[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const CONFIG = Object.freeze({
  /** js-dos release this build is pinned to (js-dos.js, js-dos.css and the
   *  DOSBox wasm all come from the same npm version). */
  jsdosVersion: '8.5.4',
  /** script + stylesheet fetch budget for the engine itself */
  engineTimeoutMs: ms('engineTimeoutMs', 20000),
  /** how often the loader re-checks for window.Dos while the script runs */
  enginePollMs: ms('enginePollMs', 120),
  /** CommandInterface (ci-ready) budget once a bundle starts booting */
  bootTimeoutMs: ms('bootTimeoutMs', 60000),
  /** a second canvas/paint guard after the CommandInterface is ready */
  frameTimeoutMs: ms('frameTimeoutMs', 8000),
  bootPollMs: ms('bootPollMs', 150),
  /** short pause between queued character taps (virtual keyboard) */
  charTapMs: ms('charTapMs', 60),
  charGapMs: ms('charGapMs', 24),
  /** how many finished sessions stay in the diagnostics ring buffer */
  sessionHistory: ms('sessionHistory', 60),
});

export const STORAGE = Object.freeze({
  lastGame: 'pkpilot0006:last',
  wasd: 'pkpilot0006:wasd',
  keymap: 'pkpilot0006:keymap',
  padForce: 'pkpilot0006:padforce',
  volume: 'pkpilot0006:volume',
  muted: 'pkpilot0006:muted',
});
