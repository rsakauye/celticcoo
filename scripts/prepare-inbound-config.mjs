// Rewrites the inbound Worker config so one deploy can bind celticcoo-intake.
// Reads D1_DATABASE_ID from the environment. Never prints the id.
// An optional second path writes a separate file instead of editing the source.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function prepareInboundConfig(source, env = {}) {
  if (!source.includes('REPLACE_WITH_D1_DATABASE_ID')) {
    throw new Error('wrangler config is missing the D1 id placeholder');
  }
  const id = String(env.D1_DATABASE_ID || '').trim();
  if (!UUID.test(id)) throw new Error('D1_DATABASE_ID must be a UUID');
  return source.replaceAll('REPLACE_WITH_D1_DATABASE_ID', id);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const file = process.argv[2];
  const out = process.argv[3] || file;
  if (!file) {
    console.error('usage: node scripts/prepare-inbound-config.mjs <wrangler.jsonc> [output]');
    process.exit(1);
  }
  try {
    const config = prepareInboundConfig(readFileSync(file, 'utf8'), process.env);
    writeFileSync(out, config, { mode: 0o600 });
    console.log(out === file
      ? 'D1 binding id applied for this deploy.'
      : 'Wrote a deploy config outside the committed file.');
  } catch (err) {
    console.error(err && err.message ? err.message : 'could not prepare the inbound config');
    process.exit(1);
  }
}
