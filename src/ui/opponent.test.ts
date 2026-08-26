/**
 * getOpponentClub guards (#119):
 * - resolves the other side for a home-side player
 * - resolves the other side for an away-side player
 * - null when the player's club has no fixture in the window (multi-club
 *   window's off-slate clubs) and for an empty window — matches the StartCell
 *   early-return precedent so callers branch on absence, never a false club.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SnapshotFixture } from '../etl/types.js';
import { getOpponentClub } from './opponent.js';

function fixture(id: number, home: string, away: string): SnapshotFixture {
  return {
    id, event: 2, home, away, homeDifficulty: 2, awayDifficulty: 3,
    kickoff: '2026-08-29T11:30:00Z',
  };
}

const WINDOW = [
  fixture(1, 'BRE', 'TOT'),
  fixture(2, 'CRY', 'EVE'),
  fixture(3, 'IPS', 'LEE'),
  fixture(4, 'NFO', 'SUN'),
];

test('resolves the opponent of a home-side player', () => {
  assert.equal(getOpponentClub({ team: 'BRE' }, WINDOW), 'TOT');
});

test('resolves the opponent of an away-side player', () => {
  assert.equal(getOpponentClub({ team: 'SUN' }, WINDOW), 'NFO');
});

test('returns null for a club with no fixture in the window', () => {
  assert.equal(getOpponentClub({ team: 'MCI' }, WINDOW), null);
});

test('returns null for an empty window', () => {
  assert.equal(getOpponentClub({ team: 'BRE' }, []), null);
});

test('a one-fixture window still resolves both sides', () => {
  assert.equal(getOpponentClub({ team: 'IPS' }, [fixture(3, 'IPS', 'LEE')]), 'LEE');
  assert.equal(getOpponentClub({ team: 'LEE' }, [fixture(3, 'IPS', 'LEE')]), 'IPS');
});
