/* Static checks for the DOS Player build (no dependency, runs in CI).
   Catches the class of mistakes a bundler would catch in a build-step project:
   missing files, broken imports, DOM ids that no longer exist, an unpinned
   engine URL, build artefacts left behind.

   Usage: node tools/static-check.mjs */

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve('.');
const problems = [];
const notes = [];

const fail = (message) => problems.push(message);
const ok = (message) => notes.push(message);

async function exists(path) {
  try {
    await stat(join(ROOT, path));
    return true;
  } catch (_) {
    return false;
  }
}

async function text(path) {
  return readFile(join(ROOT, path), 'utf8');
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(rel));
    else out.push(rel);
  }
  return out;
}

/* ---------------------------------------------------------------- files --- */
const REQUIRED = [
  'index.html',
  'style.css',
  'package.json',
  'manifest.json',
  'og-image.png',
  'favicon.svg',
  '.nojekyll',
  'src/main.js',
  'src/config.js',
  'src/core/engine-loader.js',
  'src/core/dos-runtime.js',
  'src/core/session-manager.js',
  'src/input/keyboard.js',
  'src/input/gamepad.js',
  'src/input/input-manager.js',
  'src/input/keymap.js',
  'src/files/local-bundle.js',
  'src/ui/player-view.js',
  'src/ui/game-library.js',
  'src/ui/settings-dialog.js',
  'src/ui/responsive-mode.js',
  'src/data/games.js',
  'thumbs/digger.png',
  'thumbs/doom.png',
  'thumbs/dhrystone.png',
];
for (const file of REQUIRED) {
  if (!(await exists(file))) fail(`missing required file: ${file}`);
}
if (!problems.length) ok(`${REQUIRED.length} required files present`);

if (await exists('app.js')) fail('the old single-file app.js is still in the repository (Phase 4 replaced it with src/)');

/* ------------------------------------------------------------ html head --- */
const html = await text('index.html');
const htmlChecks = [
  [/<html lang="ko"/, 'html lang="ko"'],
  [/name="viewport"[^>]*width=device-width/, 'viewport meta'],
  [/rel="manifest"/, 'web app manifest link'],
  [/og:image/, 'Open Graph image'],
  [/data-touch="off"/, 'html[data-touch] initial state'],
  [/type="module" src="src\/main.js/, 'module entry src/main.js'],
  [/<noscript>/, 'noscript fallback'],
];
for (const [pattern, label] of htmlChecks) {
  if (!pattern.test(html)) fail(`index.html: missing ${label}`);
}
if (/<script[^>]+src="app\.js/.test(html)) fail('index.html still loads app.js');
if (/v8\.js-dos\.com\/latest\/js-dos\.js/.test(html)) fail('index.html hardcodes the unversioned js-dos script');

/* -------------------------------------------------------- id wiring ----- */
const sources = (await walk('src')).filter((file) => file.endsWith('.js'));
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
// ids created by shared scripts that we deliberately adopt/move
for (const injected of ['hd2ThemeToggle']) ids.add(injected);
const missing = new Map();
for (const file of sources) {
  const body = await text(file);
  for (const match of body.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const id = match[1];
    if (!ids.has(id)) {
      if (!missing.has(id)) missing.set(id, file);
    }
  }
}
for (const [id, file] of missing) fail(`${file} looks up #${id}, which index.html does not define`);
if (!missing.size) ok(`${ids.size} DOM ids, every getElementById target exists`);

/* ------------------------------------------------------------- imports --- */
for (const file of sources) {
  const body = await text(file);
  for (const match of body.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(join(ROOT, file)), match[1]);
    try {
      await stat(target);
    } catch (_) {
      fail(`${file} imports ${match[1]}, which does not exist`);
    }
  }
}
ok(`${sources.length} modules, relative imports resolve`);

/* -------------------------------------------------------------- engine --- */
const loader = await text('src/core/engine-loader.js');
const version = (await text('src/config.js')).match(/jsdosVersion:\s*'([^']+)'/);
if (!version) fail('src/config.js has no jsdosVersion');
else {
  if (!loader.includes('CONFIG.jsdosVersion')) fail('engine-loader does not read the pinned version');
  const css = await text('style.css');
  if (!css.includes(`js-dos@${version[1]}/dist/js-dos.css`)) {
    fail(`style.css does not import the pinned js-dos ${version[1]} stylesheet`);
  }
  ok(`js-dos pinned to ${version[1]} (script, wasm prefix and stylesheet)`);
}
if (/v8\.js-dos\.com\/latest/.test(loader)) {
  const fallbackLines = loader.split('\n').filter((line) => line.includes('v8.js-dos.com/latest'));
  // exactly one fallback source may exist: its script and its emulator prefix
  if (fallbackLines.length > 2) fail('more than the single documented fallback source still uses /latest/');
  else ok('the unversioned CDN survives only as the last-resort fallback source');
}

/* ---------------------------------------------------------- hygiene ----- */
const suspicious = [];
for (const file of sources) {
  const body = await text(file);
  if (/\bdebugger\b/.test(body)) suspicious.push(`${file}: debugger statement`);
  if (/console\.log\(/.test(body)) suspicious.push(`${file}: console.log`);
  if (/TODO|FIXME/.test(body)) suspicious.push(`${file}: TODO/FIXME left in code`);
}
for (const item of suspicious) fail(item);
if (!suspicious.length) ok('src/ has no debugger, console.log or TODO markers');

/* ------------------------------------------------------------- budget --- */
const css = await text('style.css');
if (css.length > 60000) fail(`style.css is ${Math.round(css.length / 1024)} KB (budget 60 KB)`);
const total = (await Promise.all(sources.map(async (file) => (await text(file)).length)))
  .reduce((sum, size) => sum + size, 0);
if (total > 140000) fail(`src/ is ${Math.round(total / 1024)} KB (budget 140 KB)`);
ok(`style.css ${Math.round(css.length / 1024)} KB · src/ ${Math.round(total / 1024)} KB`);

/* ---------------------------------------------------------- deliverables - */
for (const shot of ['redesign-pc.png', 'redesign-mobile.png']) {
  if (!(await exists(`../pkpilot0006/${shot}`))) {
    // screenshots live outside the repository on purpose; only warn here
    ok(`note: ${shot} is expected in work/pkpilot0006/ after the live capture`);
  }
}

/* ---------------------------------------------------------------- report - */
for (const note of notes) console.log(`  ok  ${note}`);
for (const problem of problems) console.error(`  !!  ${problem}`);
if (problems.length) {
  console.error(`static check failed: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('static check passed');
