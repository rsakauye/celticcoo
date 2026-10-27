// Calendar links and iCalendar files for one event, and for the site-wide feed.
// All-day dates are floating calendar dates (RFC 5545 VALUE=DATE). DTEND is exclusive.
// They are not passed through a timezone, so a date does not shift to the previous
// evening in British Columbia or Newfoundland. A clock time is converted with the
// event's IANA timezone when we know one, and written in UTC.

const encoder = new TextEncoder();
const ISO_DATE = /^(\d{4}-\d{2}-\d{2})/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)/;

const REGION_ZONE = {
  AB: 'America/Edmonton',
  Alberta: 'America/Edmonton',
  BC: 'America/Vancouver',
  'British Columbia': 'America/Vancouver',
  SK: 'America/Regina',
  Saskatchewan: 'America/Regina',
  MB: 'America/Winnipeg',
  Manitoba: 'America/Winnipeg',
  ON: 'America/Toronto',
  Ontario: 'America/Toronto',
  QC: 'America/Toronto',
  Quebec: 'America/Toronto',
  Québec: 'America/Toronto',
  NB: 'America/Moncton',
  'New Brunswick': 'America/Moncton',
  NS: 'America/Halifax',
  'Nova Scotia': 'America/Halifax',
  PE: 'America/Halifax',
  PEI: 'America/Halifax',
  'Prince Edward Island': 'America/Halifax',
  NL: 'America/St_Johns',
  Newfoundland: 'America/St_Johns',
  'Newfoundland and Labrador': 'America/St_Johns',
  YT: 'America/Whitehorse',
  Yukon: 'America/Whitehorse',
  NT: 'America/Yellowknife',
  'Northwest Territories': 'America/Yellowknife',
  NU: 'America/Iqaluit',
  Nunavut: 'America/Iqaluit',
  Scotland: 'Europe/London',
  England: 'Europe/London',
  Wales: 'Europe/London',
  'Northern Ireland': 'Europe/London',
  Oregon: 'America/Los_Angeles',
  Washington: 'America/Los_Angeles',
  California: 'America/Los_Angeles',
  'North Carolina': 'America/New_York',
  Wisconsin: 'America/Chicago',
  France: 'Europe/Paris',
};

const COUNTRY_ZONE = {
  UK: 'Europe/London',
  France: 'Europe/Paris',
};

export function isRealIsoDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function nextIsoDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

// Names, not fixed offsets. Intl applies the IANA rules for that instant,
// including zones that keep one offset all year.
export function timeZoneFor(event) {
  const explicit = typeof event?.timezone === 'string' ? event.timezone.trim() : '';
  if (explicit && isValidTimeZone(explicit)) return explicit;
  const region = String(event?.region || event?.province_or_region || '').trim();
  if (REGION_ZONE[region]) return REGION_ZONE[region];
  const country = String(event?.country || '').trim();
  return COUNTRY_ZONE[country] || '';
}

function dateOnly(value) {
  if (typeof value !== 'string') return '';
  const m = value.trim().match(ISO_DATE);
  return m && isRealIsoDate(m[1]) ? m[1] : '';
}

function clockTime(value) {
  if (typeof value !== 'string') return '';
  const m = value.trim().match(CLOCK);
  return m ? `${m[1]}:${m[2]}` : '';
}

function embeddedTime(value) {
  if (typeof value !== 'string') return '';
  const m = value.trim().match(/T([01]\d|2[0-3]):([0-5]\d)/);
  return m ? `${m[1]}:${m[2]}` : '';
}

// Wall-clock time in an IANA zone, as a UTC Date. Returns null if the parts are unusable.
export function zonedWallTimeToUtc(isoDate, hhmm, timeZone) {
  if (!isRealIsoDate(isoDate) || !CLOCK.test(hhmm) || !isValidTimeZone(timeZone)) return null;
  const [y, mo, d] = isoDate.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const desiredAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  let utc = desiredAsUtc;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(utc)).map((p) => [p.type, p.value]));
    let hour = Number(parts.hour);
    if (hour === 24) hour = 0;
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
    const diff = desiredAsUtc - asUtc;
    if (diff === 0) return new Date(utc);
    utc += diff;
  }
  return new Date(utc);
}

function formatWall(utc, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(utc).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` };
}

function allDaySchedule(date, endDate, timeZone, timeSkipped = false) {
  return {
    allDay: true,
    timeSkipped,
    timeZone: timeZone || '',
    startDate: date,
    endDateInclusive: endDate,
    endDateExclusive: nextIsoDate(endDate),
  };
}

// Null when the event has no confirmed calendar date (for example a Date TBA listing).
export function eventSchedule(event) {
  const startRaw = typeof event?.start_date === 'string' ? event.start_date : '';
  const date = dateOnly(startRaw);
  if (!date) return null;
  let endDate = dateOnly(typeof event?.end_date === 'string' ? event.end_date : '') || date;
  if (endDate < date) endDate = date;
  const startTime = clockTime(event?.start_time) || embeddedTime(startRaw);
  const endTime = clockTime(event?.end_time);
  const zone = timeZoneFor(event);
  if (!startTime) return allDaySchedule(date, endDate, zone);
  if (!zone) return allDaySchedule(date, endDate, '', true);
  const startUtc = zonedWallTimeToUtc(date, startTime, zone);
  let endUtc = null;
  if (endTime) endUtc = zonedWallTimeToUtc(endDate, endTime, zone);
  else if (endDate > date) endUtc = zonedWallTimeToUtc(endDate, startTime, zone);
  else endUtc = new Date(startUtc.getTime() + 2 * 60 * 60 * 1000);
  if (!startUtc || !endUtc || endUtc.getTime() <= startUtc.getTime()) return allDaySchedule(date, endDate, zone, true);
  return {
    allDay: false,
    timeSkipped: false,
    timeZone: zone,
    startDate: date,
    endDateInclusive: endDate,
    startTime,
    endTime: endTime || '',
    startUtc,
    endUtc,
  };
}

export function icsEscape(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Fold at 75 octets. Continuation lines start with a space, per RFC 5545.
export function foldIcsLine(line) {
  const out = [];
  let s = line;
  while (encoder.encode(s).length > 75) {
    let n = 74;
    while (encoder.encode(s.slice(0, n)).length > 74) n--;
    out.push(s.slice(0, n));
    s = ` ${s.slice(n)}`;
  }
  out.push(s);
  return out.join('\r\n');
}

function placeLabel(event) {
  const region = event.regionLabel || event.region || event.province_or_region || '';
  return [event.city, region, event.country].filter((part, i, all) => part && all.indexOf(part) === i).join(', ');
}

function sourcePhrase(event) {
  return event.source_kind === 'organizer' ? 'Date from organizer' : 'Details and tickets';
}

function pageUrlFor(event, site) {
  const base = String(site || 'https://celticcoo.ca/');
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${root}events/${event.id}/`;
}

function detailsText(event, pageUrl, schedule) {
  const first = `${event.type || ''}${event.cost === 'free' ? ' · Free admission' : ''}${event.note ? ` · ${event.note}` : ''}`;
  const lines = [];
  if (first) lines.push(first);
  if (!schedule.allDay) {
    const startW = formatWall(schedule.startUtc, schedule.timeZone);
    const endW = formatWall(schedule.endUtc, schedule.timeZone);
    lines.push(`Local time: ${startW.time}–${endW.time} (${schedule.timeZone}).`);
  }
  if (event.source_url) lines.push(`${sourcePhrase(event)}: ${event.source_url}`);
  if (pageUrl) lines.push(`Listed on The Celtic Coo: ${pageUrl}`);
  return lines.join('\n');
}

function stampOf(now) {
  const d = now instanceof Date ? now : new Date(now || Date.now());
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function utcBasic(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function veventLines(event, schedule, { stamp, pageUrl }) {
  const lines = ['BEGIN:VEVENT', `UID:${event.id}@celticcoo.ca`, `DTSTAMP:${stamp}`];
  if (schedule.allDay) {
    lines.push(
      `DTSTART;VALUE=DATE:${schedule.startDate.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${schedule.endDateExclusive.replace(/-/g, '')}`,
    );
  } else {
    lines.push(`DTSTART:${utcBasic(schedule.startUtc)}`, `DTEND:${utcBasic(schedule.endUtc)}`);
  }
  lines.push(
    `SUMMARY:${icsEscape(event.name || 'Celtic event')}`,
    `LOCATION:${icsEscape(placeLabel(event))}`,
    `DESCRIPTION:${icsEscape(detailsText(event, pageUrl, schedule))}`,
  );
  if (event.source_url) lines.push(`URL:${icsEscape(event.source_url)}`);
  if (event.category) lines.push(`CATEGORIES:${icsEscape(event.category)}`);
  lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  return lines;
}

function renderLines(header, blocks) {
  const lines = [...header];
  for (const block of blocks) lines.push(...block);
  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

const FEED_HEADER = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//The Celtic Coo//CelticCoo.ca Events//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:The Celtic Coo: Celtic & Highland events',
  'X-WR-TIMEZONE:America/Edmonton',
  'X-WR-CALDESC:Confirmed Highland Games\\, pipe band\\, dance\\, Gaelic and Celtic festival dates. Always confirm with the organizer.',
  'REFRESH-INTERVAL;VALUE=DURATION:P1D',
  'X-PUBLISHED-TTL:P1D',
];

function blocksFor(list, { site, stamp }) {
  const blocks = [];
  for (const event of list || []) {
    const schedule = eventSchedule(event);
    if (!schedule || !event?.id) continue;
    blocks.push({ event, schedule, lines: veventLines(event, schedule, { stamp, pageUrl: pageUrlFor(event, site) }) });
  }
  return blocks;
}

export function renderFeed(list, { site = 'https://celticcoo.ca/', now = new Date() } = {}) {
  const built = blocksFor(list, { site, stamp: stampOf(now) });
  return renderLines(FEED_HEADER, built.map((item) => item.lines));
}

export function renderEventIcs(event, { site = 'https://celticcoo.ca/', now = new Date() } = {}) {
  const built = blocksFor([event], { site, stamp: stampOf(now) });
  if (!built.length) return '';
  const schedule = built[0].schedule;
  const name = event.name || 'Celtic event';
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Celtic Coo//CelticCoo.ca Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`,
    `X-WR-TIMEZONE:${schedule.timeZone || 'America/Edmonton'}`,
    'X-WR-CALDESC:One confirmed event from The Celtic Coo. Always confirm with the organizer.',
  ];
  return renderLines(header, [built[0].lines]);
}

function clip(value, max = 1200) {
  const text = String(value || '');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function googleCalendarUrl(schedule, { title, details, location }) {
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', title);
  if (schedule.allDay) {
    url.searchParams.set('dates', `${schedule.startDate.replace(/-/g, '')}/${schedule.endDateExclusive.replace(/-/g, '')}`);
  } else {
    url.searchParams.set('dates', `${utcBasic(schedule.startUtc)}/${utcBasic(schedule.endUtc)}`);
  }
  if (details) url.searchParams.set('details', clip(details));
  if (location) url.searchParams.set('location', location);
  return url.toString();
}

export function outlookCalendarUrl(schedule, { title, details, location }) {
  const url = new URL('https://outlook.live.com/calendar/0/deeplink/compose');
  url.searchParams.set('path', '/calendar/action/compose');
  url.searchParams.set('rru', 'addevent');
  url.searchParams.set('subject', title);
  if (schedule.allDay) {
    url.searchParams.set('startdt', schedule.startDate);
    url.searchParams.set('enddt', schedule.endDateExclusive);
    url.searchParams.set('allday', 'true');
  } else {
    url.searchParams.set('startdt', schedule.startUtc.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    url.searchParams.set('enddt', schedule.endUtc.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    url.searchParams.set('allday', 'false');
  }
  if (details) url.searchParams.set('body', clip(details));
  if (location) url.searchParams.set('location', location);
  return url.toString();
}

export function calendarLinks(event, { site = 'https://celticcoo.ca/' } = {}) {
  const schedule = eventSchedule(event);
  if (!schedule || !event?.id) return null;
  const pageUrl = pageUrlFor(event, site);
  const meta = {
    title: event.name || 'Celtic event',
    details: detailsText(event, pageUrl, schedule),
    location: placeLabel(event),
  };
  return {
    allDay: schedule.allDay,
    timeSkipped: schedule.timeSkipped,
    timeZone: schedule.timeZone || '',
    google: googleCalendarUrl(schedule, meta),
    outlook: outlookCalendarUrl(schedule, meta),
  };
}
