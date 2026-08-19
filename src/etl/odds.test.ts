import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOddsSlate } from './odds.js';
import type { SnapshotFixture, SnapshotPlayer } from './types.js';

const fixture: SnapshotFixture = { id: 3, event: 1, home: 'EVE', away: 'CRY', homeDifficulty: 3, awayDifficulty: 3, kickoff: '2026-08-22T14:00:00Z' };
const players: SnapshotPlayer[] = [
  { id: '1', name: 'Salah', fullName: 'Mohamed Salah', position: 'FW', team: 'EVE', price: 10, status: 'a', news: '', seasons: [] },
  { id: '2', name: 'Other', fullName: 'Other Player', position: 'MD', team: 'CRY', price: 5, status: 'a', news: '', seasons: [] },
];
const bulk = [{ id: 'event-1', commence_time: fixture.kickoff, home_team: 'Everton', away_team: 'Crystal Palace', bookmakers: [{ key: 'draftkings', title: 'DraftKings', markets: [
  { key: 'h2h', outcomes: [{ name: 'Everton', price: 2.1 }, { name: 'Draw', price: 3.4 }, { name: 'Crystal Palace', price: 3.6 }] },
  { key: 'totals', outcomes: [{ name: 'Over', point: 2.5, price: 1.9 }, { name: 'Under', point: 2.5, price: 1.95 }] },
] }] }];

test('buildOddsSlate stores raw team and eligible-player quotes under FPL ids', () => {
  const details = new Map([['event-1', { ...bulk[0], bookmakers: [{ key: 'fanduel', title: 'FanDuel', markets: [
    { key: 'player_goal_scorer_anytime', outcomes: [{ name: 'Mohamed Salah', price: 2.5 }, { name: 'Unknown Player', price: 4 }] },
    { key: 'player_assists', outcomes: [{ name: 'Over', description: 'Mohamed Salah', point: 0.5, price: 2.2 }, { name: 'Under', description: 'Mohamed Salah', point: 0.5, price: 1.6 }] },
  ] }] }]]);
  const result = buildOddsSlate('daily', '2026-08-22', [fixture], players, bulk, details, '2026-08-20T00:00:00Z');
  assert.equal(result.fixtures.length, 1);
  assert.deepEqual(result.fixtures[0].matchWinner.map((quote) => quote.selection), ['home', 'draw', 'away']);
  assert.deepEqual(result.fixtures[0].totalGoals, [{ bookmaker: 'draftkings', side: 'over', point: 2.5, price: 1.9 }, { bookmaker: 'draftkings', side: 'under', point: 2.5, price: 1.95 }]);
  assert.deepEqual(result.fixtures[0].playerProps, [{ playerId: '1', anytimeGoalscorer: [{ bookmaker: 'fanduel', price: 2.5 }], assists: [{ bookmaker: 'fanduel', side: 'over', point: 0.5, price: 2.2 }, { bookmaker: 'fanduel', side: 'under', point: 0.5, price: 1.6 }] }]);
});

test('buildOddsSlate omits unpriced fixtures and does not turn missing player props into a failure', () => {
  const result = buildOddsSlate('daily', '2026-08-22', [fixture], players, [], new Map(), '2026-08-20T00:00:00Z');
  assert.deepEqual(result.fixtures, []);
});
