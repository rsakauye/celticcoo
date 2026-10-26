// Site pack for The Celtic Coo. The engine reads this and does not
// hard-code Highland Games, Kit, or Alberta. Copy this file for another
// site and replace the phrases, places, categories, and seasons.

/** @typedef {'event_listing_request'|'booking_inquiry'|'correction_or_update'|'partnership_or_press'|'spam'|'other'} Category */

export const categories = [
  'event_listing_request',
  'booking_inquiry',
  'correction_or_update',
  'partnership_or_press',
  'spam',
  'other',
];

export const scoring = {
  minScore: 3.5,
  subjectWeight: 2,
  maxConfidence: 0.93,
  // A message with no signals stays clearly uncertain.
  emptyConfidence: 0.26,
};

export const guard = {
  timeZone: 'America/Edmonton',
  // Off-season limit is rollingDailyAverage * offSeasonMultiplier,
  // then clamped. Same ISO week last year replaces the rolling average
  // once that history exists.
  offSeasonMultiplier: 3,
  floorPerDay: 8,
  ceilingPerDay: 80,
  // Hard stop for Email Sending cost. Hold never overrides this.
  outboundDailyCap: 40,
  // A burst smaller than this is ordinary mail, not a bulk review.
  minBurst: 4,
  seasons: [
    { id: 'hogmanay', label: 'Hogmanay', multiplier: 3, start: [12, 27], end: [1, 4] },
    { id: 'burns', label: 'Burns Night', multiplier: 4, start: [1, 10], end: [1, 31] },
    { id: 'games', label: 'Highland Games season', multiplier: 3, start: [4, 1], end: [8, 31] },
    { id: 'andrews', label: "St Andrew's", multiplier: 3, start: [11, 15], end: [11, 30] },
  ],
};

export const provinces = [
  { name: 'Newfoundland and Labrador', forms: ['newfoundland and labrador', 'newfoundland', 'nfld', 'nl', 'n.l.'] },
  { name: 'Prince Edward Island', forms: ['prince edward island', 'pei', 'p.e.i.', 'pe'] },
  { name: 'Nova Scotia', forms: ['nova scotia', 'ns', 'n.s.'] },
  { name: 'New Brunswick', forms: ['new brunswick', 'nb', 'n.b.'] },
  { name: 'Quebec', forms: ['quebec', 'québec', 'qc', 'pq', 'p.q.'] },
  { name: 'Ontario', forms: ['ontario', 'ont', 'on'] },
  { name: 'Manitoba', forms: ['manitoba', 'man', 'mb'] },
  { name: 'Saskatchewan', forms: ['saskatchewan', 'sask', 'sk'] },
  { name: 'Alberta', forms: ['alberta', 'alta', 'ab'] },
  { name: 'British Columbia', forms: ['british columbia', 'bc', 'b.c.'] },
  { name: 'Yukon', forms: ['yukon', 'yt', 'y.t.'] },
  { name: 'Northwest Territories', forms: ['northwest territories', 'nwt', 'nt'] },
  { name: 'Nunavut', forms: ['nunavut', 'nu'] },
];

// Used when a town is named and the province is left off. Not a gazetteer.
export const albertaTowns = [
  'Calgary', 'Edmonton', 'Red Deer', 'Lethbridge', 'Medicine Hat', 'Fort McMurray',
  'Grande Prairie', 'Airdrie', 'Spruce Grove', 'Okotoks', 'Leduc', 'Cochrane',
  'Fort Saskatchewan', 'Chestermere', 'St. Albert', 'Sherwood Park', 'Camrose',
  'Brooks', 'Wetaskiwin', 'Lacombe', 'Canmore', 'Banff', 'Jasper', 'Hinton',
  'Edson', 'Whitecourt', 'Slave Lake', 'Peace River', 'Drumheller', 'Strathmore',
  'High River', 'Black Diamond', 'Turner Valley', 'Diamond Valley',
  'Nanton', 'Claresholm', 'Pincher Creek', 'Fort Macleod', 'Cardston', 'Coaldale',
  'Taber', 'Crowsnest Pass', 'Sylvan Lake', 'Innisfail', 'Olds', 'Didsbury',
  'Carstairs', 'Rocky Mountain House', 'Sundre', 'Ponoka', 'Stettler', 'Wainwright',
  'Lloydminster', 'Vegreville', 'Vermilion', 'Cold Lake', 'Bonnyville', 'Athabasca',
  'Westlock', 'Barrhead', 'Morinville', 'Beaumont', 'Devon', 'High Level',
  'Fairview', 'Hanna', 'Three Hills', 'Rimbey', 'Blackfalds', 'Penhold',
  'Bragg Creek', 'Millarville', 'De Winton', 'Langdon', 'Crossfield', 'Irricana',
  'Beiseker', 'Water Valley', 'Cremona', 'Exshaw', 'Lake Louise', 'Harvie Heights',
];

export const venueWords = [
  'hall', 'legion', 'lodge', 'church', 'centre', 'center', 'arena', 'club',
  'hotel', 'parish', 'cathedral', 'school', 'grounds', 'park', 'elks',
  'auditorium', 'rink', 'community centre', 'community center',
];

// role is a side flag. weight 0 phrases only set the flag.
// category scores are summed. Subject matches are multiplied by scoring.subjectWeight.
export const phrases = [
  { id: 'please-list', category: 'event_listing_request', weight: 5, role: 'listing', forms: ['please list', 'please add', 'please include', 'add this event', 'add our event', 'add an event', 'list our', 'event listing', 'submit our event', 'submit an event', 'submit the event'] },
  { id: 'hosting', category: 'event_listing_request', weight: 4, role: 'listing', forms: ['is hosting', 'are hosting', 'we are hosting', 'were hosting'] },
  { id: 'free-admission', category: 'event_listing_request', weight: 1.5, role: 'event', forms: ['free admission', 'free entry', 'admission is free', 'no admission charge', 'free to attend'] },
  { id: 'highland-games', category: 'event_listing_request', weight: 2, role: 'event', forms: ['highland games', 'highland gathering', 'scottish games', 'highalnd games', 'highand games', 'highlandgames', 'highland game'] },
  { id: 'ceilidh', category: 'event_listing_request', weight: 2, role: 'event', forms: ['ceilidh', 'ceilidhs', 'céilidh', 'cèilidh', 'cielidh', 'ceillidh', 'ceilie'] },
  { id: 'kaylee', category: 'event_listing_request', weight: 1, role: 'event', forms: ['kaylee', 'kayleigh', 'kailey'] },
  { id: 'ceili', category: 'event_listing_request', weight: 2, role: 'event', forms: ['céilí', 'ceili', 'ceili dance', 'ceili dances'] },
  { id: 'burns', category: 'event_listing_request', weight: 2, role: 'event', forms: ['burns supper', 'burns suppers', 'burns night', 'burns nights', 'robbie burns', 'rabbie burns', 'robert burns', 'robbie burns day', 'robert burns supper', 'robert burns night', 'burns day'] },
  { id: 'pipe-comp', category: 'event_listing_request', weight: 2, role: 'event', forms: ['pipe band competition', 'pipe band competitions', 'piping competition', 'piping championship', 'band contest'] },
  { id: 'andrews', category: 'event_listing_request', weight: 2, role: 'event', forms: ["st andrews", "st andrew's", 'st andrews day', 'saint andrews', 'saint andrews day', 'st. andrews'] },
  { id: 'hogmanay', category: 'event_listing_request', weight: 2, role: 'event', forms: ['hogmanay', 'hogmany', 'hogmaney', 'hogmanay ceilidh'] },
  { id: 'tartan', category: 'event_listing_request', weight: 2, role: 'event', forms: ['tartan day', 'tartan week'] },
  { id: 'gaelic', category: 'event_listing_request', weight: 1.5, role: 'event', forms: ['gaelic', 'gàidhlig', 'gaidhlig', 'gaelig', 'gaeilge'] },
  { id: 'festival', category: 'event_listing_request', weight: 1.5, role: 'event', forms: ['celtic festival', 'cultural festival', 'irish festival', 'scottish festival', 'celtic fest'] },
  { id: 'tattoo-parade', category: 'event_listing_request', weight: 1.5, role: 'event', forms: ['military tattoo', 'highland tattoo', 'tartan parade', 'celtic parade'] },

  { id: 'booking-verb', category: 'booking_inquiry', weight: 4.5, role: 'booking', forms: ['booking inquiry', 'booking enquiry', 'book a', 'book an', 'like to book', 'want to book', 'looking to book', 'would like to hire', 'like to hire', 'want to hire', 'looking to hire', 'hire a', 'hire an'] },
  { id: 'booking-word', category: 'booking_inquiry', weight: 3, role: 'booking', forms: ['booking', 'bookings'] },
  { id: 'perform-at', category: 'booking_inquiry', weight: 2, role: 'booking', forms: ['perform at', 'performance at', 'play at', 'available to play', 'can you play', 'come and play'] },
  { id: 'available', category: 'booking_inquiry', weight: 1.2, role: 'booking', forms: ['are you available', 'availability'] },
  { id: 'piper', category: 'booking_inquiry', weight: 3, role: 'performer', forms: ['piper', 'pipers', 'bagpiper', 'bagpipers', 'bag piper', 'bag pipers'] },
  { id: 'drummer', category: 'booking_inquiry', weight: 3, role: 'performer', forms: ['drummer', 'drummers', 'pipe drummer'] },
  { id: 'pipe-band', category: 'booking_inquiry', weight: 3, role: 'performer', forms: ['pipe band', 'pipe bands', 'pipeband', 'pipes and drums', 'pipes & drums'] },
  { id: 'highland-dance', category: 'booking_inquiry', weight: 3, role: 'performer', forms: ['highland dancer', 'highland dancers', 'highland dance', 'highland dancing'] },
  { id: 'irish-dance', category: 'booking_inquiry', weight: 3, role: 'performer', forms: ['irish dancer', 'irish dancers', 'irish dance', 'irish dancing', 'step dancer', 'step dancers', 'step dance', 'stepdance', 'step-dance'] },
  { id: 'fiddler', category: 'booking_inquiry', weight: 3, role: 'performer', forms: ['fiddler', 'fiddlers', 'fiddle player', 'fiddle players'] },
  { id: 'ceilidh-band', category: 'booking_inquiry', weight: 3, role: 'performer', forms: ['ceilidh band', 'ceilidh bands', 'celtic band', 'celtic bands'] },
  { id: 'occasion', category: 'booking_inquiry', weight: 1.5, role: 'occasion', forms: ['wedding', 'weddings', 'funeral', 'funerals', 'memorial', 'memorials', 'corporate event', 'corporate events', 'corporate function'] },

  { id: 'correction', category: 'correction_or_update', weight: 5, role: 'correction', forms: ['correction', 'incorrect', 'wrong date', 'date is wrong', 'date has changed', 'please update', 'please remove', 'please take down', 'take this down', 'has been cancelled', 'has been canceled', 'is cancelled', 'is canceled', 'was cancelled', 'was canceled', 'postponed', 'rescheduled', 'no longer happening', 'remove the listing', 'remove this listing', 'delete the listing', 'take down the listing'] },

  { id: 'press', category: 'partnership_or_press', weight: 4.5, role: 'press', forms: ['partnership', 'sponsorship', 'sponsor', 'press request', 'journalist', 'interview', 'media kit', 'collaborate', 'collaboration', 'press release'] },

  { id: 'spam-seo', category: 'spam', weight: 5, role: 'spam', forms: ['seo', 'seo services', 'search engine optimization', 'guest post', 'guest posts', 'guest posting', 'backlink', 'backlinks', 'link building', 'link exchange'] },
  { id: 'spam-pitch', category: 'spam', weight: 4, role: 'spam', forms: ['buy now', 'click here', 'viagra', 'crypto airdrop', 'bitcoin doubling', 'wire transfer', 'you have won', 'digital marketing agency', 'increase your traffic', 'boost your ranking'] },
  { id: 'spam-footer', category: 'spam', weight: 4, role: 'spam', forms: ['unsubscribe from this list', 'unsubscribe from this newsletter', 'view in your browser', 'view this email in', 'you are receiving this', 'youre receiving this', 'manage your preferences', 'this message was sent'] },

  { id: 'newsletter', category: '', weight: 0, role: 'newsletter', forms: ['newsletter', "coo's letter", 'coos letter', 'kit.com', 'convertkit', 'mailing list', 'sign up for the newsletter', 'subscribe to', 'unsubscribe'] },
];

export const automatedForms = [
  'automatic reply', 'auto reply', 'autoreply', 'out of office', 'out of the office',
  'delivery status notification', 'undeliverable', 'mail delivery failed',
  'delivery has failed', 'this is an automated', 'this is an automatically generated',
  'do not reply', 'mailer-daemon', 'auto-submitted',
];

export const directoryForms = [
  'society', 'societies', 'association', 'club', 'guild', 'pipe band', 'pipe bands',
  'groups page', 'group listing', 'directory',
];

const celticcoo = {
  id: 'celticcoo',
  categories,
  scoring,
  guard,
  provinces,
  albertaTowns,
  venueWords,
  phrases,
  automatedForms,
  directoryForms,
};

export default celticcoo;
