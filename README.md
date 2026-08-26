# best-ball-pl

Pre-draft cheat sheet for Underdog's **The False Nine** EPL best-ball tournament. Pulls free Premier League data via ETL, projects season-long player value under False Nine scoring, and renders a tiered cheat-sheet web app for draft day.

Sibling of [dynastyff](https://github.com/wulke/dynastyff) — same TypeScript/static-build pattern, minus the Express/SQLite layer: the ETL writes a committed `data/snapshot.json` and the browser-only React app reads it.

> **Time-critical effort.** The 2026-27 EPL season starts Friday 2026-08-21 and drafts are live. Scope is deliberately cut to a usable sheet first; see the wayfinder map issue for the routed plan.

**Live site**: https://wulke.github.io/best-ball-pl/ — redeploys automatically from `main` via GitHub Actions (`.github/workflows/deploy.yml`). It publishes whatever `data/snapshot.json` is committed; run `npm run etl` and commit the refreshed snapshot to update the live data. Pull requests run a separate check workflow (`.github/workflows/ci.yml`: typecheck, test, build) but do not deploy. `main` is protected (ruleset `main-requires-review`): a PR needs one approving review and a green check run before merging, so every change — snapshot refreshes included — lands via a reviewed PR.

**Scheduled refresh (#41)**: `.github/workflows/scheduled-refresh.yml` runs `ETL_FRESH=1 npm run etl` on a **daily 06:00 UTC cron** in-season (also triggerable via "Run workflow"), then `npm run etl:sanity-check` — player count, projection non-degeneracy, `asOf` freshness, and `actualsThrough` never regressing versus the previously committed snapshot. Any guardrail failure fails the run and nothing is committed. If the snapshot changed and passed, it opens a PR (never pushes to `main` directly) and dispatches `ci.yml` on that branch so the required check populates — GitHub doesn't fire `pull_request` events for PRs opened by a workflow's own token. Manual `ETL_FRESH=1 npm run etl` stays available anytime between cron fires.

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
| `npm run etl` | Pull FPL data, project season points, collect per-GW actuals for finished gameweeks, **collect in-season opponent strength (Understat npxG/xGA, fixture-scores fallback)** once matches are played, and write `data/snapshot.json` (idempotent; disk-cached) |
| `npm run odds -- --profile free-kick-gw1-sat` | Pull a single daily slate's Odds API 1X2, totals, anytime-goalscorer, and assists O/U quotes into committed `data/odds/free-kick-gw1-sat.json` (reads `ODDS_API_KEY` from the shell or the gitignored `.env`) |
| `npm run lineups -- --profile free-kick-gw2-sat` | Pull a single daily slate's confirmed starting XIs (premierleague.com pulselive API, no key) into committed `data/lineups/free-kick-gw2-sat.json`; partial coverage (late kickoffs) is preserved, never fabricated |
| `npm run fbref` | Parse manually-saved FBref pages (data/fbref-raw/) → commit `data/fbref.json` → enrich snapshot volume terms → **fetch the PL stats API for the passing terms (passes completed / key passes)** → commit `data/pl-stats.json` → reproject (reuses the committed parses when the raw folder is empty) |
| `npm run model` | Recompute projections against the committed snapshot and print the ranked report (no API calls — the config-tuning loop). `npm run model -- --profile free-kick-gw1-sat` prints the GW1 Saturday slate pool ranked for that window (report only — the snapshot keeps the season projections) |
| `ETL_FRESH=1 npm run etl` | Same, bypassing the cache for fresh API reads |
| `npm run etl:sanity-check` | Guardrail checks against the current `data/snapshot.json` (player count, projection non-degeneracy, `asOf` freshness, optional `actualsThrough` non-regression via `PREV_ACTUALS_THROUGH`); used by the scheduled refresh, exits non-zero on failure |
| `npm run dev` | Vite dev server for the cheat-sheet UI |
| `npm run build` | Build the static UI bundle into `dist/ui/` (includes snapshot copy) |
| `npm run preview` | Preview the built bundle locally |
| `npm test` | Data-as-of stamp, parser/matcher, headline-driver, window-projection pool, model, window, and contest-profile tests |
| `npm run typecheck` | TypeScript check across the repo |

## Contest profiles (`src/contest/`)

Every contest the tool supports is a **contest profile** (`src/contest/profiles.ts`, #39): scoring table, roster shape + starter minimums, **window as an explicit fixture list**, draft-room shape, pool restriction, and the tournament/tiering/scenario knobs — one data object threaded through the model (`modelConfigFor`), the sheet/live panel (`buildRecommendations`, `LivePanel`), and the draft review (`reviewRoom`). Profiles live in **code**, not the snapshot: they're primary-confirmed contest *rules*, type-checked beside the code that consumes them, and the snapshot stays pure FPL data.

- **`false-nine`** (profile #1) — the season best-ball contest: today's behavior, preserved bit-for-bit (guarded by tests; ETL/model CLI run under it).
- **`free-kick-gw1-sat`** (profile #2) — Underdog's The Free Kick GW1 Saturday slate: the four 2026-08-22 fixtures kicking off after the 13:41Z close (HUL-MUN excluded — pre-close), roster 1/1/1/1 + 2 FLEX = 6 rounds, **no bench**, draft size 6, pool = the 8 slate clubs, scoring identical to False Nine. Its knobs are **short-window calibrated** (#46): `ceilingWeight` 0.4 (GPP-shaped — top-heavy payouts, 6/6 starters), tiering on window scale (`minGap` 1.0 ≈ one SoT, `maxTiers` 4, `maxTierSize` 8 — a 6-round room reads 3–4 tiers), and a `scenarios` override widening attacker p90 bursts to single-fixture q90/expectation ratios (FW ×2.0 / MD ×1.8 / D ×1.45 / G ×1.1 — a starter's single-fixture q90 is "scores once", not "×1.25 of a good season"; p10 burst 0.65 for the floor). One-slate provisional — retune once a few dailies have results. Carry-card review baseline (#45): `sheetPerfectFlagPercent` 72 — the sheet-perfect top-6 is nearly attainable for a 6-drafter no-bench room, so a clear miss sits far above False Nine's 45.
- **`free-kick-gw2-sat`** (profile #3) — The Free Kick GW2 Saturday Main slate ($3, 3-entry max): the four 2026-08-29 fixtures kicking off after the 11:11Z close (NFO-LIV 11:30Z, EVE-BOU and HUL-COV 14:00Z, NEW-TOT 16:30Z — no pre-close exclusion that week), same roster/room/scoring as GW1. Prize shape is more top-heavy than GW1 ($300 of $2,000 = 15% to first vs 10%) — same GPP direction, so the #46 knobs carry over unchanged pending the retune. Odds/lineup pulls key off the profile id (`data/odds/free-kick-gw2-sat.json`, `data/lineups/free-kick-gw2-sat.json`).

### Adding a weekly slate profile (manual recipe, #52)

Each Saturday's Free Kick slate is a new profile, hand-added from the contest page (decided **manual** in #52 — the lobby API surfaces the close time but not the fixture list, so copy/paste from the Underdog modal is the process; assist/automation revisited in the map's fog):

1. Capture from the Underdog contest page: close time (convert to UTC), game list, roster, scoring table, prize shape, entry max.
2. Verify the game list against the FPL calendar (committed `snapshot.json` fixtures or `fixtures/?event=N` live): every game must match a fixture, and any same-day fixture kicking off **before** close is excluded from the slate (GW1's HUL-MUN) — if one appears, double-check the close-time conversion before excluding. **Count check**: the modal's game list must equal the calendar's post-close count for that date — if the calendar shows *more*, Underdog bundled a subset and the `slate` predicate would silently over-include: pin the exact ids (`{ kind: 'fixtures', ids: [...] }`) instead.
3. Add the `ContestProfile` to `src/contest/profiles.ts` (id `free-kick-gw<N>-sat`, window `{ kind: 'slate', date, notBefore: '<close>Z' }`), carrying the previous slate's short-window knobs unless the prize structure moved materially.
4. Extend `src/contest/profiles.test.ts` (resolved fixture ids + clubs, registry assertion) and this README's profile list.
5. Later in the week, pull the per-slate assets: `npm run odds -- --profile <id>` (key from the shell or `.env`) and `npm run lineups -- --profile <id>` (no key — run ~30–60 min before the draft close so late-kickoff lists have maximum time to publish).

A profile's `WindowSpec` (`season` | `slate` | `fixtures`) resolves via `resolveContest(profile, snapshot.fixtures)` to an explicit fixture list — never a bare GW label; any window is a sum over its fixtures. The **active** profile is the UI's choice, persisted as an id in localStorage (`bbpl-profile`, default False Nine) and resolved by `src/ui/useContestProfile.ts`.

The Sheet tab's header carries a profile switcher (a `<select>` next to the theme toggle, shown once more than one profile is registered, grouped Season / Daily slates as the weekly cadence accumulates). Switching profiles re-ranks the board: False Nine reads the committed season projections as-is; any other profile is window-projected and pool-restricted **client-side** (`src/ui/windowProjections.ts`, same math as `npm run model -- --profile <id>`) — the committed snapshot itself is never touched. Off-board marks, my-roster, and the queue are namespaced per profile (`bbpl-drafted`/`bbpl-mine`/`bbpl-queue`, suffixed `:<profile-id>` for anything but False Nine) so switching to a slate contest never tramples the flagship's marks. Default stays False Nine until explicitly switched — today's pre-draft experience is unchanged.

**Data-as-of stamp (#44):** the header's meta line reports the committed snapshot's freshness under the active profile (`src/ui/asOfStamp.ts`, fed by the snapshot's `asOf` block): the scheduled refresh's pull time (`fetchedAt`), which GW's actuals are folded in (`actualsThrough`), and either the next kickoff (season) or the slate's close time (daily — it leads the line, the entry-cutoff and lineup-pull clock). A finished slate reads `closed 22 Aug` dimly; a pull over 30h old (daily ~06:00 UTC cron plus one whole missed run) turns the whole line negative with a `stale` marker — the visible freshness cue the ETL-time guardrails (#41) can't give mid-draft.

## Window-parametric projections (#42)

Every projection is a sum over an **explicit fixture window** (`ProjectionWindow` in `src/model/types.ts`: calendar + window fixtures + draft pool). Season minutes allocate 1/38 per fixture (GK expected starts likewise), and each fixture applies opponent factors **relative to the club's own calendar-mean baseline** — attack terms (goals/assists/SoT/chances), clean sheets, goals conceded, GK wins, and saves (a harder fixture means a busier keeper). Because the factors average exactly 1 over a club's season, the season window is opponent-neutral **by construction**: the committed False Nine projections are reproduced bit-for-bit (guarded by `src/model/window.test.ts`), while short windows — a GW range or a single-day slate — express real schedule strength. Pool clubs scope rank/tier/value; league priors always estimate over the full population. All factor slopes are knobs in `src/model/config.ts` (`fixture`).

**Results-driven opponent strength (#92, DVOA-style)**: pre-season, opponent factors are FPL-FDR slopes as above (`src/model/config.ts` `fixture`), bit-for-bit. Once the snapshot carries a `strength` section — the ETL writes it after the first current-season match — the factors switch to **results-driven shrunk multipliers** (`src/model/strength.ts`, knobs in `config.ts` `strength`): per-club attack/concession multipliers estimated from Understat npxG/xGA in the #43 pseudo-count form (kA=6/kD=10, goal-scale fallback shrinks harder), seeded from FDR-extracted quality so n=0 is pure FDR (no cliff between the two regimes). Each fixture's factor is the opponent-keyed multiplier ratio `(M/M̄_calendar)^γ`, renormalized so every family averages exactly 1 over the club's calendar — season windows stay opponent-neutral, single-fixture slates express *this week's* opponent. Own-club strength cancels in the ratio by construction (it lives in the #43 actuals blend); venue rides a league-wide `homeBoost` knob. Per-family γ dials control response magnitude; a club with zero matches stays exactly its FDR seed, so the pre-season snapshot reproduces bit-for-bit. Research grounding: `docs/research/opponent-strength-signals.md`.

For a daily slate with `data/odds/<profile-id>.json`, the client also computes an **Odds Pts** value by conservatively blending listed player goal/assist props and fixture 1X2/total-goals markets into the relevant per-fixture rates. The Sheet shows that extra column only when the asset has a pull timestamp and at least one fixture; an unpulled `fetchedAt: null` placeholder behaves exactly like no odds asset. An `O` badge means at least one player or fixture term had odds coverage, while an unmarked row used FDR-only fallback. Opening a covered player's scoring breakdown shows its model, odds-implied, and blended rates per covered term plus the odds asset's `fetchedAt` stamp; missing terms remain model-only with no placeholder rows. It is a display-only companion to model Pts: `#`, position rank, tier, VORP, and tournament score always remain model-only. Missing fixture or player coverage silently retains the model term; False Nine never reads an odds asset.

**Start-aware slate minutes (#97):** an optional static `data/lineups/<profile-id>.json` asset makes expected minutes per fixture responsive to confirmed starters and benches. The factor precedence is the manual UI override map (`localStorage` key `bbpl-start-overrides:<profile-id>`), then the lineup asset, then the unchanged model default of `1.0`. A confirmed starter uses the player's season-share minutes divided by start probability (capped at 90); a confirmed non-starter receives the configurable 18-minute cameo floor, never zero. The p10/p90 scenario machinery then widens around that called p50 base. A player's breakdown modal records the source, aggregate factor, and fixture calls. No asset (or `fetchedAt: null`) leaves current slate numbers unchanged; season/False Nine projections do not carry the new field and remain byte-identical. See [`data/lineups/README.md`](data/lineups/README.md) for the asset and override-map contracts. Verified against GW1 actuals in the [GW1 start-call ledger](docs/research/gw1-start-call-ledger.md): the lineup pull's calls were essentially perfect on start status, correct calls cut slate minute error ~a third (MAE 28.0′→19.1′), and the 18′ cameo floor matches the played-cameo mean (18.3′) while ~55% of bench calls never appear (EV ~8–9′).

**Slate start surface (#98, daily profiles):** the sheet mounts the #97 machinery as UI — a **Min** column (expected minutes over the slate window, already start-aware) beside Pts, holding a clickable **start chip** per player: `S` starting (green) / `B` benched (red) / `?` unknown (muted), dashed border when the call is yours. One click cycles auto → starting → benched → auto (under the 30-second clock there's no menu to open); the call persists per profile+slate in `bbpl-start-overrides:<profile-id>` and re-projects the board immediately under the #97 precedence manual > lineup > model. A `⊘` marker (mirror of the odds `O` badge) flags players whose fixture is **structurally unknown at close** — late kickoffs whose confirmed XI lands after the slate locks (on GW2 Sat, every fixture until the lineups pull; then just NEW-TOT 16:30Z) — and the breakdown modal shows each fixture's P(start), the call's source (your call / confirmed XI / model share), and the 18′ cameo floor behind a bench call. Chips print with the sheet. False Nine mounts none of it: no column, no chips, no storage key — the flagship view stays pixel-identical.

**Matchup strip (#108, daily profiles):** the slate sheet docks a thin, collapsible strip of per-fixture matchup chips sticky at the top of the board, ABOVE the position-filter/search bar (strip and filters pin together as one stack; the table header's own sticky offset tracks that stack's measured height via the `--bbpl-sticky-top` CSS custom property, falling back to the historical 44px when unset) — mid-draft "betting site" context for every game on the slate. Each chip shows the model's predicted score (the pool's window-projected p50 expected goals per club — the same opponent-adjusted, start-aware, odds-blended math the board ranks on), a 1X2 bar with win/draw/win percentages from an independent Poisson grid over those λs, both clean-sheet probabilities, and over-2.5; fixtures priced in the slate's odds asset also show `MKT` — the bookmaker 1X2 consensus (implied probabilities normalized per book, averaged across books). Unpriced fixtures simply omit the market line. Styling is deliberately distinct from the board: an accent-tinted band (`bg-accent/5` + `border-accent/30`, the position-badge highlight treatment) wraps the whole strip so it reads as one context zone, with raised chips (`bg-surface-raised` + `border-strong`). The data hues are one-per-meaning: home = info blue, away = positive green, draw = muted gray — never the theme accent (which reads as "active/selected" UI) — and the 1X2 percentages are colored to match their bar segments exactly, so hue says *side* while bar length says *favorite*; `MKT` renders in the section's accent, distinct from every data hue. Kickoff timestamps are omitted (the slate defines the window), and every probability is explicitly `%`-suffixed (`62%/21%/17%`, `CS 41%/28%`, `O2.5 57%`) so bare numbers never read as scores. Display-only: the strip consumes what the board already computed (`src/ui/matchupContext.ts`), never feeds the model. False Nine's 380-fixture window renders no strip; the open/collapsed preference persists in `localStorage` (`bbpl-matchup-strip`, default open).

## Project Structure

```
src/
  etl/        # Data pipeline → data/snapshot.json
    fpl.ts    #   FPL API client: disk cache (.etl-cache/), retry/backoff, concurrency cap; event-live rows join bootstrap players by FPL `id`
    actuals.ts #   Per-GW actuals pipeline: GW completeness, featured filter, asOf stamp (#40)
    fbref.ts  #   FBref parser: manually-saved league pages → per-player volume stats
    fbref-merge.ts #  FBref↔FPL matching + snapshot enrichment (npm run fbref)
    strength.ts #  Opponent-strength section: Understat npxG/xGA + fixture-goals fallback (#92)
    index.ts  #   Orchestration: bootstrap + season history + fixtures + per-GW actuals + strength → snapshot
    types.ts  #   Canonical snapshot contract (shared with the UI)
  model/      # Season-long False Nine projection model
    config.ts   #   Scoring table + every model constant — the tuning surface
    scoring.ts  #   Pure statline → points scorer (the substrate)
    project.ts  #   Minutes/rates/volume/team priors → p10/p50/p90 projections
    strength.ts #   DVOA-style shrunk opponent multipliers + per-fixture ratio factors (#92)
    actuals.ts  #   Season-to-date aggregation of per-GW actuals + results (#43)
    cli.ts      #   npm run model: recompute + ranked report
  contest/    # Contest profiles (#39): a contest's rules as one data object
    profiles.ts   # Profile type + registry (False Nine, The Free Kick GW1/2 Sat) + resolveContest(window→fixtures)
    profiles.test.ts # Bit-for-bit False Nine parity + window/club resolution
  ui/         # Browser-only React cheat sheet (Vite)
    App.tsx         #   Snapshot load, view nav (Sheet/Drafts), carry-card pin, sticky controls bar
    PlayerTable.tsx #   Ranked tier table: bands, rows, flags
    useProfilePool.ts # Window-projected pool for ONE profile (+odds/lineups assets) — sheet, intake, review, carry pin (#45)
    useDrafted.ts   #   Mark-drafted state persisted to localStorage
    useContestProfile.ts # Active contest profile (localStorage id → profiles registry)
    windowProjections.ts # Client-side pool projections for the active profile (#47)
    startOverrides.ts #   Daily start-call override map: load/save + pure edits (#97/#98)
    useStartOverrides.ts # Live per-profile manual calls driving the sheet's chips (#98)
    drafts/         # Draft-review slice (#20): rooms, intake, review lenses
      types.ts      #   Parsed-log + room-record contract (the #22 parser produces this)
      parse.ts      #   Recap paste-parser + name matcher (#22, built against the first real recap)
      parse.test.ts #   Parser/matcher tests vs the committed fixture (npm test)
      store.ts      #   localStorage working store + export/import (data/drafts/)
      review.ts     #   Pure lens math: deviations, headline, best-9, tier mix, club grid, flags
      exposure.ts   #   Per-player, per-competition exposure and entry-capital math from live rooms
      fixture.ts    #   DEV-only deterministic 12-team season + 6×6 slate room for exercising the flow
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

`data/snapshot.json` is generated by `npm run etl` and committed. Per player: identity, False Nine position, team, 2026/27 FPL price, availability status, **labeled multi-season stat lines** (most recent first; minutes/starts/goals/assists/clean sheets/goals conceded/saves/pen saves/xG/xA/FPL points) from FPL `element-summary` history, and a **season-long projection** (`projection`) — False Nine points at p10/p50/p90 with the full auditable stat line, per-90, ceiling-per-90, a **tournament-adjusted score** and durability-risk flag, value (tournament score per £M), position/overall ranks, tier, and a confidence grade (history depth). Also includes the full 380-fixture list with per-fixture difficulty ratings (Round 1 scores MW 1–26) — and, once fixtures are played, each fixture's final score.

**Underdog position corrections (#60)**: player positions default to FPL's `element_type`, then `npm run etl` applies the small, checked-in table in `src/etl/position-overrides.ts`. Add an entry only when Underdog's pool or a reliable Underdog-position source visibly disagrees during draft prep or a live draft: use the player's string FPL id, the Underdog position (`G`, `D`, `MD`, or `FW`), and a dated source note. This keeps every manual exception auditable instead of replacing the FPL-derived default.

**Per-GW actuals (#40)**: for every gameweek whose fixtures are *all* finished, `npm run etl` pulls `event/{gw}/live` (one call per GW covers all players) into the snapshot's `actuals` section — one row per player who featured (minutes > 0 or any non-zero stat; absence = did not feature), carrying minutes/goals/assists/clean sheets/goals conceded/saves/pen saves/xG/xA plus FPL points as a cross-check. Retention is all-season (~300–400KB raw per GW, oldest GW first). Re-runs are idempotent — rows are byte-identical unless FPL corrects its data. The **`asOf` stamp** at the top of the snapshot is the freshness contract: `fetchedAt` (when the run observed upstream), `actualsThrough` (highest complete GW — 0 pre-season), and `nextKickoff` (earliest unfinished fixture, i.e. when the snapshot starts going stale). A GW held up by a postponed fixture doesn't claim completeness until the replay finishes; per-GW volume terms (shots/crosses/tackles/passes) aren't in FPL's live feed and stay season-aggregate from FBref/PL.

**In-season opponent strength (#92)**: once the current season has played matches, `npm run etl` adds a `strength` section — per-club season-to-date attack/concession **sums** (`{n, attack, concede}` keyed by FPL short code) plus the source's league mean, from Understat per-match team npxG/npxGA (read through the same Playwright page-load as the key-pass validation; the ETL probes both season-start years and selects by match dates to sidestep Understat's season-rollover lag) with fixture final scores (GF/GA) as the always-current fallback. The section stores **sufficient statistics, not multipliers** — the model derives shrunk multipliers at projection time so calibration knobs never force an ETL re-run. It's omitted entirely while nothing is played (pre-season parity: the model runs its FDR-only path bit-for-bit); a hard failure if matches are played but no source yields aggregates. FPL summed player xG remains a researched-but-unwired fallback (GW-gated, 1dp-rounded, pen-inclusive) pending the GW1–3 cross-check vs Understat club xG.

**Daily-slate odds (#61)**: `npm run odds -- --profile <daily-profile-id>` is a manual, close-to-draft ETL step—not part of the scheduled FPL refresh. Set `ODDS_API_KEY` to a free-tier [The Odds API](https://the-odds-api.com) key — exported in your shell or in the gitignored `.env` at the repo root (auto-loaded via `dotenv/config`; an inline `ODDS_API_KEY=…` prefix still works and wins) — then run, for example, `npm run odds -- --profile free-kick-gw1-sat`. It writes the reviewable static asset at `data/odds/<profile-id>.json`; commit it on a PR for human review—never push directly to `main`. The asset preserves bookmaker-attributed decimal 1X2/total-goals quotes for each available fixture and anytime-goalscorer/assists-O/U quotes for listed FPL players. Partial coverage is expected: unpriced fixtures and unlisted players are absent, so a consuming model must fall back to FDR. See `data/odds/README.md` for the versioned contract.

**Daily-slate lineups (#99)**: `npm run lineups -- --profile <daily-profile-id>` is the same manual, close-to-draft ritual against the Premier League site's pulselive API (research #96: no auth, no key, `Origin` header only) — run ~30–60 min before the slate's close, then commit `data/lineups/<profile-id>.json` on a PR. The asset carries a per-fixture coverage mask and per-player `starter`/`bench` calls keyed to FPL ids, feeding the start-aware slate minutes (#97): known starters get per-start minutes, known non-starters the cameo floor, and anything uncovered falls back to the model default. Partial coverage is expected and preserved — confirmed XIs publish ~60–75 min pre-KO, so late-kickoff fixtures are structurally uncovered at close and ride the manual override (#98) instead; unmatched pulselive names are reported by the CLI, never fabricated. See `data/lineups/README.md` for the versioned contract.

### Model v1 shape (`src/model/`)

- **Minutes**: recency-weighted (55/30/15) durability prior, injury-status haircuts, a **fixture-congestion haircut** for outfield players on top-6 win-rate teams (Europe/cup rotation proxy, inside MW 1–26), and a per-team **goalkeeper job-share cap** (one team = one ~3450-minute starting job, shared proportionally to priors). **Team × position-group minute caps (#83)**: a club fields exactly 11 players, so its realized season total is exactly 37,620 minutes and the independently-estimated per-player expectations must respect that ceiling — each team's D group is capped at `defenderSlots` (4) × 3420 and the MD+FW group at the remaining 6 × 3420 (the mid/forward split is formation-flexible), scaled down proportionally within an over-cap group (only-down; under-cap teams — thin snapshots, youth minutes — are never inflated). The caps apply to the season minutes, so every fixture window inherits the corrected level as its prorated 1/n share. **Newcomers** (no FPL history — a third of the pool, the entire promoted contingent) get a **price-informed minutes prior**: per-position FPL-price → minutes fit over established players, discounted 0.85 for survivorship — FPL prices newcomers by expected role, so a £5.5 new midfielder projects ~1500 minutes instead of a flat 850. **Thin history**: seasons under 90 minutes count as missing data, not zero output (one real season averaged with cameo rows no longer halves).
- **Attacking rates**: xG/xA-weighted per-90s (70/30 blend with actuals), regressed toward position mean by sample size.
- **In-season actuals blending (#43)**: once GWs complete, the snapshot's `actuals` section feeds every prior family through pseudo-count shrinkage — weight = sample/(sample + k), zero with no data, so the pre-season snapshot is reproduced bit-for-bit and the blends asymptote to fully observed as matches accumulate (all knobs in `src/model/config.ts` `actuals`; deterministic — the cron refresh re-projects identically). **Minutes**: observed minutes per team-match prorated over the club's calendar and blended against the durability prior (`minutesK`); the observed share carries today's status haircut. **Rates**: observed per-90s (x-weighted like the priors) blend into the shrunk attacking rates by observed minutes (`ratesK`) — the newcomer's price-prior minutes hand off to real output gracefully. **Team priors**: CS/GC/win rates blend with match results (`teamK`), so a promoted club's league-mean prior starts tracking its own results immediately. **GK job-share**: observed starts (a GW row with ≥60' — FPL's live feed has no start flag) prorate to the 38-start job and blend into the starts-claim model (`gkK`), re-normalized so the club's job stays conserved. Start-fraction and GK saves blend on their own knobs; durability flags and CS eligibility read the blended values. Aggregation lives in `src/model/actuals.ts` (`aggregateSeasonActuals` — team truth from fixture scores, player truth from GW rows; transfers are v1-unhandled: a mover's rows keep blending into his current club). Each projection carries an `actualsBlend` audit stamp (club matches played, observed minutes, applied weight).

- **Results-driven opponent factors (#92)**: the fixture-factor layer above switches from FDR slopes to shrunk results-driven multipliers once `strength` data exists (knobs in `config.ts` `strength`: kA/kD shrinkage, per-family γ, `homeBoost`, `seedSlope`). Own-club strength cancels in the fixture ratio (it's already in the #43 blend); only opponent + venue differentiation lands on a fixture.
- **Volume terms** FPL can't express (SoT, chances created, crosses, tackles, passes): **per-player rates from FBref league pages, with the passing terms (passes completed / key passes) from the Premier League stats API** (recency-weighted over 2025/26 + 2024/25, shrunk toward the position's covered mean by sample size, **per term**) when that term has data — see the FBref section below; league-average conversions + per-position baselines for uncovered terms (players without rows, e.g. promoted squads, or pages that were never saved).
- **Defense**: team CS/GC/win-rate priors from the 2025/26 primary keeper (regressed to league mean; promoted teams get the mean), personal saves rate for GKs.
- **GK expected starts**: the keeper job is **38 starts per club**, not continuous minutes — a keeper claims club starts by starting ≥8 matches last season (recent starting evidence; stale cross-club minutes can't claim the #1 job), claimants keep their recency-weighted starts prior (injury risk priced), scaled down only when the pool overflows 38, and the bench inherits the residual. Wins/CS/saves follow structurally: matches = starts × club rates — the club's season of win/CS/save opportunity is counted exactly once.
- **Durability**: the unused-subs rate (FBref playing-time page — games spent entirely on the bench per 90 played) joins the minutes/start-rate checks in the **durability-risk flag**, so bench-heavy rotation bets get the dampened-ceiling treatment even when their raw minutes look serviceable.
- **Scenarios**: parametric p10/p50/p90 (minutes 0.6×/1.0×/1.1×, burst 0.88×/1.0×/1.2–1.25× by position, team-form on CS/wins) — no Monte Carlo (out of scope per the map).
- **Tournament-shape adjustment**: rank/tier/value key off a `tournamentScore` — `p50 + ceilingWeight × (p90 − p50)` — that blends toward the p90 ceiling (best-ball pays for boom weeks, not mean output). A **durability-risk flag** (projected minutes share < 50% of a full season, or multi-season start rate < 55%) dampens the ceiling boost to 30% for flagged players, since a spike proxy is only worth drafting toward if the player is trusted to be on the pitch for the 26-week Round 1 grind. Raw `points.p50` is untouched and stays visible as the unadjusted "Pts" column — the adjustment is a separate, auditable figure, not folded silently into the headline number.
- **Tiers**: **natural breaks in each position's `tournamentScore` distribution** — cut where the neighbor gap exceeds max(8, 2.5 × median gap); flat plateaus split at their largest internal gap up to 15-wide tiers; past the position's draft depth everything is residual tier 9. Forward-looking by construction: tiers are the clusters the model's own estimates form, never price/value bands.
- **Draft value (VORP)**: `draftValue` is `tournamentScore` minus the score of the last player at that position a full league would still be starting — the replacement depth implied by the active contest's roster shape (`ReplacementConfig`/`DEFAULT_REPLACEMENT` in `src/model/config.ts`, derived per-profile by `replacementConfigFor` in `src/contest/profiles.ts`: dedicated starters plus an even share of FLEX across D/MD/FW). `overallRankByValue` is the cross-position rank by `draftValue` instead of raw points — the Sheet's Points/VORP toggle switches between the two.

Every constant lives in `src/model/config.ts`; tune and re-run `npm run model`, which also prints a **team defensive context table** (projected CS/match, GC/match, GK win rate) for clean-sheet-first drafting.

## Design

UI follows the design system in [`DESIGN.md`](DESIGN.md) — data-dense sports analytics, semantic Tailwind tokens, IBM Plex typography, position badges (G/D/MD/FW) fixed across themes.

### Cheat sheet view (v1)

A single ranked table over the snapshot, built for draft day (the **Sheet** tab):

- **Ranking**: overall by tournament-adjusted score, or within-position (`posRank`) when a position filter is active. In the overall (ALL) view, a **Points / VORP** toggle switches the cross-position ordering: **Points** ranks by raw tournament-adjusted score; **VORP** ranks by `draftValue` — score above the last player at that position a full league would still be starting, given the active contest's roster shape (dedicated starters + an even FLEX share). Raw points overrates shallow, low-variance positions (e.g. a keeper can outscore a midfielder on points while being nearly interchangeable with the next-best keeper); VORP corrects for that. The toggle only appears in the ALL view — within one position, points and VORP order agree. Choice persists in localStorage.
- **Tier bands**: in a position-filtered view, natural-break tiers render as labeled divider rows (`Tier 3 · 2 players · 308.8–308.1 pts`); in the overall view tiers interleave across positions, so tier shows as a compact per-row `T4` column instead.
- **Columns**: pick toggle, rank, player, position, team, £ price, projected p50 points (raw, unadjusted), tier, /90 efficiency, ceiling (p90 per 90 — the best-ball spike proxy), value (tournament-adjusted score per £M), and VORP (`draftValue` — points above position replacement level).
- **Flags** (hover any chip for its meaning): `!` marks non-available status (hover for the injury/suspension news); `±` / `?` chips mark medium / low projection confidence; `R` marks durability/minutes-risk (thin projected playing time for the 26-week grind — dampens the ceiling boost feeding rank/tier/value). When a player has been selected in locally logged rooms for the active contest profile, a neutral `##%` chip shows their rounded exposure; hover for its raw rooms fraction and competition scope. Players with no matching logged exposure remain unmarked.
- **Search** matches player name or team; **Hide off-board** (default on) removes drafted players from the board.
- **Row controls** (three, hover-revealed): `✓` marks a player **off board** — drafted by *anyone* in the room, not necessarily by you; `M` marks **my pick** (sets your roster + off-board together); `★` **queues** a target (watch list). All persist in localStorage per draft session.
- **Player breakdown modal** (the `i` row control): a scoring-math table (stat × weight = subtotal, exactly mirroring `scoreStatline`'s position gating), an estimated-range chart (p10/p50/p90), and a **Why this projection** section — plain-language headline drivers generated client-side from the raw explanation fields on `PlayerProjection`: minutes basis (observed history / price-tier newcomer prior / keeper starts-claim), congestion haircut when it fired, confidence basis (season count + weighted minutes), durability risk naming the exact thresholds tripped, and team-context basis (observed club priors vs promoted-team league-mean fallback).
- **Live draft panel** (collapsible, above the table): roster shape chips vs starter minimums (`FW 1/2`, red = need) **plus a FLEX chip** (`FLEX 1/2`) so every spot that starts is tracked — overflow drafted beyond a position's exact starters fills FLEX, and further overflow is bench; on no-bench dailies the header adds `no bench — all start` since all 6 picks start, **correlation watch** (same-club clusters; `CS corr` flags G+D pairs whose clean sheets are the same event), **From your queue** (your ★ pool still on the board, best first), **Best on board** (top-3 BPA), and a **default target per position** with NEED/ok/full state and scarcity tags (`T2 ×3 left`) — the mid-to-late-round answer to "I don't know half these players".
- **★ Queue filter**: the `★ Queue (n)` toggle filters the board down to your queued targets — the Underdog watch-list pattern, mid-draft.
- **New draft**: full reset of off-board marks, roster, and queue between drafts.
- **Print-friendly**: printing (or Print preview) flips any theme to light paper/dark ink via a print token override, hides interactive controls, and tightens row density — print with filters active to scope the sheet (e.g. MD-only page).
- **Carry-card pin**: when a reviewed draft room exists for the *active* contest's competition, its carry-forward card (auto-flags + your note) pins at the top of the sheet for the next draft — collapsible, never printed. Per-competition (#45): each contest's rooms pin under that contest only, reviewed with the room's own numbers.

### Draft review (v1)

The **Drafts** tab — the between-drafts review loop for the practice-then-flagship plan. Paste-parse is the only intake (#19): **paste** Underdog's draft-recap text into the paste box, **load a saved recap page** (`.mhtml` from Chrome/Edge ⌘S → *Webpage, Single File*, `.html`, or `.txt`), or hit **Paste from clipboard** after the one-click **Capture Underdog recap** bookmarklet grabs it off the recap page (install + why in [`docs/recap-capture.md`](docs/recap-capture.md)). All three intake paths run through the same decoder → the same parser. The intake carries a **contest select** (defaults to the active sheet profile — pick a different one when the pasted room was drafted under another contest). The **recap parser (#22)** builds the full-room pick log — pick/round/team from the `1.6|6`-style board anchors, names matched against the FPL snapshot (normalized diacritics/case/punctuation, last-name + first-initial; mononyms like Rayan exact-match the FPL web name). Ambiguous names get a **one-click confirm queue**; unmatched picks (transfer insurance / non-EPL names outside the FPL pool, by design) stay flagged and excluded from the math. The anchors are contest-shape-generic — the same parser handles a 12×18 season room and a 6×6 no-bench daily room (verified against the two real GW1 Saturday recaps committed under `data/drafts/fixtures/`, #45). The parser is locked in by tests (`npm test`) against the committed paste fixtures (`data/drafts/fixtures/`); the real saved page (`data/udraft-raw/`, gitignored) is regression-checked byte-for-byte when present locally. **Re-parse** over a stored room re-runs the parser without clobbering your team pick, confirmed matches, or carry note. A DEV-only fixture button simulates a full room against the current snapshot for exercising the flow without a real paste — a 12×18 season snake under the season profile, or a 6×6 no-bench slate snake (over the window's real projected pool) under a daily one, each engineered so every review lens has material. The pure `computeExposure(rooms)` helper uses the same live local room set: for every player and competition it returns the share of logged rooms containing that player on your team and the sum of those rooms’ known entry costs; unmatched picks are excluded and uncategorized rooms stay grouped together.

The **Exposure** view, beside Drafts in the More views menu, turns that live aggregate into a per-competition table. It opens on the competition updated most recently, defaults to exposure percentage descending, and can switch to capital committed sorting. Exposure only includes rooms whose team has been selected and matched picks from the current snapshot.

- **Rooms**: localStorage is the working store; **Export** downloads the record verbatim as `data/drafts/<yyyy-mm-dd>-<room-slug>.json` to move into the repo and commit (the archival step), **Import** restores it. Every room is **tagged with the contest it was drafted under** (#45): `profileId` persisted at creation (the intake's contest select), with the editable competition label defaulted from the profile name + slate date; the room list groups by that tag (DAILY/SEASON badge per room). Rooms created before #45 (no `profileId`) are back-filled from their competition label when it matches a known contest — and, when there's no label either, from the pick log itself (36 picks across 6 teams from one slate's clubs → that slate's profile, auto-applied on open) — otherwise they review under the active profile. Room facts: name, draft date, entry cost ($3/$15/other), editable competition, draft URL, my team (dropdown of recap teams), carry note. Competition values from existing rooms are offered as autocomplete choices.
- **Pick log**: the full log (216 picks for a 12×18 season room, 36 for a 6×6 slate) with inline editing as the pressure valve — re-match a player (search-select), fix a team name, delete/add picks; pick/round renumber automatically.
- **Review panel** (needs my team picked) — the #18 lenses, always run under **the room's own contest profile** (#45: its window clubs, roster shape, and window-projected pool — a Free Kick room reviews against slate numbers even while False Nine is the active sheet profile; the panel shows which contest it ran under):
  - **Headline**: roster total vs the profile's naive sheet-perfect legal roster, as % (tournament score, raw p50 alongside — the carry-card flag threshold is per-profile: 45 for a 12×18 season room, 72 for a 6×6 no-bench slate)
  - **Per-pick deviation**: each own pick vs the best sheet player still on the board — BPA delta primary (rank + points), best same-position secondary
  - **Best N**: pseudo-starters by projection (1 G / 2 D / 2 MD / 2 FW / 2 FLEX for the season, 1/1/1/1 + 2 FLEX = 6 for a slate), with the tier mix and a floor gauge (avg p10/p50)
  - **Club coverage**: the contest window's clubs × G/D/MD/FW counts, shaded by model strength (CS quartile for G/D, attack quartile for MD/FW) with auto gap-flags
  - **Carry card**: top auto-flags + one free-text line — pinned on the cheat sheet during the next draft
- **Carry cards per competition** (#45): the sheet's pin shows the latest room of the *active* contest's competition only (the same scoping Exposure uses), reviewed under that room's own profile — switching to GW2 shows GW2's card, never GW1's.

## Workflow

This repo is being charted with the Wayfinder skill — the map issue and its tickets live on this repo's GitHub tracker. `/grill-me` for design stress-tests; research findings land on `research/<name>` branches under `docs/research/`.

## The False Nine (context)

18-round snake draft · roster 1 G / 2 D / 2 MD / 2 FW / 2 FLEX / 9 BENCH · auto-set best-ball lineups each match week · Round 1 = MW 1–26, finals MW 35–38 · lineups must span ≥ 2 clubs · non-EPL players in pool as transfer insurance.
