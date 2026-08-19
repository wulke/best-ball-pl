/**
 * Canonical snapshot contract — the single source of truth shared by the ETL
 * (`src/etl/`) and the browser UI (`src/ui/`). `data/snapshot.json` is the
 * compiled artifact of these types.
 *
 * Settled with the modeling baseline in mind (docs/research/historical-baseline-modeling.md):
 * season stat lines are labeled and multi-season so the projection slice (#8)
 * can build per-90 rates and priors without reshaping this contract. The
 * FBref volume terms (SoT, KP, crosses, TklW, passes) will be *added* fields,
 * not a reshape.
 */

/** False Nine roster positions, mapped from FPL element_type 1=GKP/2=DEF/3=MID/4=FWD. */
export type Position = 'G' | 'D' | 'MD' | 'FW';

/** FPL availability status codes. */
export type PlayerStatus = 'a' | 'i' | 'd' | 's' | 'u' | 'n';

/**
 * One labeled FPL season for a player, from `element-summary/{id}.history_past`.
 * Most recent season first. Field set = the FPL-expressible subset of False Nine
 * scoring plus FPL's own points/xG/xA for cross-checks.
 */
export type SeasonStatLine = {
  /** FPL season label, e.g. "2025/26". */
  season: string;
  minutes: number;
  starts: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  saves: number;
  penaltiesSaved: number;
  /** FPL ships xG/xA as strings; null when absent for a season. */
  xg: number | null;
  xa: number | null;
  /** FPL fantasy points for the season — cross-check vs Underdog scoring, not a target. */
  fplPoints: number;

  /**
   * FBref league-page volume terms (optional — merged in by `npm run fbref`
   * from manually saved pages in data/fbref-raw/, parsed output committed as
   * data/fbref.json). Season totals. Absent when the player didn't match or
   * the season wasn't pulled — the model falls back to league-average
   * conversions + position baselines for those rows.
   */
  /** FBref Sh (all shots, incl. blocked). */
  shots?: number;
  /** FBref SoT. */
  shotsOnTarget?: number;
  /** FBref KP (key passes — the "chance created" term). */
  keyPasses?: number;
  /** FBref Crs (crosses, pass-types page). */
  crosses?: number;
  /** FBref TklW (tackles won). */
  tacklesWon?: number;
  /** FBref total pass Cmp. */
  passesCompleted?: number;
  /** FBref keeper W (parsed for cross-checks; scoring still uses the team win-rate prior). */
  gkWins?: number;
  /** FBref playing-time page: games the player was an UNUSED substitute — a
   *  thin-role signal FPL history can't express (bench-warmers vs nailed
   *  starters with similar minutes). Feeds the durability-risk flag. */
  unusedSubs?: number;
  /** Minutes as FBref reports them — cross-check vs FPL `minutes` for match QA. */
  fbrefMinutes?: number;
};

export type SnapshotPlayer = {
  /** FPL element id, stringified. */
  id: string;
  /** Display name (FPL `web_name`). */
  name: string;
  fullName: string;
  position: Position;
  /** FPL team short name, e.g. "MCI". */
  team: string;
  /** 2026/27 draft price in £m (FPL `now_cost` / 10). */
  price: number;
  status: PlayerStatus;
  /** FPL injury/availability news blurb; empty string when none. */
  news: string;
  /** Labeled prior seasons, most recent first. Empty for players with no FPL history. */
  seasons: SeasonStatLine[];
  /** Season-long False Nine projection (p10/p50/p90 + audit stat line), built
   *  by the model at snapshot time. Present on every player after ETL. */
  projection?: PlayerProjection;
};

export type SnapshotFixture = {
  id: number;
  /** Match week (FPL event). Round 1 of False Nine scores MW 1–26. */
  event: number;
  home: string;
  away: string;
  homeDifficulty: number;
  awayDifficulty: number;
  kickoff: string;
  /** Final score — present only once the fixture has finished (#40). */
  homeScore?: number;
  awayScore?: number;
};

export type SnapshotMeta = {
  /** Players carrying at least one labeled season row. */
  playersWithHistory: number;
  positionCounts: Record<Position, number>;
};

/**
 * One player's finalized per-GW stat line, from `event/{gw}/live` (#40).
 * The FPL-expressible subset of what blending (#43) and draft review (#45)
 * consume — counting stats for priors/scoring, xG/xA for underlying rates,
 * FPL points as a cross-check (not a target; scoring rules differ). Per-GW
 * volume terms (shots/crosses/tackles/passes) are NOT in FPL's live feed —
 * they stay season-aggregate from the FBref/PL caches until a free per-GW
 * source appears.
 */
export type GwPlayerActual = {
  /** FPL element id, stringified — joins SnapshotPlayer.id. */
  id: string;
  minutes: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  saves: number;
  penaltiesSaved: number;
  /** FPL ships xG/xA as decimal strings; null until data-checked. */
  xg: number | null;
  xa: number | null;
  /** FPL fantasy points for the GW — cross-check, not target scoring. */
  fplPoints: number;
};

/** Finalized actuals for one gameweek — every player who featured (a row
 *  exists only if minutes > 0 or any counting stat is non-zero; absence =
 *  did not feature that GW). */
export type GwActuals = {
  /** FPL event (gameweek) number. */
  event: number;
  players: GwPlayerActual[];
};

/** Per-GW actuals section — retention is all-season (one row set per finished
 *  GW, oldest first; empty until the first GW completes). ~300–400KB raw per
 *  GW pretty-printed, ~10× smaller gzipped on the wire. */
export type SnapshotActuals = {
  gameweeks: GwActuals[];
};

/** Data-as-of stamp (#40) — the freshness contract the UI's stamp (#44) and
 *  the scheduled refresh's guardrails (#41) trust. */
export type SnapshotAsOf = {
  /** Wall-clock when this ETL run began observing upstream FPL state. */
  fetchedAt: string;
  /** Highest GW whose actuals are complete in this snapshot; 0 pre-season.
 *  A GW counts as complete only when every one of its fixtures is finished. */
  actualsThrough: number;
  /** Kickoff of the earliest unfinished fixture — the moment this snapshot
 *  starts going stale (already past ⇒ a match is live or awaiting final
 *  data). Null once the whole calendar is finished. */
  nextKickoff: string | null;
};

import type { PlayerProjection } from '../model/types.js';

/** data/snapshot.json — generated by `npm run etl`, committed, the UI's single data source. */
export type Snapshot = {
  generated_at: string;
  /** Data-as-of stamp (#40) — freshness contract for the UI stamp (#44) and cron guard (#41). */
  asOf: SnapshotAsOf;
  meta: SnapshotMeta;
  players: SnapshotPlayer[];
  fixtures: SnapshotFixture[];
  /** Per-GW finalized actuals (#40) — empty until a GW completes. */
  actuals: SnapshotActuals;
};
