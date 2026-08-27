/**
 * Position-override audit (#132) — Underdog's own position tags vs the
 * snapshot's FPL-derived positions.
 *
 * The maintainer's committed draft captures (data/drafts/*.json rooms,
 * data/drafts/fixtures/*.txt saved pages) carry Underdog's position-club line
 * for every drafted player. This audit re-parses those captures with the #22
 * parser/matcher, joins each pick to the snapshot, and reports every player
 * whose Underdog tag disagrees with the sheet — override-ready entries for
 * src/etl/position-overrides.ts (#60's table, #58's research protocol).
 *
 * Trust rules:
 * - A pick is trusted only when the recap's club abbreviation **also** agrees
 *   with the snapshot club — the club line is the join's second, independent
 *   verification. Club-disagreeing picks are quarantined into
 *   `clubMismatches` (transfer-window moves or join ambiguity — eyes on).
 * - Conflicting Underdog tags across captures never auto-apply: the player is
 *   flagged in `conflicts` for manual review.
 * - A pick whose position an existing override already fixed reads as
 *   `confirmed` — the table working as intended, corroborated by reality.
 *
 * Run: `npm run positions:audit` (report only — it never edits anything).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecap } from './parse.js';
import type { Position, SnapshotPlayer } from '../types.js';
import {
  POSITION_OVERRIDES,
  type PositionOverride,
} from '../../etl/position-overrides.js';

/** One capture to audit: a label (file name / room id) and its raw paste. */
export type AuditCapture = { source: string; rawPaste: string };

/** A trusted position disagreement — override-table ready. */
export type AuditRow = {
  playerId: string;
  name: string;
  team: string;
  snapshotPosition: Position;
  udPosition: Position;
  /** Trusted picks carrying this tag (corroboration weight). */
  picks: number;
  /** Distinct captures that produced the tag. */
  sources: string[];
};

/** One player whose captures disagree with each other — manual review. */
export type AuditConflict = {
  playerId: string;
  name: string;
  snapshotPosition: Position;
  tags: { pos: Position; sources: string[] }[];
};

/** A pick whose club line disagreed with the snapshot — join unverified. */
export type AuditClubMismatch = {
  source: string;
  rawName: string;
  udPosition: Position;
  udClub: string;
  snapshotTeam: string;
};

/** A recap name with no confident pool match (transfer insurance, non-EPL). */
export type AuditUnmatched = { rawName: string; tags: string[] };

export type AuditReport = {
  /** Trusted mismatches, name-sorted — candidates for POSITION_OVERRIDES. */
  rows: AuditRow[];
  /** Agreements an existing override already produced — the table confirmed. */
  confirmed: AuditRow[];
  conflicts: AuditConflict[];
  clubMismatches: AuditClubMismatch[];
  unmatched: AuditUnmatched[];
  /** Captures that failed to parse (reported, never fatal). */
  skipped: { source: string; message: string }[];
};

type Tally = {
  player: SnapshotPlayer;
  /** udPosition → distinct sources (club-agreed picks only). */
  tags: Map<Position, Set<string>>;
  picks: Map<Position, number>;
};

export function auditPositions(
  captures: AuditCapture[],
  pool: SnapshotPlayer[],
  overrides: readonly PositionOverride[] = POSITION_OVERRIDES,
): AuditReport {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const tallies = new Map<string, Tally>();
  const clubMismatches: AuditClubMismatch[] = [];
  const unmatched = new Map<string, string[]>();
  const skipped: { source: string; message: string }[] = [];

  const tally = (player: SnapshotPlayer): Tally => {
    let t = tallies.get(player.id);
    if (!t) {
      t = { player, tags: new Map(), picks: new Map() };
      tallies.set(player.id, t);
    }
    return t;
  };

  for (const capture of captures) {
    const parsed = parseRecap(capture.rawPaste, pool);
    if (parsed.status === 'error') {
      skipped.push({ source: capture.source, message: parsed.message });
      continue;
    }
    for (const pick of parsed.picks) {
      const udPosition = pick.udPosition;
      if (!udPosition) continue; // capture predates #132 — nothing to audit
      const tag = `${udPosition} - ${pick.udClub ?? '???'}`;
      if (!pick.playerId) {
        unmatched.set(pick.rawName, [...(unmatched.get(pick.rawName) ?? []), tag]);
        continue;
      }
      const player = byId.get(pick.playerId);
      if (!player) continue;
      if (pick.udClub && pick.udClub !== player.team) {
        // Position may still be Underdog's truth, but the join is unverified —
        // never let a club mismatch drive an override on its own.
        clubMismatches.push({
          source: capture.source,
          rawName: pick.rawName,
          udPosition,
          udClub: pick.udClub,
          snapshotTeam: player.team,
        });
        continue;
      }
      const t = tally(player);
      const sources = t.tags.get(udPosition) ?? new Set<string>();
      sources.add(capture.source);
      t.tags.set(udPosition, sources);
      t.picks.set(udPosition, (t.picks.get(udPosition) ?? 0) + 1);
    }
  }

  const rows: AuditRow[] = [];
  const confirmed: AuditRow[] = [];
  const conflicts: AuditConflict[] = [];

  for (const { player, tags, picks } of tallies.values()) {
    const toRow = (pos: Position): AuditRow => ({
      playerId: player.id,
      name: player.name,
      team: player.team,
      snapshotPosition: player.position,
      udPosition: pos,
      picks: picks.get(pos) ?? 0,
      sources: [...(tags.get(pos) ?? [])],
    });
    if (tags.size > 1) {
      conflicts.push({
        playerId: player.id,
        name: player.name,
        snapshotPosition: player.position,
        tags: [...tags.entries()]
          .map(([pos, sources]) => ({ pos, sources: [...sources] }))
          .sort((a, b) => a.pos.localeCompare(b.pos)),
      });
      continue;
    }
    const [pos] = tags.keys();
    if (!pos) continue;
    if (pos !== player.position) {
      rows.push(toRow(pos));
    } else if (overrides.some((o) => o.fplId === player.id && o.overridePosition === pos)) {
      confirmed.push(toRow(pos));
    }
    // Natural agreement (no override involved) stays silent — no noise.
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  confirmed.sort((a, b) => a.name.localeCompare(b.name));

  return {
    rows,
    confirmed,
    conflicts,
    clubMismatches,
    unmatched: [...unmatched.entries()].map(([rawName, tags]) => ({
      rawName,
      tags: [...new Set(tags)],
    })),
    skipped,
  };
}

// ── CLI: audit every committed capture and print override-ready entries ────

/** `2026-08-19-room-2026-08-19` → `2026-08-19` (label prefix), if present. */
function sourceDate(source: string): string | null {
  return source.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

function loadCaptures(): AuditCapture[] {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  const draftsDir = join(repoRoot, 'data', 'drafts');
  const captures: AuditCapture[] = [];
  for (const file of readdirSync(draftsDir).filter((f) => f.endsWith('.json')).sort()) {
    const room = JSON.parse(readFileSync(join(draftsDir, file), 'utf8')) as {
      rawPaste?: string;
    };
    if (typeof room.rawPaste === 'string') {
      captures.push({ source: file.replace(/\.json$/, ''), rawPaste: room.rawPaste });
    }
  }
  const fixturesDir = join(draftsDir, 'fixtures');
  if (existsSync(fixturesDir)) {
    for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith('.txt')).sort()) {
      captures.push({
        source: file.replace(/\.txt$/, ''),
        rawPaste: readFileSync(join(fixturesDir, file), 'utf8'),
      });
    }
  }
  return captures;
}

function printReport(report: AuditReport): void {
  const dateSpan = (sources: string[]): string => {
    const dates = [
      ...new Set(sources.map(sourceDate).filter((d): d is string => d !== null)),
    ].sort();
    if (dates.length === 0) return 'undated capture';
    return dates.length === 1 ? dates[0] : `${dates[0]}..${dates.at(-1)!.slice(5)}`;
  };

  console.log(
    [
      `trusted mismatches: ${report.rows.length}`,
      `confirmed by captures: ${report.confirmed.length}`,
      `conflicting tags: ${report.conflicts.length}`,
      `club-mismatched picks (quarantined): ${report.clubMismatches.length}`,
      `unmatched names: ${report.unmatched.length}`,
    ].join('\n'),
  );

  if (report.rows.length > 0) {
    console.log('\nOverride-ready entries for src/etl/position-overrides.ts:\n');
    for (const row of report.rows) {
      const note = `${row.name}: Underdog draft recaps ${dateSpan(row.sources)} (${row.picks} pick${row.picks === 1 ? '' : 's'}) — FPL ${row.snapshotPosition}.`;
      console.log(`  {`);
      console.log(`    fplId: '${row.playerId}',`);
      console.log(`    overridePosition: '${row.udPosition}',`);
      console.log(`    note: '${note.replace(/'/g, "\\'")}',`);
      console.log(`  },`);
    }
  }

  if (report.confirmed.length > 0) {
    console.log('\nAlready overridden — captures confirm the fix:');
    for (const row of report.confirmed) {
      console.log(`  ${row.name} (${row.team}) → ${row.udPosition}, ${row.picks} pick(s)`);
    }
  }
  if (report.conflicts.length > 0) {
    console.log('\nCONFLICTING Underdog tags — resolve by eye in the Underdog app before overriding:');
    for (const c of report.conflicts) {
      console.log(`  ${c.name} (${c.playerId}): ${c.tags.map((t) => `${t.pos}×${t.sources.length}`).join(' vs ')}`);
    }
  }
  if (report.clubMismatches.length > 0) {
    console.log('\nClub-mismatched picks (join unverified — inspect before trusting the tag):');
    for (const m of report.clubMismatches) {
      console.log(`  ${m.rawName}: ${m.udPosition} - ${m.udClub} [${m.source}] vs snapshot ${m.snapshotTeam}`);
    }
  }
  if (report.unmatched.length > 0) {
    console.log('\nUnmatched recap names (no join):');
    for (const u of report.unmatched) console.log(`  ${u.rawName}: ${u.tags.join(' | ')}`);
  }
  if (report.skipped.length > 0) {
    console.log('\nSkipped captures:');
    for (const s of report.skipped) console.log(`  ${s.source}: ${s.message}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)) {
  const captures = loadCaptures();
  if (captures.length === 0) {
    console.log('No captures found under data/drafts/ (rooms or fixtures).');
  } else {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const snapshot = JSON.parse(
      readFileSync(join(repoRoot, 'data', 'snapshot.json'), 'utf8'),
    ) as { players: SnapshotPlayer[] };
    const report = auditPositions(captures, snapshot.players);
    console.log(`captures: ${captures.length}`);
    printReport(report);
  }
}
