// Turns a ForwardableEmailMessage into the fields we store.
// Attachment bytes are not kept. A large raw message is capped before parse
// so one email cannot load an unbounded body into the isolate.

import PostalMime from 'postal-mime';
import { clampText, oneLine } from './text.js';

export const PARSE_LIMIT = 256 * 1024;
export const TEXT_LIMIT = 20_000;

export async function readCapped(raw, max = PARSE_LIMIT) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.length > max ? raw.slice(0, max) : raw;
  if (raw instanceof Uint8Array) {
    const view = raw.byteLength > max ? raw.subarray(0, max) : raw;
    return new TextDecoder('utf-8', { fatal: false }).decode(view);
  }
  if (typeof raw.arrayBuffer === 'function') {
    const buf = await raw.arrayBuffer();
    const view = buf.byteLength > max ? buf.slice(0, max) : buf;
    return new TextDecoder('utf-8', { fatal: false }).decode(view);
  }
  if (typeof raw.getReader !== 'function') return '';
  const reader = raw.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.byteLength) continue;
      const room = max - total;
      const slice = value.byteLength > room ? value.subarray(0, room) : value;
      chunks.push(slice);
      total += slice.byteLength;
      if (value.byteLength > room) break;
    }
  } finally {
    try { await reader.cancel(); } catch { /* the stream may already be closed */ }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

export function headerValue(message, name) {
  if (!message || !message.headers || typeof message.headers.get !== 'function') return '';
  return message.headers.get(name) || '';
}

export function receivedAt(dateHeader, now = new Date()) {
  const parsed = Date.parse(String(dateHeader || ''));
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return now.toISOString();
}

export function htmlToPlain(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function attachmentNote(attachments, truncated) {
  const list = Array.isArray(attachments) ? attachments : [];
  const types = list
    .map((item) => oneLine((item && (item.mimeType || item.mime)) || 'unknown', 80))
    .filter(Boolean);
  const parts = [];
  if (list.length) parts.push(`${list.length} attachment(s): ${types.join(', ')}; contents not stored`);
  if (truncated) parts.push('raw message truncated before parse');
  return oneLine(parts.join('; '), 300);
}

export async function parseInbound(message, now = new Date()) {
  const subjectHeader = oneLine(headerValue(message, 'subject'), 300);
  const dateHeader = headerValue(message, 'date');
  const base = {
    subject: subjectHeader,
    text: '',
    fromHeader: oneLine(headerValue(message, 'from'), 300),
    replyTo: oneLine(headerValue(message, 'reply-to'), 300),
    messageId: oneLine(headerValue(message, 'message-id'), 500),
    receivedAt: receivedAt(dateHeader, now),
    attachmentNote: '',
    attachmentCount: 0,
    parseError: '',
  };
  try {
    const size = Number(message && message.rawSize) || 0;
    const rawValue = message && message.raw;
    const raw = await readCapped(rawValue, PARSE_LIMIT);
    const truncated = size > PARSE_LIMIT || (typeof rawValue === 'string' && rawValue.length > PARSE_LIMIT);
    if (!raw) {
      if (truncated) base.attachmentNote = 'raw message truncated before parse';
      return base;
    }
    const email = await PostalMime.parse(raw, {
      maxNestingDepth: 8,
      maxRfc822NestingDepth: 0,
      maxHeadersSize: 64 * 1024,
    });
    const attachments = Array.isArray(email.attachments) ? email.attachments : [];
    for (const item of attachments) {
      if (item) item.content = null;
    }
    let text = String(email.text || '').trim();
    if (!text && email.html) text = htmlToPlain(email.html);
    return {
      ...base,
      subject: oneLine(email.subject || '', 300) || subjectHeader,
      text: clampText(text, TEXT_LIMIT),
      fromHeader: oneLine(formatAddress(email.from), 300) || base.fromHeader,
      replyTo: oneLine(formatAddressList(email.replyTo), 300) || base.replyTo,
      messageId: oneLine(email.messageId || base.messageId, 500),
      receivedAt: receivedAt(email.date || dateHeader, now),
      attachmentNote: attachmentNote(attachments, truncated),
      attachmentCount: attachments.length,
    };
  } catch {
    return { ...base, parseError: 'parse_failed', attachmentNote: base.attachmentNote || 'body not parsed' };
  }
}

function formatAddress(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const address = oneLine(value.address || '', 200);
  const name = oneLine(value.name || '', 120);
  if (name && address) return `${name} <${address}>`;
  return address || name;
}

function formatAddressList(value) {
  if (!value) return '';
  const list = Array.isArray(value) ? value : [value];
  return list.map(formatAddress).filter(Boolean).join(', ');
}

export async function dedupeKey(message, subject) {
  const headerId = oneLine(headerValue(message, 'message-id'), 500);
  if (headerId) return headerId;
  const material = [
    String(message && message.from || ''),
    String(message && message.to || ''),
    subject || '',
    String(message && message.rawSize || 0),
  ].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}
