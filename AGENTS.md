# AGENTS.md

## Pull requests

PR descriptions must follow `.github/PULL_REQUEST_TEMPLATE.md`.

## AI handoffs

Russell confirmed this on Nov 20, 2026: Claude is a separate builder that opens pull requests and never merges.

- A handoff starts as an issue from the **AI handoff** template. Russell or the maintainers' bot comments `@claude implement this` to start Claude Code (`.github/workflows/claude.yml`), or adds the `jules` label.
- Claude builds on a `claude/` branch and opens a pull request. It never merges, pushes `main`, deploys, or changes settings, DNS, or secrets. Russell merges.
- Each handoff issue gets one usage comment from `tools/handoff-usage`.

Russell confirmed these signing rules on Nov 20, 2026, and the `rsakauye` exception on Nov 21, 2026.

- Commit subjects, pull request titles, and issue or pull request comments start `[Claude]`. Commits keep a `Co-authored-by` line.
- The pull request body names the model in a plain sentence, for example "Made by Claude Code (Claude Opus 5.5, Claude Pro)."
- A claude.ai session can reach GitHub only as `rsakauye`. When it does, it adds `(via Claude <model>)` to every commit subject, pull request title and body, and comment, for example `(via Claude Opus 5.5)`. Branches and pull requests only, never `main`.
