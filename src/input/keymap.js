/* ==========================================================================
   HD2Lab | DOS Player — key map model
   Pure data + pure functions: no DOM, no storage side effects outside the
   injected storage object. Everything the keyboard, the touch pad and the
   settings dialog need to agree on lives here.

   Vocabulary
     physical key  a KeyboardEvent.code  (KeyW, ArrowUp, Numpad7 …)
     dos key       a js-dos KBD_ code    (87, 265, 341 …) sent to the emulator
     slot          one physical key a remappable action owns; an action can own
                   several slots (J / Z / Ctrl all fire)
   A slot is `null`/'' when the player unbound it.
   ========================================================================== */

import { STORAGE } from '../config.js';

/* js-dos v8 key codes — the `KBD_` object inside js-dos.js. sendKeyEvent takes
   these numbers. */
export const KBD = (() => {
  const table = {
    Escape: 256, Tab: 258, Backspace: 259, Enter: 257, Space: 32,
    CapsLock: 280, ScrollLock: 281, NumLock: 282, PrintScreen: 283, Pause: 284,
    Insert: 260, Delete: 261, Home: 268, End: 269, PageUp: 266, PageDown: 267,
    ArrowLeft: 263, ArrowUp: 265, ArrowRight: 262, ArrowDown: 264,
    ControlLeft: 341, ControlRight: 345, ShiftLeft: 340, ShiftRight: 344,
    AltLeft: 342, AltRight: 346,
    Backquote: 96, Minus: 45, Equal: 61, Backslash: 92,
    BracketLeft: 91, BracketRight: 93, Semicolon: 59, Quote: 39,
    Period: 46, Comma: 44, Slash: 47,
  };
  for (let i = 0; i < 26; i += 1) table[`Key${String.fromCharCode(65 + i)}`] = 65 + i;
  for (let i = 0; i < 10; i += 1) table[`Digit${i}`] = 48 + i;
  for (let i = 1; i <= 12; i += 1) table[`F${i}`] = 289 + i;
  for (let i = 0; i < 10; i += 1) table[`Numpad${i}`] = 320 + i;
  table.NumpadEnter = 335;
  table.NumpadDecimal = 330;
  table.NumpadDivide = 331;
  table.NumpadMultiply = 332;
  table.NumpadSubtract = 333;
  table.NumpadAdd = 334;
  return Object.freeze(table);
})();

/* The DOM fallback used only until the CommandInterface is live: js-dos' own
   window listener maps keyCode + location, so a plain synthetic KeyboardEvent
   reaches the emulator too. */
export const KEY_INFO = (() => {
  const table = {
    Escape: { key: 'Escape', keyCode: 27 },
    Tab: { key: 'Tab', keyCode: 9 },
    Backspace: { key: 'Backspace', keyCode: 8 },
    Enter: { key: 'Enter', keyCode: 13 },
    NumpadEnter: { key: 'Enter', keyCode: 13, location: 3 },
    Space: { key: ' ', keyCode: 32 },
    ArrowLeft: { key: 'ArrowLeft', keyCode: 37 },
    ArrowUp: { key: 'ArrowUp', keyCode: 38 },
    ArrowRight: { key: 'ArrowRight', keyCode: 39 },
    ArrowDown: { key: 'ArrowDown', keyCode: 40 },
    Insert: { key: 'Insert', keyCode: 45 },
    Delete: { key: 'Delete', keyCode: 46 },
    Home: { key: 'Home', keyCode: 36 },
    End: { key: 'End', keyCode: 35 },
    PageUp: { key: 'PageUp', keyCode: 33 },
    PageDown: { key: 'PageDown', keyCode: 34 },
    ControlLeft: { key: 'Control', keyCode: 17, location: 1 },
    ControlRight: { key: 'Control', keyCode: 17, location: 2 },
    ShiftLeft: { key: 'Shift', keyCode: 16, location: 1 },
    ShiftRight: { key: 'Shift', keyCode: 16, location: 2 },
    AltLeft: { key: 'Alt', keyCode: 18, location: 1 },
    AltRight: { key: 'Alt', keyCode: 18, location: 2 },
    Backquote: { key: '`', keyCode: 192 },
    Minus: { key: '-', keyCode: 189 },
    Equal: { key: '=', keyCode: 187 },
    Backslash: { key: '\\', keyCode: 220 },
    BracketLeft: { key: '[', keyCode: 219 },
    BracketRight: { key: ']', keyCode: 221 },
    Semicolon: { key: ';', keyCode: 186 },
    Quote: { key: "'", keyCode: 222 },
    Period: { key: '.', keyCode: 190 },
    Comma: { key: ',', keyCode: 188 },
    Slash: { key: '/', keyCode: 191 },
  };
  for (let i = 0; i < 26; i += 1) {
    const ch = String.fromCharCode(65 + i);
    table[`Key${ch}`] = { key: ch.toLowerCase(), keyCode: 65 + i };
  }
  for (let i = 0; i < 10; i += 1) {
    table[`Digit${i}`] = { key: String(i), keyCode: 48 + i };
    table[`Numpad${i}`] = { key: String(i), keyCode: 96 + i, location: 3 };
  }
  for (let i = 1; i <= 12; i += 1) table[`F${i}`] = { key: `F${i}`, keyCode: 111 + i };
  return Object.freeze(table);
})();

export const canSend = (code) => typeof code === 'string' && !!KBD[code] && !!KEY_INFO[code];

/* What a movement token means depends on the running game. DOOM's bundle ships
   a DEFAULT.CFG of W/S move, A/D strafe, arrows turn; Digger and the rest are
   arrow driven. */
export const PROFILES = Object.freeze({
  arrows: {
    pad: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
    move: { forward: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
  },
  doom: {
    pad: {
      up: ['KeyW', 'ArrowUp'],
      down: ['KeyS', 'ArrowDown'],
      left: ['ArrowLeft'],
      right: ['ArrowRight'],
    },
    move: { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD' },
  },
});

export const DIRECTION = Object.freeze({
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
});

/* Actions own slots. [physical key, what the slot sends]. A send is either a
   movement token (resolved through the profile) or an exact DOS key. */
export const ACTIONS = Object.freeze([
  { id: 'forward', label: '앞으로 / 위', note: '이동 ↑', slots: [['KeyW', 'forward'], ['ArrowUp', 'ArrowUp']] },
  { id: 'back', label: '뒤로 / 아래', note: '이동 ↓', slots: [['KeyS', 'back'], ['ArrowDown', 'ArrowDown']] },
  { id: 'left', label: '왼쪽 / 좌회전', note: '옆걸음 · 회전 ←', slots: [['KeyA', 'left'], ['ArrowLeft', 'ArrowLeft']] },
  { id: 'right', label: '오른쪽 / 우회전', note: '옆걸음 · 회전 →', slots: [['KeyD', 'right'], ['ArrowRight', 'ArrowRight']] },
  { id: 'fire', label: '사격 / 액션', note: 'Ctrl', slots: [['KeyJ', 'ControlLeft'], ['KeyZ', 'ControlLeft'], ['ControlLeft', 'ControlLeft']] },
  { id: 'use', label: '사용 / 열기', note: 'Space', slots: [['KeyK', 'Space'], ['KeyX', 'Space'], ['Space', 'Space']] },
  { id: 'enter', label: '확인 / 시작', note: 'Enter', slots: [['KeyL', 'Enter'], ['KeyC', 'Enter'], ['Enter', 'Enter']] },
  { id: 'run', label: '달리기', note: 'Shift', slots: [['ShiftLeft', 'ShiftLeft']] },
  { id: 'strafe', label: '스트레이프', note: 'Alt', slots: [['AltLeft', 'AltLeft']] },
  { id: 'menu', label: '메뉴 / 취소', note: 'Esc', slots: [['Escape', 'Escape']] },
]);

/* Keys forwarded as-is (not remappable). */
export const NATIVE_KEYS = Object.freeze({
  KeyY: 'KeyY', KeyN: 'KeyN',
  Digit1: 'Digit1', Digit2: 'Digit2', Digit3: 'Digit3', Digit4: 'Digit4',
  Digit5: 'Digit5', Digit6: 'Digit6', Digit7: 'Digit7',
  NumpadEnter: 'Enter',
  ControlRight: 'ControlRight', ShiftRight: 'ShiftRight', AltRight: 'AltRight',
});

const MOVEMENT_TOKENS = new Set(['forward', 'back', 'left', 'right']);

export function actionById(id) {
  return ACTIONS.find((action) => action.id === id) || null;
}

export function defaultKeymap() {
  const map = {};
  for (const action of ACTIONS) map[action.id] = action.slots.map((slot) => slot[0]);
  return map;
}

/* Accepts anything localStorage may hold and returns a map that is safe to
   index: right shape, known codes, no key bound to two slots, nothing exotic. */
export function normalizeKeymap(saved, base = defaultKeymap()) {
  const map = {};
  for (const action of ACTIONS) {
    const fallback = base[action.id].slice();
    const raw = saved && Array.isArray(saved[action.id]) ? saved[action.id] : null;
    if (!raw || raw.length !== fallback.length) {
      map[action.id] = fallback;
      continue;
    }
    map[action.id] = raw.map((code, i) => (canSend(code) ? code : fallback[i]));
  }
  // one physical key, one slot — a duplicate would fire two DOS keys at once
  const seen = new Set();
  for (const action of ACTIONS) {
    map[action.id] = map[action.id].map((code) => {
      if (!code || seen.has(code)) return null;
      seen.add(code);
      return code;
    });
  }
  return map;
}

/* physical code -> { actionId, slot, send } used by the keyboard handler. */
export function buildKeyIndex(map) {
  const index = {};
  for (const action of ACTIONS) {
    const codes = map[action.id] || [];
    action.slots.forEach((slot, i) => {
      const code = codes[i];
      if (!code) return;
      index[code] = { actionId: action.id, slot: i, send: slot[1] };
    });
  }
  return index;
}

/* A movement token resolves through the running game's profile; everything
   else is already an exact DOS key. */
export function resolveSlot(send, profile = 'arrows') {
  if (!send) return null;
  if (!MOVEMENT_TOKENS.has(send)) return send;
  const move = (PROFILES[profile] || PROFILES.arrows).move;
  return move[send] || send;
}

/* The DOS keys behind a d-pad button (`data-code` holds the semantic direction
   or a fixed key). */
export function padCodesFor(buttonCode, profile = 'arrows') {
  const dir = DIRECTION[buttonCode];
  if (!dir) return buttonCode ? [buttonCode] : [];
  const codes = (PROFILES[profile] || PROFILES.arrows).pad[dir];
  return Array.isArray(codes) ? codes.slice() : [codes];
}

export function keyLabel(code) {
  if (!code) return '미설정';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  const named = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Escape: 'Esc', Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: '⌫',
    ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', ShiftLeft: 'Shift', ShiftRight: 'R Shift',
    AltLeft: 'Alt', AltRight: 'R Alt', NumpadEnter: 'Num Enter',
    Minus: '-', Equal: '=', Backquote: '`', Backslash: '\\',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/',
  };
  return named[code] || code.replace(/^Numpad/, 'Num ');
}

const CHAR_CODES = {
  ' ': 'Space', '.': 'Period', ',': 'Comma', '-': 'Minus', '=': 'Equal',
  ';': 'Semicolon', "'": 'Quote', '/': 'Slash', '\\': 'Backslash',
  '[': 'BracketLeft', ']': 'BracketRight', '`': 'Backquote',
};

/* a typed character -> the DOS key that types it */
export function codeForChar(ch) {
  if (/^[a-zA-Z]$/.test(ch)) return `Key${ch.toUpperCase()}`;
  if (/^[0-9]$/.test(ch)) return `Digit${ch}`;
  return CHAR_CODES[ch] || null;
}

export function codesForText(text) {
  const out = [];
  for (const ch of String(text || '')) {
    if (ch === '\n' || ch === '\r') { out.push('Enter'); continue; }
    const code = codeForChar(ch);
    if (code) out.push(code);
  }
  return out;
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

function browserStorage() {
  try {
    const probe = '__pk6_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (_) {
    return memoryStorage();
  }
}

/* ------------------------------------------------------------------ store -- */
export class KeymapStore {
  constructor({ storage = browserStorage(), key = STORAGE.keymap, initial = null } = {}) {
    this.storage = storage;
    this.key = key;
    this.map = initial
      ? normalizeKeymap(initial)
      : normalizeKeymap(this.#read());
    this.index = buildKeyIndex(this.map);
  }

  #read() {
    try {
      return JSON.parse(this.storage.getItem(this.key) || 'null');
    } catch (_) {
      return null;
    }
  }

  persist() {
    try { this.storage.setItem(this.key, JSON.stringify(this.map)); } catch (_) { /* private mode */ }
  }

  codes(actionId) {
    return (this.map[actionId] || []).slice();
  }

  /** Bind `code` to (actionId, slot). A key already used elsewhere is swapped
   *  with the previous occupant rather than silently duplicated. */
  assign(actionId, slot, code) {
    if (!actionById(actionId)) return { ok: false, reason: 'unknown-action' };
    if (!canSend(code)) return { ok: false, reason: 'unsendable' };
    const list = this.map[actionId];
    if (!list || slot < 0 || slot >= list.length) return { ok: false, reason: 'unknown-slot' };

    const previous = list[slot];
    if (previous === code) return { ok: true, unchanged: true, swapped: null };

    let swapped = null;
    for (const action of ACTIONS) {
      const other = this.map[action.id];
      for (let i = 0; i < other.length; i += 1) {
        if (action.id === actionId && i === slot) continue;
        if (other[i] !== code) continue;
        other[i] = previous; // may be null: the old key is released, not duplicated
        swapped = { actionId: action.id, slot: i };
      }
    }
    list[slot] = code;
    this.#settle();
    return { ok: true, swapped, code, previous };
  }

  /** Unbind a slot so its key reaches the game as a plain character again. */
  clear(actionId, slot) {
    const list = this.map[actionId];
    if (!list || slot < 0 || slot >= list.length) return { ok: false, reason: 'unknown-slot' };
    const previous = list[slot];
    if (!previous) return { ok: true, unchanged: true, previous };
    list[slot] = null;
    this.#settle();
    return { ok: true, previous };
  }

  resetAction(actionId) {
    const action = actionById(actionId);
    if (!action) return { ok: false, reason: 'unknown-action' };
    const defaults = defaultKeymap()[actionId];
    // free this action's own slots first, then take the defaults back; a slot
    // in another action that still holds one of those keys ends up cleared
    // instead of duplicated (the swap in assign() hands it our old value).
    for (let i = 0; i < this.map[actionId].length; i += 1) this.map[actionId][i] = null;
    defaults.forEach((code, i) => { if (canSend(code)) this.assign(actionId, i, code); });
    this.#settle();
    return { ok: true };
  }

  resetAll() {
    this.map = defaultKeymap();
    this.#settle();
    return { ok: true };
  }

  #settle() {
    this.index = buildKeyIndex(this.map);
    this.persist();
  }

  resolvePhysical(code) {
    const hit = this.index[code];
    if (!hit) return null;
    return { ...hit };
  }
}

export { CHAR_CODES };
