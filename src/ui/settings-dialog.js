/* ==========================================================================
   HD2Lab | DOS Player — key settings dialog
   Renders one row per action. A slot button listens for the next physical key
   and hands it to the KeymapStore (which swaps on a conflict); a slot can also
   be released with ×. While the dialog is open the game receives no keys at
   all — the input manager's capture gate is closed by the caller.
   ========================================================================== */

import { ACTIONS, keyLabel } from '../input/keymap.js';

export class SettingsDialog {
  constructor({
    dialog,
    listEl,
    noteEl,
    store,
    onOpen = () => {},
    onClose = () => {},
    onChanged = () => {},
  } = {}) {
    this.dialog = dialog;
    this.listEl = listEl;
    this.noteEl = noteEl;
    this.store = store;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.onChanged = onChanged;
    this.listening = null;
    this.returnFocus = null;
    this.doc = dialog ? dialog.ownerDocument : document;
    this.bound = false;
  }

  get open_() {
    return !!(this.dialog && this.dialog.open);
  }

  get isOpen() {
    return this.open_;
  }

  bind() {
    if (this.bound || !this.dialog) return this;
    this.bound = true;
    const byId = (id) => this.doc.getElementById(id);
    const x = byId('keymapX');
    const done = byId('keymapDone');
    const reset = byId('keymapReset');
    if (x) x.addEventListener('click', () => this.close());
    if (done) done.addEventListener('click', () => this.close());
    if (reset) {
      reset.addEventListener('click', () => {
        this.store.resetAll();
        this.listening = null;
        this.render();
        this.note('모든 키를 기본값으로 되돌렸습니다.');
        this.onChanged();
      });
    }

    this.dialog.addEventListener('close', () => this.#afterClose());
    this.dialog.addEventListener('cancel', (event) => {
      // Esc first cancels a listening slot, then closes the dialog
      if (this.listening) {
        event.preventDefault();
        this.cancelListen();
        return;
      }
      // native close follows; #afterClose runs on the close event
    });
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close(); // backdrop click
    });

    this.onKeyDown = (event) => this.#onKeyDown(event);
    this.doc.addEventListener('keydown', this.onKeyDown, true);
    return this;
  }

  #onKeyDown(event) {
    if (!this.isOpen) return;
    if (event.key === 'Escape' || event.key === 'Esc') return; // handled by cancel
    if (!this.listening) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.code === 'MetaLeft' || event.code === 'MetaRight') {
      this.note('Meta 키는 DOS로 전달할 수 없습니다 — 다른 키를 눌러 주세요.', 'warn');
      return;
    }
    this.assign(event.code);
  }

  render() {
    if (!this.listEl) return;
    const doc = this.listEl.ownerDocument;
    const frag = doc.createDocumentFragment();
    for (const action of ACTIONS) {
      const row = doc.createElement('li');
      row.className = 'keydialog-row';
      row.dataset.action = action.id;

      const label = doc.createElement('div');
      label.className = 'keydialog-label';
      const name = doc.createElement('b');
      name.textContent = action.label;
      const meta = doc.createElement('span');
      meta.textContent = action.note;
      label.append(name, meta);

      const slots = doc.createElement('div');
      slots.className = 'keydialog-slots';
      const codes = this.store.codes(action.id);
      action.slots.forEach((slot, i) => {
        const cell = doc.createElement('span');
        cell.className = 'slot-cell';

        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'keyslot';
        btn.dataset.action = action.id;
        btn.dataset.slot = String(i);
        btn.setAttribute('aria-label', `${action.label} 키 ${i + 1}`);
        btn.addEventListener('click', () => this.beginListen(action.id, i));
        cell.appendChild(btn);

        const clear = doc.createElement('button');
        clear.type = 'button';
        clear.className = 'keyclear';
        clear.dataset.clearAction = action.id;
        clear.dataset.clearSlot = String(i);
        clear.setAttribute('aria-label', `${action.label} 키 ${i + 1} 해제`);
        clear.title = '이 키를 해제';
        clear.textContent = '×';
        clear.hidden = !codes[i];
        clear.addEventListener('click', () => this.releaseSlot(action.id, i));
        cell.appendChild(clear);

        slots.appendChild(cell);
      });

      row.append(label, slots);
      frag.appendChild(row);
    }
    this.listEl.replaceChildren(frag);
    this.paint();
  }

  paint() {
    if (!this.listEl) return;
    for (const btn of this.listEl.querySelectorAll('.keyslot')) {
      const id = btn.dataset.action;
      const i = Number(btn.dataset.slot);
      const on = !!this.listening && this.listening.actionId === id && this.listening.slot === i;
      btn.classList.toggle('is-listening', on);
      btn.setAttribute('aria-pressed', String(on));
      const code = this.store.codes(id)[i];
      btn.dataset.bound = code ? 'yes' : 'no';
      btn.textContent = on ? '키를 누르세요…' : keyLabel(code);
    }
    for (const clear of this.listEl.querySelectorAll('.keyclear')) {
      const id = clear.dataset.clearAction;
      const i = Number(clear.dataset.clearSlot);
      clear.hidden = !this.store.codes(id)[i];
    }
    for (const row of this.listEl.querySelectorAll('.keydialog-row')) {
      row.classList.toggle('is-lead', !!this.listening && row.dataset.action === this.listening.actionId);
    }
  }

  note(message, tone = 'info') {
    if (!this.noteEl) return;
    this.noteEl.textContent = message || '';
    this.noteEl.dataset.tone = tone;
    this.noteEl.hidden = !message;
  }

  beginListen(actionId, slot) {
    this.listening = { actionId, slot };
    this.note('');
    this.paint();
  }

  cancelListen() {
    if (!this.listening) return;
    this.listening = null;
    this.note('입력을 취소했습니다.');
    this.paint();
  }

  assign(code) {
    const pending = this.listening;
    if (!pending) return;
    const action = ACTIONS.find((item) => item.id === pending.actionId);
    const result = this.store.assign(pending.actionId, pending.slot, code);
    if (!result.ok) {
      const reason = result.reason === 'unsendable'
        ? `‘${code}’ 키는 DOS로 전달할 수 없습니다 — 다른 키를 눌러 주세요.`
        : '이 키는 지정할 수 없습니다.';
      this.note(reason, 'warn');
      return;
    }
    this.listening = null;
    this.paint();
    if (result.swapped) {
      const other = ACTIONS.find((item) => item.id === result.swapped.actionId);
      const where = other.slots.length > 1 ? `${other.label} ${result.swapped.slot + 1}번 칸` : other.label;
      this.note(`‘${keyLabel(code)}’는 ‘${where}’에 이미 쓰여 있어 ‘${keyLabel(result.previous)}’와 서로 바꿨습니다.`);
    } else {
      this.note(`‘${action.label}’ 키를 ‘${keyLabel(code)}’로 바꿨습니다.`);
    }
    this.onChanged();
  }

  releaseSlot(actionId, slot) {
    const result = this.store.clear(actionId, slot);
    if (!result.ok) return;
    this.listening = null;
    this.paint();
    this.note(`‘${keyLabel(result.previous)}’ 키를 해제했습니다. 이제 그 키는 게임에 글자로 전달됩니다.`);
    this.onChanged();
  }

  open() {
    if (!this.dialog || this.isOpen) return false;
    this.returnFocus = this.doc.activeElement;
    this.render();
    this.note('');
    this.onOpen();
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
    const first = this.listEl && this.listEl.querySelector('.keyslot');
    if (first) first.focus();
    return true;
  }

  close() {
    if (!this.dialog || !this.isOpen) return false;
    this.listening = null;
    this.paint();
    if (typeof this.dialog.close === 'function') this.dialog.close();
    else this.dialog.removeAttribute('open');
    return true;
  }

  #afterClose() {
    this.listening = null;
    this.onClose();
    const back = this.returnFocus && this.returnFocus.focus && this.doc.contains(this.returnFocus)
      ? this.returnFocus
      : this.doc.getElementById('keymapBtn');
    if (back) back.focus();
  }
}
