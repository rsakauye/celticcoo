import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleBookingRequest } from '../src/lib/booking.js';
import { mailerSend, sendViaMailer } from '../src/lib/mailer.js';
import { BOOKING_FROM, buildOutboundEmail, handleMailerRequest } from '../../workers/mailer/src/index.js';

const catalog = [
  { id: 'calgary-games-2027-09-01', name: 'Calgary Highland Games', when: 'Wed, Sep 1, 2027', city: 'Calgary', regionLabel: 'Alberta' },
];

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
    body: formData({
      name: 'Aileen MacLeod',
      email: 'aileen@example.com',
      requester_type: 'organizer',
      request_type: 'hire',
      events: ['calgary-games-2027-09-01'],
      performers: ['piper'],
      message: 'We need a piper for the opening massed bands.',
      adult_confirm: 'yes',
      casl: 'yes',
      ...input,
    }),
  });
}

const VERIFIED = 'verified-destination@example.com';

const sample = {
  to: 'someone-else@example.com',
  from: { email: 'attacker@example.com', name: 'The Celtic Coo' },
  replyTo: { email: 'aileen@example.com', name: 'Aileen MacLeod' },
  subject: 'Performer request: Piper',
  text: 'A booking note.',
  html: '<p>A booking note.</p>',
};

const configured = { BOOKING_TO: VERIFIED };

test('the mailer forces the from address and ignores the payload recipient', () => {
  const built = buildOutboundEmail(sample, configured);
  assert.equal(built.message.from.email, BOOKING_FROM);
  assert.equal(built.message.from.email, 'bookings@celticcoo.ca');
  assert.equal(built.message.to, VERIFIED);
  assert.notEqual(built.message.to, sample.to);
  assert.equal(built.message.replyTo.email, 'aileen@example.com');
  assert.notEqual(built.message.from.email, 'attacker@example.com');

  const ignored = buildOutboundEmail({ ...sample, to: 'not-an-email' }, configured);
  assert.equal(ignored.message.to, VERIFIED);
  assert.equal(buildOutboundEmail(sample, {}).error, 'not_configured');
  assert.equal(buildOutboundEmail(sample, { BOOKING_TO: 'not-an-email' }).error, 'not_configured');
  assert.equal(buildOutboundEmail(sample, { BOOKING_TO: 'owner@example.com\nBcc: x@example.com' }).error, 'not_configured');
  const injected = buildOutboundEmail({ ...sample, subject: 'line\nBcc: x@example.com' }, configured);
  assert.equal(injected.message.subject, 'line Bcc: x@example.com');
  assert.doesNotMatch(injected.message.subject, /\n/);
  assert.equal(buildOutboundEmail({ ...sample, replyTo: { email: 'bad' } }, configured).error, 'invalid');
});

test('the mailer sends only to BOOKING_TO and does not send when it is missing', async () => {
  const sent = [];
  const ok = await handleMailerRequest(new Request('https://celticcoo-mailer/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sample),
  }), { ...configured, EMAIL: { send: async (msg) => { sent.push(msg); } } });
  assert.equal(ok.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from.email, 'bookings@celticcoo.ca');
  assert.equal(sent[0].to, VERIFIED);
  assert.notEqual(sent[0].to, sample.to);

  const missingDestination = await handleMailerRequest(new Request('https://celticcoo-mailer/send', {
    method: 'POST',
    body: JSON.stringify(sample),
  }), { EMAIL: { send: async (msg) => { sent.push(msg); } } });
  assert.equal(missingDestination.status, 503);
  assert.equal((await missingDestination.json()).code, 'email_not_configured');
  assert.equal(sent.length, 1);

  const badDestination = await handleMailerRequest(new Request('https://celticcoo-mailer/send', {
    method: 'POST',
    body: JSON.stringify(sample),
  }), { BOOKING_TO: 'not-an-email', EMAIL: { send: async (msg) => { sent.push(msg); } } });
  assert.equal(badDestination.status, 503);
  assert.equal(sent.length, 1);

  const missing = await handleMailerRequest(new Request('https://celticcoo-mailer/send', {
    method: 'POST',
    body: JSON.stringify(sample),
  }), configured);
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).code, 'email_not_configured');

  const get = await handleMailerRequest(new Request('https://celticcoo-mailer/send'), { ...configured, EMAIL: { send: async () => {} } });
  assert.equal(get.status, 405);

  const failed = await handleMailerRequest(new Request('https://celticcoo-mailer/send', {
    method: 'POST',
    body: JSON.stringify(sample),
  }), { ...configured, EMAIL: { send: async () => { const err = new Error('recipient not verified'); err.code = 'E_RECIPIENT'; throw err; } } });
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).code, 'email_failed');
  assert.equal(sent.length, 1);
});

test('the pages function calls MAILER.fetch and falls back when that send fails', async () => {
  const seen = [];
  const mailer = {
    fetch: async (url, init) => {
      seen.push({ url: String(url), body: JSON.parse(init.body) });
      return Response.json({ ok: true });
    },
  };
  const send = mailerSend({ MAILER: mailer });
  assert.equal(typeof send, 'function');
  assert.equal(mailerSend({}), null);
  assert.equal(mailerSend({ EMAIL: { send() {} } }), null);

  const ok = await handleBookingRequest(post(), {
    catalog,
    to: 'hello@celticcoo.ca',
    send,
  });
  assert.equal(ok.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://celticcoo-mailer/send');
  assert.equal(seen[0].body.to, 'hello@celticcoo.ca');
  assert.equal(seen[0].body.from.email, 'bookings@celticcoo.ca');
  assert.equal(seen[0].body.replyTo.email, 'aileen@example.com');

  const workerSent = [];
  const linked = {
    fetch: (url, init) => handleMailerRequest(new Request(url, init), {
      BOOKING_TO: VERIFIED,
      EMAIL: { send: async (msg) => { workerSent.push(msg); } },
    }),
  };
  const endToEnd = await handleBookingRequest(post(), {
    catalog,
    to: 'hello@celticcoo.ca',
    send: (message) => sendViaMailer(linked, message),
  });
  assert.equal(endToEnd.status, 200);
  assert.equal(workerSent[0].to, VERIFIED);
  assert.notEqual(workerSent[0].to, 'hello@celticcoo.ca');
  assert.equal(workerSent[0].from.email, 'bookings@celticcoo.ca');

  const failing = {
    fetch: async () => Response.json({ ok: false, code: 'email_failed' }, { status: 502 }),
  };
  const failed = await handleBookingRequest(post(), {
    catalog,
    to: 'hello@celticcoo.ca',
    send: mailerSend({ MAILER: failing }),
  });
  assert.equal(failed.status, 503);
  const failedBody = await failed.json();
  assert.equal(failedBody.code, 'email_failed');
  assert.match(failedBody.mailto, /^mailto:hello@celticcoo\.ca\?/);
});

test('pages config binds MAILER and does not use send_email', () => {
  const pages = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../../workers/mailer/wrangler.jsonc', import.meta.url), 'utf8');
  const workerSrc = readFileSync(new URL('../../workers/mailer/src/index.js', import.meta.url), 'utf8');
  const fn = readFileSync(new URL('../functions/api/book.js', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(pages, /"send_email"/);
  assert.match(pages, /"binding": "MAILER"/);
  assert.match(pages, /"service": "celticcoo-mailer"/);
  assert.doesNotMatch(pages, /BOOKING_TO/);
  assert.match(pages, /"binding": "INTAKE_DB"/);
  assert.match(pages, /REPLACE_WITH_D1_DATABASE_ID/);
  assert.match(pages, /"TURNSTILE_HOSTNAMES": "celticcoo.ca,www.celticcoo.ca"/);
  const hostLine = pages.split('\n').find((line) => line.includes('"TURNSTILE_HOSTNAMES"'));
  assert.doesNotMatch(hostLine, /localhost|127\.0\.0\.1/);
  assert.doesNotMatch(pages, /"TURNSTILE_SECRET"\s*:/);
  assert.match(worker, /send_email/);
  assert.match(worker, /"workers_dev": false/);
  assert.match(worker, /"preview_urls": false/);
  assert.doesNotMatch(worker, /"routes"/);
  assert.doesNotMatch(worker, /allowed_destination_addresses/);
  assert.match(fn, /mailerSend\(env\)/);
  assert.match(fn, /BOOKING_TO_DEFAULT/);
  assert.match(fn, /verifyFromEnv\(env\)/);
  assert.match(fn, /intakeFromEnv\(env\)/);
  assert.doesNotMatch(fn, /env\.BOOKING_TO/);
  assert.doesNotMatch(fn, /env\.EMAIL/);
  assert.match(workflow, /workers\/mailer/);
  assert.match(workflow, /Workers Scripts:Edit/);
  assert.match(workflow, /secrets\.BOOKING_TO/);
  assert.match(workflow, /--secrets-file/);
  assert.doesNotMatch(workflow, /--var "BOOKING_TO:/);
  assert.doesNotMatch(workflow, /--var "FORWARD_TO:/);
  assert.match(workflow, /GitHub secret BOOKING_TO is empty/);
  const sourceCheck = readFileSync(new URL('../../.github/workflows/source-check.yml', import.meta.url), 'utf8');
  const dependabot = readFileSync(new URL('../../.github/dependabot.yml', import.meta.url), 'utf8');
  const top = sourceCheck.split('\njobs:')[0];
  const job = sourceCheck.split('\njobs:')[1];
  assert.match(top, /permissions:\n  contents: read/);
  assert.doesNotMatch(top, /contents: write/);
  assert.doesNotMatch(top, /issues: write/);
  assert.match(job, /contents: write/);
  assert.match(job, /issues: write/);
  for (const text of [workflow, sourceCheck]) {
    const uses = [...text.matchAll(/^[\s-]*uses:\s*(\S+)/gm)].map((match) => match[1]);
    assert.ok(uses.length > 0);
    for (const use of uses) assert.match(use, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  }
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /directory: \/site/);
  assert.match(dependabot, /directory: \/workers\/inbound/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.match(dependabot, /interval: weekly/);
  assert.match(workflow, /prepare-pages-config\.mjs/);
  assert.match(workflow, /secrets\.D1_DATABASE_ID/);
  assert.match(workflow, /PUBLIC_TURNSTILE_SITEKEY/);
  assert.match(workflow, /vars\.TURNSTILE_SITEKEY/);
  for (const src of [pages, worker, workerSrc, fn, workflow]) {
    assert.doesNotMatch(src, /gmail\.com/i);
  }
  const mailerStep = workflow.indexOf('Deploy mailer Worker');
  const pagesStep = workflow.indexOf('Deploy to Cloudflare Pages');
  assert.ok(mailerStep > 0 && mailerStep < pagesStep);
});
