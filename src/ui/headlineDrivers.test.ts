/**
 * Coverage for the headline-drivers formatter (#30): every line family —
 * GK starts-claim phrasing, newcomer prior vs observed history, congestion
 * only-when-applied, confidence basis, each durability threshold, and the
 * observed vs promoted-fallback team context. Synthetic projections, cast
 * partially — the formatter reads only the explanation fields.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headlineDrivers } from './headlineDrivers.js';
import type { PlayerProjection } from '../model/types.js';
import type { Position } from './types.js';

type Explanation = Pick<
  PlayerProjection,
  | 'minutes'
  | 'confidence'
  | 'durabilityRisk'
  | 'durabilityReasons'
  | 'seasonCount'
  | 'weightedMinutes'
  | 'newcomerPrior'
  | 'congestionApplied'
  | 'teamContext'
> & { statline: { matches: number } };

function player(overrides: Partial<Explanation>): PlayerProjection {
  const base: Explanation = {
    minutes: 2200,
    confidence: 'high',
    durabilityRisk: false,
    durabilityReasons: { thinMinutesShare: false, lowStartFraction: false, highUnusedSubs: false },
    seasonCount: 3,
    weightedMinutes: 2880,
    newcomerPrior: { value: 0, applied: false },
    congestionApplied: false,
    teamContext: { cleanSheetRate: 0.36, goalsConcededPerMatch: 1.4, gkWinRate: 0.5, observed: true },
    statline: { matches: 24.4 },
    ...overrides,
  };
  return base as unknown as PlayerProjection;
}

const text = (lines: { label: string; text: string }[], label: string) =>
  lines.find((l) => l.label === label)?.text ?? '';

test('GK minutes line reads as the starts-claim model, never the newcomer blend', () => {
  const p = player({ newcomerPrior: { value: 700, applied: false } });
  const line = text(headlineDrivers(p, 'G', 'ARS'), 'Minutes');
  assert.match(line, /Keeper starts-claim model/);
  assert.match(line, /~24 claimed starts at ARS/);
  assert.doesNotMatch(line, /newcomer|prior/i);
});

test('newcomer prior line shows the fitted minutes and flags thin history', () => {
  const p = player({
    seasonCount: 0,
    weightedMinutes: 0,
    newcomerPrior: { value: 765, applied: true },
    minutes: 765,
  });
  const line = text(headlineDrivers(p, 'MD', 'CHE'), 'Minutes');
  assert.match(line, /Price-tier newcomer prior/);
  assert.match(line, /~765 min/);
});

test('one-season blend reads as thin history, not no-history', () => {
  const p = player({
    seasonCount: 1,
    weightedMinutes: 1600,
    newcomerPrior: { value: 1469, applied: true },
    minutes: 1520,
  });
  const line = text(headlineDrivers(p, 'MD', 'ARS'), 'Minutes');
  assert.match(line, /Thin history — 1 usable season blended toward the price-tier prior/);
  assert.match(line, /~1,469 min/);
});

test('observed-history line carries seasons, weighted minutes, projection', () => {
  const line = text(headlineDrivers(player({}), 'FW', 'LIV'), 'Minutes');
  assert.match(line, /Observed history — 3 usable seasons, 2,880 weighted min → 2,200 projected/);
});

test('congestion line appears only when the haircut fired', () => {
  const quiet = headlineDrivers(player({}), 'MD', 'MCI');
  assert.equal(quiet.find((l) => l.label === 'Congestion'), undefined);
  const cut = headlineDrivers(player({ congestionApplied: true }), 'MD', 'MCI');
  assert.match(text(cut, 'Congestion'), /haircut applied/);
});

test('GK never gets a congestion line even if the flag were somehow set', () => {
  const lines = headlineDrivers(player({ congestionApplied: true }), 'G', 'ARS');
  assert.equal(lines.find((l) => l.label === 'Congestion'), undefined);
});

test('confidence line names the label and its basis', () => {
  const p = player({ confidence: 'medium', seasonCount: 2, weightedMinutes: 1900 });
  assert.match(
    text(headlineDrivers(p, 'D', 'BHA'), 'Confidence'),
    /medium — 2 usable seasons, 1,900 weighted min/,
  );
});

test('durability line joins exactly the thresholds that tripped and flags negative', () => {
  const p = player({
    durabilityRisk: true,
    durabilityReasons: { thinMinutesShare: false, lowStartFraction: true, highUnusedSubs: true },
  });
  const lines = headlineDrivers(p, 'FW', 'EVE');
  const line = lines.find((l) => l.label === 'Durability')!;
  assert.equal(line.negative, true);
  assert.match(line.text, /start rate < 55% · unused-sub rate > 0\.6\/90/);
  assert.doesNotMatch(line.text, /minutes share/);
});

test('no durability line when healthy', () => {
  const lines = headlineDrivers(player({}), 'D', 'NEW');
  assert.equal(lines.find((l) => l.label === 'Durability'), undefined);
});

test('observed team context shows club rates; keeper adds win rate', () => {
  const outfield = text(headlineDrivers(player({}), 'D', 'MCI'), 'Team context');
  assert.match(outfield, /Observed MCI priors — 36% CS rate, 1\.4 GC\/match\.$/);
  const keeper = text(headlineDrivers(player({}), 'G', 'MCI'), 'Team context');
  assert.match(keeper, /36% CS rate, 1\.4 GC\/match, 50% keeper win rate\.$/);
});

test('promoted-team fallback names the league-mean priors', () => {
  const p = player({
    teamContext: { cleanSheetRate: 0.28, goalsConcededPerMatch: 1.8, gkWinRate: 0.34, observed: false },
  });
  assert.match(
    text(headlineDrivers(p, 'G', 'LUT'), 'Team context'),
    /Promoted-team fallback — LUT lacks keeper\/squad history; league-mean priors \(28% CS, 1\.8 GC\/match\)/,
  );
});
