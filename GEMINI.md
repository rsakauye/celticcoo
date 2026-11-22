# Gemini in Antigravity

Antigravity automatically loads `GEMINI.md` or `AGENTS.md` at the repo root (always on, no frontmatter). It also reads `.agents/rules/*.md`. Follow `AGENTS.md` if it is present; do not copy those rules here.


## Do this

- Work on a new branch off latest `main`. Never push to `main`. Never force-push.
- Keep the change on one task. Multi-file and larger tasks are fine when they stay in scope.
- Run the repo's tests and lint before you open or update a PR. Start a dev server when a UI change needs it.
- In the Antigravity App, use the built-in browser for UI checks and take screenshots; add them under the template's Screenshots section when the visible site changed. Official docs: the built-in browser agent is not yet available for Remote Agents, so do browser checks in the App.
- Open one PR per task. Title it with the prefix `[Gemini]`. Write the body from `.github/PULL_REQUEST_TEMPLATE.md`. Keep the description short and plain. Include one sentence that Gemini in Antigravity made it, and name the exact model you used: Gemini 4 Hydrogen, Gemini 4 Neon, Orchestrator (Neon), Gemini 3.8 Flash, or Gemini 4 Argon.
- Use the `gemini/` branch prefix and add the label `forge:review-ready` to every PR you open or update. Forge checks that label weekdays at 8 AM MT, and forge-triage emails Forge as a backup.
- Never write the Forge inbox address in the repo. It lives only in the FORGE_INBOX Actions secret.
- If the work comes from an issue, include `Closes #N`.
- If a PR is already open for this task, push to that branch. Do not open a second PR. Address Forge review comments on that same branch.
- When the branch is behind, update it from `main` (merge or rebase `main` into the feature branch). Do not force-push.
- Open a follow-up GitHub issue for out-of-scope findings. Do not expand this PR to cover them.

## Never

- Merge, approve, enable auto-merge, or bypass review.
- Deploy, or change secrets, repo settings, or `.github/workflows`.
- Print or commit secrets, keys, `.pem`, or `.env` files.
- Collect or show minors' names or photos. In public celticcoo copy, use plain feature wording. No VRS branding before incorporation.

## Review

Forge (Grok Bot) reviews last. Russell merges.

## Settings for Russell (not for the agent)

- Sign in with Google AI Pro. Keep AI Credit Overages off.
- Default to Gemini 4 Hydrogen or Gemini 4 Neon (or Orchestrator (Neon)) for routine work. Use Gemini 4 Argon for larger tasks. Gemini 3.8 Flash shares the weekly and 5-hour limits with Neon/Hydrogen; Argon has a separate weekly limit on Pro.
- Permission preset: use `default` or `request review`, not `always-proceed (turbo)`.
- Connect GitHub and grant only `rsakauye/ai-monorepo` and `rsakauye/celticcoo`.
