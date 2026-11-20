// Pure helpers for the handoff usage report. No network, no env, no tokens.

export const MARKER = '<!-- handoff-usage -->';
export const JULES_DAILY_CAP = 100;
export const JULES_CONCURRENT_CAP = 15;

const HOUR = 60 * 60 * 1000;

/** Count items whose `field` timestamp is at or after `sinceMs`. */
export function countSince(items, field, sinceMs) {
  let n = 0;
  for (const item of items) {
    const t = Date.parse(item?.[field] ?? '');
    if (Number.isFinite(t) && t >= sinceMs) n += 1;
  }
  return n;
}

/** Claude workflow runs in the last 5 hours and 7 days. Skipped runs never reached Claude. */
export function countClaudeRuns(runs, nowMs) {
  const real = runs.filter((r) => r.conclusion !== 'skipped');
  return {
    last5h: countSince(real, 'created_at', nowMs - 5 * HOUR),
    last7d: countSince(real, 'created_at', nowMs - 7 * 24 * HOUR),
  };
}

/** Jules tasks: issues (not PRs) labelled `jules`. */
export function countJules(issues, nowMs) {
  const real = issues.filter((i) => !i.pull_request);
  return {
    last24h: countSince(real, 'created_at', nowMs - 24 * HOUR),
    open: real.filter((i) => i.state === 'open').length,
  };
}

/** Optional run budgets from repo variables. Returns null when unset or invalid. */
export function parseBudget(value) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const MT = 'America/Edmonton';

/** Format a time in Mountain Time, e.g. "Wed Nov 25, 10:40 AM MT". */
export function mt(ms) {
  if (!Number.isFinite(ms)) return 'unknown';
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: MT,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
  return `${s} MT`;
}

function pct(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

function runsText(n, cap, label) {
  return cap == null ? `${n} runs in ${label}` : `${n} runs in ${label}, about ${Math.max(cap - n, 0)} of ${cap} left`;
}

/**
 * Turn a Claude Code status line payload into a small snapshot.
 * Field names follow https://code.claude.com/docs/en/statusline (rate_limits.*).
 */
export function snapshotFromStatusline(payload, nowMs) {
  const rl = payload?.rate_limits ?? {};
  const win = (w) =>
    w && pct(w.used_percentage) != null
      ? { used_percentage: pct(w.used_percentage), resets_at: w.resets_at ?? null }
      : null;
  return {
    at: new Date(nowMs).toISOString(),
    model: payload?.model?.display_name ?? null,
    five_hour: win(rl.five_hour),
    seven_day: win(rl.seven_day),
  };
}

/** One line for the local status bar. */
export function statuslineText(snap) {
  const parts = [snap.model ?? 'Claude'];
  if (snap.five_hour) parts.push(`5h ${snap.five_hour.used_percentage}%`);
  if (snap.seven_day) parts.push(`7d ${snap.seven_day.used_percentage}%`);
  return parts.join(' | ');
}

/** The Claude block, in the GrokBot PMO format. */
export function claudeBlock({ claude, budgets, local, plan, model }) {
  const runs = `${runsText(claude.last5h, budgets.five, '5h')}; ${runsText(claude.last7d, budgets.week, '7d')}`;
  let remaining;
  let resets;
  let source;
  if (local && (local.five_hour || local.seven_day)) {
    const parts = [];
    const r = [];
    if (local.five_hour) {
      parts.push(`5-hour ${100 - local.five_hour.used_percentage}% left`);
      r.push(`5-hour ${mt(local.five_hour.resets_at * 1000)}`);
    }
    if (local.seven_day) {
      parts.push(`weekly ${100 - local.seven_day.used_percentage}% left`);
      r.push(`weekly ${mt(local.seven_day.resets_at * 1000)}`);
    }
    remaining = `${parts.join(', ')} (${runs})`;
    resets = r.join('; ');
    source = `Claude Code status line, ${mt(Date.parse(local.at))}; run counts from this repo's Actions`;
  } else {
    remaining = `Pro limits not readable from CI, Russell checks /usage (${runs})`;
    resets = 'unknown from CI, see /usage';
    source = "this repo's claude.yml runs (GitHub Actions)";
  }
  return [
    'Usage report for the GrokBot PMO',
    'tool: Claude Code',
    `plan: ${plan || 'Claude Pro'}`,
    `model: ${model || local?.model || 'Action default'}`,
    `remaining: ${remaining}`,
    `resets (MT): ${resets}`,
    `source: ${source}`,
  ].join('\n');
}

/** The Jules block, in the GrokBot PMO format. */
export function julesBlock(jules) {
  return [
    'Usage report for the GrokBot PMO',
    'tool: Jules',
    'plan: Google AI Pro',
    'model: Jules default',
    `remaining: ${Math.max(JULES_DAILY_CAP - jules.last24h, 0)} of ${JULES_DAILY_CAP} tasks today, ${Math.max(JULES_CONCURRENT_CAP - jules.open, 0)} of ${JULES_CONCURRENT_CAP} concurrent slots free`,
    'resets (MT): rolling 24 hours',
    "source: issues labelled jules in this repo",
  ].join('\n');
}

/**
 * Markdown body of the single usage comment. No em dashes.
 * @param {object} o
 * @param {number} o.nowMs
 * @param {string} o.stage e.g. "Claude run started"
 * @param {{last5h:number,last7d:number}} o.claude
 * @param {{last24h:number,open:number}|null} o.jules
 * @param {{five:number|null,week:number|null}} o.budgets
 * @param {object|null} o.local snapshot from snapshotFromStatusline
 * @param {string} [o.plan]
 * @param {string} [o.model]
 */
export function formatComment(o) {
  const fence = '```';
  const lines = [MARKER, `[Claude] Usage at handoff: ${o.stage}. Updated ${mt(o.nowMs)}.`, '', fence, claudeBlock(o), fence];
  if (o.jules && (o.jules.last24h > 0 || o.jules.open > 0)) {
    lines.push('', fence, julesBlock(o.jules), fence);
  }
  lines.push('', '_Best effort. Counts come from this repo only._');
  return lines.join('\n');
}

/** Find the existing usage comment, if any. */
export function findUsageComment(comments) {
  return comments.find((c) => typeof c?.body === 'string' && c.body.includes(MARKER)) ?? null;
}
