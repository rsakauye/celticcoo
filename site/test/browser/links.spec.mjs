import { test, expect } from '@playwright/test';

const BUTTONS = [
  ['/events/', 'Find Celtic events near you'],
  ['/submit/', 'List your event, free'],
  ['/groups/', 'Clubs, bands and lessons'],
  ['/burns-night/', 'Burns Night 2027 (Jan 25)'],
  ['/newsletter/', "Get The Coo's Letter, free"],
  ['/tune/', 'Drone tuner for pipers'],
  ['https://giphy.com/channel/celticcoo', "Ceilidh's GIPHY stickers", true],
  ['/', 'Visit celticcoo.ca'],
];

const SOCIAL = [
  ['https://www.instagram.com/celticcoo/', 'Instagram', 'The Celtic Coo on Instagram'],
  ['https://www.facebook.com/profile.php?id=1347389718466335', 'Facebook', 'The Celtic Coo on Facebook'],
];

function watchExternal(page) {
  const external = [];
  page.on('request', (req) => {
    let url;
    try { url = new URL(req.url()); } catch { external.push(req.url()); return; }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return;
    external.push(req.url());
  });
  return external;
}

async function expectButtons(page, source) {
  const buttons = page.locator('nav a.btn');
  await expect(buttons).toHaveCount(BUTTONS.length + SOCIAL.length);
  for (let i = 0; i < BUTTONS.length; i++) {
    const [path, label, external] = BUTTONS[i];
    const link = buttons.nth(i);
    await expect(link).toContainText(label);
    const href = await link.getAttribute('href');
    if (external) {
      expect(href).toBe(path);
      expect(href).not.toMatch(/utm_/);
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(await link.getAttribute('target')).toBeNull();
      continue;
    }
    await expect(link).toHaveAttribute('href', new RegExp(`[?&]utm_source=${source}(&|$)`));
    const url = new URL(href);
    expect(url.pathname).toBe(path);
    expect(url.searchParams.get('utm_source')).toBe(source);
    expect(url.searchParams.get('utm_medium')).toBe('social');
    expect(url.searchParams.get('utm_campaign')).toBe('links');
    expect(url.hostname === '127.0.0.1' || url.hostname === 'localhost').toBe(true);
  }
  for (let i = 0; i < SOCIAL.length; i++) {
    const [href, label, name] = SOCIAL[i];
    const link = buttons.nth(BUTTONS.length + i);
    await expect(link).toContainText(label);
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('aria-label', name);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
    expect(href).not.toMatch(/utm_/);
  }
}

test('links page loads with its buttons and no outside requests', async ({ page }) => {
  const external = watchExternal(page);
  const res = await page.goto('/links/');
  expect(res.status()).toBe(200);
  await expect(page).toHaveTitle('Links | The Celtic Coo');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    "Find Celtic events across Canada, list your own for free, and grab Ceilidh's stickers on GIPHY.",
  );
  await expect(page.locator('h1')).toHaveText('The Celtic Coo');
  await expect(page.locator('.intro')).toHaveText("Hiya! Find a ceilidh, bring your crew. Here's everywhere the Coo hangs out.");

  await expectButtons(page, 'instagram');

  const mail = page.locator('a[href^="mailto:"]');
  await expect(mail).toHaveCount(1);
  await expect(mail).toHaveAttribute('href', 'mailto:hello@celticcoo.ca');
  await expect(mail).toContainText('Say hello to the Coo');

  const privacy = page.locator('footer a', { hasText: 'Privacy' });
  await expect(privacy).toHaveCount(1);
  const privacyUrl = new URL(await privacy.getAttribute('href'));
  expect(privacyUrl.pathname).toBe('/privacy/');
  expect(privacyUrl.searchParams.get('utm_source')).toBe('instagram');
  expect(privacyUrl.searchParams.get('utm_campaign')).toBe('links');

  const html = await page.content();
  expect(html).toContain('https://www.instagram.com/celticcoo/');
  expect(html).toContain('https://www.facebook.com/profile.php?id=1347389718466335');
  expect(html).not.toMatch(/fonts\.google|kit\.com|unpkg|jsdelivr/i);
  expect(html).not.toMatch(/<(?:script|img|link)[^>]+(?:giphy|instagram|facebook)\.com/i);
  await expect(page.locator('a')).toHaveCount(12);

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);

  const targets = await page.locator('a').evaluateAll((els) => els.map((el) => {
    const box = el.getBoundingClientRect();
    return { h: box.height, w: box.width };
  }));
  expect(targets).toHaveLength(12);
  for (const box of targets) {
    expect(box.h).toBeGreaterThanOrEqual(44);
    expect(box.w).toBeGreaterThanOrEqual(44);
  }
  const buttonBox = await page.locator('nav a.btn').first().boundingBox();
  expect(buttonBox.height).toBeGreaterThanOrEqual(56);

  expect(external).toEqual([]);
});

test('src=fb tags facebook and src=ig tags instagram', async ({ page }) => {
  await page.goto('/links/?src=fb');
  await expectButtons(page, 'facebook');
  await expect(page.locator('a[href^="mailto:"]')).toHaveAttribute('href', 'mailto:hello@celticcoo.ca');

  await page.goto('/links/?src=ig');
  await expectButtons(page, 'instagram');
  const mail = await page.locator('a[href^="mailto:"]').getAttribute('href');
  expect(mail).toBe('mailto:hello@celticcoo.ca');
  expect(mail).not.toContain('utm_');
});

test('/links shows the GIPHY stickers button', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/links/');
  const link = page.getByRole('link', { name: "Ceilidh's GIPHY stickers" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://giphy.com/channel/celticcoo');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(await link.getAttribute('target')).toBeNull();
  await expect(link).toHaveClass('btn');

  const matched = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('nav a.btn')];
    const el = buttons.find((node) => node.textContent.includes('GIPHY'));
    const tuneEl = buttons.find((node) => node.textContent.includes('Drone tuner'));
    const a = getComputedStyle(el);
    const b = getComputedStyle(tuneEl);
    return {
      border: a.borderTopColor === b.borderTopColor && a.borderTopWidth === b.borderTopWidth,
      background: a.backgroundColor === b.backgroundColor,
      color: a.color === b.color,
      radius: a.borderRadius === b.borderRadius,
      minHeight: a.minHeight,
    };
  });
  expect(matched.border).toBe(true);
  expect(matched.background).toBe(true);
  expect(matched.color).toBe(true);
  expect(matched.radius).toBe(true);
  expect(parseFloat(matched.minHeight)).toBeGreaterThanOrEqual(44);

  const box = await link.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);

  for (const width of [375, 390, 1024, 1280]) {
    await page.setViewportSize({ width, height: width < 800 ? 844 : 1000 });
    await link.scrollIntoViewIfNeeded();
    const covered = await link.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const points = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + 12, rect.top + 12],
        [rect.right - 12, rect.bottom - 12],
      ];
      const coo = document.querySelector('[data-ceilidh-coo], .coo-perch');
      return points.some(([x, y]) => {
        const top = document.elementFromPoint(x, y);
        if (!top) return true;
        if (coo && (top === coo || coo.contains(top))) return true;
        return !(el === top || el.contains(top));
      });
    });
    expect(covered, `GIPHY button covered at ${width}px`).toBe(false);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('nav a.btn').first().focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  const ring = await link.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      visible: el.matches(':focus-visible'),
      outline: style.outlineColor,
      width: style.outlineWidth,
      shadow: style.boxShadow,
    };
  });
  expect(ring.visible).toBe(true);
  expect(ring.width).toBe('3px');
  expect(ring.outline).toBe('rgb(240, 178, 122)');
  expect(ring.shadow).toContain('rgb(29, 53, 87)');
});

test('links still go to the right pages when javascript is off', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  const res = await page.goto('/links/');
  expect(res.status()).toBe(200);
  const buttons = page.locator('nav a.btn');
  await expect(buttons).toHaveCount(BUTTONS.length + SOCIAL.length);
  for (let i = 0; i < BUTTONS.length; i++) {
    await expect(buttons.nth(i)).toHaveAttribute('href', BUTTONS[i][0]);
  }
  for (let i = 0; i < SOCIAL.length; i++) {
    const link = buttons.nth(BUTTONS.length + i);
    await expect(link).toHaveAttribute('href', SOCIAL[i][0]);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
  }
  await expect(page.locator('a[href^="mailto:"]')).toHaveAttribute('href', 'mailto:hello@celticcoo.ca');
  await expect(page.locator('footer a', { hasText: 'Privacy' })).toHaveAttribute('href', '/privacy/');
  await context.close();
});

test('light mode focus ring keeps the navy inner halo', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/links/');
  await page.locator('nav a.btn').first().focus();
  await page.keyboard.press('Tab');
  const ring = await page.locator('nav a.btn').nth(1).evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      visible: el.matches(':focus-visible'),
      outline: style.outlineColor,
      width: style.outlineWidth,
      shadow: style.boxShadow,
    };
  });
  expect(ring.visible).toBe(true);
  expect(ring.width).toBe('3px');
  expect(ring.outline).toBe('rgb(240, 178, 122)');
  expect(ring.shadow).toContain('rgb(29, 53, 87)');

  const current = await page.locator('.avatar img').evaluate((img) => img.currentSrc);
  expect(current).toContain('ceilidh-avatar-52.png');
  const fling = await page.locator('.fling').evaluate((el) => getComputedStyle(el).animationName);
  expect(fling).toBe('none');
});
