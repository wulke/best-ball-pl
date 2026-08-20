import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExposureView } from './ExposureView.js';
import type { RoomRecord } from './types.js';
import type { Snapshot } from '../types.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const snapshot = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'data/snapshot.json'), 'utf8'),
) as Snapshot;

function room(overrides: Partial<RoomRecord>): RoomRecord {
  return {
    version: 1,
    id: 'room-1',
    name: 'Room',
    entryCost: 3,
    competition: 'False Nine',
    draftDate: '2026-08-20',
    rawPaste: '',
    picks: [],
    myTeam: 'Mine',
    draftUrl: null,
    carryNote: '',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

test('defaults to the most recently updated competition and ranks its players by exposure', () => {
  const [first, second] = snapshot.players.filter((player) => player.projection).slice(0, 2);
  const html = renderToStaticMarkup(
    <ExposureView
      players={snapshot.players}
      rooms={[
        room({
          id: 'old',
          competition: 'False Nine',
          updatedAt: '2026-08-19T00:00:00.000Z',
          picks: [{ pick: 1, round: 1, team: 'Mine', rawName: first.name, playerId: first.id, unmatched: false }],
        }),
        room({
          id: 'new-1',
          competition: 'Free Kick',
          entryCost: 15,
          updatedAt: '2026-08-20T12:00:00.000Z',
          picks: [
            { pick: 1, round: 1, team: 'Mine', rawName: first.name, playerId: first.id, unmatched: false },
            { pick: 2, round: 1, team: 'Mine', rawName: second.name, playerId: second.id, unmatched: false },
          ],
        }),
        room({
          id: 'new-2',
          competition: 'Free Kick',
          entryCost: 5,
          updatedAt: '2026-08-20T12:01:00.000Z',
          picks: [{ pick: 1, round: 1, team: 'Mine', rawName: first.name, playerId: first.id, unmatched: false }],
        }),
      ]}
    />,
  );

  assert.match(html, /Exposure by competition/);
  assert.match(html, /<option value="Free Kick" selected="">Free Kick<\/option>/);
  assert.match(html, />100\.0%<\/td>/);
  assert.match(html, />50\.0%<\/td>/);
  assert.match(html, />\$20\.00<\/td>/);
  assert.ok(html.indexOf(first.name) < html.indexOf(second.name), 'highest exposure is first');
});

test('explains how to populate exposure when no rooms are logged', () => {
  const html = renderToStaticMarkup(<ExposureView players={snapshot.players} rooms={[]} />);
  assert.match(html, /No draft rooms yet/);
  assert.match(html, /Drafts/);
});
