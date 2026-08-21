import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startCallForFixture, type LineupSlate, type StartOverrideMap } from './lineups.js';

const slate: LineupSlate = {
  schemaVersion: 1,
  profileId: 'daily',
  slateDate: '2026-08-22',
  fetchedAt: '2026-08-21T12:00:00Z',
  fixtureCoverage: [
    { fixtureId: 11, covered: true },
    { fixtureId: 12, covered: false },
  ],
  players: [
    { fixtureId: 11, playerId: 'starter', status: 'starter' },
    { fixtureId: 11, playerId: 'bench', status: 'bench' },
  ],
};

test('manual start overrides take precedence over a lineup asset', () => {
  const overrides: StartOverrideMap = { starter: { 11: 'bench' } };
  assert.deepEqual(startCallForFixture('starter', 11, overrides, slate), {
    status: 'bench', source: 'override',
  });
  assert.deepEqual(startCallForFixture('bench', 11, undefined, slate), {
    status: 'bench', source: 'lineup',
  });
});

test('uncovered fixtures and unknown players retain the model default', () => {
  assert.deepEqual(startCallForFixture('starter', 12, undefined, slate), {
    status: 'unknown', source: 'model',
  });
  assert.deepEqual(startCallForFixture('absent', 11, undefined, slate), {
    status: 'unknown', source: 'model',
  });
});
