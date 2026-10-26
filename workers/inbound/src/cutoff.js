// Manual kill switch for review.celticcoo.ca.
// Authorization is the same REVIEW_SECRET value, sent as a bearer token.
// Approval links are unchanged: they still require the HMAC token and confirm=yes.
// This route does not read or return message bodies.

import { readControl, setPaused } from '../../../shared/triage/guard.js';
import { reviewSecret } from './token.js';

const NO_STORE = { 'cache-control': 'no-store' };

function json(status, body, extra = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

async function authorized(request, env) {
  const secret = reviewSecret(env);
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/.exec(header);
  const token = match ? match[1] : '';
  if (!secret || !token || token.length > 200) return false;
  const enc = new TextEncoder();
  const digest = (value) => crypto.subtle.digest('SHA-256', enc.encode(value));
  const [leftBuf, rightBuf] = await Promise.all([digest(secret), digest(token)]);
  const left = new Uint8Array(leftBuf);
  const right = new Uint8Array(rightBuf);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function view(control) {
  const paused = Boolean(control.manual || control.latch === 'severe' || control.latch === 'manual');
  return {
    ok: true,
    paused,
    reason: control.pauseReason || '',
    latch: control.latch || '',
  };
}

export async function handleCutoff(request, env, deps = {}) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { ...NO_STORE, allow: 'GET, POST' } });
  }
  if (!(await authorized(request, env))) return json(401, { ok: false, code: 'unauthorized' });
  const db = env && env.INTAKE_DB;
  const now = deps.now ? deps.now() : new Date();
  if (request.method === 'GET') {
    const control = await readControl(db);
    if (!control.ready) return json(503, { ok: false, code: 'guard_not_ready' });
    return json(200, view(control));
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 2000) return json(413, { ok: false, code: 'too_large' });
  let body;
  try { body = await request.json(); }
  catch { return json(400, { ok: false, code: 'invalid' }); }
  if (!body || typeof body.paused !== 'boolean' || Object.keys(body).length !== 1) {
    return json(400, { ok: false, code: 'invalid' });
  }
  try {
    const result = await setPaused(db, body.paused, now);
    if (!result.ok) return json(503, { ok: false, code: result.code || 'guard_not_ready' });
    return json(200, result);
  } catch {
    return json(503, { ok: false, code: 'guard_not_ready' });
  }
}
