import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPositionOverride, POSITION_OVERRIDES } from './position-overrides.js';

/**
 * The table is data, not code — these tests pin its invariants (every entry
 * reviewable, unique, well-formed) plus representative entries from each
 * provenance wave, so growth stays mechanical (audit paste) without the test
 * becoming a hand-maintained copy of the list.
 */

test('every entry is well-formed, unique, and carries a dated source note', () => {
  assert.ok(POSITION_OVERRIDES.length >= 30, 'the audited 2026-08-18..21 wave landed');
  const seen = new Set<string>();
  for (const entry of POSITION_OVERRIDES) {
    assert.match(entry.fplId, /^\d+$/, `fplId ${entry.fplId} is numeric`);
    assert.ok(!seen.has(entry.fplId), `fplId ${entry.fplId} appears once`);
    seen.add(entry.fplId);
    assert.ok(['G', 'D', 'MD', 'FW'].includes(entry.overridePosition));
    // The #58 protocol: every exception names its source and date.
    assert.match(entry.note, /20\d{2}-\d{2}-\d{2}/, `${entry.fplId}: note is dated`);
    assert.ok(entry.note.length > 10, `${entry.fplId}: note says where the correction came from`);
  }
});

test('Saka is corrected from FPL midfielder to Underdog forward', () => {
  const saka = POSITION_OVERRIDES.find((o) => o.fplId === '12');
  assert.deepEqual(
    { pos: saka?.overridePosition, note: saka?.note },
    {
      pos: 'FW',
      note: 'Saka (ARS): RotoWire Underdog EPL rankings list him F, 2026-08-19; recap capture 2026-08-18 agrees.',
    },
  );
  assert.equal(applyPositionOverride('12', 'MD'), 'FW');
});

test('representative audited corrections apply after the FPL mapping', () => {
  // The wide-attacker wave (FPL MD → Underdog FW), corroborated by 5 picks.
  assert.equal(applyPositionOverride('514', 'MD'), 'FW'); // Tel
  assert.equal(applyPositionOverride('237', 'MD'), 'FW'); // Ndiaye
  // Underdog goes the other way for FPL's 2026/27 reclassifications:
  // Dorgu (FPL MID, "reinvention as a winger") is a defender at Underdog.
  assert.equal(applyPositionOverride('415', 'MD'), 'D');
  // Matheus N. is the sole D → MD correction.
  assert.equal(applyPositionOverride('389', 'D'), 'MD');
});

test('players without an override retain their FPL-derived position', () => {
  assert.equal(applyPositionOverride('999', 'D'), 'D');
});
