import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import groupsRaw from '../../data/groups_canada.json' with { type: 'json' };
import { groups, events } from '../src/lib/data.js';
import { DEFAULT_ALPHABET, redirectLines } from '../../shared/slugs/index.js';
import {
  suggestClubSlug,
  assignClubSlugs,
  assignClubCodes,
  publishedSlug,
  linkPack,
  clubShareTitle,
  CLUB_SHARE_DESCRIPTION,
  shareClubPage,
  eventMatchesClub,
  splitClubEvents,
  clubLinks,
  clubMetaDescription,
  eventDateParts,
  eventPlace,
} from '../src/lib/groupProfiles.js';

test('short club slugs drop fillers and suffixes, and a published slug never changes', () => {
  assert.equal(suggestClubSlug('Sláinte Social Club'), 'slainte');
  assert.equal(suggestClubSlug('City of Calgary Pipe Band'), 'calgary');
  assert.equal(suggestClubSlug('RSCDS Montréal'), 'rscds-montreal');
  assert.equal(suggestClubSlug('Airdrie Scots Pipes & Drums'), 'airdrie-scots');
  assert.notEqual(suggestClubSlug('Royal Scottish Country Dance Society Calgary Branch'), 'rscds-calgary');
  assert.deepEqual(
    assignClubSlugs([{ name: 'Royal Scottish Country Dance Society Calgary Branch', city: 'Calgary', slug: 'rscds-calgary' }]),
    ['rscds-calgary'],
  );
  assert.deepEqual(assignClubSlugs([
    { name: 'Harbour Pipe Band', city: 'Calgary' },
    { name: 'Harbour Pipe Band', city: 'Edmonton' },
  ]), ['harbour', 'harbour-edmonton']);
  assert.equal(JSON.stringify(assignClubSlugs([
    { name: 'Harbour Pipe Band', city: 'Calgary' },
    { name: 'Harbour Pipe Band', city: 'Edmonton' },
  ])).includes('-2'), false);
  assert.deepEqual(assignClubSlugs([{ name: 'Renamed Club', city: 'Calgary', slug: 'slainte' }]), ['slainte']);

  const snapshot = JSON.parse(readFileSync(new URL('./fixtures/published-club-slugs.json', import.meta.url), 'utf8'));
  assert.deepEqual(groupsRaw.map((g) => [g.name, g.slug, g.code]), snapshot);
  assert.equal(new Set(snapshot.map((row) => row[1])).size, snapshot.length);
  assert.equal(new Set(snapshot.map((row) => row[2])).size, snapshot.length);
  snapshot.forEach(([, slug, code]) => {
    assert.equal(publishedSlug(slug), slug);
    assert.equal(/-\d+$/.test(slug), false);
    assert.equal(code.length, linkPack.shortCodeLength);
    assert.equal([...code].every((char) => DEFAULT_ALPHABET.includes(char)), true);
  });
  const byName = new Map(groups.map((g) => [g.name, g.id]));
  groupsRaw.forEach((g) => assert.equal(byName.get(g.name), g.slug));
  assert.deepEqual(assignClubSlugs(groupsRaw), snapshot.map((row) => row[1]));
  assert.deepEqual(assignClubCodes(groupsRaw), snapshot.map((row) => row[2]));
  assert.deepEqual(assignClubCodes([{ name: 'Renamed Club', code: 'k7mp' }]), ['k7mp']);
  const manual = new Map([['RSCDS Calgary Branch', 'rscds-calgary']]);
  const regenerated = assignClubSlugs(groupsRaw.map((g) => (manual.has(g.name) ? g : { ...g, slug: '' })));
  assert.deepEqual(regenerated, snapshot.map((row) => row[1]));
  const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8').trim().split('\n').filter((line) => line && !line.startsWith('#'));
  const expected = redirectLines(groupsRaw.map((g) => ({ slug: g.slug, code: g.code })), linkPack);
  assert.deepEqual(redirects, expected);
  assert.equal(expected.length >= groupsRaw.length, true);
  const src = readFileSync(new URL('../src/lib/groupProfiles.js', import.meta.url), 'utf8');
  assert.match(src, /published slug never changes/);
});

test('a shared profile card names the club and keeps the site image', () => {
  const club = { name: 'Sláinte Social Club', kind: 'Pipe band / piping', city: 'Calgary', regionLabel: 'Alberta' };
  assert.equal(clubShareTitle(club), 'Sláinte Social Club · Pipe band / piping · Calgary, Alberta');
  assert.equal(clubShareTitle({ name: 'ScotDance Canada', kind: 'Association', city: 'National', regionLabel: 'National / multi-province' }), 'ScotDance Canada · Association · National / multi-province');
  assert.equal(CLUB_SHARE_DESCRIPTION, 'Upcoming events on The Celtic Coo');
  const layout = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');
  assert.match(layout, /const shareTitle = ogTitle \|\| fullTitle/);
  assert.match(layout, /property="og:title" content=\{shareTitle\}/);
  assert.match(layout, /property="og:description" content=\{shareDescription\}/);
  assert.match(layout, /name="twitter:title" content=\{shareTitle\}/);
  assert.match(layout, /name="twitter:description" content=\{shareDescription\}/);
  assert.match(layout, /property="og:image" content=\{ogImage\}/);
  assert.match(layout, /name="twitter:card" content="summary_large_image"/);
  const profile = readFileSync(new URL('../src/pages/groups/[id].astro', import.meta.url), 'utf8');
  assert.match(profile, /ogTitle=\{clubShareTitle\(g\)\}/);
  assert.match(profile, /ogDescription=\{CLUB_SHARE_DESCRIPTION\}/);
  assert.doesNotMatch(profile, /og:image/);
});

test('share copies the page URL and falls back to the share sheet on mobile', async () => {
  const calls = [];
  assert.equal(await shareClubPage('https://celticcoo.ca/groups/slainte-social-club/', {
    copy: (url) => { calls.push(['copy', url]); },
    share: (url) => { calls.push(['share', url]); },
    mobile: true,
  }), 'copied');
  assert.deepEqual(calls, [['copy', 'https://celticcoo.ca/groups/slainte-social-club/']]);

  calls.length = 0;
  assert.equal(await shareClubPage('https://celticcoo.ca/groups/x/', {
    copy: () => Promise.reject(new Error('denied')),
    share: (url) => { calls.push(url); },
    mobile: true,
  }), 'shared');
  assert.deepEqual(calls, ['https://celticcoo.ca/groups/x/']);

  assert.equal(await shareClubPage('https://celticcoo.ca/groups/x/', {
    copy: () => Promise.reject(new Error('denied')),
    share: () => { throw new Error('should not share on desktop'); },
    mobile: false,
  }), 'failed');

  assert.equal(await shareClubPage('https://celticcoo.ca/groups/x/', {
    copy: () => Promise.reject(new Error('denied')),
    share: () => Promise.reject(Object.assign(new Error('cancel'), { name: 'AbortError' })),
    mobile: true,
  }), 'aborted');
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
  assert.match(profile, /Share this page/);
  assert.match(profile, /Link copied/);
  assert.match(profile, /shareClubPage/);
  assert.match(profile, /navigator\.clipboard/);
  assert.match(profile, /navigator\.share/);
  assert.match(profile, /id="share-page"/);
  assert.match(profile, /id="short-link"/);
  assert.match(profile, /Short link:/);
  assert.match(profile, /DOMAIN\.toLowerCase\(\)/);
  assert.match(profile, /shortPrefix/);
});
