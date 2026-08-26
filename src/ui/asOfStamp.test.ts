/**
 * #44 data-as-of stamp: the pure formatter over (profile, asOf, pool size,
 * now) — season/daily/closed shapes, the 30h staleness marker, and the
 * defensive fallbacks (missing asOf block, zero actuals, null kickoff).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FALSE_NINE, FREE_KICK_GW1_SAT, FREE_KICK_GW2_SAT } from '../contest/profiles.js';
import { dataAsOfStamp, slateCloseMs } from './asOfStamp.js';

const NOW = new Date('2026-08-26T12:00:00Z');
const AS_OF = {
  fetchedAt: '2026-08-26T11:25:46.250Z',
  actualsThrough: 1,
  nextKickoff: '2026-08-28T19:00:00Z',
};

test('season line: fetched with time, actuals-through, next kickoff, pool size', () => {
  const { text, stale } = dataAsOfStamp({
    profile: FALSE_NINE,
    asOf: AS_OF,
    playerCount: 517,
    now: NOW,
  });
  assert.equal(
    text,
    'fetched 26 Aug, 11:25 UTC · actuals through GW1 · next kickoff Fri 28 Aug, 19:00 UTC · 517 players',
  );
  assert.equal(stale, false);
});

test('daily line: close time leads, fetched is day-only', () => {
  const { text, stale } = dataAsOfStamp({
    profile: FREE_KICK_GW2_SAT,
    asOf: AS_OF,
    playerCount: 131,
    now: NOW,
  });
  assert.equal(
    text,
    'closes Sat 29 Aug, 11:11 UTC · fetched 26 Aug · GW1 actuals · 131 players',
  );
  assert.equal(stale, false);
});

test('closed slate: dim `closed` form, never alarming about having finished', () => {
  const { text } = dataAsOfStamp({
    profile: FREE_KICK_GW1_SAT,
    asOf: AS_OF,
    playerCount: 137,
    now: NOW,
  });
  assert.equal(text, 'closed 22 Aug · fetched 26 Aug · GW1 actuals · 137 players');
});

test('fetched >30h old marks the whole stamp stale', () => {
  const fresh = dataAsOfStamp({
    profile: FALSE_NINE,
    asOf: { ...AS_OF, fetchedAt: '2026-08-25T06:30:00Z' }, // 29.5h — one missed cron, still fine
    playerCount: 517,
    now: NOW,
  });
  assert.equal(fresh.stale, false);

  const stale = dataAsOfStamp({
    profile: FALSE_NINE,
    asOf: { ...AS_OF, fetchedAt: '2026-08-25T06:00:00Z' }, // exactly 30h
    playerCount: 517,
    now: NOW,
  });
  assert.equal(stale.stale, true);
  assert.match(stale.text, /fetched 25 Aug, 06:00 UTC · stale ·/);
});

test('missing asOf block (cached pre-#40 snapshot) degrades to pool size only', () => {
  const { text, stale } = dataAsOfStamp({
    profile: FALSE_NINE,
    asOf: undefined,
    playerCount: 517,
    now: NOW,
  });
  assert.deepEqual({ text, stale }, { text: '517 players', stale: false });
});

test('pre-season snapshot: no GW0 segment, null kickoff omitted', () => {
  const { text } = dataAsOfStamp({
    profile: FALSE_NINE,
    asOf: { fetchedAt: AS_OF.fetchedAt, actualsThrough: 0, nextKickoff: null },
    playerCount: 517,
    now: NOW,
  });
  assert.equal(text, 'fetched 26 Aug, 11:25 UTC · 517 players');
});

test('slateCloseMs derives close from the window, other kinds are null', () => {
  assert.equal(slateCloseMs(FREE_KICK_GW2_SAT), Date.parse('2026-08-29T11:11:00Z'));
  assert.equal(slateCloseMs(FALSE_NINE), null);
});
