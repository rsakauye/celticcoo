Follow [AGENTS.md](AGENTS.md).

## Rules for Claude

- Never merge, push to `main`, deploy, change repo settings, or touch DNS, hosting, or secrets.
- Never print, echo, log, or commit any token. Russell adds every secret himself.
- This repo is public. Describe changes as plain features.
- Never put prices, private preview URLs, internal service names, access IDs, or anyone's email address in the repo, a pull request, or an issue.
- Pull request bodies follow `.github/PULL_REQUEST_TEMPLATE.md`.
- No em dashes in pull request text.

Russell confirmed these signing rules on Nov 20, 2026, and the `rsakauye` exception on Nov 21, 2026.

- Every pull request body says which AI made it in plain prose, for example "Made by Claude Code (Claude Opus 5.5, Claude Pro)."
- Commit subjects, pull request titles, and comments start `[Claude]`. Commits keep a `Co-authored-by` line.
- From a claude.ai session pushing as `rsakauye`, add `(via Claude <model>)` to every commit subject, pull request title and body, and comment.
