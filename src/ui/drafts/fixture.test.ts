import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FREE_KICK_GW1_SAT } from '../../contest/profiles.js';
import type { SnapshotPlayer } from '../types.js';
import { buildSlateFixturePreview } from './fixture.js';
import { teamsInLog } from './types.js';

/** A minimal slate pool: 8 clubs × 7 players, positions cycling G/D/D/MD/MD/FW/FW. */
function slatePool(): SnapshotPlayer[] {
  const clubs = ['ARS', 'CHE', 'LIV', 'MCI', 'MUN', 'TOT', 'NFO', 'BRE'];
  const positions: SnapshotPlayer['position'][] = ['G', 'D', 'D', 'MD', 'MD', 'FW', 'FW'];
  const out: SnapshotPlayer[] = [];
  let rank = 1;
  for (const club of clubs) {
    for (let i = 0; i < positions.length; i += 1) {
      const id = `${club.toLowerCase()}-p${i + 1}`;
      const position = positions[i];
      out.push({
        id,
        name: `${club} ${position} ${i + 1}`,
        fullName: `${club} ${position} ${i + 1}`,
        team: club,
        position,
        price: 5,
        status: 'a',
        news: '',
        seasons: [],
        projection: {
          points: { p10: 2, p50: 4, p90: 6 },
          statline: {
            minutes: 90, matches: 1, goals: 0, assists: 0, shotsOnTarget: 0, shotsOffTarget: 0,
            chancesCreated: 0, crosses: 0, tackles: 0, passes: 0, cleanSheets: 0,
            goalsConceded: 0, saves: 0, gkWins: 0, penaltiesSaved: 0,
          },
          per90: 4,
          ceilingPer90: 4,
          minutes: 90,
          value: 4,
          posRank: 1,
          overallRank: rank,
          draftValue: 4,
          overallRankByValue: rank,
          tier: 1,
          confidence: 'high',
          tournamentScore: 4,
          durabilityRisk: false,
          durabilityReasons: { thinMinutesShare: false, lowStartFraction: false, highUnusedSubs: false },
          seasonCount: 1,
          weightedMinutes: 90,
          newcomerPrior: { value: 0, applied: false },
          congestionApplied: false,
          teamContext: { cleanSheetRate: 0, goalsConcededPerMatch: 0, gkWinRate: 0, observed: true },
        },
      });
      rank += 1;
    }
  }
  return out;
}

test('slate dev fixture produces a full 6×6 no-bench log from the window pool', () => {
  const pool = slatePool();
  const fixture = buildSlateFixturePreview(pool, FREE_KICK_GW1_SAT);

  assert.equal(fixture.picks.length, 36);
  assert.equal(teamsInLog(fixture.picks).length, 6);
  assert.deepEqual(
    fixture.picks.map((p) => p.pick),
    Array.from({ length: 36 }, (_, i) => i + 1),
  );
  // 6 rounds of 6: my team gets one pick per round, snake-consistent.
  const mine = fixture.picks.filter((p) => p.team === fixture.myTeam);
  assert.equal(mine.length, 6);
  assert.deepEqual(mine.map((p) => p.round), [1, 2, 3, 4, 5, 6]);
  // No bench: 6 picks, and every matched pick resolves inside the slate pool.
  const matched = fixture.picks.filter((p) => p.playerId);
  assert.ok(matched.every((p) => pool.some((q) => q.id === p.playerId)));
  // Engineering: at least the transfer-insurance pick stays unmatched, and the
  // round-2 reach should leave a deviation-sized gap somewhere in my log.
  assert.ok(fixture.picks.some((p) => p.unmatched));
  assert.match(fixture.suggestedName, /Dev Slate Room/);
});

test('slate dev fixture rejects non-daily profiles', () => {
  const pool = slatePool();
  assert.throws(
    () => buildSlateFixturePreview(pool, { ...FREE_KICK_GW1_SAT, kind: 'season' as const }),
    /daily slate profiles only/,
  );
});
