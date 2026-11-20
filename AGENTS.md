# AGENTS.md

## Pull requests

PR descriptions must follow `.github/PULL_REQUEST_TEMPLATE.md`.

## AI handoffs

Russell confirmed this on Nov 20, 2026: Claude is a separate builder that opens pull requests and never merges.

- A handoff starts as an issue from the **AI handoff** template. Russell or the maintainers' bot comments `@claude implement this` to start Claude Code (`.github/workflows/claude.yml`), or adds the `jules` label.
- Claude builds on a `claude/` branch and opens a pull request. It never merges, pushes `main`, deploys, or changes settings, DNS, or secrets. Russell merges.
- Each handoff issue gets one usage comment from `tools/handoff-usage`.

Signing rules below were proposed on Nov 20, 2026 and are not yet confirmed by Russell.

- Commit subjects and pull request titles start `[Claude]`. The pull request body names the model in a plain sentence, for example "Made by Claude Code (Claude Opus 5.5, Claude Pro)." No `Co-authored-by` lines.
