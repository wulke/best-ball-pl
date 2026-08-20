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
