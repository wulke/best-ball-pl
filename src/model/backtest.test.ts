import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actualPoints, rankCorrelation, snapshotBeforeGameweek, summarizeSamples } from './backtest.js';
import { FALSE_NINE, modelConfigFor } from '../contest/profiles.js';
import type { Snapshot } from '../etl/types.js';

const fixture = (id: number, event: number, kickoff: string, home: string, away: string, homeScore?: number, awayScore?: number) => ({
  id, event, kickoff, home, away, homeDifficulty: 3, awayDifficulty: 3, homeScore, awayScore,
});

const snapshot = {
  generated_at: '2026-09-21T00:00:00Z',
  asOf: { fetchedAt: '2026-09-21T00:00:00Z', actualsThrough: 2, nextKickoff: null },
  meta: { playersWithHistory: 0, positionCounts: { G: 1, D: 0, MD: 1, FW: 0 } },
  players: [
    { id: 'g', name: 'Keeper', fullName: 'Keeper', position: 'G', team: 'A', price: 5, status: 'a', news: '', seasons: [] },
    { id: 'm', name: 'Mid', fullName: 'Mid', position: 'MD', team: 'B', price: 6, status: 'a', news: '', seasons: [] },
  ],
  fixtures: [
    fixture(1, 1, '2026-08-10T15:00:00Z', 'A', 'B', 1, 0),
    fixture(2, 2, '2026-08-17T15:00:00Z', 'A', 'B', 0, 2),
  ],
  actuals: { gameweeks: [
    { event: 1, players: [{ id: 'g', minutes: 90, goals: 0, assists: 0, cleanSheets: 1, goalsConceded: 0, saves: 2, penaltiesSaved: 0, xg: null, xa: null, fplPoints: 8 }] },
    { event: 2, players: [{ id: 'm', minutes: 90, goals: 1, assists: 0, cleanSheets: 0, goalsConceded: 0, saves: 0, penaltiesSaved: 0, xg: null, xa: null, fplPoints: 10 }] },
  ] },
  strength: {
    source: 'fixture-goals', leagueAttackPerMatch: 1, through: '2026-08-17T15:00:00Z',
    clubs: { A: { n: 2, attack: 1, concede: 2 }, B: { n: 2, attack: 2, concede: 1 } },
    matches: {
      A: [{ date: '2026-08-10T15:00:00Z', home: true, attack: 1, concede: 0 }, { date: '2026-08-17T15:00:00Z', home: true, attack: 0, concede: 2 }],
      B: [{ date: '2026-08-10T15:00:00Z', home: false, attack: 0, concede: 1 }, { date: '2026-08-17T15:00:00Z', home: false, attack: 2, concede: 0 }],
    },
  },
} satisfies Snapshot;

test('walk-forward snapshot removes target GW actuals, scores, and strength rows', () => {
  const before = snapshotBeforeGameweek(snapshot, 2);
  assert.deepEqual(before.actuals.gameweeks.map((gw) => gw.event), [1]);
  assert.equal(before.fixtures[1].homeScore, undefined);
  assert.deepEqual(before.strength?.clubs.A, { n: 1, attack: 1, concede: 0 });
  assert.equal(before.strength?.leagueAttackPerMatch, 0.5);
});

test('actual score uses retained Underdog-compatible fields and infers a keeper win', () => {
  const points = actualPoints(snapshot.players[0], snapshot.actuals.gameweeks[0].players[0], snapshot.fixtures, modelConfigFor(FALSE_NINE).scoring);
  // clean sheet 5 + two saves 1 + keeper win 5.
  assert.equal(points, 11);
});

test('metric helpers use tie-aware rank correlation and complete calibration samples', () => {
  assert.equal(rankCorrelation([10, 20, 30], [1, 2, 3]), 1);
  assert.equal(rankCorrelation([10, 20, 30], [3, 2, 1]), -1);
  const summary = summarizeSamples([
    { position: 'MD', actual: 6, p10: 2, p50: 5, p90: 8, minutes: 90 },
    { position: 'MD', actual: 0, p10: 1, p50: 3, p90: 5, minutes: 0 },
  ]);
  assert.equal(summary.mae, 2);
  assert.equal(summary.coverage, 0.5);
  assert.deepEqual(summary.byMinuteBucket.map((row) => row.bucket), ['0', '90']);
});
