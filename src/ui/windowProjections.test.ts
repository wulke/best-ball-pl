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
import type { OddsSlate } from '../etl/odds.js';

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

test('daily odds blend adds Odds Pts without changing model-only ranks, and falls back per missing term', () => {
  const fixture = snapshot.fixtures.find((f) =>
    f.home === 'BRE' && f.away === 'TOT' && f.kickoff.startsWith('2026-08-22'),
  );
  assert.ok(fixture, 'expected a Free Kick slate fixture');
  const covered = snapshot.players.find((p) => p.team === 'BRE' && p.position === 'FW');
  const partial = snapshot.players.find((p) => p.team === 'BRE' && p.position === 'MD');
  assert.ok(covered && partial, 'expected slate-pool attackers');
  const odds: OddsSlate = {
    schemaVersion: 1, profileId: FREE_KICK_GW1_SAT.id, slateDate: '2026-08-22', fetchedAt: '2026-08-20T12:00:00Z',
    fixtures: [{
      fixtureId: fixture.id, eventId: 'test', kickoff: fixture.kickoff, home: fixture.home, away: fixture.away,
      matchWinner: [
        { bookmaker: 'test', selection: 'home', price: 1.5 },
        { bookmaker: 'test', selection: 'draw', price: 5 },
        { bookmaker: 'test', selection: 'away', price: 8 },
      ],
      totalGoals: [
        { bookmaker: 'test', side: 'over', point: 3.5, price: 1.9 },
        { bookmaker: 'test', side: 'under', point: 3.5, price: 1.9 },
      ],
      playerProps: [{
        playerId: covered.id,
        anytimeGoalscorer: [{ bookmaker: 'test', price: 1.5 }],
        assists: [{ bookmaker: 'test', side: 'over', point: 0.5, price: 1.4 }],
      }],
    }],
  };
  const plain = poolForProfile(snapshot, FREE_KICK_GW1_SAT);
  const blended = poolForProfile(snapshot, FREE_KICK_GW1_SAT, odds);
  const byId = new Map(blended.map((p) => [p.id, p.projection!]));
  const plainById = new Map(plain.map((p) => [p.id, p.projection!]));
  const coveredProjection = byId.get(covered.id)!;
  const partialProjection = byId.get(partial.id)!;

  assert.notEqual(coveredProjection.oddsPoints, coveredProjection.points.p50);
  assert.equal(partialProjection.odds.goals.oddsImplied, null, 'missing player prop falls back');
  assert.equal(partialProjection.odds.goals.blended, partialProjection.odds.goals.model);
  assert.deepEqual(
    blended.map((p) => [p.id, p.projection!.overallRank, p.projection!.posRank, p.projection!.tier, p.projection!.tournamentScore]),
    plain.map((p) => [p.id, plainById.get(p.id)!.overallRank, plainById.get(p.id)!.posRank, plainById.get(p.id)!.tier, plainById.get(p.id)!.tournamentScore]),
  );
});
