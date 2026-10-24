// Rewrites site/wrangler.jsonc for one Pages deploy.
// When D1_DATABASE_ID is set, the placeholder is replaced in the checkout copy.
// When it is unset, the D1 binding is removed so the rest of the site can still deploy.
// This file never prints the database id.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function preparePagesConfig(source, env = {}) {
  if (!source.includes('REPLACE_WITH_D1_DATABASE_ID')) {
    throw new Error('wrangler config is missing the D1 id placeholder');
  }
  const id = String(env.D1_DATABASE_ID || '').trim();
  if (!id) {
    const block = /[ \t]*"d1_databases": \[[\s\S]*?\],\r?\n/;
    if (!block.test(source)) throw new Error('could not find the d1_databases block');
    const config = source.replace(block, '');
    if (config.includes('d1_databases') || config.includes('REPLACE_WITH_D1_DATABASE_ID')) {
      throw new Error('could not remove the D1 binding');
    }
    return { config, bound: false };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('D1_DATABASE_ID must be a UUID');
  }
  return { config: source.replaceAll('REPLACE_WITH_D1_DATABASE_ID', id), bound: true };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/prepare-pages-config.mjs <wrangler.jsonc>');
    process.exit(1);
  }
  try {
    const { config, bound } = preparePagesConfig(readFileSync(file, 'utf8'), process.env);
    writeFileSync(file, config);
    if (bound) console.log('D1 binding id applied for this deploy.');
    else console.log('::warning::D1_DATABASE_ID is not set. This deploy has no intake database binding, so booking requests will not be stored. See the README setup.');
  } catch (err) {
    console.error(err && err.message ? err.message : 'could not prepare the Pages config');
    process.exit(1);
  }
}
