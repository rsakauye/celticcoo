#!/usr/bin/env node
// Tell IndexNow about every URL in the built sitemap. Run this after a deploy:
//   node tools/indexnow-ping.mjs
// Build first so site/dist/sitemap.xml exists. This does not run during the build.
import { readFile } from 'node:fs/promises';

const HOST = 'celticcoo.ca';
const KEY = 'e6061a0668a20a80ee0d6a79eb16ce89';
const keyLocation = `https://${HOST}/${KEY}.txt`;
const endpoint = 'https://api.indexnow.org/indexnow';

const xml = await readFile(new URL('../site/dist/sitemap.xml', import.meta.url), 'utf8');
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim()).filter(Boolean);
if (!urlList.length) {
  console.error('IndexNow: site/dist/sitemap.xml has no URLs. Build the site, then run this again.');
  process.exit(1);
}

let failed = false;
for (let i = 0; i < urlList.length; i += 10000) {
  const batch = urlList.slice(i, i + 10000);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation, urlList: batch }),
  });
  console.log(`IndexNow: sent ${batch.length} URL(s) for ${HOST}, HTTP ${res.status}`);
  if (!res.ok) failed = true;
}
if (failed) process.exit(1);
