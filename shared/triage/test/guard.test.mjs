import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alertBody,
  assessChannel,
  clientHash,
  noteOutbound,
  resolveGuardConfig,
  setPaused,
} from '../guard.js';
import celticcoo from '../sites/celticcoo.js';
import { createGuardDb } from './guard-db.mjs';

const NOW = new Date('2026-10-26T18:00:00.000Z');
const config = resolveGuardConfig(celticcoo.guard, {});

function stamp(minutesAgo) {
  return new Date(NOW.getTime() - minutesAgo * 60 * 1000).toISOString();
}

test('a missing control table does not pause the site', async () => {
  const db = createGuardDb();
  db.state.control = null;
  const decision = await assessChannel(db, { channel: 'form', now: NOW, config, sender: 'organizer@example.com' });
  assert.equal(decision.action, 'allow');
  assert.equal(decision.reason, 'guard_unavailable');
  assert.deepEqual(await setPaused(db, true, NOW), { ok: false, code: 'guard_not_ready' });
});

test('the manual switch pauses before any counting and stays until it is cleared', async () => {
  const db = createGuardDb();
  const on = await setPaused(db, true, NOW);
  assert.equal(on.paused, true);
  assert.equal(on.latch, 'manual');
  const peeked = await assessChannel(db, { channel: 'peek', now: NOW, config });
  assert.equal(peeked.action, 'pause');
  assert.equal(peeked.reason, 'manual');
  assert.equal(peeked.alert, false);
  const off = await setPaused(db, false, NOW);
  assert.equal(off.paused, false);
  const open = await assessChannel(db, { channel: 'peek', now: NOW, config });
  assert.equal(open.action, 'allow');
});

test('one organizer with distinct requests is held and does not latch the switch', async () => {
  const db = createGuardDb();
  for (let n = 1; n <= 4; n += 1) {
    db.state.submissions.push({
      created_at: stamp(10),
      email: 'organizer@example.com',
      name: 'Sample Organizer',
      message: `Please book act ${n} for a separate performance on a different night.`,
      events_json: JSON.stringify([{ when: `2027-07-0${n}`, city: `Town ${n}` }]),
      custom_event_json: null,
      performers_json: JSON.stringify([`band-${n}`]),
      client_hash: 'abc',
    });
  }
  const decision = await assessChannel(db, {
    channel: 'form',
    now: NOW,
    config,
    sender: 'organizer@example.com',
    text: 'Please book act 5 for a separate performance.',
    fields: { when: '2027-07-05', place: 'Town 5', act: 'band-5' },
    turnstile: 'pass',
  });
  assert.equal(decision.action, 'hold');
  assert.equal(decision.reason, 'bulk_organizer');
  assert.equal(decision.alert, true);
  assert.equal(db.state.control.latch, '');
  assert.match(alertBody(decision, 'form'), /Action: hold/);
  assert.doesNotMatch(alertBody(decision, 'form'), /organizer@example.com/);
  const again = await assessChannel(db, {
    channel: 'form',
    now: NOW,
    config,
    sender: 'organizer@example.com',
    text: 'Please book act 6.',
    fields: { when: '2027-07-06', place: 'Town 6', act: 'band-6' },
    turnstile: 'pass',
  });
  assert.equal(again.alert, false);
});

test('repeated payloads and turnstile failures pause and latch', async () => {
  const db = createGuardDb();
  for (let n = 0; n < 4; n += 1) {
    db.state.inbound.push({
      created_at: stamp(5),
      envelope_from: 'same@example.com',
      subject: 'Offer',
      text_body: 'Buy now. Guest post and SEO services for your site today.',
      extracted_json: '{}',
      auth_spf: 'pass',
      auth_dkim: 'pass',
    });
  }
  const repeated = await assessChannel(db, {
    channel: 'inbound',
    now: NOW,
    config,
    sender: 'same@example.com',
    text: 'Buy now. Guest post and SEO services for your site today.',
    spf: 'pass',
    dkim: 'pass',
  });
  assert.equal(repeated.action, 'pause');
  assert.equal(repeated.reason, 'abuse');
  assert.equal(db.state.control.latch, 'severe');

  const quiet = createGuardDb();
  for (let n = 0; n < 4; n += 1) quiet.state.failures.push({ created_at: stamp(5), reason: 'turnstile_rejected' });
  const bots = await assessChannel(quiet, { channel: 'form', now: NOW, config, turnstile: 'fail' });
  assert.equal(bots.action, 'pause');
  assert.equal(bots.reason, 'abuse');
  assert.ok(bots.abuse.includes('turnstile_fail'));
});

test('the outbound cap pauses even when the messages look legitimate', async () => {
  const db = createGuardDb();
  db.state.control.outbound_day = '2026-10-26';
  db.state.control.outbound_count = config.outboundDailyCap;
  const decision = await assessChannel(db, {
    channel: 'inbound',
    now: NOW,
    config,
    sender: 'organizer@example.com',
    text: 'Please list our ceilidh on 2 May 2027 in Halifax.',
  });
  assert.equal(decision.action, 'pause');
  assert.equal(decision.reason, 'outbound_cap');
  const next = await noteOutbound(db, NOW, config.timeZone);
  assert.equal(next, config.outboundDailyCap + 1);
});

test('a client hash does not keep the raw address', async () => {
  const hash = await clientHash('203.0.113.10');
  assert.equal(hash.length, 16);
  assert.equal(hash.includes('203.0.113.10'), false);
  assert.equal(await clientHash(''), '');
});
