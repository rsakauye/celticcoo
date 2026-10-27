import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const labels = ['Download calendar file', 'Add to Google Calendar', 'Add to Outlook calendar'];

const widget = readFileSync(join(here, '../src/components/AddToCalendar.astro'), 'utf8');
const glyph = readFileSync(join(here, '../src/components/CalendarGlyph.astro'), 'utf8');
const stylePage = readFileSync(join(here, '../src/pages/style/index.astro'), 'utf8');
const sitemap = readFileSync(join(here, '../src/pages/sitemap.xml.js'), 'utf8');
const layout = readFileSync(join(here, '../src/layouts/Base.astro'), 'utf8');
const guide = readFileSync(join(root, 'STYLEGUIDE.md'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

test('calendar icon buttons keep the same hrefs and have accessible names', () => {
  for (const label of labels) {
    assert.match(widget, new RegExp(`label: '${label.replace(/[.]/g, '\\.')}'`));
  }
  assert.match(widget, /href: icsHref/);
  assert.match(widget, /href: links\.google/);
  assert.match(widget, /href: links\.outlook/);
  assert.match(widget, /aria-label=\{action\.label\}/);
  assert.match(widget, /title=\{action\.label\}/);
  assert.match(widget, /u\(`events\/\$\{e\.id\}\.ics`\)/);
  assert.match(widget, /rel=\{action\.external \? 'noopener noreferrer'/);
  assert.match(widget, /target=\{action\.external \? '_blank'/);
  assert.match(widget, /min-width:\s*44px/);
  assert.match(widget, /min-height:\s*44px/);
  assert.match(widget, /width:\s*44px/);
  assert.match(widget, /height:\s*44px/);
  assert.doesNotMatch(widget, />Download \.ics</);
  assert.doesNotMatch(widget, /fonts\.google|fontawesome|iconify|unpkg|jsdelivr|cdn\.jsdelivr/i);
  assert.doesNotMatch(widget, /<img[\s>]/);
});

test('calendar icons are inline, generic, and share one stroke', () => {
  assert.match(glyph, /<svg/);
  assert.match(glyph, /viewBox="0 0 24 24"/);
  assert.match(glyph, /stroke-width="1\.75"/);
  assert.match(glyph, /stroke-linecap="round"/);
  assert.match(glyph, /stroke-linejoin="round"/);
  assert.match(glyph, /currentColor/);
  assert.match(glyph, />\.ics</);
  assert.match(glyph, /mark === 'g'/);
  assert.match(glyph, /mark === 'mail'/);
  assert.match(glyph, /--cal-glyph, 32px/);
  assert.equal(glyph.match(/stroke-width="/g).length, 1);
  assert.doesNotMatch(glyph, /https?:\/\//);
  assert.doesNotMatch(glyph, /fonts\.google|fontawesome|iconify|unpkg|jsdelivr/i);
});

test('the style page shows the tokens and stays out of the index and sitemap', () => {
  assert.match(stylePage, /noindex=\{true\}/);
  assert.match(stylePage, /## Voice and copy|Voice and copy/);
  assert.match(stylePage, /To be filled in\./);
  assert.match(stylePage, /Tone:/);
  assert.match(stylePage, /Button and microcopy wording:/);
  assert.match(stylePage, /Accessible labels:/);
  for (const label of labels) assert.match(stylePage, new RegExp(label.replace(/[.]/g, '\\.')));
  assert.match(stylePage, /--cal-glyph: 16px/);
  assert.match(stylePage, /Legibility check, not a usable size/);
  assert.match(stylePage, /Legibility check: 16px on a light background/);
  assert.match(stylePage, /Legibility check: 16px on a dark background/);
  assert.match(stylePage, /#B82E26/);
  assert.match(stylePage, /#20284E/);
  assert.doesNotMatch(sitemap, /['"]style\/['"]/);
  assert.doesNotMatch(layout, /u\('style\/'\)/);
  assert.doesNotMatch(stylePage, /fonts\.google|fontawesome|iconify|unpkg|jsdelivr/i);
});

test('the style guide records the live tokens and the voice section', () => {
  assert.match(readme, /STYLEGUIDE\.md/);
  assert.match(guide, /#1f4d3a/);
  assert.match(guide, /#fbf6ec/);
  assert.match(guide, /#a54e1e/);
  assert.match(guide, /#f4e6c8/);
  assert.match(guide, /#B82E26/);
  assert.match(guide, /#1F4D3A/);
  assert.match(guide, /#20284E/);
  assert.match(guide, /Georgia/);
  assert.match(guide, /1\.75/);
  assert.match(guide, /44px/);
  assert.match(guide, /generic and self-hosted/i);
  assert.match(guide, /The calendar glyph \(`--cal-glyph`\) stays at 24px or larger, because the \.ics, G and envelope marks blur below that\./);
  assert.doesNotMatch(guide, /--cal-glyph: 16px/);
  for (const label of labels) assert.match(guide, new RegExp(label.replace(/[.]/g, '\\.')));
  const voice = guide.split('## Voice and copy')[1];
  assert.ok(voice);
  assert.match(voice, /friendly neighbour at the beer tent/);
  assert.match(voice, /No em dashes/);
  assert.match(voice, /"Download calendar file"/);
  assert.doesNotMatch(voice, /Download \.ics/);
  assert.match(voice, /aria-label="Add to Outlook calendar"/);
  assert.match(voice, /Words to avoid/);
  assert.doesNotMatch(voice, /To be filled in/);
});
