import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FREE_KICK_GW1_SAT } from '../../contest/profiles.js';
import { RoomEditor } from './RoomEditor.js';
import type { RoomRecord } from './types.js';

const room: RoomRecord = {
  version: 1,
  id: 'room-1',
  name: 'Saturday room',
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

test('room editor offers current-room competition values as autocomplete choices', () => {
  const markup = renderToStaticMarkup(
    <RoomEditor
      room={room}
      rooms={[room, { ...room, id: 'room-2', competition: 'The Free Kick — 2026-08-22' }]}
      players={[]}
      onChange={() => {}}
      onClose={() => {}}
      profile={FREE_KICK_GW1_SAT}
    />,
  );

  assert.match(markup, /<label[^>]*>.*?>Competition<\/span>/);
  assert.match(markup, /list="room-competition-options"/);
  assert.match(markup, /<datalist id="room-competition-options"><option value="The Free Kick — 2026-08-22"><\/option><\/datalist>/);
});
