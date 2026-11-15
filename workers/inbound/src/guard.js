// Send guard for replies that leave hello@celticcoo.ca.
// Reads the intake_control kill switch and counts outbound sends, then asks
// decideGuard (shared/triage/breaker.js) for allow, hold, or pause.
//
// - pause (manual pause, a latch, or the outbound cap): nothing is sent,
//   not even an approved reply.
// - hold (a seasonal rush over the adaptive limit): a person may still
//   approve a reply, but nothing goes out automatically.
// - A missing table or a failed read fails closed: nothing is sent.
//
// Tables: site/migrations/0013_intake_control.sql. Volume alone never pauses.

import { adaptiveLimit, decideGuard } from '../../../shared/triage/breaker.js';
import celticcoo from '../../../shared/triage/sites/celticcoo.js';
import { clarifyMode } from './clarify.js';
import { codeOf } from './text.js';

const DAY_MS = 86_400_000;

const CONTROL_SQL = `SELECT manual_pause, latch, pause_reason FROM intake_control WHERE id = 'singleton'`;
const OUTBOUND_SQL = 'SELECT COUNT(*) AS n FROM outbound_sends WHERE created_at >= ?';
const INBOUND_SQL = 'SELECT COUNT(*) AS n FROM inbound_emails WHERE created_at >= ?';
const OUTBOUND_INSERT = `INSERT INTO outbound_sends (id, created_at, kind, inbound_email_id, actor)
VALUES (?, ?, ?, ?, ?)`;

function countOf(row) {
  const n = Number(row && (row.n ?? row['COUNT(*)']));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function readControl(db) {
  if (!db || typeof db.prepare !== 'function') return { state: 'unavailable' };
  try {
    const row = await db.prepare(CONTROL_SQL).bind().first();
    if (!row) return { state: 'unavailable' };
    const paused = Number(row.manual_pause) === 1 || String(row.latch || '') !== '';
    return paused ? { state: 'paused', reason: String(row.pause_reason || row.latch || 'manual') } : { state: 'allow' };
  } catch (err) {
    console.error(JSON.stringify({ message: 'send guard control failed', code: codeOf(err) }));
    return { state: 'unavailable' };
  }
}

async function countSince(db, sql, sinceIso) {
  try {
    const row = await db.prepare(sql).bind(sinceIso).first();
    return countOf(row);
  } catch (err) {
    console.error(JSON.stringify({ message: 'send guard count failed', code: codeOf(err) }));
    return null;
  }
}

// mode 'approved': a person pressed approve. Only pause refuses.
// mode 'auto': EXHIBITOR_AUTO_SEND. Hold also refuses.
export async function sendGate(env, { now = new Date(), mode = 'approved' } = {}) {
  if (clarifyMode(env) === 'off') return { ok: false, reason: 'clarify_off' };
  const db = env && env.INTAKE_DB;
  const control = await readControl(db);
  if (control.state === 'unavailable') return { ok: false, reason: 'guard_unavailable' };
  if (control.state === 'paused') return { ok: false, reason: 'guard_paused' };
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const outboundToday = await countSince(db, OUTBOUND_SQL, since);
  if (outboundToday == null) return { ok: false, reason: 'outbound_unknown' };
  let count = 0;
  let limit = Infinity;
  if (mode === 'auto') {
    const today = await countSince(db, INBOUND_SQL, since);
    const month = await countSince(db, INBOUND_SQL, new Date(now.getTime() - 28 * DAY_MS).toISOString());
    if (today == null || month == null) return { ok: false, reason: 'volume_unknown' };
    const g = celticcoo.guard;
    count = today;
    limit = adaptiveLimit({
      baseline: month / 28,
      now,
      seasons: g.seasons,
      timeZone: g.timeZone,
      floor: g.floorPerDay,
      ceiling: g.ceilingPerDay,
      offSeasonMultiplier: g.offSeasonMultiplier,
    }).limit;
  }
  const decision = decideGuard({
    count,
    limit,
    outboundToday,
    outboundCap: celticcoo.guard.outboundDailyCap,
  });
  if (decision.action === 'pause') return { ok: false, reason: decision.reason === 'outbound_cap' ? 'outbound_cap' : 'guard_paused' };
  if (decision.action === 'hold' && mode === 'auto') return { ok: false, reason: 'guard_hold' };
  return { ok: true, reason: decision.action === 'hold' ? 'guard_hold_approved' : 'ok', outboundToday };
}

// Best effort. A missing table must not turn a sent reply into an error.
export async function recordOutbound(db, { kind, inboundEmailId, actor = 'person', now = new Date() }) {
  if (!db || typeof db.prepare !== 'function') return false;
  try {
    await db.prepare(OUTBOUND_INSERT).bind(
      crypto.randomUUID(),
      now.toISOString(),
      String(kind || 'clarify').slice(0, 40),
      String(inboundEmailId || ''),
      String(actor || 'person').slice(0, 20),
    ).run();
    return true;
  } catch (err) {
    console.error(JSON.stringify({ message: 'outbound record failed', code: codeOf(err) }));
    return false;
  }
}
