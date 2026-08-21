import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerBreakdownModal } from './PlayerBreakdownModal.js';
import type { Snapshot, SnapshotPlayer } from './types.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const snapshot = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'data/snapshot.json'), 'utf8'),
) as Snapshot;

function renderModal(player: SnapshotPlayer) {
  assert.ok(player.projection, 'player needs a projection');
  return renderToStaticMarkup(
    <PlayerBreakdownModal
      name={player.name}
      position={player.position}
      team={player.team}
      projection={player.projection}
      onClose={() => {}}
    />,
  );
}

test('covered odds terms show model, market, blended rates, and the fetched-at stamp', () => {
  const player = structuredClone(snapshot.players.find((candidate) => candidate.position === 'G')!);
  assert.ok(player.projection);
  player.projection.odds = {
    fetchedAt: '2026-08-20T12:00:00Z',
    goals: { model: 0.01, oddsImplied: 0.02, blended: 0.0135 },
    assists: { model: 0.02, oddsImplied: 0.04, blended: 0.027 },
    cleanSheets: { model: 0.3, oddsImplied: 0.5, blended: 0.37 },
    goalsConceded: { model: 1.1, oddsImplied: 0.8, blended: 0.995 },
    gkWins: { model: 0.45, oddsImplied: 0.6, blended: 0.5025 },
  };

  const markup = renderModal(player);

  assert.match(markup, /Odds rate detail/);
  assert.match(markup, /Odds fetched/);
  assert.match(markup, /2026-08-20T12:00:00Z/);
  for (const term of ['Goals', 'Assists', 'Clean sheets', 'Goals conceded', 'Wins']) {
    assert.match(markup, new RegExp(`>${term}</td>`));
  }
  for (const rate of ['0.010', '0.020', '0.014', '0.300', '0.500', '0.370', '1.100', '0.800', '0.995', '0.450', '0.600', '0.503']) {
    assert.match(markup, new RegExp(`>${rate}</td>`));
  }
});

test('only covered, position-relevant terms gain odds detail', () => {
  const player = structuredClone(snapshot.players.find((candidate) => candidate.position === 'MD')!);
  assert.ok(player.projection);
  player.projection.odds = {
    fetchedAt: '2026-08-20T12:00:00Z',
    goals: { model: 0.2, oddsImplied: 0.4, blended: 0.27 },
    assists: { model: 0.1, oddsImplied: null, blended: 0.1 },
    cleanSheets: { model: 0, oddsImplied: 0.7, blended: 0.245 },
    goalsConceded: { model: 0, oddsImplied: 1.2, blended: 0.42 },
    gkWins: { model: 0, oddsImplied: 0.5, blended: 0.175 },
  };

  const markup = renderModal(player);

  assert.match(markup, />Goals<\/td>/);
  assert.doesNotMatch(markup, />Assists<\/td>/);
  assert.doesNotMatch(markup, />Clean sheets<\/td>/);
  assert.doesNotMatch(markup, />Goals conceded<\/td>/);
  assert.doesNotMatch(markup, />Wins<\/td>/);
});

test('model-only projections leave the existing modal without odds detail', () => {
  const player = snapshot.players.find((candidate) => candidate.projection && !candidate.projection.odds)!;
  const markup = renderModal(player);

  assert.doesNotMatch(markup, /Odds rate detail/);
  assert.doesNotMatch(markup, /Odds fetched/);
  assert.doesNotMatch(markup, />Model<\/th>/);
});
