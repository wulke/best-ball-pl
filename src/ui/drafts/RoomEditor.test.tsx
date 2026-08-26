import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { FALSE_NINE } from '../../contest/profiles.js';
import { RoomEditor } from './RoomEditor.js';
import type { RoomRecord } from './types.js';
import type { Snapshot } from '../types.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const snapshot = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'data/snapshot.json'), 'utf8'),
) as Snapshot;

const room: RoomRecord = {
  version: 1,
  id: 'room-1',
  name: 'Saturday room',
  entryCost: 3,
  competition: null,
  profileId: null,
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
      snapshot={snapshot}
      onChange={() => {}}
      onClose={() => {}}
      profile={FALSE_NINE}
    />,
  );

  assert.match(markup, /<label[^>]*>.*?>Competition[^<]*<\/span>/);
  assert.match(markup, /list="room-competition-options"/);
  assert.match(markup, /<datalist id="room-competition-options"><option value="The Free Kick — 2026-08-22"><\/option><\/datalist>/);
});

test('a room carrying its own profileId shows the derived contest tag and defaults its competition label to it', () => {
  const tagged = { ...room, id: 'room-3', profileId: 'free-kick-gw1-sat' };
  const markup = renderToStaticMarkup(
    <RoomEditor
      room={tagged}
      rooms={[tagged]}
      snapshot={snapshot}
      onChange={() => {}}
      onClose={() => {}}
      profile={FALSE_NINE}
    />,
  );

  assert.match(markup, />DAILY<\/span>/);
  assert.match(markup, /placeholder="The Free Kick — GW1 Saturday slate \(Aug 22\)"/);
});
