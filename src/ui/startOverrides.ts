import type { StartOverrideMap, StartStatus } from '../model/lineups.js';

/** The #98 override editor behind the sheet's start chips. The #97 contract
 * is unchanged: `bbpl-start-overrides:<profile-id>`, keyed player → fixture,
 * only `starter`/`bench` are meaningful. Malformed/stale storage must never
 * block model-default minutes (load stays total). */
export function loadStartOverrides(profileId: string): StartOverrideMap | undefined {
  try {
    const raw = localStorage.getItem(`bbpl-start-overrides:${profileId}`);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const map: StartOverrideMap = {};
    for (const [playerId, fixtures] of Object.entries(parsed as Record<string, unknown>)) {
      if (fixtures == null || typeof fixtures !== 'object') continue;
      for (const [fixtureId, status] of Object.entries(fixtures as Record<string, unknown>)) {
        if ((status === 'starter' || status === 'bench') && Number.isFinite(Number(fixtureId))) {
          (map[playerId] ??= {})[Number(fixtureId)] = status;
        }
      }
    }
    return Object.keys(map).length > 0 ? map : undefined;
  } catch {
    return undefined;
  }
}

export function saveStartOverrides(profileId: string, map: StartOverrideMap): void {
  try {
    // An empty map clears the key entirely — a fully-unwound slate leaves no
    // stale storage behind (and False Nine never grows one in the first place).
    if (Object.keys(map).length === 0) localStorage.removeItem(`bbpl-start-overrides:${profileId}`);
    else localStorage.setItem(`bbpl-start-overrides:${profileId}`, JSON.stringify(map));
  } catch {
    /* storage unavailable — the in-memory map still drives this session */
  }
}

/** Manual call a chip can express: the two #97 override states, or `null` to
 *  clear back to lineup/model precedence. */
export type ManualStartCall = Exclude<StartStatus, 'unknown'> | null;

/** Pure map edit: set or clear one player's fixture call. Empty player/fixture
 *  records are pruned so a cleared board leaves no orphan keys behind. */
export function setStartCall(
  map: StartOverrideMap,
  playerId: string,
  fixtureId: number,
  call: ManualStartCall,
): StartOverrideMap {
  const next: StartOverrideMap = {};
  for (const [pid, fixtures] of Object.entries(map)) {
    next[pid] = { ...fixtures };
  }
  if (call == null) {
    const fixtures = next[playerId];
    if (fixtures) {
      delete fixtures[fixtureId];
      if (Object.keys(fixtures).length === 0) delete next[playerId];
    }
  } else {
    next[playerId] = { ...next[playerId], [fixtureId]: call };
  }
  return Object.keys(next).length > 0 ? next : {};
}

/** The chip's click cycle (#98): none → starter → bench → none. Lineup-sourced
 *  calls enter the cycle at `starter` — the manual call takes precedence over
 *  the lineup by the #97 order, so the first click always asserts a call. */
export function nextManualCall(current: ManualStartCall): ManualStartCall {
  if (current == null) return 'starter';
  if (current === 'starter') return 'bench';
  return null;
}
