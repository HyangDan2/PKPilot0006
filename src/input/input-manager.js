/* ==========================================================================
   HD2Lab | DOS Player — input manager
   One place owns "which DOS keys are down and why".

   * every *input source* has an id (keyboard, pad:0 … pad:9, type:7, tap:12)
   * a DOS key is held while at least one source holds it — reference counted
     by a Set of source ids, so a pad release can never cut a keyboard hold
     and a second finger on the same key never sends a duplicate keydown
   * typed characters go through a sequential queue (down → hold → up → gap),
     so "aaa" really types three letters instead of collapsing into one hold
   * a capture gate (modal, menu, unfocused UI) stops new keys and releases
     whatever was down when it closed
   ========================================================================== */

function defaultTimers() {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
  };
}

export class InputManager {
  constructor({ send = () => {}, tapHoldMs = 60, gapMs = 24, timers = defaultTimers() } = {}) {
    this.send = send;
    this.tapHoldMs = tapHoldMs;
    this.gapMs = gapMs;
    this.timers = timers;

    /** @type {Map<string, Set<string>>} dos code -> source ids holding it */
    this.holds = new Map();
    /** @type {Map<string, Set<string>>} source id -> dos codes it holds */
    this.sources = new Map();

    this.blockers = new Set();
    this.listeners = new Set();

    this.queue = [];
    this.queueTimer = null;
    this.queueRunning = false;
    this.seq = 0;
    this.disposed = false;
    this.stats = { downs: 0, ups: 0, queued: 0, blockedPresses: 0 };
  }

  /* ------------------------------------------------------------- capture -- */
  get captureBlocked() {
    return this.blockers.size > 0;
  }

  block(reason) {
    if (this.blockers.has(reason)) return;
    this.blockers.add(reason);
    this.releaseAll(`block:${reason}`);
    this.#emit({ type: 'capture', blocked: true, reason });
  }

  unblock(reason) {
    if (!this.blockers.delete(reason)) return;
    this.#emit({ type: 'capture', blocked: this.captureBlocked, reason });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit(event) {
    for (const listener of this.listeners) {
      try { listener(event); } catch (_) { /* a UI listener must not break input */ }
    }
  }

  /* --------------------------------------------------------------- holds -- */
  isHeld(code) {
    const set = this.holds.get(code);
    return !!(set && set.size);
  }

  heldCodes() {
    return Array.from(this.holds.keys());
  }

  sourcesOf(code) {
    const set = this.holds.get(code);
    return set ? Array.from(set) : [];
  }

  press(code, sourceId = 'manual') {
    if (!code) return false;
    if (this.captureBlocked) {
      this.stats.blockedPresses += 1;
      return false;
    }
    let set = this.holds.get(code);
    if (!set) {
      set = new Set();
      this.holds.set(code, set);
      this.#trackSource(sourceId, code);
      set.add(sourceId);
      this.stats.downs += 1;
      this.send(code, true);
      this.#emit({ type: 'hold', code, down: true, sources: Array.from(set) });
      return true;
    }
    if (set.has(sourceId)) return false;
    set.add(sourceId);
    this.#trackSource(sourceId, code);
    this.#emit({ type: 'hold', code, down: true, sources: Array.from(set) });
    return false; // no new keydown: the key was already down
  }

  release(code, sourceId = 'manual') {
    const set = this.holds.get(code);
    if (!set) return false;
    if (!set.delete(sourceId)) return false;
    this.#untrackSource(sourceId, code);
    if (set.size === 0) {
      this.holds.delete(code);
      this.stats.ups += 1;
      this.send(code, false);
      this.#emit({ type: 'hold', code, down: false, sources: [] });
    } else {
      this.#emit({ type: 'hold', code, down: true, sources: Array.from(set) });
    }
    return true;
  }

  /** Release everything one source holds (a lifted finger, a lost pointer). */
  releaseSource(sourceId) {
    const codes = this.sources.get(sourceId);
    if (!codes) return 0;
    let count = 0;
    for (const code of Array.from(codes)) {
      if (this.release(code, sourceId)) count += 1;
    }
    this.sources.delete(sourceId);
    return count;
  }

  /** Hard reset: used on blur, on tab hide, before a modal and before a stop. */
  releaseAll(reason = 'all') {
    let count = 0;
    for (const [code, set] of Array.from(this.holds.entries())) {
      for (const sourceId of Array.from(set)) {
        set.delete(sourceId);
        this.#untrackSource(sourceId, code);
      }
      this.holds.delete(code);
      this.stats.ups += 1;
      count += 1;
      this.send(code, false);
      this.#emit({ type: 'hold', code, down: false, sources: [] });
    }
    this.sources.clear();
    this.clearQueue();
    if (count) this.#emit({ type: 'release-all', reason, count });
    return count;
  }

  #trackSource(sourceId, code) {
    let set = this.sources.get(sourceId);
    if (!set) { set = new Set(); this.sources.set(sourceId, set); }
    set.add(code);
  }

  #untrackSource(sourceId, code) {
    const set = this.sources.get(sourceId);
    if (!set) return;
    set.delete(code);
    if (!set.size) this.sources.delete(sourceId);
  }

  /** A one-shot keystroke with its own source id. */
  tap(code, holdMs = this.tapHoldMs) {
    if (!code) return false;
    const id = `tap:${++this.seq}`;
    const started = this.press(code, id);
    this.timers.setTimeout(() => this.release(code, id), holdMs);
    return started;
  }

  /* ---------------------------------------------------- typed characters -- */
  /** Queue DOS keys and type them one by one (duplicates included). */
  typeCodes(codes) {
    if (!codes || !codes.length) return 0;
    const valid = codes.filter(Boolean);
    this.queue.push(...valid);
    this.stats.queued += valid.length;
    this.#pump();
    return valid.length;
  }

  #pump() {
    if (this.queueRunning || this.disposed) return;
    if (this.captureBlocked) { this.queue = []; return; }
    const code = this.queue.shift();
    if (!code) return;
    this.queueRunning = true;
    const id = `type:${++this.seq}`;
    this.press(code, id);
    this.timers.setTimeout(() => {
      this.release(code, id);
      this.queueTimer = this.timers.setTimeout(() => {
        this.queueRunning = false;
        this.#pump();
      }, this.gapMs);
    }, this.tapHoldMs);
  }

  get pendingChars() {
    return this.queue.length + (this.queueRunning ? 1 : 0);
  }

  clearQueue() {
    this.queue = [];
    this.queueRunning = false;
    if (this.queueTimer) {
      this.timers.clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }
  }

  dispose() {
    this.disposed = true;
    this.clearQueue();
    this.releaseAll('dispose');
    this.listeners.clear();
  }
}
