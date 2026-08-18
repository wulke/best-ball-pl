/**
 * Premier League stats API volume source (`npm run fbref` step 2).
 *
 * FBref's passing page cells are JS-populated and FBref currently serves them
 * empty (no save format captures them — HTML Only and Single File both store
 * the pre-JS document). The Premier League's own stats leaderboard API
 * (footballapi.pulselive.com / SDP — powers premierleague.com) exposes the
 * same Opta-derived season stats server-side as JSON, including:
 *   - keyPassesAttemptAssists   → the "chance created" term (FBref KP)
 *   - successfulPassesOwnHalf + successfulPassesOppositionHalf
 *                               → completed passes (FBref Cmp)
 *   - timePlayed                → minutes (per-player rate denominator)
 * No auth, no browser, ~7 paginated pages per season.
 *
 * Fetch result is cached in the committed data/pl-stats.json so `npm run etl`
 * re-applies it without network.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMatchIndexes,
  matchPlayer,
  norm,
  readOverrides,
  tokensOf,
  type Overrides,
} from './match.js';
import type { SnapshotPlayer } from './types.js';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const PL_STATS_PATH = path.join(REPO_ROOT, 'data/pl-stats.json');

const LEADERBOARD_URL =
  'https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v3/competitions/8/seasons/{season}/players/stats/leaderboard';

/** PL season start year → model season label (matches FBref season labels). */
export const PL_SEASONS: Record<string, number> = {
  '2025/26': 2025,
  '2024/25': 2024,
};

export type PlPlayerRow = {
  /** Premier League API display name ("Martin Ødegaard"). */
  name: string;
  /** Full club name ("Manchester City"). */
  squad: string | null;
  minutes: number;
  values: { keyPasses?: number; passesCompleted?: number };
};

export type PlParsed = {
  generated_at: string;
  seasons: Record<string, PlPlayerRow[]>;
};

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Origin: 'https://www.premierleague.com',
  Referer: 'https://www.premierleague.com/',
  Accept: 'application/json',
};

async function fetchPage(url: string): Promise<{ data: PlPlayerRow[]; next: string | null }> {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`PL leaderboard HTTP ${res.status} for ${url}`);
  const body = (await res.json()) as {
    data: { playerMetadata: { name: string; currentTeam: { name: string } | null }; stats: Record<string, number> }[];
    pagination: { _next?: string | null };
  };
  const rows: PlPlayerRow[] = body.data
    .filter((p) => p.playerMetadata?.name) // some fringe entries have no identity
    .map((p) => {
      const s = p.stats ?? {}; // some fringe players have no stats object
    const completed =
      (s.successfulPassesOwnHalf ?? 0) + (s.successfulPassesOppositionHalf ?? 0);
    const values: PlPlayerRow['values'] = {};
    if (s.keyPassesAttemptAssists != null) values.keyPasses = s.keyPassesAttemptAssists;
    if (s.timePlayed != null) {
      // Only carry completed passes when the player actually played — a
      // 0-minute row would otherwise zero out the per-90 rate.
      values.passesCompleted = completed;
    }
    return {
      name: p.playerMetadata.name,
      squad: p.playerMetadata.currentTeam?.name ?? null,
      minutes: s.timePlayed ?? 0,
      values,
    };
  });
  return { data: rows, next: body.pagination?._next ?? null };
}

/** Fetch one PL season's player leaderboard (paginated). */
export async function fetchPlSeason(seasonYear: number, onLog: (msg: string) => void): Promise<PlPlayerRow[]> {
  const rows: PlPlayerRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 30; page++) {
    const url =
      LEADERBOARD_URL.replace('{season}', String(seasonYear)) +
      `?_limit=100` +
      (cursor ? `&_next=${encodeURIComponent(cursor)}` : '');
    const { data, next } = await fetchPage(url);
    if (!data.length) break;
    rows.push(...data);
    cursor = next;
    if (!cursor) break;
  }
  onLog(`[fbref] PL ${seasonYear}/${seasonYear + 1} leaderboard: ${rows.length} players`);
  return rows;
}

/** Fetch both model seasons; write the committed cache. */
export async function fetchPlStats(onLog: (msg: string) => void = console.log): Promise<PlParsed> {
  const seasons: Record<string, PlPlayerRow[]> = {};
  for (const [label, year] of Object.entries(PL_SEASONS)) {
    seasons[label] = await fetchPlSeason(year, onLog);
  }
  const parsed: PlParsed = { generated_at: new Date().toISOString(), seasons };
  writePlCache(parsed);
  onLog('[fbref] PL passing data committed → data/pl-stats.json');
  return parsed;
}

export function readPlCache(): PlParsed | null {
  if (!fs.existsSync(PL_STATS_PATH)) return null;
  return JSON.parse(fs.readFileSync(PL_STATS_PATH, 'utf8')) as PlParsed;
}

export function writePlCache(data: PlParsed): void {
  fs.writeFileSync(PL_STATS_PATH, `${JSON.stringify(data, null, 1)}\n`);
}

/** Season rows → per-player stats (PL has one row per player per season). */
function assembleSeason(rows: PlPlayerRow[]): Map<string, PlPlayerRow> {
  const byName = new Map<string, PlPlayerRow>();
  for (const row of rows) {
    const key = norm(row.name);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { ...row, values: { ...row.values } });
      continue;
    }
    // Same name twice (rare, e.g. two players sharing a name): keep the
    // row with more minutes; merge values defensively.
    if (row.minutes > existing.minutes) byName.set(key, { ...row, values: { ...row.values } });
    else for (const [k, v] of Object.entries(row.values)) if (v !== undefined) existing.values[k as 'keyPasses' | 'passesCompleted'] = v;
  }
  return byName;
}

export type PlMatchReport = {
  matched: number;
  enriched: { season: string; count: number }[];
};

/**
 * Fill passesCompleted/keyPasses from the PL stats cache. FBref-first
 * precedence: a field already set by FBref is left alone (PL fills gaps).
 */
export function applyPlEnrichment(
  players: SnapshotPlayer[],
  cache: PlParsed,
  overrides: Overrides = {},
): PlMatchReport {
  const report: PlMatchReport = { matched: 0, enriched: [] };
  const { byNormFull, byNormWeb } = buildMatchIndexes(players);
  for (const [seasonLabel, rows] of Object.entries(cache.seasons)) {
    if (!rows.length) continue;
    const byName = assembleSeason(rows);
    let count = 0;
    for (const [, stats] of byName) {
      const player = matchPlayer(
        stats.name,
        stats.squad ? new Set([stats.squad]) : new Set<null>([null]),
        seasonLabel,
        stats.minutes,
        players,
        byNormFull,
        byNormWeb,
        overrides,
      );
      if (!player) continue;
      const row = player.seasons.find((s) => s.season === seasonLabel);
      if (!row) continue;
      let touched = false;
      if (row.passesCompleted == null && stats.values.passesCompleted != null) {
        row.passesCompleted = stats.values.passesCompleted;
        touched = true;
      }
      if (row.keyPasses == null && stats.values.keyPasses != null) {
        row.keyPasses = stats.values.keyPasses;
        touched = true;
      }
      if (touched) {
        count += 1;
        report.matched += 1;
      }
    }
    report.enriched.push({ season: seasonLabel, count });
  }
  return report;
}
