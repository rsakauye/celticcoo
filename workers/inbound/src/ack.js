// Optional plain receipt. Off unless ACK_REPLIES is exactly "on".
// The receipt does not quote the inbound message and does not take a subject
// from it, so a sender cannot inject headers or instructions into the reply.

import { caslFooterText } from '../../../shared/casl/notice.js';
import { optOutStatus } from './optout.js';
import { envelopeAddress, oneLine } from './text.js';

export const ACK_BODY = `The Celtic Coo received your email. A person will read it. This is an automatic receipt, and this mailbox will not answer the substance of your message on its own.\n\n${caslFooterText()}\n`;

export function acksEnabled(env) {
  return String(env && env.ACK_REPLIES || '').trim().toLowerCase() === 'on';
}

export function isAutomated(message) {
  const from = String(message && message.from || '').toLowerCase();
  if (!from || from.includes('mailer-daemon') || from.includes('postmaster') || from.includes('noreply') || from.includes('no-reply')) {
    return true;
  }
  const headers = message && message.headers;
  const auto = String(headers && headers.get ? headers.get('auto-submitted') || '' : '').toLowerCase();
  if (auto && auto !== 'no') return true;
  const precedence = String(headers && headers.get ? headers.get('precedence') || '' : '').toLowerCase();
  if (['bulk', 'list', 'junk', 'auto_reply'].includes(precedence)) return true;
  if (headers && headers.get && headers.get('list-id')) return true;
  return false;
}

export function buildAckMime(message) {
  const from = oneLine(message && message.to, 200);
  const to = oneLine(message && message.from, 200);
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    'Subject: Re: message received by The Celtic Coo',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    'Auto-Submitted: auto-replied',
  ];
  const messageId = oneLine(message && message.headers && message.headers.get ? message.headers.get('message-id') : '', 500);
  if (messageId) {
    lines.push(`In-Reply-To: ${messageId}`);
    lines.push(`References: ${messageId}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n${ACK_BODY}`;
}

export async function maybeAcknowledge(message, env, deps = {}) {
  if (!acksEnabled(env)) return { status: 'skipped' };
  if (!message || typeof message.reply !== 'function') return { status: 'skipped' };
  if (isAutomated(message)) return { status: 'skipped' };
  const stopped = await optOutStatus(env && env.INTAKE_DB, envelopeAddress(message && message.from));
  if (stopped !== 'allowed') {
    return { status: 'skipped', error: stopped === 'opted_out' ? 'opt_out' : 'opt_out_unknown' };
  }
  const mime = buildAckMime(message);
  if (typeof deps.reply === 'function') {
    await deps.reply(message, mime);
    return { status: 'sent' };
  }
  const { EmailMessage } = await import('cloudflare:email');
  await message.reply(new EmailMessage(message.to, message.from, mime));
  return { status: 'sent' };
}
