#!/usr/bin/env python3
"""Weekly source re-check for The Celtic Coo.

Fetches every calendar/list URL in data/sources_and_orgs.csv plus every event source_url in
data/events_2027*.json, and compares each page with the last snapshot in data/source_state.json:

  * HTTP status / reachability changes
  * dates on the page that could still matter for the current or upcoming season
  * whether each confirmed event's start date can still be found on its source page
  * a hash of the visible text (minor changes are listed but don't open an issue on their own)

A failed read (non-200, or a short page) is not stored as "this page has no dates". Date diffs
run only against a previous successful read, or against dates carried forward from one. Page
chrome, blog publish dates, and related-article dates are ignored, as are dates that are already
in the past. If anything significant changed, it writes a Markdown report and (with --open-issue
and a GITHUB_TOKEN) opens a GitHub issue labelled "source-check", or comments on the open one, so
a human reviews dates before they are published. Standard library only.

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
MENTION_RE = re.compile(
    r"^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec) (\d{1,2})"
    r"(?:-(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec) )?(\d{1,2}))?"
    r"(?: (20\d\d))?$"
)
# Publication chrome and blog/related-article widgets. Tokens are matched whole, so
# "header-date" (a real event line on some sites) is not the same as "header-bottom".
NOISE_CLASSES = {
    "topbar", "header-bottom", "date-time",
    "posted-on", "entry-date", "entry-meta", "entry-time", "post-date", "byline",
    "wp-block-post-date", "wp-block-latest-posts",
    "t-entry", "t-entry-date", "t-entry-meta",
    "tag_date", "tag_block",
    "related-wrap", "related-post", "related-posts", "h_news-item",
}
_EMBEDDED = re.compile(r"(?is)<(script|style|noscript|template|svg)\b.*?</\1>|<!--.*?-->")
_TAG = re.compile(r"<(/?)([a-zA-Z][\w:-]*)([^>]*)>")
_CLASS = re.compile(r"""(?i)\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))""")
_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
_STATUS_ELEMENT = re.compile(
    r"(?is)<(p|span|div|li|time|h[1-6])\b[^>]*>\s*"
    r"((?:last\s+)?updated|posted(?:\s+on)?|published(?:\s+on)?)\s*:?\s+"
    r"(?:" + MON_RE + r"\s+" + DAY_RE + r"|" + DAY_RE + r"\s+(?:of\s+)?" + MON_RE + r")"
    r"(?:,?\s+20\d\d)?"
    r"\s*</\1>"
)


def mon(s):
    return s[:3].lower()


def visible_text(raw):
    raw = _EMBEDDED.sub(" ", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", html.unescape(raw)).strip()


def _noise_class(attrs):
    m = _CLASS.search(attrs or "")
    if not m:
        return False
    classes = (m.group(1) or m.group(2) or m.group(3) or "").split()
    return any(c.lower() in NOISE_CLASSES for c in classes)


# A blog card or related-article widget is short. A layout wrapper with the same class
# name can enclose the whole schedule; leave those alone so event dates stay visible.
_NOISE_TEXT_LIMIT = 4000


def _matching_end(tags, start_i, tag):
    """End offset of the element opened by tags[start_i], counting only the same tag name."""
    depth = 1
    for m in tags[start_i + 1:]:
        if m.group(2).lower() != tag:
            continue
        attrs = m.group(3) or ""
        if tag in _VOID or attrs.rstrip().endswith("/"):
            continue
        if m.group(1):
            depth -= 1
            if depth == 0:
                return m.end()
        else:
            depth += 1
    return None


def strip_noise_html(raw):
    """Drop publication chrome and blog/related widgets.

    Tags stay in the page (visible_text turns them into spaces) so a year that sits in its
    own element is not glued to the day. An unclosed widget is left in place. A match that
    contains a long stretch of text is treated as a layout wrapper, not a date chip.
    """
    raw = _EMBEDDED.sub(" ", raw)
    raw = _STATUS_ELEMENT.sub(" ", raw)
    tags = list(_TAG.finditer(raw))
    spans = []
    for i, m in enumerate(tags):
        closing, tag, attrs = m.group(1), m.group(2).lower(), m.group(3) or ""
        if closing or tag in _VOID or attrs.rstrip().endswith("/") or not _noise_class(attrs):
            continue
        end = _matching_end(tags, i, tag)
        if end is None:
            continue
        if len(re.sub(r"<[^>]+>", "", raw[m.start():end])) > _NOISE_TEXT_LIMIT:
            continue
        spans.append((m.start(), end))
    if not spans:
        return raw
    spans.sort()
    merged = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    out, pos = [], 0
    for a, b in merged:
        out.append(raw[pos:a])
        out.append(" ")
        pos = b
    out.append(raw[pos:])
    return "".join(out)


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


def page_dates(raw_html):
    """Dates worth storing, after page chrome and blog/related widgets are removed."""
    return date_mentions(visible_text(strip_noise_html(raw_html)))


def mention_end(mention):
    """Last calendar day of a stored mention, or None when it has no year or doesn't parse."""
    m = MENTION_RE.match(mention)
    if not m or not m.group(5):
        return None
    mon1, d1, mon2, d2, year = m.group(1), int(m.group(2)), m.group(3), m.group(4), int(m.group(5))
    end_m = MONTHS.index(mon2) + 1 if mon2 else MONTHS.index(mon1) + 1
    end_d = int(d2) if d2 else d1
    try:
        return dt.date(year, end_m, end_d)
    except ValueError:
        return None


def actionable_date(mention, today):
    """True when a date change could matter for events in the current or upcoming season.

    Past years, dates that have already passed, and mentions with no year (blog headlines,
    undated lines) are not flagged. A mention we cannot parse is kept, so an unusual
    future date is not hidden.
    """
    if MENTION_RE.match(mention) and not MENTION_RE.match(mention).group(5):
        return False
    end = mention_end(mention)
    if end is None:
        return True
    return end >= today


def date_on_page(iso, text):
    """True if the event's start date appears in a common written form."""
    y, m, d = iso.split("-")
    mi, di = int(m), int(d)
    t = text.lower()
    full = dt.date(int(y), mi, di).strftime("%B").lower()
    month = rf"(?:{MONTHS[mi - 1]}|{full})\.?"
    ord_ = r"(?:st|nd|rd|th)?"
    sep = r"(?:-|–|—|&|and|to)"
    pats = [
        rf"\b{month}\s+{di}{ord_}\b",
        rf"\b{di}{ord_}\s+(?:of\s+)?{month}\b",
        # "6 – 28 August", "6-28 August", "1 to Sunday 8 August"
        rf"\b{di}{ord_}\s*{sep}\s*(?:[a-z]+\s+)?\d{{1,2}}{ord_}\s+(?:of\s+)?{month}\b",
        rf"\b{y}-{m}-{d}\b",
        rf"\b{mi}/{di}/{y}\b|\b{di}/{mi}/{y}\b",
    ]
    return any(re.search(p, t) for p in pats)


def fetch_succeeded(status, text):
    return status == 200 and isinstance(text, str) and len(text) > 200


def dates_basis(prev):
    """Whether prev['dates'] came from a successful read.

    'ok'      this snapshot's own read succeeded
    'carried' a later read failed and the previous good dates were kept
    'unknown' a failed read with nothing reliable before it (often stored as [])
    Legacy snapshots have no dates_basis; a saved hash and length mean the dates
    were taken from a real page, including when a later failure kept them.
    """
    if not prev:
        return "unknown"
    explicit = prev.get("dates_basis")
    if explicit in ("ok", "carried", "unknown"):
        return explicit
    if prev.get("dates") is None:
        return "unknown"
    length = prev.get("length")
    if prev.get("sha256") and isinstance(length, int) and length > 200:
        return "ok" if prev.get("status") == 200 else "carried"
    return "unknown"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*;q=0.8", "Accept-Language": "en-CA,en;q=0.8"})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read(3_000_000).decode(r.headers.get_content_charset() or "utf-8", "replace")
                return {"status": r.status, "text": visible_text(body), "html": body}
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


def run_check(targets, results, old, today, now):
    """Compare one fetch per target with the saved snapshot. No network and no file writes."""
    baseline = not old
    new_state, significant, minor, unconfirmed = {}, [], [], []
    for url, meta in targets.items():
        r = results[url]
        text = r.get("text") or ""
        ok = fetch_succeeded(r.get("status"), text)
        prev = (old.get("pages") or {}).get(url)
        basis = dates_basis(prev)
        if ok:
            dates = page_dates(r["html"]) if r.get("html") else date_mentions(text)
            date_state = "ok"
        elif basis in ("ok", "carried"):
            dates = prev.get("dates")
            date_state = "carried"
        else:
            # Unknown, not an empty date list. The next good read must not look like every date was added.
            dates = None
            date_state = "unknown"
        rec = {
            "labels": meta["labels"],
            "status": r.get("status"),
            "checked_at": now,
            "sha256": hashlib.sha256(text.encode()).hexdigest() if ok else (prev or {}).get("sha256"),
            "length": len(text) if ok else (prev or {}).get("length"),
            "dates": dates,
            "dates_basis": date_state,
            "events": {},
        }
        for ev in meta["events"]:
            if ev["confirmed"] and re.match(r"\d{4}-\d\d-\d\d$", ev["start_date"]):
                rec["events"][ev["name"]] = date_on_page(ev["start_date"], text) if ok else (prev or {}).get("events", {}).get(ev["name"])
        new_state[url] = rec
        names = ", ".join(meta["labels"] + [e["name"] for e in meta["events"]][:4]) or url
        for name, found in rec["events"].items():
            if found is False:
                unconfirmed.append((name, url))
        if prev is None:
            continue
        msgs = []
        # Bot challenges / timeouts come and go, so only a "page gone" status counts as significant.
        if r.get("status") in (404, 410) and prev.get("status") not in (404, 410):
            msgs.append(f"page now returns `{r.get('status')}` (moved or removed?)")
        if ok and basis in ("ok", "carried"):
            added = sorted(d for d in set(rec["dates"] or []) - set(prev.get("dates") or []) if actionable_date(d, today))
            removed = sorted(d for d in set(prev.get("dates") or []) - set(rec["dates"] or []) if actionable_date(d, today))
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
    return {
        "state": {"updated_at": now, "pages": new_state},
        "significant": significant,
        "minor": minor,
        "unconfirmed": unconfirmed,
        "errors": errors,
        "report": "\n".join(lines),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--open-issue", action="store_true", help="open/comment a GitHub issue when significant changes are found")
    ap.add_argument("--report", default="source-check-report.md")
    ap.add_argument("--no-save", action="store_true")
    args = ap.parse_args()

    targets = load_targets()
    old = json.loads(STATE.read_text()) if STATE.exists() else {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        results = dict(zip(targets, ex.map(fetch, targets)))

    now_dt = dt.datetime.now(dt.timezone.utc)
    checked = run_check(targets, results, old, now_dt.date(), now_dt.strftime("%Y-%m-%dT%H:%M:%SZ"))
    report = checked["report"]
    Path(args.report).write_text(report, encoding="utf-8")
    print(report)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(report + "\n")

    if not args.no_save:
        STATE.write_text(json.dumps(checked["state"], indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")

    if checked["significant"] and args.open_issue:
        open_issue(report, len(checked["significant"]))
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
