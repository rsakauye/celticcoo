import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASL_TODO, caslFooterText } from '../../shared/casl/notice.js';
import { bookingText } from '../src/lib/booking.js';

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

test('CASL hooks are placeholders and do not invent an address', () => {
  const footer = caslFooterText();
  assert.match(footer, /TODO: CASL purpose/);
  assert.match(footer, /TODO: CASL sender identification/);
  assert.match(footer, /TODO: CASL withdraw-consent line/);
  assert.equal(CASL_TODO.mailingAddress, 'TODO: CASL mailing address');
  assert.doesNotMatch(footer, /@|PO Box|Street|Avenue/i);
  const form = readFileSync(join(here, '../src/components/NewsletterForm.astro'), 'utf8');
  assert.match(form, /caslFooterText\(\)/);
  const notice = readFileSync(join(root, 'shared/casl/notice.js'), 'utf8');
  assert.doesNotMatch(notice, /@[a-z0-9.-]+\.[a-z]{2,}/i);
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
  assert.match(text, /TODO: CASL purpose/);
  assert.match(text, /TODO: CASL mailing address/);
});

test('the site source does not load an analytics beacon', () => {
  const files = [...walk(join(here, '../src')), ...walk(join(here, '../public'))];
  const blob = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(blob, /cloudflareinsights|cf-beacon|googletagmanager|gtag\(|plausible|umami|fathom/i);
});
