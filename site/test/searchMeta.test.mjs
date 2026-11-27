import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { events, groups, shops } from '../src/lib/data.js';
import { COPY } from '../src/lib/listing.js';
import { bookingConfig } from '../src/lib/booking.js';
import {
  DESCRIPTION_MAX,
  HOME_DESCRIPTION,
  TITLE_MAX,
  TITLE_ROOM,
  TITLE_SUFFIX,
  chooseSearchTitle,
  eventMetaDescription,
  eventPageTitle,
  groupMetaDescription,
  groupPageTitle,
  performerMetaDescription,
  shopMetaDescription,
  trimAtWord,
  trimMetaDescription,
} from '../src/lib/metaDescription.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) walk(path, out);
    else if (name.name.endsWith('.astro')) out.push(path);
  }
  return out;
}

function lastWord(sentence) {
  return sentence.replace(/[.!?]$/, '').split(/\s+/).pop();
}

test('trimAtWord and trimMetaDescription finish on a whole word', () => {
  assert.equal(TITLE_SUFFIX, ' · The Celtic Coo');
  assert.equal(TITLE_SUFFIX.length + TITLE_ROOM, TITLE_MAX);
  assert.equal(trimMetaDescription('Hello world.'), 'Hello world.');
  assert.equal(trimMetaDescription('Hello world'), 'Hello world.');
  assert.equal(trimMetaDescription('Hello world,'), 'Hello world.');
  assert.equal(trimMetaDescription('Hello world…'), 'Hello world.');
  assert.equal(trimMetaDescription('Hello world...'), 'Hello world.');
  assert.equal(trimAtWord('Supercalifragilistic', 8), '');

  const repeated = trimMetaDescription(`${'ceilidh '.repeat(40)}`, 30);
  assert.ok(repeated.length <= 30);
  assert.match(repeated, /^(ceilidh )+ceilidh\.$/);

  const cut = trimMetaDescription('Highland Games in Calgary and Southern Alberta, with ceilidhs and pipe bands tomorrow.', 52);
  assert.ok(cut.length <= 52);
  assert.match(cut, /[.!?]$/);
  assert.doesNotMatch(cut, /[,;:\u2013\u2014…-]$/);
  assert.equal(lastWord(cut), 'Alberta');

  const two = `Calgary Burns Club is a burns club in Calgary, Alberta. ${'word '.repeat(40)}`;
  assert.equal(trimMetaDescription(two), 'Calgary Burns Club is a burns club in Calgary, Alberta.');

  assert.equal(chooseSearchTitle(['Way too long for the room we have available today', 'Short name'], 20), 'Short name');
  assert.equal(chooseSearchTitle(['One two three four five six seven'], 12), 'One two');
  assert.equal(chooseSearchTitle(["Irish Cultural Society trad session at Hickey's"]), 'Irish Cultural Society trad session');
  assert.equal(chooseSearchTitle(['Halifax Citadel Society (78th Highlanders living history)']), 'Halifax Citadel Society');
  assert.equal(chooseSearchTitle(["St. Andrew's and Caledonian Society of the City of Vancouver"]), "St. Andrew's and Caledonian Society");
});

test('event, performer, group and shop descriptions are sentences from the record', () => {
  assert.equal(
    eventMetaDescription({
      name: 'Canmore Highland Games',
      when: 'Sat, Aug 1, 2027',
      venue: 'Centennial Park',
      city: 'Canmore',
      regionLabel: 'Alberta',
    }),
    'Canmore Highland Games is on Sat, Aug 1, 2027 at Centennial Park in Canmore, Alberta.',
  );
  assert.equal(
    eventMetaDescription({ name: 'Town Ceilidh', when: 'Fri, Jan 22, 2027', city: 'Calgary', regionLabel: 'Alberta' }),
    'Town Ceilidh is on Fri, Jan 22, 2027 in Calgary, Alberta.',
  );
  const huge = eventMetaDescription({
    name: 'Word '.repeat(40).trim(),
    when: 'Sat, Aug 1, 2027',
    venue: 'Centennial Park',
    city: 'Canmore',
    regionLabel: 'Alberta',
  });
  assert.ok(huge.length <= DESCRIPTION_MAX);
  assert.match(huge, /[.!?]$/);
  assert.equal(lastWord(huge) !== 'Wor', true);

  assert.equal(
    performerMetaDescription({ name: 'Ada Piper', act: 'solo piper', city: 'Calgary', regionLabel: 'Alberta' }),
    'Ada Piper (solo piper) is based in Calgary, Alberta.',
  );
  assert.equal(
    performerMetaDescription({
      name: 'Ada Piper',
      act: 'solo piper',
      when: 'Sat, Jan 25, 2027',
      venue: 'Hotel Arts',
      city: 'Calgary',
      regionLabel: 'Alberta',
    }),
    'Ada Piper (solo piper) is on Sat, Jan 25, 2027 at Hotel Arts in Calgary, Alberta.',
  );
  assert.equal(
    groupMetaDescription({ name: 'ScotDance Canada', kind: 'Association', city: 'National', regionLabel: 'National / multi-province' }),
    'ScotDance Canada is an Association in National / multi-province.',
  );
  assert.equal(
    shopMetaDescription({ name: 'The Highland Shoppe', category: 'kilt shop', city: 'Calgary', regionLabel: 'Alberta' }),
    'The Highland Shoppe is a kilt shop in Calgary, Alberta.',
  );
});

test('every published event, group and shop snippet stays under the caps', () => {
  const eventDescriptions = new Set();
  for (const event of events) {
    const title = `${eventPageTitle(event)}${TITLE_SUFFIX}`;
    assert.ok(title.length <= TITLE_MAX, title);
    const description = eventMetaDescription(event);
    assert.ok(description.length <= DESCRIPTION_MAX, description);
    assert.match(description, /[.!?]$/);
    assert.doesNotMatch(description, /[,;:\u2013\u2014…-]\.$/);
    assert.doesNotMatch(description, /\u2014/);
    assert.equal(eventDescriptions.has(description), false, description);
    eventDescriptions.add(description);
    const word = lastWord(description);
    assert.match(description, new RegExp(`(?:^|\\s)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.!?]$`));
  }
  const groupDescriptions = new Set();
  for (const group of groups) {
    const place = [group.city && group.city !== 'National' ? group.city : '', group.regionLabel].filter(Boolean).join(', ');
    const title = `${groupPageTitle(group, place)}${TITLE_SUFFIX}`;
    assert.ok(title.length <= TITLE_MAX, title);
    const description = groupMetaDescription(group);
    assert.ok(description.length <= DESCRIPTION_MAX, `${group.name}: ${description}`);
    assert.match(description, /[.!?]$/);
    assert.doesNotMatch(description, /\u2014/);
    assert.equal(groupDescriptions.has(description), false, description);
    groupDescriptions.add(description);
  }
  for (const shop of shops) {
    const description = shopMetaDescription(shop);
    assert.ok(description.length <= DESCRIPTION_MAX, description);
    assert.match(description, /[.!?]$/);
  }
});

test('section page descriptions are unique finished sentences', () => {
  const descriptions = new Map();
  const add = (label, text) => {
    assert.equal(typeof text, 'string', label);
    assert.ok(text.length >= 120 && text.length <= DESCRIPTION_MAX, `${label} (${text.length}): ${text}`);
    assert.match(text, /[.!?](?:\s+[A-Z][^!?]*[.!?])?$/);
    assert.doesNotMatch(text, /\u2014/);
    assert.equal(descriptions.has(text), false, `${label} repeats ${descriptions.get(text)}`);
    descriptions.set(text, label);
  };
  add('home', HOME_DESCRIPTION);
  add('performers', COPY.performersPage.description);
  add('book', bookingConfig.pageDescription);
  add('checklist', bookingConfig.checklist.description);
  const links = readFileSync(join(site, 'src/pages/links/index.astro'), 'utf8');
  add('links', links.match(/const description = "([^"]+)"/)[1]);
  for (const file of walk(join(site, 'src/pages'))) {
    const src = readFileSync(file, 'utf8');
    for (const match of src.matchAll(/description="([^"]+)"/g)) add(file, match[1]);
  }
});

test('footer and home page link the letter, events, performers and links', () => {
  const layout = readFileSync(join(site, 'src/layouts/Base.astro'), 'utf8');
  assert.match(layout, /<b><a href=\{u\('newsletter\/'\)\}>The Coo's Letter<\/a><\/b>/);
  assert.match(layout, /class="footer-links">[\s\S]*href=\{u\('events\/'\)\}>Events<\/a>[\s\S]*href=\{u\('performers\/'\)\}>Performers<\/a>[\s\S]*href=\{u\('links\/'\)\}>Links<\/a>/);
  const home = readFileSync(join(site, 'src/pages/index.astro'), 'utf8');
  assert.match(home, /href=\{u\('newsletter\/'\)\}/);
  assert.match(home, /href=\{u\('performers\/'\)\}/);
  const key = 'e6061a0668a20a80ee0d6a79eb16ce89';
  const script = readFileSync(join(site, '../tools/indexnow-ping.mjs'), 'utf8');
  const file = readFileSync(join(site, `public/${key}.txt`), 'utf8');
  assert.equal(file.trim(), key);
  assert.match(script, new RegExp(`const KEY = '${key}'`));
  assert.match(script, /https:\/\/api\.indexnow\.org\/indexnow/);
  assert.match(script, /host: HOST, key: KEY, keyLocation/);
  assert.match(script, /celticcoo\.ca/);
  assert.doesNotMatch(script, /fetch\([^)]*\)[\s\S]*fetch\(/);
});
