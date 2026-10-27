import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import groupsRaw from '../../data/groups_canada.json' with { type: 'json' };
import { slugify, groups, events } from '../src/lib/data.js';
import {
  slugifyClub,
  uniqueClubSlugs,
  eventMatchesClub,
  splitClubEvents,
  clubLinks,
  clubMetaDescription,
  eventDateParts,
  eventPlace,
} from '../src/lib/groupProfiles.js';

test('club slugs strip accents and stay unique in source order', () => {
  assert.equal(slugifyClub('Sláinte Social Club'), 'slainte-social-club');
  assert.equal(slugifyClub('Comunn Gàidhlig Thoronto (Gaelic Society of Toronto)'), slugify('Comunn Gàidhlig Thoronto (Gaelic Society of Toronto)'));
  assert.equal(slugifyClub('RSCDS Montréal'), 'rscds-montreal');
  assert.equal(slugifyClub('Pipes & Drums'), 'pipes-and-drums');
  assert.deepEqual(uniqueClubSlugs(['Sláinte', 'Slainte', 'Other', 'Sláinte']), ['slainte', 'slainte-2', 'other', 'slainte-3']);
  const ids = uniqueClubSlugs(groupsRaw.map((g) => g.name));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[groupsRaw.findIndex((g) => g.name === 'Sláinte Social Club')], 'slainte-social-club');
  const byName = new Map(groups.map((g) => [g.name, g.id]));
  groupsRaw.forEach((g, i) => assert.equal(byName.get(g.name), ids[i]));
});

test('events match a club by slug or exact organizer name, not by a partial title', () => {
  const slainte = { id: 'slainte-social-club', name: 'Sláinte Social Club' };
  const calgary = groups.find((g) => g.name === 'Calgary Burns Club');
  assert.equal(eventMatchesClub({ name: 'Ceilidh with Sláinte Social Club', organizer: [{ name: 'Someone else' }] }, slainte), false);
  assert.equal(eventMatchesClub({ groups: ['slainte-social-club'], organizer: [{ name: 'Legion' }] }, slainte), true);
  assert.equal(eventMatchesClub({ group: 'slainte-social-club' }, slainte), true);
  assert.equal(eventMatchesClub({ organizer: [{ name: 'sláinte social club' }] }, slainte), true);
  assert.equal(eventMatchesClub({ organizer: 'Burns Club of Calgary' }, calgary), false);
  assert.equal(eventMatchesClub({ organizer: [{ name: 'Calgary Burns Club' }] }, calgary), true);
  assert.equal(eventMatchesClub({ groups: ['not-a-club'], organizer: [{ name: 'Other' }] }, slainte), false);

  const ottawa = groups.find((g) => g.name === 'The Scottish Society of Ottawa');
  const supper = events.find((e) => e.name === 'Scottish Society of Ottawa Burns Supper');
  assert.ok(supper);
  assert.equal(eventMatchesClub(supper, ottawa), true);
  assert.equal(eventMatchesClub(supper, slainte), false);
  const moncton = groups.find((g) => g.name === 'Greater Moncton Scottish Association');
  assert.equal(events.filter((e) => eventMatchesClub(e, moncton)).length, 2);
  assert.equal(events.filter((e) => eventMatchesClub(e, groups.find((g) => g.name === 'Sláinte Social Club'))).length, 0);
});

test('upcoming events are soonest first and past events are newest first', () => {
  const club = { id: 'band', name: 'Band' };
  const list = [
    { name: 'Old', start_date: '2026-01-02', end_date: '2026-01-02', organizer: [{ name: 'Band' }] },
    { name: 'Older', start_date: '2025-12-01', end_date: '2025-12-01', groups: ['band'] },
    { name: 'Next', start_date: '2026-11-01', end_date: '2026-11-02', organizer: [{ name: 'Band' }] },
    { name: 'Later', start_date: '2027-02-01', end_date: '2027-02-01', group: 'band' },
    { name: 'Still on', start_date: '2026-10-01', end_date: '2026-10-27', organizer: [{ name: 'Band' }] },
    { name: 'No date', organizer: [{ name: 'Band' }] },
    { name: 'Other club', start_date: '2026-11-05', end_date: '2026-11-05', organizer: [{ name: 'Else' }] },
  ];
  const { upcoming, past } = splitClubEvents(list, club, '2026-10-27');
  assert.deepEqual(upcoming.map((e) => e.name), ['Still on', 'Next', 'Later']);
  assert.deepEqual(past.map((e) => e.name), ['Old', 'Older']);
  assert.deepEqual(past.slice(0, 5).map((e) => e.name), ['Old', 'Older']);
});

test('profile links and the event row only use values that are actually there', () => {
  const links = clubLinks({
    website: 'https://example.com',
    facebook: 'https://facebook.com/example',
    instagram: 'not a url',
    social: { youtube: 'https://youtube.com/@example' },
    socials: [{ label: 'Bandcamp', url: 'https://band.example' }, { label: '', url: 'https://nope.example' }],
  });
  assert.deepEqual(links.map((link) => link.label), ['Website', 'Facebook', 'YouTube', 'Bandcamp']);
  assert.equal(clubLinks({ website: 'javascript:alert(1)', facebook: '' }).length, 0);
  assert.equal(clubMetaDescription({ name: 'Sláinte Social Club', kind: 'Pipe band / piping', city: 'Calgary', regionLabel: 'Alberta', note: 'A Grade 3 pipe band.' }).includes('Calgary, Alberta'), true);
  assert.ok(clubMetaDescription({ name: 'A', kind: 'Gaelic', regionLabel: 'Nova Scotia', note: 'word '.repeat(80) }).length <= 160);
  assert.deepEqual(eventDateParts('2027-01-22'), { month: 'Jan', day: '22' });
  assert.equal(eventPlace({ venue: 'Hotel Arts', city: 'Calgary', regionLabel: 'Alberta' }), 'Hotel Arts · Calgary, Alberta');
  assert.equal(eventPlace({ city: 'Toronto', regionLabel: 'Ontario' }), 'Toronto, Ontario');
});

test('listing cards link to the profile, and the profile page has the sections', () => {
  const listing = readFileSync(new URL('../src/pages/groups/index.astro', import.meta.url), 'utf8');
  const profile = readFileSync(new URL('../src/pages/groups/[id].astro', import.meta.url), 'utf8');
  assert.match(listing, /class="card grp"/);
  assert.match(listing, /href=\{u\(`groups\/\$\{g\.id\}\/`\)\}/);
  assert.match(listing, /View profile →/);
  assert.match(listing, /a\.grp\[hidden\] \{ display:none !important; \}/);
  assert.doesNotMatch(listing, /Visit website/);
  assert.match(profile, /No upcoming events listed/);
  assert.match(profile, /Add yours/);
  assert.match(profile, /Show all/);
  assert.match(profile, /id="group-back"/);
  assert.match(profile, /rel="noopener"/);
  assert.match(profile, /target="_blank"/);
  assert.match(profile, /getStaticPaths/);
  assert.match(profile, /splitClubEvents/);
});
