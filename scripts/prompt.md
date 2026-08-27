# Agent Work Prompt

You are a coding agent working on **best-ball-pl** — a static-only Underdog best-ball draft tool (TypeScript, Vite, React, browser-only). All project context is in `AGENTS.md`, `LID.md`, and `DESIGN.md`.

## Your Job
Complete the assigned issue fully and submit a pull request as your final artifact. Do not start other issues.

## Branch Naming and Issue Tagging
Create a branch before making any changes:
- Bug: `bug/[issue-number]-[short-description]`
- Feature: `feature/[issue-number]-[short-description]`
- Other: `chore/[issue-number]-[short-description]`

Immediately after creating the branch, claim the issue so no other agent picks it up:
1. Add the `in-progress` label: `gh issue edit [number] --add-label "in-progress"`
2. Post a comment linking to your branch: `gh issue comment [number] --body "Starting work on branch \`[branch-name]\`."`

## Standing Constraints (see AGENTS.md)
- **Static-only architecture**: no Express/SQLite/Drizzle. ETL writes committed `data/snapshot.json`; the UI is browser-only Vite React reading that snapshot. Do not introduce server dependencies.
- **Free data first**: scraping/free APIs are the default; a paid source needs a demonstrated free-path failure before it's considered.
- **Time-critical**: drafts are live now. Usable-first ordering; nothing decorative ahead of the cheat sheet.
- **UI work**: read `DESIGN.md` before writing or modifying any UI component. Use semantic Tailwind token classes only — never hardcode palette classes.

## LID Mode: Abbreviated
This project runs LID in **abbreviated mode** (see `LID.md`): README-first, HLD/LLD/EARS deferred to post-draft-season unless a slice genuinely needs one.

**Bug** — Walk the Arrow of Intent anyway: find where behavior diverges from the README/existing docs, write a failing test that reproduces the bug (Red), then fix the code (Green).

**Feature** — No HLD/LLD/EARS required unless the issue explicitly calls for one. Write failing tests where the code is testable (Red), implement the minimum (Green), update `README.md` to reflect new setup steps, commands, or configuration options.

**Other** — Use judgment. Keep changes minimal. Apply Red → Green where tests are applicable. Update `README.md` if relevant.

Commit the red state and the green state as separate commits when tests are involved.

## Pull Request
When done: push your branch and open a PR that references the issue (e.g. `Closes #[number]`) and describes what changed and why. Do not merge.

### Validation (required for every PR)

A PR is **UI-related** if it modifies any file under `src/ui/`, any `.tsx` file, or any `.css` file.

**For bug PRs only** — include a `Steps to Reproduce` block showing pre-fix behavior:
```
### Steps to Reproduce
**Preconditions:** <e.g. `npm run dev`, snapshot.json present>
1. <action>
2. <action>
**Observed:** <what happens before the fix>
```

**For all PRs** — include a `Validation` checklist showing how the human can confirm the fix or feature works:
```
### Validation
**Preconditions:** <e.g. `npm run dev`, specific snapshot/data state required>
- [ ] <screen or component to navigate to (required for UI changes)> → <expected result>
- [ ] <next step> → <expected result>
```

For UI changes, the checklist must name the specific screen or component (e.g. "Navigate to the Cheat Sheet tab → confirm rows render") and any data setup required.

Before opening the PR, run and confirm passing:
- `npm run typecheck`
- `npm test`

## Rules
- Follow all instructions in `CLAUDE.md` and `AGENTS.md`.
- Once specs exist for a slice (`docs/specs/`), code entry points and tests touching that slice must carry `@spec [ID]` comments per LID.md. Slices still in abbreviated mode do not require this.
