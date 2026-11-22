/* ==========================================================================
   HD2Lab | DOS Player — application wiring (PKPilot0006)
   main.js only connects the modules:
     engine-loader  → js-dos script + pinned emulator assets
     session-manager→ generations, newest-wins boot policy, teardown order
     dos-runtime    → one js-dos instance, ci-ready + canvas + frame = running
     input-manager  → reference-counted keys, character queue, capture gate
     keyboard/pad   → physical keys, touch gamepad, phone keyboard
     ui/*           → player, library, settings dialog, responsive mode
   ========================================================================== */

import { CONFIG, STORAGE } from './config.js';
import { GAMES, findGame } from './data/games.js';
import { EngineLoader, ENGINE_SOURCES } from './core/engine-loader.js';
import { DosRuntime } from './core/dos-runtime.js';
import { SessionManager } from './core/session-manager.js';
import { InputManager } from './input/input-manager.js';
import { KeyboardInput } from './input/keyboard.js';
import { TouchPad, SoftKeyboard } from './input/gamepad.js';
import { KeymapStore, KBD, KEY_INFO, ACTIONS, keyLabel, padCodesFor, resolveSlot } from './input/keymap.js';
import { LocalBundleManager, validateBundle, formatSize } from './files/local-bundle.js';
import { PlayerView } from './ui/player-view.js';
import { GameLibrary } from './ui/game-library.js';
import { SettingsDialog } from './ui/settings-dialog.js';
import { ResponsiveMode } from './ui/responsive-mode.js';

const $ = (id) => document.getElementById(id);

/* localStorage may throw in private mode / blocked cookies */
const storage = (() => {
  try {
    const probe = '__pk6__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (_) {
    const mem = new Map();
    return {
      getItem: (key) => (mem.has(key) ? mem.get(key) : null),
      setItem: (key, value) => mem.set(key, String(value)),
      removeItem: (key) => mem.delete(key),
    };
  }
})();

const app = {
  wasd: storage.getItem(STORAGE.wasd) !== '0',
  muted: false,
  volume: 1,
  profile: 'arrows',
  current: null,
  lastError: null,
  localFile: null,
  bootStartedAt: 0,
  bootToken: 0,
};

/* ------------------------------------------------------------------ views -- */
const view = new PlayerView(document);
const library = new GameLibrary({
  listEl: $('gameList'),
  benchEl: $('benchList'),
  miniEl: $('miniGames'),
  dropZoneEl: $('dropZone'),
  fileInputEl: $('fileInput'),
  fileNoteEl: $('fileNote'),
  onSelect: (game) => startGame(game),
  onNotice: (type, file) => { if (type === 'file') handleFile(file); },
});

const keymapStore = new KeymapStore({ storage });
const input = new InputManager({
  send: (code, down) => sendKey(code, down),
  tapHoldMs: CONFIG.charTapMs,
  gapMs: CONFIG.charGapMs,
});

const engine = new EngineLoader({ timeoutMs: CONFIG.engineTimeoutMs, pollMs: CONFIG.enginePollMs });
engine.subscribe((status) => view.setEngine(status));

const bundles = new LocalBundleManager();

/* ------------------------------------------------------------------- send -- */
function sendKey(code, down) {
  const kbd = KBD[code];
  const info = KEY_INFO[code];
  if (!kbd || !info) return false;
  const runtime = session.runtime;
  if (runtime && runtime.ci && typeof runtime.ci.sendKeyEvent === 'function') {
    try {
      runtime.ci.sendKeyEvent(kbd, down);
      return true;
    } catch (_) { /* CommandInterface went away mid-press: fall through */ }
  }
  const event = new KeyboardEvent(down ? 'keydown' : 'keyup', {
    key: info.key,
    code,
    location: info.location || 0,
    bubbles: true,
    cancelable: true,
    view: window,
  });
  for (const prop of ['keyCode', 'which']) {
    Object.defineProperty(event, prop, { get: () => info.keyCode });
  }
  event.__pkpilot = true;
  const target = view.el.stage.querySelector('canvas') || view.el.stage || document;
  target.dispatchEvent(event);
  return true;
}

/* ----------------------------------------------------------------- session -- */
const session = new SessionManager({
  createRuntime: ({ generation, target }) => new DosRuntime({
    generation,
    mount: view.el.stage,
    Dos: window.Dos,
    options: {
      theme: 'dark',
      autoStart: true,
      autoSave: false,
      noCloud: true,
      thinSidebar: true,
      mouseCapture: false,
      countDownStart: 0,
      pathPrefix: engine.emulatorPrefix,
    },
    bootTimeoutMs: CONFIG.bootTimeoutMs,
    frameTimeoutMs: CONFIG.frameTimeoutMs,
    pollMs: CONFIG.bootPollMs,
  }),
  // stop order: keys up first, then the runtime, then the blob URL
  onBeforeStop: () => input.releaseAll('session-stop'),
  onAfterStop: ({ target }) => {
    if (target && target.local && target.url) bundles.release(target.url);
  },
  onEvent: (event) => handleSessionEvent(event),
});

view.setEngine(engine.status());

/* ------------------------------------------------------------- boot flow -- */
function friendlyError(error) {
  const code = error && error.code;
  if (code === 'network') return 'js-dos 엔진을 내려받지 못했습니다. 네트워크를 확인해 주세요.';
  if (code === 'timeout') return `엔진 응답이 ${Math.round(CONFIG.engineTimeoutMs / 1000)}초를 넘었습니다. 네트워크가 느리거나 CDN이 막혀 있을 수 있습니다.`;
  if (code === 'boot-timeout') return 'DOSBox가 부팅을 마치지 않았습니다. 번들이 크거나 네트워크가 느릴 수 있습니다.';
  if (code === 'canvas-timeout' || code === 'canvas-lost') return 'DOS 화면이 만들어지지 않았습니다. 다시 시도해 주세요.';
  if (code === 'cancelled') return '부팅을 취소했습니다.';
  return (error && error.message) || '부팅에 실패했습니다.';
}

function selectTarget(target) {
  app.current = target;
  app.profile = target && target.pad === 'doom' ? 'doom' : 'arrows';
  view.setTarget(target);
  library.setCurrent(target ? target.id : null);
}

async function startGame(target, { force = false } = {}) {
  if (!target) return { ok: false };
  const token = ++app.bootToken;
  app.lastError = null;
  selectTarget(target);
  view.setPhase('booting', { message: 'DOSBox WebAssembly를 올리는 중입니다…' });
  library.setBusy(true);
  input.releaseAll('boot');

  // a remembered engine failure must not swallow the user's retry
  const needsForce = force || engine.state === 'failed';
  try {
    await engine.load({ force: needsForce });
  } catch (error) {
    app.lastError = { ...error, kind: 'engine' };
    view.setEngine(engine.status());
    view.setPhase('error', {
      message: friendlyError(error),
      detail: `엔진 오류 · ${error.code || 'engine'} — 다시 시도하면 다른 CDN에서 받습니다.`,
    });
    library.setBusy(false);
    library.setRunning(null);
    return { ok: false, error };
  }

  // the user may have cancelled (or picked another game) while the engine was
  // still downloading: that request must not boot behind their back
  if (token !== app.bootToken) return { ok: false, cancelled: true };

  app.bootStartedAt = Date.now();
  const outcome = await session.boot(target);
  if (outcome.ok) {
    saveLast(target.id);
    return outcome;
  }
  if (outcome.stale) return outcome;
  app.lastError = outcome.error ? { ...outcome.error, kind: 'boot' } : null;
  return outcome;
}

function handleSessionEvent(event) {
  switch (event.type) {
    case 'booting':
      library.setBusy(true);
      view.setPhase('booting');
      view.setEngine(engine.status());
      break;
    case 'progress':
      view.setProgress(event.progress);
      break;
    case 'running': {
      const target = event.target;
      library.setBusy(false);
      library.setRunning(target.id);
      view.setPhase('running');
      view.setEngine({ ...engine.status(), state: 'running' });
      if (target) saveLast(target.id);
      const ms = app.bootStartedAt ? Math.round((Date.now() - app.bootStartedAt) / 100) / 10 : null;
      view.toast(`${target.name} 부팅 완료${ms ? ` · ${ms}s` : ''} — 바로 플레이하세요`);
      break;
    }
    case 'error': {
      const error = event.error || {};
      library.setBusy(false);
      library.setRunning(null);
      app.lastError = { ...error, kind: error.code === 'cancelled' ? 'cancelled' : 'boot' };
      if (error.code === 'cancelled') {
        view.setPhase('idle');
        view.toast('부팅을 취소했습니다');
        break;
      }
      view.setEngine(engine.status());
      view.setPhase('error', {
        message: friendlyError(error),
        detail: `오류 코드 · ${error.code || 'boot'} — 다시 시도해 주세요.`,
      });
      break;
    }
    case 'idle':
      library.setBusy(false);
      library.setRunning(null);
      view.setEngine(engine.status());
      if (view.phase === 'booting') view.setPhase('idle');
      break;
    default:
      break;
  }
}

function saveLast(id) {
  try { storage.setItem(STORAGE.lastGame, id); } catch (_) { /* private mode */ }
}

async function retry() {
  const target = app.current || GAMES[0];
  const force = !!(app.lastError && app.lastError.kind === 'engine');
  // a local bundle URL was revoked when its runtime stopped: open the file again
  if (target && target.local && app.localFile) {
    const reopened = bundles.open(app.localFile);
    if (reopened.ok) return startGame(reopened.target, { force });
  }
  return startGame(target, { force });
}

/* ------------------------------------------------------------ file input -- */
function handleFile(file) {
  const verdict = validateBundle(file);
  if (!verdict.ok) {
    library.note(verdict.message, 'warn');
    view.toast(verdict.message, 'warn');
    return;
  }
  const opened = bundles.open(file);
  if (!opened.ok) {
    library.note(opened.message || '파일을 열지 못했습니다.', 'warn');
    return;
  }
  app.localFile = file;
  library.note(`${file.name} · ${formatSize(file.size)} · 브라우저 안에서만 실행`, 'ok');
  startGame(opened.target);
}

/* --------------------------------------------------------------- controls -- */
view.bind({
  onPlay: () => startGame(app.current || GAMES[0]),
  onCancel: () => {
    app.bootToken += 1; // anything still waiting on the engine is now stale
    session.stop('cancel');
  },
  onRetry: () => retry(),
  onRestart: () => {
    if (!app.current) { view.toast('먼저 게임을 고르세요', 'warn'); return; }
    view.toast('다시 시작합니다');
    startGame(app.current);
  },
  onMute: () => toggleMute(),
  onVolume: (value) => {
    const level = Math.max(0, Math.min(1, value / 100));
    app.volume = level;
    app.muted = level === 0;
    view.setMuted(app.muted);
    session.setVolume(level);
  },
  onFullscreen: () => toggleFullscreen(),
  onExitFullscreen: () => exitFullscreen(),
});

function toggleMute() {
  app.muted = !app.muted;
  view.setMuted(app.muted);
  session.setVolume(app.muted ? 0 : app.volume || 1);
  const mini = $('miniMuteBtn');
  if (mini) {
    mini.setAttribute('aria-pressed', String(app.muted));
    mini.textContent = app.muted ? '🔇' : '🔊';
  }
  view.toast(app.muted ? '소리를 껐습니다' : '소리를 켰습니다');
}

async function toggleFullscreen() {
  const shell = document.getElementById('screenShell');
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (shell.requestFullscreen) await shell.requestFullscreen();
    else if (shell.webkitRequestFullscreen) shell.webkitRequestFullscreen();
    else view.toast('이 브라우저는 전체화면을 지원하지 않습니다', 'warn');
  } catch (_) {
    view.toast('전체화면으로 전환하지 못했습니다', 'warn');
  }
}

async function exitFullscreen() {
  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch (_) { /* ignore */ }
  }
}

document.addEventListener('fullscreenchange', () => {
  view.setFullscreen(document.fullscreenElement === document.getElementById('screenShell'));
});

/* ----------------------------------------------------------------- input -- */
const keyboard = new KeyboardInput({
  manager: input,
  store: keymapStore,
  getProfile: () => app.profile,
  isWasdEnabled: () => app.wasd,
  onActivity: (code, down) => flashPad(code, down),
}).attach();

function flashPad(code, down) {
  const pad = $('pad');
  if (!pad || !code) return;
  for (const btn of pad.querySelectorAll('[data-pad-key]')) {
    const codes = padCodesFor(btn.dataset.code, app.profile);
    if (!codes.includes(code)) continue;
    btn.classList.toggle('is-hot', down);
  }
}

const touchPad = new TouchPad({
  root: $('pad'),
  manager: input,
  getCodes: (button) => padCodesFor(button.dataset.code, app.profile),
  isReady: () => session.running,
  onNotReady: () => view.toast('먼저 게임을 실행하세요', 'warn'),
}).attach();

const softKeyboard = new SoftKeyboard({
  input: $('softKeyboard'),
  manager: input,
  isReady: () => session.running,
  onNotReady: () => view.toast('먼저 게임을 실행하세요', 'warn'),
}).attach();

[$('softKbBtn'), $('miniKbBtn')].forEach((btn) => {
  if (btn) btn.addEventListener('click', () => softKeyboard.open());
});

input.subscribe((event) => {
  if (event.type === 'capture') view.setCaptureFlag(event.blocked);
});

/* ------------------------------------------------------- keymap settings -- */
const settings = new SettingsDialog({
  dialog: $('keymapModal'),
  listEl: $('keymapList'),
  noteEl: $('keymapNote'),
  store: keymapStore,
  onOpen: () => { input.block('settings'); renderLegend(); },
  onClose: () => { input.unblock('settings'); renderLegend(); },
  onChanged: () => renderLegend(),
}).bind();

$('keymapBtn').addEventListener('click', () => settings.open());
$('resetKeysBtn').addEventListener('click', () => {
  keymapStore.resetAll();
  renderLegend();
  view.toast('키 설정을 기본값으로 되돌렸습니다');
});

function renderLegend() {
  const strip = $('keybind');
  if (!strip) return;
  const chip = (code) => `<kbd>${keyLabel(code)}</kbd>`;
  const codes = (id) => keymapStore.codes(id).filter(Boolean);
  const first = (id) => chip(codes(id)[0] || null);
  const alt = (id, label) => `<span class="kb">${codes(id).map(chip).join('<i>/</i>') || chip(null)} ${label}</span>`;
  const turn = `${chip(codes('left')[1] || null)}${chip(codes('right')[1] || null)}`;
  strip.dataset.wasd = app.wasd ? 'on' : 'off';
  strip.innerHTML = `
    <span class="keybind-label">PC 키보드</span>
    <span class="kb">${['forward', 'left', 'back', 'right'].map(first).join('')} 이동</span>
    <span class="kb">${turn} 회전</span>
    ${alt('fire', '사격')}
    ${alt('use', '문 열기')}
    ${alt('enter', 'Enter')}
    <span class="kb">${first('run')} 달리기</span>
    <span class="kb">${first('strafe')} 스트레이프</span>
    <span class="kb"><kbd>1</kbd>–<kbd>4</kbd> 무기</span>`;
}

/* -------------------------------------------------------------- switches -- */
const wasdBtn = $('wasdBtn');
function applyWasd(announce = false) {
  if (wasdBtn) {
    wasdBtn.setAttribute('aria-checked', String(app.wasd));
    const state = $('wasdState');
    if (state) state.textContent = app.wasd ? '켜짐' : '꺼짐';
    wasdBtn.title = app.wasd ? 'WASD 바인딩 켜짐' : 'WASD 바인딩 꺼짐 — 글자로 전달';
  }
  const strip = $('keybind');
  if (strip) strip.dataset.wasd = app.wasd ? 'on' : 'off';
  if (announce) {
    view.toast(app.wasd ? 'WASD 모드 켜짐 — W/A/S/D로 이동합니다' : 'WASD 모드 꺼짐 — W/A/S/D는 글자로 전달됩니다');
  }
}
if (wasdBtn) {
  wasdBtn.addEventListener('click', () => {
    app.wasd = !app.wasd;
    try { storage.setItem(STORAGE.wasd, app.wasd ? '1' : '0'); } catch (_) { /* ignore */ }
    input.releaseAll('wasd-toggle');
    applyWasd(true);
  });
}
applyWasd();

/* -------------------------------------------------------------- responsive -- */
const responsive = new ResponsiveMode({
  win: window,
  doc: document,
  pad: $('pad'),
  miniBar: $('miniBar'),
  storage,
  isRunning: () => session.running,
  onPadHidden: (hidden) => view.setPadHidden(hidden),
  onMute: () => toggleMute(),
  onExit: () => {
    if (document.fullscreenElement) { exitFullscreen(); return; }
    responsive.dismiss();
    view.toast('가상 전체화면을 닫았습니다 — 화면을 돌리면 다시 열립니다');
  },
  onKeyboard: () => softKeyboard.open(),
  onNotice: (message) => view.toast(message),
}).start();

const padToggleBtn = $('padToggleBtn');
if (padToggleBtn) {
  padToggleBtn.addEventListener('click', () => responsive.togglePad());
}
const padForceBtn = $('padForceBtn');
function applyPadForce(announce = false) {
  if (padForceBtn) {
    padForceBtn.setAttribute('aria-checked', String(responsive.padForced));
    const state = $('padForceState');
    if (state) state.textContent = responsive.padForced ? '켜짐' : '꺼짐';
  }
  responsive.setPadForced(responsive.padForced, { announce });
}
if (padForceBtn) {
  padForceBtn.addEventListener('click', () => {
    responsive.padForced = !responsive.padForced;
    applyPadForce(true);
  });
}
applyPadForce(false);

$('resetPadBtn').addEventListener('click', () => {
  responsive.setPadHidden(false, { announce: false });
  responsive.setPadForced(false, { announce: false });
  applyPadForce(false);
  view.setPadHidden(false);
  view.toast('가상 패드 설정을 기본값으로 되돌렸습니다');
});

/* ------------------------------------------------------------- chrome/ui -- */
const portalMenuBtn = $('portalMenuBtn');
const portalMenuDropdown = $('portalMenuDropdown');
if (portalMenuBtn) {
  portalMenuBtn.addEventListener('click', () => {
    const open = portalMenuDropdown.hidden;
    portalMenuDropdown.hidden = !open;
    portalMenuBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (event) => {
    if (portalMenuDropdown.hidden) return;
    if (event.target.closest('#portalMenu')) return;
    portalMenuDropdown.hidden = true;
    portalMenuBtn.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !portalMenuDropdown.hidden) {
      portalMenuDropdown.hidden = true;
      portalMenuBtn.setAttribute('aria-expanded', 'false');
      portalMenuBtn.focus();
    }
  });
}

/* a bundle dropped anywhere on the page lands in the player, not in the tab */
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const zone = $('dropZone');
  if (zone && zone.contains(event.target)) return;
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) handleFile(file);
});

/* the shared theme toggle belongs in the header here, not floating over the pad */
const themeToggle = document.getElementById('hd2ThemeToggle');
const headerActions = document.querySelector('.header-actions');
const portalMenu = document.getElementById('portalMenu');
if (themeToggle && headerActions) {
  themeToggle.classList.add('in-header');
  headerActions.insertBefore(themeToggle, portalMenu || null);
}

/* ---------------------------------------------------------------- start -- */
library.render(GAMES).bindFileInput();
renderLegend();

const params = new URLSearchParams(location.search);
const wanted = params.get('game');
let initial = GAMES[0];
if (wanted && findGame(wanted)) initial = findGame(wanted);
else {
  const last = storage.getItem(STORAGE.lastGame);
  if (last && findGame(last)) initial = findGame(last);
}
selectTarget(initial);
view.setPhase('idle');
view.setPadHidden(false);

/* the first click on the overlay is a user gesture: boot without an autoplay block */
const warm = () => engine.load().then(() => view.setEngine(engine.status())).catch(() => view.setEngine(engine.status()));
if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 2500 });
else setTimeout(warm, 1200);

window.addEventListener('pagehide', () => {
  input.releaseAll('pagehide');
  bundles.releaseAll();
});
window.addEventListener('beforeunload', () => {
  input.releaseAll('unload');
});

/* a tiny debug surface for the E2E suite and for live troubleshooting */
window.__pkpilot = {
  version: '2.0.0',
  engineVersion: ENGINE_SOURCES[0].label,
  games: GAMES,
  state: app,
  boot: startGame,
  retry,
  cancel: () => session.stop('cancel'),
  press: (code) => input.press(code, 'debug'),
  release: (code) => input.release(code, 'debug'),
  releaseAll: () => input.releaseAll('debug'),
  tap: (code) => input.tap(code),
  typeText: (text) => softKeyboard.typeText(text),
  sendKey,
  KBD,
  actions: ACTIONS,
  keymap: () => JSON.parse(JSON.stringify(keymapStore.map)),
  keyLabel,
  setKey: (actionId, slot, code) => keymapStore.assign(actionId, slot, code),
  openKeymap: () => settings.open(),
  closeKeymap: () => settings.close(),
  isTouch: responsive.touch,
  input,
  session,
  engine,
  library,
  view,
  responsive,
  snapshot: () => ({
    session: session.snapshot(),
    engine: engine.status(),
    input: { held: input.heldCodes(), blocked: input.captureBlocked, queued: input.pendingChars },
    phase: view.phase,
    target: app.current ? app.current.id : null,
    keymap: keymapStore.map,
    wasd: app.wasd,
    muted: app.muted,
  }),
};
window.__pkpilotReady = true;
