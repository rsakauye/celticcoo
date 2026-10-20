#!/usr/bin/env node
// IndexNow ping (no deps). Submits only URLs that are new or whose <lastmod> moved forward since the live sitemap.
//   node scripts/indexnow.mjs --snapshot   run BEFORE deploy: saves the live sitemap to .indexnow-prev.xml
//   node scripts/indexnow.mjs              run AFTER deploy: diffs site/dist/sitemap.xml against that snapshot
//   node scripts/indexnow.mjs --all        submit every URL (one-off, e.g. after a big redesign)
//   --dry-run                              print what would be sent, send nothing
// Without a snapshot it falls back to URLs whose lastmod is today (America/Edmonton).
// Never exits non-zero, so it cannot fail a build or deploy.
import { readFile, writeFile } from "node:fs/promises";
const HOST = "celticcoo.ca";
const KEY = "e89cfa1ef4b4ab49b0e9814fdf7e5536";
const SNAP = new URL("../.indexnow-prev.xml", import.meta.url);
const args = new Set(process.argv.slice(2));
const parse = (xml) => new Map([...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => [
  (m[1].match(/<loc>(.*?)<\/loc>/) || [])[1], (m[1].match(/<lastmod>(.*?)<\/lastmod>/) || [])[1] || "",
]).filter(([loc]) => loc));
try {
  if (args.has("--snapshot")) {
    const res = await fetch(`https://${HOST}/sitemap.xml`, { headers: { "cache-control": "no-cache" } });
    if (!res.ok) throw new Error(`live sitemap HTTP ${res.status}`);
    const xml = await res.text();
    await writeFile(SNAP, xml);
    console.log(`IndexNow: saved live sitemap snapshot (${parse(xml).size} URLs)`);
    process.exit(0);
  }
  const cur = parse(await readFile(new URL("../site/dist/sitemap.xml", import.meta.url), "utf8"));
  let prev = null;
  try { prev = parse(await readFile(SNAP, "utf8")); } catch {}
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton" }).format(new Date());
  let urls, why;
  if (args.has("--all")) { urls = [...cur.keys()]; why = "all"; }
  else if (prev && prev.size) { // New URL, or lastmod moved forward. (A lastmod that moved back or vanished is not a content change.)
    urls = [...cur].filter(([loc, lm]) => !prev.has(loc) || (lm && lm > prev.get(loc))).map(([loc]) => loc); why = "new or newer lastmod vs live sitemap"; }
  else { urls = [...cur].filter(([, lm]) => lm.startsWith(today)).map(([loc]) => loc); why = `no snapshot; lastmod ${today}`; }
  console.log(`IndexNow: ${urls.length} of ${cur.size} URL(s) to submit (${why})`);
  if (args.has("--dry-run")) { urls.slice(0, 50).forEach((x) => console.log("  " + x)); process.exit(0); }
  for (let i = 0; i < urls.length; i += 10000) {
    const urlList = urls.slice(i, i + 10000);
    try {
      const res = await fetch("https://api.indexnow.org/indexnow", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
      });
      console.log(`IndexNow batch ${i / 10000 + 1}: ${urlList.length} URLs -> HTTP ${res.status}`);
    } catch (e) { console.log(`IndexNow batch failed: ${e.message}`); }
  }
} catch (e) { console.log(`IndexNow skipped: ${e.message}`); }
