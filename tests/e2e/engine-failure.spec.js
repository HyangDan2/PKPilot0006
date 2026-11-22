import { expect, test } from '@playwright/test';
import { STUB_SOURCE, breakEngine, installEngine, snapshot, waitReady } from './util.js';

async function retryStub(page) {
  await page.unroute('**/js-dos.js');
  await page.route('**/js-dos.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: STUB_SOURCE,
  }));
}

test.describe('engine failures', () => {
  test('a network failure shows an error with a retry that actually works', async ({ page }) => {
    await breakEngine(page, { mode: 'network' });
    await page.goto('/');
    await waitReady(page);

    await page.click('#playBtn');
    await expect(page.locator('#screenShell')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#overlayTitle')).toContainText('실행 실패');
    await expect(page.locator('#overlaySub')).toContainText(/네트워크|불러오지/);
    await expect(page.locator('#retryBtn')).toBeVisible();
    await expect(page.locator('#engineChip')).toHaveAttribute('data-state', 'failed');

    // the failure is remembered: no duplicate script sneaks in while idle
    expect(await page.locator('script[data-jsdos-js]').count()).toBeLessThanOrEqual(1);

    await retryStub(page);
    await page.click('#retryBtn');
    await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'running', null, { timeout: 20000 });
    await expect(page.locator('#screenOverlay')).toBeHidden();
    await expect(page.locator('#retryBtn')).toBeHidden();
    expect((await snapshot(page)).engine.state).toBe('ready');
  });

  test('a hanging engine trips the timeout instead of waiting forever', async ({ page }) => {
    await breakEngine(page, { mode: 'hang', init: { engineTimeoutMs: 1500 } });
    await page.goto('/');
    await waitReady(page);
    await page.click('#playBtn');
    await expect(page.locator('#screenShell')).toHaveAttribute('data-state', 'error', { timeout: 12000 });
    await expect(page.locator('#overlaySub')).toContainText(/초를 넘었습니다|네트워크/);
    const snap = await snapshot(page);
    expect(snap.engine.state).toBe('failed');
    expect(snap.engine.attempts).toBeGreaterThanOrEqual(1);
  });

  test('a boot that never signals ci-ready fails and stays retryable', async ({ page }) => {
    await installEngine(page, { init: { fail: 'no-ci', bootTimeoutMs: 1200 } });
    await page.goto('/');
    await waitReady(page);
    await page.click('.game-card[data-game="digger"]');
    await expect(page.locator('#screenShell')).toHaveAttribute('data-state', 'error', { timeout: 15000 });
    await expect(page.locator('#overlaySub')).toContainText(/부팅을 마치지/);
    await expect(page.locator('#retryBtn')).toBeVisible();
    const snap = await snapshot(page);
    expect(snap.session.state).toBe('error');
    expect(snap.input.held).toEqual([]);

    // let the next attempt succeed and press retry
    await page.evaluate(() => { window.__PK6_STUB__.fail = null; });
    await page.unroute('**/js-dos.js');
    await page.route('**/js-dos.js', (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: STUB_SOURCE,
    }));
    await page.click('#retryBtn');
    await page.waitForFunction(() => window.__pkpilot.snapshot().session.state === 'running', null, { timeout: 20000 });
  });

  test('a canvas that never appears is reported as a canvas failure', async ({ page }) => {
    await installEngine(page, { init: { fail: 'canvas', frameTimeoutMs: 900 } });
    await page.goto('/');
    await waitReady(page);
    await page.click('#playBtn');
    await expect(page.locator('#screenShell')).toHaveAttribute('data-state', 'error', { timeout: 15000 });
    await expect(page.locator('#overlaySub')).toContainText(/화면/);
  });
});
