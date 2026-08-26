import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeExposure } from './exposure.js';
import type { RoomRecord } from './types.js';

function room(overrides: Partial<RoomRecord>): RoomRecord {
  return {
    version: 1,
    id: 'room-1',
    name: 'Room',
    entryCost: 3,
    competition: 'False Nine',
    profileId: null,
    draftDate: '2026-08-20',
    rawPaste: '',
    picks: [],
    myTeam: 'Mine',
    draftUrl: null,
    carryNote: '',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

test('computes each player\'s room share and entry capital within each competition', () => {
  const exposure = computeExposure([
    room({
      id: 'fn-1',
      picks: [
        { pick: 1, round: 1, team: 'Mine', rawName: 'Salah', playerId: 'salah', unmatched: false },
        { pick: 2, round: 1, team: 'Other', rawName: 'Haaland', playerId: 'haaland', unmatched: false },
      ],
    }),
    room({
      id: 'fn-2',
      entryCost: 15,
      picks: [{ pick: 1, round: 1, team: 'Mine', rawName: 'Salah', playerId: 'salah', unmatched: false }],
    }),
    room({
      id: 'fn-3',
      entryCost: null,
      picks: [{ pick: 1, round: 1, team: 'Mine', rawName: 'Palmer', playerId: 'palmer', unmatched: false }],
    }),
    room({
      id: 'fk-1',
      competition: 'Free Kick',
      entryCost: 5,
      picks: [{ pick: 1, round: 1, team: 'Mine', rawName: 'Salah', playerId: 'salah', unmatched: false }],
    }),
  ]);

  assert.deepEqual(exposure, [
    { playerId: 'salah', competition: 'False Nine', pickedRooms: 2, totalRooms: 3, percent: 2 / 3, capital: 18 },
    { playerId: 'palmer', competition: 'False Nine', pickedRooms: 1, totalRooms: 3, percent: 1 / 3, capital: 0 },
    { playerId: 'salah', competition: 'Free Kick', pickedRooms: 1, totalRooms: 1, percent: 1, capital: 5 },
  ]);
});

test('excludes unmatched picks and never counts a player twice in one room', () => {
  const exposure = computeExposure([
    room({
      picks: [
        { pick: 1, round: 1, team: 'Mine', rawName: 'Salah', playerId: 'salah', unmatched: false },
        { pick: 2, round: 1, team: 'Mine', rawName: 'Salah duplicate', playerId: 'salah', unmatched: false },
        { pick: 3, round: 1, team: 'Mine', rawName: 'Insurance', playerId: 'insurance', unmatched: true },
      ],
    }),
  ]);

  assert.deepEqual(exposure, [
    { playerId: 'salah', competition: 'False Nine', pickedRooms: 1, totalRooms: 1, percent: 1, capital: 3 },
  ]);
});

test('keeps uncategorized rooms as their own competition group', () => {
  const exposure = computeExposure([
    room({ competition: null, picks: [{ pick: 1, round: 1, team: 'Mine', rawName: 'Salah', playerId: 'salah', unmatched: false }] }),
  ]);

  assert.deepEqual(exposure, [
    { playerId: 'salah', competition: null, pickedRooms: 1, totalRooms: 1, percent: 1, capital: 3 },
  ]);
});
