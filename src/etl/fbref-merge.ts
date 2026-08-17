/**
 * FBref merge (`npm run fbref`): parse raw saved pages (data/fbref-raw/) →
 * match FBref players to FPL elements → enrich SeasonStatLine volume fields →
 * re-run projections → write snapshot. Committed artifacts: data/fbref.json
 * (parsed, reusable by `npm run etl`) and data/fbref-overrides.json (manual
 * name-match fixes).
 *
 * Matching has no shared key (FBref names ≠ FPL names): normalized full-name
 * match first, unique web-name match second, team-map tiebreak for ambiguity,
 * committed overrides for the rest. Unmatched FBref rows are usually players
 * outside the 2026/27 FPL pool — expected, logged, skipped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFbrefRawDir,
  readFbrefCache,
  writeFbrefCache,
  type FbrefField,
  type FbrefParsed,
  type FbrefPlayerRow,
} from './fbref.js';
import { DEFAULT_MODEL_CONFIG } from '../model/config.js';
import { buildProjections } from '../model/project.js';
import type { Snapshot, SnapshotPlayer } from './types.js';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SNAPSHOT_PATH = path.join(REPO_ROOT, 'data/snapshot.json');
const OVERRIDES_PATH = path.join(REPO_ROOT, 'data/fbref-overrides.json');
const FBREF_RAW_DIR = path.join(REPO_ROOT, 'data/fbref-raw');

/** FBref squad name → FPL short code (2026/27 pool). */
const SQUAD_TO_FPL: Record<string, string> = {
  Arsenal: 'ARS',
  'Aston Villa': 'AVL',
  Brighton: 'BHA',
  Bournemouth: 'BOU',
  Brentford: 'BRE',
  Chelsea: 'CHE',
  'Coventry City': 'COV',
  'Crystal Palace': 'CRY',
  Everton: 'EVE',
  Fulham: 'FUL',
  'Hull City': 'HUL',
  'Ipswich Town': 'IPS',
  'Leeds United': 'LEE',
  Liverpool: 'LIV',
  'Manchester City': 'MCI',
  'Manchester United': 'MUN',
  'Newcastle United': 'NEW',
  'Nottingham Forest': 'NFO',
  Sunderland: 'SUN',
  Tottenham: 'TOT',
};

/** Strip diacritics + everything non-alphabetic, lowercase. */
function norm(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

type Overrides = Record<string, string>; // fbref name → FPL element id

function readOverrides(): Overrides {
  if (!fs.existsSync(OVERRIDES_PATH)) return {};
  return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8')) as Overrides;
}

// ---------------------------------------------------------------------------
// Season assembly: group per-page rows by player
// ---------------------------------------------------------------------------

type SeasonPlayerStats = {
  name: string;
  /** Squad of the single-club row, when there is one; null = combined multi-club row only. */
  squads: Set<string | null>;
  minutes: number;
  values: Partial<Record<FbrefField, number>>;
};

function assembleSeason(pages: Record<string, FbrefPlayerRow[]>): Map<string, SeasonPlayerStats> {
  // Collect all rows per player name across pages first.
  const rowsByName = new Map<string, FbrefPlayerRow[]>();
  for (const rows of Object.values(pages)) {
    for (const row of rows) {
      rowsByName.set(row.name, [...(rowsByName.get(row.name) ?? []), row]);
    }
  }

  const byName = new Map<string, SeasonPlayerStats>();
  for (const [name, rows] of rowsByName) {
    const combined = rows.filter((r) => r.squad === null); // full-season totals for movers
    const perClub = rows.filter((r) => r.squad !== null);
    const squads = new Set<string | null>(
      (combined.length ? [null] : [...new Set(perClub.map((r) => r.squad as string))]),
    );
    const source = combined.length ? combined : perClub;
    const values: Partial<Record<FbrefField, number>> = {};
    let minutes = 0;
    for (const row of source) {
      for (const [f, v] of Object.entries(row.values)) {
        if (v !== undefined) values[f as FbrefField] = (values[f as FbrefField] ?? 0) + v;
      }
      minutes = combined.length
        ? Math.max(minutes, row.minutes)
        : minutes + row.minutes;
    }
    byName.set(name, { name, squads, minutes, values });
  }
  return byName;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

type MatchReport = {
  matched: number;
  unmatchedFplPool: string[]; // FBref names that look like they should match but didn't
  enriched: { season: string; count: number }[];
  minuteMismatches: string[];
};

function matchPlayer(
  fbrefName: string,
  squads: Set<string | null>,
  players: SnapshotPlayer[],
  byNormFull: Map<string, SnapshotPlayer[]>,
  byNormWeb: Map<string, SnapshotPlayer[]>,
  overrides: Overrides,
): SnapshotPlayer | null {
  const byId = (id: string) => players.find((p) => p.id === id) ?? null;
  const override = overrides[fbrefName];
  if (override) {
    const hit = byId(override);
    if (!hit) throw new Error(`data/fbref-overrides.json: "${fbrefName}" → id ${override} not in snapshot`);
    return hit;
  }

  const full = byNormFull.get(norm(fbrefName)) ?? [];
  if (full.length === 1) return full[0];
  if (full.length > 1) return tiebreakBySquad(full, squads) ?? full[0];

  const web = byNormWeb.get(norm(fbrefName)) ?? [];
  if (web.length === 1) return web[0];
  if (web.length > 1) return tiebreakBySquad(web, squads) ?? null;

  return null;
}

function tiebreakBySquad(candidates: SnapshotPlayer[], squads: Set<string | null>): SnapshotPlayer | null {
  const fplCodes = new Set(
    [...squads].filter((s): s is string => s !== null).map((s) => SQUAD_TO_FPL[s]).filter(Boolean),
  );
  if (fplCodes.size === 0) return null;
  const hit = candidates.filter((p) => fplCodes.has(p.team));
  return hit.length === 1 ? hit[0] : null;
}

// ---------------------------------------------------------------------------
// Enrichment (pure — reused by npm run etl)
// ---------------------------------------------------------------------------

export function applyFbrefEnrichment(
  players: SnapshotPlayer[],
  cache: FbrefParsed,
  overrides: Overrides = {},
): MatchReport {
  const report: MatchReport = {
    matched: 0,
    unmatchedFplPool: [],
    enriched: [],
    minuteMismatches: [],
  };
  const byNormFull = new Map<string, SnapshotPlayer[]>();
  const byNormWeb = new Map<string, SnapshotPlayer[]>();
  for (const p of players) {
    const k = norm(p.fullName);
    byNormFull.set(k, [...(byNormFull.get(k) ?? []), p]);
    const w = norm(p.name);
    byNormWeb.set(w, [...(byNormWeb.get(w) ?? []), p]);
  }
  const playerById = new Map(players.map((p) => [p.id, p]));

  for (const [seasonLabel, pages] of Object.entries(cache.seasons)) {
    if (!Object.keys(pages).length) continue;
    const byName = assembleSeason(pages);
    let count = 0;
    for (const [fbrefName, stats] of byName) {
      const player = matchPlayer(fbrefName, stats.squads, players, byNormFull, byNormWeb, overrides);
      if (!player) {
        // Only interesting if the FBref squad maps into the 2026/27 pool.
        const inPool = [...stats.squads].some((s) => s !== null && s in SQUAD_TO_FPL) || stats.squads.has(null);
        if (inPool) report.unmatchedFplPool.push(`${fbrefName} (${[...stats.squads].filter(Boolean).join('/') || 'multi-club'})`);
        continue;
      }
      const row = player.seasons.find((s) => s.season === seasonLabel);
      if (!row) continue; // no FPL row for that season — can't enrich (documented)
      row.shots = stats.values.shots;
      row.shotsOnTarget = stats.values.shotsOnTarget;
      row.keyPasses = stats.values.keyPasses;
      row.crosses = stats.values.crosses;
      row.tacklesWon = stats.values.tacklesWon;
      row.passesCompleted = stats.values.passesCompleted;
      row.gkWins = stats.values.gkWins;
      row.fbrefMinutes = stats.minutes > 0 ? stats.minutes : undefined;
      if (row.fbrefMinutes != null && Math.abs(row.fbrefMinutes - row.minutes) > 90) {
        report.minuteMismatches.push(
          `${player.name} ${seasonLabel}: FBref ${row.fbrefMinutes}′ vs FPL ${row.minutes}′`,
        );
      }
      if (playerById.has(player.id)) report.matched += 1;
      count += 1;
    }
    report.enriched.push({ season: seasonLabel, count });
  }
  return report;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  // 1. Parse raw pages if present; else reuse the committed cache.
  const rawFiles = fs.existsSync(FBREF_RAW_DIR)
    ? fs.readdirSync(FBREF_RAW_DIR).filter((f) => f.endsWith('.html'))
    : [];
  let cache: FbrefParsed;
  if (rawFiles.length > 0) {
    console.log(`[fbref] Parsing ${rawFiles.length} saved page(s) from data/fbref-raw/…`);
    cache = await parseFbrefRawDir();
    writeFbrefCache(cache);
    console.log(`[fbref] Parsed output committed → data/fbref.json`);
  } else {
    const cached = readFbrefCache();
    if (!cached) {
      console.error(
        '[fbref] No saved pages in data/fbref-raw/ and no data/fbref.json — see data/fbref-raw/README.md for capture steps.',
      );
      process.exit(1);
    }
    cache = cached;
    console.log('[fbref] Using committed data/fbref.json (no raw pages found).');
  }

  // 2. Enrich + reproject the snapshot.
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
  const overrides = readOverrides();
  const report = applyFbrefEnrichment(snapshot.players, cache, overrides);

  console.log(`[fbref] Enriched seasons: ${report.enriched.map((e) => `${e.season}=${e.count}`).join(', ')}`);
  if (report.unmatchedFplPool.length) {
    console.warn(
      `[fbref] ${report.unmatchedFplPool.length} unmatched FBref name(s) in-pool (top 25): ${report.unmatchedFplPool.slice(0, 25).join('; ')}`,
    );
    console.warn('[fbref]   → add fixes as {"<fbref name>": "<fpl element id>"} in data/fbref-overrides.json and re-run.');
  }
  if (report.minuteMismatches.length) {
    console.warn(`[fbref] ${report.minuteMismatches.length} minute mismatch(es) (possible mis-match):`);
    for (const m of report.minuteMismatches.slice(0, 10)) console.warn(`[fbref]   ${m}`);
  }

  const { projections } = buildProjections(snapshot.players, DEFAULT_MODEL_CONFIG);
  const players = snapshot.players.map((p, i) => ({ ...p, projection: projections[i] }));
  const out: Snapshot = { ...snapshot, players };
  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(out, null, 2)}\n`);

  const withVolume = snapshot.players.filter((p) => p.seasons.some((s) => s.shotsOnTarget != null)).length;
  console.log(`[fbref] Snapshot updated: ${withVolume}/${snapshot.players.length} players carry FBref volume data.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error('[fbref] Failed:', err);
    process.exit(1);
  });
}
