# Second review — what was wrong, what changed, how it is proven

Every item below names the defect, the code that now owns the behaviour, and the
test that fails without the fix. Runs: `node tools/static-check.mjs`,
`npx vitest run` (89), `npx playwright test` (desktop + iPhone 13 profile).

## P0 — immediate

| # | Defect | Fix | Tests |
|---|---|---|---|
| 1 | J and Z both send Ctrl, but both used the source id `keyboard`; lifting J sent the keyup for Z too | `src/input/keyboard.js` `sourceIdFor()` → `kbd:<code>`; the hold set in `src/input/input-manager.js` is keyed by that id | unit `keyboard.test.js` “gives every physical key its own source id”, `input-manager.test.js` “J and Z both fire Ctrl…”; E2E `qa-v2.spec.js` QA 1 |
| 2 | The page grabbed arrows/space/Enter before a game ran, and swallowed them while a control had focus | `keyboard.js` `claims()`: capture only while a session runs, never inside a text field, dialog or menu, and Space/Enter stay with a focused button/link/switch; the stage (`#dosStage`, `tabindex="0"`) takes focus when a game starts and when the picture is clicked (`player-view.focusStage`) | unit `keyboard.test.js` capture policy (5 cases); E2E QA 2 (cards on Enter/Space, mute on Space, arrows still reach DOS, nothing prevented while idle) |
| 3 | A new boot could mount while the previous runtime was still stopping (both in the same stage) | `src/core/session-manager.js`: one promise chain (`#enqueue`, `#settled`) serializes every teardown; `boot()` waits for the chain before it creates a runtime; `stop()` joins the same chain and keeps the UI honest with a generation check | unit `session-manager.test.js` “mounts the next runtime only after the previous stop resolved”, “never runs two teardowns at the same time”; E2E QA 3 (`canvasesAtBoot` all 0) |
| 4 | Teardown read `this.target` / cleared the whole mount, so a late stop could revoke the next generation’s Blob URL or delete its canvas | `#dispose()` freezes `{runtime, target, generation}` and hands that snapshot to `onBeforeStop`/`onAfterStop`; `dos-runtime.js` records the nodes it mounted (`#captureMount`) and removes only those | unit `session-manager.test.js` “frees the target snapshot…”, `dos-runtime.test.js` “removes only the nodes it mounted”; E2E QA 3 |

## P1 — stability

| # | Defect | Fix | Tests |
|---|---|---|---|
| 1 | A game card was ignored while another game booted (`if (this.busy) return`) | `src/ui/game-library.js` click handler always reports the pick; cards show `is-booting` / `is-running` state instead of blocking | E2E QA 3, `player.spec.js` “picking another game mid-boot…”; E2E QA 8 (card + mini bar + overlay + chip agree) |
| 2 | Volume and mute reset on game change and restart | one audio state in `main.js` (`applyAudio`, `setVolumeLevel`, `toggleMute`), applied to each new instance on `running`, persisted in `localStorage`; `player-view.setAudio()` moves the slider and the mini bar together | E2E QA 6 (mute across switch and restart, volume 40 % carried over); `player.spec.js` “mute and volume reach the emulator” |
| 3 | Scheduled taps/typed characters were not tracked, and the character queue survived a game change | `input-manager.js`: `#later()` records every timeout, `#clearTimers()` on release/blur/dispose, `setGeneration()` drops the queue and releases holds; queued work carries its generation | unit `input-manager.test.js` timers/generations (4 cases); E2E QA 5 |
| 4 | A cancelled or failed engine download could still repaint the screen | `startGame()` compares its boot token after every await and stays silent when it lost; `session` events from an older generation are dropped in `handleSessionEvent`; `EngineLoader.cancel()` aborts a hanging download (and `reset()` clears the remembered failure) | unit `engine-loader.test.js` “cancel rejects the pending load…”, “a retry after a cancel…”; E2E QA 7 (cancel a hanging download, then a network failure, then a clean retry) |
| 5 | `pagehide` revoked blob URLs while the emulator was still reading them, and a page back from bfcache showed a dead screen as “실행 중” | `main.js` lifecycle: `pagehide` stops the session first and releases what is left after the teardown; `pageshow` checks the canvas and returns to an honest idle screen with a toast | E2E `landscape.spec.js` page lifecycle (2 cases) |
| 6 | CI was not active | `.github/workflows/ci.yml` was attempted and refused by the GitHub App (`workflows` permission, HTTP 403). `docs/ci-workflow.yml` is kept current and tested against `package.json` | unit `ci-workflow.test.js` (triggers, commands, artefacts, 403 note, no stale copy) |

## P2 — UI finish

| # | Defect | Fix | Tests |
|---|---|---|---|
| 1 | Dark landscape pad kept its light glass skin: the selector was `[data-theme="dark"] html[data-landscape="on"]`, which can never match because `data-theme` sits on `<html>` itself | `style.css` → `html[data-theme="dark"][data-landscape="on"]` rules for `.pad-key`, `.pad-more`, `.pad-extra`, `.mini-game`, `.mini-btn`, `.mini-exit` | E2E `landscape.spec.js` dark mode (light skin vs navy skin, running chip keeps its accent) |
| 2 | The slider disagreed with the real audio state (mute forced it to 0/100 and ignored the level) | `player-view.setAudio({volume, muted})` is the only writer of the slider, the mute button, its label/icon and the mini-bar button | E2E QA 6 (`volumeRange` follows mute and the restored level) |
| 3 | Landscape controls were small and the 보조 키 opener was inside `.pad-head`, which landscape hid — Shift/Alt/weapons were unreachable on a phone | `.pad-head` keeps the opener visible, `.pad-more` floats at 36 px, pad keys and mini controls are 44 px, the extra row replaces the action keys instead of covering them | E2E `landscape.spec.js` “at least 44 px and none overlap”, “보조 키 opener is reachable” |
| 4 | Booting feedback was inconsistent between card, mini bar, overlay and status chip | `game-library.setPending()` + `data-state`, `.card-run` “부팅 중”, `.mini-game.is-booting`, overlay `data-phase` + `aria-busy` | E2E QA 8 |
| 5 | Device verification | iPhone 13 profile with touch input runs the mobile, landscape, player and QA suites on Chromium. WebKit (real iOS Safari) cannot start on this host (missing GTK/GStreamer/ICU libraries), and no physical phone was used | 41 mobile-project E2E runs |

## QA scenarios (the eight from the review)

1. `qa-v2.spec.js` QA 1 — J + Z, lift J, Ctrl stays down until Z lifts (plus pad + key).
2. QA 2 — Enter and Space run a focused card, Space starts from the run button, a focused control keeps only its own keys, nothing is intercepted before booting.
3. QA 3 — A → B → C with a 260 ms stop: every mount happens after the previous teardown, `canvasesAtBoot` all 0, no double stop, one canvas at the end.
4. QA 4 — local A → B → C: every URL is created once, revoked only after its own stop, `created = revoked + live`, the running bundle keeps its URL.
5. QA 5 — characters queued for a cancelled boot never reach the next game, and typing works again at once.
6. QA 6 — mute survives a game change and a restart; a 40 % level is carried into the next instance.
7. QA 7 — cancel a hanging download → idle; the next attempt fails cleanly with **다시 시도**; a newer pick is never overwritten by the old request.
8. QA 8 — CI definition verified in `ci-workflow.test.js`; live activation blocked by the App permission (403), reported instead of worked around.
