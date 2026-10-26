// Builds the advisory trust score for one stored message.
// A failed model check caps the score and records ai_check_failed.
// Nothing in this file sends mail.

import { fenceEmail, modelName, resolveAiRunner } from './classify.js';
import { codeOf, envelopeAddress, oneEmail } from './text.js';
import {
  TRUST_CHECK_SCHEMA,
  TRUST_CHECK_SYSTEM,
  countLexiconHits,
  parseAuthenticationResults,
  parseTrustCheck,
  scoreTrust,
  seasonFor,
} from '../../../shared/trust/index.js';
import celticcooTrust from '../../../shared/trust/sites/celticcoo.js';

const HISTORY_SQL = `SELECT
  COUNT(*) AS prior_emails,
  COALESCE(SUM(CASE WHEN clarify_status = 'sent' THEN 1 ELSE 0 END), 0) AS prior_approved,
  COALESCE(SUM(CASE WHEN clarify_status = 'discarded' THEN 1 ELSE 0 END), 0) AS prior_denied,
  COALESCE(SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END), 0) AS recent_emails
FROM inbound_emails
WHERE ? != '' AND (lower(reply_to) = ? OR lower(envelope_from) = ?)`;

const GUARD_SQL = `SELECT manual_pause, latch, pause_reason
FROM intake_control WHERE id = 'singleton'`;

function countOf(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function classifierSource(classification) {
  if (classification && classification.classifier === 'ai') return 'ai';
  const reason = String(classification && classification.reason || '');
  if (reason === 'rules_override') return 'rules';
  if (!reason || reason === 'rules') return 'rules';
  return 'ai_failed';
}

function headerValue(message, name) {
  const headers = message && message.headers;
  if (!headers || typeof headers.get !== 'function') return '';
  return headers.get(name) || '';
}

async function senderHistory(db, address, sinceIso) {
  if (!address) {
    return { priorEmails: 0, priorApproved: 0, priorDenied: 0, recentEmails: 0, unavailable: false };
  }
  try {
    const row = await db.prepare(HISTORY_SQL).bind(sinceIso, address, address, address).first();
    if (!row) {
      return { priorEmails: 0, priorApproved: 0, priorDenied: 0, recentEmails: 0, unavailable: false };
    }
    return {
      priorEmails: countOf(row.prior_emails),
      priorApproved: countOf(row.prior_approved),
      priorDenied: countOf(row.prior_denied),
      recentEmails: countOf(row.recent_emails),
      unavailable: false,
    };
  } catch (err) {
    console.error(JSON.stringify({ message: 'inbound trust history failed', code: codeOf(err) }));
    return { priorEmails: 0, priorApproved: 0, priorDenied: 0, recentEmails: 0, unavailable: true };
  }
}

function guardFromRow(row) {
  if (!row || (row.manual_pause == null && row.latch == null)) {
    return { action: 'unavailable', reason: 'guard_unavailable' };
  }
  const paused = Number(row.manual_pause) === 1 || String(row.latch || '') !== '';
  if (!paused) return { action: 'allow', reason: 'ok' };
  const reason = String(row.pause_reason || row.latch || 'manual').toLowerCase();
  const safe = /^[a-z0-9_]{1,40}$/.test(reason) ? reason : 'paused';
  return { action: 'pause', reason: safe };
}

async function guardState(db) {
  if (!db || typeof db.prepare !== 'function') return { action: 'unavailable', reason: 'guard_unavailable' };
  try {
    const row = await db.prepare(GUARD_SQL).bind().first();
    return guardFromRow(row);
  } catch (err) {
    console.error(JSON.stringify({ message: 'inbound trust guard failed', code: codeOf(err) }));
    return { action: 'unavailable', reason: 'guard_unavailable' };
  }
}

function trustPayload(user, mode) {
  const messages = [
    {
      role: 'system',
      content: mode === 'text'
        ? `${TRUST_CHECK_SYSTEM}\nReply with one JSON object only. Do not use markdown.`
        : TRUST_CHECK_SYSTEM,
    },
    { role: 'user', content: user },
  ];
  if (mode === 'text') return { messages };
  return {
    messages,
    max_tokens: 128,
    response_format: { type: 'json_schema', json_schema: TRUST_CHECK_SCHEMA },
  };
}

export async function checkTrustText(input, env, deps = {}) {
  const runner = resolveAiRunner(env, deps);
  if (!runner.run) return { status: 'failed' };
  const user = fenceEmail(input && input.subject, input && input.text);
  const model = modelName(env);
  for (const mode of ['schema', 'text']) {
    try {
      const result = await runner.run(model, trustPayload(user, mode));
      const parsed = parseTrustCheck(result);
      if (!parsed) continue;
      const flags = ['spam', 'phishing', 'prompt_injection'].filter((flag) => {
        if (flag === 'prompt_injection') return parsed.promptInjection;
        return parsed[flag];
      });
      console.log(JSON.stringify({ message: 'inbound trust check', result: 'ok', flags: flags.join(',') }));
      return parsed;
    } catch (err) {
      console.error(JSON.stringify({ message: 'inbound trust check failed', code: codeOf(err) }));
    }
  }
  console.log(JSON.stringify({ message: 'inbound trust check', result: 'ai_check_failed' }));
  return { status: 'failed' };
}

function failedScore() {
  return {
    score: celticcooTrust.failClosedScore,
    reasons: [{ code: 'ai_check_failed', delta: 0 }],
    autoSend: false,
  };
}

export async function assessTrust({ message, parsed, classification, env, deps = {}, now }) {
  const pack = celticcooTrust;
  const when = now instanceof Date ? now : new Date();
  const address = oneEmail(parsed && parsed.replyTo) || oneEmail(envelopeAddress(message && message.from));
  const since = new Date(when.getTime() - pack.bulk.windowHours * 60 * 60 * 1000).toISOString();
  const db = env && env.INTAKE_DB;
  let history = { priorEmails: 0, priorApproved: 0, priorDenied: 0, recentEmails: 0, unavailable: !db };
  let guard = { action: 'unavailable', reason: 'guard_unavailable' };
  if (db && typeof db.prepare === 'function') {
    history = await senderHistory(db, address.toLowerCase(), since);
    guard = await guardState(db);
  }
  let aiCheck = { status: 'failed' };
  try {
    aiCheck = await checkTrustText({ subject: parsed && parsed.subject, text: parsed && parsed.text }, env, deps);
  } catch (err) {
    console.error(JSON.stringify({ message: 'inbound trust check failed', code: codeOf(err) }));
    aiCheck = { status: 'failed' };
  }
  const text = `${parsed && parsed.subject || ''}\n${parsed && parsed.text || ''}`;
  const season = seasonFor(when, pack.seasons, pack.timeZone);
  try {
    return scoreTrust({
      auth: parseAuthenticationResults(headerValue(message, 'authentication-results')),
      history,
      classifier: {
        source: classifierSource(classification),
        confidence: classification && classification.confidence,
        category: classification && classification.category,
      },
      aiCheck,
      lexicon: countLexiconHits(text, pack.lexicon),
      guard,
      season: season ? { id: season.id } : null,
    }, pack);
  } catch (err) {
    console.error(JSON.stringify({ message: 'inbound trust score failed', code: codeOf(err) }));
    return failedScore();
  }
}

export function storedTrust(score) {
  const n = Number(score && score.score);
  const safe = Number.isInteger(n) && n >= 0 && n <= 100 ? n : celticcooTrust.failClosedScore;
  const reasons = Array.isArray(score && score.reasons) ? score.reasons : [{ code: 'ai_check_failed', delta: 0 }];
  return { score: safe, reasons: JSON.stringify(reasons) };
}
