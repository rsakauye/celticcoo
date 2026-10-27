import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveLimit, assessBurst, decideGuard, decidePerformerVolume, looksGibberish, seasonFor } from '../breaker.js';
import celticcoo from '../sites/celticcoo.js';

const { seasons, timeZone, offSeasonMultiplier, floorPerDay, ceilingPerDay, outboundDailyCap, minBurst } = celticcoo.guard;

function at(iso) {
  return new Date(iso);
}

function limitFor(now, extra = {}) {
  return adaptiveLimit({
    now,
    seasons,
    timeZone,
    floor: floorPerDay,
    ceiling: ceilingPerDay,
    offSeasonMultiplier,
    ...extra,
  });
}

test('Celtic Coo seasons raise the multiplier and the rest of the year does not', () => {
  assert.equal(seasonFor(at('2027-01-20T18:00:00Z'), seasons, timeZone).id, 'burns');
  assert.equal(seasonFor(at('2027-01-10T18:00:00Z'), seasons, timeZone).id, 'burns');
  assert.equal(seasonFor(at('2027-01-31T18:00:00Z'), seasons, timeZone).id, 'burns');
  assert.equal(seasonFor(at('2026-12-31T18:00:00Z'), seasons, timeZone).id, 'hogmanay');
  assert.equal(seasonFor(at('2027-01-04T18:00:00Z'), seasons, timeZone).id, 'hogmanay');
  assert.equal(seasonFor(at('2027-01-09T18:00:00Z'), seasons, timeZone), null);
  assert.equal(seasonFor(at('2027-04-01T18:00:00Z'), seasons, timeZone).id, 'games');
  assert.equal(seasonFor(at('2027-08-31T18:00:00Z'), seasons, timeZone).id, 'games');
  assert.equal(seasonFor(at('2027-09-02T18:00:00Z'), seasons, timeZone), null);
  assert.equal(seasonFor(at('2027-11-20T18:00:00Z'), seasons, timeZone).id, 'andrews');
  assert.equal(seasonFor(at('2027-11-01T18:00:00Z'), seasons, timeZone), null);
});

test('the limit is last year or the rolling average, times the season, inside the floor and ceiling', () => {
  const quiet = limitFor(at('2027-03-01T18:00:00Z'), { baseline: 0 });
  assert.equal(quiet.limit, floorPerDay);
  assert.equal(quiet.source, 'rolling');
  assert.equal(quiet.season, null);

  const burns = limitFor(at('2027-01-20T18:00:00Z'), { baseline: 100 });
  assert.equal(burns.season, 'burns');
  assert.equal(burns.multiplier, 4);
  assert.equal(burns.limit, ceilingPerDay);

  const fromYear = limitFor(at('2027-03-01T18:00:00Z'), { baseline: 2, sameWeekLastYear: 10 });
  assert.equal(fromYear.source, 'last_year');
  assert.equal(fromYear.baseline, 10);
  assert.equal(fromYear.limit, 30);

  const emptyYear = limitFor(at('2027-03-01T18:00:00Z'), { baseline: 4, sameWeekLastYear: 0 });
  assert.equal(emptyYear.source, 'rolling');
  assert.equal(emptyYear.limit, 12);
});

function organizerBurst() {
  return [1, 2, 3, 4, 5].map((n) => ({
    sender: 'organizer@example.com',
    org: 'Foothills Games',
    text: `Please book act ${n} for a separate performance.`,
    fields: { when: `2027-07-0${n}`, place: `Field ${n}`, act: `band-${n}` },
    spf: 'pass',
    dkim: 'pass',
    turnstile: 'pass',
  }));
}

test('one organizer with distinct events is held, not paused', () => {
  const burst = assessBurst(organizerBurst(), { minBurst });
  assert.equal(burst.kind, 'bulk_organizer');
  const decision = decideGuard({
    count: 5,
    limit: 80,
    burst,
    outboundToday: 1,
    outboundCap: outboundDailyCap,
  });
  assert.equal(decision.action, 'hold');
  assert.equal(decision.reason, 'bulk_organizer');
});

test('the same template with a new date, place, or act is still a bulk request', () => {
  const items = [1, 2, 3, 4].map((n) => ({
    sender: 'organizer@example.com',
    org: 'Burns Circuit',
    text: `Please book a pipe band for our Burns Supper. Arrival 6 PM. Set 7 PM. Budget similar. Night ${n}.`,
    fields: { when: `2027-01-${10 + n} 6 PM`, place: `Lodge ${n}`, act: 'pipe band' },
    spf: 'pass',
    dkim: 'pass',
    turnstile: 'unknown',
  }));
  const burst = assessBurst(items, { minBurst });
  assert.equal(burst.kind, 'bulk_organizer');
  assert.deepEqual(decideGuard({ count: 4, limit: 8, burst }).action, 'hold');
});

test('abuse signals pause, and a short or merely busy hour does not', () => {
  const repeated = [1, 2, 3, 4].map(() => ({
    sender: 'organizer@example.com',
    text: 'Please book a pipe band for our Burns Supper on 23 January 2027 at 7 PM.',
    fields: { when: '2027-01-23 7 PM', place: 'Lodge', act: 'pipe band' },
    spf: 'pass',
    dkim: 'pass',
  }));
  assert.equal(assessBurst(repeated, { minBurst }).kind, 'abuse');
  assert.ok(assessBurst(repeated, { minBurst }).reasons.includes('repeated_payload'));

  const rotating = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
    sender: `${id}@example.com`,
    text: `Unique note ${id} about nothing in particular here today.`,
    fields: { when: id, place: id, act: id },
    spf: 'pass',
    dkim: 'pass',
  }));
  assert.ok(assessBurst(rotating, { minBurst }).reasons.includes('rotating_senders'));

  const junk = [1, 2, 3, 4].map((n) => ({
    sender: 'same@example.com',
    text: `bcdfghjklm qwrtyplkmn item ${n}`,
    fields: { when: `day ${n}`, place: `hall ${n}`, act: `act ${n}` },
  }));
  assert.equal(looksGibberish(junk[0].text), true);
  assert.ok(assessBurst(junk, { minBurst }).reasons.includes('gibberish'));

  const linked = [1, 2, 3, 4].map(() => ({
    sender: 'same@example.com',
    text: 'See https://a.example https://b.example https://c.example now',
    links: 3,
  }));
  assert.ok(assessBurst(linked, { minBurst }).reasons.includes('links'));

  const spoofed = [1, 2, 3, 4].map((n) => ({
    sender: 'same@example.com',
    text: `Real looking note number ${n} with a date.`,
    fields: { when: `2027-05-0${n}`, place: 'Hall', act: 'band' },
    spf: 'fail',
    dkim: 'pass',
  }));
  assert.ok(assessBurst(spoofed, { minBurst }).reasons.includes('auth_fail'));

  const bots = [1, 2, 3, 4].map((n) => ({
    sender: 'same@example.com',
    text: `Form post ${n} for a wedding piper in Calgary.`,
    fields: { when: `2027-06-0${n}`, place: 'Calgary', act: 'piper' },
    turnstile: 'fail',
  }));
  assert.ok(assessBurst(bots, { minBurst }).reasons.includes('turnstile_fail'));

  for (const items of [repeated, rotating, junk, linked, spoofed, bots]) {
    const burst = assessBurst(items, { minBurst });
    assert.equal(decideGuard({ count: 4, limit: 80, burst, outboundToday: 0, outboundCap: outboundDailyCap }).action, 'pause');
  }

  const few = organizerBurst().slice(0, minBurst - 1);
  assert.equal(assessBurst(few, { minBurst }).kind, 'normal');
  assert.equal(decideGuard({ count: 8, limit: 8, burst: { kind: 'normal', reasons: [] } }).action, 'allow');
  assert.equal(decideGuard({ count: 9, limit: 8, burst: { kind: 'normal', reasons: [] } }).reason, 'over_seasonal');
});

test('a head count at the burst floor is held and is not paused', () => {
  const small = decidePerformerVolume({ pipers: 2, drummers: 1 }, {
    minBurst,
    sender: 'organizer@example.com',
    when: '2027-07-04',
    place: 'Lethbridge',
  });
  assert.equal(small.action, 'allow');
  assert.equal(small.total, 3);

  const lineup = decidePerformerVolume({
    pipers: 20,
    drummers: 10,
    dancers: 8,
    other: 2,
    otherNote: 'storytellers',
  }, {
    minBurst,
    sender: 'organizer@example.com',
    when: '2027-07-04',
    place: 'Lethbridge',
  });
  assert.equal(lineup.action, 'hold');
  assert.equal(lineup.reason, 'bulk_organizer');
  assert.equal(lineup.total, 40);
  assert.notEqual(lineup.action, 'pause');
});

test('the outbound cost cap pauses even a legit organizer burst', () => {
  const burst = assessBurst(organizerBurst(), { minBurst });
  const decision = decideGuard({
    count: 5,
    limit: 80,
    burst,
    outboundToday: outboundDailyCap,
    outboundCap: outboundDailyCap,
  });
  assert.equal(decision.action, 'pause');
  assert.equal(decision.reason, 'outbound_cap');
});
