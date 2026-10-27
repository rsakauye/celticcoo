import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, parseArgs } from '../src/cli.js';
import { resolveConfig } from '../src/config.js';
import { runCheck } from '../src/check.js';

const NOW = new Date('2026-10-27T18:00:00Z');

function writeFixture(dir) {
  const dataPath = path.join(dir, 'directory.json');
  const outputPath = path.join(dir, 'status.json');
  const records = [
    { name: 'Example Pipe Band', website: 'https://example.com/band', note: 'Ask person@example.com' },
    { name: 'Example Pipe Band', website: 'https://example.com/other' },
    { name: 'Example Social', website: 'https://instagram.com/example-club' },
  ];
  fs.writeFileSync(dataPath, JSON.stringify(records, null, 2));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    dataPath: 'directory.json',
    urlField: 'website',
    idField: 'name',
    idMode: 'slug',
    labelField: 'name',
    outputPath: 'status.json',
    schedule: '0 15 * * 1',
    timeZone: 'America/Edmonton',
    userAgent: 'ExampleBot/1.0 (+https://example.com/clubs; weekly check)',
    concurrency: 2,
    timeoutMs: 1000,
    delayMs: 0,
    prTitle: 'Weekly club link check',
    branch: 'bot/weekly-club-link-check',
    base: 'main',
  }));
  return { dataPath, outputPath, configPath, records };
}

function fetchImpl() {
  return async (url, opts) => {
    const method = opts.method;
    if (String(url).includes('instagram.com')) {
      assert.equal(method, 'HEAD');
      return { status: 403, headers: { get: () => null }, body: { cancel: async () => {} } };
    }
    if (method === 'HEAD') {
      return { status: 405, headers: { get: () => null }, body: { cancel: async () => {} } };
    }
    return { status: 200, headers: { get: () => null }, body: { cancel: async () => {} } };
  };
}

test('flags that would publish are rejected on a dry run', () => {
  assert.throws(() => parseArgs(['--config', 'x.json', '--dry-run', '--open-pr']), /does not open a pull request/);
  assert.throws(() => parseArgs(['--config', 'x.json', '--limit', '2']), /only allowed with --dry-run/);
  assert.throws(() => resolveConfig({
    dataPath: 'a.json',
    urlField: 'url',
    idField: 'id',
    outputPath: 'out.json',
    schedule: '0 15 * * 1',
    userAgent: 'Mozilla/5.0',
  }, '/tmp'), /must not impersonate a browser/);
});

test('dry run prints counts and writes nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-check-'));
  const { dataPath, outputPath, configPath } = writeFixture(dir);
  const before = fs.readFileSync(dataPath);
  const result = await main(['--config', configPath, '--dry-run'], {
    cwd: dir,
    fetchImpl: fetchImpl(),
    now: NOW,
  });
  assert.equal(result.wrote, false);
  assert.equal(fs.existsSync(outputPath), false);
  assert.deepEqual(fs.readFileSync(dataPath), before);
  assert.equal(result.summary.ok, 2);
  assert.equal(result.summary.redirect, 0);
  assert.equal(result.summary.broken, 0);
  assert.equal(result.summary.unreachable, 0);
  assert.equal(result.summary.unverifiable, 1);
  assert.equal(result.summary.total, 3);
  assert.equal(result.document.checked_on, '2026-10-27');
  assert.equal(result.document.entries.some((entry) => entry.id === 'example-pipe-band-2'), true);
  assert.equal(JSON.stringify(result.document).includes('person@example.com'), false);
  assert.equal(JSON.stringify(result.document).includes('"note"'), false);
});

test('a real run writes only the status file and leaves the directory bytes untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-check-'));
  const { dataPath, outputPath, configPath } = writeFixture(dir);
  const before = fs.readFileSync(dataPath);
  await main(['--config', configPath, '--report', path.join(dir, 'report.md')], {
    cwd: dir,
    fetchImpl: fetchImpl(),
    now: NOW,
  });
  assert.deepEqual(fs.readFileSync(dataPath), before);
  const status = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(status.checked_on, '2026-10-27');
  assert.equal(status.entries.length, 3);
  assert.match(fs.readFileSync(path.join(dir, 'report.md'), 'utf8'), /First completed check/);
  const names = fs.readdirSync(dir).sort();
  assert.deepEqual(names, ['config.json', 'directory.json', 'report.md', 'status.json']);
});

test('runCheck does not mutate frozen source records', async () => {
  const records = Object.freeze([
    Object.freeze({ name: 'Example Dance School', website: 'https://example.com/dance' }),
  ]);
  const config = resolveConfig({
    dataPath: 'directory.json',
    urlField: 'website',
    idField: 'name',
    idMode: 'slug',
    outputPath: 'status.json',
    schedule: '0 15 * * 1',
    userAgent: 'ExampleBot/1.0 (+https://example.com/clubs)',
    concurrency: 1,
    delayMs: 0,
  }, '/tmp');
  const { summary } = await runCheck({
    records,
    config,
    now: NOW,
    fetchImpl: async () => ({ status: 200, headers: { get: () => null }, body: { cancel: async () => {} } }),
  });
  assert.equal(summary.ok, 1);
  assert.equal(summary.total, 1);
});

test('--open-pr updates one pull request and does not fetch club websites', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-check-'));
  const { configPath } = writeFixture(dir);
  const report = path.join(dir, 'report.md');
  fs.writeFileSync(report, 'Checked 1 websites on Oct 27, 2026.\n');
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts.method });
    if (String(url).includes('/pulls?')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{
          number: 12,
          html_url: 'https://example.com/pr/12',
          head: { ref: 'bot/weekly-club-link-check' },
        }]),
      };
    }
    assert.equal(opts.method, 'PATCH');
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ number: 12, html_url: 'https://example.com/pr/12' }),
    };
  };
  const result = await main(['--config', configPath, '--open-pr', '--report', report], {
    cwd: dir,
    fetchImpl,
    token: 'test-token',
    repository: 'example/example',
  });
  assert.equal(result.action, 'update');
  assert.equal(result.url, 'https://example.com/pr/12');
  assert.equal(calls.length, 2);
  assert.equal(calls.some((call) => String(call.url).includes('example.com/band')), false);
});
