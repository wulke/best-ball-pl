import assert from 'node:assert/strict';
import { test } from 'node:test';
import { excludedTeamsForFixtures, filterSheetPlayers, loadExcludedTeams } from './excludedTeams.js';
import type { SnapshotFixture, SnapshotPlayer } from './types.js';

const fixtures: SnapshotFixture[] = [
  { id: 1, event: 2, home: 'LIV', away: 'NFO', homeDifficulty: 2, awayDifficulty: 3, kickoff: '2026-08-29T11:30:00Z' },
  { id: 2, event: 2, home: 'BOU', away: 'EVE', homeDifficulty: 2, awayDifficulty: 3, kickoff: '2026-08-29T14:00:00Z' },
];

const players = [
  { id: 'liv', team: 'LIV' },
  { id: 'nfo', team: 'NFO' },
  { id: 'bou', team: 'BOU' },
] as SnapshotPlayer[];

test('only active-slate teams can load as excluded, and stale teams are discarded', () => {
  const storage = new Map([['bbpl-excluded-teams:free-kick-gw2-sat', JSON.stringify(['LIV', 'ARS', 'LIV'])]]);
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => storage.get(key) ?? null },
  });

  try {
    const slateTeams = excludedTeamsForFixtures(fixtures);
    assert.deepEqual([...slateTeams].sort(), ['BOU', 'EVE', 'LIV', 'NFO']);
    assert.deepEqual(
      [...loadExcludedTeams('free-kick-gw2-sat', slateTeams)],
      ['LIV'],
    );
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
  }
});

test('excluded teams compose with the sheet filters by removing their players', () => {
  const visible = filterSheetPlayers(players, new Set(['LIV', 'NFO']));
  assert.deepEqual(visible.map((player) => player.id), ['bou']);
});
