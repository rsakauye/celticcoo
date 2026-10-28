import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOutcome, needsGetFallback, shouldRetry } from '../src/classify.js';
import { urlsEquivalent, isBotWallHost } from '../src/urls.js';
import { formatDisplayDate, isoDateInTimeZone } from '../src/dates.js';

test('display dates use the short month form', () => {
  assert.equal(formatDisplayDate('2026-10-27'), 'Oct 27, 2026');
  assert.equal(formatDisplayDate('2026-10-07'), 'Oct 7, 2026');
  assert.equal(formatDisplayDate('2026-01-01'), 'Jan 1, 2026');
  assert.equal(formatDisplayDate(null), null);
  assert.equal(formatDisplayDate('2026-13-01'), null);
  assert.equal(formatDisplayDate('October 27, 2026'), null);
});

test('run dates use the configured time zone', () => {
  assert.equal(isoDateInTimeZone(new Date('2026-10-27T05:30:00Z'), 'America/Edmonton'), '2026-10-26');
  assert.equal(isoDateInTimeZone(new Date('2026-10-27T06:00:00Z'), 'America/Edmonton'), '2026-10-27');
});

test('scheme and trailing slash are the same URL, a new host is not', () => {
  assert.equal(urlsEquivalent('http://Example.com/band/', 'https://example.com/band'), true);
  assert.equal(urlsEquivalent('https://example.com/band', 'https://www.example.com/band'), false);
  assert.equal(urlsEquivalent('https://example.com/band', 'https://example.com/band?season=1'), false);
  assert.equal(urlsEquivalent('https://example.com/band#times', 'https://example.com/band'), true);
});

test('bot-wall hosts match subdomains and not lookalikes', () => {
  assert.equal(isBotWallHost('https://www.facebook.com/some-page'), true);
  assert.equal(isBotWallHost('https://m.facebook.com/some-page'), true);
  assert.equal(isBotWallHost('https://instagram.com/some-page'), true);
  assert.equal(isBotWallHost('https://notfacebook.com/'), false);
  assert.equal(isBotWallHost('https://example.com/'), false);
});

test('HEAD falls back to GET only when HEAD has no usable answer', () => {
  assert.equal(needsGetFallback({ status: 405, error: null }), true);
  assert.equal(needsGetFallback({ status: 404, error: null }), true);
  assert.equal(needsGetFallback({ status: null, error: 'timeout' }), true);
  assert.equal(needsGetFallback({ status: 200, error: null }), false);
  assert.equal(needsGetFallback({ status: 403, error: null }), false);
  assert.equal(needsGetFallback({ status: 301, error: null }), false);
});

test('retry once skips DNS and a definitive 403', () => {
  assert.equal(shouldRetry({ status: null, error: 'timeout' }), true);
  assert.equal(shouldRetry({ status: 503, error: null }), true);
  assert.equal(shouldRetry({ status: 429, error: null }), true);
  assert.equal(shouldRetry({ status: null, error: 'dns' }), false);
  assert.equal(shouldRetry({ status: 403, error: null }), false);
  assert.equal(shouldRetry({ status: 404, error: null }), false);
});

function outcome(overrides) {
  return {
    url: 'https://example.com/band',
    status: 200,
    finalUrl: 'https://example.com/band',
    redirectCodes: [],
    error: null,
    ...overrides,
  };
}

test('status classification', () => {
  assert.equal(classifyOutcome(outcome({})).last_status, 'ok');
  assert.equal(classifyOutcome(outcome({})).final_url, null);

  const upgraded = classifyOutcome(outcome({
    url: 'http://example.com/band',
    finalUrl: 'https://example.com/band/',
    redirectCodes: [301],
  }));
  assert.equal(upgraded.last_status, 'ok');
  assert.equal(upgraded.final_url, null);

  const temporary = classifyOutcome(outcome({
    finalUrl: 'https://example.com/band?session=1',
    redirectCodes: [302],
  }));
  assert.equal(temporary.last_status, 'ok');
  assert.equal(temporary.final_url, null);

  const moved = classifyOutcome(outcome({
    finalUrl: 'https://www.example.com/band',
    redirectCodes: [301],
  }));
  assert.equal(moved.last_status, 'redirect');
  assert.equal(moved.final_url, 'https://www.example.com/band');

  const movedChain = classifyOutcome(outcome({
    finalUrl: 'https://club.example.org/home',
    redirectCodes: [302, 308],
  }));
  assert.equal(movedChain.last_status, 'redirect');
  assert.equal(movedChain.final_url, 'https://club.example.org/home');

  assert.equal(classifyOutcome(outcome({ status: 404, finalUrl: 'https://example.com/band' })).last_status, 'broken');
  assert.equal(classifyOutcome(outcome({ status: 500 })).last_status, 'broken');
  assert.equal(classifyOutcome(outcome({
    status: 404,
    finalUrl: 'https://www.example.com/missing',
    redirectCodes: [301],
  })).last_status, 'broken');

  assert.equal(classifyOutcome(outcome({ status: 403 })).last_status, 'unverifiable');
  assert.equal(classifyOutcome(outcome({ status: 429 })).last_status, 'unverifiable');
  assert.equal(classifyOutcome(outcome({
    url: 'https://www.facebook.com/example-club',
    finalUrl: 'https://www.facebook.com/example-club',
    status: 400,
  })).last_status, 'unverifiable');
  assert.equal(classifyOutcome(outcome({
    url: 'https://instagram.com/example-club',
    finalUrl: 'https://instagram.com/example-club',
    status: 403,
  })).last_status, 'unverifiable');
  assert.equal(classifyOutcome(outcome({
    url: 'https://www.facebook.com/example-club',
    finalUrl: 'https://www.facebook.com/example-club',
    status: 404,
  })).last_status, 'broken');
  assert.equal(classifyOutcome(outcome({ status: 400 })).last_status, 'broken');

  assert.equal(classifyOutcome(outcome({ status: null, error: 'timeout' })).last_status, 'unreachable');
  assert.equal(classifyOutcome(outcome({ status: null, error: 'dns' })).last_status, 'unreachable');
  assert.equal(classifyOutcome(outcome({ status: null, error: 'tls' })).last_status, 'unreachable');
  assert.equal(classifyOutcome(outcome({ status: null, error: 'missing-url' })).last_status, 'broken');
  assert.equal(classifyOutcome(outcome({ status: null, error: 'blocked-url' })).last_status, 'broken');
  assert.equal(classifyOutcome(outcome({ status: 301, error: 'too-many-redirects' })).last_status, 'broken');
});
