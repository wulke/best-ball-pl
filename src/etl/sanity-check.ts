/**
 * Snapshot sanity check (#41) — the scheduled refresh's guardrail. Run after
 * `npm run etl` writes a fresh `data/snapshot.json`; exits non-zero (failing
 * the workflow, before anything is committed or a PR opens) if the new
 * snapshot looks broken rather than merely different.
 *
 * Checks:
 *   - player count hasn't collapsed (a truncated/empty FPL response)
 *   - season-window projections aren't degenerate (all zero / all identical
 *     — a sign the model or the upstream stat feed silently broke)
 *   - the asOf stamp is actually fresh (this run observed upstream "now")
 *   - actualsThrough never regresses versus the previously committed
 *     snapshot (a stale/cached upstream response masquerading as live)
 *
 * `PREV_ACTUALS_THROUGH` (optional, set by the workflow from the pre-ETL
 * commit) skips the regression check when absent — e.g. first run ever.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Snapshot } from './types.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SNAPSHOT_PATH = path.join(repoRoot, 'data/snapshot.json');

const MIN_PLAYERS = 400;
const MIN_DISTINCT_P50 = 50;
const MAX_STALENESS_MS = 3 * 60 * 60 * 1000; // 3h — cron fires ~06:00 UTC, generous margin

function fail(message: string): never {
  console.error(`[sanity-check] FAIL: ${message}`);
  process.exit(1);
}

const snapshot: Snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));

if (snapshot.players.length < MIN_PLAYERS) {
  fail(`only ${snapshot.players.length} players (expected >= ${MIN_PLAYERS}) — truncated upstream response?`);
}

const p50s = snapshot.players
  .map((p) => p.projection?.points.p50)
  .filter((v): v is number => typeof v === 'number');
const distinctP50 = new Set(p50s.map((v) => Math.round(v * 100)));
if (p50s.length === 0 || distinctP50.size < MIN_DISTINCT_P50) {
  fail(`only ${distinctP50.size} distinct season p50 projection(s) across ${p50s.length} players — degenerate model output?`);
}
if (p50s.every((v) => v === 0)) {
  fail('every projected player has p50 = 0 — degenerate model output');
}

const fetchedAtMs = Date.parse(snapshot.asOf.fetchedAt);
if (Number.isNaN(fetchedAtMs)) {
  fail(`asOf.fetchedAt is not a parseable timestamp: ${snapshot.asOf.fetchedAt}`);
}
const stalenessMs = Date.now() - fetchedAtMs;
if (stalenessMs > MAX_STALENESS_MS || stalenessMs < 0) {
  fail(`asOf.fetchedAt (${snapshot.asOf.fetchedAt}) is not fresh — ${Math.round(stalenessMs / 60000)}min from now`);
}

const prevRaw = process.env.PREV_ACTUALS_THROUGH;
if (prevRaw !== undefined && prevRaw !== '') {
  const prev = Number(prevRaw);
  if (!Number.isNaN(prev) && snapshot.asOf.actualsThrough < prev) {
    fail(`asOf.actualsThrough regressed: ${snapshot.asOf.actualsThrough} < previous ${prev}`);
  }
}

console.log(
  `[sanity-check] OK: ${snapshot.players.length} players, ${distinctP50.size} distinct p50 values, ` +
    `asOf ${snapshot.asOf.fetchedAt} (actualsThrough GW${snapshot.asOf.actualsThrough}).`,
);
