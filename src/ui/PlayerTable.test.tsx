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

function renderTable(
  players: SnapshotPlayer[],
  showOddsPoints: boolean,
  exposureByPlayer: ReadonlyMap<string, { percent: number; pickedRooms: number; totalRooms: number }> = new Map(),
) {
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
      exposureByPlayer={exposureByPlayer}
      exposureCompetition="False Nine — season best ball"
    />,
  );
}

test('thead sticky top tracks the config stack height via CSS var (44px fallback)', () => {
  // #109 review: a hardcoded top-11 only worked when the sticky block above
  // was exactly the 44px filter bar; with the matchup strip stacked on it the
  // thead must follow the measured height (App publishes --bbpl-sticky-top).
  const html = renderTable([], false);
  assert.ok(html.includes('var(--bbpl-sticky-top, 2.75rem)'));
  assert.ok(!html.includes('top-11'));
});

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

test('exposure badge renders rounded active-competition exposure with its raw scoped detail', () => {
  const [picked, unpicked] = snapshot.players.filter((player) => player.projection).slice(0, 2);
  const markup = renderTable(
    [picked, unpicked],
    false,
    new Map([
      [picked.id, { percent: 2 / 3, pickedRooms: 2, totalRooms: 3 }],
      [unpicked.id, { percent: 0, pickedRooms: 0, totalRooms: 3 }],
    ]),
  );

  assert.match(markup, />67%<\/span>/, 'rounds the percent with no decimals');
  assert.match(markup, /Exposure: 2\/3 rooms in False Nine — season best ball/);
  assert.equal((markup.match(/>67%<\/span>/g) ?? []).length, 1, 'only picked players get a badge');
  assert.doesNotMatch(markup, />0%<\/span>/, 'zero exposure remains visually unchanged');
});
