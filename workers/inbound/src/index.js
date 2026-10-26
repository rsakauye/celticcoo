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
// event listing or a correction, turned into a GitHub issue when both
// GITHUB_TOKEN and INBOUND_ISSUES_REPO are set. The repo must be private, and
// it must not be the public product repo. Until that var is set, issues stay off.
// No URL from the message is fetched. ACK_REPLIES still defaults to off.
// A clarifying draft is stored and shown for approval. This handler does not
// send that draft to the original sender. Approval is a POST to /review.
// A message that is only "stop" or "unsubscribe" is recorded as an opt-out.
// Further non-transactional mail to that address is not sent.
// There is no addresses field in wrangler.jsonc, so deploying this Worker does
// not change the Email Routing rule. The owner switches that in the dashboard.

import { isAutomated, maybeAcknowledge } from './ack.js';
import { classifyMessage, modelName, safeReason } from './classify.js';
import { planDraft } from './clarify.js';
import { buildIssue, fileGitHubIssue, issuesRepo, shouldFile, workerToken } from './issue.js';
import { isOptOutMessage, optOutStatus, recordOptOut } from './optout.js';
import { dedupeKey, parseInbound } from './parse.js';
import { aiNamePass, exportReason, redactOutsideD1Many } from './redact.js';
import { runRetention } from './retention.js';
import { handleReviewRequest, sendReviewNote } from './review.js';
import { markIssue, upsertInbound } from './store.js';
import { codeOf, envelopeAddress, isBookingsRecipient, isHelloRecipient, oneEmail, oneLine } from './text.js';

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

function namePassFor(env, deps) {
  if (typeof deps.namePass === 'function') return deps.namePass;
  const ai = env && env.AI;
  if (!ai || typeof ai.run !== 'function') return null;
  const run = ai.run;
  return (text) => aiNamePass(text, (model, payload) => run.call(ai, model, payload), modelName(env));
}

async function issueFields(classification, env, deps) {
  const event = classification.event || {};
  const pass = namePassFor(env, deps);
  const [summary, title, host] = await redactOutsideD1Many(
    [classification.summary, event.title, event.host],
    pass ? { namePass: pass } : {},
  );
  return { summary, event: { ...event, title, host } };
}

async function fileIfNeeded({ saved, classification, parsed, draft, forward, env, deps }) {
  const canFile = forward.status === 'sent' || forward.error === 'not_forwardable';
  if (!canFile || !shouldFile(classification.category) || saved.issueStatus === 'filed') {
    return { issueStatus: saved.issueStatus || 'skipped', issueUrl: saved.issueUrl || '', errorCode: '' };
  }
  const token = workerToken(env);
  const repo = issuesRepo(env);
  if (!token || !repo) {
    try { await markIssue(env.INTAKE_DB, saved.id, 'failed', '', null, 'issue_not_configured'); } catch { /* logged below */ }
    return { issueStatus: 'failed', issueUrl: '', errorCode: 'issue_not_configured' };
  }
  const exported = await issueFields(classification, env, deps);
  const issue = buildIssue({
    id: saved.id,
    category: classification.category,
    confidence: classification.confidence,
    summary: exported.summary,
    event: exported.event,
    classifier: classification.classifier,
    attachmentCount: parsed.attachmentCount,
    clarifyStatus: draft ? draft.status : '',
    clarifyDraft: draft ? draft.draft : '',
    clarifyReasons: draft ? draft.reasons : [],
  });
  if (!issue) return { issueStatus: 'skipped', issueUrl: '', errorCode: '' };
  try {
    const filed = await fileGitHubIssue({
      token,
      repo,
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

async function rememberOptOut(env, emails, createdAt) {
  const seen = new Set();
  for (const value of emails) {
    const email = oneEmail(envelopeAddress(value));
    if (!email || seen.has(email)) continue;
    seen.add(email);
    try {
      await recordOptOut(env && env.INTAKE_DB, email, createdAt);
    } catch (err) {
      console.error(JSON.stringify({
        message: 'opt-out record failed',
        code: codeOf(err) === 'error' ? 'opt_out_store_failed' : codeOf(err),
      }));
    }
  }
}

async function processHello(message, env, deps, forward) {
  const now = deps.now ? deps.now() : new Date();
  const createdAt = now.toISOString();
  const parsed = typeof deps.parse === 'function'
    ? await deps.parse(message, now)
    : await parseInbound(message, now);
  const optingOut = isOptOutMessage(parsed.subject, parsed.text);
  const sender = oneEmail(parsed.replyTo) || oneEmail(envelopeAddress(message.from));
  if (optingOut) await rememberOptOut(env, [message.from, parsed.replyTo], createdAt);
  const stopStatus = optingOut ? 'opted_out' : await optOutStatus(env && env.INTAKE_DB, sender);
  const classification = typeof deps.classify === 'function'
    ? await deps.classify(parsed, env)
    : await classifyMessage({ subject: parsed.subject, text: parsed.text }, env, deps);
  const draft = stopStatus === 'opted_out' ? null : planDraft({
    category: classification.category,
    event: classification.event,
    subject: parsed.subject,
    text: parsed.text,
    now,
    env,
    automated: isAutomated(message),
  });
  const key = await dedupeKey(message, parsed.subject);
  const errorCode = [forward.error, parsed.parseError, optingOut ? 'opt_out' : ''].filter(Boolean).join(',') || '';
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
    classifierReason: safeReason(
      classification.detailSlug
        ? `${classification.reason}:${classification.detailSlug}`
        : classification.reason,
    ),
    clarifyStatus: draft ? draft.status : '',
    clarifyDraft: draft ? draft.draft : '',
    clarifyReasons: draft ? draft.reasons.join(',') : '',
    forwardStatus: forward.status,
    issueStatus: 'skipped',
    errorCode: oneLine(errorCode, 80),
    rawSize: Number(message.rawSize) || 0,
  };
  const saved = await upsertInbound(env && env.INTAKE_DB, row);
  const issue = optingOut
    ? { issueStatus: 'skipped', issueUrl: '', errorCode: 'opt_out' }
    : await fileIfNeeded({ saved, classification, parsed, draft, forward, env, deps });
  let reviewStatus = '';
  if (draft) {
    const review = await sendReviewNote(env, {
      id: saved.id,
      category: classification.category,
      reasons: draft.reasons,
      draft: draft.draft,
      recipient: oneEmail(parsed.replyTo) || oneEmail(envelopeAddress(message.from)),
      forwardStatus: forward.status,
    }, deps);
    reviewStatus = review.status;
  }
  if (forward.status === 'sent' && stopStatus === 'allowed') {
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
      if (isBookingsRecipient(message && message.to)) {
        const now = deps.now ? deps.now() : new Date();
        let parsed = null;
        try {
          parsed = typeof deps.parse === 'function'
            ? await deps.parse(message, now)
            : await parseInbound(message, now);
        } catch {
          parsed = null;
        }
        if (parsed && isOptOutMessage(parsed.subject, parsed.text)) {
          await rememberOptOut(env, [message.from, parsed.replyTo], now.toISOString());
          outcome = {
            skipped: 'opt_out',
            forwardStatus: forward.status,
            errorCode: [forward.error, 'opt_out'].filter(Boolean).join(','),
          };
        } else {
          outcome = { skipped: 'not_hello', forwardStatus: forward.status, errorCode: forward.error };
        }
      } else {
        outcome = { skipped: 'not_hello', forwardStatus: forward.status, errorCode: forward.error };
      }
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
    reason: exportReason((outcome && outcome.reason) || ''),
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

export async function handleScheduled(env, deps = {}) {
  const log = typeof deps.log === 'function' ? deps.log : console.log;
  const now = deps.now ? deps.now() : new Date();
  try {
    return await runRetention(env && env.INTAKE_DB, env, now, log);
  } catch {
    log(JSON.stringify({ message: 'retention failed', code: 'retention_failed' }));
    return { mode: 'dry_run', error: 'retention_failed', counts: {} };
  }
}

export default {
  async email(message, env) {
    await handleInboundEmail(message, env);
  },
  fetch(request, env) {
    return handleFetch(request, env);
  },
  async scheduled(_event, env) {
    await handleScheduled(env);
  },
};
