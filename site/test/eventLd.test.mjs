import test from 'node:test';
import assert from 'node:assert/strict';
import { eventJsonLd, EVENT_IMAGE_FALLBACK } from '../src/lib/eventLd.js';

const base = {
  id: 'example-games-2027-06-01',
  name: 'Example Games',
  start_date: '2027-06-01',
  end_date: '2027-06-02',
  city: 'Regina',
  region: 'SK',
  country: 'Canada',
  type: 'Highland Games',
  note: 'Victoria Park',
  source_url: 'https://example.test/',
  source_kind: 'official',
};

test('every event gets a crawlable image, using the site artwork when none is published', () => {
  const ld = eventJsonLd(base);
  assert.deepEqual(ld.image, EVENT_IMAGE_FALLBACK);
  assert.ok(EVENT_IMAGE_FALLBACK.every((url) => url.startsWith('https://celticcoo.ca/images/celtic-coo-event-')));
});

test('a real per-event image replaces the fallback', () => {
  const ld = eventJsonLd({ ...base, image: 'https://celticcoo.ca/images/example.png' });
  assert.deepEqual(ld.image, ['https://celticcoo.ca/images/example.png']);
});

test('organizer and performer are omitted when the record does not name them', () => {
  const ld = eventJsonLd(base);
  assert.equal('organizer' in ld, false);
  assert.equal('performer' in ld, false);
});

test('organizer keeps a host url and still emits a name-only host', () => {
  const one = eventJsonLd({ ...base, organizer: [{ name: 'Example Society', url: 'https://example.test/' }] });
  assert.deepEqual(one.organizer, { '@type': 'Organization', name: 'Example Society', url: 'https://example.test/' });
  const named = eventJsonLd({ ...base, organizer: [{ name: 'Tea Room' }] });
  assert.deepEqual(named.organizer, { '@type': 'Organization', name: 'Tea Room' });
  assert.equal('url' in named.organizer, false);
});

test('several organizers stay a list', () => {
  const ld = eventJsonLd({
    ...base,
    organizer: [{ name: 'One', url: 'https://one.test/' }, { name: 'Two' }],
  });
  assert.equal(ld.organizer.length, 2);
  assert.equal(ld.organizer[1].name, 'Two');
  assert.equal('url' in ld.organizer[1], false);
});

test('performers accept a name or a name and url, and ignore blanks', () => {
  const ld = eventJsonLd({
    ...base,
    performers: ['Blackthorn', { name: 'Wee Drams', url: 'https://weedrams.test/' }, { name: '  ' }, ''],
  });
  assert.deepEqual(ld.performer, [
    { '@type': 'PerformingGroup', name: 'Blackthorn' },
    { '@type': 'PerformingGroup', name: 'Wee Drams', url: 'https://weedrams.test/' },
  ]);
});

test('an official event page is not an offer by itself', () => {
  const ld = eventJsonLd({ ...base, tickets_on_sale: '2027-02-01' });
  assert.equal('offers' in ld, false);
});

test('a ticket url can be an offer without a made-up price or availability', () => {
  const ld = eventJsonLd({ ...base, offers: { url: 'https://example.test/tickets', priceCurrency: 'CAD' } });
  assert.deepEqual(ld.offers, { '@type': 'Offer', url: 'https://example.test/tickets' });
});

test('price is emitted only with a currency, including a real free admission', () => {
  const priced = eventJsonLd({
    ...base,
    offers: { url: 'https://example.test/tickets', price: 16, priceCurrency: 'GBP', availability: 'InStock' },
  });
  assert.equal(priced.offers.price, 16);
  assert.equal(priced.offers.priceCurrency, 'GBP');
  assert.equal(priced.offers.availability, 'https://schema.org/InStock');
  const free = eventJsonLd({ ...base, offers: { url: 'https://example.test/tickets', price: 0, priceCurrency: 'CAD' } });
  assert.equal(free.offers.price, 0);
  const bare = eventJsonLd({ ...base, offers: { url: 'https://example.test/tickets', price: 20 } });
  assert.equal('price' in bare.offers, false);
  assert.equal('priceCurrency' in bare.offers, false);
});

test('unknown availability is dropped, and a future on-sale date does not imply in stock', () => {
  const ld = eventJsonLd({
    ...base,
    offers: { url: 'https://example.test/tickets', availability: 'Maybe', validFrom: '2027-02-01' },
  });
  assert.equal('availability' in ld.offers, false);
  assert.equal(ld.offers.validFrom, '2027-02-01');
});

test('a free event is marked accessible for free, and paid or unknown events are not', () => {
  const free = eventJsonLd({ ...base, cost: 'free' });
  assert.equal(free.isAccessibleForFree, true);
  assert.match(free.description, /Free admission/);
  assert.deepEqual(free.offers, {
    '@type': 'Offer',
    url: 'https://example.test/',
    price: 0,
    priceCurrency: 'CAD',
    availability: 'https://schema.org/InStock',
  });
  assert.equal('validFrom' in free.offers, false);
  const paid = eventJsonLd({ ...base, cost: 'paid' });
  assert.equal('isAccessibleForFree' in paid, false);
  assert.equal('offers' in paid, false);
  const unknown = eventJsonLd({ ...base, cost: 'unknown' });
  assert.equal('isAccessibleForFree' in unknown, false);
  const omitted = eventJsonLd(base);
  assert.equal('isAccessibleForFree' in omitted, false);
  const pricedFree = eventJsonLd({ ...base, cost: 'free', offers: { url: 'https://example.test/tickets', price: 0, priceCurrency: 'CAD' } });
  assert.equal(pricedFree.isAccessibleForFree, true);
  assert.equal(pricedFree.offers.price, 0);
  assert.equal(pricedFree.offers.url, 'https://example.test/tickets');
  assert.equal(pricedFree.offers.availability, 'https://schema.org/InStock');
});

test('a free offer uses the country currency and does not invent a price or a date', () => {
  const uk = eventJsonLd({ ...base, country: 'UK', cost: 'free' });
  assert.equal(uk.offers.price, 0);
  assert.equal(uk.offers.priceCurrency, 'GBP');
  const usa = eventJsonLd({ ...base, country: 'USA', cost: 'free', source_url: 'https://example.test/parade' });
  assert.equal(usa.offers.priceCurrency, 'USD');
  assert.equal(usa.offers.url, 'https://example.test/parade');
  const france = eventJsonLd({ ...base, country: 'France', cost: 'free' });
  assert.equal(france.offers.priceCurrency, 'EUR');
  const dated = eventJsonLd({ ...base, cost: 'free', tickets_on_sale: '2027-03-01' });
  assert.equal(dated.offers.validFrom, '2027-03-01');
  const fromOffer = eventJsonLd({
    ...base,
    cost: 'free',
    tickets_on_sale: '2027-03-01',
    offers: { url: 'https://example.test/tickets', validFrom: '2027-02-01', price: 12, priceCurrency: 'USD', availability: 'SoldOut' },
  });
  assert.equal(fromOffer.offers.url, 'https://example.test/tickets');
  assert.equal(fromOffer.offers.price, 0);
  assert.equal(fromOffer.offers.priceCurrency, 'CAD');
  assert.equal(fromOffer.offers.availability, 'https://schema.org/InStock');
  assert.equal(fromOffer.offers.validFrom, '2027-02-01');
  const noDate = eventJsonLd({ ...base, cost: 'free', start_date: '2027-06-01', added_date: '2026-10-25' });
  assert.equal('validFrom' in noDate.offers, false);
  const nowhere = eventJsonLd({ ...base, cost: 'free', country: 'Ireland', source_url: '' });
  assert.equal('offers' in nowhere, false);
  const explicitCurrency = eventJsonLd({
    ...base,
    cost: 'free',
    country: 'Ireland',
    offers: { url: 'https://example.test/tickets', priceCurrency: 'EUR' },
  });
  assert.equal(explicitCurrency.offers.price, 0);
  assert.equal(explicitCurrency.offers.priceCurrency, 'EUR');
});

test('the record stays an Event with the required properties', () => {
  const ld = eventJsonLd(base);
  assert.equal(ld['@type'], 'Event');
  assert.equal(ld.name, 'Example Games');
  assert.equal(ld.startDate, '2027-06-01');
  assert.equal(ld.location['@type'], 'Place');
  assert.equal(ld.location.address.addressCountry, 'CA');
});
