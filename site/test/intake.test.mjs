import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleBookingRequest } from '../src/lib/booking.js';
import {
  assessRisk,
  intakeFromEnv,
  intakeStatus,
  logIntakeFailure,
  verifyTurnstile,
} from '../src/lib/intake.js';
import { preparePagesConfig } from '../../scripts/prepare-pages-config.mjs';

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
    performers: ['piper'],
    message: 'We need a player for the opening massed bands on the listed date.',
    casl: 'yes',
    'cf-turnstile-response': 'token-ok',
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

function post(input, { origin = 'https://celticcoo.ca' } = {}) {
  return new Request('https://celticcoo.ca/api/book', {
    method: 'POST',
    headers: { origin, accept: 'application/json' },
    body: formData(input),
  });
}

function fakeDb(overrides = {}) {
  const submissions = [];
  const failures = [];
  const updates = [];
  return {
    submissions,
    failures,
    updates,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (overrides.failSave && sql.includes('INSERT INTO submissions')) {
                throw new Error('database unavailable');
              }
              if (sql.includes('INSERT INTO submissions')) submissions.push(args);
              else if (sql.includes('INSERT INTO submission_failures')) failures.push(args);
              else if (sql.includes('UPDATE submissions')) updates.push(args);
              else throw new Error(`unexpected sql: ${sql}`);
            },
          };
        },
      };
    },
  };
}

function baseValue(extra = {}) {
  return {
    name: 'Aileen MacLeod',
    email: 'aileen@example.com',
    phone: '',
    requesterType: 'organizer',
    requestType: 'hire',
    events: [{ id: 'calgary-games-2027-09-01', name: 'Calgary Highland Games', when: 'Wed, Sep 1, 2027', city: 'Calgary', regionLabel: 'Alberta' }],
    custom: null,
    performers: ['piper'],
    performerOther: '',
    message: 'We need a player for the opening massed bands on the listed date.',
    budget: '',
    under18: false,
    guardianConfirm: false,
    ...extra,
  };
}

test('risk flags catch a minor, a private contact ask, a cheque, and a missing date or venue', () => {
  assert.deepEqual(assessRisk(baseValue()), []);
  assert.equal(intakeStatus([]), 'new');

  const minor = assessRisk(baseValue({ message: 'My child is 12 years old and needs an accompanist.' }));
  assert.ok(minor.includes('minor_no_guardian'));
  assert.equal(intakeStatus(minor), 'flagged');

  const guarded = assessRisk(baseValue({
    under18: true,
    guardianConfirm: true,
    requesterType: 'guardian',
    message: 'My child is 12 years old and needs an accompanist.',
  }));
  assert.equal(guarded.includes('minor_no_guardian'), false);

  assert.ok(assessRisk(baseValue({ message: 'Please send the performer\'s private phone number.' })).includes('private_contact'));
  assert.ok(assessRisk(baseValue({ message: 'Can you pass along their email?' })).includes('private_contact'));
  assert.equal(assessRisk(baseValue({ message: 'Please check the date and the hall address.' })).includes('payment_oddity'), false);
  assert.ok(assessRisk(baseValue({ message: 'I will mail a cheque for the deposit.' })).includes('payment_oddity'));
  assert.ok(assessRisk(baseValue({ message: 'I can pay by e-transfer today.' })).includes('payment_oddity'));

  const undated = assessRisk(baseValue({
    events: [{ id: 'tba-island', name: 'Island Games', when: 'Date TBA', city: 'Charlottetown', tba: true }],
  }));
  assert.ok(undated.includes('missing_date'));
  assert.equal(undated.includes('missing_venue'), false);

  const noPlace = assessRisk(baseValue({
    events: [{ id: 'tba-island', name: 'Island Games', when: 'Date TBA', city: '', tba: true }],
  }));
  assert.ok(noPlace.includes('missing_date'));
  assert.ok(noPlace.includes('missing_venue'));

  const ownEvent = assessRisk(baseValue({
    events: [],
    custom: { type: 'wedding', name: 'Family supper', date: '2027-06-01', city: 'Okotoks', province: 'Alberta', venue: '' },
  }));
  assert.equal(ownEvent.includes('missing_date'), false);
  assert.ok(ownEvent.includes('missing_venue'));
});

test('siteverify fails closed and does not treat localhost as a production host', async () => {
  const env = { TURNSTILE_SECRET: 'test-secret', TURNSTILE_HOSTNAMES: 'celticcoo.ca,www.celticcoo.ca' };
  const request = new Request('https://celticcoo.ca/api/book', { headers: { 'CF-Connecting-IP': '203.0.113.5' } });

  assert.equal((await verifyTurnstile({ token: 'x', request, env: {} })).reason, 'turnstile_not_configured');
  assert.equal((await verifyTurnstile({ token: '', request, env })).reason, 'turnstile_missing');
  assert.equal((await verifyTurnstile({ token: 'x'.repeat(2049), request, env })).reason, 'turnstile_missing');

  let sent;
  const ok = await verifyTurnstile({
    token: 'token-ok',
    request,
    env,
    fetchImpl: async (url, init) => {
      sent = { url, body: init.body.toString() };
      return Response.json({ success: true, action: 'book', hostname: 'www.celticcoo.ca' });
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(sent.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.match(sent.body, /secret=test-secret/);
  assert.match(sent.body, /response=token-ok/);
  assert.equal(ok.secret, undefined);

  const rejected = await verifyTurnstile({
    token: 'token-bad',
    request,
    env,
    fetchImpl: async () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] }),
  });
  assert.equal(rejected.reason, 'turnstile_rejected');
  assert.equal(rejected.detail, 'invalid-input-response');

  const wrongAction = await verifyTurnstile({
    token: 'token-ok',
    request,
    env,
    fetchImpl: async () => Response.json({ success: true, action: 'login', hostname: 'celticcoo.ca' }),
  });
  assert.equal(wrongAction.reason, 'turnstile_action');
  assert.equal(wrongAction.detail, '');

  const local = await verifyTurnstile({
    token: 'token-ok',
    request,
    env,
    fetchImpl: async () => Response.json({ success: true, action: 'book', hostname: 'localhost' }),
  });
  assert.equal(local.reason, 'turnstile_hostname');

  const down = await verifyTurnstile({
    token: 'token-ok',
    request,
    env,
    fetchImpl: async () => { throw new Error('network'); },
  });
  assert.equal(down.reason, 'turnstile_unavailable');

  const status = await verifyTurnstile({
    token: 'token-ok',
    request,
    env,
    fetchImpl: async () => new Response('nope', { status: 503 }),
  });
  assert.equal(status.reason, 'turnstile_unavailable');
  assert.equal(status.detail, 'siteverify_503');
});

test('a failure log keeps the reason and drops the message, name, and email', async () => {
  const db = fakeDb();
  const spam = 'please write person@example.com and send a cheque to this long spam note';
  await logIntakeFailure(db, { reason: 'validation', detail: spam });
  assert.equal(db.failures.length, 1);
  assert.equal(db.failures[0][2], 'validation');
  assert.equal(db.failures[0][3], '');
  assert.equal(JSON.stringify(db.failures).includes('person@example.com'), false);
  assert.equal(JSON.stringify(db.failures).includes('cheque'), false);

  await logIntakeFailure(db, { reason: 'turnstile_rejected', detail: 'timeout-or-duplicate' });
  assert.equal(db.failures[1][3], 'timeout-or-duplicate');

  const missing = await logIntakeFailure(null, { reason: 'honeypot', detail: spam });
  assert.equal(missing, false);
});

test('a verified request is stored, flagged, and still kept when the notice fails', async () => {
  const db = fakeDb();
  const sent = [];
  const ok = await handleBookingRequest(post(fields({
    message: 'My child needs a player. Please send their private email. I will mail a cheque.',
  })), {
    catalog,
    to: 'hello@celticcoo.ca',
    send: async (msg) => { sent.push(msg); },
    verify: async (token) => ({ ok: token === 'token-ok' }),
    intake: intakeFromEnv({ INTAKE_DB: db }),
  });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.stored, true);
  assert.equal(body.email, 'sent');
  assert.equal(db.submissions.length, 1);
  assert.equal(db.submissions[0][3], 'flagged');
  const flags = JSON.parse(db.submissions[0][4]);
  const trustReasons = JSON.parse(db.submissions[0][20]);
  const redFlags = JSON.parse(db.submissions[0][22]);
  assert.ok(flags.includes('minor_no_guardian'));
  assert.ok(trustReasons.some((reason) => reason.code === 'turnstile_pass'));
  assert.equal(redFlags.minor_mentioned, true);
  assert.equal(redFlags.payment_request, true);
  assert.equal(redFlags.bot_instruction_attempt, false);
  assert.equal(JSON.stringify(trustReasons).includes('cheque'), false);
  assert.equal(JSON.stringify(trustReasons).includes('child'), false);
  assert.equal(JSON.stringify(redFlags).includes('child'), false);
  assert.equal(trustReasons.some((reason) => reason.code === 'turnstile_pass' && sent.length === 1), true);
  assert.ok(flags.includes('private_contact'));
  assert.ok(flags.includes('payment_oddity'));
  assert.match(sent[0].text, /Risk flags: .*minor_no_guardian/);
  assert.match(sent[0].text, /Status: flagged/);
  assert.equal(db.updates[0][0], 'sent');
  assert.equal(JSON.stringify(db.failures).includes('aileen@example.com'), false);

  const failedDb = fakeDb();
  const failed = await handleBookingRequest(post(fields()), {
    catalog,
    to: 'hello@celticcoo.ca',
    send: async () => { const err = new Error('recipient not verified'); err.code = 'E_RECIPIENT'; throw err; },
    verify: async () => ({ ok: true }),
    intake: intakeFromEnv({ INTAKE_DB: failedDb }),
  });
  assert.equal(failed.status, 200);
  const failedBody = await failed.json();
  assert.equal(failedBody.stored, true);
  assert.equal(failedBody.email, 'failed');
  assert.equal(failedDb.submissions.length, 1);
  assert.equal(failedDb.updates[0][0], 'failed');
  assert.equal(failedBody.mailto, undefined);
});

test('rejected attempts are logged without the payload and are not stored', async () => {
  const db = fakeDb();
  const intake = intakeFromEnv({ INTAKE_DB: db });
  const verify = async () => ({ ok: false, reason: 'turnstile_rejected', detail: 'invalid-input-response' });

  const blocked = await handleBookingRequest(post(fields()), { catalog, verify, intake });
  assert.equal(blocked.status, 403);
  assert.equal(db.submissions.length, 0);
  assert.equal(db.failures[0][2], 'turnstile_rejected');
  assert.equal(db.failures[0][3], 'invalid-input-response');

  const honeypot = await handleBookingRequest(post(fields({ booking_hp: 'https://spam.example/buy-now' })), {
    catalog,
    verify: async () => { throw new Error('should not verify'); },
    intake,
    send: async () => { throw new Error('should not send'); },
  });
  assert.equal(honeypot.status, 200);
  assert.equal(db.submissions.length, 0);
  assert.equal(db.failures[1][2], 'honeypot');
  assert.equal(db.failures[1][3], '');
  assert.equal(JSON.stringify(db.failures).includes('spam.example'), false);

  const minor = await handleBookingRequest(post(fields({ under18: 'yes' })), {
    catalog,
    verify: async () => ({ ok: true }),
    intake,
  });
  assert.equal(minor.status, 400);
  assert.equal(db.submissions.length, 0);
  assert.equal(db.failures[2][2], 'minor_no_guardian');
  assert.match(db.failures[2][3], /guardian_confirm/);
  assert.equal(db.failures[2][3].includes('aileen@example.com'), false);

  const invalid = await handleBookingRequest(post(fields({ email: 'not-an-email', message: 'x'.repeat(50) })), {
    catalog,
    verify: async () => ({ ok: true }),
    intake,
  });
  assert.equal(invalid.status, 400);
  assert.equal(db.submissions.length, 0);
  assert.equal(db.failures[3][2], 'validation');
  assert.match(db.failures[3][3], /email/);
  assert.equal(db.failures[3][3].includes('not-an-email'), false);
});

test('a database miss still sends the notice and does not drop the error reason', async () => {
  const db = fakeDb({ failSave: true });
  const sent = [];
  const res = await handleBookingRequest(post(fields()), {
    catalog,
    to: 'hello@celticcoo.ca',
    send: async (msg) => { sent.push(msg); },
    verify: async () => ({ ok: true }),
    intake: intakeFromEnv({ INTAKE_DB: db }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.stored, false);
  assert.equal(body.email, 'sent');
  assert.equal(sent.length, 1);
  assert.equal(db.submissions.length, 0);
  assert.equal(db.failures[0][2], 'store_failed');
  assert.equal(db.failures[0][3], 'insert_failed');
  assert.equal(JSON.stringify(db.failures).includes('aileen@example.com'), false);
});

test('the pages config keeps a placeholder id and the deploy helper does not print a real one', () => {
  const pages = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../migrations/0001_intake.sql', import.meta.url), 'utf8');
  const form = readFileSync(new URL('../src/pages/book/index.astro', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE submissions/);
  assert.match(migration, /CREATE TABLE submission_failures/);
  assert.match(migration, /CHECK \(status IN \('new', 'flagged', 'handled'\)\)/);
  assert.match(form, /action: 'book'/);
  assert.match(form, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit&onload=onBookTurnstileLoad/);
  assert.doesNotMatch(form, /TURNSTILE_SECRET|1x00000000000000000000AA/);

  const stripped = preparePagesConfig(pages, {});
  assert.equal(stripped.bound, false);
  assert.doesNotMatch(stripped.config, /d1_databases|REPLACE_WITH_D1_DATABASE_ID/);
  assert.match(stripped.config, /MAILER/);
  assert.match(stripped.config, /TURNSTILE_HOSTNAMES/);

  const id = '11111111-2222-4333-8444-555555555555';
  const bound = preparePagesConfig(pages, { D1_DATABASE_ID: id });
  assert.equal(bound.bound, true);
  assert.match(bound.config, new RegExp(id));
  assert.doesNotMatch(bound.config, /REPLACE_WITH_D1_DATABASE_ID/);
  assert.throws(() => preparePagesConfig(pages, { D1_DATABASE_ID: 'not-a-uuid' }));

  const dir = mkdtempSync(join(tmpdir(), 'pages-config-'));
  const file = join(dir, 'wrangler.jsonc');
  writeFileSync(file, pages);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/prepare-pages-config.mjs', import.meta.url)), file], {
    env: { ...process.env, D1_DATABASE_ID: id },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(id));
  assert.match(readFileSync(file, 'utf8'), new RegExp(id));
  rmSync(dir, { recursive: true, force: true });
});
