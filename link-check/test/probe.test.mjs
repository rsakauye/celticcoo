import test from 'node:test';
import assert from 'node:assert/strict';
import { probeUrl } from '../src/probe.js';
import { classifyOutcome } from '../src/classify.js';

function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts.method });
    const route = routes[`${opts.method} ${url}`] || routes[url];
    if (!route) {
      const error = new Error('getaddrinfo ENOTFOUND example.test');
      error.code = 'ENOTFOUND';
      throw error;
    }
    if (route.throw) throw route.throw;
    return {
      status: route.status,
      headers: { get: (name) => (name.toLowerCase() === 'location' ? route.location || null : null) },
      body: { cancel: async () => { calls[calls.length - 1].cancelled = true; } },
    };
  };
  return { fetchImpl, calls };
}

const options = (fetchImpl) => ({ fetchImpl, timeoutMs: 1000, userAgent: 'ExampleBot/1.0 (+https://example.com/clubs)' });

async function classified(routes, url = 'https://example.com/band') {
  const { fetchImpl, calls } = mockFetch(routes);
  const probed = await probeUrl(url, options(fetchImpl));
  return { probed, calls, result: classifyOutcome(probed) };
}

test('HEAD 200 does not GET', async () => {
  const { calls, result } = await classified({
    'HEAD https://example.com/band': { status: 200 },
  });
  assert.deepEqual(calls.map((call) => call.method), ['HEAD']);
  assert.equal(result.last_status, 'ok');
  assert.equal(calls[0].cancelled, true);
});

test('HEAD 405 falls back to GET', async () => {
  const { calls, result } = await classified({
    'HEAD https://example.com/band': { status: 405 },
    'GET https://example.com/band': { status: 200 },
  });
  assert.deepEqual(calls.map((call) => call.method), ['HEAD', 'GET']);
  assert.equal(result.last_status, 'ok');
});

test('HEAD 404 falls back to GET before calling the site broken', async () => {
  const { calls, result } = await classified({
    'HEAD https://example.com/band': { status: 404 },
    'GET https://example.com/band': { status: 200 },
  });
  assert.deepEqual(calls.map((call) => call.method), ['HEAD', 'GET']);
  assert.equal(result.last_status, 'ok');
});

test('a HEAD timeout falls back to GET and retries that GET once', async () => {
  const timeout = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  let gets = 0;
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(opts.method);
    if (opts.method === 'HEAD') throw timeout;
    gets += 1;
    if (gets === 1) throw timeout;
    return { status: 200, headers: { get: () => null }, body: { cancel: async () => {} } };
  };
  const probed = await probeUrl('https://example.com/band', options(fetchImpl));
  assert.deepEqual(calls, ['HEAD', 'GET', 'GET']);
  assert.equal(classifyOutcome(probed).last_status, 'ok');
});

test('HEAD 403 on a bot wall is unverifiable and is not followed by GET', async () => {
  const { calls, result } = await classified({
    'HEAD https://www.facebook.com/example-club': { status: 403 },
  }, 'https://www.facebook.com/example-club');
  assert.deepEqual(calls.map((call) => call.method), ['HEAD']);
  assert.equal(result.last_status, 'unverifiable');
});

test('HEAD 403 on an ordinary host falls back to GET', async () => {
  const { calls, result } = await classified({
    'HEAD https://example.com/band': { status: 403 },
    'GET https://example.com/band': { status: 200 },
  });
  assert.deepEqual(calls.map((call) => call.method), ['HEAD', 'GET']);
  assert.equal(result.last_status, 'ok');
});

test('a permanent https upgrade is ok, and a new host is a redirect', async () => {
  const upgraded = await classified({
    'HEAD http://example.com/band': { status: 301, location: 'https://example.com/band/' },
    'HEAD https://example.com/band/': { status: 200 },
  }, 'http://example.com/band');
  assert.equal(upgraded.result.last_status, 'ok');
  assert.equal(upgraded.result.final_url, null);

  const moved = await classified({
    'HEAD https://example.com/band': { status: 301, location: '/new-home' },
    'HEAD https://example.com/new-home': { status: 308, location: 'https://club.example.org/home' },
    'HEAD https://club.example.org/home': { status: 200 },
  });
  assert.equal(moved.result.last_status, 'redirect');
  assert.equal(moved.result.final_url, 'https://club.example.org/home');
});

test('a temporary redirect to another host stays ok', async () => {
  const { result } = await classified({
    'HEAD https://example.com/band': { status: 302, location: 'https://example.org/band' },
    'HEAD https://example.org/band': { status: 200 },
  });
  assert.equal(result.last_status, 'ok');
  assert.equal(result.final_url, null);
});

test('DNS failure is unreachable and is not retried', async () => {
  const { calls, result } = await classified({});
  assert.deepEqual(calls.map((call) => call.method), ['HEAD', 'GET']);
  assert.equal(result.last_status, 'unreachable');
  assert.equal(result.detail, 'dns');
});

test('a private URL is not requested', async () => {
  const { fetchImpl, calls } = mockFetch({});
  const probed = await probeUrl('http://127.0.0.1/secret', options(fetchImpl));
  assert.equal(calls.length, 0);
  assert.equal(classifyOutcome(probed).last_status, 'broken');
  assert.equal(classifyOutcome(probed).detail, 'blocked-url');
});

test('HEAD 500 is retried once and does not fall through to a body download', async () => {
  const { calls, result } = await classified({
    'HEAD https://example.com/band': { status: 500 },
  });
  assert.deepEqual(calls.map((call) => call.method), ['HEAD', 'HEAD']);
  assert.equal(result.last_status, 'broken');
  assert.equal(result.detail, 'HTTP 500');
});
