/* ==========================================================================
   HD2Lab | DOS Player — game library view
   Thumbnail cards for the play library, a separate benchmark row, and the
   local-file drop zone. Cards report a selection; they never boot anything
   themselves.
   ========================================================================== */

export class GameLibrary {
  constructor({
    listEl,
    benchEl = null,
    miniEl = null,
    dropZoneEl = null,
    fileInputEl = null,
    fileNoteEl = null,
    onSelect = () => {},
    onNotice = () => {},
  } = {}) {
    this.listEl = listEl;
    this.benchEl = benchEl;
    this.miniEl = miniEl;
    this.dropZoneEl = dropZoneEl;
    this.fileInputEl = fileInputEl;
    this.fileNoteEl = fileNoteEl;
    this.onSelect = onSelect;
    this.onNotice = onNotice;
    this.games = [];
    this.currentId = null;
    this.runningId = null;
    this.pendingId = null;
    this.busy = false;
    this.defaultNote = fileNoteEl ? fileNoteEl.textContent : '';
  }

  render(games) {
    this.games = games.slice();
    const library = this.games.filter((game) => game.kind !== 'benchmark');
    const bench = this.games.filter((game) => game.kind === 'benchmark');
    if (this.listEl) this.listEl.replaceChildren(...library.map((game) => this.card(game)));
    if (this.benchEl) this.benchEl.replaceChildren(...bench.map((game) => this.card(game, true)));
    this.renderMini();
    this.sync();
    return this;
  }

  card(game, compact = false) {
    const li = this.listEl ? this.listEl.ownerDocument.createElement('li') : document.createElement('li');
    const btn = li.ownerDocument.createElement('button');
    btn.type = 'button';
    btn.className = `game-card${compact ? ' is-compact' : ''}`;
    btn.dataset.game = game.id;
    btn.setAttribute('aria-pressed', 'false');
    const thumb = game.thumb
      ? `<img class="card-thumb" src="${game.thumb}" alt="" loading="lazy" decoding="async" />`
      : '';
    btn.innerHTML = `
      <span class="card-media">
        ${thumb}
        <span class="card-badge" aria-hidden="true">${game.badge || '??'}</span>
        <span class="card-size">${game.size || ''}</span>
      </span>
      <span class="card-body">
        <span class="card-title">${game.name}<span class="card-lic">${game.license || ''}</span></span>
        <span class="card-meta">${[game.year, game.maker, game.genre].filter(Boolean).join(' · ')}</span>
        ${compact ? '' : `<span class="card-blurb">${game.blurb || ''}</span>`}
      </span>
      <span class="card-run">실행 중</span>`;
    const img = btn.querySelector('img');
    if (img) img.addEventListener('error', () => btn.classList.add('no-thumb'), { once: true });
    btn.addEventListener('click', () => {
      // a card stays live while another game boots: the newest pick wins
      this.onSelect(game);
    });
    li.appendChild(btn);
    return li;
  }

  renderMini() {
    if (!this.miniEl) return;
    const doc = this.miniEl.ownerDocument;
    const chips = this.games.map((game) => {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'mini-game';
      btn.dataset.game = game.id;
      btn.textContent = game.name;
      btn.addEventListener('click', () => this.onSelect(game));
      return btn;
    });
    this.miniEl.replaceChildren(...chips);
  }

  setBusy(busy) {
    this.busy = !!busy;
    this.sync();
  }

  /** The card whose boot is in flight (shows “부팅 중”). */
  setPending(id) {
    this.pendingId = id || null;
    this.sync();
  }

  setCurrent(id) {
    this.currentId = id;
    this.sync();
  }

  setRunning(id) {
    this.runningId = id || null;
    this.sync();
  }

  sync() {
    const containers = [this.listEl, this.benchEl].filter(Boolean);
    for (const root of containers) {
      for (const card of root.querySelectorAll('.game-card')) {
        const id = card.dataset.game;
        const state = id === this.runningId ? 'running' : id === this.pendingId ? 'booting' : 'idle';
        card.dataset.state = state;
        card.setAttribute('aria-pressed', String(id === this.currentId));
        card.classList.toggle('is-running', state === 'running');
        card.classList.toggle('is-booting', state === 'booting');
        card.classList.toggle('is-busy', this.busy);
        const badge = card.querySelector('.card-run');
        if (badge) badge.textContent = state === 'running' ? '실행 중' : '부팅 중';
      }
    }
    if (this.miniEl) {
      for (const chip of this.miniEl.querySelectorAll('.mini-game')) {
        chip.setAttribute('aria-pressed', String(chip.dataset.game === this.currentId));
        chip.classList.toggle('is-running', chip.dataset.game === this.runningId);
        chip.classList.toggle('is-booting', chip.dataset.game === this.pendingId && chip.dataset.game !== this.runningId);
      }
    }
    const root = this.listEl && this.listEl.closest('.library');
    if (root) root.dataset.busy = this.busy ? 'on' : 'off';
  }

  note(message, tone = 'info') {
    if (!this.fileNoteEl) return;
    this.fileNoteEl.textContent = message || this.defaultNote;
    this.fileNoteEl.dataset.tone = tone;
  }

  bindFileInput() {
    if (!this.dropZoneEl || !this.fileInputEl) return this;
    const pick = () => this.fileInputEl.click();
    this.dropZoneEl.addEventListener('click', pick);
    this.dropZoneEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        pick();
      }
    });
    this.fileInputEl.addEventListener('change', () => {
      const file = this.fileInputEl.files && this.fileInputEl.files[0];
      this.fileInputEl.value = '';
      if (file) this.onNotice('file', file);
    });
    ['dragenter', 'dragover'].forEach((type) => {
      this.dropZoneEl.addEventListener(type, (event) => {
        event.preventDefault();
        this.dropZoneEl.classList.add('is-over');
      });
    });
    ['dragleave', 'dragend'].forEach((type) => {
      this.dropZoneEl.addEventListener(type, () => this.dropZoneEl.classList.remove('is-over'));
    });
    this.dropZoneEl.addEventListener('drop', (event) => {
      event.preventDefault();
      this.dropZoneEl.classList.remove('is-over');
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) this.onNotice('file', file);
    });
    return this;
  }
}
