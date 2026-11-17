// The weekly workflow runs `node --test link-check/test`. Node treats that
// folder as one entry point and loads this file, so it imports every test file.
// `npm test` in link-check/ uses the *.test.mjs glob and does not load this file.
import { readdirSync } from 'node:fs';

const dir = new URL('./', import.meta.url);
for (const name of readdirSync(dir).filter((n) => n.endsWith('.test.mjs')).sort()) {
  await import(new URL(name, dir).href);
}
