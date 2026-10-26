import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASL_NOTICE, MAILING_ADDRESS, caslFooterText } from '../../shared/casl/notice.js';
import { bookingText } from '../src/lib/booking.js';
import bookingConfig from '../../data/booking.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(astro|js|mjs|html|css)$/.test(name)) out.push(path);
  }
  return out;
}

test('CASL notice uses the published post-office box and has no placeholder', () => {
  const footer = caslFooterText();
  assert.equal(CASL_NOTICE.mailingAddress, MAILING_ADDRESS);
  assert.equal(CASL_NOTICE.senderId.includes('The Celtic Coo'), true);
  assert.match(footer, /You wrote to The Celtic Coo/);
  assert.match(footer, /PO Box 1604, Okotoks, AB T1S 1B5, Canada/);
  assert.match(footer, /only the word unsubscribe/);
  assert.match(footer, /https:\/\/celticcoo\.ca\/privacy\//);
  assert.doesNotMatch(footer, /\bTODO\b|\{\{|\[PLACEHOLDER\]/i);
  assert.doesNotMatch(footer, /@/);
  assert.doesNotMatch(footer, /Street|Avenue|Drive|Road|Lane|Crescent|Boulevard/i);
  assert.equal(bookingConfig.senderAddress, MAILING_ADDRESS);
  const form = readFileSync(join(here, '../src/components/NewsletterForm.astro'), 'utf8');
  assert.match(form, /MAILING_ADDRESS/);
  assert.match(form, /CONTACT_EMAIL/);
  assert.match(form, /You can unsubscribe at any time/);
  assert.doesNotMatch(form, /caslFooterText|\bTODO\b/);
  const site = readFileSync(join(here, '../src/lib/site.js'), 'utf8');
  assert.match(site, /shared\/casl\/notice\.js/);
  assert.doesNotMatch(site, /PO Box/);
  const notice = readFileSync(join(root, 'shared/casl/notice.js'), 'utf8');
  assert.doesNotMatch(notice, /@[a-z0-9.-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(notice, /\bTODO\b/);
  const layout = readFileSync(join(here, '../src/layouts/Base.astro'), 'utf8');
  assert.match(layout, /postOfficeBoxNumber: '1604'/);
  assert.match(layout, /T1S 1B5/);
  const text = bookingText({
    name: 'Sample Organizer',
    email: 'ada@example.com',
    phone: '',
    requesterType: 'organizer',
    requestType: 'performer',
    events: [],
    performers: [],
    performerOther: '',
    message: 'A short request for a player.',
    budget: '',
    under18: false,
  });
  assert.match(text, /The Celtic Coo \(https:\/\/celticcoo\.ca\)/);
  assert.match(text, /PO Box 1604, Okotoks, AB T1S 1B5, Canada/);
  assert.doesNotMatch(text, /\bTODO\b/);
});

test('the site source does not load an analytics beacon', () => {
  const files = [...walk(join(here, '../src')), ...walk(join(here, '../public'))];
  const blob = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(blob, /cloudflareinsights|cf-beacon|googletagmanager|gtag\(|plausible|umami|fathom/i);
});
