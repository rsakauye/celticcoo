import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBookingRequest } from '../src/lib/booking.js';

const catalog = [
  { id: 'sample-games', name: 'Sample Highland Games', when: 'Sat, Jul 4, 2027', city: 'Lethbridge', regionLabel: 'Alberta' },
];

function fields(extra = {}) {
  return {
    name: 'Sample Organizer',
    email: 'organizer@example.com',
    phone: '',
    requester_type: 'organizer',
    request_type: 'hire',
    events: ['sample-games'],
    performers: ['piper'],
    message: 'Please book a piper for the opening set.',
    casl: 'yes',
    ...extra,
  };
}

function formData(input) {
  const body = new FormData();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) value.forEach((item) => body.append(key, item));
    else if (value != null) body.append(key, String(value));
  }
  return body;
}

function post(input) {
  return new Request('https://celticcoo.ca/api/book', {
    method: 'POST',
    headers: { origin: 'https://celticcoo.ca', accept: 'application/json' },
    body: formData(input),
  });
}

function intake() {
  const saved = [];
  const failures = [];
  const emails = [];
  return {
    saved,
    failures,
    emails,
    async save(row) { saved.push(row); },
    async log(entry) { failures.push(entry); },
    async markEmail(id, status) { emails.push({ id, status }); },
  };
}

test('a paused form does not store the message and does not send', async () => {
  const db = intake();
  let sent = 0;
  const res = await handleBookingRequest(post(fields()), {
    catalog,
    to: 'hello@celticcoo.ca',
    intake: db,
    send: async () => { sent += 1; },
    guard: async () => ({ action: 'pause', reason: 'manual' }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'paused');
  assert.equal(body.ok, false);
  assert.equal(sent, 0);
  assert.equal(db.saved.length, 0);
  assert.equal(db.failures.some((entry) => entry.reason === 'paused'), true);
  assert.equal(JSON.stringify(db.failures).includes('Sample Organizer'), false);
  assert.equal(db.failures.find((entry) => entry.reason === 'paused').detail, 'manual');
  assert.equal(JSON.stringify(body).includes('organizer@example.com'), false);

  const page = await handleBookingRequest(new Request('https://celticcoo.ca/api/book', {
    method: 'POST',
    headers: { origin: 'https://celticcoo.ca', accept: 'text/html' },
    body: formData(fields()),
  }), {
    catalog,
    to: 'hello@celticcoo.ca',
    intake: db,
    send: async () => { sent += 1; },
    guard: async () => ({ action: 'pause', reason: 'manual' }),
  });
  assert.equal(page.status, 503);
  const html = await page.text();
  assert.match(html, /temporarily unavailable/i);
  assert.match(html, /hello@celticcoo\.ca/);
  assert.equal(html.includes('organizer@example.com'), false);
  assert.equal(html.includes('Sample Organizer'), false);
  assert.equal(sent, 0);
});

test('a bulk organizer request is stored and not emailed', async () => {
  const db = intake();
  let sent = 0;
  const res = await handleBookingRequest(post(fields()), {
    catalog,
    to: 'hello@celticcoo.ca',
    intake: db,
    send: async () => { sent += 1; },
    guard: async (sample) => (sample.phase === 'peek'
      ? { action: 'allow' }
      : { action: 'hold', reason: 'bulk_organizer', ipHash: 'abc123' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.stored, true);
  assert.equal(body.email, 'skipped');
  assert.equal(sent, 0);
  assert.equal(db.saved.length, 1);
  assert.ok(db.saved[0].flags.includes('held_bulk_organizer'));
  assert.equal(db.saved[0].clientHash, 'abc123');
  assert.equal(db.emails[0].status, 'skipped');
});
