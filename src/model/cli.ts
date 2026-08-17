/**
 * Model CLI (`npm run model`): reads the committed snapshot, recomputes every
 * player's projection, writes projections back into data/snapshot.json, and
 * prints the ranked report. The fast iteration loop for tuning config
 * constants without touching the API (ETL cache untouched).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODEL_CONFIG } from './config.js';
import { buildProjections } from './project.js';
import type { Position, Snapshot } from '../etl/types.js';

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
};

function toRows(snapshot: Snapshot): Row[] {
  return snapshot.players
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
    }));
}

function printTable(title: string, rows: Row[]): void {
  console.log(`\n${title}`);
  console.log(
    '  rank name                 pos team  price    p10    p50    p90   /90   val  tier conf',
  );
  console.log('  ' + '-'.repeat(94));
  for (const r of rows) {
    console.log(
      `  ${String(r.rank).padStart(4)} ${r.name.padEnd(20)} ${r.pos.padEnd(3)} ${r.team.padEnd(5)} ${r.price.toFixed(1).padStart(5)} ${r.p10.toFixed(0).padStart(6)} ${r.p50.toFixed(0).padStart(6)} ${r.p90.toFixed(0).padStart(6)} ${r.per90.toFixed(2).padStart(5)} ${r.value.toFixed(1).padStart(5)} ${String(r.tier).padStart(4)} ${r.conf.padEnd(4)}`,
    );
  }
}

function main() {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
  const { projections } = buildProjections(snapshot.players, DEFAULT_MODEL_CONFIG);

  const players = snapshot.players.map((p, i) => ({ ...p, projection: projections[i] }));
  const out: Snapshot = { ...snapshot, players, generated_at: snapshot.generated_at };
  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`[model] Projections written for ${players.length} players → data/snapshot.json`);

  const rows = toRows(out).sort((a, b) => a.rank - b.rank);

  printTable(
    `TOP 25 OVERALL (p50 season points) — as of ${snapshot.generated_at.slice(0, 10)}`,
    rows.slice(0, 25),
  );

  for (const pos of POSITIONS) {
    printTable(
      `${pos} — top 10`,
      rows.filter((r) => r.pos === pos).slice(0, 10),
    );
  }

  printTable(
    'VALUE PICKS — top 10 by p50 per £M (price ≤ 6.0, high/med confidence)',
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
