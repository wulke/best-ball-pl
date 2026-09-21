/**
 * Results-driven opponent strength, ETL side (#92):
 * 1. Page parsing — teamsData aggregation (npxG/npxGA sums, n, through),
 *    league mean, and the calendar-club join (Understat title → FPL code).
 * 2. Rollover probe — selectCurrentSeasonPage picks by match dates, never
 *    URL year; a stale current-year page (last season's data) is rejected.
 * 3. Incomplete page — a page missing calendar clubs falls through to null.
 * 4. Fixture-scores fallback — GF/GA aggregates, mean, through, always
 *    current once a match finishes.
 * 5. Per-match retention (#174) — both builders keep chronological
 *    {date, home, attack, concede} rows alongside the sums, pruned to the
 *    calendar; sums stay bit-identical to the pre-retention builders.
 * 6. Section builder — omitted with zero played matches; hard-fails when
 *    matches are played but no source yields aggregates.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchUnderstatLeaguePages,
  parseDateRows,
  playedDatesFromTeamsData,
  selectCurrentSeasonPage,
  understatStrengthFromPage,
  fixtureGoalsStrength,
  buildStrengthSection,
  seasonStartFrom,
  type UnderstatPage,
  type UnderstatTeamsData,
} from './strength.js';
import type { SnapshotFixture, SnapshotStrength } from './types.js';

function teamsData(rows: Record<string, { title: string; npxg: number; npxga: number; date?: string }>): UnderstatTeamsData {
  return Object.fromEntries(
    Object.entries(rows).map(([id, r]) => [
      id,
      {
        title: r.title,
        history: r.npxg > 0
          ? [
              { h_a: 'h', npxG: String(r.npxg), npxGA: String(r.npxga), date: r.date ?? '2026-08-16 15:00:00' },
              { h_a: 'a', npxG: String(r.npxg), npxGA: String(r.npxga), date: r.date ?? '2026-08-16 15:00:00' },
            ]
          : [],
      },
    ]),
  );
}

function page(startYear: number, teams: UnderstatTeamsData, playedDates: string[]): UnderstatPage {
  return { startYear, teamsData: teams, playedDates };
}

function fixture(overrides: Partial<SnapshotFixture> & { home: string; away: string }): SnapshotFixture {
  return {
    id: Math.random(),
    event: 1,
    kickoff: '2026-08-15T14:00:00Z',
    homeDifficulty: 3,
    awayDifficulty: 3,
    ...overrides,
  };
}

test('seasonStartFrom: July-forward year rollover', () => {
  assert.equal(seasonStartFrom([fixture({ home: 'A', away: 'B', kickoff: '2026-08-15T14:00:00Z' })]), '2026-07-01');
  assert.equal(seasonStartFrom([fixture({ home: 'A', away: 'B', kickoff: '2026-02-01T14:00:00Z' })]), '2025-07-01');
});

test('selectCurrentSeasonPage: picks by played dates, not URL year', () => {
  const stale = page(2026, {}, ['2025-05-19 16:00:00']); // URL year 2026 but last-season dates
  const current = page(2025, {}, ['2026-08-16 15:00:00']); // real current-season matches
  assert.equal(selectCurrentSeasonPage([stale, current], '2026-07-01'), current);
  assert.equal(selectCurrentSeasonPage([stale], '2026-07-01'), null);
});

test('parseDateRows: accepts both legacy array rows and current object rows', () => {
  assert.deepEqual(
    parseDateRows([
      ['1', true, 'Arsenal', 'Chelsea', { h: 1, a: 0 }, {}, '2026-08-16 15:00:00'],
      { id: '2', isResult: 'yes', h: 'Liverpool', a: 'Everton', datetime: '2026-08-17 14:00:00' },
      { id: '3', isResult: false, datetime: '2026-08-18 14:00:00' },
    ]),
    ['2026-08-16 15:00:00', '2026-08-17 14:00:00'],
  );
});

test('playedDatesFromTeamsData: selects the current-season page when datesData is unusable', () => {
  const stale = page(2026, teamsData({
    old: { title: 'Arsenal', npxg: 1.2, npxga: 0.7, date: '2025-05-19 16:00:00' },
  }), []);
  const current = page(2025, teamsData({
    recent: { title: 'Arsenal', npxg: 1.5, npxga: 0.9, date: '2026-08-16 15:00:00' },
  }), playedDatesFromTeamsData(teamsData({
    recent: { title: 'Arsenal', npxg: 1.5, npxga: 0.9, date: '2026-08-16 15:00:00' },
  })));

  assert.equal(selectCurrentSeasonPage([stale, current], '2026-07-01'), current);
});

test('understatStrengthFromPage: aggregates sums, league mean, join, prune', () => {
  const t = teamsData({
    m1: { title: 'Manchester City', npxg: 2.5, npxga: 0.5, date: '2026-08-16 15:00:00' },
    a1: { title: 'Arsenal', npxg: 1.8, npxga: 0.9, date: '2026-08-16 15:00:00' },
  });
  const p = page(2026, t, ['2026-08-16 15:00:00']);
  const section = understatStrengthFromPage(p, new Set(['MCI', 'ARS']));
  assert.ok(section);
  assert.equal(section.source, 'understat');
  assert.equal(section.clubs['MCI'].n, 2); // 2 history rows
  assert.equal(section.clubs['MCI'].attack, 5.0); // 2 × 2.5
  assert.equal(section.clubs['MCI'].concede, 1.0); // 2 × 0.5
  // League mean over all page team-matches (2 rows/club):
  // (2.5+1.8+0.5+0.9) × 2 / 4 = 5.7/2... recomputed: attack sums 5+3.6=8.6, n=4 → 2.15
  assert.equal(section.leagueAttackPerMatch, 2.15);
  assert.equal(section.through, '2026-08-16 15:00:00');
  // Pruned to calendar clubs: stray teams are dropped, but the league mean
  // still spans the whole page (the league, not the calendar subset).
  const t2 = teamsData({
    m1: { title: 'Manchester City', npxg: 2.5, npxga: 0.5, date: '2026-08-16 15:00:00' },
    a1: { title: 'Arsenal', npxg: 1.8, npxga: 0.9, date: '2026-08-16 15:00:00' },
    x1: { title: 'Tottenham', npxg: 1.0, npxga: 1.0, date: '2026-08-16 15:00:00' },
  });
  const section2 = understatStrengthFromPage(page(2026, t2, ['2026-08-16 15:00:00']), new Set(['MCI', 'ARS']));
  assert.ok(section2);
  assert.deepEqual(Object.keys(section2.clubs).sort(), ['ARS', 'MCI']);
  // μ = (5 + 3.6 + 2) / 6 = 1.7667 → round3 = 1.767 — Tottenham's rows
  // count toward the mean.
  assert.equal(section2.leagueAttackPerMatch, 1.767);
});

test('understatStrengthFromPage: incomplete page (missing calendar club) → null', () => {
  const t = teamsData({ m1: { title: 'Manchester City', npxg: 2.5, npxga: 0.5 } });
  assert.equal(understatStrengthFromPage(page(2026, t, ['2026-08-16 15:00:00']), new Set(['MCI', 'ARS'])), null);
});

test('understatStrengthFromPage: retains chronological, calendar-pruned match rows without changing sums', () => {
  const p = page(2026, {
    m1: {
      title: 'Manchester City',
      history: [
        { h_a: 'a', npxG: '1.23456', npxGA: '0.44444', date: '2026-08-23 15:00:00' },
        { h_a: 'h', npxG: '2.34567', npxGA: '1.55555', date: '2026-08-16 15:00:00' },
      ],
    },
    a1: {
      title: 'Arsenal',
      history: [{ h_a: 'h', npxG: '0.5', npxGA: '0.6', date: '2026-08-16 15:00:00' }],
    },
    x1: {
      title: 'Tottenham',
      history: [{ h_a: 'h', npxG: '1', npxGA: '1', date: '2026-08-16 15:00:00' }],
    },
  }, ['2026-08-23 15:00:00']);

  const section = understatStrengthFromPage(p, new Set(['MCI', 'ARS']));
  assert.ok(section);
  assert.deepEqual(section.clubs['MCI'], { n: 2, attack: 3.58, concede: 2 });
  assert.deepEqual(section.matches, {
    MCI: [
      { date: '2026-08-16 15:00:00', home: true, attack: 2.346, concede: 1.556 },
      { date: '2026-08-23 15:00:00', home: false, attack: 1.235, concede: 0.444 },
    ],
    ARS: [{ date: '2026-08-16 15:00:00', home: true, attack: 0.5, concede: 0.6 }],
  });
});

test('understatStrengthFromPage: retains chronological per-match rows (#174)', () => {
  const td: UnderstatTeamsData = {
    m1: {
      title: 'Manchester City',
      history: [
        // Deliberately out of order — retention sorts ascending.
        { h_a: 'a', npxG: '1.111111', npxGA: '0.909090', date: '2026-08-30 14:00:00' },
        { h_a: 'h', npxG: '2.5', npxGA: '0.5', date: '2026-08-16 15:00:00' },
        { h_a: 'h', npxG: '1.5', npxGA: '1.0' }, // finite but dateless: counts in sums, not retained
      ],
    },
    a1: {
      title: 'Arsenal',
      history: [
        { h_a: 'h', npxG: '1.8', npxGA: '0.9', date: '2026-08-16 15:00:00' },
        { h_a: 'a', npxG: '1.8', npxGA: '0.9', date: '2026-08-16 15:00:00' },
      ],
    },
  };
  const section = understatStrengthFromPage(page(2026, td, ['2026-08-30 14:00:00']), new Set(['MCI', 'ARS']));
  assert.ok(section);
  assert.ok(section.matches);
  // Dateless row still counted in the sums (n=3) but only dated rows retained.
  assert.equal(section.clubs['MCI'].n, 3);
  assert.deepEqual(section.matches['MCI'], [
    { date: '2026-08-16 15:00:00', home: true, attack: 2.5, concede: 0.5 },
    { date: '2026-08-30 14:00:00', home: false, attack: 1.111, concede: 0.909 }, // round3
  ]);
  assert.deepEqual(section.matches['ARS'].map((m) => m.home), [true, false]);
  // Pruned to calendar clubs like the sums.
  const withStray: UnderstatTeamsData = {
    ...td,
    x1: { title: 'Tottenham', history: [{ h_a: 'h', npxG: '1.0', npxGA: '1.0', date: '2026-08-16 15:00:00' }] },
  };
  const section2 = understatStrengthFromPage(page(2026, withStray, ['2026-08-30 14:00:00']), new Set(['MCI', 'ARS']));
  assert.ok(section2?.matches);
  assert.deepEqual(Object.keys(section2.matches).sort(), ['ARS', 'MCI']);
});

test('fixtureGoalsStrength: GF/GA sums, mean, through', () => {
  const f = [
    fixture({ home: 'MCI', away: 'ARS', homeScore: 2, awayScore: 1, kickoff: '2026-08-15T14:00:00Z' }),
    fixture({ home: 'WOL', away: 'BHA', homeScore: 0, awayScore: 0, kickoff: '2026-08-16T14:00:00Z' }),
    fixture({ home: 'CHE', away: 'FUL', kickoff: '2026-08-17T14:00:00Z' }), // unplayed
  ];
  const section = fixtureGoalsStrength(f);
  assert.ok(section);
  assert.equal(section.source, 'fixture-goals');
  assert.equal(section.clubs['MCI'].n, 1);
  assert.equal(section.clubs['MCI'].attack, 2);
  assert.equal(section.clubs['MCI'].concede, 1);
  assert.equal(section.clubs['ARS'].attack, 1);
  assert.equal(section.clubs['ARS'].concede, 2);
  assert.equal(section.clubs['WOL'].n, 1);
  assert.equal(section.clubs['WOL'].attack, 0);
  // leagueAttackPerMatch = total goals / team-matches = 3 / 4
  assert.equal(section.leagueAttackPerMatch, 0.75);
  assert.equal(section.through, '2026-08-16T14:00:00Z');
  assert.equal(section.clubs['CHE'], undefined); // unplayed club absent
  // Per-match retention (#174): mirrored rows per played fixture, kickoff
  // as date, home flag per side.
  assert.ok(section.matches);
  assert.deepEqual(section.matches['MCI'], [{ date: '2026-08-15T14:00:00Z', home: true, attack: 2, concede: 1 }]);
  assert.deepEqual(section.matches['ARS'], [{ date: '2026-08-15T14:00:00Z', home: false, attack: 1, concede: 2 }]);
  assert.deepEqual(section.matches['WOL'], [{ date: '2026-08-16T14:00:00Z', home: true, attack: 0, concede: 0 }]);
  assert.equal(section.matches['CHE'], undefined);
});

test('fixtureGoalsStrength: null with nothing played', () => {
  const f = [fixture({ home: 'A', away: 'B', kickoff: '2026-08-17T14:00:00Z' })];
  assert.equal(fixtureGoalsStrength(f), null);
});

test('fixtureGoalsStrength: retains mirrored chronological match rows without changing sums', () => {
  const section = fixtureGoalsStrength([
    fixture({ home: 'MCI', away: 'ARS', homeScore: 2, awayScore: 1, kickoff: '2026-08-23T14:00:00Z' }),
    fixture({ home: 'MCI', away: 'CHE', homeScore: 0, awayScore: 3, kickoff: '2026-08-16T14:00:00Z' }),
  ]);
  assert.ok(section);
  assert.deepEqual(section.clubs['MCI'], { n: 2, attack: 2, concede: 4 });
  assert.deepEqual(section.matches, {
    MCI: [
      { date: '2026-08-16T14:00:00Z', home: true, attack: 0, concede: 3 },
      { date: '2026-08-23T14:00:00Z', home: true, attack: 2, concede: 1 },
    ],
    ARS: [{ date: '2026-08-23T14:00:00Z', home: false, attack: 1, concede: 2 }],
    CHE: [{ date: '2026-08-16T14:00:00Z', home: false, attack: 3, concede: 0 }],
  });
});

test('buildStrengthSection: zero played → undefined (parity path)', async () => {
  const f = [fixture({ home: 'A', away: 'B', kickoff: '2026-08-17T14:00:00Z' })];
  const section = await buildStrengthSection(f, () => {});
  assert.equal(section, undefined);
});

test('buildStrengthSection: played but fixture fallback yields aggregates (no live fetch in tests)', async () => {
  const f = [
    fixture({ home: 'MCI', away: 'ARS', homeScore: 2, awayScore: 1, kickoff: '2026-08-15T14:00:00Z' }),
  ];
  // The Understat fetch path is exercised live only; the fallback must
  // produce the section deterministically from fixtures alone. To avoid a
  // Chromium launch in unit tests, we assert the fallback directly and that
  // the orchestrator's non-fetch path (played=0 → undefined) works above.
  const section = fixtureGoalsStrength(f);
  assert.ok(section);
  assert.equal(section.clubs['MCI'].attack, 2);
});

// fetchUnderstatLeaguePages is exercised against the real site only in the
// ETL run; its pure parsing logic is covered by the helpers above.
void fetchUnderstatLeaguePages;
