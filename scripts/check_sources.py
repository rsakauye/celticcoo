#!/usr/bin/env python3
"""Weekly source re-check for The Celtic Coo.

Fetches every calendar/list URL in data/sources_and_orgs.csv plus every event source_url in
data/events_2027*.json, and compares each page with the last snapshot in data/source_state.json:

  * HTTP status / reachability changes
  * the set of dates mentioned on the page (e.g. "July 30-31, 2027", "30 July 2027", "2027-07-30")
  * whether each confirmed event's start date can still be found on its source page
  * a hash of the visible text (minor changes are listed but don't open an issue on their own)

If anything significant changed, it writes a Markdown report and (with --open-issue and a
GITHUB_TOKEN) opens a GitHub issue labelled "source-check", or comments on the open one, so a
human reviews dates before they are published. Standard library only.

Usage: python scripts/check_sources.py [--open-issue] [--report report.md] [--no-save]
"""
import argparse, csv, datetime as dt, hashlib, html, json, os, re, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
STATE = DATA / "source_state.json"
UA = "CelticCooBot/0.1 (+https://celticcoo.ca/about/; weekly date check)"
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
MON_RE = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?"
DAY_RE = r"(\d{1,2})(?:st|nd|rd|th)?"
RANGE_RE = r"(?:\s*(?:-|–|—|to|&|and)\s*(?:" + MON_RE + r"\s+)?" + DAY_RE + r")?"
YEAR_RE = r"(?:,?\s+(20\d\d))?"
MD = re.compile(r"\b" + MON_RE + r"\s+" + DAY_RE + RANGE_RE + YEAR_RE + r"\b", re.I)
DM = re.compile(r"\b" + DAY_RE + r"(?:\s*(?:-|–)\s*" + DAY_RE + r")?\s+(?:of\s+)?" + MON_RE + YEAR_RE + r"\b", re.I)
ISO = re.compile(r"\b(20\d\d)-(\d\d)-(\d\d)\b")


def mon(s):
    return s[:3].lower()


def visible_text(raw):
    raw = re.sub(r"(?is)<(script|style|noscript|svg|template)\b.*?</\1>", " ", raw)
    raw = re.sub(r"(?is)<!--.*?-->", " ", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", html.unescape(raw)).strip()


def date_mentions(text):
    out = set()
    for m in MD.finditer(text):
        m1, d1, m2, d2, y = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        if not 1 <= int(d1) <= 31:
            continue
        s = f"{mon(m1)} {int(d1)}"
        if d2 and 1 <= int(d2) <= 31:
            s += f"-{mon(m2) + ' ' if m2 else ''}{int(d2)}"
        out.add(s + (f" {y}" if y else ""))
    for m in DM.finditer(text):
        d1, d2, m1, y = m.group(1), m.group(2), m.group(3), m.group(4)
        if not 1 <= int(d1) <= 31:
            continue
        s = f"{mon(m1)} {int(d1)}" + (f"-{int(d2)}" if d2 else "")
        out.add(s + (f" {y}" if y else ""))
    for m in ISO.finditer(text):
        out.add(f"{MONTHS[int(m.group(2)) - 1] if 1 <= int(m.group(2)) <= 12 else '?'} {int(m.group(3))} {m.group(1)}")
    return sorted(out)


def date_on_page(iso, text):
    """True if the event's start date appears in a common written form."""
    y, m, d = iso.split("-")
    mi, di = int(m), int(d)
    t = text.lower()
    full = dt.date(int(y), mi, di).strftime("%B").lower()
    pats = [
        rf"\b({MONTHS[mi-1]}|{full})\.?\s+{di}(st|nd|rd|th)?\b",
        rf"\b{di}(st|nd|rd|th)?\s+(of\s+)?({MONTHS[mi-1]}|{full})\b",
        rf"\b{y}-{m}-{d}\b",
        rf"\b{mi}/{di}/{y}\b|\b{di}/{mi}/{y}\b",
    ]
    return any(re.search(p, t) for p in pats)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*;q=0.8", "Accept-Language": "en-CA,en;q=0.8"})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read(3_000_000).decode(r.headers.get_content_charset() or "utf-8", "replace")
                return {"status": r.status, "text": visible_text(body)}
        except urllib.error.HTTPError as e:
            res = {"status": e.code, "text": ""}
        except Exception as e:  # network errors, timeouts, TLS
            res = {"status": f"error: {type(e).__name__}", "text": ""}
        time.sleep(3)
    return res


def load_targets():
    targets = {}
    with open(DATA / "sources_and_orgs.csv", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            url = (row.get("calendar_or_list_url") or "").strip()
            if url.startswith("http") and "COMPETITOR" not in row.get("type", ""):
                targets.setdefault(url, {"labels": [], "events": []})["labels"].append(row["name"])
    for fname, confirmed in (("events_2027.json", True), ("events_2027_pending.json", False)):
        for e in json.loads((DATA / fname).read_text(encoding="utf-8")):
            url = e.get("source_url", "").strip()
            if not url.startswith("http"):
                continue
            t = targets.setdefault(url, {"labels": [], "events": []})
            t["events"].append({"name": e["name"], "start_date": e.get("start_date", ""), "confirmed": confirmed})
    return targets


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--open-issue", action="store_true", help="open/comment a GitHub issue when significant changes are found")
    ap.add_argument("--report", default="source-check-report.md")
    ap.add_argument("--no-save", action="store_true")
    args = ap.parse_args()

    targets = load_targets()
    old = json.loads(STATE.read_text()) if STATE.exists() else {}
    baseline = not old
    with ThreadPoolExecutor(max_workers=6) as ex:
        results = dict(zip(targets, ex.map(fetch, targets)))

    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    new_state, significant, minor, unconfirmed = {}, [], [], []
    for url, meta in targets.items():
        r = results[url]
        ok = r["status"] == 200 and len(r["text"]) > 200
        prev = old.get("pages", {}).get(url)
        rec = {
            "labels": meta["labels"],
            "status": r["status"],
            "checked_at": now,
            "sha256": hashlib.sha256(r["text"].encode()).hexdigest() if ok else (prev or {}).get("sha256"),
            "length": len(r["text"]) if ok else (prev or {}).get("length"),
            "dates": date_mentions(r["text"]) if ok else (prev or {}).get("dates", []),
            "events": {},
        }
        for ev in meta["events"]:
            if ev["confirmed"] and re.match(r"\d{4}-\d\d-\d\d$", ev["start_date"]):
                rec["events"][ev["name"]] = date_on_page(ev["start_date"], r["text"]) if ok else (prev or {}).get("events", {}).get(ev["name"])
        new_state[url] = rec
        names = ", ".join(meta["labels"] + [e["name"] for e in meta["events"]][:4]) or url
        for name, found in rec["events"].items():
            if found is False:
                unconfirmed.append((name, url))
        if prev is None:
            continue
        msgs = []
        # Bot challenges / timeouts come and go, so only a "page gone" status counts as significant.
        if r["status"] in (404, 410) and prev.get("status") not in (404, 410):
            msgs.append(f"page now returns `{r['status']}` (moved or removed?)")
        if ok:
            added = sorted(set(rec["dates"]) - set(prev.get("dates", [])))
            removed = sorted(set(prev.get("dates", [])) - set(rec["dates"]))
            if added or removed:
                msgs.append("dates on page changed: " + "; ".join(
                    ([f"added {', '.join(added[:12])}{' …' if len(added) > 12 else ''}"] if added else []) +
                    ([f"removed {', '.join(removed[:12])}{' …' if len(removed) > 12 else ''}"] if removed else [])))
            for name, found in rec["events"].items():
                was = prev.get("events", {}).get(name)
                if was is True and found is False:
                    msgs.append(f"**{name}**: our start date is no longer found on this page")
                elif was is False and found is True:
                    msgs.append(f"{name}: our start date now appears on this page")
        if msgs:
            significant.append((names, url, msgs))
        elif ok and prev.get("sha256") and prev["sha256"] != rec["sha256"]:
            minor.append((names, url, prev.get("length"), rec["length"]))

    lines = [f"# Weekly source check ({now})", ""]
    if baseline:
        lines += ["First run: saved a baseline snapshot. Future runs compare against it.", ""]
    lines += [f"Checked {len(targets)} pages. Significant changes: {len(significant)}. Minor text-only changes: {len(minor)}.", ""]
    if significant:
        lines += ["## Review before publishing", "Open each page, confirm the date, then update `data/events_2027*.json`.", ""]
        for names, url, msgs in significant:
            lines.append(f"- [{names}]({url})")
            lines += [f"  - {m}" for m in msgs]
        lines.append("")
    if minor:
        lines += ["<details><summary>Minor text-only changes (no date changes detected)</summary>", ""]
        lines += [f"- [{n}]({u}) ({a} → {b} chars)" for n, u, a, b in minor]
        lines += ["", "</details>", ""]
    if unconfirmed:
        lines += ["<details><summary>Confirmed events whose start date isn't visible on the source page (JS-rendered page or needs a look)</summary>", ""]
        lines += [f"- {n}: {u}" for n, u in unconfirmed]
        lines += ["", "</details>", ""]
    errors = [(u, s["status"]) for u, s in new_state.items() if s["status"] != 200]
    if errors:
        lines += ["<details><summary>Pages that didn't load this run</summary>", ""]
        lines += [f"- {u}: `{s}`" for u, s in errors]
        lines += ["", "</details>", ""]
    report = "\n".join(lines)
    Path(args.report).write_text(report, encoding="utf-8")
    print(report)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(report + "\n")

    if not args.no_save:
        STATE.write_text(json.dumps({"updated_at": now, "pages": new_state}, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")

    if significant and args.open_issue:
        open_issue(report, len(significant))
    return 0


def gh(method, path, body=None):
    token, repo = os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"]
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                                          "X-GitHub-Api-Version": "2022-11-28", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"null")


def open_issue(report, n):
    if not os.environ.get("GITHUB_TOKEN"):
        print("GITHUB_TOKEN not set; skipping issue", file=sys.stderr)
        return
    report = report[:60000]
    existing = gh("GET", "/issues?state=open&labels=source-check&per_page=1")
    if existing:
        gh("POST", f"/issues/{existing[0]['number']}/comments", {"body": report})
        print(f"Commented on issue #{existing[0]['number']}")
    else:
        today = dt.date.today().isoformat()
        issue = gh("POST", "/issues", {"title": f"Source check {today}: {n} page(s) need a date review",
                                        "body": report, "labels": ["source-check"]})
        print(f"Opened issue #{issue['number']}")


if __name__ == "__main__":
    sys.exit(main())
