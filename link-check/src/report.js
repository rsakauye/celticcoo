import { formatDisplayDate } from './dates.js';
import { meaningfulChanges } from './check.js';

function isEmailChar(ch, local) {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return true;
  if (code >= 65 && code <= 90) return true;
  if (code >= 97 && code <= 122) return true;
  if (ch === '.' || ch === '_' || ch === '-') return true;
  return local && ch === '+';
}

function isEmailToken(token) {
  const at = token.indexOf('@');
  if (at <= 0 || token.indexOf('@', at + 1) !== -1) return false;
  const local = token.slice(0, at);
  const domain = token.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  if (dot <= 0 || dot > domain.length - 3) return false;
  for (const ch of local) if (!isEmailChar(ch, true)) return false;
  for (const ch of domain.slice(0, dot)) if (!isEmailChar(ch, false)) return false;
  for (const ch of domain.slice(dot + 1)) {
    const code = ch.charCodeAt(0);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) return false;
  }
  return true;
}

// Labels come from the directory. Scan them in one pass instead of a regex:
// a pattern like /[...%+-]+@.../ backtracks on a long run of "%" characters.
function redactEmails(value) {
  let out = '';
  let token = '';
  const flush = () => {
    let start = 0;
    let end = token.length;
    while (start < end && '([<\'"'.includes(token[start])) start += 1;
    while (end > start && '.,:;!?)]>\'"'.includes(token[end - 1])) end -= 1;
    const core = token.slice(start, end);
    out += isEmailToken(core) ? `${token.slice(0, start)}(redacted)${token.slice(end)}` : token;
    token = '';
  };
  for (const ch of value) {
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      flush();
      out += ch;
    } else {
      token += ch;
    }
  }
  flush();
  return out;
}

function escapeMd(value) {
  return redactEmails(String(value ?? ''))
    .replace(/[\\`*_{}[\]<>]/g, '\\$&')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function mdUrl(url) {
  const clean = String(url || '').replace(/[\s<>]/g, '');
  return clean ? `<${clean}>` : '(no url)';
}

function problemLine(entry) {
  const name = escapeMd(entry.label || entry.id);
  const from = mdUrl(entry.url);
  if (entry.final_url) return `- ${name}: ${from} -> ${mdUrl(entry.final_url)}${entry.detail ? ` (${escapeMd(entry.detail)})` : ''}`;
  const why = entry.detail ? ` (${escapeMd(entry.detail)})` : '';
  return `- ${name}: ${from}${why}`;
}

function section(title, entries) {
  if (!entries.length) return '';
  return `## ${title} (${entries.length})\n\n${entries.map(problemLine).join('\n')}\n`;
}

export function renderReport({ config, previous, document, summary }) {
  const when = formatDisplayDate(document.checked_on) || document.checked_on;
  const flagged = {
    broken: document.entries.filter((entry) => entry.last_status === 'broken'),
    unreachable: document.entries.filter((entry) => entry.last_status === 'unreachable'),
    redirect: document.entries.filter((entry) => entry.last_status === 'redirect'),
  };
  const firstRun = !previous?.checked_on;
  const changes = firstRun ? [] : meaningfulChanges(previous, document);
  const lines = [
    `Checked ${summary.total} websites on ${when}.`,
    '',
    `This pull request updates \`${config.outputPathLabel || 'the link status file'}\` only. It does not add, edit, or delete directory records. Review the list and change the directory yourself if a website should be updated.`,
    '',
  ];
  if (firstRun) {
    lines.push('First completed check. Statuses below are the current result, not a diff against an earlier run.', '');
  } else if (changes.length === 0) {
    lines.push('Only the check date changed. Statuses and final URLs are the same as the previous file.', '');
  } else {
    lines.push('## Status changes', '');
    for (const change of changes) {
      const name = escapeMd(change.label || change.id);
      if (change.change === 'added') lines.push(`- ${name}: added (${change.to})`);
      else if (change.change === 'removed') lines.push(`- ${name}: no longer in the directory data (the checker did not delete it)`);
      else lines.push(`- ${name}: ${change.from} -> ${change.to}`);
    }
    lines.push('');
  }
  const blocks = [lines.join('\n').trim()];
  const problems = flagged.broken.length + flagged.unreachable.length + flagged.redirect.length;
  if (problems === 0) {
    blocks.push('No broken, unreachable, or permanently redirected websites in this check.');
  } else {
    for (const block of [
      section('Broken', flagged.broken),
      section('Unreachable', flagged.unreachable),
      section('Permanently redirected', flagged.redirect),
    ]) {
      if (block) blocks.push(block.trim());
    }
  }
  blocks.push([
    '## Summary',
    '',
    `- ok: ${summary.ok}`,
    `- redirect: ${summary.redirect}`,
    `- broken: ${summary.broken}`,
    `- unreachable: ${summary.unreachable}`,
    `- unverifiable: ${summary.unverifiable}`,
    '',
    'HTTP 403 and 429 are recorded as unverifiable and are not listed above. That includes bot-blocking hosts such as Facebook and Instagram. A 404 on those hosts is still broken.',
  ].join('\n'));
  return `${blocks.filter(Boolean).join('\n\n')}\n`;
}
