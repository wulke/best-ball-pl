/**
 * In-season actuals aggregation (#43): the pure fold from the snapshot's
 * per-GW actuals section (#40) + played fixtures into the season-to-date
 * aggregates the projection model blends against its priors.
 *
 * Blending semantics settled here:
 * - **Denominators are team matches played**, not GW numbers — a club with a
 *   game in hand must not have its players' per-match rates diluted. Player
 *   rows and finished fixtures can't disagree (a GW only enters `actuals`
 *   once every fixture is finished), so both aggregates are consistent.
 * - **A player's absence from a GW row = did not feature** (minutes 0 for
 *   that match) — the featured-filter contract from #40 carries through: a
 *   benched player's season rate falls, exactly as it should.
 * - **Starts are inferred**: FPL's live feed has no started flag; a row with
 *   `minutes >= startMinutesThreshold` (default 60) counts as a start. A
 *   sub rarely plays 60+.
 * - **xG/xA cover all observed minutes** when present: FPL data-checks the
 *   decimals shortly after a GW completes; a null stays null (treated as
 *   missing, not zero — the rate blend skips it).
 * - **Null when there is nothing to blend** (no finished GWs / no played
 *   fixtures): callers pass undefined and the model runs its pure prior path —
 *   pre-season parity is structural, zero-actuals output is bit-identical.
 *
 * Team-level results come from the fixtures' final scores (team truth), not
 * by summing player rows. Transfers mid-season are v1-unhandled: a player's
 * rows keep blending into his current club's projection (documented in
 * README — revisit when it bites).
 */

import type { SnapshotActuals, SnapshotFixture, SnapshotPlayer } from '../etl/types.js';

/** One player's season-to-date actuals, summed over completed GW rows. */
export type PlayerSeasonActuals = {
  /** GWs in which the player featured (had a row). */
  featured: number;
  minutes: number;
  /** Rows with minutes >= the start threshold (inferred starts). */
  starts: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  saves: number;
  penaltiesSaved: number;
  /** Sum of non-null xG/xA rows — null when every row was null. */
  xg: number | null;
  xa: number | null;
};

/** One club's season-to-date results, from finished fixtures' final scores. */
export type TeamSeasonActuals = {
  played: number;
  wins: number;
  cleanSheets: number;
  goalsFor: number;
  goalsAgainst: number;
};

/** The season-to-date aggregate the model blends against its priors. */
export type SeasonActuals = {
  players: Map<string, PlayerSeasonActuals>;
  teams: Map<string, TeamSeasonActuals>;
};

/** Aggregate the snapshot's actuals + played fixtures for the model. Returns
 *  null when nothing has been played — callers pass it as undefined and the
 *  projection pipeline runs its pure-prior path (pre-season parity). */
export function aggregateSeasonActuals(
  players: SnapshotPlayer[],
  fixtures: SnapshotFixture[],
  actuals: SnapshotActuals,
  startMinutesThreshold: number,
): SeasonActuals | null {
  // Team truth: every finished fixture with a final score.
  const teams = new Map<string, TeamSeasonActuals>();
  const team = (club: string): TeamSeasonActuals => {
    const existing = teams.get(club);
    if (existing) return existing;
    const fresh: TeamSeasonActuals = {
      played: 0, wins: 0, cleanSheets: 0, goalsFor: 0, goalsAgainst: 0,
    };
    teams.set(club, fresh);
    return fresh;
  };
  for (const fixture of fixtures) {
    if (fixture.homeScore == null || fixture.awayScore == null) continue;
    const home = team(fixture.home);
    const away = team(fixture.away);
    home.played += 1;
    away.played += 1;
    home.goalsFor += fixture.homeScore;
    home.goalsAgainst += fixture.awayScore;
    away.goalsFor += fixture.awayScore;
    away.goalsAgainst += fixture.homeScore;
    if (fixture.homeScore > fixture.awayScore) home.wins += 1;
    else if (fixture.awayScore > fixture.homeScore) away.wins += 1;
    if (fixture.awayScore === 0) home.cleanSheets += 1;
    if (fixture.homeScore === 0) away.cleanSheets += 1;
  }

  // Player truth: rows joined to the pool by element id.
  const pool = new Set(players.map((p) => p.id));
  const rows = new Map<string, PlayerSeasonActuals>();
  for (const gw of actuals.gameweeks) {
    for (const row of gw.players) {
      if (!pool.has(row.id)) continue; // transferred out / non-pool
      const agg = rows.get(row.id) ?? {
        featured: 0, minutes: 0, starts: 0, goals: 0, assists: 0,
        cleanSheets: 0, goalsConceded: 0, saves: 0, penaltiesSaved: 0,
        xg: null, xa: null,
      };
      agg.featured += 1;
      agg.minutes += row.minutes;
      if (row.minutes >= startMinutesThreshold) agg.starts += 1;
      agg.goals += row.goals;
      agg.assists += row.assists;
      agg.cleanSheets += row.cleanSheets;
      agg.goalsConceded += row.goalsConceded;
      agg.saves += row.saves;
      agg.penaltiesSaved += row.penaltiesSaved;
      if (row.xg != null) agg.xg = (agg.xg ?? 0) + row.xg;
      if (row.xa != null) agg.xa = (agg.xa ?? 0) + row.xa;
      rows.set(row.id, agg);
    }
  }

  if (teams.size === 0 && rows.size === 0) return null;
  return { players: rows, teams };
}
