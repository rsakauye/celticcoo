// Approval for a clarifying draft.
// The email handler never calls sendApprovedReply. Only a POST to /review,
// with a valid HMAC token and a confirm field, can send to the original sender.
// GET shows the draft and does not send. Mail scanners that prefetch links
// therefore cannot approve a reply.
//
// The approve link stays out of GitHub issues. Issues are filed only in a
// private repo, and only when that repo is configured.
// The link is emailed only to FORWARD_TO.

import { questionFor } from './clarify.js';
import { caslFooterText } from '../../../shared/casl/notice.js';
import { hasPrivateContact, PUBLIC_MAILBOX } from './redact.js';
import { claimClarifySend, discardClarify, loadInbound, markClarifySent, releaseClarifySend } from './store.js';
import { codeOf, envelopeAddress, oneEmail, oneLine } from './text.js';
import { reviewLinks, reviewSecret, validRowId, verifyAction } from './token.js';

export const HELLO_FROM = PUBLIC_MAILBOX;
const LOCK_MS = 2 * 60 * 1000;

const NO_STORE = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function page(status, title, body) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.45 Georgia, serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; color: #1c1915; background: #faf7f1; }
  pre { white-space: pre-wrap; background: #f4f0e6; padding: 1rem; }
  button { font: inherit; margin: 0 0.5rem 0.5rem 0; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { ...NO_STORE, 'content-type': 'text/html; charset=utf-8' },
  });
}

function replySubject(subject) {
  const clean = oneLine(subject, 180);
  if (!clean) return 'Re: your note to The Celtic Coo';
  if (/^re:/i.test(clean)) return clean;
  return `Re: ${clean}`;
}

export function replyAddress(row) {
  const replyTo = oneEmail(row && row.reply_to);
  if (replyTo) return replyTo;
  return oneEmail(envelopeAddress(row && row.envelope_from));
}

function padTime(ms) {
  return String(ms).padStart(16, '0');
}

export async function sendApprovedReply(env, { to, subject, text }, deps = {}) {
  const recipient = oneEmail(to);
  if (!recipient || recipient.toLowerCase() === HELLO_FROM) {
    const err = new Error('missing recipient');
    err.code = 'clarify_no_recipient';
    throw err;
  }
  const body = String(text || '');
  if (!body || body.length > 8000 || hasPrivateContact(body)) {
    const err = new Error('draft is not sendable');
    err.code = 'clarify_draft_blocked';
    throw err;
  }
  const send = typeof deps.send === 'function'
    ? deps.send
    : (env && env.EMAIL && typeof env.EMAIL.send === 'function' ? env.EMAIL.send.bind(env.EMAIL) : null);
  if (!send) {
    const err = new Error('email binding missing');
    err.code = 'clarify_not_configured';
    throw err;
  }
  await send({
    to: recipient,
    from: { email: HELLO_FROM, name: 'The Celtic Coo' },
    replyTo: { email: HELLO_FROM, name: 'The Celtic Coo' },
    subject: replySubject(subject),
    text: body,
  });
}

export function buildReviewNote({ id, category, reasons, draft, recipient, links, forwardStatus }) {
  const lines = [
    'A clarifying reply is waiting. Nothing has been sent to the person who wrote in.',
    `Row: ${id}`,
    `Category: ${category || 'other'}`,
    `Forward: ${forwardStatus || 'unknown'}`,
    '',
    `If you approve it, it will be sent from ${HELLO_FROM} to:`,
    recipient || '(no reply address stored)',
    '',
    'Draft:',
    '---',
    draft || '',
    '---',
    '',
  ];
  const asked = (reasons || []).map((reason) => questionFor(reason, category)).filter(Boolean);
  if (asked.length) {
    lines.push('It asks only for:', ...asked.map((item) => `- ${item}`), '');
  }
  if (links) {
    lines.push(
      'Opening a link does not send the reply. The page asks you to confirm.',
      `Approve: ${links.approve}`,
      `Discard: ${links.discard}`,
      '',
      'These links are not in the GitHub issue. Do not paste them there.',
    );
  } else {
    lines.push('Approval links are not configured yet. Set REVIEW_SECRET and REVIEW_BASE_URL, and attach a route for that origin to this Worker. The draft is stored. It will not be sent on its own.');
  }
  lines.push('', caslFooterText());
  return lines.join('\n');
}

export async function sendReviewNote(env, note, deps = {}) {
  const to = oneEmail(env && env.FORWARD_TO);
  if (!to) return { status: 'skipped', error: 'forward_not_configured' };
  const send = typeof deps.send === 'function'
    ? deps.send
    : (env && env.EMAIL && typeof env.EMAIL.send === 'function' ? env.EMAIL.send.bind(env.EMAIL) : null);
  if (!send) return { status: 'skipped', error: 'review_not_configured' };
  const now = deps.now ? deps.now() : new Date();
  let links = null;
  try {
    links = await reviewLinks(env, note.id, now);
  } catch (err) {
    console.error(JSON.stringify({ message: 'inbound review link failed', code: codeOf(err) }));
    links = null;
  }
  const text = buildReviewNote({ ...note, links });
  try {
    await send({
      to,
      from: { email: HELLO_FROM, name: 'The Celtic Coo' },
      subject: 'Approve a clarifying reply for hello@celticcoo.ca',
      text,
    });
    return { status: 'sent', error: '' };
  } catch (err) {
    console.error(JSON.stringify({ message: 'inbound review note failed', code: codeOf(err) }));
    return { status: 'failed', error: 'review_failed' };
  }
}

function formFields({ id, action, exp, token }) {
  return [
    `<input type="hidden" name="id" value="${escapeHtml(id)}">`,
    `<input type="hidden" name="action" value="${escapeHtml(action)}">`,
    `<input type="hidden" name="exp" value="${escapeHtml(exp)}">`,
    `<input type="hidden" name="token" value="${escapeHtml(token)}">`,
  ].join('');
}

function reviewBody(row, fields) {
  const recipient = replyAddress(row);
  const reasons = String(row.clarify_reasons || '').split(',').filter(Boolean);
  const asked = reasons.map((reason) => questionFor(reason, row.category)).filter(Boolean);
  return [
    `<p>Nothing has been sent yet. Approving sends the text below from ${escapeHtml(HELLO_FROM)}.</p>`,
    `<p>To: ${escapeHtml(recipient || '(no reply address stored)')}</p>`,
    asked.length ? `<ul>${asked.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '',
    `<pre>${escapeHtml(row.clarify_draft || '')}</pre>`,
    '<form method="post" action="/review">',
    formFields({ ...fields, action: 'approve' }),
    '<button type="submit" name="confirm" value="yes">Approve and send</button>',
    '</form>',
    '<form method="post" action="/review">',
    formFields({ ...fields, action: 'discard' }),
    '<button type="submit" name="confirm" value="yes">Discard</button>',
    '</form>',
  ].join('\n');
}

async function readFields(request) {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    return {
      id: url.searchParams.get('id') || '',
      action: url.searchParams.get('action') || '',
      exp: url.searchParams.get('exp') || '',
      token: url.searchParams.get('token') || '',
      confirm: '',
    };
  }
  const raw = await request.text();
  if (raw.length > 4000) return { tooLarge: true };
  const params = new URLSearchParams(raw);
  return {
    id: params.get('id') || '',
    action: params.get('action') || '',
    exp: params.get('exp') || '',
    token: params.get('token') || '',
    confirm: params.get('confirm') || '',
  };
}

function invalid() {
  return page(403, 'Link not valid', '<p>This approval link is not valid, or it has expired. Nothing was sent.</p>');
}

export async function applyReview({ env, fields, deps = {} }) {
  const db = env && env.INTAKE_DB;
  if (!db) return { http: 503, code: 'not_configured' };
  const row = await loadInbound(db, fields.id);
  if (!row) return { http: 404, code: 'not_found' };
  if (fields.action === 'discard') {
    if (row.clarify_status === 'sent') return { http: 200, code: 'already_sent', row };
    const ok = await discardClarify(db, fields.id);
    if (!ok) {
      const again = await loadInbound(db, fields.id);
      if (again && again.clarify_status === 'sent') return { http: 200, code: 'already_sent', row: again };
    }
    return { http: 200, code: 'discarded', row };
  }
  if (row.clarify_status === 'sent') return { http: 200, code: 'already_sent', row };
  if (row.clarify_status === 'discarded') return { http: 409, code: 'discarded', row };
  if (row.clarify_status !== 'pending_approval' && row.clarify_status !== 'approved') {
    return { http: 409, code: 'no_draft', row };
  }
  const now = deps.now ? deps.now() : new Date();
  const lock = padTime(now.getTime());
  const stale = padTime(now.getTime() - LOCK_MS);
  const claimed = await claimClarifySend(db, fields.id, lock, stale);
  if (!claimed) {
    const again = await loadInbound(db, fields.id);
    if (again && again.clarify_status === 'sent') return { http: 200, code: 'already_sent', row: again };
    return { http: 409, code: 'busy', row: again || row };
  }
  try {
    await sendApprovedReply(env, {
      to: replyAddress(row),
      subject: row.subject,
      text: row.clarify_draft,
    }, deps);
    await markClarifySent(db, fields.id, lock);
    console.log(JSON.stringify({ message: 'inbound clarify sent', id: fields.id }));
    return { http: 200, code: 'sent', row: { ...row, clarify_status: 'sent' } };
  } catch (err) {
    try { await releaseClarifySend(db, fields.id, lock); } catch { /* the lock expires */ }
    const code = codeOf(err) === 'error' ? 'clarify_send_failed' : codeOf(err);
    console.error(JSON.stringify({ message: 'inbound clarify send failed', code }));
    return { http: 502, code, row };
  }
}

function resultPage(result) {
  if (result.code === 'not_found') return page(404, 'Not found', '<p>That draft is not in the mailbox log. Nothing was sent.</p>');
  if (result.code === 'not_configured') return page(503, 'Not ready', '<p>The mailbox log is not configured. Nothing was sent.</p>');
  if (result.code === 'already_sent') return page(200, 'Already sent', '<p>This reply was already sent. It was not sent again.</p>');
  if (result.code === 'discarded') return page(200, 'Discarded', '<p>The draft was discarded. Nothing was sent.</p>');
  if (result.code === 'no_draft') return page(409, 'No draft', '<p>There is no clarifying draft for this message. Nothing was sent.</p>');
  if (result.code === 'busy') return page(409, 'Please wait', '<p>This draft is already being sent. Nothing else was sent. Refresh the approval link in a minute if it still looks unsent.</p>');
  if (result.code === 'sent') return page(200, 'Sent', '<p>The clarifying reply was sent. The recipient address is not repeated here.</p>');
  return page(result.http || 502, 'Not sent', `<p>The draft was not sent (${escapeHtml(result.code || 'clarify_send_failed')}). The approval link can be used again.</p>`);
}

export async function handleReviewRequest(request, env, deps = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/review') {
    return new Response('Not found', { status: 404, headers: NO_STORE });
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { ...NO_STORE, allow: 'GET, POST' } });
  }
  const fields = await readFields(request);
  if (fields.tooLarge) return page(413, 'Too large', '<p>That request was too large. Nothing was sent.</p>');
  const secret = reviewSecret(env);
  const now = deps.now ? deps.now() : new Date();
  const ok = secret && await verifyAction(secret, {
    action: fields.action,
    id: fields.id,
    exp: Number(fields.exp),
    token: fields.token,
    nowSec: Math.floor(now.getTime() / 1000),
  });
  if (!ok) return invalid();
  if (request.method === 'GET') {
    if (!validRowId(fields.id)) return invalid();
    const row = env && env.INTAKE_DB ? await loadInbound(env.INTAKE_DB, fields.id) : null;
    if (!row || !row.clarify_draft) return page(404, 'Not found', '<p>That draft is not in the mailbox log. Nothing was sent.</p>');
    if (row.clarify_status === 'sent') return page(200, 'Already sent', '<p>This reply was already sent. Opening this page did not send it again.</p>');
    if (row.clarify_status === 'discarded') return page(200, 'Discarded', '<p>This draft was discarded. Opening this page sent nothing.</p>');
    return page(200, 'Review a reply', reviewBody(row, fields));
  }
  if (fields.confirm !== 'yes') {
    return page(400, 'Not confirmed', '<p>The reply was not sent. Use the button on the review page.</p>');
  }
  const result = await applyReview({ env, fields, deps });
  return resultPage(result);
}
