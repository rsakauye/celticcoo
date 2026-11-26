import test from 'node:test';
import assert from 'node:assert/strict';
import { events } from '../src/lib/data.js';
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

test('organizer falls back to The Celtic Coo when the record names nobody', () => {
  const ld = eventJsonLd(base);
  assert.deepEqual(ld.organizer, { '@type': 'Organization', name: 'The Celtic Coo', url: 'https://celticcoo.ca' });
  assert.equal('email' in ld.organizer, false);
  assert.equal('telephone' in ld.organizer, false);
  assert.equal('address' in ld.organizer, false);
  assert.equal('performer' in ld, false);
  const blank = eventJsonLd({ ...base, organizer: [{ name: '   ' }], performers: ['Blackthorn'] });
  assert.equal(blank.organizer.name, 'The Celtic Coo');
  assert.equal(blank.performer.name, 'Blackthorn');
});

test('organizer keeps a host url and still emits a name-only host', () => {
  const one = eventJsonLd({ ...base, organizer: [{ name: 'Example Society', url: 'https://example.test/' }] });
  assert.deepEqual(one.organizer, { '@type': 'Organization', name: 'Example Society', url: 'https://example.test/' });
  const named = eventJsonLd({ ...base, organizer: [{ name: 'Tea Room' }] });
  assert.deepEqual(named.organizer, { '@type': 'Organization', name: 'Tea Room' });
  assert.equal('url' in named.organizer, false);
  const asString = eventJsonLd({ ...base, organizer: 'Example Society' });
  assert.deepEqual(asString.organizer, { '@type': 'Organization', name: 'Example Society' });
});

test('organizer uses a host band, then a band or club name, and never copies contact details', () => {
  const host = eventJsonLd({ ...base, host_band: { name: 'Barrie Pipes & Drums', url: 'https://band.test/', email: 'band@example.test', telephone: '403-555-0100' } });
  assert.deepEqual(host.organizer, { '@type': 'Organization', name: 'Barrie Pipes & Drums', url: 'https://band.test/' });

  const person = eventJsonLd({ ...base, host: { '@type': 'Person', name: 'Morag Fraser', url: 'https://morag.test/', address: '1 Main St' } });
  assert.deepEqual(person.organizer, { '@type': 'Person', name: 'Morag Fraser', url: 'https://morag.test/' });

  const band = eventJsonLd({ ...base, band: 'Calgary Piobaireachd Club' });
  assert.deepEqual(band.organizer, { '@type': 'Organization', name: 'Calgary Piobaireachd Club' });
  assert.equal('url' in band.organizer, false);

  const club = eventJsonLd({ ...base, club: { name: 'Burns Club of Calgary', url: 'https://club.test/', streetAddress: '1 Main St' } });
  assert.deepEqual(club.organizer, { '@type': 'Organization', name: 'Burns Club of Calgary', url: 'https://club.test/' });

  const named = eventJsonLd({
    ...base,
    organizer: [{ name: 'Example Society', url: 'https://example.test/', email: 'hello@example.test', phone: '403-555-0199' }],
    band: 'Some Other Band',
  });
  assert.deepEqual(named.organizer, { '@type': 'Organization', name: 'Example Society', url: 'https://example.test/' });
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

test('a ticket url without a price is not an offer', () => {
  const ld = eventJsonLd({ ...base, offers: { url: 'https://example.test/tickets', priceCurrency: 'CAD' } });
  assert.equal('offers' in ld, false);
});

test('a priced offer uses a number string, currency, the ticket or event url, and availability when known', () => {
  const priced = eventJsonLd({
    ...base,
    offers: { url: 'https://example.test/tickets', price: 16, priceCurrency: 'GBP', availability: 'InStock' },
  });
  assert.equal(priced.offers.price, '16');
  assert.equal(typeof priced.offers.price, 'string');
  assert.equal(priced.offers.priceCurrency, 'GBP');
  assert.equal(priced.offers.url, 'https://example.test/tickets');
  assert.equal(priced.offers.availability, 'https://schema.org/InStock');

  const cad = eventJsonLd({
    ...base,
    offers: { url: 'https://example.test/tickets', price: 59.85, priceCurrency: 'CAD' },
  });
  assert.equal(cad.offers.price, '59.85');
  assert.equal(cad.offers.priceCurrency, 'CAD');
  assert.equal('availability' in cad.offers, false);

  const freePrice = eventJsonLd({ ...base, offers: { url: 'https://example.test/tickets', price: 0, priceCurrency: 'CAD' } });
  assert.equal(freePrice.offers.price, '0');

  const bare = eventJsonLd({ ...base, offers: { url: 'https://example.test/tickets', price: 20 } });
  assert.equal(bare.offers.price, '20');
  assert.equal(bare.offers.priceCurrency, 'CAD');
  assert.equal(bare.offers.url, 'https://example.test/tickets');

  const eventPage = eventJsonLd({ ...base, source_url: '', offers: { price: 12, priceCurrency: 'CAD' } });
  assert.equal(eventPage.offers.url, 'https://celticcoo.ca/events/example-games-2027-06-01/');
  assert.equal(eventPage.offers.price, '12');
  assert.equal(eventPage.offers.priceCurrency, 'CAD');

  const sourcePage = eventJsonLd({ ...base, offers: { price: 12, priceCurrency: 'CAD' } });
  assert.equal(sourcePage.offers.url, 'https://example.test/');
});

test('an unknown price omits the whole offers object', () => {
  const stockOnly = eventJsonLd({
    ...base,
    offers: { url: 'https://example.test/tickets', availability: 'InStock', validFrom: '2027-02-01' },
  });
  assert.equal('offers' in stockOnly, false);
  const paid = eventJsonLd({ ...base, cost: 'paid', offers: { url: 'https://example.test/tickets' } });
  assert.equal('offers' in paid, false);
  const unknown = eventJsonLd({ ...base, cost: 'unknown' });
  assert.equal('offers' in unknown, false);
  const currencyOnly = eventJsonLd({ ...base, offers: { url: 'https://example.test/tickets', priceCurrency: 'CAD', availability: 'SoldOut' } });
  assert.equal('offers' in currencyOnly, false);
});

test('unknown availability is dropped, and a future on-sale date does not imply in stock', () => {
  const ld = eventJsonLd({
    ...base,
    offers: { url: 'https://example.test/tickets', price: 25, priceCurrency: 'CAD', availability: 'Maybe', validFrom: '2027-02-01' },
  });
  assert.equal(ld.offers.price, '25');
  assert.equal(ld.offers.priceCurrency, 'CAD');
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
    price: '0',
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
  assert.equal(pricedFree.offers.price, '0');
  assert.equal(pricedFree.offers.url, 'https://example.test/tickets');
  assert.equal(pricedFree.offers.availability, 'https://schema.org/InStock');
});

test('a free offer uses the country currency and does not invent a price or a date', () => {
  const uk = eventJsonLd({ ...base, country: 'UK', cost: 'free' });
  assert.equal(uk.offers.price, '0');
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
  assert.equal(fromOffer.offers.price, '0');
  assert.equal(fromOffer.offers.priceCurrency, 'CAD');
  assert.equal(fromOffer.offers.availability, 'https://schema.org/InStock');
  assert.equal(fromOffer.offers.validFrom, '2027-02-01');
  const noDate = eventJsonLd({ ...base, cost: 'free', start_date: '2027-06-01', added_date: '2026-10-25' });
  assert.equal('validFrom' in noDate.offers, false);
  const nowhere = eventJsonLd({ ...base, cost: 'free', country: 'Ireland', source_url: '' });
  assert.equal(nowhere.offers.price, '0');
  assert.equal(nowhere.offers.priceCurrency, 'CAD');
  assert.equal(nowhere.offers.url, 'https://celticcoo.ca/events/example-games-2027-06-01/');
  const noUrl = eventJsonLd({ ...base, id: '', cost: 'free', country: 'Ireland', source_url: '' });
  assert.equal('offers' in noUrl, false);
  const explicitCurrency = eventJsonLd({
    ...base,
    cost: 'free',
    country: 'Ireland',
    offers: { url: 'https://example.test/tickets', priceCurrency: 'EUR' },
  });
  assert.equal(explicitCurrency.offers.price, '0');
  assert.equal(explicitCurrency.offers.priceCurrency, 'EUR');
});

test('every published event names an organizer and only offers a known price', () => {
  const noPrice = new Set([
    'Royal Edinburgh Military Tattoo',
    'World Pipe Band Championships',
    'Braemar Gathering',
  ]);
  for (const event of events) {
    const ld = eventJsonLd(event);
    const orgs = Array.isArray(ld.organizer) ? ld.organizer : [ld.organizer];
    assert.ok(orgs.length > 0, event.name);
    for (const org of orgs) {
      assert.ok(org['@type'] === 'Organization' || org['@type'] === 'Person', event.name);
      assert.equal(typeof org.name, 'string', event.name);
      assert.ok(org.name.trim(), event.name);
      assert.equal('email' in org, false, event.name);
      assert.equal('telephone' in org, false, event.name);
      assert.equal('address' in org, false, event.name);
    }
    if (noPrice.has(event.name)) assert.equal('offers' in ld, false, event.name);
    if (!ld.offers) continue;
    assert.equal(typeof ld.offers.price, 'string', event.name);
    assert.match(ld.offers.price, /^\d+(\.\d{2})?$/, event.name);
    assert.match(ld.offers.priceCurrency, /^[A-Z]{3}$/, event.name);
    assert.equal(typeof ld.offers.url, 'string', event.name);
    assert.ok(ld.offers.url, event.name);
    if (event.cost === 'free') assert.equal(ld.offers.price, '0', event.name);
  }
});

test('the record stays an Event with the required properties', () => {
  const ld = eventJsonLd(base);
  assert.equal(ld['@type'], 'Event');
  assert.equal(ld.name, 'Example Games');
  assert.equal(ld.startDate, '2027-06-01');
  assert.equal(ld.location['@type'], 'Place');
  assert.equal(ld.location.address.addressCountry, 'CA');
});

test('location name is the venue when the record has one, and the city when it does not', () => {
  const withVenue = eventJsonLd({
    ...base,
    city: 'Calgary',
    region: 'AB',
    venue: 'Spruce Meadows',
    street_address: '100 Example Road',
    postal_code: 'T0T 0T0',
  });
  assert.equal(withVenue.location['@type'], 'Place');
  assert.equal(withVenue.location.name, 'Spruce Meadows');
  assert.equal(withVenue.location.address['@type'], 'PostalAddress');
  assert.equal(withVenue.location.address.streetAddress, '100 Example Road');
  assert.equal(withVenue.location.address.postalCode, 'T0T 0T0');
  assert.equal(withVenue.location.address.addressLocality, 'Calgary');
  assert.equal(withVenue.location.address.addressRegion, 'AB');
  assert.equal(withVenue.location.address.addressCountry, 'CA');
  assert.equal(withVenue.startDate, base.start_date);
  assert.equal(withVenue.endDate, base.end_date);
  assert.equal(withVenue.eventStatus, 'https://schema.org/EventScheduled');
  assert.equal(withVenue.eventAttendanceMode, 'https://schema.org/OfflineEventAttendanceMode');
  assert.equal(withVenue.sameAs, base.source_url);
  assert.deepEqual(withVenue.image, EVENT_IMAGE_FALLBACK);

  const cityOnly = eventJsonLd({ ...base, city: 'Calgary', region: 'AB' });
  assert.equal(cityOnly.location.name, 'Calgary');
  assert.equal('streetAddress' in cityOnly.location.address, false);
  assert.equal('postalCode' in cityOnly.location.address, false);
  assert.equal(cityOnly.location.address.addressLocality, 'Calgary');
  assert.equal(cityOnly.location.address.addressRegion, 'AB');

  const blank = eventJsonLd({
    ...base,
    venue: '   ',
    street_address: '',
    postal_code: '  ',
    notes: '100 Example Road',
    note: 'Topaz Park',
  });
  assert.equal(blank.location.name, base.city);
  assert.equal('streetAddress' in blank.location.address, false);
  assert.equal('postalCode' in blank.location.address, false);
});
