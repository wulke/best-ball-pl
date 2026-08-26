import { useCallback, useEffect, useState } from 'react';
import type { StartOverrideMap } from '../model/lineups.js';
import {
  loadStartOverrides,
  nextManualCall,
  saveStartOverrides,
  setStartCall,
  type ManualStartCall,
} from './startOverrides.js';

/**
 * Live manual start calls for one contest profile (#98). The map is the #97
 * `StartOverrideMap` persisted under `bbpl-start-overrides:<profile-id>`
 * (per profile+slate — a GW2 slate's calls never touch another profile's),
 * fed straight into the pool projection so a chip click re-ranks the board
 * under precedence manual > lineup > model. False Nine never mounts this
 * hook (the surface is daily-only), so the flagship's storage is untouched.
 */
export function useStartOverrides(profileId: string) {
  const [overrides, setOverrides] = useState<StartOverrideMap>(() => loadStartOverrides(profileId) ?? {});
  const [loadedProfile, setLoadedProfile] = useState(profileId);

  // Profile switches reload (never write through): switching slates mid-
  // session must not stamp the old slate's calls into the new key.
  useEffect(() => {
    if (loadedProfile !== profileId) {
      setLoadedProfile(profileId);
      setOverrides(loadStartOverrides(profileId) ?? {});
    }
  }, [loadedProfile, profileId]);

  useEffect(() => {
    if (loadedProfile === profileId) saveStartOverrides(profileId, overrides);
  }, [loadedProfile, profileId, overrides]);

  /** Chip click: set/cycle one player's fixture call (none → starter → bench
   *  → none) or apply an explicit call (`null` clears back to auto). */
  const setCall = useCallback(
    (playerId: string, fixtureId: number, call?: ManualStartCall) => {
      setOverrides((prev) => {
        const current = prev[playerId]?.[fixtureId] ?? null;
        return setStartCall(prev, playerId, fixtureId, call !== undefined ? call : nextManualCall(current));
      });
    },
    [],
  );

  return { overrides, setCall };
}
