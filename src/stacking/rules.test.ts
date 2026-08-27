/**
 * Correlation-rule framework (#118): the GK+DEF same-club clean-sheet stack
 * must match a real G+D pair, not just any 2 of G/D combined.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SnapshotFixture } from '../etl/types.js';
import {
  GK_DEF_CS_STACK,
  OPP_ATT_CS_ANTISTACK,
  clubPositionCounts,
  matchOpponentClubRules,
  matchSameClubRules,
  ruleTooltip,
} from './rules.js';

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

const fixture = (home: string, away: string): SnapshotFixture => ({
  id: 1,
  event: 1,
  home,
  away,
  homeDifficulty: 3,
  awayDifficulty: 3,
  kickoff: '2026-08-22T14:00:00Z',
});

test('anti-stack fires for an attacker from the opponent of a roster G+D stack', () => {
  const rosterByClub = clubPositionCounts([
    { team: 'MCI', position: 'G' },
    { team: 'MCI', position: 'D' },
  ]);
  const matches = matchOpponentClubRules(
    { team: 'LIV', position: 'FW' },
    rosterByClub,
    [fixture('MCI', 'LIV')],
  );
  assert.deepEqual(
    matches.map((m) => [m.rule.id, m.club, m.prospective, m.held]),
    [[OPP_ATT_CS_ANTISTACK.id, 'MCI', false, undefined]],
  );
});

test('anti-stack does not fire for a defender or keeper of the opponent club', () => {
  const rosterByClub = clubPositionCounts([
    { team: 'MCI', position: 'G' },
    { team: 'MCI', position: 'D' },
  ]);
  const fixtures = [fixture('MCI', 'LIV')];
  assert.deepEqual(matchOpponentClubRules({ team: 'LIV', position: 'D' }, rosterByClub, fixtures), []);
  assert.deepEqual(matchOpponentClubRules({ team: 'LIV', position: 'G' }, rosterByClub, fixtures), []);
});

test('a half-held stack (lone GK) matches as prospective, naming the held half', () => {
  const rosterByClub = clubPositionCounts([{ team: 'MCI', position: 'G' }]);
  const matches = matchOpponentClubRules(
    { team: 'LIV', position: 'FW' },
    rosterByClub,
    [fixture('MCI', 'LIV')],
  );
  assert.deepEqual(
    matches.map((m) => [m.rule.id, m.club, m.prospective, m.held]),
    [[OPP_ATT_CS_ANTISTACK.id, 'MCI', true, 'a GK']],
  );
});

test('2 DEF with no GK also match as prospective (deficit 1)', () => {
  const rosterByClub = clubPositionCounts([
    { team: 'MCI', position: 'D' },
    { team: 'MCI', position: 'D' },
  ]);
  const matches = matchOpponentClubRules(
    { team: 'LIV', position: 'MD' },
    rosterByClub,
    [fixture('MCI', 'LIV')],
  );
  assert.deepEqual(
    matches.map((m) => [m.prospective, m.held]),
    [[true, 'a DEF']],
  );
});

test('two picks away from the stack stays silent', () => {
  const rosterByClub = clubPositionCounts([{ team: 'MCI', position: 'MD' }]);
  assert.deepEqual(
    matchOpponentClubRules({ team: 'LIV', position: 'FW' }, rosterByClub, [fixture('MCI', 'LIV')]),
    [],
  );
});

test('anti-stack stays silent when the stack club has no window fixture', () => {
  const rosterByClub = clubPositionCounts([
    { team: 'MCI', position: 'G' },
    { team: 'MCI', position: 'D' },
  ]);
  assert.deepEqual(
    matchOpponentClubRules({ team: 'LIV', position: 'FW' }, rosterByClub, [fixture('ARS', 'LIV')]),
    [],
  );
});
