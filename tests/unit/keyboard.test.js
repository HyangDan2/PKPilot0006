import { describe, expect, it } from 'vitest';
import { KeyboardInput } from '../../src/input/keyboard.js';
import { InputManager } from '../../src/input/input-manager.js';

/* A tiny DOM: a node knows which selectors it answers to, and closest() walks
   up the parent chain. Enough to prove the capture policy without jsdom. */
function node(tokens = [], parent = null) {
  const el = {
    tokens,
    parentNode: parent,
    closest(selector) {
      const wanted = selector.split(',').map((part) => part.trim());
      let current = el;
      while (current) {
        if (current.tokens && current.tokens.some((token) => wanted.includes(token))) return current;
        current = current.parentNode;
      }
      return null;
    },
  };
  return el;
}

const STORE = {
  resolvePhysical(code) {
    if (code === 'KeyJ' || code === 'KeyZ') return { actionId: 'fire', slot: 0, send: 'ControlLeft' };
    if (code === 'ArrowUp') return { actionId: 'forward', slot: 1, send: 'ArrowUp' };
    if (code === 'Space') return { actionId: 'use', slot: 2, send: 'Space' };
    if (code === 'Enter') return { actionId: 'enter', slot: 2, send: 'Enter' };
    if (code === 'KeyW') return { actionId: 'forward', slot: 0, send: 'forward' };
    return null;
  },
};

function makeKeyboard({ capturing = true, wasd = true } = {}) {
  const sent = [];
  const manager = new InputManager({ send: (code, down) => sent.push([code, down]), tapHoldMs: 1, gapMs: 1 });
  let running = capturing;
  const keyboard = new KeyboardInput({
    manager,
    store: STORE,
    getProfile: () => 'arrows',
    isWasdEnabled: () => wasd,
    isCapturing: () => running,
  });
  return { keyboard, manager, sent, setRunning: (value) => { running = value; } };
}

function key(type, code, target, extra = {}) {
  const event = {
    type,
    code,
    key: code,
    target,
    cancelable: true,
    defaultPrevented: false,
    repeat: false,
    preventDefault() { event.defaultPrevented = true; },
    stopPropagation() {},
    ...extra,
  };
  return event;
}

describe('KeyboardInput source ids', () => {
  it('gives every physical key its own source id', () => {
    const { keyboard, manager } = makeKeyboard();
    const body = node();
    keyboard.onDown(key('keydown', 'KeyJ', body));
    keyboard.onDown(key('keydown', 'KeyZ', body));
    expect(manager.sourcesOf('ControlLeft').sort()).toEqual(['kbd:KeyJ', 'kbd:KeyZ']);

    keyboard.onUp(key('keyup', 'KeyJ', body));
    expect(manager.isHeld('ControlLeft')).toBe(true); // Z still holds it
    keyboard.onUp(key('keyup', 'KeyZ', body));
    expect(manager.isHeld('ControlLeft')).toBe(false);
  });

  it('lifts its own key even when the keyup lands in a text field', () => {
    const { keyboard, manager } = makeKeyboard();
    const body = node();
    const field = node(['input']);
    keyboard.onDown(key('keydown', 'KeyJ', body));
    const up = key('keyup', 'KeyJ', field);
    expect(keyboard.onUp(up)).toBe(true);
    expect(manager.isHeld('ControlLeft')).toBe(false);
  });

  it('does not swallow a keyup it never pressed', () => {
    const { keyboard } = makeKeyboard();
    const field = node(['input']);
    const up = key('keyup', 'KeyJ', field);
    expect(keyboard.onUp(up)).toBe(false);
    expect(up.defaultPrevented).toBe(false);
  });
});

describe('KeyboardInput capture policy', () => {
  it('never touches the keyboard before a game runs', () => {
    const { keyboard, sent, setRunning } = makeKeyboard({ capturing: false });
    const body = node();
    for (const code of ['Space', 'ArrowUp', 'KeyJ', 'Enter']) {
      const event = key('keydown', code, body);
      expect(keyboard.onDown(event)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(sent).toEqual([]);
    setRunning(true);
  });

  it('captures game keys while a game runs', () => {
    const { keyboard, sent } = makeKeyboard();
    const event = key('keydown', 'ArrowUp', node());
    expect(keyboard.onDown(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(sent).toEqual([['ArrowUp', true]]);
  });

  it('lets a focused button keep Space and Enter, but not the game keys', () => {
    const { keyboard, sent } = makeKeyboard();
    const controls = node(['.control-bar']);
    const button = node(['button'], controls);

    const space = key('keydown', 'Space', button);
    expect(keyboard.onDown(space)).toBe(false);
    expect(space.defaultPrevented).toBe(false);

    const enter = key('keydown', 'Enter', button);
    expect(keyboard.onDown(enter)).toBe(false);

    const arrow = key('keydown', 'ArrowUp', button);
    expect(keyboard.onDown(arrow)).toBe(true); // movement still reaches DOS
    expect(sent).toEqual([['ArrowUp', true]]);
  });

  it('lets a text field, a dialog and a menu own every key', () => {
    const { keyboard, sent } = makeKeyboard();
    const field = node(['input']);
    const dialog = node(['dialog']);
    const menu = node(['[role="menu"]']);
    for (const target of [field, dialog, menu]) {
      const event = key('keydown', 'ArrowUp', target);
      expect(keyboard.onDown(event)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(sent).toEqual([]);
  });

  it('stays quiet while the capture gate is closed', () => {
    const { keyboard, manager, sent } = makeKeyboard();
    manager.block('settings');
    const event = key('keydown', 'ArrowUp', node());
    expect(keyboard.onDown(event)).toBe(false);
    expect(sent).toEqual([]);
    expect(manager.stats.blockedPresses).toBe(0); // nothing even reached the manager
  });

  it('keeps a control’s key away from the emulator listener but not from the page', () => {
    const { keyboard } = makeKeyboard();
    const button = node(['button']);
    let stopped = false;
    const event = key('keydown', 'Space', button, { stopPropagation: () => { stopped = true; } });
    expect(keyboard.onDown(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false); // the button still activates
    expect(stopped).toBe(true);                 // js-dos never sees it
  });

  it('ignores auto-repeat for a held key', () => {
    const { keyboard, sent } = makeKeyboard();
    const body = node();
    keyboard.onDown(key('keydown', 'ArrowUp', body));
    const repeated = key('keydown', 'ArrowUp', body, { repeat: true });
    expect(keyboard.onDown(repeated)).toBe(false);
    expect(sent).toEqual([['ArrowUp', true]]);
  });
});
