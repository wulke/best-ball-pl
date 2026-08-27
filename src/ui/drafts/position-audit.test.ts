/**
 * Position-override audit tests (#132): Underdog's own position tags from
 * captured recaps vs the snapshot's FPL-derived positions. The audit joins
 * each pick via the #22 matcher and trusts only name+club-agreed picks —
 * the club line is the second, independent verification of the join.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SnapshotPlayer } from '../types.js';
import type { Position } from '../types.js';
import { auditPositions, type AuditCapture } from './position-audit.js';

const player = (
  id: string,
  name: string,
  fullName: string,
  position: Position,
  team: string,
): SnapshotPlayer =>
  ({
    id,
    name,
    fullName,
    position,
    team,
    price: 5,
    status: 'a',
    news: '',
    seasons: [],
  }) as unknown as SnapshotPlayer;

const POOL: SnapshotPlayer[] = [
  player('1', 'Wingman', 'Arnold Wingman', 'MD', 'XXX'),
  player('2', 'Striker', 'Bob Striker', 'FW', 'XXX'),
  player('3', 'Rock', 'Carl Rock', 'D', 'YYY'),
  player('4', 'Keeper', 'Dan Keeper', 'G', 'YYY'),
];

/** A minimal recap paste: team / anchor / name / position-club blocks. */
const paste = (blocks: [string, string, string, string][]) =>
  blocks
    .map(([team, anchor, rawName, posClub]) => [team, anchor, rawName, posClub].join('\n'))
    .join('\n');

test('a trusted mismatch becomes an override-ready row; agreements stay silent', () => {
  const captures: AuditCapture[] = [
    {
      source: 'room-a',
      rawPaste: paste([
        ['TEAM1', '1.1|1', 'A. Wingman', 'FW - XXX'],
        ['TEAM1', '2.1|2', 'B. Striker', 'FW - XXX'],
      ]),
    },
  ];
  const report = auditPositions(captures, POOL);
  assert.equal(report.rows.length, 1);
  const row = report.rows[0];
  assert.equal(row.playerId, '1');
  assert.equal(row.name, 'Wingman');
  assert.equal(row.snapshotPosition, 'MD');
  assert.equal(row.udPosition, 'FW');
  assert.equal(row.picks, 1);
  assert.deepEqual(row.sources, ['room-a']);
  // Striker agrees (FW == FW) — no row, no noise.
  assert.equal(report.conflicts.length, 0);
  assert.equal(report.clubMismatches.length, 0);
  assert.equal(report.unmatched.length, 0);
});

test('club-disagreeing picks are quarantined, never rows — the join is unverified', () => {
  const captures: AuditCapture[] = [
    {
      source: 'room-a',
      rawPaste: paste([
        ['TEAM1', '1.1|1', 'A. Wingman', 'FW - ZZZ'], // position disagrees, club too
        ['TEAM1', '2.1|2', 'C. Rock', 'D - ZZZ'], // position agrees, club does not
      ]),
    },
  ];
  const report = auditPositions(captures, POOL);
  assert.equal(report.rows.length, 0);
  assert.equal(report.clubMismatches.length, 2);
  const wing = report.clubMismatches.find((m) => m.rawName === 'A. Wingman');
  assert.equal(wing?.udPosition, 'FW');
  assert.equal(wing?.udClub, 'ZZZ');
  assert.equal(wing?.snapshotTeam, 'XXX');
});

test('conflicting Underdog tags across captures flag the player for eyes-on review', () => {
  const captures: AuditCapture[] = [
    { source: 'room-a', rawPaste: paste([['T1', '1.1|1', 'A. Wingman', 'FW - XXX']]) },
    { source: 'room-b', rawPaste: paste([['T2', '1.1|1', 'A. Wingman', 'MD - XXX']]) },
  ];
  const report = auditPositions(captures, POOL);
  assert.equal(report.rows.length, 0); // conflicting tags never auto-apply
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].playerId, '1');
  assert.deepEqual(
    report.conflicts[0].tags.map((t) => t.pos).sort(),
    ['FW', 'MD'],
  );
});

test('unmatched names and unparseable captures are reported, not fatal', () => {
  const captures: AuditCapture[] = [
    { source: 'room-a', rawPaste: paste([['T1', '1.1|1', 'V. Osimhen', 'FW - GAL']]) },
    { source: 'room-bad', rawPaste: 'no anchors here' },
  ];
  const report = auditPositions(captures, POOL);
  assert.equal(report.rows.length, 0);
  assert.equal(report.unmatched.length, 1);
  assert.equal(report.unmatched[0].rawName, 'V. Osimhen');
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].source, 'room-bad');
});

test('picks whose position an existing override already fixed read as confirmed', () => {
  const overriddenPool = POOL.map((p) =>
    p.id === '1' ? { ...p, position: 'FW' as Position } : p,
  );
  const captures: AuditCapture[] = [
    { source: 'room-a', rawPaste: paste([['T1', '1.1|1', 'A. Wingman', 'FW - XXX']]) },
  ];
  // The confirmed bucket is keyed off the committed override table: prime it
  // by auditing a pool already carrying the fix.
  const report = auditPositions(captures, overriddenPool, [
    { fplId: '1', overridePosition: 'FW', note: 'test' },
  ]);
  assert.equal(report.rows.length, 0);
  assert.equal(report.confirmed.length, 1);
  assert.equal(report.confirmed[0].playerId, '1');
});
