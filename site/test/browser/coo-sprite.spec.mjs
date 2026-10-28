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

async function scrollToEnd(page) {
  // iPhone WebKit's layout viewport is taller than clientHeight by the browser
  // chrome, so scrollTop + clientHeight never reaches scrollHeight. The page is
  // at the end when a further scroll does not move.
  await page.evaluate(() => {
    const root = document.scrollingElement;
    root.scrollTop = root.scrollHeight;
    window.scrollTo(0, root.scrollHeight);
  });
  await page.waitForFunction(() => {
    const root = document.scrollingElement;
    const top = root.scrollTop;
    root.scrollTop = root.scrollHeight;
    return root.scrollTop <= top + 1;
  });
}

async function phoneClearance(page) {
  const report = await page.evaluate(() => {
    const vv = window.visualViewport;
    const shown = (el) => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
      const box = el.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return null;
      return box;
    };
    const sprites = [...document.querySelectorAll('.coo-head, .coo-window, .coo-cue')]
      .map((el) => ({ name: el.className, box: shown(el) }))
      .filter((item) => item.box);
    const outside = [];
    for (const { name, box } of sprites) {
      const left = box.left - vv.offsetLeft;
      const top = box.top - vv.offsetTop;
      const right = left + box.width;
      const bottom = top + box.height;
      if (left < -1 || top < -1 || right > vv.width + 1 || bottom > vv.height + 1) {
        outside.push(`${name} L${left.toFixed(1)} T${top.toFixed(1)} R${right.toFixed(1)} B${bottom.toFixed(1)}`);
      }
    }
    const overlaps = [];
    const hits = (box) => sprites.some((sprite) => {
      const a = sprite.box;
      return a.left < box.right - 0.5
        && a.right > box.left + 0.5
        && a.top < box.bottom - 0.5
        && a.bottom > box.top + 0.5;
    });
    const consider = (el, label) => {
      if (el.closest('[data-ceilidh-coo]')) return;
      const box = shown(el);
      if (!box) return;
      if (box.bottom <= 0 || box.top >= vv.height || box.right <= 0 || box.left >= vv.width) return;
      if (hits(box)) overlaps.push(`${label}: ${(el.innerText || el.getAttribute('aria-label') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 90)}`);
    };
    for (const el of document.querySelectorAll('p.muted')) {
      if ((el.textContent || '').includes('unsubscribe')) consider(el, 'consent');
    }
    const footer = document.querySelector('footer.site');
    if (footer) {
      for (const el of footer.querySelectorAll('a, button, p, b, span, div')) {
        const text = (el.innerText || '').trim();
        if (!text) continue;
        const direct = el.matches('a, button') || [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
        if (direct) consider(el, 'footer');
      }
    }
    for (const el of document.querySelectorAll('a, button')) consider(el, 'control');
    return { outside, overlaps };
  });
  expect(report.outside, 'sprite or pill partly outside the viewport').toEqual([]);
  expect(report.overlaps, 'sprite or pill covering the end of the page').toEqual([]);
}

async function shownBox(page, selector) {
  return page.locator(selector).evaluate((el) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
      display: style.display,
      visibility: style.visibility,
      width: box.width,
      height: box.height,
    };
  });
}

function expectFullyHidden(box, label) {
  const hidden = box.display === 'none' || box.visibility === 'hidden';
  expect(hidden, `${label} is fully hidden`).toBe(true);
  expect(box.width, `${label} has no box`).toBe(0);
  expect(box.height, `${label} has no box`).toBe(0);
}

test('on a phone the head starts a tune and the end of the page stays clear', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium', 'checked on iPhone WebKit and Brave');
  await page.goto('/');
  const button = page.locator('[data-coo-toggle]');
  const head = page.locator('[data-coo-head]');
  for (const size of PHONES) {
    await page.setViewportSize(size);
    if ((await page.locator('[data-ceilidh-coo]').getAttribute('data-out')) != null) {
      await button.click();
    }
    await expect(head).toBeVisible();
    await expect(head.locator('img')).toHaveAttribute('src', /coo\.svg/);
    const headBox = await head.boundingBox();
    expect(headBox.width, `head width at ${size.width}`).toBeGreaterThanOrEqual(44);
    expect(headBox.height, `head height at ${size.width}`).toBeGreaterThanOrEqual(44);
    expectFullyHidden(await shownBox(page, '.coo-window'), 'idle sprite');
    expectFullyHidden(await shownBox(page, '.coo-cue'), 'idle pill');
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute('aria-label', /^Bring out Ceilidh to dance/);
    await scrollToEnd(page);
    await spriteInVisualViewport(page);
    await columnUsesMostOfTheWidth(page);
    await phoneClearance(page);

    await head.click({ trial: true });
    await head.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toHaveAttribute('aria-label', /^Tuck Ceilidh away and stop /);
    await page.waitForFunction(() => {
      const perch = document.querySelector('[data-ceilidh-coo]');
      const win = document.querySelector('.coo-window');
      const frame = getComputedStyle(perch).getPropertyValue('--frame').trim();
      return Math.abs(win.getBoundingClientRect().width - parseFloat(frame)) < 1;
    });
    expectFullyHidden(await shownBox(page, '[data-coo-head]'), 'dancing head');
    await scrollToEnd(page);
    await spriteInVisualViewport(page);
    await columnUsesMostOfTheWidth(page);
    await phoneClearance(page);

    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(head).toBeVisible();
    expectFullyHidden(await shownBox(page, '.coo-window'), 'sprite after stop');
    expectFullyHidden(await shownBox(page, '.coo-cue'), 'pill after stop');
    await scrollToEnd(page);
    await phoneClearance(page);
  }
});

async function watchShakes(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date('2026-10-28T12:00:00Z') });
  await page.clock.pauseAt('2026-10-28T12:00:00Z');
  await page.goto('/');
  await page.evaluate(() => {
    window.__cooShakes = 0;
    document.querySelector('[data-coo-head]').addEventListener('coo-head-shake', () => {
      window.__cooShakes += 1;
    });
  });
}

test('the phone head shakes four times and then stops', async ({ page }) => {
  await watchShakes(page);
  await page.clock.fastForward(8000);
  await expect.poll(() => page.evaluate(() => window.__cooShakes)).toBe(1);
  for (const expected of [2, 3, 4]) {
    await page.clock.fastForward(30000);
    await expect.poll(() => page.evaluate(() => window.__cooShakes)).toBe(expected);
  }
  await page.clock.fastForward(90000);
  expect(await page.evaluate(() => window.__cooShakes)).toBe(4);
});

test('the first tap starts the tune and cancels later head shakes', async ({ page }) => {
  await watchShakes(page);
  await page.clock.fastForward(8000);
  await expect.poll(() => page.evaluate(() => window.__cooShakes)).toBe(1);
  await page.clock.resume();
  await page.locator('[data-coo-head]').click();
  await expect(page.locator('[data-coo-toggle]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-coo-toggle]')).toHaveAttribute('aria-label', 'Tuck Ceilidh away and stop Highland Laddie');
  await page.locator('[data-coo-toggle]').click();
  await expect(page.locator('[data-coo-head]')).toBeVisible();
  await expect(page.locator('[data-coo-toggle]')).toHaveAttribute('aria-pressed', 'false');
  await page.clock.fastForward(120000);
  expect(await page.evaluate(() => window.__cooShakes)).toBe(1);
});

test('reduced motion skips the phone head shake', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await watchShakes(page);
  await page.clock.fastForward(120000);
  expect(await page.evaluate(() => window.__cooShakes)).toBe(0);
  await expect(page.locator('[data-coo-head]')).toBeVisible();
  await expect(page.locator('[data-coo-head]')).not.toHaveClass(/coo-head-shake/);
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
