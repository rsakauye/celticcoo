import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOCIALS } from '../src/lib/socials.js';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const component = readFileSync(join(site, 'src/components/SocialLinks.astro'), 'utf8');
const layout = readFileSync(join(site, 'src/layouts/Base.astro'), 'utf8');
const links = readFileSync(join(site, 'src/pages/links/index.astro'), 'utf8');

test('profile addresses live in one module', () => {
  assert.deepEqual(SOCIALS.map((item) => item.id), ['instagram', 'facebook']);
  assert.equal(SOCIALS[0].href, 'https://www.instagram.com/celticcoo/');
  assert.equal(SOCIALS[1].href, 'https://www.facebook.com/celticcoo');
  assert.equal(SOCIALS[0].label, 'Instagram');
  assert.equal(SOCIALS[1].label, 'Facebook');
  assert.equal(SOCIALS[0].ariaLabel, 'The Celtic Coo on Instagram');
  assert.equal(SOCIALS[1].ariaLabel, 'The Celtic Coo on Facebook');
  for (const item of SOCIALS) {
    assert.equal(item.href.includes('utm_'), false);
    assert.equal(item.glyph.includes('utm_'), false);
  }
  assert.equal(createHash('sha256').update(SOCIALS[0].glyph).digest('hex'), 'acf15f9fb76fd2bda63eabbd917408607f4a8d4b40b332601765c83fb875ae73');
  assert.equal(createHash('sha256').update(SOCIALS[1].glyph).digest('hex'), '910dcaa575f731d3e2f1cadeb5a4fcbdcfa6d71ba3bd04c6d2734c4104bba816');
});

test('footer and links page share SocialLinks', () => {
  assert.match(layout, /import SocialLinks from '\.\.\/components\/SocialLinks\.astro'/);
  assert.match(layout, /<SocialLinks variant="icons" \/>/);
  assert.match(links, /import SocialLinks from '\.\.\/\.\.\/components\/SocialLinks\.astro'/);
  assert.match(links, /<SocialLinks variant="buttons" \/>/);
  assert.doesNotMatch(links, /instagram\.com|facebook\.com/);

  assert.match(component, /target="_blank"/);
  assert.match(component, /rel="noopener"/);
  assert.doesNotMatch(component, /noreferrer|utm_/);
  assert.match(component, /viewBox="0 0 24 24"/);
  assert.match(component, /fill="currentColor"/);
  assert.match(component, /width: 24px/);
  assert.match(component, /height: 24px/);
  assert.match(component, /width: 44px/);
  assert.match(component, /height: 44px/);
  assert.match(component, /min-width: 44px/);
  assert.match(component, /min-height: 44px/);
  assert.match(component, /#f0b27a/);
  assert.doesNotMatch(component, /transform:|shape-rendering|crispEdges|pixelated/);
  assert.equal(component.match(/aria-label=\{item\.ariaLabel\}/g).length, 2);
});
