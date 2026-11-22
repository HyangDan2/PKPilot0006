import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  KBD,
  KeymapStore,
  buildKeyIndex,
  canSend,
  codeForChar,
  codesForText,
  defaultKeymap,
  keyLabel,
  normalizeKeymap,
  padCodesFor,
  resolveSlot,
} from '../../src/input/keymap.js';

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

describe('key map data', () => {
  it('binds every action by default and every default key is sendable', () => {
    const map = defaultKeymap();
    expect(Object.keys(map).sort()).toEqual(ACTIONS.map((action) => action.id).sort());
    for (const codes of Object.values(map)) {
      for (const code of codes) expect(canSend(code), code).toBe(true);
    }
  });

  it('builds one index entry per physical key with its action and send value', () => {
    const index = buildKeyIndex(defaultKeymap());
    expect(index.KeyJ).toMatchObject({ actionId: 'fire', send: 'ControlLeft' });
    expect(index.ArrowUp).toMatchObject({ actionId: 'forward', send: 'ArrowUp' });
    expect(index.ControlLeft).toMatchObject({ actionId: 'fire', slot: 2 });
  });

  it('repairs garbage instead of trusting it', () => {
    const saved = {
      forward: ['Nope', 'ArrowUp'],
      back: 'not-an-array',
      fire: ['KeyW', 'KeyW', 'KeyW'], // duplicates of a movement key
      unknown: ['KeyQ'],
    };
    const map = normalizeKeymap(saved);
    expect(map.forward[0]).toBe('KeyW'); // falls back to the default
    expect(map.back).toEqual(defaultKeymap().back);
    // duplicates are dropped rather than firing two DOS keys from one press
    const bound = map.fire.filter(Boolean);
    expect(new Set(bound).size).toBe(bound.length);
    expect(map.unknown).toBeUndefined();
    // forward claimed KeyW first, so fire's duplicate W slots are unbound
    expect(bound).not.toContain('KeyW');
    const everyKey = Object.values(map).flat().filter(Boolean);
    expect(new Set(everyKey).size).toBe(everyKey.length);
  });

  it('resolves movement tokens through the running game profile', () => {
    expect(resolveSlot('forward', 'doom')).toBe('KeyW');
    expect(resolveSlot('forward', 'arrows')).toBe('ArrowUp');
    expect(resolveSlot('left', 'doom')).toBe('KeyA');
    expect(resolveSlot('ControlLeft', 'doom')).toBe('ControlLeft');
    expect(resolveSlot(null, 'doom')).toBe(null);
  });

  it('maps d-pad directions to both keys DOOM listens for', () => {
    expect(padCodesFor('ArrowUp', 'doom')).toEqual(['KeyW', 'ArrowUp']);
    expect(padCodesFor('ArrowUp', 'arrows')).toEqual(['ArrowUp']);
    expect(padCodesFor('ControlLeft', 'doom')).toEqual(['ControlLeft']);
    expect(padCodesFor(undefined, 'doom')).toEqual([]);
  });

  it('labels keys for the settings dialog', () => {
    expect(keyLabel('KeyQ')).toBe('Q');
    expect(keyLabel('Digit7')).toBe('7');
    expect(keyLabel('Numpad3')).toBe('Num 3');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel(null)).toBe('미설정');
  });

  it('turns typed text into DOS keys', () => {
    expect(codeForChar('q')).toBe('KeyQ');
    expect(codeForChar('Q')).toBe('KeyQ');
    expect(codeForChar('5')).toBe('Digit5');
    expect(codeForChar(' ')).toBe('Space');
    expect(codeForChar('!')).toBe(null);
    expect(codesForText('doom\n')).toEqual(['KeyD', 'KeyO', 'KeyO', 'KeyM', 'Enter']);
  });

  it('keeps the KBD table free of obvious gaps', () => {
    for (const code of ['KeyA', 'Digit1', 'F12', 'Numpad9', 'ArrowDown', 'Space', 'Escape']) {
      expect(KBD[code], code).toBeTypeOf('number');
    }
  });
});

describe('KeymapStore', () => {
  it('persists assignments and reloads them', () => {
    const storage = memoryStorage();
    const store = new KeymapStore({ storage });
    store.assign('fire', 0, 'KeyQ');
    const reloaded = new KeymapStore({ storage });
    expect(reloaded.codes('fire')[0]).toBe('KeyQ');
    expect(reloaded.index.KeyQ).toMatchObject({ actionId: 'fire', send: 'ControlLeft' });
  });

  it('swaps instead of duplicating a key that another action owns', () => {
    const store = new KeymapStore({ storage: memoryStorage() });
    const before = store.codes('back')[0]; // KeyS
    const result = store.assign('fire', 0, 'KeyS');
    expect(result.ok).toBe(true);
    expect(result.swapped).toEqual({ actionId: 'back', slot: 0 });
    expect(store.codes('fire')[0]).toBe('KeyS');
    expect(store.codes('back')[0]).toBe('KeyJ'); // the old fire key, not a duplicate
    expect(before).toBe('KeyS');
    const owners = Object.values(store.map).flat().filter((code) => code === 'KeyS');
    expect(owners).toHaveLength(1);
  });

  it('refuses keys that cannot be sent to DOS', () => {
    const store = new KeymapStore({ storage: memoryStorage() });
    const result = store.assign('fire', 0, 'MetaLeft');
    expect(result).toMatchObject({ ok: false, reason: 'unsendable' });
    expect(store.codes('fire')[0]).toBe('KeyJ');
  });

  it('releases a slot and stops resolving that physical key', () => {
    const store = new KeymapStore({ storage: memoryStorage() });
    const result = store.clear('fire', 1);
    expect(result.ok).toBe(true);
    expect(store.codes('fire')[1]).toBe(null);
    expect(store.resolvePhysical('KeyZ')).toBe(null);
    // the same DOS key is still reachable through the other slots
    expect(store.resolvePhysical('KeyJ')).toMatchObject({ actionId: 'fire' });
  });

  it('resets one action without stealing another action’s keys', () => {
    const store = new KeymapStore({ storage: memoryStorage() });
    store.assign('forward', 0, 'KeyI');
    store.assign('fire', 0, 'KeyW'); // takes W, forward keeps ArrowUp
    expect(store.codes('forward')[0]).toBe('KeyI');
    store.resetAction('forward');
    expect(store.codes('forward')[0]).toBe('KeyW');
    // W now belongs to forward, so fire's first slot was cleared, not duplicated
    expect(store.codes('fire')[0]).toBe(null);
    const all = Object.values(store.map).flat().filter(Boolean);
    expect(new Set(all).size).toBe(all.length);
  });

  it('resets everything to the shipped defaults', () => {
    const storage = memoryStorage();
    const store = new KeymapStore({ storage });
    store.assign('fire', 0, 'KeyQ');
    store.clear('menu', 0);
    store.resetAll();
    expect(store.map).toEqual(defaultKeymap());
    expect(new KeymapStore({ storage }).map).toEqual(defaultKeymap());
  });

  it('survives a corrupted stored value', () => {
    const storage = memoryStorage({ 'pkpilot0006:keymap': '{not json' });
    const store = new KeymapStore({ storage });
    expect(store.map).toEqual(defaultKeymap());
  });
});
