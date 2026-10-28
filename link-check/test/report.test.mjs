import test from 'node:test';
import assert from 'node:assert/strict';
import { meaningfulChanges, summarize } from '../src/check.js';
import { renderReport } from '../src/report.js';
import { pullRequestPlan } from '../src/github.js';

const config = { outputPathLabel: 'data/groups_link_status.json' };

function entry(overrides) {
  return {
    id: 'example-pipe-band',
    label: 'Example Pipe Band',
    url: 'https://example.com/band',
    last_checked: '2026-10-27',
    last_status: 'ok',
    final_url: null,
    detail: null,
    ...overrides,
  };
}

function document(entries, checkedOn = '2026-10-27') {
  return { schema: 1, checked_on: checkedOn, entries };
}

test('a date-only change stays quiet and still names the new date', () => {
  const previous = document([entry({ last_checked: '2026-10-20' })], '2026-10-20');
  const next = document([entry({ last_checked: '2026-10-27' })], '2026-10-27');
  assert.deepEqual(meaningfulChanges(previous, next), []);
  const body = renderReport({
    config,
    previous,
    document: next,
    summary: summarize(next.entries),
  });
  assert.match(body, /Oct 27, 2026/);
  assert.match(body, /Only the check date changed/);
  assert.match(body, /does not add, edit, or delete/);
  assert.match(body, /No broken, unreachable, or permanently redirected/);
  assert.doesNotMatch(body, /## Broken/);
});

test('the review list shows broken, unreachable, and permanent redirects, not unverifiable', () => {
  const entries = [
    entry({ id: 'ok-club', label: 'Example Dance School', last_status: 'ok' }),
    entry({
      id: 'moved-club',
      label: 'Example Society',
      url: 'https://example.com/old',
      last_status: 'redirect',
      final_url: 'https://example.org/new',
      detail: 'permanent redirect',
    }),
    entry({
      id: 'broken-club',
      label: 'Example Burns Club person@example.com',
      url: 'https://example.com/missing',
      last_status: 'broken',
      detail: 'HTTP 404',
    }),
    entry({
      id: 'down-club',
      label: 'Example Session',
      url: 'https://example.com/down',
      last_status: 'unreachable',
      detail: 'timeout',
    }),
    entry({
      id: 'social-club',
      label: 'Example Social person@example.com',
      url: 'https://facebook.com/example-club',
      last_status: 'unverifiable',
      detail: 'HTTP 403',
    }),
  ];
  const body = renderReport({
    config,
    previous: document(entries, '2026-10-20'),
    document: document(entries),
    summary: summarize(entries),
  });
  assert.match(body, /Example Society: <https:\/\/example.com\/old> -> <https:\/\/example.org\/new>/);
  assert.match(body, /## Broken \(1\)/);
  assert.match(body, /Example Burns Club \(redacted\): <https:\/\/example.com\/missing> \(HTTP 404\)/);
  assert.match(body, /## Unreachable \(1\)/);
  assert.match(body, /timeout/);
  assert.match(body, /unverifiable: 1/);
  assert.doesNotMatch(body, /## Unverifiable/);
  assert.doesNotMatch(body, /person@example.com/);
  assert.match(body, /Only the check date changed/);
});

test('an open pull request on the bot branch is updated', () => {
  const plan = pullRequestPlan([
    { number: 4, title: 'Something else', head: { ref: 'feature' } },
    { number: 9, title: 'Weekly club link check', head: { ref: 'bot/weekly-club-link-check' } },
  ], { branch: 'bot/weekly-club-link-check' });
  assert.deepEqual(plan, { action: 'update', number: 9 });
  assert.deepEqual(pullRequestPlan([], { branch: 'bot/weekly-club-link-check' }), { action: 'create' });
});
