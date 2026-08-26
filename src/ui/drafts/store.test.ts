import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRoomFile } from './store.js';

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
