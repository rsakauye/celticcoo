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

// Local parts used by bulk mail and daemons. A normal local part does not
// match. The check is the local part only, so a display name or a domain
// that happens to contain these words does not match.
const AUTO_LOCAL = /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster)(?:[.+_-].*)?$/i;
const PRECEDENCE = new Set(['bulk', 'list', 'junk', 'auto_reply']);
const SKIP_REASONS = ['list_unsubscribe', 'list_id', 'auto_submitted', 'precedence', 'sender'];

function headerValue(headers, name) {
  if (!headers || typeof headers.get !== 'function') return '';
  return String(headers.get(name) || '').trim();
}

function emailAddresses(value) {
  const found = String(value || '').match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi);
  return found ? found.map((item) => item.toLowerCase()) : [];
}

function localIsAutomated(address) {
  const at = address.lastIndexOf('@');
  if (at < 1) return false;
  return AUTO_LOCAL.test(address.slice(0, at));
}

// Codes that explain why a clarifying draft was not queued.
// The header value itself is never returned: List-Unsubscribe often contains
// an address. `sender` means an automated local part, or no address at all.
// `extra` covers the parsed From and Reply-To when those are not on message.headers.
export function automatedReason(message, extra = {}) {
  const headers = message && message.headers;
  const reasons = [];
  if (headerValue(headers, 'list-unsubscribe')) reasons.push('list_unsubscribe');
  if (headerValue(headers, 'list-id')) reasons.push('list_id');
  const auto = headerValue(headers, 'auto-submitted').toLowerCase().split(/[\s;]+/)[0] || '';
  if (auto && auto !== 'no') reasons.push('auto_submitted');
  const precedence = headerValue(headers, 'precedence').toLowerCase();
  const tokens = precedence.split(/[^a-z_-]+/).filter(Boolean).map((token) => token.replace(/-/g, '_'));
  if (tokens.some((token) => PRECEDENCE.has(token))) reasons.push('precedence');
  const addresses = [
    message && message.from,
    headerValue(headers, 'from'),
    headerValue(headers, 'reply-to'),
    extra.fromHeader,
    extra.replyTo,
  ].flatMap(emailAddresses);
  if (addresses.length === 0 || addresses.some(localIsAutomated)) reasons.push('sender');
  return SKIP_REASONS.filter((code) => reasons.includes(code)).join(',');
}

export function isAutomated(message, extra) {
  return automatedReason(message, extra) !== '';
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
