import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerTable } from './PlayerTable.js';
import type { Snapshot, SnapshotPlayer } from './types.js';
import type { OddsSlate } from '../etl/odds.js';
import { hasOddsCoverage } from './windowProjections.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const snapshot = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'data/snapshot.json'), 'utf8'),
) as Snapshot;

const noOp = () => {};

function renderTable(players: SnapshotPlayer[], showOddsPoints: boolean) {
  return renderToStaticMarkup(
    <PlayerTable
      players={players}
      drafted={new Set()}
      onToggleDrafted={noOp}
      mine={new Set()}
      onDraftMine={noOp}
      queued={new Set()}
      onToggleQueued={noOp}
      groupByTier={false}
      rankMode="points"
      showOddsPoints={showOddsPoints}
    />,
  );
}

test('Odds Pts and odds-coverage marker render only for a single-day slate', () => {
  const covered = structuredClone(snapshot.players.find((player) => player.projection)!);
  const fallback = structuredClone(snapshot.players.find((player) => player.projection && player.id !== covered.id)!);
  covered.projection!.oddsPoints = 7.4;
  covered.projection!.odds = {
    fetchedAt: '2026-08-20T12:00:00Z',
    goals: { model: 0.1, oddsImplied: 0.2, blended: 0.135 },
    assists: { model: 0.1, oddsImplied: null, blended: 0.1 },
    cleanSheets: { model: 0, oddsImplied: null, blended: 0 },
    goalsConceded: { model: 0, oddsImplied: null, blended: 0 },
    gkWins: { model: 0, oddsImplied: null, blended: 0 },
  };
  fallback.projection!.oddsPoints = fallback.projection!.points.p50;
  fallback.projection!.odds = {
    fetchedAt: '2026-08-20T12:00:00Z',
    goals: { model: 0.1, oddsImplied: null, blended: 0.1 },
    assists: { model: 0.1, oddsImplied: null, blended: 0.1 },
    cleanSheets: { model: 0, oddsImplied: null, blended: 0 },
    goalsConceded: { model: 0, oddsImplied: null, blended: 0 },
    gkWins: { model: 0, oddsImplied: null, blended: 0 },
  };

  const slate = renderTable([covered, fallback], true);
  assert.match(slate, />Odds Pts<\/th>/);
  assert.match(slate, />7\.4<\/td>/);
  assert.match(slate, />O<\/span>/, 'covered player gets the odds marker');
  assert.equal((slate.match(/>O<\/span>/g) ?? []).length, 1, 'fallback-only row stays unmarked');

  const season = renderTable([covered, fallback], false);
  assert.doesNotMatch(season, />Odds Pts<\/th>/);
  assert.doesNotMatch(season, />O<\/span>/);
});

test('Odds Pts stays hidden for an unpulled slate placeholder', () => {
  const placeholder: OddsSlate = {
    schemaVersion: 1,
    profileId: 'daily-placeholder',
    slateDate: '2026-08-22',
    fetchedAt: null,
    fixtures: [],
  };
  const player = structuredClone(snapshot.players.find((candidate) => candidate.projection)!);
  player.projection!.oddsPoints = player.projection!.points.p50;

  const markup = renderTable([player], hasOddsCoverage(placeholder));
  assert.doesNotMatch(markup, />Odds Pts<\/th>/);
  assert.doesNotMatch(markup, />O<\/span>/);
});
