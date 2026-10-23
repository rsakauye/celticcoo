// Sends one booking email, then forgets it. Nothing is stored.
// The from address is fixed at bookings@celticcoo.ca.
// The recipient is only env.BOOKING_TO. Deploy injects that from the GitHub
// secret BOOKING_TO. Any "to" on the request is ignored, so this public site
// cannot choose the destination inbox, and that inbox is never in the repo.
// A missing or invalid BOOKING_TO does not send.
// This Worker is only reachable through the MAILER service binding.

export const BOOKING_FROM = 'bookings@celticcoo.ca';

const LIMITS = {
  subject: 200,
  text: 20000,
  html: 60000,
  name: 120,
  email: 200,
};

function oneEmail(value) {
  const s = String(value ?? '').trim();
  if (!s || s.length > LIMITS.email || /[\r\n\s]/.test(s)) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
  return s;
}

function oneLine(value, max) {
  const s = String(value ?? '').replace(/[\r\n\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.length > max) return '';
  return s;
}

export function buildOutboundEmail(body, env) {
  if (!body || typeof body !== 'object') return { error: 'invalid' };
  const to = oneEmail(env && env.BOOKING_TO);
  if (!to) return { error: 'not_configured' };
  const replyTo = body.replyTo && typeof body.replyTo === 'object' ? body.replyTo : {};
  const replyEmail = oneEmail(replyTo.email);
  const subject = oneLine(body.subject, LIMITS.subject);
  const text = typeof body.text === 'string' ? body.text : '';
  const html = typeof body.html === 'string' ? body.html : '';
  if (!replyEmail || !subject || text.length < 1 || text.length > LIMITS.text || html.length > LIMITS.html) {
    return { error: 'invalid' };
  }
  const replyName = oneLine(replyTo.name, LIMITS.name);
  const fromName = oneLine(body.from && body.from.name, LIMITS.name) || 'The Celtic Coo';
  return {
    message: {
      to,
      from: { email: BOOKING_FROM, name: fromName },
      replyTo: replyName ? { email: replyEmail, name: replyName } : { email: replyEmail },
      subject,
      text,
      ...(html ? { html } : {}),
    },
  };
}

function json(status, payload) {
  return Response.json(payload, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export async function handleMailerRequest(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { allow: 'POST', 'cache-control': 'no-store' },
    });
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 200000) return json(413, { ok: false, code: 'too_large' });
  let body;
  try { body = await request.json(); }
  catch { return json(400, { ok: false, code: 'invalid' }); }
  const built = buildOutboundEmail(body, env);
  if (built.error === 'not_configured') return json(503, { ok: false, code: 'email_not_configured' });
  if (built.error) return json(400, { ok: false, code: 'invalid' });
  if (!env || !env.EMAIL || typeof env.EMAIL.send !== 'function') {
    return json(503, { ok: false, code: 'email_not_configured' });
  }
  try {
    await env.EMAIL.send(built.message);
  } catch (err) {
    console.error('mailer send failed', err && err.code ? err.code : '');
    return json(502, { ok: false, code: 'email_failed' });
  }
  return json(200, { ok: true });
}

export default {
  fetch(request, env) {
    return handleMailerRequest(request, env);
  },
};
