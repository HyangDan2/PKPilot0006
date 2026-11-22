import { expect, test } from '@playwright/test';
import { bootGame, installEngine, snapshot, stub, waitReady } from './util.js';

test.describe('key settings', () => {
  test('opening the dialog stops the game from receiving keys', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');

    await page.click('#keymapBtn');
    await expect(page.locator('#keymapModal')).toBeVisible();
    expect((await snapshot(page)).input.blocked).toBe(true);
    await expect(page.locator('#captureFlag')).toBeVisible();

    const before = (await stub(page)).keys.length;
    await page.keyboard.press('j');
    await page.keyboard.press('ArrowUp');
    expect((await stub(page)).keys.length).toBe(before);

    await page.click('#keymapDone');
    await expect(page.locator('#keymapModal')).toBeHidden();
    expect((await snapshot(page)).input.blocked).toBe(false);
  });

  test('remapping a key makes the new physical key reach DOS', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');

    await page.click('#keymapBtn');
    const slot = page.locator('.keyslot[data-action="fire"][data-slot="0"]');
    await slot.click();
    await expect(slot).toHaveClass(/is-listening/);
    await page.keyboard.press('q');
    await expect(slot).toHaveText('Q');
    await page.click('#keymapDone');

    await page.keyboard.down('q');
    await page.keyboard.up('q');
    const { keys } = await stub(page);
    expect(keys).toContainEqual([341, true]); // ControlLeft
    expect(keys).toContainEqual([341, false]);
    const km = await page.evaluate(() => window.__pkpilot.keymap());
    expect(km.fire[0]).toBe('KeyQ');
  });

  test('a conflicting key is swapped, never bound twice', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await page.click('#keymapBtn');

    await page.locator('.keyslot[data-action="forward"][data-slot="0"]').click();
    await page.keyboard.press('s'); // belongs to "back"
    await expect(page.locator('#keymapNote')).toContainText('서로 바꿨');
    const km = await page.evaluate(() => window.__pkpilot.keymap());
    expect(km.forward[0]).toBe('KeyS');
    expect(km.back[0]).toBe('KeyW');
    const all = Object.values(km).flat().filter(Boolean);
    expect(new Set(all).size).toBe(all.length);
  });

  test('a slot can be released and then lets the letter through', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');
    await page.click('#keymapBtn');

    const row = page.locator('.keydialog-row[data-action="fire"]');
    await row.locator('.keyclear[data-clear-slot="0"]').click();
    await expect(page.locator('#keymapNote')).toContainText('해제');
    await expect(row.locator('.keyslot[data-slot="0"]')).toHaveText('미설정');
    await page.click('#keymapDone');

    const km = await page.evaluate(() => window.__pkpilot.keymap());
    expect(km.fire[0]).toBe(null);
    await page.keyboard.down('j');
    await page.keyboard.up('j');
    const { keys } = await stub(page);
    // J is no longer a fire key: no Ctrl was sent for it
    expect(keys.filter(([code]) => code === 341)).toHaveLength(0);
  });

  test('the dialog close button restores input and keeps focus sensible', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await page.click('#keymapBtn');
    await expect(page.locator('#keymapModal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#keymapModal')).toBeHidden();
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    expect(focused).toBe('keymapBtn');
  });

  test('reset restores the shipped defaults', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await page.evaluate(() => window.__pkpilot.setKey('fire', 0, 'KeyQ'));
    await page.click('#keymapBtn');
    await page.click('#keymapReset');
    const km = await page.evaluate(() => window.__pkpilot.keymap());
    expect(km.fire[0]).toBe('KeyJ');
    expect(km.back[0]).toBe('KeyS');
  });
});

test.describe('advanced settings', () => {
  test('WASD off turns letters into typed characters', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await bootGame(page, 'digger');

    await page.click('#advancedDetails > summary');
    await page.click('#wasdBtn');
    await expect(page.locator('#wasdBtn')).toHaveAttribute('aria-checked', 'false');
    const before = (await stub(page)).keys.length;
    await page.keyboard.down('w');
    await page.keyboard.up('w');
    const after = (await stub(page)).keys.length;
    expect(after).toBe(before); // W is no longer forwarded as a DOS key

    const stored = await page.evaluate(() => localStorage.getItem('pkpilot0006:wasd'));
    expect(stored).toBe('0');
  });

  test('the pad can be forced on for a mouse-only desktop', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await expect(page.locator('#pad')).toBeHidden();
    await page.click('#advancedDetails > summary');
    await page.click('#padForceBtn');
    await expect(page.locator('#pad')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('pkpilot0006:padforce'))).toBe('1');
  });
});
