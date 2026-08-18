# best-ball-pl

Pre-draft cheat sheet for Underdog's **The False Nine** EPL best-ball tournament. Pulls free Premier League data via ETL, projects season-long player value under False Nine scoring, and renders a tiered cheat-sheet web app for draft day.

Sibling of [dynastyff](https://github.com/wulke/dynastyff) — same TypeScript/static-build pattern, minus the Express/SQLite layer: the ETL writes a committed `data/snapshot.json` and the browser-only React app reads it.

> **Time-critical effort.** The 2026-27 EPL season starts Friday 2026-08-21 and drafts are live. Scope is deliberately cut to a usable sheet first; see the wayfinder map issue for the routed plan.

## Prerequisites

- Node.js 20+

## Setup

```bash
npm install

# Populate data/snapshot.json (FPL API pull; cached, safe to re-run)
npm run etl

# Start the cheat-sheet UI
npm run dev
```

## Commands

| Command | Purpose |
|---|---|
| `npm run etl` | Pull FPL data, project season points, write `data/snapshot.json` (idempotent; disk-cached) |
| `npm run fbref` | Parse manually-saved FBref pages (data/fbref-raw/) → commit `data/fbref.json` → enrich snapshot volume terms → **fetch the PL stats API for the passing terms (passes completed / key passes)** → commit `data/pl-stats.json` → reproject (reuses the committed parses when the raw folder is empty) |
| `npm run model` | Recompute projections against the committed snapshot and print the ranked report (no API calls — the config-tuning loop) |
| `ETL_FRESH=1 npm run etl` | Same, bypassing the cache for fresh API reads |
| `npm run dev` | Vite dev server for the cheat-sheet UI |
| `npm run build` | Build the static UI bundle into `dist/ui/` (includes snapshot copy) |
| `npm run preview` | Preview the built bundle locally |
| `npm test` | Parser/matcher tests against the committed first-recap fixture |
| `npm run typecheck` | TypeScript check across the repo |

## Project Structure

```
src/
  etl/        # Data pipeline → data/snapshot.json
    fpl.ts    #   FPL API client: disk cache (.etl-cache/), retry/backoff, concurrency cap
    fbref.ts  #   FBref parser: manually-saved league pages → per-player volume stats
    fbref-merge.ts #  FBref↔FPL matching + snapshot enrichment (npm run fbref)
    index.ts  #   Orchestration: bootstrap + per-player season history + fixtures → snapshot
    types.ts  #   Canonical snapshot contract (shared with the UI)
  model/      # Season-long False Nine projection model
    config.ts   #   Scoring table + every model constant — the tuning surface
    scoring.ts  #   Pure statline → points scorer (the substrate)
    project.ts  #   Minutes/rates/volume/team priors → p10/p50/p90 projections
    cli.ts      #   npm run model: recompute + ranked report
  ui/         # Browser-only React cheat sheet (Vite)
    App.tsx         #   Snapshot load, view nav (Sheet/Drafts), carry-card pin, sticky controls bar
    PlayerTable.tsx #   Ranked tier table: bands, rows, flags
    useDrafted.ts   #   Mark-drafted state persisted to localStorage
    drafts/         # Draft-review slice (#20): rooms, intake, review lenses
      types.ts      #   Parsed-log + room-record contract (the #22 parser produces this)
      parse.ts      #   Recap paste-parser + name matcher (#22, built against the first real recap)
      parse.test.ts #   Parser/matcher tests vs the committed fixture (npm test)
      store.ts      #   localStorage working store + export/import (data/drafts/)
      review.ts     #   Pure lens math: deviations, headline, best-9, tier mix, club grid, flags
      fixture.ts    #   DEV-only deterministic 12-team room for exercising the flow
      DraftsView.tsx / RoomEditor.tsx / PickTable.tsx / ReviewPanel.tsx / PlayerPicker.tsx / CarryCard.tsx
data/
  snapshot.json  # Committed, ETL-generated; the UI's single data source
  fbref.json     # Committed parse of the manually-saved FBref pages (volume terms)
  pl-stats.json  # Committed Premier League stats API pull (passing terms)
  drafts/        # Exported room records (data/drafts/<yyyy-mm-dd>-<room-slug>.json), committed
    fixtures/    # Recap-paste text fixtures for the parser tests (no room identifiers)
docs/
  research/   # Research findings (wayfinder research tickets)
```

### FBref volume terms (`npm run fbref`)

FBref has no API and Cloudflare-blocks automated fetches, so its league pages
are **saved by hand** from a normal browser and parsed locally: open the ten
URLs in `data/fbref-raw/README.md`, ⌘S → *HTML Only* into `data/fbref-raw/`
(filenames don't matter — the parser detects each page by its embedded
canonical URL), then run `npm run fbref`. That parses the
pages (local Chromium, zero network), commits `data/fbref.json`, matches
FBref players to FPL elements (normalized full-name, web-name, and
surname-with-sanity-check tiers; hand fixes go in
`data/fbref-overrides.json` as `{"<fbref name>": "<fpl element id>"}`),
enriches each season row's volume fields, and reprojects. **Partial page sets
are fine**: coverage is tracked per term — a term whose page wasn't captured
(e.g. only shooting saved) falls back to league-average conversions + position
baselines for everyone; a term is FBref-driven only when its page was parsed.
`npm run etl` re-applies the committed `data/fbref.json` automatically so fresh
FPL pulls never drop the volume data.

### Passing terms come from the PL stats API

FBref's **passing page** cells are JS-populated after load and FBref currently
serves them empty — no save format captures them (HTML Only and Single File
both store the pre-JS server document, and the live page itself shows blank
columns). The passing terms (`passesCompleted`, `keyPasses`) are therefore
pulled from the **Premier League's own stats leaderboard API** (the Opta feed
behind premierleague.com — no auth): `npm run fbref` fetches
`/api/v3/competitions/8/seasons/{2025,2024}/players/stats/leaderboard`
(paginated, ~10 pages), maps `keyPassesAttemptAssists` → key passes and
`successfulPassesOwnHalf + successfulPassesOppositionHalf` → completed passes
(`timePlayed` as minutes), matches to FPL players with the same matcher, and
fills those two fields wherever FBref didn't. The fetch is cached in the
committed `data/pl-stats.json` so `npm run etl` re-applies it offline. Each
`npm run fbref` also cross-checks the PL key-pass numbers against **Understat**
(an independent re-processing of the Opta feed — headless pull, best-effort):
logs the log-correlation, median count ratio and minutes agreement per season,
and warns if the correlation ever drops or the ratio swings. All
other volume terms (shots, SoT, crosses, tackles won, GK wins, unused subs)
stay on the saved FBref pages.

## Snapshot contents

`data/snapshot.json` is generated by `npm run etl` and committed. Per player: identity, False Nine position, team, 2026/27 FPL price, availability status, **labeled multi-season stat lines** (most recent first; minutes/starts/goals/assists/clean sheets/goals conceded/saves/pen saves/xG/xA/FPL points) from FPL `element-summary` history, and a **season-long projection** (`projection`) — False Nine points at p10/p50/p90 with the full auditable stat line, per-90, ceiling-per-90, a **tournament-adjusted score** and durability-risk flag, value (tournament score per £M), position/overall ranks, tier, and a confidence grade (history depth). Also includes the full 380-fixture list with per-fixture difficulty ratings (Round 1 scores MW 1–26). Current-season per-GW stats land with the in-season refresh slice once the season starts.

### Model v1 shape (`src/model/`)

- **Minutes**: recency-weighted (55/30/15) durability prior, injury-status haircuts, a **fixture-congestion haircut** for outfield players on top-6 win-rate teams (Europe/cup rotation proxy, inside MW 1–26), and a per-team **goalkeeper job-share cap** (one team = one ~3450-minute starting job, shared proportionally to priors). **Newcomers** (no FPL history — a third of the pool, the entire promoted contingent) get a **price-informed minutes prior**: per-position FPL-price → minutes fit over established players, discounted 0.85 for survivorship — FPL prices newcomers by expected role, so a £5.5 new midfielder projects ~1500 minutes instead of a flat 850. **Thin history**: seasons under 90 minutes count as missing data, not zero output (one real season averaged with cameo rows no longer halves).
- **Attacking rates**: xG/xA-weighted per-90s (70/30 blend with actuals), regressed toward position mean by sample size.
- **Volume terms** FPL can't express (SoT, chances created, crosses, tackles, passes): **per-player rates from FBref league pages, with the passing terms (passes completed / key passes) from the Premier League stats API** (recency-weighted over 2025/26 + 2024/25, shrunk toward the position's covered mean by sample size, **per term**) when that term has data — see the FBref section below; league-average conversions + per-position baselines for uncovered terms (players without rows, e.g. promoted squads, or pages that were never saved).
- **Defense**: team CS/GC/win-rate priors from the 2025/26 primary keeper (regressed to league mean; promoted teams get the mean), personal saves rate for GKs.
- **GK expected starts**: the keeper job is **38 starts per club**, not continuous minutes — a keeper claims club starts by starting ≥8 matches last season (recent starting evidence; stale cross-club minutes can't claim the #1 job), claimants keep their recency-weighted starts prior (injury risk priced), scaled down only when the pool overflows 38, and the bench inherits the residual. Wins/CS/saves follow structurally: matches = starts × club rates — the club's season of win/CS/save opportunity is counted exactly once.
- **Durability**: the unused-subs rate (FBref playing-time page — games spent entirely on the bench per 90 played) joins the minutes/start-rate checks in the **durability-risk flag**, so bench-heavy rotation bets get the dampened-ceiling treatment even when their raw minutes look serviceable.
- **Scenarios**: parametric p10/p50/p90 (minutes 0.6×/1.0×/1.1×, burst 0.88×/1.0×/1.2–1.25× by position, team-form on CS/wins) — no Monte Carlo (out of scope per the map).
- **Tournament-shape adjustment**: rank/tier/value key off a `tournamentScore` — `p50 + ceilingWeight × (p90 − p50)` — that blends toward the p90 ceiling (best-ball pays for boom weeks, not mean output). A **durability-risk flag** (projected minutes share < 50% of a full season, or multi-season start rate < 55%) dampens the ceiling boost to 30% for flagged players, since a spike proxy is only worth drafting toward if the player is trusted to be on the pitch for the 26-week Round 1 grind. Raw `points.p50` is untouched and stays visible as the unadjusted "Pts" column — the adjustment is a separate, auditable figure, not folded silently into the headline number.
- **Tiers**: **natural breaks in each position's `tournamentScore` distribution** — cut where the neighbor gap exceeds max(8, 2.5 × median gap); flat plateaus split at their largest internal gap up to 15-wide tiers; past the position's draft depth everything is residual tier 9. Forward-looking by construction: tiers are the clusters the model's own estimates form, never price/value bands.

Every constant lives in `src/model/config.ts`; tune and re-run `npm run model`, which also prints a **team defensive context table** (projected CS/match, GC/match, GK win rate) for clean-sheet-first drafting.

## Design

UI follows the design system in [`DESIGN.md`](DESIGN.md) — data-dense sports analytics, semantic Tailwind tokens, IBM Plex typography, position badges (G/D/MD/FW) fixed across themes.

### Cheat sheet view (v1)

A single ranked table over the snapshot, built for draft day (the **Sheet** tab):

- **Ranking**: overall by tournament-adjusted score, or within-position (`posRank`) when a position filter is active.
- **Tier bands**: in a position-filtered view, natural-break tiers render as labeled divider rows (`Tier 3 · 2 players · 308.8–308.1 pts`); in the overall view tiers interleave across positions, so tier shows as a compact per-row `T4` column instead.
- **Columns**: pick toggle, rank, player, position, team, £ price, projected p50 points (raw, unadjusted), tier, /90 efficiency, ceiling (p90 per 90 — the best-ball spike proxy), and value (tournament-adjusted score per £M).
- **Flags** (hover any chip for its meaning): `!` marks non-available status (hover for the injury/suspension news); `±` / `?` chips mark medium / low projection confidence; `R` marks durability/minutes-risk (thin projected playing time for the 26-week grind — dampens the ceiling boost feeding rank/tier/value).
- **Search** matches player name or team; **Hide off-board** (default on) removes drafted players from the board.
- **Row controls** (three, hover-revealed): `✓` marks a player **off board** — drafted by *anyone* in the room, not necessarily by you; `M` marks **my pick** (sets your roster + off-board together); `★` **queues** a target (watch list). All persist in localStorage per draft session.
- **Live draft panel** (collapsible, above the table): roster shape chips vs starter minimums (`FW 1/2`, red = need), **correlation watch** (same-club clusters; `CS corr` flags G+D pairs whose clean sheets are the same event), **From your queue** (your ★ pool still on the board, best first), **Best on board** (top-3 BPA), and a **default target per position** with NEED/ok/full state and scarcity tags (`T2 ×3 left`) — the mid-to-late-round answer to "I don't know half these players".
- **★ Queue filter**: the `★ Queue (n)` toggle filters the board down to your queued targets — the Underdog watch-list pattern, mid-draft.
- **New draft**: full reset of off-board marks, roster, and queue between drafts.
- **Print-friendly**: printing (or Print preview) flips any theme to light paper/dark ink via a print token override, hides interactive controls, and tightens row density — print with filters active to scope the sheet (e.g. MD-only page).
- **Carry-card pin**: when a reviewed draft room exists, its carry-forward card (auto-flags + your note) pins at the top of the sheet for the next draft — collapsible, never printed.

### Draft review (v1)

The **Drafts** tab — the between-drafts review loop for the practice-then-flagship plan. Paste-parse is the only intake (#19): **paste** Underdog's draft-recap text into the paste box **or load a saved recap page** (`.mhtml` from Chrome/Edge ⌘S → *Webpage, Single File*, `.html`, or `.txt` — saved files are decoded to the same paste text and the draft URL is sniffed from the file header). The **recap parser (#22)** then builds the full-room pick log — pick/round/team from the `1.6|6`-style board anchors, names matched against the FPL snapshot (normalized diacritics/case/punctuation, last-name + first-initial; mononyms like Rayan exact-match the FPL web name). Ambiguous names get a **one-click confirm queue**; unmatched picks (transfer insurance / non-EPL names outside the FPL pool, by design) stay flagged and excluded from the math. The parser was built against the first real $3 recap and is locked in by tests (`npm test`) against the committed paste fixture (`data/drafts/fixtures/`); the real saved page (`data/udraft-raw/`, gitignored) is regression-checked byte-for-byte when present locally. **Re-parse** over a stored room re-runs the parser without clobbering your team pick, confirmed matches, or carry note. A DEV-only fixture button still simulates a full 12-team room against the current snapshot for exercising the flow without a real paste.

- **Rooms**: localStorage is the working store; **Export** downloads the record verbatim as `data/drafts/<yyyy-mm-dd>-<room-slug>.json` to move into the repo and commit (the archival step), **Import** restores it. Room facts: name, draft date, entry cost ($3/$15/other), draft URL, my team (dropdown of recap teams), carry note.
- **Pick log**: the full ~216-pick log with inline editing as the pressure valve — re-match a player (search-select), fix a team name, delete/add picks; pick/round renumber automatically.
- **Review panel** (needs my team picked) — the #18 lenses:
  - **Headline**: roster total vs naive sheet-perfect top-18 legal shape, as % (tournament score, raw p50 alongside — 12-team rooms sit ~50–55% of the unattainable baseline by construction)
  - **Per-pick deviation**: each own pick vs the best sheet player still on the board — BPA delta primary (rank + points), best same-position secondary
  - **Best 9**: pseudo-starters (1 G / 2 D / 2 MD / 2 FW / 2 FLEX) by projection, with the tier mix and a floor gauge (avg p10/p50)
  - **Club coverage**: 20 clubs × G/D/MD/FW counts, shaded by model strength (CS quartile for G/D, attack quartile for MD/FW) with auto gap-flags
  - **Carry card**: top auto-flags + one free-text line — pinned on the cheat sheet during the next draft

## Workflow

This repo is being charted with the Wayfinder skill — the map issue and its tickets live on this repo's GitHub tracker. `/grill-me` for design stress-tests; research findings land on `research/<name>` branches under `docs/research/`.

## The False Nine (context)

18-round snake draft · roster 1 G / 2 D / 2 MD / 2 FW / 2 FLEX / 9 BENCH · auto-set best-ball lineups each match week · Round 1 = MW 1–26, finals MW 35–38 · lineups must span ≥ 2 clubs · non-EPL players in pool as transfer insurance.
