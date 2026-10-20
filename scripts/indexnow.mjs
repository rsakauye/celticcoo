#!/usr/bin/env node
// IndexNow ping (no deps). Submits sitemap URLs with lastmod = today (America/Edmonton), or all with --all.
// Never exits non-zero, so it cannot fail a build or deploy.
import { readFile } from "node:fs/promises";
const HOST = "celticcoo.ca";
const KEY = "e89cfa1ef4b4ab49b0e9814fdf7e5536";
const all = process.argv.includes("--all");
try {
  let xml;
  try { xml = await readFile(new URL("../site/dist/sitemap.xml", import.meta.url), "utf8"); }
  catch { xml = await (await fetch(`https://${HOST}/sitemap.xml`)).text(); }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton" }).format(new Date());
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => ({
    loc: (m[1].match(/<loc>(.*?)<\/loc>/) || [])[1],
    lastmod: (m[1].match(/<lastmod>(.*?)<\/lastmod>/) || [])[1] || "",
  })).filter(u => u.loc && (all || u.lastmod.startsWith(today))).map(u => u.loc);
  console.log(`IndexNow: ${urls.length} URL(s) to submit (${all ? "all" : "lastmod " + today})`);
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
