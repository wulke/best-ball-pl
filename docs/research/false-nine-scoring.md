# Research: False Nine scoring rules and weekly starter config

**Ticket:** #3 · **Date:** 2026-08-17 · **Branch:** `research/false-nine-scoring`

## Question

What are Underdog's exact scoring rules for The False Nine EPL best ball tournament, and the weekly best-ball starter configuration?

## Access note (read this first)

Underdog's own contest/rules pages are behind Cloudflare bot protection:

- `https://app.underdogsports.com/rules/tournaments/the-false-nine` (the `rules_url` returned live by Underdog's own unauthenticated lobby API, see below) returns **HTTP 403 "Attention Required! | Cloudflare"** to `curl` regardless of User-Agent.
- `help.underdogsports.com` (Underdog's Intercom-hosted help center; `help.underdogfantasy.com` 301-redirects there) also returns 403 to `curl`, though it is reachable via `WebFetch` for pages that *don't* require the extra bot check — used below for the Opta stat-provider citation and best-ball mechanics.
- `web.archive.org` has no snapshot of either False Nine or Premier Pup rules pages (checked via the Wayback `available` API — empty `archived_snapshots`).
- Underdog's public API (`api.underdogfantasy.com/v2/lobby`, no auth required) confirms the contest exists and gives structural metadata (see below), but has no scoring-rules endpoint reachable by path-guessing (`contest_styles/{id}`, `rules/tournaments/*`, `scoring_rules`, `sports` all 404).

Given this, **the points table below is not sourced from a page Underdog serves directly to this agent.** It is corroborated by two independent RotoWire articles (2026/27 EPL best ball season, published on rotowire.com, a paid subscription soccer-fantasy outlet) whose scoring tables are internally consistent with each other, and which match — value-for-value — a third, independent source (Rotogrinders' Underdog **World Cup** best ball guide) describing what is evidently the same universal Underdog soccer scoring engine. Treat the point values as high-confidence but not primary-verified; flag for spot-check against the live contest page once Cloudflare access is available (e.g., logged-in browser session, not `curl`).

## Contest identity (primary source: Underdog's own public API)

```
GET https://api.underdogfantasy.com/v2/lobby   (unauthenticated, 200 OK)
```

The False Nine tournament record (id `ea9924ae-f0fa-4397-850d-6d793f5399f4`):

- `title`: "The False Nine", `description`: "EPL Best Ball! - $2k to first!"
- `total_rounds`: 4 — `additional_info`: "Round Advancement: 2/10 - 2/5 - 1/5 - 120 Seat Final"
- `tournament_rounds`: Qualifiers = "Match Weeks 1-26" (round 1), then quarterfinal/semifinal/final rounds (round `status` was `"drafting"` as of 2026-08-17)
- `cutoff_at`: 2026-08-21T15:29:00Z; slate `start_at`: 2026-08-21T17:00:00Z, `sport_id`: `"FIFA"` (Underdog's internal sport code for soccer), slate `title`/`description`: "2026 EPL Season", `best_ball`: true
- `rules_url` (as served by Underdog itself): `https://app.underdogsports.com/rules/tournaments/the-false-nine` — confirms Underdog rebranded its rules/app domain from `underdogfantasy.com` to `underdogsports.com` sometime before this snapshot; both `underdogfantasy.com` root and `help.underdogfantasy.com` 301-redirect to the `underdogsports.com` equivalents.

This matches the format already known from ticket #1's parent rules text (18-player draft, 4-round structure, weeks 1-26 qualifier).

## Points table (points table sourced as described in "Access note" above — not primary-verified)

Universal Underdog soccer best-ball scoring (confirmed identical across the EPL games — The Premier Pup / The False Nine — and Underdog's World Cup best ball product; source: RotoWire "Underdog EPL Best Ball Strategy 2026/27: Premier Pup Guide" and RotoWire "Underdog EPL Best Ball Rankings 2026/27", cross-checked against Rotogrinders "World Cup Best Ball Guide on Underdog (2026)"):

| Stat | Points |
|---|---|
| Goal | +8.0 |
| Assist | +4.0 |
| Shot on target | +2.0 |
| Shot off target | +1.0 |
| Chance created | +1.0 |
| Cross | +0.75 |
| Successful tackle | +0.5 |
| Successful pass | +0.05 |
| Clean sheet (GK and D only) | +5.0 |
| Goalkeeper win | +5.0 |
| Save (GK) | +2.0 |
| Penalty save (GK) | +3.0 |
| Goal conceded (GK/D only) | -2.0 |

**Not found in any accessible source** (checked RotoWire ×2, Rotogrinders, VegasInsider, Underdog help-center Pick'em/soccer article, and direct API/page probing): explicit point values for cards (yellow/red), minutes-played thresholds for clean-sheet/appearance eligibility, penalty-won/penalty-conceded/penalty-missed events, and own goals. One AI-search summary surfaced a "4.0 clean sheet, 60-minute threshold, defensive contribution bonus" variant, but on verbatim re-fetch of its cited RotoWire source that language was **not present in the article** — it appears to be a hallucinated conflation with the *official* FPL 2025/26 "defensive contribution" rule (a different product, not Underdog). Discarded; do not use those numbers.

Cards *are* a tracked stat in Underdog's system generally — the Pick'em soccer scoring article (see stat-provider section) defines "Cards - combined total of yellow and red cards" as a stat Underdog tracks for player props — but no best-ball point value for it was found.

## Weekly starter configuration (best-ball auto-start)

Confirmed by two independent RotoWire quotes (identical wording) and one general web-search summary, all describing the same EPL product:

> "Each Gameweek Underdog auto-starts your best nine: one goalkeeper, two defenders, two midfielders, two forwards and two flex spots that can be any outfielder."

- Starters per match week: **1 GK + 2 D + 2 MD + 2 FW + 2 FLEX (any non-GK) = 9 starters**
- Roster drafted: **18 players** total (confirmed by ticket #1's rules text and the RotoWire strategy article: "Drafts consist of 18 total players across 10-person rooms")
- The other 9 rostered players sit on bench each week; there is no lineup-setting — Underdog's own Best Ball Contest Guidelines (primary source, see below) confirm the platform *automatically* selects the highest-scoring eligible players at each position as starters, so "starter" status is scored retroactively per week, not chosen by the entrant.
- Note: this 9-starter (1/2/2/2/2) shape is EPL-specific. Underdog's separate World Cup best ball product uses a *smaller* weekly lineup (1 GK + 1 D + 1 MD + 2 FW + 1 FLEX = 6 starters from a 12-man roster) — do not reuse World Cup lineup shape for False Nine modeling, only the points table is shared.

## Scoring cadence (primary source)

Source: `help.underdogsports.com/en/articles/8991638-best-ball-contest-guidelines` (fetched via Wayback Machine snapshot `20260418065749`, since live fetch 403s):

> "At the end of each sport's week, Underdog automatically selects the entrant's highest scoring players at the designated positions to be 'starters' and only those players' statistics over that week are counted towards the entrant's accumulated score. This means entrants do not need to set their lineups."

For EPL/FIFA sport_id, "week" = Premier League match week / Gameweek (consistent with the API slate's "2026 EPL Season" framing and the round description "Match Weeks 1-26"). Scores accumulate weekly across the 4-round tournament structure described above.

## Stat provider

Source: `help.underdogsports.com/en/articles/11006231-pick-em-scoring-soccer-fifa` ("Pick'em Scoring - Soccer/FIFA", fetched via Wayback Machine snapshot `20260418064521`):

> "Domestic leagues and competitions, UEFA competitions, and international competitions scoring are based on official league stats provided by **Opta Stats** unless otherwise stated. World Cup scoring is based on official league stats from Opta Stats. Liga MX, Argentine Primera División, and all Women's Domestic Leagues are scored based on official league stats from SofaScore & FotMob."

The EPL is a domestic league, so **Opta Stats** is the provider for The False Nine, per this rule. Caveat: this article documents Pick'em (props) scoring, not Best Ball scoring specifically — Underdog does not appear to publish a separate provider disclosure for Best Ball, but Pick'em and Best Ball draw from the same underlying stat feeds per sport, so this is treated as applicable.

This same article also has Underdog's full stat *definitions* (assist rules, what counts as a shot on target, pass-attempted vs completed, etc.) worth keeping for QA of any scraped box-score data — e.g. "Passes are graded as passes attempted, not completed," "Shot On Target - any shot that is saved by the goalie, cleared off the line, or scores a goal," own-goal/direct-free-kick/direct-corner goals do not award an assist.

## Gaps / follow-ups for downstream modeling tickets

1. **Card points, minutes thresholds, penalty-event points are unconfirmed.** If precise point values matter for the model, the only reliable path is a logged-in browser session against `app.underdogsports.com/rules/tournaments/the-false-nine` (Cloudflare blocks headless `curl`/`WebFetch`) — someone with a real browser/account should screenshot or copy that page's scoring table directly.
2. The points table here is RotoWire-sourced, not Underdog-sourced directly. Spot-check against the primary page before finalizing point weights in the projection model.
3. Ticket #5 (`research/underdog-pool-adp`, already closed) separately documents `api.underdogfantasy.com/v2/lobby` as an unauthenticated, scriptable source for contest metadata (entry counts, cutoff times, round structure) — useful for a live status widget, but confirmed to have no player-pool/ADP or scoring-rules data.
