/**
 * Deterministic walk-forward evaluation (#175).  Each completed gameweek is
 * projected with only the finalized player/team actuals and strength matches
 * available before that GW's first kickoff, then compared with that GW's
 * retained outcome.  This module never fetches or writes data.
 *
 * The FPL event-live feed does not expose shots, crosses, tackles, or passes.
 * Actual points here therefore use the retained Underdog-compatible scoring
 * fields only; the CLI labels that boundary instead of substituting FPL points.
 */

import { FALSE_NINE, modelConfigFor, replacementConfigFor } from '../contest/profiles.js';
import type { GwPlayerActual, Position, Snapshot, SnapshotFixture, SnapshotPlayer, SnapshotStrength } from '../etl/types.js';
import { aggregateSeasonActuals } from './actuals.js';
import type { ModelConfig, ScoringConfig } from './config.js';
import { buildProjections } from './project.js';
import { scoreStatline } from './scoring.js';
import type { ProjectedStatline } from './types.js';

export type BacktestSample = {
  position: Position;
  actual: number;
  p10: number;
  p50: number;
  p90: number;
  minutes: number;
};

export type MetricSummary = {
  count: number;
  mae: number;
  spearman: number | null;
  coverage: number;
  byPosition: Array<{ position: Position; count: number; mae: number }>;
  byMinuteBucket: Array<{ bucket: string; count: number; mae: number }>;
};

export type BacktestGameweek = MetricSummary & {
  event: number;
  fixtures: number;
  teamGoals: { count: number; mae: number; predicted: number; actual: number };
};

export type BacktestReport = MetricSummary & {
  gameweeks: BacktestGameweek[];
  teamGoals: { count: number; mae: number; predicted: number; actual: number };
};

const POSITIONS: Position[] = ['G', 'D', 'MD', 'FW'];

function minuteBucket(minutes: number): string {
  if (minutes === 0) return '0';
  if (minutes < 30) return '1–29';
  if (minutes < 60) return '30–59';
  if (minutes < 90) return '60–89';
  return '90';
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Tie-aware ranks (average rank within each tied group). */
function ranks(values: number[]): number[] {
  const ordered = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = Array<number>(values.length);
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].value === ordered[start].value) end += 1;
    const rank = (start + 1 + end) / 2;
    for (let i = start; i < end; i += 1) out[ordered[i].index] = rank;
    start = end;
  }
  return out;
}

/** Spearman rho over a board, returning null when either ordering is constant. */
export function rankCorrelation(predicted: number[], actual: number[]): number | null {
  if (predicted.length !== actual.length || predicted.length < 2) return null;
  const x = ranks(predicted);
  const y = ranks(actual);
  const mx = average(x);
  const my = average(y);
  let numerator = 0;
  let x2 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    numerator += dx * dy;
    x2 += dx * dx;
    y2 += dy * dy;
  }
  return x2 === 0 || y2 === 0 ? null : round(numerator / Math.sqrt(x2 * y2));
}

export function summarizeSamples(samples: BacktestSample[]): MetricSummary {
  const summarize = (rows: BacktestSample[]) => round(average(rows.map((row) => Math.abs(row.p50 - row.actual))));
  const byPosition = POSITIONS
    .map((position) => {
      const rows = samples.filter((sample) => sample.position === position);
      return { position, count: rows.length, mae: summarize(rows) };
    })
    .filter((row) => row.count > 0);
  const buckets = new Map<string, BacktestSample[]>();
  for (const sample of samples) {
    const bucket = minuteBucket(sample.minutes);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), sample]);
  }
  const bucketOrder = ['0', '1–29', '30–59', '60–89', '90'];
  return {
    count: samples.length,
    mae: summarize(samples),
    spearman: rankCorrelation(samples.map((sample) => sample.p50), samples.map((sample) => sample.actual)),
    coverage: samples.length === 0 ? 0 : round(samples.filter((sample) => sample.actual >= sample.p10 && sample.actual <= sample.p90).length / samples.length),
    byPosition,
    byMinuteBucket: bucketOrder
      .filter((bucket) => buckets.has(bucket))
      .map((bucket) => ({ bucket, count: buckets.get(bucket)!.length, mae: summarize(buckets.get(bucket)!) })),
  };
}

function instant(value: string): number {
  const normalized = value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`;
  return Date.parse(normalized);
}

function strengthBefore(strength: SnapshotStrength | undefined, cutoff: string): SnapshotStrength | undefined {
  if (!strength) return undefined;
  if (!strength.matches) {
    throw new Error('Walk-forward backtest requires strength.matches; refresh the snapshot after #174 retention.');
  }
  const cutoffAt = instant(cutoff);
  const matches = Object.fromEntries(
    Object.entries(strength.matches).map(([club, rows]) => [club, rows.filter((row) => instant(row.date) < cutoffAt)]),
  );
  const clubs = Object.fromEntries(
    Object.keys(strength.clubs).map((club) => {
      const rows = matches[club] ?? [];
      return [club, {
        n: rows.length,
        attack: round(rows.reduce((sum, row) => sum + row.attack, 0)),
        concede: round(rows.reduce((sum, row) => sum + row.concede, 0)),
      }];
    }),
  );
  const all = Object.values(matches).flat();
  if (all.length === 0) return undefined;
  return {
    source: strength.source,
    leagueAttackPerMatch: round(all.reduce((sum, row) => sum + row.attack, 0) / all.length),
    through: all.map((row) => row.date).sort().at(-1)!,
    clubs,
    matches,
  };
}

/** A snapshot representing exactly the information available before GW N. */
export function snapshotBeforeGameweek(snapshot: Snapshot, event: number): Snapshot {
  const target = snapshot.fixtures.filter((fixture) => fixture.event === event);
  if (target.length === 0) throw new Error(`GW${event} has no fixtures in the snapshot.`);
  const cutoff = target.map((fixture) => fixture.kickoff).sort()[0];
  return {
    ...snapshot,
    actuals: { gameweeks: snapshot.actuals.gameweeks.filter((gameweek) => gameweek.event < event) },
    // aggregateSeasonActuals reads final scores from fixtures. Strip scores at
    // and after the target event so later results cannot leak into team priors.
    fixtures: snapshot.fixtures.map((fixture) => fixture.event < event
      ? fixture
      : { ...fixture, homeScore: undefined, awayScore: undefined }),
    strength: strengthBefore(snapshot.strength, cutoff),
  };
}

function actualStatline(row: GwPlayerActual, keeperWin: boolean): ProjectedStatline {
  return {
    minutes: row.minutes, matches: row.minutes / 90,
    goals: row.goals, assists: row.assists,
    shotsOnTarget: 0, shotsOffTarget: 0, chancesCreated: 0, crosses: 0, tackles: 0, passes: 0,
    cleanSheets: row.cleanSheets, goalsConceded: row.goalsConceded, saves: row.saves,
    gkWins: keeperWin ? 1 : 0, penaltiesSaved: row.penaltiesSaved,
  };
}

/** Score one retained GW row using the False Nine scorer, not FPL points. */
export function actualPoints(
  player: SnapshotPlayer,
  row: GwPlayerActual | undefined,
  fixtures: SnapshotFixture[],
  scoring: ScoringConfig,
): number {
  if (!row) return 0;
  const keeperWin = player.position === 'G' && fixtures.some((fixture) =>
    (fixture.home === player.team && fixture.homeScore != null && fixture.awayScore != null && fixture.homeScore > fixture.awayScore)
    || (fixture.away === player.team && fixture.homeScore != null && fixture.awayScore != null && fixture.awayScore > fixture.homeScore));
  return scoreStatline(actualStatline(row, keeperWin), player.position, scoring);
}

function teamGoalSummary(rows: Array<{ predicted: number; actual: number }>) {
  return {
    count: rows.length,
    mae: round(average(rows.map((row) => Math.abs(row.predicted - row.actual)))),
    predicted: round(rows.reduce((sum, row) => sum + row.predicted, 0)),
    actual: round(rows.reduce((sum, row) => sum + row.actual, 0)),
  };
}

/** Run every completed GW in a committed snapshot. Pure; no API calls or writes. */
export function runBacktest(snapshot: Snapshot, cfg: ModelConfig = modelConfigFor(FALSE_NINE)): BacktestReport {
  const allSamples: BacktestSample[] = [];
  const allTeamGoals: Array<{ predicted: number; actual: number }> = [];
  const gameweeks: BacktestGameweek[] = [];
  for (const gameweek of [...snapshot.actuals.gameweeks].sort((a, b) => a.event - b.event)) {
    const targetFixtures = snapshot.fixtures.filter((fixture) => fixture.event === gameweek.event);
    if (targetFixtures.length === 0 || targetFixtures.some((fixture) => fixture.homeScore == null || fixture.awayScore == null)) continue;
    const before = snapshotBeforeGameweek(snapshot, gameweek.event);
    const targetClubs = new Set(targetFixtures.flatMap((fixture) => [fixture.home, fixture.away]));
    const actuals = aggregateSeasonActuals(before.players, before.fixtures, before.actuals, cfg.actuals.startMinutesThreshold) ?? undefined;
    const { projections } = buildProjections(
      before.players, cfg,
      { calendar: before.fixtures, fixtures: targetFixtures, clubs: null },
      replacementConfigFor(FALSE_NINE), undefined, actuals, before.strength,
    );
    const rowsById = new Map(gameweek.players.map((row) => [row.id, row]));
    const samples = before.players.flatMap((player, index) => {
      if (!targetClubs.has(player.team)) return [];
      const projection = projections[index];
      return [{
        position: player.position,
        actual: actualPoints(player, rowsById.get(player.id), targetFixtures, cfg.scoring),
        p10: projection.points.p10,
        p50: projection.points.p50,
        p90: projection.points.p90,
        minutes: rowsById.get(player.id)?.minutes ?? 0,
      }];
    });
    const goalRows = targetFixtures.flatMap((fixture) => [
      { predicted: projections.reduce((sum, projection, index) => sum + (before.players[index].team === fixture.home ? projection.statline.goals : 0), 0), actual: fixture.homeScore! },
      { predicted: projections.reduce((sum, projection, index) => sum + (before.players[index].team === fixture.away ? projection.statline.goals : 0), 0), actual: fixture.awayScore! },
    ]);
    allSamples.push(...samples);
    allTeamGoals.push(...goalRows);
    gameweeks.push({ event: gameweek.event, fixtures: targetFixtures.length, ...summarizeSamples(samples), teamGoals: teamGoalSummary(goalRows) });
  }
  return { ...summarizeSamples(allSamples), gameweeks, teamGoals: teamGoalSummary(allTeamGoals) };
}

function metric(value: number | null): string {
  return value == null ? 'n/a' : value.toFixed(3);
}

/** Human-readable deterministic report for `npm run model -- --backtest`. */
export function printBacktest(report: BacktestReport): void {
  console.log('\n[backtest] Walk-forward baseline — each GW uses only information before its first kickoff.');
  console.log('[backtest] Actual points use retained Underdog-compatible fields; per-GW volume events are not in FPL event/live.');
  console.log(`\n  samples ${report.count}  points MAE ${report.mae.toFixed(3)}  Spearman ${metric(report.spearman)}  p10–p90 coverage ${(report.coverage * 100).toFixed(1)}%`);
  console.log(`  opponent layer: team-goals MAE ${report.teamGoals.mae.toFixed(3)} (${report.teamGoals.predicted.toFixed(2)} projected / ${report.teamGoals.actual.toFixed(2)} actual across ${report.teamGoals.count} teams)`);
  console.log('\n  by position');
  for (const row of report.byPosition) console.log(`    ${row.position.padEnd(2)} n=${String(row.count).padStart(4)}  MAE ${row.mae.toFixed(3)}`);
  console.log('  by actual minutes');
  for (const row of report.byMinuteBucket) console.log(`    ${row.bucket.padEnd(5)} n=${String(row.count).padStart(4)}  MAE ${row.mae.toFixed(3)}`);
  console.log('\n  per completed GW');
  for (const gw of report.gameweeks) {
    console.log(`    GW${String(gw.event).padStart(2)} (${gw.fixtures} fixtures): n=${gw.count} MAE ${gw.mae.toFixed(3)} rho ${metric(gw.spearman)} coverage ${(gw.coverage * 100).toFixed(1)}% · team-goals MAE ${gw.teamGoals.mae.toFixed(3)}`);
  }
}
