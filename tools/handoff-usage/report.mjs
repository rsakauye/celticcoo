#!/usr/bin/env node
// Handoff usage report. Node 20+, no dependencies.
// Posts or updates one comment (marker <!-- handoff-usage -->) on a handoff issue or PR,
// in the "Usage report for the GrokBot PMO" block format. Times are Mountain Time.
// Reads GITHUB_TOKEN from the environment and never prints it.
//
// CI:     node tools/handoff-usage/report.mjs --issue 12 --stage "Claude run started"
// Local:  node tools/handoff-usage/report.mjs --issue 12 --local --stage "Claude handing back"
// Dry:    add --dry-run to print the comment instead of posting it.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  countClaudeRuns,
  countJules,
  findUsageComment,
  formatComment,
  parseBudget,
} from './lib.mjs';

export const DEFAULT_SNAPSHOT = join(homedir(), '.claude', 'handoff-usage.json');
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const MAX_PAGES = 10;

function fail(msg) {
  console.error(`handoff-usage: ${msg}`);
  process.exit(1);
}

async function gh(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'handoff-usage',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return { notFound: true, data: null };
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} returned ${res.status}`);
  return { notFound: false, data: res.status === 204 ? null : await res.json() };
}

async function paged(token, path, pick) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const sep = path.includes('?') ? '&' : '?';
    const { notFound, data } = await gh(token, 'GET', `${path}${sep}per_page=100&page=${page}`);
    if (notFound) return null;
    const items = pick(data);
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

async function readSnapshot(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      issue: { type: 'string' },
      repo: { type: 'string' },
      stage: { type: 'string', default: 'handoff' },
      local: { type: 'boolean', default: false },
      snapshot: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const repo = values.repo || process.env.GITHUB_REPOSITORY;
  const issue = values.issue || process.env.ISSUE_NUMBER;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) fail('set --repo owner/name or GITHUB_REPOSITORY');
  if (!issue || !/^\d+$/.test(issue)) fail('set --issue <number> or ISSUE_NUMBER');
  if (!token) fail('GITHUB_TOKEN is not set');

  const now = Date.now();
  const workflow = process.env.CLAUDE_WORKFLOW || 'claude.yml';
  const since7d = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
  const since24h = new Date(now - 24 * 3600 * 1000).toISOString();

  const runs =
    (await paged(
      token,
      `/repos/${repo}/actions/workflows/${workflow}/runs?created=${encodeURIComponent(`>=${since7d}`)}`,
      (d) => d.workflow_runs ?? [],
    )) ?? [];
  const recentJules =
    (await paged(token, `/repos/${repo}/issues?labels=jules&state=all&since=${since24h}`, (d) => d)) ?? [];
  const openJules =
    (await paged(token, `/repos/${repo}/issues?labels=jules&state=open`, (d) => d)) ?? [];
  const jules = {
    last24h: countJules(recentJules, now).last24h,
    open: countJules(openJules, now).open,
  };

  const local = values.local ? await readSnapshot(values.snapshot || DEFAULT_SNAPSHOT) : null;
  const body = formatComment({
    nowMs: now,
    stage: values.stage,
    plan: process.env.CLAUDE_PLAN,
    model: process.env.CLAUDE_MODEL,
    claude: countClaudeRuns(runs, now),
    jules,
    budgets: {
      five: parseBudget(process.env.CLAUDE_RUNS_5H_BUDGET),
      week: parseBudget(process.env.CLAUDE_RUNS_7D_BUDGET),
    },
    local,
  });

  if (values['dry-run']) {
    console.log(body);
    return;
  }

  const comments = (await paged(token, `/repos/${repo}/issues/${issue}/comments`, (d) => d)) ?? [];
  const existing = findUsageComment(comments);
  if (existing) {
    await gh(token, 'PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body });
    console.log(`handoff-usage: updated comment on #${issue}`);
  } else {
    await gh(token, 'POST', `/repos/${repo}/issues/${issue}/comments`, { body });
    console.log(`handoff-usage: added comment on #${issue}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => fail(err.message));
}
