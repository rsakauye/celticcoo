import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tagHref, utmSource } from '../src/lib/linksUtm.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
const page = readFileSync(join(site, 'src/pages/links/index.astro'), 'utf8');
const sitemap = readFileSync(join(site, 'src/pages/sitemap.xml.js'), 'utf8');

const LABELS = [
  'Find Celtic events near you',
  'List your event, free',
  'Clubs, bands and lessons',
  'Burns Night 2027 (Jan 25)',
  "Get The Coo's Letter, free",
  'Drone tuner for pipers',
  'Visit celticcoo.ca',
];
const PATHS = ['events/', 'submit/', 'groups/', 'burns-night/', 'newsletter/', 'tune/', ''];

test('utm source follows src=ig|fb and defaults to instagram', () => {
  assert.equal(utmSource(null), 'instagram');
  assert.equal(utmSource(''), 'instagram');
  assert.equal(utmSource('ig'), 'instagram');
  assert.equal(utmSource('IG'), 'instagram');
  assert.equal(utmSource('instagram'), 'instagram');
  assert.equal(utmSource('fb'), 'facebook');
  assert.equal(utmSource('FB'), 'facebook');
  assert.equal(utmSource('facebook'), 'facebook');
  assert.equal(utmSource('other'), 'instagram');
});

test('utm tags same-origin links and leaves mailto and other hosts alone', () => {
  const pageUrl = 'https://celticcoo.ca/links/?src=fb';
  const tagged = tagHref('/events/', pageUrl, 'facebook');
  const url = new URL(tagged);
  assert.equal(url.origin, 'https://celticcoo.ca');
  assert.equal(url.pathname, '/events/');
  assert.equal(url.searchParams.get('utm_source'), 'facebook');
  assert.equal(url.searchParams.get('utm_medium'), 'social');
  assert.equal(url.searchParams.get('utm_campaign'), 'links');

  const home = new URL(tagHref('/', 'https://celticcoo.ca/links/?src=ig', 'instagram'));
  assert.equal(home.pathname, '/');
  assert.equal(home.searchParams.get('utm_source'), 'instagram');

  assert.equal(tagHref('mailto:hello@celticcoo.ca', pageUrl, 'facebook'), 'mailto:hello@celticcoo.ca');
  assert.equal(tagHref('https://example.com/out', pageUrl, 'facebook'), 'https://example.com/out');
});

test('the links page lists the seven buttons in order', () => {
  assert.match(page, /<title>\{title\}<\/title>/);
  assert.match(page, /Links \| The Celtic Coo/);
  assert.match(page, /Find Celtic events across Canada, list your own for free, and find clubs, bands and lessons near you\./);
  assert.match(page, /Hiya! Find a ceilidh, bring your crew\. Here's everywhere the Coo hangs out\./);
  assert.doesNotMatch(page, /Base\.astro/);
  assert.doesNotMatch(page, /instagram\.com|giphy|mock-flag|fonts\.google|kit\.com/i);

  const labels = [...page.matchAll(/class="lbl">(.*?)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(labels, LABELS);
  const paths = [...page.matchAll(/<a class="btn[^"]*" data-utm href=\{u\('([^']*)'\)\}/g)].map((m) => m[1]);
  assert.deepEqual(paths, PATHS);
  assert.equal(page.match(/class="btn cta"/g).length, 1);

  assert.match(page, /mailto:\$\{CONTACT_EMAIL\}/);
  assert.match(page, /href=\{u\('privacy\/'\)\}/);
  assert.match(page, /data-utm href=\{u\('privacy\/'\)\}/);
  assert.doesNotMatch(page, /data-utm href=\{`mailto:/);

  const svgs = page.match(/<svg\b/g);
  const hidden = page.match(/<svg\b[^>]*aria-hidden="true"/g);
  assert.ok(svgs && hidden);
  assert.equal(svgs.length, hidden.length);
  assert.equal(svgs.length, 15);

  assert.match(page, /min-height:56px/);
  assert.match(page, /min-height:44px/);
  assert.match(page, /--focus-ring:#f0b27a/);
  assert.match(page, /--focus-inner:#1d3557/);
  assert.match(page, /--focus-inner:#0f2219/);
  assert.match(page, /outline:3px solid var\(--focus-ring\)/);
  assert.match(page, /box-shadow:0 0 0 3px var\(--focus-inner\)/);
  assert.match(page, /prefers-color-scheme:dark/);
  assert.match(page, /prefers-reduced-motion:\s*reduce/);
  assert.match(page, /prefers-reduced-motion: reduce/);
  assert.match(page, /forced-colors:active/);
  assert.match(page, /ceilidh-avatar-52\.gif/);
  assert.match(page, /ceilidh-avatar-52\.png/);
  assert.match(page, /tagOnSiteLinks/);
  assert.doesNotMatch(page, /<script is:inline>/);
  assert.doesNotMatch(page, /@font-face|fonts\.googleapis|atkinson/i);
});

test('links is on the sitemap with the other public utility pages', () => {
  assert.match(sitemap, /['"]links\/['"]/);
  assert.match(sitemap, /['"]privacy\/['"]/);
  assert.match(sitemap, /['"]terms\/['"]/);
  assert.doesNotMatch(sitemap, /['"]tune\/['"]/);
  assert.doesNotMatch(sitemap, /['"]style\/['"]/);
});

test('links art is the small local sprite set', () => {
  const gif = readFileSync(join(site, 'public/img/ceilidh-avatar-52.gif'));
  const png = readFileSync(join(site, 'public/img/ceilidh-avatar-52.png'));
  const strip = readFileSync(join(site, 'public/img/ceilidh-fling-strip.png'));
  assert.equal(gif.readUInt16LE(6), 52);
  assert.equal(gif.readUInt16LE(8), 52);
  assert.equal(png.readUInt32BE(16), 52);
  assert.equal(png.readUInt32BE(20), 52);
  assert.equal(strip.readUInt32BE(16), 640);
  assert.equal(strip.readUInt32BE(20), 64);
  assert.ok(gif.length < 4000);
  assert.ok(png.length < 2000);
  assert.ok(strip.length < 8000);
});
