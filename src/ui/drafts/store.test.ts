import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRoomFile } from './store.js';
import { inferProfileFromPicks } from './types.js';
import type { SnapshotFixture, SnapshotPlayer } from '../types.js';
import type { PickLogEntry } from './types.js';

const legacyRoom = {
  version: 1,
  id: 'legacy-room',
  name: 'Legacy room',
  entryCost: 3,
  draftDate: '2026-08-20',
  rawPaste: '',
  picks: [],
  myTeam: null,
  draftUrl: null,
  carryNote: '',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

test('legacy room files without competition import as Uncategorized', () => {
  const room = parseRoomFile(JSON.stringify(legacyRoom));

  assert.equal(room.competition, null);
});

test('legacy rooms without profileId have it back-filled from the competition label', () => {
  const slateRoom = parseRoomFile(
    JSON.stringify({ ...legacyRoom, competition: 'The Free Kick — GW1 Saturday slate (Aug 22)' }),
  );
  assert.equal(slateRoom.profileId, 'free-kick-gw1-sat');

  const seasonRoom = parseRoomFile(
    JSON.stringify({ ...legacyRoom, competition: 'False Nine — season best ball' }),
  );
  assert.equal(seasonRoom.profileId, 'false-nine');
});

test('a hand-edited competition label keeps its profile prefix but stays null when rewritten', () => {
  const suffixed = parseRoomFile(
    JSON.stringify({ ...legacyRoom, competition: 'The Free Kick — GW1 Saturday slate (Aug 22) practice' }),
  );
  assert.equal(suffixed.profileId, 'free-kick-gw1-sat');

  const rewritten = parseRoomFile(JSON.stringify({ ...legacyRoom, competition: 'GW2 practice' }));
  assert.equal(rewritten.profileId, null);
});

test('an explicit profileId is preserved on import', () => {
  const room = parseRoomFile(
    JSON.stringify({ ...legacyRoom, competition: null, profileId: 'free-kick-gw2-sat' }),
  );
  assert.equal(room.profileId, 'free-kick-gw2-sat');
});

test('inferProfileFromPicks resolves a label-less legacy slate room from its clubs and team count', () => {
  // GW1 Sat slate clubs: BRE CRY EVE IPS LEE NFO SUN TOT. GW2: BOU COV EVE
  // HUL LIV NEW NFO TOT — LEE/BRE/SUN/CRY/IPS appear only in GW1.
  const pool: SnapshotPlayer[] = [
    { id: 'p1', name: 'A', fullName: 'A', team: 'LEE', position: 'MD', price: 5, status: 'a', news: '', seasons: [] },
    { id: 'p2', name: 'B', fullName: 'B', team: 'NFO', position: 'FW', price: 5, status: 'a', news: '', seasons: [] },
    { id: 'p3', name: 'C', fullName: 'C', team: 'TOT', position: 'D', price: 5, status: 'a', news: '', seasons: [] },
  ] as SnapshotPlayer[];
  const fixtures: SnapshotFixture[] = [
    { id: 1, event: 1, home: 'LEE', away: 'NFO', homeDifficulty: 3, awayDifficulty: 3, kickoff: '2026-08-22T14:00:00Z' },
    { id: 2, event: 1, home: 'TOT', away: 'BRE', homeDifficulty: 3, awayDifficulty: 3, kickoff: '2026-08-22T16:30:00Z' },
  ];
  const pick = (playerId: string, team: string, pickNo: number): PickLogEntry => ({
    pick: pickNo,
    round: Math.floor((pickNo - 1) / 6) + 1,
    team,
    rawName: pool.find((p) => p.id === playerId)!.name,
    playerId,
    unmatched: false,
  });
  const sixTeams = ['A', 'B', 'C', 'D', 'E', 'F'];
  const slateRoomPicks = sixTeams.flatMap((team, index) =>
    Array.from({ length: 6 }, (_, i) => pick(['p1', 'p2', 'p3'][i % 3], team, index * 6 + i + 1)),
  );

  assert.equal(inferProfileFromPicks(slateRoomPicks, pool, fixtures), 'free-kick-gw1-sat');
  // A 12-drafter season room (12 distinct teams) matches no daily draft size —
  // nothing to infer, and an empty log has no signal at all.
  const twelveTeams = slateRoomPicks.slice(0, 12).map((p, i) => ({ ...p, team: `T${i}` }));
  assert.equal(inferProfileFromPicks(twelveTeams, pool, fixtures), null);
  assert.equal(inferProfileFromPicks([], pool, fixtures), null);
});
