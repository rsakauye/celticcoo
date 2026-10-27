import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { events, tba } from '../src/lib/data.js';
import {
  calendarLinks,
  eventSchedule,
  foldIcsLine,
  icsEscape,
  nextIsoDate,
  renderEventIcs,
  renderFeed,
  timeZoneFor,
  zonedWallTimeToUtc,
} from '../src/lib/calendar.js';

const here = dirname(fileURLToPath(import.meta.url));
const now = new Date('2026-10-27T15:04:05.000Z');
const site = 'https://celticcoo.ca/';

function vevents(ics) {
  return ics.split('BEGIN:VEVENT').slice(1).map((block) => `BEGIN:VEVENT${block.split('END:VEVENT')[0]}END:VEVENT`);
}

function prop(ics, name) {
  const folded = ics.replace(/\r\n[ \t]/g, '');
  const line = folded.split(/\r\n/).find((row) => row.startsWith(name));
  return line || '';
}

const games = {
  id: 'example-games-2027-06-26',
  name: 'Example Games',
  start_date: '2027-06-26',
  end_date: '2027-06-26',
  city: 'Red Deer',
  region: 'AB',
  regionLabel: 'Alberta',
  country: 'Canada',
  type: 'Highland Games',
  category: 'Highland Games',
  source_url: 'https://example.test/games',
  source_kind: 'official',
  note: 'Central field',
};

test('the next calendar day does not depend on the machine timezone', () => {
  assert.equal(nextIsoDate('2027-01-31'), '2027-02-01');
  assert.equal(nextIsoDate('2027-12-31'), '2028-01-01');
  assert.equal(nextIsoDate('2024-02-28'), '2024-02-29');
  assert.equal(nextIsoDate('2027-02-28'), '2027-03-01');
});

test('a one-day event is all-day and the end date is exclusive', () => {
  const schedule = eventSchedule(games);
  assert.equal(schedule.allDay, true);
  assert.equal(schedule.startDate, '2027-06-26');
  assert.equal(schedule.endDateExclusive, '2027-06-27');
  const ics = renderEventIcs(games, { site, now });
  assert.equal(prop(ics, 'DTSTART'), 'DTSTART;VALUE=DATE:20270626');
  assert.equal(prop(ics, 'DTEND'), 'DTEND;VALUE=DATE:20270627');
  assert.match(ics, /UID:example-games-2027-06-26@celticcoo\.ca/);
});

test('a multi-day event covers every calendar day and does not shift west of UTC', () => {
  const event = {
    ...games,
    id: 'celtic-connections-2027-01-14',
    name: 'Celtic Connections',
    start_date: '2027-01-14',
    end_date: '2027-01-31',
    city: 'Glasgow',
    region: 'Scotland',
    regionLabel: 'Scotland',
    country: 'UK',
  };
  const schedule = eventSchedule(event);
  assert.equal(schedule.allDay, true);
  assert.equal(schedule.endDateExclusive, '2027-02-01');
  assert.equal(timeZoneFor(event), 'Europe/London');
  const ics = renderEventIcs(event, { site, now });
  assert.match(prop(ics, 'DTSTART'), /20270114$/);
  assert.match(prop(ics, 'DTEND'), /20270201$/);
  assert.doesNotMatch(ics, /DTSTART;VALUE=DATE:20270113/);
});

test('an all-day date in British Columbia stays on that date', () => {
  const event = { ...games, id: 'bc-day-2027-01-14', start_date: '2027-01-14', end_date: '2027-01-14', region: 'BC', city: 'Victoria' };
  assert.equal(timeZoneFor(event), 'America/Vancouver');
  const ics = renderEventIcs(event, { site, now });
  assert.match(prop(ics, 'DTSTART'), /20270114$/);
  assert.doesNotMatch(ics, /20270113/);
});

test('events without a confirmed date are skipped', () => {
  assert.equal(eventSchedule({ name: 'Date TBA Games', id: 'date-tba-games' }), null);
  assert.equal(eventSchedule({ ...games, start_date: '2027-02-31' }), null);
  assert.equal(eventSchedule({ ...games, start_date: '' }), null);
  assert.equal(calendarLinks({ name: 'Date TBA Games', id: 'date-tba-games' }), null);
  assert.equal(renderEventIcs({ name: 'Date TBA Games', id: 'date-tba-games' }, { site, now }), '');
  for (const pending of tba) assert.equal(calendarLinks(pending), null);
});

test('an end date before the start date collapses to one day', () => {
  const schedule = eventSchedule({ ...games, end_date: '2027-06-01' });
  assert.equal(schedule.startDate, '2027-06-26');
  assert.equal(schedule.endDateExclusive, '2027-06-27');
});

test('Google and Outlook all-day links use an exclusive end and no clock time', () => {
  const links = calendarLinks(games, { site });
  const google = new URL(links.google);
  const outlook = new URL(links.outlook);
  assert.equal(google.origin + google.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(google.searchParams.get('action'), 'TEMPLATE');
  assert.equal(google.searchParams.get('text'), 'Example Games');
  assert.equal(google.searchParams.get('dates'), '20270626/20270627');
  assert.equal(google.searchParams.get('ctz'), null);
  assert.equal(outlook.origin + outlook.pathname, 'https://outlook.live.com/calendar/0/deeplink/compose');
  assert.equal(outlook.searchParams.get('rru'), 'addevent');
  assert.equal(outlook.searchParams.get('startdt'), '2027-06-26');
  assert.equal(outlook.searchParams.get('enddt'), '2027-06-27');
  assert.equal(outlook.searchParams.get('allday'), 'true');
  assert.match(google.searchParams.get('details'), /Listed on The Celtic Coo: https:\/\/celticcoo\.ca\/events\/example-games-2027-06-26\//);
  assert.match(google.searchParams.get('location'), /Red Deer, Alberta, Canada/);
});

test('a comma and a line break in the text are escaped, and long lines fold', () => {
  const event = { ...games, name: 'Games, North; East', note: 'Line one\nLine two' };
  const ics = renderEventIcs(event, { site, now });
  assert.match(prop(ics, 'SUMMARY'), /Games\\, North\\; East$/);
  assert.match(prop(ics, 'DESCRIPTION'), /Line one\\nLine two/);
  const folded = foldIcsLine(`DESCRIPTION:${'a'.repeat(90)}`);
  assert.match(folded, /\r\n /);
  assert.ok(folded.split('\r\n').every((line) => Buffer.byteLength(line) <= 75));
  assert.equal(icsEscape('a\\b,c;d\n'), 'a\\\\b\\,c\\;d\\n');
});

test('clock times follow IANA offsets, including DST, a half hour, and zones with one offset all year', () => {
  const cases = [
    // Pacific still changes clocks. British Columbia stays on UTC-7 after 2026-03-09.
    ['2026-01-14', '10:00', 'America/Los_Angeles', '2026-01-14T18:00:00.000Z'],
    ['2027-07-01', '10:00', 'America/Los_Angeles', '2027-07-01T17:00:00.000Z'],
    ['2026-01-14', '10:00', 'America/Vancouver', '2026-01-14T18:00:00.000Z'],
    ['2027-01-14', '10:00', 'America/Vancouver', '2027-01-14T17:00:00.000Z'],
    ['2027-07-01', '10:00', 'America/Vancouver', '2027-07-01T17:00:00.000Z'],
    // Alberta stays on UTC-6 after 2026-06-18. Toronto still springs forward.
    ['2026-01-14', '10:00', 'America/Edmonton', '2026-01-14T17:00:00.000Z'],
    ['2027-01-14', '10:00', 'America/Edmonton', '2027-01-14T16:00:00.000Z'],
    ['2027-07-01', '10:00', 'America/Edmonton', '2027-07-01T16:00:00.000Z'],
    ['2027-03-13', '10:00', 'America/Toronto', '2027-03-13T15:00:00.000Z'],
    ['2027-03-14', '10:00', 'America/Toronto', '2027-03-14T14:00:00.000Z'],
    ['2027-11-06', '10:00', 'America/Toronto', '2027-11-06T14:00:00.000Z'],
    ['2027-11-07', '10:00', 'America/Toronto', '2027-11-07T15:00:00.000Z'],
    // Saskatchewan does not change clocks. Newfoundland is a half hour.
    ['2027-01-14', '10:00', 'America/Regina', '2027-01-14T16:00:00.000Z'],
    ['2027-07-01', '10:00', 'America/Regina', '2027-07-01T16:00:00.000Z'],
    ['2027-01-14', '10:00', 'America/St_Johns', '2027-01-14T13:30:00.000Z'],
    ['2027-07-01', '10:00', 'America/St_Johns', '2027-07-01T12:30:00.000Z'],
    ['2027-01-14', '10:00', 'Europe/London', '2027-01-14T10:00:00.000Z'],
    ['2027-07-01', '10:00', 'Europe/London', '2027-07-01T09:00:00.000Z'],
  ];
  for (const [date, time, zone, expected] of cases) {
    assert.equal(zonedWallTimeToUtc(date, time, zone).toISOString(), expected, `${date} ${time} ${zone}`);
  }
});

test('a timed event is stored in UTC and linked with the same instant', () => {
  const event = {
    ...games,
    id: 'timed-pipes-2027-07-01',
    region: 'BC',
    city: 'Vancouver',
    regionLabel: 'British Columbia',
    start_date: '2027-07-01',
    end_date: '2027-07-01',
    start_time: '10:00',
    end_time: '12:30',
  };
  const schedule = eventSchedule(event);
  assert.equal(schedule.allDay, false);
  assert.equal(schedule.timeZone, 'America/Vancouver');
  assert.equal(schedule.startUtc.toISOString(), '2027-07-01T17:00:00.000Z');
  assert.equal(schedule.endUtc.toISOString(), '2027-07-01T19:30:00.000Z');
  const ics = renderEventIcs(event, { site, now });
  assert.match(prop(ics, 'DTSTART'), /^DTSTART:20270701T170000Z$/);
  assert.match(prop(ics, 'DTEND'), /^DTEND:20270701T193000Z$/);
  assert.match(prop(ics, 'DESCRIPTION'), /Local time: 10:00–12:30 \(America\/Vancouver\)/);
  const links = calendarLinks(event, { site });
  const google = new URL(links.google);
  const outlook = new URL(links.outlook);
  assert.equal(google.searchParams.get('dates'), '20270701T170000Z/20270701T193000Z');
  assert.equal(outlook.searchParams.get('startdt'), '2027-07-01T17:00:00Z');
  assert.equal(outlook.searchParams.get('enddt'), '2027-07-01T19:30:00Z');
  assert.equal(outlook.searchParams.get('allday'), 'false');
});

test('a multi-day timed event runs from the start clock time through the end clock time', () => {
  const event = { ...games, start_date: '2027-07-01', end_date: '2027-07-03', start_time: '09:00', end_time: '17:00', region: 'SK' };
  const schedule = eventSchedule(event);
  assert.equal(schedule.startUtc.toISOString(), '2027-07-01T15:00:00.000Z');
  assert.equal(schedule.endUtc.toISOString(), '2027-07-03T23:00:00.000Z');
});

test('a same-day start time without an end lasts two hours', () => {
  const schedule = eventSchedule({ ...games, start_time: '10:00', region: 'AB' });
  assert.equal(schedule.startUtc.toISOString(), '2027-06-26T16:00:00.000Z');
  assert.equal(schedule.endUtc.toISOString(), '2027-06-26T18:00:00.000Z');
});

test('a clock time with no known timezone degrades to an all-day event', () => {
  const schedule = eventSchedule({ ...games, region: 'Atlantis', regionLabel: 'Atlantis', start_time: '10:00', timezone: 'Not/AZone' });
  assert.equal(schedule.allDay, true);
  assert.equal(schedule.timeSkipped, true);
  assert.equal(schedule.endDateExclusive, '2027-06-27');
});

test('an explicit timezone overrides the region', () => {
  const event = { ...games, region: 'AB', timezone: 'America/Halifax', start_time: '10:00', end_time: '11:00' };
  assert.equal(timeZoneFor(event), 'America/Halifax');
  assert.equal(eventSchedule(event).startUtc.toISOString(), '2027-06-26T13:00:00.000Z');
});

test('a clock time that ends before it starts falls back to all-day', () => {
  const schedule = eventSchedule({ ...games, start_time: '22:00', end_time: '01:00' });
  assert.equal(schedule.allDay, true);
  assert.equal(schedule.timeSkipped, true);
});

test('the site feed and the per-event file share one VEVENT', () => {
  const list = [games, { ...games, id: 'second-2027-07-04', name: 'Second', start_date: '2027-07-04', end_date: '2027-07-05' }];
  const feed = renderFeed(list, { site, now });
  const one = renderEventIcs(games, { site, now });
  const feedEvent = vevents(feed)[0];
  const singleEvent = vevents(one)[0];
  assert.equal(feedEvent, singleEvent);
  assert.match(feed, /X-WR-TIMEZONE:America\/Edmonton/);
  assert.equal(vevents(renderFeed([{ name: 'No date', id: 'no-date' }, games], { site, now })).length, 1);
});

test('every published event is an all-day feed entry on its own dates', () => {
  const feed = renderFeed(events, { site, now });
  const blocks = vevents(feed);
  assert.equal(blocks.length, events.length);
  for (const event of events) {
    const schedule = eventSchedule(event);
    assert.equal(schedule.allDay, true, event.id);
    assert.equal(schedule.startDate, event.start_date);
    assert.equal(schedule.endDateExclusive, nextIsoDate(event.end_date || event.start_date));
    const block = blocks.find((item) => item.replace(/\r\n[ \t]/g, '').includes(`UID:${event.id}@celticcoo.ca`));
    assert.ok(block, event.id);
    assert.equal(prop(block, 'UID'), `UID:${event.id}@celticcoo.ca`);
    assert.match(prop(block, 'DTSTART'), new RegExp(`${event.start_date.replace(/-/g, '')}$`));
    assert.match(prop(block, 'DTEND'), new RegExp(`${schedule.endDateExclusive.replace(/-/g, '')}$`));
  }
  assert.equal(timeZoneFor({ region: 'SK' }), 'America/Regina');
  assert.equal(timeZoneFor({ region: 'NL' }), 'America/St_Johns');
  assert.equal(timeZoneFor({ region: 'Oregon' }), 'America/Los_Angeles');
  assert.equal(timeZoneFor({ province_or_region: 'North Carolina' }), 'America/New_York');
  const regina = events.find((event) => event.region === 'SK');
  if (regina) assert.equal(timeZoneFor(regina), 'America/Regina');
});

test('the reminder form posts to the existing Kit form and does not ship a secret', () => {
  const form = readFileSync(join(here, '../src/components/NewsletterForm.astro'), 'utf8');
  const page = readFileSync(join(here, '../src/pages/events/[id].astro'), 'utf8');
  const card = readFileSync(join(here, '../src/components/EventCard.astro'), 'utf8');
  const siteSource = readFileSync(join(here, '../src/lib/site.js'), 'utf8');
  assert.match(siteSource, /interest: 'event_reminders'/);
  assert.match(siteSource, /event: 'reminder_event'/);
  assert.match(siteSource, /region: 'reminder_region'/);
  assert.match(form, /kitAction/);
  assert.match(form, /KIT_REMINDER_FIELDS/);
  assert.match(form, /type="checkbox"/);
  assert.match(form, /value="yes"/);
  assert.match(form, /required/);
  assert.match(form, /Watch for a confirmation email/);
  assert.match(form, /You can unsubscribe at any time/);
  assert.match(form, /MAILING_ADDRESS/);
  assert.match(form, /CONTACT_EMAIL/);
  assert.doesNotMatch(form, /\schecked[\s=>]/);
  assert.doesNotMatch(form, /api_key|api_secret|KIT_API|X-Kit-Api-Key/i);
  assert.doesNotMatch(form, /Street|Avenue|Drive|Crescent|Boulevard/i);
  assert.match(page, /AddToCalendar/);
  assert.match(page, /reminders=\{true\}/);
  assert.match(card, /AddToCalendar/);
  assert.match(siteSource, /event_reminders/);
  assert.doesNotMatch(readFileSync(join(here, '../src/lib/calendar.js'), 'utf8'), /api_key|api_secret/i);
});
