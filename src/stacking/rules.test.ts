/**
 * Correlation-rule framework (#118): the GK+DEF same-club clean-sheet stack
 * must match a real G+D pair, not just any 2 of G/D combined.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GK_DEF_CS_STACK, matchSameClubRules, ruleTooltip } from './rules.js';

test('matches a club with 1 G + 1 D', () => {
  const matched = matchSameClubRules({ G: 1, D: 1 });
  assert.deepEqual(
    matched.map((r) => r.id),
    [GK_DEF_CS_STACK.id],
  );
});

test('does not match 2 DEF with no GK', () => {
  assert.deepEqual(matchSameClubRules({ D: 2 }), []);
});

test('does not match a lone GK', () => {
  assert.deepEqual(matchSameClubRules({ G: 1 }), []);
});

test('ruleTooltip fills in the club name', () => {
  assert.equal(
    ruleTooltip(GK_DEF_CS_STACK, 'MCI'),
    'G + D from MCI: their clean-sheet points are the same event',
  );
});
