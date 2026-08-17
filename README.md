# best-ball-pl

Pre-draft cheat sheet for Underdog's **The False Nine** EPL best-ball tournament. Pulls free Premier League data via ETL, projects season-long player value under False Nine scoring, and renders a tiered cheat-sheet web app for draft day.

Sibling of [dynastyff](https://github.com/wulke/dynastyff) — same TypeScript/static-build pattern, minus the Express/SQLite layer: the ETL writes a committed `data/snapshot.json` and the browser-only React app reads it.

> **Time-critical effort.** The 2026-27 EPL season starts Friday 2026-08-21 and drafts are live. Scope is deliberately cut to a usable sheet first; see the wayfinder map issue for the routed plan.

## Prerequisites

- Node.js 20+

## Setup

```bash
npm install

# Populate data/snapshot.json (currently a placeholder — real FPL pull lands with the ETL slice)
npm run etl

# Start the cheat-sheet UI
npm run dev
```

## Commands

| Command | Purpose |
|---|---|
| `npm run etl` | Pull source data and write `data/snapshot.json` |
| `npm run dev` | Vite dev server for the cheat-sheet UI |
| `npm run build` | Build the static UI bundle into `dist/ui/` (includes snapshot copy) |
| `npm run preview` | Preview the built bundle locally |
| `npm run typecheck` | TypeScript check across the repo |

## Project Structure

```
src/
  etl/        # Data pipeline → data/snapshot.json
  ui/         # Browser-only React cheat sheet (Vite)
data/
  snapshot.json  # Committed, ETL-generated; the UI's single data source
docs/
  research/   # Research findings (wayfinder research tickets)
```

## Design

UI follows the design system in [`DESIGN.md`](DESIGN.md) — data-dense sports analytics, semantic Tailwind tokens, IBM Plex typography, position badges (G/D/MD/FW) fixed across themes.

## Workflow

This repo is being charted with the Wayfinder skill — the map issue and its tickets live on this repo's GitHub tracker. `/grill-me` for design stress-tests; research findings land on `research/<name>` branches under `docs/research/`.

## The False Nine (context)

18-round snake draft · roster 1 G / 2 D / 2 MD / 2 FW / 2 FLEX / 9 BENCH · auto-set best-ball lineups each match week · Round 1 = MW 1–26, finals MW 35–38 · lineups must span ≥ 2 clubs · non-EPL players in pool as transfer insurance.
