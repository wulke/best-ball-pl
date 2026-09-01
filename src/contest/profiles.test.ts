/**
 * Contest-profile guards (#39):
 * - False Nine must be bit-for-bit today's behavior — modelConfigFor deep-
 *   equals DEFAULT_MODEL_CONFIG, and the roster constants equal the values
 *   previously hardcoded across recommend.ts / review.ts / fixture.ts /
 *   LivePanel. This is the additive-only-until-flagship contract.
 * - The Free Kick GW1 Saturday slate must resolve, against the committed
 *   snapshot, to exactly the four post-close 2026-08-22 fixtures and the 8
 *   slate clubs (HUL-MUN's 11:30Z kickoff excluded — pre-close).
 * - The Free Kick GW2 Saturday Main slate must resolve to exactly the four
 *   post-close 2026-08-29 fixtures (no pre-close exclusion that week) and
 *   match GW1's ruleset knobs — same family, contest-page-confirmed.
 * - Match Day Mania (the GW3 weekly brand) must resolve to exactly the six
 *   post-close 2026-09-05 fixtures (NEW-BOU 11:30Z excluded — pre-close,
 *   like GW1's HUL-MUN) and match the Free Kick ruleset knobs — same
 *   FIFA Daily V2 family, contest-page-confirmed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Snapshot } from '../etl/types.js';
import {
  DEFAULT_MODEL_CONFIG,
  DEFAULT_SCORING,
  DEFAULT_TIERING,
  DEFAULT_TOURNAMENT,
} from '../model/config.js';
import {
  FALSE_NINE,
  FREE_KICK_GW1_SAT,
  FREE_KICK_GW2_SAT,
  MATCH_DAY_MANIA_GW3_SAT,
  PROFILES,
  benchSize,
  fullLogFloor,
  modelConfigFor,
  profileById,
  resolveContest,
  starterSlots,
} from './profiles.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const snapshot = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'data/snapshot.json'), 'utf8'),
) as Snapshot;
const fixtures = snapshot.fixtures;

test('False Nine model config is bit-for-bit DEFAULT_MODEL_CONFIG (flagship guard)', () => {
  assert.deepEqual(modelConfigFor(FALSE_NINE), DEFAULT_MODEL_CONFIG);
  // And the profile carries the very config objects, not copies that could drift.
  assert.equal(FALSE_NINE.scoring, DEFAULT_SCORING);
  assert.equal(FALSE_NINE.tournament, DEFAULT_TOURNAMENT);
  assert.equal(FALSE_NINE.tiering, DEFAULT_TIERING);
});

test('False Nine roster constants equal the previously hardcoded values', () => {
  assert.deepEqual(FALSE_NINE.roster.starters, { G: 1, D: 2, MD: 2, FW: 2 });
  assert.equal(FALSE_NINE.roster.flex, 2);
  assert.equal(FALSE_NINE.roster.rosterSize, 18);
  assert.deepEqual(FALSE_NINE.roster.targets, { G: 2, D: 6, MD: 5, FW: 5 });
  assert.equal(FALSE_NINE.draft.draftSize, 12);
  assert.deepEqual(starterSlots(FALSE_NINE), [
    'G', 'D', 'D', 'MD', 'MD', 'FW', 'FW', 'FLEX', 'FLEX',
  ]);
  assert.equal(benchSize(FALSE_NINE), 9);
  assert.equal(fullLogFloor(FALSE_NINE), 180); // the old FULL_LOG_FLOOR
});

test('False Nine window is the whole committed fixture list, pool unrestricted', () => {
  const resolved = resolveContest(FALSE_NINE, fixtures);
  assert.equal(resolved.fixtures.length, fixtures.length);
  assert.equal(resolved.clubs, null);
});

test('Free Kick GW1 Saturday resolves to exactly the 4 post-close fixtures', () => {
  const resolved = resolveContest(FREE_KICK_GW1_SAT, fixtures);
  const ids = resolved.fixtures.map((f) => f.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [2, 3, 5, 6]); // EVE-CRY, IPS-SUN, NFO-LEE @14:00, BRE-TOT @16:30
  assert.ok(
    resolved.fixtures.every((f) => f.kickoff.startsWith('2026-08-22') && f.kickoff >= '2026-08-22T13:41:00Z'),
  );
  assert.ok(!ids.includes(4)); // HUL-MUN 11:30Z — kicks off pre-close
  assert.deepEqual(resolved.clubs, ['BRE', 'CRY', 'EVE', 'IPS', 'LEE', 'NFO', 'SUN', 'TOT']);
});

test('Free Kick roster: 6 drafted, 6 start — no bench', () => {
  assert.deepEqual(FREE_KICK_GW1_SAT.roster.starters, { G: 1, D: 1, MD: 1, FW: 1 });
  assert.equal(FREE_KICK_GW1_SAT.roster.flex, 2);
  assert.equal(FREE_KICK_GW1_SAT.roster.rosterSize, 6);
  assert.equal(starterSlots(FREE_KICK_GW1_SAT).length, 6);
  assert.equal(benchSize(FREE_KICK_GW1_SAT), 0);
  assert.equal(FREE_KICK_GW1_SAT.draft.draftSize, 6);
  assert.equal(FREE_KICK_GW1_SAT.draft.clockSeconds, 30);
});

test('Free Kick scoring is primary-confirmed identical to False Nine', () => {
  assert.deepEqual(FREE_KICK_GW1_SAT.scoring, DEFAULT_SCORING);
});

test('Free Kick GW2 Saturday Main resolves to exactly the 4 post-close fixtures', () => {
  const resolved = resolveContest(FREE_KICK_GW2_SAT, fixtures);
  const ids = resolved.fixtures.map((f) => f.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [12, 13, 14, 15]); // LIV-NFO @11:30, BOU-EVE + COV-HUL @14:00, TOT-NEW @16:30
  assert.ok(
    resolved.fixtures.every((f) => f.kickoff.startsWith('2026-08-29') && f.kickoff >= '2026-08-29T11:11:00Z'),
  );
  assert.deepEqual(resolved.clubs, ['BOU', 'COV', 'EVE', 'HUL', 'LIV', 'NEW', 'NFO', 'TOT']);
});

test('Free Kick GW2 is ruleset-identical to GW1 (roster, room, scoring, model knobs)', () => {
  assert.deepEqual(FREE_KICK_GW2_SAT.roster, FREE_KICK_GW1_SAT.roster);
  assert.deepEqual(FREE_KICK_GW2_SAT.draft, FREE_KICK_GW1_SAT.draft);
  assert.deepEqual(FREE_KICK_GW2_SAT.scoring, DEFAULT_SCORING);
  assert.deepEqual(FREE_KICK_GW2_SAT.tournament, FREE_KICK_GW1_SAT.tournament);
  assert.deepEqual(FREE_KICK_GW2_SAT.tiering, FREE_KICK_GW1_SAT.tiering);
  assert.deepEqual(FREE_KICK_GW2_SAT.scenarios, FREE_KICK_GW1_SAT.scenarios);
});

test('Match Day Mania GW3 Saturday Main resolves to exactly the 6 post-close fixtures', () => {
  const resolved = resolveContest(MATCH_DAY_MANIA_GW3_SAT, fixtures);
  const ids = resolved.fixtures.map((f) => f.id).sort((a, b) => a - b);
  // BRE-SUN, BHA-LEE, FUL-CRY, MCI-COV, NFO-TOT @14:00 + HUL-AVL @16:30
  assert.deepEqual(ids, [22, 23, 24, 25, 26, 28]);
  assert.ok(
    resolved.fixtures.every((f) => f.kickoff.startsWith('2026-09-05') && f.kickoff >= '2026-09-05T13:41:00Z'),
  );
  assert.ok(!ids.includes(27)); // NEW-BOU 11:30Z — kicks off pre-close
  assert.deepEqual(resolved.clubs, [
    'AVL', 'BHA', 'BRE', 'COV', 'CRY', 'FUL', 'HUL', 'LEE', 'MCI', 'NFO', 'SUN', 'TOT',
  ]);
  assert.equal(resolved.fixtures.length, 6); // count check: modal game list = post-close count
});

test('Match Day Mania GW3 is ruleset-identical to the Free Kick family (roster, room, scoring, model knobs)', () => {
  assert.deepEqual(MATCH_DAY_MANIA_GW3_SAT.roster, FREE_KICK_GW2_SAT.roster);
  assert.deepEqual(MATCH_DAY_MANIA_GW3_SAT.draft, FREE_KICK_GW2_SAT.draft);
  assert.deepEqual(MATCH_DAY_MANIA_GW3_SAT.scoring, DEFAULT_SCORING);
  assert.deepEqual(MATCH_DAY_MANIA_GW3_SAT.tournament, FREE_KICK_GW2_SAT.tournament);
  assert.deepEqual(MATCH_DAY_MANIA_GW3_SAT.tiering, FREE_KICK_GW2_SAT.tiering);
  assert.deepEqual(MATCH_DAY_MANIA_GW3_SAT.scenarios, FREE_KICK_GW2_SAT.scenarios);
  assert.equal(MATCH_DAY_MANIA_GW3_SAT.sheetPerfectFlagPercent, FREE_KICK_GW2_SAT.sheetPerfectFlagPercent);
});

test('profileById resolves registry ids and throws on unknown ids', () => {
  assert.equal(profileById('false-nine'), FALSE_NINE);
  assert.equal(profileById('free-kick-gw1-sat'), FREE_KICK_GW1_SAT);
  assert.equal(profileById('free-kick-gw2-sat'), FREE_KICK_GW2_SAT);
  assert.equal(profileById('match-day-mania-gw3-sat'), MATCH_DAY_MANIA_GW3_SAT);
  assert.throws(() => profileById('nope'), /Unknown contest profile/);
  assert.deepEqual(PROFILES.map((p) => p.id), [
    'false-nine', 'free-kick-gw1-sat', 'free-kick-gw2-sat', 'match-day-mania-gw3-sat',
  ]);
});

test('a slate that matches no fixtures fails loudly', () => {
  assert.throws(
    () => resolveContest(
      { ...FREE_KICK_GW1_SAT, window: { kind: 'slate', date: '2026-12-25', notBefore: '00:00:00Z' } },
      fixtures,
    ),
    /matched no fixtures/,
  );
});
