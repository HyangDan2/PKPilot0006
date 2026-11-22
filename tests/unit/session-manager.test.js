import { describe, expect, it } from 'vitest';
import { SessionManager } from '../../src/core/session-manager.js';
import { makeRuntime } from './helpers.js';

function target(id, extra = {}) {
  return { id, name: id.toUpperCase(), url: `https://example.test/${id}.jsdos`, ...extra };
}

function makeSession({ result = 'running', historyLimit = 60 } = {}) {
  const events = [];
  const order = [];
  const runtimes = [];
  const session = new SessionManager({
    createRuntime: ({ generation }) => {
      const runtime = makeRuntime({ id: generation, result, log: order });
      runtimes.push(runtime);
      return runtime;
    },
    onEvent: (event) => events.push(event),
    onBeforeStop: ({ reason }) => order.push(`before-stop:${reason}`),
    onAfterStop: ({ reason }) => order.push(`after-stop:${reason}`),
    historyLimit,
    now: (() => { let t = 0; return () => (t += 1); })(),
  });
  return { session, events, order, runtimes };
}

describe('SessionManager boot', () => {
  it('runs a game and records the session', async () => {
    const { session, events, runtimes } = makeSession();
    const outcome = await session.boot(target('digger'));
    expect(outcome).toMatchObject({ ok: true, generation: 1 });
    expect(session.state).toBe('running');
    expect(session.currentId).toBe('digger');
    expect(runtimes[0].state).toBe('running');
    expect(events.map((event) => event.type)).toContain('running');
    expect(session.history.at(-1)).toMatchObject({ targetId: 'digger', state: 'running' });
  });

  it('tears the previous execution down before the new one starts', async () => {
    const { session, order, runtimes } = makeSession();
    await session.boot(target('digger'));
    await session.boot(target('doom'));
    expect(order.slice(0, 3)).toEqual([
      'start:1:https://example.test/digger.jsdos',
      'running:1',
      'before-stop:replaced',
    ]);
    expect(order).toContain('stop:1:replaced');
    expect(order.indexOf('stop:1:replaced')).toBeLessThan(order.indexOf('start:2:https://example.test/doom.jsdos'));
    expect(runtimes[0].stopCount).toBe(1);
    expect(session.state).toBe('running');
    expect(session.currentId).toBe('doom');
  });

  it('reports a boot failure, stops the runtime and offers a clean state', async () => {
    const { session, events, runtimes } = makeSession({ result: 'error' });
    const outcome = await session.boot(target('doom'));
    expect(outcome.ok).toBe(false);
    expect(outcome.error.code).toBe('boot-timeout');
    expect(session.state).toBe('error');
    expect(runtimes[0].stopCount).toBe(1);
    expect(events.map((event) => event.type)).toContain('error');
    expect(session.history.at(-1).state).toBe('error');
  });

  it('rejects a boot request without a bundle', async () => {
    const { session } = makeSession();
    const outcome = await session.boot(null);
    expect(outcome.ok).toBe(false);
    expect(outcome.error.code).toBe('no-target');
    expect(session.state).toBe('idle');
  });

  it('lets the newest request win when another game is picked mid-boot', async () => {
    const events = [];
    const order = [];
    const session = new SessionManager({
      createRuntime: ({ generation }) => {
        const runtime = makeRuntime({ id: generation, log: order });
        runtime.onStart = () => new Promise((resolve) => { runtime.release = resolve; });
        return runtime;
      },
      onEvent: (event) => events.push(event),
      onBeforeStop: ({ reason }) => order.push(`before-stop:${reason}`),
      onAfterStop: ({ reason }) => order.push(`after-stop:${reason}`),
    });

    const first = session.boot(target('digger'));
    await new Promise((resolve) => setImmediate(resolve));
    // the first boot is waiting for ci-ready when the second game is picked
    const second = session.boot(target('doom'));
    await new Promise((resolve) => setImmediate(resolve));
    const outcome1 = await first;
    expect(outcome1).toMatchObject({ ok: false, stale: true });

    const runtimes = session.snapshot();
    expect(runtimes.generation).toBe(2);
    // free the second runtime
    const active = session.runtime;
    active.release();
    const outcome2 = await second;
    expect(outcome2).toMatchObject({ ok: true, generation: 2 });
    expect(session.currentId).toBe('doom');
    // the first runtime was torn down when the second request arrived
    expect(order).toContain('stop:1:replaced');
    expect(order).not.toContain('stop:1:superseded'); // it was already stopped
  });

  it('survives 30 game switches with no leaked runtimes', async () => {
    const { session, runtimes, order } = makeSession({ historyLimit: 12 });
    const ids = ['digger', 'doom', 'dhrystone'];
    for (let i = 0; i < 30; i += 1) {
      const outcome = await session.boot(target(ids[i % ids.length]));
      expect(outcome.ok).toBe(true);
    }
    expect(runtimes).toHaveLength(30);
    expect(runtimes.filter((runtime) => runtime.state === 'running')).toHaveLength(1);
    expect(runtimes.slice(0, 29).every((runtime) => runtime.stopCount === 1)).toBe(true);
    expect(runtimes.at(-1).stopCount).toBe(0);
    expect(session.runtime).toBe(runtimes.at(-1));
    expect(session.snapshot().disposals).toBe(29);
    expect(order.filter((entry) => entry.startsWith('before-stop')).length).toBe(29);
    expect(order.filter((entry) => entry.startsWith('after-stop')).length).toBe(29);
    // the history ring buffer stays bounded
    expect(session.history.length).toBeLessThanOrEqual(12);
  });

  it('stop() invalidates a boot that is still in flight', async () => {
    let release;
    const session = new SessionManager({
      createRuntime: ({ generation }) => {
        const runtime = makeRuntime({ id: generation });
        runtime.onStart = () => new Promise((resolve) => { release = resolve; });
        return runtime;
      },
      onEvent: () => {},
    });
    const pending = session.boot(target('digger'));
    await session.stop('cancel');
    if (release) release();
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    expect(outcome.stale).toBe(true);
    expect(session.state).toBe('idle');
  });

  it('forwards volume to the running runtime only', async () => {
    const { session, runtimes } = makeSession();
    expect(session.setVolume(0.5)).toBe(0.5); // idle: value remembered by the caller
    await session.boot(target('digger'));
    session.setVolume(0);
    expect(runtimes[0].volume).toBe(0);
  });
});
