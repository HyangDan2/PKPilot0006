/* ==========================================================================
   HD2Lab | DOS Player — physical keyboard source
   Maps KeyboardEvent.code -> a DOS key through the key map, and forwards it
   to the InputManager with the source id "keyboard".

   Capture phase + preventDefault: the page must not scroll on arrows/space and
   js-dos' own window listener must not deliver the same press a second time.
   ========================================================================== */

import { NATIVE_KEYS, resolveSlot } from './keymap.js';

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export class KeyboardInput {
  constructor({
    manager,
    store,
    getProfile = () => 'arrows',
    isWasdEnabled = () => true,
    onActivity = () => {},
    target = typeof window !== 'undefined' ? window : null,
    doc = typeof document !== 'undefined' ? document : null,
  } = {}) {
    this.manager = manager;
    this.store = store;
    this.getProfile = getProfile;
    this.isWasdEnabled = isWasdEnabled;
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

  isEditable(target) {
    return !!(target && target.closest && target.closest(EDITABLE));
  }

  onDown(event) {
    if (!event || event.__pkpilot) return false;
    if (this.manager.captureBlocked) return false;
    if (this.isEditable(event.target)) return false;
    const code = this.resolve(event.code);
    if (!code) return false;
    if (event.cancelable !== false) event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    if (event.repeat) return false; // the key is already held; no re-send
    this.manager.press(code, 'keyboard');
    this.onActivity(code, true);
    return true;
  }

  onUp(event) {
    if (!event || event.__pkpilot) return false;
    if (this.isEditable(event.target)) return false;
    const code = this.resolve(event.code);
    if (!code) return false;
    if (event.cancelable !== false) event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    this.manager.release(code, 'keyboard');
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
