import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = (f) => readFileSync(join(root, 'public', f));
const src = (f) => readFileSync(join(root, f), 'utf8');

function pngSize(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test('the PNG icons are real PNGs at the sizes the page head promises', () => {
  assert.deepEqual(pngSize(pub('favicon-16.png')), [16, 16]);
  assert.deepEqual(pngSize(pub('favicon-32.png')), [32, 32]);
  assert.deepEqual(pngSize(pub('apple-touch-icon.png')), [180, 180]);
});

test('favicon.ico holds the 16, 32 and 48 pixel images', () => {
  const ico = pub('favicon.ico');
  assert.equal(ico.readUInt16LE(0), 0, 'reserved');
  assert.equal(ico.readUInt16LE(2), 1, 'type is icon');
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i += 1) sizes.push(ico[6 + i * 16] || 256);
  assert.deepEqual(sizes.sort((a, b) => a - b), [16, 32, 48]);
});

test('the SVG icon stays, and both layouts link the whole set', () => {
  assert.match(pub('favicon.svg').toString('utf8'), /<svg/);
  for (const file of ['src/layouts/Base.astro', 'src/pages/links/index.astro']) {
    const html = src(file);
    assert.match(html, /rel="icon" href=\{u\('favicon\.svg'\)\} type="image\/svg\+xml"/, file);
    assert.match(html, /rel="icon" href=\{u\('favicon-32\.png'\)\} type="image\/png" sizes="32x32"/, file);
    assert.match(html, /rel="icon" href=\{u\('favicon-16\.png'\)\} type="image\/png" sizes="16x16"/, file);
    assert.match(html, /rel="icon" href=\{u\('favicon\.ico'\)\} sizes="48x48"/, file);
    assert.match(html, /rel="apple-touch-icon" href=\{u\('apple-touch-icon\.png'\)\}/, file);
  }
});
