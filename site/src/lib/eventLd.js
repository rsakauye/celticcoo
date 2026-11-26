// Event JSON-LD for one leaf page.
//
// Google's Event rich result (developers.google.com/search/docs/appearance/structured-data/event,
// reviewed 2026-10-22) requires name, startDate, and location. image, offers, organizer,
// and performer are recommended. We fill those only with values we can stand behind:
//
// - image: a per-event image URL when the record has one. Otherwise the site's own
//   share images in /images/, which are original artwork and are files in the build.
//   Organizer photos are not copied or hotlinked.
// - organizer: the hosting society, band, or club, as an Organization or Person.
//   name and url come from the event's organizer, or from host, band, or club when
//   that is what the record has. A name with no url is still named. Email, phone,
//   and street address are never copied. When the record names nobody, the organizer
//   is The Celtic Coo.
// - performer: a named person or group billed for this event. A field of competing
//   bands, or "ceilidh performers" with no names, is left out. Performers are not
//   treated as the organizer.
// - offers: only when a price is already on the record. price is a number string and
//   priceCurrency is emitted with it. A published priceCurrency is kept. Otherwise
//   the currency follows the country, and a Canadian price with no currency is CAD.
//   The url is the ticket page, then the event's own page. availability is only
//   InStock, SoldOut, or PreOrder when we know which. If tickets are not on sale yet,
//   leave availability off and set validFrom to the published on-sale date.
//   A ticket page with no published price is not an offer. Do not guess a price.
//   A free event (cost === 'free') is the exception: admission is the offer. price is
//   "0", priceCurrency comes from the country (or a published currency when the
//   country has none), and availability is InStock. validFrom is set only when
//   offers.validFrom or tickets_on_sale is already a date.

const ORIGIN = 'https://celticcoo.ca';
const COUNTRY_CODE = { Canada: 'CA', USA: 'US', UK: 'GB', France: 'FR' };
const CURRENCY_BY_COUNTRY = { Canada: 'CAD', USA: 'USD', UK: 'GBP', France: 'EUR' };

export const EVENT_IMAGE_FALLBACK = [
  `${ORIGIN}/images/celtic-coo-event-16x9.png`,
  `${ORIGIN}/images/celtic-coo-event-4x3.png`,
  `${ORIGIN}/images/celtic-coo-event-1x1.png`,
];

const AVAILABILITY = {
  InStock: 'https://schema.org/InStock',
  SoldOut: 'https://schema.org/SoldOut',
  PreOrder: 'https://schema.org/PreOrder',
};

function asList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function eventImages(event) {
  const own = asList(event?.image).filter((url) => typeof url === 'string' && url.trim());
  return own.length ? own : EVENT_IMAGE_FALLBACK;
}

const SITE_ORGANIZER = { '@type': 'Organization', name: 'The Celtic Coo', url: ORIGIN };

// Name and url only. A string is an organization name. @type Person stays a person.
// Email, phone, and street address on the record are left off.
function party(value) {
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? { '@type': 'Organization', name } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) return null;
  const kind = String(value['@type'] || value.type || '').trim().toLowerCase();
  const out = { '@type': kind === 'person' ? 'Person' : 'Organization', name };
  if (typeof value.url === 'string' && value.url.trim()) out.url = value.url.trim();
  return out;
}

function parties(value) {
  return asList(value).map(party).filter(Boolean);
}

export function eventOrganizers(event) {
  const named = parties(event?.organizer);
  if (named.length) return named;
  for (const key of ['host_band', 'host', 'band', 'club']) {
    const found = parties(event?.[key]);
    if (found.length) return found;
  }
  return [SITE_ORGANIZER];
}

export function eventPerformers(event) {
  return asList(event?.performers).flatMap((performer) => {
    const name = typeof performer === 'string' ? performer : performer?.name;
    if (typeof name !== 'string' || !name.trim()) return [];
    const out = { '@type': 'PerformingGroup', name: name.trim() };
    if (performer && typeof performer === 'object' && typeof performer.url === 'string' && performer.url.trim()) {
      out.url = performer.url.trim();
    }
    return [out];
  });
}

function dated(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value : '';
}

function placeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// location.name is venue when that string is set, otherwise the city.
// streetAddress and postalCode are copied only from street_address and postal_code.
// Blank strings are left off. Notes are not an address.
function eventLocation(event) {
  const venue = placeText(event?.venue);
  const address = {
    '@type': 'PostalAddress',
    addressLocality: event.city,
    addressRegion: event.region,
    ...(COUNTRY_CODE[event.country] ? { addressCountry: COUNTRY_CODE[event.country] } : {}),
  };
  const street = placeText(event?.street_address);
  const postal = placeText(event?.postal_code);
  if (street) address.streetAddress = street;
  if (postal) address.postalCode = postal;
  return {
    '@type': 'Place',
    name: venue || event.city,
    address,
  };
}

function isoCurrency(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return /^[A-Z]{3}$/.test(raw) ? raw : '';
}

// Free admission follows the country. A published currency is used only when the
// country has none. CAD is the last resort, never a guessed ticket price.
function freeCurrency(event) {
  return CURRENCY_BY_COUNTRY[event?.country] || isoCurrency(event?.offers?.priceCurrency) || 'CAD';
}

// A priced offer keeps the currency published with that price, then the country.
function pricedCurrency(event, raw) {
  return isoCurrency(raw?.priceCurrency) || CURRENCY_BY_COUNTRY[event?.country] || 'CAD';
}

function priceText(price) {
  const cents = Math.round((price + Number.EPSILON) * 100);
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

function publishedPrice(raw) {
  if (!raw || raw.price === undefined || raw.price === null || raw.price === '') return null;
  const price = typeof raw.price === 'number' ? raw.price : Number(String(raw.price).trim());
  if (!Number.isFinite(price) || price < 0) return null;
  return price;
}

// Ticket page first, then the event's own page, then this site's event page.
function offerUrl(event) {
  const ticket = typeof event?.offers?.url === 'string' ? event.offers.url.trim() : '';
  if (ticket) return ticket;
  const source = typeof event?.source_url === 'string' ? event.source_url.trim() : '';
  if (source) return source;
  const id = typeof event?.id === 'string' ? event.id.trim() : '';
  return id ? `${ORIGIN}/events/${id}/` : '';
}

function knownAvailability(raw) {
  const availability = typeof raw?.availability === 'string' ? raw.availability.replace(/^https:\/\/schema\.org\//, '') : '';
  return AVAILABILITY[availability] || '';
}

// Free admission is an offer even when nobody sells a ticket. Price stays "0".
// A date already on the record can be validFrom.
function freeOffer(event) {
  const url = offerUrl(event);
  if (!url) return null;
  const raw = event?.offers;
  const offer = {
    '@type': 'Offer',
    url,
    price: '0',
    priceCurrency: freeCurrency(event),
    availability: AVAILABILITY.InStock,
  };
  const validFrom = dated(raw?.validFrom) || dated(event?.tickets_on_sale);
  if (validFrom) offer.validFrom = validFrom;
  return offer;
}

export function eventOffer(event) {
  if (event?.cost === 'free') return freeOffer(event);
  const raw = event?.offers;
  const price = publishedPrice(raw);
  if (price === null) return null;
  const url = offerUrl(event);
  if (!url) return null;
  const offer = {
    '@type': 'Offer',
    url,
    price: priceText(price),
    priceCurrency: pricedCurrency(event, raw),
  };
  const availability = knownAvailability(raw);
  if (availability) offer.availability = availability;
  if (raw && dated(raw.validFrom)) offer.validFrom = raw.validFrom;
  return offer;
}

export function eventJsonLd(event) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.name,
    startDate: event.start_date,
    endDate: event.end_date || event.start_date,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: eventLocation(event),
    description: [event.type, event.cost === 'free' ? 'Free admission' : '', event.note].filter(Boolean).join('. '),
    url: `${ORIGIN}/events/${event.id}/`,
    sameAs: event.source_url,
    image: eventImages(event),
  };
  const organizers = eventOrganizers(event);
  if (organizers.length === 1) ld.organizer = organizers[0];
  else if (organizers.length > 1) ld.organizer = organizers;
  const performers = eventPerformers(event);
  if (performers.length === 1) ld.performer = performers[0];
  else if (performers.length > 1) ld.performer = performers;
  const offer = eventOffer(event);
  if (offer) ld.offers = offer;
  if (event.cost === 'free') ld.isAccessibleForFree = true;
  return ld;
}
