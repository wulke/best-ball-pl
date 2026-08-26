/**
 * Per-GW actuals pipeline (#40): turns the FPL fixtures + `event/{gw}/live`
 * responses into the snapshot's actuals section and data-as-of stamp.
 *
 * Pure functions only — the ETL orchestrator (index.ts) fetches, this module
 * maps, so the classification/filtering rules are unit-testable offline.
 *
 * Settled here:
 * - **A GW is complete iff every one of its fixtures is finished** (fixture
 *   flags, not `bootstrap.events`): self-contained, testable against data the
 *   ETL already fetches, and never claims actuals for a GW mid-play. A
 *   postponed fixture holds its GW's actuals back until the replay finishes —
 *   late but always complete.
 * - **Retention: all-season.** One row set per finished GW, oldest first.
 *   Blending (#43) wants the full recency series and review (#45) wants any
 *   past GW; ~300–400KB raw per GW pretty-printed is acceptable for a
 *   browser-loaded JSON (gzip ~10× on the wire).
 * - **Featured filter:** a row exists iff the player featured — minutes > 0 or
 *   any counting stat non-zero. Absence = did not feature that GW.
 * - **Idempotent re-runs:** pure functions over cached responses; a GW's rows
 *   are byte-identical across re-runs unless FPL corrects its data (which is
 *   exactly what a refresh should pick up).
 */

import type { RawEventLive, RawFixture, RawLiveElement } from './fpl.js';
import type { GwActuals, GwPlayerActual, SnapshotAsOf, SnapshotActuals } from './types.js';

/** FPL ships xG/xA as decimal strings; tolerate absence, numbers, and junk. */
export function decimalOrNull(value: string | number | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Gameweeks whose fixtures are ALL finished, ascending. Empty pre-season. */
export function finishedEventNumbers(fixtures: RawFixture[]): number[] {
  const byEvent = new Map<number, { total: number; done: number }>();
  for (const f of fixtures) {
    const entry = byEvent.get(f.event) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (f.finished) entry.done += 1;
    byEvent.set(f.event, entry);
  }
  return [...byEvent.entries()]
    .filter(([, { total, done }]) => total > 0 && done === total)
    .map(([event]) => event)
    .sort((a, b) => a - b);
}

function featured(stats: RawLiveElement['stats']): boolean {
  return (
    stats.minutes > 0 ||
    stats.goals_scored > 0 ||
    stats.assists > 0 ||
    stats.clean_sheets > 0 ||
    stats.goals_conceded > 0 ||
    stats.saves > 0 ||
    stats.penalties_saved > 0 ||
    stats.total_points !== 0
  );
}

function toGwPlayerActual(row: RawLiveElement): GwPlayerActual {
  if (typeof row.id !== 'number' || row.stats == null) {
    throw new Error(`Malformed event-live row: ${JSON.stringify(row).slice(0, 120)}`);
  }
  const s = row.stats;
  return {
    id: String(row.id),
    minutes: s.minutes,
    goals: s.goals_scored,
    assists: s.assists,
    cleanSheets: s.clean_sheets,
    goalsConceded: s.goals_conceded,
    saves: s.saves,
    penaltiesSaved: s.penalties_saved,
    xg: decimalOrNull(s.expected_goals),
    xa: decimalOrNull(s.expected_assists),
    fplPoints: s.total_points,
  };
}

/** Map one GW's live response to its snapshot section (featured players only). */
export function toGwActuals(event: number, live: RawEventLive): GwActuals {
  if (!Array.isArray(live.elements) || live.elements.length === 0) {
    // A finished GW must have live rows — an empty feed here is an upstream
    // anomaly, not "nobody played". Fail loudly; never deploy a bad snapshot.
    throw new Error(`event/${event}/live returned no elements for a finished GW`);
  }
  return { event, players: live.elements.filter((r) => featured(r.stats)).map(toGwPlayerActual) };
}

/** The freshness contract: what this snapshot covers, and when it goes stale. */
export function buildAsOf(
  fetchedAt: string,
  fixtures: RawFixture[],
  actuals: SnapshotActuals,
): SnapshotAsOf {
  const last = actuals.gameweeks.at(-1);
  const next = fixtures
    .filter((f) => !f.finished)
    .map((f) => f.kickoff_time)
    .sort()
    .at(0);
  return {
    fetchedAt,
    actualsThrough: last ? last.event : 0,
    nextKickoff: next ?? null,
  };
}
