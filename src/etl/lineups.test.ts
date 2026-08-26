import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLineupSlate, callsForTeamList, matchPulseFixture, type PulseFixture, type PulseFixtureDetail, type PulseTeamList } from './lineups.js';
import type { SnapshotFixture, SnapshotPlayer } from './types.js';

const fixture: SnapshotFixture = { id: 14, event: 2, home: 'LIV', away: 'NFO', homeDifficulty: 2, awayDifficulty: 4, kickoff: '2026-08-29T11:30:00Z' };
const players: SnapshotPlayer[] = [
  { id: '1', name: 'Salah', fullName: 'Mohamed Salah', position: 'FW', team: 'LIV', price: 12, status: 'a', news: '', seasons: [] },
  { id: '2', name: 'Wood', fullName: 'Chris Wood', position: 'FW', team: 'NFO', price: 7, status: 'a', news: '', seasons: [] },
  // Cross-club surname collision — a NFO "Salah" must not steal the LIV call.
  { id: '3', name: 'Salah', fullName: 'Sami Salah', position: 'MD', team: 'NFO', price: 5, status: 'a', news: '', seasons: [] },
  // Out-of-pool: real squads list 9 subs, FPL's pool is the 20-club squad — a
  // youth call-up may simply not be in the snapshot. Skipped, not fabricated.
  { id: '4', name: 'Alisson', fullName: 'Alisson Becker', position: 'G', team: 'LIV', price: 5, status: 'a', news: '', seasons: [] },
];

const season: PulseFixture[] = [
  {
    id: 128939,
    kickoff: { millis: Date.parse('2026-08-29T11:30:00Z') },
    teams: [
      { team: { club: { abbr: 'LIV' } } },
      { team: { club: { abbr: 'NFO' } } },
    ],
  },
  // A different fixture between the same clubs on a different date (the return
  // fixture) — the UTC-date key must not conflate it.
  {
    id: 129400,
    kickoff: { millis: Date.parse('2027-01-16T15:00:00Z') },
    teams: [
      { team: { club: { abbr: 'LIV' } } },
      { team: { club: { abbr: 'NFO' } } },
    ],
  },
];

function teamList(teamId: number, lineupNames: Array<[string, number]>, subNames: Array<[string, number]> = []): PulseTeamList {
  const member = (display: string, shirt: number) => ({ name: { display, first: display.split(' ')[0], last: display.split(' ').slice(1).join(' ') }, matchShirtNumber: shirt, captain: false });
  return { teamId, lineup: lineupNames.map(([n, s]) => member(n, s)), substitutes: subNames.map(([n, s]) => member(n, s)) };
}

const fullDetail: PulseFixtureDetail = {
  id: 128939,
  teamLists: [
    teamList(10, [['Mohamed Salah', 11], ['Alisson Becker', 1]], [['Cody Gakpo', 18]]),
    teamList(14, [['Chris Wood', 9]]),
  ],
};

test('matchPulseFixture joins on clubs + UTC date and ignores the return fixture', () => {
  const hit = matchPulseFixture(fixture, season);
  assert.equal(hit.id, 128939);
});

test('matchPulseFixture fails loudly on calendar drift and on missing fixtures', () => {
  assert.throws(() => matchPulseFixture({ ...fixture, kickoff: '2026-08-29T20:00:00Z' }, season), /Kickoff drift/);
  assert.throws(() => matchPulseFixture({ ...fixture, away: 'BOU' }, season), /No pulselive fixture/);
});

test('buildLineupSlate maps the confirmed XI to starters and named subs to bench', () => {
  const { slate, unmatched } = buildLineupSlate('free-kick-gw2-sat', '2026-08-29', [fixture], players, new Map([[14, fullDetail]]), '2026-08-29T10:00:00Z');
  assert.equal(slate.schemaVersion, 1);
  assert.equal(slate.profileId, 'free-kick-gw2-sat');
  assert.equal(slate.slateDate, '2026-08-29');
  assert.equal(slate.fetchedAt, '2026-08-29T10:00:00Z');
  assert.deepEqual(slate.fixtureCoverage, [{ fixtureId: 14, covered: true }]);
  assert.deepEqual(slate.players, [
    { fixtureId: 14, playerId: '1', status: 'starter' },  // Mohamed Salah — the NFO Salah never steals it
    { fixtureId: 14, playerId: '4', status: 'starter' },  // Alisson Becker (short-name tolerant match)
    { fixtureId: 14, playerId: '2', status: 'starter' },  // Chris Wood
  ]);
  // Cody Gakpo is absent from the synthetic pool — reported, not fabricated.
  assert.deepEqual(unmatched, [{ side: 'home', name: 'Cody Gakpo', shirt: 18 }]);
});

test('callsForTeamList marks named substitutes bench and reports out-of-pool names', () => {
  const list = teamList(10, [['Alisson Becker', 1]], [['Mohamed Salah', 11], ['Cody Gakpo', 18], ['Wataru Endo', 3]]);
  const { calls, unmatched } = callsForTeamList(list, fixture, players, 'home');
  assert.deepEqual(calls, [
    { fixtureId: 14, playerId: '4', status: 'starter' },
    { fixtureId: 14, playerId: '1', status: 'bench' },
  ]);
  assert.deepEqual(unmatched.map((u) => u.name), ['Cody Gakpo', 'Wataru Endo']);
});

test('one side publishing alone is real partial coverage — covered true, only that side called', () => {
  const detail: PulseFixtureDetail = { id: 128939, teamLists: [teamList(10, [['Mohamed Salah', 11]]), null] };
  const { slate } = buildLineupSlate('free-kick-gw2-sat', '2026-08-29', [fixture], players, new Map([[14, detail]]), '2026-08-29T10:00:00Z');
  assert.deepEqual(slate.fixtureCoverage, [{ fixtureId: 14, covered: true }]);
  assert.deepEqual(slate.players, [{ fixtureId: 14, playerId: '1', status: 'starter' }]);
  // The NFO pool stays implicit-unknown (absent from the asset), never fabricated.
});

test('no published lists is an uncovered fixture with an empty players array', () => {
  const detail: PulseFixtureDetail = { id: 128939, teamLists: [null, null] };
  const { slate } = buildLineupSlate('free-kick-gw2-sat', '2026-08-29', [fixture], players, new Map([[14, detail]]), '2026-08-29T10:00:00Z');
  assert.deepEqual(slate.fixtureCoverage, [{ fixtureId: 14, covered: false }]);
  assert.deepEqual(slate.players, []);
});

test('buildLineupSlate is deterministic — a re-run before close is byte-identical', () => {
  const inputs = { profileId: 'free-kick-gw2-sat', slateDate: '2026-08-29', fixtures: [fixture], players, details: new Map([[14, fullDetail]]) };
  const a = buildLineupSlate(inputs.profileId, inputs.slateDate, inputs.fixtures, inputs.players, inputs.details, '2026-08-29T10:00:00Z');
  const b = buildLineupSlate(inputs.profileId, inputs.slateDate, inputs.fixtures, inputs.players, inputs.details, '2026-08-29T10:00:00Z');
  assert.deepEqual(a.slate, b.slate);
  assert.deepEqual(a.unmatched, b.unmatched);
});

test('buildLineupSlate fails loudly when a slate fixture lacks its pulselive detail', () => {
  assert.throws(() => buildLineupSlate('free-kick-gw2-sat', '2026-08-29', [fixture], players, new Map()), /No pulselive detail/);
});
