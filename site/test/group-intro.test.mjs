import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { offersLessons, formatLastChecked, latestCheckedOn, buildClubIntro, clubIntroSentence } from '../src/lib/groupIntro.js';
import { formatDisplayDate } from '../../link-check/src/dates.js';
import { clubIntro, counts, groups } from '../src/lib/data.js';

const COPY = 'Pipe bands, Highland and Scottish country dance, clan societies, Gaelic classes, Burns clubs, heavy events, trad sessions, whisky societies and more: 3 groups across Canada, 1 of them offering lessons. We check every website weekly (last check: Oct 27, 2026). Ask the group directly about schedules and fees.';

test('the intro sentence matches the copywriter text', () => {
  assert.equal(clubIntroSentence({
    groupCount: 3,
    lessonCount: 1,
    lastChecked: 'Oct 27, 2026',
  }), COPY);
});

test('offers_lessons unknown is not counted as offering lessons', () => {
  const sample = [
    { offers_lessons: 'y' },
    { offers_lessons: 'Y' },
    { offers_lessons: true },
    { offers_lessons: 'n' },
    { offers_lessons: 'unknown' },
    { offers_lessons: 'unknown' },
    {},
    { offers_lessons: false },
  ];
  assert.equal(offersLessons('unknown'), false);
  assert.equal(offersLessons('n'), false);
  assert.equal(offersLessons(undefined), false);
  const intro = buildClubIntro(sample, { checked_on: '2026-10-27' });
  assert.equal(intro.groupCount, 8);
  assert.equal(intro.lessonCount, 3);
  assert.equal(intro.lastChecked, 'Oct 27, 2026');
  assert.match(intro.text, /8 groups across Canada, 3 of them offering lessons/);
  assert.match(intro.text, /last check: Oct 27, 2026/);
});

test('a missing check run reads as not yet, in the same month form as the checker', () => {
  assert.equal(formatLastChecked(null), 'not yet');
  assert.equal(formatLastChecked(''), 'not yet');
  assert.equal(formatLastChecked('2026-02-31'), 'Feb 31, 2026');
  assert.equal(latestCheckedOn({ checked_on: null }), null);
  assert.equal(latestCheckedOn({ entries: [{ last_checked: '2026-10-27' }] }), null);
  const intro = buildClubIntro([{ offers_lessons: 'unknown' }], { checked_on: null, entries: [] });
  assert.equal(intro.lessonCount, 0);
  assert.equal(intro.groupCount, 1);
  assert.equal(intro.lastChecked, 'not yet');
  assert.match(intro.text, /last check: not yet/);
  for (const iso of ['2026-10-27', '2026-01-01', '2026-12-09', '2026-10-07']) {
    assert.equal(formatLastChecked(iso), formatDisplayDate(iso));
  }
});

test('the live clubs intro is counted from the directory, and unknown stays out of the lesson total', () => {
  const directory = JSON.parse(fs.readFileSync(new URL('../../data/groups_canada.json', import.meta.url), 'utf8'));
  const status = JSON.parse(fs.readFileSync(new URL('../../data/groups_link_status.json', import.meta.url), 'utf8'));
  const yes = directory.filter((group) => group.offers_lessons === 'y').length;
  const unknown = directory.filter((group) => group.offers_lessons === 'unknown').length;
  assert.ok(unknown > 0);
  assert.equal(clubIntro.groupCount, directory.length);
  assert.equal(clubIntro.lessonCount, yes);
  assert.notEqual(clubIntro.lessonCount, yes + unknown);
  assert.equal(clubIntro.lastChecked, formatLastChecked(latestCheckedOn(status)));
  assert.equal(clubIntro.text, clubIntroSentence(clubIntro));
  assert.equal(counts.groups, clubIntro.groupCount);
  assert.equal(counts.groupsLessons, clubIntro.lessonCount);
  assert.equal(groups.filter((group) => group.lessons).length, yes);
  assert.equal(groups.filter((group) => group.offers_lessons === 'unknown' && group.lessons).length, 0);
});

test('the clubs page uses the computed intro and not the old fixed date', () => {
  const source = fs.readFileSync(new URL('../src/pages/groups/index.astro', import.meta.url), 'utf8');
  assert.match(source, /\{clubIntro\.groupCount\}/);
  assert.match(source, /\{clubIntro\.lessonCount\}/);
  assert.match(source, /\{clubIntro\.lastChecked\}/);
  assert.match(source, /We check every website weekly \(last check:/);
  assert.doesNotMatch(source, /Every website was checked/);
  assert.doesNotMatch(source, /Oct 17/);
  assert.doesNotMatch(source, />105</);
  assert.doesNotMatch(source, />28</);
});
