/**
 * Per-GW actuals pipeline guards (#40):
 * - GW completeness is all-fixtures-finished (a mid-play or postponed GW
 *   never claims actuals; a GW with zero fixtures doesn't count).
 * - The featured filter keeps players who featured (any non-zero line),
 *   drops pure DNP rows; absence = did not feature.
 * - A finished GW with an empty live feed fails loudly (upstream anomaly —
 *   never deploy a bad snapshot).
 * - The asOf stamp: actualsThrough = highest complete GW, nextKickoff =
 *   earliest unfinished fixture (null when the calendar is done).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAsOf, decimalOrNull, finishedEventNumbers, toGwActuals } from './actuals.js';
import type { RawEventLive, RawFixture, RawLiveElement } from './fpl.js';

/**
 * Captured from https://fantasy.premierleague.com/api/event/1/live/ on
 * 2026-08-26. Deliberately retains the upstream row key (`id`) and selected
 * ignored fields so an upstream payload-shape change fails before cron.
 */
const capturedEvent1LiveRow = {
  id: 1,
  stats: {
    minutes: 90,
    goals_scored: 0,
    assists: 0,
    clean_sheets: 1,
    goals_conceded: 0,
    saves: 1,
    penalties_saved: 0,
    total_points: 6,
    expected_goals: '0.00',
    expected_assists: '0.00',
  },
  explain: [{ fixture: 1, stats: [{ identifier: 'minutes', points: 2, value: 90, points_modification: 0 }] }],
  modified: false,
};

function fixture(overrides: Partial<RawFixture>): RawFixture {
  return {
    id: 1,
    event: 1,
    team_h: 1,
    team_a: 2,
    team_h_difficulty: 3,
    team_a_difficulty: 3,
    kickoff_time: '2026-08-22T14:00:00Z',
    started: false,
    finished: false,
    team_h_score: null,
    team_a_score: null,
    ...overrides,
  };
}

function liveRow(overrides: Partial<RawLiveElement> = {}): RawLiveElement {
  return {
    element: 411,
    stats: {
      minutes: 90,
      goals_scored: 2,
      assists: 0,
      clean_sheets: 0,
      goals_conceded: 0,
      saves: 0,
      penalties_saved: 0,
      total_points: 17,
      expected_goals: '1.84',
      expected_assists: '0.12',
    },
    ...overrides,
  };
}

test('toGwActuals accepts the captured FPL event-live row shape', () => {
  // This cast records the API contract before RawLiveElement is corrected.
  const live = { elements: [capturedEvent1LiveRow] } as unknown as RawEventLive;
  const gw = toGwActuals(1, live);
  assert.deepEqual(gw.players, [
    {
      id: '1',
      minutes: 90,
      goals: 0,
      assists: 0,
      cleanSheets: 1,
      goalsConceded: 0,
      saves: 1,
      penaltiesSaved: 0,
      xg: 0,
      xa: 0,
      fplPoints: 6,
    },
  ]);
});

test('finishedEventNumbers: only all-finished GWs count, ascending', () => {
  const fixtures = [
    fixture({ id: 1, event: 1, finished: true, team_h_score: 2, team_a_score: 1 }),
    fixture({ id: 2, event: 1, finished: true, team_h_score: 0, team_a_score: 0 }),
    fixture({ id: 3, event: 2, finished: true, team_h_score: 1, team_a_score: 1 }),
    fixture({ id: 4, event: 2, finished: false }), // GW2 still has a match in play
    fixture({ id: 5, event: 3, started: true, finished: false }), // GW3 live
    fixture({ id: 6, event: 4, finished: false }), // GW4 future
  ];
  assert.deepEqual(finishedEventNumbers(fixtures), [1]);
});

test('finishedEventNumbers: empty pre-season, and a postponed fixture holds its GW back', () => {
  assert.deepEqual(finishedEventNumbers([]), []);
  assert.deepEqual(finishedEventNumbers([fixture({ event: 7, finished: false })]), []);
  // One finished + one postponed (never finished) fixture in the same GW.
  assert.deepEqual(
    finishedEventNumbers([
      fixture({ id: 1, event: 7, finished: true }),
      fixture({ id: 2, event: 7, finished: false }),
    ]),
    [],
  );
});

test('toGwActuals maps fields (string xG/xA coerced) and keeps only featured players', () => {
  const live: RawEventLive = {
    elements: [
      liveRow(), // played
      liveRow({ element: 1, stats: { ...liveRow().stats, minutes: 90, goals_scored: 0, total_points: 0, expected_goals: undefined } }), // played, no output
      liveRow({ element: 2, stats: { ...liveRow().stats, minutes: 0, goals_scored: 0, total_points: 0, expected_goals: '', expected_assists: '' } }), // DNP
      liveRow({ element: 3, stats: { ...liveRow().stats, minutes: 0, goals_scored: 0, total_points: -3, saves: 0 } }), // 0 mins, red-card points
    ],
  };
  const gw = toGwActuals(1, live);
  assert.deepEqual(gw.players.map((p) => p.id), ['411', '1', '3']);
  const haaland = gw.players[0];
  assert.equal(haaland.minutes, 90);
  assert.equal(haaland.goals, 2);
  assert.equal(haaland.xg, 1.84);
  assert.equal(haaland.xa, 0.12);
  assert.equal(haaland.fplPoints, 17);
  assert.deepEqual(gw.players[1].xg, null); // absent xG → null, row still kept (minutes)
});

test('toGwActuals: zero-minute rows with any non-zero stat are kept (featured)', () => {
  const live: RawEventLive = {
    elements: [
      liveRow({ element: 5, stats: { ...liveRow().stats, minutes: 0, goals_scored: 0, goals_conceded: 2, total_points: -1 } }),
    ],
  };
  const gw = toGwActuals(1, live);
  assert.equal(gw.players.length, 1);
  assert.equal(gw.players[0].goalsConceded, 2);
});

test('toGwActuals: an empty live feed for a finished GW fails loudly', () => {
  assert.throws(() => toGwActuals(1, { elements: [] }), /no elements/);
  assert.throws(() => toGwActuals(1, {} as RawEventLive), /no elements/);
});

test('buildAsOf: actualsThrough, nextKickoff, and the all-done calendar', () => {
  const fetchedAt = '2026-09-01T06:00:00Z';
  const fixtures = [
    fixture({ id: 1, event: 1, kickoff_time: '2026-08-22T14:00:00Z', finished: true }),
    fixture({ id: 2, event: 2, kickoff_time: '2026-08-29T14:00:00Z', finished: true }),
    fixture({ id: 3, event: 3, kickoff_time: '2026-09-05T14:00:00Z', finished: false }),
    fixture({ id: 4, event: 3, kickoff_time: '2026-09-05T16:30:00Z', finished: false }),
  ];
  const asOf = buildAsOf(fetchedAt, fixtures, {
    gameweeks: [{ event: 1, players: [] }, { event: 2, players: [] }],
  });
  assert.equal(asOf.fetchedAt, fetchedAt);
  assert.equal(asOf.actualsThrough, 2);
  assert.equal(asOf.nextKickoff, '2026-09-05T14:00:00Z');

  // Pre-season: no actuals, the calendar's first kickoff is next.
  const pre = buildAsOf(fetchedAt, fixtures.map((f) => ({ ...f, finished: false })), {
    gameweeks: [],
  });
  assert.equal(pre.actualsThrough, 0);
  assert.equal(pre.nextKickoff, '2026-08-22T14:00:00Z');

  // Season over: every fixture finished, actuals through the last GW.
  const done = buildAsOf(
    fetchedAt,
    fixtures.map((f) => ({ ...f, finished: true })),
    { gameweeks: [{ event: 1, players: [] }, { event: 2, players: [] }, { event: 3, players: [] }] },
  );
  assert.equal(done.actualsThrough, 3);
  assert.equal(done.nextKickoff, null);
});

test('decimalOrNull tolerates FPL decimal strings, numbers, and junk', () => {
  assert.equal(decimalOrNull('1.84'), 1.84);
  assert.equal(decimalOrNull(0.5), 0.5);
  assert.equal(decimalOrNull(''), null);
  assert.equal(decimalOrNull(undefined), null);
  assert.equal(decimalOrNull('junk'), null);
});
