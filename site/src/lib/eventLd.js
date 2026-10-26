// Event JSON-LD for one leaf page.
//
// Google's Event rich result (developers.google.com/search/docs/appearance/structured-data/event,
// reviewed 2026-10-22) requires name, startDate, and location. image, offers, organizer,
// and performer are recommended. We fill those only with values we can stand behind:
//
// - image: a per-event image URL when the record has one. Otherwise the site's own
//   share images in /images/, which are original artwork and are files in the build.
//   Organizer photos are not copied or hotlinked.
// - organizer: the hosting society or association, with url set to that host's domain
//   when we know it. A sanctioning association (for example the BCPA schedule) is not
//   the organizer of someone else's games.
// - performer: a named person or group billed for this event. A field of competing
//   bands, or "ceilidh performers" with no names, is left out.
// - offers: only when offers.url is a page that sells tickets for this event.
//   Google requires that URL to be a landing page where the public can buy admission,
//   so a general homepage or an association date list is not an offer. price and
//   priceCurrency are emitted together, and only for a price published for this event
//   (never a previous year's price, never a guess). availability is only InStock,
//   SoldOut, or PreOrder when we know which. If tickets are not on sale yet, leave
//   availability off and set validFrom to the published on-sale date.
//   A free event (cost === 'free') is the exception: admission is the offer. The URL is
//   offers.url, or source_url when there is no ticket page. price is 0, priceCurrency
//   comes from the country (never a guess), and availability is InStock. validFrom is
//   set only when offers.validFrom or tickets_on_sale is already a date.

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

export function eventOrganizers(event) {
  return asList(event?.organizer).flatMap((org) => {
    if (!org || typeof org.name !== 'string' || !org.name.trim()) return [];
    const out = { '@type': 'Organization', name: org.name.trim() };
    if (typeof org.url === 'string' && org.url.trim()) out.url = org.url.trim();
    return [out];
  });
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

function currencyFor(event) {
  const fromCountry = CURRENCY_BY_COUNTRY[event?.country];
  if (fromCountry) return fromCountry;
  const raw = typeof event?.offers?.priceCurrency === 'string' ? event.offers.priceCurrency.trim() : '';
  return /^[A-Z]{3}$/.test(raw) ? raw : '';
}

// Free admission is an offer even when nobody sells a ticket. Price stays 0; the
// currency follows the country. A date already on the record can be validFrom.
function freeOffer(event) {
  const raw = event?.offers;
  const ticketUrl = typeof raw?.url === 'string' ? raw.url.trim() : '';
  const source = typeof event?.source_url === 'string' ? event.source_url.trim() : '';
  const url = ticketUrl || source;
  const currency = currencyFor(event);
  if (!url || !currency) return null;
  const offer = {
    '@type': 'Offer',
    url,
    price: 0,
    priceCurrency: currency,
    availability: AVAILABILITY.InStock,
  };
  const validFrom = dated(raw?.validFrom) || dated(event?.tickets_on_sale);
  if (validFrom) offer.validFrom = validFrom;
  return offer;
}

export function eventOffer(event) {
  if (event?.cost === 'free') {
    const free = freeOffer(event);
    if (free) return free;
  }
  const raw = event?.offers;
  if (!raw || typeof raw.url !== 'string' || !raw.url.trim()) return null;
  const offer = { '@type': 'Offer', url: raw.url.trim() };
  const hasPrice = raw.price !== undefined && raw.price !== null && raw.price !== '';
  if (hasPrice) {
    const price = typeof raw.price === 'number' ? raw.price : Number(String(raw.price).trim());
    const currency = typeof raw.priceCurrency === 'string' ? raw.priceCurrency.trim() : '';
    if (Number.isFinite(price) && price >= 0 && /^[A-Z]{3}$/.test(currency)) {
      offer.price = price;
      offer.priceCurrency = currency;
    }
  }
  const availability = typeof raw.availability === 'string' ? raw.availability.replace(/^https:\/\/schema\.org\//, '') : '';
  if (AVAILABILITY[availability]) offer.availability = AVAILABILITY[availability];
  if (dated(raw.validFrom)) offer.validFrom = raw.validFrom;
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
    location: {
      '@type': 'Place',
      name: event.city,
      address: {
        '@type': 'PostalAddress',
        addressLocality: event.city,
        addressRegion: event.region,
        ...(COUNTRY_CODE[event.country] ? { addressCountry: COUNTRY_CODE[event.country] } : {}),
      },
    },
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
