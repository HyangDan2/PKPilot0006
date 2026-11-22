import { describe, expect, it } from 'vitest';
import { InputManager } from '../../src/input/input-manager.js';
import { makeClock } from './helpers.js';

function makeInput(options = {}) {
  const clock = makeClock();
  const sent = [];
  const manager = new InputManager({
    send: (code, down) => { sent.push([code, down]); },
    tapHoldMs: 60,
    gapMs: 20,
    timers: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    ...options,
  });
  return { manager, sent, clock };
}

describe('InputManager reference counting', () => {
  it('sends one keydown even when two sources hold the same DOS key', () => {
    const { manager, sent } = makeInput();
    manager.press('ArrowUp', 'keyboard');
    manager.press('ArrowUp', 'pad:0');
    expect(sent).toEqual([['ArrowUp', true]]);
    expect(manager.sourcesOf('ArrowUp').sort()).toEqual(['keyboard', 'pad:0']);
  });

  it('does not send keyup until the last source lets go', () => {
    const { manager, sent } = makeInput();
    manager.press('ArrowUp', 'keyboard');
    manager.press('ArrowUp', 'pad:0');
    manager.release('ArrowUp', 'pad:0');
    expect(sent).toEqual([['ArrowUp', true]]);
    expect(manager.isHeld('ArrowUp')).toBe(true);
    manager.release('ArrowUp', 'keyboard');
    expect(sent).toEqual([['ArrowUp', true], ['ArrowUp', false]]);
    expect(manager.isHeld('ArrowUp')).toBe(false);
  });

  it('keeps a move and a fire key down at the same time', () => {
    const { manager, sent } = makeInput();
    manager.press('KeyW', 'keyboard');
    manager.press('ControlLeft', 'keyboard');
    expect(sent).toEqual([['KeyW', true], ['ControlLeft', true]]);
    manager.release('KeyW', 'keyboard');
    expect(manager.isHeld('ControlLeft')).toBe(true);
    expect(sent).toEqual([['KeyW', true], ['ControlLeft', true], ['KeyW', false]]);
  });

  it('releaseSource only lifts what that source holds', () => {
    const { manager, sent } = makeInput();
    manager.press('ArrowUp', 'pad:1');
    manager.press('ArrowUp', 'keyboard');
    manager.press('KeyW', 'keyboard');
    manager.releaseSource('pad:1');
    expect(manager.isHeld('ArrowUp')).toBe(true);
    expect(sent.filter(([, down]) => !down)).toHaveLength(0);
    manager.releaseSource('keyboard');
    expect(manager.heldCodes()).toEqual([]);
    expect(sent.filter(([, down]) => !down).map(([code]) => code).sort()).toEqual(['ArrowUp', 'KeyW']);
  });

  it('repeated press from the same source is a no-op', () => {
    const { manager, sent } = makeInput();
    manager.press('KeyW', 'keyboard');
    manager.press('KeyW', 'keyboard');
    expect(sent).toEqual([['KeyW', true]]);
  });

  it('releaseAll lifts every held key exactly once', () => {
    const { manager, sent } = makeInput();
    manager.press('KeyW', 'keyboard');
    manager.press('ArrowUp', 'pad:0');
    manager.press('ArrowUp', 'keyboard');
    const count = manager.releaseAll('blur');
    expect(count).toBe(2);
    expect(sent.filter(([, down]) => !down)).toHaveLength(2);
    expect(manager.heldCodes()).toEqual([]);
    expect(manager.releaseAll()).toBe(0);
  });
});

describe('InputManager character queue', () => {
  it('types the same character three times instead of collapsing it', async () => {
    const { manager, sent, clock } = makeInput();
    manager.typeCodes(['KeyA', 'KeyA', 'KeyA']);
    expect(manager.pendingChars).toBe(3);
    await clock.advance(1000);
    expect(sent).toEqual([
      ['KeyA', true], ['KeyA', false],
      ['KeyA', true], ['KeyA', false],
      ['KeyA', true], ['KeyA', false],
    ]);
    expect(manager.pendingChars).toBe(0);
  });

  it('types characters one at a time (sequential queue, not a burst)', async () => {
    const { manager, sent, clock } = makeInput();
    manager.typeCodes(['KeyD', 'KeyO', 'KeyO', 'KeyM']);
    await clock.advance(61);
    expect(sent).toEqual([['KeyD', true], ['KeyD', false]]);
    await clock.advance(19 + 60);
    expect(sent.slice(2, 4)).toEqual([['KeyO', true], ['KeyO', false]]);
    await clock.advance(1000);
    expect(sent.filter(([, down]) => down).map(([code]) => code)).toEqual(['KeyD', 'KeyO', 'KeyO', 'KeyM']);
  });

  it('drops the queue when the capture gate closes', async () => {
    const { manager, sent, clock } = makeInput();
    manager.typeCodes(['KeyA', 'KeyB', 'KeyC']);
    manager.block('settings');
    const before = sent.length;
    await clock.advance(1000);
    expect(sent.length).toBe(before);
    expect(manager.pendingChars).toBe(0);
  });
});

describe('InputManager capture gate', () => {
  it('refuses new presses while blocked and lifts held keys on block', () => {
    const { manager, sent } = makeInput();
    manager.press('KeyW', 'keyboard');
    manager.block('settings');
    expect(manager.captureBlocked).toBe(true);
    expect(sent).toEqual([['KeyW', true], ['KeyW', false]]);
    expect(manager.press('KeyA', 'keyboard')).toBe(false);
    expect(sent).toHaveLength(2);
    manager.unblock('settings');
    expect(manager.press('KeyA', 'keyboard')).toBe(true);
  });

  it('needs every blocker to clear before keys flow again', () => {
    const { manager } = makeInput();
    manager.block('settings');
    manager.block('menu');
    manager.unblock('settings');
    expect(manager.captureBlocked).toBe(true);
    manager.unblock('menu');
    expect(manager.captureBlocked).toBe(false);
  });

  it('tap sends a down/up pair and releases it on the clock', async () => {
    const { manager, sent, clock } = makeInput();
    manager.tap('Enter');
    expect(sent).toEqual([['Enter', true]]);
    await clock.advance(60);
    expect(sent).toEqual([['Enter', true], ['Enter', false]]);
  });
});

describe('InputManager teardown', () => {
  it('dispose clears the queue and releases everything', async () => {
    const { manager, sent, clock } = makeInput();
    manager.press('KeyW', 'keyboard');
    manager.typeCodes(['KeyA', 'KeyB']);
    manager.dispose();
    expect(manager.heldCodes()).toEqual([]);
    await clock.advance(1000);
    expect(sent.filter(([, down]) => down)).toHaveLength(2); // KeyW + the first queued char
    expect(manager.pendingChars).toBe(0);
  });
});
