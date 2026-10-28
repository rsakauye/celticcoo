import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_ABOUT, NAV_CTA, NAV_GROUPS, PLAY_BLURB } from '../src/lib/nav.js';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');

test('header groups match the approved labels and live routes', () => {
  assert.deepEqual(NAV_GROUPS.map((group) => group.label), ['Events', 'Community', 'Heritage', 'Play']);
  assert.deepEqual(NAV_GROUPS[0].items.map((item) => item.label), ['Upcoming events', 'Results', 'Burns Night']);
  assert.deepEqual(NAV_GROUPS[1].items.map((item) => item.label), ['Clubs & lessons', 'Book performers', 'Shops', 'Fundraising']);
  assert.deepEqual(NAV_GROUPS[2].items.map((item) => item.label), ['Find your tartan', 'Trace your roots', 'What to wear']);
  assert.deepEqual(NAV_GROUPS[3].items.map((item) => [item.label, item.href]), [['Drone tuner', 'tune/']]);
  assert.equal(NAV_GROUPS[3].items[0].blurb, PLAY_BLURB);
  assert.equal(NAV_ABOUT.label, 'About');
  assert.equal(NAV_ABOUT.href, 'about/');
  assert.deepEqual(NAV_CTA, { href: 'submit/', label: 'Add yours' });
  assert.doesNotMatch(PLAY_BLURB, /coming soon/i);

  const pages = [
    ...NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href)),
    NAV_ABOUT.href,
    NAV_CTA.href,
  ];
  for (const href of pages) {
    const file = join(site, 'src/pages', href, 'index.astro');
    assert.equal(existsSync(file), true, file);
  }
});

test('the menu is a click disclosure with a no-js list and no hover or :has()', () => {
  const layout = readFileSync(join(site, 'src/layouts/Base.astro'), 'utf8');
  const nav = readFileSync(join(site, 'src/components/SiteNav.astro'), 'utf8');
  const script = readFileSync(join(site, 'public/nav.js'), 'utf8');
  const about = readFileSync(join(site, 'src/pages/about/index.astro'), 'utf8');

  assert.match(nav, /aria-expanded="false"/);
  assert.match(nav, /aria-controls=/);
  assert.match(nav, /NAV_CTA\.label/);
  assert.match(nav, /item\.blurb/);
  assert.doesNotMatch(nav, /About Ceilidh/);
  assert.doesNotMatch(nav, /coming soon/i);
  assert.match(about, /title="About"/);
  assert.match(about, /<h1>About The Celtic Coo<\/h1>/);

  assert.match(script, /aria-expanded/);
  assert.match(script, /Escape/);
  assert.match(script, /nav-lock/);
  assert.match(script, /documentElement/);
  assert.match(script, /safe-area|nav-lock/);
  assert.match(layout, /env\(safe-area-inset-bottom/);
  assert.match(layout, /#f0b27a/);
  assert.match(layout, /max-width:\s*899px/);
  assert.match(layout, /min-height:\s*44px/);
  assert.doesNotMatch(layout, /:has\(/);
  assert.doesNotMatch(script, /:has\(/);
  assert.doesNotMatch(nav, /:has\(/);
  assert.doesNotMatch(`${layout}\n${script}\n${nav}`, /:hover[^{]*\.nav-panel/);
});
