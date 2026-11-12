# Research: FPL 2026-27 scoring rules and chip rules

**Ticket:** #248 · **Date:** 2026-11-12 · **Branch:** `research/fpl-scoring-chip-rules` · **Parent map:** #241

## Question

What are the exact FPL 2026-27 scoring rules and chip rules, as a value table an FPL scorer config can be built from, with unverified items flagged?

## Sources (all first-party)

| Tag | Source | Notes |
|---|---|---|
| **[API]** | `https://fantasy.premierleague.com/api/bootstrap-static/` fetched live 2026-11-12 (GW10 current, GW11 next). Fields `game_settings`, `game_config.rules`, `game_config.scoring`, `chips`, `element_types`, `events[].overrides`. | Machine-readable ground truth for core points. No auth. |
| **[RULES]** | Official rules page `https://fantasy.premierleague.com/en/help/rules`. It is a JS-rendered SPA, so the text was read from its shipped bundle `https://fantasy.premierleague.com/assets/Rules-B4Kv8ZoR.js` (prose, chip text, and a hardcoded BPS/points table). | Authoritative for prose rules, thresholds, chips, BPS values. |
| **[PL-CHG]** | premierleague.com, "All you need to know about changes to FPL for 2026/27" (31 Jul 2026), `https://www.premierleague.com/en/news/4679873/all-you-need-to-know-about-changes-to-fpl-for-202627` | Official 2026-27 change list. |
| **[PL-BPS]** | premierleague.com, "What's new in 2026/27 Fantasy: Changes to Bonus Points System", `https://www.premierleague.com/en/news/4679946/whats-new-in-202627-fantasy-changes-to-bonus-points-system` | Official BPS delta. |
| **[PL-DC]** | premierleague.com, "What's happening with defensive contribution points in 2026/27 Fantasy?", `https://www.premierleague.com/en/news/4361991/whats-happening-with-defensive-contribution-points-in-202627-fantasy` | Official DC explainer. |
| **[PL-PTS]** | premierleague.com, "FPL basics explained: Scoring points" (20 Jul 2026), `https://www.premierleague.com/en/news/2174909/fpl-basics-explained-scoring-points` | Points table cross-check. |

Fetching note: the `premierleague.com/en/fantasy-premier-league/rules` URL 404s; the live rules page is on `fantasy.premierleague.com`. The `fantasy.premierleague.com/api/game-settings/` path does not exist; `game_settings` is a key inside bootstrap-static. Third-party guides (flashscore, beatfpl, etc.) surfaced in search but were not used as evidence.

## Verified scoring table (scorer config values)

Positions: GKP=1, DEF=2, MID=3, FWD=4 (`element_types`). Every value below matches between [API] `game_config.scoring` and [RULES] unless noted.

| Event | GKP | DEF | MID | FWD | Source / note |
|---|---|---|---|---|---|
| Appearance, 1 to 59 min | 1 | 1 | 1 | 1 | [API] `short_play`=1; [RULES] "up to 60 minutes" |
| Appearance, 60+ min (excl. stoppage) | 2 | 2 | 2 | 2 | [API] `long_play`=2; `long_play_limit`=60 [RULES] |
| Goal | 10 | 6 | 5 | 4 | [API] `goals_scored` |
| Assist | 3 | 3 | 3 | 3 | [API] `assists` |
| Clean sheet (60+ min, none conceded while on pitch) | 4 | 4 | 1 | 0 | [API] `clean_sheets`; min 60 min [RULES] |
| Goals conceded | -1 per 2 | -1 per 2 | 0 | 0 | [API] `goals_conceded` = -1 (GKP/DEF); the "per 2" granularity (`concede_limit`=2) is only in [RULES]/[PL-PTS] |
| Saves | +1 per 3 saves | - | - | - | [API] `saves`=1; `saves_limit`=3 [RULES] |
| Penalty save | 5 | 5 | 5 | 5 | [API] `penalties_saved` (any player) |
| Penalty miss | -2 | -2 | -2 | -2 | [API] `penalties_missed` |
| Yellow card | -1 | -1 | -1 | -1 | [API] |
| Red card | -3 | -3 | -3 | -3 | [API]. Red-card deduction includes the yellow points; red-carded players keep being charged for goals conceded [RULES] |
| Own goal | -2 | -2 | -2 | -2 | [API] |
| Bonus (top 3 BPS in a match) | 3/2/1 | 3/2/1 | 3/2/1 | 3/2/1 | [API] `bonus`=1 per point; ties in [RULES] |
| Defensive contribution (DC) | 0 | 2 | 2 | 2 | [API] `defensive_contribution`: GKP 0, others 2 |

Not scored (all 0 in [API]): tackles, CBI, recoveries, xG, `starts`, `bps`, ICT, and all manager (`mng_*`) fields.

### Defensive contribution thresholds

- DEF: 10 or more clearances + blocked shots + interceptions + tackles (CBIT) in a match -> 2 pts. [RULES], [PL-DC]
- MID and FWD: 12 or more CBIT + recoveries (CBIRT) -> 2 pts. [RULES], [PL-DC]
- Cap: 2 pts per match, does not stack (20 CBIT is still 2). [RULES], [PL-DC]
- GKP: 0 pts. [API] `defensive_contribution.GKP`=0. [PL-DC] is silent on GKP, so this rests on the API value only; effectively verified.
- The thresholds (10 / 12) are NOT in the API. They come from [RULES]/[PL-DC]. Per-player counts are available as the `defensive_contribution` stat in `element_stats` and live data (not re-verified here against `event/{n}/live`).

### Clean-sheet and minutes details [RULES]

- Clean sheet requires 60+ minutes excluding stoppage time, and no goal conceded while the player is on the pitch. A substitution after reaching 60 minutes keeps the clean sheet.
- Per [PL-PTS] snippet the 60th minute is 59:00-59:59, so a player subbed in that window may count 59 completed minutes. (Secondary detail from search snippet; confirm before encoding sub-minute edge cases.)
- Goals-conceded penalty applies only to GKP and DEF, per 2 goals conceded while on the pitch (red-carded players are still charged for team goals conceded).
- Points are subject to change until the gameweek is finalised (see Timing).

## Bonus points system (BPS)

Top 3 BPS in each match get 3/2/1 bonus. Ties [RULES]: tie for 1st -> 3,3,1; tie for 2nd -> 3,2,2; tie for 3rd -> 3,2,1,1.

BPS action values from the [RULES] page's hardcoded table (the page renders the 2026-27 table; items changed this season per [PL-BPS] are flagged):

| Action | BPS |
|---|---|
| Playing 1-60 min / over 60 min | 3 / 6 |
| Penalty goal | 12 |
| Goal GKP/DEF / MID / FWD | 12 / 18 / 24 |
| Assist | 9 |
| Clean sheet GKP/DEF (MID/FWD 0) | 12 |
| Save | 2 (changed 2026-27: any save, [PL-BPS]) |
| Save from shot inside box | +1 |
| Save from big chance | +1 (new 2026-27) |
| Penalty save | 7 (was 8; [PL-BPS]) |
| CBI | 1 per 3 (was 1 per 2; [PL-BPS]) |
| Recoveries | 1 per 3 |
| Successful tackle | 2 |
| Chance created / big chance created | 1 / 3 |
| Successful open-play cross | 1 |
| Successful dribble | 1 |
| Winning goal | 3 |
| Goal-line clearance | 9 |
| Foul won | 1 |
| Shot on target | 2 |
| Pass completion 70-79 / 80-89 / 90+ (min 30 attempted) | 2 / 4 / 6 |
| GKP/DEF conceding a goal | -4 |
| Penalty conceded / missed | -3 / -6 |
| Yellow / red card | -3 / -9 |
| Own goal | -6 |
| Big chance missed | -3 |
| Error leading to goal / to attempt | -3 / -1 |
| Foul conceded / offside / shot off target | -1 each |

Removed in 2026-27 [PL-BPS]: the -1 BPS for being tackled, and the goalkeeper bonus for saves from outside the box. The bundle still carries a `save_from_outside_box` constant but it is not rendered in the table; ignore it.

Flags: the rules-page BPS block is a hardcoded literal in the front-end bundle, not an API field, so it could lag the live Opta-driven calculation. For best-ball use BPS only to project bonus; the realised `bonus` stat from the API is authoritative.

## Captain, vice-captain, auto-subs [RULES]

| Rule | Value |
|---|---|
| Squad / starters | 15 / 11 (`squad_squadsize`, `squad_squadplay`); 2 GKP, 5 DEF, 5 MID, 3 FWD ([API] `element_types.squad_select`) |
| Formation limits | 1 GKP; DEF 3-5; MID 2-5; FWD 1-3 ([API] `squad_min_play`/`squad_max_play`) |
| Max players per club | 3 (`squad_team_limit`) |
| Budget | 100.0m (`squad_total_spend`=1000, `ui_currency_multiplier`=10) |
| Captain multiplier | x2 (captain's whole score doubled) |
| Triple Captain | x3 |
| Vice-captain | `sys_vice_captain_enabled`=true; becomes the captain (x2, or x3 with TC) only if the captain plays 0 minutes in the gameweek |
| Both play 0 minutes | no player is doubled |
| "Played" definition | made an appearance on the pitch OR received a yellow/red card |
| Auto-subs | Processed at the end of the gameweek, in bench priority order. GKP replaced only by the bench GKP (if he played). Outfield non-players replaced by the highest-priority bench outfielder who played and does not break formation limits (min 3 DEF, 1 FWD, 1 GKP per [RULES]; API shows MID min 2) |
| Bench GKP lock | `sub_positions_locked`=[12] for GKP (slot 12 is the bench GKP) |
| Transfers | 1 free per GW, bank up to 5 (`max_extra_free_transfers`=4 beyond the 1), each extra transfer -4; cap 20 per GW (not applying to Wildcard/Free Hit); 50% sell-on, rounded down to 0.1m |

## Chip rules [RULES], [API] `chips`

Eight chips in total, two sets of four, no Assistant Manager chip. One chip per gameweek.

| Chip | Effect | First set (API `start_event`-`stop_event`) | Second set |
|---|---|---|---|
| Wildcard | All transfers in the GW are free of charge (squad change persists) | GW2-GW19 (not available GW1) | GW20-GW38 |
| Free Hit | Unlimited free transfers for one GW; squad reverts at next deadline | GW2-GW19 | GW20-GW38 |
| Bench Boost | Bench points count toward the total | GW1-GW19 | GW20-GW38 |
| Triple Captain | Captain x3 instead of x2 | GW1-GW19 | GW20-GW38 |

- Unused first-set chips do not carry over after the GW19 deadline. [PL-CHG]
- Bench Boost and Triple Captain can be cancelled before the GW deadline. Wildcard and Free Hit are played when confirming transfers and cannot be cancelled. [RULES]
- Free Hit cannot be played in consecutive gameweeks (first set played in GW19 means the second is available from GW21, per the rules text; API second-set window starts GW20, so the consecutive-play restriction is enforced separately from `start_event`). [RULES]
- Saved free transfers are retained for the following GW after playing a Wildcard or Free Hit (if you hold 2 saved, you still hold 2 after). [RULES]
- Chip config has no per-chip `overrides` and no event has `overrides` set as of 2026-11-12 (rules/scoring/pick_multiplier all empty), so there are no special-gameweek scoring modifiers at present.
- GW19 deadline: [API] `events[18].deadline_time` = **2027-01-01T18:30:00Z**. [PL-CHG] (31 Jul) said 13:30 GMT Sat 2 Jan. The API is more recent and is the working value; fixtures were evidently rescheduled. Re-read the API before encoding. GW20 deadline is 2027-01-05T18:00Z.
- Observed usage: GW1 had Bench Boost (814,606 plays) and Triple Captain (250,816 plays) in `events[0].chip_plays`, consistent with the GW1 start for those two. Wildcard and Free Hit absent in GW1, consistent with GW2 start.

## 2026-27 changes vs last season [PL-CHG], [PL-BPS]

1. BPS tweaks (see above): remove "being tackled" penalty and out-of-box save bonus; CBI 1 per 3; saves 2 BPS each; pen save 7; new big-chance-save +1. Intent: less overlap with DC, better bonus odds for GKP, full-backs, attackers.
2. Defensive contribution stays (introduced 2025-26). No change to 2 pts / thresholds 10 and 12 / cap 2 found.
3. Chips: no changes (two sets of four). The 2025-26 AFCON bonus free transfers are not repeated. Free transfers: still roll up to 5.
4. Live bonus: projected bonus added to scores after 20 minutes of each match and updated through the match.
5. Lockdown: scores finalise at 09:00 UK time the day after the GW's final match (previously one hour after the final whistle).
6. 11 players reclassified by position (names not published in [PL-CHG]); position changes affect the scoring row a player falls under, so read `element_type` from the API, not from last season.
7. No auto-sub or captaincy rule change announced (absence from [PL-CHG]; the live rules text is consistent with prior seasons).

## Unverified / open items

- **Auto-sub formation floors:** [RULES] prose says min 3 DEF and 1 FWD but does not state a MID floor; the API says MID min 2. Use API `squad_min_play`.
- **60th-minute edge case (59:00-59:59):** from a [PL-PTS] search snippet only; not re-read in full.
- **Whether DC is exactly 0 for GKP:** from API only; no prose confirms it.
- **DC counting definitions** (what counts as a recovery, the "next action with the ball" clause) are from [PL-DC] prose, not API; per-match counts should be validated against `event/{n}/live` `defensive_contribution` before modelling probabilities.
- **BPS table currency:** hardcoded in the front-end bundle; could lag live Opta weights.
- **Lockdown time:** 09:00 UK is from [PL-CHG] prose; the rules page text (in the bundle) says "up to 9am UK time on the day after the final match" (via [PL-PTS] snippet), consistent but not independently timed against the API `data_checked` flag.
- **GW19 deadline:** 2027-01-01T18:30Z (API) vs 2 Jan 13:30 GMT ([PL-CHG]); API preferred, re-check before GW19.
- **Which 11 players were reclassified:** not published in [PL-CHG].
- **`event/{n}/live` and `element-summary`** were not re-fetched here; see `docs/research/fpl-api-surface.md` for those endpoints.

## Suggested scorer config shape

```
play: short=1 (<60), long=2 (>=60)
goal: {GKP:10, DEF:6, MID:5, FWD:4}
assist: 3
cleanSheet: {GKP:4, DEF:4, MID:1, FWD:0}, minMinutes=60
goalsConceded: {GKP:-1, DEF:-1}, per=2
saves: 1 per 3
penSave: 5, penMiss: -2
yellow: -1, red: -3, ownGoal: -2
bonus: 3/2/1 from BPS
defCon: {DEF: 2 @ 10 CBIT, MID: 2 @ 12 CBIRT, FWD: 2 @ 12 CBIRT, GKP: 0}, cap 2
captain: x2 (TC x3), vice if captain 0 min
```
