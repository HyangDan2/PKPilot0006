import { describe, expect, it } from 'vitest';
import {
  LocalBundleManager,
  MAX_BUNDLE_BYTES,
  formatSize,
  localTargetFor,
  validateBundle,
} from '../../src/files/local-bundle.js';

function file(name, size = 2048) {
  return { name, size };
}

describe('bundle validation', () => {
  it('accepts .jsdos and .zip only', () => {
    expect(validateBundle(file('doom.jsdos')).ok).toBe(true);
    expect(validateBundle(file('DOOM.ZIP')).ok).toBe(true);
    expect(validateBundle(file('notes.txt')).code).toBe('extension');
    expect(validateBundle(file('game.7z')).code).toBe('extension');
    expect(validateBundle(null).code).toBe('empty');
  });

  it('rejects empty and oversized files', () => {
    expect(validateBundle(file('empty.jsdos', 0)).code).toBe('zero-size');
    expect(validateBundle(file('huge.zip', MAX_BUNDLE_BYTES + 1)).code).toBe('too-large');
  });

  it('formats sizes the way the UI shows them', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(27 * 1024)).toBe('27 KB');
    expect(formatSize(5.3 * 1024 * 1024)).toBe('5.3 MB');
    expect(formatSize(0)).toBe('0 B');
  });

  it('builds a local target with a readable name', () => {
    const target = localTargetFor(file('My Game.jsdos', 4096), 'blob:test');
    expect(target).toMatchObject({ id: 'local', local: true, name: 'My Game', url: 'blob:test', badge: 'FL' });
    expect(target.meta).toContain('로컬 파일');
  });
});

describe('LocalBundleManager lifecycle', () => {
  it('creates a blob URL once per file and revokes exactly that URL', () => {
    const created = [];
    const revoked = [];
    const bundles = new LocalBundleManager({
      createObjectURL: (f) => { const url = `blob:${f.name}-${created.length}`; created.push(url); return url; },
      revokeObjectURL: (url) => revoked.push(url),
    });
    const first = bundles.open(file('a.jsdos'));
    expect(first.ok).toBe(true);
    expect(bundles.active.url).toBe(created[0]);
    bundles.release();
    expect(revoked).toEqual([created[0]]);
    expect(bundles.active).toBe(null);
  });

  it('does not revoke anything when validation fails', () => {
    const revoked = [];
    const bundles = new LocalBundleManager({
      createObjectURL: () => 'blob:x',
      revokeObjectURL: (url) => revoked.push(url),
    });
    const result = bundles.open(file('virus.exe'));
    expect(result.ok).toBe(false);
    expect(revoked).toEqual([]);
    expect(bundles.created).toBe(0);
  });

  it('releases the previous URL only when the session asks for it', () => {
    const revoked = [];
    const bundles = new LocalBundleManager({
      createObjectURL: (f) => `blob:${f.name}`,
      revokeObjectURL: (url) => revoked.push(url),
    });
    const a = bundles.open(file('a.jsdos'));
    const b = bundles.open(file('b.jsdos'));
    // opening the second bundle must not pull the rug under the running one
    expect(revoked).toEqual([]);
    bundles.release(a.url);
    expect(revoked).toEqual(['blob:a.jsdos']);
    expect(bundles.active.url).toBe('blob:b.jsdos');
    bundles.releaseAll();
    expect(revoked).toEqual(['blob:a.jsdos', 'blob:b.jsdos']);
  });
});

describe('LocalBundleManager across A → B → C', () => {
  it('keeps one URL live per running bundle and never loses a URL', () => {
    const revoked = [];
    const bundles = new LocalBundleManager({
      createObjectURL: (f) => `blob:${f.name}`,
      revokeObjectURL: (url) => revoked.push(url),
    });
    const a = bundles.open(file('a.jsdos'));
    const b = bundles.open(file('b.jsdos'));
    const c = bundles.open(file('c.jsdos'));
    expect(bundles.liveCount).toBe(3);

    // A stops: its URL goes, the pending B and C stay readable
    expect(bundles.release(a.url)).toBe(true);
    expect(bundles.liveUrls).toEqual(['blob:b.jsdos', 'blob:c.jsdos']);
    // B was replaced before it mounted (the session releases it itself)
    expect(bundles.release(b.url)).toBe(true);
    expect(bundles.liveUrls).toEqual(['blob:c.jsdos']);
    expect(bundles.active.url).toBe('blob:c.jsdos');

    // the same URL is never revoked twice
    expect(bundles.release(a.url)).toBe(false);
    expect(revoked).toEqual(['blob:a.jsdos', 'blob:b.jsdos']);

    expect(bundles.releaseAll()).toBe(1);
    expect(bundles.liveCount).toBe(0);
    expect(bundles.created).toBe(3);
    expect(bundles.revoked).toBe(3);
    expect(bundles.order.map(([kind]) => kind)).toEqual(['create', 'create', 'create', 'revoke', 'revoke', 'revoke']);
  });
});
