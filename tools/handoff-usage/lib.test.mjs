import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MARKER,
  claudeBlock,
  countClaudeRuns,
  countJules,
  countSince,
  findUsageComment,
  formatComment,
  julesBlock,
  mt,
  parseBudget,
  snapshotFromStatusline,
  statuslineText,
} from './lib.mjs';

const NOW = Date.parse('2026-11-20T17:00:00Z');
const RESET5 = Date.parse('2026-11-20T21:00:00Z');
const RESET7 = Date.parse('2026-11-25T16:40:00Z');
// Expected MT text comes from the runner's own tz data, so tests pass on old and new data.
const ref = (ms) =>
  `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Edmonton', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms))} MT`;
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

test('countSince ignores bad and old timestamps', () => {
  const items = [{ t: hoursAgo(1) }, { t: hoursAgo(10) }, { t: 'nope' }, {}];
  assert.equal(countSince(items, 't', NOW - 5 * 3600 * 1000), 1);
});

test('countClaudeRuns splits 5h and 7d and drops skipped runs', () => {
  const runs = [
    { created_at: hoursAgo(1), conclusion: 'success' },
    { created_at: hoursAgo(4.9), conclusion: null },
    { created_at: hoursAgo(2), conclusion: 'skipped' },
    { created_at: hoursAgo(30), conclusion: 'failure' },
    { created_at: hoursAgo(24 * 8), conclusion: 'success' },
  ];
  assert.deepEqual(countClaudeRuns(runs, NOW), { last5h: 2, last7d: 3 });
});

test('countJules skips pull requests and counts open', () => {
  const issues = [
    { created_at: hoursAgo(2), state: 'open' },
    { created_at: hoursAgo(23), state: 'closed' },
    { created_at: hoursAgo(25), state: 'open' },
    { created_at: hoursAgo(1), state: 'open', pull_request: {} },
  ];
  assert.deepEqual(countJules(issues, NOW), { last24h: 2, open: 2 });
});

test('parseBudget accepts positive integers only', () => {
  assert.equal(parseBudget('40'), 40);
  assert.equal(parseBudget(' 7 '), 7);
  assert.equal(parseBudget(''), null);
  assert.equal(parseBudget('0'), null);
  assert.equal(parseBudget(undefined), null);
  assert.equal(parseBudget('abc'), null);
});

test('mt formats Mountain Time, including the Wednesday reset', () => {
  assert.equal(mt(NOW), ref(NOW));
  assert.match(mt(RESET7), /^Wed, Nov 25, \d{1,2}:40 AM MT$/);
  assert.equal(mt(NaN), 'unknown');
});

test('snapshotFromStatusline reads documented rate_limits fields', () => {
  const snap = snapshotFromStatusline(
    {
      model: { display_name: 'Opus' },
      rate_limits: {
        five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
        seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
      },
    },
    NOW,
  );
  assert.equal(snap.model, 'Opus');
  assert.deepEqual(snap.five_hour, { used_percentage: 24, resets_at: 1738425600 });
  assert.deepEqual(snap.seven_day, { used_percentage: 41, resets_at: 1738857600 });
  assert.equal(statuslineText(snap), 'Opus | 5h 24% | 7d 41%');
});

test('snapshotFromStatusline tolerates missing windows', () => {
  const snap = snapshotFromStatusline({ model: { display_name: 'Sonnet' } }, NOW);
  assert.equal(snap.five_hour, null);
  assert.equal(snap.seven_day, null);
  assert.equal(statuslineText(snap), 'Sonnet');
  assert.equal(statuslineText(snapshotFromStatusline({}, NOW)), 'Claude');
});

const base = {
  nowMs: NOW,
  stage: 'Claude run started',
  claude: { last5h: 3, last7d: 12 },
  jules: { last24h: 0, open: 0 },
  budgets: { five: null, week: null },
  local: null,
};

const FIELDS = ['tool: ', 'plan: ', 'model: ', 'remaining: ', 'resets (MT): ', 'source: '];

function assertPmoBlock(block) {
  const lines = block.split('\n');
  assert.equal(lines[0], 'Usage report for the GrokBot PMO');
  FIELDS.forEach((f, i) => assert.ok(lines[i + 1].startsWith(f), `line ${i + 1} starts with ${f}`));
  assert.equal(lines.length, 7);
}

test('claudeBlock CI form follows the PMO format', () => {
  const block = claudeBlock(base);
  assertPmoBlock(block);
  assert.match(block, /tool: Claude Code/);
  assert.match(block, /plan: Claude Pro/);
  assert.match(block, /model: Action default/);
  assert.match(block, /remaining: Pro limits not readable from CI, Russell checks \/usage \(3 runs in 5h; 12 runs in 7d\)/);
  assert.match(block, /resets \(MT\): unknown from CI/);
});

test('claudeBlock shows runs left when budgets are set, and plan/model overrides', () => {
  const block = claudeBlock({ ...base, budgets: { five: 5, week: 10 }, plan: 'Claude Max', model: 'Opus 5.5' });
  assert.match(block, /3 runs in 5h, about 2 of 5 left; 12 runs in 7d, about 0 of 10 left/);
  assert.match(block, /plan: Claude Max/);
  assert.match(block, /model: Opus 5.5/);
});

test('claudeBlock local form shows percent left and MT resets', () => {
  const local = snapshotFromStatusline(
    {
      model: { display_name: 'Opus' },
      rate_limits: {
        five_hour: { used_percentage: 30, resets_at: RESET5 / 1000 },
        seven_day: { used_percentage: 55, resets_at: RESET7 / 1000 },
      },
    },
    NOW,
  );
  const block = claudeBlock({ ...base, local });
  assertPmoBlock(block);
  assert.match(block, /model: Opus/);
  assert.match(block, /remaining: 5-hour 70% left, weekly 45% left \(3 runs in 5h; 12 runs in 7d\)/);
  assert.ok(block.includes(`resets (MT): 5-hour ${ref(RESET5)}; weekly ${ref(RESET7)}`));
  assert.ok(block.includes(`source: Claude Code status line, ${ref(NOW)}`));
});

test('julesBlock follows the PMO format', () => {
  const block = julesBlock({ last24h: 4, open: 2 });
  assertPmoBlock(block);
  assert.match(block, /remaining: 96 of 100 tasks today, 13 of 15 concurrent slots free/);
});

test('formatComment wraps blocks, adds Jules only when used, no em dashes', () => {
  const quiet = formatComment(base);
  assert.ok(quiet.startsWith(MARKER));
  assert.ok(quiet.includes(`[Claude] Usage at handoff: Claude run started. Updated ${ref(NOW)}.`));
  assert.equal(quiet.split('Usage report for the GrokBot PMO').length - 1, 1);
  const busy = formatComment({ ...base, jules: { last24h: 1, open: 1 } });
  assert.equal(busy.split('Usage report for the GrokBot PMO').length - 1, 2);
  assert.doesNotMatch(busy, /\u2014/);
});

test('findUsageComment finds the marker comment only', () => {
  const comments = [
    { id: 1, body: 'hello' },
    { id: 2, body: `${MARKER}\nold` },
    { id: 3, body: null },
  ];
  assert.equal(findUsageComment(comments).id, 2);
  assert.equal(findUsageComment([{ id: 1, body: 'x' }]), null);
});
