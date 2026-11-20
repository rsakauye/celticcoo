Follow [AGENTS.md](AGENTS.md).

## Rules for Claude

- Never merge, push to `main`, deploy, change repo settings, or touch DNS, hosting, or secrets.
- Never print, echo, log, or commit any token. Russell adds every secret himself.
- This repo is public. Describe changes as plain features.
- Never put prices, private preview URLs, internal service names, access IDs, or anyone's email address in the repo, a pull request, or an issue.
- Pull request bodies follow `.github/PULL_REQUEST_TEMPLATE.md`.
- No em dashes in pull request text.

Signing rules below were proposed on Nov 20, 2026 and are not yet confirmed by Russell.

- Every pull request body says which AI made it in plain prose, for example "Made by Claude Code (Claude Opus 5.5, Claude Pro)."
- Commit subjects start `[Claude]`. No `Co-authored-by` lines.
