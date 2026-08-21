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
import { buildMatchIndexes, matchPlayer, norm, readOverrides, SQUAD_TO_FPL, type Overrides } from './match.js';
import { applyPlEnrichment, fetchPlStats } from './pl-stats.js';
import { fetchUnderstatStats, summarizeValidation, validatePlPassing } from './understat.js';
import { DEFAULT_MODEL_CONFIG, DEFAULT_REPLACEMENT } from '../model/config.js';
import { buildProjections } from '../model/project.js';
import { aggregateSeasonActuals } from '../model/actuals.js';
import { FALSE_NINE, resolveContest } from '../contest/profiles.js';
import type { Snapshot, SnapshotPlayer } from './types.js';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SNAPSHOT_PATH = path.join(REPO_ROOT, 'data/snapshot.json');
const FBREF_RAW_DIR = path.join(REPO_ROOT, 'data/fbref-raw');

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
      if (combined.length) {
        // Multi-club aggregate rows: identical full-season totals on every page.
        minutes = Math.max(minutes, row.minutes);
      }
    }
    if (!combined.length) {
      // Per-club rows: the same player appears once per PAGE with identical
      // season minutes for their club — take the max per club, then sum across
      // clubs (a player can have two rows on one page after a mid-season move).
      const perClubMinutes = new Map<string, number>();
      for (const row of perClub) {
        const s = row.squad as string;
        perClubMinutes.set(s, Math.max(perClubMinutes.get(s) ?? 0, row.minutes));
      }
      minutes = [...perClubMinutes.values()].reduce((a, b) => a + b, 0);
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
      const player = matchPlayer(fbrefName, stats.squads, seasonLabel, stats.minutes, players, byNormFull, byNormWeb, overrides);
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
      row.unusedSubs = stats.values.unusedSubs;
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
    ? fs.readdirSync(FBREF_RAW_DIR).filter((f) => /\.(html|mhtml|csv)$/i.test(f))
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

  // 3. PL stats API: FBref's passing page cells are JS-populated and currently
  // served empty, so pull passesCompleted/keyPasses from the Premier League's
  // own leaderboard API instead. FBref-first precedence — PL fills gaps only.
  let plReport = null;
  try {
    const plCache = await fetchPlStats();
    plReport = applyPlEnrichment(snapshot.players, plCache, overrides);
    console.log(
      `[fbref] PL passing filled: ${plReport.enriched.map((e) => `${e.season}=${e.count}`).join(', ')}`,
    );

    // 3b. Best-effort independent cross-check: Understat re-processes the Opta
    // feed with its own definitions, so drift here means the PL API is off.
    try {
      const us = await fetchUnderstatStats();
      const val = validatePlPassing(plCache, us);
      console.log(`[fbref] PL↔Understat validation: ${summarizeValidation(val) || 'no comparable seasons'}`);
      if (val.notes.length) for (const note of val.notes) console.warn(`[fbref]   validation note: ${note}`);
    } catch (err) {
      console.warn(`[fbref] Understat validation skipped (${(err as Error).message})`);
    }
  } catch (err) {
    console.warn(`[fbref] PL stats fetch failed (${(err as Error).message}) — passesCompleted/keyPasses stay on baselines.`);
  }

  // Season window, explicit (#42): all committed fixtures, whole pool.
  // In-season actuals (#43) re-apply on reproject, same as the main ETL.
  const season = resolveContest(FALSE_NINE, snapshot.fixtures);
  const seasonActuals = aggregateSeasonActuals(
    snapshot.players,
    snapshot.fixtures,
    snapshot.actuals,
    DEFAULT_MODEL_CONFIG.actuals.startMinutesThreshold,
  );
  const { projections } = buildProjections(
    snapshot.players,
    DEFAULT_MODEL_CONFIG,
    season,
    DEFAULT_REPLACEMENT,
    undefined,
    seasonActuals ?? undefined,
    snapshot.strength,
  );
  const players = snapshot.players.map((p, i) => ({ ...p, projection: projections[i] }));
  const out: Snapshot = { ...snapshot, players };
  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(out, null, 2)}\n`);

  const withVolume = snapshot.players.filter((p) => p.seasons.some((s) => s.shotsOnTarget != null)).length;
  const withPassing = snapshot.players.filter((p) => p.seasons.some((s) => s.keyPasses != null)).length;
  console.log(`[fbref] Snapshot updated: ${withVolume}/${snapshot.players.length} players carry FBref volume; ${withPassing} carry passing data (FBref+PL).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error('[fbref] Failed:', err);
    process.exit(1);
  });
}
