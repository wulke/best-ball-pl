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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProjections } from './project.js';
import { DEFAULT_MODEL_CONFIG } from './config.js';
import {
  FALSE_NINE,
  FREE_KICK_GW1_SAT,
  modelConfigFor,
  resolveContest,
} from '../contest/profiles.js';
import type { PlayerStatus, Position, SeasonStatLine, Snapshot, SnapshotPlayer } from '../etl/types.js';
import type { ProjectionWindow, WindowFixture } from './types.js';

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

test('season window reproduces the committed snapshot projections bit-for-bit', () => {
  const snapshot = loadSnapshot();
  const contest = resolveContest(FALSE_NINE, snapshot.fixtures);
  const { projections } = buildProjections(snapshot.players, modelConfigFor(FALSE_NINE), contest);

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
