import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bookableFromData,
  bookingConfig,
  readBookingForm,
  validateBooking,
  bookingSubject,
  bookingText,
  bookingMailto,
  handleBookingRequest,
  MESSAGES,
} from '../src/lib/booking.js';

const catalog = [
  { id: 'calgary-games-2027-09-01', name: 'Calgary Highland Games', when: 'Wed, Sep 1, 2027', city: 'Calgary', regionLabel: 'Alberta' },
  { id: 'tba-island', name: 'Island Games', when: 'Date TBA', city: 'Charlottetown', regionLabel: 'Prince Edward Island', tba: true },
];

function fields(extra = {}) {
  return {
    name: 'Aileen MacLeod',
    email: 'aileen@example.com',
    phone: '403-555-0100',
    requester_type: 'organizer',
    request_type: 'hire',
    events: ['calgary-games-2027-09-01'],
    performers: ['piper', 'drummer'],
    message: 'We need a piper and a drummer for the opening massed bands.',
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

function post(input, { origin = 'https://celticcoo.ca', accept = 'application/json', url = 'https://celticcoo.ca/api/book' } = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { origin, accept },
    body: formData(input),
  });
}

test('bookable ids stay stable and a TBA clash gets a prefix', () => {
  const list = bookableFromData(
    [{ id: 'shared', name: 'Shared', when: 'Sat, Jan 1, 2027', city: 'Banff', regionLabel: 'Alberta', end_date: '2027-01-01', start_date: '2027-01-01' }],
    [{ id: 'shared', name: 'Shared TBA', city: 'Banff', regionLabel: 'Alberta' }],
    '2026-10-23',
  );
  assert.deepEqual(list.map((e) => e.id), ['shared', 'tba-shared']);
  assert.equal(list[0].past, false);
  assert.equal(list[1].tba, true);
});

test('a past event is marked past and still keeps its id', () => {
  const list = bookableFromData(
    [{ id: 'old', name: 'Old Games', when: 'Sat, Jan 1, 2026', city: 'Banff', regionLabel: 'Alberta', end_date: '2026-01-02', start_date: '2026-01-01' }],
    [],
    '2026-10-23',
  );
  assert.equal(list[0].past, true);
  assert.equal(list[0].id, 'old');
});

test('a complete request is accepted and the email names the event, not the honeypot', () => {
  const input = readBookingForm(formData(fields()));
  const result = validateBooking(input, catalog);
  assert.equal(result.ok, true);
  assert.equal(result.spam, false);
  const text = bookingText(result.value, { sentFrom: 'https://celticcoo.ca' });
  assert.match(text, /Aileen MacLeod/);
  assert.match(text, /aileen@example.com/);
  assert.match(text, /Calgary Highland Games/);
  assert.match(text, /Piper/);
  assert.match(text, /Drummer/);
  assert.match(text, /CASL/);
  assert.match(text, /Under 18: No/);
  assert.doesNotMatch(text, /coo_hp|honeypot/i);
  assert.equal(bookingSubject(result.value), 'Performer request: Piper, Drummer for Calgary Highland Games');
});

test('missing consent, a minor without a guardian, and an empty request are rejected', () => {
  const noConsent = validateBooking(readBookingForm(formData(fields({ casl: '' }))), catalog);
  assert.equal(noConsent.ok, false);
  assert.equal(noConsent.errors.casl, MESSAGES.casl);

  const minor = validateBooking(readBookingForm(formData(fields({ under18: 'yes' }))), catalog);
  assert.equal(minor.errors.guardian_confirm, MESSAGES.guardian_confirm);

  const guardian = validateBooking(readBookingForm(formData(fields({ under18: 'yes', guardian_confirm: 'yes', requester_type: 'guardian' }))), catalog);
  assert.equal(guardian.ok, true);
  assert.match(bookingText(guardian.value), /parent or guardian/);

  const empty = validateBooking(readBookingForm(formData(fields({ events: [], message: 'short' }))), catalog);
  assert.equal(empty.errors.events, MESSAGES.events);
  assert.equal(empty.errors.message, MESSAGES.message);
});

test('a custom event can stand alone, and a half-filled one cannot', () => {
  const custom = validateBooking(readBookingForm(formData(fields({
    events: [],
    request_type: 'accompanist',
    performers: ['piper', 'other'],
    performer_other: 'A storyteller for the address to the haggis',
    custom_type: 'burns',
    custom_name: 'Family Burns supper',
    custom_date: '2027-01-25',
    custom_city: 'Okotoks',
    custom_province: 'Alberta',
    custom_venue: 'The legion hall',
  }))), catalog);
  assert.equal(custom.ok, true);
  const customText = bookingText(custom.value);
  assert.match(customText, /Family Burns supper/);
  assert.match(customText, /Burns supper/);
  assert.match(customText, /storyteller/);
  assert.match(bookingSubject(custom.value), /Family Burns supper/);

  const half = validateBooking(readBookingForm(formData(fields({ events: [], custom_name: 'Wedding' }))), catalog);
  assert.equal(half.ok, false);
  assert.equal(half.errors.custom_type, MESSAGES.custom_type);
  assert.equal(half.errors.custom_date, MESSAGES.custom_date);
  assert.equal(half.errors.events, undefined);
});

test('unknown events, a bad email, a newline in the name, and a filled honeypot', () => {
  const unknown = validateBooking(readBookingForm(formData(fields({ events: ['not-a-real-event'] }))), catalog);
  assert.equal(unknown.errors.events, MESSAGES.events_unknown);

  const email = validateBooking(readBookingForm(formData(fields({ email: 'not-an-email' }))), catalog);
  assert.equal(email.errors.email, MESSAGES.email);

  const injected = validateBooking(readBookingForm(formData(fields({ name: 'Aileen\nBcc: spam@example.com' }))), catalog);
  assert.equal(injected.ok, false);
  assert.equal(injected.errors.name, MESSAGES.name);

  const spam = validateBooking(readBookingForm(formData(fields({ booking_hp: 'https://spam.example' }))), catalog);
  assert.equal(spam.ok, true);
  assert.equal(spam.spam, true);
});

test('the handler emails hello@ and does not mail a honeypot or a cross-site post', async () => {
  const sent = [];
  const ok = await handleBookingRequest(post(fields()), {
    catalog,
    to: 'hello@celticcoo.ca',
    send: async (msg) => { sent.push(msg); },
  });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'hello@celticcoo.ca');
  assert.equal(sent[0].from.email, 'bookings@celticcoo.ca');
  assert.equal(sent[0].replyTo.email, 'aileen@example.com');
  assert.match(sent[0].text, /opening massed bands/);
  assert.match(sent[0].html, /Calgary Highland Games/);
  assert.doesNotMatch(sent[0].html, /<script/i);

  const honeypot = await handleBookingRequest(post(fields({ booking_hp: 'filled' })), {
    catalog,
    send: async (msg) => { sent.push(msg); },
  });
  assert.equal(honeypot.status, 200);
  assert.equal(sent.length, 1);

  const foreign = await handleBookingRequest(post(fields(), { origin: 'https://evil.example' }), {
    catalog,
    send: async () => { throw new Error('should not send'); },
  });
  assert.equal(foreign.status, 403);
});

test('a missing email binding returns a mailto fallback and does not throw', async () => {
  const res = await handleBookingRequest(post(fields()), { catalog, to: 'hello@celticcoo.ca', send: null });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'email_not_configured');
  assert.match(body.mailto, /^mailto:hello@celticcoo\.ca\?/);
  assert.match(decodeURIComponent(body.mailto), /Aileen MacLeod/);

  const failed = await handleBookingRequest(post(fields()), {
    catalog,
    to: 'hello@celticcoo.ca',
    send: async () => { const err = new Error('recipient not verified'); err.code = 'E_RECIPIENT'; throw err; },
  });
  assert.equal(failed.status, 503);
  const failedBody = await failed.json();
  assert.equal(failedBody.code, 'email_failed');
  assert.match(failedBody.mailto, /^mailto:hello@celticcoo\.ca\?/);
});

test('a browser form post without JSON gets an HTML thank-you', async () => {
  const res = await handleBookingRequest(post(fields(), { accept: 'text/html' }), {
    catalog,
    send: async () => {},
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Ceilidh has the note/);
  assert.match(html, /noindex/);
  assert.doesNotMatch(html, /aileen@example.com/);
});

const faire = {
  siteName: 'The Faire Gate',
  siteUrl: 'https://faire.example',
  destinationEmail: 'bookings@faire.example',
  fromEmail: 'requests@faire.example',
  fromName: 'The Faire Gate',
  subjectPrefix: 'Booking request',
  requesterTypes: [['individual', 'Individual'], ['organizer', 'Faire organizer'], ['guardian', 'Parent or guardian'], ['other', 'Other']],
  requestTypes: [['hire', 'Hire performers'], ['accompanist', 'Find a partner act']],
  performerTypes: [['jouster', 'Jouster'], ['minstrel', 'Minstrel'], ['other', 'Other']],
  customEventTypes: [['market', 'Market day'], ['other', 'Other']],
  email: {
    lead: 'The gate passed along a booking request.',
    replyNote: 'Reply to this email to reach the requester. Do not publish it.',
    disclosure: 'The Faire Gate is not the performer or an agency.',
    consent: 'The requester agreed that The Faire Gate may email them about this request (CASL).',
    performersHeading: 'Acts needed',
  },
  responses: {
    sentTitle: 'Sent · {siteName}',
    thanksHeading: 'The gate has the note.',
    thanksSpam: ['Thank you.'],
    thanksSent: ['Your request is on its way to {email}.'],
    fallbackTitle: 'Email the gate',
    fallbackHeading: 'One more step.',
    fallbackMissing: ['Ready for {email}.'],
    fallbackFailed: ['Ready for {email}.'],
    originParagraph: 'Open the form on {siteName}.',
    openEmailLabel: 'Open the email',
    returnLabel: 'Return to the form',
  },
};

test('a sister niche keeps its own types, copy, and destination', async () => {
  const rejected = validateBooking(readBookingForm(formData(fields({ performers: ['piper'] }))), catalog, faire);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errors.performers, MESSAGES.performers);

  const accepted = validateBooking(readBookingForm(formData(fields({
    performers: ['minstrel', 'other'],
    performer_other: 'A storyteller',
    events: [],
    custom_type: 'market',
    custom_name: 'Harvest market',
    custom_date: '2027-08-01',
    custom_city: 'Red Deer',
    custom_province: 'Alberta',
  }))), catalog, faire);
  assert.equal(accepted.ok, true);
  const text = bookingText(accepted.value, { config: faire, sentFrom: 'https://faire.example' });
  assert.match(text, /The Faire Gate/);
  assert.match(text, /Minstrel/);
  assert.match(text, /Market day/);
  assert.match(text, /Acts needed/);
  assert.doesNotMatch(text, /Ceilidh|Celtic|Piper|Burns/);
  assert.equal(bookingSubject(accepted.value, faire), 'Booking request: Minstrel, A storyteller for Harvest market');

  const sent = [];
  const res = await handleBookingRequest(post(fields({ performers: ['jouster'] })), {
    catalog,
    config: faire,
    send: async (msg) => { sent.push(msg); },
  });
  assert.equal(res.status, 200);
  assert.equal(sent[0].to, 'bookings@faire.example');
  assert.equal(sent[0].from.email, 'requests@faire.example');
  assert.equal(sent[0].from.name, 'The Faire Gate');
  assert.match(sent[0].text, /The gate passed along a booking request/);
  assert.doesNotMatch(sent[0].text, /Ceilidh/);

  const html = await handleBookingRequest(post(fields({ performers: ['jouster'] }), { accept: 'text/html' }), {
    catalog,
    config: faire,
    send: async () => {},
  });
  const page = await html.text();
  assert.match(page, /The gate has the note/);
  assert.match(page, /The Faire Gate/);
});

test('niche words stay in the config file', () => {
  const files = [
    '../src/lib/booking.js',
    '../src/pages/book/index.astro',
    '../src/pages/book/checklist/index.astro',
    '../src/components/BookLink.astro',
  ];
  for (const file of files) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /piper|ceilidh|celtic|burns|highland|hello@/i, file);
  }
  assert.equal(
    bookingConfig.checklist.disclaimer,
    "This is a checklist, not a contract or legal advice. The Celtic Coo isn't a party to any agreement. Please use your own agreement.",
  );
  assert.deepEqual(bookingConfig.checklist.items.map((item) => item.label), [
    'Date', 'Set times', 'Fee', 'Deposit', 'Cancellation', 'Travel', 'Sound or equipment', 'Dress',
  ]);
});

test('mailto helper keeps a usable subject', () => {
  const result = validateBooking(readBookingForm(formData(fields())), catalog);
  const href = bookingMailto(result.value, 'hello@celticcoo.ca', { sentFrom: 'https://celticcoo.ca' });
  assert.match(href, /subject=Performer%20request/);
  assert.ok(href.length < 2000);
});
