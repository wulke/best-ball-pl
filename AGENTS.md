# AGENTS.md

Project instructions for coding agents working in this repository.

## Linked-Intent Development

This repository uses the centralized Linked Intent Development skill in [`LID.md`](LID.md).
Follow `LID.md` as the source of truth for the LID workflow, approval gates, traceability, and bug-fix protocol — **abbreviated mode** for this effort (see LID.md): README-first, design docs deferred to post-draft-season unless a slice genuinely needs one.

### README Maintenance

When completing any feature or issue, update `README.md` to reflect changes: new setup steps, changed commands, new configuration options, or new components. Keep it accurate and current — it is the primary quick-start reference.

### Navigation

| What you need | Where to look |
|---|---|
| UI design system | `DESIGN.md` |
| Research findings | `docs/research/` |
| Low-level designs (post-draft) | `docs/llds/` |
| EARS specs (post-draft) | `docs/specs/` |

## Standing Constraints

- **Static-only architecture**: no Express/SQLite/Drizzle. ETL writes committed `data/snapshot.json`; the UI is browser-only Vite React reading that snapshot. Do not introduce server dependencies.
- **Free data first**: scraping/free APIs are the default; a paid source needs a demonstrated free-path failure before it's considered.
- **Time-critical**: drafts are live now, EPL starts Friday 2026-08-21. Usable-first ordering; nothing decorative ahead of the cheat sheet.

## UI Development

This project uses a design system defined in [`DESIGN.md`](DESIGN.md). **Read `DESIGN.md` before writing or modifying any UI component.**

Rules enforced by the design system:

- Use semantic Tailwind token classes (`text-accent`, `bg-surface`, `border-default`) — never hardcode palette classes like `text-lime-300` or `bg-zinc-900`.
- Use `font-condensed` + `tabular-nums` for all stat values, projections, and section headers.
- Use `rounded` (4px) for rows/buttons/badges, `rounded-md` (6px) for panels/cards, `rounded-lg` (8px) for modals. Never use `rounded-[2rem]` or large decorative radii on structural elements.
- Keep padding tight: `px-2 py-1` for data rows, `px-3 py-2` for panel headers/bodies.
- Position badge colors (G/D/MD/FW) are fixed across themes — use `text-pos-g`, `bg-pos-g`, `border-pos-g`, etc.
- All accent, surface, border, and text colors must come from the CSS variable token layer defined in `DESIGN.md`.
