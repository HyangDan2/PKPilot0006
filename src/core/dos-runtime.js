/* ==========================================================================
   HD2Lab | DOS Player — one js-dos execution instance
   A runtime belongs to exactly one generation of a boot request. It is created
   by the SessionManager, started once and stopped once.

   “Running” is not “a canvas exists”:
     1. js-dos must hand over the CommandInterface   (onEvent 'ci-ready')
     2. the canvas must have real dimensions and have painted a frame
     3. the props object must still offer stop/setVolume
   Only then does the runtime report `running`. Anything slower than the boot
   budget fails with code 'boot-timeout' instead of hanging the UI.
   ========================================================================== */

import { CONFIG } from '../config.js';

export class RuntimeError extends Error {
  constructor(message, code = 'runtime', cause = null) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
    this.cause = cause;
  }
}

const defaultTimers = () => ({
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
});

export class DosRuntime {
  constructor({
    generation = 0,
    mount,
    Dos,
    options = {},
    bootTimeoutMs = CONFIG.bootTimeoutMs,
    frameTimeoutMs = CONFIG.frameTimeoutMs,
    pollMs = CONFIG.bootPollMs,
    timers = defaultTimers(),
    now = () => Date.now(),
    requestFrame = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16)),
  } = {}) {
    this.generation = generation;
    this.mount = mount;
    this.Dos = Dos;
    this.options = options;
    this.bootTimeoutMs = bootTimeoutMs;
    this.frameTimeoutMs = frameTimeoutMs;
    this.pollMs = pollMs;
    this.timers = timers;
    this.now = now;
    this.requestFrame = requestFrame;

    this.state = 'idle';
    this.props = null;
    this.ci = null;
    this.error = null;
    this.startedAt = null;
    this.readyAt = null;
    this.stoppedAt = null;
    this.events = [];
    this.timers_ = new Set();
    this.waiters = new Set();
    this.volume = 1;
  }

  get running() {
    return this.state === 'running';
  }

  get durationMs() {
    if (!this.startedAt) return 0;
    return (this.stoppedAt || this.now()) - this.startedAt;
  }

  #log(type, detail = {}) {
    this.events.push({ at: this.now(), type, ...detail });
    if (this.events.length > 40) this.events.shift();
  }

  #setLater(fn, ms) {
    const handle = this.timers.setTimeout(() => {
      this.timers_.delete(handle);
      fn();
    }, ms);
    this.timers_.add(handle);
    return handle;
  }

  #clearTimers() {
    for (const handle of this.timers_) this.timers.clearTimeout(handle);
    this.timers_.clear();
  }

  /* Late js-dos events from a stopped or superseded runtime land here and are
     dropped, so an old game can never paint into the new game's stage. */
  #onEvent = (event, ci) => {
    if (this.state === 'stopped' || this.state === 'failed') {
      this.#log('event-dropped', { event });
      return;
    }
    this.#log('event', { event });
    if (event === 'ci-ready' && ci) {
      this.ci = ci;
      this.#log('ci-ready');
    }
  };

  #onProgress = (progress) => {
    if (this.state !== 'booting') return;
    this.#log('progress', { progress });
    if (typeof this.onProgress === 'function') this.onProgress(progress);
  };

  /** Callback the UI can replace to show bundle download progress. */
  onProgress = null;

  async start({ url } = {}) {
    if (this.state !== 'idle') throw new RuntimeError(`이미 시작된 런타임입니다 (${this.state}).`, 'state');
    if (!this.Dos) throw new RuntimeError('js-dos가 준비되지 않았습니다.', 'engine-missing');
    if (!url) throw new RuntimeError('번들 URL이 없습니다.', 'no-url');

    this.state = 'booting';
    this.startedAt = this.now();
    this.#log('boot', { url, generation: this.generation });

    try {
      this.props = this.Dos(this.mount, {
        ...this.options,
        url,
        onEvent: this.#onEvent,
      });
    } catch (error) {
      this.#fail(new RuntimeError(
        error && error.message ? error.message : 'DOSBox를 시작하지 못했습니다.',
        'boot-failed',
        error,
      ));
      throw this.error;
    }

    if (!this.props || typeof this.props.stop !== 'function') {
      this.#fail(new RuntimeError('js-dos가 실행 인스턴스를 돌려주지 않았습니다.', 'no-instance'));
      throw this.error;
    }

    try {
      await this.#waitFor(() => !!this.ci, this.bootTimeoutMs, () => new RuntimeError(
        'DOSBox가 부팅을 마치지 않았습니다 (입력 준비 신호 없음).',
        'boot-timeout',
      ));
      await this.#waitForCanvas();
    } catch (error) {
      if (this.state === 'stopped') throw new RuntimeError('부팅이 취소되었습니다.', 'cancelled', error);
      this.#fail(error instanceof RuntimeError ? error : new RuntimeError(String(error && error.message), 'boot-failed', error));
      await this.stop('boot-failed');
      throw this.error;
    }

    this.readyAt = this.now();
    this.state = 'running';
    this.#log('running', { bootMs: this.readyAt - this.startedAt });
    try { this.props.setVolume(this.volume); } catch (_) { /* volume is cosmetic */ }
    return this;
  }

  #waitFor(predicate, timeoutMs, makeError) {
    if (predicate()) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const started = this.now();
      const waiter = {
        reject: (error) => {
          this.waiters.delete(waiter);
          this.#clearTimers();
          reject(error);
        },
      };
      this.waiters.add(waiter);
      const tick = () => {
        if (this.state === 'stopped') {
          waiter.reject(new RuntimeError('부팅이 취소되었습니다.', 'cancelled'));
          return;
        }
        if (predicate()) {
          this.waiters.delete(waiter);
          resolve(true);
          return;
        }
        if (this.now() - started >= timeoutMs) {
          this.waiters.delete(waiter);
          reject(makeError());
          return;
        }
        this.#setLater(tick, this.pollMs);
      };
      this.#setLater(tick, 0);
    });
  }

  #canvas() {
    if (!this.mount || typeof this.mount.querySelector !== 'function') return null;
    const canvas = this.mount.querySelector('canvas');
    if (!canvas || !canvas.width || !canvas.height) return null;
    return canvas;
  }

  async #waitForCanvas() {
    await this.#waitFor(() => !!this.#canvas(), this.frameTimeoutMs, () => new RuntimeError(
      'DOS 화면(canvas)이 만들어지지 않았습니다.',
      'canvas-timeout',
    ));
    // one composition beat so the first frame is actually painted
    await new Promise((resolve) => this.requestFrame(() => resolve(true)));
    if (!this.#canvas()) {
      throw new RuntimeError('DOS 화면이 곧바로 사라졌습니다.', 'canvas-lost');
    }
  }

  #fail(error) {
    this.error = error;
    this.state = 'failed';
    this.#log('failed', { code: error.code, message: error.message });
    for (const waiter of Array.from(this.waiters)) waiter.reject(error);
    this.waiters.clear();
  }

  setVolume(value) {
    this.volume = value;
    if (this.state === 'running' && this.props) {
      try { this.props.setVolume(value); } catch (_) { /* ignore */ }
    }
    return this.volume;
  }

  /**
   * Ordered teardown:
   *   1. state -> stopped, so late js-dos events are dropped
   *   2. pending boot waiters are rejected (they would otherwise leak timers)
   *   3. every timer this runtime owns is cleared
   *   4. the js-dos instance is stopped (ci.exit + network shutdown inside)
   *   5. the mount is emptied (canvas, injected UI, blob-backed bundle)
   * The blob URL is owned by the session, not here, and is revoked after this
   * resolves — a running emulator must never pull a revoked URL.
   */
  async stop(reason = 'stop') {
    if (this.state === 'stopped') return { already: true, reason };
    const previous = this.state;
    const wasRunning = previous === 'running';
    this.state = 'stopped';
    this.#log('stop', { reason, from: previous });
    const errors = [];

    for (const waiter of Array.from(this.waiters)) {
      try { waiter.reject(new RuntimeError('부팅이 취소되었습니다.', 'cancelled')); } catch (_) { /* ignore */ }
    }
    this.waiters.clear();
    this.#clearTimers();

    const props = this.props;
    this.props = null;
    this.ci = null;

    if (props && typeof props.stop === 'function') {
      try {
        await props.stop();
        this.#log('stopped', { ok: true });
      } catch (error) {
        errors.push(error);
        this.#log('stop-error', { message: String(error && error.message) });
      }
    }

    if (this.mount && typeof this.mount.replaceChildren === 'function') {
      try { this.mount.replaceChildren(); } catch (error) { errors.push(error); }
    }
    this.stoppedAt = this.now();
    // a boot that failed stays "failed" (terminal) rather than looking like a
    // clean stop: the UI and the session manager read that state
    if (previous === 'failed') this.state = 'failed';
    return { already: false, reason, wasRunning, errors, durationMs: this.durationMs };
  }
}
