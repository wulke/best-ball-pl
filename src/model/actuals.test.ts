/**
 * In-season actuals blending (#43):
 * 1. Aggregation — snapshot actuals + played fixtures → season-to-date
 *    per-player / per-team aggregates (null when nothing is played).
 * 2. Structural parity — no actuals ⇒ bit-identical prior path (the
 *    committed pre-season snapshot must re-project unchanged).
 * 3. Blend behavior — minutes proration, newcomer handoff, GK starts
 *    conservation, team-context pickup (promoted teams flip `observed`),
 *    and the audit `actualsBlend` fields.
 *
 * Synthetic league, hand-controlled numbers — same pattern as project.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateSeasonActuals } from './actuals.js';
import { buildProjections } from './project.js';
import { DEFAULT_MODEL_CONFIG, DEFAULT_REPLACEMENT } from './config.js';
import { FALSE_NINE, modelConfigFor, resolveContest } from '../contest/profiles.js';
import type {
  GwPlayerActual,
  PlayerStatus,
  Position,
  SeasonStatLine,
  Snapshot,
  SnapshotActuals,
  SnapshotFixture,
  SnapshotPlayer,
} from '../etl/types.js';

const START_THRESHOLD = DEFAULT_MODEL_CONFIG.actuals.startMinutesThreshold;

// ---------------------------------------------------------------------------
// Synthetic helpers (pattern shared with project.test.ts)
// ---------------------------------------------------------------------------

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

/** A row: player featured with these minutes (a full-90 start by default). */
function row(id: string, overrides: Partial<GwPlayerActual> = {}): GwPlayerActual {
  return {
    id,
    minutes: 90,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 0,
    saves: 0,
    penaltiesSaved: 0,
    xg: null,
    xa: null,
    fplPoints: 2,
    ...overrides,
  };
}

function fixture(id: number, event: number, home: string, away: string, homeScore: number, awayScore: number): SnapshotFixture {
  return {
    id,
    event,
    home,
    away,
    homeDifficulty: 3,
    awayDifficulty: 3,
    kickoff: `2026-08-${10 + event}T15:00:00Z`,
    homeScore,
    awayScore,
  };
}

/**
 * Eight clubs. T1–T6: established keepers (observed team contexts, declining
 * win rate — T7/T8 stay out of the top-6 congestion set). T7: promoted — no
 * keeper history (league-mean fallback), hosts the minutes-blend FW and the
 * newcomer. T8: nothing happening (control — no fixtures, no rows).
 */
function buildLeague(): SnapshotPlayer[] {
  const players: SnapshotPlayer[] = [];
  const keeperSpec: Record<string, { starts: [number, number]; minutes: [number, number]; cs: number; gc: number }> = {
    T1: { starts: [30, 26], minutes: [2700, 2340], cs: 14, gc: 36 },
    T2: { starts: [30, 26], minutes: [2700, 2340], cs: 12, gc: 40 },
    T3: { starts: [30, 26], minutes: [2700, 2340], cs: 11, gc: 44 },
    T4: { starts: [30, 26], minutes: [2700, 2340], cs: 9, gc: 50 },
    T5: { starts: [30, 26], minutes: [2700, 2340], cs: 8, gc: 54 },
    T6: { starts: [8, 26], minutes: [720, 2340], cs: 4, gc: 62 },
  };
  for (const [team, spec] of Object.entries(keeperSpec)) {
    players.push(
      player({
        id: `${team}-GK`,
        team,
        position: 'G',
        seasons: [
          season({ season: '2025/26', minutes: spec.minutes[0], starts: spec.starts[0], cleanSheets: spec.cs, goalsConceded: spec.gc, saves: 90 }),
          season({ season: '2024/25', minutes: spec.minutes[1], starts: spec.starts[1], cleanSheets: 10, goalsConceded: 40, saves: 80 }),
        ],
      }),
    );
    // A filler forward so every club fields a side (history-bearing, no rows).
    players.push(
      player({
        id: `${team}-FW`,
        team,
        position: 'FW',
        seasons: [
          season({ season: '2025/26', minutes: 1600, starts: 17, goals: 6 }),
          season({ season: '2024/25', minutes: 1400, starts: 15, goals: 5 }),
        ],
      }),
    );
  }
  // Promoted club: no keeper history at all → league-mean team context.
  players.push(player({ id: 'T7-GK', team: 'T7', position: 'G' }));
  // Minutes-blend forward: 2-season established prior on a non-congested club.
  players.push(
    player({
      id: 'T7-FW-BLEND',
      team: 'T7',
      position: 'FW',
      seasons: [
        season({ season: '2025/26', minutes: 2400, starts: 26, goals: 10 }),
        season({ season: '2024/25', minutes: 2000, starts: 22, goals: 8 }),
      ],
    }),
  );
  // Newcomer: no FPL history — the price prior owns his minutes until
  // actuals hand over.
  players.push(player({ id: 'T7-FW-NEW', team: 'T7', position: 'FW', price: 5.5 }));
  // Control club: established squad, zero matches played, zero rows.
  players.push(
    player({
      id: 'T8-GK',
      team: 'T8',
      position: 'G',
      seasons: [
        season({ season: '2025/26', minutes: 2700, starts: 30, cleanSheets: 12, goalsConceded: 40, saves: 85 }),
        season({ season: '2024/25', minutes: 2340, starts: 26, cleanSheets: 10, goalsConceded: 42, saves: 75 }),
      ],
    }),
  );
  players.push(
    player({
      id: 'T8-FW',
      team: 'T8',
      position: 'FW',
      seasons: [
        season({ season: '2025/26', minutes: 1500, starts: 16, goals: 5 }),
        season({ season: '2024/25', minutes: 1300, starts: 14, goals: 4 }),
      ],
    }),
  );
  return players;
}

/** Six finished rounds: T1 (strong home form) and T7 (3 clean sheets). */
function buildFixtures(): SnapshotFixture[] {
  const out: SnapshotFixture[] = [];
  const t1Scores: Array<[number, number]> = [[1, 0], [1, 0], [0, 0], [2, 1], [0, 1], [1, 0]];
  const t7Scores: Array<[number, number]> = [[0, 0], [1, 0], [0, 0], [0, 1], [0, 2], [1, 2]];
  for (let gw = 1; gw <= 6; gw += 1) {
    const [h1, a1] = t1Scores[gw - 1];
    const [h7, a7] = t7Scores[gw - 1];
    out.push(fixture(gw * 10 + 1, gw, 'T1', 'T2', h1, a1));
    out.push(fixture(gw * 10 + 2, gw, 'T7', 'T3', h7, a7));
  }
  return out;
}

/** GW rows for the players under test; everyone else simply didn't feature. */
function buildActuals(): SnapshotActuals {
  const gameweeks = [];
  for (let gw = 1; gw <= 6; gw += 1) {
    gameweeks.push({
      event: gw,
      players: [
        row('T1-GK'), // started all six
        row('T7-FW-BLEND'), // 90 every match
        // Newcomer: three appearances (GW1–3), then injured/unused.
        ...(gw <= 3
          ? [row('T7-FW-NEW', { goals: 1, xg: 0.8, minutes: 90 })]
          : []),
      ],
    });
  }
  return { gameweeks };
}

function aggregate(players = buildLeague(), fixtures = buildFixtures(), actuals = buildActuals()) {
  return aggregateSeasonActuals(players, fixtures, actuals, START_THRESHOLD);
}

// ---------------------------------------------------------------------------
// 1. Aggregation
// ---------------------------------------------------------------------------

test('aggregation: nothing played → null (parity short-circuit)', () => {
  assert.equal(aggregateSeasonActuals(buildLeague(), [], { gameweeks: [] }, START_THRESHOLD), null);
});

test('aggregation: team results from fixture scores', () => {
  const agg = aggregate()!;
  const t1 = agg.teams.get('T1')!;
  // 1-0 W, 1-0 W, 0-0 D, 2-1 W, 0-1 L, 1-0 W
  assert.equal(t1.played, 6);
  assert.equal(t1.wins, 4);
  assert.equal(t1.cleanSheets, 4);
  assert.equal(t1.goalsFor, 5);
  assert.equal(t1.goalsAgainst, 2);
  const t2 = agg.teams.get('T2')!; // away side of the same matches
  assert.equal(t2.played, 6);
  assert.equal(t2.cleanSheets, 2); // 0-0 and 0-1 — T1 failed to score twice
  assert.equal(t2.wins, 1);
});

test('aggregation: player totals, inferred starts, xG/xA sums, non-pool rows skipped', () => {
  const agg = aggregate()!;
  const blendFw = agg.players.get('T7-FW-BLEND')!;
  assert.equal(blendFw.featured, 6);
  assert.equal(blendFw.minutes, 540);
  assert.equal(blendFw.starts, 6); // 90 ≥ 60 threshold
  const newcomer = agg.players.get('T7-FW-NEW')!;
  assert.equal(newcomer.featured, 3);
  assert.equal(newcomer.goals, 3);
  assert.ok(Math.abs(newcomer.xg! - 2.4) < 1e-9); // 3 × 0.8, summed over non-null rows
  const gk = agg.players.get('T1-GK')!;
  assert.equal(gk.starts, 6);

  // Start inference honors the threshold: 45-minute cameos are not starts.
  const cameo = aggregate(buildLeague(), buildFixtures(), {
    gameweeks: [1, 2].map((event) => ({
      event,
      players: [row('T7-FW-BLEND', { minutes: 45 })],
    })),
  })!;
  assert.equal(cameo.players.get('T7-FW-BLEND')!.starts, 0);

  // Rows for players outside the pool (transferred out) carry no team data
  // and no pool join — with nothing else played, the aggregate is null.
  assert.equal(
    aggregateSeasonActuals(
      buildLeague(),
      [],
      { gameweeks: [{ event: 1, players: [row('GONE-PLAYER')] }] },
      START_THRESHOLD,
    ),
    null,
  );
});

// ---------------------------------------------------------------------------
// 2. Structural parity
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SNAPSHOT_PATH = path.join(repoRoot, 'data/snapshot.json');

test('parity: pre-season aggregate is null, so the committed snapshot re-projects unchanged', () => {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
  const aggregated = aggregateSeasonActuals(
    snapshot.players,
    snapshot.fixtures,
    snapshot.actuals,
    START_THRESHOLD,
  );
  assert.equal(aggregated, null); // GW1 hasn't completed at commit time

  const contest = resolveContest(FALSE_NINE, snapshot.fixtures);
  const { projections } = buildProjections(
    snapshot.players,
    modelConfigFor(FALSE_NINE),
    contest,
    DEFAULT_REPLACEMENT,
    undefined,
    aggregated ?? undefined,
  );
  // Bit-for-bit against the committed flagship numbers (same guard style as
  // window.test.ts) — and no actualsBlend field pre-season (byte parity).
  snapshot.players.forEach((p, i) => {
    assert.deepEqual(projections[i], p.projection, `${p.name} projection unchanged`);
    assert.equal('actualsBlend' in projections[i], false);
  });
});

// ---------------------------------------------------------------------------
// 3. Blend behavior
// ---------------------------------------------------------------------------

test('minutes: observed per-match rate prorated and blended against the prior', () => {
  const players = buildLeague();
  const prior = buildProjections(players, DEFAULT_MODEL_CONFIG, undefined, DEFAULT_REPLACEMENT).projections;
  const blended = buildProjections(
    players,
    DEFAULT_MODEL_CONFIG,
    undefined,
    DEFAULT_REPLACEMENT,
    undefined,
    aggregate()!,
  ).projections;

  const i = players.findIndex((p) => p.id === 'T7-FW-BLEND');
  // Prior: 0.55×2400 + 0.30×2000 = 1920 (T7 not congested, status a).
  assert.equal(prior[i].minutes, 1920);
  // Observed: 540 min / 6 played = 90/match → 3420 prorated; w = 6/(6+6) = .5
  // → 0.5×3420 + 0.5×1920 = 2670 exactly.
  assert.equal(blended[i].minutes, 2670);
  assert.deepEqual(blended[i].actualsBlend, { played: 6, minutes: 540, weight: 0.5 });
});

test('newcomer: actuals hand off from the price prior gracefully', () => {
  const players = buildLeague();
  const prior = buildProjections(players, DEFAULT_MODEL_CONFIG, undefined, DEFAULT_REPLACEMENT).projections;
  const blended = buildProjections(
    players,
    DEFAULT_MODEL_CONFIG,
    undefined,
    DEFAULT_REPLACEMENT,
    undefined,
    aggregate()!,
  ).projections;
  const i = players.findIndex((p) => p.id === 'T7-FW-NEW');

  // Pre-season: the price fit owns him — 8 FW samples with weighted minutes
  // ≥ 900, all priced 5.5, so the fit collapses to the sample mean × the
  // 0.85 newcomer discount: 1366.875 × 0.85 = 1161.84 → 1162 minutes.
  assert.equal(prior[i].newcomerPrior.applied, true);
  assert.equal(prior[i].minutes, 1162);
  // Three featured GWs at 90' (270 min), team played 6 → w = 6/(6+6) = .5:
  // 0.5 × (45/match × 38 = 1710) + 0.5 × 1161.84 = 1435.92 → 1436 — halfway
  // to reality after three starts. A did-not-feature stretch counts as 0s.
  assert.equal(blended[i].minutes, 1436);
  assert.equal(blended[i].actualsBlend!.minutes, 270);

  // Rates: observed 1 goal/90 (3 goals, 3×90 min, xG 0.8/goal → x-weighted
  // 0.86/90) blend into the position-mean prior by 270/(270+900) — strictly
  // between prior and observed, i.e. the handoff is graded, not a cliff.
  assert.ok(blended[i].statline.goals > prior[i].statline.goals, 'observed scoring lifts the newcomer');
  assert.ok(blended[i].statline.goals < prior[i].statline.goals + 38 * 0.86, '…but stays shrunk toward the prior');
});

test('GK starts: observed starts move the job-share, club job stays conserved', () => {
  const players = buildLeague();
  const prior = buildProjections(players, DEFAULT_MODEL_CONFIG, undefined, DEFAULT_REPLACEMENT).projections;
  const blended = buildProjections(
    players,
    DEFAULT_MODEL_CONFIG,
    undefined,
    DEFAULT_REPLACEMENT,
    undefined,
    aggregate()!,
  ).projections;
  const gk = players.findIndex((p) => p.id === 'T1-GK');
  const gkStarts = blended[gk].minutes / 90;

  // Prior (claimant with 24.3 weighted starts): 24.3 of the club's 38.
  assert.ok(Math.abs(prior[gk].minutes / 90 - 24.3) < 1e-9);
  // Six observed starts in six matches pull the share up (w = 6/11), and the
  // club's 38-start job is conserved exactly after re-normalization.
  assert.ok(gkStarts > 24.3, `starter's share rose (${gkStarts})`);
  const clubMinutes = players
    .map((p, i) => (p.team === 'T1' && p.position === 'G' ? blended[i].minutes : 0))
    .reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(clubMinutes / 90 - 38) < 1e-9, `Σ GK starts = 38 (${clubMinutes / 90})`);
});

test('team context: promoted club picks up its own results and flips observed', () => {
  const players = buildLeague();
  const prior = buildProjections(players, DEFAULT_MODEL_CONFIG, undefined, DEFAULT_REPLACEMENT).teamContexts;
  const blended = buildProjections(
    players,
    DEFAULT_MODEL_CONFIG,
    undefined,
    DEFAULT_REPLACEMENT,
    undefined,
    aggregate()!,
  ).teamContexts;

  assert.equal(prior.get('T7')!.observed, false);
  const after = blended.get('T7')!;
  assert.equal(after.observed, true);
  // 3 CS in 6 played, w = 0.5: csRate = 0.5×0.5 + 0.5×prior.
  assert.ok(Math.abs(after.cleanSheetRate - (0.25 + 0.5 * prior.get('T7')!.cleanSheetRate)) < 1e-12);
  // The club with no matches played stays exactly on its prior.
  assert.deepEqual(blended.get('T8'), prior.get('T8'));
});

test('audit field: absent pre-season, present (with zeros) for never-featured players in-season', () => {
  const players = buildLeague();
  const blended = buildProjections(
    players,
    DEFAULT_MODEL_CONFIG,
    undefined,
    DEFAULT_REPLACEMENT,
    undefined,
    aggregate()!,
  ).projections;
  const control = blended[players.findIndex((p) => p.id === 'T8-FW')];
  assert.deepEqual(control.actualsBlend, { played: 0, minutes: 0, weight: 0 });
  assert.equal(control.minutes, buildProjections(players, DEFAULT_MODEL_CONFIG).projections[players.findIndex((p) => p.id === 'T8-FW')].minutes);
});
