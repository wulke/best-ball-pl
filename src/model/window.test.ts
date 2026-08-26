/**
 * Window-parametric model coverage (#42):
 * 1. Season parity — the committed snapshot's False Nine projections must be
 *    reproduced bit-for-bit by the window-parametric pipeline (factors average
 *    exactly 1 over a club's calendar; the flagship's numbers cannot drift).
 * 2. Fixture factors — every factor family behaves directionally and in the
 *    documented ratio between an easy and a hard fixture run.
 * 3. Slate windows — the Free Kick GW1 Saturday slice: pool-scoped ranks,
 *    per-fixture minutes/GK starts distribution, sane single-fixture output.
 * 4. Window composition — a season window equals its fixture windows summed.
 * 5. Windowed per-90 — the per90 denominator regression (#46 review): points
 *    are a window sum, so per90 must divide by windowed minutes, not the
 *    season-scale risk-flag denominator the live UI would otherwise render.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProjections } from './project.js';
import { aggregateSeasonActuals } from './actuals.js';
import { DEFAULT_MODEL_CONFIG } from './config.js';
import {
  FALSE_NINE,
  FREE_KICK_GW1_SAT,
  modelConfigFor,
  resolveContest,
} from '../contest/profiles.js';
import type { PlayerStatus, Position, SeasonStatLine, Snapshot, SnapshotPlayer } from '../etl/types.js';
import type { ProjectionWindow, WindowFixture } from './types.js';
import type { LineupSlate, StartOverrideMap } from './lineups.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SNAPSHOT_PATH = path.join(repoRoot, 'data/snapshot.json');

function loadSnapshot(): Snapshot {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
}

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

/** Club A hosts B at difficulty 1 (B sees 5); B hosts A at difficulty 1 for
 *  itself (A sees 5). Each club's calendar mean difficulty is exactly 3. */
function abCalendar(): WindowFixture[] {
  const fixtures: WindowFixture[] = [];
  for (let i = 0; i < 19; i += 1) {
    fixtures.push({ home: 'A', away: 'B', homeDifficulty: 1, awayDifficulty: 5 });
    fixtures.push({ home: 'B', away: 'A', homeDifficulty: 1, awayDifficulty: 5 });
  }
  return fixtures;
}

function abPlayers(): SnapshotPlayer[] {
  return [
    player({
      id: 'A-GK',
      team: 'A',
      position: 'G',
      seasons: [
        season({
          season: '2025/26',
          minutes: 3420,
          starts: 38,
          cleanSheets: 10,
          goalsConceded: 40,
          saves: 110,
        }),
      ],
    }),
    player({
      id: 'A-FW',
      team: 'A',
      position: 'FW',
      seasons: [season({ season: '2025/26', minutes: 3000, goals: 24, starts: 33 })],
    }),
    player({
      id: 'B-GK',
      team: 'B',
      position: 'G',
      seasons: [
        season({
          season: '2025/26',
          minutes: 3420,
          starts: 38,
          cleanSheets: 14,
          goalsConceded: 30,
          saves: 90,
        }),
      ],
    }),
  ];
}

/** A window over A's easy home run, its hard away run, or the whole season. */
function abWindow(pick: 'home' | 'away' | 'season'): ProjectionWindow {
  const calendar = abCalendar();
  const fixtures =
    pick === 'season'
      ? calendar
      : calendar.filter((f) => (pick === 'home' ? f.home === 'A' : f.away === 'A'));
  return { calendar, fixtures, clubs: null };
}

function projectAb(window: ProjectionWindow) {
  const players = abPlayers();
  const { projections } = buildProjections(players, DEFAULT_MODEL_CONFIG, window);
  const byId = new Map(players.map((p, i) => [p.id, projections[i]] as const));
  return { byId, projections };
}

// ---------------------------------------------------------------------------
// 1. Season parity — the flagship guard
// ---------------------------------------------------------------------------

test('per90 divides window points by windowed minutes (#46 review regression)', () => {
  // The bug: projection.per90 divided the window p50 by the season-scale
  // minutes — on a 1/38 window that deflates per90 ~38×, and the live UI
  // renders this field directly (PlayerTable). Season byte-parity is guarded
  // separately by test 1 (the season ratio is exactly 1, so the windowed
  // denominator is float-identical to the committed one).
  const calendar = abCalendar();
  const window: ProjectionWindow = { calendar, fixtures: [calendar[0]], clubs: null };
  const { byId } = projectAb(window);
  for (const id of ['A-GK', 'A-FW', 'B-GK']) {
    const proj = byId.get(id)!;
    const expected = (proj.points.p50 / proj.statline.minutes) * 90;
    assert.ok(
      Math.abs(proj.per90 - expected) < 0.1,
      `${id}: per90 ${proj.per90} ≈ p50 ${proj.points.p50} / windowed minutes ${proj.statline.minutes} × 90`,
    );
    // The pre-fix value divides by a thousands-of-minutes season denominator
    // — assert we are nowhere near that deflated scale.
    assert.ok(proj.per90 > 1, `${id}: per90 must be on a per-90 scale, not season-deflated`);
  }
});

test('slate minutes are start-aware: override > lineup > model, with bench cameo floor', () => {
  const calendar = abCalendar();
  const window: ProjectionWindow = { calendar, fixtures: [calendar[0]], clubs: null };
  const lineups: LineupSlate = {
    schemaVersion: 1, profileId: 'daily', slateDate: '2026-08-22', fetchedAt: '2026-08-21T12:00:00Z',
    fixtureCoverage: [{ fixtureId: 1, covered: true }],
    players: [
      { fixtureId: 1, playerId: 'A-FW', status: 'starter' },
      { fixtureId: 1, playerId: 'A-GK', status: 'bench' },
    ],
  };
  // The synthetic window fixture does not normally carry an id; lineup assets
  // deliberately join by id, so make the fixture identity explicit here.
  window.fixtures[0].id = 1;
  const overrides: StartOverrideMap = { 'A-FW': { 1: 'bench' } };
  const players = abPlayers();
  const plain = buildProjections(players, DEFAULT_MODEL_CONFIG, window);
  const aware = buildProjections(players, DEFAULT_MODEL_CONFIG, window, undefined, undefined, undefined, undefined, lineups, overrides);
  const plainById = new Map(players.map((p, i) => [p.id, plain.projections[i]]));
  const byId = new Map(players.map((p, i) => [p.id, aware.projections[i]]));

  const fw = byId.get('A-FW')!;
  const gk = byId.get('A-GK')!;
  const untouched = byId.get('B-GK')!;
  assert.equal(fw.startAwareMinutes?.source, 'override');
  assert.equal(fw.startAwareMinutes?.fixtures[0].status, 'bench');
  assert.ok(fw.statline.minutes < plainById.get('A-FW')!.statline.minutes, 'override bench call lowers minutes');
  assert.equal(gk.startAwareMinutes?.source, 'lineup');
  assert.equal(gk.statline.minutes, DEFAULT_MODEL_CONFIG.minutes.cameoFloorMinutes, 'known bench gets the cameo floor, not zero');
  assert.equal(untouched.startAwareMinutes?.source, 'model');
  assert.equal(untouched.startAwareMinutes?.factor, 1);
  assert.equal(untouched.statline.minutes, plainById.get('B-GK')!.statline.minutes, 'unknown remains model-default');
  assert.ok(fw.points.p10 < fw.points.p50 && fw.points.p50 < fw.points.p90, 'scenario minutes remain widened around the called base');
});

test('season window reproduces the committed snapshot projections bit-for-bit', () => {
  const snapshot = loadSnapshot();
  const contest = resolveContest(FALSE_NINE, snapshot.fixtures);
  const actuals = aggregateSeasonActuals(
    snapshot.players,
    snapshot.fixtures,
    snapshot.actuals,
    modelConfigFor(FALSE_NINE).actuals.startMinutesThreshold,
  );
  const { projections } = buildProjections(
    snapshot.players,
    modelConfigFor(FALSE_NINE),
    contest,
    undefined,
    undefined,
    actuals ?? undefined,
    snapshot.strength,
  );

  let compared = 0;
  snapshot.players.forEach((p, i) => {
    assert.ok(p.projection, `${p.name} carries a committed projection`);
    assert.deepStrictEqual(
      projections[i],
      p.projection,
      `${p.name}: window-parametric season projection must equal the committed projection`,
    );
    compared += 1;
  });
  assert.ok(compared > 500, `expected the full pool, compared ${compared}`);
});

test('committed projections respect the team × position-group minute caps (#83)', () => {
  // The physical constraint: 11 players on the pitch × 90 min × 38 games =
  // 37,620 minutes per club. The committed snapshot's per-player expectations
  // must jointly respect it — D ≤ 4 slots, MD+FW ≤ 6 slots (formation-
  // flexible split), GK already exact via the starts model — and the group
  // caps sum to the full-squad ceiling.
  const snapshot = loadSnapshot();
  const sums = new Map<string, { g: number; d: number; mdfw: number }>();
  snapshot.players.forEach((p) => {
    assert.ok(p.projection, `${p.name} carries a committed projection`);
    const row = sums.get(p.team) ?? { g: 0, d: 0, mdfw: 0 };
    const m = p.projection!.minutes;
    if (p.position === 'G') row.g += m;
    else if (p.position === 'D') row.d += m;
    else row.mdfw += m;
    sums.set(p.team, row);
  });
  const dCap = 4 * 3420;
  const mdfwCap = 6 * 3420;
  // Per-player Math.round on the reported minutes can drift a team a couple
  // of minutes over the exact unrounded cap — slack of 5 per group / 10 total
  // absorbs that while still catching any real constraint violation.
  const SLACK = { group: 5, total: 10 };
  for (const [team, row] of sums) {
    assert.ok(row.g <= 3420 + SLACK.group, `${team}: GK minutes ${row.g} ≤ one 38-game starting job`);
    assert.ok(row.d <= dCap + SLACK.group, `${team}: D minutes ${row.d} ≤ ${dCap} (4 slots)`);
    assert.ok(row.mdfw <= mdfwCap + SLACK.group, `${team}: MD+FW minutes ${row.mdfw} ≤ ${mdfwCap} (6 slots)`);
    const total = row.g + row.d + row.mdfw;
    assert.ok(total <= 11 * 3420 + SLACK.total, `${team}: squad total ${total} ≤ 37,620`);
  }
});

test('a difficulty-varied calendar sums to the same season output as a flat one (factors average 1)', () => {
  // Same players under the A/B alternating-extremes calendar (mean 3) vs a
  // neutral all-3 calendar: every factor is exactly 1 against a mean of 3, so
  // the season aggregates agree up to round2 noise on the summed terms.
  const varied = projectAb(abWindow('season')).projections;
  const flatCalendar: WindowFixture[] = abCalendar().map((f) => ({
    ...f,
    homeDifficulty: 3,
    awayDifficulty: 3,
  }));
  const flat = projectAb({ calendar: flatCalendar, fixtures: flatCalendar, clubs: null }).projections;

  varied.forEach((v, i) => {
    const f = flat[i];
    assert.ok(Math.abs(v.points.p50 - f.points.p50) <= 0.3, `p50 drift: ${v.points.p50} vs ${f.points.p50}`);
    for (const term of ['goals', 'assists', 'cleanSheets', 'goalsConceded', 'saves', 'gkWins'] as const) {
      assert.ok(
        Math.abs(v.statline[term] - f.statline[term]) <= 0.05,
        `statline.${term} drift: ${v.statline[term]} vs ${f.statline[term]}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Fixture factors — direction and ratio between easy and hard runs
// ---------------------------------------------------------------------------

test('every factor family moves in its documented direction between easy and hard fixture runs', () => {
  const cfg = DEFAULT_MODEL_CONFIG.fixture;
  const home = projectAb(abWindow('home')).byId; // A at difficulty 1 → factor 1 + 2×slope
  const away = projectAb(abWindow('away')).byId; // A at difficulty 5 → factor 1 − 2×slope

  // Attack: more goals in the easy run; exact family ratio on the totals.
  const fwHome = home.get('A-FW')!.statline;
  const fwAway = away.get('A-FW')!.statline;
  assert.ok(fwHome.goals > fwAway.goals, 'attack output rises against easier opponents');
  const attackRatio = (1 + 2 * cfg.attackSlope) / (1 - 2 * cfg.attackSlope);
  assert.ok(
    Math.abs(fwHome.goals / fwAway.goals - attackRatio) < 0.02,
    `attack ratio ${fwHome.goals / fwAway.goals} ≈ ${attackRatio}`,
  );

  // Defense: fewer clean sheets, more conceded, fewer wins when running hard.
  const gkHome = home.get('A-GK')!.statline;
  const gkAway = away.get('A-GK')!.statline;
  assert.ok(gkHome.cleanSheets > gkAway.cleanSheets, 'clean sheets fall against harder opponents');
  assert.ok(gkAway.goalsConceded > gkHome.goalsConceded, 'goals conceded rise against harder opponents');
  assert.ok(gkHome.gkWins > gkAway.gkWins, 'keeper wins fall against harder opponents');
  // …but the keeper is busier: saves rise against harder opponents.
  assert.ok(gkAway.saves > gkHome.saves, 'saves rise against harder opponents (busier keeper)');

  const csRatio = (1 + 2 * cfg.cleanSheetSlope) / (1 - 2 * cfg.cleanSheetSlope);
  assert.ok(
    Math.abs(gkHome.cleanSheets / gkAway.cleanSheets - csRatio) < 0.02,
    `CS ratio ${gkHome.cleanSheets / gkAway.cleanSheets} ≈ ${csRatio}`,
  );
});

test('per-fixture minutes: outfield minutes and GK starts distribute as a 1/38 share of the season job', () => {
  const seasonProj = projectAb(abWindow('season')).byId;
  const single = abWindow('season');
  single.fixtures = [single.calendar[0]]; // one A home fixture (difficulty 1)
  const singleProj = projectAb(single).byId;

  const fwSeason = seasonProj.get('A-FW')!;
  const fwSingle = singleProj.get('A-FW')!;
  assert.ok(
    Math.abs(fwSingle.statline.minutes - fwSeason.statline.minutes / 38) <= 1,
    `outfield single-fixture minutes ${fwSingle.statline.minutes} ≈ season/38 (${fwSeason.statline.minutes / 38})`,
  );

  const gkSeason = seasonProj.get('A-GK')!;
  const gkSingle = singleProj.get('A-GK')!;
  // Single-season keepers shrink toward the no-history prior (0.85), so the
  // A keeper's season job is 33.7 expected starts — a single fixture is that
  // job's 1/38 share, not a guaranteed 90.
  assert.ok(
    gkSingle.statline.minutes >= 78 && gkSingle.statline.minutes <= 82,
    `GK single-fixture minutes ${gkSingle.statline.minutes} ≈ 80 (33.7-start season job / 38)`,
  );
  assert.ok(
    Math.abs(gkSingle.statline.minutes - gkSeason.statline.minutes / 38) <= 1,
    'GK starts distribute as a 1/38 share: single-fixture minutes ≈ season/38',
  );
});

// ---------------------------------------------------------------------------
// 3. Slate windows — the Free Kick GW1 Saturday slice
// ---------------------------------------------------------------------------

test('the GW1 Saturday slate window: 4 fixtures, 8 clubs, pool-scoped ranks, single-fixture output', () => {
  const snapshot = loadSnapshot();
  const contest = resolveContest(FREE_KICK_GW1_SAT, snapshot.fixtures);
  assert.equal(contest.fixtures.length, 4);
  assert.equal(contest.clubs?.length, 8);
  assert.ok(!contest.clubs?.includes('HUL'), 'pre-close HUL-MUN is not draftable');

  const { projections } = buildProjections(
    snapshot.players,
    modelConfigFor(FREE_KICK_GW1_SAT),
    contest,
  );

  const poolClubs = new Set(contest.clubs!);
  const ranks: number[] = [];
  snapshot.players.forEach((p, i) => {
    const proj = projections[i];
    if (poolClubs.has(p.team)) {
      assert.ok(proj.overallRank >= 1, `${p.name} ranked within the pool`);
      assert.ok(proj.statline.minutes <= 91, `${p.name}: single-fixture window ≤ 90 minutes`);
      assert.ok(
        proj.points.p50 >= 0 && proj.points.p50 < 30,
        // p50 can read exactly 0: a bench keeper with no residual starts — the
        // starts-claim model hands the club's 38 to the #1, the bench inherits 0.
        `${p.name}: sane single-fixture points (${proj.points.p50})`,
      );
      ranks.push(proj.overallRank);
    } else {
      assert.equal(proj.overallRank, 0, `${p.name} sits unranked outside the pool`);
      assert.equal(proj.tier, 9);
    }
  });
  assert.deepEqual([...ranks].sort((a, b) => a - b), Array.from({ length: ranks.length }, (_, i) => i + 1));
  assert.ok(ranks.length > 150, `a real share of the pool is slate-eligible (${ranks.length})`);
});

// ---------------------------------------------------------------------------
// 4. Window composition — a season is its fixture windows summed
// ---------------------------------------------------------------------------

test('a season window equals its single-fixture windows summed (within rounding)', () => {
  const seasonProj = projectAb(abWindow('season')).byId;
  const calendar = abCalendar();
  const acc = { goals: 0, assists: 0, cleanSheets: 0, saves: 0, gkWins: 0, minutes: 0 };
  for (const f of calendar.filter((x) => x.home === 'A' || x.away === 'A')) {
    const one = projectAb({ calendar, fixtures: [f], clubs: null }).byId.get('A-FW')!;
    acc.goals += one.statline.goals;
    acc.assists += one.statline.assists;
    acc.cleanSheets += one.statline.cleanSheets;
    acc.saves += one.statline.saves;
    acc.gkWins += one.statline.gkWins;
    acc.minutes += one.statline.minutes;
  }
  const whole = seasonProj.get('A-FW')!;
  assert.ok(Math.abs(acc.goals - whole.statline.goals) < 0.3, `goals: ${acc.goals} vs ${whole.statline.goals}`);
  assert.ok(Math.abs(acc.minutes - whole.statline.minutes) <= 2, `minutes: ${acc.minutes} vs ${whole.statline.minutes}`);
});
