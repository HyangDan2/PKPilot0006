/* ==========================================================================
   HD2Lab | DOS Player — touch gamepad + virtual (OS) keyboard
   Both are *input sources*: they never call the emulator directly, they hold
   and release keys on the InputManager with their own source id. That is what
   keeps a finger and a physical key on the same DOS key from fighting.
   ========================================================================== */

import { codesForText } from './keymap.js';

export class TouchPad {
  constructor({
    root,
    manager,
    getCodes = () => [],
    isReady = () => true,
    onNotReady = () => {},
    onActivity = () => {},
  } = {}) {
    this.root = root;
    this.manager = manager;
    this.getCodes = getCodes;
    this.isReady = isReady;
    this.onNotReady = onNotReady;
    this.onActivity = onActivity;
    this.buttons = [];
    this.bound = [];
    this.attached = false;
  }

  get buttons_() {
    return this.buttons;
  }

  attach() {
    if (this.attached || !this.root) return this;
    const nodes = Array.from(this.root.querySelectorAll('[data-pad-key]'));
    this.buttons = nodes;
    nodes.forEach((button, index) => {
      const sourceId = `pad:${index}`;
      let pointerId = null;

      const down = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (event.cancelable !== false) event.preventDefault();
        if (pointerId !== null) return;
        if (!this.isReady()) { this.onNotReady(button); return; }
        pointerId = event.pointerId ?? 'key';
        button.classList.add('is-down');
        button.setAttribute('aria-pressed', 'true');
        // capture keeps the hold alive when the finger slides off the key;
        // a plain pointerleave release used to drop the d-pad mid-move
        if (button.setPointerCapture && event.pointerId !== undefined) {
          try { button.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
        }
        const codes = this.getCodes(button);
        codes.forEach((code) => this.manager.press(code, sourceId));
        this.onActivity(codes, true);
      };

      const up = (event) => {
        if (pointerId === null) return;
        if (event && event.pointerId !== undefined && event.pointerId !== pointerId) return;
        pointerId = null;
        button.classList.remove('is-down');
        button.setAttribute('aria-pressed', 'false');
        const codes = this.getCodes(button);
        this.manager.releaseSource(sourceId);
        this.onActivity(codes, false);
      };

      const onContext = (event) => event.preventDefault();
      const onKeyDown = (event) => {
        if (event.key === ' ' || event.key === 'Enter') event.preventDefault();
      };
      const onClick = (event) => {
        // keyboard activation (detail 0) never fires pointerdown
        if (event.detail !== 0) return;
        if (!this.isReady()) { this.onNotReady(button); return; }
        if (this.manager.captureBlocked) return;
        const codes = this.getCodes(button);
        const id = `padkey:${index}`;
        codes.forEach((code) => this.manager.press(code, id));
        globalThis.setTimeout(() => this.manager.releaseSource(id), 90);
        this.onActivity(codes, true);
        globalThis.setTimeout(() => this.onActivity(codes, false), 90);
      };

      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
      button.addEventListener('lostpointercapture', up);
      button.addEventListener('contextmenu', onContext);
      button.addEventListener('keydown', onKeyDown);
      button.addEventListener('click', onClick);
      this.bound.push({ button, down, up, onContext, onKeyDown, onClick, sourceId });
    });
    // leaving the tab/pointer cancel must not leave a direction pressed
    this.onVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden) this.releaseAll();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    this.attached = true;
    return this;
  }

  releaseAll() {
    for (const entry of this.bound) {
      entry.button.classList.remove('is-down');
      entry.button.setAttribute('aria-pressed', 'false');
      this.manager.releaseSource(entry.sourceId);
    }
  }

  detach() {
    if (!this.attached) return this;
    for (const entry of this.bound) {
      entry.button.removeEventListener('pointerdown', entry.down);
      entry.button.removeEventListener('pointerup', entry.up);
      entry.button.removeEventListener('pointercancel', entry.up);
      entry.button.removeEventListener('lostpointercapture', entry.up);
      entry.button.removeEventListener('contextmenu', entry.onContext);
      entry.button.removeEventListener('keydown', entry.onKeyDown);
      entry.button.removeEventListener('click', entry.onClick);
    }
    if (typeof document !== 'undefined' && this.onVisibility) {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.bound = [];
    this.attached = false;
    return this;
  }
}

/* A 1px text field summons the phone keyboard; its characters become DOS keys
   through the same sequential queue. Android IMEs only report the character in
   `input` (keydown gives keyCode 229), so that event is the real source. */
export class SoftKeyboard {
  constructor({ input, manager, isReady = () => true, onNotReady = () => {} } = {}) {
    this.input = input;
    this.manager = manager;
    this.isReady = isReady;
    this.onNotReady = onNotReady;
    this.attached = false;
  }

  open() {
    if (!this.input) return false;
    if (!this.isReady()) { this.onNotReady(); return false; }
    this.input.value = '';
    try { this.input.focus({ preventScroll: true }); } catch (_) { this.input.focus(); }
    return true;
  }

  typeText(text) {
    const codes = codesForText(text);
    if (!codes.length) return 0;
    return this.manager.typeCodes(codes);
  }

  attach() {
    if (this.attached || !this.input) return this;
    this.onKeyDown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (this.isReady()) this.manager.tap('Enter');
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        if (this.isReady()) this.manager.tap('Backspace');
      }
    };
    this.onBeforeInput = (event) => {
      if (event.inputType === 'deleteContentBackward') {
        event.preventDefault();
        if (this.isReady()) this.manager.tap('Backspace');
      } else if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
        event.preventDefault();
        if (this.isReady()) this.manager.tap('Enter');
      }
    };
    this.onInput = () => {
      const typed = this.input.value;
      this.input.value = '';
      this.typeText(typed);
    };
    this.onBlur = () => { this.input.value = ''; };
    this.input.addEventListener('keydown', this.onKeyDown);
    this.input.addEventListener('beforeinput', this.onBeforeInput);
    this.input.addEventListener('input', this.onInput);
    this.input.addEventListener('blur', this.onBlur);
    this.attached = true;
    return this;
  }

  detach() {
    if (!this.attached || !this.input) return this;
    this.input.removeEventListener('keydown', this.onKeyDown);
    this.input.removeEventListener('beforeinput', this.onBeforeInput);
    this.input.removeEventListener('input', this.onInput);
    this.input.removeEventListener('blur', this.onBlur);
    this.attached = false;
    return this;
  }
}
