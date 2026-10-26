// D1-backed intake guard. The decisions themselves are in breaker.js.
// This file names tables and columns. It does not know a site's phrases,
// and it does not log message bodies, addresses, or IP addresses.
//
// The control row lives in intake_control. Apply site/migrations/0004_intake_guard.sql
// by hand before relying on the switch. If that table is missing, every
// check returns allow so a deploy cannot take the mailbox down by itself.

import { adaptiveLimit, assessBurst, decideTraffic, hourlyLimit } from './breaker.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const SQL = {
  read: `-- q:read
SELECT id, manual_pause, latch, pause_reason, paused_until, alerted_at,
  outbound_day, outbound_count, limit_per_day, limit_source, limit_season, limit_computed_at
FROM intake_control WHERE id = ?`,
  countSub: `-- q:count_sub
SELECT count(*) AS n FROM submissions WHERE created_at >= ?`,
  countIn: `-- q:count_in
SELECT count(*) AS n FROM inbound_emails WHERE created_at >= ?`,
  countSenderSub: `-- q:count_sender_sub
SELECT count(*) AS n FROM submissions WHERE created_at >= ? AND email = ?`,
  countSenderIn: `-- q:count_sender_in
SELECT count(*) AS n FROM inbound_emails WHERE created_at >= ? AND envelope_from = ?`,
  countIp: `-- q:count_ip
SELECT count(*) AS n FROM submissions WHERE created_at >= ? AND client_hash = ?`,
  countTurnstile: `-- q:count_turnstile
SELECT count(*) AS n FROM submission_failures WHERE created_at >= ? AND reason LIKE 'turnstile%'`,
  recentSub: `-- q:recent_sub
SELECT email, name, message, events_json, custom_event_json, performers_json, created_at, client_hash
FROM submissions WHERE created_at >= ? ORDER BY created_at DESC LIMIT 30`,
  recentIn: `-- q:recent_in
SELECT envelope_from, subject, text_body, extracted_json, created_at, auth_spf, auth_dkim
FROM inbound_emails WHERE created_at >= ? ORDER BY created_at DESC LIMIT 30`,
  recentInPlain: `-- q:recent_in_plain
SELECT envelope_from, subject, text_body, extracted_json, created_at
FROM inbound_emails WHERE created_at >= ? ORDER BY created_at DESC LIMIT 30`,
  historySub: `-- q:history_sub
SELECT substr(created_at, 1, 10) AS day, count(*) AS n
FROM submissions WHERE created_at >= ? GROUP BY day`,
  historyIn: `-- q:history_in
SELECT substr(created_at, 1, 10) AS day, count(*) AS n
FROM inbound_emails WHERE created_at >= ? GROUP BY day`,
  saveLimit: `-- q:save_limit
UPDATE intake_control
SET limit_per_day = ?, limit_source = ?, limit_season = ?, limit_computed_at = ?, updated_at = ?
WHERE id = 'singleton'`,
  latch: `-- q:latch
UPDATE intake_control
SET latch = 'severe', pause_reason = ?, updated_at = ?
WHERE id = 'singleton' AND manual_pause = 0 AND latch = ''`,
  alert: `-- q:alert
UPDATE intake_control
SET alerted_at = ?
WHERE id = 'singleton' AND (alerted_at = '' OR alerted_at < ?)`,
  pauseOn: `-- q:pause_on
UPDATE intake_control
SET manual_pause = 1, latch = 'manual', pause_reason = 'manual', paused_until = '', updated_at = ?
WHERE id = 'singleton'`,
  pauseOff: `-- q:pause_off
UPDATE intake_control
SET manual_pause = 0, latch = '', pause_reason = '', paused_until = '', updated_at = ?
WHERE id = 'singleton'`,
  outbound: `-- q:outbound
UPDATE intake_control
SET outbound_day = ?, outbound_count = ?, updated_at = ?
WHERE id = 'singleton'`,
};

const FREE_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'yahoo.com', 'yahoo.ca', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
]);

function dbReady(db) {
  return Boolean(db && typeof db.prepare === 'function');
}

async function first(db, sql, ...args) {
  return db.prepare(sql).bind(...args).first();
}

async function allRows(db, sql, ...args) {
  const result = await db.prepare(sql).bind(...args).all();
  if (Array.isArray(result)) return result;
  return (result && result.results) || [];
}

function changesOf(result) {
  const n = result && result.meta && result.meta.changes;
  return Number(n) || 0;
}

function num(env, key, fallback) {
  if (!env || env[key] == null || String(env[key]).trim() === '') return fallback;
  const n = Number(env[key]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function resolveGuardConfig(siteGuard = {}, env = {}) {
  const guard = siteGuard || {};
  return {
    timeZone: guard.timeZone || 'UTC',
    seasons: guard.seasons || [],
    offSeasonMultiplier: num(env, 'GUARD_OFF_SEASON_MULTIPLIER', guard.offSeasonMultiplier ?? 3),
    floorPerDay: num(env, 'GUARD_FLOOR_PER_DAY', guard.floorPerDay ?? 8),
    ceilingPerDay: num(env, 'GUARD_CEILING_PER_DAY', guard.ceilingPerDay ?? 80),
    outboundDailyCap: num(env, 'OUTBOUND_DAILY_CAP', guard.outboundDailyCap ?? 40),
    minBurst: num(env, 'GUARD_MIN_BURST', guard.minBurst ?? 4),
    hourlyFloor: num(env, 'GUARD_HOURLY_FLOOR', 6),
    hourlyCeiling: num(env, 'GUARD_HOURLY_CEILING', 24),
    senderHourly: num(env, 'GUARD_SENDER_HOURLY', 8),
    ipHourly: num(env, 'GUARD_IP_HOURLY', 10),
    alertDebounceMinutes: num(env, 'GUARD_ALERT_DEBOUNCE_MINUTES', 360),
    historyCacheMinutes: num(env, 'GUARD_HISTORY_CACHE_MINUTES', 360),
  };
}

export function localDay(now, timeZone) {
  const date = now instanceof Date ? now : new Date(now);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function shiftDay(day, delta) {
  const [year, month, date] = String(day).split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return utc.toISOString().slice(0, 10);
}

function startOfLocalDay(now, timeZone) {
  const day = localDay(now, timeZone);
  // Compare created_at as UTC ISO strings. The local midnight converted to
  // UTC is the start of the count. A fixed offset is enough for a daily cap;
  // the timezone database is used only to pick the civil day, then we walk
  // back until localDay matches.
  let cursor = new Date(now instanceof Date ? now.getTime() : Date.parse(now));
  cursor.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 30; i += 1) {
    if (localDay(cursor, timeZone) !== day) break;
    cursor = new Date(cursor.getTime() - HOUR_MS);
  }
  return new Date(cursor.getTime() + HOUR_MS).toISOString();
}

export function orgFromEmail(email) {
  const domain = String(email || '').split('@')[1] || '';
  const host = domain.trim().toLowerCase();
  if (!host || FREE_DOMAINS.has(host)) return '';
  return host;
}

export async function clientHash(ip) {
  const raw = String(ip || '').trim();
  if (!raw || raw.length > 80 || /\s/.test(raw)) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`coo-ip-v1|${raw}`));
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalize(row) {
  return {
    ready: true,
    manual: Number(row.manual_pause) === 1,
    latch: String(row.latch || ''),
    pauseReason: String(row.pause_reason || ''),
    pausedUntil: String(row.paused_until || ''),
    alertedAt: String(row.alerted_at || ''),
    outboundDay: String(row.outbound_day || ''),
    outboundCount: Number(row.outbound_count) || 0,
    limitPerDay: Number(row.limit_per_day) || 0,
    limitSource: String(row.limit_source || ''),
    limitSeason: String(row.limit_season || ''),
    limitComputedAt: String(row.limit_computed_at || ''),
  };
}

export async function readControl(db) {
  if (!dbReady(db)) return { ready: false };
  try {
    const row = await first(db, SQL.read, 'singleton');
    if (!row || !Object.prototype.hasOwnProperty.call(row, 'manual_pause')) return { ready: false };
    return normalize(row);
  } catch {
    return { ready: false };
  }
}

export function alertBody(decision, channel) {
  const action = decision && decision.action === 'pause' ? 'pause' : 'hold';
  const reason = String(decision && decision.reason || 'ok').replace(/[^a-z0-9_]/g, '').slice(0, 40) || 'ok';
  const where = channel === 'inbound' ? 'inbound' : 'form';
  const lines = [
    'Celtic Coo intake guard.',
    `Channel: ${where}`,
    `Action: ${action}`,
    `Reason: ${reason}`,
  ];
  if (action === 'pause') {
    lines.push('New form posts and mailbox deliveries are stored without sending. Reset the cutoff switch to resume.');
  } else {
    lines.push('Messages are stored for review. The kill switch was not tripped. Automatic notices are not being sent.');
  }
  return lines.join('\n');
}

function countOf(row) {
  return Number(row && row.n) || 0;
}

async function countOptional(db, sql, ...args) {
  try {
    return countOf(await first(db, sql, ...args));
  } catch {
    return 0;
  }
}

function mergeDays(lists) {
  const days = new Map();
  for (const list of lists) {
    for (const row of list || []) {
      const day = String(row.day || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      days.set(day, (days.get(day) || 0) + (Number(row.n) || 0));
    }
  }
  return days;
}

export function baselineFromDays(dayCounts, now, timeZone) {
  const today = localDay(now, timeZone);
  const lastYear = shiftDay(today, -364);
  const yearCount = dayCounts.get(lastYear) || 0;
  if (yearCount > 0) return { baseline: yearCount, sameWeekLastYear: yearCount };
  let sum = 0;
  for (let i = 1; i <= 28; i += 1) sum += dayCounts.get(shiftDay(today, -i)) || 0;
  return { baseline: sum / 28, sameWeekLastYear: null };
}

function limitFresh(control, now, minutes) {
  if (!control.limitPerDay || !control.limitComputedAt) return false;
  const then = Date.parse(control.limitComputedAt);
  if (!Number.isFinite(then)) return false;
  return now.getTime() - then < minutes * 60 * 1000;
}

async function dailyLimit(db, control, config, now) {
  if (limitFresh(control, now, config.historyCacheMinutes)) {
    return {
      limit: control.limitPerDay,
      source: control.limitSource || 'cache',
      season: control.limitSeason || null,
    };
  }
  let days = new Map();
  try {
    const since = new Date(now.getTime() - 400 * DAY_MS).toISOString();
    const [subs, inbound] = await Promise.all([
      allRows(db, SQL.historySub, since),
      allRows(db, SQL.historyIn, since),
    ]);
    days = mergeDays([subs, inbound]);
  } catch {
    days = new Map();
  }
  const base = baselineFromDays(days, now, config.timeZone);
  const adaptive = adaptiveLimit({
    baseline: base.baseline,
    sameWeekLastYear: base.sameWeekLastYear,
    now,
    seasons: config.seasons,
    timeZone: config.timeZone,
    floor: config.floorPerDay,
    ceiling: config.ceilingPerDay,
    offSeasonMultiplier: config.offSeasonMultiplier,
  });
  const stamp = now.toISOString();
  try {
    await db.prepare(SQL.saveLimit).bind(
      adaptive.limit,
      adaptive.source,
      adaptive.season || '',
      stamp,
      stamp,
    ).run();
  } catch { /* the decision still uses the number just computed */ }
  return { limit: adaptive.limit, source: adaptive.source, season: adaptive.season };
}

function clip(value) {
  return String(value || '').slice(0, 2000);
}

function formFields(row) {
  let events = [];
  let custom = {};
  let performers = [];
  try { events = JSON.parse(row.events_json || '[]'); } catch { events = []; }
  try { custom = JSON.parse(row.custom_event_json || '{}') || {}; } catch { custom = {}; }
  try { performers = JSON.parse(row.performers_json || '[]'); } catch { performers = []; }
  const when = [custom.date, ...(Array.isArray(events) ? events.map((event) => event && event.when) : [])].filter(Boolean).join(';');
  const place = [custom.city || custom.venue, ...(Array.isArray(events) ? events.map((event) => event && (event.city || event.venue)) : [])].filter(Boolean).join(';');
  const act = (Array.isArray(performers) ? performers : []).join(',');
  return { when, place, act };
}

function formItem(row) {
  return {
    sender: String(row.email || ''),
    org: orgFromEmail(row.email),
    text: clip(row.message),
    fields: formFields(row),
    turnstile: 'pass',
    spf: 'unknown',
    dkim: 'unknown',
  };
}

function inboundItem(row) {
  let fields = null;
  try {
    const event = JSON.parse(row.extracted_json || '{}');
    if (event && typeof event === 'object') {
      fields = { when: event.date || '', place: event.city || event.venue || '', act: event.title || '' };
    }
  } catch { fields = null; }
  return {
    sender: String(row.envelope_from || ''),
    org: orgFromEmail(row.envelope_from),
    text: clip(`${row.subject || ''}\n${row.text_body || ''}`),
    fields,
    turnstile: 'unknown',
    spf: row.auth_spf || 'unknown',
    dkim: row.auth_dkim || 'unknown',
  };
}

async function claimAlert(db, now, debounceMinutes) {
  const stamp = now.toISOString();
  const cutoff = new Date(now.getTime() - debounceMinutes * 60 * 1000).toISOString();
  try {
    const result = await db.prepare(SQL.alert).bind(stamp, cutoff).run();
    return changesOf(result) >= 1;
  } catch {
    return false;
  }
}

async function latchSevere(db, reason, now) {
  try {
    await db.prepare(SQL.latch).bind(String(reason || 'abuse').slice(0, 40), now.toISOString()).run();
  } catch { /* a later request will try again */ }
}

function allow(reason = 'guard_unavailable') {
  return { action: 'allow', reason, latch: '', alert: false, limit: null };
}

export async function setPaused(db, paused, now = new Date()) {
  const control = await readControl(db);
  if (!control.ready) return { ok: false, code: 'guard_not_ready' };
  const stamp = (now instanceof Date ? now : new Date(now)).toISOString();
  await db.prepare(paused ? SQL.pauseOn : SQL.pauseOff).bind(stamp).run();
  const next = await readControl(db);
  return {
    ok: true,
    paused: Boolean(next.manual || next.latch === 'severe' || next.latch === 'manual'),
    reason: next.pauseReason || '',
    latch: next.latch || '',
  };
}

export async function noteOutbound(db, now = new Date(), timeZone = 'UTC') {
  const control = await readControl(db);
  if (!control.ready) return 0;
  const day = localDay(now, timeZone);
  const count = control.outboundDay === day ? control.outboundCount + 1 : 1;
  try {
    await db.prepare(SQL.outbound).bind(day, count, (now instanceof Date ? now : new Date(now)).toISOString()).run();
  } catch { /* the send already happened */ }
  return count;
}

function currentItem(input) {
  return {
    sender: String(input.sender || ''),
    org: input.org || orgFromEmail(input.sender),
    text: clip(input.text),
    fields: input.fields || null,
    turnstile: input.turnstile || 'unknown',
    spf: input.spf || 'unknown',
    dkim: input.dkim || 'unknown',
    links: Number.isFinite(input.links) ? input.links : undefined,
  };
}

// channel is 'form', 'inbound', or 'peek'.
// peek only reports a latched or manual pause. It does not count or alert.
export async function assessChannel(db, input = {}) {
  const config = input.config || resolveGuardConfig();
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const control = await readControl(db);
  if (!control.ready) return allow();
  if (input.phase === 'peek' || input.channel === 'peek') {
    if (control.manual) return { action: 'pause', reason: 'manual', latch: 'manual', alert: false, limit: null };
    if (control.latch === 'severe' || control.latch === 'manual') {
      return { action: 'pause', reason: control.pauseReason || 'latched', latch: control.latch, alert: false, limit: null };
    }
    return { action: 'allow', reason: 'open', latch: '', alert: false, limit: null };
  }
  if (control.manual || control.latch === 'manual') {
    return { action: 'pause', reason: 'manual', latch: 'manual', alert: false, limit: null };
  }
  if (control.latch === 'severe') {
    return { action: 'pause', reason: control.pauseReason || 'latched', latch: 'severe', alert: false, limit: null };
  }

  const channel = input.channel === 'inbound' ? 'inbound' : 'form';
  const hourSince = new Date(now.getTime() - HOUR_MS).toISOString();
  const daySince = startOfLocalDay(now, config.timeZone);
  const sender = String(input.sender || '');
  let storedHour = 0;
  let storedToday = 0;
  let storedSender = 0;
  let storedIp = 0;
  let turnstileFails = 0;
  try {
    const [subHour, inHour, subToday, inToday] = await Promise.all([
      first(db, SQL.countSub, hourSince),
      first(db, SQL.countIn, hourSince),
      first(db, SQL.countSub, daySince),
      first(db, SQL.countIn, daySince),
    ]);
    storedHour = countOf(subHour) + countOf(inHour);
    storedToday = countOf(subToday) + countOf(inToday);
    if (sender) {
      const senderRow = channel === 'inbound'
        ? await first(db, SQL.countSenderIn, hourSince, sender)
        : await first(db, SQL.countSenderSub, hourSince, sender);
      storedSender = countOf(senderRow);
    }
    if (channel === 'form' && input.ipHash) {
      storedIp = await countOptional(db, SQL.countIp, hourSince, input.ipHash);
    }
    if (channel === 'form') turnstileFails = await countOptional(db, SQL.countTurnstile, hourSince);
  } catch {
    return allow();
  }

  const includeCurrent = input.turnstile !== 'fail';
  const hourCount = storedHour + (includeCurrent ? 1 : 0);
  const todayCount = storedToday + (includeCurrent ? 1 : 0);
  const senderCount = sender ? storedSender + (includeCurrent ? 1 : 0) : 0;
  const ipCount = input.ipHash ? storedIp + (channel === 'form' && includeCurrent ? 1 : 0) : 0;
  const limitInfo = await dailyLimit(db, control, config, now);
  const hourCap = hourlyLimit(limitInfo.limit, { floor: config.hourlyFloor, ceiling: config.hourlyCeiling });
  const outboundToday = control.outboundDay === localDay(now, config.timeZone) ? control.outboundCount : 0;

  let burst = null;
  const busy = hourCount >= config.minBurst || senderCount >= config.minBurst || ipCount >= config.minBurst || turnstileFails >= config.minBurst;
  if (busy) {
    let items = [];
    try {
      if (channel === 'form') {
        const rows = await allRows(db, SQL.recentSub, hourSince);
        items = rows.map(formItem);
      } else {
        let rows = [];
        try {
          rows = await allRows(db, SQL.recentIn, hourSince);
        } catch {
          rows = await allRows(db, SQL.recentInPlain, hourSince);
        }
        items = rows.map(inboundItem);
      }
    } catch {
      items = [];
    }
    if (includeCurrent) items.push(currentItem({ ...input, channel }));
    const fails = Math.min(turnstileFails, 30);
    for (let i = 0; i < fails; i += 1) items.push({ sender: '', text: '', turnstile: 'fail', spf: 'unknown', dkim: 'unknown' });
    burst = assessBurst(items, { minBurst: config.minBurst });
  }

  const decision = decideTraffic({
    manual: false,
    latched: false,
    outboundToday,
    outboundCap: config.outboundDailyCap,
    burst,
    todayCount,
    dailyLimit: limitInfo.limit,
    hourCount,
    hourLimit: hourCap,
    senderCount: sender ? senderCount : 0,
    senderLimit: sender ? config.senderHourly : Infinity,
    ipCount: input.ipHash ? ipCount : 0,
    ipLimit: input.ipHash ? config.ipHourly : Infinity,
  });
  if (decision.latch === 'severe') await latchSevere(db, decision.reason, now);
  const alert = decision.action === 'pause' || decision.action === 'hold'
    ? await claimAlert(db, now, config.alertDebounceMinutes)
    : false;
  return { ...decision, alert, limit: limitInfo.limit, hourLimit: hourCap };
}
