/**
 * Season-long projection pipeline v1: snapshot players → False Nine points at
 * p10/p50/p90. Transparent by construction — every projected stat line is
 * retained on the projection so any ranking can be audited to its inputs.
 *
 * Model shape (see #8 and docs/research/historical-baseline-modeling.md):
 *   minutes  : recency-weighted multi-season durability prior, status-haircut
 *   rates    : xG/xA-blended per-90s, regressed to position mean by sample
 *   volume   : FPL-invisible terms (SoT/KP/Crs/TklW/pass) from league-average
 *              conversions + per-position baselines — the FBref upgrade slot
 *   defense  : team CS/GC/win-rate priors from the 2025/26 primary keeper,
 *              regressed to league mean; GK saves from personal history
 *   tiers    : parametric minutes/burst scenarios — no Monte Carlo (out of scope)
 */

import type { PlayerStatus, Position, SnapshotPlayer } from '../etl/types.js';
import type { ModelConfig } from './config.js';
import { TIER_BANDS } from './config.js';
import { scoreStatline } from './scoring.js';
import type { PlayerProjection, ProjectedStatline } from './types.js';

const LATEST_SEASON = '2025/26';
const SEASON_MINUTES = 3420; // 38 × 90

type TeamContext = {
  cleanSheetRate: number;
  goalsConcededPerMatch: number;
  gkWinRate: number;
};

export type ProjectionResult = {
  /** Aligned 1:1 with the input players array. */
  projections: PlayerProjection[];
  /** League-mean per-90s actually used (post-computation) — for the report. */
  positionMeans: Record<Position, { goals: number; assists: number }>;
};

// ---------------------------------------------------------------------------
// Team defensive context
// ---------------------------------------------------------------------------

function buildTeamContexts(players: SnapshotPlayer[], cfg: ModelConfig): Map<string, TeamContext> {
  const teams = new Set(players.map((p) => p.team));
  const ctxs = new Map<string, TeamContext>();

  // Aggregate last-season team-level rates: primary keeper carries CS/GC, the
  // squad's summed goals carry attack (for the win-rate proxy).
  const keeperByTeam = new Map<string, SnapshotPlayer>();
  const goalsFor = new Map<string, number>();
  for (const p of players) {
    const last = p.seasons.find((s) => s.season === LATEST_SEASON);
    if (!last) continue;
    goalsFor.set(p.team, (goalsFor.get(p.team) ?? 0) + last.goals);
    if (p.position === 'G') {
      const incumbent = keeperByTeam.get(p.team);
      const incumbentMinutes = incumbent?.seasons.find((s) => s.season === LATEST_SEASON)?.minutes ?? -1;
      if (last.minutes > incumbentMinutes) keeperByTeam.set(p.team, p);
    }
  }

  // League means over teams that have data (promoted teams fall back to these).
  const observedCs: number[] = [];
  const observedGc: number[] = [];
  const observedGf: number[] = [];
  for (const team of teams) {
    const keeper = keeperByTeam.get(team);
    if (!keeper) continue;
    const last = keeper.seasons.find((s) => s.season === LATEST_SEASON)!;
    if (last.minutes < 900) continue; // split goalkeeping — not a team signal
    const matches = last.minutes / 90;
    observedCs.push(last.cleanSheets / matches);
    observedGc.push(last.goalsConceded / matches);
    observedGf.push((goalsFor.get(team) ?? 0) / 38);
  }
  const mean = (xs: number[], fallback: number) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;
  const lgCs = mean(observedCs, cfg.team.meanCleanSheetRate);
  const lgGc = mean(observedGc, cfg.team.meanGoalsConcededPerMatch);
  const lgGf = mean(observedGf, cfg.team.meanGoalsForPerMatch);

  for (const team of teams) {
    const keeper = keeperByTeam.get(team);
    const last = keeper?.seasons.find((s) => s.season === LATEST_SEASON);
    if (!last || last.minutes < 900) {
      // Promoted team / split goalkeeping — pure league-mean prior.
      ctxs.set(team, {
        cleanSheetRate: lgCs,
        goalsConcededPerMatch: lgGc,
        gkWinRate: clampWinRate(cfg.team.winRate.intercept + cfg.team.winRate.slope * (lgGf - lgGc), cfg),
      });
      continue;
    }
    const matches = last.minutes / 90;
    const w = cfg.team.lastSeasonWeight;
    const csRate = w * (last.cleanSheets / matches) + (1 - w) * lgCs;
    const gcRate = w * (last.goalsConceded / matches) + (1 - w) * lgGc;
    const gfRate = w * ((goalsFor.get(team) ?? 0) / 38) + (1 - w) * lgGf;

    const winRate = clampWinRate(
      cfg.team.winRate.intercept + cfg.team.winRate.slope * (gfRate - gcRate),
      cfg,
    );

    ctxs.set(team, { cleanSheetRate: csRate, goalsConcededPerMatch: gcRate, gkWinRate: winRate });
  }
  return ctxs;
}

function clampWinRate(x: number, cfg: ModelConfig): number {
  return Math.min(cfg.team.winRate.hi, Math.max(cfg.team.winRate.lo, x));
}

// ---------------------------------------------------------------------------
// Per-player rate estimation
// ---------------------------------------------------------------------------

type RawRates = {
  weightedMinutes: number;
  goalsPer90: number;
  xgPer90: number | null;
  assistsPer90: number;
  xaPer90: number | null;
  savesPer90: number | null;
  startFraction: number;
  penaltiesSavedRate: number; // expected per full-season share
  seasonCount: number;
};

function recencyWeightedTotal(
  seasons: SnapshotPlayer['seasons'],
  weights: [number, number, number],
  pick: (s: SnapshotPlayer['seasons'][number]) => number | null,
): { total: number; minutes: number } {
  let total = 0;
  let minutes = 0;
  seasons.slice(0, 3).forEach((s, i) => {
    const value = pick(s);
    if (value == null) return;
    const w = weights[i];
    total += w * value;
    minutes += w * s.minutes;
  });
  return { total, minutes };
}

function rawRates(player: SnapshotPlayer, cfg: ModelConfig): RawRates {
  const [w0, w1, w2] = cfg.minutes.recencyWeights;
  const weights: [number, number, number] = [w0, w1, w2];
  // Contract says most-recent-first; sort defensively so a stale snapshot
  // (written before the ETL ordering fix) can't silently re-weight careers.
  const seasons = [...player.seasons].sort((a, b) => b.season.localeCompare(a.season));

  const goals = recencyWeightedTotal(seasons, weights, (s) => s.goals);
  const xg = recencyWeightedTotal(seasons, weights, (s) => s.xg);
  const assists = recencyWeightedTotal(seasons, weights, (s) => s.assists);
  const xa = recencyWeightedTotal(seasons, weights, (s) => s.xa);
  const saves = recencyWeightedTotal(seasons, weights, (s) => (s.minutes > 0 ? s.saves : null));
  const starts = recencyWeightedTotal(seasons, weights, (s) =>
    s.minutes > 900 ? Math.min(1, s.starts / (s.minutes / 90)) : null,
  );

  const per90 = (t: { total: number; minutes: number }) =>
    t.minutes > 0 ? (t.total / t.minutes) * 90 : 0;
  const hasXg = xg.minutes > 0 && xg.total > 0.05;

  const penaltyTotals = seasons.reduce((a, s) => a + s.penaltiesSaved, 0);
  const penaltyMinutes = seasons.reduce((a, s) => a + s.minutes, 0);

  return {
    weightedMinutes: recencyWeightedTotal(seasons, weights, (s) => s.minutes).total,
    goalsPer90: per90(goals),
    xgPer90: hasXg ? per90(xg) : null,
    assistsPer90: per90(assists),
    xaPer90: hasXg ? per90(xa) : null, // xA ships with xG; same availability
    savesPer90: saves.minutes > 0 ? per90(saves) : null,
    startFraction: starts.minutes > 0 ? Math.min(1, Math.max(0.3, starts.total)) : 0.85,
    penaltiesSavedRate: penaltyMinutes > 0 ? penaltyTotals / (penaltyMinutes / SEASON_MINUTES) : 0,
    seasonCount: seasons.length,
  };
}

function expectedMinutes(player: SnapshotPlayer, rates: RawRates, cfg: ModelConfig): number {
  let minutes: number;
  if (rates.seasonCount === 0) {
    minutes = cfg.minutes.noHistoryMinutes;
  } else if (rates.seasonCount === 1) {
    const observed = rates.weightedMinutes / cfg.minutes.recencyWeights[0];
    minutes = observed * cfg.minutes.singleSeasonShrink + cfg.minutes.noHistoryMinutes * (1 - cfg.minutes.singleSeasonShrink);
  } else {
    minutes = rates.weightedMinutes;
  }
  minutes = Math.min(minutes, cfg.minutes.maxMinutes);

  const statusFactor = STATUS_FACTORS[player.status] ?? 1;
  return minutes * statusFactor;
}

const STATUS_FACTORS: Partial<Record<PlayerStatus, number>> = {
  i: 0.5,
  d: 0.8,
};

// ---------------------------------------------------------------------------
// Stat-line construction
// ---------------------------------------------------------------------------

type AttackRates = { goals: number; assists: number };

function buildStatline(
  minutes: number,
  position: Position,
  rates: RawRates,
  attack: AttackRates,
  team: TeamContext,
  cfg: ModelConfig,
): ProjectedStatline {
  const matches = minutes / 90;
  const volume = cfg.volume[position];

  const goals = (attack.goals / 90) * matches;
  const assists = (attack.assists / 90) * matches;
  const shotsOnTarget = goals / cfg.conversions.goalsPerSoT;
  const shotsOffTarget =
    shotsOnTarget *
    cfg.conversions.offTargetPerSoT *
    (cfg.scoring.blockedShotsCountOffTarget ? 1.9 : 1.0);
  const chancesCreated = Math.max(
    assists * cfg.conversions.kpPerAssist,
    volume.chancesCreatedFloor * matches,
  );

  // Defensive/team terms — G and D only for CS/GC.
  const csEligible = position === 'G' ? 0.95 : 0.25 + 0.75 * rates.startFraction;
  const cleanSheets = team.cleanSheetRate * matches * csEligible;
  const goalsConceded = team.goalsConcededPerMatch * matches;

  const saves = position === 'G' ? (rates.savesPer90 ?? cfg.team.meanSavesPer90) * matches : 0;
  const gkWins = position === 'G' ? team.gkWinRate * matches : 0;
  const penaltiesSaved = position === 'G' ? rates.penaltiesSavedRate * (minutes / SEASON_MINUTES) : 0;

  return {
    minutes: Math.round(minutes),
    matches: Math.round(matches * 10) / 10,
    goals: round2(goals),
    assists: round2(assists),
    shotsOnTarget: round2(shotsOnTarget),
    shotsOffTarget: round2(shotsOffTarget),
    chancesCreated: round2(chancesCreated),
    crosses: round2(volume.crosses * matches),
    tackles: round2(volume.tackles * matches),
    passes: Math.round(volume.passes * matches),
    cleanSheets: round2(position === 'G' || position === 'D' ? cleanSheets : 0),
    goalsConceded: round2(position === 'G' || position === 'D' ? goalsConceded : 0),
    saves: round2(saves),
    gkWins: round2(gkWins),
    penaltiesSaved: round2(penaltiesSaved),
  };
}

/** Scale a stat line into a scenario. Burst terms react to form, stable terms
 *  barely move, team terms scale with matches and a form factor. */
function applyScenario(
  base: ProjectedStatline,
  scenario: {
    minutesFactor: number;
    burstFactor: number;
    stableFactor: number;
    teamFormFactor: number;
  },
  maxMinutes: number,
): ProjectedStatline {
  const m = Math.min(1, maxMinutes / base.minutes) * scenario.minutesFactor;
  const matches = base.matches * m;
  const team = (term: number) => term * m * scenario.teamFormFactor;
  const conceded = (term: number) => term * m * (2 - scenario.teamFormFactor); // form ↓ conceded

  return {
    minutes: Math.round(base.minutes * m),
    matches: round2(matches),
    goals: round2(base.goals * m * scenario.burstFactor),
    assists: round2(base.assists * m * scenario.burstFactor),
    shotsOnTarget: round2(base.shotsOnTarget * m * scenario.burstFactor),
    shotsOffTarget: round2(base.shotsOffTarget * m * scenario.burstFactor),
    chancesCreated: round2(base.chancesCreated * m * scenario.burstFactor),
    crosses: round2(base.crosses * m * scenario.stableFactor),
    tackles: round2(base.tackles * m * scenario.stableFactor),
    passes: Math.round(base.passes * m * scenario.stableFactor),
    cleanSheets: round2(team(base.cleanSheets)),
    goalsConceded: round2(conceded(base.goalsConceded)),
    saves: round2(base.saves * m * scenario.stableFactor),
    gkWins: round2(base.gkWins * m * scenario.teamFormFactor),
    penaltiesSaved: round2(base.penaltiesSaved * m),
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function buildProjections(
  players: SnapshotPlayer[],
  cfg: ModelConfig,
): ProjectionResult {
  const teams = buildTeamContexts(players, cfg);
  const leagueTeam = teams.get(players[0]?.team ?? '')!; // contexts exist for every team
  const fallbackTeam: TeamContext = leagueTeam ?? {
    cleanSheetRate: cfg.team.meanCleanSheetRate,
    goalsConcededPerMatch: cfg.team.meanGoalsConcededPerMatch,
    gkWinRate: 0.34,
  };

  const raws = players.map((p) => rawRates(p, cfg));

  // Expected minutes per player before position-competition adjustments.
  const minutesByPlayer = players.map((p, i) => expectedMinutes(p, raws[i], cfg));

  // One team, one starting keeper: if a club's GK minutes sum past a full
  // season's job, scale them proportionally — otherwise every incumbent in a
  // goalkeeping carousel projects as a 3420-minute starter (the ARS 2026/27
  // Raya/Meslier/Arrizabalaga problem). Outfield competition stays unmodeled
  // v1 — squads rotate, the #1 job does not.
  const GK_JOB_MINUTES = 3450;
  const gkIndicesByTeam = new Map<string, number[]>();
  players.forEach((p, i) => {
    if (p.position !== 'G') return;
    const list = gkIndicesByTeam.get(p.team) ?? [];
    list.push(i);
    gkIndicesByTeam.set(p.team, list);
  });
  for (const [team, indices] of gkIndicesByTeam) {
    void team;
    const total = indices.reduce((sum, i) => sum + minutesByPlayer[i], 0);
    if (total > GK_JOB_MINUTES) {
      for (const i of indices) minutesByPlayer[i] *= GK_JOB_MINUTES / total;
    }
  }

  // Position means from established players (≥900 recency-weighted minutes).
  const sums: Record<Position, { goals: number; assists: number; n: number }> = {
    G: { goals: 0, assists: 0, n: 0 },
    D: { goals: 0, assists: 0, n: 0 },
    MD: { goals: 0, assists: 0, n: 0 },
    FW: { goals: 0, assists: 0, n: 0 },
  };
  players.forEach((p, i) => {
    if (raws[i].weightedMinutes < 900) return;
    const s = sums[p.position];
    const g = raws[i].xgPer90 ?? raws[i].goalsPer90;
    const a = raws[i].xaPer90 ?? raws[i].assistsPer90;
    s.goals += g;
    s.assists += a;
    s.n += 1;
  });
  const positionMeans = {
    G: { goals: safeDiv(sums.G), assists: safeDiv(sums.G, 'assists') },
    D: { goals: safeDiv(sums.D), assists: safeDiv(sums.D, 'assists') },
    MD: { goals: safeDiv(sums.MD), assists: safeDiv(sums.MD, 'assists') },
    FW: { goals: safeDiv(sums.FW), assists: safeDiv(sums.FW, 'assists') },
  };
  function safeDiv(s: { goals: number; assists: number; n: number }, key: 'goals' | 'assists' = 'goals') {
    return s.n > 0 ? s[key] / s.n : 0;
  }

  const projections = players.map((player, i) => {
    const rates = raws[i];
    const team = teams.get(player.team) ?? fallbackTeam;

    // Regressed attack rates: x-weighted blend, shrunk to position mean.
    const k = rates.weightedMinutes / (rates.weightedMinutes + cfg.rates.regressionMinutes);
    const mean = positionMeans[player.position];
    const xw = cfg.rates.xWeight;
    const gBlend = blend(rates.xgPer90, rates.goalsPer90, xw);
    const aBlend = blend(rates.xaPer90, rates.assistsPer90, xw);
    const attack = {
      goals: (k * gBlend + (1 - k) * mean.goals) * 90,
      assists: (k * aBlend + (1 - k) * mean.assists) * 90,
    };

    const minutes = minutesByPlayer[i];
    const base = buildStatline(minutes, player.position, rates, attack, team, cfg);

    const p10Line = applyScenario(base, cfg.scenarios.p10, cfg.minutes.maxMinutes);
    const p90Cfg = cfg.scenarios.p90;
    const p90Line = applyScenario(
      base,
      {
        minutesFactor: p90Cfg.minutesFactor,
        burstFactor: p90Cfg.burstByPosition[player.position],
        stableFactor: p90Cfg.stableFactor,
        teamFormFactor: p90Cfg.teamFormFactor,
      },
      cfg.minutes.maxMinutes,
    );

    const p50 = scoreStatline(base, player.position, cfg.scoring);
    const p10 = scoreStatline(p10Line, player.position, cfg.scoring);
    const p90 = scoreStatline(p90Line, player.position, cfg.scoring);

    const confidence: PlayerProjection['confidence'] =
      rates.seasonCount >= 2 && rates.weightedMinutes >= 1800
        ? 'high'
        : rates.seasonCount >= 1 && rates.weightedMinutes >= 400
          ? 'medium'
          : 'low';

    return {
      points: { p10, p50, p90 },
      statline: base,
      per90: round2(minutes > 0 ? (p50 / minutes) * 90 : 0),
      ceilingPer90: round2(p90Line.minutes > 0 ? (p90 / p90Line.minutes) * 90 : 0),
      minutes: Math.round(minutes),
      value: round2(player.price > 0 ? p50 / player.price : 0),
      posRank: 0,
      overallRank: 0,
      tier: 0,
      confidence,
    } satisfies PlayerProjection;
  });

  assignRanks(players, projections);
  return { projections, positionMeans };
}

function blend(x: number | null, actual: number, xWeight: number): number {
  if (x == null) return actual;
  return xWeight * x + (1 - xWeight) * actual;
}

function assignRanks(players: SnapshotPlayer[], projections: PlayerProjection[]): void {
  const byP50 = (a: number, b: number) => projections[b].points.p50 - projections[a].points.p50;
  const overall = players.map((_, i) => i).sort(byP50);
  overall.forEach((index, rank) => {
    projections[index].overallRank = rank + 1;
  });

  (Object.keys(TIER_BANDS) as Position[]).forEach((pos) => {
    const inPos = players
      .map((_, i) => i)
      .filter((i) => players[i].position === pos)
      .sort(byP50);
    inPos.forEach((index, rank) => {
      const p = projections[index];
      p.posRank = rank + 1;
      p.tier = Math.min(9, Math.floor(rank / TIER_BANDS[pos]) + 1);
    });
  });
}
