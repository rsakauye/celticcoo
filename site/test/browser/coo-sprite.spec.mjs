import { test, expect } from '@playwright/test';

const WIDTHS = [1024, 1280, 390];

test('the dancing sprite stays inside the viewport', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('[data-coo-toggle]');
  await expect(button).toBeVisible();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    if (await page.locator('[data-ceilidh-coo]').getAttribute('data-out') == null) {
      await button.click();
    }
    await page.waitForFunction(() => {
      const win = document.querySelector('.coo-window');
      if (!win) return false;
      const frame = getComputedStyle(document.querySelector('[data-ceilidh-coo]')).getPropertyValue('--frame').trim();
      return Math.abs(win.getBoundingClientRect().width - parseFloat(frame)) < 1;
    });

    const viewport = page.viewportSize();
    for (const selector of ['.coo-window', '[data-ceilidh-coo]']) {
      const box = await page.locator(selector).boundingBox();
      expect(box, selector).toBeTruthy();
      expect(box.x, `${selector} left at ${width}`).toBeGreaterThanOrEqual(0);
      expect(box.y, `${selector} top at ${width}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${selector} right at ${width}`).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(box.y + box.height, `${selector} bottom at ${width}`).toBeLessThanOrEqual(viewport.height + 0.5);
    }
  }
});
