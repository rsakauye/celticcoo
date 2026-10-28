import { test, expect } from '@playwright/test';

const TUNES = [
  {
    name: 'Highland Laddie',
    ariaOn: 'Tuck Ceilidh away and stop Highland Laddie',
    nextAria: 'Bring out Ceilidh to dance to Gillie Callum',
  },
  {
    name: 'Gillie Callum',
    ariaOn: 'Tuck Ceilidh away and stop Gillie Callum',
    nextAria: 'Bring out Ceilidh to dance to Seann Triubhas',
  },
  {
    name: 'Seann Triubhas',
    ariaOn: 'Tuck Ceilidh away and stop Seann Triubhas',
    nextAria: 'Bring out Ceilidh to dance',
  },
  {
    name: 'Coo theme',
    ariaOn: 'Tuck Ceilidh away and stop Coo theme',
    nextAria: 'Bring out Ceilidh to dance to Highland Laddie',
  },
];

test('each tune starts and stops, and switching leaves only one playing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const button = page.locator('[data-coo-toggle]');
  const status = page.locator('[data-coo-status]');
  await expect(button).toHaveAttribute('aria-label', 'Bring out Ceilidh to dance to Highland Laddie');

  for (const tune of TUNES) {
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toHaveAttribute('aria-label', tune.ariaOn);
    await expect(status).toHaveText(`Ceilidh is out and dancing. ${tune.name} is playing.`);
    if (tune.name === 'Coo theme') await expect(page.locator('.coo-cue-out')).toHaveText('stop Coo theme');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(button).toHaveAttribute('aria-label', tune.nextAria);
    await expect(status).toContainText('is next, and the music is muted.');
  }
});


const WIDTHS = [1024, 1280];

const PHONES = [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
];

async function spriteInVisualViewport(page) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('[data-ceilidh-coo]');
    const rect = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const left = rect.left - vv.offsetLeft;
    const top = rect.top - vv.offsetTop;
    return {
      left,
      top,
      right: left + rect.width,
      bottom: top + rect.height,
      width: vv.width,
      height: vv.height,
    };
  });
  expect(box.left, 'sprite left').toBeGreaterThanOrEqual(-1);
  expect(box.top, 'sprite top').toBeGreaterThanOrEqual(-1);
  expect(box.right, 'sprite right').toBeLessThanOrEqual(box.width + 1);
  expect(box.bottom, 'sprite bottom').toBeLessThanOrEqual(box.height + 1);
}

async function columnUsesMostOfTheWidth(page) {
  const ratio = await page.evaluate(() => {
    const main = document.querySelector('main.wrap');
    const style = getComputedStyle(main);
    const content = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return content / window.visualViewport.width;
  });
  expect(ratio).toBeGreaterThanOrEqual(0.9);
}

test('on a phone the coo stays on screen and the column stays wide', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'checked on iPhone WebKit and Brave');
  await page.goto('/');
  const button = page.locator('[data-coo-toggle]');
  const newsletter = page.locator('.nl');
  for (const size of PHONES) {
    await page.setViewportSize(size);
    if ((await page.locator('[data-ceilidh-coo]').getAttribute('data-out')) != null) {
      await button.click();
    }
    await newsletter.scrollIntoViewIfNeeded();
    await spriteInVisualViewport(page);
    await columnUsesMostOfTheWidth(page);
    await button.click();
    await page.waitForFunction(() => {
      const perch = document.querySelector('[data-ceilidh-coo]');
      const win = document.querySelector('.coo-window');
      const frame = getComputedStyle(perch).getPropertyValue('--frame').trim();
      return Math.abs(win.getBoundingClientRect().width - parseFloat(frame)) < 1;
    });
    await newsletter.scrollIntoViewIfNeeded();
    await spriteInVisualViewport(page);
    await columnUsesMostOfTheWidth(page);
    await button.click();
  }
});


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
