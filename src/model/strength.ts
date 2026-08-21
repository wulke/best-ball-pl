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
 *   M_attack(f)  = v_own  × D_opp          (leaky opponent + home boost)
 *   M_defense(f) = v_opp  × A_opp          (their attack, boosted at home)
 *   M_win(f)     = (v_own × D_opp) / (v_opp × A_opp)
 *
 * Own-club strength cancels in the ratio (A_own/D_own are constant across a
 * club's fixtures, so they divide out of M/M̄) — by design: the fixture
 * factor's job is *who you're playing*; who you are lives in the #43
 * actuals blending and team priors. Folding own form in here would
 * double-count it.
 */

import type { SnapshotStrength } from '../etl/types.js';
import type { FixtureStrengthConfig } from './config.js';
import type { WindowFixture } from './types.js';

/** The five factor families the projection loop consumes (same shape the
 *  legacy FDR path produces — src/model/project.ts). */
export type FixtureFactors = { attack: number; cs: number; gc: number; saves: number; win: number };

/** Per-club shrunk multipliers, league-normalized (≈1.0 = average). */
export type StrengthModel = {
  attack: Map<string, number>;
  defense: Map<string, number>;
};

/** Venue multiplier for the club playing at home (`homeBoost`) or away
 *  (arithmetic mirror `2 − homeBoost`) — the pair averages exactly 1 over a
 *  balanced calendar, keeping the mean-1 normalization venue-clean. */
function venueMultiplier(isHome: boolean, cfg: FixtureStrengthConfig): number {
  return isHome ? cfg.homeBoost : 2 - cfg.homeBoost;
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
    attack.set(club, (sums.attack + kA * mu * seedAttack) / (sums.n + kA) / mu);
    defense.set(club, (sums.concede + kD * mu * seedDefense) / (sums.n + kD) / mu);
  }
  // Clubs present in strength but absent from the calendar are harmless
  // (stray rows); clubs in the calendar but absent from strength throw above.
  return { attack, defense };
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
  const vOwn = venueMultiplier(isHome, cfg);
  const vOpp = venueMultiplier(!isHome, cfg); // opponent's venue is the mirror
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
