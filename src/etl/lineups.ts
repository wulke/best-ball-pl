/** Pulselive lineup ETL (#99). Fetches confirmed starting XIs from the Premier
 * League site's match-centre API (footballapi.pulselive.com, research #96) into
 * the model's browser-readable `data/lineups/<profile-id>.json` asset. The
 * output shape is exactly the contract #97's model consumes (`LineupSlate`):
 * per-fixture coverage mask + per-player starter/bench calls. Partial coverage —
 * late-kickoff lists landing after a slate's close — is preserved as
 * `covered: false` fixture rows and absent player entries, never fabricated.
 * The CLI (`npm run lineups -- --profile <id>`) is the manual pre-close pull;
 * this module is the pure, testable join + assembly. */

import { LINEUP_SCHEMA_VERSION, type LineupSlate, type StartStatus } from '../model/lineups.js';
import { matchPlayerByName } from './odds.js';
import type { SnapshotFixture, SnapshotPlayer } from './types.js';

/** Raw pulselive fixture row from the season fixture list. */
export type PulseFixture = {
  id: number;
  kickoff: { millis: number };
  teams: Array<{ team: { club: { abbr: string } } }>;
};

/** A confirmed squad member (starting XI or named substitute). */
export type PulseSquadMember = {
  name: { display: string; first: string; last: string };
  matchShirtNumber: number;
  captain: boolean;
};

/** One side's published team list — null before the site publishes team news. */
export type PulseTeamList = {
  teamId: number;
  lineup: PulseSquadMember[];
  substitutes: PulseSquadMember[];
};

/** The fixture-detail payload. `teamLists` is [home, away]; each entry stays
 *  null until that side's list is published (~60–75 min pre-KO, research #96),
 *  so one side publishing alone is real partial signal. */
export type PulseFixtureDetail = {
  id: number;
  teamLists: Array<PulseTeamList | null> | null;
};

/** A pulselive name that could not be joined to the FPL pool — reported by the
 *  CLI for the #100 ledger (out-of-pool players vs matcher misses). */
export type UnmatchedName = {
  side: 'home' | 'away';
  name: string;
  shirt: number;
};

/** Slack for snapshot-vs-pulselive kickoff drift (provisional-kickoff moves). */
export const KICKOFF_SLACK_MS = 60 * 60 * 1000;

function clubAbbr(team: PulseFixture['teams'][number]): string {
  return (team.team?.club?.abbr ?? '').trim().toUpperCase();
}

/** Join one committed slate fixture to the pulselive season list on clubs +
 *  UTC date, then verify the kickoff. Missing, ambiguous, or drifted matches
 *  fail loudly — the committed calendar is the source of truth. */
export function matchPulseFixture(fixture: SnapshotFixture, season: PulseFixture[]): PulseFixture {
  const key = `${fixture.home}-${fixture.away}-${fixture.kickoff.slice(0, 10)}`;
  const hits = season.filter(
    (row) => row.teams.length >= 2 && `${clubAbbr(row.teams[0])}-${clubAbbr(row.teams[1])}-${new Date(row.kickoff.millis).toISOString().slice(0, 10)}` === key,
  );
  if (hits.length === 0) {
    throw new Error(`[lineups] No pulselive fixture for ${fixture.home}-${fixture.away} on ${fixture.kickoff.slice(0, 10)} — calendar drift?`);
  }
  if (hits.length > 1) {
    throw new Error(`[lineups] Ambiguous pulselive fixture for ${fixture.home}-${fixture.away} on ${fixture.kickoff.slice(0, 10)}`);
  }
  const hit = hits[0];
  const drift = Math.abs(hit.kickoff.millis - Date.parse(fixture.kickoff));
  if (drift > KICKOFF_SLACK_MS) {
    throw new Error(`[lineups] Kickoff drift for ${fixture.home}-${fixture.away}: snapshot ${fixture.kickoff} vs pulselive ${new Date(hit.kickoff.millis).toISOString()}`);
  }
  return hit;
}

/** The start calls + unmatched names for one published team list. XI members
 *  become `starter`; named substitutes `bench` (a known non-starter — the model
 *  floors their slate minutes at the cameo floor). Anyone absent from both is
 *  implicitly `unknown` via the coverage mask. */
export function callsForTeamList(
  list: PulseTeamList,
  fixture: SnapshotFixture,
  players: SnapshotPlayer[],
  side: 'home' | 'away',
): { calls: Array<{ fixtureId: number; playerId: string; status: StartStatus }>; unmatched: UnmatchedName[] } {
  const clubs = new Set([fixture.home, fixture.away]);
  const calls: Array<{ fixtureId: number; playerId: string; status: StartStatus }> = [];
  const unmatched: UnmatchedName[] = [];
  const append = (members: PulseSquadMember[], status: StartStatus) => {
    for (const member of members) {
      const name = member.name?.display ?? `${member.name?.first ?? ''} ${member.name?.last ?? ''}`.trim();
      if (!name) continue;
      const player = matchPlayerByName(players, name, clubs);
      if (player) calls.push({ fixtureId: fixture.id, playerId: player.id, status });
      else unmatched.push({ side, name, shirt: member.matchShirtNumber });
    }
  };
  append(list.lineup ?? [], 'starter');
  append(list.substitutes ?? [], 'bench');
  return { calls, unmatched };
}

/** Assemble the `LineupSlate` asset from per-fixture pulselive details (keyed
 *  by snapshot fixture id). Deterministic — same inputs, same bytes — so a
 *  re-run before close converges on one committed artifact. */
export function buildLineupSlate(
  profileId: string,
  slateDate: string,
  fixtures: SnapshotFixture[],
  players: SnapshotPlayer[],
  details: Map<number, PulseFixtureDetail>,
  fetchedAt = new Date().toISOString(),
): { slate: LineupSlate; unmatched: UnmatchedName[] } {
  const fixtureCoverage: LineupSlate['fixtureCoverage'] = [];
  const playerRows: LineupSlate['players'] = [];
  const unmatched: UnmatchedName[] = [];
  for (const fixture of fixtures) {
    const detail = details.get(fixture.id);
    if (!detail) {
      throw new Error(`[lineups] No pulselive detail for snapshot fixture ${fixture.id} (${fixture.home}-${fixture.away})`);
    }
    const lists = detail.teamLists ?? [];
    const homeList = lists[0] ?? null;
    const awayList = lists[1] ?? null;
    fixtureCoverage.push({ fixtureId: fixture.id, covered: homeList != null || awayList != null });
    if (homeList) {
      const r = callsForTeamList(homeList, fixture, players, 'home');
      playerRows.push(...r.calls);
      unmatched.push(...r.unmatched);
    }
    if (awayList) {
      const r = callsForTeamList(awayList, fixture, players, 'away');
      playerRows.push(...r.calls);
      unmatched.push(...r.unmatched);
    }
  }
  return {
    slate: { schemaVersion: LINEUP_SCHEMA_VERSION, profileId, slateDate, fetchedAt, fixtureCoverage, players: playerRows },
    unmatched,
  };
}
