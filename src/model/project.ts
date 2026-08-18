/**
 * Season-long projection pipeline v1: snapshot players → False Nine points at
 * p10/p50/p90. Transparent by construction — every projected stat line is
 * retained on the projection so any ranking can be audited to its inputs.
 *
 * Model shape (see #8 and docs/research/historical-baseline-modeling.md):
 *   minutes  : recency-weighted multi-season durability prior, status-haircut
 *   rates    : xG/xA-blended per-90s, regressed to position mean by sample
 *   volume   : FPL-invisible terms (SoT/KP/Crs/TklW/pass) — per-player
 *              recency-weighted FBref rates shrunk to the position mean,
 *              per term, when that term has data (#21); league-average
 *              conversions + per-position baselines for uncovered terms
 *              (the v1 fallback path)
 *   defense  : team CS/GC/win-rate priors from the 2025/26 primary keeper,
 *              regressed to league mean; GK saves from personal history
 *   tiers    : parametric minutes/burst scenarios — no Monte Carlo (out of scope)
 *   tournament: (#10) rank/tier/value key off tournamentScore, not raw p50 —
 *              ceiling-weighted toward p90, dampened for durability-risk
 *              players; p50 stays visible unadjusted as the raw "Pts" column
 */

import type { PlayerStatus, Position, SnapshotPlayer } from '../etl/types.js';
import type { ModelConfig } from './config.js';
import { scoreStatline } from './scoring.js';
import type { PlayerProjection, ProjectedStatline } from './types.js';

const LATEST_SEASON = '2025/26';
const SEASON_MINUTES = 3420; // 38 × 90

type TeamContext = {
  cleanSheetRate: number;
  goalsConcededPerMatch: number;
  gkWinRate: number;
  /** false for the promoted-team / split-goalkeeping fallback: no team's own
   *  keeper/squad data behind the priors, pure league-mean substitutes. */
  observed: boolean;
};

export type ProjectionResult = {
  /** Aligned 1:1 with the input players array. */
  projections: PlayerProjection[];
  /** League-mean per-90s actually used (post-computation) — for the report. */
  positionMeans: Record<Position, { goals: number; assists: number }>;
  /** Team defensive contexts actually used — CS/GC/win-rate priors (report). */
  teamContexts: Map<string, TeamContext>;
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
        observed: false,
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

    ctxs.set(team, { cleanSheetRate: csRate, goalsConcededPerMatch: gcRate, gkWinRate: winRate, observed: true });
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
  /** FBref playing-time signal: recency-weighted unused-subs per 90 played
   *  (bench-heavy role) — null when the playing-time page wasn't parsed. */
  unusedSubsPer90: number | null;
  /** FBref per-90 volume rates, recency-weighted over enriched seasons. */
  volume: VolumeRates | null;
};

/** Recency-weighted per-90 rate for one FBref volume term, plus the weighted
 *  minutes behind it (the shrinkage sample size). */
export type VolumeField = {
  min: number;
  per90: number;
};

/** Recency-weighted per-90 volume terms from FBref-enriched season rows.
 *  A field is null when that term has NO league-wide data (its page wasn't
 *  parsed for any season) — buildStatline falls back to league-average
 *  conversions + position baselines for those fields instead of treating
 *  missing data as zero volume. */
export type VolumeRates = {
  shots: VolumeField | null;
  shotsOnTarget: VolumeField | null;
  keyPasses: VolumeField | null;
  crosses: VolumeField | null;
  tacklesWon: VolumeField | null;
  passesCompleted: VolumeField | null;
};

/** Term keys of VolumeRates — also the league-coverage mask keys. */
export type VolumeTerm = keyof VolumeRates;

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
  // A <90-minute season is missing data, not zero output — cameo/no-show
  // rows (loan, injury, non-selection at a prior club) would otherwise eat a
  // recency weight slot and halve real signal (the Philogene trap: one real
  // 796-minute season averaged with two ~zero rows).
  const seasons = [...player.seasons]
    .sort((a, b) => b.season.localeCompare(a.season))
    .filter((s) => s.minutes >= 90);

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

  // FBref playing-time signal: unused substitutes per 90 played, weighted over
  // the enriched rows (denominator = those rows' FBref minutes, so a
  // bench-warming cameo player and a nailed starter are compared fairly).
  let wUnused = 0;
  let wUnusedMin = 0;
  seasons.slice(0, 3).forEach((s, i) => {
    if (s.unusedSubs == null || s.fbrefMinutes == null || s.fbrefMinutes <= 0) return;
    const w = weights[i];
    wUnused += w * s.unusedSubs;
    wUnusedMin += w * s.fbrefMinutes;
  });

  // FBref volume terms: recency-weight each field's totals and divide by the
  // SAME rows' weighted minutes — a field only counts seasons where that
  // field was actually parsed (a page set can legitimately cover only some
  // terms). Small samples are handled downstream by shrinkage toward the
  // position volume mean.
  const acc = (): VolumeField => ({ min: 0, per90: 0 });
  const add = (a: VolumeField, v: number | undefined, w: number, min: number) => {
    if (v == null) return;
    a.min += w * min;
    a.per90 += w * v;
  };
  const sh = acc(), sot = acc(), kp = acc(), crs = acc(), tklw = acc(), cmp = acc();
  seasons.slice(0, 3).forEach((s, i) => {
    if (s.fbrefMinutes == null || s.fbrefMinutes <= 0) return;
    const w = weights[i];
    add(sh, s.shots, w, s.fbrefMinutes);
    add(sot, s.shotsOnTarget, w, s.fbrefMinutes);
    add(kp, s.keyPasses, w, s.fbrefMinutes);
    add(crs, s.crosses, w, s.fbrefMinutes);
    add(tklw, s.tacklesWon, w, s.fbrefMinutes);
    add(cmp, s.passesCompleted, w, s.fbrefMinutes);
  });
  const field = (a: VolumeField): VolumeField | null =>
    a.min > 0 ? { min: a.min, per90: (a.per90 / a.min) * 90 } : null;
  const volume: VolumeRates | null =
    field(sh) || field(sot) || field(kp) || field(crs) || field(tklw) || field(cmp)
      ? {
          shots: field(sh),
          shotsOnTarget: field(sot),
          keyPasses: field(kp),
          crosses: field(crs),
          tacklesWon: field(tklw),
          passesCompleted: field(cmp),
        }
      : null;

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
    unusedSubsPer90: wUnusedMin > 0 ? wUnused / (wUnusedMin / 90) : null,
    volume,
  };
}

function expectedMinutes(
  player: SnapshotPlayer,
  rates: RawRates,
  cfg: ModelConfig,
  newcomerPrior: number,
): number {
  let minutes: number;
  if (rates.seasonCount === 0) {
    // Price-informed prior (see buildProjections) — a flat baseline buried
    // every newcomer at 850 minutes, which a third of the pool is.
    minutes = newcomerPrior;
  } else if (rates.seasonCount === 1) {
    const observed = rates.weightedMinutes / cfg.minutes.recencyWeights[0];
    minutes =
      observed * cfg.minutes.singleSeasonShrink + newcomerPrior * (1 - cfg.minutes.singleSeasonShrink);
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
  volume: VolumeRates | null,
): ProjectedStatline {
  const matches = minutes / 90;
  const baseline = cfg.volume.baselines[position];

  const goals = (attack.goals / 90) * matches;
  const assists = (attack.assists / 90) * matches;

  let shotsOnTarget: number;
  let shotsOffTarget: number;
  let chancesCreated: number;
  let crosses: number;
  let tackles: number;
  let passes: number;
  if (volume) {
    // FBref per-player rates — but only for terms whose page was parsed
    // (covered league-wide); everything else keeps the v1 conversion/baseline
    // math, so a partial page set can't silently zero out volume terms.
    const sot = volume.shotsOnTarget?.per90 ?? null;
    const sh = volume.shots?.per90 ?? null;
    shotsOnTarget = sot != null ? sot * matches : goals / cfg.conversions.goalsPerSoT;
    if (sh != null) {
      const misses = Math.max(0, sh - (sot ?? 0)) * matches;
      shotsOffTarget = cfg.scoring.blockedShotsCountOffTarget
        ? misses
        : misses * cfg.volume.offTargetShareOfMisses;
    } else {
      shotsOffTarget =
        shotsOnTarget *
        cfg.conversions.offTargetPerSoT *
        (cfg.scoring.blockedShotsCountOffTarget ? 1.9 : 1.0);
    }
    const kp = volume.keyPasses?.per90 ?? null;
    chancesCreated =
      kp != null
        ? kp * matches
        : Math.max(assists * cfg.conversions.kpPerAssist, baseline.chancesCreatedFloor * matches);
    const crs = volume.crosses?.per90 ?? null;
    crosses = crs != null ? crs * matches : baseline.crosses * matches;
    const tklw = volume.tacklesWon?.per90 ?? null;
    tackles = tklw != null ? tklw * matches : baseline.tackles * matches;
    const cmp = volume.passesCompleted?.per90 ?? null;
    passes = cmp != null ? cmp * matches : baseline.passes * matches;
  } else {
    // No FBref rows: league-average conversions + position baselines (v1 path).
    shotsOnTarget = goals / cfg.conversions.goalsPerSoT;
    shotsOffTarget =
      shotsOnTarget *
      cfg.conversions.offTargetPerSoT *
      (cfg.scoring.blockedShotsCountOffTarget ? 1.9 : 1.0);
    chancesCreated = Math.max(
      assists * cfg.conversions.kpPerAssist,
      baseline.chancesCreatedFloor * matches,
    );
    crosses = baseline.crosses * matches;
    tackles = baseline.tackles * matches;
    passes = baseline.passes * matches;
  }

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
    crosses: round2(crosses),
    tackles: round2(tackles),
    passes: Math.round(passes),
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
    observed: false,
  };

  const raws = players.map((p) => rawRates(p, cfg));

  // Newcomer minutes prior: FPL prices newcomers by expected role, so the
  // £4→£7 spread across no-history players is a free expected-minutes signal
  // (a £5.5 new midfielder is priced to start, not to play 850 minutes). Fit
  // price → recency-weighted minutes per position over established players
  // (≥900 weighted minutes), then discount: the fit population survived
  // selection (they played), and a newcomer must still beat incumbents.
  // Falls back to the flat noHistoryMinutes when a position lacks samples.
  const priceSamples: Record<Position, { x: number; y: number }[]> = {
    G: [], D: [], MD: [], FW: [],
  };
  players.forEach((p, i) => {
    if (raws[i].weightedMinutes >= 900) {
      priceSamples[p.position].push({ x: p.price, y: raws[i].weightedMinutes });
    }
  });
  const fitByPos = new Map<Position, { a: number; b: number }>();
  for (const pos of Object.keys(priceSamples) as Position[]) {
    const rows = priceSamples[pos];
    if (rows.length < cfg.minutes.newcomer.minSamples) continue;
    const n = rows.length;
    const mx = rows.reduce((sum, r) => sum + r.x, 0) / n;
    const my = rows.reduce((sum, r) => sum + r.y, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const r of rows) {
      sxy += (r.x - mx) * (r.y - my);
      sxx += (r.x - mx) ** 2;
    }
    const b = sxx > 0 ? Math.max(0, sxy / sxx) : 0; // monotone: price can't reduce minutes
    fitByPos.set(pos, { a: my - b * mx, b });
  }
  const newcomerPrior = (p: SnapshotPlayer): number => {
    const fit = fitByPos.get(p.position);
    if (!fit) return cfg.minutes.noHistoryMinutes;
    const estimate = fit.a + fit.b * p.price;
    const clamped = Math.min(
      cfg.minutes.newcomer.capMinutes,
      Math.max(cfg.minutes.newcomer.floorMinutes, estimate),
    );
    return Math.max(
      cfg.minutes.newcomer.floorMinutes,
      clamped * cfg.minutes.newcomer.discount,
    );
  };

  // Expected minutes per player before position-competition adjustments.
  const newcomerPriorByPlayer = players.map((p) => newcomerPrior(p));
  const minutesByPlayer = players.map((p, i) =>
    expectedMinutes(p, raws[i], cfg, newcomerPriorByPlayer[i]),
  );
  // The prior only actually shaped a player's minutes when seasonCount < 2
  // (see expectedMinutes) — and never for goalkeepers, whose minutes get
  // fully overwritten by the starts-claim model below.
  const newcomerPriorApplied = players.map(
    (p, i) => p.position !== 'G' && raws[i].seasonCount < 2,
  );

  // Fixture congestion: outfield players on the top-N teams by projected win
  // rate (Europe/cup proxy) rotate inside MW 1–26 — haircut their minutes.
  const congestedTeams = new Set(
    [...teams.entries()]
      .sort((a, b) => b[1].gkWinRate - a[1].gkWinRate)
      .slice(0, cfg.minutes.congestion.topTeams)
      .map(([team]) => team),
  );
  const congestionApplied = players.map((p) => p.position !== 'G' && congestedTeams.has(p.team));
  players.forEach((p, i) => {
    if (congestionApplied[i]) {
      minutesByPlayer[i] *= cfg.minutes.congestion.factor;
    }
  });

  // Goalkeepers: one club, 38 STARTS — and a share of the job is claimed by
  // recent starting evidence, not by minutes. Prior-season minutes follow the
  // keeper across transfers, so a proportional minute-split lets stale
  // cross-club bench minutes steal the #1 job (the ARS 2026/27
  // Raya/Meslier/Arrizabalaga problem: Raya started 37 and 38 straight
  // seasons, yet projected behind keepers with 0 and 90 minutes last season).
  // A keeper claims club starts by starting ≥ gkCredibleStarts matches last
  // season; claimants split the club's gkStartsPerSeason proportionally to
  // recency-weighted starts priors (injury risk stays priced — priors sit
  // under 38), and the bench inherits the residual — the club's 38 starts of
  // win/CS/save opportunity are counted exactly once, handed to whoever
  // actually starts. Clubs with no credible claimant (fresh carousel,
  // promoted room) fall back to a prior-proportional split of the whole job.
  // Expected wins/CS/saves then follow structurally: matches = starts, club
  // rates × starts. Outfield competition stays unmodeled v1 — squads rotate,
  // the #1 GK job does not.
  const gkIndicesByTeam = new Map<string, number[]>();
  players.forEach((p, i) => {
    if (p.position !== 'G') return;
    const list = gkIndicesByTeam.get(p.team) ?? [];
    list.push(i);
    gkIndicesByTeam.set(p.team, list);
  });
  const startsPrior = (p: SnapshotPlayer): number => {
    // Mirror expectedMinutes' season-count logic in starts: one-season keepers
    // shrink toward a no-history baseline (their 0.55-weighted row alone
    // would halve a 34-start #1); multi-season keepers recency-weight.
    const w = cfg.minutes.recencyWeights;
    if (p.seasons.length === 0) return 0;
    if (p.seasons.length === 1) {
      const observed = p.seasons[0].starts;
      return (
        observed * cfg.minutes.singleSeasonShrink +
        (cfg.minutes.noHistoryMinutes / 90) * (1 - cfg.minutes.singleSeasonShrink)
      );
    }
    return p.seasons
      .slice(0, w.length)
      .reduce((sum, s, k) => sum + s.starts * w[k], 0);
  };
  for (const indices of gkIndicesByTeam.values()) {
    const priors = indices.map((i) => startsPrior(players[i]));
    const isClaimant = indices.map(
      (i) => (players[i].seasons[0]?.starts ?? 0) >= cfg.minutes.gkCredibleStarts,
    );
    const starts = new Array<number>(indices.length).fill(0);

    if (isClaimant.some(Boolean)) {
      const claimantPrior = priors.reduce((sum, prior, k) => sum + (isClaimant[k] ? prior : 0), 0);
      // Claimants keep their prior expected starts (injury risk priced in) —
      // scaled down only when the claimant pool overflows the club's job.
      const scale = Math.min(1, cfg.minutes.gkStartsPerSeason / claimantPrior);
      indices.forEach((_, k) => {
        if (isClaimant[k]) starts[k] = priors[k] * scale;
      });
      // Bench inherits the club's residual starts (injury cover), split by priors.
      const assigned = starts.reduce((sum, s) => sum + s, 0);
      const residual = Math.max(0, cfg.minutes.gkStartsPerSeason - assigned);
      const bench = indices.map((_, k) => (isClaimant[k] ? 0 : priors[k]));
      const benchPrior = bench.reduce((sum, b) => sum + b, 0);
      if (residual > 0) {
        const benchCount = indices.filter((_, j) => !isClaimant[j]).length;
        indices.forEach((_, k) => {
          if (!isClaimant[k]) {
            starts[k] =
              benchPrior > 0
                ? (bench[k] / benchPrior) * residual
                : residual / Math.max(1, benchCount);
          }
        });
      }
    } else {
      // No credible #1: prior-proportional split of the whole job (+1 floor
      // so a room of all-zero priors doesn't degenerate).
      const floorPriors = priors.map((prior) => prior + 1);
      const total = floorPriors.reduce((sum, f) => sum + f, 0);
      indices.forEach((_, k) => {
        starts[k] = (floorPriors[k] / total) * cfg.minutes.gkStartsPerSeason;
      });
    }

    indices.forEach((i, k) => {
      const statusFactor = STATUS_FACTORS[players[i].status] ?? 1;
      minutesByPlayer[i] = starts[k] * 90 * statusFactor;
    });
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

  // League-wide coverage per term: is there ANY season row carrying this
  // FBref field? A term without coverage (its page was never parsed) must
  // fall back to the conversion/baseline path for every player — never be
  // treated as zero volume.
  const coverage: Record<VolumeTerm, boolean> = {
    shots: false, shotsOnTarget: false, keyPasses: false,
    crosses: false, tacklesWon: false, passesCompleted: false,
  };
  for (const p of players) {
    for (const s of p.seasons) {
      if (s.shots != null) coverage.shots = true;
      if (s.shotsOnTarget != null) coverage.shotsOnTarget = true;
      if (s.keyPasses != null) coverage.keyPasses = true;
      if (s.crosses != null) coverage.crosses = true;
      if (s.tacklesWon != null) coverage.tacklesWon = true;
      if (s.passesCompleted != null) coverage.passesCompleted = true;
    }
  }

  // Position volume means per term, over players with ≥ minMeanMinutes of
  // recency-weighted FBref minutes behind that term — the shrinkage target
  // for per-player rates.
  const emptySums = (): VolSums => ({
    shots: emptyFieldSum(), shotsOnTarget: emptyFieldSum(), keyPasses: emptyFieldSum(),
    crosses: emptyFieldSum(), tacklesWon: emptyFieldSum(), passesCompleted: emptyFieldSum(),
  });
  const volSums: Record<Position, VolSums> = {
    G: emptySums(), D: emptySums(), MD: emptySums(), FW: emptySums(),
  };
  const leagueVol = emptySums();
  players.forEach((p, i) => {
    const v = raws[i].volume;
    if (!v) return;
    for (const target of [volSums[p.position], leagueVol]) {
      for (const t of Object.keys(coverage) as VolumeTerm[]) {
        const f = v[t];
        if (f && f.min >= cfg.volume.minMeanMinutes) {
          target[t].total += f.per90;
          target[t].n += 1;
        }
      }
    }
  });
  const volumeMeans: Record<Position, VolumeMean | null> = {
    G: toVolMean(volSums.G), D: toVolMean(volSums.D), MD: toVolMean(volSums.MD), FW: toVolMean(volSums.FW),
  };
  const leagueVolumeMean = toVolMean(leagueVol);

  // Per-player shrunk rates. Terms without league coverage become null →
  // buildStatline falls back to conversions/baselines for them. A covered
  // term the player is missing data for shrinks fully to the position mean.
  const volumeRates: (VolumeRates | null)[] = players.map((p, i) => {
    const v = raws[i].volume;
    if (!v) return null;
    const mean = volumeMeans[p.position] ?? leagueVolumeMean;
    const shrink = (t: VolumeTerm, f: VolumeField | null): VolumeField | null => {
      if (!coverage[t]) return null;
      const m = mean ? mean[t] : null;
      if (!f) return m ? { min: 0, per90: m } : null; // missing row → position mean
      if (m == null) return f; // nobody to shrink toward — raw rates
      const k = f.min / (f.min + cfg.volume.regressionMinutes);
      return { min: f.min, per90: k * f.per90 + (1 - k) * m };
    };
    return {
      shots: shrink('shots', v.shots),
      shotsOnTarget: shrink('shotsOnTarget', v.shotsOnTarget),
      keyPasses: shrink('keyPasses', v.keyPasses),
      crosses: shrink('crosses', v.crosses),
      tacklesWon: shrink('tacklesWon', v.tacklesWon),
      passesCompleted: shrink('passesCompleted', v.passesCompleted),
    };
  });

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
    const base = buildStatline(minutes, player.position, rates, attack, team, cfg, volumeRates[i]);

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

    // Durability/minutes-risk (#10): thin projected playing time or start
    // rate for the 26-week Round 1 grind, independent of the injury/status
    // flag (that covers today's news, this covers season-long role security).
    const tCfg = cfg.tournament;
    const durabilityReasons = {
      thinMinutesShare: minutes / cfg.minutes.maxMinutes < tCfg.minutesShareRiskThreshold,
      lowStartFraction: rates.startFraction < tCfg.startFractionRiskThreshold,
      highUnusedSubs: (rates.unusedSubsPer90 ?? 0) > tCfg.unusedSubsRiskPer90,
    };
    const durabilityRisk =
      durabilityReasons.thinMinutesShare ||
      durabilityReasons.lowStartFraction ||
      durabilityReasons.highUnusedSubs;

    // Ceiling weighting: best-ball rewards boom weeks, so rank on a score
    // blended toward p90, not raw mean output. Risk-flagged players get a
    // dampened boost — a spike proxy is only worth drafting toward if the
    // player is trusted to be on the pitch.
    const ceilingWeight = tCfg.ceilingWeight * (durabilityRisk ? tCfg.riskCeilingDampen : 1);
    const tournamentScore = round2(p50 + ceilingWeight * (p90 - p50));

    return {
      points: { p10, p50, p90 },
      statline: base,
      per90: round2(minutes > 0 ? (p50 / minutes) * 90 : 0),
      ceilingPer90: round2(p90Line.minutes > 0 ? (p90 / p90Line.minutes) * 90 : 0),
      minutes: Math.round(minutes),
      value: round2(player.price > 0 ? tournamentScore / player.price : 0),
      posRank: 0,
      overallRank: 0,
      tier: 0,
      confidence,
      tournamentScore,
      durabilityRisk,
      durabilityReasons,
      seasonCount: rates.seasonCount,
      weightedMinutes: round2(rates.weightedMinutes),
      newcomerPrior: { value: round2(newcomerPriorByPlayer[i]), applied: newcomerPriorApplied[i] },
      congestionApplied: congestionApplied[i],
      teamContext: team,
    } satisfies PlayerProjection;
  });

  assignRanks(players, projections, cfg);
  return { projections, positionMeans, teamContexts: teams };
}

function blend(x: number | null, actual: number, xWeight: number): number {
  if (x == null) return actual;
  return xWeight * x + (1 - xWeight) * actual;
}

type FieldSum = { total: number; n: number };

type VolSums = Record<VolumeTerm, FieldSum>;

function emptyFieldSum(): FieldSum {
  return { total: 0, n: 0 };
}

type VolumeMean = Record<VolumeTerm, number>;

function toVolMean(s: VolSums): VolumeMean | null {
  const out: VolumeMean = {
    shots: 0, shotsOnTarget: 0, keyPasses: 0,
    crosses: 0, tacklesWon: 0, passesCompleted: 0,
  };
  let any = false;
  for (const t of Object.keys(s) as VolumeTerm[]) {
    const f = s[t];
    if (f.n > 0) {
      out[t] = f.total / f.n;
      any = true;
    }
  }
  return any ? out : null;
}

function assignRanks(players: SnapshotPlayer[], projections: PlayerProjection[], cfg: ModelConfig): void {
  // Rank/tier on tournamentScore (ceiling-weighted, risk-dampened) — the
  // best-ball-relevant value, not raw mean points (see #10).
  const byScore = (a: number, b: number) =>
    projections[b].tournamentScore - projections[a].tournamentScore;
  const overall = players.map((_, i) => i).sort(byScore);
  overall.forEach((index, rank) => {
    projections[index].overallRank = rank + 1;
  });

  (['G', 'D', 'MD', 'FW'] as Position[]).forEach((pos) => {
    const inPos = players
      .map((_, i) => i)
      .filter((i) => players[i].position === pos)
      .sort(byScore);
    inPos.forEach((index, rank) => {
      projections[index].posRank = rank + 1;
    });
    assignNaturalBreakTiers(inPos, projections, cfg.tiering, pos);
  });
}

/** Natural-break tiers over the draftable head: cut where the gap between
 *  tournamentScore-neighbors exceeds max(minGap, gapMultiplier × median gap);
 *  any tier larger than maxTierSize (flat plateaus) splits recursively at its
 *  largest internal gap until draft-room sized. Tier 1 is best; past
 *  draftableDepth = 9. */
function assignNaturalBreakTiers(
  sortedIndices: number[],
  projections: PlayerProjection[],
  cfg: ModelConfig['tiering'],
  position: Position,
): void {
  const draftable = sortedIndices.slice(0, cfg.draftableDepth[position]);
  const p50s = draftable.map((i) => projections[i].tournamentScore);
  const gaps = p50s.slice(1).map((v, j) => p50s[j] - v);
  const cutSet = new Set<number>();
  if (gaps.length > 0) {
    const medianGap = median(gaps);
    const threshold = Math.max(cfg.minGap, cfg.gapMultiplier * medianGap);
    gaps
      .map((gap, j) => ({ gap, j }))
      .filter(({ gap }) => gap >= threshold)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, cfg.maxTiers - 1)
      .forEach(({ j }) => cutSet.add(j));
  }

  // Size-driven splits: keep every run between cuts ≤ maxTierSize.
  const runs: Array<[number, number]> = [];
  {
    let start = 0;
    for (let j = 0; j < draftable.length; j += 1) {
      if (cutSet.has(j)) {
        runs.push([start, j + 1]);
        start = j + 1;
      }
    }
    if (start < draftable.length) runs.push([start, draftable.length]);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (let r = 0; r < runs.length; r += 1) {
      const [start, end] = runs[r];
      if (end - start <= cfg.maxTierSize) continue;
      if (cutSet.size >= cfg.maxTiers - 1) break; // keep the 1..8 + residual-9 invariant
      let bestJ = start;
      let bestGap = -Infinity;
      for (let j = start; j < end - 1; j += 1) {
        const gap = p50s[j] - p50s[j + 1];
        if (gap > bestGap) {
          bestGap = gap;
          bestJ = j;
        }
      }
      cutSet.add(bestJ);
      runs.splice(r, 1, [start, bestJ + 1], [bestJ + 1, end]);
      changed = true;
      break;
    }
  }

  let tier = 1;
  draftable.forEach((index, j) => {
    projections[index].tier = tier;
    if (cutSet.has(j)) tier += 1;
  });
  for (const index of sortedIndices.slice(cfg.draftableDepth[position])) {
    projections[index].tier = 9;
  }
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
