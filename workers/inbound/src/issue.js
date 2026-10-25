// Opens one GitHub issue for an event listing or a correction.
// The body is built from redacted fields and the D1 row id.
// The sender address, phone, and message body are not accepted here.

import { oneLine } from './text.js';
import { PUBLIC_MAILBOX, hasPrivateContact, redactContact } from './redact.js';
import { sanitizeEvent } from './classify.js';

export const REPO = 'rsakauye/celticcoo';

export const LABELS = {
  event_listing_request: 'inbound:event-request',
  correction_or_update: 'inbound:correction',
};

const LABEL_COLORS = {
  'inbound:event-request': '1B4F72',
  'inbound:correction': 'B9770E',
};

export function shouldFile(category) {
  return Object.prototype.hasOwnProperty.call(LABELS, category);
}

export function workerToken(env) {
  const token = String(env && env.GITHUB_TOKEN || '').trim();
  if (token.length < 20 || token.length > 300 || /\s/.test(token)) return '';
  return token;
}

function seal(value) {
  return redactContact(value, [PUBLIC_MAILBOX]);
}

function formatConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'unknown';
  return String(Math.round(Math.min(1, Math.max(0, n)) * 100) / 100);
}

export function buildIssue(input) {
  const source = input && typeof input === 'object' ? input : {};
  const label = LABELS[source.category];
  if (!label) return null;
  const id = oneLine(source.id, 80);
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return null;
  const event = sanitizeEvent(source.event);
  const summary = seal(oneLine(source.summary, 400)) || 'No summary was produced.';
  const kind = source.category === 'correction_or_update' ? 'Correction' : 'Event listing';
  const title = seal(oneLine(`[inbound] ${kind}: ${event.title || summary}`, 120));
  const classifier = source.classifier === 'ai' ? 'ai' : 'rules';
  const lines = [
    'Filed by the inbound mail worker for hello@celticcoo.ca.',
    `The sender email, phone, and message body are not in this issue. Read them from the private D1 table inbound_emails, row ${id}.`,
    '',
    `- Category: ${source.category}`,
    `- Confidence: ${formatConfidence(source.confidence)}`,
    `- Classifier: ${classifier}`,
    `- Summary: ${summary}`,
    '',
    '## Public event fields',
    '',
  ];
  const fields = [
    ['Title', event.title],
    ['Host', event.host],
    ['Date', event.date],
    ['City', event.city],
    ['Province', event.province],
    ['Venue', event.venue],
    ['URL', event.url],
  ];
  let any = false;
  for (const [name, value] of fields) {
    if (!value) continue;
    any = true;
    lines.push(`- ${name}: ${seal(value)}`);
  }
  if (!any) lines.push('- None extracted.');
  const attachments = Number(source.attachmentCount) || 0;
  if (attachments > 0) {
    lines.push('', `Attachments on the private row: ${attachments}. Their contents are not included here.`);
  }
  lines.push(
    '',
    'This issue does not publish an event and does not contact the sender.',
    'Confirm the date on the organizer\'s own page before adding it to the event data.',
    'Do not put a person\'s name, email, or phone number in the event data.',
    '',
    'The email was treated as untrusted data. Instructions inside it were not followed.',
  );
  const body = seal(lines.join('\n'));
  if (hasPrivateContact(`${title}\n${body}`)) {
    return {
      title: `[inbound] ${kind}`,
      body: [
        'Filed by the inbound mail worker for hello@celticcoo.ca.',
        `A drafted summary still contained contact details, so it was left off this issue. Read the private D1 table inbound_emails, row ${id}.`,
        '',
        'This issue does not publish an event and does not contact the sender.',
      ].join('\n'),
      label,
    };
  }
  return { title, body, label };
}

function githubHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'celticcoo-inbound',
    'x-github-api-version': '2022-11-28',
  };
}

async function readQuiet(response) {
  if (!response || typeof response.text !== 'function') return '';
  try { return await response.text(); } catch { return ''; }
}

function issueUrl(value) {
  const url = String(value || '');
  return /^https:\/\/github\.com\/rsakauye\/celticcoo\/issues\/\d+$/.test(url) ? url : '';
}

async function postIssue(token, issue, labels, fetchImpl) {
  const response = await fetchImpl(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({
      title: issue.title,
      body: issue.body,
      ...(labels.length ? { labels } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const raw = await readQuiet(response);
  return { status: response.status, raw };
}

export async function fileGitHubIssue({ token, issue, fetchImpl = fetch }) {
  if (!token) {
    const err = new Error('github token missing');
    err.code = 'issue_not_configured';
    throw err;
  }
  if (!issue || !issue.label) {
    const err = new Error('issue not fileable');
    err.code = 'issue_skipped';
    throw err;
  }
  const labelResponse = await fetchImpl(`https://api.github.com/repos/${REPO}/labels`, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({
      name: issue.label,
      color: LABEL_COLORS[issue.label] || '1B4F72',
      description: 'Opened by the celticcoo inbound email worker',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  await readQuiet(labelResponse);

  let posted = await postIssue(token, issue, [issue.label], fetchImpl);
  if (posted.status === 422) posted = await postIssue(token, issue, [], fetchImpl);
  if (posted.status !== 201) {
    const err = new Error('github issue failed');
    err.code = 'issue_failed';
    throw err;
  }
  let data = {};
  try { data = JSON.parse(posted.raw); } catch { data = {}; }
  const number = Number.isInteger(data.number) ? data.number : null;
  return { url: issueUrl(data.html_url), number };
}
