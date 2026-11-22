/* ==========================================================================
   HD2Lab | DOS Player — js-dos engine loader
   One explicit state machine for the library itself:

        idle ──load()──▶ loading ──▶ ready
                          │
                          └──▶ failed ──load({force})──▶ loading …

   What changed against the old inline loader
   * a failure is remembered: a second call rejects at once instead of quietly
     polling for another 30 s (the old code recreated the promise and appended
     a second <script> on every retry)
   * exactly one script node is ever injected; a retry reuses or replaces that
     node, never adds one beside it
   * the stylesheet, the script and the DOSBox wasm all come from one pinned
     js-dos version (npm 8.5.4 through jsDelivr); the canonical v8.js-dos.com
     URL is only a fallback source for a retry
   * a late-arriving window.Dos is still adopted after a timeout, so a slow
     network ends in "ready", not in a permanent error
   ========================================================================== */

import { CONFIG } from '../config.js';

export const JSDOS_VERSION = CONFIG.jsdosVersion;

const PINNED = `https://cdn.jsdelivr.net/npm/js-dos@${JSDOS_VERSION}/dist/`;

export const ENGINE_SOURCES = Object.freeze([
  {
    id: 'jsdelivr-pinned',
    label: `js-dos ${JSDOS_VERSION} (pinned)`,
    js: `${PINNED}js-dos.js`,
    // the stylesheet is imported from style.css into layer(engine) so the
    // preflight inside it can never repaint this shell
    emulators: `${PINNED}emulators/`,
  },
  {
    id: 'jsdos-cdn',
    label: 'js-dos v8 (official CDN)',
    js: 'https://v8.js-dos.com/latest/js-dos.js',
    emulators: 'https://v8.js-dos.com/latest/emulators/',
  },
]);

export class EngineError extends Error {
  constructor(message, code = 'engine', cause = null) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.cause = cause;
  }
}

export class EngineLoader {
  constructor({
    doc = typeof document !== 'undefined' ? document : null,
    global = typeof window !== 'undefined' ? window : globalThis,
    sources = ENGINE_SOURCES,
    timeoutMs = CONFIG.engineTimeoutMs,
    pollMs = CONFIG.enginePollMs,
    timers = {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle),
    },
  } = {}) {
    this.doc = doc;
    this.global = global;
    this.sources = sources;
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
    this.timers = timers;

    this.state = 'idle';
    this.error = null;
    this.attempts = 0;
    this.source = null;
    this.promise = null;
    this.script = null;
    this.deadline = null;
    this.poll = null;
    this.listeners = new Set();
  }

  get ready() {
    return this.state === 'ready' || this.hasDos();
  }

  hasDos() {
    return !!(this.global && typeof this.global.Dos === 'function');
  }

  get emulatorPrefix() {
    return (this.source || this.sources[0]).emulators;
  }

  status() {
    return {
      state: this.state,
      ready: this.hasDos(),
      version: JSDOS_VERSION,
      source: this.source ? this.source.id : null,
      sourceLabel: this.source ? this.source.label : null,
      attempts: this.attempts,
      error: this.error ? { message: this.error.message, code: this.error.code } : null,
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit() {
    const status = this.status();
    for (const listener of this.listeners) {
      try { listener(status); } catch (_) { /* UI listeners stay non-fatal */ }
    }
  }

  #sourceFor(attempt) {
    return this.sources[Math.min(attempt, this.sources.length - 1)] || this.sources[0];
  }

  /**
   * Resolve when window.Dos exists.
   * @param {{force?: boolean}} options force = a user-initiated retry: it clears
   *   the remembered failure and starts a fresh attempt.
   */
  load({ force = false } = {}) {
    if (this.hasDos()) {
      this.#setReady();
      return Promise.resolve(this.status());
    }
    if (this.state === 'loading' && this.promise) return this.promise;
    if (this.state === 'failed' && !force) {
      return Promise.reject(this.error || new EngineError('js-dos를 불러오지 못했습니다.', 'engine'));
    }
    if (this.state === 'failed' || force) this.#cleanupNodes();

    this.state = 'loading';
    this.error = null;
    this.attempts += 1;
    this.source = this.#sourceFor(this.attempts - 1);
    this.#emit();

    this.promise = new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      try {
        this.#injectScript();
      } catch (error) {
        this.#fail(new EngineError('js-dos를 불러오지 못했습니다.', 'inject', error));
        return;
      }
      this.deadline = this.timers.setTimeout(() => {
        if (this.hasDos()) { this.#setReady(); return; }
        this.#fail(new EngineError(
          `js-dos 로딩이 ${Math.round(this.timeoutMs / 1000)}초를 넘었습니다. 네트워크를 확인해 주세요.`,
          'timeout',
        ));
      }, this.timeoutMs);
      this.#schedulePoll();
    });
    return this.promise;
  }

  #schedulePoll() {
    this.poll = this.timers.setTimeout(() => {
      this.poll = null;
      if (this.state !== 'loading') return;
      if (this.hasDos()) { this.#setReady(); return; }
      this.#schedulePoll();
    }, this.pollMs);
  }

  #injectScript() {
    if (!this.doc) throw new EngineError('document가 없어 js-dos를 붙일 수 없습니다.', 'no-doc');
    // adopt a node that is already on the page (a second loader instance, or a
    // hot reload): never append a duplicate js-dos module
    const existing = this.doc.querySelector ? this.doc.querySelector('script[data-jsdos-js]') : null;
    if (existing && existing.getAttribute('src') === this.source.js) {
      this.script = existing;
      this.#watch(existing);
      return;
    }
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    const script = this.doc.createElement('script');
    script.type = 'module';
    script.crossOrigin = 'anonymous';
    script.dataset.jsdosJs = '1';
    script.async = true;
    script.src = this.source.js;
    this.#watch(script);
    this.doc.head.appendChild(script);
    this.script = script;
  }

  #watch(script) {
    script.addEventListener('load', () => {
      if (this.hasDos()) this.#setReady();
      // a module that loaded without defining Dos is left to the deadline so a
      // slow module evaluation can still settle into “ready”
    });
    script.addEventListener('error', () => {
      this.#fail(new EngineError(
        `js-dos 스크립트를 불러오지 못했습니다 (${this.source.id}).`,
        'network',
      ));
    });
  }

  #setReady() {
    if (this.state === 'ready') return;
    this.state = 'ready';
    this.error = null;
    this.#clearTimers();
    this.#emit();
    if (this.pending) {
      const { resolve } = this.pending;
      this.pending = null;
      resolve(this.status());
    }
  }

  #fail(error) {
    const err = error instanceof EngineError ? error : new EngineError(String(error && error.message || error), 'engine', error);
    this.state = 'failed';
    this.error = err;
    this.#clearTimers();
    // a failed node is removed so a retry starts from a clean element and the
    // page never keeps two js-dos scripts side by side
    if (this.script && this.script.parentNode) this.script.parentNode.removeChild(this.script);
    this.script = null;
    this.#emit();
    if (this.pending) {
      const { reject } = this.pending;
      this.pending = null;
      reject(err);
    }
  }

  #clearTimers() {
    if (this.deadline) { this.timers.clearTimeout(this.deadline); this.deadline = null; }
    if (this.poll) { this.timers.clearTimeout(this.poll); this.poll = null; }
  }

  #cleanupNodes() {
    this.#clearTimers();
    if (this.pending) {
      const { reject } = this.pending;
      this.pending = null;
      const cancelled = new EngineError('엔진 로딩이 취소되었습니다.', 'cancelled');
      try { reject(cancelled); } catch (_) { /* ignore */ }
    }
    this.promise = null;
    if (this.script) {
      const node = this.script;
      if (node.parentNode) node.parentNode.removeChild(node);
      this.script = null;
    }
    this.state = 'idle';
    this.#emit();
  }

  /** Forget a failure without loading (used by “초기화”). */
  reset() {
    if (this.hasDos()) { this.#setReady(); return this.status(); }
    this.#cleanupNodes();
    this.error = null;
    return this.status();
  }

  /**
   * Abort a download that is still in flight (the player pressed 취소). A
   * remembered failure is cleared by reset(), so the next attempt starts fresh.
   */
  cancel(reason = 'cancelled') {
    if (this.state !== 'loading') return false;
    this.#fail(new EngineError('엔진 로딩이 취소되었습니다.', reason));
    return true;
  }

  destroy() {
    this.#cleanupNodes();
    this.listeners.clear();
  }
}
