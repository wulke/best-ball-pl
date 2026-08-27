import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleHistory, roleSignal, blendRoleSignal } from './role.js';
import type { GwActuals } from '../etl/types.js';
import { DEFAULT_ROLE } from './config.js';

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

test('blendRoleSignal: 1 GW of a clear starter dominates a low preseason prior', () => {
  const seasonPrior = { pStart: 0.4, minutesPerAppearance: 60 };
  const signal = { pStartRecent: 1, minutesPerAppearanceRecent: 90 };

  const blended = blendRoleSignal(seasonPrior, signal, 1);

  const w = 1 / 1.1; // n=1, k = k0 (0.1)
  assert.equal(blended.pStart, w * 1 + (1 - w) * 0.4);
  assert.equal(blended.minutesPerAppearance, w * 90 + (1 - w) * 60);
  // Dominated, not the ~85-90%-preseason-weighted shape of today's startK blend.
  assert.ok(blended.pStart > 0.9, `expected pStart > 0.9, got ${blended.pStart}`);
});

test('blendRoleSignal: weight grows toward the signal as GWs accumulate without ever fully discarding the prior', () => {
  const seasonPrior = { pStart: 0.3, minutesPerAppearance: 50 };
  const signal = { pStartRecent: 1, minutesPerAppearanceRecent: 90 };

  const oneGw = blendRoleSignal(seasonPrior, signal, 1);
  const twoGw = blendRoleSignal(seasonPrior, signal, 2);
  const threeGw = blendRoleSignal(seasonPrior, signal, 3);

  assert.ok(oneGw.pStart < twoGw.pStart && twoGw.pStart < threeGw.pStart);
  // Residual prior weight never fully vanishes within the window.
  assert.ok(threeGw.pStart < 1);

  // A window deeper than roleWindowGames clamps rather than over-trusting further.
  const beyondWindow = blendRoleSignal(seasonPrior, signal, 10);
  assert.equal(beyondWindow.pStart, threeGw.pStart);
});

test('blendRoleSignal: a disagreeing recent signal still eases the prior, not overrides it, and reverts as the signal weakens', () => {
  const seasonPrior = { pStart: 0.9, minutesPerAppearance: 85 };
  const benchedSignal = { pStartRecent: 0, minutesPerAppearanceRecent: 20 };

  const blended = blendRoleSignal(seasonPrior, benchedSignal, 1);

  assert.ok(blended.pStart < seasonPrior.pStart);
  assert.ok(blended.pStart > 0); // residual prior weight prevents a full swing to 0
});

test('blendRoleSignal: no observed data returns the season prior unchanged', () => {
  const seasonPrior = { pStart: 0.55, minutesPerAppearance: 70 };

  assert.deepEqual(
    blendRoleSignal(seasonPrior, { pStartRecent: null, minutesPerAppearanceRecent: null }, 0),
    seasonPrior,
  );
  assert.deepEqual(
    blendRoleSignal(seasonPrior, { pStartRecent: null, minutesPerAppearanceRecent: null }, 3),
    seasonPrior,
  );
});

test('blendRoleSignal: a null minutesPerAppearanceRecent (all-DNP window) leaves minutes at the prior', () => {
  const seasonPrior = { pStart: 0.6, minutesPerAppearance: 65 };
  const blended = blendRoleSignal(seasonPrior, { pStartRecent: 0, minutesPerAppearanceRecent: null }, 2);

  assert.equal(blended.minutesPerAppearance, seasonPrior.minutesPerAppearance);
  assert.ok(blended.pStart < seasonPrior.pStart);
});

test('roleHistory/roleSignal: cfg.roleWindowGames and cfg.roleRecencyWeights are actually consumed', () => {
  const gameweeks = [
    gameweek(1, { 'player-1': 90 }),
    gameweek(2, { 'player-1': 90 }),
    gameweek(3, { 'player-1': 90 }),
    gameweek(4), // would fall inside a wider window but outside a 2-GW cap
  ];

  const cappedAt2 = { ...DEFAULT_ROLE, roleWindowGames: 2, roleRecencyWeights: [0.6, 0.25, 0.15] as [number, number, number] };
  const history = roleHistory('player-1', gameweeks, undefined, cappedAt2);
  assert.equal(history.length, 2); // stops at the configured window, not the default 3

  // A recency-weight config that inverts the default's emphasis flips the
  // conditional-minutes average when the two GWs' minutes differ.
  const gws = [gameweek(1, { 'player-1': 30 }), gameweek(2, { 'player-1': 90 })];
  const h2 = roleHistory('player-1', gws, undefined, cappedAt2);

  const defaultWeighted = roleSignal(h2, cappedAt2);
  const inverted = roleSignal(h2, { ...cappedAt2, roleRecencyWeights: [0.15, 0.85, 0] as [number, number, number] });
  assert.notEqual(defaultWeighted.minutesPerAppearanceRecent, inverted.minutesPerAppearanceRecent);
});

test('blendRoleSignal: config knobs are wired through (not hardcoded)', () => {
  const seasonPrior = { pStart: 0, minutesPerAppearance: 0 };
  const signal = { pStartRecent: 1, minutesPerAppearanceRecent: 90 };

  const wideK = blendRoleSignal(seasonPrior, signal, 1, { ...DEFAULT_ROLE, roleK0: 10 });
  const narrowK = blendRoleSignal(seasonPrior, signal, 1, { ...DEFAULT_ROLE, roleK0: 0.01 });

  assert.ok(narrowK.pStart > wideK.pStart);
});
