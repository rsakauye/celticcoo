# Handoff usage report

Posts one comment on an AI handoff issue or PR, in the GrokBot PMO block format (`tool / plan / model / remaining / resets (MT) / source`). Times are Mountain Time. The comment carries the marker `<!-- handoff-usage -->`, so each run edits it rather than adding a new one.

Best effort. Consumer plans have no quota API.

## When it runs

- An issue gets the `ai-handoff` label (`handoff-usage.yml`).
- A Claude run starts and finishes (`claude.yml`, jobs `usage-start` and `usage-end`).
- By hand at a local handoff (below).

## What it shows

- Claude runs of `claude.yml` in the last 5 hours and 7 days.
- If the repo variables `CLAUDE_RUNS_5H_BUDGET` and `CLAUDE_RUNS_7D_BUDGET` are set, an estimate of runs left. Russell sets these from experience. They are not Anthropic numbers.
- `plan:` and `model:` default to `Claude Pro` and `Action default`. Override with repo variables `CLAUDE_PLAN` and `CLAUDE_MODEL`.
- A second block for Jules, only when Jules has run: tasks left of 100 today and free slots of 15 (AI Pro).
- With `--local`, the real Claude Pro 5-hour and weekly percent left, read from Claude Code's status line. CI cannot read those. Without it, check `/usage` in Claude Code.

## Local setup (Russell's machine)

Add the status line to `~/.claude/settings.json`. Use the absolute path to your clone.

```json
{ "statusLine": { "type": "command", "command": "node /path/to/celticcoo/tools/handoff-usage/statusline.mjs" } }
```

The status line then shows `Opus | 5h 23% | 7d 41%` and saves a snapshot to `~/.claude/handoff-usage.json` (no tokens, only percentages and reset times).

To post the snapshot on a handoff issue or PR (use the PR number as `--issue`), with a GitHub token in `GITHUB_TOKEN`:

```sh
node tools/handoff-usage/report.mjs --repo rsakauye/celticcoo --issue 12 --local --stage "Claude handing back to Forge"
```

Add `--dry-run` to print the comment without posting.

## Tests

```sh
node --test tools/handoff-usage/*.test.mjs
```
