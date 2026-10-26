// Approval for a clarifying draft.
// The email handler never calls sendApprovedReply. Only a POST to /r/<id>,
// with a still-unused token, a signed CSRF cookie, and confirm=yes, can send.
// GET shows the page and does not send. Mail scanners that prefetch links
// therefore cannot approve a reply.
//
// The short link stays out of GitHub issues. Issues are filed only in a
// private repo, and only when that repo is configured.
// The link is emailed only to FORWARD_TO.

import { questionFor } from './clarify.js';
import { COO_MARK } from './coo-mark.js';
import { caslFooterText } from '../../../shared/casl/notice.js';
import { optOutStatus } from './optout.js';
import { hasPrivateContact, PUBLIC_MAILBOX } from './redact.js';
import {
  claimClarifySend,
  claimReviewToken,
  createReviewToken,
  discardClarify,
  loadInbound,
  loadReviewToken,
  markClarifySent,
  releaseClarifySend,
  releaseReviewToken,
  saveClarifyDraft,
  suppressClarify,
} from './store.js';
import { codeOf, envelopeAddress, hasUnfilledPlaceholder, oneEmail, oneLine } from './text.js';
import {
  TOKEN_TTL_SECONDS,
  csrfPairMatches,
  issueCsrf,
  reviewOrigin,
  reviewSecret,
  validRowId,
  verifyCsrf,
} from './token.js';

export const HELLO_FROM = PUBLIC_MAILBOX;
const LOCK_MS = 2 * 60 * 1000;
const EMAIL_ORIGINAL_LIMIT = 4000;
const DRAFT_LIMIT = 8000;

const NO_STORE = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

const CATEGORY_LABEL = {
  event_listing_request: 'Event listing',
  booking_inquiry: 'Booking',
  correction_or_update: 'Correction',
  partnership_or_press: 'Press or partnership',
  spam: 'Spam',
  other: 'Other',
};

const PAGE_CSS = `
  :root {
    --fg:#2a1d14; --muted:#6b5a4c; --bg:#fbf6ec; --card:#fffdf8; --line:#eadfcb;
    --green:#1f4d3a; --green2:#2f6b52; --ginger:#a54e1e; --ginger2:#e0843f; --cream:#f4e6c8; --navy:#1d3557;
    --focus:#1d3557; --focus-halo:#fff;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 1.0625rem/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg); background: var(--bg); }
  h1, h2 { font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif; line-height: 1.2; color: var(--green); }
  h1 { font-size: 1.8rem; margin: 0.2rem 0 0.4rem; }
  h2 { font-size: 1.15rem; margin: 0 0 0.6rem; }
  header.site { background: var(--green); color: #fff; }
  header.site .bar { max-width: 1100px; margin: 0 auto; padding: 0.8rem 1.1rem; display: flex; align-items: center; gap: 0.7rem; }
  header.site strong { font-family: Georgia, serif; font-size: 1.35rem; display: block; }
  header.site small { display: block; font: 400 0.78rem/1.1 system-ui, sans-serif; opacity: 0.85; }
  .mark { width: 46px; height: 46px; background: var(--cream); border-radius: 50%; flex: 0 0 auto; }
  .mark svg { width: 46px; height: 46px; display: block; }
  .tartan { height: 10px; background: var(--green); border-bottom: 3px solid var(--ginger2); }
  main { max-width: 1100px; margin: 0 auto; padding: 1.2rem 1.1rem 3rem; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 1rem 1.1rem; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; align-items: start; }
  .muted { color: var(--muted); }
  .summary { margin: 0 0 1rem; }
  .quote, .message { white-space: pre-wrap; background: var(--cream); border-radius: 10px; padding: 0.8rem 1rem; margin: 0.6rem 0 0; }
  label { display: block; font-weight: 600; margin-bottom: 0.35rem; }
  textarea { width: 100%; min-height: 18rem; font: inherit; padding: 0.7rem 0.8rem; border: 1px solid #cdbda3; border-radius: 10px; background: #fff; color: var(--fg); }
  .actions { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 0.8rem; }
  button { font: 600 1rem system-ui, sans-serif; border-radius: 10px; padding: 0.7rem 1rem; cursor: pointer; }
  button.primary { background: var(--ginger); color: #fff; border: 0; }
  button.primary:hover { background: #8a4118; }
  button.ghost { background: transparent; color: var(--green); border: 2px solid var(--green); }
  .banner { background: #fde7d6; border-radius: 10px; padding: 0.7rem 0.9rem; margin: 0 0 1rem; }
  :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; box-shadow: 0 0 0 5px var(--focus-halo); }
  @media (max-width: 800px) {
    .cols { grid-template-columns: 1fr; }
    h1 { font-size: 1.45rem; }
    textarea { min-height: 14rem; }
  }
`;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function page(status, title, body, extraHeaders = {}) {
  const html = `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · The Celtic Coo</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<header class="site"><div class="bar"><span class="mark">${COO_MARK}</span><span><strong>The Celtic Coo</strong><small>Review a reply</small></span></div></header>
<div class="tartan"></div>
<main>
<h1>${escapeHtml(title)}</h1>
${body}
</main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { ...NO_STORE, 'content-type': 'text/html; charset=utf-8', ...extraHeaders },
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

export function categoryLabel(category) {
  return CATEGORY_LABEL[category] || 'Note';
}

export function reviewSummary(category, reasons) {
  const label = categoryLabel(category);
  const asked = (reasons || []).map((reason) => questionFor(reason, category)).filter(Boolean);
  if (!asked.length) return label;
  return `${label}. ${asked.join(' ')}`;
}

function clip(value, limit) {
  const text = String(value || '').replace(/\r\n/g, '\n').replace(/\u0000/g, '');
  if (text.length <= limit) return { text, clipped: false };
  return { text: text.slice(0, limit), clipped: true };
}

function quotePlain(value, limit) {
  const { text, clipped } = clip(value, limit);
  const body = text.trim() ? text : '(no message text stored)';
  const lines = body.split('\n').map((line) => `> ${line}`);
  if (clipped) lines.push('> …');
  return lines.join('\n');
}

export async function sendApprovedReply(env, { to, subject, text }, deps = {}) {
  const recipient = oneEmail(to);
  if (!recipient || recipient.toLowerCase() === HELLO_FROM) {
    const err = new Error('missing recipient');
    err.code = 'clarify_no_recipient';
    throw err;
  }
  const body = String(text || '');
  if (!body || body.length > DRAFT_LIMIT) {
    const err = new Error('draft is not sendable');
    err.code = 'clarify_draft_blocked';
    throw err;
  }
  if (hasUnfilledPlaceholder(body)) {
    logReplyRefused('draft_placeholder');
    const err = new Error('draft has an unfilled placeholder');
    err.code = 'draft_placeholder';
    throw err;
  }
  if (hasPrivateContact(body)) {
    const err = new Error('draft is not sendable');
    err.code = 'clarify_draft_blocked';
    throw err;
  }
  const stopped = await optOutStatus(env && env.INTAKE_DB, recipient);
  if (stopped === 'opted_out') {
    const err = new Error('recipient opted out');
    err.code = 'opt_out';
    throw err;
  }
  if (stopped !== 'allowed') {
    const err = new Error('opt-out list unavailable');
    err.code = 'opt_out_unknown';
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

export function buildReviewNote({
  category,
  reasons,
  draft,
  recipient,
  link,
  subject,
  original,
  senderLabel,
}) {
  const summary = reviewSummary(category, reasons || []);
  const lines = [
    'A clarifying reply is waiting. Nothing has been sent.',
    '',
    summary,
    '',
    `From: ${senderLabel || recipient || '(no reply address stored)'}`,
    `Subject: ${oneLine(subject, 180) || '(no subject)'}`,
    '',
    'Original message:',
    quotePlain(original, EMAIL_ORIGINAL_LIMIT),
    '',
    'Draft:',
    '---',
    draft || '',
    '---',
    '',
  ];
  if (link) {
    lines.push(
      `Review: ${link}`,
      '',
      'Opening the link does not send the reply. The page asks you to confirm.',
      'This link is not in the GitHub issue. Do not paste it there.',
    );
  } else {
    lines.push('The review link is not configured yet. Set REVIEW_SECRET and REVIEW_BASE_URL, and attach a route for that origin to this Worker. The draft is stored. It will not be sent on its own.');
  }
  lines.push('', caslFooterText());
  return lines.join('\n');
}

export function buildReviewHtml({
  category,
  reasons,
  draft,
  link,
  subject,
  original,
  senderLabel,
}) {
  const summary = reviewSummary(category, reasons || []);
  const { text, clipped } = clip(original, EMAIL_ORIGINAL_LIMIT);
  const shown = text.trim() ? text : '(no message text stored)';
  const button = link
    ? `<a href="${escapeHtml(link)}" style="display:inline-block;background:#a54e1e;color:#ffffff;font:700 16px/1 system-ui,-apple-system,sans-serif;text-decoration:none;padding:14px 22px;border-radius:10px;">Review</a>`
    : '<p style="margin:0;color:#6b5a4c;">The review link is not configured yet. The draft is stored and will not be sent on its own.</p>';
  return `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review a reply</title>
</head>
<body style="margin:0;background:#fbf6ec;color:#2a1d14;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf6ec;">
<tr><td align="center" style="padding:16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf8;border:1px solid #eadfcb;border-radius:14px;overflow:hidden;">
<tr><td style="background:#1f4d3a;color:#ffffff;padding:16px 20px;font:700 22px/1.2 Georgia,serif;">The Celtic Coo</td></tr>
<tr><td style="height:6px;background:#e0843f;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:20px;font:16px/1.5 system-ui,-apple-system,sans-serif;">
<p style="margin:0 0 8px;font:700 22px/1.2 Georgia,serif;color:#1f4d3a;">A reply is waiting</p>
<p style="margin:0 0 16px;color:#6b5a4c;">Nothing has been sent.</p>
<p style="margin:0 0 16px;">${escapeHtml(summary)}</p>
<p style="margin:0 0 4px;color:#6b5a4c;">From ${escapeHtml(senderLabel || '(no reply address stored)')}</p>
<p style="margin:0 0 8px;color:#6b5a4c;">Subject: ${escapeHtml(oneLine(subject, 180) || '(no subject)')}</p>
<blockquote style="margin:0 0 16px;padding:10px 12px;background:#f4e6c8;border-radius:10px;white-space:pre-wrap;">${escapeHtml(shown)}${clipped ? '\n…' : ''}</blockquote>
<p style="margin:0 0 8px;font-weight:700;color:#1f4d3a;">Drafted reply</p>
<pre style="margin:0 0 18px;white-space:pre-wrap;font:15px/1.45 system-ui,sans-serif;background:#fffdf8;border:1px solid #eadfcb;border-radius:10px;padding:12px;">${escapeHtml(draft || '')}</pre>
${button}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export async function reviewLinks(env, id, now = new Date()) {
  const secret = reviewSecret(env);
  const origin = reviewOrigin(env);
  const db = env && env.INTAKE_DB;
  if (!secret || !origin || !db || !validRowId(id)) return null;
  const token = await createReviewToken(db, id, now, TOKEN_TTL_SECONDS);
  return {
    id: token.id,
    expiresAt: token.expiresAt,
    url: `${origin}/r/${token.id}`,
  };
}

export async function sendReviewNote(env, note, deps = {}) {
  const to = oneEmail(env && env.FORWARD_TO);
  if (!to) return { status: 'skipped', error: 'forward_not_configured' };
  const send = typeof deps.send === 'function'
    ? deps.send
    : (env && env.EMAIL && typeof env.EMAIL.send === 'function' ? env.EMAIL.send.bind(env.EMAIL) : null);
  if (!send) return { status: 'skipped', error: 'review_not_configured' };
  const now = deps.now ? deps.now() : new Date();
  let link = '';
  try {
    const links = await reviewLinks(env, note.id, now);
    link = links ? links.url : '';
  } catch (err) {
    console.error(JSON.stringify({ message: 'inbound review link failed', code: codeOf(err) }));
    link = '';
  }
  const view = { ...note, link };
  const text = buildReviewNote(view);
  const html = buildReviewHtml(view);
  try {
    await send({
      to,
      from: { email: HELLO_FROM, name: 'The Celtic Coo' },
      subject: 'Review a reply for hello@celticcoo.ca',
      text,
      html,
    });
    return { status: 'sent', error: '' };
  } catch (err) {
    console.error(JSON.stringify({ message: 'inbound review note failed', code: codeOf(err) }));
    return { status: 'failed', error: 'review_failed' };
  }
}

function senderLabelOf(row) {
  const header = oneLine(row && row.from_header, 300);
  if (header) return header;
  return replyAddress(row) || '(no reply address stored)';
}

function originalText(row) {
  return String(row && row.text_body || '');
}

function reasonList(row) {
  return String(row && row.clarify_reasons || '').split(',').filter(Boolean);
}

function reviewForm(row, tokenId, csrf, banner) {
  const summary = reviewSummary(row.category, reasonList(row));
  const original = originalText(row);
  return [
    banner ? `<p class="banner">${escapeHtml(banner)}</p>` : '',
    `<p class="summary">${escapeHtml(summary)}</p>`,
    '<div class="cols">',
    '<section class="card">',
    '<h2>Original message</h2>',
    `<p class="muted">From ${escapeHtml(senderLabelOf(row))}</p>`,
    `<p class="muted">Subject: ${escapeHtml(oneLine(row.subject, 180) || '(no subject)')}</p>`,
    `<pre class="message">${escapeHtml(original.trim() ? original : '(no message text stored)')}</pre>`,
    '</section>',
    '<section class="card">',
    '<h2>Draft reply</h2>',
    `<p class="muted">Nothing is sent until you press Approve and send. It goes from ${escapeHtml(HELLO_FROM)} to the person who wrote in.</p>`,
    `<form method="post" action="/r/${escapeHtml(tokenId)}">`,
    `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">`,
    '<input type="hidden" name="action" value="approve">',
    '<label for="draft">Edit the reply before sending</label>',
    `<textarea id="draft" name="draft">${escapeHtml(row.clarify_draft || '')}</textarea>`,
    '<div class="actions"><button class="primary" type="submit" name="confirm" value="yes">Approve and send</button></div>',
    '</form>',
    `<form method="post" action="/r/${escapeHtml(tokenId)}">`,
    `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">`,
    '<input type="hidden" name="action" value="deny">',
    '<div class="actions"><button class="ghost" type="submit" name="confirm" value="yes">Deny</button></div>',
    '</form>',
    '</section>',
    '</div>',
  ].join('\n');
}

function csrfCookie(value) {
  return `coo_csrf=${value}; HttpOnly; Secure; SameSite=Lax; Path=/r; Max-Age=7200`;
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return '';
}

function tokenIdFromUrl(url) {
  const match = /^\/r\/([0-9A-Za-z]{8,10})$/.exec(url.pathname);
  return match ? match[1] : '';
}

async function readFields(request) {
  if (request.method === 'GET') return { confirm: '', action: '', csrf: '', draft: null };
  const raw = await request.text();
  if (raw.length > 16000) return { tooLarge: true };
  const params = new URLSearchParams(raw);
  return {
    action: params.get('action') || '',
    confirm: params.get('confirm') || '',
    csrf: params.get('csrf') || '',
    draft: params.has('draft') ? String(params.get('draft') || '') : null,
  };
}

function logReplyRefused(code) {
  console.error(JSON.stringify({ message: 'inbound reply refused', code }));
}

function draftProblem(text) {
  if (!text || !String(text).trim()) {
    return { code: 'clarify_draft_blocked', message: 'The reply is empty, so it was not sent.' };
  }
  if (String(text).length > DRAFT_LIMIT) {
    return { code: 'clarify_draft_blocked', message: 'The reply is too long, so it was not sent.' };
  }
  if (hasUnfilledPlaceholder(text)) {
    logReplyRefused('draft_placeholder');
    return {
      code: 'draft_placeholder',
      message: 'The reply still has an unfilled placeholder, so it was not sent. Remove it and try again.',
    };
  }
  if (hasPrivateContact(text)) {
    return {
      code: 'clarify_draft_blocked',
      message: 'The reply still has an email address or a phone number, so it was not sent. Edit it and try again.',
    };
  }
  return null;
}

export async function applyReview({ env, fields, deps = {} }) {
  const db = env && env.INTAKE_DB;
  if (!db) return { http: 503, code: 'not_configured' };
  const row = await loadInbound(db, fields.inboundId);
  if (!row) return { http: 404, code: 'not_found' };
  if (fields.action === 'deny') {
    if (row.clarify_status === 'sent') return { http: 200, code: 'already_sent', row };
    const ok = await discardClarify(db, fields.inboundId);
    if (!ok) {
      const again = await loadInbound(db, fields.inboundId);
      if (again && again.clarify_status === 'sent') return { http: 200, code: 'already_sent', row: again };
      if (again && again.clarify_status === 'discarded') return { http: 200, code: 'discarded', row: again };
      return { http: 409, code: 'busy', row: again || row };
    }
    return { http: 200, code: 'discarded', row };
  }
  if (row.clarify_status === 'sent') return { http: 200, code: 'already_sent', row };
  if (row.clarify_status === 'discarded') return { http: 409, code: 'discarded', row };
  if (row.clarify_status !== 'pending_approval' && row.clarify_status !== 'approved') {
    return { http: 409, code: 'no_draft', row };
  }
  const stopped = await optOutStatus(db, replyAddress(row));
  if (stopped === 'opted_out') {
    try { await discardClarify(db, fields.inboundId); } catch { /* still do not send */ }
    return { http: 200, code: 'opt_out', row };
  }
  if (stopped !== 'allowed') {
    return { http: 503, code: 'opt_out_unknown', row };
  }
  const text = fields.draft == null ? String(row.clarify_draft || '') : String(fields.draft);
  const problem = draftProblem(text);
  if (problem) return { http: 400, code: problem.code, row, problem: problem.message };
  if (text !== row.clarify_draft) {
    try { await saveClarifyDraft(db, fields.inboundId, text); }
    catch { return { http: 502, code: 'clarify_send_failed', row }; }
  }
  const now = deps.now ? deps.now() : new Date();
  const lock = padTime(now.getTime());
  const stale = padTime(now.getTime() - LOCK_MS);
  const claimed = await claimClarifySend(db, fields.inboundId, lock, stale);
  if (!claimed) {
    const again = await loadInbound(db, fields.inboundId);
    if (again && again.clarify_status === 'sent') return { http: 200, code: 'already_sent', row: again };
    return { http: 409, code: 'busy', row: again || row };
  }
  try {
    await sendApprovedReply(env, {
      to: replyAddress(row),
      subject: row.subject,
      text,
    }, deps);
    await markClarifySent(db, fields.inboundId, lock);
    console.log(JSON.stringify({ message: 'inbound clarify sent', id: fields.inboundId }));
    return { http: 200, code: 'sent', row: { ...row, clarify_status: 'sent', clarify_draft: text } };
  } catch (err) {
    const code = codeOf(err) === 'error' ? 'clarify_send_failed' : codeOf(err);
    if (code === 'opt_out') {
      try { await suppressClarify(db, fields.inboundId, lock); } catch { /* the lock expires */ }
      console.log(JSON.stringify({ message: 'inbound clarify not sent', code: 'opt_out', id: fields.inboundId }));
      return { http: 200, code: 'opt_out', row };
    }
    try { await releaseClarifySend(db, fields.inboundId, lock); } catch { /* the lock expires */ }
    console.error(JSON.stringify({ message: 'inbound clarify send failed', code }));
    return { http: code === 'opt_out_unknown' ? 503 : 502, code, row: { ...row, clarify_draft: text } };
  }
}

function resultPage(result) {
  if (result.code === 'not_found') return page(404, 'Not found', '<p>That draft is not in the mailbox log. Nothing was sent.</p>');
  if (result.code === 'not_configured') return page(503, 'Not ready', '<p>The mailbox log is not configured. Nothing was sent.</p>');
  if (result.code === 'already_sent') return page(200, 'Already sent', '<p class="card">This reply was already sent. It was not sent again.</p>');
  if (result.code === 'discarded') return page(200, 'Denied', '<p class="card">The draft was discarded. Nothing was sent.</p>');
  if (result.code === 'no_draft') return page(409, 'No draft', '<p>There is no clarifying draft for this message. Nothing was sent.</p>');
  if (result.code === 'busy') return page(409, 'Please wait', '<p class="card">This draft is already being sent. Nothing else was sent. Open the review link again in a minute if it still looks unsent.</p>');
  if (result.code === 'sent') return page(200, 'Sent', '<p class="card">The clarifying reply was sent. Refreshing this page will not send it again.</p>');
  if (result.code === 'clarify_draft_blocked' || result.code === 'draft_placeholder') {
    return page(400, 'Not sent', `<p class="card">${escapeHtml(result.problem || 'The reply was not sent.')}</p>`);
  }
  if (result.code === 'opt_out') return page(200, 'Not sent', '<p class="card">Nothing was sent. They asked to stop receiving email.</p>');
  if (result.code === 'opt_out_unknown') return page(503, 'Not sent', '<p class="card">The reply was not sent. The stop-mail list could not be checked. Nothing was sent.</p>');
  return page(result.http || 502, 'Not sent', '<p class="card">The reply was not sent. Open the review link again to retry. Nothing went out.</p>');
}

function terminalGet(row) {
  if (row.clarify_status === 'sent') return page(200, 'Already sent', '<p class="card">This reply was already sent. Opening this page did not send it again.</p>');
  if (row.clarify_status === 'discarded') return page(200, 'Denied', '<p class="card">This draft was discarded. Opening this page sent nothing.</p>');
  return null;
}

export async function handleReviewRequest(request, env, deps = {}) {
  const url = new URL(request.url);
  if (url.pathname === '/review') {
    return page(410, 'Link replaced', '<p class="card">This is an old review link. Nothing was sent. Use the Review button in the newest note.</p>');
  }
  const tokenId = tokenIdFromUrl(url);
  if (!tokenId) return new Response('Not found', { status: 404, headers: NO_STORE });
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { ...NO_STORE, allow: 'GET, POST' } });
  }
  const fields = await readFields(request);
  if (fields.tooLarge) return page(413, 'Too large', '<p class="card">That request was too large. Nothing was sent.</p>');
  const now = deps.now ? deps.now() : new Date();
  const nowIso = now.toISOString();
  const token = await loadReviewToken(env && env.INTAKE_DB, tokenId);
  if (!token || !validRowId(token.inbound_email_id)) {
    return page(404, 'Link not valid', '<p class="card">This review link is not valid. Nothing was sent.</p>');
  }
  if (String(token.expires_at || '') <= nowIso) {
    return page(410, 'Link expired', '<p class="card">This review link has expired. Nothing was sent.</p>');
  }
  if (request.method === 'GET') {
    if (token.used_at) return page(200, 'Link used', '<p class="card">This review link was already used. Nothing else was sent.</p>');
    const row = await loadInbound(env.INTAKE_DB, token.inbound_email_id);
    if (!row || !row.clarify_draft) return page(404, 'Not found', '<p class="card">That draft is not in the mailbox log. Nothing was sent.</p>');
    const done = terminalGet(row);
    if (done) return done;
    const secret = reviewSecret(env);
    if (!secret) return page(503, 'Not ready', '<p class="card">Review is not configured. Nothing was sent.</p>');
    const csrf = await issueCsrf(secret, tokenId);
    return page(200, 'Review a reply', reviewForm(row, tokenId, csrf), { 'set-cookie': csrfCookie(csrf) });
  }
  if (token.used_at) return page(200, 'Link used', '<p class="card">This review link was already used. Nothing else was sent.</p>');
  const secret = reviewSecret(env);
  const cookie = readCookie(request, 'coo_csrf');
  const csrfOk = secret
    && await csrfPairMatches(cookie, fields.csrf)
    && await verifyCsrf(secret, tokenId, fields.csrf);
  if (!csrfOk) return page(403, 'Not confirmed', '<p class="card">That confirmation did not match this page. Nothing was sent. Open the review link again.</p>');
  if (fields.confirm !== 'yes' || (fields.action !== 'approve' && fields.action !== 'deny')) {
    return page(400, 'Not confirmed', '<p class="card">The reply was not sent. Use the buttons on the review page.</p>');
  }
  const row = await loadInbound(env.INTAKE_DB, token.inbound_email_id);
  if (!row) return page(404, 'Not found', '<p class="card">That draft is not in the mailbox log. Nothing was sent.</p>');
  if (fields.action === 'approve') {
    const text = fields.draft == null ? String(row.clarify_draft || '') : String(fields.draft);
    const problem = draftProblem(text);
    if (problem) {
      const csrf = await issueCsrf(secret, tokenId);
      const shown = { ...row, clarify_draft: text || row.clarify_draft };
      return page(400, 'Check the reply', reviewForm(shown, tokenId, csrf, problem.message), { 'set-cookie': csrfCookie(csrf) });
    }
  }
  const usedAt = nowIso;
  const claimed = await claimReviewToken(env.INTAKE_DB, tokenId, usedAt, nowIso);
  if (!claimed) return page(200, 'Link used', '<p class="card">This review link was already used. Nothing else was sent.</p>');
  const result = await applyReview({
    env,
    fields: { ...fields, inboundId: token.inbound_email_id },
    deps,
  });
  const finished = result.code === 'sent' || result.code === 'discarded' || result.code === 'already_sent';
  if (!finished) {
    try { await releaseReviewToken(env.INTAKE_DB, tokenId, usedAt); } catch { /* retry still possible until expiry */ }
  }
  if ((result.code === 'clarify_draft_blocked' || result.code === 'draft_placeholder') && result.problem) {
    const csrf = await issueCsrf(secret, tokenId);
    return page(400, 'Check the reply', reviewForm(result.row, tokenId, csrf, result.problem), { 'set-cookie': csrfCookie(csrf) });
  }
  return resultPage(result);
}
