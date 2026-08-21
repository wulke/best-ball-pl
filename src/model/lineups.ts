/** Static daily-slate lineup contract (#97). The lineup pull and override UI
 * land separately; this module is the shared, browser-safe join contract. */

export const LINEUP_SCHEMA_VERSION = 1;
export type StartStatus = 'starter' | 'bench' | 'unknown';
export type StartCallSource = 'override' | 'lineup' | 'model';

/** Manual UI calls, keyed player ID → fixture ID. Persist per profile under
 * `bbpl-start-overrides:<profile-id>`; a later UI editor writes this exact
 * JSON shape. Only `starter` and `bench` are meaningful overrides. */
export type StartOverrideMap = Record<string, Record<number, Exclude<StartStatus, 'unknown'>>>;

/** Browser-readable asset at `data/lineups/<profile-id>.json`.
 * `fixtureCoverage` is explicit so an absent player in a covered fixture means
 * unknown, whereas an uncovered fixture has no lineup signal at all. */
export type LineupSlate = {
  schemaVersion: typeof LINEUP_SCHEMA_VERSION;
  profileId: string;
  slateDate: string;
  fetchedAt: string | null;
  fixtureCoverage: Array<{ fixtureId: number; covered: boolean }>;
  players: Array<{ fixtureId: number; playerId: string; status: StartStatus }>;
};

export function startCallForFixture(
  playerId: string,
  fixtureId: number | undefined,
  overrides?: StartOverrideMap,
  lineup?: LineupSlate,
): { status: StartStatus; source: StartCallSource } {
  const override = fixtureId == null ? undefined : overrides?.[playerId]?.[fixtureId];
  if (override) return { status: override, source: 'override' };
  if (fixtureId == null || lineup?.fetchedAt == null) return { status: 'unknown', source: 'model' };
  if (!lineup.fixtureCoverage.some((fixture) => fixture.fixtureId === fixtureId && fixture.covered)) {
    return { status: 'unknown', source: 'model' };
  }
  const status = lineup.players.find((player) => player.fixtureId === fixtureId && player.playerId === playerId)?.status;
  return status && status !== 'unknown'
    ? { status, source: 'lineup' }
    : { status: 'unknown', source: 'model' };
}
