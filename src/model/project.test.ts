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
import { DEFAULT_MODEL_CONFIG, DEFAULT_REPLACEMENT, type ReplacementConfig } from './config.js';
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
