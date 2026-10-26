// Inbound mail for hello@celticcoo.ca.
//
// The forward to env.FORWARD_TO happens before parse, classify, D1, or GitHub.
// FORWARD_TO is injected at deploy from a secret. It is not in this repo.
// A later step throwing does not undo a forward that already succeeded.
// If the forward itself does not happen, this handler throws so Email Routing
// does not treat the delivery as finished, except when the platform says the
// message cannot be forwarded. In that case the row is still stored.
//
// Email content is untrusted. It can only be logged, classified, and, for an
// event listing or a correction, turned into a redacted GitHub issue.
// No URL from the message is fetched. ACK_REPLIES still defaults to off.
// A clarifying draft is stored and shown for approval. This handler does not
// send that draft to the original sender. Approval is a POST to /r/<id>.
// There is no addresses field in wrangler.jsonc, so deploying this Worker does
// not change the Email Routing rule. The owner switches that in the dashboard.

import { isAutomated, maybeAcknowledge } from './ack.js';
import { classifyMessage, safeReason } from './classify.js';
import { planDraft } from './clarify.js';
import { buildIssue, fileGitHubIssue, shouldFile, workerToken } from './issue.js';
import { dedupeKey, parseInbound } from './parse.js';
import { handleReviewRequest, sendReviewNote } from './review.js';
import { markIssue, upsertInbound } from './store.js';
import { codeOf, envelopeAddress, isHelloRecipient, oneEmail, oneLine } from './text.js';

export function forwardDestination(env) {
  return oneEmail(env && env.FORWARD_TO);
}

export async function forwardCopy(message, env) {
  const to = forwardDestination(env);
  if (!to) return { status: 'skipped', error: 'forward_not_configured' };
  if (!message || typeof message.forward !== 'function') return { status: 'failed', error: 'forward_unavailable' };
  if (message.canBeForwarded === false) return { status: 'skipped', error: 'not_forwardable' };
  try {
    await message.forward(to);
    return { status: 'sent', error: '' };
  } catch (err) {
    console.error(JSON.stringify({
      message: 'inbound forward failed',
      code: codeOf(err) === 'error' ? 'forward_failed' : codeOf(err),
    }));
    return { status: 'failed', error: 'forward_failed' };
  }
}

function logOutcome(fields, deps) {
  const line = JSON.stringify({ message: 'inbound email', ...fields });
  if (deps && typeof deps.log === 'function') deps.log(line);
  else console.log(line);
}

async function fileIfNeeded({ saved, classification, parsed, draft, forward, env, deps }) {
  const canFile = forward.status === 'sent' || forward.error === 'not_forwardable';
  if (!canFile || !shouldFile(classification.category) || saved.issueStatus === 'filed') {
    return { issueStatus: saved.issueStatus || 'skipped', issueUrl: saved.issueUrl || '', errorCode: '' };
  }
  const token = workerToken(env);
  const issue = buildIssue({
    id: saved.id,
    category: classification.category,
    confidence: classification.confidence,
    summary: classification.summary,
    event: classification.event,
    classifier: classification.classifier,
    attachmentCount: parsed.attachmentCount,
    clarifyStatus: draft ? draft.status : '',
    clarifyDraft: draft ? draft.draft : '',
    clarifyReasons: draft ? draft.reasons : [],
  });
  if (!issue) return { issueStatus: 'skipped', issueUrl: '', errorCode: '' };
  if (!token) {
    try { await markIssue(env.INTAKE_DB, saved.id, 'failed', '', null, 'issue_not_configured'); } catch { /* logged below */ }
    return { issueStatus: 'failed', issueUrl: '', errorCode: 'issue_not_configured' };
  }
  try {
    const filed = await fileGitHubIssue({
      token,
      issue,
      fetchImpl: deps.fetch,
    });
    await markIssue(env.INTAKE_DB, saved.id, 'filed', filed.url, filed.number, '');
    return { issueStatus: 'filed', issueUrl: filed.url, errorCode: '' };
  } catch (err) {
    const code = codeOf(err) === 'error' ? 'issue_failed' : codeOf(err);
    try { await markIssue(env.INTAKE_DB, saved.id, 'failed', '', null, code); } catch { /* the forward already happened */ }
    return { issueStatus: 'failed', issueUrl: '', errorCode: code };
  }
}

async function processHello(message, env, deps, forward) {
  const now = deps.now ? deps.now() : new Date();
  const createdAt = now.toISOString();
  const parsed = typeof deps.parse === 'function'
    ? await deps.parse(message, now)
    : await parseInbound(message, now);
  const classification = typeof deps.classify === 'function'
    ? await deps.classify(parsed, env)
    : await classifyMessage({ subject: parsed.subject, text: parsed.text }, env, deps);
  const draft = planDraft({
    category: classification.category,
    event: classification.event,
    subject: parsed.subject,
    text: parsed.text,
    now,
    env,
    automated: isAutomated(message),
  });
  const key = await dedupeKey(message, parsed.subject);
  const errorCode = [forward.error, parsed.parseError].filter(Boolean).join(',') || '';
  const row = {
    id: deps.uuid ? deps.uuid() : crypto.randomUUID(),
    createdAt,
    receivedAt: parsed.receivedAt || createdAt,
    dedupeKey: key,
    messageId: oneLine(parsed.messageId, 500),
    envelopeFrom: oneLine(envelopeAddress(message.from), 200),
    envelopeTo: oneLine(envelopeAddress(message.to), 200),
    fromHeader: parsed.fromHeader || '',
    replyTo: parsed.replyTo || '',
    subject: parsed.subject || '',
    textBody: parsed.text || '',
    attachmentNote: parsed.attachmentNote || '',
    category: classification.category,
    confidence: classification.confidence,
    summary: classification.summary,
    extractedJson: JSON.stringify(classification.event || {}),
    classifier: classification.classifier === 'ai' ? 'ai' : 'rules',
    classifierReason: safeReason(classification.reason),
    clarifyStatus: draft ? draft.status : '',
    clarifyDraft: draft ? draft.draft : '',
    clarifyReasons: draft ? draft.reasons.join(',') : '',
    forwardStatus: forward.status,
    issueStatus: 'skipped',
    errorCode: oneLine(errorCode, 80),
    rawSize: Number(message.rawSize) || 0,
  };
  const saved = await upsertInbound(env && env.INTAKE_DB, row);
  const issue = await fileIfNeeded({ saved, classification, parsed, draft, forward, env, deps });
  let reviewStatus = '';
  if (draft) {
    const review = await sendReviewNote(env, {
      id: saved.id,
      category: classification.category,
      reasons: draft.reasons,
      draft: draft.draft,
      recipient: oneEmail(parsed.replyTo) || oneEmail(envelopeAddress(message.from)),
      forwardStatus: forward.status,
      subject: parsed.subject || '',
      original: parsed.text || '',
      senderLabel: parsed.fromHeader || envelopeAddress(message.from),
    }, deps);
    reviewStatus = review.status;
  }
  if (forward.status === 'sent') {
    try {
      await maybeAcknowledge(message, env, deps);
    } catch (err) {
      console.error(JSON.stringify({ message: 'inbound ack failed', code: codeOf(err) }));
    }
  }
  return {
    id: saved.id,
    category: classification.category,
    classifier: classification.classifier,
    forwardStatus: forward.status,
    issueStatus: issue.issueStatus,
    issueUrl: issue.issueUrl,
    errorCode: issue.errorCode || row.errorCode,
    reason: row.classifierReason,
    reviewStatus,
  };
}

export async function handleInboundEmail(message, env, deps = {}) {
  const forward = await forwardCopy(message, env);
  let outcome = null;
  try {
    if (!isHelloRecipient(message && message.to)) {
      outcome = { skipped: 'not_hello', forwardStatus: forward.status, errorCode: forward.error };
    } else {
      outcome = await processHello(message, env, deps, forward);
    }
  } catch (err) {
    console.error(JSON.stringify({ message: 'inbound triage failed', code: codeOf(err) }));
    outcome = { forwardStatus: forward.status, errorCode: forward.error || codeOf(err) };
  }
  logOutcome({
    id: outcome && outcome.id || '',
    category: outcome && outcome.category || '',
    classifier: outcome && outcome.classifier || '',
    forward: forward.status,
    issue: outcome && outcome.issueStatus || '',
    code: (outcome && outcome.errorCode) || forward.error || '',
    reason: (outcome && outcome.reason) || '',
  }, deps);
  if (forward.status !== 'sent' && forward.error !== 'not_forwardable') {
    const error = new Error('inbound forward failed');
    error.code = forward.error || 'forward_failed';
    throw error;
  }
  return { forward, outcome };
}

export function handleFetch(request, env, deps) {
  return handleReviewRequest(request, env, deps);
}

export default {
  async email(message, env) {
    await handleInboundEmail(message, env);
  },
  fetch(request, env) {
    return handleFetch(request, env);
  },
};
