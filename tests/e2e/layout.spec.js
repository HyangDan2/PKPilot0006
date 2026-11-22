import { expect, test } from '@playwright/test';
import { installEngine, waitReady } from './util.js';

const WIDTHS = [320, 360, 390, 414, 768, 1024, 1280, 1440];

test.describe('layout', () => {
  test('no horizontal overflow from 320 px to 1440 px', async ({ page }) => {
    await installEngine(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await waitReady(page);
      await page.waitForTimeout(120);
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        offender: (() => {
          const limit = window.innerWidth + 1;
          for (const el of document.querySelectorAll('body *')) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.right > limit) {
              return { tag: el.tagName, id: el.id, cls: el.className && String(el.className).slice(0, 60), right: Math.round(rect.right) };
            }
          }
          return null;
        })(),
      }));
      expect(metrics.offender, `overflowing element at ${width}px`).toBe(null);
      expect(metrics.scrollWidth, `scrollWidth at ${width}px`).toBeLessThanOrEqual(metrics.innerWidth + 1);
    }
  });

  test('control bar buttons never overlap each other', async ({ page }) => {
    await installEngine(page);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await waitReady(page);
      const overlaps = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('.controls > *')].filter((el) => el.offsetParent !== null);
        const rects = nodes.map((el) => ({ id: el.id || el.className, rect: el.getBoundingClientRect() }));
        const hits = [];
        for (let i = 0; i < rects.length; i += 1) {
          for (let j = i + 1; j < rects.length; j += 1) {
            const a = rects[i].rect;
            const b = rects[j].rect;
            const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (overlapX > 1 && overlapY > 1) hits.push(`${rects[i].id} × ${rects[j].id}`);
          }
        }
        return hits;
      });
      expect(overlaps, `control bar overlap at ${width}px`).toEqual([]);
    }
  });

  test('touch targets are at least 40 px on a phone', async ({ page }) => {
    await installEngine(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await waitReady(page);
    const small = await page.evaluate(() => {
      const selectors = ['.bar-btn', '.pad-key', '.mini-btn', '.game-card', '.disclosure > summary'];
      const limit = 40;
      const bad = [];
      for (const selector of selectors) {
        for (const el of document.querySelectorAll(selector)) {
          if (el.offsetParent === null) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < limit || rect.height < limit) {
            bad.push(`${selector} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
          }
        }
      }
      return bad;
    });
    expect(small).toEqual([]);
  });

  test('every interactive control has an accessible name and correct pressed state', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    const unnamed = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('button, a[href], input, [role="switch"]')) {
        if (el.offsetParent === null) continue;
        const name = (el.getAttribute('aria-label') || el.textContent || el.title || '').trim();
        if (!name) bad.push(el.id || el.className || el.tagName);
      }
      return bad;
    });
    expect(unnamed).toEqual([]);
    await expect(page.locator('#muteBtn')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#wasdBtn')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.game-card[data-game="digger"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the page keeps its SEO and share metadata', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);
    const meta = await page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content,
      ogImage: document.querySelector('meta[property="og:image"]')?.content,
      ogUrl: document.querySelector('meta[property="og:url"]')?.content,
      theme: document.documentElement.getAttribute('data-theme'),
      favicons: [...document.querySelectorAll('link[rel="icon"]')].length,
    }));
    expect(meta.title).toContain('DOS Player');
    expect(meta.description.length).toBeGreaterThan(50);
    expect(meta.ogImage).toContain('og-image.png');
    expect(meta.ogUrl).toBe('https://hyangdan2.github.io/PKPilot0006/');
    expect(meta.favicons).toBeGreaterThanOrEqual(2);
  });
});
