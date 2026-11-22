import { describe, expect, it } from 'vitest';
import { ENGINE_SOURCES, EngineLoader, JSDOS_VERSION } from '../../src/core/engine-loader.js';
import { makeClock, makeDocument } from './helpers.js';

function makeLoader({ clock, timeoutMs = 20000, sources = ENGINE_SOURCES, global = {} } = {}) {
  const doc = makeDocument();
  const loader = new EngineLoader({
    doc,
    global,
    sources,
    timeoutMs,
    pollMs: 100,
    timers: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
  });
  return { loader, doc, global };
}

describe('EngineLoader', () => {
  it('pins one js-dos version for the script, the stylesheet and the wasm', () => {
    expect(JSDOS_VERSION).toBe('8.5.4');
    expect(ENGINE_SOURCES[0].js).toContain('js-dos@8.5.4');
    expect(ENGINE_SOURCES[0].emulators).toContain('js-dos@8.5.4');
    // only the last resort source may be the unversioned official CDN
    const fallback = ENGINE_SOURCES.at(-1);
    expect(fallback.id).toBe('jsdos-cdn');
    for (const source of ENGINE_SOURCES.slice(0, -1)) {
      expect(source.js).not.toContain('/latest/');
      expect(source.emulators).not.toContain('/latest/');
    }
  });

  it('injects exactly one module script and becomes ready when window.Dos appears', async () => {
    const clock = makeClock();
    const { loader, doc, global } = makeLoader({ clock });
    const pending = loader.load();
    expect(doc.scripts()).toHaveLength(1);
    const script = doc.scripts()[0];
    expect(script.type).toBe('module');
    expect(script.src).toBe(ENGINE_SOURCES[0].js);

    global.Dos = () => {};
    script.fire('load');
    const status = await pending;
    expect(status.state).toBe('ready');
    expect(loader.ready).toBe(true);
  });

  it('shares one request between concurrent callers (no duplicate script)', async () => {
    const clock = makeClock();
    const { loader, doc, global } = makeLoader({ clock });
    const a = loader.load();
    const b = loader.load();
    expect(doc.scripts()).toHaveLength(1);
    global.Dos = () => {};
    doc.scripts()[0].fire('load');
    await Promise.all([a, b]);
    expect(loader.attempts).toBe(1);
    expect(doc.scripts()).toHaveLength(1);
  });

  it('remembers a script failure and does not re-spin on its own', async () => {
    const clock = makeClock();
    const { loader, doc } = makeLoader({ clock });
    const pending = loader.load();
    doc.scripts()[0].fire('error');
    await expect(pending).rejects.toMatchObject({ code: 'network' });
    expect(loader.state).toBe('failed');

    // a plain retry rejects immediately: no second script, no 30 s of polling
    await expect(loader.load()).rejects.toMatchObject({ code: 'network' });
    expect(loader.attempts).toBe(1);
    expect(doc.scripts()).toHaveLength(0);

    // and time alone does not resurrect it
    await clock.advance(60000);
    expect(loader.state).toBe('failed');
  });

  it('retries with a fresh node and the fallback source after a failure', async () => {
    const clock = makeClock();
    const { loader, doc, global } = makeLoader({ clock });
    const first = loader.load();
    doc.scripts()[0].fire('error');
    await expect(first).rejects.toBeTruthy();

    const second = loader.load({ force: true });
    const scripts = doc.scripts();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(ENGINE_SOURCES[1].js);
    expect(loader.status().source).toBe(ENGINE_SOURCES[1].id);

    global.Dos = () => {};
    scripts[0].fire('load');
    await second;
    expect(loader.state).toBe('ready');
  });

  it('fails with code timeout and still adopts a late window.Dos', async () => {
    const clock = makeClock();
    const { loader, global } = makeLoader({ clock, timeoutMs: 5000 });
    const pending = loader.load();
    await clock.advance(5001);
    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
    expect(loader.state).toBe('failed');

    // the script finally arrives after the deadline
    global.Dos = () => {};
    const status = await loader.load({ force: true });
    expect(status.state).toBe('ready');
    expect(loader.error).toBe(null);
  });

  it('adopts a script that another loader already put on the page', async () => {
    const clock = makeClock();
    const doc = makeDocument();
    const global = {};
    const timers = { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
    const a = new EngineLoader({ doc, global, timers, timeoutMs: 5000, pollMs: 100 });
    const b = new EngineLoader({ doc, global, timers, timeoutMs: 5000, pollMs: 100 });
    const first = a.load();
    const second = b.load();
    expect(doc.scripts()).toHaveLength(1);
    global.Dos = () => {};
    doc.scripts()[0].fire('load');
    await Promise.all([first, second]);
    expect(a.state).toBe('ready');
    expect(b.state).toBe('ready');
  });

  it('reset() forgets a failure without loading', async () => {
    const clock = makeClock();
    const { loader, doc } = makeLoader({ clock });
    const pending = loader.load();
    doc.scripts()[0].fire('error');
    await expect(pending).rejects.toBeTruthy();
    loader.reset();
    expect(loader.state).toBe('idle');
    expect(loader.error).toBe(null);
  });

  it('reports its source for the emulator wasm path', async () => {
    const clock = makeClock();
    const { loader } = makeLoader({ clock });
    loader.load().catch(() => { /* destroyed below */ });
    expect(loader.emulatorPrefix).toBe(ENGINE_SOURCES[0].emulators);
    loader.destroy();
    await clock.advance(30000);
    expect(clock.pending).toBe(0);
  });
});

describe('EngineLoader cancel', () => {
  it('rejects the pending load and removes the script node', async () => {
    const doc = makeDocument();
    const loader = new EngineLoader({ doc, global: {}, timeoutMs: 5000, pollMs: 20 });
    const pending = loader.load();
    expect(loader.state).toBe('loading');
    expect(doc.scripts()).toHaveLength(1);

    expect(loader.cancel('cancelled')).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(loader.state).toBe('failed');
    expect(doc.scripts()).toHaveLength(0);

    // a cancel of an idle loader is a no-op, not an error
    expect(loader.cancel()).toBe(false);
  });

  it('a retry after a cancel starts a fresh attempt', async () => {
    const doc = makeDocument();
    const global = {};
    const loader = new EngineLoader({ doc, global, timeoutMs: 5000, pollMs: 20 });
    const pending = loader.load().catch(() => null);
    loader.cancel();
    await pending;
    loader.reset();
    expect(loader.state).toBe('idle');

    const retry = loader.load();
    global.Dos = () => ({});
    doc.scripts()[0].fire('load');
    await expect(retry).resolves.toMatchObject({ state: 'ready' });
  });
});
