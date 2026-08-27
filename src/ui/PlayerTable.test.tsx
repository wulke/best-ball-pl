import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerTable } from './PlayerTable.js';
import type { Snapshot, SnapshotPlayer } from './types.js';
import type { OddsSlate } from '../etl/odds.js';
import type { LineupSlate } from '../model/lineups.js';
import type { StartSurface } from './PlayerTable.js';
import { hasOddsCoverage } from './windowProjections.js';
import { OPP_ATT_CS_ANTISTACK, type AntiStackMatch } from '../stacking/rules.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const snapshot = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'data/snapshot.json'), 'utf8'),
) as Snapshot;

const noOp = () => {};

function renderTable(
  players: SnapshotPlayer[],
  showOddsPoints: boolean,
  exposureByPlayer: ReadonlyMap<string, { percent: number; pickedRooms: number; totalRooms: number }> = new Map(),
  startSurface?: StartSurface,
  antiStackByPlayer?: ReadonlyMap<string, AntiStackMatch[]>,
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
      startSurface={startSurface}
      exposureByPlayer={exposureByPlayer}
      exposureCompetition="False Nine — season best ball"
      antiStackByPlayer={antiStackByPlayer}
    />,
  );
}

test('anti-stack match renders the ⚔ badge with the filled tooltip (#120)', () => {
  const covered = structuredClone(snapshot.players.find((p) => p.projection)!);
  const html = renderTable([covered], false, new Map(), undefined, new Map([
    [covered.id, [{ rule: OPP_ATT_CS_ANTISTACK, club: 'MCI', prospective: false }]],
  ]));
  assert.ok(html.includes('⚔'));
  assert.ok(html.includes('Faces your G+D clean-sheet stack from MCI'));
  assert.ok(html.includes('text-negative'));
  // A player with no match renders no badge — the glyph count stays at 1.
  const clean = renderTable([covered], false);
  assert.ok(!clean.includes('⚔'));
});

test('a prospective (half-held) anti-stack renders in the light info tone', () => {
  const covered = structuredClone(snapshot.players.find((p) => p.projection)!);
  const html = renderTable([covered], false, new Map(), undefined, new Map([
    [covered.id, [{ rule: OPP_ATT_CS_ANTISTACK, club: 'MCI', prospective: true, held: 'a GK' }]],
  ]));
  assert.ok(html.includes('You hold a GK from MCI'));
  assert.ok(html.includes('text-info'));
});

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

test('slate start surface: Min column renders chips, override state, and the unknown-at-close marker', () => {
  const fixture = structuredClone(
    snapshot.fixtures.find((f) => f.home === 'BRE' && f.away === 'TOT' && f.kickoff.startsWith('2026-08-22'))!,
  );
  const bre = snapshot.players
    .filter((p) => p.team === 'BRE' && p.projection)
    .slice(0, 3)
    .map((p) => structuredClone(p));
  const [overridden, benched, unknown] = bre;
  assert.ok(fixture.id != null && overridden && benched && unknown, 'expected three BRE players');
  const lineups: LineupSlate = {
    schemaVersion: 1,
    profileId: 'free-kick-gw1-sat',
    slateDate: '2026-08-22',
    fetchedAt: '2026-08-22T12:00:00Z',
    fixtureCoverage: [{ fixtureId: fixture.id, covered: true }],
    players: [{ fixtureId: fixture.id, playerId: benched.id, status: 'bench' }],
  };
  const surface: StartSurface = {
    fixtures: [fixture],
    lineups,
    overrides: { [overridden.id]: { [fixture.id]: 'starter' } },
    onSetOverride: noOp,
  };

  const html = renderTable(bre, false, new Map(), surface);
  assert.match(html, />Min<\/th>/, 'the slate renders the expected-minutes column');
  assert.match(html, />S<\/button>/, 'override starter chip');
  assert.match(html, /aria-pressed="true"/, 'a manual call is pressed');
  assert.match(html, /border-dashed/, 'manual calls are dashed');
  assert.match(html, />B<\/button>/, 'lineup bench chip');
  assert.match(html, />\?<\/button>/, 'unknown chip for a player absent from the XI');
  assert.doesNotMatch(html, /⊘/, 'a covered fixture is not structurally unknown');

  // The same slate with the fixture uncovered (late kickoff / no lists yet):
  // every unknown becomes structurally unknown at close and gets the ⊘ marker.
  const uncovered: LineupSlate = { ...lineups, fixtureCoverage: [{ fixtureId: fixture.id, covered: false }], players: [] };
  const lateHtml = renderTable(
    bre,
    false,
    new Map(),
    { ...surface, lineups: uncovered, overrides: {} },
  );
  assert.match(lateHtml, /⊘/, 'uncovered fixture rows get the unknown-at-close marker');
  assert.match(lateHtml, /Unknown at close/);

  // False Nine (no surface mounted) never renders the column or chips.
  const season = renderTable(bre, false);
  assert.doesNotMatch(season, />Min<\/th>/);
  assert.doesNotMatch(season, />S<\/button>/);
  assert.doesNotMatch(season, /Start call for /);
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
