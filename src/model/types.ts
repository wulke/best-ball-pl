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
  /** Tournament-adjusted score (see `tournamentScore`) per £M of draft price. */
  value: number;
  /** 1-based rank within position and overall, by tournamentScore. */
  posRank: number;
  overallRank: number;
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
};
