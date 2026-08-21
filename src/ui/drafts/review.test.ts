import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FREE_KICK_GW1_SAT } from '../../contest/profiles.js';
import type { SnapshotFixture, SnapshotPlayer } from '../types.js';
import { reviewRoom } from './review.js';

function player(
  id: string,
  name: string,
  team: string,
  position: SnapshotPlayer['position'],
  overallRank: number,
  tournamentScore: number,
  posRank = overallRank,
): SnapshotPlayer {
  return {
    id,
    name,
    fullName: name,
    team,
    position,
    price: 5,
    status: 'a',
    news: '',
    seasons: [],
    projection: {
      points: { p10: tournamentScore / 2, p50: tournamentScore, p90: tournamentScore * 1.2 },
      statline: {
        minutes: 90, matches: 1, goals: 0, assists: 0, shotsOnTarget: 0, shotsOffTarget: 0,
        chancesCreated: 0, crosses: 0, tackles: 0, passes: 0, cleanSheets: 0,
        goalsConceded: 0, saves: 0, gkWins: 0, penaltiesSaved: 0,
      },
      per90: tournamentScore,
      ceilingPer90: tournamentScore,
      minutes: 90,
      value: tournamentScore,
      posRank,
      overallRank,
      draftValue: tournamentScore,
      overallRankByValue: overallRank,
      tier: 1,
      confidence: 'high',
      tournamentScore,
      durabilityRisk: false,
      durabilityReasons: { thinMinutesShare: false, lowStartFraction: false, highUnusedSubs: false },
      seasonCount: 1,
      weightedMinutes: 90,
      newcomerPrior: { value: 0, applied: false },
      congestionApplied: false,
      teamContext: { cleanSheetRate: 0, goalsConcededPerMatch: 0, gkWinRate: 0, observed: true },
    },
  };
}

test('daily room review compares picks and sheet-perfect only against slate clubs', () => {
  const fixtures: SnapshotFixture[] = [{
    id: 1, event: 1, home: 'ARS', away: 'CHE', homeDifficulty: 3, awayDifficulty: 3,
    kickoff: '2026-08-22T14:00:00Z',
  }];
  const pool = [
    player('out-bpa', 'Out of Slate', 'MUN', 'MD', 1, 100, 1),
    player('slate-bpa', 'Slate BPA', 'ARS', 'MD', 2, 90, 1),
    player('mine', 'My Pick', 'CHE', 'MD', 3, 80, 2),
    player('g', 'Slate Keeper', 'ARS', 'G', 4, 70),
    player('d', 'Slate Defender', 'CHE', 'D', 5, 60),
    player('fw', 'Slate Forward', 'ARS', 'FW', 6, 50),
    player('g2', 'Second Keeper', 'CHE', 'G', 7, 40),
    player('out-2', 'Another Outsider', 'LIV', 'FW', 8, 99),
  ];

  const review = reviewRoom(
    pool,
    [{ pick: 1, round: 1, team: 'Me', rawName: 'My Pick', playerId: 'mine' }],
    'Me',
    FREE_KICK_GW1_SAT,
    fixtures,
  );

  assert.ok(review);
  assert.equal(review.deviations[0]?.bpa.name, 'Slate BPA');
  assert.equal(review.deviations[0]?.posBpa?.name, 'Slate BPA');
  assert.equal(review.headline.sheetPerfectScore, 390);
  assert.deepEqual(review.clubGrid.rows.map((row) => row.club), ['ARS', 'CHE']);
});
