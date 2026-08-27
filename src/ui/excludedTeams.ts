import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SnapshotFixture } from './types.js';

const STORAGE_KEY = 'bbpl-excluded-teams';
const EMPTY_TEAMS = new Set<string>();

/** The filter may only contain clubs playing in the active daily slate. */
export function excludedTeamsForFixtures(fixtures: readonly SnapshotFixture[]): Set<string> {
  return new Set(fixtures.flatMap((fixture) => [fixture.home, fixture.away]));
}

/** Load a profile-scoped team exclusion set, discarding stale/non-slate clubs. */
export function loadExcludedTeams(namespace: string, allowedTeams: ReadonlySet<string>): Set<string> {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${namespace}`);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((team): team is string => typeof team === 'string' && allowedTeams.has(team)));
  } catch {
    return new Set();
  }
}

/** The table's team gate; App composes it with its position/search/draft filters. */
export function filterSheetPlayers<T extends { team: string }>(
  players: readonly T[],
  excludedTeams: ReadonlySet<string>,
): T[] {
  return players.filter((player) => !excludedTeams.has(player.team));
}

/** Daily-sheet-only club exclusions; False Nine supplies no namespace. */
export function useExcludedTeams(namespace: string | undefined, allowedTeams: ReadonlySet<string>) {
  const allowedKey = useMemo(() => [...allowedTeams].sort().join(','), [allowedTeams]);
  const [state, setState] = useState<{ namespace: string | undefined; teams: Set<string> }>(
    () => ({ namespace, teams: new Set() }),
  );

  useEffect(() => {
    setState({ namespace, teams: namespace ? loadExcludedTeams(namespace, allowedTeams) : new Set() });
  }, [namespace, allowedTeams, allowedKey]);

  const persist = useCallback((next: Set<string>) => {
    if (!namespace) return;
    try {
      localStorage.setItem(`${STORAGE_KEY}:${namespace}`, JSON.stringify([...next]));
    } catch {
      // Storage unavailable — the current sheet session still works.
    }
  }, [namespace]);

  const toggle = useCallback((team: string) => {
    if (!namespace || !allowedTeams.has(team)) return;
    setState((previous) => {
      const next = new Set(previous.namespace === namespace ? previous.teams : EMPTY_TEAMS);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      persist(next);
      return { namespace, teams: next };
    });
  }, [namespace, allowedTeams, persist]);

  const clear = useCallback(() => {
    const next = new Set<string>();
    setState({ namespace, teams: next });
    persist(next);
  }, [persist]);

  // A profile switch must never briefly apply the previous slate's filter.
  const excludedTeams = state.namespace === namespace ? state.teams : EMPTY_TEAMS;
  return { excludedTeams, toggle, clear };
}
