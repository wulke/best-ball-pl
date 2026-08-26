/**
 * Live-recs shape guards: the roster-shape chips must cover EVERY starting
 * spot — the exact-position slots plus the profile's FLEX slots. On the
 * no-bench daily slates that is all 6 roster spots; on False Nine the 2
 * FLEX starters (overflow beyond them is bench, not more FLEX).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Position, SnapshotPlayer } from './types.js';
import { buildRecommendations } from './recommend.js';
import { FALSE_NINE, FREE_KICK_GW1_SAT } from '../contest/profiles.js';

function player(id: string, position: Position, team = 'MCI'): SnapshotPlayer {
  return {
    id,
    name: `P${id}`,
    fullName: `Player ${id}`,
    position,
    team,
    price: 5,
    status: 'a',
    news: '',
    seasons: [],
  };
}

const shapeFor = (pool: SnapshotPlayer[], mine: Set<string>, profile = FREE_KICK_GW1_SAT) =>
  buildRecommendations(pool, new Set(), mine, new Set(), profile).shape;

test('daily slate shape includes the FLEX slots — every roster spot that starts', () => {
  const shape = shapeFor([], new Set());
  assert.deepEqual(
    shape.map((s) => [s.pos, s.count, s.starter, s.state]),
    [
      ['G', 0, 1, 'need'],
      ['D', 0, 1, 'need'],
      ['MD', 0, 1, 'need'],
      ['FW', 0, 1, 'need'],
      ['FLEX', 0, 2, 'need'],
    ],
  );
});

test('exact-position picks do not fill FLEX; overflow beyond the minimums does', () => {
  // 1/1/1/1 drafted: all four exact chips read full, but both FLEX slots
  // stay open — the gap this fixes on no-bench dailies.
  const exact = shapeFor(
    [player('1', 'G'), player('2', 'D'), player('3', 'MD'), player('4', 'FW')],
    new Set(['1', '2', '3', '4']),
  );
  assert.deepEqual(
    exact.filter((s) => s.pos !== 'FLEX').map((s) => s.state),
    ['full', 'full', 'full', 'full'],
  );
  const flex = exact.find((s) => s.pos === 'FLEX')!;
  assert.equal(flex.count, 0);
  assert.equal(flex.state, 'need');

  // Two extra outfielders fill both FLEX slots (any position qualifies).
  const full = shapeFor(
    [
      player('1', 'G'),
      player('2', 'D'),
      player('3', 'MD'),
      player('4', 'FW'),
      player('5', 'FW'),
      player('6', 'MD'),
    ],
    new Set(['1', '2', '3', '4', '5', '6']),
  );
  const filled = full.find((s) => s.pos === 'FLEX')!;
  assert.equal(filled.count, 2);
  assert.equal(filled.state, 'full');
});

test('False Nine FLEX caps at 2 — overflow beyond it is bench, not more starters', () => {
  // 6 D on the season roster: 2 exact starters + 2 FLEX, the rest bench.
  const pool = ['1', '2', '3', '4', '5', '6'].map((id, i) =>
    player(id, i === 0 ? 'G' : 'D'),
  );
  const shape = shapeFor(pool, new Set(pool.map((p) => p.id)), FALSE_NINE);
  const d = shape.find((s) => s.pos === 'D')!;
  const flex = shape.find((s) => s.pos === 'FLEX')!;
  assert.equal(d.count, 5);
  assert.equal(flex.count, 2);
  assert.equal(flex.starter, 2);
  assert.equal(flex.state, 'full');
});
