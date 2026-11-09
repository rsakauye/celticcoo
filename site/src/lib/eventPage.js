// Place line and nearby links for one event page.
// street and postal fields stay in the JSON-LD helper. This file only prints names we already have.

import { searchFromFilters } from './groupFilters.js';

function placeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function eventPlaceLine(event) {
  const venue = placeText(event?.venue);
  const city = placeText(event?.city);
  const region = placeText(event?.regionLabel);
  const country = placeText(event?.country);
  const parts = [];
  if (venue && venue !== city) parts.push(venue);
  if (city) parts.push(city);
  if (region && region !== city) parts.push(region);
  if (country && country !== 'Canada' && country !== region) parts.push(country);
  return parts.join(', ');
}

function ymd(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(placeText(value));
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function stamp(part) {
  return part.y * 10000 + part.m * 100 + part.d;
}

// True when the event dates overlap a month window. Late November is the 20th through the 30th.
function overlaps(event, month, dayMin, dayMax) {
  const start = ymd(event?.start_date);
  const end = ymd(event?.end_date) || start;
  if (!start || !end) return false;
  const lo = Math.min(stamp(start), stamp(end));
  const hi = Math.max(stamp(start), stamp(end));
  const firstYear = Math.min(start.y, end.y);
  const lastYear = Math.max(start.y, end.y);
  for (let year = firstYear; year <= lastYear; year++) {
    const windowLo = year * 10000 + month * 100 + dayMin;
    const windowHi = year * 10000 + month * 100 + dayMax;
    if (lo <= windowHi && hi >= windowLo) return true;
  }
  return false;
}

export function eventNearby(event, knownProvinces) {
  const known = knownProvinces instanceof Set ? knownProvinces : new Set(knownProvinces || []);
  const code = placeText(event?.region || event?.province_or_region);
  const regionLabel = placeText(event?.regionLabel);
  const filtered = code && known.has(code);
  const guides = [];
  if (overlaps(event, 1, 1, 31)) guides.push({ href: 'burns-night/', label: 'Burns Night guide' });
  if (overlaps(event, 11, 20, 30)) guides.push({ href: 'st-andrews-day/', label: "St Andrew's Day guide" });
  return {
    groupsPath: filtered ? `groups/${searchFromFilters({ province: code })}` : 'groups/',
    groupsLabel: filtered && regionLabel ? `Clubs and lessons in ${regionLabel}` : 'Clubs and lessons',
    guides,
  };
}
