# Research: FPL API data surface for projections

**Ticket:** #4
**Date:** 2026-08-17
**Question:** What does the free official FPL API (`fantasy.premierleague.com/api`) offer for building season-long player projections?

All claims below were verified by live `curl` against the endpoints on 2026-08-17 (season not yet started; GW1 deadline is 2026-08-21T17:30:00Z). Raw responses inspected locally, not sourced from blog posts.

## Auth & rate limits

- **No authentication required** for any endpoint tested (`bootstrap-static`, `fixtures`, `element-summary/{id}`, `event/{id}/live`). Plain `curl` with no headers/cookies returns `HTTP 200`.
- No `X-RateLimit-*` or `Retry-After` response headers observed. `curl -sI https://fantasy.premierleague.com/api/bootstrap-static/` shows only standard cache/security headers (`cache-control: max-age=300, stale-while-revalidate=3600, stale-if-error=3600`, served via Varnish/openresty behind what looks like a Google-fronted CDN).
- Three back-to-back requests to `bootstrap-static` all returned `200` in ~0.14–0.17s — no throttling observed at this volume. Treat this as unofficial/undocumented (no public FPL API spec exists); be a good citizen — cache locally, poll on a schedule (e.g. hourly via the ETL step), don't hammer it.
- `cache-control: max-age=300` implies the CDN itself refreshes every 5 minutes, so polling more often than that is pointless.

## Endpoint inventory

| Endpoint | Purpose | Size (live sample) |
|---|---|---|
| `GET /api/bootstrap-static/` | The core dump: all players (`elements`), all teams, gameweeks (`events`), position defs (`element_types`), scoring-stat catalogue (`element_stats`), chips, phases, game settings | **1,388,879 bytes** (~1.4MB), 590 players |
| `GET /api/fixtures/` | All 380 fixtures for the season, with per-fixture FDR (`team_h_difficulty`/`team_a_difficulty`), kickoff times, scores once played | 118,021 bytes |
| `GET /api/fixtures/?event={gw}` | Fixtures filtered to one gameweek | 3,083 bytes for GW1 (10 fixtures) |
| `GET /api/element-summary/{player_id}/` | Per-player detail: `fixtures` (upcoming, with per-fixture difficulty), `history` (this-season per-gameweek match log — empty pre-season), `history_past` (season-by-season totals for prior seasons) | 12,162 bytes for a single player (Haaland, id 411) |
| `GET /api/event/{gw}/live/` | Live/finalized per-player stats for one gameweek (all `element_stats` fields per player, e.g. actual minutes/goals/bps for that GW) | 15 bytes pre-season (`{"elements": []}` — populates once matches are played) |

Not tested live (would need a logged-in session — out of scope for public data): `/api/entry/{id}/...` (manager/team endpoints), `/api/leagues-classic/...`. These aren't needed for player-projection purposes since they cover manager/league data, not player stats.

## Position mapping (`element_types` → False Nine G/D/MD/FW)

Confirmed via `bootstrap-static.element_types`:

| FPL `id` | FPL name | element_count (2026/27 preseason) | False Nine position |
|---|---|---|---|
| 1 | Goalkeeper (GKP) | 66 | **G** |
| 2 | Defender (DEF) | 194 | **D** |
| 3 | Midfielder (MID) | 260 | **MD** |
| 4 | Forward (FWD) | 70 | **FW** |

Direct 1:1 mapping — `element_type` on each player object in `elements` maps straight onto False Nine's four position badges. No remapping/splitting needed (e.g. FPL doesn't split wingers from forwards).

## Per-player fields relevant to projection (`bootstrap-static.elements[i]`)

Confirmed keys present on every element (590 players, sample: Haaland id=411):

**Identity/meta:** `id`, `first_name`, `second_name`, `web_name`, `known_name`, `team` (FPL team id, join to `teams`), `team_code`, `element_type` (position), `code`, `squad_number`, `birth_date`

**Availability/status:** `status` (`a`=available, `i`=injured, `d`=doubtful, `s`=suspended, `u`=unavailable/left club, `n`=not in squad), `chance_of_playing_this_round`, `chance_of_playing_next_round`, `news`, `news_added`

**Price:** `now_cost` (tenths of £m), `cost_change_event`, `cost_change_start`, `selected_by_percent`, `transfers_in`/`transfers_out`

**Volume/playing time:** `minutes`, `starts`, `starts_per_90`

**Attacking output (actual):** `goals_scored`, `assists`, `penalties_missed`, `penalties_order`

**Attacking output (expected/underlying — the xG-like proxies):**
- `expected_goals`, `expected_assists`, `expected_goal_involvements` (xG+xA), `expected_goals_conceded`
- `expected_goals_per_90`, `expected_assists_per_90`, `expected_goal_involvements_per_90`, `expected_goals_conceded_per_90`
- These are real Opta-derived xG/xA, not a proxy — directly usable for projection models.

**FPL's own composite indices (usable as secondary signal, not primary):** `ict_index` (Influence+Creativity+Threat), `influence`, `creativity`, `threat`, and their `*_rank`/`*_rank_type` fields; `bps` (bonus points system score), `bonus`

**Defensive (for D/G projection):** `clean_sheets`, `clean_sheets_per_90`, `goals_conceded`, `goals_conceded_per_90`, `saves`, `saves_per_90`, `penalties_saved`, `clearances_blocks_interceptions`, `recoveries`, `tackles`, `defensive_contribution`, `defensive_contribution_per_90` (new-ish stat category tracking CBIT-style defensive actions, relevant since FPL added defensive-contribution scoring in 2025/26)

**FPL scoring outputs (explicitly NOT the target scoring, but useful as a cross-check / feature):** `total_points`, `event_points`, `points_per_game`, `points_per_game_rank`, `form`, `form_rank`, `ep_next`, `ep_this` (FPL's own next-GW point projection — could sanity-check a custom model against it, not use it directly since scoring rules differ)

**Discipline:** `yellow_cards`, `red_cards`, `own_goals`

## Season-history endpoints (prior-season data)

- `element-summary/{id}.history_past` returns **one row per prior season** the player was FPL-tracked, going back multiple years (Haaland: 2022/23, 2023/24, 2024/25 present). Fields per season: `total_points`, `minutes`, `goals_scored`, `assists`, `clean_sheets`, `goals_conceded`, `bonus`, `bps`, `influence`/`creativity`/`threat`/`ict_index`, `starts`, and the **expected_* xG/xA fields** (`expected_goals`, `expected_assists`, `expected_goal_involvements`, `expected_goals_conceded`) — all as season totals. This is the primary source for multi-season priors in a projection model.
- `element-summary/{id}.history` is the **current-season per-gameweek match log** (one row per GW played) — empty right now since 2026/27 GW1 hasn't kicked off, but once live, each row carries the same per-GW stat set as `event/{gw}/live` (see below), giving a true per-fixture time series.

## Per-fixture history for variance/ceiling estimation

Yes — this is available and is exactly what `history` (in `element-summary`) and `event/{gw}/live` provide once matches are played:

- `element-summary/{id}.history`: per-GW rows for the *current* season, each containing `goals_scored`, `assists`, `minutes`, `bps`, `ict_index`, xG/xA per that fixture, opponent (`opponent_team`), `was_home`, `kickoff_time`, `total_points` — this is the raw material for computing a player's goals+assists **distribution** (variance, ceiling/floor) rather than just a season average.
- `event/{gw}/live`: same per-GW stat granularity but for *all* players in one gameweek at once (better for bulk ETL — one call per GW instead of one call per player per GW).
- Verified schema is confirmed even though 2026/27 has zero played gameweeks right now (`event/1/live` returns `{"elements": []}` pre-kickoff, and `history` is `[]` for the same reason) — structurally these are the fields that populate once the season starts (2026-08-21).
- Practical ETL implication: for **this season's** in-progress ceiling/variance stats, poll `event/{gw}/live` once per finished GW (1 call covers all players — cheap). For **prior-season** per-fixture granularity (to seed pre-season projections before any 2026/27 data exists), you'd need `element-summary/{id}.history` captured *during* each of those past seasons — FPL does not appear to expose a "full match log for a past season" in one shot via `history_past` (that endpoint is season-aggregate only). If per-fixture 2024/25-era granularity is needed for cold-start projections, a different source (e.g. Vaastav's FPL historical archive, or understat) would be needed — flagging as a gap, not fabricating an endpoint.

## Response sizes summary (for ETL planning)

- `bootstrap-static`: ~1.4MB single call — this is the one-shot source for all 590 players + teams + gameweeks. Fine to fetch whole and cache.
- `fixtures` (full season): ~118KB.
- `fixtures?event=N`: ~3KB per gameweek.
- `element-summary/{id}`: ~12KB per player → at 590 players, a full per-player detail pull would be ~590 sequential/parallel calls (~7MB total) purely for `history`/`history_past`/per-fixture `fixtures`. Given no visible rate limit but no documented allowance either, batch with a small concurrency cap and cache aggressively (align with the 5-min CDN `max-age`).
- `event/{gw}/live`: near-zero pre-season; once populated, one call covers all ~590 players' stats for that GW — cheaper than `element-summary` for in-season updates.

## Bottom line for the ETL slice

- `bootstrap-static` alone (single ~1.4MB call) covers price, status, position, current-season aggregate stats, and real xG/xA-based expected stats for all players — sufficient for a first-pass projection model.
- `element-summary/{id}.history_past` adds 2–3 prior full seasons of aggregate (not per-fixture) stats per player for stabilizing small-sample current-season data.
- Per-fixture variance data is only available once the current season is underway (via `history`/`event/live`); pre-season ceiling/floor modeling needs an external source for past-season match-level granularity if that's a hard requirement before 2026-08-21.
- Position mapping FPL→False Nine is a clean 1:1 (`element_type` 1/2/3/4 → G/D/MD/FW).
- No auth, no confirmed rate limit, but this is an undocumented public API — cache per the 5-min CDN TTL and avoid unnecessary polling.
