import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { cardSvg, layoutCard, loadBrand, renderCardPng, renderSvgPng, shareAlt } from '../index.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const tokensPath = path.resolve(root, '../og-brand-tokens.json');
const brand = loadBrand(tokensPath);
const sharp = createRequire(path.resolve(root, '../../../site/package.json'))('sharp');

const SAMPLE_1 = {
  name: 'Sláinte Social Club',
  type: 'Social club',
  location: 'Calgary, AB',
};
const SAMPLE_2 = {
  name: 'The Royal Caledonian Highland Dancing, Piping and Drumming Association of Southern Alberta',
  type: 'Pipe band & dance school',
  location: 'Lethbridge and Medicine Hat, Alberta, Canada',
};

function slot(svg, id) {
  const match = svg.match(new RegExp(`<text id="${id}"[\\s\\S]*?<\\/text>`));
  return match ? match[0] : '';
}

async function meanDelta(png, reference) {
  const ours = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sample = await sharp(reference).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(ours.info.width, 1200);
  assert.equal(ours.info.height, 630);
  assert.equal(sample.info.width, 1200);
  assert.equal(sample.info.height, 630);
  let sum = 0;
  for (let i = 0; i < ours.data.length; i += 1) sum += Math.abs(ours.data[i] - sample.data[i]);
  return sum / ours.data.length;
}

test('a short name stays one line at 80px and a long name wraps then shrinks to 56px', () => {
  const short = layoutCard(SAMPLE_1, brand);
  assert.equal(short.size, 80);
  assert.deepEqual(short.lines, ['Sláinte Social Club']);
  assert.equal(short.typeText, 'SOCIAL CLUB');
  assert.equal(short.locationText, 'Calgary, AB');
  assert.equal(short.typeY, 150);
  assert.equal(short.nameY, 248);
  assert.equal(short.locationY, 306);

  const long = layoutCard(SAMPLE_2, brand);
  assert.equal(long.size, 56);
  assert.deepEqual(long.lines, ['The Royal Caledonian', 'Highland Dancing, Piping…']);
  assert.equal(long.typeText, 'PIPE BAND & DANCE SCHOOL');
  assert.equal(long.nameY, 230);
  assert.equal(long.locationY, 348);

  const shortSvg = cardSvg(SAMPLE_1, brand);
  assert.match(slot(shortSvg, 'slot-name'), /font-size="80"/);
  assert.match(slot(shortSvg, 'slot-name'), /y="248"/);
  assert.match(slot(shortSvg, 'slot-name'), />Sláinte Social Club</);
  assert.match(slot(shortSvg, 'slot-type'), /y="150"/);
  assert.match(slot(shortSvg, 'slot-type'), />SOCIAL CLUB</);
  assert.match(slot(shortSvg, 'slot-location'), /y="306"/);
  assert.match(slot(shortSvg, 'slot-location'), />Calgary, AB</);

  const longSvg = cardSvg(SAMPLE_2, brand);
  assert.match(slot(longSvg, 'slot-name'), /font-size="56"/);
  assert.match(slot(longSvg, 'slot-name'), /y="230">The Royal Caledonian</);
  assert.match(slot(longSvg, 'slot-name'), /y="290">Highland Dancing, Piping…</);
  assert.match(slot(longSvg, 'slot-type'), />PIPE BAND &amp; DANCE SCHOOL</);
  assert.match(slot(longSvg, 'slot-location'), /y="348"/);
  assert.match(slot(longSvg, 'slot-location'), />Lethbridge and Medicine Hat, Alberta, Canada</);
});

test('share alt names the club, lowercases the type, and drops empty parts', () => {
  const tokens = brand.tokens;
  assert.equal(
    shareAlt({ name: 'Sláinte Social Club', type: 'Pipe Band', location: 'Calgary, AB' }, tokens),
    'Sláinte Social Club, pipe band in Calgary, AB. Upcoming events on The Celtic Coo.',
  );
  assert.equal(
    shareAlt({ name: 'Sláinte  Social Club', type: '  pipe   band ', location: 'Calgary,  AB' }, brand),
    'Sláinte Social Club, pipe band in Calgary, AB. Upcoming events on The Celtic Coo.',
  );
  assert.equal(
    shareAlt({ name: 'Sláinte Social Club', type: '', location: 'Calgary, AB' }, tokens),
    'Sláinte Social Club in Calgary, AB. Upcoming events on The Celtic Coo.',
  );
  assert.equal(
    shareAlt({ name: 'Sláinte Social Club', type: 'Pipe band', location: '   ' }, tokens),
    'Sláinte Social Club, pipe band. Upcoming events on The Celtic Coo.',
  );
  assert.equal(
    shareAlt({ name: 'Sláinte Social Club', type: '', location: '' }, tokens),
    'Sláinte Social Club. Upcoming events on The Celtic Coo.',
  );
  assert.equal(shareAlt({}, tokens), 'The Celtic Coo. Upcoming events on The Celtic Coo.');
  const other = { site_name: 'Used Glass', tagline: 'Listings on {site}' };
  assert.equal(shareAlt({ name: 'Shop', type: 'Stained Glass', location: '' }, other), 'Shop, stained glass. Listings on Used Glass.');
  assert.equal(shareAlt({ name: 'Shop', location: 'Toronto' }, other), 'Shop in Toronto. Listings on Used Glass.');
  assert.equal(shareAlt({ name: 'Shop' }, other), 'Shop. Listings on Used Glass.');
  assert.equal(shareAlt({}, other), 'Used Glass. Listings on Used Glass.');
  const alt = shareAlt(SAMPLE_1, tokens);
  assert.doesNotMatch(alt, /tartan|mascot|artwork/i);
  assert.equal(alt.includes('  '), false);
  assert.equal(alt.includes(', .'), false);
  assert.equal(alt.includes(', in'), false);
});

test('empty slots are removed and a missing name uses the site name from the tokens', () => {
  const noType = cardSvg({ name: 'Only Name', type: '', location: 'Calgary, AB' }, brand);
  assert.equal(slot(noType, 'slot-type'), '');
  assert.match(slot(noType, 'slot-name'), /y="178">Only Name</);
  assert.match(noType, /id="slot-location"/);

  const noPlace = cardSvg({ name: 'Only Name', type: 'Pipe band', location: '' }, brand);
  assert.equal(slot(noPlace, 'slot-location'), '');
  assert.match(noPlace, /id="slot-type"/);
  assert.match(slot(noPlace, 'slot-name'), /y="248"/);

  const fallback = layoutCard({ name: '   ', type: '', location: '' }, brand);
  assert.deepEqual(fallback.lines, [brand.tokens.site_name]);
  assert.equal(slot(cardSvg({}, brand), 'slot-type'), '');
  assert.equal(slot(cardSvg({}, brand), 'slot-location'), '');
});

test('the renderer loads the token fonts and fails when a file is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-brand-'));
  const tokens = structuredClone(brand.tokens);
  tokens.fonts.bold = 'missing-bold.ttf';
  tokens.fonts.regular = 'missing-regular.ttf';
  const file = path.join(dir, 'og-brand-tokens.json');
  fs.writeFileSync(file, JSON.stringify(tokens));
  assert.throws(() => loadBrand(file), /Share-card font missing/);

  const png = renderCardPng(SAMPLE_1, brand);
  assert.equal(png[0], 0x89);
  assert.equal(png[1], 0x50);
  assert.throws(() => renderSvgPng('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', {
    ...brand,
    bold: path.join(dir, 'missing-bold.ttf'),
    regular: path.join(dir, 'missing-regular.ttf'),
  }), /font/i);
});

test('rendered cards match the designer samples', async () => {
  const first = await meanDelta(renderCardPng(SAMPLE_1, brand), path.join(root, 'og-club-sample-1.png'));
  const second = await meanDelta(renderCardPng(SAMPLE_2, brand), path.join(root, 'og-club-sample-2.png'));
  assert.ok(first < 4, `sample 1 mean channel delta ${first}`);
  assert.ok(second < 4, `sample 2 mean channel delta ${second}`);
});

test('the renderer has no site names and the tokens file is the only brand file', () => {
  const engine = fs.readFileSync(path.join(root, '../engine.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, '../index.js'), 'utf8');
  assert.doesNotMatch(engine, /celtic|coo|highland|pipe band/i);
  assert.doesNotMatch(index, /celtic|coo|highland|pipe band/i);
  const brandFiles = fs.readdirSync(path.join(root, '..')).filter((name) => name.endsWith('.json'));
  assert.deepEqual(brandFiles, ['og-brand-tokens.json']);
});
