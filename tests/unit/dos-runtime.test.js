import { describe, expect, it } from 'vitest';
import { DosRuntime } from '../../src/core/dos-runtime.js';
import { makeClock } from './helpers.js';

function makeMount({ canvas = true } = {}) {
  const mount = {
    children: [],
    querySelector(selector) {
      if (selector !== 'canvas') return null;
      return mount.canvas || null;
    },
    appendChild(node) {
      node.parentNode = mount;
      mount.children.push(node);
      return node;
    },
    removeChild(node) {
      mount.children = mount.children.filter((child) => child !== node);
      node.parentNode = null;
      if (mount.canvas === node) mount.canvas = null;
      return node;
    },
    replaceChildren() {
      mount.children = [];
      mount.canvas = null;
    },
  };
  if (canvas) {
    mount.canvas = { width: 640, height: 400, parentNode: mount };
    mount.children.push(mount.canvas);
  }
  return mount;
}

function makeDos({ autoCi = true, ciDelay = null } = {}) {
  const calls = { boots: [], stops: 0, volume: [] };
  const runtimeHooks = {};
  const Dos = (target, options) => {
    calls.boots.push({ target, options });
    const props = {
      stop: async () => { calls.stops += 1; },
      setVolume: (value) => { calls.volume.push(value); },
    };
    if (autoCi && ciDelay === null) {
      options.onEvent('emu-ready');
      options.onEvent('ci-ready', { sendKeyEvent: () => {} });
    } else if (ciDelay !== null) {
      setTimeout(() => options.onEvent('ci-ready', { sendKeyEvent: () => {} }), ciDelay);
    }
    return props;
  };
  return { Dos, calls, runtimeHooks };
}

function makeRuntime({ Dos, mount, clock, ciTime = 1000, frameTime = 1000 }) {
  const runtime = new DosRuntime({
    generation: 7,
    mount,
    Dos,

    options: { pathPrefix: 'https://example.test/emulators/' },
    bootTimeoutMs: ciTime,
    frameTimeoutMs: frameTime,
    pollMs: 50,
    timers: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    now: () => clock.now(),
    requestFrame: (fn) => { fn(); },
  });
  return runtime;
}

describe('DosRuntime readiness', () => {
  it('needs the CommandInterface, not just a canvas', async () => {
    const clock = makeClock();
    const mount = makeMount();
    const { Dos } = makeDos({ autoCi: false });
    const runtime = makeRuntime({ Dos, mount, clock, ciTime: 500 });
    const pending = runtime.start({ url: 'https://example.test/a.jsdos' });
    await clock.advance(600);
    await expect(pending).rejects.toMatchObject({ code: 'boot-timeout' });
    expect(runtime.state).toBe('failed');
    expect(runtime.error.code).toBe('boot-timeout');
  });

  it('becomes running when ci-ready arrives and the canvas has painted', async () => {
    const clock = makeClock();
    const mount = makeMount();
    const { Dos, calls } = makeDos();
    const runtime = makeRuntime({ Dos, mount, clock });
    await runtime.start({ url: 'https://example.test/a.jsdos' });
    expect(runtime.state).toBe('running');
    expect(runtime.ci).toBeTruthy();
    expect(calls.boots).toHaveLength(1);
    expect(calls.boots[0].options.pathPrefix).toBe('https://example.test/emulators/');
    expect(calls.boots[0].options.onEvent).toBeTypeOf('function');
  });

  it('fails when the CommandInterface appears but no canvas is produced', async () => {
    const clock = makeClock();
    const mount = makeMount({ canvas: false });
    const { Dos } = makeDos();
    const runtime = makeRuntime({ Dos, mount, clock, frameTime: 400 });
    const pending = runtime.start({ url: 'https://example.test/a.jsdos' });
    await clock.advance(500);
    await expect(pending).rejects.toMatchObject({ code: 'canvas-timeout' });
  });

  it('fails clearly when js-dos hands back no instance', async () => {
    const clock = makeClock();
    const runtime = makeRuntime({ Dos: () => null, mount: makeMount(), clock });
    await expect(runtime.start({ url: 'x.jsdos' })).rejects.toMatchObject({ code: 'no-instance' });
    expect(runtime.state).toBe('failed');
  });

  it('applies the requested volume once running', async () => {
    const clock = makeClock();
    const { Dos, calls } = makeDos();
    const runtime = makeRuntime({ Dos, mount: makeMount(), clock });
    runtime.setVolume(0.3);
    expect(calls.volume).toEqual([]); // nothing to send before the instance exists
    await runtime.start({ url: 'x.jsdos' });
    expect(calls.volume).toContain(0.3);
  });
});

describe('DosRuntime teardown', () => {
  it('stops the instance once, empties the mount and drops late events', async () => {
    const clock = makeClock();
    const mount = makeMount();
    let onEvent = null;
    const Dos = (target, options) => {
      onEvent = options.onEvent;
      options.onEvent('ci-ready', { sendKeyEvent: () => {} });
      return { stop: async () => { Dos.stops += 1; }, setVolume: () => {} };
    };
    Dos.stops = 0;
    const runtime = makeRuntime({ Dos, mount, clock });
    await runtime.start({ url: 'x.jsdos' });
    const result = await runtime.stop('switch');
    expect(result.already).toBe(false);
    expect(Dos.stops).toBe(1);
    expect(mount.canvas).toBe(null);
    expect(clock.pending).toBe(0);

    const before = runtime.events.length;
    onEvent('ci-ready', { sendKeyEvent: () => {} }); // a stray event from the old game
    expect(runtime.ci).toBe(null);
    expect(runtime.events.length).toBe(before + 1);
    expect(runtime.events.at(-1).type).toBe('event-dropped');

    const again = await runtime.stop('switch');
    expect(again.already).toBe(true);
    expect(Dos.stops).toBe(1);
  });

  it('cancels a pending boot when stopped mid-flight', async () => {
    const clock = makeClock();
    const { Dos } = makeDos({ autoCi: false, ciDelay: 3000 });
    const runtime = makeRuntime({ Dos, mount: makeMount(), clock, ciTime: 10000 });
    const pending = runtime.start({ url: 'x.jsdos' });
    await clock.advance(100);
    await runtime.stop('cancel');
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(runtime.state).toBe('stopped');
    expect(clock.pending).toBe(0);
  });

  it('rejects a second start on the same runtime', async () => {
    const clock = makeClock();
    const { Dos } = makeDos();
    const runtime = makeRuntime({ Dos, mount: makeMount(), clock });
    await runtime.start({ url: 'x.jsdos' });
    await expect(runtime.start({ url: 'y.jsdos' })).rejects.toMatchObject({ code: 'state' });
  });
});

describe('DosRuntime teardown snapshot', () => {
  it('removes only the nodes it mounted, never a later generation’s canvas', async () => {
    const clock = makeClock();
    const mount = makeMount();
    const { Dos, calls } = makeDos();
    const first = makeRuntime({ Dos, mount, clock });
    await first.start({ url: 'a.jsdos' });
    const oldCanvas = mount.canvas;

    // the next generation mounts into the same stage before the stop resolves
    const newCanvas = { width: 320, height: 200, parentNode: null };
    mount.appendChild(newCanvas);
    await first.stop('replaced');

    expect(mount.children).toContain(newCanvas);
    expect(mount.children).not.toContain(oldCanvas);
    expect(calls.stops).toBe(1);
  });

  it('shares one teardown between concurrent stop calls', async () => {
    const clock = makeClock();
    const mount = makeMount();
    let stops = 0;
    const Dos = (target, options) => {
      options.onEvent('ci-ready', { sendKeyEvent: () => {} });
      return {
        stop: async () => { stops += 1; await new Promise((resolve) => setTimeout(resolve, 5)); },
        setVolume: () => {},
      };
    };
    const runtime = makeRuntime({ Dos, mount, clock });
    await runtime.start({ url: 'a.jsdos' });
    const [one, two] = await Promise.all([runtime.stop('one'), runtime.stop('two')]);
    expect(stops).toBe(1);
    expect(one.already).toBe(false);
    expect(two.already).toBe(true); // a second stop joins the first, never repeats it
  });
});
