/**
 * Model-side types: the projection contract the ETL embeds into the snapshot
 * and the UI renders. Lives here (not in etl/types.ts) so the model owns its
 * output shape; the snapshot contract re-exports it.
 */

/**
 * A projected 2026/27 stat line — the terms of the False Nine scoring table,
 * aggregated over the full 38-matchweek season. `penaltiesSaved` is included
 * for completeness (history-driven, tiny expected value).
 */
export type ProjectedStatline = {
  minutes: number;
  matches: number; // minutes / 90
  goals: number;
  assists: number;
  shotsOnTarget: number;
  shotsOffTarget: number;
  chancesCreated: number;
  crosses: number;
  tackles: number;
  passes: number;
  cleanSheets: number;
  goalsConceded: number;
  saves: number;
  gkWins: number;
  penaltiesSaved: number;
};

export type ProjectionScenario = 'p10' | 'p50' | 'p90';

/**
 * The fixture-difficulty shape the window math consumes — structurally the
 * snapshot's fixture (id/kickoff/event are window-irrelevant to the model).
 */
export type WindowFixture = {
  id?: number;
  home: string;
  away: string;
  homeDifficulty: number;
  awayDifficulty: number;
};

/**
 * A projection window (#42): the unit every projection is a sum over.
 *
 * - `calendar` — the full committed fixture list. Two normalizations hang off
 *   it: each club's calendar fixture count (the per-fixture minutes
 *   denominator — season minutes are allocated 1/n per fixture) and each
 *   club's calendar-mean difficulty (opponent factors are relative to it, so
 *   they average exactly 1 over a club's season — season windows stay
 *   opponent-neutral by construction).
 * - `fixtures` — the explicit window subset the stat lines sum over: the
 *   whole calendar (season parity), a GW range, or a single-day slate.
 * - `clubs` — the draft pool: ranking/tiering/value sort within these clubs
 *   only (null = everyone). Priors (position means, volume means, price
 *   fits) always estimate over the full player population — a small contest
 *   pool must not shrink the league's priors.
 *
 * Callers who pass nothing get a neutral opponent-flat calendar derived from
 * the players' clubs (every factor exactly 1 — synthetic/unit use); real
 * callers (ETL, CLI, UI) pass an explicitly resolved window.
 */
export type ProjectionWindow = {
  calendar: WindowFixture[];
  fixtures: WindowFixture[];
  clubs: string[] | null;
};

/**
 * Per-player projection: season points at three percentile-ish scenarios
 * (parametric, not simulated — see src/model/project.ts), the stat lines they
 * come from, and the derived columns the cheat sheet ranks on.
 */
export type PlayerProjection = {
  /** Season-long False Nine points under the scenario's minutes/rates. */
  points: Record<ProjectionScenario, number>;
  /** The p50 stat line — full auditability of the headline number. */
  statline: ProjectedStatline;
  /** p50 points per 90 minutes. */
  per90: number;
  /** p90 points per 90 — the best-ball "spike" proxy. */
  ceilingPer90: number;
  /** Projected p50 season minutes (durability). */
  minutes: number;
  /** p50 points per £M of draft price. */
  value: number;
  /** 1-based rank within position and overall, by tournamentScore. */
  posRank: number;
  overallRank: number;
  /** VORP-style draft value: this player's tournamentScore minus the
   *  tournamentScore of the last player at his position still worth starting
   *  (the replacement rank implied by the contest's roster shape — see
   *  `ReplacementConfig` in model/config.ts). Answers "how much does this
   *  player beat what's left at his position," not just "how many points" —
   *  fixes the shallow-position overrate that raw tournamentScore ranking has
   *  (a keeper can out-score a forward on points while being nearly
   *  interchangeable with the next-best keeper). */
  draftValue: number;
  /** 1-based overall rank by draftValue instead of tournamentScore — an
   *  alternate "who to draft next" ordering the sheet can toggle to. */
  overallRankByValue: number;
  /** Natural-break tier within position (1 = best): the cluster the player's
   *  tournamentScore falls into — cuts where the gap between neighbors is
   *  anomalous (see model config `tiering`). */
  tier: number;
  /** History depth behind the projection — surfaced in the UI. */
  confidence: 'high' | 'medium' | 'low';
  /** Tournament-shape-adjusted season score: p50 blended toward p90 (best-ball
   *  favors boom weeks over mean output), dampened for durability/minutes-risk
   *  players (see model config `tournament`). Drives rank, tier, and `value` —
   *  `points.p50` stays the unadjusted raw expected-points figure. */
  tournamentScore: number;
  /** Durability/minutes-risk flag: projected playing time or start rate is
   *  thin for the 26-week Round 1 grind — gates the ceiling boost above. */
  durabilityRisk: boolean;
  /** Which specific durabilityRisk threshold(s) tripped — durabilityRisk is
   *  their OR. */
  durabilityReasons: {
    thinMinutesShare: boolean;
    lowStartFraction: boolean;
    highUnusedSubs: boolean;
  };
  /** History depth behind the projection: seasons with ≥90 minutes played,
   *  and their recency-weighted minutes total — the sample size `confidence`
   *  and the minutes/rate regressions are built from. */
  seasonCount: number;
  weightedMinutes: number;
  /** Price-informed minutes prior for no/low-history players (see
   *  `expectedMinutes` in project.ts), and whether it actually factored into
   *  this player's final minutes. Never applied for goalkeepers — their
   *  minutes come from the starts-claim model instead, regardless of
   *  history depth. */
  newcomerPrior: { value: number; applied: boolean };
  /** Whether the high-win-rate-team fixture-congestion minutes haircut fired.
   *  Outfield only — goalkeeper minutes never go through it. */
  congestionApplied: boolean;
  /** The player's team defensive/win-rate priors (clean sheets, goals
   *  conceded, gk win rate) and whether they came from this team's own
   *  keeper/squad data (`observed: true`) or the promoted-team league-mean
   *  fallback (`observed: false`). */
  teamContext: {
    cleanSheetRate: number;
    goalsConcededPerMatch: number;
    gkWinRate: number;
    observed: boolean;
  };
  /** In-season actuals blend (#43): present once any GW has completed —
   *  `played` = the club's finished matches (the blend denominator),
   *  `minutes` = the player's season-to-date observed minutes, `weight` =
   *  the minutes/starts blend weight actually applied (0 = pure prior — a
   *  player yet to feature, or pre-season). */
  actualsBlend?: { played: number; minutes: number; weight: number };
  /** Daily-slate start calls (#97). Omitted for season projections so the
   * committed False Nine snapshot remains byte-identical. `factor` is the
   * average per-fixture multiplier relative to the normal season-share
   * minutes; each fixture retains the exact call behind that summary. */
  startAwareMinutes?: {
    source: 'override' | 'lineup' | 'model';
    factor: number;
    fixtures: Array<{
      fixtureId: number | null;
      status: 'starter' | 'bench' | 'unknown';
      source: 'override' | 'lineup' | 'model';
      factor: number;
      minutes: number;
      /** P(starts this fixture): 1 for a called starter, 0 for a called bench,
       *  and the model's regressed start share for an unknown — the number a
       *  manual call replaces (#98 breakdown surface). */
      pStart: number;
    }>;
  };
  /** Daily-slate score using market-shrunk rates. It is display-only: all
   * ranking fields above always remain based on `points`/tournamentScore. */
  oddsPoints?: number;
  /** Inputs retained for the odds/model breakdown modal. Absent unless a
   * daily slate actually supplied an odds asset. */
  odds?: {
    fetchedAt: string | null;
    goals: OddsRateComparison;
    assists: OddsRateComparison;
    cleanSheets: OddsRateComparison;
    goalsConceded: OddsRateComparison;
    gkWins: OddsRateComparison;
  };
};

export type OddsRateComparison = {
  model: number;
  oddsImplied: number | null;
  blended: number;
};
