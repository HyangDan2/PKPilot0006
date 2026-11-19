# HD2Lab | DOS Player (PKPilot0006)

A static instant player that runs classic DOS games in the browser with no install. [js-dos v8](https://js-dos.com/)
(DOSBox compiled to WebAssembly) drives the emulator and the page is served statically from GitHub Pages.

- Live: <https://hyangdan2.github.io/PKPilot0006/>
- Family: the same HD2Lab shell as Web-HQ and PKPilot0001–0005 (Soft Iris light, Navy & Lavender dark)
- Runtime: no build, no server. The library comes from the public js-dos CDN; your own files are read only in
  browser memory

## Instant-play bundles (all measured)

| # | Bundle | Original | Size | Licence | URL |
|---|------|------|------|----------|-----|
| 1 | Digger | Windmill Software, 1983 | 26,875 B | Freeware | `https://v8.js-dos.com/bundles/digger.jsdos` |
| 2 | DOOM (shareware Ep.1) | id Software, 1993 | 5,539,791 B | Shareware | `https://v8.js-dos.com/bundles/doom.jsdos` |
| 3 | Dhrystone 2 | R. P. Weicker (DOS/4GW) | 178,752 B | Benchmark | `https://v8.js-dos.com/bundles/dhry2.jsdos` |

All three URLs were confirmed with `curl` HTTP 200 and a real headless Chromium boot (canvas created and screen
rendered). `v8.js-dos.com/bundles/` returns `access-control-allow-origin` for the requesting origin, so there is no
CORS problem from GitHub Pages. The other candidate names (keen4, prince, wolf3d, duke3d, tetris, sopwith and
about 60 more) returned 404 on this CDN — those three bundles are all it publishes.

## Features

- **One-click boot** — Digger is selected first and the start veil's `▶ Play` boots it. `Dos()` is called inside
  the user's click, so browser autoplay policies never block the audio
- **Bundle switching** — one click on a library card `stop()`s the running instance and boots the new bundle
- **Run your own file** — drag and drop or pick a `.jsdos` / `.zip`. It opens with `URL.createObjectURL(file)`, and
  dropping the file anywhere on the page routes it to the player. Files are never sent to a server
- **Fullscreen** — the screen shell switches to the native Fullscreen API, and an `Exit fullscreen` button stays
  available inside it (Esc can be intercepted by DOS)
- **Input through the js-dos CommandInterface** — the `ci` (CommandInterface) is taken from
  `Dos(stage, { onEvent })`'s `"ci-ready"` and every key goes in through `ci.sendKeyEvent(kbdCode, pressed)`. Keys
  reach the emulator even when focus is outside the canvas, and without ever clicking the canvas
- **Virtual gamepad** — direction · Enter · Space · Ctrl · Esc · Y · N plus a second row of `Shift` (run), `Alt`
  (strafe) and `1`–`4` (weapons). `pointerdown` captures the press with `setPointerCapture` and only `pointerup`,
  `pointercancel` or `lostpointercapture` release it (the old `pointerleave` release broke movement when a finger
  drifted off a button). Multi-touch (move + fire) is supported, and `blur`, `visibilitychange` and `pagehide`
  release everything so a key never sticks
- **Per-game key profile** — this DOOM shareware bundle ships its own `DEFAULT.CFG`, so the up/down arrows do
  nothing in gameplay (`key_up=W`, `key_down=S`, `key_strafeleft/right=A/D`, `key_left/right` = the left/right
  arrows, `key_fire=Ctrl`, `key_use=Space`, `key_speed=Shift`). So in DOOM the d-pad ▲▼ sends `W`+`↑` and ◀▶ sends
  `←`/`→` — walk with W/S in gameplay and navigate menus with the arrows. Digger and the rest keep the plain arrows
- **PC keyboard binding (WASD mode, on by default, remembered in `localStorage`)** — `W`/`A`/`S`/`D` → movement,
  `J`·`Z` → `Ctrl` (fire), `K`·`X` → `Space`, `L`·`C` → `Enter`. Arrows, `Ctrl`, `Space`, `Enter`, `Esc`, `1`–`7`
  and `Y`/`N` always work regardless of the mode. So a key is never sent twice, js-dos's `window` key listener is
  stopped with `stopPropagation` for these keys and only `ci.sendKeyEvent` is called. Page scrolling on arrows and
  Space is blocked too
- **The virtual pad is touch-only** — screens whose primary pointer is a mouse
  (`@media (hover: hover) and (pointer: fine)`, `maxTouchPoints=0`) hide `.pad`. For hybrid devices such as touch
  laptops the `⋮` menu has a **force-show virtual gamepad** toggle (remembered in `localStorage`)
- **PC key settings dialog (desktop)** — the `Key settings` button in the play bar opens a dialog with the app's
  own theme. Tap one of the 20 key cells across 10 actions (forward / back / left / right / fire / use / confirm /
  run / strafe / menu) and press the key you want; it maps to the exact `KBD_*` code that `ci.sendKeyEvent` sends.
  Picking a key another action uses **swaps the two** and shows a notice. The map is stored in `localStorage`
  (`pkpilot0006:keymap`) and the legend under the play bar updates at once, with `Reset defaults` and `Close`;
  keys never leak into the game while the dialog is open (Esc cancels an entry, a second Esc closes)
- **Mobile landscape fullscreen overlay** — turning the phone sideways (or going fullscreen while landscape) hides
  the header, hero, side panel and play bar, and the canvas fills `100vw × 100dvh`. A translucent D-pad (bottom
  left) and action buttons (bottom right) float over the game (opacity .45, .85 while pressed), and `Shift`, `Alt`
  and `1`–`4` expand from a `＋` chip. The mini bar at the top right holds `Hide pad / Show pad`, `⌨️ Virtual
  keyboard`, `🔊 Sound` and `✕ Exit` (leave fullscreen or fold the overlay). It **never uses
  `screen.orientation.lock()` or a forced 90° rotation**
- **Phone keyboard input (⌨️)** — the `⌨️` button on the mobile play bar and the landscape mini bar focuses a
  1px hidden `<input>` to raise the OS keyboard and converts characters from `input`/`beforeinput` events into
  `ci.sendKeyEvent` calls (covering the Android IME case where `keydown` carries `keyCode 229` with no character).
  `Enter` and `Backspace` are sent as `257` and `259`
- **Key guide** — a compact legend under the play bar (`W A S D move · ← → turn · J/Z fire …`) on desktop, and a
  per-game key table in the control guide panel
- **Sound and restart** — `setVolume(0|1)`, and `stop()` followed by a fresh boot
- **Deep links and memory** — `?game=doom` jumps straight to a bundle, and the last game is remembered in
  `localStorage`
- **Responsive** — two columns at 1440×900, one column at 390×844, landscape overlay at 844×390, zero horizontal
  overflow (checked at 320, 768 and 1024px)

## Cleaning up js-dos chrome

js-dos injects its own sidebar (save, keyboard, zoom, performance, settings). This app provides the same features
in its own toolbar, so the injected `.sidebar-thin`, spacer (`.w-4`) and background image are hidden with CSS and
the canvas is centred. Mouse capture is off — enabling it covers the screen with a “Click to capture mouse” notice.
The Dhrystone performance overlay js-dos runs at start (`.dhry2-window`) is hidden too, and the app uses its own
boot veil.

## Files

| File | Purpose |
|------|------|
| `index.html` | markup + OG/PWA meta + theme pre-paint |
| `style.css` | Soft Iris / Navy & Lavender shell, player · library · pad · key settings dialog · landscape overlay layout; the DOS stage itself stays `#000` |
| `app.js` | js-dos loader, boot state machine, file running, fullscreen, CommandInterface input (pad, keyboard, per-game profile, key remapping, soft keyboard, landscape overlay) |
| `assets/hd2-theme.*` | shared theme tokens and the 44px floating light/dark toggle |
| `manifest.json` | PWA manifest |
| `og-image.png` | 1200×630 social card |
| `favicon.*`, `icon-*.png`, `apple-touch-icon.png` | favicon set (dual-skew mark) |
| `tools/make_assets.py` | favicon and OG card generator |

## Verification (2026-11-16, headless Chromium)

**Key settings · landscape overlay · soft keyboard (all 45 items passed)**

| Item | Result |
|---|---|
| 1440×900 desktop | `.pad` `display:none` (height 0), the `⋮` force-show toggle turns on and off, `Key settings` visible and `⌨️ Keyboard` hidden |
| Key settings dialog | 10 rows × 20 cells, defaults match the spec, remapping `fire` J→F updates the legend to `F / Z / Ctrl` and survives a reload and `localStorage` |
| Duplicate key | Entering F for `use` swaps it with `fire` cell 1 and shows the notice |
| Esc | Esc while entering cancels the entry (dialog stays); a second Esc closes the dialog and returns focus to `Key settings` |
| DOOM in play | keyboard `Enter`→`257`, remapped `F`→`341` down/up once, ammo HUD drops (199 pixel difference), `W`→`87` moves |
| WASD toggle | on, `J`→`341`; off, `J`→`74` (the letter); `Enter`→`257` either way |
| Reset defaults | all 10 actions back to the spec defaults |
| 390×844 portrait | pad shown, `Key settings` hidden, `⌨️ Keyboard` shown, pad Enter→`257`, soft keyboard `w k1`→`87·75·49·32`, `Enter`→`257`, `Backspace`→`259` |
| 844×390 landscape | overlay on, header/hero/side/play bar/footer all hidden, shell 844×390, D-pad bottom left and actions bottom right, key opacity 0.45→0.85 pressed, `＋` chip expands Shift/Alt/1–4 |
| Landscape mini bar | four buttons (hide/show pad · ⌨️ · 🔊 · ✕), hide/show and mute work, ✕ folds the overlay, rotating back resumes |
| Landscape soft keyboard | `w s 2`→`87·83·50` |
| Console/network | zero errors and zero failed requests in all three environments |
| Horizontal overflow | zero at 320, 360, 390, 768, 844, 1024, 1180 and 1440px |
| Button surfaces | selectors strengthened so js-dos's late-injected preflight (`button[type=button]{background-color:transparent}`) cannot clear button backgrounds |

**Earlier rounds**

- Local server at 1440×900: Digger booted in 2.7 s, zero console errors, zero page errors, zero failed requests,
  zero 4xx, zero horizontal overflow
- `?game=doom` booted in 2.6 s and `?game=dhrystone` in 1.6 s, each creating a 640×400 canvas
- Running the local `digger.jsdos` through the file input succeeded (`01 / RUNNING`)
- Virtual pad: ArrowDown in the DOOM menu changed the screen by 63px on average = input reached the emulator
- Mute `aria-pressed=true`, fullscreen enter/exit, and canvas recreated after restart confirmed
- 390×844: zero horizontal overflow, canvas scaled to 325×203 inside the shell
- Not verified: real-device (iOS Safari, Android KakaoTalk in-app) touch, audio and soft keyboard; load time for
  large (tens of MB) bundles

## Licence

The bundles link to files the js-dos project distributes publicly (they are not redistributed here). Copyright in
each original work belongs to its owner.
