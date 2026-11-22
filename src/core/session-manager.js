/* ==========================================================================
   HD2Lab | DOS Player — session manager
   Owns *which* execution is current and gives every boot request a generation
   id. A request that finishes late (its bundle finally arrived, its canvas
   finally appeared) can only touch the UI if its generation is still the newest
   one; otherwise its runtime is stopped and its result thrown away.

   Policy for “another game while booting”: newest request wins. The older
   runtime is stopped in order (input released → instance stopped → resources
   released) before the new one is created.
   ========================================================================== */

import { CONFIG } from '../config.js';
import { RuntimeError } from './dos-runtime.js';

export class SessionManager {
  constructor({
    createRuntime,
    onEvent = () => {},
    onBeforeStop = () => {},
    onAfterStop = () => {},
    historyLimit = CONFIG.sessionHistory,
    now = () => Date.now(),
  } = {}) {
    this.createRuntime = createRuntime;
    this.onEvent = onEvent;
    this.onBeforeStop = onBeforeStop;
    this.onAfterStop = onAfterStop;
    this.historyLimit = historyLimit;
    this.now = now;

    this.generation = 0;
    this.state = 'idle'; // idle | booting | running | error
    this.runtime = null;
    this.target = null;
    this.error = null;
    this.history = [];
    this.boots = 0;
    this.disposals = 0;
    this.busy = null;
  }

  get running() {
    return this.state === 'running';
  }

  get currentId() {
    return this.target ? this.target.id : null;
  }

  #emit(type, payload = {}) {
    try {
      this.onEvent({
        type,
        state: this.state,
        generation: this.generation,
        target: this.target,
        ...payload,
      });
    } catch (_) { /* a UI listener must not break session flow */ }
  }

  #record(entry) {
    this.history.push({ at: this.now(), ...entry });
    if (this.history.length > this.historyLimit) this.history.shift();
  }

  /**
   * Start `target`. Resolves with an outcome object; it never throws, so the UI
   * can render success, error and “superseded” the same way.
   * @returns {Promise<{ok: boolean, generation: number, stale?: boolean, error?: Error}>}
   */
  async boot(target) {
    if (!target || typeof target !== 'object' || !target.url) {
      const error = new RuntimeError('실행할 번들이 없습니다.', 'no-target');
      this.#emit('error', { error });
      return { ok: false, generation: this.generation, error };
    }

    const generation = ++this.generation;
    this.boots += 1;
    this.#emit('request', { generation, target });
    this.#record({ generation, targetId: target.id, name: target.name, state: 'requested' });

    // newest wins: the previous execution is fully torn down first
    await this.#dispose('replaced');
    if (generation !== this.generation) {
      this.#record({ generation, targetId: target.id, name: target.name, state: 'superseded' });
      return { ok: false, generation, stale: true };
    }

    this.target = target;
    this.error = null;
    this.state = 'booting';
    this.#emit('booting', { generation, target });

    const startedAt = this.now();
    const runtime = this.createRuntime({ generation, target });
    this.runtime = runtime;
    runtime.onProgress = (progress) => {
      if (generation !== this.generation) return;
      this.#emit('progress', { generation, progress });
    };

    try {
      await runtime.start({ url: target.url });
    } catch (error) {
      if (generation !== this.generation || (error && error.code === 'cancelled')) {
        await this.#safeStop(runtime, 'superseded');
        this.#record({ generation, targetId: target.id, name: target.name, state: 'superseded', reason: error && error.code });
        return { ok: false, generation, stale: true, error };
      }
      this.state = 'error';
      this.error = error;
      this.#record({
        generation,
        targetId: target.id,
        name: target.name,
        state: 'error',
        error: error && error.message,
        code: error && error.code,
        bootMs: this.now() - startedAt,
      });
      this.#emit('error', { generation, target, error });
      await this.#dispose('boot-failed');
      return { ok: false, generation, error };
    }

    if (generation !== this.generation) {
      await this.#safeStop(runtime, 'superseded');
      this.#record({ generation, targetId: target.id, name: target.name, state: 'superseded' });
      return { ok: false, generation, stale: true };
    }
    if (runtime.state !== 'running') {
      const error = new RuntimeError('DOSBox가 실행 상태에 이르지 않았습니다.', 'not-running');
      this.state = 'error';
      this.error = error;
      this.#emit('error', { generation, target, error });
      await this.#dispose('not-running');
      return { ok: false, generation, error };
    }

    this.state = 'running';
    this.error = null;
    this.#record({
      generation,
      targetId: target.id,
      name: target.name,
      state: 'running',
      bootMs: runtime.readyAt && runtime.startedAt ? runtime.readyAt - runtime.startedAt : this.now() - startedAt,
    });
    this.#emit('running', { generation, target, runtime });
    return { ok: true, generation };
  }

  async #safeStop(runtime, reason) {
    if (!runtime || runtime.state === 'stopped') return null;
    try { return await runtime.stop(reason); } catch (_) { return null; }
  }

  /** Stop and release the current execution. Never throws. */
  async #dispose(reason) {
    const runtime = this.runtime;
    if (!runtime) return null;
    this.runtime = null;
    this.disposals += 1;
    try { this.onBeforeStop({ reason, target: this.target, runtime }); } catch (_) { /* keep tearing down */ }
    const result = await this.#safeStop(runtime, reason);
    try { this.onAfterStop({ reason, target: this.target, runtime }); } catch (_) { /* keep going */ }
    this.#emit('disposed', { reason, generation: runtime.generation });
    return result;
  }

  /** A user-facing stop (close / unmount). Invalidates pending boots. */
  async stop(reason = 'manual') {
    this.generation += 1;
    const target = this.target;
    await this.#dispose(reason);
    this.state = 'idle';
    this.target = null;
    if (target) this.#record({ generation: this.generation, targetId: target.id, name: target.name, state: 'stopped', reason });
    this.#emit('idle', { reason });
    return { ok: true };
  }

  setVolume(value) {
    if (this.runtime) return this.runtime.setVolume(value);
    return value;
  }

  /** Diagnostics for the debug surface and the E2E suite. */
  snapshot() {
    return {
      generation: this.generation,
      state: this.state,
      currentId: this.currentId,
      boots: this.boots,
      disposals: this.disposals,
      runtime: this.runtime
        ? { generation: this.runtime.generation, state: this.runtime.state, durationMs: this.runtime.durationMs }
        : null,
      history: this.history.slice(-12),
    };
  }

  async destroy() {
    await this.stop('destroy');
  }
}
