// Real "last changed" dates for the sitemap (and IndexNow), instead of stamping every URL with the build date.
//  - Event pages: the date of the commit where that event's entry in data/events_2027.json last changed.
//  - Other pages: the last commit that touched the page's source or the data it shows.
// Needs full git history (CI checks out with fetch-depth 0). On a shallow or missing history we return null
// and the sitemap omits <lastmod> rather than guessing.
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { slugify } from './data.js';

const ROOT = path.resolve(process.cwd(), '..');
const EVENTS = 'data/events_2027.json';
const ymd = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' });
const TODAY = ymd(Date.now());
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64e6 }).trim();
let ok = null;
const usable = () => { if (ok === null) { try { ok = git(['rev-parse', '--is-shallow-repository']) === 'false'; } catch { ok = false; } } return ok; };
const dirty = (paths) => { try { return git(['status', '--porcelain', '--', ...paths]) !== ''; } catch { return false; } };

export function gitDate(paths) {
  if (!usable()) return null;
  if (dirty(paths)) return TODAY; // local uncommitted edit
  try { const t = git(['log', '-1', '--format=%ct', '--', ...paths]); return t ? ymd(Number(t) * 1000) : null; } catch { return null; }
}

const byId = (list) => new Map((Array.isArray(list) ? list : []).map((e) => [slugify(`${e.name}-${e.start_date}`), JSON.stringify(e)]));
let eventDates = null;
export function eventLastmod(id) {
  if (!eventDates) {
    eventDates = new Map();
    if (usable()) {
      try {
        const cur = byId(JSON.parse(fs.readFileSync(path.join(ROOT, EVENTS), 'utf8')));
        const dirtyNow = dirty([EVENTS]);
        const commits = git(['log', '--format=%H %ct', '--', EVENTS]).split('\n').filter(Boolean).map((l) => l.split(' '));
        const settled = new Set();
        // Walk newest -> oldest; an event's date is the oldest commit in the unbroken run where it equals today's entry.
        for (const [sha, ct] of commits) {
          let snap;
          try { snap = byId(JSON.parse(git(['show', `${sha}:${EVENTS}`]))); } catch { break; }
          for (const [k, v] of cur) {
            if (settled.has(k)) continue;
            if (snap.get(k) === v) eventDates.set(k, ymd(Number(ct) * 1000));
            else settled.add(k);
          }
          if (settled.size === cur.size) break;
        }
        // Uncommitted local edits: anything that differs from HEAD is "today".
        if (dirtyNow && commits[0]) {
          const head = byId(JSON.parse(git(['show', `${commits[0][0]}:${EVENTS}`])));
          for (const [k, v] of cur) if (head.get(k) !== v) eventDates.set(k, TODAY);
        }
      } catch { /* leave missing -> no lastmod */ }
    }
  }
  return eventDates.get(id) || null;
}
export const maxDate = (ds) => ds.filter(Boolean).sort().pop() || null;
