# Research: FPL API entry, picks, transfers and league surface

**Ticket:** #242 (parent map #241)
**Date:** 2026-11-12 (live season: GW10 finished, GW11 deadline 2026-11-21T11:00:00Z)
**Complements:** `docs/research/fpl-api-surface.md` (player-level endpoints, written pre-season). This note covers the manager/entry/league side and the live game. Not repeated here: `bootstrap-static` field catalogue, `element-summary`.

All claims verified by live unauthenticated `curl` (browser-style `User-Agent`, no cookies) against `https://fantasy.premierleague.com/api/` on 2026-11-12. Public entry used: top-of-overall entry id 895045 (a leaderboard entry; no personal details of the project owner used). Items marked **inferred** were not observable today.

## Headline findings

1. **Every entry-side endpoint tested is readable with no auth**, for any public entry id: `entry/{id}/`, `/history/`, `/transfers/`, `/event/{gw}/picks/`. Rival picks are therefore just the same call with another id. Only `my-team/{id}/` and `me/` are login-gated.
2. **Private mini-leagues are readable by id without auth** (`leagues-classic/{id}/standings/`, including `league_type: "x"` private leagues). The league id is the only secret.
3. **No CORS headers**: a response to a request with `Origin:` set carries no `access-control-allow-origin`, and `OPTIONS` returns `405` (`allow: GET, HEAD`). A browser-only Vite app on another origin cannot call these endpoints directly. This matters for the static-only constraint: entry/league data must go through the ETL (committed JSON) or a proxy, not live browser `fetch`. (Inferred from headers; not tested from a real browser.)
4. **Caching is disabled on entry/league/live endpoints** (`cache-control: max-age=0, no-cache, no-store`), unlike `bootstrap-static` (`max-age=300`). Freshness is therefore limited by the upstream write timing, not the CDN.
5. **No rate limiting observed**: 40 concurrent requests to `picks` all returned 200; no `X-RateLimit-*`/`Retry-After` headers anywhere. Still undocumented and unofficial; keep a concurrency cap.
6. **Not a gap, a state**: this season has no double or blank gameweeks scheduled yet (see below), so DGW/BGW shapes could not be observed.

## Auth matrix

| Endpoint | Status (no auth) | Notes |
|---|---|---|
| `entry/{id}/` | 200 | Summary, classic leagues, current rank |
| `entry/{id}/history/` | 200 | Per-GW history, past seasons, chips |
| `entry/{id}/transfers/` | 200 | Full season transfer log |
| `entry/{id}/event/{gw}/picks/` | 200 (past/current GW); **404 for a not-yet-started GW** (`{"detail":"Not found."}`) | Cache header gains `private` on the 404 |
| `leagues-classic/{id}/standings/` | 200 (also private `x` leagues) | 50 rows/page, `page_standings=N` |
| `leagues-h2h/{id}/standings/` | 404 for a classic id (wrong type, not auth) | Not exercised with a real H2H id |
| `entry/{id}/cup/` | 404 | Cup data appears under `entry/{id}/` `leagues.cup` |
| `event/{gw}/live/`, `event-status/`, `fixtures/`, `dream-team/{gw}/` | 200 | |
| `my-team/{id}/` | **403** `{"detail":"Authentication credentials were not provided."}` | Current squad incl. selling prices, free transfers, chips available |
| `me/` | 200 but `{"player":null,"watched":[]}` | Empty when anonymous |
| unknown entry / league id | 404 (`No Entry matches the given query.` / `Not found.`) | |

Behind login (inferred from the 403 and from FPL's own site; not verified because it needs credentials): the live editable squad (`my-team`, with `transfers.limit`/`cost`/`status`, `selling_price`, `purchase_price`), the transfer-making POST, and anything personalised to a session. Practical consequence: for the user's own team, the public equivalents are `entry/{id}/event/{gw}/picks/` (post-deadline lineup) plus `entry/{id}/` and `history/` (bank/value); **pre-deadline, in-progress squad changes are not visible without login**.

## Payload shapes

### `entry/{id}/`
Top-level keys: `id`, `joined_time`, `started_event`, `favourite_team`, `player_first_name`, `player_last_name`, `player_region_*`, `years_active`, `current_event`, `name` (team name), `entered_events` (list of GWs), `kit`, `club_badge_src`, `leagues`, and summary fields:

- `last_deadline_bank` (tenths of £m; 19 = £1.9m), `last_deadline_value` (tenths; 1033 = £103.3m, squad value excluding bank), `last_deadline_total_transfers`
- `summary_overall_points`, `summary_event_points`, `summary_event_rank`, `summary_overall_rank`
- `leagues.classic[]`: per league `id`, `name`, `short_name`, `league_type` (`s` system, `x` private), `entry_rank`, `entry_last_rank`, `rank_count`, `entry_percentile_rank`, `scoring`, `start_event`, `admin_entry`, `entry_can_admin/invite/leave`, and `active_phases[]` (monthly phase ranks). `leagues.h2h[]`, `leagues.cup` (`matches`, `status`), `leagues.cup_matches` are present (empty for this entry).
- Gap: `last_deadline_*` values are as at the **last deadline**, not live; there is no live bank/free-transfer count here.

### `entry/{id}/history/`
- `current[]`: one row per played GW: `event`, `points`, `total_points`, `rank` (GW rank), `rank_sort`, `overall_rank`, `percentile_rank`, `overall_rank_percentage`, `bank`, `value`, `event_transfers`, `event_transfers_cost` (hit points deducted), `points_on_bench`.
- `past[]`: previous seasons (empty for a first-season entry).
- `chips[]`: `{name, time, event}`; observed names `bboost`, `3xc`, `wildcard`, `freehit` (`time` is the activation timestamp). Chips *remaining* are derived: `bootstrap-static.chips[]` defines each chip's window (`start_event`/`stop_event`, `number`). This season has two sets: wildcard/freehit/bboost/3xc each for GW1/2-19 and GW20-38 (wildcard and freehit start at event 2 in the first half). Chip availability for the second half is not stated per entry, so the app must compute it by window.

### `entry/{id}/event/{gw}/picks/`
```
{ "active_chip": "bboost"|"3xc"|"wildcard"|"freehit"|null,
  "automatic_subs": [ {entry, element_in, element_out, event}, ... ],
  "entry_history": { same shape as a history.current row },
  "picks": [ {element, position, multiplier, is_captain, is_vice_captain, element_type}, ... x15 ] }
```
- `position` 1-11 starters, 12-15 bench (12 = GK, 13-15 bench order). `multiplier`: 0 bench, 1 normal, 2 captain, 3 triple captain (`3xc`). Observed 15 picks per response.
- **Auto-subs verified**: GW6 and GW8 of entry 895045 each returned one `automatic_subs` record `{element_in: 304, element_out: <starter>}`. The `picks` array itself retains the pre-sub `position`/`multiplier` (the substituted-in bench player still shows `multiplier 0` in `picks`); the effective lineup must be reconstructed by applying `automatic_subs`. Vice-captain promotion on a captain DNP is **not** flagged in the payload (**inferred**: the consumer must apply the rule from `is_vice_captain` and minutes).
- Bench boost (GW1) response has `active_chip: "bboost"`; this entry's `points_on_bench` in `entry_history` lets bench points be read directly.
- Available as soon as the GW deadline passes (**inferred** from the 404 on GW11, whose deadline has not passed). Historical GWs stay available for the whole season.

### `entry/{id}/transfers/`
Array (41 rows for this entry), each `{element_in, element_in_cost, element_out, element_out_cost, entry, event, time}`; costs in tenths of £m, `time` an ISO timestamp (so the order within a GW is recoverable). Chip-GW transfers appear too (wildcard / free hit GWs produce many rows). No field marks a hit or free transfer; hit cost is `history.current[].event_transfers_cost`. Free transfers banked are **not exposed publicly**: derive from per-GW `event_transfers` against the rule (1 per GW, bank up to `game_settings.max_extra_free_transfers` = 4 extra, a chip resets/pauses accrual) (**inferred**).
`game_settings` also provides: `squad_total_spend` 1000, `squad_team_limit` 3, `transfers_sell_on_fee` 0.5, `element_sell_at_purchase_price` false (selling price = purchase price plus half of the profit; the exact per-player selling price is only in the login-gated `my-team`).

### `leagues-classic/{id}/standings/`
`{league:{id,name,created,closed,league_type,scoring,start_event,admin_entry,max_entries,...}, standings:{has_next, page, results:[...]}, new_entries, last_updated_data}`. Each result: `entry`, `entry_name`, `player_name`, `rank`, `last_rank`, `rank_sort`, `total`, `event_total`, `club_badge_src`. Page size is 50. Paginate with `?page_standings=N` until `has_next` is false. The overall league (id 314) is huge; ids are sequential by creation, and arbitrary ids (315, 1000, 50000) resolved as public/private leagues. Quirk: an out-of-range `page_standings` (9999) returned a 200 echoing `page: 9999` with results, so always rely on `has_next`, not on the page echo (observed behaviour, cause not investigated).
Rival picks workflow: standings gives the member `entry` ids, then `entry/{rival}/event/{gw}/picks/` for each (1 call per rival per GW; ~1.9KB each, ~0.13-0.25s).

## Live game and update timing

- `event/{gw}/live/`: `{"elements":[{id, stats:{minutes, goals_scored, ..., bonus, bps, total_points, in_dreamteam, played, expected_*...}, explain:[{fixture, stats:[{identifier, points, value, points_modification}]}], modified}]}`. 672 elements, 477KB for GW10; `explain` gives per-stat point attributions, ideal for reconciling a user's lineup score. Total GW points per entry = sum over starters of `total_points x multiplier` after auto-subs, minus `event_transfers_cost`. Live `total_points` includes provisional bonus only after `bonus_added`.
- `event-status/`: `{"status":[{"bonus_added":true,"date":"2026-11-06","event":10,"points":"r"}, ...], "leagues":"Updated"}`. Per-date flags: `bonus_added` (bonus applied for that day's matches), `points` (`"r"` = ready/final in this sample; other values not observed since the sample was only post-GW), and `leagues` (`"Updated"` after league tables are recomputed, observed; the in-progress value, **inferred** to be `"Updating"`, was not seen). This is the cheap poll target for "is the GW settled" before reading standings.
- `fixtures/?event={gw}`: includes per-fixture `started`, `finished`, `finished_provisional`, `minutes`, `team_h_score`/`team_a_score`, `kickoff_time`, `provisional_start_time`, difficulty, and a `stats` array (`identifier` such as `goals_scored`/`assists`, with `h`/`a` lists of `{value, element}`). `fixtures/?future=1` returns only unplayed fixtures (87KB). `pulse_id` is 0 in samples.
- Not observed (no live match during research): in-play refresh cadence of `live/` and entry `summary_*`. FPL's site updates live scores on the order of a minute and rank/leagues after the GW completes (**inferred, unverified**). Plan ETL polling gated on `event-status` and fixture `finished_provisional`.
- `entry` summary rank fields (`summary_overall_rank`, `summary_event_rank`) lag: GW10 `history.current.rank_sort`/`rank` differ slightly from the `summary_event_rank` seen on `entry/` at the same moment (222067 vs 222011), so ranks keep moving after the GW closes.

## Prices and transfers signals

Per-player in `bootstrap-static.elements[]` (already catalogued in the prior note, with these extra fields confirmed today): `now_cost`, `cost_change_event` (+/- tenths this GW), `cost_change_event_fall`, `cost_change_start`, `cost_change_start_fall`, `selected_by_percent`, `transfers_in`/`transfers_out` (season), `transfers_in_event`/`transfers_out_event` (current GW), `now_cost_rank`. 59 players had a non-zero `cost_change_event` at research time (e.g. +1 for several), so **price changes are visible only after they occur**. There is no public predicted-rise/fall field; a prediction would need to be modelled from net `transfers_*_event` and `selected_by_percent` (an approach, not a verified threshold). `bootstrap-static.events[]` carries per-GW aggregates: `average_entry_score`, `highest_score`, `transfers_made`, `most_selected`, `most_transferred_in`, `most_captained`, `most_vice_captained`, `top_element`, `top_element_info`, and `chip_plays[]` (e.g. GW1: 814,606 bench boosts, 250,816 triple captains), plus `deadline_time`, `is_current/is_next`, `data_checked`. `dream-team/{gw}/` gives `{top_player:{id,points}, team:[{element,points,position}]}`.

## Double and blank gameweeks

`fixtures/` contains an `event` per fixture; a team playing twice in a GW shows as two fixtures with the same `event`, and a blank GW as a team absent from that event's fixtures. Computed over all 380 fixtures today: **no GW has a team playing twice, and no GW has a team missing**, with zero fixtures lacking an `event`. So current schedule has no DGW/BGW; they will appear when postponed fixtures are rescheduled (a postponed fixture keeps `event` and a null `kickoff_time`, **inferred**, not observed). The ETL should compute `fixtures-per-team-per-event` from `fixtures/` on each refresh rather than assume. Chips with `chip_type: team` (bboost, 3xc) are the usual DGW tools.

## Rate limits and operational notes

- No limit hit at 40 parallel same-endpoint requests; sustained-volume behaviour untested. FPL historically throttles on abuse (**inferred**, no evidence collected today). Use a concurrency cap (e.g. 4-8) plus retries with backoff.
- Typical latency 0.12-0.25s; sizes: picks ~1.9KB, entry ~6.8KB, history ~2.6KB, transfers ~5.8KB (41 rows), standings page ~11KB, `live` ~480KB, `fixtures/` ~346KB (now with results), `bootstrap-static` ~1.8MB (grown from 1.4MB pre-season).
- The `User-Agent` is not required (a no-UA request to `entry/{id}/` returned 200), but sending a descriptive one is polite.
- Because there is no CORS and the cache is disabled on these endpoints, pull them in the ETL, store the result in `data/snapshot.json` (or a sibling committed file), and have the browser read that. Per-league cost: one standings page per 50 members plus one `picks` call per member per GW.

## Gaps and open items

1. Own-team pre-deadline state (planned transfers, selling prices, free transfers, available chips): login only. Workaround: user supplies their entry id; read only post-deadline picks, derive bank/value from `history`.
2. Free transfers banked: not a public field; derive.
3. Vice-captain and auto-sub effective points: reconstruct client-side from `automatic_subs`, `is_vice_captain`, and live minutes.
4. In-play update cadence and `event-status.points`/`leagues` in-progress values: not captured (no match in progress during research); re-test on a matchday.
5. DGW/BGW payload behaviour: none scheduled yet; re-check when fixtures are rescheduled.
6. H2H league standings shape and cup matches: no real id tested.
7. Browser CORS blocking is inferred from response headers, not from a real browser fetch; verify once if a direct-browser approach is ever considered.
