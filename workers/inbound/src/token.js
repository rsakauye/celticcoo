// HMAC tokens for the private approval links. The secret is REVIEW_SECRET.
// A token is bound to one row, one action, and an expiry. It is not a login.

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function reviewSecret(env) {
  const secret = String(env && env.REVIEW_SECRET || '');
  if (secret.length < 16 || secret.length > 200 || /\s/.test(secret)) return '';
  return secret;
}

export function reviewOrigin(env) {
  try {
    const url = new URL(String(env && env.REVIEW_BASE_URL || ''));
    if (url.protocol !== 'https:') return '';
    if (url.username || url.password || url.search || url.hash) return '';
    if (url.pathname !== '/' && url.pathname !== '') return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function validRowId(value) {
  return ID_RE.test(String(value || ''));
}

function bytesToB64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function b64UrlToBytes(value) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(text)) return null;
  try {
    const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function payloadFor({ action, id, exp }) {
  return `v1.${action}.${id}.${exp}`;
}

async function hmac(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return new Uint8Array(mac);
}

function sameBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

export async function signAction(secret, { action, id, exp }) {
  const mac = await hmac(secret, payloadFor({ action, id, exp }));
  return bytesToB64Url(mac);
}

export async function verifyAction(secret, { action, id, exp, token, nowSec }) {
  if (!secret || (action !== 'approve' && action !== 'discard') || !validRowId(id)) return false;
  const expiry = Number(exp);
  if (!Number.isInteger(expiry) || expiry < 1_000_000_000 || expiry > 10_000_000_000) return false;
  if (!Number.isInteger(nowSec) || expiry < nowSec) return false;
  const actual = b64UrlToBytes(token);
  if (!actual) return false;
  const expected = await hmac(secret, payloadFor({ action, id, exp: expiry }));
  return sameBytes(expected, actual);
}

const TOKEN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function validReviewTokenId(value) {
  return /^[0-9A-Za-z]{8,10}$/.test(String(value || ''));
}

// 10 characters from a base62 alphabet. Bytes at or above 248 are skipped
// so the modulo does not bias the first characters.
export function reviewTokenIdFromBytes(bytes) {
  let out = '';
  for (const byte of bytes) {
    if (byte >= 248) continue;
    out += TOKEN_ALPHABET[byte % 62];
    if (out.length === 10) return out;
  }
  return '';
}

export function newReviewTokenId() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const id = reviewTokenIdFromBytes(crypto.getRandomValues(new Uint8Array(24)));
    if (id) return id;
  }
  const err = new Error('review token entropy failed');
  err.code = 'token_entropy';
  throw err;
}

export async function issueCsrf(secret, tokenId) {
  const nonce = bytesToB64Url(crypto.getRandomValues(new Uint8Array(18)));
  const mac = bytesToB64Url(await hmac(secret, `csrf.v1.${tokenId}.${nonce}`));
  return `${nonce}.${mac}`;
}

export async function csrfPairMatches(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || a.length !== b.length || a.length > 300) return false;
  const enc = new TextEncoder();
  const [leftBuf, rightBuf] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return sameBytes(new Uint8Array(leftBuf), new Uint8Array(rightBuf));
}

export async function verifyCsrf(secret, tokenId, presented) {
  if (!secret || !validReviewTokenId(tokenId)) return false;
  const value = String(presented || '');
  const dot = value.indexOf('.');
  if (dot < 10 || dot > 80) return false;
  const nonce = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(nonce)) return false;
  const actual = b64UrlToBytes(mac);
  if (!actual) return false;
  const expected = await hmac(secret, `csrf.v1.${tokenId}.${nonce}`);
  return sameBytes(expected, actual);
}
