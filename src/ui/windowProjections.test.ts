/**
 * windowProjections guards (#47):
 * - False Nine returns the committed snapshot's own projections untouched.
 * - Any other profile returns a pool restricted to its window's clubs, with
 *   projections recomputed client-side (never mutating the snapshot).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Snapshot } from './types.js';
import { FALSE_NINE, FREE_KICK_GW1_SAT } from '../contest/profiles.js';
import { poolForProfile } from './windowProjections.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const snapshot = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'data/snapshot.json'), 'utf8'),
) as Snapshot;

test('False Nine pool is exactly the committed projections, snapshot untouched', () => {
  const pool = poolForProfile(snapshot, FALSE_NINE);
  const committed = snapshot.players.filter((p) => p.projection);
  assert.equal(pool.length, committed.length);
  assert.deepEqual(pool, committed);
});

test('Free Kick GW1 Saturday pool is restricted to the 8 slate clubs', () => {
  const pool = poolForProfile(snapshot, FREE_KICK_GW1_SAT);
  assert.ok(pool.length > 0);
  const clubs = new Set(pool.map((p) => p.team));
  assert.deepEqual(
    [...clubs].sort(),
    ['BRE', 'CRY', 'EVE', 'IPS', 'LEE', 'NFO', 'SUN', 'TOT'],
  );
  assert.ok(pool.every((p) => p.projection && p.projection.overallRank > 0));
});
