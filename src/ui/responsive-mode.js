/* ==========================================================================
   HD2Lab | DOS Player — responsive / immersive mode
   One module decides the three presentation switches the CSS listens to:

     html[data-touch=on|off]        is this a touch device at all
     html[data-landscape=on|off]    phone on its side -> the screen becomes the page
     #pad[data-hidden] / [data-force]

   In immersive landscape the header, library and disclosures step away, the
   screen fills the viewport, the pad floats over it and the mini bar appears —
   including a compact game picker, so a game can still be chosen before (or
   after) booting while the phone is sideways.
   ========================================================================== */

export class ResponsiveMode {
  constructor({
    win = typeof window !== 'undefined' ? window : null,
    doc = typeof document !== 'undefined' ? document : null,
    pad = null,
    miniBar = null,
    storage = null,
    isRunning = () => false,
    onPadForce = () => {},
    onPadHidden = () => {},
    onMute = () => {},
    onExit = () => {},
    onKeyboard = () => {},
    onNotice = () => {},
  } = {}) {
    this.win = win;
    this.doc = doc;
    this.pad = pad;
    this.miniBar = miniBar;
    this.storage = storage;
    this.isRunning = isRunning;
    this.onPadForce = onPadForce;
    this.onPadHidden = onPadHidden;
    this.onMute = onMute;
    this.onExit = onExit;
    this.onKeyboard = onKeyboard;
    this.onNotice = onNotice;

    this.touch = this.detectTouch();
    this.padForced = this.readFlag('padforce') === '1';
    this.padHidden = false;
    this.overlayDismissed = false;
    this.lastLandscape = null;
    this.attached = false;
  }

  detectTouch() {
    try {
      const nav = this.win.navigator || {};
      return (nav.maxTouchPoints || 0) > 0
        || (this.win.matchMedia && this.win.matchMedia('(hover: none), (pointer: coarse)').matches);
    } catch (_) {
      return false;
    }
  }

  readFlag(name) {
    try { return this.storage ? this.storage.getItem(`pkpilot0006:${name}`) : null; } catch (_) { return null; }
  }

  writeFlag(name, value) {
    try { this.storage && this.storage.setItem(`pkpilot0006:${name}`, value); } catch (_) { /* private mode */ }
  }

  get landscape() {
    if (!this.win) return false;
    return this.win.innerWidth > this.win.innerHeight;
  }

  /** immersive = touch + landscape + not dismissed */
  get immersive() {
    return this.touch && this.landscape && !this.overlayDismissed;
  }

  sync() {
    if (!this.doc) return this;
    const root = this.doc.documentElement;
    const landscape = this.landscape;
    if (this.lastLandscape !== null && this.lastLandscape !== landscape) this.overlayDismissed = false;
    this.lastLandscape = landscape;

    root.dataset.touch = this.touch ? 'on' : 'off';
    root.dataset.landscape = this.immersive ? 'on' : 'off';
    root.dataset.player = this.doc.body ? this.doc.body.dataset.playerState || 'idle' : 'idle';

    if (this.pad) {
      this.pad.dataset.force = this.padForced ? 'on' : 'off';
      this.pad.dataset.hidden = this.padHidden ? 'on' : 'off';
      this.pad.dataset.immersive = this.immersive ? 'on' : 'off';
      if (!this.immersive) {
        this.pad.dataset.extra = 'closed';
        const more = this.doc.getElementById('padMoreBtn');
        if (more) more.setAttribute('aria-expanded', 'false');
      }
    }
    if (this.miniBar) this.miniBar.hidden = !this.immersive;
    this.syncMini();
    return this;
  }

  syncMini() {
    if (!this.doc) return;
    const padBtn = this.doc.getElementById('miniPadBtn');
    if (padBtn) {
      padBtn.textContent = this.padHidden ? '패드 보이기' : '패드 숨기기';
      padBtn.setAttribute('aria-pressed', String(!this.padHidden));
    }
    const exit = this.doc.getElementById('miniExitBtn');
    if (exit) exit.textContent = this.immersive && this.isRunning() ? '✕' : '✕';
    const games = this.doc.getElementById('miniGames');
    if (games) games.hidden = false;
  }

  setPadHidden(hidden, { announce = true } = {}) {
    this.padHidden = !!hidden;
    this.sync();
    this.onPadHidden(this.padHidden);
    if (announce) this.onNotice(this.padHidden ? '가상 패드를 숨겼습니다' : '가상 패드를 표시합니다');
  }

  togglePad() {
    this.setPadHidden(!this.padHidden);
  }

  setPadForced(value, { announce = true } = {}) {
    this.padForced = !!value;
    this.writeFlag('padforce', this.padForced ? '1' : '0');
    this.sync();
    if (announce) this.onNotice(this.padForced ? '가상 게임패드를 항상 표시합니다' : '가상 게임패드를 기본 동작으로 되돌렸습니다');
  }

  /** Leave immersive mode without changing device orientation. */
  dismiss() {
    this.overlayDismissed = true;
    this.sync();
  }

  start() {
    if (this.attached || !this.win) return this;
    this.onResize = () => this.sync();
    this.onOrientation = () => { this.overlayDismissed = false; this.sync(); };
    this.onFullscreen = () => this.sync();
    this.win.addEventListener('resize', this.onResize);
    this.win.addEventListener('orientationchange', this.onOrientation);
    this.doc.addEventListener('fullscreenchange', this.onFullscreen);

    const doc = this.doc;
    const bind = (id, fn) => {
      const el = doc.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    bind('miniPadBtn', () => this.togglePad());
    bind('miniMuteBtn', () => this.onMute());
    bind('miniKbBtn', () => this.onKeyboard());
    bind('miniExitBtn', () => this.onExit());
    bind('padMoreBtn', () => {
      if (!this.pad) return;
      const open = this.pad.dataset.extra !== 'open';
      this.pad.dataset.extra = open ? 'open' : 'closed';
      const more = doc.getElementById('padMoreBtn');
      if (more) more.setAttribute('aria-expanded', String(open));
    });

    this.attached = true;
    this.sync();
    return this;
  }

  stop() {
    if (!this.attached || !this.win) return this;
    this.win.removeEventListener('resize', this.onResize);
    this.win.removeEventListener('orientationchange', this.onOrientation);
    this.doc.removeEventListener('fullscreenchange', this.onFullscreen);
    this.attached = false;
    return this;
  }
}
