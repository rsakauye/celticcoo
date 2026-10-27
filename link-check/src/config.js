import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BOT_HOSTS } from './urls.js';
import { isoDateInTimeZone } from './dates.js';

const REQUIRED = ['dataPath', 'urlField', 'idField', 'outputPath', 'userAgent', 'schedule'];

export function resolveConfig(raw, cwd) {
  if (!raw || typeof raw !== 'object') throw new Error('Config must be a JSON object');
  const missing = REQUIRED.filter((key) => raw[key] == null || String(raw[key]).trim() === '');
  if (missing.length) throw new Error(`Missing config: ${missing.join(', ')}`);

  const concurrency = raw.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('concurrency must be an integer from 1 to 8');
  }
  const timeoutMs = raw.timeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new Error('timeoutMs must be an integer from 1000 to 30000');
  }
  const delayMs = raw.delayMs ?? 0;
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5000) {
    throw new Error('delayMs must be an integer from 0 to 5000');
  }
  const schedule = String(raw.schedule).trim();
  if (!/^(\S+\s+){4}\S+$/.test(schedule)) throw new Error('schedule must be a 5-field cron expression');
  const userAgent = String(raw.userAgent).trim();
  if (userAgent.length < 8 || /^mozilla/i.test(userAgent)) {
    throw new Error('userAgent must name the site and must not impersonate a browser');
  }
  const idMode = raw.idMode || 'field';
  if (idMode !== 'field' && idMode !== 'slug') throw new Error('idMode must be field or slug');
  const branch = raw.branch || 'bot/weekly-link-check';
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('/') || branch.includes('..') || branch.endsWith('/')) {
    throw new Error('branch name is not safe');
  }
  const base = raw.base || 'main';
  if (!/^[A-Za-z0-9._/-]+$/.test(base)) throw new Error('base branch name is not safe');
  const timeZone = raw.timeZone || 'UTC';
  try {
    isoDateInTimeZone(new Date(), timeZone);
  } catch {
    throw new Error(`timeZone is not a valid IANA zone: ${timeZone}`);
  }
  const hosts = Array.isArray(raw.unverifiableHosts) && raw.unverifiableHosts.length
    ? raw.unverifiableHosts.map((host) => String(host).toLowerCase())
    : DEFAULT_BOT_HOSTS.slice();
  const rel = (value) => path.resolve(cwd, value);
  const outputPath = rel(raw.outputPath);
  return {
    dataPath: rel(raw.dataPath),
    outputPath,
    outputPathLabel: raw.outputPath,
    urlField: String(raw.urlField),
    idField: String(raw.idField),
    labelField: String(raw.labelField || raw.idField),
    idMode,
    schedule,
    timeZone,
    userAgent,
    concurrency,
    timeoutMs,
    delayMs,
    unverifiableHosts: hosts,
    prTitle: String(raw.prTitle || 'Weekly link check'),
    branch,
    base,
    gitName: String(raw.git?.name || 'link-check-bot'),
    gitEmail: String(raw.git?.email || '41898282+github-actions[bot]@users.noreply.github.com'),
  };
}

export function loadConfigFile(file, cwd = process.cwd()) {
  const abs = path.resolve(cwd, file);
  const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  return resolveConfig(raw, cwd);
}
