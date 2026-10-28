import { test, expect } from '@playwright/test';

const WIDTHS = [1024, 1280, 390];

test('the dancing sprite stays inside the viewport and off the page controls', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('[data-coo-toggle]');
  await expect(button).toBeVisible();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    if ((await page.locator('[data-ceilidh-coo]').getAttribute('data-out')) == null) {
      await button.click();
    }
    await page.waitForFunction(() => {
      const perch = document.querySelector('[data-ceilidh-coo]');
      const win = document.querySelector('.coo-window');
      if (!perch || !win) return false;
      const frame = getComputedStyle(perch).getPropertyValue('--frame').trim();
      return Math.abs(win.getBoundingClientRect().width - parseFloat(frame)) < 1;
    });

    const sprite = await page.locator('[data-ceilidh-coo]').boundingBox();
    expect(sprite, `sprite at ${width}`).toBeTruthy();
    expect(sprite.x, `left ${width}`).toBeGreaterThanOrEqual(-0.5);
    expect(sprite.y, `top ${width}`).toBeGreaterThanOrEqual(-0.5);
    expect(sprite.x + sprite.width, `right ${width}`).toBeLessThanOrEqual(width + 0.5);
    expect(sprite.y + sprite.height, `bottom ${width}`).toBeLessThanOrEqual(900 + 0.5);

    const hits = await page.evaluate(() => {
      const coo = document.querySelector('[data-ceilidh-coo]').getBoundingClientRect();
      const hitsBox = (box) => coo.left < box.right - 0.5
        && coo.right > box.left + 0.5
        && coo.top < box.bottom - 0.5
        && coo.bottom > box.top + 0.5;
      const seen = [];
      for (const el of document.querySelectorAll('a, button, .pill')) {
        if (el.closest('[data-ceilidh-coo]')) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const box = el.getBoundingClientRect();
        if (box.width < 1 || box.height < 1) continue;
        if (box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) continue;
        if (hitsBox(box)) seen.push((el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 80));
      }
      return seen;
    });
    expect(hits, `overlaps at ${width}`).toEqual([]);
  }
});
