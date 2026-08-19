/**
 * Model CLI (`npm run model`): reads the committed snapshot, recomputes every
 * player's projection, writes projections back into data/snapshot.json, and
 * prints the ranked report. The fast iteration loop for tuning config
 * constants without touching the API (ETL cache untouched).
 *
 * `npm run model -- --profile <id>` (#42) recomputes under any contest
 * profile's window — e.g. `--profile free-kick-gw1-sat` prints the GW1
 * Saturday slate pool ranked for that window (opponent-adjusted, pool-scoped
 * ranks). Only the default (false-nine) writes the snapshot: the committed
 * projections stay the flagship's season numbers; other windows are views.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FALSE_NINE, modelConfigFor, profileById, resolveContest } from '../contest/profiles.js';
import { buildProjections } from './project.js';
import type { Position, Snapshot, SnapshotPlayer } from '../etl/types.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SNAPSHOT_PATH = path.join(repoRoot, 'data/snapshot.json');
const POSITIONS: Position[] = ['G', 'D', 'MD', 'FW'];

type Row = {
  rank: number;
  name: string;
  pos: Position;
  team: string;
  price: number;
  p50: number;
  p10: number;
  p90: number;
  per90: number;
  value: number;
  conf: string;
  tier: number;
  minutes: number;
  tScore: number;
  risk: boolean;
};

function toRows(players: SnapshotPlayer[]): Row[] {
  return players
    .filter((p) => p.projection)
    .map((p) => ({
      rank: p.projection!.overallRank,
      name: p.name,
      pos: p.position,
      team: p.team,
      price: p.price,
      p50: p.projection!.points.p50,
      p10: p.projection!.points.p10,
      p90: p.projection!.points.p90,
      per90: p.projection!.per90,
      value: p.projection!.value,
      conf: p.projection!.confidence,
      tier: p.projection!.tier,
      minutes: p.projection!.minutes,
      tScore: p.projection!.tournamentScore,
      risk: p.projection!.durabilityRisk,
    }));
}

function printTable(title: string, rows: Row[]): void {
  console.log(`\n${title}`);
  console.log(
    '  rank name                 pos team  price   expMin    p10    p50    p90   /90 tScr tier conf risk',
  );
  console.log('  ' + '-'.repeat(104));
  for (const r of rows) {
    console.log(
      `  ${String(r.rank).padStart(4)} ${r.name.padEnd(20)} ${r.pos.padEnd(3)} ${r.team.padEnd(5)} ${r.price.toFixed(1).padStart(5)} ${String(r.minutes).padStart(7)} ${r.p10.toFixed(0).padStart(6)} ${r.p50.toFixed(0).padStart(6)} ${r.p90.toFixed(0).padStart(6)} ${r.per90.toFixed(2).padStart(5)} ${r.tScore.toFixed(0).padStart(4)} ${String(r.tier).padStart(4)} ${r.conf.padEnd(4)} ${r.risk ? 'R' : ''}`,
    );
  }
}

function printTeamContext(
  teamContexts: Map<string, { cleanSheetRate: number; goalsConcededPerMatch: number; gkWinRate: number }>,
): void {
  console.log('\nTEAM DEFENSIVE CONTEXT (p50 priors — CS/GC from the 2025/26 primary keeper, regressed; win rate from projected GF−GC)');
  console.log('  team  CS/m  GC/m  win%');
  console.log('  ' + '-'.repeat(26));
  const rows = [...teamContexts.entries()].sort((a, b) => b[1].cleanSheetRate - a[1].cleanSheetRate);
  for (const [team, ctx] of rows) {
    console.log(
      `  ${team.padEnd(5)} ${ctx.cleanSheetRate.toFixed(2).padStart(4)} ${ctx.goalsConcededPerMatch.toFixed(2).padStart(5)} ${(ctx.gkWinRate * 100).toFixed(0).padStart(4)}%`,
    );
  }
}

function printWindowFixtures(label: string, fixtures: Snapshot['fixtures']): void {
  console.log(`\n${label} — ${fixtures.length} fixture${fixtures.length === 1 ? '' : 's'}`);
  for (const f of fixtures) {
    console.log(
      `  GW${String(f.event).padStart(2, ' ')} ${f.kickoff.slice(0, 16).replace('T', ' ')}Z  ${f.home}–${f.away}  (FDR ${f.homeDifficulty}/${f.awayDifficulty})`,
    );
  }
}

function profileArg(): string {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith('--profile='));
  if (eq) return eq.split('=')[1];
  const i = argv.indexOf('--profile');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return FALSE_NINE.id;
}

function main() {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
  const profile = profileById(profileArg()); // fail loudly on unknown ids
  const contest = resolveContest(profile, snapshot.fixtures);

  const { projections, teamContexts } = buildProjections(
    snapshot.players,
    modelConfigFor(profile),
    contest,
  );

  const players = snapshot.players.map((p, i) => ({ ...p, projection: projections[i] }));
  // Pool only — non-pool players sit unranked (rank 0) outside the contest.
  const rows = toRows(players)
    .filter((r) => r.rank > 0)
    .sort((a, b) => a.rank - b.rank);

  if (profile.id === FALSE_NINE.id) {
    // Default path — byte-identical to the pre-#42 CLI: write + full report.
    const out: Snapshot = { ...snapshot, players, generated_at: snapshot.generated_at };
    fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`[model] Projections written for ${players.length} players → data/snapshot.json`);
    printTeamContext(teamContexts);
  } else {
    console.log(
      `[model] ${profile.name} — window report only (snapshot untouched; committed projections stay season/false-nine)`,
    );
    printWindowFixtures(profile.name, contest.fixtures);
    const poolClubs = new Set(contest.clubs ?? []);
    printTeamContext(new Map([...teamContexts].filter(([team]) => poolClubs.has(team))));
  }

  printTable(
    `${profile.name.toUpperCase()} — TOP 25 IN POOL (ranked by tournament-adjusted score) — as of ${snapshot.generated_at.slice(0, 10)} — tier = within-position cluster`,
    rows.slice(0, 25),
  );

  for (const pos of POSITIONS) {
    printTable(
      `${pos} — top 10`,
      rows.filter((r) => r.pos === pos).slice(0, 10),
    );
  }

  printTable(
    'VALUE PICKS — top 10 by tournament-adjusted score per £M (price ≤ 6.0, high/med confidence)',
    rows
      .filter((r) => r.price <= 6.0 && r.conf !== 'low')
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
  );

  const unknowns = rows.filter((r) => r.conf === 'low' && r.price >= 7.5);
  printTable(
    'UNRANKED TALENT — price ≥ 7.5 but no FPL history (new signings; model blind)',
    unknowns.slice(0, 15),
  );

  const counts = { high: 0, medium: 0, low: 0 };
  for (const r of rows) counts[r.conf as keyof typeof counts] += 1;
  console.log(
    `\n[model] Confidence: ${counts.high} high / ${counts.medium} medium / ${counts.low} low across ${rows.length} players.`,
  );
}

main();
