// Pages-side adapter. Thresholds come from the Celtic Coo site pack.
// The form never logs the visitor's message. The alert is a fixed sentence.

import { alertBody, assessChannel, clientHash, noteOutbound, resolveGuardConfig } from '../../../shared/triage/guard.js';
import celticcoo from '../../../shared/triage/sites/celticcoo.js';
import { mailerSend } from './mailer.js';

const PUBLIC_REPLY = 'hello@celticcoo.ca';

export function bookingGuard(env) {
  const config = resolveGuardConfig(celticcoo.guard, env);
  const send = mailerSend(env);
  return async (sample = {}) => {
    const now = sample.now instanceof Date ? sample.now : new Date();
    const ipHash = sample.ip ? await clientHash(sample.ip) : '';
    const decision = await assessChannel(env && env.INTAKE_DB, {
      phase: sample.phase,
      channel: sample.phase === 'peek' ? 'peek' : 'form',
      sender: sample.sender || '',
      text: sample.text || '',
      fields: sample.fields || null,
      turnstile: sample.turnstile || 'unknown',
      ipHash,
      config,
      now,
    });
    if (decision.alert && send) {
      try {
        await send({
          replyTo: { email: PUBLIC_REPLY, name: 'The Celtic Coo' },
          subject: 'Intake guard',
          text: alertBody(decision, 'form'),
        });
      } catch { /* the debounce already moved; do not retry in a loop */ }
    }
    return ipHash ? { ...decision, ipHash } : decision;
  };
}

export function noteBookingOutbound(env, now = new Date()) {
  return noteOutbound(env && env.INTAKE_DB, now, celticcoo.guard.timeZone);
}
