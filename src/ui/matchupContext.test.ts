/**
 * Matchup-context guards (#108):
 * - Poisson math against independent brute-force grids (higher cap, no
 *   renormalization) — the strip must not drift from textbook probabilities.
 * - Market averaging: per-book overround removal, cross-book mean, incomplete
 *   or degenerate quotes skipped, no books → null.
 * - matchupContext end-to-end: λs are pool p50 goal sums; unpriced fixtures
 *   carry no market.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OddsSlate } from '../etl/odds.js';
import type { SnapshotFixture } from '../etl/types.js';
import type { SnapshotPlayer } from './types.js';
import {
  cleanSheetProb,
  marketLine,
  matchProbabilities,
  matchupContext,
  overProb,
} from './matchupContext.js';

/** Independent Poisson grid — bigger cap, no truncation renormalization. */
function bruteForce(homeXg: number, awayXg: number) {
  const fact = (n: number) => { let f = 1; for (let i = 2; i <= n; i += 1) f *= i; return f; };
  const pmf = (k: number, l: number) => (Math.pow(l, k) * Math.exp(-l)) / fact(k);
  let homeWin = 0, draw = 0, awayWin = 0, over = 0;
  for (let h = 0; h <= 20; h += 1) {
    for (let a = 0; a <= 20; a += 1) {
      const p = pmf(h, homeXg) * pmf(a, awayXg);
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      if (h + a >= 3) over += p;
    }
  }
  return { homeWin, draw, awayWin, over };
}

function fixture(id: number, home: string, away: string): SnapshotFixture {
  return {
    id, event: 2, home, away, homeDifficulty: 2, awayDifficulty: 3,
    kickoff: '2026-08-29T11:30:00Z',
  };
}

function scorer(team: string, goals: number): SnapshotPlayer {
  return { team, projection: { statline: { goals } } } as unknown as SnapshotPlayer;
}

test('matchProbabilities matches a brute-force grid and sums to 1', () => {
  for (const [h, a] of [[1.5, 1.0], [2.1, 0.9], [0.6, 0.6], [2.8, 1.7]] as const) {
    const got = matchProbabilities(h, a);
    const want = bruteForce(h, a);
    assert.ok(Math.abs(got.homeWin + got.draw + got.awayWin - 1) < 1e-9);
    assert.ok(Math.abs(got.homeWin - want.homeWin) < 1e-6, `homeWin λ=${h}/${a}`);
    assert.ok(Math.abs(got.draw - want.draw) < 1e-6, `draw λ=${h}/${a}`);
    assert.ok(Math.abs(got.awayWin - want.awayWin) < 1e-6, `awayWin λ=${h}/${a}`);
    assert.ok(Math.abs(overProb(h, a) - want.over) < 1e-6, `over2.5 λ=${h}/${a}`);
  }
  // Symmetry: swapping λs swaps the sides, draw unchanged.
  const ab = matchProbabilities(1.4, 0.8);
  const ba = matchProbabilities(0.8, 1.4);
  assert.ok(Math.abs(ab.homeWin - ba.awayWin) < 1e-9);
  assert.ok(Math.abs(ab.draw - ba.draw) < 1e-9);
});

test('cleanSheetProb is e^-λ', () => {
  assert.ok(Math.abs(cleanSheetProb(1.0) - Math.exp(-1)) < 1e-12);
  assert.equal(cleanSheetProb(0), 1);
  assert.equal(cleanSheetProb(-0.5), 1); // guarded, never >1
});

test('marketLine: per-book normalization, cross-book mean, junk skipped', () => {
  // book1 2.0/4.0/4.0 → implied sums 1.0 → .5/.25/.25
  // book2 2.5/3.0/3.5 → 1/d = .4/.3̄/.285714, overround 1.019048 → .392524/.327102/.280375
  const line = marketLine([
    { bookmaker: 'book1', selection: 'home', price: 2.0 },
    { bookmaker: 'book1', selection: 'draw', price: 4.0 },
    { bookmaker: 'book1', selection: 'away', price: 4.0 },
    { bookmaker: 'book2', selection: 'home', price: 2.5 },
    { bookmaker: 'book2', selection: 'draw', price: 3.0 },
    { bookmaker: 'book2', selection: 'away', price: 3.5 },
    { bookmaker: 'book3', selection: 'home', price: 1.9 }, // incomplete book — skipped
    { bookmaker: 'book4', selection: 'draw', price: 0 },   // degenerate quote — skipped
  ]);
  assert.ok(line);
  assert.equal(line!.books, 2);
  assert.ok(Math.abs(line!.homeWin - 0.446262) < 1e-4);
  assert.ok(Math.abs(line!.draw - 0.288551) < 1e-4);
  assert.ok(Math.abs(line!.awayWin - 0.265188) < 1e-4);
  assert.ok(Math.abs(line!.homeWin + line!.draw + line!.awayWin - 1) < 1e-9);
  // Nothing usable → null (never a fabricated line).
  assert.equal(marketLine([]), null);
  assert.equal(
    marketLine([{ bookmaker: 'b', selection: 'home', price: 2.0 }]),
    null,
  );
});

test('matchupContext: λs are pool goal sums; market only where priced', () => {
  const players = [
    scorer('LIV', 1.4), scorer('LIV', 0.3), scorer('NFO', 0.9),
    scorer('BOU', 1.1), scorer('EVE', 0.7), scorer('TOT', 1.6), scorer('NEW', 0.8),
    scorer('UNRELATED', 5.0), // pool restriction is the caller's job; extra clubs ignored
  ];
  const fixtures = [fixture(14, 'LIV', 'NFO'), fixture(12, 'BOU', 'EVE')];
  const odds = {
    fetchedAt: '2026-08-28T10:00:00Z',
    fixtures: [
      {
        fixtureId: 14, eventId: 'e1', kickoff: '2026-08-29T11:30:00Z', home: 'LIV', away: 'NFO',
        matchWinner: [
          { bookmaker: 'b1', selection: 'home' as const, price: 2.0 },
          { bookmaker: 'b1', selection: 'draw' as const, price: 4.0 },
          { bookmaker: 'b1', selection: 'away' as const, price: 4.0 },
        ],
        totalGoals: [], playerProps: [],
      },
    ],
  } as unknown as OddsSlate;

  const ctx = matchupContext(players, fixtures, odds);
  assert.equal(ctx.length, 2);
  const liv = ctx[0];
  assert.ok(Math.abs(liv.homeXg - 1.7) < 1e-9); // 1.4 + 0.3
  assert.ok(Math.abs(liv.awayXg - 0.9) < 1e-9);
  assert.ok(liv.homeWin > liv.draw && liv.homeWin > liv.awayWin);
  assert.ok(liv.market && Math.abs(liv.market.homeWin - 0.5) < 1e-9);
  assert.equal(ctx[1].market, null); // unpriced fixture — no MKT line
  assert.ok(Math.abs(ctx[1].homeXg - 1.1) < 1e-9);
  // No odds asset at all → every market null, math still present.
  const bare = matchupContext(players, fixtures);
  assert.ok(bare.every((m) => m.market === null));
});
