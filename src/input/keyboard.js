/* ==========================================================================
   HD2Lab | DOS Player — physical keyboard source
   Maps KeyboardEvent.code -> a DOS key through the key map, and forwards it
   to the InputManager with a source id of its own (`kbd:KeyJ`).

   That id matters: J and Z both send Ctrl, so holding both and lifting one
   must keep Ctrl down. With one shared "keyboard" id the first keyup released
   the key for both.

   Capture phase + preventDefault: the page must not scroll on arrows/space and
   js-dos' own window listener must not deliver the same press a second time.

   Capture policy
   * nothing is intercepted before a game runs — the page keeps its normal
     keyboard (Tab, Space, typing in the file field, buttons)
   * while a game runs the stage has focus and keys go to DOS
   * a text field, a dialog or a menu keeps every key; a button, link or switch
     keeps only the keys that operate it (Space, Enter). Everything else —
     arrows, letters, Ctrl — still reaches the game, so playing never breaks
     because focus happens to sit on a control.
   ========================================================================== */

import { NATIVE_KEYS, resolveSlot } from './keymap.js';

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Regions that own every key while they are open or focused. */
const OWNED_REGIONS = [
  'dialog', '[role="dialog"]', '[role="menu"]', '.portal-menu-dropdown',
  '.mini-bar', '.keydialog',
].join(',');

/** Controls whose activation keys (Space/Enter) belong to the page, not DOS. */
const ACTIVATABLE = [
  'button', 'a[href]', 'summary', '[role="button"]', '[role="switch"]',
  '[role="menuitem"]', '[role="menuitemradio"]', '[role="tab"]',
].join(',');

export class KeyboardInput {
  constructor({
    manager,
    store,
    getProfile = () => 'arrows',
    isWasdEnabled = () => true,
    isCapturing = () => true,
    onActivity = () => {},
    target = typeof window !== 'undefined' ? window : null,
    doc = typeof document !== 'undefined' ? document : null,
  } = {}) {
    this.manager = manager;
    this.store = store;
    this.getProfile = getProfile;
    this.isWasdEnabled = isWasdEnabled;
    this.isCapturing = isCapturing;
    this.onActivity = onActivity;
    this.target = target;
    this.doc = doc;
    this.attached = false;
    this.onDown = this.onDown.bind(this);
    this.onUp = this.onUp.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
  }

  /** physical code -> DOS code, or null when the event must pass through. */
  resolve(code) {
    const hit = this.store.resolvePhysical(code);
    if (hit) {
      // WASD off: letters reach DOS as typed characters (js-dos' own listener),
      // arrows, modifiers and the rest of the key map keep working
      if (!this.isWasdEnabled() && /^Key[A-Z]$/.test(code)) return null;
      return resolveSlot(hit.send, this.getProfile());
    }
    return NATIVE_KEYS[code] || null;
  }

  /** One source id per physical key, so J and Z never share a Ctrl hold. */
  sourceIdFor(code) {
    return `kbd:${code}`;
  }

  isEditable(target) {
    return !!(target && target.closest && target.closest(EDITABLE));
  }

  /** True when this key is the one that operates the focused control. */
  belongsToControl(event) {
    const target = event.target;
    if (!target || !target.closest) return false;
    if (target.closest(OWNED_REGIONS)) return true;
    if (!target.closest(ACTIVATABLE)) return false;
    return event.key === ' ' || event.key === 'Enter' || event.key === 'Spacebar'
      || event.code === 'Space' || event.code === 'Enter';
  }

  /** Should this event belong to the emulator instead of the page? */
  claims(event) {
    if (!event) return false;
    if (this.manager.captureBlocked) return false;
    if (!this.isCapturing()) return false;
    if (this.isEditable(event.target)) return false;
    if (this.belongsToControl(event)) return false;
    return true;
  }

  onDown(event) {
    if (!event || event.__pkpilot) return false;
    if (!this.claims(event)) return false;
    const code = this.resolve(event.code);
    if (!code) return false;
    if (event.cancelable !== false) event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    if (event.repeat) return false; // the key is already held; no re-send
    this.manager.press(code, this.sourceIdFor(event.code));
    this.onActivity(code, true);
    return true;
  }

  onUp(event) {
    if (!event || event.__pkpilot) return false;
    const code = this.resolve(event.code);
    if (!code) return false;
    const sourceId = this.sourceIdFor(event.code);
    // only lift what this physical key actually holds: a keyup that belongs to
    // a text field or to another control must not be swallowed
    if (!this.manager.sourcesOf(code).includes(sourceId)) return false;
    if (event.cancelable !== false) event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    this.manager.release(code, sourceId);
    this.onActivity(code, false);
    return true;
  }

  onBlur() {
    this.manager.releaseAll('blur');
    this.onActivity(null, false);
  }

  onVisibility() {
    if (this.doc && this.doc.hidden) this.manager.releaseAll('hidden');
  }

  attach() {
    if (this.attached || !this.target) return this;
    this.target.addEventListener('keydown', this.onDown, true);
    this.target.addEventListener('keyup', this.onUp, true);
    this.target.addEventListener('blur', this.onBlur);
    this.target.addEventListener('pagehide', this.onBlur);
    if (this.doc) this.doc.addEventListener('visibilitychange', this.onVisibility);
    this.attached = true;
    return this;
  }

  detach() {
    if (!this.attached || !this.target) return this;
    this.target.removeEventListener('keydown', this.onDown, true);
    this.target.removeEventListener('keyup', this.onUp, true);
    this.target.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('pagehide', this.onBlur);
    if (this.doc) this.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.attached = false;
    return this;
  }
}
