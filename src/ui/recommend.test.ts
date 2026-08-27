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
import { GK_DEF_CS_STACK, OPP_ATT_CS_ANTISTACK } from '../stacking/rules.js';
import { FALSE_NINE, FREE_KICK_GW1_SAT } from '../contest/profiles.js';
import type { SnapshotFixture } from '../etl/types.js';

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

test('clubChips flags the GK+DEF CS stack rule for a real G+D pair', () => {
  const pool = [player('1', 'G', 'MCI'), player('2', 'D', 'MCI')];
  const chips = buildRecommendations(pool, new Set(), new Set(['1', '2']), new Set()).clubChips;
  const mci = chips.find((c) => c.club === 'MCI')!;
  assert.deepEqual(
    mci.matchedRules.map((r) => r.id),
    [GK_DEF_CS_STACK.id],
  );
});

test('clubChips does not flag 2 DEF from the same club with no GK', () => {
  const pool = [player('1', 'D', 'MCI'), player('2', 'D', 'MCI')];
  const chips = buildRecommendations(pool, new Set(), new Set(['1', '2']), new Set()).clubChips;
  const mci = chips.find((c) => c.club === 'MCI')!;
  assert.deepEqual(mci.matchedRules, []);
});

test('tagsFor tags a DEF pick that would complete the GK+DEF stack with an already-rostered GK', () => {
  const board = { ...player('2', 'D', 'MCI'), projection: { tournamentScore: 1, tier: 1 } } as unknown as SnapshotPlayer;
  const pool = [player('1', 'G', 'MCI'), board];
  const bpa = buildRecommendations(pool, new Set(), new Set(['1']), new Set()).bpa;
  const candidate = bpa.find((r) => r.player.id === '2')!;
  assert.ok(candidate.tags.includes(GK_DEF_CS_STACK.label));
});

const fixture = (home: string, away: string): SnapshotFixture => ({
  id: 1,
  event: 1,
  home,
  away,
  homeDifficulty: 3,
  awayDifficulty: 3,
  kickoff: '2026-08-22T14:00:00Z',
});

test('anti-stack tags an opponent attacker once the roster holds the G+D CS stack', () => {
  const livFw = {
    ...player('3', 'FW', 'LIV'),
    projection: { tournamentScore: 5, tier: 1 },
  } as unknown as SnapshotPlayer;
  const pool = [player('1', 'G', 'MCI'), player('2', 'D', 'MCI'), livFw];
  const bpa = buildRecommendations(pool, new Set(), new Set(['1', '2']), new Set(), undefined, [
    fixture('MCI', 'LIV'),
  ]).bpa;
  const candidate = bpa.find((r) => r.player.id === '3')!;
  assert.ok(candidate.tags.includes('⚔ vs MCI'));
});

test('oppWarnings lists the opponent club whose attackers face a roster stack', () => {
  const pool = [player('1', 'G', 'MCI'), player('2', 'D', 'MCI')];
  const { oppWarnings } = buildRecommendations(
    pool,
    new Set(),
    new Set(['1', '2']),
    new Set(),
    undefined,
    [fixture('MCI', 'LIV')],
  );
  assert.deepEqual(
    oppWarnings.map((w) => [w.oppClub, w.club, w.rule.id]),
    [['LIV', 'MCI', OPP_ATT_CS_ANTISTACK.id]],
  );
});

test('a half-held stack gets the light ½⚔ tag and no panel warning chip', () => {
  const livFw = {
    ...player('3', 'FW', 'LIV'),
    projection: { tournamentScore: 5, tier: 1 },
  } as unknown as SnapshotPlayer;
  const pool = [player('1', 'G', 'MCI'), livFw];
  const recs = buildRecommendations(pool, new Set(), new Set(['1']), new Set(), undefined, [
    fixture('MCI', 'LIV'),
  ]);
  const candidate = recs.bpa.find((r) => r.player.id === '3')!;
  assert.ok(candidate.tags.includes('½⚔ vs MCI'));
  assert.deepEqual(recs.oppWarnings, []);
});

test('no fixtures (season-long) — no anti-stack tags or warnings', () => {
  const pool = [player('1', 'G', 'MCI'), player('2', 'D', 'MCI')];
  const recs = buildRecommendations(pool, new Set(), new Set(['1', '2']), new Set());
  assert.deepEqual(recs.oppWarnings, []);
  assert.deepEqual(recs.bpa, []);
});
