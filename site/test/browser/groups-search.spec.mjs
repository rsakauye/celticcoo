import { test, expect } from '@playwright/test';

async function typeQuery(page, query) {
  const box = page.locator('#g-q');
  await box.click();
  await box.pressSequentially(query, { delay: 30 });
}

test('typing a query keeps matching clubs visible', async ({ page }) => {
  await page.goto('/groups/');
  await expect(page.locator('#g-count')).toContainText(/\d+ groups/);
  await expect.poll(() => page.locator('#g-clear').evaluate((el) => getComputedStyle(el).display)).toBe('none');

  await typeQuery(page, 'ca');
  await expect(page.locator('#g-count')).not.toHaveText('0 groups');
  await expect(page.locator('.grp:not([hidden])').filter({ hasText: 'Calgary' }).first()).toBeVisible();

  await typeQuery(page, 'lgary');
  await expect(page.locator('#g-q')).toHaveValue('calgary');
  await expect(page.locator('#g-count')).toHaveText('15 groups');
  const visible = page.locator('.grp:not([hidden])');
  await expect(visible).toHaveCount(15);
  await expect(visible.first()).toBeVisible();
  await expect.poll(() => page.locator('.grp[hidden]').first().evaluate((el) => getComputedStyle(el).display)).toBe('none');
});

test('typing and ?q= on load show the same clubs', async ({ page }) => {
  await page.goto('/groups/?q=calgary');
  await expect(page.locator('#g-q')).toHaveValue('calgary');
  await expect(page.locator('#g-count')).toHaveText('15 groups');

  await page.goto('/groups/');
  await typeQuery(page, 'calgary');
  await expect(page.locator('#g-count')).toHaveText('15 groups');
  await expect(page.locator('.grp:not([hidden])')).toHaveCount(15);
});

test('blocked storage and a rejected history update do not hide every club', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('blocked', 'SecurityError'); },
    });
    history.replaceState = () => { throw new DOMException('blocked', 'SecurityError'); };
  });
  await page.goto('/groups/');
  await expect(page.locator('.grp:not([hidden])')).not.toHaveCount(0);
  await typeQuery(page, 'ca');
  await expect(page.locator('#g-count')).not.toHaveText('0 groups');
  await typeQuery(page, 'lgary');
  await expect(page.locator('#g-count')).toHaveText('15 groups');
  await expect(page.locator('.grp:not([hidden])').filter({ hasText: 'Calgary' }).first()).toBeVisible();
});

test('typing still filters with accessibility options on', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('a11y', JSON.stringify({
      space: 'on', links: 'on', size: 'xl', font: 'readable', contrast: 'high', cb: 'on', motion: 'reduce',
    }));
  });
  await page.goto('/groups/');
  await expect(page.locator('html')).toHaveAttribute('data-a11y-space', 'on');
  await expect.poll(() => page.locator('#g-clear').evaluate((el) => getComputedStyle(el).display)).toBe('none');

  await typeQuery(page, 'calgary');
  await expect(page.locator('#g-count')).toHaveText('15 groups');
  const visible = page.locator('.grp:not([hidden])');
  await expect(visible).toHaveCount(15);
  await expect(visible.filter({ hasText: 'Calgary' }).first()).toBeVisible();
});
