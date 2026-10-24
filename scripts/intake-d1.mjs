// Runs one `wrangler d1` command against celticcoo-intake.
// D1_DATABASE_ID comes from the environment. A gitignored config is deleted
// afterwards. The id is not printed.
//
// Example (do not select name, email, phone, or message onto a shared screen):
//   node scripts/intake-d1.mjs execute --command "SELECT id, status, risk_flags, email_status, created_at FROM submissions ORDER BY created_at DESC LIMIT 20;"

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const id = String(process.env.D1_DATABASE_ID || '').trim();
const args = process.argv.slice(2);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
  console.error('Set D1_DATABASE_ID to the UUID from `npx wrangler d1 create celticcoo-intake`. Do not commit it.');
  process.exit(1);
}
if (args[0] !== 'execute' || args.some((arg) => arg.includes(id))) {
  console.error('usage: node scripts/intake-d1.mjs execute --command "SQL"');
  process.exit(1);
}

const configPath = join(root, 'site/.wrangler-intake.jsonc');
const source = readFileSync(join(root, 'site/wrangler.jsonc'), 'utf8');
writeFileSync(configPath, source.replaceAll('REPLACE_WITH_D1_DATABASE_ID', id), { mode: 0o600 });

let status = 1;
try {
  const result = spawnSync(
    'npx',
    ['--yes', 'wrangler@4', 'd1', 'execute', 'celticcoo-intake', ...args.slice(1), '--remote', '--config', configPath],
    { cwd: join(root, 'site'), stdio: 'inherit' },
  );
  status = result.status ?? 1;
} finally {
  rmSync(configPath, { force: true });
}
process.exit(status);
