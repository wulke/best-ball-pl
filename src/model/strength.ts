/**
 * Results-driven opponent strength (#92) — the DVOA-style fixture-factor
 * layer. Replaces the FDR slopes (config `fixture`) whenever the snapshot
 * carries a `strength` section (src/etl/strength.ts writes it once the
 * current season has played matches); with no section, callers stay on the
 * legacy linear-FDR path bit-for-bit (guarded by the parity tests).
 *
 * Estimator (docs/research/opponent-strength-signals.md): per-club shrunk
 * league-mean multipliers in the #43 pseudo-count form,
 *
 *   A_i = (Σattack_i + kA·μ·Fᴬ_i) / (n_i + kA) / μ      (attack multiplier)
 *   D_i = (Σconcede_i + kD·μ·Fᴰ_i) / (n_i + kD) / μ      (concession mult.)
 *
 * where μ is the source-scale league mean and F is the FDR-extracted-quality
 * seed — so n=0 is pure FDR and the estimate migrates to observed results as
 * matches accumulate, with the walk-forward-calibrated shrinkage (kA/kD per
 * source scale; goals are noisier than xG and shrink harder).
 *
 * Fixture factors are RATIO-formed: factor = (M_fixture / M̄_calendar)^γ,
 * renormalized so each family averages exactly 1 over the club's calendar
 * (γ curvature would otherwise bias season means ~1% low). M is keyed off
 * the OPPONENT and the venue:
 *
 *   M_attack(f)  = v_own  × D_opp          (leaky opponent + own venue split)
 *   M_defense(f) = v_opp  × A_opp          (their attack + their venue split)
 *   M_win(f)     = (v_own × D_opp) / (v_opp × A_opp)
 *
 * Own-club strength cancels in the ratio (A_own/D_own are constant across a
 * club's fixtures, so they divide out of M/M̄) — by design: the fixture
 * factor's job is *who you're playing*; who you are lives in the #43
 * actuals blending and team priors. Folding own form in here would
 * double-count it.
 */

import type { SnapshotStrength, StrengthMatch } from '../etl/types.js';
import type { FixtureStrengthConfig } from './config.js';
import type { WindowFixture } from './types.js';

/** The five factor families the projection loop consumes (same shape the
 *  legacy FDR path produces — src/model/project.ts). */
export type FixtureFactors = { attack: number; cs: number; gc: number; saves: number; win: number };

/** Per-club shrunk multipliers, league-normalized (≈1.0 = average). */
export type StrengthModel = {
  attack: Map<string, number>;
  defense: Map<string, number>;
  /** Club-specific attack venue multipliers. Counts make the CLI audit able
   *  to distinguish a genuine split from a heavily shrunk thin sample. */
  venue: Map<string, VenueSplit>;
};

export type VenueSplit = { home: number; away: number; homeMatches: number; awayMatches: number };

/**
 * Derive a club's home/away attack split from retained team-match rows. Each
 * venue rate is first expressed relative to the club's season attack rate so
 * team quality remains in `model.attack`, then receives `venueK` pseudo rows
 * at the league arithmetic-mirror target. Missing rows therefore land
 * exactly on the former league-wide pair; on balanced samples the two
 * applied values still average exactly one before fixture normalization.
 */
function venueSplit(
  rows: StrengthMatch[] | undefined,
  sums: { n: number; attack: number },
  cfg: FixtureStrengthConfig,
): VenueSplit {
  const target = { home: cfg.venueHomeTarget, away: 2 - cfg.venueHomeTarget };
  const split = {
    home: { n: 0, attack: 0 },
    away: { n: 0, attack: 0 },
  };
  for (const row of rows ?? []) {
    const side = row.home ? split.home : split.away;
    side.n += 1;
    side.attack += row.attack;
  }
  const baseline = sums.n > 0 ? sums.attack / sums.n : 0;
  const multiplier = (side: 'home' | 'away') => {
    const sample = split[side];
    if (!(baseline > 0) || sample.n === 0) return target[side];
    return (sample.attack / baseline + cfg.venueK * target[side]) / (sample.n + cfg.venueK);
  };
  return {
    home: multiplier('home'),
    away: multiplier('away'),
    homeMatches: split.home.n,
    awayMatches: split.away.n,
  };
}

function venueMultiplier(club: string, isHome: boolean, model: StrengthModel): number {
  const split = model.venue.get(club);
  if (!split) throw new Error(`No venue split for club ${club} — calendar/strength mismatch.`);
  return isHome ? split.home : split.away;
}

/** Extract each club's quality rating from FPL FDR: a fixture's difficulty
 *  rates the fixture FOR one side, i.e. it encodes the OTHER club's strength
 *  plus the venue edge. Splitting the venue offset symmetrically
 *  (homeDifficulty = q_away + vOff/2; awayDifficulty = q_home + vOff/2)
 *  leaves q as a venue-neutral per-club quality signal — the pre-season seed
 *  multipliers hang off its deviation from the league mean. */
function fdrClubQuality(calendar: WindowFixture[]): {
  quality: Map<string, number>;
  leagueMean: number;
} {
  let homeSum = 0;
  let awaySum = 0;
  for (const f of calendar) {
    homeSum += f.homeDifficulty;
    awaySum += f.awayDifficulty;
  }
  const vOff = homeSum / calendar.length - awaySum / calendar.length;
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const f of calendar) {
    const qAway = f.homeDifficulty - vOff / 2; // rating of the away club
    const qHome = f.awayDifficulty - vOff / 2; // rating of the home club
    sums.set(f.away, (sums.get(f.away) ?? 0) + qAway);
    counts.set(f.away, (counts.get(f.away) ?? 0) + 1);
    sums.set(f.home, (sums.get(f.home) ?? 0) + qHome);
    counts.set(f.home, (counts.get(f.home) ?? 0) + 1);
  }
  const quality = new Map<string, number>();
  let total = 0;
  let clubs = 0;
  for (const [club, sum] of sums) {
    const q = sum / (counts.get(club) ?? 1);
    quality.set(club, q);
    total += q;
    clubs += 1;
  }
  return { quality, leagueMean: clubs ? total / clubs : 3 };
}

/** Recent estimate from the chronological #174 sufficient statistics. The
 * effective exponential sample size shrinks the form estimate toward the
 * season multiplier using the source's existing k, so the signal starts
 * inert and never needs ETL-owned state. */
function blendRecentForm(
  rows: StrengthMatch[] | undefined,
  seasonMultiplier: number,
  leagueMean: number,
  k: number,
  cfg: FixtureStrengthConfig,
  signal: 'attack' | 'concede',
): number {
  if (!rows?.length || cfg.recentFormWindow <= 0 || cfg.recentFormHalfLife <= 0 || cfg.recentFormBlend <= 0) {
    return seasonMultiplier;
  }
  const recent = [...rows]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, cfg.recentFormWindow);
  let weightTotal = 0;
  let signalTotal = 0;
  for (let i = 0; i < recent.length; i += 1) {
    const weight = 2 ** (-i / cfg.recentFormHalfLife);
    weightTotal += weight;
    signalTotal += weight * recent[i][signal];
  }
  if (weightTotal === 0) return seasonMultiplier;
  const recentMultiplier = signalTotal / weightTotal / leagueMean;
  const formWeight = cfg.recentFormBlend * weightTotal / (weightTotal + k);
  return seasonMultiplier + formWeight * (recentMultiplier - seasonMultiplier);
}

/** Build the shrunk multiplier maps from the snapshot's strength section. */
export function buildStrengthModel(
  strength: SnapshotStrength,
  calendar: WindowFixture[],
  cfg: FixtureStrengthConfig,
): StrengthModel {
  const goalsScale = strength.source === 'fixture-goals';
  const kA = goalsScale ? cfg.kAttackGoals : cfg.kAttack;
  const kD = goalsScale ? cfg.kDefenseGoals : cfg.kDefense;
  const { quality, leagueMean } = fdrClubQuality(calendar);

  const attack = new Map<string, number>();
  const defense = new Map<string, number>();
  const venue = new Map<string, VenueSplit>();
  for (const [club, q] of quality) {
    const sums = strength.clubs[club];
    if (!sums) {
      throw new Error(
        `Strength section is missing club ${club} — snapshot integrity break (the ETL guarantees every calendar club).`,
      );
    }
    const dq = q - leagueMean;
    const seedAttack = 1 + cfg.seedSlope * dq; // strong club → attacks more
    const seedDefense = 1 - cfg.seedSlope * dq; // strong club → concedes less
    const mu = strength.leagueAttackPerMatch;
    const seasonAttack = (sums.attack + kA * mu * seedAttack) / (sums.n + kA) / mu;
    const seasonDefense = (sums.concede + kD * mu * seedDefense) / (sums.n + kD) / mu;
    attack.set(club, blendRecentForm(strength.matches?.[club], seasonAttack, mu, kA, cfg, 'attack'));
    defense.set(club, blendRecentForm(strength.matches?.[club], seasonDefense, mu, kD, cfg, 'concede'));
    venue.set(club, venueSplit(strength.matches?.[club], sums, cfg));
  }
  // Clubs present in strength but absent from the calendar are harmless
  // (stray rows); clubs in the calendar but absent from strength throw above.
  return { attack, defense, venue };
}

type FixtureMultipliers = { attack: number; defense: number; win: number };

/** The opponent-keyed multiplier triple for one fixture of `club`. */
function fixtureMultipliers(
  fixture: WindowFixture,
  club: string,
  model: StrengthModel,
  cfg: FixtureStrengthConfig,
): FixtureMultipliers {
  const isHome = fixture.home === club;
  const opponent = isHome ? fixture.away : fixture.home;
  const dOpp = model.defense.get(opponent);
  const aOpp = model.attack.get(opponent);
  if (dOpp == null || aOpp == null) {
    throw new Error(`No strength multiplier for club ${opponent} — calendar/strength mismatch.`);
  }
  const vOwn = venueMultiplier(club, isHome, model);
  const vOpp = venueMultiplier(opponent, !isHome, model);
  const mAttack = vOwn * dOpp;
  const mDefense = vOpp * aOpp;
  return { attack: mAttack, defense: mDefense, win: mAttack / mDefense };
}

/** γ-power ratio against the club's calendar mean, renormalized so the
 *  family's calendar mean is exactly 1 (removes the concave-curvature bias
 *  γ<1 would otherwise leave in season totals). Returns the *applied*
 *  function so any fixture's factor — calendar or window — derives without
 *  reference-matching between the two lists. */
function familyFactors(calendarMs: number[], gamma: number): (m: number) => number {
  const meanM = calendarMs.reduce((sum, m) => sum + m, 0) / calendarMs.length;
  const raw = calendarMs.map((m) => (m / meanM) ** gamma);
  const meanRaw = raw.reduce((sum, r) => sum + r, 0) / raw.length;
  return (m: number) => ((m / meanM) ** gamma) / meanRaw;
}

/** Factors for the club's fixtures inside the projection window, aligned
 *  (index-for-index) with the window-fixture list the caller sums over.
 *  Normalization always spans the club's FULL calendar — a season window is
 *  opponent-neutral by construction, short windows express schedule
 *  strength — mirroring the legacy path's calendarMeanDifficulty. */
export function strengthFixtureFactorsFor(
  club: string,
  calendar: WindowFixture[],
  windowFixtures: WindowFixture[],
  model: StrengthModel,
  cfg: FixtureStrengthConfig,
): FixtureFactors[] {
  const mine = calendar.filter((f) => f.home === club || f.away === club);
  if (mine.length === 0) {
    throw new Error(`Club ${club} has no fixtures in the projection calendar — snapshot integrity break.`);
  }
  const triples = mine.map((f) => fixtureMultipliers(f, club, model, cfg));
  const attack = familyFactors(triples.map((t) => t.attack), cfg.gamma.attack);
  // cs runs NEGATIVE on the same opponent-attack multiplier as gc/saves: a
  // strong-attacking opponent means fewer clean sheets, more goals conceded,
  // a busier keeper (Q2: cs −, gc +, saves +).
  const cs = familyFactors(triples.map((t) => t.defense), -cfg.gamma.cs);
  const gc = familyFactors(triples.map((t) => t.defense), cfg.gamma.gc);
  const saves = familyFactors(triples.map((t) => t.defense), cfg.gamma.saves);
  const win = familyFactors(triples.map((t) => t.win), cfg.gamma.win);
  return windowFixtures.map((f) => {
    if (f.home !== club && f.away !== club) {
      throw new Error(`Window fixture ${f.home}-${f.away} does not involve ${club}.`);
    }
    const t = fixtureMultipliers(f, club, model, cfg);
    return {
      attack: attack(t.attack),
      cs: cs(t.defense),
      gc: gc(t.defense),
      saves: saves(t.defense),
      win: win(t.win),
    };
  });
}
