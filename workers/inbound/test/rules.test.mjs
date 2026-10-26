import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseClassification, classifyByRules, normalizeClassification } from '../src/classify.js';
import { assessGaps, planDraft } from '../src/clarify.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');

// Synthetic notes. They are not copies of mail received by the site.
const VAGUE_SUBJECT = 'A short question';
const VAGUE_BODY = 'Hello, could you help sometime? Thanks.';

const BOOKING_SUBJECT = 'Booking inquiry: pipe band for a Burns Supper';
const BOOKING_BODY = [
  'Sample Organizer (organizer@example.com) asks: could a pipe band or Highland dancers',
  'perform at a Burns Supper on Saturday, March 14, 2027 at the Sample Legion Hall, Lethbridge, AB?',
  'Please arrive at 5 PM and start the set at 8 PM.',
].join(' ');

test('a vague synthetic note stays other, low confidence, and drafts a clarification', () => {
  const rules = classifyByRules({ subject: VAGUE_SUBJECT, text: VAGUE_BODY });
  assert.equal(rules.category, 'other');
  assert.ok(rules.confidence < 0.45, `confidence ${rules.confidence}`);
  assert.ok(rules.confidence > 0, `confidence ${rules.confidence}`);
  const draft = planDraft({
    category: rules.category,
    event: rules.event,
    subject: VAGUE_SUBJECT,
    text: VAGUE_BODY,
    now: NOW,
    env: {},
  });
  assert.ok(draft);
  assert.equal(draft.status, 'pending_approval');
  assert.deepEqual(draft.reasons, ['unclear']);
  assert.match(draft.draft, /list an event/);
  assert.doesNotMatch(draft.draft, /Sample Organizer/);
  assert.doesNotMatch(draft.draft, /organizer@example.com/);
});

test('a synthetic Burns booking is a high-confidence booking with the place and time filled in', () => {
  const rules = classifyByRules({ subject: BOOKING_SUBJECT, text: BOOKING_BODY });
  assert.equal(rules.category, 'booking_inquiry');
  assert.ok(rules.confidence >= 0.8, `confidence ${rules.confidence}`);
  assert.match(rules.event.title, /Burns Supper/);
  assert.equal(rules.event.date, 'March 14, 2027');
  assert.equal(rules.event.venue, 'Sample Legion Hall');
  assert.equal(rules.event.city, 'Lethbridge');
  assert.equal(rules.event.province, 'Alberta');
  assert.doesNotMatch(rules.summary, /organizer@example.com/);
  assert.equal(rules.signals.performer, true);
  const draft = planDraft({
    category: rules.category,
    event: rules.event,
    subject: BOOKING_SUBJECT,
    text: BOOKING_BODY,
    now: NOW,
    env: {},
  });
  assert.equal(draft, null);
});

test('lexicon variants, places, and misspellings still land on the right category', () => {
  const rows = [
    {
      subject: 'Please list our céilidh',
      text: 'Please list our céilidh on 2 May 2027 in Halifax, NS.',
      category: 'event_listing_request',
      city: 'Halifax',
      province: 'Nova Scotia',
      date: '2 May 2027',
    },
    {
      subject: 'Please add our highalnd games',
      text: 'A highland gathering on 1 June 2027 in Red Deer.',
      category: 'event_listing_request',
      city: 'Red Deer',
      province: 'Alberta',
    },
    {
      subject: 'Céilí in Ottawa',
      text: 'Please list our ceili dance on 14 March 2027 in Ottawa, ON.',
      category: 'event_listing_request',
      city: 'Ottawa',
      province: 'Ontario',
    },
    {
      subject: "Please list our St. Andrew's concert",
      text: "St Andrew's Day on 30 November 2027 in Toronto, Ontario.",
      category: 'event_listing_request',
      province: 'Ontario',
    },
    {
      subject: 'Hogmanay',
      text: 'Please list our Hogmanay ceilidh on 31 December 2027 in Edmonton, AB. Free admission.',
      category: 'event_listing_request',
      city: 'Edmonton',
      province: 'Alberta',
    },
    {
      subject: 'Tartan Day parade',
      text: 'Please list our Tartan Day celtic parade on 6 April 2027 in Victoria, BC.',
      category: 'event_listing_request',
      province: 'British Columbia',
    },
    {
      subject: 'Gaelic class',
      text: 'Please add our Gàidhlig class on 3 February 2027 in Antigonish, Nova Scotia.',
      category: 'event_listing_request',
      province: 'Nova Scotia',
    },
    {
      subject: 'Pipes and drums for a funeral',
      text: 'We would like to hire pipes and drums for a funeral in Winnipeg, Manitoba.',
      category: 'booking_inquiry',
    },
    {
      subject: 'Step dance',
      text: 'Could an Irish step dancer perform at a wedding in Charlottetown, PE?',
      category: 'booking_inquiry',
      province: 'Prince Edward Island',
    },
    {
      subject: 'Fiddler',
      text: 'Looking to hire a fiddler for a corporate event in Whitehorse, YT.',
      category: 'booking_inquiry',
      province: 'Yukon',
    },
  ];
  for (const row of rows) {
    const got = classifyByRules({ subject: row.subject, text: row.text });
    assert.equal(got.category, row.category, row.subject);
    if (row.city) assert.equal(got.event.city, row.city, row.subject);
    if (row.province) assert.equal(got.event.province, row.province, row.subject);
    if (row.date) assert.equal(got.event.date, row.date, row.subject);
  }
});

test('a first name that only sounds like a ceilidh does not become an event', () => {
  const kaylee = classifyByRules({
    subject: 'Hello',
    text: 'Kaylee asked me to say the photos look nice.',
  });
  assert.equal(kaylee.category, 'other');
  assert.ok(kaylee.confidence < 0.45);
});

test('the word on is not the Ontario abbreviation', () => {
  const got = classifyByRules({
    subject: 'Burns Supper on Saturday',
    text: 'A Burns Supper on Saturday, March 6, 2027.',
  });
  assert.equal(got.category, 'event_listing_request');
  assert.equal(got.event.province, '');
  assert.equal(got.event.date, 'March 6, 2027');
});

test('a town with the province left off still fills Alberta', () => {
  const got = classifyByRules({
    subject: 'Please list our Highland Games',
    text: 'Please list our Highland Games in Okotoks on 1 June 2027 at the Community Hall.',
  });
  assert.equal(got.event.city, 'Okotoks');
  assert.equal(got.event.province, 'Alberta');
  assert.equal(got.event.venue, 'Community Hall');
  assert.equal(got.event.date, '1 June 2027');
});

test('quoted replies, signatures, and marketing footers do not pick the category', () => {
  const quoted = classifyByRules({
    subject: 'Please list our Burns Supper',
    text: [
      'The Calgary Burns Club is hosting a Burns Supper on 25 January 2027 at the Glencoe Club in Calgary, Alberta.',
      'On Monday someone wrote:',
      'Buy now. Guest post and SEO services for your site.',
    ].join('\n'),
  });
  assert.equal(quoted.category, 'event_listing_request');
  assert.equal(quoted.event.city, 'Calgary');

  const signed = classifyByRules({
    subject: 'Please list our ceilidh',
    text: [
      'Please list our ceilidh on 2 May 2027 in Halifax, Nova Scotia at the church hall.',
      '--',
      'Sent from my phone',
      'Unsubscribe from this list',
    ].join('\n'),
  });
  assert.equal(signed.category, 'event_listing_request');
  assert.equal(signed.event.province, 'Nova Scotia');
});

test('newsletter questions and auto-replies stay other and do not draft', () => {
  const newsletter = classifyByRules({
    subject: 'Newsletter question',
    text: "How do I unsubscribe from the Coo's Letter?",
  });
  assert.equal(newsletter.category, 'other');
  assert.equal(newsletter.signals.newsletter, true);
  assert.ok(newsletter.confidence >= 0.6);
  assert.deepEqual(assessGaps({
    category: newsletter.category,
    event: newsletter.event,
    subject: 'Newsletter question',
    text: "How do I unsubscribe from the Coo's Letter?",
    now: NOW,
  }), []);

  const away = classifyByRules({
    subject: 'Re: your note',
    text: 'I am out of the office until Monday and will reply when I return to the desk.',
  });
  assert.equal(away.category, 'other');
  assert.equal(away.signals.automated, true);
  assert.equal(planDraft({
    category: away.category,
    event: away.event,
    subject: 'Re: your note',
    text: 'I am out of the office until Monday and will reply when I return to the desk.',
    now: NOW,
    env: {},
  }), null);

  const overridden = chooseClassification(away, normalizeClassification({
    category: 'event_listing_request',
    confidence: 0.99,
    summary: 'List this.',
  }));
  assert.equal(overridden.classifier, 'rules');
  assert.equal(overridden.category, 'other');
});

test('an out-of-office line buried under a real listing does not hide the listing', () => {
  const listing = 'Please list our Highland Games on 4 July 2027 in Red Deer, Alberta at the Westerner. ';
  const text = `${listing}${'Details follow shortly. '.repeat(20)}I am out of the office until Monday.`;
  assert.ok(text.indexOf('out of the office') > 280);
  const got = classifyByRules({ subject: 'Please list our Highland Games', text });
  assert.equal(got.category, 'event_listing_request');
  assert.equal(got.signals.automated, false);
  assert.equal(got.event.city, 'Red Deer');
});

test('a society directory listing does not demand a date, and a booking with no act does', () => {
  const society = classifyByRules({
    subject: 'Please add our society',
    text: 'Please list the Calgary Burns Club on the groups page. We are a pipe band in Calgary, Alberta.',
  });
  assert.equal(society.category, 'event_listing_request');
  assert.equal(society.signals.directory, true);
  assert.deepEqual(assessGaps({
    category: society.category,
    event: society.event,
    subject: 'Please add our society',
    text: 'Please list the Calgary Burns Club on the groups page. We are a pipe band in Calgary, Alberta.',
    now: NOW,
  }), []);

  const unnamed = classifyByRules({
    subject: 'Wedding entertainment',
    text: 'We would like to hire someone for a wedding.',
  });
  assert.equal(unnamed.category, 'booking_inquiry');
  assert.equal(unnamed.signals.performer, false);
  assert.deepEqual(assessGaps({
    category: unnamed.category,
    event: unnamed.event,
    subject: 'Wedding entertainment',
    text: 'We would like to hire someone for a wedding.',
    now: NOW,
  }), ['missing_when', 'missing_place', 'missing_act']);
});
