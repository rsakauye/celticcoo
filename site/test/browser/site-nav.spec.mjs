import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { PLAY_BLURB } from '../../src/lib/nav.js';

const MARK = 'rgb(240, 178, 122)';

async function desktop(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function phone(page) {
  await page.setViewportSize({ width: 390, height: 844 });
}

function eventsButton(page) {
  return page.locator('[data-nav-group="events"] [data-nav-group-btn]');
}

test.describe('desktop menu', () => {
  test.beforeEach(async ({ page }) => {
    await desktop(page);
    await page.goto('/groups/');
  });

  test('opens and closes on click, and hover does nothing', async ({ page }) => {
    const events = eventsButton(page);
    await events.hover();
    await expect(events).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#nav-events')).toBeHidden();

    await events.click();
    await expect(events).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#nav-events')).toBeVisible();
    await expect(page.locator('#nav-events a')).toHaveText(['Upcoming events', 'Results', 'Burns Night']);

    await page.locator('[data-nav-group="community"] [data-nav-group-btn]').click();
    await expect(events).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#nav-events')).toBeHidden();
    await expect(page.locator('#nav-community')).toBeVisible();

    await page.locator('.tartan').first().click();
    await expect(page.locator('#nav-community')).toBeHidden();
    await expect(page.locator('[data-nav-group="community"] [data-nav-group-btn]')).toHaveAttribute('aria-expanded', 'false');
  });

  test('Escape closes the open group and returns focus', async ({ page }) => {
    const heritage = page.locator('[data-nav-group="heritage"] [data-nav-group-btn]');
    await heritage.click();
    await expect(page.locator('#nav-heritage')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(heritage).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#nav-heritage')).toBeHidden();
    await expect(heritage).toBeFocused();
  });

  test('arrow keys move across groups and inside a panel', async ({ page }) => {
    const events = eventsButton(page);
    await events.focus();
    await page.keyboard.press('ArrowRight');
    const community = page.locator('[data-nav-group="community"] [data-nav-group-btn]');
    await expect(community).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(community).toHaveAttribute('aria-expanded', 'true');
    const links = page.locator('#nav-community a');
    await expect(links.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(links.nth(1)).toBeFocused();
    await expect(links.nth(1)).toHaveText('Book performers');
    await page.keyboard.press('ArrowUp');
    await expect(links.first()).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(community).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await expect(links.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(links.first()).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(community).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator('[data-nav-cta]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(events).toBeFocused();
  });

  test('Play lists only the drone tuner and its blurb', async ({ page }) => {
    await expect(page.locator('[data-site-nav]')).not.toContainText(/coming soon/i);
    await expect(page.locator('header.site .btn')).toHaveCount(1);
    await expect(page.locator('[data-nav-cta]')).toHaveText('Add yours');
    await expect(page.locator('[data-nav-about]')).toHaveText('About');
    const play = page.locator('[data-nav-group="play"] [data-nav-group-btn]');
    await play.click();
    await expect(page.locator('#nav-play a')).toHaveCount(1);
    await expect(page.locator('#nav-play a')).toHaveText('Drone tuner');
    await expect(page.locator('#nav-play-blurb')).toHaveText(PLAY_BLURB);
    await page.locator('#nav-play a').click();
    await expect(page).toHaveURL(/\/tune\/$/);
    await expect(page.locator('.scale-labels')).toContainText('Flat');
    await expect(page.locator('.scale-labels')).toContainText('Sharp');
    await expect(page.locator('.scale-labels')).toContainText('In tune');
  });

  test('current page uses the ginger underline and focus ring', async ({ page }) => {
    await page.goto('/events/');
    const events = eventsButton(page);
    await expect(events).toHaveCSS('border-bottom-color', MARK);
    const community = page.locator('[data-nav-group="community"] [data-nav-group-btn]');
    await expect(community).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)');

    await page.locator('a.brand').focus();
    await page.keyboard.press('Tab');
    await expect(events).toBeFocused();
    await expect(events).toHaveCSS('outline-color', MARK);
  });
});

test.describe('narrow menu', () => {
  test.beforeEach(async ({ page }) => {
    await phone(page);
    await page.goto('/groups/');
  });

  test('hamburger opens a flat full-height panel and Escape closes it', async ({ page }) => {
    const toggle = page.locator('[data-nav-toggle]');
    await expect(toggle).toBeVisible();
    await expect(page.locator('#nav-events')).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAttribute('aria-label', 'Close menu');
    await expect(page.locator('#nav-events')).toBeVisible();
    await expect(page.locator('[data-nav-group="events"] [data-nav-group-btn]')).toBeHidden();

    const eventsLabel = page.locator('#nav-events-label');
    await expect(eventsLabel).toBeVisible();
    await expect(eventsLabel).toHaveCSS('text-transform', 'uppercase');
    const labelSize = await eventsLabel.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(labelSize).toBeLessThan(16);

    const links = page.locator('[data-site-nav] a');
    const count = await links.count();
    expect(count).toBeGreaterThan(10);
    for (let i = 0; i < count; i++) {
      const box = await links.nth(i).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }

    const cta = await page.locator('.nav-cta').boundingBox();
    const viewport = page.viewportSize();
    expect(cta.y + cta.height).toBeGreaterThan(viewport.height - 2);
    expect(cta.y + cta.height).toBeLessThanOrEqual(viewport.height + 1);

    await expect(page.locator('[data-nav-about]')).toBeInViewport();
    await expect(page.locator('#nav-play-blurb')).toBeInViewport();
    const padding = await page.locator('.nav-cta').evaluate((el) => getComputedStyle(el).paddingBottom);
    expect(padding).toMatch(/px$/);
    const css = await page.evaluate(() => [...document.styleSheets].map((sheet) => {
      try { return [...sheet.cssRules].map((rule) => rule.cssText).join('\n'); }
      catch { return ''; }
    }).join('\n'));
    expect(css).toContain('.nav-cta');
    expect(css).toContain('safe-area-inset-bottom');

    await expect(page.locator('html')).toHaveClass(/nav-lock/);
    await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
    await expect(page.locator('body')).toHaveCSS('position', 'fixed');
    const scrolled = await page.evaluate(() => {
      window.scrollTo(0, 1600);
      document.documentElement.scrollTop = 1600;
      return window.scrollY;
    });
    expect(scrolled).toBe(0);

    await page.locator('.tartan').first().click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#nav-events')).toBeHidden();
    await expect(page.locator('html')).not.toHaveClass(/nav-lock/);

    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });
});

test('without JavaScript the menu is a plain list of links', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/groups/');
  await expect(page.locator('[data-nav-toggle]')).toBeHidden();
  await expect(page.locator('[data-nav-group-btn]').first()).toBeHidden();
  const nav = page.locator('[data-site-nav]');
  await expect(nav.getByRole('link', { name: 'Upcoming events' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Drone tuner' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'About', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Add yours' })).toBeVisible();
  await expect(page.locator('#nav-play-blurb')).toHaveText(PLAY_BLURB);
  await expect(page.locator('html')).not.toHaveClass(/nav-js/);
  await context.close();
});

test('tuner load does not post audio', async ({ page }) => {
  const posted = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET' && req.method() !== 'HEAD') posted.push(`${req.method()} ${req.url()}`);
  });
  await page.goto('/tune/');
  await expect(page.locator('[data-cents-text]')).toHaveText('No pitch yet');
  await expect(page.locator('.scale-labels')).toContainText('Flat');
  await expect(page.locator('.scale-labels')).toContainText('Sharp');
  expect(posted).toEqual([]);
});

test('header screenshots', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'one set of shots is enough');
  const dir = '/opt/cursor/artifacts';
  mkdirSync(dir, { recursive: true });

  await phone(page);
  await page.goto('/');
  await page.screenshot({ path: `${dir}/nav-390-closed.png` });

  await page.locator('[data-nav-toggle]').click();
  await expect(page.locator('#nav-events')).toBeVisible();
  await page.screenshot({ path: `${dir}/nav-390-open.png` });

  await desktop(page);
  await page.goto('/');
  await eventsButton(page).click();
  await expect(page.locator('#nav-events')).toBeVisible();
  await page.screenshot({ path: `${dir}/nav-1280-dropdown.png` });

  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('[data-coo-toggle]').click();
  await expect(page.locator('[data-ceilidh-coo]')).toHaveAttribute('data-out', '');
  await expect(page.locator('.tartan').first()).toBeVisible();
  await expect(page.locator('.hero > img')).toBeVisible();
  await page.screenshot({ path: `${dir}/palette-check.png` });
});
