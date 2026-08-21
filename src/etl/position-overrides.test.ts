import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPositionOverride, POSITION_OVERRIDES } from './position-overrides.js';

test('Saka is corrected from FPL midfielder to Underdog forward', () => {
  assert.deepEqual(POSITION_OVERRIDES, [
    {
      fplId: '12',
      overridePosition: 'FW',
      note: 'RotoWire Underdog EPL rankings list Bukayo Saka as F, 2026-08-19.',
    },
  ]);
  assert.equal(applyPositionOverride('12', 'MD'), 'FW');
});

test('players without an override retain their FPL-derived position', () => {
  assert.equal(applyPositionOverride('999', 'D'), 'D');
});
