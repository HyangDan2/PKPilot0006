import { expect, test } from '@playwright/test';
import { installEngine, waitReady } from './util.js';

const WIDTHS = [320, 360, 390, 414, 768, 1024, 1280, 1440];

async function measureContrast(page) {
  return page.evaluate(() => {
    const parse = (color) => {
      const match = color.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(',').map((value) => parseFloat(value));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    const contrast = (fg, bg) => {
      const l1 = luminance(fg);
      const l2 = luminance(bg);
      const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
      return (light + 0.05) / (dark + 0.05);
    };
    // walk up for the first opaque background
    const backdrop = (el) => {
      let node = el;
      while (node) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg && bg.a > 0.9) return bg;
        node = node.parentElement;
      }
      return parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    };
    const targets = [
      ['h1', 3.0], ['.player-lede', 4.5], ['.card-blurb', 4.5], ['.card-meta', 4.5],
      ['.bar-btn', 4.5], ['.primary-btn', 4.5], ['.state-chip', 4.5], ['.panel-foot', 4.5],
      ['.disclosure > summary', 4.5], ['.section-head p', 4.5], ['.game-card .card-title', 4.5],
    ];
    const failures = [];
    for (const [selector, minimum] of targets) {
      const el = document.querySelector(selector);
      if (!el || el.offsetParent === null) continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      if (!fg) continue;
      const ratio = contrast(fg, backdrop(el));
      if (ratio < minimum) failures.push(`${selector}: ${ratio.toFixed(2)} < ${minimum}`);
    }
    return failures;
  });
}

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

  test('text contrast meets WCAG AA in both themes', async ({ page }) => {
    await installEngine(page);
    await page.goto('/');
    await waitReady(page);

    // colour transitions would otherwise be sampled mid-fade and report a
    // contrast the resting state never has
    await page.addStyleTag({ content: '*{transition:none!important;animation:none!important}' });

    const measure = async () => measureContrast(page);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => window.HD2Theme.set(value, { persist: false }), theme);
      await page.waitForTimeout(120);
      const failures = await measure();
      expect(failures, `contrast failures in ${theme}`).toEqual([]);
    }
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
