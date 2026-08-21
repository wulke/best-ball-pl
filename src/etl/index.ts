/**
 * ETL entry point (`npm run etl`): pulls the FPL API surface needed for the
 * pre-draft cheat sheet and writes the committed `data/snapshot.json`.
 *
 * Shape (see ./types.ts for the full contract):
 *   - bootstrap-static: identity, position, team, price, status for all players
 *   - element-summary/{id} per player (concurrency-capped, disk-cached):
 *     labeled multi-season stat lines — the historical baseline's source
 *   - fixtures: full-season fixture list with per-fixture difficulty ratings
 *
 * Idempotent and cheap to re-run draft-to-draft: raw responses are cached in
 * `.etl-cache/` (bootstrap/fixtures 5 min, element-summaries 24h, event-live
 * 60 min). ETL_FRESH=1 forces cache misses. Current-season per-GW actuals
 * (#40) come from `event/{gw}/live` — one call per finished GW — and land in
 * the snapshot's `actuals` section with an `asOf` stamp on top.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FplApi } from './fpl.js';
import { applyFbrefEnrichment } from './fbref-merge.js';
import { readFbrefCache } from './fbref.js';
import { applyPlEnrichment, readPlCache } from './pl-stats.js';
import { readOverrides } from './match.js';
import { applyPositionOverride } from './position-overrides.js';
import { FALSE_NINE, modelConfigFor, replacementConfigFor, resolveContest } from '../contest/profiles.js';
import { buildProjections } from '../model/project.js';
import { buildAsOf, decimalOrNull, finishedEventNumbers, toGwActuals } from './actuals.js';
import type {
  Position,
  SeasonStatLine,
  Snapshot,
  SnapshotActuals,
  SnapshotFixture,
  SnapshotPlayer,
} from './types.js';
import type {
  RawElement,
  RawElementSummary,
  RawFixture,
  RawHistoryPastSeason,
  RawTeam,
} from './fpl.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SNAPSHOT_PATH = path.join(repoRoot, 'data/snapshot.json');

const POSITION_BY_ELEMENT_TYPE: Record<number, Position> = {
  1: 'G',
  2: 'D',
  3: 'MD',
  4: 'FW',
};

function toPosition(elementType: number): Position {
  const position = POSITION_BY_ELEMENT_TYPE[elementType];
  if (!position) throw new Error(`Unknown FPL element_type ${elementType}`);
  return position;
}

// decimalOrNull (FPL decimal-string coercion) lives in actuals.ts.


function toSeasonStatLine(raw: RawHistoryPastSeason): SeasonStatLine {
  return {
    season: raw.season_name,
    minutes: raw.minutes,
    starts: raw.starts,
    goals: raw.goals_scored,
    assists: raw.assists,
    cleanSheets: raw.clean_sheets,
    goalsConceded: raw.goals_conceded,
    saves: raw.saves,
    penaltiesSaved: raw.penalties_saved,
    xg: decimalOrNull(raw.expected_goals),
    xa: decimalOrNull(raw.expected_assists),
    fplPoints: raw.total_points,
  };
}
function toSnapshotPlayer(
  element: RawElement,
  teamShortName: string,
  summary: RawElementSummary | null,
): SnapshotPlayer {
  return {
    id: String(element.id),
    name: element.web_name,
    fullName: `${element.first_name} ${element.second_name}`.trim(),
    // FPL is the default; checked-in exceptions correct confirmed Underdog
    // eligibility differences only after the normal element_type mapping.
    position: applyPositionOverride(String(element.id), toPosition(element.element_type)),
    team: teamShortName,
    price: element.now_cost / 10,
    status: element.status as SnapshotPlayer['status'],
    news: element.news ?? '',
    // FPL ships history_past oldest-first; the contract is most-recent-first.
    seasons: (summary?.history_past ?? [])
      .slice()
      .sort((a, b) => b.season_name.localeCompare(a.season_name))
      .map(toSeasonStatLine),
  };
}

function toSnapshotFixture(raw: RawFixture, shortNames: Map<number, string>): SnapshotFixture {
  const home = shortNames.get(raw.team_h);
  const away = shortNames.get(raw.team_a);
  if (!home || !away) throw new Error(`Fixture ${raw.id} references unknown team ids`);
  return {
    id: raw.id,
    event: raw.event,
    home,
    away,
    homeDifficulty: raw.team_h_difficulty,
    awayDifficulty: raw.team_a_difficulty,
    kickoff: raw.kickoff_time,
    // Final scores once played (#40) — spread so unfinished fixtures stay
    // byte-identical to the pre-actuals contract (no null fields).
    ...(raw.finished && raw.team_h_score != null && raw.team_a_score != null
      ? { homeScore: raw.team_h_score, awayScore: raw.team_a_score }
      : {}),
  };
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const api = new FplApi();

  console.log('[ETL] Fetching bootstrap-static (players, teams) and fixtures…');
  const bootstrap = await api.fetchBootstrap();
  const rawFixtures = await api.fetchFixtures();

  const shortNames = new Map<number, string>(bootstrap.teams.map((t: RawTeam) => [t.id, t.short_name]));
  const elements = bootstrap.elements;
  console.log(`[ETL] ${elements.length} players, ${bootstrap.teams.length} teams, ${rawFixtures.length} fixtures.`);

  console.log('[ETL] Fetching per-player season history (element-summary)…');
  const summaries = await api.fetchElementSummaries(
    elements.map((e) => e.id),
    8,
    (done, total) => {
      if (done % 100 === 0 || done === total) console.log(`[ETL]   ${done}/${total}`);
    },
  );
  const failedSummaries = [...summaries.values()].filter((s) => s === null).length;
  if (failedSummaries > 0) {
    console.warn(`[ETL] ${failedSummaries} element-summary fetch(es) failed — those players get empty seasons.`);
  }

  const players = elements.map((element) =>
    toSnapshotPlayer(element, shortNames.get(element.team) ?? '???', summaries.get(element.id) ?? null),
  );
  const fixtures = rawFixtures.map((f) => toSnapshotFixture(f, shortNames));

  // Per-GW actuals (#40): one `event/{gw}/live` call per FINISHED GW — a GW
  // counts once every one of its fixtures is finished (see actuals.ts). Any
  // fetch failure here fails the whole run loudly (retry/backoff first) — a
  // snapshot must never silently ship partial actuals.
  const finishedGws = finishedEventNumbers(rawFixtures);
  const gameweeks = [];
  for (const gw of finishedGws) {
    const live = await api.fetchEventLive(gw);
    gameweeks.push(toGwActuals(gw, live));
  }
  const actuals: SnapshotActuals = { gameweeks };
  const asOf = buildAsOf(fetchedAt, rawFixtures, actuals);

  // Re-apply committed FBref volume data if present (from `npm run fbref`) so
  // a fresh FPL pull doesn't silently drop back to baseline-only volume.
  const overrides = readOverrides();
  const fbref = readFbrefCache();
  if (fbref) {
    const report = applyFbrefEnrichment(players, fbref, overrides);
    const enriched = report.enriched.map((e) => `${e.season}=${e.count}`).join(', ');
    console.log(`[ETL] FBref volume re-applied from data/fbref.json (${enriched || 'none'}).`);
  } else {
    console.log('[ETL] No data/fbref.json — volume terms fall back to league-average baselines.');
  }

  // PL stats cache covers the passing terms (passesCompleted/keyPasses) that
  // FBref's JS-populated pages don't capture. Fill gaps only (FBref-first).
  const pl = readPlCache();
  if (pl) {
    const plReport = applyPlEnrichment(players, pl, overrides);
    const plEnriched = plReport.enriched.map((e) => `${e.season}=${e.count}`).join(', ');
    console.log(`[ETL] PL passing re-applied from data/pl-stats.json (${plEnriched || 'none'}).`);
  } else {
    console.log('[ETL] No data/pl-stats.json — passing terms fall back to league-average baselines.');
  }

  console.log('[ETL] Projecting season-long False Nine points (p10/p50/p90)…');
  // Profile #1 — value-identical to DEFAULT_MODEL_CONFIG (guarded by
  // src/contest/profiles.test.ts); threading it keeps the snapshot provably
  // unchanged while the profile becomes the model's single entry point (#39).
  // The season window is explicit (#42): all committed fixtures, whole pool.
  const season = resolveContest(FALSE_NINE, fixtures);
  const { projections } = buildProjections(
    players,
    modelConfigFor(FALSE_NINE),
    season,
    replacementConfigFor(FALSE_NINE),
  );
  const playersWithProjections = players.map((p, i) => ({ ...p, projection: projections[i] }));

  const positionCounts = players.reduce(
    (acc, p) => ({ ...acc, [p.position]: (acc[p.position] ?? 0) + 1 }),
    {} as Record<Position, number>,
  );
  const playersWithHistory = players.filter((p) => p.seasons.length > 0).length;

  const snapshot: Snapshot = {
    generated_at: new Date().toISOString(),
    asOf,
    meta: { playersWithHistory, positionCounts },
    players: playersWithProjections,
    fixtures,
    actuals,
  };

  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);

  const seasonRows = players.reduce((sum, p) => sum + p.seasons.length, 0);
  console.log(`[ETL] Snapshot written to ${path.relative(repoRoot, SNAPSHOT_PATH)}`);
  console.log(
    `[ETL] ${players.length} players (${playersWithHistory} with history, ${seasonRows} season rows) · ${fixtures.length} fixtures · ${playersWithProjections.length} projected.`,
  );
  const actualRows = actuals.gameweeks.reduce((sum, gw) => sum + gw.players.length, 0);
  console.log(
    `[ETL] Actuals: ${actuals.gameweeks.length} finished GW(s) · ${actualRows} player rows · asOf ${asOf.fetchedAt} (through GW${asOf.actualsThrough}${asOf.nextKickoff ? `, next kickoff ${asOf.nextKickoff}` : ''}).`,
  );
  console.log(
    `[ETL] Positions: ${Object.entries(positionCounts)
      .map(([pos, count]) => `${pos}=${count}`)
      .join(' ')}`,
  );
}

main().catch((err) => {
  console.error('[ETL] Failed:', err);
  process.exit(1);
});
