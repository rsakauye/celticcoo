import { test, expect } from '@playwright/test';

const PROFILES = [
  ['The Celtic Coo on Instagram', 'https://www.instagram.com/celticcoo/'],
  ['The Celtic Coo on Facebook', 'https://www.facebook.com/celticcoo'],
];

test('footer icons match the footer text and turn gold on hover and focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/privacy/');
  const footer = page.locator('footer.site');
  const footerColor = await footer.evaluate((el) => getComputedStyle(el).color);

  for (const [name, href] of PROFILES) {
    const link = footer.getByRole('link', { name });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
    expect(href).not.toMatch(/utm_/);

    const box = await link.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeLessThanOrEqual(48);
    expect(box.height).toBeLessThanOrEqual(48);

    const glyph = await link.locator('svg').evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        fill: el.querySelector('path').getAttribute('fill'),
        viewBox: el.getAttribute('viewBox'),
        transform: style.transform,
      };
    });
    expect(glyph.viewBox).toBe('0 0 24 24');
    expect(glyph.fill).toBe('currentColor');
    expect(glyph.transform === 'none' || glyph.transform === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
    expect(glyph.width).toBeGreaterThanOrEqual(23);
    expect(glyph.width).toBeLessThanOrEqual(25);
    expect(glyph.height).toBeGreaterThanOrEqual(23);
    expect(glyph.height).toBeLessThanOrEqual(25);

    const color = await link.evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe(footerColor);
  }

  const instagram = footer.getByRole('link', { name: 'The Celtic Coo on Instagram' });
  await instagram.hover();
  await expect.poll(() => instagram.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(240, 178, 122)');

  await instagram.focus();
  const ring = await instagram.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      visible: el.matches(':focus-visible'),
      color: style.color,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    };
  });
  expect(ring.visible).toBe(true);
  expect(ring.color).toBe('rgb(240, 178, 122)');
  expect(ring.outlineStyle).not.toBe('none');
  expect(parseFloat(ring.outlineWidth)).toBeGreaterThanOrEqual(3);
  expect(ring.outlineColor).toBe('rgb(255, 255, 255)');
});

test('links page social buttons use the same button style', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/links/');
  const sample = page.locator('nav a.btn', { hasText: 'Drone tuner for pipers' });
  for (const [name, href] of PROFILES) {
    const link = page.getByRole('link', { name });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
    const matched = await link.evaluate((el, other) => {
      const a = getComputedStyle(el);
      const b = getComputedStyle(other);
      const box = el.getBoundingClientRect();
      const icon = el.querySelector('svg').getBoundingClientRect();
      return {
        border: a.borderTopColor === b.borderTopColor && a.borderTopWidth === b.borderTopWidth,
        background: a.backgroundColor === b.backgroundColor,
        color: a.color === b.color,
        radius: a.borderRadius === b.borderRadius,
        minHeight: parseFloat(a.minHeight),
        width: box.width,
        parentWidth: el.parentElement.getBoundingClientRect().width,
        icon: icon.width,
      };
    }, await sample.elementHandle());
    expect(matched.border).toBe(true);
    expect(matched.background).toBe(true);
    expect(matched.color).toBe(true);
    expect(matched.radius).toBe(true);
    expect(matched.minHeight).toBeGreaterThanOrEqual(56);
    expect(matched.width).toBeGreaterThan(300);
    expect(Math.abs(matched.width - matched.parentWidth)).toBeLessThan(2);
    expect(matched.icon).toBeGreaterThanOrEqual(23);
    expect(matched.icon).toBeLessThanOrEqual(25);
  }
});
