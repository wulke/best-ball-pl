import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FALSE_NINE, FREE_KICK_GW1_SAT } from '../../contest/profiles.js';
import type { Snapshot, SnapshotFixture, SnapshotPlayer } from '../types.js';
import { reviewRoom } from './review.js';
import { poolForProfile } from '../windowProjections.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const snapshot = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'data/snapshot.json'), 'utf8'),
) as Snapshot;

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
    [{ pick: 1, round: 1, team: 'Me', rawName: 'My Pick', playerId: 'mine', unmatched: false }],
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

test('headline sheet-perfect flag uses the profile room-size baseline (#45)', () => {
  const fixtures: SnapshotFixture[] = [{
    id: 1, event: 1, home: 'ARS', away: 'CHE', homeDifficulty: 3, awayDifficulty: 3,
    kickoff: '2026-08-22T14:00:00Z',
  }];
  // 15 players across the slate's two clubs. Free Kick sheet-perfect = the
  // legal top-6 by rank (g1,d1,m1,f1,g2,d2 = 450); False Nine sheet-perfect =
  // the legal top-18, which here is the whole 15-player pool (723).
  const mk = (id: string, name: string, team: 'ARS' | 'CHE', position: SnapshotPlayer['position'], overallRank: number, tournamentScore: number) =>
    player(id, name, team, position, overallRank, tournamentScore);
  const pool = [
    mk('g1', 'G One', 'ARS', 'G', 1, 100),
    mk('d1', 'D One', 'ARS', 'D', 2, 90),
    mk('m1', 'M One', 'ARS', 'MD', 3, 80),
    mk('f1', 'F One', 'ARS', 'FW', 4, 70),
    mk('g2', 'G Two', 'CHE', 'G', 5, 60),
    mk('d2', 'D Two', 'CHE', 'D', 6, 50),
    mk('m2', 'M Two', 'CHE', 'MD', 7, 40),
    mk('f2', 'F Two', 'CHE', 'FW', 8, 30),
    mk('g3', 'G Three', 'ARS', 'G', 9, 20),
    mk('d4', 'D Four', 'CHE', 'D', 10, 55),
    mk('m4', 'M Four', 'CHE', 'MD', 11, 45),
    mk('f4', 'F Four', 'ARS', 'FW', 12, 35),
    mk('d3', 'D Three', 'CHE', 'D', 13, 18),
    mk('m3', 'M Three', 'ARS', 'MD', 14, 16),
    mk('f3', 'F Three', 'ARS', 'FW', 15, 14),
  ];
  // Give the slate's keepers clean-sheet lines so ARS/CHE land in the elite
  // defense quartile — the CS-exposure red flag then stays quiet and the only
  // carry-card content left is the headline flag under test (the flag cap is
  // 5; this keeps the headline flag inside it).
  pool.find((p) => p.id === 'g1')!.projection!.statline.cleanSheets = 10;
  pool.find((p) => p.id === 'g2')!.projection!.statline.cleanSheets = 5;
  const log = (ids: string[]) =>
    ids.map((id, index) => ({
      pick: index + 1,
      round: Math.floor(index / 6) + 1,
      team: 'Me',
      rawName: pool.find((p) => p.id === id)!.name,
      playerId: id,
      unmatched: false,
    }));
  const sheetPerfectFlag = (review: { flags: { text: string }[] }) =>
    review.flags.some((flag) => flag.text.includes('of sheet-perfect'));

  // Default floor 45 (False Nine): 138/723 = 19% flags, 450/723 = 62% does not.
  const weak = reviewRoom(pool, log(['g3', 'd3', 'm3', 'f3', 'm2', 'f2']), 'Me', FALSE_NINE, fixtures);
  assert.ok(weak);
  assert.ok(sheetPerfectFlag(weak), '19% of sheet-perfect must flag under the default 45 floor');
  const strongSeason = reviewRoom(pool, log(['g1', 'd1', 'm1', 'f1', 'g2', 'd2']), 'Me', FALSE_NINE, fixtures);
  assert.ok(strongSeason);
  assert.ok(!sheetPerfectFlag(strongSeason), '62% of sheet-perfect must NOT flag under the default 45 floor');

  // Slate floor 72 (Free Kick): 270/450 = 60% flags; the full top-6 at 100%
  // does not. (3-3 club split, G/D from the elite-CS club, so the other
  // carry-card flags stay quiet and the headline flag survives the top-5 cap.)
  const middling = log(['g3', 'd1', 'f4', 'm4', 'f2', 'd2']);
  const freeKick = reviewRoom(pool, middling, 'Me', FREE_KICK_GW1_SAT, fixtures);
  assert.ok(freeKick);
  assert.ok(sheetPerfectFlag(freeKick), '60% of sheet-perfect must flag under the 72 slate floor');
  const strongSlate = reviewRoom(pool, log(['g1', 'd1', 'm1', 'f1', 'g2', 'd2']), 'Me', FREE_KICK_GW1_SAT, fixtures);
  assert.ok(strongSlate);
  assert.ok(!sheetPerfectFlag(strongSlate), '100% of sheet-perfect must NOT flag under the 72 slate floor');
});

test('real GW1 Saturday rooms review under the slate profile, window pool only', () => {
  const slatePool = poolForProfile(snapshot, FREE_KICK_GW1_SAT);
  const slateClubs = new Set(slatePool.map((p) => p.team));
  for (const file of [
    'data/drafts/2026-08-19-room-2026-08-19.json',
    'data/drafts/2026-08-21-room-2026-08-21.json',
  ]) {
    const room = JSON.parse(
      fs.readFileSync(path.join(repoRoot, file), 'utf8'),
    ) as { picks: Parameters<typeof reviewRoom>[1]; myTeam: string };
    const review = reviewRoom(slatePool, room.picks, room.myTeam, FREE_KICK_GW1_SAT, snapshot.fixtures);
    assert.ok(review, `${file} must review`);
    assert.equal(review.teamCount, 6, `${file}: 6 drafters`);
    assert.equal(review.pickCount, 36, `${file}: 36 picks`);
    assert.equal(review.matchedCount, 36, `${file}: everything matched`);
    assert.equal(review.partialLog, false, `${file}: 36 ≥ the 30-pick slate floor`);
    // Every BPA / same-pos alternative is an in-slate player — never a club
    // the drafter couldn't have picked.
    for (const row of review.deviations) {
      assert.ok(slateClubs.has(row.bpa.team), `${file} pick ${row.pick}: BPA ${row.bpa.name} in-slate`);
      if (row.posBpa) assert.ok(slateClubs.has(row.posBpa.team), `${file} pick ${row.pick}: same-pos alternative in-slate`);
    }
    // 6-drafter no-bench rooms sit near sheet-perfect (top-6 nearly attainable) —
    // both real rooms land ~90%, far above the 72 flag floor.
    assert.ok(review.headline.percent > 72, `${file}: ${review.headline.percent.toFixed(1)}% > 72 floor`);
    assert.ok(review.headline.percent <= 100);
    // No out-of-slate club ever appears in the club grid.
    assert.ok(review.clubGrid.rows.every((row) => slateClubs.has(row.club)));
  }
});
