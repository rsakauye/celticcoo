#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfigFile } from './config.js';
import { readStatus, runCheck, serializeStatus } from './check.js';
import { renderReport } from './report.js';
import { openOrUpdatePullRequest } from './github.js';

export function parseArgs(argv) {
  const args = { dryRun: false, openPr: false, config: null, report: null, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') args.dryRun = true;
    else if (token === '--open-pr') args.openPr = true;
    else if (token === '--config') args.config = argv[++i];
    else if (token === '--report') args.report = argv[++i];
    else if (token === '--limit') args.limit = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.config) throw new Error('--config is required');
  if (args.dryRun && args.openPr) throw new Error('--dry-run does not open a pull request');
  if (args.openPr && !args.report) throw new Error('--open-pr needs --report');
  if (args.limit != null && (!Number.isInteger(args.limit) || args.limit < 1)) throw new Error('--limit must be a positive integer');
  if (args.limit != null && !args.dryRun) throw new Error('--limit is only allowed with --dry-run');
  return args;
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const args = parseArgs(argv);
  const cwd = io.cwd || process.cwd();
  const config = loadConfigFile(args.config, cwd);
  const fetchImpl = io.fetchImpl || fetch;
  if (args.openPr) {
    const body = fs.readFileSync(path.resolve(cwd, args.report), 'utf8');
    const token = io.token ?? process.env.GITHUB_TOKEN;
    const repository = io.repository ?? process.env.GITHUB_REPOSITORY;
    const result = await openOrUpdatePullRequest({
      token,
      repository,
      branch: config.branch,
      base: config.base,
      title: config.prTitle,
      body,
      fetchImpl,
    });
    console.log(`${result.action} ${result.url}`);
    return result;
  }

  const sourceText = fs.readFileSync(config.dataPath, 'utf8');
  const records = JSON.parse(sourceText);
  const previous = fs.existsSync(config.outputPath)
    ? readStatus(JSON.parse(fs.readFileSync(config.outputPath, 'utf8')))
    : readStatus(null);
  const { document, summary } = await runCheck({
    records,
    config,
    fetchImpl,
    now: io.now || new Date(),
    limit: args.limit,
  });
  if (JSON.stringify(records) !== JSON.stringify(JSON.parse(sourceText))) {
    throw new Error('Source records changed while checking');
  }
  const body = renderReport({ config, previous, document, summary });
  console.log(`ok=${summary.ok} redirect=${summary.redirect} broken=${summary.broken} unreachable=${summary.unreachable} unverifiable=${summary.unverifiable} total=${summary.total}`);
  if (args.dryRun) return { summary, document, body, wrote: false };
  fs.mkdirSync(path.dirname(config.outputPath), { recursive: true });
  fs.writeFileSync(config.outputPath, serializeStatus(document));
  if (args.report) fs.writeFileSync(path.resolve(cwd, args.report), body);
  return { summary, document, body, wrote: true };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
