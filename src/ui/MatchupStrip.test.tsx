/**
 * MatchupStrip render guards (#108): chips show the predicted score, 1X2
 * percentages, CS/O2.5, and MKT only for priced fixtures; the collapsed strip
 * renders just the toggle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MatchupStrip } from './MatchupStrip.js';
import type { MatchupContext } from './matchupContext.js';
import type { SnapshotFixture } from '../etl/types.js';

function fixture(id: number, home: string, away: string): SnapshotFixture {
  return { id, event: 2, home, away, homeDifficulty: 2, awayDifficulty: 3, kickoff: '2026-08-29T11:30:00Z' };
}

function matchup(over: Partial<MatchupContext>): MatchupContext {
  return {
    fixture: fixture(14, 'LIV', 'NFO'),
    homeXg: 2.1, awayXg: 0.9,
    homeWin: 0.62, draw: 0.21, awayWin: 0.17,
    homeCleanSheet: 0.41, awayCleanSheet: 0.28, over25: 0.57,
    market: null,
    ...over,
  };
}

const noOp = () => {};

test('open strip renders score, probabilities, CS/O2.5, and MKT for priced fixtures', () => {
  const html = renderToStaticMarkup(
    <MatchupStrip
      open
      onToggle={noOp}
      matchups={[
        matchup({ market: { homeWin: 0.55, draw: 0.24, awayWin: 0.21, books: 3 } }),
        matchup({
          fixture: fixture(12, 'BOU', 'EVE'),
          homeXg: 1.1, awayXg: 0.7,
          homeWin: 0.45, draw: 0.27, awayWin: 0.28,
        }),
      ]}
    />,
  );
  assert.ok(html.includes('Matchups (2)'));
  assert.ok(html.includes('2.1–0.9'));
  assert.ok(html.includes('62/21/17'));
  assert.ok(html.includes('CS 41/28'));
  assert.ok(html.includes('O2.5 57%'));
  assert.ok(html.includes('MKT 55/24/21'));
  assert.ok(html.includes('Sat 11:30Z'));
  // Unpriced fixture: numbers render, no market line.
  assert.ok(html.includes('BOU'));
  assert.ok(html.includes('45/27/28'));
  assert.equal(html.split('MKT').length - 1, 1); // exactly one MKT label
});

test('collapsed strip renders only the toggle', () => {
  const html = renderToStaticMarkup(
    <MatchupStrip open={false} onToggle={noOp} matchups={[matchup({})]} />,
  );
  assert.ok(html.includes('Matchups (1)'));
  assert.ok(!html.includes('2.1–0.9'));
  assert.ok(!html.includes('MKT'));
});
