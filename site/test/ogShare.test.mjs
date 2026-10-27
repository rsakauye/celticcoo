import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { groups } from '../src/lib/data.js';
import { clubCardFields } from '../src/lib/groupProfiles.js';
import { loadBrand, renderCardPng, renderSvgPng, shareAlt } from '../../shared/og/index.js';

const siteOg = readFileSync(new URL('../src/pages/og.png.js', import.meta.url), 'utf8');
const brand = loadBrand(path.resolve(process.cwd(), '../shared/og/og-brand-tokens.json'));

test('the site share image uses the token fonts and the lighter accent', () => {
  assert.doesNotMatch(siteOg, /DejaVu/);
  assert.doesNotMatch(siteOg, /#e0843f/i);
  assert.match(siteOg, /colors\.url/);
  assert.match(siteOg, /loadBrand/);
  assert.equal(brand.tokens.colors.url, '#f0b27a');
  const css = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');
  assert.match(css, /--ginger2:#e0843f/);
  const slainte = groups.find((g) => g.name === 'Sláinte Social Club');
  const macbeth = groups.find((g) => g.name === 'Clan MacBeth');
  assert.equal(
    shareAlt(clubCardFields(slainte), brand),
    'Sláinte Social Club, pipe band in Calgary, AB. Upcoming events on The Celtic Coo.',
  );
  assert.equal(
    shareAlt(clubCardFields(macbeth), brand),
    'Clan MacBeth, clan society. Upcoming events on The Celtic Coo.',
  );
  assert.equal(shareAlt({}, brand), 'The Celtic Coo. Upcoming events on The Celtic Coo.');
});

test('a club share card is a png and the site card still draws the mascot', async () => {
  const club = groups.find((g) => g.name === 'Sláinte Social Club');
  const png = renderCardPng(clubCardFields(club), brand);
  assert.equal(png[0], 0x89);
  const endpoint = await import('../src/pages/og.png.js');
  const response = endpoint.GET();
  const sitePng = Buffer.from(await response.arrayBuffer());
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(sitePng[0], 0x89);
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(sitePng).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1200);
  assert.equal(info.height, 630);
  const at = (x, y) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const green = at(1100, 40);
  assert.ok(green[1] > green[0] && green[1] > 40, `background ${green}`);
  const fringe = at(270, 280);
  assert.ok(fringe[0] > fringe[1] + 20, `mascot ${fringe}`);
  assert.throws(() => renderSvgPng('<svg xmlns="http://www.w3.org/2000/svg"/>', { bold: '', regular: '' }), /font missing/);
});
