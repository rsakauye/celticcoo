// Pure guard decisions for a small public site.
// The caller counts rows and passes them in. This file does not read D1.

import { clamp } from './text.js';

function monthDay(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now instanceof Date ? now : new Date(now));
  const pick = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

function inRange(month, day, start, end) {
  const value = month * 100 + day;
  const from = start[0] * 100 + start[1];
  const to = end[0] * 100 + end[1];
  if (from <= to) return value >= from && value <= to;
  return value >= from || value <= to;
}

export function seasonFor(now, seasons, timeZone) {
  const { month, day } = monthDay(now, timeZone);
  let best = null;
  for (const season of seasons || []) {
    if (!season || !inRange(month, day, season.start, season.end)) continue;
    if (!best || season.multiplier > best.multiplier) best = season;
  }
  return best;
}

// baseline is the rolling daily average. sameWeekLastYear, when it is a
// positive number, replaces that average. The result is always inside
// [floor, ceiling].
export function adaptiveLimit({
  baseline = 0,
  sameWeekLastYear = null,
  now = new Date(),
  seasons = [],
  timeZone = 'UTC',
  floor = 8,
  ceiling = 80,
  offSeasonMultiplier = 3,
} = {}) {
  const season = seasonFor(now, seasons, timeZone);
  const hasYear = Number.isFinite(sameWeekLastYear) && sameWeekLastYear > 0;
  const base = hasYear ? sameWeekLastYear : (Number.isFinite(baseline) ? baseline : 0);
  const multiplier = season ? season.multiplier : offSeasonMultiplier;
  const limit = clamp(Math.ceil(base * multiplier), floor, ceiling);
  return {
    limit,
    baseline: base,
    multiplier,
    season: season ? season.id : null,
    source: hasYear ? 'last_year' : 'rolling',
  };
}

function tokens(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
}

function jaccard(left, right) {
  if (!left.length || !right.length) return 0;
  const a = new Set(left);
  const b = new Set(right);
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  const union = a.size + b.size - shared;
  return union ? shared / union : 0;
}

export function looksGibberish(text) {
  const words = String(text || '').toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 8);
  if (words.length < 2) return false;
  const bad = words.filter((word) => (word.match(/[aeiou]/g) || []).length / word.length < 0.2);
  return bad.length / words.length >= 0.6;
}

function fieldKey(item) {
  if (item && item.fields) {
    const fields = item.fields;
    return [fields.when || '', fields.place || '', fields.act || ''].join('|').toLowerCase();
  }
  const text = String(item && item.text || '');
  const dates = text.match(/\d{1,2}\s+[a-z]+\s+\d{4}|[a-z]+\s+\d{1,2},?\s+\d{4}/gi) || [];
  const times = text.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi) || [];
  return `${dates.map((part) => part.toLowerCase()).sort().join(',')}#${times.map((part) => part.toLowerCase()).sort().join(',')}`;
}

function linkCount(item) {
  if (Number.isFinite(item && item.links)) return item.links;
  return (String(item && item.text || '').match(/https?:\/\//gi) || []).length;
}

// items are the messages in one short window. A bulk organizer burst is
// one sender or organization, with distinct details, and without the
// abuse signals below. The same template repeated with the same date,
// place, and act is a repeated payload, not a bulk request.
export function assessBurst(items, { minBurst = 4 } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (list.length < minBurst) return { kind: 'normal', reasons: [] };
  const n = list.length;
  const senders = new Map();
  const orgs = new Map();
  for (const item of list) {
    const sender = String(item && item.sender || '');
    const org = String(item && item.org || '');
    if (sender) senders.set(sender, (senders.get(sender) || 0) + 1);
    if (org) orgs.set(org, (orgs.get(org) || 0) + 1);
  }
  const top = (map) => Math.max(0, ...map.values());
  const consistent = top(senders) >= Math.ceil(n * 0.8) || (top(orgs) >= Math.ceil(n * 0.8) && top(orgs) >= minBurst);
  const authFail = list.filter((item) => item && (item.spf === 'fail' || item.dkim === 'fail')).length;
  const turnstileFail = list.filter((item) => item && item.turnstile === 'fail').length;
  const linky = list.filter((item) => linkCount(item) >= 3).length;
  const gibberish = list.filter((item) => item && (item.gibberish || looksGibberish(item.text))).length;
  const rotating = senders.size >= 5 && senders.size >= Math.ceil(n * 0.7);

  const keys = list.map(fieldKey);
  const bags = list.map((item) => tokens(item && item.text));
  let repeated = 0;
  const seen = new Set();
  for (let i = 0; i < n; i += 1) {
    if (seen.has(i)) continue;
    const group = [i];
    for (let j = i + 1; j < n; j += 1) {
      if (jaccard(bags[i], bags[j]) >= 0.82) group.push(j);
    }
    group.forEach((index) => seen.add(index));
    const sameFields = group.every((index) => keys[index] === keys[group[0]]);
    if (sameFields && group.length >= Math.ceil(n * 0.6)) repeated = group.length;
  }

  const reasons = [];
  if (rotating) reasons.push('rotating_senders');
  if (repeated) reasons.push('repeated_payload');
  if (gibberish / n >= 0.5) reasons.push('gibberish');
  if (linky / n >= 0.5) reasons.push('links');
  if (authFail / n >= 0.5) reasons.push('auth_fail');
  if (turnstileFail / n >= 0.5) reasons.push('turnstile_fail');
  if (reasons.length) return { kind: 'abuse', reasons };

  const distinctKeys = new Set(keys.filter(Boolean)).size;
  const structured = list.filter((item) => {
    const key = fieldKey(item);
    return key.replace(/[|#]/g, '').length > 0;
  }).length;
  if (consistent && distinctKeys >= Math.ceil(n * 0.5) && structured >= Math.ceil(n * 0.6)) {
    return { kind: 'bulk_organizer', reasons: ['consistent_sender', 'distinct_details'] };
  }
  return { kind: 'normal', reasons: [] };
}

// allow: process normally.
// hold: store it and leave it for a person. Do not send, and do not trip
// the kill switch. This is the degraded path for a seasonal rush and for
// a legit organizer burst.
// pause: hard stop. Clear abuse, or the outbound cost cap.
export function decideGuard({
  count = 0,
  limit = Infinity,
  burst = null,
  outboundToday = 0,
  outboundCap = Infinity,
} = {}) {
  if (Number.isFinite(outboundCap) && outboundToday >= outboundCap) {
    return { action: 'pause', reason: 'outbound_cap' };
  }
  if (burst && burst.kind === 'abuse') {
    return { action: 'pause', reason: 'abuse', abuse: burst.reasons || [] };
  }
  if (burst && burst.kind === 'bulk_organizer') {
    return { action: 'hold', reason: 'bulk_organizer' };
  }
  if (Number.isFinite(limit) && count > limit) {
    return { action: 'hold', reason: 'over_seasonal' };
  }
  return { action: 'allow', reason: 'ok' };
}

function countLinesOf(counts) {
  if (!counts || typeof counts !== 'object') return [];
  const lines = [];
  for (const [id, n] of Object.entries(counts)) {
    if (id === 'otherNote') continue;
    if (!/^[a-z0-9-]{1,40}$/.test(id)) continue;
    if (!Number.isInteger(n) || n <= 0 || n > 10000) continue;
    lines.push({ id, n });
  }
  return lines;
}

function sampleCountItems(lines, options, cap) {
  const items = [];
  const sender = String(options.sender || 'requester');
  const place = String(options.place || 'request');
  const when = String(options.when || '');
  for (const line of lines) {
    const take = Math.min(line.n, cap - items.length);
    for (let i = 1; i <= take; i += 1) {
      items.push({
        sender,
        text: `Head count ${line.id} number ${i} for a separate part of this request.`,
        fields: {
          when: when || `part-${line.id}-${i}`,
          place,
          act: `${line.id}-${i}`,
        },
        turnstile: 'pass',
        spf: 'unknown',
        dkim: 'unknown',
      });
    }
    if (items.length >= cap) break;
  }
  return items;
}

// One form that names enough performers is a bulk organizer request.
// The sample is passed through assessBurst and decideGuard. The result
// is hold, for a person to review. This path does not return pause:
// a lineup from one requester is stored, not rejected.
export function decidePerformerVolume(counts, options = {}) {
  const minBurst = Number.isFinite(options.minBurst) && options.minBurst > 0
    ? Math.floor(options.minBurst)
    : 4;
  const lines = countLinesOf(counts);
  const total = lines.reduce((sum, line) => sum + line.n, 0);
  if (total < minBurst) return { action: 'allow', reason: 'ok', total };
  const items = sampleCountItems(lines, options, Math.max(minBurst, 8));
  const burst = assessBurst(items, { minBurst });
  const decision = decideGuard({
    count: total,
    limit: Infinity,
    burst: burst.kind === 'bulk_organizer' ? burst : { kind: 'bulk_organizer', reasons: ['consistent_sender', 'distinct_details'] },
    outboundToday: 0,
    outboundCap: Infinity,
  });
  return {
    action: 'hold',
    reason: decision.action === 'hold' ? decision.reason : 'bulk_organizer',
    total,
  };
}
