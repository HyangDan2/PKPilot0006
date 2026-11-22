import { expect, test } from '@playwright/test';
import { bootGame, installEngine, snapshot, stub, waitReady } from './util.js';

test.use({ hasTouch: true, isMobile: true });

test.describe('phone portrait', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows the touch gamepad and sends its keys', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await expect(page.locator('html')).toHaveAttribute('data-touch', 'on');
    await expect(page.locator('#pad')).toBeVisible();

    await bootGame(page, 'digger');
    await expect(page.locator('#pad')).toBeVisible();

    const up = page.locator('#pad .pad-key[data-code="ArrowUp"]');
    await up.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true });
    await up.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true });

    const { keys } = await stub(page);
    expect(keys).toContainEqual([265, true]);
    expect(keys).toContainEqual([265, false]);
  });

  test('a pad tap before booting explains itself instead of failing silently', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    const up = page.locator('#pad .pad-key[data-code="ArrowUp"]');
    await up.dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', bubbles: true });
    await expect(page.locator('#toast')).toContainText('먼저 게임을 실행');
  });

  test('the pad can be hidden and shown again from the control bar', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await expect(page.locator('#pad')).toBeVisible();
    await page.click('#padToggleBtn');
    await expect(page.locator('#pad')).toBeHidden();
    await page.click('#padToggleBtn');
    await expect(page.locator('#pad')).toBeVisible();
  });

  test('the phone keyboard button opens the soft input only when running', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await page.click('#softKbBtn');
    await expect(page.locator('#toast')).toContainText('먼저 게임을 실행');
    await bootGame(page, 'digger');
    await page.click('#softKbBtn');
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    expect(focused).toBe('softKeyboard');
  });
});

test.describe('phone landscape', () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('becomes an immersive machine with a game picker still available', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await expect(page.locator('html')).toHaveAttribute('data-landscape', 'on');
    await expect(page.locator('.site-header')).toBeHidden();
    await expect(page.locator('.library')).toBeHidden();
    await expect(page.locator('#miniBar')).toBeVisible();
    await expect(page.locator('#miniGames .mini-game')).toHaveCount(3);

    // a game can be chosen before booting, while the phone is sideways
    await page.click('#miniGames .mini-game[data-game="doom"]');
    await page.waitForFunction(() => {
      const snap = window.__pkpilot.snapshot();
      return snap.session.state === 'running' && snap.target === 'doom';
    }, null, { timeout: 20000 });
    await expect(page.locator('#dosStage canvas')).toBeVisible();
    await expect(page.locator('#pad')).toBeVisible();
    expect(await snapshot(page)).toMatchObject({ target: 'doom', phase: 'running' });
  });

  test('the mini bar can hide the pad and leave immersive mode', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await page.click('#miniPadBtn');
    await expect(page.locator('#pad')).toBeHidden();
    await page.click('#miniPadBtn');
    await expect(page.locator('#pad')).toBeVisible();

    await page.click('#miniExitBtn');
    await expect(page.locator('html')).toHaveAttribute('data-landscape', 'off');
    await expect(page.locator('.site-header')).toBeVisible();
    await expect(page.locator('#miniBar')).toBeHidden();
  });

  test('rotating back to portrait restores the normal document', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    await expect(page.locator('html')).toHaveAttribute('data-landscape', 'on');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('html')).toHaveAttribute('data-landscape', 'off');
    await expect(page.locator('.library')).toBeVisible();
    await expect(page.locator('#pad')).toBeVisible();
  });
});
