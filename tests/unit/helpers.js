/* Shared fakes for the unit suite: a manual clock, a minimal document and a
   runtime double. No jsdom — the modules under test take their environment by
   injection, and if they did not, a test that needed jsdom would be telling us
   the module is not testable. */

export function makeClock() {
  let now = 0;
  let seq = 0;
  const tasks = new Map();

  const api = {
    now: () => now,
    setTimeout(fn, ms = 0) {
      const id = ++seq;
      tasks.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    async advance(ms) {
      // let already-queued microtasks schedule their first timers
      await Promise.resolve();
      await Promise.resolve();
      const target = now + ms;
      for (let guard = 0; guard < 100000; guard += 1) {
        let nextId = null;
        let next = null;
        for (const [id, task] of tasks) {
          if (task.at > target) continue;
          if (!next || task.at < next.at) { next = task; nextId = id; }
        }
        if (!next) break;
        tasks.delete(nextId);
        now = next.at;
        next.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = target;
      await Promise.resolve();
    },
    get pending() {
      return tasks.size;
    },
  };
  return api;
}

function fakeElement(tagName) {
  const el = {
    tagName: tagName.toUpperCase(),
    dataset: {},
    attrs: {},
    children: [],
    listeners: new Map(),
    parentNode: null,
    isConnected: false,
    addEventListener(type, fn) {
      if (!el.listeners.has(type)) el.listeners.set(type, new Set());
      el.listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = el.listeners.get(type);
      if (set) set.delete(fn);
    },
    setAttribute(name, value) {
      el.attrs[name] = String(value);
      if (name === 'src') el.srcValue = String(value);
    },
    getAttribute(name) {
      return el.attrs[name] ?? null;
    },
    remove() {
      if (el.parentNode) el.parentNode.removeChild(el);
    },
    fire(type, event = {}) {
      const set = el.listeners.get(type);
      if (!set) return;
      for (const fn of Array.from(set)) fn(event);
    },
  };
  Object.defineProperty(el, 'src', {
    get: () => el.attrs.src || '',
    set: (value) => { el.attrs.src = String(value); },
  });
  Object.defineProperty(el, 'type', {
    get: () => el.attrs.type || '',
    set: (value) => { el.attrs.type = String(value); },
  });
  return el;
}

export function makeDocument() {
  const head = fakeElement('head');
  head.appendChild = (node) => {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = head;
    node.isConnected = true;
    head.children.push(node);
    return node;
  };
  head.removeChild = (node) => {
    head.children = head.children.filter((child) => child !== node);
    node.parentNode = null;
    node.isConnected = false;
    return node;
  };

  const doc = {
    head,
    createElement: (tag) => fakeElement(tag),
    querySelector(selector) {
      if (selector === 'script[data-jsdos-js]') {
        return head.children.find((child) => child.tagName === 'SCRIPT' && child.dataset.jsdosJs) || null;
      }
      if (selector === 'link[data-jsdos-css]') {
        return head.children.find((child) => child.tagName === 'LINK' && child.dataset.jsdosCss) || null;
      }
      return null;
    },
    scripts() {
      return head.children.filter((child) => child.tagName === 'SCRIPT');
    },
  };
  return doc;
}

/** A runtime double that records the order of every lifecycle call. */
export function makeRuntime({ id = 0, result = 'running', delays = false, log = [] } = {}) {
  const runtime = {
    id,
    state: 'idle',
    ci: { sendKeyEvent: () => {} },
    startedAt: 0,
    readyAt: 0,
    onProgress: null,
    bootCount: 0,
    stopCount: 0,
    volume: 1,
    async start({ url } = {}) {
      runtime.bootCount += 1;
      log.push(`start:${id}:${url}`);
      runtime.state = 'booting';
      if (typeof runtime.onStart === 'function') await runtime.onStart();
      if (runtime.state === 'stopped') {
        const cancelled = new Error('cancelled');
        cancelled.code = 'cancelled';
        throw cancelled;
      }
      if (result === 'error') {
        runtime.state = 'failed';
        const error = new Error('stub boot failure');
        error.code = 'boot-timeout';
        throw error;
      }
      runtime.state = 'running';
      runtime.readyAt = 10;
      log.push(`running:${id}`);
      return runtime;
    },
    async stop(reason = 'stop') {
      runtime.stopCount += 1;
      log.push(`stop:${id}:${reason}`);
      runtime.state = 'stopped';
      if (typeof runtime.release === 'function') runtime.release();
      return { already: false, reason };
    },
    setVolume(value) {
      runtime.volume = value;
      return value;
    },
  };
  if (delays) {
    runtime.onStart = () => new Promise((resolve) => { runtime.release = resolve; });
  }
  return runtime;
}
