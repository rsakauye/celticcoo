// Inbound adapter for the shared guard. Alerts go to FORWARD_TO.
// The alert text is fixed. It does not include the message that arrived.

import { alertBody, assessChannel, noteOutbound, resolveGuardConfig } from '../../../shared/triage/guard.js';
import celticcoo from '../../../shared/triage/sites/celticcoo.js';
import { PUBLIC_MAILBOX } from './redact.js';
import { envelopeAddress, oneEmail } from './text.js';

export function authResult(headers) {
  const value = String(headers && headers.get ? headers.get('authentication-results') || '' : '');
  const spf = /spf=(pass|fail|softfail|neutral|none)/i.exec(value);
  const dkim = /dkim=(pass|fail|none|neutral)/i.exec(value);
  const norm = (raw) => {
    const token = String(raw || '').toLowerCase();
    if (token === 'pass') return 'pass';
    if (token === 'fail' || token === 'softfail') return 'fail';
    return 'unknown';
  };
  return { spf: norm(spf && spf[1]), dkim: norm(dkim && dkim[1]) };
}

async function sendGuardAlert(env, decision, deps) {
  const to = oneEmail(env && env.FORWARD_TO);
  const send = typeof deps.send === 'function'
    ? deps.send
    : (env && env.EMAIL && typeof env.EMAIL.send === 'function' ? env.EMAIL.send.bind(env.EMAIL) : null);
  if (!to || !send) return;
  await send({
    to,
    from: { email: PUBLIC_MAILBOX, name: 'The Celtic Coo' },
    subject: 'Intake guard',
    text: alertBody(decision, 'inbound'),
  });
}

export function inboundGuard(env, deps = {}) {
  const config = resolveGuardConfig(celticcoo.guard, env);
  return async (sample = {}) => {
    const now = sample.now instanceof Date ? sample.now : new Date();
    const auth = authResult(sample.message && sample.message.headers);
    const decision = await assessChannel(env && env.INTAKE_DB, {
      phase: sample.phase,
      channel: sample.phase === 'peek' ? 'peek' : 'inbound',
      sender: sample.sender || envelopeAddress(sample.message && sample.message.from),
      text: sample.text || '',
      fields: sample.fields || null,
      spf: sample.spf || auth.spf,
      dkim: sample.dkim || auth.dkim,
      turnstile: 'unknown',
      config,
      now,
    });
    if (decision.alert) {
      try { await sendGuardAlert(env, decision, deps); }
      catch { /* one alert per debounce window */ }
    }
    return decision;
  };
}

export async function rememberAuth(db, id, message) {
  if (!db || typeof db.prepare !== 'function' || !id) return;
  const auth = authResult(message && message.headers);
  if (auth.spf === 'unknown' && auth.dkim === 'unknown') return;
  try {
    await db.prepare('UPDATE inbound_emails SET auth_spf = ?, auth_dkim = ? WHERE id = ?')
      .bind(auth.spf, auth.dkim, id)
      .run();
  } catch { /* migration 0004 adds auth_spf and auth_dkim */ }
}

export function noteInboundOutbound(env, now = new Date()) {
  return noteOutbound(env && env.INTAKE_DB, now, celticcoo.guard.timeZone);
}
