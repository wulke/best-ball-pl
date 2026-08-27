import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleHistory, roleSignal } from './role.js';
import type { GwActuals } from '../etl/types.js';

function gameweek(event: number, minutesByPlayer: Record<string, number> = {}): GwActuals {
  return {
    event,
    players: Object.entries(minutesByPlayer).map(([id, minutes]) => ({
      id,
      minutes,
      goals: 0,
      assists: 0,
      cleanSheets: 0,
      goalsConceded: 0,
      saves: 0,
      penaltiesSaved: 0,
      xg: null,
      xa: null,
      fplPoints: 0,
    })),
  };
}

test('roleHistory: classifies the three most recent team gameweeks and skips a postponed one', () => {
  const history = roleHistory(
    'player-1',
    [
      gameweek(1, { 'player-1': 90 }),
      gameweek(2),
      gameweek(3, { 'player-1': 25 }),
      gameweek(4), // Player's team did not play this postponed gameweek.
      gameweek(5, { 'player-1': 75 }),
      gameweek(6, { 'player-1': 90 }),
    ],
    (gw) => gw.event !== 4,
  );

  assert.deepEqual(history, [
    { gw: 6, role: 'start', minutes: 90 },
    { gw: 5, role: 'start', minutes: 75 },
    { gw: 3, role: 'cameo', minutes: 25 },
  ]);
  assert.equal(history.length, 3);
  assert.deepEqual(roleSignal(history), {
    pStartRecent: 0.85,
    minutesPerAppearanceRecent: 76.5,
  });
});

test('roleSignal: renormalizes a partial two-GW window', () => {
  const history = roleHistory('player-1', [
    gameweek(1, { 'player-1': 30 }),
    gameweek(2, { 'player-1': 90 }),
  ]);

  assert.deepEqual(history, [
    { gw: 2, role: 'start', minutes: 90 },
    { gw: 1, role: 'cameo', minutes: 30 },
  ]);
  assert.deepEqual(roleSignal(history), {
    pStartRecent: 0.6 / 0.85,
    minutesPerAppearanceRecent: 61.5 / 0.85,
  });
});

test('roleSignal: gives its sole gameweek full weight', () => {
  const history = roleHistory('player-1', [gameweek(1, { 'player-1': 68 })]);

  assert.deepEqual(roleSignal(history), {
    pStartRecent: 1,
    minutesPerAppearanceRecent: 68,
  });
});

test('roleSignal: all cameos have no start probability but retain appearance minutes', () => {
  const history = roleHistory('player-1', [
    gameweek(1, { 'player-1': 10 }),
    gameweek(2, { 'player-1': 20 }),
    gameweek(3, { 'player-1': 50 }),
  ]);

  assert.deepEqual(roleSignal(history), {
    pStartRecent: 0,
    minutesPerAppearanceRecent: 36.5,
  });
});

test('roleSignal: unused-sub weeks lower start rate but not minutes per appearance', () => {
  const history = roleHistory('player-1', [
    gameweek(1, { 'player-1': 80 }),
    gameweek(2),
    gameweek(3, { 'player-1': 90 }),
  ]);

  assert.deepEqual(history, [
    { gw: 3, role: 'start', minutes: 90 },
    { gw: 2, role: 'dnp', minutes: 0 },
    { gw: 1, role: 'start', minutes: 80 },
  ]);
  assert.deepEqual(roleSignal(history), {
    pStartRecent: 0.75,
    minutesPerAppearanceRecent: (90 * 0.6 + 80 * 0.15) / 0.75,
  });
});

test('roleSignal: all-DNP-then-starter history reacts to the new start', () => {
  const history = roleHistory('player-1', [
    gameweek(1),
    gameweek(2),
    gameweek(3, { 'player-1': 75 }),
  ]);

  assert.deepEqual(roleSignal(history), {
    pStartRecent: 0.6,
    minutesPerAppearanceRecent: 75,
  });
});
