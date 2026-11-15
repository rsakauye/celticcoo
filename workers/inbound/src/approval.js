// Machine API for approving a clarifying draft from chat.
// The bearer token is APPROVAL_API_TOKEN. It is a Worker secret.
// GET never sends. Approve and deny are POSTs. The worker is the only sender.
// A trust score is not read here. No score can approve a draft by itself.

import { applyReview } from './review.js';
import { EXHIBITOR_CATEGORY, STATUSES, exhibitorView, loadExhibitor, setExhibitorStatus } from './exhibitor.js';
import { createInterestedCard } from './trello.js';
import { codeOf, oneLine } from './text.js';

const QUEUE_LIMIT = 20;
const EXCERPT_LIMIT = 180;
const BODY_LIMIT = 16000;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;

const QUEUE_SQL = `SELECT id, category, trust_score, trust_reasons, missing_fields, red_flags,
  from_header, reply_to, envelope_from, subject, text_body, clarify_draft, created_at
FROM inbound_emails
WHERE clarify_status = 'pending_approval' AND clarify_draft != ''
ORDER BY created_at ASC
LIMIT ?`;

const AUDIT_COUNT_SQL = `SELECT COUNT(*) AS n FROM approval_audit WHERE created_at > ?`;

const AUDIT_INSERT_SQL = `INSERT INTO approval_audit (
  id, created_at, actor, action, inbound_email_id, outcome, detail
) VALUES (?, ?, ?, ?, ?, ?, ?)`;

const NO_STORE = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...NO_STORE, 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

function fixedEqual(left, right) {
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  if (a.length !== b.length) return false;
  if (typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function approvalToken(env) {
  const secret = String(env && env.APPROVAL_API_TOKEN || '');
  if (secret.length < 16 || secret.length > 200 || /\s/.test(secret)) return '';
  return secret;
}

function presentedBearer(header) {
  const text = String(header || '').slice(0, 280);
  const match = /^Bearer ([A-Za-z0-9._~+/-]{1,200})$/.exec(text);
  return match ? match[1] : '';
}

export async function bearerMatches(expected, header) {
  const presented = presentedBearer(header);
  const enc = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(expected || ''))),
    crypto.subtle.digest('SHA-256', enc.encode(presented)),
  ]);
  const equal = fixedEqual(left, right);
  return Boolean(expected && presented && equal);
}

function senderDisplay(row) {
  const header = oneLine(row && row.from_header, 300);
  const named = header.match(/^\s*"?([^"<]+?)"?\s*</);
  if (named && named[1].trim()) return oneLine(named[1], 120);
  const address = oneLine(row && (row.reply_to || row.envelope_from), 200);
  return address || 'Unknown sender';
}

function excerpt(value) {
  const line = oneLine(value, EXCERPT_LIMIT + 1);
  if (line.length <= EXCERPT_LIMIT) return line;
  return `${line.slice(0, EXCERPT_LIMIT - 1).trim()}…`;
}

function reasonsOf(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((reason) => reason && /^[a-z0-9_]{1,40}$/.test(String(reason.code || '')));
  } catch {
    return [];
  }
}

function missingOf(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((field) => /^(date|time|venue|booking|event|deadline|apply_link|booth_cost|setup)$/.test(String(field)));
  } catch {
    return [];
  }
}

function flagsOf(value) {
  const flags = {
    minor_mentioned: false,
    links_present: false,
    payment_request: false,
    bot_instruction_attempt: false,
  };
  try {
    const parsed = JSON.parse(String(value || '{}'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return flags;
    for (const key of Object.keys(flags)) flags[key] = Boolean(parsed[key]);
  } catch { /* a bad column is advisory and empty */ }
  return flags;
}

function queueItem(row) {
  const score = Number(row.trust_score);
  return {
    id: row.id,
    category: row.category || 'other',
    trust_score: Number.isInteger(score) ? score : 0,
    trust_reasons: reasonsOf(row.trust_reasons),
    missing_fields: missingOf(row.missing_fields),
    red_flags: flagsOf(row.red_flags),
    sender_display: senderDisplay(row),
    subject: oneLine(row.subject, 180),
    excerpt: excerpt(row.text_body),
    draft: String(row.clarify_draft || ''),
  };
}

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

function routeOf(pathname, method) {
  if (pathname === '/api/queue' && method === 'GET') return { action: 'queue' };
  const status = new RegExp(`^/api/exhibitors/${UUID}/status$`, 'i').exec(pathname);
  if (status) {
    if (method !== 'POST') return { action: 'method', id: status[1], intended: 'exhibitor_status' };
    return { action: 'exhibitor_status', id: status[1].toLowerCase() };
  }
  const match = /^\/api\/drafts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|deny)$/i.exec(pathname);
  if (!match) return null;
  if (method !== 'POST') return { action: 'method', id: match[1], intended: match[2] };
  return { action: match[2], id: match[1].toLowerCase() };
}

async function readJson(request) {
  if (request.method === 'GET') return { text: null };
  const raw = await request.text();
  if (!raw) return { text: null };
  if (raw.length > BODY_LIMIT) return { error: 'too_large' };
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'bad_json' };
    if (!Object.prototype.hasOwnProperty.call(body, 'text')) return { text: null };
    if (typeof body.text !== 'string') return { error: 'bad_json' };
    return { text: body.text };
  } catch {
    return { error: 'bad_json' };
  }
}

async function audit(db, row) {
  await db.prepare(AUDIT_INSERT_SQL).bind(
    row.id,
    row.createdAt,
    row.actor,
    row.action,
    row.inboundEmailId || '',
    row.outcome,
    row.detail || '',
  ).run();
}

function outcomeOf(result) {
  if (!result) return 'error';
  if (result.code === 'sent') return 'sent';
  if (result.code === 'already_sent') return 'already_sent';
  if (result.code === 'discarded') return 'denied';
  if (result.code === 'busy') return 'busy';
  if (result.code === 'draft_placeholder') return 'draft_placeholder';
  if (result.code === 'clarify_draft_blocked') return 'blocked';
  if (result.code === 'not_found') return 'not_found';
  if (GUARD_CODES.has(result.code)) return result.code;
  return 'error';
}

const GUARD_CODES = new Set(['guard_paused', 'outbound_cap', 'guard_unavailable', 'outbound_unknown', 'clarify_off', 'guard_hold', 'volume_unknown']);

export async function handleApprovalApi(request, env, deps = {}) {
  const url = new URL(request.url);
  const onApi = url.pathname === '/api/queue' || url.pathname.startsWith('/api/drafts/') || url.pathname.startsWith('/api/exhibitors/');
  if (!onApi) return json(404, { ok: false, error: 'not_found' });
  const db = env && env.INTAKE_DB;
  if (!db || typeof db.prepare !== 'function') return json(503, { ok: false, error: 'not_configured' });
  const secret = approvalToken(env);
  if (!secret) return json(503, { ok: false, error: 'not_configured' });

  const now = deps.now ? deps.now() : new Date();
  const nowIso = now.toISOString();
  const route = routeOf(url.pathname, request.method) || { action: 'unknown' };
  let authed = false;
  try {
    authed = await bearerMatches(secret, request.headers.get('authorization'));
  } catch {
    authed = false;
  }

  let limited = false;
  try {
    const windowStart = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();
    const countRow = await db.prepare(AUDIT_COUNT_SQL).bind(windowStart).first();
    const limit = Number.isInteger(deps.rateLimit) && deps.rateLimit > 0 ? deps.rateLimit : RATE_LIMIT;
    limited = countOf(countRow && countRow.n) >= limit;
  } catch (err) {
    console.error(JSON.stringify({ message: 'inbound approval rate failed', code: codeOf(err) }));
    return json(503, { ok: false, error: 'not_configured' });
  }

  const actor = authed ? 'chat' : 'rejected';
  const action = route.action === 'method' ? route.intended : route.action;
  const record = async (outcome, detail = '') => {
    try {
      await audit(db, {
        id: crypto.randomUUID(),
        createdAt: nowIso,
        actor,
        action: action || 'unknown',
        inboundEmailId: route.id || '',
        outcome,
        detail,
      });
    } catch (err) {
      console.error(JSON.stringify({ message: 'inbound approval audit failed', code: codeOf(err) }));
    }
  };

  if (limited) {
    await record('rate_limited');
    return json(429, { ok: false, error: 'rate_limited' });
  }
  if (!authed) {
    await record('unauthorized');
    return json(401, { ok: false, error: 'unauthorized' });
  }
  if (route.action === 'method' || route.action === 'unknown') {
    await record('method_not_allowed');
    return json(405, { ok: false, error: 'method_not_allowed' }, { allow: route.action === 'method' ? 'POST' : 'GET, POST' });
  }

  if (route.action === 'queue') {
    let rows = [];
    try {
      const listed = await db.prepare(QUEUE_SQL).bind(QUEUE_LIMIT).all();
      rows = listed && Array.isArray(listed.results) ? listed.results : [];
    } catch (err) {
      console.error(JSON.stringify({ message: 'inbound approval queue failed', code: codeOf(err) }));
      await record('error', 'queue_failed');
      return json(503, { ok: false, error: 'queue_failed' });
    }
    const drafts = [];
    for (const row of rows) {
      const item = queueItem(row);
      // Exhibitor rows carry the private field table for the queue owner.
      if (row.category === EXHIBITOR_CATEGORY) item.exhibitor = exhibitorView(await loadExhibitor(db, row.id));
      drafts.push(item);
    }
    await record('ok');
    return json(200, { ok: true, drafts });
  }

  if (route.action === 'exhibitor_status') {
    let status = '';
    try {
      const raw = await request.text();
      if (raw.length > BODY_LIMIT) throw new Error('too_large');
      const body = JSON.parse(raw || '{}');
      status = body && typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
    } catch {
      status = '';
    }
    if (!STATUSES.includes(status) || status === 'new') {
      await record('bad_status');
      return json(400, { ok: false, error: 'bad_status' });
    }
    const current = await loadExhibitor(db, route.id);
    if (!current) {
      await record('not_found');
      return json(404, { ok: false, error: 'not_found' });
    }
    const changed = await setExhibitorStatus(db, route.id, status, now);
    if (!changed) {
      await record('error', 'status_failed');
      return json(503, { ok: false, error: 'status_failed' });
    }
    let trello = { status: 'skipped', reason: '' };
    if (status === 'interested' && current.status !== 'interested') {
      trello = await createInterestedCard(env, exhibitorView({ ...current, status }), route.id, deps);
    }
    await record('ok', `status:${status}:trello_${trello.status}`);
    return json(200, { ok: true, id: route.id, status, trello: trello.status });
  }

  const fields = await readJson(request);
  if (fields.error) {
    await record(fields.error);
    return json(fields.error === 'too_large' ? 413 : 400, { ok: false, error: fields.error });
  }

  if (route.action === 'deny') {
    const existing = await db.prepare(
      'SELECT id, clarify_status FROM inbound_emails WHERE id = ?',
    ).bind(route.id).first();
    if (!existing) {
      await record('not_found');
      return json(404, { ok: false, error: 'not_found' });
    }
    if (existing.clarify_status === 'discarded') {
      await record('already_denied');
      return json(200, { ok: true, status: 'already_denied', id: route.id });
    }
    if (existing.clarify_status === 'sent') {
      await record('already_sent');
      return json(200, { ok: true, status: 'already_sent', id: route.id });
    }
  }

  if (route.action === 'approve') {
    const existing = await db.prepare(
      'SELECT id, clarify_status FROM inbound_emails WHERE id = ?',
    ).bind(route.id).first();
    if (existing && existing.clarify_status === 'sent') {
      await record('already_sent');
      return json(200, { ok: true, status: 'already_sent', id: route.id });
    }
  }

  const result = await applyReview({
    env,
    fields: {
      action: route.action === 'deny' ? 'deny' : 'approve',
      inboundId: route.id,
      draft: fields.text,
    },
    deps,
  });
  const outcome = outcomeOf(result);
  await record(outcome);
  if (outcome === 'sent') return json(200, { ok: true, status: 'sent', id: route.id });
  if (outcome === 'already_sent') return json(200, { ok: true, status: 'already_sent', id: route.id });
  if (outcome === 'denied') return json(200, { ok: true, status: 'denied', id: route.id });
  if (outcome === 'not_found') return json(404, { ok: false, error: 'not_found' });
  if (outcome === 'busy') return json(409, { ok: false, error: 'busy' });
  if (outcome === 'draft_placeholder') return json(400, { ok: false, error: 'draft_placeholder' });
  if (outcome === 'blocked') return json(400, { ok: false, error: 'clarify_draft_blocked' });
  if (GUARD_CODES.has(outcome)) return json(result.http || 409, { ok: false, error: outcome });
  return json(result.http || 502, { ok: false, error: 'not_sent' });
}

function countOf(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
