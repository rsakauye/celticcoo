import { formatDisplayDate } from './dates.js';
import { meaningfulChanges } from './check.js';

function escapeMd(value) {
  return String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '(redacted)')
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
