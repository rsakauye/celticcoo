// Applies site/migrations to the private D1 database named celticcoo-intake.
// Reads D1_DATABASE_ID from the environment. Writes a gitignored config under
// site/, runs wrangler, then deletes that config. Does not print the id.

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const id = String(process.env.D1_DATABASE_ID || '').trim();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
  console.error('Set D1_DATABASE_ID to the UUID from `npx wrangler d1 create celticcoo-intake`. Do not commit it.');
  process.exit(1);
}

const configPath = join(root, 'site/.wrangler-intake.jsonc');
const source = readFileSync(join(root, 'site/wrangler.jsonc'), 'utf8');
writeFileSync(configPath, source.replaceAll('REPLACE_WITH_D1_DATABASE_ID', id), { mode: 0o600 });

let status = 1;
try {
  const result = spawnSync(
    'npx',
    ['--yes', 'wrangler@4', 'd1', 'migrations', 'apply', 'celticcoo-intake', '--remote', '--config', configPath],
    { cwd: join(root, 'site'), stdio: 'inherit' },
  );
  status = result.status ?? 1;
} finally {
  rmSync(configPath, { force: true });
}
process.exit(status);
