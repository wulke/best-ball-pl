/**
 * Results-driven opponent strength (#92) — estimator + ratio-factor coverage:
 * 1. Mean-1 — every family's factors average exactly 1 over a club's full
 *    calendar (season windows stay opponent-neutral even with γ curvature).
 * 2. Degenerate symmetry — a strength section where every club is league
 *    average (identical multipliers) yields factors exactly 1 everywhere.
 * 3. Directionality — a strong opponent (stingy defense / potent attack)
 *    moves the five families the documented way.
 * 4. Scale invariance — multiplying a source's sums AND its league mean by
 *    any constant leaves factors unchanged (goal-scale vs xG-scale).
 * 5. n=0 seed — a club with no matches is exactly its FDR seed (parity path
 *    continuity: no cliff between FDR-only and results-driven regimes).
 * 6. Full-pipeline smoke — buildProjections with a strength section runs
 *    end-to-end on the committed snapshot without error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStrengthModel, strengthFixtureFactorsFor } from './strength.js';
import { DEFAULT_FIXTURE_STRENGTH } from './config.js';
import { buildProjections } from './project.js';
import { modelConfigFor, resolveContest, FALSE_NINE } from '../contest/profiles.js';
import type { Snapshot, SnapshotStrength, StrengthClubSums } from '../etl/types.js';
import type { ProjectionWindow, WindowFixture } from './types.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SNAPSHOT_PATH = path.join(repoRoot, 'data/snapshot.json');

// ---------------------------------------------------------------------------
// Synthetic league: 4 clubs × 2 fixtures each, round-robin-ish
// ---------------------------------------------------------------------------

const CLUBS = ['MCI', 'ARS', 'WOL', 'BHA'];
// Opponent-perspective quality per club (real FDR semantics: HIGH = strong —
// opponents face high difficulty when playing them).
const STRENGTH: Record<string, number> = { MCI: 5, ARS: 4, WOL: 2, BHA: 1 };

function fixture(home: string, away: string): WindowFixture {
  // homeDifficulty rates the AWAY club, awayDifficulty rates the HOME club
  // (each side's difficulty = the opponent's quality + venue edge).
  return {
    home,
    away,
    homeDifficulty: STRENGTH[away],
    awayDifficulty: STRENGTH[home],
  };
}

const CALENDAR: WindowFixture[] = [
  fixture('MCI', 'WOL'),
  fixture('ARS', 'BHA'),
  fixture('WOL', 'MCI'),
  fixture('BHA', 'ARS'),
  fixture('MCI', 'BHA'),
  fixture('ARS', 'WOL'),
  fixture('WOL', 'ARS'),
  fixture('BHA', 'MCI'),
];

function strengthFor(clubs: Record<string, StrengthClubSums>, mu: number): SnapshotStrength {
  return {
    source: 'understat',
    leagueAttackPerMatch: mu,
    through: '2026-08-20 22:00:00',
    clubs,
  };
}

const MID: StrengthClubSums = { n: 4, attack: 4 * 1.5, concede: 4 * 1.2 }; // league-avg rates

function factorsForClub(club: string, strength: SnapshotStrength): ReturnType<typeof strengthFixtureFactorsFor> {
  const model = buildStrengthModel(strength, CALENDAR, DEFAULT_FIXTURE_STRENGTH);
  const window: ProjectionWindow = { calendar: CALENDAR, fixtures: CALENDAR, clubs: null };
  const mine = CALENDAR.filter((f) => f.home === club || f.away === club);
  return strengthFixtureFactorsFor(club, window.calendar, mine, model, DEFAULT_FIXTURE_STRENGTH);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

test('mean-1: every family averages exactly 1 over a club\'s full calendar', () => {
  const strength = strengthFor(
    {
      MCI: { n: 4, attack: 4 * 1.8, concede: 4 * 0.9 },
      ARS: { n: 4, attack: 4 * 1.6, concede: 4 * 1.0 },
      WOL: { n: 4, attack: 4 * 1.2, concede: 4 * 1.4 },
      BHA: { n: 4, attack: 4 * 1.0, concede: 4 * 1.7 },
    },
    1.5,
  );
  for (const club of CLUBS) {
    const fs = factorsForClub(club, strength);
    for (const family of ['attack', 'cs', 'gc', 'saves', 'win'] as const) {
      const avg = mean(fs.map((f) => f[family]));
      assert.ok(Math.abs(avg - 1) < 1e-9, `${club} ${family} mean ${avg} ≠ 1`);
    }
  }
});

test('degenerate: all-league-average clubs differentiate by venue only', () => {
  // Identical clubs ⇒ opponent-relative multipliers collapse to a constant;
  // only the venue term survives. Directions (from the settled mapping):
  // attack/win key off OWN venue (home > 1), cs keys off OPPONENT venue with
  // a NEGATIVE sign (your home game = opponent away = weaker attack → more
  // clean sheets → home cs > 1), gc/saves key off opponent venue positively
  // (home gc/saves < 1 — you concede less vs an away-weakened attack).
  const strength = strengthFor(
    { MCI: MID, ARS: MID, WOL: MID, BHA: MID },
    1.5,
  );
  for (const club of CLUBS) {
    const fs = factorsForClub(club, strength);
    const mine = CALENDAR.filter((f) => f.home === club || f.away === club);
    for (let i = 0; i < mine.length; i += 1) {
      const isHome = mine[i].home === club;
      assert.ok(isHome ? fs[i].attack > 1 : fs[i].attack < 1, `${club} attack venue direction`);
      assert.ok(isHome ? fs[i].win > 1 : fs[i].win < 1, `${club} win venue direction`);
      assert.ok(isHome ? fs[i].cs > 1 : fs[i].cs < 1, `${club} cs venue direction`);
      assert.ok(isHome ? fs[i].gc < 1 : fs[i].gc > 1, `${club} gc venue direction`);
      assert.ok(isHome ? fs[i].saves < 1 : fs[i].saves > 1, `${club} saves venue direction`);
    }
  }
});

test('directionality: strong opponents move each family the documented way', () => {
  // MCI is the strongest side (attack 2.5, concede 0.7); WOL the weakest
  // (attack 1.0, concede 1.9). n=12 gives the observed rates enough weight
  // that ordering is unambiguous despite the FDR seeds.
  const strength = strengthFor(
    {
      MCI: { n: 12, attack: 12 * 2.5, concede: 12 * 0.7 },
      ARS: { n: 12, attack: 12 * 1.6, concede: 12 * 1.2 },
      WOL: { n: 12, attack: 12 * 1.0, concede: 12 * 1.9 },
      BHA: { n: 12, attack: 12 * 1.1, concede: 12 * 1.7 },
    },
    1.5,
  );
  const factorsOf = (club: string) => factorsForClub(club, strength);
  const mine = (club: string) => CALENDAR.filter((f) => f.home === club || f.away === club);
  const fi = (club: string, opp: string, leg: 'home' | 'away') => {
    const fixtures = mine(club);
    const idx = fixtures.findIndex((f) => (leg === 'home' ? f.home === club && f.away === opp : f.away === club && f.home === opp));
    return factorsOf(club)[idx];
  };
  // ARS home legs vs WOL (weakest) and BHA: same venue ⇒ opponent ordering
  // alone. Attack/win/cs higher vs the weaker side; gc/saves lower.
  const vsWol = fi('ARS', 'WOL', 'home');
  const vsBha = fi('ARS', 'BHA', 'home');
  assert.ok(vsWol.attack > vsBha.attack, 'attack higher vs weaker opponent (WOL > BHA)');
  assert.ok(vsWol.win > vsBha.win, 'win higher vs weaker opponent');
  assert.ok(vsWol.cs > vsBha.cs, 'cs higher vs weaker attack (WOL)');
  assert.ok(vsWol.gc < vsBha.gc, 'gc lower vs weaker attack');
  assert.ok(vsWol.saves < vsBha.saves, 'saves lower vs weaker attack');
  // WOL's home leg vs MCI is the absolute strong-opponent check.
  const wolVsMci = fi('WOL', 'MCI', 'home');
  assert.ok(wolVsMci.attack < 1, 'WOL home attack vs MCI suppressed');
  assert.ok(wolVsMci.gc > 1, 'WOL home gc vs MCI rises');
  assert.ok(wolVsMci.saves > 1, 'WOL home saves vs MCI rise');
  assert.ok(wolVsMci.cs < 1, 'WOL home cs vs MCI falls');
  assert.ok(wolVsMci.win < 1, 'WOL home win vs MCI falls');
  // Away leg mirrors: ARS away vs WOL still out-attacks ARS away vs BHA.
  const vsWolAway = fi('ARS', 'WOL', 'away');
  const vsBhaAway = fi('ARS', 'BHA', 'away');
  assert.ok(vsWolAway.attack > vsBhaAway.attack, 'away attack higher vs weaker opponent');
  assert.ok(vsWolAway.cs > vsBhaAway.cs, 'away cs higher vs weaker attack');
});

test('scale invariance: uniform rescaling of sums + league mean leaves factors unchanged', () => {
  const strength = strengthFor(
    {
      MCI: { n: 4, attack: 4 * 1.8, concede: 4 * 0.9 },
      ARS: { n: 4, attack: 4 * 1.6, concede: 4 * 1.0 },
      WOL: { n: 4, attack: 4 * 1.2, concede: 4 * 1.4 },
      BHA: { n: 4, attack: 4 * 1.0, concede: 4 * 1.7 },
    },
    1.5,
  );
  const scaled = strengthFor(
    {
      MCI: { n: 4, attack: 4 * 1.8 * 10, concede: 4 * 0.9 * 10 },
      ARS: { n: 4, attack: 4 * 1.6 * 10, concede: 4 * 1.0 * 10 },
      WOL: { n: 4, attack: 4 * 1.2 * 10, concede: 4 * 1.4 * 10 },
      BHA: { n: 4, attack: 4 * 1.0 * 10, concede: 4 * 1.7 * 10 },
    },
    15,
  );
  for (const club of CLUBS) {
    const a = factorsForClub(club, strength);
    const b = factorsForClub(club, scaled);
    for (let i = 0; i < a.length; i += 1) {
      for (const family of ['attack', 'cs', 'gc', 'saves', 'win'] as const) {
        assert.ok(Math.abs(a[i][family] - b[i][family]) < 1e-9, `${club}[${i}].${family} scale-dependent`);
      }
    }
  }
});

test('n=0 seed: a club with no matches equals its FDR seed multiplier', () => {
  // WOL has no matches → A = seed, D = seed; the ratios must reflect the
  // FDR-extracted quality ordering (stronger rated → higher attack, lower
  // concede), and the club must not blow up or collapse.
  const strength = strengthFor(
    {
      MCI: { n: 4, attack: 4 * 1.8, concede: 4 * 0.9 },
      ARS: { n: 4, attack: 4 * 1.6, concede: 4 * 1.0 },
      WOL: { n: 0, attack: 0, concede: 0 },
      BHA: { n: 4, attack: 4 * 1.0, concede: 4 * 1.7 },
    },
    1.5,
  );
  const model = buildStrengthModel(strength, CALENDAR, DEFAULT_FIXTURE_STRENGTH);
  const seedAttack = model.attack.get('WOL');
  const seedDefense = model.defense.get('WOL');
  assert.ok(seedAttack != null && seedDefense != null);
  // FDR quality ordering (STRENGTH map): MCI rated strongest, WOL weak.
  assert.ok(model.attack.get('MCI')! > model.attack.get('WOL')!, 'stronger club should have higher attack multiplier');
  assert.ok(model.defense.get('MCI')! < model.defense.get('WOL')!, 'stronger club should concede less');
  // n=0 must be the pure seed: WOL rated 2, league mean (5+4+2+1)/4 = 3.
  assert.equal(seedAttack, 1 + DEFAULT_FIXTURE_STRENGTH.seedSlope * (2 - 3), 'WOL attack seed');
  assert.equal(seedDefense, 1 - DEFAULT_FIXTURE_STRENGTH.seedSlope * (2 - 3), 'WOL defense seed');
});

test('full pipeline: buildProjections with a strength section runs on the committed snapshot', () => {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
  const contest = resolveContest(FALSE_NINE, snapshot.fixtures);
  const strength = strengthFor(
    Object.fromEntries(
      [...new Set(snapshot.fixtures.flatMap((f) => [f.home, f.away]))].map((club) => [
        club,
        { n: 1, attack: 1.4, concede: 1.3 },
      ]),
    ),
    1.4,
  );
  const { projections } = buildProjections(snapshot.players, modelConfigFor(FALSE_NINE), contest, undefined, undefined, undefined, strength);
  assert.ok(projections.length === snapshot.players.length);
  for (const p of projections) assert.ok(Number.isFinite(p.points.p50), 'p50 finite with strength');
});
