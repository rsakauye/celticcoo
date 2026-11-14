// Optional plain receipt. Off unless ACK_REPLIES is exactly "on".
// The receipt does not quote the inbound message and does not take a subject
// from it, so a sender cannot inject headers or instructions into the reply.

import { caslFooterText } from '../../../shared/casl/notice.js';
import { optOutStatus } from './optout.js';
import { PUBLIC_MAILBOX } from './redact.js';
import { envelopeAddress, oneEmail, oneLine } from './text.js';

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

// Untrusted mail headers. Walk each character once so a long header stays cheap.
const LOCAL_CHARS = new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!#$%&'*+/=?^_`{|}~-");

function isLabelChar(code) {
  return (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || code === 45;
}

function isAllLetters(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 65 || (code > 90 && code < 97) || code > 122) return false;
  }
  return value.length > 0;
}

function domainEnd(text, start) {
  const n = text.length;
  let i = start;
  if (i >= n || !isLabelChar(text.charCodeAt(i))) return -1;
  let labels = 0;
  while (i < n) {
    const labelStart = i;
    while (i < n && isLabelChar(text.charCodeAt(i))) i += 1;
    if (i === labelStart) return -1;
    labels += 1;
    if (i < n && text.charCodeAt(i) === 46) {
      const next = i + 1;
      if (next < n && isLabelChar(text.charCodeAt(next))) {
        i = next;
        continue;
      }
      break;
    }
    break;
  }
  if (labels < 2) return -1;
  const domain = text.slice(start, i);
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (tld.length < 2 || !isAllLetters(tld)) return -1;
  return i;
}

function emailAddresses(value) {
  const text = String(value || '');
  const out = [];
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf('@', from);
    if (at < 0) break;
    let start = at - 1;
    while (start >= 0 && LOCAL_CHARS.has(text[start])) start -= 1;
    start += 1;
    const end = start < at ? domainEnd(text, at + 1) : -1;
    if (end > at + 1) out.push(text.slice(start, end).toLowerCase());
    from = at + 1;
  }
  return out;
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
// `extra.sender` is the resolved original sender, which may differ from the envelope.
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
    extra.sender,
  ].flatMap(emailAddresses);
  if (addresses.length === 0 || addresses.some(localIsAutomated)) reasons.push('sender');
  return SKIP_REASONS.filter((code) => reasons.includes(code)).join(',');
}

export function isAutomated(message, extra) {
  return automatedReason(message, extra) !== '';
}

// message.reply() can only answer the envelope sender, and the From domain
// has to be the domain that received the mail. A forward, or mail to
// intake@in.celticcoo.com or intake@in.celticcoo.ca, is sent with the
// EMAIL binding instead.
function ackTransport(message, sender) {
  const envelope = oneEmail(envelopeAddress(message && message.from));
  const target = oneEmail(envelopeAddress(sender));
  const inbound = envelopeAddress(message && message.to);
  const at = inbound.lastIndexOf('@');
  const domain = at >= 0 ? inbound.slice(at + 1) : '';
  if (target && target === envelope && domain === 'celticcoo.ca') return 'reply';
  return 'send';
}

export function buildAckMime(message, sender) {
  const to = oneLine(sender || (message && message.from), 200);
  const from = ackTransport(message, to) === 'reply'
    ? oneLine(message && message.to, 200)
    : PUBLIC_MAILBOX;
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
  const sender = oneEmail(deps.sender) || oneEmail(envelopeAddress(message.from));
  if (!sender) return { status: 'skipped' };
  if (isAutomated(message, { sender })) return { status: 'skipped' };
  const stopped = await optOutStatus(env && env.INTAKE_DB, sender);
  if (stopped !== 'allowed') {
    return { status: 'skipped', error: stopped === 'opted_out' ? 'opt_out' : 'opt_out_unknown' };
  }
  const mime = buildAckMime(message, sender);
  if (typeof deps.reply === 'function') {
    await deps.reply(message, mime);
    return { status: 'sent' };
  }
  const { EmailMessage } = await import('cloudflare:email');
  if (ackTransport(message, sender) === 'reply') {
    await message.reply(new EmailMessage(message.to, message.from, mime));
    return { status: 'sent' };
  }
  const send = env && env.EMAIL && typeof env.EMAIL.send === 'function'
    ? env.EMAIL.send.bind(env.EMAIL)
    : null;
  if (!send) return { status: 'skipped', error: 'ack_not_configured' };
  await send(new EmailMessage(PUBLIC_MAILBOX, sender, mime));
  return { status: 'sent' };
}
