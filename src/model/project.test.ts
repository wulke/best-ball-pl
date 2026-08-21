/**
 * Coverage for the explanation fields persisted on PlayerProjection (#29):
 * seasonCount/weightedMinutes, newcomerPrior, congestionApplied, teamContext
 * (incl. the promoted-team fallback), and durabilityReasons — each threshold
 * individually. Synthetic players, not the real snapshot, so every case is
 * hand-controlled.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjections, replacementDepth } from './project.js';
import { DEFAULT_MODEL_CONFIG, DEFAULT_REPLACEMENT, type ModelConfig, type ReplacementConfig } from './config.js';
import type { PlayerProjection } from './types.js';
import type { Position, PlayerStatus, SeasonStatLine, SnapshotPlayer } from '../etl/types.js';

function season(overrides: Partial<SeasonStatLine> & { season: string; minutes: number }): SeasonStatLine {
  return {
    starts: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 0,
    saves: 0,
    penaltiesSaved: 0,
    xg: null,
    xa: null,
    fplPoints: 0,
    ...overrides,
  };
}

function player(overrides: Partial<SnapshotPlayer> & { id: string; team: string; position: Position }): SnapshotPlayer {
  return {
    name: overrides.id,
    fullName: overrides.id,
    price: 5.5,
    status: 'a' as PlayerStatus,
    news: '',
    seasons: [],
    ...overrides,
  };
}

// Seven teams: T1–T5 are healthy keepers (varying win rate), T6 is the
// weakest observed keeper (guaranteed excluded from the top-6 congestion
// set), T7 is promoted — no goalkeeper at all, forcing the league-mean
// fallback (teamContext.observed === false).
function buildTeams(): SnapshotPlayer[] {
  const teams: SnapshotPlayer[] = [];
  const keeperSpec: Record<string, { cs: number; gc: number; goals: number }> = {
    T1: { cs: 18, gc: 30, goals: 70 },
    T2: { cs: 15, gc: 38, goals: 60 },
    T3: { cs: 13, gc: 42, goals: 55 },
    T4: { cs: 11, gc: 48, goals: 48 },
    T5: { cs: 9, gc: 55, goals: 42 },
    T6: { cs: 3, gc: 80, goals: 25 }, // weakest — excluded from top-6 congestion
  };
  for (const [team, spec] of Object.entries(keeperSpec)) {
    teams.push(
      player({
        id: `${team}-GK`,
        team,
        position: 'G',
        seasons: [
          season({
            season: '2025/26',
            minutes: 3420,
            starts: 38,
            cleanSheets: spec.cs,
            goalsConceded: spec.gc,
          }),
        ],
      }),
    );
    // Squad goals for the win-rate proxy.
    teams.push(
      player({
        id: `${team}-attacker`,
        team,
        position: 'FW',
        seasons: [season({ season: '2025/26', minutes: 3000, goals: spec.goals, starts: 33 })],
      }),
    );
  }
  // T7: promoted club, no keeper — league-mean fallback.
  teams.push(
    player({
      id: 'T7-attacker',
      team: 'T7',
      position: 'FW',
      seasons: [season({ season: '2025/26', minutes: 3000, goals: 40, starts: 33 })],
    }),
  );
  return teams;
}

function run(extraPlayers: SnapshotPlayer[]) {
  const players = [...buildTeams(), ...extraPlayers];
  const result = buildProjections(players, DEFAULT_MODEL_CONFIG);
  const byId = new Map(players.map((p, i) => [p.id, result.projections[i]]));
  return { result, byId };
}

test('seasonCount and weightedMinutes are persisted from the raw rates', () => {
  const est = player({
    id: 'established',
    team: 'T1',
    position: 'MD',
    seasons: [
      season({ season: '2025/26', minutes: 2500, goals: 5, starts: 25 }),
      season({ season: '2024/25', minutes: 2500, goals: 4, starts: 24 }),
    ],
  });
  const { byId } = run([est]);
  const proj = byId.get('established')!;
  assert.equal(proj.seasonCount, 2);
  // weightedMinutes = 0.55*2500 + 0.3*2500 (recencyWeights), rounded to 2dp.
  assert.equal(proj.weightedMinutes, 2125);
});

test('newcomerPrior applies to a no-history outfield player but never to a goalkeeper', () => {
  const newcomerMd = player({ id: 'newcomer-md', team: 'T1', position: 'MD', price: 6.0, seasons: [] });
  const newcomerGk = player({ id: 'newcomer-gk', team: 'T2', position: 'G', price: 4.5, seasons: [] });
  const { byId } = run([newcomerMd, newcomerGk]);

  const mdProj = byId.get('newcomer-md')!;
  assert.equal(mdProj.seasonCount, 0);
  assert.equal(mdProj.newcomerPrior.applied, true);
  assert.ok(mdProj.newcomerPrior.value > 0);

  // A no-history goalkeeper's minutes come entirely from the starts-claim
  // model — the newcomer prior never actually shapes them.
  const gkProj = byId.get('newcomer-gk')!;
  assert.equal(gkProj.seasonCount, 0);
  assert.equal(gkProj.newcomerPrior.applied, false);
});

test('congestionApplied fires for outfield players on high-win-rate teams, never for goalkeepers, and not for the excluded weakest team', () => {
  const { result, byId } = run([]);

  // Recompute the same top-6-by-win-rate set the model derives internally.
  const top6 = new Set(
    [...result.teamContexts.entries()]
      .sort((a, b) => b[1].gkWinRate - a[1].gkWinRate)
      .slice(0, DEFAULT_MODEL_CONFIG.minutes.congestion.topTeams)
      .map(([team]) => team),
  );
  assert.ok(!top6.has('T6'), 'T6 is engineered to be the weakest team and must sit outside the top 6');

  for (const [id, proj] of byId) {
    const team = id.split('-')[0];
    const isGk = id.endsWith('GK');
    if (isGk) {
      assert.equal(proj.congestionApplied, false, `${id} is a goalkeeper — congestion never applies`);
    } else if (top6.has(team)) {
      assert.equal(proj.congestionApplied, true, `${id} is on a top-6 win-rate team`);
    } else {
      assert.equal(proj.congestionApplied, false, `${id} is on a team outside the top 6`);
    }
  }
});

test('teamContext.observed reflects the promoted-team league-mean fallback', () => {
  const { byId } = run([]);

  assert.equal(byId.get('T1-attacker')!.teamContext.observed, true);
  assert.equal(byId.get('T7-attacker')!.teamContext.observed, false);
  // The fallback still carries usable numbers, not zeros.
  const t7 = byId.get('T7-attacker')!.teamContext;
  assert.ok(t7.cleanSheetRate > 0);
  assert.ok(t7.goalsConcededPerMatch > 0);
});

test('durabilityReasons.thinMinutesShare trips in isolation', () => {
  const p = player({
    id: 'thin-minutes',
    team: 'T1',
    position: 'MD',
    seasons: [
      season({ season: '2025/26', minutes: 1200, starts: 13, goals: 2 }),
      season({ season: '2024/25', minutes: 1200, starts: 13, goals: 2 }),
    ],
  });
  const { byId } = run([p]);
  const proj = byId.get('thin-minutes')!;
  assert.equal(proj.durabilityReasons.thinMinutesShare, true);
  assert.equal(proj.durabilityReasons.lowStartFraction, false);
  assert.equal(proj.durabilityReasons.highUnusedSubs, false);
  assert.equal(proj.durabilityRisk, true);
});

test('durabilityReasons.lowStartFraction trips in isolation', () => {
  const p = player({
    id: 'low-starts',
    team: 'T1',
    position: 'MD',
    seasons: [season({ season: '2025/26', minutes: 3000, starts: 30, goals: 4 })],
  });
  const { byId } = run([p]);
  const proj = byId.get('low-starts')!;
  assert.equal(proj.durabilityReasons.lowStartFraction, true);
  assert.equal(proj.durabilityReasons.thinMinutesShare, false);
  assert.equal(proj.durabilityReasons.highUnusedSubs, false);
  assert.equal(proj.durabilityRisk, true);
});

test('durabilityReasons.highUnusedSubs trips in isolation', () => {
  const p = player({
    id: 'bench-heavy',
    team: 'T1',
    position: 'MD',
    seasons: [
      season({
        season: '2025/26',
        minutes: 2500,
        starts: 25,
        goals: 4,
        unusedSubs: 25,
        fbrefMinutes: 2500,
      }),
      season({ season: '2024/25', minutes: 2500, starts: 25, goals: 4 }),
    ],
  });
  const { byId } = run([p]);
  const proj = byId.get('bench-heavy')!;
  assert.equal(proj.durabilityReasons.highUnusedSubs, true);
  assert.equal(proj.durabilityReasons.thinMinutesShare, false);
  assert.equal(proj.durabilityReasons.lowStartFraction, false);
  assert.equal(proj.durabilityRisk, true);
});

test('durabilityReasons are all false and durabilityRisk is false for a secure starter', () => {
  const p = player({
    id: 'nailed-on',
    team: 'T1',
    position: 'MD',
    seasons: [
      season({ season: '2025/26', minutes: 3000, starts: 33, goals: 6 }),
      season({ season: '2024/25', minutes: 3000, starts: 33, goals: 5 }),
    ],
  });
  const { byId } = run([p]);
  const proj = byId.get('nailed-on')!;
  assert.deepEqual(proj.durabilityReasons, {
    thinMinutesShare: false,
    lowStartFraction: false,
    highUnusedSubs: false,
  });
  assert.equal(proj.durabilityRisk, false);
});

// ---------------------------------------------------------------------------
// draftValue / overallRankByValue (VORP) — #Pickford-4th
// ---------------------------------------------------------------------------

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

test('replacementDepth: FLEX share splits evenly across D/MD/FW only, never G', () => {
  // False Nine shape (12-team, 1G/2D/2MD/2FW + 2 FLEX): flexShare = 2/3 per
  // flex-eligible position; G gets none regardless of the flex count.
  assert.equal(replacementDepth('G', DEFAULT_REPLACEMENT), 12); // 12 * (1 + 0)
  assert.equal(replacementDepth('D', DEFAULT_REPLACEMENT), 32); // round(12 * (2 + 2/3)) = round(32.0004)
  assert.equal(replacementDepth('MD', DEFAULT_REPLACEMENT), 32);
  assert.equal(replacementDepth('FW', DEFAULT_REPLACEMENT), 32);

  // The Free Kick GW1 slate shape (6-team, 1G/1D/1MD/1FW + 2 FLEX).
  const freeKick: ReplacementConfig = {
    starters: { G: 1, D: 1, MD: 1, FW: 1 },
    flex: 2,
    draftSize: 6,
  };
  assert.equal(replacementDepth('G', freeKick), 6);
  assert.equal(replacementDepth('D', freeKick), 10); // round(6 * (1 + 2/3)) = round(10.002)

  // Rounding lands mid-value cases sensibly (not just exact-integer cases).
  const oddSplit: ReplacementConfig = { starters: { G: 1, D: 1, MD: 1, FW: 1 }, flex: 1, draftSize: 10 };
  assert.equal(replacementDepth('MD', oddSplit), 13); // round(10 * (1 + 1/3)) = round(13.33)

  // Floors at 1 even for a degenerate zero-starter, zero-flex shape.
  const empty: ReplacementConfig = { starters: { G: 0, D: 0, MD: 0, FW: 0 }, flex: 0, draftSize: 1 };
  assert.equal(replacementDepth('G', empty), 1);
  assert.equal(replacementDepth('D', empty), 1);
});

test('draftValue clamps to the last available player when the pool is shallower than replacement depth', () => {
  // Only 6 goalkeepers exist (buildTeams' T1-T6), well short of the default
  // 12-team replacement depth — the worst of the 6 becomes the baseline.
  const { byId } = run([]);
  const gks = ['T1-GK', 'T2-GK', 'T3-GK', 'T4-GK', 'T5-GK', 'T6-GK'].map((id) => byId.get(id)!);
  const sorted = [...gks].sort((a, b) => b.tournamentScore - a.tournamentScore);
  const worst = sorted[sorted.length - 1];

  assert.equal(worst.draftValue, 0, 'the worst available keeper is his own replacement baseline');
  for (const proj of sorted) {
    assert.equal(proj.draftValue, round2(proj.tournamentScore - worst.tournamentScore));
  }
});

test('a shallow position compresses toward replacement faster than a deep one', () => {
  // draftSize=1, 1 starting G but 3 starting FW (0 D/MD, no FLEX): replacement
  // depth is 1 for G and 3 for FW — an intentionally extreme, synthetic
  // roster shape purely to make the shallow-vs-deep contrast unambiguous.
  const shape: ReplacementConfig = { starters: { G: 1, D: 0, MD: 0, FW: 3 }, flex: 0, draftSize: 1 };
  assert.equal(replacementDepth('G', shape), 1);
  assert.equal(replacementDepth('FW', shape), 3);

  const players = buildTeams(); // 6 G, 7 FW, no D/MD
  const { projections } = buildProjections(players, DEFAULT_MODEL_CONFIG, undefined, shape);
  const byId = new Map(players.map((p, i) => [p.id, projections[i]]));

  const gks = ['T1-GK', 'T2-GK', 'T3-GK', 'T4-GK', 'T5-GK', 'T6-GK'].map((id) => byId.get(id)!);
  const fwds = ['T1-attacker', 'T2-attacker', 'T3-attacker', 'T4-attacker', 'T5-attacker', 'T6-attacker', 'T7-attacker'].map(
    (id) => byId.get(id)!,
  );
  const gSorted = [...gks].sort((a, b) => b.tournamentScore - a.tournamentScore);
  const fSorted = [...fwds].sort((a, b) => b.tournamentScore - a.tournamentScore);

  // Wiring check: draftValue is exactly tournamentScore minus the score at
  // the position's own replacement rank.
  const gReplacement = gSorted[Math.min(1, gSorted.length) - 1].tournamentScore;
  const fReplacement = fSorted[Math.min(3, fSorted.length) - 1].tournamentScore;
  gSorted.forEach((proj) => assert.equal(proj.draftValue, round2(proj.tournamentScore - gReplacement)));
  fSorted.forEach((proj) => assert.equal(proj.draftValue, round2(proj.tournamentScore - fReplacement)));

  // The compression itself: only the single best keeper clears his own
  // shallow replacement level (draftValue >= 0); the top three forwards all
  // do, because their position stays open three picks deeper.
  const gPositive = gSorted.filter((p) => p.draftValue >= 0).length;
  const fPositive = fSorted.filter((p) => p.draftValue >= 0).length;
  assert.equal(gPositive, 1, 'only the #1 keeper is at or above his 1-deep replacement level');
  assert.equal(fPositive, 3, 'the top 3 forwards are at or above their 3-deep replacement level');
});

// ---------------------------------------------------------------------------
// Team × position-group minute caps (#83)
// ---------------------------------------------------------------------------

/** A two-season player whose recency-weighted minutes prior is exactly
 *  (0.55 + 0.30) × minutes = 0.85 × minutes. Two seasons keep the prior
 *  deterministic (no newcomer blend, no single-season shrink), and the
 *  congestion haircut is disabled by runCapped, so the prior is the final
 *  pre-cap level. */
function cappedPlayer(id: string, team: string, position: Position, minutes: number): SnapshotPlayer {
  return player({
    id,
    team,
    position,
    seasons: [
      season({ season: '2025/26', minutes, starts: Math.round(minutes / 90), goals: 2 }),
      season({ season: '2024/25', minutes, starts: Math.round(minutes / 90), goals: 2 }),
    ],
  });
}

/** Run with the congestion haircut disabled (exact minute assertions need the
 *  durability prior to be the final pre-cap level) and optionally an
 *  overridden defenderSlots. */
function runCapped(
  extra: SnapshotPlayer[],
  defenderSlots?: number,
): { projections: PlayerProjection[]; byId: Map<string, PlayerProjection> } {
  const cfg: ModelConfig = {
    ...DEFAULT_MODEL_CONFIG,
    minutes: {
      ...DEFAULT_MODEL_CONFIG.minutes,
      congestion: { topTeams: 0, factor: 0.95 },
      ...(defenderSlots == null ? {} : { defenderSlots }),
    },
  };
  const players = [...buildTeams(), ...extra];
  const { projections } = buildProjections(players, cfg);
  const byId = new Map(players.map((p, i) => [p.id, projections[i]]));
  return { projections, byId };
}

const CAP_GK = cappedPlayer('CAP-GK', 'CAP', 'G', 3420);
const PRIOR = 0.55 * 3000 + 0.3 * 3000; // 2550 — every cappedPlayer(…, 3000)

// CAP roster pieces used across the cap tests: 6 defenders at 3000 (sum
// 15,300 > 13,680, the 4-slot D cap) plus a lone MD and FW (combined
// 5,100 ≤ 20,520 — untouched controls on the same team).
function capRoster(): SnapshotPlayer[] {
  return [
    CAP_GK,
    ...['1', '2', '3', '4', '5', '6'].map((k) => cappedPlayer(`CAP-D${k}`, 'CAP', 'D', 3000)),
    cappedPlayer('CAP-MD1', 'CAP', 'MD', 3000),
    cappedPlayer('CAP-FW1', 'CAP', 'FW', 3000),
  ];
}

test('an over-cap D group scales every defender down proportionally; GK and other groups keep their priors', () => {
  const { byId } = runCapped(capRoster());
  const { byId: loose } = runCapped(capRoster(), 5); // D cap 17,100 — no scaling

  const dSum = 6 * PRIOR; // 15,300
  const factor = (4 * 3420) / dSum; // 13,680 / 15,300 = 0.8941…
  for (const k of ['1', '2', '3', '4', '5', '6']) {
    const proj = byId.get(`CAP-D${k}`)!;
    assert.equal(proj.minutes, Math.round(PRIOR * factor), `CAP-D${k} scaled to the D group cap share`);
    assert.ok(proj.minutes < loose.get(`CAP-D${k}`)!.minutes, `CAP-D${k} reduced below its prior`);
  }

  // Same team, other groups: the MD+FW group (5,100) is under its 20,520 cap
  // and the keeper job is the starts model's — neither is touched by the cap.
  assert.equal(byId.get('CAP-MD1')!.minutes, loose.get('CAP-MD1')!.minutes);
  assert.equal(byId.get('CAP-FW1')!.minutes, loose.get('CAP-FW1')!.minutes);
  assert.equal(byId.get('CAP-GK')!.minutes, loose.get('CAP-GK')!.minutes);
});

test('the cap changes the level, never the rate or the within-group ranking', () => {
  // Same roster plus one standout defender with a heavier prior — under a
  // proportional cap the standout keeps the top spot and every defender's
  // per-90 stays identical to an uncapped run (defenderSlots 5 ⇒ cap 17,100
  // ≥ 15,385, no scaling).
  const roster = [
    CAP_GK,
    cappedPlayer('CAP-D1', 'CAP', 'D', 3100),
    cappedPlayer('CAP-D2', 'CAP', 'D', 3000),
    cappedPlayer('CAP-D3', 'CAP', 'D', 3000),
    cappedPlayer('CAP-D4', 'CAP', 'D', 3000),
    cappedPlayer('CAP-D5', 'CAP', 'D', 3000),
    cappedPlayer('CAP-D6', 'CAP', 'D', 3000),
    cappedPlayer('CAP-MD1', 'CAP', 'MD', 3000),
    cappedPlayer('CAP-FW1', 'CAP', 'FW', 3000),
  ];
  const { byId } = runCapped(roster);
  const { byId: loose } = runCapped(roster, 5);

  const standoutPrior = 0.55 * 3100 + 0.3 * 3100; // 2635
  const dSum = standoutPrior + 5 * PRIOR; // 15,385
  const factor = (4 * 3420) / dSum;
  assert.equal(byId.get('CAP-D1')!.minutes, Math.round(standoutPrior * factor));
  for (const k of ['2', '3', '4', '5', '6']) {
    assert.equal(byId.get(`CAP-D${k}`)!.minutes, Math.round(PRIOR * factor));
  }

  // Level drops, rate is invariant, ranking survives.
  assert.ok(byId.get('CAP-D1')!.minutes < loose.get('CAP-D1')!.minutes, 'standout defender capped down');
  for (const k of ['1', '2', '3', '4', '5', '6']) {
    const id = `CAP-D${k}`;
    assert.ok(Math.abs(byId.get(id)!.per90 - loose.get(id)!.per90) <= 0.02, `${id} per90 invariant under the cap`);
  }
  assert.ok(byId.get('CAP-D1')!.minutes > byId.get('CAP-D2')!.minutes, 'proportional scaling preserves the ranking');

  // Control players on the same team are byte-identical under both caps.
  assert.equal(byId.get('CAP-GK')!.minutes, loose.get('CAP-GK')!.minutes);
  assert.equal(byId.get('CAP-MD1')!.minutes, loose.get('CAP-MD1')!.minutes);
  assert.equal(byId.get('CAP-FW1')!.minutes, loose.get('CAP-FW1')!.minutes);
});

test('an over-cap MD+FW group scales proportionally as one formation-flexible group', () => {
  // 5 MD + 4 FW at 2550 each: combined 22,950 > 20,520 (the 6 non-defender
  // outfield slots). The mid/forward split is formation-flexible, so both
  // positions share one cap and one factor.
  const roster = [
    CAP_GK,
    ...['1', '2', '3', '4'].map((k) => cappedPlayer(`CAP-D${k}`, 'CAP', 'D', 3000)),
    ...['1', '2', '3', '4', '5'].map((k) => cappedPlayer(`CAP-MD${k}`, 'CAP', 'MD', 3000)),
    ...['1', '2', '3', '4'].map((k) => cappedPlayer(`CAP-FW${k}`, 'CAP', 'FW', 3000)),
  ];
  const { byId } = runCapped(roster);

  const mdfwSum = 9 * PRIOR; // 22,950
  const factor = (6 * 3420) / mdfwSum; // 20,520 / 22,950 = 0.8941…
  for (const id of ['CAP-MD1', 'CAP-MD2', 'CAP-MD3', 'CAP-MD4', 'CAP-MD5', 'CAP-FW1', 'CAP-FW2', 'CAP-FW3', 'CAP-FW4']) {
    assert.equal(byId.get(id)!.minutes, Math.round(PRIOR * factor), `${id} scaled to the MD+FW cap share`);
  }
  // The D group (4 × 2550 = 10,200 ≤ 13,680) is untouched.
  for (const k of ['1', '2', '3', '4']) {
    assert.equal(byId.get(`CAP-D${k}`)!.minutes, Math.round(PRIOR));
  }
});

test('under-cap teams are never scaled up — the constraint is a ceiling, not a target', () => {
  // 4 D + 2 MD + 2 FW at 2550: every group sum sits under its cap, so the
  // priors pass through untouched (a thin snapshot must not invent minutes).
  const roster = [
    CAP_GK,
    ...['1', '2', '3', '4'].map((k) => cappedPlayer(`CAP-D${k}`, 'CAP', 'D', 3000)),
    cappedPlayer('CAP-MD1', 'CAP', 'MD', 3000),
    cappedPlayer('CAP-MD2', 'CAP', 'MD', 3000),
    cappedPlayer('CAP-FW1', 'CAP', 'FW', 3000),
    cappedPlayer('CAP-FW2', 'CAP', 'FW', 3000),
  ];
  const { byId } = runCapped(roster);
  for (const id of [
    'CAP-D1', 'CAP-D2', 'CAP-D3', 'CAP-D4',
    'CAP-MD1', 'CAP-MD2', 'CAP-FW1', 'CAP-FW2',
  ]) {
    assert.equal(byId.get(id)!.minutes, Math.round(PRIOR), `${id} untouched below the cap`);
  }
});

test('an over-cap team respects the full-squad ceiling 11 × 90 × 38', () => {
  // Worst case: over-cap D AND over-cap MD+FW simultaneously — the group
  // caps sum to 37,620, so the squad total must sit at or under it even with
  // a full club of starters.
  const roster = [
    CAP_GK,
    ...['1', '2', '3', '4', '5', '6'].map((k) => cappedPlayer(`CAP-D${k}`, 'CAP', 'D', 3000)),
    ...['1', '2', '3', '4', '5'].map((k) => cappedPlayer(`CAP-MD${k}`, 'CAP', 'MD', 3000)),
    ...['1', '2', '3', '4'].map((k) => cappedPlayer(`CAP-FW${k}`, 'CAP', 'FW', 3000)),
  ];
  const { byId } = runCapped(roster);
  const squadTotal = roster.reduce((sum, p) => sum + byId.get(p.id)!.minutes, 0);
  assert.ok(squadTotal <= 11 * 3420, `squad total ${squadTotal} ≤ 37,620`);
});
