/* ==========================================================================
   HD2Lab | DOS Player — local .jsdos / .zip bundle handling
   The File never leaves the browser: it becomes a Blob URL that the session
   owns. Release order matters — the URL is revoked only after the runtime that
   reads it has stopped, otherwise the emulator loses its bundle mid-teardown.
   ========================================================================== */

export const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;

export function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${value} B`;
}

export function validateBundle(file) {
  if (!file) return { ok: false, code: 'empty', message: '파일이 선택되지 않았습니다.' };
  const name = String(file.name || '');
  if (!/\.(jsdos|zip)$/i.test(name)) {
    return { ok: false, code: 'extension', message: '.jsdos 또는 .zip 파일만 실행할 수 있습니다.' };
  }
  if (!file.size) {
    return { ok: false, code: 'zero-size', message: '빈 파일입니다. 다른 파일을 골라 주세요.' };
  }
  if (file.size > MAX_BUNDLE_BYTES) {
    return {
      ok: false,
      code: 'too-large',
      message: `파일 용량이 너무 큽니다 (${formatSize(file.size)} · 최대 ${formatSize(MAX_BUNDLE_BYTES)}).`,
    };
  }
  return { ok: true };
}

export function localTargetFor(file, url) {
  const base = String(file.name || 'local').replace(/\.(jsdos|zip)$/i, '');
  const size = formatSize(file.size);
  return {
    id: 'local',
    local: true,
    kind: 'library',
    name: base || '로컬 번들',
    badge: 'FL',
    license: 'Local',
    size,
    url,
    meta: `${file.name} · ${size} · 로컬 파일`,
    blurb: '내가 고른 번들 — 브라우저 안에서만 열립니다.',
  };
}

export class LocalBundleManager {
  constructor({
    createObjectURL = (file) => URL.createObjectURL(file),
    revokeObjectURL = (url) => URL.revokeObjectURL(url),
  } = {}) {
    this.createObjectURL = createObjectURL;
    this.revokeObjectURL = revokeObjectURL;
    this.active = null; // the newest bundle opened
    this.live = new Map(); // url -> { name, size } : every URL that may still be read
    this.created = 0;
    this.revoked = 0;
    this.order = []; // ["create", url] / ["revoke", url] in call order
  }

  get liveCount() {
    return this.live.size;
  }

  get liveUrls() {
    return Array.from(this.live.keys());
  }

  open(file) {
    const verdict = validateBundle(file);
    if (!verdict.ok) return verdict;
    const url = this.createObjectURL(file);
    this.created += 1;
    this.live.set(url, { name: file.name, size: file.size });
    this.order.push(['create', url]);
    this.active = { url, name: file.name, size: file.size };
    return { ok: true, url, target: localTargetFor(file, url) };
  }

  /** Revoke one URL (the session calls this after its runtime stopped). */
  release(url) {
    const target = url || (this.active && this.active.url);
    if (!target || !this.live.has(target)) return false;
    try { this.revokeObjectURL(target); } catch (_) { return false; }
    this.live.delete(target);
    this.order.push(['revoke', target]);
    this.revoked += 1;
    if (this.active && this.active.url === target) {
      const last = Array.from(this.live.keys()).pop() || null;
      this.active = last ? { url: last, ...this.live.get(last) } : null;
    }
    return true;
  }

  releaseAll() {
    let count = 0;
    for (const url of Array.from(this.live.keys())) {
      if (this.release(url)) count += 1;
    }
    return count;
  }
}
