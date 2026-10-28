# link-check

A small, site-agnostic checker for a JSON directory of public websites. Copy this folder into another repository (UsedGlass, or a later site), point a config file at that site's data, and schedule the workflow. Nothing in `src/` knows which site it is running for.

Celtic Coo's config is [`sites/celticcoo.json`](sites/celticcoo.json). It checks `data/groups_canada.json` and writes `data/groups_link_status.json`.

## What a run does

1. Read the directory JSON (an array of objects).
2. Request each record's URL, HEAD first. GET is the fallback when HEAD has no usable answer (timeouts, connection errors, and 400, 404, 405, or 501). A 403 on HEAD is also retried with GET, except on the bot-wall hosts, where a 403 is already the answer. A failed read is retried once. DNS failures are not retried.
3. Follow up to five HTTP redirects. Only `http` and `https` are requested. Local and link-local addresses are refused before a socket is opened.
4. Write a status file. The directory file is never modified.

Each entry stores `last_checked` (the run date), `last_status`, and `final_url` when a permanent redirect landed somewhere else.

| `last_status` | Meaning |
|---|---|
| `ok` | A 2xx response. `http` to `https`, and a trailing slash, count as the same URL. A temporary redirect (302 or 307) that ends on 2xx is `ok`, and its final URL is not stored, so session redirects do not churn the file. |
| `redirect` | A 301 or 308 to a different host, path, or query, ending on 2xx. `final_url` is where it landed. |
| `broken` | A 4xx or 5xx we could read, a missing URL, or a redirect loop. A 404 is broken even on Facebook or Instagram. |
| `unreachable` | Timeout, DNS, TLS, or a dropped connection, after the one retry. |
| `unverifiable` | HTTP 403 or 429 from any host. HTTP 400 or 401 only from hosts in `unverifiableHosts` (Facebook and Instagram by default). These are not listed as broken. |

The run date is `checked_on`, in the config's `timeZone`. It is written only after every record has been attempted.

## What it will not do

- It will not add, edit, or delete directory records. A person updates those.
- It will not store response bodies, notes, or email addresses. The status file keeps the id, the public label, the URL, the status, and the final URL.
- It does not need a third-party token. The workflow uses `GITHUB_TOKEN` with `contents: write` and `pull-requests: write`.

## Config

Paths are resolved from the working directory you run the command in (the repository root in GitHub Actions).

| Field | Required | Purpose |
|---|---|---|
| `dataPath` | yes | Directory JSON array. |
| `urlField` | yes | Property that holds the website URL. |
| `idField` | yes | Property used as the stable id. |
| `idMode` | no | `field` (default) uses the value as-is. `slug` folds it to a URL slug. Duplicate ids get `-2`, `-3`, … |
| `labelField` | no | Name shown in the pull request. Defaults to `idField`. |
| `outputPath` | yes | Status JSON. This is the only file the checker writes. |
| `schedule` | yes | Five-field cron. The workflow has to repeat it; Actions cannot read this file. |
| `timeZone` | no | IANA zone for `checked_on`. Default `UTC`. |
| `userAgent` | yes | Polite agent that names the site. Strings that start with `Mozilla` are rejected. |
| `concurrency` | no | Parallel requests, 1–8. Default 4. |
| `timeoutMs` | no | Per request, 1000–30000. Default 10000. |
| `delayMs` | no | Pause after each request on a worker, 0–5000. Default 0. |
| `unverifiableHosts` | no | Extra bot-wall hosts. Defaults to Facebook and Instagram. |
| `prTitle` | no | Pull request title. |
| `branch` | no | Bot branch that holds the rolling pull request. |
| `base` | no | Branch the pull request targets. Default `main`. |
| `git.name`, `git.email` | no | Committer recorded in the workflow. |

## Commands

From the repository root:

```bash
node link-check/src/cli.js --config link-check/sites/celticcoo.json --dry-run
node link-check/src/cli.js --config link-check/sites/celticcoo.json --report /tmp/club-link-check.md
node link-check/src/cli.js --config link-check/sites/celticcoo.json --open-pr --report /tmp/club-link-check.md
```

`--dry-run` requests the URLs and prints the counts. It does not write the status file and it does not open a pull request. `--limit` is only allowed with `--dry-run`.

`--open-pr` does not fetch websites. It reads the report written by the check step and opens or updates the single open pull request for `branch`. The workflow commits the status file to that branch first, and only then calls `--open-pr`.

A later week force-updates that same branch (lease-checked against the previous bot commit) and edits the open pull request. It does not open a second one. If nothing changed except the date, the date is still committed, and the pull request says so instead of listing every club again.

## Tests

```bash
node --test link-check/test
```

Celtic Coo also runs these from `npm test` in `site/`.

## Using this on another site

1. Copy the `link-check/` folder.
2. Add `link-check/sites/yoursite.json` with that site's data path, URL field, id field, output path, schedule, and user agent.
3. Copy `.github/workflows/club-link-check.yml` and point both `node link-check/src/cli.js` steps at the new config. Repeat `schedule`, `branch`, `outputPath`, and the git committer in the workflow. Keep the action SHAs pinned, and do not add secrets other than `GITHUB_TOKEN`.
4. Commit an empty status file (`checked_on` null, `entries` []) so the site can build before the first run.
5. Show the date from `checked_on`. Format it in the site. This repo uses `Oct 27, 2026`, and prints `not yet` when `checked_on` is null.

The checker does not know about lessons, shops, or any other field. The site decides what its own pages count.
