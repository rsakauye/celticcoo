import { test, expect } from '@playwright/test';

const BUTTONS = [
  ['/events/', 'Find Celtic events near you'],
  ['/submit/', 'List your event, free'],
  ['/groups/', 'Clubs, bands and lessons'],
  ['/burns-night/', 'Burns Night 2027 (Jan 25)'],
  ['/newsletter/', "Get The Coo's Letter, free"],
  ['/tune/', 'Drone tuner for pipers'],
  ['/', 'Visit celticcoo.ca'],
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
  await expect(buttons).toHaveCount(7);
  for (let i = 0; i < BUTTONS.length; i++) {
    const [path, label] = BUTTONS[i];
    const link = buttons.nth(i);
    await expect(link).toContainText(label);
    await expect(link).toHaveAttribute('href', new RegExp(`[?&]utm_source=${source}(&|$)`));
    const href = await link.getAttribute('href');
    const url = new URL(href);
    expect(url.pathname).toBe(path);
    expect(url.searchParams.get('utm_source')).toBe(source);
    expect(url.searchParams.get('utm_medium')).toBe('social');
    expect(url.searchParams.get('utm_campaign')).toBe('links');
    expect(url.hostname === '127.0.0.1' || url.hostname === 'localhost').toBe(true);
  }
}

test('links page loads with seven tagged buttons and no outside requests', async ({ page }) => {
  const external = watchExternal(page);
  const res = await page.goto('/links/');
  expect(res.status()).toBe(200);
  await expect(page).toHaveTitle('Links | The Celtic Coo');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    'Find Celtic events across Canada, list your own for free, and find clubs, bands and lessons near you.',
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
  expect(html).not.toMatch(/instagram\.com|giphy|fonts\.google|kit\.com|unpkg|jsdelivr/i);
  await expect(page.locator('a')).toHaveCount(9);

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
  expect(targets).toHaveLength(9);
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

test('links still go to the right pages when javascript is off', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  const res = await page.goto('/links/');
  expect(res.status()).toBe(200);
  const buttons = page.locator('nav a.btn');
  await expect(buttons).toHaveCount(7);
  for (let i = 0; i < BUTTONS.length; i++) {
    await expect(buttons.nth(i)).toHaveAttribute('href', BUTTONS[i][0]);
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
