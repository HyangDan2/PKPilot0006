/* ==========================================================================
   HD2Lab | DOS Player — player view
   Owns the screen, the overlay (idle / booting / error), the control bar and
   the status chips. It never talks to js-dos: it only renders the state the
   session manager reports.
   ========================================================================== */

const PHASES = {
  idle: { kicker: 'READY', chip: '대기', chipState: 'idle' },
  booting: { kicker: 'BOOTING', chip: '부팅 중', chipState: 'booting' },
  running: { kicker: 'RUNNING', chip: '실행 중', chipState: 'running' },
  error: { kicker: 'ERROR', chip: '오류', chipState: 'error' },
  paused: { kicker: 'PAUSED', chip: '일시정지', chipState: 'idle' },
};

export class PlayerView {
  constructor(doc = document) {
    this.doc = doc;
    this.el = {
      screen: doc.getElementById('screenShell'),
      stage: doc.getElementById('dosStage'),
      overlay: doc.getElementById('screenOverlay'),
      kicker: doc.getElementById('overlayKicker'),
      title: doc.getElementById('overlayTitle'),
      sub: doc.getElementById('overlaySub'),
      hint: doc.getElementById('overlayHint'),
      play: doc.getElementById('playBtn'),
      playLabel: doc.getElementById('playLabel'),
      cancel: doc.getElementById('cancelBtn'),
      retry: doc.getElementById('retryBtn'),
      progress: doc.getElementById('overlayProgress'),
      progressText: doc.getElementById('progressText'),
      fsExit: doc.getElementById('fsExit'),
      captureFlag: doc.getElementById('captureFlag'),
      engineChip: doc.getElementById('engineChip'),
      engineChipText: doc.getElementById('engineChipText'),
      nowBadge: doc.getElementById('nowBadge'),
      nowTitle: doc.getElementById('nowTitle'),
      nowMeta: doc.getElementById('nowMeta'),
      stateChip: doc.getElementById('stateChip'),
      restart: doc.getElementById('restartBtn'),
      mute: doc.getElementById('muteBtn'),
      muteLabel: doc.getElementById('muteLabel'),
      muteIcon: doc.getElementById('muteIcon'),
      volume: doc.getElementById('volumeRange'),
      fs: doc.getElementById('fsBtn'),
      fsLabel: doc.getElementById('fsLabel'),
      keymap: doc.getElementById('keymapBtn'),
      padToggle: doc.getElementById('padToggleBtn'),
      padToggleLabel: doc.getElementById('padToggleLabel'),
      padHint: doc.getElementById('padHint'),
      toast: doc.getElementById('toast'),
    };
    this.phase = 'idle';
    this.target = null;
    this.toastTimer = 0;
    this.handlers = {};
  }

  bind(handlers = {}) {
    this.handlers = handlers;
    const on = (el, event, fn) => {
      if (el && typeof fn === 'function') el.addEventListener(event, fn);
    };
    on(this.el.play, 'click', () => this.handlers.onPlay && this.handlers.onPlay());
    on(this.el.cancel, 'click', () => this.handlers.onCancel && this.handlers.onCancel());
    on(this.el.retry, 'click', () => this.handlers.onRetry && this.handlers.onRetry());
    on(this.el.restart, 'click', () => this.handlers.onRestart && this.handlers.onRestart());
    on(this.el.mute, 'click', () => this.handlers.onMute && this.handlers.onMute());
    on(this.el.fs, 'click', () => this.handlers.onFullscreen && this.handlers.onFullscreen());
    on(this.el.fsExit, 'click', () => this.handlers.onExitFullscreen && this.handlers.onExitFullscreen());
    on(this.el.volume, 'input', () => {
      if (this.handlers.onVolume) this.handlers.onVolume(Number(this.el.volume.value));
    });
    return this;
  }

  describe(target) {
    if (!target) return '';
    if (target.local) return target.meta || '로컬 파일';
    const bits = [target.year, target.maker, target.genre].filter(Boolean);
    return bits.join(' · ');
  }

  setEngine(status = {}) {
    const chip = this.el.engineChip;
    const text = this.el.engineChipText;
    if (!chip || !text) return;
    const state = status.state || 'loading';
    let label = '엔진 준비 중';
    if (state === 'ready') label = '엔진 준비됨';
    else if (state === 'running') label = '실행 중';
    else if (state === 'failed') label = '엔진 오류';
    chip.dataset.state = state === 'running' ? 'running' : state;
    const version = `js-dos ${status.version || 'v8'}`;
    chip.title = status.error
      ? `${version} · ${status.error.message}`
      : `${version}${status.sourceLabel ? ` · ${status.sourceLabel}` : ''}`;
    text.textContent = label;
  }

  setTarget(target) {
    this.target = target || null;
    const t = this.target;
    if (this.el.nowBadge) this.el.nowBadge.textContent = t ? (t.badge || t.name.slice(0, 2).toUpperCase()) : '—';
    if (this.el.nowTitle) this.el.nowTitle.textContent = t ? t.name : '게임을 선택하세요';
    if (this.el.nowMeta) this.el.nowMeta.textContent = t ? this.describe(t) : '아래 라이브러리에서 고르세요';
    if (t && t.pad === 'doom' && this.el.padHint) this.el.padHint.textContent = '가상 게임패드 · ▲▼ 이동 · ◀▶ 회전 · Alt 옆걸음';
    else if (this.el.padHint) this.el.padHint.textContent = '가상 게임패드 · 터치로 조작';
    if (this.phase === 'idle' || this.phase === 'paused') this.setPhase(this.phase);
  }

  setPhase(phase, { message = '', detail = '', progress = null } = {}) {
    this.phase = PHASES[phase] ? phase : 'idle';
    const meta = PHASES[this.phase];
    const { screen, overlay, kicker, title, sub, hint, play, playLabel, cancel, retry, progress: progressEl, progressText } = this.el;
    if (!screen || !overlay) return;

    screen.dataset.state = this.phase;
    document.body.dataset.playerState = this.phase;
    const running = this.phase === 'running';
    overlay.hidden = running;
    if (kicker) kicker.textContent = meta.kicker;
    if (this.el.stateChip) {
      this.el.stateChip.textContent = meta.chip;
      this.el.stateChip.dataset.state = meta.chipState;
    }

    const name = this.target ? this.target.name : '게임';
    if (title) {
      title.textContent = this.phase === 'error'
        ? `${name} 실행 실패`
        : running ? name : this.phase === 'booting' ? `${name} 부팅 중` : `${name} 실행`;
    }
    if (sub) {
      if (this.phase === 'error') sub.textContent = message || '부팅하지 못했습니다.';
      else if (this.phase === 'booting') sub.textContent = message || 'DOSBox WebAssembly를 올리는 중입니다…';
      else if (this.phase === 'paused') sub.textContent = message || '다시 실행하면 이어서 플레이할 수 있습니다.';
      else sub.textContent = this.target
        ? `${this.describe(this.target)}${this.target.size ? ' · ' + this.target.size : ''}`
        : '라이브러리에서 게임을 고르세요';
    }
    if (hint) {
      hint.hidden = running || this.phase === 'booting';
      hint.textContent = this.phase === 'error'
        ? (detail || '잠시 뒤 다시 시도해 주세요.')
        : this.target ? '한 번 누르면 DOSBox가 부팅됩니다' : '아래 라이브러리에서 고르세요';
    }
    if (play) {
      play.hidden = this.phase === 'booting' || this.phase === 'error';
      if (playLabel) playLabel.textContent = this.phase === 'paused' ? '다시 실행' : '실행';
    }
    if (cancel) cancel.hidden = this.phase !== 'booting';
    if (retry) retry.hidden = this.phase !== 'error';
    if (progressEl) progressEl.hidden = this.phase !== 'booting';

    const canControl = running || this.phase === 'paused';
    [this.el.restart, this.el.mute, this.el.volume, this.el.fs].forEach((node) => {
      if (node) node.disabled = !canControl;
    });
    if (this.el.keymap) this.el.keymap.disabled = false;
    this.setProgress(this.phase === 'booting' ? progress : null);
  }

  setProgress(progress) {
    const { progress: box, progressText } = this.el;
    if (!box) return;
    const bar = box.querySelector('i');
    if (progress === null || progress === undefined) {
      box.dataset.mode = 'indeterminate';
      if (bar) bar.style.width = '';
      if (progressText) progressText.textContent = 'DOSBox를 올리는 중…';
      return;
    }
    box.dataset.mode = 'determinate';
    const value = Math.max(0, Math.min(100, Math.round(Number(progress) * 100)));
    if (bar) bar.style.width = `${value}%`;
    if (progressText) progressText.textContent = value > 0 ? `번들 받는 중 · ${value}%` : 'DOSBox를 올리는 중…';
  }

  setMuted(muted) {
    if (this.el.mute) {
      this.el.mute.setAttribute('aria-pressed', String(muted));
      this.el.mute.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
      this.el.mute.title = muted ? '소리 켜기' : '소리 끄기';
    }
    if (this.el.muteLabel) this.el.muteLabel.textContent = muted ? '무음' : '소리';
    if (this.el.muteIcon) this.el.muteIcon.setAttribute('href', muted ? '#i-mute' : '#i-volume');
    if (this.el.volume) this.el.volume.value = muted ? '0' : '100';
  }

  setVolume(value) {
    if (this.el.volume) this.el.volume.value = String(value);
  }

  setFullscreen(on) {
    if (this.el.fs) {
      this.el.fs.setAttribute('aria-pressed', String(on));
      this.el.fs.setAttribute('aria-label', on ? '전체화면 나가기' : '전체화면');
    }
    if (this.el.fsLabel) this.el.fsLabel.textContent = on ? '나가기' : '전체화면';
    if (this.el.fsExit) this.el.fsExit.hidden = !on;
  }

  setCaptureFlag(blocked) {
    if (this.el.captureFlag) this.el.captureFlag.hidden = !blocked;
  }

  setPadHidden(hidden) {
    if (this.el.padToggle) {
      this.el.padToggle.setAttribute('aria-pressed', String(!hidden));
      this.el.padToggle.title = hidden ? '가상 게임패드 표시' : '가상 게임패드 숨김';
    }
    if (this.el.padToggleLabel) this.el.padToggleLabel.textContent = hidden ? '패드 꺼짐' : '패드';
  }

  toast(message, tone = 'info') {
    const el = this.el.toast;
    if (!el) return;
    el.textContent = message;
    el.dataset.tone = tone;
    el.classList.add('is-on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
  }

  focusPrimary() {
    const target = this.phase === 'error' ? this.el.retry : this.el.play;
    if (target && !target.hidden) target.focus();
  }
}
