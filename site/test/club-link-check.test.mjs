import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadConfigFile } from '../../link-check/src/config.js';

const repo = new URL('../../', import.meta.url);

test('the weekly workflow matches the Celtic Coo link-check config and stays on GITHUB_TOKEN', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('link-check/sites/celticcoo.json', repo), 'utf8'));
  const config = loadConfigFile('link-check/sites/celticcoo.json', repo.pathname);
  const workflow = fs.readFileSync(new URL('.github/workflows/club-link-check.yml', repo), 'utf8');

  assert.equal(config.urlField, 'website');
  assert.equal(config.idField, 'name');
  assert.equal(config.idMode, 'slug');
  assert.equal(config.outputPathLabel, 'data/groups_link_status.json');
  assert.equal(config.prTitle, 'Weekly club link check');
  assert.equal(config.concurrency, 4);
  assert.match(config.userAgent, /CelticCooBot/);
  assert.match(config.userAgent, /celticcoo\.ca/);
  assert.doesNotMatch(config.userAgent, /^Mozilla/i);

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, new RegExp(`cron:\\s*"${raw.schedule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(workflow, new RegExp(raw.branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(workflow, new RegExp(raw.outputPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(workflow, new RegExp(raw.git.name));
  assert.match(workflow, new RegExp(raw.git.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /pull-requests:\s*write/);
  assert.match(workflow, /--dry-run does not|node link-check\/src\/cli\.js --config link-check\/sites\/celticcoo\.json --report/);
  assert.match(workflow, /--open-pr/);

  const secrets = [...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(secrets)], ['GITHUB_TOKEN']);
  const uses = [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
  assert.deepEqual(uses, [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1',
  ]);
  assert.match(workflow, /file="data\/groups_link_status\.json"/);
  const adds = [...workflow.matchAll(/git add[^\n]*/g)].map((match) => match[0]);
  assert.deepEqual(adds, ['git add -- "$file"']);
  assert.doesNotMatch(workflow, /git push[^\n]*\bmain\b/);
  assert.match(workflow, /HEAD:\$\{branch\}|HEAD:bot\/weekly-club-link-check/);
});
