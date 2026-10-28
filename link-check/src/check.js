import { slugify } from './slug.js';
import { sanitizeUrl } from './urls.js';
import { classifyOutcome } from './classify.js';
import { probeUrl } from './probe.js';
import { isoDateInTimeZone } from './dates.js';

export async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Math.max(1, Math.min(limit, items.length));
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export function assignId(raw, config, used) {
  if (raw == null || String(raw).trim() === '') return null;
  let id = config.idMode === 'slug' ? slugify(String(raw)) : String(raw).trim();
  if (!id) return null;
  if (!used.has(id)) {
    used.add(id);
    return id;
  }
  let n = 2;
  while (used.has(`${id}-${n}`)) n += 1;
  id = `${id}-${n}`;
  used.add(id);
  return id;
}

function labelOf(record, config, id) {
  const value = record?.[config.labelField];
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200);
  return id;
}

function urlOf(record, config) {
  const value = record?.[config.urlField];
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 500);
}

function entryFromProbe(job, probe, checkedOn, config) {
  const classified = classifyOutcome(probe, { unverifiableHosts: config.unverifiableHosts });
  const storedUrl = sanitizeUrl(job.url) || job.url;
  return {
    id: job.id,
    label: job.label,
    url: storedUrl,
    last_checked: checkedOn,
    last_status: classified.last_status,
    final_url: classified.final_url,
    detail: classified.detail,
  };
}

export function readStatus(raw) {
  if (!raw || typeof raw !== 'object') return { schema: 1, checked_on: null, entries: [] };
  return {
    schema: raw.schema ?? 1,
    checked_on: typeof raw.checked_on === 'string' && raw.checked_on ? raw.checked_on : null,
    entries: Array.isArray(raw.entries) ? raw.entries : [],
  };
}

export function serializeStatus(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function summarize(entries) {
  const counts = { ok: 0, redirect: 0, broken: 0, unreachable: 0, unverifiable: 0 };
  for (const entry of entries) {
    if (Object.prototype.hasOwnProperty.call(counts, entry.last_status)) counts[entry.last_status] += 1;
  }
  return { total: entries.length, ...counts };
}

// Status, final URL, or the directory URL. last_checked alone is not a change.
export function meaningfulChanges(previous, next) {
  const prev = new Map((previous?.entries || []).map((entry) => [entry.id, entry]));
  const nextIds = new Set((next?.entries || []).map((entry) => entry.id));
  const changes = [];
  for (const entry of next?.entries || []) {
    const old = prev.get(entry.id);
    if (!old) {
      changes.push({ id: entry.id, label: entry.label, change: 'added', to: entry.last_status, url: entry.url, final_url: entry.final_url });
      continue;
    }
    const sameStatus = old.last_status === entry.last_status;
    const sameFinal = (old.final_url || null) === (entry.final_url || null);
    const sameUrl = (old.url || '') === (entry.url || '');
    if (!sameStatus || !sameFinal || !sameUrl) {
      changes.push({
        id: entry.id,
        label: entry.label,
        change: 'updated',
        from: old.last_status,
        to: entry.last_status,
        url: entry.url,
        final_url: entry.final_url,
      });
    }
  }
  for (const old of previous?.entries || []) {
    if (!nextIds.has(old.id)) {
      changes.push({ id: old.id, label: old.label, change: 'removed', from: old.last_status, url: old.url });
    }
  }
  return changes;
}

export async function runCheck({ records, config, fetchImpl, now = new Date(), limit = null, probe = probeUrl }) {
  if (!Array.isArray(records)) throw new Error('records must be an array');
  const snapshot = JSON.stringify(records);
  const checkedOn = isoDateInTimeZone(now, config.timeZone);
  const used = new Set();
  let jobs = records.map((record) => {
    let id = assignId(record?.[config.idField], config, used);
    const missingId = !id;
    if (!id) {
      let n = 1;
      while (used.has(`missing-id-${n}`)) n += 1;
      id = `missing-id-${n}`;
      used.add(id);
    }
    return {
      record,
      id,
      label: labelOf(record, config, id),
      url: urlOf(record, config),
      missingId,
    };
  });
  if (limit != null) jobs = jobs.slice(0, limit);
  const delayMs = config.delayMs || 0;
  const entries = await mapPool(jobs, config.concurrency, async (job) => {
    if (job.missingId) {
      return entryFromProbe(job, {
        url: job.url, status: null, finalUrl: null, redirectCodes: [], error: 'missing-id',
      }, checkedOn, config);
    }
    let outcome;
    try {
      outcome = await probe(job.url, {
        fetchImpl,
        timeoutMs: config.timeoutMs,
        userAgent: config.userAgent,
        unverifiableHosts: config.unverifiableHosts,
      });
    } catch {
      // One bad record must not discard the rest of the run, and must not set checked_on early.
      outcome = { url: job.url, status: null, finalUrl: null, redirectCodes: [], error: 'network' };
    }
    const entry = entryFromProbe(job, outcome, checkedOn, config);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return entry;
  });
  if (JSON.stringify(records) !== snapshot) {
    throw new Error('Checker mutated the source records');
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  const document = { schema: 1, checked_on: checkedOn, entries };
  return { document, summary: summarize(entries) };
}
