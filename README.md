# HD2Lab | DOS Player (PKPilot0006)

A static instant player that runs classic DOS games in the browser with no install. [js-dos v8](https://js-dos.com/)
(DOSBox compiled to WebAssembly) drives the emulator, and the page is served statically from GitHub Pages.

- Live: <https://hyangdan2.github.io/PKPilot0006/>
- Family: the same HD2Lab shell as Web-HQ and the other PKPilot apps (Soft Iris light, Navy & Lavender dark)
- Runtime: no build step and no server. js-dos is pinned to one version; the bundles come from the public
  js-dos CDN, and your own file is read only in browser memory

## Architecture

```
index.html                 Player-first markup (screen → control bar → pad → disclosures → library)
style.css                  Shell + responsive/immersive layout; js-dos CSS is imported into a low-priority layer
src/
  main.js                  Wiring only: engine, session, input, views
  config.js                Pinned js-dos version, timeouts, storage keys
  core/
    engine-loader.js       idle → loading → ready/failed, one script node, retry with a fallback source
    dos-runtime.js         One js-dos instance per generation; running = ci-ready + painted canvas
    session-manager.js     Boot generations, newest-wins policy, ordered teardown
  input/
    keymap.js              Physical key ⇄ DOS key model, profiles, store (pure functions)
    input-manager.js       Reference-counted key holds, character queue, capture gate
    keyboard.js            Physical keyboard source
    gamepad.js             Touch gamepad + phone keyboard sources
  files/local-bundle.js    .jsdos/.zip validation and Blob URL ownership
  ui/
    player-view.js         Screen, overlay (idle/booting/error), control bar, chips, toast
    game-library.js        Thumbnail cards, benchmark row, mini picker, drop zone
    settings-dialog.js     Key settings dialog (listen, swap, release, reset)
    responsive-mode.js     Touch detection, immersive landscape, pad show/hide
  data/games.js            Bundle metadata + captured thumbnails
tests/unit                 Vitest (~84 tests, no DOM needed — everything is injected)
tests/e2e                  Playwright with a stubbed js-dos module (desktop + iPhone 13 profile)
tools/                     static check, local server, thumbnail and screenshot capture
```

### Runtime state machine (Phase 1)

| State | Meaning | What the UI shows |
|---|---|---|
| `idle` | nothing booted | overlay with the selected game and **실행** |
| `booting` | engine loading or bundle starting | booting overlay with progress and **취소** |
| `running` | `ci-ready` arrived **and** the canvas has real dimensions **and** a frame was painted | game visible, controls enabled |
| `error` | engine, boot or canvas failure | error overlay with the reason and **다시 시도** |

* Every boot gets a **generation id**. Late events, late `ci-ready` signals and late canvas appearances from a
  superseded generation are dropped, and the stale runtime is stopped.
* Picking another game (or a file) while booting **replaces** the request: the old runtime is stopped in order —
  keys released → js-dos instance stopped → timers cleared → mount nodes removed → Blob URL revoked.
* Teardown is **serialized**: `stop()` and every replacement share one promise chain, so a runtime that is still
  shutting down never shares the stage with the next generation. Each teardown works on a snapshot (runtime, target,
  generation), removes only the nodes it mounted, and releases only its own Blob URL.
* Volume and mute are one state (slider · mini bar · emulator) applied again to every new instance, and remembered
  in `localStorage`, so switching games or restarting keeps the level.
* `loadEngine()` remembers a failure. A retry is an explicit `force` and injects a fresh script node (never a
  second one), and the second attempt uses the official CDN as a fallback source.
* js-dos, its emulator wasm and its stylesheet are all pinned to **8.5.4**; the unversioned `/latest/` URL exists
  only as the last-resort fallback.

### Input engine (Phase 2)

* Every input source has an id (`kbd:KeyJ`, `pad:3`, `type:12`, `tap:4`) and a DOS key is held while at least one
  source holds it — a finger lifting cannot cut a physical key, two sources never send a double keydown, and J and Z
  (both mapped to Ctrl) can be held together: lifting J leaves Ctrl down for Z.
* Typed characters go through a **sequential queue** (down → hold → up → gap), so `aaa` really reaches DOS as three
  keystrokes. Every timer the manager owns is recorded and cancelled on release/blur/generation change, and the queue
  belongs to one input generation — a character typed for game A never lands in game B.
* Nothing is intercepted **before a game runs**: Tab, Space, Enter and typing work normally. While a game runs the
  stage holds focus and takes every key, except that a focused control keeps the keys that operate it (Space/Enter on
  a button or link, every key in a text field, a dialog or a menu). Arrows, letters and Ctrl still reach the game.
* A **capture gate** closes while the settings dialog is open: no key reaches the game, everything held is
  released, and the screen shows `게임 키 입력 일시정지`.
* `blur`, `visibilitychange`, `pagehide`, `pointercancel` and `lostpointercapture` all release held keys.
* Key settings: a key already in use is **swapped**, a slot can be **released** (× → `미설정`), and per-action or
  full reset never leaves two slots holding the same physical key.

### Player-first layout (Phase 3)

The screen is the first thing on the page, the library sits under it, and every run control lives in one bar
(restart · mute + volume · fullscreen · key settings · pad · keyboard). Key help and advanced settings are
collapsed disclosures. Cards use thumbnails captured from the real emulator (`thumbs/*.png`), the benchmark entry
is a separate row, and the local file drop zone is a card of its own. On a phone in landscape the page becomes the
machine: full-viewport screen, translucent floating pad, and a mini bar that keeps the game picker, sound, keyboard
and exit reachable before and after booting.

## Tests

```bash
npm ci
node tools/static-check.mjs   # files, imports, DOM ids, pinned engine, size budget
npx vitest run                # unit tests
npx playwright test           # E2E on desktop + an iPhone 13 profile, js-dos replaced by a recording stub
```

The E2E suite runs without downloading the emulator: `tests/e2e/util.js` serves a stub `js-dos.js` that reports
`ci-ready`, records every `sendKeyEvent`, and can fail on purpose (`fail: 'no-ci' | 'canvas' | 'never'`, plus
`stopDelay` for a slow teardown) to exercise the error and race paths. `tests/e2e/qa-v2.spec.js` holds the eight
second-review scenarios; `tests/e2e/landscape.spec.js` holds the phone-landscape and page-lifecycle runs.

The CI definition is kept in `docs/ci-workflow.yml` (same commands as `npm test`) because the GitHub App that pushes
for this repository has no `workflows` scope: an attempt to add `.github/workflows/ci.yml` is refused with HTTP 403.

## Verified in this build

| Area | Result |
|---|---|
| Real emulator boot (headless Chromium, live bundles) | Digger 6.2 s · DOOM 3.4 s · Dhrystone 1.1 s to `running`, canvas 947×592 |
| Thumbnails | captured from those boots (`thumbs/digger.png`, `doom.png`, `dhrystone.png`) |
| Horizontal overflow | 0 at 320 / 360 / 390 / 414 / 768 / 1024 / 1280 / 1440 px |
| Unit suite | input ref-counting per physical key, char queue + timers + generations, keymap swap/release/reset, loader failure/retry/timeout/cancel, runtime readiness + teardown snapshot, 30 switches, serialized teardown, Blob URL order |
| Second review (unit + E2E) | 8 QA scenarios: J+Z · Enter/Space on cards · A→B→C under a slow teardown · local A→B→C URL order · cancel while typing · mute across game change/restart · cancel + network failure · CI definition |
| Mobile pass | iPhone 13 metrics with touch input on Chromium (layout, pad, landscape, lifecycle) |
| Not verified | a real iPhone (Safari/WebKit — the sandbox is missing its GTK/GStreamer libraries) or Android device; audio output; very large (tens of MB) bundles |

## Notes

* js-dos injects its own sidebar, background and Dhrystone overlay; they are hidden with CSS because this app has
  its own chrome. Mouse capture stays off (it covers the screen with a "click to capture" notice).
* js-dos ships Tailwind's preflight, whose `button[type=button] { background: transparent }` would otherwise erase
  our button surfaces. `style.css` imports the js-dos stylesheet into `layer(engine)` so unlayered app rules always
  win, regardless of load order or specificity.
* The bundles link to files the js-dos project distributes publicly (they are not redistributed here). Copyright in
  each original work belongs to its owner.
